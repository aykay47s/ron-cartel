import { asset } from './assets.js';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Money lives in the database as integer pence and is only ever formatted
   for display, so nothing rounds badly on the way through. */
export const money = (p) => (Number(p || 0) / 100).toFixed(2);
export const pence = (s) => {
  const n = Math.round(parseFloat(String(s).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return 'RC-' + s;
}

export const icon = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  upload: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7.5 9.5L12 5l4.5 4.5M12 5v12"/></svg>',
  chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  /* courier marks — drawn here, not fetched. Carrier logos are trademarks;
     a glyph plus the carrier's name in type says the same thing honestly. */
  post: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2.6 6.6L12 13l9.4-6.4"/></svg>',
  van: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5h12v11H1z"/><path d="M13 9h4.5l3.5 3.6V16h-8z"/><circle cx="5" cy="18.5" r="2.2"/><circle cx="17.5" cy="18.5" r="2.2"/></svg>',
  plane: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.2 13.8L2 11.4l1-2 7.6 1L15 4.6a2 2 0 013 2.6l-3.6 5.4 1.2 7.4-2 1z"/></svg>',
  pallet: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="10" rx="1"/><path d="M2 17h20M4 17v4M20 17v4M12 17v4"/></svg>',
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.4 7-12a7 7 0 10-14 0c0 5.6 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  globe: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18"/></svg>',
  mail: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2.5 6.5L12 13l9.5-6.5"/></svg>',
  spark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13H11l-1 9 8.5-11H12z"/></svg>',
  bag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 01-8 0"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  tick: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  bin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  bank: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 9.4L12 3.6l9.4 5.8"/><path d="M5 10.6V19M19 10.6V19M12 10.6V19"/><path d="M2.6 20.4h18.8"/></svg>',
  cog: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.4-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/></svg>',
  bankpay: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M2 9h20"/><path d="M7 14.5h4"/><circle cx="17" cy="14.5" r="2"/></svg>',
  bolt: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13H11l-1 9 8.5-11H12z"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.6 1.8"/></svg>',
  truck: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1.5"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  camera: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5L8 5h8l1.5 2H21v13H3z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  mail: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2.5 7.5L12 13l9.5-5.5"/></svg>',
  out: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
};

export const STATUS_LABEL = { stock: 'In stock', reserved: 'Reserved', sold: 'Sold' };

export function bikePhoto(cls = '') {
  return `<figure class="surron ${cls}">
    <picture>
      <source srcset="/assets/bike.webp" type="image/webp">
      <img src="${asset('bike.png')}" alt="Sur-Ron Light Bee X" loading="lazy" decoding="async">
    </picture>
    <span class="shadow" aria-hidden="true"></span>
  </figure>`;
}

export function productArt(p) {
  return p.image_id
    ? `<img src="/img/${p.image_id}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
    : bikePhoto();
}

function nav(active, isAdmin, isCustomer) {
  const link = (href, label, key) =>
    `<a href="${href}"${active === key ? ' class="on"' : ''}>${label}</a>`;
  return `<nav class="nav">
    ${link('/', 'Shop', 'shop')}
    ${link('/track', 'Track order', 'track')}
    ${isCustomer ? link('/account', 'My orders', 'account') : ''}
    ${isAdmin ? link('/admin', 'Admin', 'admin') : ''}
  </nav>`;
}

/* One footer everywhere. A shop with no trading name, no address and no
   returns link reads as a front, however good the rest looks. */
export function siteFooter(s = {}) {
  const bits = [s.legal_name || s.shop_name, s.trading_address, s.contact_email, s.contact_phone]
    .filter(Boolean).map(esc);
  return `<footer class="sitefoot">
    <div class="shell">
      <div class="cols">
        <div>
          <div class="logo" style="margin-bottom:12px">
            <span class="glyph" aria-hidden="true"><img src="${asset('logo-180.png')}" alt="" width="34" height="34"></span>
            ${esc(s.shop_name || 'Ron Cartel')}
          </div>
          ${bits.length ? `<p class="addr">${bits.join('<br>')}</p>`
                        : '<p class="addr">Business details not set yet.</p>'}
        </div>
        <div>
          <div class="ft">Shop</div>
          <a href="/">All stock</a>
          <a href="/track">Track an order</a>
          <a href="/account">Your orders</a>
        </div>
        <div>
          <div class="ft">Buying from us</div>
          <a href="/returns">Returns &amp; cancellations</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/contact">Contact</a>
        </div>
      </div>
      <div class="fbot">
        <span>© ${new Date().getFullYear()} ${esc(s.legal_name || s.shop_name || 'Ron Cartel')}</span>
        <span>${esc(s.returns_days || '14')}-day cancellation right · UK consumer law applies</span>
      </div>
    </div>
  </footer>`;
}

export function layout({ title, body, active = '', admin = null, customer = null, head = '', wide = false, settings = null }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="${asset('favicon.png')}" type="image/png">
<link rel="apple-touch-icon" href="${asset('icon-180.png')}">
<meta name="theme-color" content="#0A0A0B">
<link rel="stylesheet" href="${asset('app.css')}">
${head}
</head>
<body>
<header class="topbar">
  <div class="topbar-in">
    <a class="logo" href="/">
      <span class="glyph" aria-hidden="true"><img src="${asset('mark.png')}" alt="" width="26" height="32"></span>
      Ron Cartel
    </a>
    ${nav(active, !!admin, !!customer)}
    <div class="topbar-r">
      ${admin
        ? `<span class="chip" style="padding-left:5px"><span class="av">${esc((admin.email || '?')[0].toUpperCase())}</span>Owner</span>
           <form method="post" action="/admin/logout" style="display:inline"><button class="chip" type="submit" style="cursor:pointer">${icon.out}</button></form>`
        : customer
          ? `<a class="chip" href="/account" style="padding-left:5px"><span class="av">${esc((customer.name || customer.email || '?')[0].toUpperCase())}</span>${esc((customer.name || customer.email).split(' ')[0])}</a>
             <form method="post" action="/signout" style="display:inline"><button class="chip" type="submit" style="cursor:pointer">${icon.out}</button></form>`
          : `<a class="chip" href="/signin">Sign in</a>`}
    </div>
  </div>
</header>
<div class="page">${body}${settings ? siteFooter(settings) : ''}</div>
<script src="${asset('app.js')}"></script>
</body>
</html>`;
}

export function flash(kind, msg) {
  if (!msg) return '';
  const cls = kind === 'error' ? 'stop' : kind === 'warn' ? 'warn' : 'info';
  return `<div class="note ${cls}" style="margin:0 0 18px">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4.5M12 8h.01"/></svg>
    <span>${esc(msg)}</span></div>`;
}
