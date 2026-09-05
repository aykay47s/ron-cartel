/* Guided setup.
 *
 * The settings page had every field on it and no idea what any of them were
 * for. Three things needed explaining rather than listing: taking money by
 * bank, sending email, and deciding how things get delivered. Each of these
 * is a short page that says what to do, gives you the one link you need, and
 * then TESTS it — because "I pasted some keys and nothing happened" is not a
 * setup experience.
 */
import { Hono } from 'hono';
import { q, many, one, getSettings, setSettings } from './db.js';
import { requireAdmin } from './auth.js';
import { layout, esc, money, icon, flash } from './ui.js';
import { testBank } from './pay-bank.js';
import { sendMail } from './mail.js';
import { COURIERS, COUNTRIES, ZONES, countryName, leadTime } from './shipping.js';

export const setupRoutes = new Hono();
setupRoutes.use('/admin/setup/*', requireAdmin);
setupRoutes.use('/admin/delivery', requireAdmin);
setupRoutes.use('/admin/delivery/*', requireAdmin);

const pence = (v) => Math.max(0, Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100) || 0);

const wrap = (title, active, inner) => `<main class="shell adm">
  <div class="adm-head"><div>
    <p class="eyebrow" style="margin:0 0 9px">Admin</p>
    <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">${title}</h1>
  </div></div>
  <div class="tabs" role="tablist">
    <a href="/admin">${icon.bank} Orders</a>
    <a href="/admin/tracking">${icon.pin} Tracking</a>
    <a href="/admin/products">${icon.box} Products</a>
    <a href="/admin/delivery"${active === 'delivery' ? ' class="on"' : ''}>${icon.truck} Delivery</a>
    <a href="/admin/setup/email"${active === 'email' ? ' class="on"' : ''}>${icon.mail} Email</a>
    <a href="/admin/settings"${active === 'settings' ? ' class="on"' : ''}>${icon.cog} Settings</a>
  </div>
  ${inner}</main>`;

/* A numbered step. Three of them, never more — the moment there is a fourth
   nobody finishes. */
const step = (n, title, body, state = '') => `
  <section class="step ${state}">
    <div class="step-n">${state === 'done' ? icon.tick : n}</div>
    <div class="step-b"><h3>${title}</h3>${body}</div>
  </section>`;

/* ------------------------------------------------------------------ *
 *  PAY BY BANK
 * ------------------------------------------------------------------ */
setupRoutes.get('/admin/setup/bank', async (c) => {
  const s = await getSettings();
  const hasKeys = !!(s.tl_client_id && s.tl_client_secret && s.tl_kid && s.tl_private_key);
  const live = s.bank_pay_on === '1';
  const tested = c.req.query('tested');
  const err = c.req.query('e');

  const body = wrap('Take payment straight from a bank', 'bank', `
    ${flash('error', err)}
    ${tested === 'ok' ? flash('info', 'Connected. TrueLayer answered and your keys work.') : ''}
    <p class="lede" style="max-width:60ch;margin-bottom:26px">
      The customer taps their bank, approves it in their banking app, and the money
      lands in your account in seconds. No card processor, no percentage, nothing to
      freeze. It runs on TrueLayer, who are FCA-regulated — you need an account with
      them first, and that is the only fiddly part.</p>

    ${step(1, 'Open a TrueLayer account', `
      <p>Sign up, then in their console create an application and generate a signing
      key. You will end up with four things: a <strong>client ID</strong>, a
      <strong>client secret</strong>, a <strong>key ID</strong> and a
      <strong>private key</strong> file.</p>
      <p class="hint">Start in Sandbox — it uses fake banks so you can test the whole
      flow without moving real money. Switch to Live when you are happy.</p>
      <a class="btn ghost sm" href="https://console.truelayer.com/" target="_blank" rel="noopener noreferrer">
        ${icon.globe} Open the TrueLayer console</a>`, hasKeys ? 'done' : '')}

    ${step(2, 'Paste the four things here', `
      <form method="post" action="/admin/setup/bank">
        <div class="grid2">
          <div class="field"><label for="env">Environment</label>
            <select id="env" name="tl_env">
              <option value="sandbox"${s.tl_env !== 'live' ? ' selected' : ''}>Sandbox — fake banks, for testing</option>
              <option value="live"${s.tl_env === 'live' ? ' selected' : ''}>Live — real money</option>
            </select></div>
          <div class="field"><label for="mid">Merchant account ID</label>
            <input id="mid" name="tl_merchant_id" value="${esc(s.tl_merchant_id)}" maxlength="80"
                   placeholder="the account the money lands in"></div>
        </div>
        <div class="field"><label for="cid">Client ID</label>
          <input id="cid" name="tl_client_id" value="${esc(s.tl_client_id)}" maxlength="120"></div>
        <div class="field"><label for="cs">Client secret</label>
          <input id="cs" name="tl_client_secret" type="password" value="${esc(s.tl_client_secret)}" maxlength="200"
                 autocomplete="off"></div>
        <div class="field"><label for="kid">Key ID</label>
          <input id="kid" name="tl_kid" value="${esc(s.tl_kid)}" maxlength="120"></div>
        <div class="field"><label for="pk">Private key</label>
          <textarea id="pk" name="tl_private_key" rows="5" spellcheck="false"
            placeholder="-----BEGIN EC PRIVATE KEY-----">${esc(s.tl_private_key)}</textarea>
          <div class="hint">Open the .pem file TrueLayer gave you in any text editor and
            paste the whole thing, including the BEGIN and END lines.</div></div>
        <button class="btn" type="submit">${icon.tick} Save and test the connection</button>
      </form>`, hasKeys ? 'done' : '')}

    ${step(3, 'Turn it on at checkout', hasKeys ? `
      <form method="post" action="/admin/setup/bank/live">
        <p>${live
          ? 'Pay by bank is <strong>on</strong> and sits at the top of the payment list.'
          : 'Your keys are saved. Flip this when you are ready for customers to see it.'}</p>
        <button class="btn${live ? ' ghost' : ''}" type="submit" name="on" value="${live ? '0' : '1'}">
          ${live ? 'Turn it off' : icon.spark + ' Turn pay by bank on'}</button>
      </form>` : '<p class="hint">Finish step 2 first.</p>', live ? 'done' : '')}
  `);
  return c.html(layout({ title: 'Pay by bank — Setup', body, active: 'admin', admin: c.get('admin'), settings: s }));
});

