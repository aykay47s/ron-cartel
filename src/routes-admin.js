import { Hono } from 'hono';
import { q, one, many, getSettings, setSettings } from './db.js';
import {
  login, logout, requireAdmin, setPin, DEFAULT_PIN,
  readCookie, setCookie, clearCookie, lockedOut, recordFailure, clearFailures,
} from './auth.js';
import { layout, esc, money, pence, icon, productArt, flash, STATUS_LABEL } from './ui.js';
import { sendMailSafe, templates } from './mail.js';

export const adminRoutes = new Hono();

const MAX_IMAGE = 4 * 1024 * 1024;
const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

/* ---------------- login ---------------- */
adminRoutes.get('/admin/login', async (c) => {
  const body = shell(`
    <p class="eyebrow" style="margin:0 0 9px">Ron Cartel</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">Owner <span class="lit">access</span></h1>
    ${flash('error', c.req.query('e'))}
    <form method="post" action="/admin/login" style="margin-top:22px">
      <input type="hidden" name="next" value="${esc(c.req.query('next') || '/admin')}">
      <div class="field">
        <label for="p">PIN</label>
        <input id="p" name="pin" type="password" inputmode="numeric" required autofocus
               autocomplete="current-password" style="font-family:var(--mono);
               font-size:22px;letter-spacing:.4em;text-align:center">
      </div>
      <button class="btn wide" type="submit">${icon.lock} Sign in</button>
    </form>`);
  return c.html(layout({ title: 'Sign in', body }));
});

adminRoutes.post('/admin/login', async (c) => {
  const f = await c.req.parseBody();
  const who = ip(c);
  if (lockedOut(who)) {
    return c.redirect('/admin/login?e=' +
      encodeURIComponent('Too many wrong tries. Wait fifteen minutes.'));
  }
  const sess = await login(String(f.pin || ''));
  if (!sess) {
    recordFailure(who);
    return c.redirect('/admin/login?e=' + encodeURIComponent('Wrong PIN.'));
  }
  clearFailures(who);          // a correct PIN wipes the slate
  setCookie(c, sess.token, sess.expires);
  const next = String(f.next || '/admin');
  return c.redirect(next.startsWith('/admin') ? next : '/admin');
});

adminRoutes.post('/admin/logout', async (c) => {
  const t = readCookie(c);
  if (t) await logout(t);
  clearCookie(c);
  return c.redirect('/');
});

/* Everything past here needs a session. */
adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', async (c, next) => {
  const p = c.req.path;
  if (p === '/admin/login' || p === '/admin/logout') return next();
  return requireAdmin(c, next);
});

