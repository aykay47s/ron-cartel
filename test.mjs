const B = 'http://127.0.0.1:3999';
let pass = 0, fail = 0;
const ok  = (name, cond, extra = '') => { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗', name, extra)); };
const head = (t) => console.log('\n' + t);

let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function go(path, opts = {}) {
  const hdr = cookieHeader();
  const res = await fetch(B + path, {
    redirect: 'manual',
    ...opts,
    headers: { ...(opts.headers || {}), ...(hdr ? { cookie: hdr } : {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    for (const part of sc.split(/,(?=\s*rc_)/)) {
      const [kv] = part.trim().split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v) delete jar[k]; else jar[k] = v;
    }
  }
  const text = res.headers.get('content-type')?.includes('text') ? await res.text() : '';
  return { status: res.status, loc: res.headers.get('location'), text, res };
}
const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});

head('boot + public');
ok('GET / is 200', (await go('/')).status === 200);
ok('empty shop shows the blank state', (await go('/')).text.includes('Nothing listed yet'));
ok('healthz', (await go('/healthz')).text === 'ok');
ok('404 page renders', (await go('/nope')).status === 404);

head('auth gate');
let r = await go('/admin');
ok('/admin redirects to login', r.status === 302 && r.loc.startsWith('/admin/login'), r.loc);
r = await go('/admin/products');
ok('/admin/products is gated too', r.status === 302, r.loc);
r = await go('/admin/setup');
ok('setup page is gone (gated like any admin path)', r.status === 302 && r.loc.startsWith('/admin/login'), r.loc);

head('PIN login');
r = await go('/admin/login', form({ pin: '0000' }));
ok('wrong PIN rejected', r.loc?.includes('Wrong+PIN') || r.loc?.includes('Wrong%20PIN'), r.loc);
r = await go('/admin/login', form({ pin: '9247' }));
ok('seeded PIN 9247 signs in', r.status === 302 && r.loc === '/admin', r.loc);
ok('a session cookie was set', !!jar.rc_sess);
ok('/admin now loads', (await go('/admin')).status === 200);

head('gate really blocks strangers');
const mine = jar.rc_sess; jar = {};
r = await go('/admin');
ok('no cookie -> redirected to login', r.status === 302 && r.loc.startsWith('/admin/login'), r.loc);
jar = { rc_sess: 'deadbeefdeadbeef' };
r = await go('/admin/products');
ok('forged cookie -> redirected to login', r.status === 302 && r.loc.startsWith('/admin/login'));
r = await go('/admin/products', form({ name: 'Sneaky', price: '1' }));
ok('POST without a session cannot create a product', r.status === 302 && r.loc.startsWith('/admin/login'));
jar = { rc_sess: mine };


head('products');
r = await go('/admin/products', form({
  name: 'Grafted Light Bee — 72V', blurb: '72V conversion, fresh 19s',
  body: 'Full rebuild.', price: '2450.00', was: '2800.00', deposit: '250.00',
  status: 'stock', position: '1',
}));
ok('product created', r.status === 302 && r.loc === '/admin/products', r.loc);
r = await go('/');
ok('it shows on the shop', r.text.includes('Grafted Light Bee'));
ok('price rendered as pounds', r.text.includes('£2450.00'));
ok('was-price shown', r.text.includes('£2800.00'));

const idm = (await go('/admin/products')).text.match(/\/admin\/products\/(\d+)"/);
const pid = idm && idm[1];
ok('product id found', !!pid, String(pid));
ok('product page loads', (await go('/p/' + pid)).status === 200);

head('money maths');
r = await go('/checkout?id=' + pid + '&qty=2');
ok('checkout loads', r.status === 200);
ok('subtotal is 2 x 2450', r.text.includes('£4900.00'));

const dm = r.text.match(/data-ship="(\d+)"[^>]*data-price="(\d+)"[^>]*data-collect="0"/);
const shipId = dm && dm[1], shipP = dm && Number(dm[2]);
ok('a paid delivery option exists', !!shipId);

r = await go('/checkout', form({
  id: pid, qty: '2', delivery_id: shipId, method: 'bank',
  cust_name: 'Danny Whyte', cust_email: 'd@example.com',
  cust_phone: '07700900184', address: '14 Everton Road, Manchester',
}));
ok('order posts but bank details are unset, so it bounces', r.loc === '/', r.loc);

head('settings');
r = await go('/admin/settings', form({
  shop_name: 'Ron Cartel', tagline: 'Grafted Sur-Ron builds', contact_email: 'jay@roncartel.co.uk',
  bank_account_name: 'Ron Cartel Ltd', bank_sort: '04-00-75', bank_number: '88213470',
  paypal_address: 'pay@roncartel.co.uk', paypal_note: 'F&F please',
  collection_note: 'Address sent once payment clears', hold_hours: '24',
}));
ok('settings saved', r.status === 302 && r.loc.includes('ok=1'), r.loc);
r = await go('/admin/settings');
ok('sort code persisted', r.text.includes('04-00-75'));
ok('paypal persisted', r.text.includes('pay@roncartel.co.uk'));

head('ordering for real');
r = await go('/checkout', form({
  id: pid, qty: '2', delivery_id: shipId, method: 'bank',
  cust_name: 'Danny Whyte', cust_email: 'd@example.com',
  cust_phone: '07700900184', address: '14 Everton Road, Manchester',
}));
const ref = r.loc?.split('/order/')[1];
ok('order created and redirected', /^\/order\/RC-[A-Z0-9]{6}$/.test(r.loc || ''), r.loc);
r = await go('/order/' + ref);
ok('order page loads', r.status === 200);
const expect = ((2450 * 2 * 100) + shipP) / 100;
ok(`total is £${expect.toFixed(2)} (2×2450 + delivery)`, r.text.includes('£' + expect.toFixed(2)),
   'looking for £' + expect.toFixed(2));
ok('bank details shown', r.text.includes('88213470'));
ok('reference shown', r.text.includes(ref));

head('price tampering is ignored');
r = await go('/checkout', form({
  id: pid, qty: '2', delivery_id: shipId, method: 'bank',
  price: '1', total_p: '1', unit_p: '1', delivery_p: '0',
  cust_name: 'Cheeky', cust_email: 'c@example.com', address: 'x',
}));
const ref2 = r.loc?.split('/order/')[1];
r = await go('/order/' + ref2);
ok('server ignored the forged price', r.text.includes('£' + expect.toFixed(2)));

head('collection = deposit only');
const cm = (await go('/checkout?id=' + pid)).text.match(/data-ship="(\d+)"[^>]*data-price="\d+"[^>]*data-collect="1"/);
ok('collection option exists', !!cm);
r = await go('/checkout', form({
  id: pid, qty: '1', delivery_id: cm[1], method: 'bank',
  cust_name: 'Leon', cust_email: 'l@example.com', address: 'Manchester',
}));
const ref3 = r.loc?.split('/order/')[1];
r = await go('/order/' + ref3);
ok('charges the £250 deposit, not £2450', r.text.includes('£250.00') && !r.text.includes('£2450.00'));
ok('collection note shown', r.text.includes('Address sent once payment clears'));

head('order lifecycle');
r = await go('/admin');
ok('orders listed in admin', r.text.includes(ref));
ok('awaiting count is 3', r.text.includes('>3</div>'));
await go(`/admin/orders/${ref}/paid`, form({}));
r = await go('/order/' + ref);
ok('customer sees it confirmed', r.text.includes('Payment') && r.text.includes('received'));
r = await go('/admin?q=' + ref);
ok('search finds it', r.text.includes(ref));
await go(`/admin/orders/${ref}/unpaid`, form({}));
r = await go('/order/' + ref);
ok('undo puts it back to awaiting', r.text.includes('Awaiting'));

head('sold items cannot be bought');
await go('/admin/products', form({
  id: pid, name: 'Grafted Light Bee — 72V', price: '2450.00', status: 'sold', position: '1',
}));
ok('checkout refuses a sold item', (await go('/checkout?id=' + pid)).status === 404);
r = await go('/checkout', form({ id: pid, qty: '1', delivery_id: shipId, method: 'bank',
  cust_name: 'x', cust_email: 'x@y.z', address: 'x' }));
ok('POST refuses a sold item', r.loc === '/');
r = await go('/');
ok('shop greys it out', r.text.includes('gone') && r.text.includes('Sold'));

head('changing the PIN');
r = await go('/admin/pin', form({ pin: '778899' }));
ok('PIN change signs you out', r.status === 302 && r.loc.startsWith('/admin/login'), r.loc);
jar = {};
r = await go('/admin/login', form({ pin: '9247' }));
ok('old PIN no longer works', r.loc?.includes('Wrong'), r.loc);
r = await go('/admin/login', form({ pin: '778899' }));
ok('new PIN works', r.status === 302 && r.loc === '/admin', r.loc);

head('logout');
await go('/admin/logout', form({}));
r = await go('/admin');
ok('session is dead after logout', r.status === 302 && r.loc.startsWith('/admin/login'), r.loc);

head('customer accounts');
jar = {};
r = await go('/signup', form({ name:'Danny Whyte', email:'danny@example.com',
  password:'hunter2hunter2', phone:'07700900184', address:'14 Somewhere Rd, Manchester' }));
ok('signup creates an account and signs in', r.status === 302 && r.loc === '/account', r.loc);
ok('/account loads', (await go('/account')).status === 200);
r = await go('/signup', form({ name:'x', email:'danny@example.com', password:'hunter2hunter2' }));
ok('duplicate email refused', r.loc?.includes('already'), r.loc);

head('ordering while signed in');
var ownerCookie;
{                                   // stock a fresh item as the shop owner
  const keepCust = jar.rc_cust; jar = {};
  await go('/admin/login', form({ pin: '778899' }));
  ownerCookie = jar.rc_sess;        // reuse it later — re-logging in trips the throttle
  await go('/admin/products', form({
    name: 'Grafted Light Bee — 60V', blurb: 'Clean build',
    price: '1740.00', status: 'stock', position: '2',
  }));
  jar = { rc_cust: keepCust };
}
r = await go('/');
const pm = r.text.match(/href="\/p\/(\d+)"/);
ok('a buyable product is on the shop', !!pm);
if (pm) {
  const ship2 = (await go('/checkout?id=' + pm[1])).text
    .match(/data-ship="(\d+)"[^>]*data-price="\d+"[^>]*data-collect="0"/);
  r = await go('/checkout', form({ id: pm[1], qty:'1', delivery_id: ship2[1], method:'bank',
    cust_name:'Danny Whyte', cust_email:'danny@example.com', address:'14 Somewhere Rd' }));
  const myRef = r.loc?.split('/order/')[1];
  ok('order created while signed in', /^RC-/.test(myRef || ''), r.loc);
  r = await go('/account');
  ok('it appears in my orders', r.text.includes(myRef), myRef);
  r = await go('/order/' + myRef);
  ok('order page shows the progress rail', r.text.includes('class="track"'));
  ok('proof upload form is offered', r.text.includes('name="proof"'));
  ok('shows awaiting', r.text.includes('Awaiting'));

  head('tracking without an account');
  const custCookie = jar.rc_cust; jar = {};
  r = await go('/track/go?ref=' + myRef.toLowerCase());
  ok('lookup is case-insensitive', r.status === 302 && r.loc === '/order/' + myRef, r.loc);
  r = await go('/track/go?ref=RC-NOPE99');
  ok('unknown reference is refused', r.loc?.includes('No+order') || r.loc?.includes('No%20order'), r.loc);

  head('dispatch');
  jar = { rc_sess: ownerCookie };
  r = await go('/admin/orders/' + myRef);
  ok('admin order page loads', r.status === 200, 'got ' + r.status + ' ' + (r.loc || ''));
  ok('customer address shown to the shop', r.text.includes('14 Somewhere Rd'));
  await go(`/admin/orders/${myRef}/paid`, form({}));
  r = await go(`/admin/orders/${myRef}/dispatch`, form({ carrier:'Royal Mail', tracking:'AB123456789GB' }));
  ok('dispatch saved (not bounced to login)',
     r.status === 302 && r.loc === `/admin/orders/${myRef}`, r.loc);
  jar = { rc_cust: custCookie };
  r = await go('/order/' + myRef);
  ok('buyer sees the tracking number', r.text.includes('AB123456789GB'));
  ok('buyer sees it dispatched', r.text.includes('Dispatched'));
  ok('history recorded the steps', r.text.includes('Order placed') && r.text.includes('Payment received'));
}

head('login throttle');
jar = {};
let blocked = false;
for (let i = 0; i < 8; i++) {
  const rr = await go('/admin/login', form({ pin: '0000' }));
  if (rr.loc?.includes('Too+many') || rr.loc?.includes('Too%20many')) { blocked = true; break; }
}
ok('repeated wrong PINs get locked out', blocked);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
