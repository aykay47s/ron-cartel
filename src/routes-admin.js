import { Hono } from 'hono';
import { q, one, many, getSettings, setSettings } from './db.js';
import {
  adminCount, createAdmin, login, logout, requireAdmin,
  readCookie, setCookie, clearCookie, throttle,
} from './auth.js';
import { layout, esc, money, pence, icon, productArt, flash, STATUS_LABEL } from './ui.js';

export const adminRoutes = new Hono();

const MAX_IMAGE = 4 * 1024 * 1024;
const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

/* ---------------- first run ---------------- */
adminRoutes.get('/admin/setup', async (c) => {
  if ((await adminCount()) > 0) return c.redirect('/admin/login');
  const body = shell(`
    <p class="eyebrow" style="margin:0 0 9px">First run</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">Create your <span class="lit">admin login</span></h1>
    <p class="lede" style="font-size:14.5px">This is the only account that can add stock or see orders. Once it exists, this page closes for good.</p>
    ${flash('error', c.req.query('e'))}
    <form method="post" action="/admin/setup" style="margin-top:22px">
      <div class="field"><label for="e">Email</label>
        <input id="e" name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="p">Password</label>
        <input id="p" name="password" type="password" required minlength="10" autocomplete="new-password">
        <div class="hint">At least 10 characters. Use something you don't use anywhere else.</div></div>
      <button class="btn wide" type="submit">${icon.lock} Create account</button>
    </form>`);
  return c.html(layout({ title: 'Set up admin', body }));
});

adminRoutes.post('/admin/setup', async (c) => {
  if ((await adminCount()) > 0) return c.redirect('/admin/login');
  const f = await c.req.parseBody();
  const email = String(f.email || '').trim();
  const password = String(f.password || '');
  if (!email || password.length < 10) {
    return c.redirect('/admin/setup?e=' + encodeURIComponent('Password must be at least 10 characters.'));
  }
  await createAdmin(email, password);
  const sess = await login(email, password);
  setCookie(c, sess.token, sess.expires);
  return c.redirect('/admin');
});

/* ---------------- login ---------------- */
adminRoutes.get('/admin/login', async (c) => {
  if ((await adminCount()) === 0) return c.redirect('/admin/setup');
  const body = shell(`
    <p class="eyebrow" style="margin:0 0 9px">Admin</p>
    <h1 class="display" style="font-size:clamp(25px,3.3vw,34px)">Sign <span class="lit">in</span></h1>
    ${flash('error', c.req.query('e'))}
    <form method="post" action="/admin/login" style="margin-top:22px">
      <input type="hidden" name="next" value="${esc(c.req.query('next') || '/admin')}">
      <div class="field"><label for="e">Email</label>
        <input id="e" name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="p">Password</label>
        <input id="p" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn wide" type="submit">${icon.lock} Sign in</button>
    </form>`);
  return c.html(layout({ title: 'Admin sign in', body }));
});

adminRoutes.post('/admin/login', async (c) => {
  const f = await c.req.parseBody();
  if (!throttle(ip(c))) {
    return c.redirect('/admin/login?e=' + encodeURIComponent('Too many attempts. Try again in a few minutes.'));
  }
  const sess = await login(String(f.email || ''), String(f.password || ''));
  if (!sess) {
    return c.redirect('/admin/login?e=' + encodeURIComponent('That email and password do not match.'));
  }
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
  if (p === '/admin/login' || p === '/admin/setup' || p === '/admin/logout') return next();
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
      <div class="refc">${esc(o.ref)}</div>
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
      ${stat('risk', 'Orders all time', stats.total)}
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
  await q(`update orders set status='paid', paid_at=now() where ref=$1 and status<>'paid'`,
          [c.req.param('ref')]);
  return c.redirect('/admin');
});
adminRoutes.post('/admin/orders/:ref/unpaid', async (c) => {
  await q(`update orders set status='awaiting', paid_at=null where ref=$1`, [c.req.param('ref')]);
  return c.redirect('/admin');
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
    </form>`);

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
