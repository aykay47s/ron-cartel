import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { layout, esc, money, icon, productArt, makeRef } from './ui.js';

export const checkoutRoutes = new Hono();

const clampQty = (v) => Math.min(9, Math.max(1, parseInt(v, 10) || 1));

/* Totals are always recomputed here from the database. Nothing the browser
   sends about price or delivery cost is trusted. */
async function priceOrder({ product, qty, option }) {
  const unit_p = product.price_p;
  const subtotal_p = unit_p * qty;
  const isCollection = !!option?.is_collection;
  const delivery_p = isCollection ? 0 : (option?.price_p ?? 0);
  const depositOnly = isCollection && product.deposit_p != null && product.deposit_p > 0;
  const total_p = depositOnly ? product.deposit_p : subtotal_p + delivery_p;
  return { unit_p, subtotal_p, delivery_p, total_p, depositOnly };
}

checkoutRoutes.get('/checkout', async (c) => {
  const id = c.req.query('id');
  const qty = clampQty(c.req.query('qty'));
  const product = id ? await one('select * from products where id = $1', [id]) : null;
  const s = await getSettings();

  if (!product || product.status !== 'stock') {
    const body = `<main class="shell"><div class="blank" style="margin:60px 0 90px">
      <div class="ico">${icon.bag}</div><h3>That item isn't available</h3>
      <p>It may have sold or been reserved while you were looking.</p>
      <a class="btn" href="/" style="display:inline-flex">Back to the shop</a></div></main>`;
    return c.html(layout({ title: 'Checkout', body, admin: c.get('admin') }), 404);
  }

  const options = await many(
    'select * from delivery_options where enabled order by position, id'
  );
  const bankReady = s.bank_sort && s.bank_number;
  const paypalReady = !!s.paypal_address;

  const shipRows = options.map((o, i) => `
    <label class="opt${i === 0 ? ' sel' : ''}" data-ship="${o.id}"
           data-price="${o.price_p}" data-collect="${o.is_collection ? 1 : 0}">
      <input type="radio" name="delivery_id" value="${o.id}"${i === 0 ? ' checked' : ''}>
      <span class="dot" aria-hidden="true"><i></i></span>
      <span class="oico" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1.5"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
      <span class="otxt"><span class="t">${esc(o.label)}${o.is_collection ? ' <span class="tag">Deposit</span>' : ''}</span>
        <span class="s">${esc(o.note)}</span></span>
      <span class="oprice${o.price_p === 0 ? ' free' : ''}">${o.price_p === 0 ? 'Free' : '£' + money(o.price_p)}</span>
    </label>`).join('');

  const payRows = `
    ${bankReady ? `
    <label class="opt sel" data-pay="bank">
      <input type="radio" name="method" value="bank" checked>
      <span class="dot" aria-hidden="true"><i></i></span>
      <span class="oico" aria-hidden="true">${icon.bank}</span>
      <span class="otxt"><span class="t">Bank transfer <span class="tag go">Instant</span></span>
        <span class="s">Faster Payments — usually clears in seconds</span></span>
    </label>` : ''}
    ${paypalReady ? `
    <label class="opt${bankReady ? '' : ' sel'}" data-pay="ppff">
      <input type="radio" name="method" value="ppff"${bankReady ? '' : ' checked'}>
      <span class="dot" aria-hidden="true"><i></i></span>
      <span class="oico" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.2L8.3 6.4h5.4c2.7 0 4.2 1.5 3.8 3.9-.5 2.6-2.5 4.1-5.3 4.1H9.8L9 20.2z"/></svg></span>
      <span class="otxt"><span class="t">PayPal — Friends &amp; Family</span>
        <span class="s">Personal payment, checked by hand</span></span>
    </label>` : ''}
    ${!bankReady && !paypalReady ? `<div class="note warn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5h.01"/></svg>
      <span>No payment method is set up yet. Add your bank details or PayPal address in admin settings.</span></div>` : ''}`;

  const canOrder = bankReady || paypalReady;
  const first = options[0];
  const priced = await priceOrder({ product, qty, option: first });

  const body = `
<main class="shell co">
  <form method="post" action="/checkout" id="coform">
    <input type="hidden" name="id" value="${product.id}">
    <input type="hidden" name="qty" value="${qty}">

    <div class="co-head rv">
      <p class="eyebrow" style="margin:0 0 8px">Checkout</p>
      <h1 class="display">Where it's going<br><span class="lit">and how you'll pay</span></h1>
    </div>

    <section class="panel spot rv" style="margin-bottom:18px">
      <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
        <h3>Your details</h3></div>
      <div class="panel-b">
        <div class="grid2">
          <div class="field"><label for="cn">Full name</label>
            <input id="cn" name="cust_name" required maxlength="80" autocomplete="name"></div>
          <div class="field"><label for="ce">Email</label>
            <input id="ce" name="cust_email" type="email" required maxlength="120" autocomplete="email"></div>
        </div>
        <div class="field"><label for="cp">Phone</label>
          <input id="cp" name="cust_phone" maxlength="30" autocomplete="tel"></div>
        <div class="field"><label for="ad">Delivery address</label>
          <textarea id="ad" name="address" required maxlength="400"
            placeholder="Street, town, postcode" autocomplete="street-address"></textarea></div>
      </div>
    </section>

    <section class="panel spot rv" style="margin-bottom:18px">
      <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
        <h3>How it gets to you</h3></div>
      <div class="panel-b" id="ship">${shipRows}</div>
    </section>

    <section class="panel spot rv">
      <div class="panel-h"><span class="hico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg></span>
        <h3>Payment method</h3></div>
      <div class="panel-b" id="pay">${payRows}</div>
    </section>
  </form>

  <aside class="rail rv">
    <div class="panel spot">
      <div class="panel-h"><span class="hico" aria-hidden="true">${icon.bag}</span><h3>Your order</h3></div>
      <div class="panel-b">
        <div class="li">
          <span class="li-thumb" aria-hidden="true" style="overflow:hidden;padding:4px">${productArt(product)}</span>
          <div><div class="li-t">${esc(product.name)}</div>
            <div class="li-s">Qty ${qty}</div></div>
          <div class="li-p">£${money(priced.subtotal_p)}</div>
        </div>
        <div class="sum-row"><span>Subtotal</span><b>£${money(priced.subtotal_p)}</b></div>
        <div class="sum-row"><span>Delivery</span><b id="shipVal">${priced.delivery_p === 0 ? 'Free' : '£' + money(priced.delivery_p)}</b></div>
        <div class="sum-total"><span class="lbl" id="totalLabel">${priced.depositOnly ? 'Deposit due' : 'Total'}</span>
          <span class="amt"><span aria-hidden="true">£</span><span id="grand" class="num">${money(priced.total_p)}</span></span></div>

        <button class="btn wide" form="coform" type="submit" style="margin-top:17px"${canOrder ? '' : ' disabled'}>
          ${icon.lock}<span id="placeTxt">${priced.depositOnly ? 'Pay deposit & reserve' : 'Place order'}</span>
        </button>

        <div class="trust">
          <div>${icon.tick}Stock held ${esc(s.hold_hours)} hours while you pay</div>
          <div>${icon.tick}Tracked and signed-for dispatch</div>
          <div>${icon.tick}UK support, seven days a week</div>
        </div>
      </div>
    </div>
  </aside>
</main>

<script>
(function(){
  var SUB = ${priced.subtotal_p}, DEP = ${product.deposit_p || 0};
  function paint(){
    var sel = document.querySelector('#ship .opt.sel');
    var collect = sel && sel.dataset.collect === '1';
    var ship = sel ? parseInt(sel.dataset.price, 10) : 0;
    var depositOnly = collect && DEP > 0;
    var total = depositOnly ? DEP : SUB + ship;
    document.getElementById('shipVal').textContent = ship === 0 ? 'Free' : '£' + (ship/100).toFixed(2);
    document.getElementById('grand').textContent = (total/100).toFixed(2);
    document.getElementById('totalLabel').textContent = depositOnly ? 'Deposit due' : 'Total';
    document.getElementById('placeTxt').textContent = depositOnly ? 'Pay deposit & reserve' : 'Place order';
  }
  function group(sel){
    document.querySelectorAll(sel + ' .opt').forEach(function(o){
      o.addEventListener('click', function(){
        document.querySelectorAll(sel + ' .opt').forEach(function(x){ x.classList.remove('sel'); });
        o.classList.add('sel');
        var r = o.querySelector('input'); if (r) r.checked = true;
        paint();
      });
    });
  }
  group('#ship'); group('#pay'); paint();
})();
</script>`;

  return c.html(layout({ title: `Checkout — ${s.shop_name}`, body, admin: c.get('admin') }));
});

