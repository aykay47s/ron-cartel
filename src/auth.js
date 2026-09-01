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

export async function login(email, password) {
  const admin = await one('select * from admins where email = lower($1)', [String(email).trim()]);
  if (!admin) return null;
  if (!(await verifyPassword(password, admin.pass_hash))) return null;
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
    if ((await adminCount()) === 0) return c.redirect('/admin/setup');
    const back = encodeURIComponent(c.req.path);
    return c.redirect('/admin/login?next=' + back);
  }
  c.set('admin', sess);
  await next();
}

/* Cheap per-IP throttle on the login form. */
const attempts = new Map();
export function throttle(key, limit = 8, windowMs = 10 * 60_000) {
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