/* ---------------- orders ---------------- */
adminRoutes.get('/admin', async (c) => {
  const filter = c.req.query('f') || 'all';
  const search = (c.req.query('q') || '').trim();

  const where = [];
  const args = [];
  if (filter === 'awaiting' || filter === 'paid') { args.push(filter); where.push(`status = $${args.length}`); }
  if (search) {
    args.push('%' + search.toLowerCase() + '%');
    where.push(`(lower(ref) like $${args.length} or lower(cust_name) like $${args.length}
                 or lower(product_name) like $${args.length})`);
  }
  const orders = await many(
    `select * from orders ${where.length ? 'where ' + where.join(' and ') : ''}
     order by (status = 'awaiting') desc, created_at desc limit 200`, args);

  const stats = await one(`
    select count(*) filter (where status='awaiting')::int as awaiting,
           coalesce(sum(total_p) filter (where status='awaiting'),0)::int as on_hold,
           count(*) filter (where status='paid' and paid_at > now() - interval '1 day')::int as paid_today,
           count(*)::int as total
      from orders`);

  const rows = orders.length ? orders.map((o) => {
    const paid = o.status === 'paid';
    const hit = search && o.ref.toLowerCase() === search.toLowerCase();
    return `<div class="tr${hit ? ' hit' : ''}${paid ? ' settled' : ''}">
      <div class="refc"><a href="/admin/orders/${esc(o.ref)}" style="color:inherit">${esc(o.ref)}</a></div>
      <div><div class="cust">${esc(o.cust_name || '—')}</div>
        <div class="item">${esc(o.product_name)} × ${o.qty}</div>
        <div class="via">${o.method === 'ppff' ? 'PayPal F&amp;F' : 'Bank transfer'}${o.is_deposit ? ' · deposit' : ''}</div></div>
      <div class="amtc">£${money(o.total_p)}</div>
      <div>${paid
        ? '<span class="pill paid"><i></i>Confirmed</span>'
        : '<span class="pill await"><i></i>Awaiting</span>'}</div>
      <div style="display:flex;justify-content:flex-end">
        <form method="post" action="/admin/orders/${esc(o.ref)}/${paid ? 'unpaid' : 'paid'}">
          <button class="btn ${paid ? 'ghost ' : ''}sm" type="submit">${paid ? 'Undo' : icon.tick + ' Mark paid'}</button>
        </form></div>
    </div>`;
  }).join('') : '<div class="empty">No orders yet.</div>';

  const body = adminShell('orders', `
    <div class="stats">
      ${stat('hold', 'Awaiting payment', stats.awaiting)}
      ${stat('cash', 'Value on hold', '£' + Math.round(stats.on_hold / 100).toLocaleString('en-GB'))}
      ${stat('good', 'Confirmed today', stats.paid_today)}
      ${stat('all', 'Orders all time', stats.total)}
    </div>
    <form class="bar" method="get" action="/admin">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7.2"/><path d="M21 21l-4.3-4.3"/></svg>
        <input name="q" value="${esc(search)}" placeholder="Paste a reference, name or item…" autocomplete="off">
      </div>
      <div class="segs">
        ${['all', 'awaiting', 'paid'].map((k) =>
          `<button name="f" value="${k}"${filter === k ? ' class="on"' : ''} type="submit">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div>
    </form>
    <div class="panel spot">
      <div class="th-row"><div>Reference</div><div>Customer</div><div>Amount</div><div>Status</div><div></div></div>
      <div>${rows}</div>
    </div>`);

  return c.html(layout({ title: 'Orders — Admin', body, active: 'admin', admin: c.get('admin') }));
});

adminRoutes.post('/admin/orders/:ref/paid', async (c) => {
  const o = await one(
    `update orders set status='paid', paid_at=now()
      where ref=$1 and status<>'paid' returning *`, [c.req.param('ref')]);
  if (o) {
    await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
            [o.id, o.is_deposit ? 'Deposit received' : 'Payment received', '£' + money(o.total_p)]);
    if (o.cust_email) {
      const s = await getSettings();
      sendMailSafe({ to: o.cust_email, ...templates.paymentConfirmed(o, s) });
    }
  }
  return c.redirect(c.req.header('referer')?.includes('/admin/orders/') ? `/admin/orders/${c.req.param('ref')}` : '/admin');
});

adminRoutes.post('/admin/orders/:ref/unpaid', async (c) => {
  const o = await one(
    `update orders set status='awaiting', paid_at=null where ref=$1 returning *`,
    [c.req.param('ref')]);
  if (o) await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
                 [o.id, 'Payment un-marked', 'Set back to awaiting by the shop']);
  return c.redirect('/admin');
});

adminRoutes.post('/admin/orders/:ref/dispatch', async (c) => {
  const f = await c.req.parseBody();
  const o = await one(
    `update orders set tracking_carrier=$1, tracking_number=$2, dispatched_at=now()
      where ref=$3 returning *`,
    [String(f.carrier || '').slice(0, 60), String(f.tracking || '').slice(0, 80),
     c.req.param('ref')]);
  if (o) {
    await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
            [o.id, 'Dispatched',
             [o.tracking_carrier, o.tracking_number].filter(Boolean).join(' · ')]);
    if (o.cust_email) {
      const s = await getSettings();
      sendMailSafe({ to: o.cust_email, ...templates.dispatched(o, s) });
    }
  }
  return c.redirect(`/admin/orders/${c.req.param('ref')}`);
});

/* ---------------- one order ---------------- */
adminRoutes.get('/admin/orders/:ref', async (c) => {
  const o = await one('select * from orders where ref = $1', [c.req.param('ref').toUpperCase()]);
  if (!o) return c.notFound();
  const proofs = await many(
    'select * from payment_proofs where order_id = $1 order by created_at desc', [o.id]);
  const events = await many(
    'select * from order_events where order_id = $1 order by created_at', [o.id]);
  const when = (d) => new Date(d).toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const paid = o.status === 'paid';

  const body = adminShell('orders', `
    <p style="margin:-8px 0 18px"><a class="link-btn" href="/admin">← All orders</a></p>
    <div class="cols2">
      <div>
        <section class="panel spot" style="margin-bottom:18px">
          <div class="panel-h"><span class="hico" aria-hidden="true">${icon.bag}</span>
            <h3>${esc(o.ref)}</h3>
            <span style="margin-left:auto">${paid
              ? '<span class="pill paid"><i></i>Confirmed</span>'
              : '<span class="pill await"><i></i>Awaiting</span>'}</span></div>
          <div class="panel-b"><div class="rows">
            <div class="row-f"><span class="k">Item</span><span class="v">${esc(o.product_name)} × ${o.qty}</span></div>
            <div class="row-f"><span class="k">${o.is_deposit ? 'Deposit' : 'Total'}</span><span class="v big">£${money(o.total_p)}</span></div>
            <div class="row-f"><span class="k">Method</span><span class="v">${o.method === 'ppff' ? 'PayPal F&amp;F' : 'Bank transfer'}</span></div>
            <div class="row-f"><span class="k">Delivery</span><span class="v">${esc(o.delivery_label || '—')}</span></div>
            <div class="row-f"><span class="k">Name</span><span class="v">${esc(o.cust_name || '—')}</span></div>
            <div class="row-f"><span class="k">Email</span><span class="v">${esc(o.cust_email || '—')}</span></div>
            <div class="row-f"><span class="k">Phone</span><span class="v">${esc(o.cust_phone || '—')}</span></div>
            <div class="row-f"><span class="k">Address</span><span class="v">${esc(o.address || '—')}</span></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <form method="post" action="/admin/orders/${esc(o.ref)}/${paid ? 'unpaid' : 'paid'}">
              <button class="btn ${paid ? 'ghost ' : ''}sm" type="submit">${paid ? 'Un-mark paid' : icon.tick + ' Mark paid'}</button>
            </form>
            <a class="btn ghost sm" href="/order/${esc(o.ref)}" target="_blank" rel="noopener">See what the buyer sees</a>
          </div></div>
        </section>

        <section class="panel spot">
          <div class="panel-h"><span class="hico" aria-hidden="true">${icon.truck}</span><h3>Dispatch</h3></div>
          <div class="panel-b">
            ${o.dispatched_at ? `<div class="note info" style="margin:0 0 14px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
              <span>Dispatched ${when(o.dispatched_at)}. Saving again re-sends the email.</span></div>` : ''}
            <form method="post" action="/admin/orders/${esc(o.ref)}/dispatch">
              <div class="grid2">
                <div class="field"><label for="ca">Carrier</label>
                  <input id="ca" name="carrier" value="${esc(o.tracking_carrier)}" maxlength="60" placeholder="Royal Mail"></div>
                <div class="field"><label for="tn">Tracking number</label>
                  <input id="tn" name="tracking" value="${esc(o.tracking_number)}" maxlength="80"></div>
              </div>
              <button class="btn" type="submit">${icon.truck} Mark dispatched &amp; email them</button>
            </form>
          </div>
        </section>
      </div>

      <div>
        <section class="panel spot" style="margin-bottom:18px">
          <div class="panel-h"><span class="hico" aria-hidden="true">${icon.camera}</span><h3>Proof of payment</h3>
            <span class="tag" style="margin-left:auto">${proofs.length}</span></div>
          <div class="panel-b">
            ${proofs.length ? `<div class="proofs">${proofs.map((pr) => `
              <a class="proof" href="/img/${pr.image_id}" target="_blank" rel="noopener">
                <img src="/img/${pr.image_id}" alt="Proof">
                <span>${when(pr.created_at)}${pr.note ? ' · ' + esc(pr.note) : ''}</span></a>`).join('')}</div>`
              : '<p style="margin:0;color:var(--muted);font-size:13.5px">Nothing uploaded yet.</p>'}
          </div>
        </section>

        <section class="panel spot">
          <div class="panel-h"><span class="hico" aria-hidden="true">${icon.clock}</span><h3>History</h3></div>
          <div class="panel-b">
            ${events.length ? `<div class="hist">${events.map((e) =>
              `<div class="ev"><span class="tm">${when(e.created_at)}</span>
               <span class="lb">${esc(e.label)}</span>
               ${e.detail ? `<span class="dt">${esc(e.detail)}</span>` : ''}</div>`).join('')}</div>`
              : '<p style="margin:0;color:var(--muted);font-size:13.5px">Nothing yet.</p>'}
          </div>
        </section>
      </div>
    </div>`);

  return c.html(layout({ title: `Order ${o.ref} — Admin`, body, active: 'admin', admin: c.get('admin') }));
});

/* ---------------- products ---------------- */
adminRoutes.get('/admin/products', async (c) => {
  const items = await many('select * from products order by position, id desc');
  const list = items.length ? items.map((p) => `
    <div class="prow">
      <span class="th">${p.image_id ? `<img src="/img/${p.image_id}" alt="">` : icon.box}</span>
      <div style="min-width:0"><div class="nm">${esc(p.name)}
        <span class="tag ${p.status === 'stock' ? 'go' : ''}">${STATUS_LABEL[p.status]}</span></div>
        <div class="bl">${esc(p.blurb || '—')}</div></div>
      <span class="pr">£${money(p.price_p)}</span>
      <span class="acts">
        <a class="iconbtn" href="/admin/products/${p.id}" aria-label="Edit ${esc(p.name)}">${icon.edit}</a>
        <form method="post" action="/admin/products/${p.id}/delete"
              onsubmit="return confirm('Delete ${esc(p.name).replace(/'/g, '')}?')">
          <button class="iconbtn danger" type="submit" aria-label="Delete">${icon.bin}</button></form>
      </span>
    </div>`).join('')
    : `<div class="blank" style="padding:44px 20px"><div class="ico">${icon.box}</div>
       <h3>No listings yet</h3><p>Add one and it appears on the shop immediately.</p></div>`;

  const body = adminShell('products', `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
      <a class="btn" href="/admin/products/new">${icon.plus} Add a product</a>
      <span class="tag">${items.length} listing${items.length === 1 ? '' : 's'}</span>
    </div>
    <div class="panel spot"><div class="panel-b"><div class="plist">${list}</div></div></div>`);

  return c.html(layout({ title: 'Products — Admin', body, active: 'admin', admin: c.get('admin') }));
});

adminRoutes.get('/admin/products/new', async (c) =>
  c.html(layout({ title: 'Add product — Admin', active: 'admin', admin: c.get('admin'),
    body: adminShell('products', productForm(null, c.req.query('e'))) })));

adminRoutes.get('/admin/products/:id', async (c) => {
  const p = await one('select * from products where id = $1', [c.req.param('id')]);
  if (!p) return c.notFound();
  return c.html(layout({ title: 'Edit product — Admin', active: 'admin', admin: c.get('admin'),
    body: adminShell('products', productForm(p, c.req.query('e'))) }));
});

async function saveImage(file) {
  if (!file || typeof file === 'string' || !file.size) return null;
  if (!/^image\//.test(file.type)) return null;
  if (file.size > MAX_IMAGE) return 'TOO_BIG';
  const buf = Buffer.from(await file.arrayBuffer());
  const row = await one('insert into images (mime, bytes) values ($1,$2) returning id',
                        [file.type, buf]);
  return row.id;
}

adminRoutes.post('/admin/products', async (c) => {
  const f = await c.req.parseBody();
  const id = f.id ? Number(f.id) : null;
  const name = String(f.name || '').trim().slice(0, 120);
  if (!name) return c.redirect((id ? `/admin/products/${id}` : '/admin/products/new') +
    '?e=' + encodeURIComponent('Give it a name.'));

  const img = await saveImage(f.image);
  if (img === 'TOO_BIG') {
    return c.redirect((id ? `/admin/products/${id}` : '/admin/products/new') +
      '?e=' + encodeURIComponent('That photo is over 4MB — use a smaller one.'));
  }

  const vals = {
    name,
    blurb: String(f.blurb || '').slice(0, 240),
    body: String(f.body || '').slice(0, 4000),
    price_p: pence(f.price),
    was_p: f.was ? pence(f.was) : null,
    deposit_p: f.deposit ? pence(f.deposit) : null,
    status: ['stock', 'reserved', 'sold'].includes(f.status) ? f.status : 'stock',
    position: Number(f.position) || 0,
  };

  if (id) {
    await q(`update products set name=$1, blurb=$2, body=$3, price_p=$4, was_p=$5,
             deposit_p=$6, status=$7, position=$8 ${img ? ', image_id=$10' : ''}
             where id=$9`,
      img ? [vals.name, vals.blurb, vals.body, vals.price_p, vals.was_p, vals.deposit_p,
             vals.status, vals.position, id, img]
          : [vals.name, vals.blurb, vals.body, vals.price_p, vals.was_p, vals.deposit_p,
             vals.status, vals.position, id]);
  } else {
    await q(`insert into products (name, blurb, body, price_p, was_p, deposit_p, status, position, image_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [vals.name, vals.blurb, vals.body, vals.price_p, vals.was_p, vals.deposit_p,
       vals.status, vals.position, img]);
  }
  return c.redirect('/admin/products');
});