checkoutRoutes.post('/checkout', async (c) => {
  const form = await c.req.parseBody();
  const product = await one('select * from products where id = $1', [form.id]);
  if (!product || product.status !== 'stock') return c.redirect('/');

  const qty = clampQty(form.qty);
  const option = await one('select * from delivery_options where id = $1 and enabled', [form.delivery_id]);
  const s = await getSettings();
  const method = form.method === 'ppff' ? 'ppff' : 'bank';
  if (method === 'bank' && !(s.bank_sort && s.bank_number)) return c.redirect('/');
  if (method === 'ppff' && !s.paypal_address) return c.redirect('/');

  const priced = await priceOrder({ product, qty, option });

  /* Retry on the tiny chance of a reference collision. */
  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await one(
        `insert into orders
           (ref, product_id, product_name, qty, unit_p, delivery_label, delivery_p,
            total_p, is_deposit, method, cust_name, cust_email, cust_phone, address)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning *`,
        [makeRef(), product.id, product.name, qty, priced.unit_p,
         option?.label || '', priced.delivery_p, priced.total_p, priced.depositOnly,
         method, String(form.cust_name || '').slice(0, 80),
         String(form.cust_email || '').slice(0, 120),
         String(form.cust_phone || '').slice(0, 30),
         String(form.address || '').slice(0, 400)]
      );
    } catch (e) {
      if (!String(e.message).includes('orders_ref_key')) throw e;
    }
  }
  if (!order) return c.text('Could not create the order, please try again', 500);

  return c.redirect('/order/' + order.ref);
});

