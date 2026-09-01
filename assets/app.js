/* ============================================================
   RON CARTEL — shared behaviour
   ============================================================ */
document.documentElement.classList.add('js');

const RC = (function () {
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const money = n => Number(n).toFixed(2);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- atmosphere ---------- */
  function atmosphere() {
    if ($('.atmos')) return;
    const el = document.createElement('div');
    el.className = 'atmos';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="mesh"></div>
      <span class="bloom a"></span><span class="bloom b"></span><span class="bloom c"></span>
      <div class="grain"></div>`;
    document.body.prepend(el);
  }

  /* ---------- the bike ----------
     Sur-Ron Light Bee X, side view. 19" wire-spoke wheels front and rear,
     KKE telescopic fork, link-type rear shock, mid-mounted PMSM, and the
     open frame triangle where a dirt bike would carry its tank.        */
  /* ---------- the bike ----------
     A cut-out photo of the real Light Bee X, not a drawing. Kept as one
     helper so every surface (hero, card fallback, cart thumb) shares it. */
  function bike(cls) {
    return `<figure class="surron ${cls || ''}">
      <picture>
        <source srcset="assets/bike.webp" type="image/webp">
        <img src="assets/bike.png" alt="Sur-Ron Light Bee X" loading="lazy" decoding="async">
      </picture>
      <span class="shadow" aria-hidden="true"></span>
    </figure>`;
  }

  /* ---------- pointer spotlight ---------- */
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

  /* ---------- scroll reveal (fails open) ---------- */
  function reveal() {
    const items = $$('.rv');
    if (!items.length) return;
    const show = () => items.forEach(el => el.classList.add('in'));
    if (reduced || !('IntersectionObserver' in window)) return show();
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const i = items.indexOf(en.target);
        en.target.style.transitionDelay = Math.min(i % 6, 5) * 55 + 'ms';
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, {rootMargin: '0px 0px -8% 0px', threshold: .08});
    items.forEach(el => io.observe(el));
    setTimeout(show, 2500);
  }

  /* ---------- etched reference ---------- */
  function etch(el, text) {
    el.textContent = '';
    String(text).split('').forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.animationDelay = (reduced ? 0 : i * 42) + 'ms';
      el.appendChild(s);
    });
  }

  /* ---------- clipboard ---------- */
  function clipboard() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const src = $(b.dataset.copy);
      const txt = (src ? src.textContent : '').trim();
      const done = () => {
        const html = b.innerHTML;
        b.classList.add('ok'); b.textContent = 'Copied';
        setTimeout(() => { b.classList.remove('ok'); b.innerHTML = html; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, done);
      } else {
        const t = document.createElement('textarea');
        t.value = txt; t.setAttribute('readonly', '');
        t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(t); done();
      }
    });
  }

  /* ---------- animated number ---------- */
  function countTo(el, to, prefix) {
    const from = parseFloat(el.dataset.v || to) || 0;
    el.dataset.v = to;
    if (reduced || Math.abs(to - from) < .01) {
      el.textContent = (prefix || '') + money(to); return;
    }
    const t0 = performance.now(), dur = 420;
    (function step(t) {
      const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (prefix || '') + money(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  /* ---------- toast ---------- */
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

  function makeRef() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return 'RC-' + s;
  }

  /* ---------- product store ----------
     Browser-local for now: this is a static site, so products live in this
     browser only. A real backend replaces this object and nothing else.  */
  const KEY = 'rc.products.v1';
  const store = {
    all() {
      try { return JSON.parse(localStorage.getItem(KEY)) || []; }
      catch (_) { return []; }
    },
    write(list) {
      try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
      catch (_) { return false; }
    },
    get(id) { return this.all().find(p => p.id === id) || null; },
    add(p) {
      const list = this.all();
      p.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      list.push(p); this.write(list); return p;
    },
    update(id, patch) {
      const list = this.all(), i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i] = Object.assign({}, list[i], patch);
      this.write(list); return list[i];
    },
    remove(id) { this.write(this.all().filter(p => p.id !== id)); }
  };

  function boot() { atmosphere(); spotlight(); reveal(); clipboard(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  return {$, $$, money, esc, reduced, bike, etch, countTo, toast, makeRef, reveal, store};
})();
