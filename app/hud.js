// Puls HUD – die futuristische Darstellung: lebendiger Hintergrund, Startsequenz, Hologramm-Ringe,
// EKG-Linie im Takt deines Ruhepulses, Text-Entschlüsselung und Tipp-Impulse.
// Alles ruht, sobald die App im Hintergrund ist. Bei „Bewegung reduzieren“ bleibt alles still.

export const THEME_KEY = 'puls.theme';
const root = () => document.documentElement;

export const isHud = () => typeof document !== 'undefined' && root().dataset.theme !== 'classic';
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const f1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function setTheme(theme) {
  const t = theme === 'classic' ? 'classic' : 'hud';
  root().dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(t));
  } catch {
    /* privater Modus */
  }
  if (t === 'hud') startBackdrop();
  else stopBackdrop();
}

// ------------------------------------------------------------------ Ringe: Skalen, Klammern, Scanner

const P = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
};
const arc = (r, a0, a1) => {
  const [x0, y0] = P(r, a0);
  const [x1, y1] = P(r, a1);
  return `M${f1(x0)},${f1(y0)}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(x1)},${f1(y1)}`;
};

/** Skala mit 72 Strichen, jeder sechste länger, vier kleine Lücken (Pfad im 200er-Raster). */
export function tickPath(inner = 93, major = 90.5, outer = 97) {
  let d = '';
  for (let k = 0; k < 72; k++) {
    if (k % 18 === 8 || k % 18 === 9) continue;
    const [x1, y1] = P(k % 6 === 0 ? major : inner, k * 5);
    const [x2, y2] = P(outer, k * 5);
    d += `M${f1(x1)},${f1(y1)}L${f1(x2)},${f1(y2)}`;
  }
  return d;
}

const DECO = (() => {
  const ticks = `<svg class="hx-a" viewBox="0 0 200 200"><path d="${tickPath()}" fill="none" stroke="var(--hud)" stroke-width=".9" opacity=".5"/><circle cx="100" cy="100" r="99.2" fill="none" stroke="var(--hud)" stroke-width=".4" opacity=".22"/></svg>`;
  const caps = [-28, 28, 152, 208].map((a) => {
    const [x1, y1] = P(84.5, a);
    const [x2, y2] = P(90.5, a);
    return `M${f1(x1)},${f1(y1)}L${f1(x2)},${f1(y2)}`;
  });
  const brackets = `<svg class="hx-b" viewBox="0 0 200 200"><circle cx="100" cy="100" r="87.5" fill="none" stroke="var(--hx)" stroke-width=".7" stroke-dasharray="1.2 3.4" opacity=".5"/><path d="${arc(87.5, -28, 28)}${arc(87.5, 152, 208)}${caps.join('')}" fill="none" stroke="var(--hx)" stroke-width="1.8" stroke-linecap="round" opacity=".95"/></svg>`;
  let sweep = '';
  for (let j = 0; j < 9; j++) sweep += `<path d="${arc(64, -(j + 1) * 8, -j * 8)}" fill="none" stroke="var(--hx)" stroke-width="1.6" opacity="${f1(0.8 * (1 - j / 9))}"/>`;
  const scanner = `<svg class="hx-c" viewBox="0 0 200 200">${sweep}<circle cx="164" cy="100" r="2" fill="#fff"/></svg>`;
  return `${ticks}${brackets}${scanner}</div>`;
})();

/** Bewegte HUD-Ebenen um einen Ring (nur in der Zukunfts-Darstellung sichtbar). */
export const hudDeco = (hex) => `<div class="hx" aria-hidden="true" style="--hx:${hex}">${DECO}`;

/** Messwerte links und rechts vom großen Ring, mit Hinweislinie. items: [{k, v, u}] */
export function callouts(items) {
  const co = (x) => `<div class="co"><span>${esc(x.k)}</span><b>${esc(x.v)}${x.u ? `<small>${esc(x.u)}</small>` : ''}</b></div>`;
  const list = items.filter((x) => x && x.v != null && x.v !== '');
  return { left: list.slice(0, 2).map(co).join(''), right: list.slice(2, 4).map(co).join('') };
}

// ------------------------------------------------------------------ Hintergrund: Lichtstaub, Netz, Scan

let fx = null;

