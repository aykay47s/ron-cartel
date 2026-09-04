import { Hono } from 'hono';
import { q, one, many, getSettings } from './db.js';
import { layout, esc, money, icon, productArt, makeRef } from './ui.js';
import { customerFrom, readCustomerCookie } from './auth.js';
import { sendMailSafe, templates } from './mail.js';
import { statusPill } from './routes-customer.js';
import { bankConfig, createBankPayment, bankPaymentStatus } from './pay-bank.js';

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
  const cust = await customerFrom(readCustomerCookie(c));

  if (!product || product.status !== 'stock') {
    const body = `<main class="shell"><div class="blank" style="margin:60px 0 90px">
      <div class="ico">${icon.bag}</div><h3>That item isn't available</h3>
      <p>It may have sold or been reserved while you were looking.</p>
      <a class="btn" href="/" style="display:inline-flex">Back to the shop</a></div></main>`;
    return c.html(layout({ title: 'Checkout', body, admin: c.get('admin') , settings: s }), 404);
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

  const bank = await bankConfig();

  const method = (id, label, note, ic, tag, on) => `
    <label class="opt pay${on ? ' sel' : ''}" data-pay="${id}">
      <input type="radio" name="method" value="${id}"${on ? ' checked' : ''}>
      <span class="dot" aria-hidden="true"><i></i></span>
      <span class="oico" aria-hidden="true">${ic}</span>
      <span class="otxt"><span class="t">${label}${tag || ''}</span>
        <span class="s">${note}</span></span>
    </label>`;

  /* Best option first: instant, confirmed automatically, nothing to match by hand. */
  let firstMethod = true;
  const pick = () => { const v = firstMethod; firstMethod = false; return v; };

  const payRows = `
    ${bank.ready ? method('bankpay', 'Pay by bank',
        'Tap your bank, approve in the app. Clears in seconds and confirms itself.',
        icon.bankpay, ` <span class="tag go">${icon.bolt} Instant</span>`, pick()) : ''}
    ${bankReady ? method('bank', 'Manual bank transfer',
        'You send it yourself using the reference. We confirm once it lands.',
        icon.bank, '', pick()) : ''}
    ${paypalReady ? method('ppff', 'PayPal — Friends &amp; Family',
        'Personal payment, checked by hand. No PayPal buyer protection.',
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.2L8.3 6.4h5.4c2.7 0 4.2 1.5 3.8 3.9-.5 2.6-2.5 4.1-5.3 4.1H9.8L9 20.2z"/></svg>',
        '', pick()) : ''}
    ${!bank.ready && !bankReady && !paypalReady ? `<div class="note warn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5h.01"/></svg>
      <span>No payment method is set up yet. Add one in Admin &rarr; Settings.</span></div>` : ''}`;

  const canOrder = bank.ready || bankReady || paypalReady;
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
            <input id="cn" name="cust_name" required maxlength="80" autocomplete="name"
                   value="${esc(cust?.name || '')}"></div>
          <div class="field"><label for="ce">Email</label>
            <input id="ce" name="cust_email" type="email" required maxlength="120" autocomplete="email"
                   value="${esc(cust?.email || '')}"></div>
        </div>
        <div class="field"><label for="cp">Phone</label>
          <input id="cp" name="cust_phone" maxlength="30" autocomplete="tel"
                 value="${esc(cust?.phone || '')}"></div>
        <div class="field"><label for="ad">Delivery address</label>
          <textarea id="ad" name="address" required maxlength="400"
            placeholder="Street, town, postcode" autocomplete="street-address">${esc(cust?.address || '')}</textarea></div>
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

        <!-- One line, and it is true: the hold window comes from settings.
             "Tracked and signed-for dispatch" was not true of every option,
             and "UK support, seven days a week" was invented outright. -->
        <p class="hold-note">Your order is held for ${esc(s.hold_hours)} hours while payment clears.</p>
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

  return c.html(layout({ title: `Checkout — ${s.shop_name}`, body,
                         admin: c.get('admin'), customer: cust, settings: s }));
});

