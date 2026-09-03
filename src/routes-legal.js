import { Hono } from 'hono';
import { getSettings } from './db.js';
import { layout, esc, icon } from './ui.js';

export const legalRoutes = new Hono();

/* These pages exist because a UK trader selling at a distance has to give a
   name, an address and contact details, and has to tell the buyer about the
   14-day cancellation right. They are also the single cheapest thing a small
   shop can do to stop looking like a front. */

const page = (title, eyebrow, inner) => `
<main class="shell doc">
  <p class="eyebrow" style="margin:0 0 10px">${esc(eyebrow)}</p>
  <h1 class="display" style="font-size:clamp(28px,3.6vw,40px);margin-bottom:22px">${title}</h1>
  ${inner}
</main>`;

function missing(what) {
  return `<div class="note warn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5h.01"/></svg>
    <span>${esc(what)} hasn't been filled in yet — add it in Admin → Settings.</span></div>`;
}

function identity(s) {
  const rows = [
    ['Trading name', s.legal_name || s.shop_name],
    ['Address', s.trading_address],
    ['Email', s.contact_email],
    ['Phone', s.contact_phone],
    ['Company number', s.company_number],
    ['VAT number', s.vat_number],
  ].filter(([, v]) => v);

  if (rows.length < 3) return missing('Your business details');
  return `<div class="rows">${rows.map(([k, v]) =>
    `<div class="row-f"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>`;
}

legalRoutes.get('/contact', async (c) => {
  const s = await getSettings();
  const body = page('Who you&rsquo;re buying from', 'Contact', `
    <p class="lede" style="font-size:15px;margin-bottom:22px">
      Every order is handled by a real person here. If something's wrong, say so and we'll sort it.</p>
    <div class="panel spot"><div class="panel-b">${identity(s)}</div></div>
    <p style="margin-top:20px;color:var(--muted);font-size:13.5px">
      We aim to reply the same day, seven days a week.</p>`);
  return c.html(layout({ title: 'Contact', body, admin: c.get('admin'), customer: c.get('customer') , settings: s }));
});

legalRoutes.get('/returns', async (c) => {
  const s = await getSettings();
  const days = parseInt(s.returns_days, 10) || 14;
  const body = page('Returns and cancellations', 'Your rights', `
    <div class="panel spot"><div class="panel-b prose">
      <p><strong>You have ${days} days to change your mind.</strong> Under the Consumer Contracts
      Regulations 2013, you can cancel a distance purchase within ${days} days of receiving it,
      for any reason, and get your money back.</p>

      <p>Send it back unused and undamaged, in a condition we could sell it in again. Refunds go
      back within 14 days of us receiving the item, or of you showing us proof you sent it.</p>

      <p><strong>The exception is made-to-order work.</strong> A bike built to a spec you chose is
      made for you specifically, so the automatic cancellation right doesn't apply to it. That is
      the law's exception, not a policy we invented — and if you're unsure whether a build counts,
      ask before you order and we'll tell you straight.</p>

      <p><strong>Faulty items are separate.</strong> If something arrives broken or fails early,
      the Consumer Rights Act 2015 applies and this ${days}-day window has nothing to do with it.
      Tell us and we'll repair, replace or refund.</p>

      ${s.returns_note ? `<p>${esc(s.returns_note)}</p>` : ''}
    </div></div>
    <p style="margin-top:20px"><a class="btn ghost sm" href="/contact">How to reach us</a></p>`);
  return c.html(layout({ title: 'Returns', body, admin: c.get('admin'), customer: c.get('customer') , settings: s }));
});

legalRoutes.get('/terms', async (c) => {
  const s = await getSettings();
  const body = page('Terms', 'The deal', `
    <div class="panel spot"><div class="panel-b prose">
      <p><strong>Who you're dealing with.</strong></p>
      ${identity(s)}

      <p style="margin-top:18px"><strong>Orders.</strong> Placing an order reserves the item for
      ${esc(s.hold_hours)} hours while you pay. Nothing is dispatched until payment clears. If it
      doesn't arrive in that window the item goes back on sale.</p>

      <p><strong>Prices.</strong> Shown in pounds including VAT where it applies. Delivery is added
      at checkout and shown before you commit.</p>

      <p><strong>Payment.</strong> We accept bank transfer and PayPal. <strong>Paying by PayPal
      Friends &amp; Family removes PayPal's buyer protection and cannot be reversed</strong> — we
      say so at checkout too, because you should know it before you choose it, not after.</p>

      <p><strong>Deposits.</strong> A deposit reserves an item for collection. It comes off the
      balance. If you cancel within your ${esc(s.returns_days)}-day right, the deposit is refunded
      like any other payment.</p>

      <p><strong>Delivery.</strong> Tracked and signed for. Timescales at checkout are what the
      carrier quotes us, not a guarantee.</p>

      ${s.terms_note ? `<p>${esc(s.terms_note)}</p>` : ''}

      <p><strong>Your legal rights are not affected</strong> by anything on this page. Nothing here
      overrides the Consumer Rights Act 2015 or the Consumer Contracts Regulations 2013.</p>
    </div></div>`);
  return c.html(layout({ title: 'Terms', body, admin: c.get('admin'), customer: c.get('customer') , settings: s }));
});

legalRoutes.get('/privacy', async (c) => {
  const s = await getSettings();
  const body = page('Privacy', 'Your data', `
    <div class="panel spot"><div class="panel-b prose">
      <p><strong>What we hold.</strong> Your name, email, phone, delivery address, what you ordered,
      and any payment screenshot you upload. That's it. We never see or store card details, because
      we don't take cards.</p>

      <p><strong>Why.</strong> To take your order, send it to you, and answer you if something goes
      wrong. That's the contract between us — we don't use it for anything else.</p>

      <p><strong>Who else sees it.</strong> The carrier gets your name and address so they can
      deliver. Our email provider handles your order emails. Nobody else. We don't sell data and we
      don't run ad trackers on this site.</p>

      <p><strong>How long.</strong> Order records are kept six years, because HMRC requires it.
      You can ask us to delete your account at any time and we'll remove everything we're not
      legally required to keep.</p>

      <p><strong>Your rights.</strong> Under UK GDPR you can ask for a copy of what we hold, ask us
      to correct it, or ask us to delete it. Email us and we'll do it within a month. If you think
      we've handled it badly you can complain to the ICO at ico.org.uk.</p>

      ${s.privacy_note ? `<p>${esc(s.privacy_note)}</p>` : ''}
    </div></div>
    <p style="margin-top:20px"><a class="btn ghost sm" href="/contact">Contact us</a></p>`);
  return c.html(layout({ title: 'Privacy', body, admin: c.get('admin'), customer: c.get('customer') , settings: s }));
});
