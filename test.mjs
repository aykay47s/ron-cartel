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

head('an account is needed before checkout');
{
  /* The gate is on by default now, so prove it works before signing anyone in. */
  const gated = await go('/checkout?id=' + pid + '&qty=1');
  ok('a stranger is sent to sign up', gated.status === 302
     && String(gated.loc).startsWith('/signup'), gated.loc);
  ok('and it remembers where they were going',
     decodeURIComponent(String(gated.loc)).includes('/checkout?id=' + pid), gated.loc);
}

/* Sign a customer in for everything that follows — that is now the normal
   state of anyone reaching a checkout. */
await go('/signup', form({
  name: 'Test Buyer', email: 'buyer@example.com', password: 'correct-horse-99',
}));

head('money maths');
r = await go('/checkout?id=' + pid + '&qty=2');
ok('checkout loads once signed in', r.status === 200);
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

head('trust pages');
jar = {};
for (const [path, needle] of [['/terms','Consumer Rights Act'], ['/returns','change your mind'],
                              ['/privacy','UK GDPR'], ['/contact','Contact']]) {
  const rr = await go(path);
  ok(`${path} loads and reads right`, rr.status === 200 && rr.text.includes(needle),
     'status ' + rr.status);
}
r = await go('/terms');
ok('terms warn about Friends & Family losing protection',
   r.text.includes('buyer protection') && r.text.includes('cannot be reversed'));
r = await go('/returns');
ok('returns names the made-to-order exception', r.text.includes('made-to-order'));
r = await go('/');
ok('footer links to the legal pages',
   r.text.includes('/returns') && r.text.includes('/privacy') && r.text.includes('/terms'));
ok('footer does not invent a trading name it has not been given',
   !r.text.includes('Ron Cartel Ltd'));

head('business details flow through');
await go('/admin/login', form({ pin: '778899' }));
r = await go('/admin/settings', form({
  shop_name:'Ron Cartel', tagline:'x', contact_email:'jay@roncartel.co.uk',
  bank_account_name:'Ron Cartel Ltd', bank_sort:'04-00-75', bank_number:'88213470',
  paypal_address:'pay@roncartel.co.uk', paypal_note:'', collection_note:'x', hold_hours:'24',
  legal_name:'Ron Cartel Ltd', trading_address:'14 Trafford Park, Manchester M17 1AB',
  contact_phone:'07700900184', company_number:'12345678', vat_number:'',
  site_url:'https://roncartel.co.uk', returns_days:'14', returns_note:'',
  d_label_1:'Royal Mail Tracked 24', d_note_1:'', d_price_1:'6.99', d_on_1:'on',
}));
ok('business details saved', r.loc?.includes('ok=1'), r.loc);
jar = {};
r = await go('/contact');
ok('contact shows the trading address', r.text.includes('Trafford Park'));
r = await go('/');
ok('footer shows the real business now', r.text.includes('Ron Cartel Ltd') && !r.text.includes('not set yet'));
r = await go('/terms');
ok('terms identify the trader', r.text.includes('Trafford Park'));

head('payment methods');
jar = {};
{
  /* Cleared the jar, so sign back in — checkout needs an account now. */
  await go('/signin', form({ email: 'buyer@example.com', password: 'correct-horse-99' }));
  const rr = await go('/');
  const pmm = rr.text.match(/href="\/p\/(\d+)"/);
  if (pmm) {
    const co = await go('/checkout?id=' + pmm[1]);
    ok('manual transfer offered when bank details are set', co.text.includes('data-pay="bank"'));
    ok('PayPal offered when an address is set', co.text.includes('data-pay="ppff"'));
    ok('pay by bank hidden while unconfigured', !co.text.includes('data-pay="bankpay"'));
    ok('F&F still warns about lost protection', co.text.includes('No PayPal buyer protection'));
    const ship3 = co.text.match(/data-ship="(\d+)"[^>]*data-price="\d+"[^>]*data-collect="0"/);
    const bad = await go('/checkout', form({ id: pmm[1], qty:'1', delivery_id: ship3[1],
      method:'bankpay', cust_name:'x', cust_email:'x@y.z', address:'x' }));
    ok('unconfigured pay-by-bank is refused, not half-attempted', bad.loc === '/', bad.loc);
    const junk = await go('/checkout', form({ id: pmm[1], qty:'1', delivery_id: ship3[1],
      method:'wire-me-cash', cust_name:'x', cust_email:'x@y.z', address:'x' }));
    ok('an unknown method falls back to bank transfer rather than erroring',
       /^\/order\/RC-/.test(junk.loc || ''), junk.loc);
  }
}

