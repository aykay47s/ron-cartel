/* Three things that make a shop earn more from the traffic it already has.
 *
 *  Waitlist  — a SOLD badge is demand walking out of the door. Catch the email.
 *  Add-ons   — a helmet or a spare battery on the way past checkout.
 *  Reviews   — the single strongest thing on a page for someone deciding
 *              whether a stranger with a bike is real.
 */
import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { requireAdmin } from './auth.js';
import { layout, esc, money, icon, flash } from './ui.js';
import { sendMailSafe } from './mail.js';

export const extraRoutes = new Hono();
extraRoutes.use('/admin/addons', requireAdmin);
extraRoutes.use('/admin/addons/*', requireAdmin);
extraRoutes.use('/admin/reviews', requireAdmin);
extraRoutes.use('/admin/reviews/*', requireAdmin);
extraRoutes.use('/admin/waitlist', requireAdmin);

const pence = (v) => Math.max(0, Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100) || 0);

/* Where a review came from. Anything that isn't 'site' was written somewhere
   else and gets a link back so it can be checked. */
export const SOURCES = {
  site:       { name: 'On this site',  short: 'Bought here' },
  google:     { name: 'Google',        short: 'Google' },
  trustpilot: { name: 'Trustpilot',    short: 'Trustpilot' },
  tiktok:     { name: 'TikTok',        short: 'TikTok' },
  instagram:  { name: 'Instagram',     short: 'Instagram' },
  facebook:   { name: 'Facebook',      short: 'Facebook' },
  whatsapp:   { name: 'WhatsApp',      short: 'WhatsApp' },
  ebay:       { name: 'eBay',          short: 'eBay' },
  other:      { name: 'Somewhere else', short: 'Elsewhere' },
};