checkoutRoutes.post('/checkout', async (c) => {
  const form = await c.req.parseBody();
  const product = await one('select * from products where id = $1', [form.id]);
  if (!product || product.status !== 'stock') return c.redirect('/');

  const qty = clampQty(form.qty);
  const option = await one('select * from delivery_options where id = $1 and enabled', [form.delivery_id]);
  const s = await getSettings();
  const bank = await bankConfig();
  const asked = String(form.method || 'bank');
  const method = ['bank', 'ppff', 'bankpay'].includes(asked) ? asked : 'bank';
  if (method === 'bank'    && !(s.bank_sort && s.bank_number)) return c.redirect('/');
  if (method === 'ppff'    && !s.paypal_address)              return c.redirect('/');
  if (method === 'bankpay' && !bank.ready)                    return c.redirect('/');

  const priced = await priceOrder({ product, qty, option });
  const cust = await customerFrom(readCustomerCookie(c));

  /* Retry on the tiny chance of a reference collision. */
  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await one(
        `insert into orders
           (ref, product_id, product_name, qty, unit_p, delivery_label, delivery_p,
            total_p, is_deposit, method, cust_name, cust_email, cust_phone, address, customer_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         returning *`,
        [makeRef(), product.id, product.name, qty, priced.unit_p,
         option?.label || '', priced.delivery_p, priced.total_p, priced.depositOnly,
         method, String(form.cust_name || '').slice(0, 80),
         String(form.cust_email || '').slice(0, 120),
         String(form.cust_phone || '').slice(0, 30),
         String(form.address || '').slice(0, 400), cust ? cust.id : null]
      );
    } catch (e) {
      if (!String(e.message).includes('orders_ref_key')) throw e;
    }
  }
  if (!order) return c.text('Could not create the order, please try again', 500);

  await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
          [order.id, 'Order placed', `${order.product_name} × ${order.qty}`]);
  if (order.cust_email) {
    const t = templates.orderPlaced(order, s);
    sendMailSafe({ to: order.cust_email, ...t });
  }

  /* Pay by bank hands straight off to the bank's own approval screen. */
  if (method === 'bankpay') {
    try {
      const base = (s.site_url || '').replace(/\/$/, '') ||
                   new URL(c.req.url).origin;
      const { id, redirect } = await createBankPayment({
        order, returnUrl: `${base}/pay/bank/return?ref=${order.ref}`,
      });
      await q('update orders set provider_ref = $1 where id = $2', [id, order.id]);
      return c.redirect(redirect);
    } catch (e) {
      console.error('[pay-bank]', e.message);
      await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
              [order.id, 'Pay by bank unavailable', 'Fell back to manual transfer']);
      await q(`update orders set method='bank' where id=$1`, [order.id]);
      return c.redirect(`/order/${order.ref}?e=` +
        encodeURIComponent('Pay by bank was unavailable — use the transfer details below.'));
    }
  }

  return c.redirect('/order/' + order.ref);
});

/* Restart an unfinished bank payment. */
checkoutRoutes.post('/pay/bank/retry', async (c) => {
  const f = await c.req.parseBody();
  const ref = String(f.ref || '').toUpperCase();
  const order = await one('select * from orders where ref = $1', [ref]);
  if (!order || order.status === 'paid') return c.redirect('/order/' + ref);
  const s = await getSettings();
  try {
    const base = (s.site_url || '').replace(/\/$/, '') || new URL(c.req.url).origin;
    const { id, redirect } = await createBankPayment({
      order, returnUrl: `${base}/pay/bank/return?ref=${order.ref}`,
    });
    await q('update orders set provider_ref = $1 where id = $2', [id, order.id]);
    return c.redirect(redirect);
  } catch (e) {
    console.error('[pay-bank retry]', e.message);
    return c.redirect(`/order/${ref}?e=` +
      encodeURIComponent('Could not reach your bank just now. Try again shortly.'));
  }
});

/* Where the bank sends the customer back to. The browser's word is not proof,
   so we ask the provider what really happened before marking anything paid. */
checkoutRoutes.get('/pay/bank/return', async (c) => {
  const ref = String(c.req.query('ref') || '').toUpperCase();
  const order = await one('select * from orders where ref = $1', [ref]);
  if (!order) return c.notFound();

  if (order.status !== 'paid' && order.provider_ref) {
    const st = await bankPaymentStatus(order.provider_ref);
    if (st && (st.settled || st.status === 'executed')) {
      const paid = await one(
        `update orders set status='paid', paid_at=now()
          where id=$1 and status<>'paid' returning *`, [order.id]);
      if (paid) {
        await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
                [order.id, paid.is_deposit ? 'Deposit received' : 'Payment received',
                 'Paid by bank · ' + st.status]);
        const s = await getSettings();
        if (paid.cust_email) {
          sendMailSafe({ to: paid.cust_email, ...templates.paymentConfirmed(paid, s) });
        }
      }
    } else if (st) {
      await q('insert into order_events (order_id, label, detail) values ($1,$2,$3)',
              [order.id, 'Bank payment ' + st.status, '']);
    }
  }
  return c.redirect('/order/' + ref);
});