setupRoutes.post('/admin/setup/bank', async (c) => {
  const f = await c.req.parseBody();
  const patch = {};
  for (const k of ['tl_env', 'tl_client_id', 'tl_client_secret', 'tl_kid', 'tl_private_key', 'tl_merchant_id']) {
    patch[k] = String(f[k] ?? '').trim();
  }
  await setSettings(patch);
  /* Ask TrueLayer for a token straight away. Saving keys that do not work and
     finding out at the first real checkout is the failure worth avoiding. */
  try {
    await testBank();
    return c.redirect('/admin/setup/bank?tested=ok');
  } catch (e) {
    return c.redirect('/admin/setup/bank?e=' + encodeURIComponent(
      'Saved, but TrueLayer refused those details: ' + String(e.message).slice(0, 160)));
  }
});

setupRoutes.post('/admin/setup/bank/live', async (c) => {
  const f = await c.req.parseBody();
  await setSettings({ bank_pay_on: String(f.on) === '1' ? '1' : '' });
  return c.redirect('/admin/setup/bank');
});

/* ------------------------------------------------------------------ *
 *  EMAIL
 *
 *  The constraint, written down so nobody re-argues it in six months:
 *  since 1 Feb 2024 Gmail and Yahoo — and Microsoft from May 2025 —
 *  reject mail that is not DKIM-signed by the domain it claims to come
 *  from. So every relay (Brevo, Mailjet, Resend, SMTP2GO) makes you
 *  authenticate a domain you own, and none of them will authenticate a
 *  @gmail.com address. Ron Cartel has no domain yet.
 *
 *  The one free route left that actually lands in an inbox is sending
 *  THROUGH Google with an app password. Google signs it itself, so SPF
 *  and DKIM both line up. 500 a day, free, no card, no domain.
 *  When the domain lands, a relay becomes worth it and this page gets a
 *  fourth card. Not before.
 * ------------------------------------------------------------------ */
