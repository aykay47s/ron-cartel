import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { getSettings } from './db.js';

/* A small SMTP client. Written by hand rather than pulled in as a dependency
   because all it ever needs to do is send one short plain-text email, and a
   mail library is a lot of surface area for that. Works with Brevo, Mailgun,
   Fastmail, Zoho — anything that speaks SMTP with AUTH LOGIN on 587. */

const CRLF = '\r\n';

function talk(socket, expectCode, payload) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // A reply is complete when the last line is "NNN " rather than "NNN-".
      const lines = buf.split(CRLF).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last)) return;
      socket.removeListener('data', onData);
      const code = parseInt(last.slice(0, 3), 10);
      if (expectCode && code !== expectCode) {
        return reject(new Error(`SMTP expected ${expectCode}, got: ${last.trim()}`));
      }
      resolve(buf);
    };
    socket.on('data', onData);
    socket.once('error', reject);
    if (payload !== undefined) socket.write(payload + CRLF);
  });
}

function headerSafe(s) {
  // Strip CR/LF so a name or subject can never inject extra headers.
  return String(s || '').replace(/[\r\n]+/g, ' ').trim();
}

export async function sendMail({ to, subject, text }) {
  const s = await getSettings();
  if (!s.emails_on || !s.smtp_host || !s.smtp_user) {
    return { sent: false, reason: 'email not configured' };
  }

  const host = s.smtp_host.trim();
  const port = parseInt(s.smtp_port, 10) || 587;
  const from = (s.smtp_from || s.smtp_user).trim();

  let socket = createConnection({ host, port });
  socket.setTimeout(15000);
  socket.setEncoding('utf8');

  try {
    await new Promise((res, rej) => {
      socket.once('connect', res);
      socket.once('error', rej);
      socket.once('timeout', () => rej(new Error('SMTP connect timed out')));
    });
    await talk(socket, 220);
    await talk(socket, 250, `EHLO roncartel`);
    await talk(socket, 220, 'STARTTLS');

    socket = tlsConnect({ socket, servername: host, rejectUnauthorized: true });
    await new Promise((res, rej) => {
      socket.once('secureConnect', res);
      socket.once('error', rej);
    });
    socket.setEncoding('utf8');

    await talk(socket, 250, `EHLO roncartel`);
    await talk(socket, 334, 'AUTH LOGIN');
    await talk(socket, 334, Buffer.from(s.smtp_user).toString('base64'));
    await talk(socket, 235, Buffer.from(s.smtp_pass).toString('base64'));
    await talk(socket, 250, `MAIL FROM:<${from}>`);
    await talk(socket, 250, `RCPT TO:<${to}>`);
    await talk(socket, 354, 'DATA');

    const body = [
      `From: ${headerSafe(s.shop_name || 'Ron Cartel')} <${from}>`,
      `To: <${to}>`,
      `Subject: ${headerSafe(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      String(text).replace(/^\./gm, '..'),   // dot-stuffing
      '.',
    ].join(CRLF);

    await talk(socket, 250, body);
    socket.write('QUIT' + CRLF);
    socket.end();
    return { sent: true };
  } catch (e) {
    try { socket.destroy(); } catch {}
    console.error('[mail] could not send to', to, '-', e.message);
    return { sent: false, reason: e.message };
  }
}

/* Fire-and-forget: an email problem must never break an order. */
export function sendMailSafe(msg) {
  sendMail(msg).catch((e) => console.error('[mail]', e.message));
}

export const templates = {
  orderPlaced: (o, s) => ({
    subject: `Order ${o.ref} — payment needed`,
    text:
`Thanks for your order.

  Item       ${o.product_name} x${o.qty}
  ${o.is_deposit ? 'Deposit   ' : 'Total     '} £${(o.total_p / 100).toFixed(2)}
  Reference  ${o.ref}

${o.method === 'ppff'
  ? `Send by PayPal to ${s.paypal_address}, putting ${o.ref} in the message.`
  : `Send by bank transfer to:
  ${s.bank_account_name}
  Sort code ${s.bank_sort}
  Account   ${o.bank_number || s.bank_number}
  Reference ${o.ref}`}

The reference matters — it is how we match your payment to this order.

Track it any time at ${s.site_url || ''}/order/${o.ref}

Stock is held for ${s.hold_hours} hours.

${s.shop_name}`,
  }),

  paymentConfirmed: (o, s) => ({
    subject: `Order ${o.ref} — payment received`,
    text:
`We have your payment for ${o.ref}. ${o.product_name} x${o.qty} is confirmed.

${o.is_deposit
  ? 'That was the deposit, so your item is reserved. We will be in touch about collection.'
  : 'It will be packed and dispatched next.'}

Track it at ${s.site_url || ''}/order/${o.ref}

${s.shop_name}`,
  }),

  dispatched: (o, s) => ({
    subject: `Order ${o.ref} — on its way`,
    text:
`${o.product_name} has been dispatched.

  Carrier   ${o.tracking_carrier || '—'}
  Tracking  ${o.tracking_number || '—'}

Track it at ${s.site_url || ''}/order/${o.ref}

${s.shop_name}`,
  }),
};