/* ---------------- order status / tracking ---------------- */
checkoutRoutes.get('/order/:ref', async (c) => {
  const order = await one('select * from orders where ref = $1', [c.req.param('ref').toUpperCase()]);
  if (!order) return c.notFound();
  const s = await getSettings();
  const cust = await customerFrom(readCustomerCookie(c));
  const paid = order.status === 'paid';
  const dispatched = !!order.dispatched_at;

  const events = await many(
    'select * from order_events where order_id = $1 order by created_at', [order.id]);
  const proofs = await many(
    'select * from payment_proofs where order_id = $1 order by created_at desc', [order.id]);

  const when = (d) => new Date(d).toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* Four fixed stages so the buyer always knows where they are. */
  const stages = [
    { key: 'placed', label: 'Order placed', done: true, at: order.created_at },
    { key: 'paid', label: order.is_deposit ? 'Deposit received' : 'Payment received',
      done: paid, at: order.paid_at },
    { key: 'sent', label: order.is_deposit ? 'Ready to collect' : 'Dispatched',
      done: dispatched, at: order.dispatched_at },
    { key: 'done', label: 'Complete', done: dispatched && paid, at: order.dispatched_at },
  ];

  const track = stages.map((st, i) => `
    <li class="${st.done ? 'on' : ''}">
      <span class="dotr" aria-hidden="true">${st.done
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
        : i + 1}</span>
      <div><div class="lb">${esc(st.label)}</div>
        ${st.done && st.at ? `<div class="tm">${when(st.at)}</div>` : '<div class="tm">—</div>'}</div>
    </li>`).join('');

  /* A pay-by-bank order that hasn't settled needs a way back to the bank,
     not a list of account numbers to type. */
  const retryBank = !paid && order.method === 'bankpay';
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
    <p class="eyebrow" style="margin:0 0 9px">Order ${esc(order.ref)}</p>
    <h1 class="display">${dispatched ? 'On its <span class="lit">way</span>'
      : paid ? 'Payment <span class="lit">received</span>'
             : 'Awaiting <span class="lit">payment</span>'}</h1>
    <p>${dispatched
      ? 'It has left us. Tracking is below.'
      : paid ? 'We have your money. We will let you know the moment it ships.'
             : `Send the payment with the reference below. Stock is held for ${esc(s.hold_hours)} hours.`}</p>
  </div>

  ${flashMsg(c)}

  <div class="panel spot" style="margin-bottom:18px">
    <div class="panel-h"><span class="hico" aria-hidden="true">${icon.clock}</span><h3>Progress</h3>
      <span style="margin-left:auto">${statusPill(order)}</span></div>
    <div class="panel-b"><ol class="track">${track}</ol></div>
  </div>

  ${dispatched ? `
  <div class="panel spot" style="margin-bottom:18px">
    <div class="panel-h"><span class="hico" aria-hidden="true">${icon.truck}</span><h3>Tracking</h3></div>
    <div class="panel-b"><div class="rows">
      <div class="row-f"><span class="k">Carrier</span><span class="v big">${esc(order.tracking_carrier || '—')}</span></div>
      <div class="row-f"><span class="k">Tracking number</span><span class="v big trackNo">${esc(order.tracking_number || '—')}</span>
        ${order.tracking_number ? '<button class="copy" type="button" data-copy=".trackNo">Copy</button>' : ''}</div>
    </div></div>
  </div>` : ''}

  ${retryBank ? `
  <div class="panel spot" style="margin-bottom:18px">
    <div class="panel-h"><span class="hico" aria-hidden="true">${icon.bankpay}</span><h3>Pay by bank</h3></div>
    <div class="panel-b">
      <p style="margin:0 0 14px;color:var(--muted);font-size:13.5px">
        We haven't seen this one land yet. If you didn't finish in your banking app,
        pick up where you left off — it confirms itself the moment it clears.</p>
      <form method="post" action="/pay/bank/retry"><input type="hidden" name="ref" value="${esc(order.ref)}">
        <button class="btn" type="submit">${icon.bankpay} Continue in my bank</button></form>
    </div>
  </div>` : ''}

  ${paid || retryBank ? '' : `
  <div class="plate hero">
    <div class="pk">Your payment reference</div>
    <div class="pv refOut">${esc(order.ref)}</div>
    <button class="copy" type="button" data-copy=".refOut">Copy reference</button>
  </div>

  <div class="panel spot" style="margin-bottom:18px">
    <div class="panel-h"><h3>${order.method === 'ppff' ? 'PayPal details' : 'Bank transfer details'}</h3></div>
    <div class="panel-b">
      <div class="rows">
        ${rows.map(([k, v]) => `<div class="row-f"><span class="k">${esc(k)}</span><span class="v big">${esc(v || '—')}</span></div>`).join('')}
      </div>
      ${order.is_deposit ? `<div class="note info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4.5M12 8h.01"/></svg>
        <span>${esc(s.collection_note)}</span></div>` : ''}
      ${order.method === 'ppff' ? `<div class="note stop">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9.5v4M12 17.5h.01"/></svg>
        <span>Friends &amp; Family carries no PayPal buyer protection and can't be reversed.</span></div>` : ''}
    </div>
  </div>

  <div class="panel spot" style="margin-bottom:18px">
    <div class="panel-h"><span class="hico" aria-hidden="true">${icon.camera}</span><h3>Sent it already?</h3></div>
    <div class="panel-b">
      <p style="margin:0 0 14px;color:var(--muted);font-size:13.5px">
        Upload a screenshot of the payment and we'll confirm faster. Keep your own copy too.</p>
      ${proofs.length ? `<div class="proofs">${proofs.map((pr) => `
        <a class="proof" href="/img/${pr.image_id}" target="_blank" rel="noopener">
          <img src="/img/${pr.image_id}" alt="Proof of payment">
          <span>${when(pr.created_at)}</span></a>`).join('')}</div>` : ''}
      <form method="post" action="/order/${esc(order.ref)}/proof" enctype="multipart/form-data">
        <div class="field"><label for="pf">Screenshot</label>
          <input id="pf" name="proof" type="file" accept="image/*" required>
          <div class="hint">Up to 6MB.</div></div>
        <div class="field"><label for="pn">Anything to add <span style="color:var(--ghost);font-weight:400">optional</span></label>
          <input id="pn" name="note" maxlength="200" placeholder="e.g. sent from a different name"></div>
        <button class="btn" type="submit">${icon.camera} Upload proof</button>
      </form>
    </div>
  </div>`}

  <div class="panel spot">
    <div class="panel-h"><h3>Summary</h3></div>
    <div class="panel-b"><div class="rows">
      <div class="row-f"><span class="k">Item</span><span class="v">${esc(order.product_name)} × ${order.qty}</span></div>
      <div class="row-f"><span class="k">Delivery</span><span class="v">${esc(order.delivery_label || '—')}</span></div>
      <div class="row-f"><span class="k">${order.is_deposit ? 'Deposit' : 'Total'}</span><span class="v big">£${money(order.total_p)}</span></div>
    </div>
    ${events.length ? `<div class="hist">${events.map((e) =>
      `<div class="ev"><span class="tm">${when(e.created_at)}</span>
       <span class="lb">${esc(e.label)}</span>
       ${e.detail ? `<span class="dt">${esc(e.detail)}</span>` : ''}</div>`).join('')}</div>` : ''}
    </div>
  </div>

  <p style="text-align:center;margin-top:24px">
    ${cust ? '<a class="btn ghost sm" href="/account">← All your orders</a>'
           : '<a class="btn ghost sm" href="/">← Back to the shop</a>'}
  </p>
</main>`;

  return c.html(layout({ title: `Order ${order.ref}`, body, customer: cust,
                         admin: c.get('admin'), settings: s }));
});

function flashMsg(c) {
  if (c.req.query('ok')) {
    return `<div class="note info" style="margin-bottom:18px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
      <span>Proof uploaded — we'll check it and confirm.</span></div>`;
  }
  const e = c.req.query('e');
  if (!e) return '';
  return `<div class="note warn" style="margin-bottom:18px">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5h.01"/></svg>
    <span>${esc(e)}</span></div>`;
}