adminRoutes.post('/admin/products/:id/delete', async (c) => {
  await q('delete from products where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/products');
});

/* ---------------- settings ---------------- */
adminRoutes.get('/admin/settings', async (c) => {
  const s = await getSettings();
  const opts = await many('select * from delivery_options order by position, id');

  const body = adminShell('settings', `
    ${flash('info', c.req.query('ok') ? 'Settings saved.' : '')}
    ${flash('error', c.req.query('e'))}
    <form method="post" action="/admin/settings">
      <div class="cols2">
        <section class="panel spot">
          <div class="panel-h"><span class="hico" aria-hidden="true">${icon.bank}</span><h3>Bank transfer</h3></div>
          <div class="panel-b">
            <div class="field"><label for="ban">Account name</label>
              <input id="ban" name="bank_account_name" value="${esc(s.bank_account_name)}" maxlength="80"></div>
            <div class="grid2">
              <div class="field"><label for="bs">Sort code</label>
                <input id="bs" name="bank_sort" value="${esc(s.bank_sort)}" maxlength="12" placeholder="04-00-75"></div>
              <div class="field"><label for="bn">Account number</label>
                <input id="bn" name="bank_number" value="${esc(s.bank_number)}" maxlength="12" placeholder="88213470"></div>
            </div>
            <div class="hint">Leave blank to hide bank transfer at checkout.</div>
          </div>
        </section>

        <section class="panel spot">
          <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.2L8.3 6.4h5.4c2.7 0 4.2 1.5 3.8 3.9-.5 2.6-2.5 4.1-5.3 4.1H9.8L9 20.2z"/></svg></span><h3>PayPal</h3></div>
          <div class="panel-b">
            <div class="field"><label for="pp">PayPal address</label>
              <input id="pp" name="paypal_address" value="${esc(s.paypal_address)}" maxlength="120" placeholder="pay@roncartel.co.uk"></div>
            <div class="field"><label for="ppn">Note shown to the buyer</label>
              <textarea id="ppn" name="paypal_note" maxlength="240">${esc(s.paypal_note)}</textarea></div>
            <div class="hint">Leave the address blank to hide PayPal at checkout.</div>
          </div>
        </section>
      </div>

      <section class="panel spot" style="margin-top:18px">
        <div class="panel-h"><span class="hico" aria-hidden="true">${icon.cog}</span><h3>Shop</h3></div>
        <div class="panel-b">
          <div class="grid2">
            <div class="field"><label for="sn">Shop name</label>
              <input id="sn" name="shop_name" value="${esc(s.shop_name)}" maxlength="60"></div>
            <div class="field"><label for="ce">Contact email</label>
              <input id="ce" name="contact_email" type="email" value="${esc(s.contact_email)}" maxlength="120"></div>
          </div>
          <div class="field"><label for="tg">Tagline</label>
            <input id="tg" name="tagline" value="${esc(s.tagline)}" maxlength="120"></div>
          <div class="grid2">
            <div class="field"><label for="hh">Hold stock for (hours)</label>
              <input id="hh" name="hold_hours" value="${esc(s.hold_hours)}" inputmode="numeric" maxlength="4"></div>
            <div class="field"><label for="cnn">Collection note</label>
              <input id="cnn" name="collection_note" value="${esc(s.collection_note)}" maxlength="200"></div>
          </div>
        </div>
      </section>

      <section class="panel spot" style="margin-top:18px">
        <div class="panel-h"><span class="hico" aria-hidden="true">${icon.bankpay}</span>
          <h3>Pay by bank</h3>
          <span class="tag go" style="margin-left:auto">${icon.bolt} Recommended</span></div>
        <div class="panel-b">
          <div class="note info" style="margin:0 0 16px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4.5M12 8h.01"/></svg>
            <span>The customer taps their bank and approves in the app. Money arrives in seconds,
              fees are pennies rather than percent, and the order marks itself paid — no references
              to match by hand. Sign up at truelayer.com, then paste the keys here.</span></div>
          <label style="display:flex;gap:9px;align-items:center;margin-bottom:16px;font-size:13.5px">
            <input type="checkbox" name="bank_pay_on" ${s.bank_pay_on ? 'checked' : ''} style="width:auto;min-height:auto">
            Offer pay by bank at checkout</label>
          <div class="grid2">
            <div class="field"><label for="tle">Environment</label>
              <select id="tle" name="tl_env">
                <option value="sandbox"${s.tl_env !== 'live' ? ' selected' : ''}>Sandbox (testing)</option>
                <option value="live"${s.tl_env === 'live' ? ' selected' : ''}>Live</option>
              </select></div>
            <div class="field"><label for="tlm">Merchant account ID</label>
              <input id="tlm" name="tl_merchant_id" value="${esc(s.tl_merchant_id)}" autocomplete="off"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="tlc">Client ID</label>
              <input id="tlc" name="tl_client_id" value="${esc(s.tl_client_id)}" autocomplete="off"></div>
            <div class="field"><label for="tls">Client secret</label>
              <input id="tls" name="tl_client_secret" type="password" value="${esc(s.tl_client_secret)}" autocomplete="off"></div>
          </div>
          <div class="field"><label for="tlk">Signing key ID (kid)</label>
            <input id="tlk" name="tl_kid" value="${esc(s.tl_kid)}" autocomplete="off"></div>
          <div class="field"><label for="tlp">Private key</label>
            <textarea id="tlp" name="tl_private_key" style="min-height:110px;font-family:var(--mono);font-size:12px"
              placeholder="-----BEGIN EC PRIVATE KEY-----">${esc(s.tl_private_key)}</textarea>
            <div class="hint">The EC key you generated when you registered the signing key. It never leaves your server.</div></div>
        </div>
      </section>

      <section class="panel spot" style="margin-top:18px">
        <div class="panel-h"><span class="hico" aria-hidden="true">${icon.cog}</span><h3>Business details</h3></div>
        <div class="panel-b">
          <div class="note info" style="margin:0 0 16px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4.5M12 8h.01"/></svg>
            <span>Selling at a distance in the UK means giving buyers your trading name, a real
              address and a way to contact you. It's also the quickest way to stop looking like
              a scam — these show in the footer and on your Terms page.</span></div>
          <div class="grid2">
            <div class="field"><label for="ln">Trading name</label>
              <input id="ln" name="legal_name" value="${esc(s.legal_name)}" maxlength="120"
                     placeholder="Ron Cartel Ltd"></div>
            <div class="field"><label for="cph">Phone</label>
              <input id="cph" name="contact_phone" value="${esc(s.contact_phone)}" maxlength="30"></div>
          </div>
          <div class="field"><label for="ta">Trading address</label>
            <textarea id="ta" name="trading_address" maxlength="300"
              placeholder="Street, town, postcode">${esc(s.trading_address)}</textarea></div>
          <div class="grid2">
            <div class="field"><label for="cn2">Company number <span style="color:var(--ghost);font-weight:400">optional</span></label>
              <input id="cn2" name="company_number" value="${esc(s.company_number)}" maxlength="30"></div>
            <div class="field"><label for="vn">VAT number <span style="color:var(--ghost);font-weight:400">optional</span></label>
              <input id="vn" name="vat_number" value="${esc(s.vat_number)}" maxlength="30"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="rd">Cancellation window (days)</label>
              <input id="rd" name="returns_days" value="${esc(s.returns_days)}" inputmode="numeric" maxlength="3">
              <div class="hint">14 is the legal minimum for distance sales.</div></div>
            <div class="field"><label for="su">Your site address</label>
              <input id="su" name="site_url" value="${esc(s.site_url)}" maxlength="200"
                     placeholder="https://roncartel.co.uk">
              <div class="hint">Used in order emails so links work.</div></div>
          </div>
          <div class="field"><label for="rn">Anything to add to your returns page</label>
            <textarea id="rn" name="returns_note" maxlength="600">${esc(s.returns_note)}</textarea></div>
        </div>
      </section>

      <section class="panel spot" style="margin-top:18px">
        <div class="panel-h"><span class="hico" aria-hidden="true">${icon.mail}</span><h3>Order emails</h3></div>
        <div class="panel-b">
          <label style="display:flex;gap:9px;align-items:center;margin-bottom:16px;font-size:13.5px">
            <input type="checkbox" name="emails_on" ${s.emails_on ? 'checked' : ''} style="width:auto;min-height:auto">
            Send order emails to customers</label>
          <div class="grid2">
            <div class="field"><label for="sh">SMTP host</label>
              <input id="sh" name="smtp_host" value="${esc(s.smtp_host)}" placeholder="smtp-relay.brevo.com"></div>
            <div class="field"><label for="sp">Port</label>
              <input id="sp" name="smtp_port" value="${esc(s.smtp_port)}" inputmode="numeric" placeholder="587"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="su">SMTP username</label>
              <input id="su" name="smtp_user" value="${esc(s.smtp_user)}" autocomplete="off"></div>
            <div class="field"><label for="sw">SMTP password / API key</label>
              <input id="sw" name="smtp_pass" type="password" value="${esc(s.smtp_pass)}" autocomplete="off"></div>
          </div>
          <div class="field"><label for="sf">Send from</label>
            <input id="sf" name="smtp_from" value="${esc(s.smtp_from)}" placeholder="orders@yourdomain.co.uk">
            <div class="hint">Brevo gives 300 emails a day free. Without your own domain, verify a personal
              address with them and use that — it works, it just looks less official.</div></div>
        </div>
      </section>

      <section class="panel spot" style="margin-top:18px">
        <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span><h3>Delivery options</h3></div>
        <div class="panel-b">
          ${opts.map((o) => `
            <div class="opt" style="cursor:default;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div class="grid2">
                  <div class="field" style="margin-bottom:8px"><label>Label</label>
                    <input name="d_label_${o.id}" value="${esc(o.label)}" maxlength="60"></div>
                  <div class="field" style="margin-bottom:8px"><label>Price £</label>
                    <input name="d_price_${o.id}" value="${money(o.price_p)}" inputmode="decimal"></div>
                </div>
                <div class="field" style="margin-bottom:0"><label>Note</label>
                  <input name="d_note_${o.id}" value="${esc(o.note)}" maxlength="120"></div>
                <label style="display:flex;gap:9px;align-items:center;margin-top:10px;font-size:13px;color:var(--muted)">
                  <input type="checkbox" name="d_on_${o.id}" ${o.enabled ? 'checked' : ''} style="width:auto;min-height:auto">
                  Show at checkout${o.is_collection ? ' · this is the collection option' : ''}</label>
              </div>
            </div>`).join('')}
        </div>
      </section>

      <button class="btn" type="submit" style="margin-top:20px">${icon.tick} Save settings</button>
    </form>

    <section class="panel spot" style="margin-top:18px">
      <div class="panel-h"><span class="hico" aria-hidden="true">${icon.lock}</span><h3>Your PIN</h3></div>
      <div class="panel-b">
        <form method="post" action="/admin/pin" style="max-width:340px">
          <div class="field"><label for="np">New PIN</label>
            <input id="np" name="pin" type="password" inputmode="numeric" minlength="4" required
                   style="font-family:var(--mono);font-size:19px;letter-spacing:.3em;text-align:center">
            <div class="hint">Signs you out everywhere so the old PIN stops working.</div></div>
          <button class="btn ghost" type="submit">${icon.lock} Change PIN</button>
        </form>
      </div>
    </section>`);

  return c.html(layout({ title: 'Settings — Admin', body, active: 'admin', admin: c.get('admin') }));
});

