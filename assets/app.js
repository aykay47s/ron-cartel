/* ============================================================
   RON CARTEL — shared behaviour
   ============================================================ */
document.documentElement.classList.add('js');

const RC = (function () {
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const money = n => n.toFixed(2);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- atmosphere: blooms, grain, mesh, rotors --- */
  function atmosphere() {
    if (document.querySelector('.atmos')) return;
    const rotor = (cls) =>
      `<svg class="rotor ${cls}" viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true">
        <circle cx="100" cy="100" r="94" stroke-width="1.5"/>
        <circle cx="100" cy="100" r="80" stroke-width="1"/>
        <circle cx="100" cy="100" r="34" stroke-width="1.5"/>
        <circle cx="100" cy="100" r="22" stroke-width="1"/>
        ${Array.from({length: 5}, (_, i) => {
          const a = (i / 5) * Math.PI * 2;
          return `<path d="M${100 + 34 * Math.cos(a)} ${100 + 34 * Math.sin(a)}
                  L${100 + 80 * Math.cos(a)} ${100 + 80 * Math.sin(a)}" stroke-width="1"/>`;
        }).join('')}
        ${Array.from({length: 30}, (_, i) => {
          const a = (i / 30) * Math.PI * 2, r = 87;
          return `<circle cx="${100 + r * Math.cos(a)}" cy="${100 + r * Math.sin(a)}"
                  r="2.6" stroke-width="1"/>`;
        }).join('')}
        ${Array.from({length: 18}, (_, i) => {
          const a = (i / 18) * Math.PI * 2, r = 60;
          return `<circle cx="${100 + r * Math.cos(a)}" cy="${100 + r * Math.sin(a)}"
                  r="3.4" stroke-width="1"/>`;
        }).join('')}
      </svg>`;
    const el = document.createElement('div');
    el.className = 'atmos';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="mesh"></div><span class="bloom a"></span>
      <span class="bloom b"></span><span class="bloom c"></span>
      ${rotor('r1')}${rotor('r2')}<div class="grain"></div>`;
    document.body.prepend(el);
  }

  /* --- pointer spotlight on panels --- */
  function spotlight() {
    if (reduced || matchMedia('(hover: none)').matches) return;
    let queued = false, ev = null;
    document.addEventListener('pointermove', e => {
      ev = e;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const el = ev.target.closest('.spot');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        el.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    }, {passive: true});
  }

  /* --- scroll reveal (fails open) --- */
  function reveal() {
    const items = $$('.rv');
    if (!items.length) return;
    const show = () => items.forEach(el => el.classList.add('in'));
    if (reduced || !('IntersectionObserver' in window)) return show();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const i = items.indexOf(en.target);
        en.target.style.transitionDelay = Math.min(i % 6, 5) * 55 + 'ms';
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, {rootMargin: '0px 0px -8% 0px', threshold: .08});
    items.forEach(el => io.observe(el));
    setTimeout(show, 2500);           // failsafe: never leave content hidden
  }

  /* --- etched reference: stagger each character --- */
  function etch(el, text) {
    el.textContent = '';
    text.split('').forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.animationDelay = (reduced ? 0 : i * 42) + 'ms';
      el.appendChild(s);
    });
  }

  /* --- copy to clipboard --- */
  function clipboard() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const src = $(b.dataset.copy);
      const txt = (src ? src.textContent : '').trim();
      const finish = () => {
        const html = b.innerHTML;
        b.classList.add('ok');
        b.textContent = 'Copied';
        setTimeout(() => { b.classList.remove('ok'); b.innerHTML = html; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(finish, finish);
      } else {
        const t = document.createElement('textarea');
        t.value = txt; t.setAttribute('readonly', '');
        t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(t); finish();
      }
    });
  }

  /* --- animated number --- */
  function countTo(el, to, prefix) {
    const from = parseFloat(el.dataset.v || to) || 0;
    el.dataset.v = to;
    if (reduced || Math.abs(to - from) < .01) {
      el.textContent = (prefix || '') + money(to); return;
    }
    const t0 = performance.now(), dur = 420;
    (function step(t) {
      const p = Math.min((t - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = (prefix || '') + money(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  /* --- toast --- */
  let tTimer;
  function toast(msg) {
    let t = $('#rc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rc-toast'; t.className = 'toast';
      t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg><span></span>`;
    t.querySelector('span').textContent = msg;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(tTimer);
    tTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }

  /* --- reference generator --- */
  function makeRef() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return 'RC-' + s;
  }

  function boot() {
    atmosphere(); spotlight(); reveal(); clipboard();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  return {$, $$, money, reduced, etch, countTo, toast, makeRef, reveal};
})();
