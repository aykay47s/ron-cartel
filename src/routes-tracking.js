/* The tracking desk.
 *
 * Updating where an order is used to be a form buried at the bottom of the
 * order page: pick from a dropdown, type a place, type a note, tick a box.
 * Four decisions for something you do five times an order.
 *
 * This is its own section instead. Every awaiting-delivery order is on one
 * page, and each update is a single tap on a labelled button. The place and
 * the time carry over from the last update, because the courier that
 * collected it from Manchester is the same one that reaches Lutterworth.
 */
import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { requireAdmin } from './auth.js';
import { layout, esc, money, icon, flash } from './ui.js';
import { UPDATE_TEMPLATES, template, niceWhen, forInput } from './tracking.js';
import { sendMailSafe } from './mail.js';

export const trackingRoutes = new Hono();
trackingRoutes.use('/admin/tracking', requireAdmin);
trackingRoutes.use('/admin/tracking/*', requireAdmin);

/* One email per update, if email is switched on. Silence between "paid" and
   "it turned up" is what generates the "any news?" messages. */
async function tellThem(order, ev, s) {
  if (!order.cust_email) return;
  const base = String(s.site_url || '').replace(/\/$/, '');
  const where = ev.location ? `\nWhere: ${ev.location}` : '';
  const note = ev.detail ? `\n\n${ev.detail}` : '';
  sendMailSafe({
    to: order.cust_email,
    subject: `${order.ref} — ${ev.label}`,
    text: `Hi${order.cust_name ? ' ' + order.cust_name.split(' ')[0] : ''},\n\n`
        + `${ev.label}.${where}${note}\n\n`
        + `${order.product_name}\n`
        + (base ? `Follow it here: ${base}/order/${order.ref}\n` : `Your reference: ${order.ref}\n`)
        + `\n— ${s.shop_name || 'Ron Cartel'}\n`,
  });
}

