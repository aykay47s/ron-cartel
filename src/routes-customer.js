import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import {
  createCustomer, customerByEmail, customerLogin, customerLogout,
  readCustomerCookie, setCustomerCookie, clearCustomerCookie, requireCustomer, readCookie,
  lockedOut, recordFailure, clearFailures,
} from './auth.js';
import { layout, esc, money, icon, flash, STATUS_LABEL } from './ui.js';
import { googleConfig, authUrl, redirectUri, newState, sameState, exchange } from './oauth.js';
import { customerFromGoogle, beginCustomerSession } from './auth.js';

export const customerRoutes = new Hono();
const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
const MAX_PROOF = 6 * 1024 * 1024;

const box = (inner) =>
  `<main class="shell" style="max-width:520px;padding:56px 22px 100px">${inner}</main>`;

/* ---------------- sign in with Google ---------------- */
const G_STATE = 'rc_gs';

customerRoutes.get('/auth/google', async (c) => {
  const cfg = await googleConfig();
  if (!cfg.ready) return c.redirect('/signin?e=' +
    encodeURIComponent('Google sign-in is not set up yet.'));
  const state = newState();
  /* The state cookie is what proves the callback belongs to a sign-in this
     browser actually started, rather than a link someone was sent. */
  c.header('Set-Cookie',
    `${G_STATE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600` +
    ((c.req.header('x-forwarded-proto') || '').split(',')[0].trim() === 'https' ? '; Secure' : ''));
  const next = String(c.req.query('next') || '/account');
  c.header('Set-Cookie',
    `rc_gn=${encodeURIComponent(next.startsWith('/') ? next : '/account')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    { append: true });
  return c.redirect(authUrl(cfg, c, state));
});

customerRoutes.get('/auth/google/callback', async (c) => {
  const cfg = await googleConfig();
  const back = (m) => c.redirect('/signin?e=' + encodeURIComponent(m));
  if (!cfg.ready) return back('Google sign-in is not set up yet.');

  if (c.req.query('error')) return back('Sign-in was cancelled.');
  const code = String(c.req.query('code') || '');
  if (!code) return back('Google sent nothing back.');
  if (!sameState(c.req.query('state'), readCookie(c, G_STATE))) {
    return back('That sign-in link did not start here. Try again.');
  }

  let who;
  try { who = await exchange(cfg, c, code); }
  catch (e) { return back(String(e.message).slice(0, 160)); }

  const cust = await customerFromGoogle(who);
  const { token, expires } = await beginCustomerSession(cust);
  setCustomerCookie(c, token, expires);
  c.header('Set-Cookie', `${G_STATE}=; Path=/; HttpOnly; Max-Age=0`, { append: true });

  const next = decodeURIComponent(readCookie(c, 'rc_gn') || '/account');
  return c.redirect(next.startsWith('/') ? next : '/account');
});

/* ---------------- sign up ---------------- */
customerRoutes.get('/signup', async (c) => {
  const s = await getSettings();
  const body = box(`
    <p class="eyebrow" style="margin:0 0 9px">${c.req.query('why') === 'checkout' ? 'One quick step' : 'Create an account'}</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">${c.req.query('why') === 'checkout'
      ? 'Almost <span class="lit">there</span>' : 'Track your <span class="lit">orders</span>'}</h1>
    <p class="lede" style="font-size:14.5px">${c.req.query('why') === 'checkout'
      ? 'Three boxes and you\'re at the checkout. It means you can see where your bike is any time without digging out a reference, and next time it is two taps.'
      : "One account, so you can see every order you've placed and where it's got to."}</p>
    ${flash('error', c.req.query('e'))}
    ${(await googleConfig()).ready ? `
      <a class="btn ghost wide gbtn" style="margin-top:20px"
         href="/auth/google?next=${encodeURIComponent(c.req.query('next') || '/account')}">
        ${icon.google} Continue with Google</a>
      <div class="orline"><span>or use an email</span></div>` : ''}
    <form method="post" action="/signup" style="margin-top:4px">
      <input type="hidden" name="next" value="${esc(c.req.query('next') || '/account')}">
      <div class="field"><label for="n">Name</label>
        <input id="n" name="name" required maxlength="80" autocomplete="name"></div>
      <div class="field"><label for="e">Email</label>
        <input id="e" name="email" type="email" required maxlength="120" autocomplete="email"></div>
      <div class="field"><label for="p">Password</label>
        <input id="p" name="password" type="password" required minlength="8" autocomplete="new-password">
        <div class="hint">At least 8 characters.</div></div>
      <button class="btn wide" type="submit">Create account</button>
      <p class="hint" style="text-align:center;margin-top:10px">
        No address needed — you give that at checkout, and it is saved for next time.</p>
      <p style="text-align:center;margin:14px 0 0;font-size:13.5px;color:var(--muted)">
        Already have one? <a href="/signin" style="color:var(--blood-2);font-weight:700">Sign in</a></p>
    </form>`);
  return c.html(layout({ title: 'Create an account', body, customer: c.get('customer') , settings: s }));
});

customerRoutes.post('/signup', async (c) => {
  const f = await c.req.parseBody();
  const email = String(f.email || '').trim();
  const password = String(f.password || '');
  const back = (m) => c.redirect('/signup?e=' + encodeURIComponent(m));

  if (!email.includes('@')) return back('That email does not look right.');
  if (password.length < 8) return back('Password must be at least 8 characters.');
  if (await customerByEmail(email)) return back('There is already an account with that email. Try signing in.');

  await createCustomer({
    email, password,
    name: String(f.name || '').slice(0, 80),
    /* Phone and address are collected at checkout, where they are actually
       needed, and written back to the account then. Asking for a delivery
       address to make an account is a reason not to make one. */
    phone: '',
    address: '',
  });
  const sess = await customerLogin(email, password);
  setCustomerCookie(c, sess.token, sess.expires);

  /* Adopt any orders already placed with this email. */
  await q(`update orders set customer_id = $1
            where customer_id is null and lower(cust_email) = lower($2)`,
          [sess.customer.id, email]);

  const next = String(f.next || '/account');
  return c.redirect(next.startsWith('/') ? next : '/account');
});

/* ---------------- sign in ---------------- */
customerRoutes.get('/signin', async (c) => {
  const s = await getSettings();
  const g = await googleConfig();
  const next = esc(c.req.query('next') || '/account');
  const body = box(`
    <p class="eyebrow" style="margin:0 0 9px">Welcome back</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">Sign <span class="lit">in</span></h1>
    ${flash('error', c.req.query('e'))}
    ${g.ready ? `
      <a class="btn ghost wide gbtn" style="margin-top:20px"
         href="/auth/google?next=${encodeURIComponent(c.req.query('next') || '/account')}">
        ${icon.google} Continue with Google</a>
      <div class="orline"><span>or use an email</span></div>` : ''}
    <form method="post" action="/signin" style="margin-top:${g.ready ? '4' : '20'}px">
      <input type="hidden" name="next" value="${esc(c.req.query('next') || '/account')}">
      <div class="field"><label for="e">Email</label>
        <input id="e" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="p">Password</label>
        <input id="p" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn wide" type="submit">Sign in</button>
      <p style="text-align:center;margin:14px 0 0;font-size:13.5px;color:var(--muted)">
        No account? <a href="/signup" style="color:var(--blood-2);font-weight:700">Create one</a>
        &nbsp;·&nbsp; <a href="/track" style="color:var(--blood-2);font-weight:700">Track without one</a></p>
    </form>`);
  return c.html(layout({ title: 'Sign in', body, customer: c.get('customer') , settings: s }));
});

customerRoutes.post('/signin', async (c) => {
  const f = await c.req.parseBody();
  const who = 'cust:' + ip(c);
  if (lockedOut(who)) {
    return c.redirect('/signin?e=' + encodeURIComponent('Too many wrong tries. Wait a few minutes.'));
  }
  const sess = await customerLogin(String(f.email || ''), String(f.password || ''));
  if (!sess) {
    recordFailure(who);
    return c.redirect('/signin?e=' + encodeURIComponent('That email and password do not match.'));
  }
  clearFailures(who);
  setCustomerCookie(c, sess.token, sess.expires);
  const next = String(f.next || '/account');
  return c.redirect(next.startsWith('/') ? next : '/account');
});

customerRoutes.post('/signout', async (c) => {
  const t = readCustomerCookie(c);
  if (t) await customerLogout(t);
  clearCustomerCookie(c);
  return c.redirect('/');
});

/* ---------------- account ---------------- */
customerRoutes.get('/account', requireCustomer, async (c) => {
  const cust = c.get('customer');
  const s = await getSettings();
  const orders = await many(
    `select * from orders where customer_id = $1 order by created_at desc`, [cust.id]);

  const rows = orders.length ? orders.map((o) => `
    <a class="ord" href="/order/${esc(o.ref)}">
      <div class="refc">${esc(o.ref)}</div>
      <div style="min-width:0"><div class="cust">${esc(o.product_name)} × ${o.qty}</div>
        <div class="item">${new Date(o.created_at).toLocaleDateString('en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      <div class="amtc">£${money(o.total_p)}</div>
      <div>${statusPill(o)}</div>
    </a>`).join('')
    : `<div class="blank" style="padding:44px 20px"><div class="ico">${icon.bag}</div>
       <h3>No orders yet</h3><p>When you order something it shows up here.</p>
       <a class="btn" href="/" style="display:inline-flex">Have a look</a></div>`;

  const body = `<main class="shell" style="padding:30px 0 90px">
    <div style="margin-bottom:24px">
      <p class="eyebrow" style="margin:0 0 9px">Your account</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,38px)">${esc(cust.name || cust.email)}</h1>
    </div>
    <div class="panel spot"><div class="panel-h">
      <span class="hico" aria-hidden="true">${icon.bag}</span><h3>Your orders</h3>
      <span class="tag" style="margin-left:auto">${orders.length}</span></div>
      <div class="panel-b"><div class="ordlist">${rows}</div></div>
    </div>
  </main>`;
  return c.html(layout({ title: 'Your account', body, customer: cust , settings: s }));
});

/* ---------------- track without an account ---------------- */
customerRoutes.get('/track', async (c) => {
  const s = await getSettings();
  const body = box(`
    <p class="eyebrow" style="margin:0 0 9px">Order tracking</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">Where's my <span class="lit">order</span></h1>
    <p class="lede" style="font-size:14.5px">Put in the reference from your confirmation email.</p>
    ${flash('error', c.req.query('e'))}
    <form method="get" action="/track/go" style="margin-top:20px">
      <div class="field"><label for="r">Reference</label>
        <input id="r" name="ref" required placeholder="RC-XXXXXX" autocomplete="off"
               style="font-family:var(--mono);font-size:18px;letter-spacing:.16em;text-transform:uppercase"></div>
      <button class="btn wide" type="submit">Find it</button>
    </form>`);
  return c.html(layout({ title: 'Track your order', body, customer: c.get('customer') , settings: s }));
});

customerRoutes.get('/track/go', async (c) => {
  const ref = String(c.req.query('ref') || '').trim().toUpperCase();
  const found = await one('select ref from orders where ref = $1', [ref]);
  if (!found) return c.redirect('/track?e=' + encodeURIComponent('No order with that reference.'));
  return c.redirect('/order/' + found.ref);
});

/* ---------------- proof of payment ---------------- */
customerRoutes.post('/order/:ref/proof', async (c) => {
  const ref = c.req.param('ref').toUpperCase();
  const order = await one('select * from orders where ref = $1', [ref]);
  if (!order) return c.notFound();

  const f = await c.req.parseBody();
  const file = f.proof;
  const back = (m) => c.redirect(`/order/${ref}?e=` + encodeURIComponent(m));

  if (!file || typeof file === 'string' || !file.size) return back('Pick an image first.');
  if (!/^image\//.test(file.type)) return back('That needs to be an image.');
  if (file.size > MAX_PROOF) return back('That image is over 6MB — send a smaller one.');

  const buf = Buffer.from(await file.arrayBuffer());
  const img = await one('insert into images (mime, bytes) values ($1,$2) returning id',
                        [file.type, buf]);
  await q('insert into payment_proofs (order_id, image_id, note) values ($1,$2,$3)',
          [order.id, img.id, String(f.note || '').slice(0, 200)]);
  await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
          [order.id, 'Proof of payment uploaded', '']);

  return c.redirect(`/order/${ref}?ok=1`);
});

export function statusPill(o) {
  if (o.status === 'paid' && o.dispatched_at) return '<span class="pill paid"><i></i>Dispatched</span>';
  if (o.status === 'paid') return '<span class="pill paid"><i></i>Confirmed</span>';
  return '<span class="pill await"><i></i>Awaiting payment</span>';
}