export function startBackdrop() {
  if (fx || !isHud() || typeof document === 'undefined') return;
  const cv = document.createElement('canvas');
  cv.id = 'fx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) {
    cv.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  let parts = [];
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const n = Math.max(28, Math.min(58, Math.round((w * h) / 9000)));
    parts = Array.from({ length: n }, (_, k) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: 0.35 + Math.random() * 0.65,
      vx: (Math.random() - 0.5) * 3,
      ph: k * 1.7,
    }));
  };
  resize();
  const t0 = performance.now();
  let last = 0;
  let raf = 0;
  const frame = (now) => {
    raf = 0;
    if (!fx || document.visibilityState !== 'visible') return;
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // 30 Bilder pro Sekunde genügen
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    draw(now, dt);
  };
  const draw = (now, dt) => {
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y -= (5 + 9 * p.z) * dt;
      p.x += (p.vx + Math.sin(t * 0.3 + p.ph) * 2) * dt;
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
    }
    // Netz zwischen nahen Punkten
    ctx.lineWidth = 0.6;
    for (let a = 0; a < parts.length; a++) {
      for (let b = a + 1; b < parts.length; b++) {
        const dx = parts[a].x - parts[b].x;
        const dy = parts[a].y - parts[b].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 7200) continue;
        const al = (1 - Math.sqrt(d2) / 85) * 0.11 * Math.min(parts[a].z, parts[b].z);
        ctx.strokeStyle = `rgba(95,240,255,${al.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(parts[a].x, parts[a].y);
        ctx.lineTo(parts[b].x, parts[b].y);
        ctx.stroke();
      }
    }
    for (const p of parts) {
      const tw = 0.6 + 0.4 * Math.sin(t * 1.6 + p.ph);
      ctx.fillStyle = `rgba(150,248,255,${((0.18 + 0.5 * p.z) * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.5 + 1.1 * p.z, 0, Math.PI * 2);
      ctx.fill();
    }
    // Alle 11 Sekunden zieht ein Scan über den Bildschirm
    const ph = t % 11;
    if (ph < 2.4) {
      const y = (ph / 2.4) * (h + 160) - 80;
      const g = ctx.createLinearGradient(0, y - 70, 0, y + 2);
      g.addColorStop(0, 'rgba(95,240,255,0)');
      g.addColorStop(1, 'rgba(95,240,255,0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 70, w, 72);
      ctx.fillStyle = 'rgba(160,250,255,0.16)';
      ctx.fillRect(0, y, w, 1);
    }
  };
  const wake = () => {
    if (fx && !raf && document.visibilityState === 'visible' && !still()) raf = requestAnimationFrame(frame);
  };
  fx = { cv, wake, stop: () => raf && cancelAnimationFrame(raf), resize };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', wake);
  if (still()) draw(performance.now(), 0); // ein stilles Bild
  else wake();
}

export function stopBackdrop() {
  if (!fx) return;
  fx.stop();
  window.removeEventListener('resize', fx.resize);
  document.removeEventListener('visibilitychange', fx.wake);
  fx.cv.remove();
  fx = null;
}

// ------------------------------------------------------------------ Startsequenz

const BOOT_KEY = 'puls.boot';

/** Kurzer Systemstart beim Öffnen (einmal pro Sitzung, ca. 2 Sekunden, Antippen überspringt). */
export function boot() {
  if (!isHud() || still()) return;
  try {
    if (sessionStorage.getItem(BOOT_KEY)) return;
    sessionStorage.setItem(BOOT_KEY, '1');
  } catch {
    /* egal */
  }
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Guten Tag' : hour < 22 ? 'Guten Abend' : 'Gute Nacht';
  const log = ['Biometrie-Kern', 'Herzratenvariabilität', 'Schlafarchitektur', 'Belastungsmodell'];
  const el = document.createElement('div');
  el.id = 'boot';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="bt-core">
      <svg class="bt-rings" viewBox="0 0 200 200">
        <path class="bt-ticks" d="${tickPath(93, 89, 98)}"/>
        <circle class="bt-c bt1" cx="100" cy="100" r="84" pathLength="1"/>
        <circle class="bt-c bt2" cx="100" cy="100" r="72" pathLength="1"/>
        <circle class="bt-c bt3" cx="100" cy="100" r="60" pathLength="1"/>
        <path class="bt-arc" d="${arc(84, -40, 40)}${arc(84, 140, 220)}"/>
      </svg>
      <div class="bt-mark">PULS</div>
    </div>
    <ol class="bt-log">${log.map((l, k) => `<li style="--d:${k}"><span>${l}</span><b>OK</b></li>`).join('')}</ol>
    <div class="bt-bar"><i></i></div>
    <div class="bt-greet">${greet}</div>`;
  document.body.appendChild(el);
  document.body.classList.add('booting');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.add('out');
    document.body.classList.remove('booting');
    setTimeout(() => el.remove(), 650);
  };
  el.addEventListener('pointerdown', finish);
  setTimeout(finish, 2050);
}

// ------------------------------------------------------------------ Effekte nach jedem Aufbau der Seite

const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789<>/#%+';

/** Überschriften „entschlüsseln“ sich beim Erscheinen. */
export function decode(scope) {
  if (!isHud() || still()) return;
  const jobs = [];
  scope.querySelectorAll('.card > h2, h2.bighead, h2.section, .ptitle, .ringbox .cap, .tl-tag').forEach((el, k) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!node) return;
    jobs.push({ node, text: node.nodeValue, delay: Math.min(k, 12) * 35 });
  });
  if (!jobs.length) return;
  const t0 = performance.now();
  const DUR = 520;
  let last = 0;
  const step = (now) => {
    if (now - last < 32 && now - t0 < DUR + 500) return requestAnimationFrame(step);
    last = now;
    let busy = false;
    for (const j of jobs) {
      const k = Math.max(0, Math.min(1, (now - t0 - j.delay) / DUR));
      if (k >= 1) {
        if (j.node.nodeValue !== j.text) j.node.nodeValue = j.text;
        continue;
      }
      busy = true;
      const shown = Math.floor(j.text.length * k);
      let s = j.text.slice(0, shown);
      for (let c = shown; c < j.text.length; c++) {
        const ch = j.text[c];
        s += ch === ' ' || ch === '·' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      j.node.nodeValue = s;
    }
    if (busy) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** EKG-Form (Werte etwa −0,3 … 1) für eine Phase 0 … 1 eines Herzschlags. */
export function ecgShape(p) {
  const g = (c, w, a) => a * Math.exp(-((p - c) ** 2) / (2 * w * w));
  return g(0.16, 0.028, 0.12) + g(0.29, 0.009, -0.14) + g(0.315, 0.011, 1) + g(0.342, 0.011, -0.3) + g(0.56, 0.05, 0.24);
}

/** Startet die EKG-Linien auf der Seite: wandernder Stift, Spur verblasst langsam. */
function startEcg(scope) {
  scope.querySelectorAll('canvas.ecg:not([data-run])').forEach((cv) => {
    cv.dataset.run = '1';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 160;
    const h = cv.clientHeight || 26;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    const bpm = Math.max(35, Math.min(120, Number(cv.dataset.bpm) || 60));
    const period = 60 / bpm;
    const speed = w / (3.2 * period);
    const color = cv.dataset.color || '#5ff0ff';
    const yOf = (t) => h * 0.68 - ecgShape((t % period) / period) * h * 0.58;
    let visible = true;
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((en) => {
        visible = en.some((x) => x.isIntersecting);
        if (!cv.isConnected) io.disconnect();
        else if (visible) kick();
      });
      io.observe(cv);
    }
    const t0 = performance.now();
    let prev = null;
    let raf = 0;
    let lastDraw = 0;
    const frame = (now) => {
      raf = 0;
      if (!cv.isConnected || !visible || document.visibilityState !== 'visible') return;
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < 30) return;
      lastDraw = now;
      const t = (now - t0) / 1000;
      const x = (t * speed) % w;
      const y = yOf(t);
      // ältere Spur verblasst
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillRect(0, 0, w, h);
      ctx.clearRect(x + 1, 0, 12, h);
      ctx.globalCompositeOperation = 'source-over';
      if (prev && x > prev.x) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      prev = { x, y };
    };
    const kick = () => {
      if (!raf && !still()) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', kick);
    if (still()) {
      // ruhende Linie: ein ganzer Durchlauf ohne Bewegung
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 1) ctx[x ? 'lineTo' : 'moveTo'](x, yOf(x / speed));
      ctx.stroke();
    } else kick();
  });
}

/** Lichtimpuls in den Linien-Diagrammen nur laufen lassen, solange sie zu sehen sind. */
function watchCharts(scope) {
  if (typeof IntersectionObserver !== 'function') return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) en.target.classList.toggle('vis', en.isIntersecting);
  });
  scope.querySelectorAll('svg.chart').forEach((el) => io.observe(el));
}

/** Nach jedem Neuaufbau der Seite aufrufen. */
export function afterRender(scope, anim) {
  if (!isHud()) return;
  startBackdrop();
  startEcg(scope);
  watchCharts(scope);
  if (anim) decode(scope);
}

// ------------------------------------------------------------------ Antippen: kurzer Lichtring

let pingsOn = false;
export function enablePings() {
  if (pingsOn || typeof document === 'undefined') return;
  pingsOn = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!isHud() || still() || (!e.clientX && !e.clientY)) return;
      const p = document.createElement('i');
      p.className = 'ping';
      p.style.left = `${e.clientX}px`;
      p.style.top = `${e.clientY}px`;
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove());
      setTimeout(() => p.remove(), 900);
    },
    true,
  );
}
