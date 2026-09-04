import { createSign, randomUUID, createPrivateKey } from 'node:crypto';
import { getSettings } from './db.js';

/* ============================================================
   PAY BY BANK — open banking payment initiation via TrueLayer
   ============================================================
   The customer taps their bank, approves in their banking app, and the money
   lands in the shop account in seconds. No card fees, no chargebacks, and —
   unlike a manual transfer — the shop is told automatically when it arrives,
   so nobody has to match references by hand.

   TrueLayer v3 requires every mutating request to carry a detached JWS
   signature made with an EC P-521 key registered in their console. That is
   what signRequest below builds.
================================================================ */

const HOSTS = {
  sandbox: { auth: 'https://auth.truelayer-sandbox.com', api: 'https://api.truelayer-sandbox.com',
             pay: 'https://payment.truelayer-sandbox.com' },
  live:    { auth: 'https://auth.truelayer.com',         api: 'https://api.truelayer.com',
             pay: 'https://payment.truelayer.com' },
};

export async function bankConfig() {
  const s = await getSettings();
  const on = s.bank_pay_on === '1';
  const ready = on && s.tl_client_id && s.tl_client_secret && s.tl_kid && s.tl_private_key
                && s.tl_merchant_id;
  return {
    on, ready, s,
    hosts: HOSTS[s.tl_env === 'live' ? 'live' : 'sandbox'],
    env: s.tl_env === 'live' ? 'live' : 'sandbox',
  };
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Detached JWS over (header . payload), with the body removed from the token. */
function signRequest({ kid, privateKey, method, path, idempotencyKey, body }) {
  const header = b64url(JSON.stringify({
    alg: 'ES512', kid, 'tl_version': '2',
    'tl_headers': 'Idempotency-Key',
  }));
  const payload = b64url(
    `${method.toUpperCase()} ${path}\n` +
    `Idempotency-Key: ${idempotencyKey}\n` +
    `${body}`
  );
  const signer = createSign('SHA512');
  signer.update(`${header}.${payload}`);
  signer.end();
  const der = signer.sign(createPrivateKey(privateKey));
  return `${header}..${b64url(derToJose(der, 66))}`;
}

/* Node signs ECDSA as DER; JOSE wants fixed-width r||s. */
function derToJose(der, size) {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error('bad DER signature');
  if (der[o] & 0x80) o += der[o] - 0x80 + 1; else o += 1;
  if (der[o++] !== 0x02) throw new Error('bad DER signature');
  let rLen = der[o++];
  let r = der.subarray(o, o + rLen); o += rLen;
  if (der[o++] !== 0x02) throw new Error('bad DER signature');
  let sLen = der[o++];
  let s = der.subarray(o, o + sLen);
  const pad = (b) => {
    b = b[0] === 0 ? b.subarray(1) : b;
    return Buffer.concat([Buffer.alloc(size - b.length, 0), b]);
  };
  return Buffer.concat([pad(r), pad(s)]);
}

export async function token(cfg) {
  const res = await fetch(`${cfg.hosts.auth}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.s.tl_client_id,
      client_secret: cfg.s.tl_client_secret,
      scope: 'payments',
    }),
  });
  if (!res.ok) throw new Error(`auth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

/* Create a payment and return where to send the customer. */
export async function createBankPayment({ order, returnUrl }) {
  const cfg = await bankConfig();
  if (!cfg.ready) throw new Error('Pay by bank is not configured');

  const access = await token(cfg);
  const idem = randomUUID();
  const path = '/v3/payments';
  const payload = {
    amount_in_minor: order.total_p,
    currency: 'GBP',
    payment_method: {
      type: 'bank_transfer',
      provider_selection: { type: 'user_selected' },
      beneficiary: {
        type: 'merchant_account',
        merchant_account_id: cfg.s.tl_merchant_id,
        /* Shown in the customer's banking app, so it must be recognisable. */
        reference: order.ref,
      },
    },
    user: {
      name: order.cust_name || 'Customer',
      email: order.cust_email || undefined,
    },
  };
  const body = JSON.stringify(payload);

  const res = await fetch(`${cfg.hosts.api}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${access}`,
      'content-type': 'application/json',
      'Idempotency-Key': idem,
      'Tl-Signature': signRequest({
        kid: cfg.s.tl_kid, privateKey: cfg.s.tl_private_key,
        method: 'POST', path, idempotencyKey: idem, body,
      }),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`payment create failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const out = await res.json();
  const url = new URL(`${cfg.hosts.pay}/payments`);
  url.searchParams.set('payment_id', out.id);
  url.searchParams.set('resource_token', out.resource_token);
  url.searchParams.set('return_uri', returnUrl);
  return { id: out.id, redirect: url.toString() };
}

/* Ask TrueLayer what actually happened. Never trust the browser's word for it. */
export async function bankPaymentStatus(paymentId) {
  const cfg = await bankConfig();
  if (!cfg.ready) return null;
  const access = await token(cfg);
  const res = await fetch(`${cfg.hosts.api}/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${access}` },
  });
  if (!res.ok) return null;
  const p = await res.json();
  return { status: p.status, settled: p.status === 'settled', raw: p };
}

/* Setup calls this to prove the keys work before a real customer ever hits
   them. Saving credentials and discovering they are wrong at the first
   checkout is the failure this exists to prevent. */
export async function testBank() {
  const cfg = await bankConfig();
  if (!cfg.ready) throw new Error('Some of the TrueLayer fields are still blank.');
  await token(cfg);
  return { ok: true, env: cfg.env };
}
