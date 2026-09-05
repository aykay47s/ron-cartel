/* Sign in with Google.
 *
 * The shop had email-and-password only, which meant a customer had to invent
 * and remember another password to see where their bike is — and with no
 * email service running there was no way to reset it either. One button is
 * the whole point.
 *
 * Straight OpenID Connect against Google, no library. The id_token comes back
 * over a server-to-server call on a channel we opened, so the token itself is
 * trusted; what still has to be checked is that it is FOR US and that Google
 * says the address is verified.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSettings } from './db.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export async function googleConfig() {
  const s = await getSettings();
  return {
    ready: !!(s.google_client_id && s.google_client_secret),
    id: s.google_client_id,
    secret: s.google_client_secret,
    siteUrl: String(s.site_url || '').replace(/\/$/, ''),
  };
}

/* Where Google sends them back. Must match the Authorised redirect URI in the
   Google console exactly, which is why the setup page prints it for copying. */
export const redirectUri = (cfg, c) => {
  if (cfg.siteUrl) return cfg.siteUrl + '/auth/google/callback';
  const proto = (c.req.header('x-forwarded-proto') || 'http').split(',')[0].trim();
  const host = c.req.header('host') || 'localhost';
  return `${proto}://${host}/auth/google/callback`;
};

export const newState = () => randomBytes(16).toString('hex');

/* Constant-time compare so a returning state cannot be probed a byte at a time. */
export function sameState(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function authUrl(cfg, c, state) {
  const p = new URLSearchParams({
    client_id: cfg.id,
    redirect_uri: redirectUri(cfg, c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH}?${p}`;
}

/* Swap the code for tokens, then read the identity out of the id_token. */
export async function exchange(cfg, c, code) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.id,
      client_secret: cfg.secret,
      redirect_uri: redirectUri(cfg, c),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error('Google refused the sign-in (' + res.status + ')');
  const body = await res.json();
  if (!body.id_token) throw new Error('Google sent no identity back');

  const claims = JSON.parse(
    Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'));

  /* This token has to be for this shop, from Google, still valid, and about
     an address Google has actually verified. Any of those missing and we do
     not know who is at the other end. */
  if (claims.aud !== cfg.id) throw new Error('That sign-in was issued for a different app');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) {
    throw new Error('That sign-in did not come from Google');
  }
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('That sign-in has expired');
  if (!claims.email) throw new Error('Google did not share an email address');
  if (claims.email_verified === false) {
    throw new Error('That Google account has an unverified email address');
  }
  return { email: claims.email, name: claims.name || '' };
}
