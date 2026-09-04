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

/* Only mark cookies Secure when the request actually arrived over HTTPS.
   Tying this to NODE_ENV meant a production box on a bare IP set Secure over
   plain HTTP — browsers silently drop the cookie, so signing in bounced
   straight back to the login form. nginx passes X-Forwarded-Proto. */
function isHttps(c) {
  const xf = c.req.header('x-forwarded-proto');
  if (xf) return xf.split(',')[0].trim().toLowerCase() === 'https';
  try { return new URL(c.req.url).protocol === 'https:'; } catch { return false; }
}
const secureFlag = (c) => (isHttps(c) ? '; Secure' : '');

export function setCookie(c, token, expires) {
  const secure = secureFlag(c);
  c.header('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` +
    `${secure}; Expires=${expires.toUTCString()}`);
}

export function clearCookie(c) {
  const secure = secureFlag(c);
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
/* A short PIN is only safe if guessing is slow — but only FAILURES should
   count. Counting successful sign-ins too means an owner who logs in a few
   times in one session locks themselves out of their own shop. */
const fails = new Map();
const LIMIT = 5;
const WINDOW = 15 * 60_000;

export function lockedOut(key) {
  const rec = fails.get(key);
  if (!rec) return false;
  if (Date.now() > rec.reset) { fails.delete(key); return false; }
  return rec.n >= LIMIT;
}

export function recordFailure(key) {
  const now = Date.now();
  const rec = fails.get(key);
  if (!rec || now > rec.reset) fails.set(key, { n: 1, reset: now + WINDOW });
  else rec.n += 1;
}

export function clearFailures(key) { fails.delete(key); }

/* Kept for callers that just want the old one-shot behaviour. */
export function throttle(key) {
  if (lockedOut(key)) return false;
  recordFailure(key);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (now > v.reset) fails.delete(k);
}, 60_000).unref?.();

/* ============================================================
   CUSTOMER ACCOUNTS — separate cookie, separate table, no admin rights
   ============================================================ */
const C_COOKIE = 'rc_cust';

export async function createCustomer({ email, password, name, phone, address }) {
  const hash = await hashPassword(password);
  return one(
    `insert into customers (email, pass_hash, name, phone, address)
     values (lower($1),$2,$3,$4,$5) returning id, email, name`,
    [String(email).trim(), hash, name || '', phone || '', address || '']
  );
}

export async function customerByEmail(email) {
  return one('select * from customers where email = lower($1)', [String(email).trim()]);
}

export async function customerLogin(email, password) {
  const cust = await customerByEmail(email);
  if (!cust) return null;
  if (!(await verifyPassword(password, cust.pass_hash))) return null;
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 864e5);
  await q('insert into customer_sessions (token, customer_id, expires_at) values ($1,$2,$3)',
          [token, cust.id, expires]);
  return { token, expires, customer: cust };
}

export async function customerFrom(token) {
  if (!token) return null;
  return one(
    `select c.id, c.email, c.name, c.phone, c.address
       from customer_sessions s join customers c on c.id = s.customer_id
      where s.token = $1 and s.expires_at > now()`,
    [token]
  );
}

export const customerLogout = (token) => q('delete from customer_sessions where token = $1', [token]);

export const readCustomerCookie = (c) => readCookie(c, C_COOKIE);

export function setCustomerCookie(c, token, expires) {
  const secure = secureFlag(c);
  c.header('Set-Cookie',
    `${C_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` +
    `${secure}; Expires=${expires.toUTCString()}`);
}

export function clearCustomerCookie(c) {
  const secure = secureFlag(c);
  c.header('Set-Cookie', `${C_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}

export async function requireCustomer(c, next) {
  const cust = await customerFrom(readCustomerCookie(c));
  if (!cust) return c.redirect('/signin?next=' + encodeURIComponent(c.req.path));
  c.set('customer', cust);
  await next();
}
