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
  function spokes(cx, cy, r, n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s += `<line x1="${(cx + r * 0.20 * Math.cos(a)).toFixed(1)}"
                  y1="${(cy + r * 0.20 * Math.sin(a)).toFixed(1)}"
                  x2="${(cx + r * 0.88 * Math.cos(a)).toFixed(1)}"
                  y2="${(cy + r * 0.88 * Math.sin(a)).toFixed(1)}"/>`;
    }
    return s;
  }

  function wheel(cx, cy, r, id) {
    let knobs = '';
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      knobs += `<line x1="${(cx + (r - 5) * Math.cos(a)).toFixed(1)}"
                      y1="${(cy + (r - 5) * Math.sin(a)).toFixed(1)}"
                      x2="${(cx + (r + 3) * Math.cos(a)).toFixed(1)}"
                      y2="${(cy + (r + 3) * Math.sin(a)).toFixed(1)}"/>`;
    }
    return `
      <g class="wheel">
        <g class="rotate" id="${id}">
          <circle class="tyre" cx="${cx}" cy="${cy}" r="${r}"/>
          <g class="knob">${knobs}</g>
          <circle class="rim" cx="${cx}" cy="${cy}" r="${r - 11}"/>
          <g class="spoke">${spokes(cx, cy, r - 11, 18)}</g>
          <circle class="hub" cx="${cx}" cy="${cy}" r="${r * 0.19}"/>
          <circle class="hubdot" cx="${cx}" cy="${cy}" r="3"/>
        </g>
      </g>`;
  }

  function bike(cls) {
    /* Proportioned off the real bike: wheelbase 1260mm, 19" wheels,
       seat 810mm, overall height 1040mm. Ground sits at y=224.        */
    const FX = 106, RX = 324, AY = 168, R = 56;
    return `
<svg class="surron ${cls || ''}" viewBox="0 0 430 258" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8FC4FF"/><stop offset=".55" stop-color="#2E8BFF"/>
      <stop offset="1" stop-color="#0E3A6B"/>
    </linearGradient>
    <linearGradient id="cell" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2E8BFF" stop-opacity=".55"/>
      <stop offset="1" stop-color="#2E8BFF" stop-opacity=".07"/>
    </linearGradient>
  </defs>

  <line class="ground" x1="10" y1="232" x2="420" y2="232"/>
  <line class="dashes" x1="10" y1="232" x2="420" y2="232"/>

  <g class="rig">
    <!-- swingarm + link shock -->
    <path class="arm" d="M248 176 L${RX} ${AY}"/>
    <path class="arm thin" d="M250 184 L${RX - 8} ${AY + 8}"/>
    <path class="shock" d="M272 108 L293 156"/>
    <path class="frame" d="M293 156 L272 172"/>
    <circle class="pivot" cx="248" cy="176" r="4"/>

    <!-- chain run -->
    <path class="chain" d="M250 172 L${RX} ${AY - 2}"/>
    <path class="chain" d="M250 180 L${RX} ${AY + 13}"/>
    <circle class="sprocket" cx="${RX}" cy="${AY}" r="14"/>
    <circle class="sprocket" cx="250" cy="176" r="7"/>

    <!-- mid-mounted PMSM -->
    <circle class="motor" cx="242" cy="176" r="19"/>
    <circle class="motor in" cx="242" cy="176" r="11"/>

    <!-- frame: perimeter with the open triangle -->
    <path class="frame main" d="M170 100 L268 106"/>
    <path class="frame main" d="M162 128 L230 178"/>
    <path class="frame main" d="M268 106 L246 174"/>
    <path class="frame" d="M230 178 L248 176"/>
    <path class="frame" d="M268 106 L252 96"/>

    <!-- battery pack in the triangle -->
    <path class="batt" d="M182 110 L256 114 L240 164 L200 160 Z"/>
    <path class="cells" d="M196 111 L196 161 M210 112 L210 162
                           M224 113 L224 163 M238 114 L238 164"/>

    <!-- seat + subframe -->
    <path class="seat" d="M246 97 C278 91 310 90 332 96 L330 105 C308 100 278 101 250 106 Z"/>
    <path class="tail" d="M268 106 L332 100"/>

    <!-- front end -->
    <g class="front">
      <path class="frame main" d="M170 100 L162 130"/>
      <path class="fork" d="M166 104 L${FX + 6} ${AY - 4}"/>
      <path class="fork thin" d="M176 102 L${FX + 17} ${AY - 7}"/>
      <path class="bars" d="M172 98 L166 62"/>
      <path class="bars grip" d="M148 58 L184 64"/>
      <path class="plate" d="M148 102 L172 93 L180 119 L156 128 Z"/>
      ${wheel(FX, AY, R, 'w-front')}
    </g>

    ${wheel(RX, AY, R, 'w-rear')}
  </g>
</svg>`;
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