/* ---------------- the desk ---------------- */
trackingRoutes.get('/admin/tracking', async (c) => {
  const s = await getSettings();
  const showDone = c.req.query('all') === '1';

  const orders = await many(
    `select o.*,
            (select label       from order_events e where e.order_id = o.id
              order by coalesce(e.happened_at, e.created_at) desc limit 1) as last_label,
            (select location    from order_events e where e.order_id = o.id
              order by coalesce(e.happened_at, e.created_at) desc limit 1) as last_where,
            (select coalesce(e.happened_at, e.created_at) from order_events e
              where e.order_id = o.id
              order by coalesce(e.happened_at, e.created_at) desc limit 1) as last_at
       from orders o
      ${showDone ? '' : "where o.status <> 'complete'"}
      order by o.created_at desc limit 100`);

  const emailReady = !!(s.emails_on && s.smtp_host && s.smtp_user);

  const card = (o) => `
    <section class="tk" id="o${o.id}">
      <div class="tk-h">
        <a class="tk-ref" href="/admin/orders/${esc(o.ref)}">${esc(o.ref)}</a>
        <div class="tk-who"><strong>${esc(o.cust_name || '—')}</strong>
          <span>${esc(o.product_name)}</span></div>
        <div class="tk-now">
          ${o.last_label ? `<span class="tk-last">${esc(o.last_label)}</span>` : '<span class="tk-last none">No updates yet</span>'}
          ${o.last_where ? `<span class="tk-where">${icon.pin}${esc(o.last_where)}</span>` : ''}
          ${o.last_at ? `<span class="tk-when">${esc(niceWhen(o.last_at))}</span>` : ''}
        </div>
      </div>
      <form method="post" action="/admin/tracking/${esc(o.ref)}" class="tk-b">
        <!-- One tap per update. Place and time carry over from last time, so
             the common case is: press the button. -->
        <div class="tk-picks">
          ${UPDATE_TEMPLATES.map((t) => `
            <button class="tkp" type="submit" name="template" value="${t.key}"
                    title="${esc(t.note || t.label)}">
              <span class="tkp-i" aria-hidden="true">${icon[t.icon] || icon.pin}</span>
              ${esc(t.label)}</button>`).join('')}
        </div>
        <div class="tk-f">
          <div class="field"><label>Where is it</label>
            <input name="location" maxlength="120" value="${esc(o.last_where || '')}"
                   placeholder="Lutterworth hub" list="places"></div>
          <div class="field"><label>When</label>
            <input name="happened_at" type="datetime-local" value="${esc(forInput(new Date()))}"></div>
          <div class="field"><label>Anything to add</label>
            <input name="detail" maxlength="200" placeholder="leave blank to use the suggested line"></div>
        </div>
        <label class="chk"><input type="checkbox" name="notify" ${emailReady ? 'checked' : 'disabled'}>
          ${emailReady ? 'Email them' : 'Email them — set email up first'}</label>
      </form>
    </section>`;

  const body = `<main class="shell adm">
    <div class="adm-head"><div>
      <p class="eyebrow" style="margin:0 0 9px">Admin</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">Where everything <span class="lit">is</span></h1>
    </div></div>
    <div class="tabs" role="tablist">
      <a href="/admin">${icon.bank} Orders</a>
      <a href="/admin/tracking" class="on">${icon.pin} Tracking</a>
      <a href="/admin/products">${icon.box} Products</a>
      <a href="/admin/delivery">${icon.truck} Delivery</a>
      <a href="/admin/settings">${icon.cog} Settings</a>
    </div>
    ${flash('info', c.req.query('ok') ? 'Posted.' : '')}
    ${flash('error', c.req.query('e'))}
    ${!emailReady ? `<div class="note warn" style="margin-bottom:18px">${icon.spark}
      <div>Updates will show on the customer's page but no email will go out —
      <a href="/admin/setup/email" style="color:var(--blood-2);font-weight:700">set email up</a>
      and they get told the moment anything moves.</div></div>` : ''}
    <p class="lede" style="max-width:58ch;margin-bottom:22px">
      One tap posts the update. Whatever is in the boxes underneath goes with it,
      and the place carries over from the last one.</p>
    <datalist id="places">
      ${[...new Set(orders.map((o) => o.last_where).filter(Boolean))]
        .map((w) => `<option value="${esc(w)}">`).join('')}
    </datalist>
    ${orders.length ? orders.map(card).join('')
      : '<div class="blank"><h3>Nothing to track</h3><p>Orders show up here as they come in.</p></div>'}
    <p style="margin-top:20px"><a class="link-btn" href="/admin/tracking${showDone ? '' : '?all=1'}">
      ${showDone ? 'Hide finished orders' : 'Show finished orders too'}</a></p>
  </main>`;
  return c.html(layout({ title: 'Tracking — Admin', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

trackingRoutes.post('/admin/tracking/:ref', async (c) => {
  const f = await c.req.parseBody();
  const ref = c.req.param('ref');
  const o = await one('select * from orders where ref = $1', [ref.toUpperCase()]);
  if (!o) return c.notFound();

  const t = template(String(f.template || ''));
  const label = t ? t.label : String(f.label || '').trim().slice(0, 80);
  if (!label) return c.redirect('/admin/tracking?e=' +
    encodeURIComponent('Pick an update first.'));

  /* A blank note falls back to the template's suggested line, so the common
     case is genuinely one tap. */
  const detail = String(f.detail || '').trim().slice(0, 200) || (t ? t.note : '');
  const place = t && t.place === false ? '' : String(f.location || '').trim().slice(0, 120);

  /* Backdating is allowed — you type "collected yesterday" the next morning —
     but the future is not, because a timeline that claims tomorrow is wrong. */
  let happened = new Date();
  if (f.happened_at) {
    const d = new Date(String(f.happened_at));
    if (!isNaN(d) && d.getTime() < Date.now() + 60_000) happened = d;
  }

  const ev = await one(
    `insert into order_events (order_id, label, detail, location, happened_at)
     values ($1,$2,$3,$4,$5) returning *`,
    [o.id, label, detail, place, happened]);

  if (f.notify === 'on') {
    const s = await getSettings();
    await tellThem(o, ev, s);
  }
  return c.redirect('/admin/tracking?ok=1#o' + o.id);
});