adminRoutes.post('/admin/settings', async (c) => {
  const f = await c.req.parseBody();
  await setSettings({
    shop_name: f.shop_name, tagline: f.tagline, contact_email: f.contact_email,
    bank_account_name: f.bank_account_name, bank_sort: f.bank_sort, bank_number: f.bank_number,
    paypal_address: f.paypal_address, paypal_note: f.paypal_note,
    collection_note: f.collection_note,
    hold_hours: String(parseInt(f.hold_hours, 10) || 24),
    smtp_host: f.smtp_host, smtp_port: f.smtp_port,
    smtp_user: f.smtp_user, smtp_pass: f.smtp_pass, smtp_from: f.smtp_from,
    emails_on: f.emails_on != null ? '1' : '',
    legal_name: f.legal_name, trading_address: f.trading_address,
    contact_phone: f.contact_phone, company_number: f.company_number,
    vat_number: f.vat_number, site_url: f.site_url,
    returns_days: String(parseInt(f.returns_days, 10) || 14),
    returns_note: f.returns_note,
    bank_pay_on: f.bank_pay_on != null ? '1' : '',
    tl_env: f.tl_env === 'live' ? 'live' : 'sandbox',
    tl_client_id: f.tl_client_id, tl_client_secret: f.tl_client_secret,
    tl_kid: f.tl_kid, tl_private_key: f.tl_private_key, tl_merchant_id: f.tl_merchant_id,
  });
  /* Only touch a delivery option if this submission actually carried its
     fields. Without that check, saving the settings form from anywhere that
     omits them silently zeroes every price and disables the lot. */
  const opts = await many('select id from delivery_options');
  for (const o of opts) {
    const label = f['d_label_' + o.id];
    if (label == null) continue;
    await q('update delivery_options set label=$1, note=$2, price_p=$3, enabled=$4 where id=$5', [
      String(label).slice(0, 60) || 'Delivery',
      String(f['d_note_' + o.id] || '').slice(0, 120),
      pence(f['d_price_' + o.id]),
      f['d_on_' + o.id] != null,
      o.id,
    ]);
  }
  return c.redirect('/admin/settings?ok=1');
});