const PROVIDERS = {
  gmail: {
    name: 'Gmail', tag: 'Free — start here',
    host: 'smtp.gmail.com', port: '587',
    cap: '500 emails a day. Free forever, no card, and it works without a domain.',
    lock: true,
    walk: [
      { t: 'Turn on 2-step verification',
        d: 'Google will not give out an app password until this is on. One minute, once, and it protects the account the shop runs on.',
        href: 'https://myaccount.google.com/signinoptions/twosv', btn: 'Open 2-step verification' },
      { t: 'Create the app password',
        d: 'Name it <b>Ron Cartel</b> and press Create. Google shows sixteen letters in four groups. That is what goes in the box below — not the password you sign in with. Copy it before closing the window; it is never shown again.',
        href: 'https://myaccount.google.com/apppasswords', btn: 'Open app passwords' },
    ],
  },
  icloud: {
    name: 'iCloud Mail', tag: 'Free',
    host: 'smtp.mail.me.com', port: '587',
    cap: 'Works the same way. You need an app-specific password from your Apple account.',
    lock: true,
    walk: [
      { t: 'Get an app-specific password',
        d: 'Sign in, open <b>Sign-In and Security</b>, then <b>App-Specific Passwords</b>. Apple gives you a code with dashes in it — keep the dashes.',
        href: 'https://account.apple.com/account/manage', btn: 'Open Apple account' },
    ],
  },
  domain: {
    name: 'A mailbox on my own domain', tag: 'Best, once you have one',
    host: '', port: '587',
    cap: 'orders@roncartel.co.uk sending as itself. Best deliverability and it looks like a real shop.',
    lock: false,
    walk: [
      { t: 'Get the server name from whoever hosts the mailbox',
        d: 'They will give you an SMTP server, a port (587 almost always) and the mailbox password. Fill those in below.',
        href: '', btn: '' },
    ],
  },
  custom: {
    name: 'Something else', tag: '',
    host: '', port: '587',
    cap: 'Any server that speaks SMTP on port 587.',
    lock: false,
    walk: [
      { t: 'Enter the details your provider gave you',
        d: 'Server name, port, the address, and its password.',
        href: '', btn: '' },
    ],
  },
};

/* Google prints app passwords as four groups of four for readability. The
   spaces are not part of it, and pasting them is the single most common
   reason a first test fails. Take them out — but only when the result is
   exactly sixteen letters, so a real password with a space survives. */
function tidyAppPassword(v) {
  const raw = String(v || '');
  const tight = raw.replace(/\s+/g, '');
  if (/\s/.test(raw) && /^[A-Za-z]{16}$/.test(tight)) return tight;
  return raw.trim();
}

/* SMTP tells you what went wrong in a code. Nobody should have to look
   one up to find out they pasted the wrong password. */
function plainly(msg, host) {
  const m = String(msg || '');
  const google = host === 'smtp.gmail.com';
  if (/534|application-specific password/i.test(m)) {
    return 'Google wants an app password here, not the password you sign in with. Step 2 above has the link.';
  }
  if (/535|5\.7\.8|Username and Password not accepted|authentication fail/i.test(m)) {
    return google
      ? 'Google turned that password down. Three things it is almost always: 2-step verification is not on yet, the code was typed instead of pasted, or that is your sign-in password rather than the sixteen-letter app password.'
      : 'The server would not accept that address and password together.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) {
    return 'There is no server by that name — check the SMTP server line for a typo.';
  }
  if (/ECONNREFUSED/i.test(m)) return 'The server refused the connection on that port. Try 587.';
  if (/timed out|ETIMEDOUT/i.test(m)) {
    return 'The server never answered. Either the port is wrong or outgoing mail is blocked.';
  }
  if (/certificate|self.signed|altname|CERT_/i.test(m)) {
    return 'The server’s security certificate did not match its name, so the connection was dropped.';
  }
  if (/55[0-3]|relay|not permitted|not allowed/i.test(m)) {
    return 'It accepted the sign-in but refused to send from that address. The send-from address has to be the account you signed in with.';
  }
  return m.slice(0, 170);
}

