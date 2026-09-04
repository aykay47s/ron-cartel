import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { layout, esc, money, icon, bikePhoto, productArt, makeRef, STATUS_LABEL } from './ui.js';

export const publicRoutes = new Hono();

/* ---------------- shop ---------------- */
publicRoutes.get('/', async (c) => {
  const s = await getSettings();
  const items = await many(
    `select id, name, blurb, price_p, was_p, status, image_id
       from products order by position, id desc`
  );
  const live = items.filter((p) => p.status === 'stock').length;

  const cards = items.length
    ? items.map((p) => {
        const gone = p.status !== 'stock';
        const inner = `
          <div class="art"><span class="badge ${esc(p.status)}">${STATUS_LABEL[p.status] || ''}</span>
            ${productArt(p)}</div>
          <div class="body"><h3>${esc(p.name)}</h3>
            <div class="meta">${esc(p.blurb)}</div>
            <div class="foot"><span class="price">${p.was_p ? `<s>£${money(p.was_p)}</s>` : ''}£${money(p.price_p)}</span>
              <span class="go" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
            </div></div>`;
        const cls = 'card spot rv' + (gone ? ' gone' : '');
        return gone
          ? `<div class="${cls}">${inner}</div>`
          : `<a class="${cls}" href="/p/${p.id}">${inner}</a>`;
      }).join('')
    : `<div class="blank">
        <div class="ico">${icon.bag}</div>
        <h3>Nothing listed yet</h3>
        <p>Stock added in the admin panel shows up here straight away.</p>
      </div>`;

  const body = `
<main class="shell">
  <section class="hero">
    <div>
      <p class="eyebrow rv" style="margin:0 0 13px">${esc(s.tagline)}</p>
      <h1 class="display rv">Built to take<br><span class="lit">the abuse.</span></h1>
      <p class="lede rv">Grafted Light Bee builds, put together and tested here — not pulled off a pallet and shipped on. Next-day UK delivery, or collect in person with a deposit.</p>
      <div class="hero-cta rv"><a class="btn" href="#shop">${icon.bag} See what's in</a></div>
      <div class="specs rv">
        <div class="spec"><div class="v">24h</div><div class="k">UK dispatch</div></div>
        <div class="spec"><div class="v">6kW</div><div class="k">Peak power</div></div>
        <div class="spec"><div class="v">250Nm</div><div class="k">Peak torque</div></div>
      </div>
    </div>
    <div class="stage rv">
      <span class="lbl eyebrow">Light Bee X · 19" front &amp; rear</span>
      ${bikePhoto()}
      <div class="readout">
        <div><span class="v" id="r-speed">0</span><span class="k">km/h</span></div>
        <div><span class="v" id="r-power">0.0</span><span class="k">kW</span></div>
        <div><span class="v">60V</span><span class="k">40Ah</span></div>
        <div><span class="v">56</span><span class="k">kg</span></div>
      </div>
    </div>
  </section>
</main>

<main class="shell" id="shop">
  <div class="grid-head">
    <div><p class="eyebrow rv" style="margin:0 0 8px">Current stock</p>
      <h2 class="sect rv">What's available</h2></div>
    ${items.length ? `<p class="lede rv" style="margin:0 0 2px;font-size:14px">${live} of ${items.length} ${items.length === 1 ? 'listing' : 'listings'} available right now.</p>` : ''}
  </div>
  <div class="cards">${cards}</div>
</main>


<script>
(function(){
  var sp = document.getElementById('r-speed'), pw = document.getElementById('r-power');
  if (!sp) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sp.textContent = '75'; pw.textContent = '6.0'; return;
  }
  var t = 0;
  setInterval(function(){
    t += 0.06;
    sp.textContent = Math.max(0, Math.round(52 + Math.sin(t)*20 + Math.sin(t*2.3)*3));
    pw.textContent = (2.4 + Math.abs(Math.sin(t*1.4))*3.4).toFixed(1);
  }, 90);
})();
</script>`;

  return c.html(layout({ title: `${s.shop_name} — grafted Sur-Rons`, body, active: 'shop',
                         admin: c.get('admin'), customer: c.get('customer'), settings: s }));
});

/* ---------------- product ---------------- */
publicRoutes.get('/p/:id', async (c) => {
  const p = await one('select * from products where id = $1', [c.req.param('id')]);
  if (!p) return c.notFound();
  const s = await getSettings();
  const gone = p.status !== 'stock';

  const body = `
<main class="shell pdp">
  <div class="rv"><div class="stage spot">
    <div class="tags"><span class="tag ${gone ? '' : 'go'}">${STATUS_LABEL[p.status]}</span>
      ${p.deposit_p ? `<span class="tag">Deposit £${money(p.deposit_p)}</span>` : ''}</div>
    ${productArt(p)}
  </div></div>

  <div class="buy rv">
    <p class="eyebrow" style="margin:0 0 10px">${esc(s.shop_name)}</p>
    <h1 class="display" style="font-size:clamp(26px,3.5vw,38px)">${esc(p.name)}</h1>
    ${p.blurb ? `<p class="lede" style="font-size:15px">${esc(p.blurb)}</p>` : ''}
    <div class="price-row"><span class="price">£${money(p.price_p)}</span>
      ${p.was_p ? `<span class="was">£${money(p.was_p)}</span>` : ''}</div>

    ${gone
      ? `<div class="note warn" style="margin-top:16px">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5h.01"/></svg>
           <span>This one is marked <strong>${STATUS_LABEL[p.status].toLowerCase()}</strong>, so it can't be ordered right now.</span></div>
         <p style="margin-top:22px"><a class="btn ghost" href="/">Back to the shop</a></p>`
      : `<form method="get" action="/checkout" style="margin-top:22px">
           <input type="hidden" name="id" value="${p.id}">
           <div class="eyebrow" style="margin-bottom:9px">Quantity</div>
           <div class="qty">
             <button type="button" data-step="-1" aria-label="Decrease">−</button>
             <input class="n" id="qty" name="qty" value="1" inputmode="numeric" readonly>
             <button type="button" data-step="1" aria-label="Increase">+</button>
           </div>
           <div class="buyrow">
             <button class="btn" type="submit" style="flex:1;min-width:210px">${icon.bag} Buy now — £${money(p.price_p)}</button>
             <a class="btn ghost" href="/">Back</a>
           </div>
         </form>`}

    ${p.body ? `<div class="facts"><details class="fact" open><summary>About this build
      <span class="cv" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></summary>
      <div class="in">${esc(p.body).replace(/\n/g, '<br>')}</div></details></div>` : ''}
  </div>
</main>
<script>
document.querySelectorAll('[data-step]').forEach(function(b){
  b.addEventListener('click', function(){
    var i = document.getElementById('qty');
    var v = Math.min(9, Math.max(1, (parseInt(i.value,10)||1) + parseInt(b.dataset.step,10)));
    i.value = v;
  });
});
</script>`;

  return c.html(layout({ title: `${p.name} — ${s.shop_name}`, body,
                         admin: c.get('admin'), customer: c.get('customer'), settings: s }));
});

/* ---------------- image serving ---------------- */
publicRoutes.get('/img/:id', async (c) => {
  const row = await one('select mime, bytes from images where id = $1', [c.req.param('id')]);
  if (!row) return c.notFound();
  return new Response(row.bytes, {
    headers: {
      'content-type': row.mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});