adminRoutes.post('/admin/pin', async (c) => {
  const f = await c.req.parseBody();
  const pin = String(f.pin || '').trim();
  if (pin.length < 4) {
    return c.redirect('/admin/settings?e=' + encodeURIComponent('PIN must be at least 4 characters.'));
  }
  await setPin(pin);
  clearCookie(c);
  return c.redirect('/admin/login?e=' + encodeURIComponent('PIN changed — sign in again.'));
});

/* ---------------- view helpers ---------------- */
function shell(inner) {
  return `<main class="shell" style="max-width:520px;padding:60px 22px 100px">${inner}</main>`;
}

function stat(kind, label, value) {
  return `<div class="stat ${kind}"><div class="k">${label}</div><div class="v">${value}</div></div>`;
}

function adminShell(active, inner) {
  const tab = (href, key, label, ic) =>
    `<a href="${href}"${active === key ? ' class="on"' : ''}>${ic} ${label}</a>`;
  return `<main class="shell adm">
    <div class="adm-head"><div>
      <p class="eyebrow" style="margin:0 0 9px">Admin</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">Your <span class="lit">shop</span></h1>
    </div></div>
    <div class="tabs" role="tablist">
      ${tab('/admin', 'orders', 'Orders', icon.bank)}
      ${tab('/admin/products', 'products', 'Products', icon.box)}
      ${tab('/admin/settings', 'settings', 'Settings', icon.cog)}
    </div>
    ${inner}
  </main>`;
}