setupRoutes.get('/admin/setup/email', async (c) => {
  const s = await getSettings();
  const pick = c.req.query('p') || (s.smtp_host
    ? (Object.entries(PROVIDERS).find(([, v]) => v.host && v.host === s.smtp_host)?.[0] || 'domain')
    : '');
  const p = PROVIDERS[pick];
  const configured = !!(s.smtp_host && s.smtp_user && s.smtp_pass);
  const sent = c.req.query('sent');

  const walk = p ? p.walk.map((w, i) => `
    <div class="walk">
      <div class="walk-n">${i + 1}</div>
      <div class="walk-b">
        <h4>${w.t}</h4>
        <p>${w.d}</p>
        ${w.href ? `<a class="btn ghost sm" href="${w.href}" target="_blank" rel="noopener noreferrer">
          ${icon.globe} ${esc(w.btn)}</a>` : ''}
      </div>
    </div>`).join('') : '';

  const body = wrap('Sending email', 'email', `
    ${flash('error', c.req.query('e'))}
    ${sent ? `<div class="won">
        <div class="won-i">${icon.tick}</div>
        <div><h3>That went out.</h3>
        <p>Check the inbox — and the spam folder the first time, because the first
        message from any new sender often lands there. Once you mark it as not spam,
        the rest go straight in. Your shop is now sending order confirmations,
        payment receipts and delivery updates on its own.</p></div>
      </div>` : ''}

    <p class="lede" style="max-width:62ch;margin-bottom:8px">
      Every order confirmation, payment receipt and “your bike is in Lutterworth”
      update goes out from your address. It costs nothing. It takes about four
      minutes, and two of those are Google making you prove it is you.</p>
    <p class="micro" style="max-width:62ch;margin:0 0 26px">
      Nothing you type here leaves your own server, and the password is never in the code.</p>

    ${step(1, 'Which email do you want it sent from?', `
      <div class="mailpick">
        ${Object.entries(PROVIDERS).map(([k, v]) => `
          <a class="mp${pick === k ? ' on' : ''}" href="/admin/setup/email?p=${k}">
            <span class="mp-h">${icon.mail}<b>${esc(v.name)}</b>
              ${v.tag ? `<i>${esc(v.tag)}</i>` : ''}</span>
            <span class="mp-c">${esc(v.cap)}</span>
          </a>`).join('')}
      </div>
      <details class="whynot">
        <summary>Why not Outlook, or one of the free sending services?</summary>
        <p><b>Outlook and Hotmail</b> — Microsoft switched personal accounts off app
        passwords on 16 September 2024. The server name still looks right and the
        sign-in still fails. Do not spend an evening on it.</p>
        <p><b>Brevo, Mailjet, Resend, SMTP2GO</b> — all genuinely free at the sizes
        you need, and all of them make you prove you own a domain first, because
        since February 2024 Gmail and Yahoo bin mail that is not signed by the domain
        it claims to come from. None of them will sign a @gmail.com address for you.
        The day roncartel.co.uk exists, one of these becomes the right answer and
        this page gets another card. Until then, Gmail is not a compromise — it is
        the option that actually reaches people.</p>
      </details>`, pick ? 'done' : '')}

    ${pick ? step(2, 'Set it up', `
      ${walk}
      <form method="post" action="/admin/setup/email" style="margin-top:20px">
        <input type="hidden" name="p" value="${esc(pick)}">
        ${p.lock
          ? `<input type="hidden" name="smtp_host" value="${esc(p.host)}">
             <input type="hidden" name="smtp_port" value="${esc(p.port)}">
             <p class="micro" style="margin:0 0 14px">Server and port are filled in for you
             (${esc(p.host)}, port ${esc(p.port)}).</p>`
          : `<div class="grid2">
              <div class="field"><label for="sh">SMTP server</label>
                <input id="sh" name="smtp_host" value="${esc(s.smtp_host)}" placeholder="mail.yourhost.com"></div>
              <div class="field"><label for="sp">Port</label>
                <input id="sp" name="smtp_port" value="${esc(s.smtp_port || '587')}" inputmode="numeric"></div>
            </div>`}
        <div class="field"><label for="su">The email address</label>
          <input id="su" name="smtp_user" type="email" value="${esc(s.smtp_user)}"
                 autocomplete="username" placeholder="${pick === 'gmail' ? 'you@gmail.com' : 'orders@roncartel.co.uk'}"></div>
        <div class="field"><label for="spw">${p.lock ? 'App password' : 'Password'}</label>
          <input id="spw" name="smtp_pass" type="password" value="${esc(s.smtp_pass)}"
                 autocomplete="off" placeholder="${pick === 'gmail' ? 'the sixteen letters' : ''}">
          <div class="hint">${pick === 'gmail'
            ? 'Paste it with or without the spaces — either is fine.'
            : 'Kept on your own server.'}</div></div>
        ${p.lock ? '' : `
        <div class="field"><label for="sf">Send from <span class="opt">optional</span></label>
          <input id="sf" name="smtp_from" type="email" value="${esc(s.smtp_from)}"
                 placeholder="orders@roncartel.co.uk">
          <div class="hint">Leave this empty unless the mailbox sends as a different
            address. The name customers see is your shop name, set in Settings.</div></div>`}
        <button class="btn" type="submit">${icon.tick} Save</button>
      </form>`, configured ? 'done' : '') : ''}

    ${configured ? step(3, 'Prove it works', `
      <p>Send one to yourself. If it arrives, you are done — there is nothing else
      to switch on.</p>
      <form method="post" action="/admin/setup/email/test">
        <div class="field" style="max-width:380px"><label for="to">Send a test to</label>
          <input id="to" name="to" type="email" required value="${esc(s.smtp_user)}"></div>
        <button class="btn" type="submit">${icon.mail} Send test email</button>
      </form>
      <div class="uses">
        <p class="micro" style="margin:0 0 8px">Once this works, the shop sends:</p>
        <ul>
          <li>the order confirmation, with the reference and what to pay</li>
          <li>a receipt when you mark a payment received</li>
          <li>every tracking update you post, with where the bike is</li>
          <li>a note to everyone on the waiting list when a bike comes back in</li>
        </ul>
      </div>`, sent ? 'done' : '') : ''}
  `);
  return c.html(layout({ title: 'Email — Setup', body, active: 'admin', admin: c.get('admin'), settings: s }));
});