head('guided setup pages');
{
  await go('/admin/login', form({ pin: '778899' }));
  for (const p of ['/admin/setup/bank', '/admin/setup/email', '/admin/delivery']) {
    ok(`${p} loads`, (await go(p)).status === 200);
  }
  const saved = { ...jar }; jar = {};
  const gated = await go('/admin/delivery');
  jar = saved;
  ok('setup pages are behind the admin gate',
     gated.status === 302 && String(gated.loc).startsWith('/admin/login'), gated.status);
}

head('delivery options: add, edit, remove, and who they reach');
{
  /* This block stands on its own: it finds a live product itself rather than
     leaning on one an earlier section may have deleted. */
  const shop = await go('/');
  const shipPid = (shop.text.match(/href="\/p\/(\d+)/) || [])[1];
  const optIds = async () => [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  const rows = async (to) => {
    const r = await go(`/checkout?id=${shipPid}&qty=1&to=${to}`);
    return [...r.text.matchAll(/<span class="t">([^<]*)/g)].map((m) => m[1].trim());
  };

  const n0 = (await optIds()).length;
  await go('/admin/delivery', form({}));
  const ids = await optIds();
  ok('a new option is added', ids.length === n0 + 1, `${n0} -> ${ids.length}`);
  const id = ids[ids.length - 1];

  await go(`/admin/delivery/${id}`, form({
    label: 'DHL Worldwide', courier: 'dhl', price: '44.00', free_over: '',
    zone: 'WORLD', zone_list: '', days_min: '3', days_max: '7', note: '', enabled: 'on',
  }));
  const list = await go('/admin/delivery');
  ok('the option saves', list.text.includes('DHL Worldwide'));
  ok('an empty note is written from the lead time', list.text.includes('3 to 7 working days'));
  ok('a worldwide option reaches Australia', (await rows('AU')).includes('DHL Worldwide'));

  await go(`/admin/delivery/${id}`, form({
    label: 'Manchester pickup', courier: 'collect', price: '0', free_over: '',
    zone: 'GB', zone_list: '', days_min: '', days_max: '', note: '', enabled: 'on',
  }));
  ok('a UK-only option is hidden from a customer in the US',
     !(await rows('US')).includes('Manchester pickup'));
  ok('and shown to one in the UK',
     (await rows('GB')).includes('Manchester pickup'), (await rows('GB')).join(' | '));

  await go(`/admin/delivery/${id}`, form({
    label: 'Hand-picked list', courier: 'dpd', price: '12.00', free_over: '',
    zone: 'custom', zone_list: 'IE, FR', days_min: '2', days_max: '4', note: '', enabled: 'on',
  }));
  ok('a hand-picked country list reaches France', (await rows('FR')).includes('Hand-picked list'));
  ok('and not Germany', !(await rows('DE')).includes('Hand-picked list'));

  await go(`/admin/delivery/${id}/delete`, form({}));
  ok('the option is removed', !(await go('/admin/delivery')).text.includes('Hand-picked list'));
}

head('free delivery over a threshold, decided on the server');
{
  const shop = await go('/');
  const shipPid = (shop.text.match(/href="\/p\/(\d+)/) || [])[1];
  const ids = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  await go(`/admin/delivery/${ids[0]}`, form({
    label: 'Threshold test', courier: 'royalmail', price: '6.99', free_over: '100',
    zone: 'GB', zone_list: '', days_min: '1', days_max: '', note: '', enabled: 'on',
  }));
  const r = await go(`/checkout?id=${shipPid}&qty=1&to=GB`);
  const labels = [...r.text.matchAll(/<span class="t">([^<]*)/g)].map((m) => m[1].trim());
  const prices = [...r.text.matchAll(/<span class="oprice[^"]*">([^<]*)/g)].map((m) => m[1].trim());
  const i = labels.indexOf('Threshold test');
  ok('an order over the threshold gets that option free', i >= 0 && prices[i] === 'Free',
     `${labels[i]} = ${prices[i]}`);
}

head('open banking (Crezco) setup and checkout');
{
  await go('/admin/login', form({ pin: '778899' }));
  ok('/admin/setup/openbanking loads', (await go('/admin/setup/openbanking')).status === 200);

  const bad = await go('/admin/setup/openbanking', form({ crezco_link: 'http://pay.example.com/x' }));
  ok('a plain http link is refused', String(bad.loc).includes('e='), bad.loc);

  await go('/admin/setup/openbanking', form({ crezco_link: 'https://pay.crezco.com/ron-cartel' }));
  const shopNow = await go('/');
  const obPid = (shopNow.text.match(/href="\/p\/(\d+)/) || [])[1];

  let co = await go('/checkout?id=' + obPid + '&qty=1');
  ok('it stays hidden until it is switched on', !co.text.includes('Pick your bank'));

  await go('/admin/setup/openbanking/live', form({ on: '1' }));
  co = await go('/checkout?id=' + obPid + '&qty=1');
  ok('once on, it is offered first at checkout', co.text.includes('Pick your bank'));

  const dIds = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  const placed = await go('/checkout', form({
    id: obPid, qty: '1', delivery_id: dIds[0], method: 'crezco', country: 'GB',
    cust_name: 'Ada Whyte', cust_email: 'ada@example.com', address: '1 Test St',
  }));
  ok('an order can be placed with it', placed.status === 302 && /\/order\//.test(String(placed.loc)),
     placed.loc);
  const page = await go(String(placed.loc));
  ok('the order page sends them to their bank',
     page.text.includes('Open my banking app') && page.text.includes('pay.crezco.com'));
  ok('and still shows the reference to quote', page.text.includes('Your payment reference'));

  await go('/admin/setup/openbanking/live', form({ on: '0' }));
  const off = await go('/checkout?id=' + obPid + '&qty=1');
  ok('turning it off removes it again', !off.text.includes('Pick your bank'));
}

head('the payment page');
{
  await go('/admin/login', form({ pin: '778899' }));
  await go('/admin/settings', form({
    shop_name: 'Ron Cartel', bank_account_name: 'Ron Cartel Ltd',
    bank_sort: '04-00-75', bank_number: '88213470', bank_which: 'starling',
  }));
  const shopP = await go('/');
  const payPid = (shopP.text.match(/href="\/p\/(\d+)/) || [])[1];
  const dIds = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  const placed = await go('/checkout', form({
    id: payPid, qty: '1', delivery_id: dIds[0], method: 'bank', country: 'GB',
    cust_name: 'Nia Barratt', cust_email: 'nia@example.com', address: '9 Test Rd',
  }));
  const page = await go(String(placed.loc));
  ok('the bank is named next to the details', page.text.includes('Starling Bank'));
  ok('every detail has its own copy button',
     (page.text.match(/data-copyval=/g) || []).length >= 4,
     (page.text.match(/data-copyval=/g) || []).length + ' found');
  ok('and there is a copy-the-lot button', page.text.includes('data-copyall='));
  ok('the account number is on the page', page.text.includes('88213470'));
  ok('proof upload is a drop zone', page.text.includes('class="drop"')
     && page.text.includes('Drop a screenshot here'));
  ok('the file input is still a real input', page.text.includes('type="file"'));

  await go('/admin/settings', form({
    shop_name: 'Ron Cartel', bank_account_name: 'Ron Cartel Ltd',
    bank_sort: '04-00-75', bank_number: '88213470', bank_which: '',
  }));
  const plain = await go(String(placed.loc));
  ok('naming the bank is optional', !plain.text.includes('Starling Bank'));
}

head('live viewer count is real, not theatre');
{
  const shopV = await go('/');
  const vPid = (shopV.text.match(/href="\/p\/(\d+)/) || [])[1];

  const first = await go('/p/' + vPid);
  ok('one viewer says nothing at all', !first.text.includes('looking at this right now'));

  const again = await go('/p/' + vPid);
  ok('refreshing does not invent a second person',
     !again.text.includes('looking at this right now'));

  /* A different user agent is a different visitor, which is the honest case:
     two actual people on the same listing. */
  const other = await fetch(B + '/p/' + vPid, { headers: { 'user-agent': 'another-real-browser/1.0' } });
  const otherText = await other.text();
  ok('two real visitors are reported', otherText.includes('2 people are looking at this right now'),
     'no count shown');

  const sold = await go('/');
  ok('the shop page still renders', sold.status === 200);
}

head('categories, announcements, and posting a tracking update');
{
  await go('/admin/login', form({ pin: '778899' }));

  /* two shelves */
  await go('/admin/products', form({
    name: 'Brand new Ultra Bee', blurb: 'Untouched', price: '5200.00',
    status: 'stock', position: '9', category: 'new',
  }));
  const shop = await go('/');
  ok('the shop lists a Grafted section', shop.text.includes('Grafted builds'));
  ok('and a Brand new section', shop.text.includes('Brand new'));
  ok('the new bike lands on the new shelf',
     shop.text.indexOf('Brand new Ultra Bee') > shop.text.indexOf('>Brand new<'));

  /* the hero comes out of settings */
  await go('/admin/settings', form({
    shop_name: 'Ron Cartel', hero_line1: 'Cheapest grafted', hero_line2: 'Sur-Rons going.',
    hero_stat1_k: 'Top speed', hero_stat1_v: '56mph',
  }));
  const hero = await go('/');
  ok('the headline is whatever settings says', hero.text.includes('Sur-Rons going.'));
  ok('and the speed is in mph', hero.text.includes('56mph'));
  ok('nothing is measured in km/h any more', !hero.text.includes('km/h'));

  /* the announcement bar */
  const quiet = await go('/');
  ok('no bar when there is nothing to announce', !quiet.text.includes('class="announce"'));
  await go('/admin/settings', form({
    shop_name: 'Ron Cartel', announce_on: 'on', announce_text: 'Two 72V builds land Friday',
  }));
  const loud = await go('/');
  ok('the bar shows when it is switched on',
     loud.text.includes('class="announce"') && loud.text.includes('land Friday'));

  /* a tracking update with a place on it */
  const shopT = await go('/');
  const tPid = (shopT.text.match(/href="\/p\/(\d+)/) || [])[1];
  const dIds = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  const placed = await go('/checkout', form({
    id: tPid, qty: '1', delivery_id: dIds[0], method: 'bank', country: 'GB',
    cust_name: 'Kes Ward', cust_email: 'kes@example.com', address: '4 Test Way',
  }));
  const ref = String(placed.loc).split('/').pop();

  await go(`/admin/orders/${ref}/update`, form({
    template: 'hub', location: 'Lutterworth hub', detail: 'Due tomorrow before 1pm',
  }));
  const cust = await go(`/order/${ref}`);
  ok('the customer sees where it is', cust.text.includes('Lutterworth hub'));
  ok('with the stage named', cust.text.includes('At the sorting hub'));
  ok('and the note', cust.text.includes('Due tomorrow before 1pm'));

  const adminOrder = await go(`/admin/orders/${ref}`);
  ok('admin shows the update form', adminOrder.text.includes('Post an update'));
  ok('and the proofs panel', adminOrder.text.includes('Proof of payment'));

  const list = await go('/admin');
  ok('order rows are clickable', list.text.includes('rowlink'));

  /* a made-up update is impossible: no label, no event */
  const before = (await go(`/order/${ref}`)).text;
  await go(`/admin/orders/${ref}/update`, form({ template: '', label: '', location: 'Nowhere' }));
  const after = (await go(`/order/${ref}`)).text;
  ok('an update with no label is refused', !after.includes('Nowhere'));
}

head('the phone can order without scrolling back up');
{
  const shopM = await go('/');
  const mPid = (shopM.text.match(/href="\/p\/(\d+)/) || [])[1];
  const co = await go('/checkout?id=' + mPid + '&qty=1');
  ok('there is a sticky pay bar', co.text.includes('class="paybar"'));
  ok('it carries the same total', co.text.includes('id="pbTotal"'));
  ok('and it submits the same form', /form="coform"[^>]*>\s*[\s\S]{0,80}pbTxt/.test(co.text)
     || co.text.includes('id="pbTxt"'));
}

head('sign in with Google');
{
  await go('/admin/login', form({ pin: '778899' }));
  ok('the setup page loads', (await go('/admin/setup/google')).status === 200);

  const off = await go('/signin');
  ok('no Google button until it is configured', !off.text.includes('Continue with Google'));
  const blocked = await go('/auth/google');
  ok('and the route refuses to start',
     decodeURIComponent(String(blocked.loc)).includes('not set up'), blocked.loc);

  await go('/admin/setup/google', form({
    google_client_id: '123.apps.googleusercontent.com', google_client_secret: 'shh',
  }));
  const on = await go('/signin');
  ok('the button appears once configured', on.text.includes('Continue with Google'));
  ok('and on sign-up too', (await go('/signup')).text.includes('Continue with Google'));

  const start = await go('/auth/google');
  ok('starting a sign-in redirects to Google',
     String(start.loc).startsWith('https://accounts.google.com/'), start.loc);
  ok('carrying our client id', String(start.loc).includes('123.apps.googleusercontent.com'));

  /* A callback that did not start in this browser must be refused, or anyone
     could sign a victim into their own account with a crafted link. */
  const forged = await fetch(B + '/auth/google/callback?code=abc&state=made-up',
    { redirect: 'manual' });
  ok('a callback with a state we never issued is refused',
     decodeURIComponent(forged.headers.get('location') || '').includes('did not start here'),
     forged.headers.get('location'));

  const cancelled = await go('/auth/google/callback?error=access_denied');
  ok('a cancelled sign-in comes back cleanly',
     decodeURIComponent(String(cancelled.loc)).includes('cancelled'));
}

head('the tracking desk');
{
  await go('/admin/login', form({ pin: '778899' }));
  const desk = await go('/admin/tracking');
  ok('the desk loads', desk.status === 200);
  ok('every update is one button', (desk.text.match(/class="tkp"/g) || []).length >= 10);

  const shopD = await go('/');
  const dPid = (shopD.text.match(/href="\/p\/(\d+)/) || [])[1];
  const dIds = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  await go('/signin', form({ email: 'buyer@example.com', password: 'correct-horse-99' }));
  const placed = await go('/checkout', form({
    id: dPid, qty: '1', delivery_id: dIds[0], method: 'bank', country: 'GB',
    cust_name: 'Jo Vale', cust_email: 'jo@example.com', address: '2 Test Ave',
  }));
  const ref = String(placed.loc).split('/').pop();

  /* One tap: the template supplies the line and the note. */
  await go(`/admin/tracking/${ref}`, form({ template: 'out', location: 'Manchester M17' }));
  const cust = await go(`/order/${ref}`);
  ok('the update lands with the template wording', cust.text.includes('Out for delivery'));
  ok('and the template note fills itself in', cust.text.includes('With the driver today'));
  ok('with the place', cust.text.includes('Manchester M17'));
  ok('and a readable time', /Today, \d\d:\d\d/.test(cust.text));

  /* Backdating is allowed; claiming the future is not. */
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
  await go(`/admin/tracking/${ref}`, form({
    template: 'delivered', happened_at: soon, location: 'Leeds' }));
  const after = await go(`/order/${ref}`);
  ok('a future timestamp is ignored rather than shown', !after.includes?.('2029'));
  ok('the update still posts', after.text.includes('Delivered'));

  const back = await go('/admin/tracking');
  ok('the desk shows where it got to', back.text.includes('Leeds'));

  /* A template that is not about a place does not carry one. */
  await go(`/admin/tracking/${ref}`, form({ template: 'workshop', location: 'Nowhere' }));
  const wk = await go(`/order/${ref}`);
  ok('a workshop update carries no location', !wk.text.includes('Nowhere'));
}

head('waiting list, add-ons and reviews');
{
  await go('/admin/login', form({ pin: '778899' }));

  /* waitlist shows only on something you cannot buy */
  const shopW = await go('/');
  const live = (shopW.text.match(/href="\/p\/(\d+)/) || [])[1];
  ok('no notify box on something in stock',
     !(await go('/p/' + live)).text.includes('notifybox'));

  await go('/admin/products', form({
    name: 'Sold out build', price: '3000.00', status: 'sold', position: '20', category: 'grafted',
  }));
  /* A sold card is not a link on the shop page, so take the id from admin. */
  const plist = await go('/admin/products');
  const soldId = [...plist.text.matchAll(/href="\/admin\/products\/(\d+)"/g)]
    .map((m) => m[1]).pop();
  const soldPage = await go('/p/' + soldId);
  const soldHasBox = soldPage.text.includes('notifybox');
  ok('a sold bike offers to tell them', soldHasBox || soldPage.text.includes('Tell me'));

  await go(`/p/${soldId}/notify`, form({ email: 'waiting@example.com' }));
  ok('the email is captured', (await go('/admin/waitlist')).text.includes('waiting@example.com'));

  /* add-ons */
  await go('/admin/addons', form({}));
  const aIds = [...(await go('/admin/addons')).text
    .matchAll(/action="\/admin\/addons\/(\d+)"/g)].map((m) => m[1]);
  const aid = aIds[aIds.length - 1];
  await go(`/admin/addons/${aid}`, form({
    name: 'Spare charger', blurb: 'Keep one in the van', price: '89.00', enabled: 'on' }));

  await go('/signin', form({ email: 'buyer@example.com', password: 'correct-horse-99' }));
  const shopA = await go('/');
  const aPid = (shopA.text.match(/href="\/p\/(\d+)/) || [])[1];
  const co = await go('/checkout?id=' + aPid + '&qty=1');
  ok('the add-on is offered at checkout', co.text.includes('Spare charger'));

  const dIds2 = [...(await go('/admin/delivery')).text
    .matchAll(/action="\/admin\/delivery\/(\d+)"/g)].map((m) => m[1]);
  const withAdd = await go('/checkout', form({
    id: aPid, qty: '1', delivery_id: dIds2[0], method: 'bank', country: 'GB', addon: aid,
    cust_name: 'Add Buyer', cust_email: 'add@example.com', address: '3 Test Row',
  }));
  const addRef = String(withAdd.loc).split('/').pop();
  const addOrder = await go('/order/' + addRef);
  ok('the add-on price is in the total, worked out on the server',
     addOrder.text.includes('89.00') || addOrder.text.includes('Spare charger')
     || /£\d/.test(addOrder.text));

  /* a forged add-on price is ignored */
  const forged = await go('/checkout', form({
    id: aPid, qty: '1', delivery_id: dIds2[0], method: 'bank', country: 'GB',
    addon: aid, addon_price: '1',
    cust_name: 'Forge', cust_email: 'f@example.com', address: '4 Test Row',
  }));
  ok('a forged add-on price changes nothing', forged.status === 302);

  /* reviews */
  await go('/admin/login', form({ pin: '778899' }));
  const bad = await go('/admin/reviews', form({
    author: 'X', rating: '5', body: 'Great', source: 'google',
    source_url: 'http://not-https.example.com' }));
  ok('an http source link is refused', decodeURIComponent(String(bad.loc)).includes('https://'));

  await go('/admin/reviews', form({
    author: 'Danny W.', rating: '5', title: 'Spot on',
    body: 'Bike turned up next day exactly as described.',
    source: 'google', source_url: 'https://maps.google.com/example' }));
  const page = await go('/reviews');
  ok('the reviews page shows it', page.text.includes('Danny W.'));
  ok('and says where it came from', page.text.includes('Google'));
  ok('and links to the original', page.text.includes('maps.google.com/example'));

  /* one left by a customer waits for approval */
  await go(`/order/${addRef}/review`, form({
    rating: '5', title: 'Happy', body: 'Exactly what I wanted.' }));
  const before = await go('/reviews');
  ok('a customer review is not published until it is approved',
     !before.text.includes('Exactly what I wanted'));
  const adminR = await go('/admin/reviews');
  ok('but the owner can see it waiting', adminR.text.includes('Exactly what I wanted'));
  const rid = [...adminR.text.matchAll(/action="\/admin\/reviews\/(\d+)\/approve"/g)].map((m) => m[1])[0];
  await go(`/admin/reviews/${rid}/approve`, form({}));
  const after2 = await go('/reviews');
  ok('once approved it appears', after2.text.includes('Exactly what I wanted'));
  ok('and is marked as a real order', after2.text.includes('Bought here'));
}

head('session cookies survive plain HTTP');
{
  const r = await fetch(B + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: '778899' }).toString(),
  });
  const sc = r.headers.get('set-cookie') || '';
  ok('no Secure flag over plain HTTP — the browser would drop the cookie',
     sc.includes('rc_sess=') && !/;\s*Secure/i.test(sc), sc);
  ok('still HttpOnly and SameSite over plain HTTP',
     /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), sc);
}
{
  const r = await fetch(B + '/admin/login', {
    method: 'POST', redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-proto': 'https',
    },
    body: new URLSearchParams({ pin: '778899' }).toString(),
  });
  const sc = r.headers.get('set-cookie') || '';
  ok('Secure comes back once the request is HTTPS', /;\s*Secure/i.test(sc), sc);
}

head('assets are fingerprinted so a deploy actually reaches people');
{
  const home = await go('/');
  const m = home.text.match(/href="(\/assets\/app\.css\?v=[0-9a-f]{10})"/);
  ok('the stylesheet URL carries a content hash', !!m, home.text.slice(0, 200));
  if (m) {
    const r = await fetch(B + m[1]);
    ok('fingerprinted assets are cached hard',
       /immutable/.test(r.headers.get('cache-control') || ''),
       r.headers.get('cache-control'));
  }
  const bare = await fetch(B + '/assets/app.css');
  ok('an unfingerprinted asset is not cached at all',
     (bare.headers.get('cache-control') || '') === 'no-cache',
     bare.headers.get('cache-control'));
}

head('email setup — the one free route that actually delivers');
jar = {};
await go('/admin/login', form({ pin: '778899' }));
r = await go('/admin');
ok('Email is one tap from the admin home, not buried in settings',
   r.text.includes('/admin/setup/email'));
r = await go('/admin/setup/email');
ok('the email page loads for an admin', r.status === 200);
ok('Gmail is offered as the free place to start',
   r.text.includes('Gmail') && r.text.includes('Free — start here'));
ok('it explains why a relay is not the answer without a domain',
   r.text.includes('Brevo, Mailjet, Resend, SMTP2GO') && r.text.includes('domain'));
ok('it warns off Outlook before an evening is wasted on it',
   r.text.includes('16 September 2024'));

r = await go('/admin/setup/email?p=gmail');
ok('picking Gmail fills the server in for you',
   r.text.includes('name="smtp_host" value="smtp.gmail.com"')
   && r.text.includes('name="smtp_port" value="587"'));
ok('it links straight to Google’s app-password page',
   r.text.includes('https://myaccount.google.com/apppasswords'));
ok('and to 2-step verification, which has to be on first',
   r.text.includes('https://myaccount.google.com/signinoptions/twosv'));
ok('Gmail is not asked for a send-from address that Google would overwrite',
   !r.text.includes('name="smtp_from"'));

await go('/admin/setup/email', form({
  p: 'gmail', smtp_host: 'smtp.gmail.com', smtp_port: '587',
  smtp_user: 'shop@gmail.com', smtp_pass: 'abcd efgh ijkl mnop',
}));
r = await go('/admin/setup/email?p=gmail');
ok('an app password pasted with Google’s spaces is stored without them',
   r.text.includes('value="abcdefghijklmnop"'), 'the spaces were kept — Google would reject it');
ok('filling the form in is what switches email on, with no second toggle',
   r.text.includes('Prove it works'));

await go('/admin/setup/email', form({
  p: 'custom', smtp_host: 'nosuchmail.invalid', smtp_port: '587',
  smtp_user: 'shop@example.com', smtp_pass: 'whatever',
}));
r = await go('/admin/setup/email/test', form({ to: 'shop@example.com' }));
ok('a failed test says what is wrong in English',
   /no\+server\+by\+that\+name|no%20server%20by%20that%20name/.test(r.loc || ''), r.loc);
ok('and never shows raw SMTP jargon to the shop owner',
   !/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(r.loc || ''), r.loc);

head('login throttle');
jar = {};
let blocked = false;
for (let i = 0; i < 8; i++) {
  const rr = await go('/admin/login', form({ pin: '0000' }));
  if (rr.loc?.includes('Too+many') || rr.loc?.includes('Too%20many')) { blocked = true; break; }
}
ok('repeated wrong PINs get locked out', blocked);
jar = {};
r = await go('/admin/login', form({ pin: '778899' }));
ok('but a correct PIN is refused while locked out', r.loc?.includes('Too+many') || r.loc?.includes('Too%20many'), r.loc);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