function productForm(p, err) {
  const v = (k, d = '') => esc(p ? (p[k] ?? d) : d);
  return `
  ${flash('error', err)}
  <form method="post" action="/admin/products" enctype="multipart/form-data">
    ${p ? `<input type="hidden" name="id" value="${p.id}">` : ''}
    <div class="cols2">
      <section class="panel spot">
        <div class="panel-h"><span class="hico" aria-hidden="true">${icon.box}</span>
          <h3>${p ? 'Edit product' : 'Add a product'}</h3></div>
        <div class="panel-b">
          <div class="field"><label for="n">Name</label>
            <input id="n" name="name" required maxlength="120" value="${v('name')}"
              placeholder="Grafted Light Bee — 72V build"></div>
          <div class="field"><label for="b">Short description</label>
            <textarea id="b" name="blurb" maxlength="240"
              placeholder="One or two lines shown under the name">${v('blurb')}</textarea></div>
          <div class="field"><label for="bd">Full description</label>
            <textarea id="bd" name="body" maxlength="4000" style="min-height:130px"
              placeholder="Spec, what's been changed, condition…">${v('body')}</textarea></div>
          <div class="grid2">
            <div class="field"><label for="pr">Price £</label>
              <input id="pr" name="price" inputmode="decimal" required
                value="${p ? money(p.price_p) : ''}" placeholder="2450.00"></div>
            <div class="field"><label for="wa">Was £ <span style="color:var(--ghost);font-weight:400">optional</span></label>
              <input id="wa" name="was" inputmode="decimal"
                value="${p && p.was_p ? money(p.was_p) : ''}" placeholder="2800.00"></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="st">Availability</label>
              <select id="st" name="status">
                ${['stock', 'reserved', 'sold'].map((k) =>
                  `<option value="${k}"${p && p.status === k ? ' selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}
              </select></div>
            <div class="field"><label for="dp">Collection deposit £</label>
              <input id="dp" name="deposit" inputmode="decimal"
                value="${p && p.deposit_p ? money(p.deposit_p) : ''}" placeholder="250.00"></div>
          </div>
          <div class="field"><label for="po">Sort position</label>
            <input id="po" name="position" inputmode="numeric" value="${v('position', 0)}">
            <div class="hint">Lower numbers show first.</div></div>
        </div>
      </section>

      <section class="panel spot">
        <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.8" cy="9" r="1.8"/><path d="M21 15.5l-5-5L5 21"/></svg></span><h3>Photo</h3></div>
        <div class="panel-b">
          ${p && p.image_id
            ? `<div class="preview" style="margin-bottom:14px"><img src="/img/${p.image_id}" alt=""></div>`
            : ''}
          <div class="field"><label for="im">${p && p.image_id ? 'Replace photo' : 'Upload a photo'}</label>
            <input id="im" name="image" type="file" accept="image/*">
            <div class="hint">Up to 4MB. Without one, the Light Bee photo is used.</div></div>
          <button class="btn wide" type="submit">${icon.tick} ${p ? 'Save changes' : 'Add product'}</button>
          <p style="margin:14px 0 0;text-align:center">
            <a class="link-btn" href="/admin/products">Cancel</a></p>
        </div>
      </section>
    </div>
  </form>`;
}
