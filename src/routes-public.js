import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { layout, esc, money, icon, bikePhoto, productArt, makeRef, STATUS_LABEL } from './ui.js';
import { seen, viewerLine } from './viewers.js';

export const publicRoutes = new Hono();

/* ---------------- shop ---------------- */
publicRoutes.get('/', async (c) => {
  const s = await getSettings();
  const items = await many(
    `select id, name, blurb, price_p, was_p, status, image_id, category
       from products order by position, id desc`
  );
  const live = items.filter((p) => p.status === 'stock').length;

  const card = (p) => {
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
  };

  /* Two slots, kept apart. Someone after a brand new bike and someone after a
     grafted one are shopping for different things, and mixing them makes both
     harder to find. */
  const GROUPS = [
    ['grafted', 'Grafted builds', 'Rebuilt and tested here'],
    ['new',     'Brand new',      'Straight out of the box, untouched'],
  ];
  const sections = GROUPS.map(([key, title, sub]) => {
    const mine = items.filter((p) => (p.category || 'grafted') === key);
    if (!mine.length) return '';
    const inStock = mine.filter((p) => p.status === 'stock').length;
    return `
      <div class="grid-head" id="${key}">
        <div><p class="eyebrow" style="margin:0 0 8px">${esc(sub)}</p>
          <h2 class="sect">${esc(title)}</h2></div>
        <p class="lede" style="margin:0 0 2px;font-size:14px">${inStock} of ${mine.length}
          available</p>
      </div>
      <div class="cards">${mine.map(card).join('')}</div>`;
  }).join('');

  const cards = items.length ? sections
    : `<div class="blank">
        <div class="ico">${icon.bag}</div>
        <h3>Nothing listed yet</h3>
        <p>Stock added in the admin panel shows up here straight away.</p>
      </div>`;

  const body = `
<main class="shell">
  <section class="hero">
    <!-- The word sits behind the bike like paint on a shutter. It is the
         brand mark at poster scale, not a decoration. -->
    <span class="hero-word" aria-hidden="true">CARTEL</span>
    <div class="hero-copy">
      <p class="eyebrow rv" style="margin:0 0 13px">${esc(s.tagline)}</p>
      <!-- Every word of this comes from Settings. The shop owner knows their
           own pitch better than a line I made up. -->
      <h1 class="display rv">${esc(s.hero_line1)}<br><span class="lit">${esc(s.hero_line2)}</span></h1>
      <p class="lede rv">${esc(s.hero_blurb)}</p>
      <div class="hero-cta rv"><a class="btn" href="#shop">${icon.bag} See what's in</a></div>
      <dl class="specs rv">
        <div class="spec"><dt class="k">${esc(s.hero_stat1_k)}</dt><dd class="v">${esc(s.hero_stat1_v)}</dd></div>
        <div class="spec"><dt class="k">${esc(s.hero_stat2_k)}</dt><dd class="v">${esc(s.hero_stat2_v)}</dd></div>
        <div class="spec"><dt class="k">${esc(s.hero_stat3_k)}</dt><dd class="v">${esc(s.hero_stat3_v)}</dd></div>
      </dl>
    </div>
    <div class="stage rv">
      <span class="lbl eyebrow">${esc(s.hero_bike)}</span>
      ${bikePhoto()}
      <div class="readout">
        <div><span class="v" id="r-speed" data-to="${esc(s.hero_r1)}">0</span><span class="k">${esc(s.hero_r1k)}</span></div>
        <div><span class="v" id="r-power" data-to="${esc(s.hero_r2)}">0</span><span class="k">${esc(s.hero_r2k)}</span></div>
        <div><span class="v">${esc(s.hero_r3)}</span><span class="k">${esc(s.hero_r3k)}</span></div>
        <div><span class="v">${esc(s.hero_r4)}</span><span class="k">${esc(s.hero_r4k)}</span></div>
      </div>
    </div>
  </section>
</main>

<main class="shell" id="shop">
  <!-- Each shelf brings its own heading and its own grid. Wrapping them in one
       .cards grid turned the headings into grid cells sitting beside the bikes. -->
  ${cards}
</main>


<script>
(function(){
  /* Count up to the real figure once and stop. The old version oscillated
     forever like a live speedo, which looked busy and meant nothing. */
  var els = [document.getElementById('r-speed'), document.getElementById('r-power')];
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.forEach(function (el) {
    if (!el) return;
    var target = parseFloat(el.dataset.to || '0');
    var dp = (el.dataset.to || '').indexOf('.') > -1 ? 1 : 0;
    if (reduced || !target) { el.textContent = el.dataset.to || '0'; return; }
    var start = null, ms = 900;
    requestAnimationFrame(function step(now) {
      if (start === null) start = now;
      var k = Math.min(1, (now - start) / ms);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = (target * eased).toFixed(dp);
      if (k < 1) requestAnimationFrame(step); else el.textContent = el.dataset.to;
    });
  });
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
  /* A real count of other people on this listing right now. Says nothing
     when there is nothing to say. */
  const watching = gone ? 0 : await seen(c, p.id);
  const watchLine = viewerLine(watching);

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
    ${watchLine ? `<p class="watching"><span class="wdot" aria-hidden="true"></span>${esc(watchLine)}</p>` : ''}

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