export const stars = (n) => {
  const full = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="stars" aria-label="${full} out of 5">` +
    [1, 2, 3, 4, 5].map((i) => `<span class="${i <= full ? 'on' : ''}">${icon.star}</span>`).join('') +
    '</span>';
};

/* ------------------------------------------------------------------ *
 *  WAITLIST
 * ------------------------------------------------------------------ */
extraRoutes.post('/p/:id/notify', async (c) => {
  const f = await c.req.parseBody();
  const id = c.req.param('id');
  const email = String(f.email || '').trim().toLowerCase();
  if (!email.includes('@')) return c.redirect(`/p/${id}?e=` +
    encodeURIComponent('That email does not look right.'));
  await q(`insert into waitlist (product_id, email) values ($1,$2)
           on conflict (product_id, email) do nothing`, [id, email]).catch(() => {});
  return c.redirect(`/p/${id}?queued=1`);
});

/* When a bike goes back in stock, tell everyone waiting — once. */
export async function tellTheWaitlist(productId) {
  const p = await one('select * from products where id = $1', [productId]);
  if (!p || p.status !== 'stock') return 0;
  const s = await getSettings();
  const waiting = await many(
    'select * from waitlist where product_id = $1 and notified_at is null', [productId]);
  const base = String(s.site_url || '').replace(/\/$/, '');
  for (const w of waiting) {
    sendMailSafe({
      to: w.email,
      subject: `${p.name} is back`,
      text: `You asked to be told when this came back in.\n\n${p.name}\n`
          + `£${money(p.price_p)}\n\n`
          + (base ? `${base}/p/${p.id}\n\n` : '')
          + `First come, first served.\n\n— ${s.shop_name || 'Ron Cartel'}\n`,
    });
  }
  if (waiting.length) {
    await q('update waitlist set notified_at = now() where product_id = $1 and notified_at is null',
            [productId]);
  }
  return waiting.length;
}

extraRoutes.get('/admin/waitlist', async (c) => {
  const s = await getSettings();
  const rows = await many(
    `select w.*, p.name, p.status from waitlist w
       join products p on p.id = w.product_id
      order by w.created_at desc limit 300`);
  const body = `<main class="shell adm">
    <div class="adm-head"><div>
      <p class="eyebrow" style="margin:0 0 9px">Admin</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">Waiting <span class="lit">list</span></h1>
    </div></div>
    <p class="lede" style="max-width:56ch;margin-bottom:20px">People who asked to be told
      when something came back. Put a bike back in stock and they all get an email.</p>
    ${rows.length ? `<div class="panel"><div class="panel-b rows-flush">
      ${rows.map((w) => `<div class="opt" style="cursor:default">
        <span class="otxt"><span class="t">${esc(w.email)}</span>
          <span class="s">${esc(w.name)} · ${w.notified_at ? 'told' : 'waiting'}</span></span>
        <span class="oprice">${new Date(w.created_at).toLocaleDateString('en-GB')}</span>
      </div>`).join('')}
    </div></div>` : '<div class="blank"><h3>Nobody waiting yet</h3><p>The button shows on anything sold or reserved.</p></div>'}
  </main>`;
  return c.html(layout({ title: 'Waiting list — Admin', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

/* ------------------------------------------------------------------ *
 *  ADD-ONS
 * ------------------------------------------------------------------ */
extraRoutes.get('/admin/addons', async (c) => {
  const s = await getSettings();
  const rows = await many('select * from addons order by position, id');
  const row = (a) => `
    <form method="post" action="/admin/addons/${a.id}" class="dopt">
      <details${a.name === 'New add-on' ? ' open' : ''}>
      <summary class="dopt-h">
        <span class="dico">${icon.box}</span>
        <strong>${esc(a.name)}</strong>
        ${a.enabled ? '' : '<span class="tag">Hidden</span>'}
        <span class="dprice">${a.price_p === 0 ? 'Free' : '£' + money(a.price_p)}</span>
        <span class="dcv" aria-hidden="true">${icon.chev}</span>
      </summary>
      <div class="dopt-b">
        <div class="grid2">
          <div class="field"><label>Name</label>
            <input name="name" value="${esc(a.name)}" maxlength="60" required></div>
          <div class="field"><label>Price £</label>
            <input name="price" value="${money(a.price_p)}" inputmode="decimal"></div>
        </div>
        <div class="field"><label>One line about it</label>
          <input name="blurb" value="${esc(a.blurb)}" maxlength="120"
                 placeholder="Fits every Light Bee, black only"></div>
        <div class="dopt-f">
          <label class="chk"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''}>
            Offer it at checkout</label>
          <button class="btn sm" type="submit">${icon.tick} Save</button>
          <button class="btn sm ghost" type="submit" formaction="/admin/addons/${a.id}/delete"
                  formnovalidate>${icon.bin} Remove</button>
        </div>
      </div></details>
    </form>`;

  const body = `<main class="shell adm">
    <div class="adm-head"><div>
      <p class="eyebrow" style="margin:0 0 9px">Admin</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">Add <span class="lit">ons</span></h1>
    </div></div>
    ${flash('info', c.req.query('ok') ? 'Saved.' : '')}
    <p class="lede" style="max-width:58ch;margin-bottom:20px">
      Offered at checkout, after they have decided on the bike. A helmet or a spare
      charger is an easy yes at that point and it is the cheapest money you will make.</p>
    <div class="dlist">${rows.map(row).join('')}</div>
    <form method="post" action="/admin/addons" style="margin-top:18px">
      <button class="btn ghost" type="submit">${icon.plus} Add one</button>
    </form>
  </main>`;
  return c.html(layout({ title: 'Add-ons — Admin', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

extraRoutes.post('/admin/addons', async (c) => {
  const n = await one('select coalesce(max(position),0) + 1 as p from addons');
  await q(`insert into addons (name, price_p, position, enabled)
           values ('New add-on', 0, $1, false)`, [n.p]);
  return c.redirect('/admin/addons');
});

extraRoutes.post('/admin/addons/:id', async (c) => {
  const f = await c.req.parseBody();
  await q(`update addons set name=$1, blurb=$2, price_p=$3, enabled=$4 where id=$5`,
    [String(f.name || '').slice(0, 60) || 'Add-on', String(f.blurb || '').slice(0, 120),
     pence(f.price), f.enabled === 'on', c.req.param('id')]);
  return c.redirect('/admin/addons?ok=1');
});

extraRoutes.post('/admin/addons/:id/delete', async (c) => {
  await q('delete from addons where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/addons?ok=1');
});

/* ------------------------------------------------------------------ *
 *  REVIEWS
 * ------------------------------------------------------------------ */
extraRoutes.get('/reviews', async (c) => {
  const s = await getSettings();
  if (s.reviews_on !== '1') return c.notFound();
  const rows = await many(
    `select r.*, p.name as product_name from reviews r
       left join products p on p.id = r.product_id
      where r.approved order by r.created_at desc limit 200`);

  const avg = rows.length
    ? (rows.reduce((n, r) => n + r.rating, 0) / rows.length).toFixed(1) : null;

  const card = (r) => `
    <article class="rev">
      <div class="rev-h">${stars(r.rating)}
        ${r.order_id ? `<span class="tag go">${icon.tick} Bought here</span>`
          : `<span class="tag">${esc((SOURCES[r.source] || SOURCES.other).short)}</span>`}
      </div>
      ${r.title ? `<h3>${esc(r.title)}</h3>` : ''}
      <p>${esc(r.body)}</p>
      <div class="rev-f">
        <span class="rev-a">${esc(r.author)}</span>
        ${r.product_name ? `<span class="rev-p">${esc(r.product_name)}</span>` : ''}
        <span class="rev-d">${new Date(r.created_at).toLocaleDateString('en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        ${r.source_url ? `<a class="rev-l" href="${esc(r.source_url)}" target="_blank"
           rel="noopener noreferrer nofollow">See the original ↗</a>` : ''}
      </div>
    </article>`;

  const body = `<main class="shell">
    <div class="doc" style="max-width:none">
      <p class="eyebrow" style="margin:0 0 10px">What people say</p>
      <h1 class="display" style="font-size:clamp(30px,4.4vw,52px)">Reviews</h1>
      ${avg ? `<div class="rev-avg">${stars(Math.round(avg))}
        <span class="rev-n"><strong>${avg}</strong> out of 5</span>
        <span class="rev-c">${rows.length} review${rows.length === 1 ? '' : 's'}</span></div>` : ''}
      <p class="lede" style="margin-top:14px">Reviews marked <strong>Bought here</strong> are
        tied to a real order on this site. The rest were left somewhere else and link
        back to where they came from, so you can check them yourself.</p>
    </div>
    ${rows.length ? `<div class="revs">${rows.map(card).join('')}</div>`
      : `<div class="blank" style="margin-bottom:60px"><h3>No reviews yet</h3>
         <p>They will show up here once there are some.</p></div>`}
  </main>`;
  return c.html(layout({ title: 'Reviews', body, active: 'reviews',
    customer: c.get('customer'), admin: c.get('admin'), settings: s }));
});