setupRoutes.post('/admin/setup/email', async (c) => {
  const f = await c.req.parseBody();
  const patch = {};
  for (const k of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from']) {
    if (f[k] !== undefined) patch[k] = String(f[k]).trim();
  }
  if (f.smtp_pass !== undefined) patch.smtp_pass = tidyAppPassword(f.smtp_pass);
  /* Filling this in IS turning email on. A separate "enable emails" tick box
     somewhere else is exactly the sort of thing that makes people think the
     setup did not work. */
  if (patch.smtp_host && patch.smtp_user && patch.smtp_pass) patch.emails_on = '1';
  await setSettings(patch);
  return c.redirect('/admin/setup/email?p=' + encodeURIComponent(String(f.p || '')));
});

setupRoutes.post('/admin/setup/email/test', async (c) => {
  const f = await c.req.parseBody();
  const s = await getSettings();
  const to = String(f.to || '').trim();
  const shop = s.shop_name || 'your shop';
  try {
    const r = await sendMail({
      to,
      subject: `Test from ${shop}`,
      text: `This is a test.\n\nIf you are reading it, ${shop} can send email, and your `
          + `customers will get their order confirmations and delivery updates.\n\n`
          + `If it landed in spam, mark it as not spam once and the rest will go to the inbox.\n`,
    });
    if (r && r.sent === false) throw new Error(r.reason || 'email is not configured yet');
    return c.redirect('/admin/setup/email?sent=1');
  } catch (e) {
    return c.redirect('/admin/setup/email?e=' + encodeURIComponent(plainly(e.message, s.smtp_host)));
  }
});

/* ------------------------------------------------------------------ *
 *  DELIVERY
 * ------------------------------------------------------------------ */