/* ---------------- order confirmation ---------------- */
checkoutRoutes.get('/order/:ref', async (c) => {
  const order = await one('select * from orders where ref = $1', [c.req.param('ref').toUpperCase()]);
  if (!order) return c.notFound();
  const s = await getSettings();
  const paid = order.status === 'paid';

  const rows = order.method === 'ppff'
    ? [['Amount', '£' + money(order.total_p)],
       ['PayPal address', s.paypal_address],
       ['Message field', order.ref]]
    : [['Amount', '£' + money(order.total_p)],
       ['Account name', s.bank_account_name],
       ['Sort code', s.bank_sort],
       ['Account number', s.bank_number],
       ['Reference', order.ref]];

  const body = `
<main class="shell receipt">
  <div class="receipt-h">
    <div class="seal">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="sealgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2E8BFF"/><stop offset="1" stop-color="#A6CDFF"/></linearGradient></defs>
        <circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45"/>
      </svg>
      <span class="core" style="${paid ? 'background:var(--go-dim);color:var(--go)' : ''}" aria-hidden="true">
        ${paid
          ? '<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
          : '<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.6 1.8"/></svg>'}
      </span>
    </div>
    <p class="eyebrow" style="margin:0 0 9px">${paid ? 'Payment confirmed' : 'Order received'}</p>
    <h1 class="display">${paid ? 'You’re <span class="lit">all set</span>' : 'Awaiting <span class="lit">payment</span>'}</h1>
    <p>${paid
      ? 'We’ve got your payment and your order is being prepared.'
      : `Send the money using the reference below and we'll confirm by email. Stock is held for ${esc(s.hold_hours)} hours.`}</p>
  </div>

  <div class="plate hero">
    <div class="pk">Your payment reference</div>
    <div class="pv refOut">${esc(order.ref)}</div>
    <button class="copy" type="button" data-copy=".refOut">Copy reference</button>
  </div>

  ${paid ? '' : `
  <div class="panel spot">
    <div class="panel-h"><h3>${order.method === 'ppff' ? 'PayPal Friends & Family' : 'Bank transfer details'}</h3></div>
    <div class="panel-b">
      <div class="rows">
        ${rows.map(([k, v]) => `<div class="row-f"><span class="k">${esc(k)}</span><span class="v big">${esc(v)}</span></div>`).join('')}
      </div>
      ${order.is_deposit ? `<div class="note info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4.5M12 8h.01"/></svg>
        <span>${esc(s.collection_note)}</span></div>` : ''}
      ${order.method === 'ppff' ? `<div class="note stop">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9.5v4M12 17.5h.01"/></svg>
        <span>Friends &amp; Family carries no PayPal buyer protection and can't be reversed.</span></div>` : ''}
    </div>
  </div>`}

  <div class="panel spot" style="margin-top:18px">
    <div class="panel-h"><h3>Summary</h3></div>
    <div class="panel-b"><div class="rows">
      <div class="row-f"><span class="k">Item</span><span class="v">${esc(order.product_name)} × ${order.qty}</span></div>
      <div class="row-f"><span class="k">Delivery</span><span class="v">${esc(order.delivery_label || '—')}</span></div>
      <div class="row-f"><span class="k">${order.is_deposit ? 'Deposit' : 'Total'}</span><span class="v big">£${money(order.total_p)}</span></div>
      <div class="row-f"><span class="k">Status</span><span class="v">${paid ? 'Confirmed' : 'Awaiting payment'}</span></div>
    </div></div>
  </div>

  <p style="text-align:center;margin-top:24px"><a class="btn ghost sm" href="/">← Back to the shop</a></p>
</main>`;

  return c.html(layout({ title: `Order ${order.ref} — ${s.shop_name}`, body, admin: c.get('admin') }));
});