/* A customer leaving one about an order they actually placed. */
extraRoutes.post('/order/:ref/review', async (c) => {
  const f = await c.req.parseBody();
  const o = await one('select * from orders where ref = $1', [c.req.param('ref').toUpperCase()]);
  if (!o) return c.notFound();
  const rating = Math.max(1, Math.min(5, parseInt(f.rating, 10) || 5));
  await q(`insert into reviews (author, rating, title, body, source, product_id, order_id, approved)
           values ($1,$2,$3,$4,'site',$5,$6,false)`,
    [String(o.cust_name || 'A customer').slice(0, 60), rating,
     String(f.title || '').slice(0, 90), String(f.body || '').slice(0, 1200),
     o.product_id, o.id]);
  return c.redirect(`/order/${o.ref}?reviewed=1`);
});

extraRoutes.get('/admin/reviews', async (c) => {
  const s = await getSettings();
  const rows = await many(
    `select r.*, p.name as product_name from reviews r
       left join products p on p.id = r.product_id
      order by r.approved, r.created_at desc limit 200`);
  const products = await many('select id, name from products order by position, id');
  const pending = rows.filter((r) => !r.approved).length;

  const row = (r) => `
    <div class="revadm${r.approved ? '' : ' pending'}">
      <div class="ra-h">${stars(r.rating)}
        <strong>${esc(r.author)}</strong>
        <span class="tag">${esc((SOURCES[r.source] || SOURCES.other).name)}</span>
        ${r.order_id ? `<span class="tag go">${icon.tick} Real order</span>` : ''}
        <span class="ra-d">${new Date(r.created_at).toLocaleDateString('en-GB')}</span>
        <div class="ra-acts">
          <form method="post" action="/admin/reviews/${r.id}/${r.approved ? 'hide' : 'approve'}">
            <button class="btn sm${r.approved ? ' ghost' : ''}" type="submit">
              ${r.approved ? 'Hide it' : icon.tick + ' Publish'}</button></form>
          <form method="post" action="/admin/reviews/${r.id}/delete">
            <button class="iconbtn danger" type="submit" title="Delete">${icon.bin}</button></form>
        </div>
      </div>
      ${r.title ? `<div class="ra-t">${esc(r.title)}</div>` : ''}
      <p class="ra-b">${esc(r.body)}</p>
      ${r.source_url ? `<a class="ra-l" href="${esc(r.source_url)}" target="_blank"
         rel="noopener noreferrer">${esc(r.source_url)}</a>` : ''}
    </div>`;

  const body = `<main class="shell adm">
    <div class="adm-head"><div>
      <p class="eyebrow" style="margin:0 0 9px">Admin</p>
      <h1 class="display" style="font-size:clamp(26px,3.4vw,36px)">Reviews${pending
        ? ` <span class="lit">· ${pending} waiting</span>` : ''}</h1>
    </div></div>
    ${flash('info', c.req.query('ok') ? 'Done.' : '')}
    ${flash('error', c.req.query('e'))}

    <section class="panel spot" style="margin-bottom:22px">
      <div class="panel-h"><span class="hico" aria-hidden="true">${icon.plus}</span>
        <h3>Add one you were left somewhere else</h3></div>
      <div class="panel-b">
        <div class="note info" style="margin:0 0 16px">${icon.spark}
          <div>Only put in reviews someone actually left you. Inventing them is
          illegal under UK consumer law and it is the easiest thing in the world
          to spot. The link is what makes an imported one worth anything —
          without it, it is just words on your own website.</div></div>
        <form method="post" action="/admin/reviews">
          <div class="grid2">
            <div class="field"><label for="ra">Who wrote it</label>
              <input id="ra" name="author" required maxlength="60" placeholder="Danny W."></div>
            <div class="field"><label for="rr">Stars</label>
              <select id="rr" name="rating">
                ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} star${n === 1 ? '' : 's'}</option>`).join('')}
              </select></div>
          </div>
          <div class="grid2">
            <div class="field"><label for="rs">Where from</label>
              <select id="rs" name="source">
                ${Object.entries(SOURCES).filter(([k]) => k !== 'site').map(([k, v]) =>
                  `<option value="${k}">${esc(v.name)}</option>`).join('')}
              </select></div>
            <div class="field"><label for="rp">Which bike <span style="color:var(--ghost);font-weight:400">optional</span></label>
              <select id="rp" name="product_id"><option value="">Not about one in particular</option>
                ${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
              </select></div>
          </div>
          <div class="field"><label for="ru">Link to the original</label>
            <input id="ru" name="source_url" maxlength="300" placeholder="https://..." inputmode="url">
            <div class="hint">Where it can be read in the wild. Shown to customers as
              "See the original".</div></div>
          <div class="field"><label for="rt">Heading <span style="color:var(--ghost);font-weight:400">optional</span></label>
            <input id="rt" name="title" maxlength="90"></div>
          <div class="field"><label for="rb">What they said</label>
            <textarea id="rb" name="body" required maxlength="1200" style="min-height:90px"></textarea></div>
          <button class="btn" type="submit">${icon.tick} Add it</button>
        </form>
      </div>
    </section>

    ${rows.length ? rows.map(row).join('')
      : '<div class="blank"><h3>No reviews yet</h3><p>Ones left by customers land here for you to publish.</p></div>'}
  </main>`;
  return c.html(layout({ title: 'Reviews — Admin', body, active: 'admin',
    admin: c.get('admin'), settings: s }));
});

extraRoutes.post('/admin/reviews', async (c) => {
  const f = await c.req.parseBody();
  const url = String(f.source_url || '').trim();
  if (url && !/^https:\/\//i.test(url)) {
    return c.redirect('/admin/reviews?e=' +
      encodeURIComponent('That link needs to start with https://'));
  }
  await q(`insert into reviews (author, rating, title, body, source, source_url, product_id, approved)
           values ($1,$2,$3,$4,$5,$6,$7,true)`,
    [String(f.author || '').slice(0, 60) || 'Anonymous',
     Math.max(1, Math.min(5, parseInt(f.rating, 10) || 5)),
     String(f.title || '').slice(0, 90), String(f.body || '').slice(0, 1200),
     SOURCES[String(f.source)] ? String(f.source) : 'other',
     url.slice(0, 300), f.product_id ? Number(f.product_id) : null]);
  return c.redirect('/admin/reviews?ok=1');
});

extraRoutes.post('/admin/reviews/:id/approve', async (c) => {
  await q('update reviews set approved = true where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/reviews?ok=1');
});
extraRoutes.post('/admin/reviews/:id/hide', async (c) => {
  await q('update reviews set approved = false where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/reviews?ok=1');
});
extraRoutes.post('/admin/reviews/:id/delete', async (c) => {
  await q('delete from reviews where id = $1', [c.req.param('id')]);
  return c.redirect('/admin/reviews?ok=1');
});