setupRoutes.get('/admin/delivery', async (c) => {
  const s = await getSettings();
  const opts = await many('select * from delivery_options order by position, id');

  const row = (o) => `
    <form method="post" action="/admin/delivery/${o.id}" class="dopt">
      <details${o.label === 'New option' ? ' open' : ''}>
      <summary class="dopt-h">
        <span class="dico">${icon[COURIERS[o.courier]?.glyph || 'box']}</span>
        <strong>${esc(o.label || 'Untitled')}</strong>
        <span class="tag">${esc(COURIERS[o.courier]?.name || 'No courier')}</span>
        <span class="tag">${esc((ZONES.find(([z]) => z === o.zone) || [null, o.zone])[1])}</span>
        <span class="dprice">${o.price_p === 0 ? 'Free' : '£' + money(o.price_p)}</span>
        <span class="dcv" aria-hidden="true">${icon.chev || '▾'}</span>
      </summary>
      <div class="dopt-b">
        <div class="grid2">
          <div class="field"><label>Shown to the customer as</label>
            <input name="label" value="${esc(o.label)}" maxlength="60" required></div>
          <div class="field"><label>Courier</label>
            <select name="courier">${Object.entries(COURIERS).map(([k, v]) =>
              `<option value="${k}"${o.courier === k ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Price £</label>
            <input name="price" value="${money(o.price_p)}" inputmode="decimal"></div>
          <div class="field"><label>Free when the order is over £</label>
            <input name="free_over" value="${o.free_over_p ? money(o.free_over_p) : ''}"
                   inputmode="decimal" placeholder="leave blank for never"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Where it goes</label>
            <select name="zone">${ZONES.map(([z, lbl]) =>
              `<option value="${z}"${o.zone === z ? ' selected' : ''}>${esc(lbl)}</option>`).join('')}
              <option value="custom"${!ZONES.some(([z]) => z === o.zone) ? ' selected' : ''}>Only certain countries…</option>
            </select>
            <input name="zone_list" value="${!ZONES.some(([z]) => z === o.zone) ? esc(o.zone) : ''}"
                   placeholder="GB, IE, FR" style="margin-top:8px">
            <div class="hint">Two-letter country codes, separated by commas. Only used
              when you pick “Only certain countries”.</div></div>
          <div class="field"><label>Takes (working days)</label>
            <div class="grid2">
              <input name="days_min" value="${o.days_min || ''}" inputmode="numeric" placeholder="from">
              <input name="days_max" value="${o.days_max || ''}" inputmode="numeric" placeholder="to">
            </div>
            <div class="hint">${esc(leadTime(o.days_min, o.days_max) || 'Leave blank to say nothing about timing.')}</div></div>
        </div>
        <div class="field"><label>Extra line under the name</label>
          <input name="note" value="${esc(o.note)}" maxlength="120"
                 placeholder="left blank, this is written from the days above"></div>
        <div class="dopt-f">
          <label class="chk"><input type="checkbox" name="enabled" ${o.enabled ? 'checked' : ''}>
            Show at checkout</label>
          <label class="chk"><input type="checkbox" name="is_collection" ${o.is_collection ? 'checked' : ''}>
            This is collection in person</label>
          <button class="btn sm" type="submit">${icon.tick} Save</button>
          <button class="btn sm ghost" type="submit" formaction="/admin/delivery/${o.id}/delete"
                  formnovalidate>${icon.bin} Remove</button>
        </div>
      </div>
      </details>
    </form>`;

  const body = wrap('How things get delivered', 'delivery', `
    ${flash('info', c.req.query('ok') ? 'Saved.' : '')}
    <p class="lede" style="max-width:60ch;margin-bottom:22px">
      Each option below is one line the customer can pick at checkout. Set where it
      reaches and it only appears for people in those countries — a Manchester
      collection slot stops being offered to someone in Sydney.</p>
    <div class="dlist">${opts.map(row).join('')}</div>
    <form method="post" action="/admin/delivery" style="margin-top:18px">
      <button class="btn ghost" type="submit">${icon.plus} Add a delivery option</button>
    </form>`);
  return c.html(layout({ title: 'Delivery — Admin', body, active: 'admin', admin: c.get('admin'), settings: s }));
});

setupRoutes.post('/admin/delivery', async (c) => {
  const n = await one('select coalesce(max(position),0) + 1 as p from delivery_options');
  await q(`insert into delivery_options (label, note, price_p, position, zone, enabled)
           values ('New option', '', 0, $1, 'GB', false)`, [n.p]);
  return c.redirect('/admin/delivery');
});

setupRoutes.post('/admin/delivery/:id', async (c) => {
  const f = await c.req.parseBody();
  const zone = String(f.zone) === 'custom'
    ? String(f.zone_list || '').toUpperCase().replace(/[^A-Z,]/g, '') || 'GB'
    : String(f.zone || 'GB');
  const days_min = Math.max(0, parseInt(f.days_min, 10) || 0);
  const days_max = Math.max(0, parseInt(f.days_max, 10) || 0);
  /* An empty note writes itself from the lead time, so the shop owner never
     has to type "two to three working days" four times over. */
  const note = String(f.note || '').trim() || leadTime(days_min, days_max);
  await q(`update delivery_options set
             label=$1, note=$2, price_p=$3, enabled=$4, is_collection=$5,
             courier=$6, zone=$7, days_min=$8, days_max=$9, free_over_p=$10
           where id=$11`,
    [String(f.label || '').slice(0, 60), note.slice(0, 120), pence(f.price),
     f.enabled === 'on', f.is_collection === 'on',
     String(f.courier || ''), zone, days_min, days_max, pence(f.free_over),
     c.req.param('id')]);
  return c.redirect('/admin/delivery?ok=1');
});

setupRoutes.post('/admin/delivery/:id/delete', async (c) => {
  await q('delete from delivery_options where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/delivery?ok=1');
});

/* ------------------------------------------------------------------ *
 *  CREZCO — open banking with no monthly fee and no per-payment fee on
 *  UK domestic transfers. Two ways in, and the shop supports both:
 *
 *    Payment link  — you paste one link, every order sends the customer
 *                    to it, they type the amount and the reference.
 *                    Works today, zero integration.
 *    API key       — the shop creates each payment itself with the amount
 *                    and reference already filled in. One tap for them.
 *
 *  The link route is deliberately first, because it works the moment the
 *  account exists and does not depend on which plan they end up on.
 * ------------------------------------------------------------------ */
setupRoutes.get('/admin/setup/openbanking', async (c) => {
  const s = await getSettings();
  const hasLink = !!s.crezco_link;
  const live = s.crezco_on === '1';

  const body = wrap('One tap, straight from their bank', 'openbanking', `
    ${flash('error', c.req.query('e'))}
    ${c.req.query('ok') ? flash('info', 'Saved.') : ''}
    <p class="lede" style="max-width:62ch;margin-bottom:26px">
      Your customer picks their bank, approves the payment in their own banking
      app, and it lands in your account in seconds. It is a bank transfer — the
      same money, the same speed — except they never type a sort code and you
      never have to check whether it arrived.</p>

    <div class="note info" style="margin-bottom:26px">${icon.spark}
      <div><strong>Why Crezco and not the others.</strong> Every open banking
      provider charges for access — a monthly platform fee, usually with a
      minimum. Crezco's free plan is £0 a month and takes no cut of UK
      bank-to-bank payments; they make their money on international transfers
      and the paid tiers. Sole traders can open one, so you do not need a
      limited company. Check the plan says that when you sign up — pricing
      moves, and I would rather you saw it yourself than took my word.</div></div>

    ${step(1, 'Open a free Crezco account', `
      <p>Pick the <strong>Free</strong> plan. You will need your business or sole
      trader details and the bank account you want the money paid into. It takes
      about ten minutes and most of that is waiting for verification.</p>
      <a class="btn ghost sm" href="https://crezco.com/" target="_blank" rel="noopener noreferrer">
        ${icon.globe} Open Crezco</a>`, hasLink ? 'done' : '')}

    ${step(2, 'Create a payment link and paste it here', `
      <p>In Crezco, make a payment link for your business — the one that lets
      someone pay you without you sending an invoice first. Copy the URL and
      drop it in below.</p>
      <form method="post" action="/admin/setup/openbanking">
        <div class="field"><label for="cl">Your Crezco payment link</label>
          <input id="cl" name="crezco_link" value="${esc(s.crezco_link)}" maxlength="300"
                 placeholder="https://pay.crezco.com/..." inputmode="url">
          <div class="hint">Leave blank to hide it at checkout.</div></div>
        <div class="field"><label for="ca">API key <span style="color:var(--ghost);font-weight:400">optional</span></label>
          <input id="ca" name="crezco_api_key" type="password" value="${esc(s.crezco_api_key)}"
                 maxlength="200" autocomplete="off">
          <div class="hint">If your plan gives you one, paste it and the amount and
            reference get filled in for the customer automatically. Without it the
            link still works — they just type those two things themselves.</div></div>
        <button class="btn" type="submit">${icon.tick} Save</button>
      </form>`, hasLink ? 'done' : '')}

    ${step(3, 'Turn it on at checkout', hasLink ? `
      <form method="post" action="/admin/setup/openbanking/live">
        <p>${live
          ? 'It is <strong>on</strong>, and it sits at the top of the payment list where most people will take it.'
          : 'Ready when you are.'}</p>
        <button class="btn${live ? ' ghost' : ''}" type="submit" name="on" value="${live ? '0' : '1'}">
          ${live ? 'Turn it off' : icon.spark + ' Turn it on'}</button>
      </form>` : '<p class="hint">Finish step 2 first.</p>', live ? 'done' : '')}

    <div class="note warn" style="margin-top:26px">${icon.spark}
      <div><strong>What happens to the money.</strong> It goes straight from their
      bank to yours. Nobody holds it, so there is nothing to freeze — but there is
      also no chargeback and no dispute process. That cuts both ways, and your
      Terms page says so plainly.</div></div>
  `);
  return c.html(layout({ title: 'Open banking — Setup', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

setupRoutes.post('/admin/setup/openbanking', async (c) => {
  const f = await c.req.parseBody();
  const link = String(f.crezco_link || '').trim();
  /* Only ever send customers somewhere over https, and never anywhere the
     shop owner has not actually typed. */
  if (link && !/^https:\/\//i.test(link)) {
    return c.redirect('/admin/setup/openbanking?e=' +
      encodeURIComponent('That link needs to start with https://'));
  }
  await setSettings({
    crezco_link: link.slice(0, 300),
    crezco_api_key: String(f.crezco_api_key || '').trim().slice(0, 200),
  });
  return c.redirect('/admin/setup/openbanking?ok=1');
});

setupRoutes.post('/admin/setup/openbanking/live', async (c) => {
  const f = await c.req.parseBody();
  await setSettings({ crezco_on: String(f.on) === '1' ? '1' : '' });
  return c.redirect('/admin/setup/openbanking');
});

/* ------------------------------------------------------------------ *
 *  SIGN IN WITH GOOGLE
 * ------------------------------------------------------------------ */
setupRoutes.get('/admin/setup/google', async (c) => {
  const s = await getSettings();
  const ready = !!(s.google_client_id && s.google_client_secret);
  const base = String(s.site_url || '').replace(/\/$/, '')
    || `${(c.req.header('x-forwarded-proto') || 'http').split(',')[0]}://${c.req.header('host')}`;
  const redirect = base + '/auth/google/callback';

  const body = wrap('Let people sign in with Google', 'google', `
    ${flash('error', c.req.query('e'))}
    ${c.req.query('ok') ? flash('info', 'Saved. Try it from the sign-in page.') : ''}
    <p class="lede" style="max-width:60ch;margin-bottom:26px">
      One button instead of inventing another password. It also solves the
      forgotten-password problem, which matters because there is no way to send
      a reset link until email is set up.</p>

    ${step(1, 'Make a Google project', `
      <p>In the Google Cloud console: <strong>APIs &amp; Services → Credentials →
      Create credentials → OAuth client ID</strong>, and pick <strong>Web
      application</strong>. It will ask you to fill in a consent screen first —
      "External" is the right answer, and you only need the app name, your email
      and a logo.</p>
      <a class="btn ghost sm" href="https://console.cloud.google.com/apis/credentials"
         target="_blank" rel="noopener noreferrer">${icon.globe} Open the Google console</a>`,
      ready ? 'done' : '')}

    ${step(2, 'Paste this in as the redirect URI', `
      <p>Google will not let anyone in unless the address they come back to
      matches <em>exactly</em>. Put this under
      <strong>Authorised redirect URIs</strong>:</p>
      <div class="plate" style="margin-bottom:12px">
        <div class="pk">Authorised redirect URI</div>
        <div class="pv" style="font-size:15px;letter-spacing:.02em">${esc(redirect)}</div>
        <button class="copy" type="button" data-copyval="${esc(redirect)}"
          style="margin-top:12px">${icon.copy} Copy it</button>
      </div>
      ${!s.site_url ? `<div class="note warn">${icon.spark}
        <div>That address is guessed from the page you are on. Set
        <strong>Site URL</strong> in Settings once you have a domain, or Google
        will bounce people the day you get one.</div></div>` : ''}`,
      ready ? 'done' : '')}

    ${step(3, 'Bring the two keys back', `
      <form method="post" action="/admin/setup/google">
        <div class="field"><label for="gid">Client ID</label>
          <input id="gid" name="google_client_id" value="${esc(s.google_client_id)}"
                 maxlength="200" placeholder="…apps.googleusercontent.com"></div>
        <div class="field"><label for="gsec">Client secret</label>
          <input id="gsec" name="google_client_secret" type="password"
                 value="${esc(s.google_client_secret)}" maxlength="200" autocomplete="off"></div>
        <button class="btn" type="submit">${icon.tick} Save</button>
      </form>
      ${ready ? `<p class="hint" style="margin-top:14px">The button is live on
        <a href="/signin" style="color:var(--blood-2)">the sign-in page</a>.</p>` : ''}`,
      ready ? 'done' : '')}

    <div class="note info" style="margin-top:26px">${icon.spark}
      <div><strong>Apple ID.</strong> Not built yet, and it is a bigger job —
      Apple wants a paid developer account (£79 a year) and a signing key that
      has to be renewed every six months. Google covers nearly everyone and
      costs nothing. Say the word if you want Apple as well.</div></div>
  `);
  return c.html(layout({ title: 'Google sign-in — Setup', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

setupRoutes.post('/admin/setup/google', async (c) => {
  const f = await c.req.parseBody();
  await setSettings({
    google_client_id: String(f.google_client_id || '').trim().slice(0, 200),
    google_client_secret: String(f.google_client_secret || '').trim().slice(0, 200),
  });
  return c.redirect('/admin/setup/google?ok=1');
});
