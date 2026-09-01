import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q, one } from './db.js';

const scrypt = promisify(_scrypt);
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 14);
const COOKIE = 'rc_sess';

export async function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  try {
    const [scheme, salt, hex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hex) return false;
    const key = await scrypt(plain, salt, 64);
    const known = Buffer.from(hex, 'hex');
    if (known.length !== key.length) return false;
    return timingSafeEqual(known, key);
  } catch { return false; }
}

export async function adminCount() {
  const r = await one('select count(*)::int as n from admins');
  return r ? r.n : 0;
}

export async function createAdmin(email, password) {
  const hash = await hashPassword(password);
  return one(
    `insert into admins (email, pass_hash) values (lower($1), $2)
     returning id, email`,
    [email.trim(), hash]
  );
}

/* One shop, one owner, one PIN. Seeded on first boot so there is no setup
   step to get wrong; changeable from Settings straight after. */
export const DEFAULT_PIN = process.env.ADMIN_PIN || '9247';

export async function seedOwner() {
  if ((await adminCount()) > 0) return false;
  await createAdmin('owner', DEFAULT_PIN);
  console.log('[auth] owner account created with the default PIN — change it in Settings');
  return true;
}

export async function setPin(newPin) {
  const hash = await hashPassword(newPin);
  await q('update admins set pass_hash = $1', [hash]);
  await q('delete from sessions');           // force every other device to re-enter it
  return true;
}

export async function login(pin) {
  const admin = await one('select * from admins order by id limit 1');
  if (!admin) return null;
  if (!(await verifyPassword(pin, admin.pass_hash))) return null;
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_DAYS * 864e5);
  await q('insert into sessions (token, admin_id, expires_at) values ($1,$2,$3)',
          [token, admin.id, expires]);
  return { token, expires, admin };
}

export async function sessionFrom(token) {
  if (!token) return null;
  const row = await one(
    `select s.token, a.id, a.email
       from sessions s join admins a on a.id = s.admin_id
      where s.token = $1 and s.expires_at > now()`,
    [token]
  );
  return row || null;
}

export const logout = (token) => q('delete from sessions where token = $1', [token]);

export function readCookie(c, name = COOKIE) {
  const raw = c.req.header('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setCookie(c, token, expires) {
  const secure = (process.env.NODE_ENV === 'production') ? '; Secure' : '';
  c.header('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` +
    `${secure}; Expires=${expires.toUTCString()}`);
}

export function clearCookie(c) {
  const secure = (process.env.NODE_ENV === 'production') ? '; Secure' : '';
  c.header('Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}

/* Gate for every /admin route except login and first-run setup. */
export async function requireAdmin(c, next) {
  const sess = await sessionFrom(readCookie(c));
  if (!sess) {
    const back = encodeURIComponent(c.req.path);
    return c.redirect('/admin/login?next=' + back);
  }
  c.set('admin', sess);
  await next();
}

/* Cheap per-IP throttle on the login form. */
const attempts = new Map();
/* A short PIN is only safe if guessing is slow. Five tries per quarter hour
   turns 10,000 combinations into roughly three weeks of continuous attempts. */
export function throttle(key, limit = 5, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.reset) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  rec.n += 1;
  return rec.n <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
}, 60_000).unref?.();
