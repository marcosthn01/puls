// Kleine SVG-Diagramme ohne Bibliothek. Alle Funktionen liefern SVG-Text.

const W = 340;
const f1 = (v) => Math.round(v * 10) / 10;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Ring mit Wert (z. B. Recovery 0–100, Strain 0–21). ``band`` = [von, bis] als dünner Außenbogen.
 *  ``count`` lässt die Zahl beim Erscheinen hochzählen, ``anim`` füllt den Ring animiert. */
export function ring({ value, max, color, size = 132, stroke = 11, label = '', sub = '', band = null, labelSize = 34, count = null, digits = 0, suffix = '', anim = false, glow = false }) {
  const r = (size - stroke) / 2 - (band ? 5 : 0);
  const c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const mid = size / 2;
  let bandArc = '';
  if (band) {
    const rb = r + stroke / 2 + 5;
    const cb = 2 * Math.PI * rb;
    const a = Math.max(0, band[0] / max);
    const b = Math.min(1, band[1] / max);
    bandArc = `<circle cx="${mid}" cy="${mid}" r="${f1(rb)}" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="3"
      stroke-dasharray="${f1((b - a) * cb)} ${f1(cb)}" stroke-dashoffset="${f1(-a * cb)}" transform="rotate(-90 ${mid} ${mid})" stroke-linecap="round"/>`;
  }
  const valArc =
    frac > 0
      ? `<circle class="ringval${anim ? ' anim' : ''}" style="--c:${f1(c)}" cx="${mid}" cy="${mid}" r="${f1(r)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${f1(c)} ${f1(c)}" stroke-dashoffset="${f1(c * (1 - frac))}" transform="rotate(-90 ${mid} ${mid})"/>`
      : '';
  const countAttr = count != null && anim ? ` data-count="${count}" data-digits="${digits}" data-suffix="${esc(suffix)}"` : '';
  let tip = '';
  if (frac > 0.02 && frac < 0.995) {
    const a = -Math.PI / 2 + frac * 2 * Math.PI;
    tip = `<circle class="ringtip" cx="${f1(mid + r * Math.cos(a))}" cy="${f1(mid + r * Math.sin(a))}" r="${f1(stroke * 0.3)}" fill="#fff"/>`;
  }
  const style = glow && frac > 0 ? ` style="filter:drop-shadow(0 0 ${Math.round(size / 16)}px ${color})"` : '';
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${esc(sub)}"${style}>
    <circle cx="${mid}" cy="${mid}" r="${f1(r)}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    ${valArc}
    ${tip}
    ${bandArc}
    <text x="${mid}" y="${mid + (sub ? labelSize * 0.18 : labelSize * 0.35)}" text-anchor="middle" class="ring-label" style="font-size:${labelSize}px"${countAttr}>${esc(label)}</text>
    ${sub ? `<text x="${mid}" y="${mid + labelSize * 0.18 + Math.max(16, labelSize * 0.5)}" text-anchor="middle" class="ring-sub" style="font-size:${Math.max(11, Math.round(labelSize * 0.33))}px">${esc(sub)}</text>` : ''}
  </svg>`;
}

/** Strain-Coach: Skala 0–21 mit Zielbereich und aktuellem Wert. */
export function strainGauge(value, target) {
  const h = 54;
  const x = (v) => 8 + (Math.max(0, Math.min(21, v)) / 21) * (W - 16);
  const band = target ? `<rect x="${f1(x(target.low))}" y="18" width="${f1(x(target.high) - x(target.low))}" height="10" rx="5" fill="var(--strain)" fill-opacity=".35"/>` : '';
  const marker =
    value == null
      ? ''
      : `<circle cx="${f1(x(value))}" cy="23" r="9" fill="var(--strain)" stroke="var(--bg)" stroke-width="3"/>`;
  const ticks = [0, 7, 14, 21].map((t) => `<text x="${f1(x(t))}" y="${h - 4}" text-anchor="middle" class="axis">${t}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Strain und Zielbereich">
    <rect x="8" y="20" width="${W - 16}" height="6" rx="3" fill="var(--track)"/>${band}${marker}${ticks}</svg>`;
}

/** Wertebalken mit Normalbereich (Körper-Check). */
export function rangeBar(value, lo, hi, color) {
  const span = hi - lo || 1;
  const a = lo - span * 0.6;
  const b = hi + span * 0.6;
  const p = (v) => (100 * (Math.max(a, Math.min(b, v)) - a)) / (b - a);
  return `<div class="rbar"><i class="rband" style="left:${p(lo).toFixed(1)}%;width:${(p(hi) - p(lo)).toFixed(1)}%"></i><b style="left:${p(value).toFixed(1)}%;background:${color}"></b></div>`;
}

function axisLabels(labels, x, y, every) {
  return labels
    .map((l, i) => (l && i % every === 0 ? `<text x="${f1(x(i))}" y="${y}" text-anchor="middle" class="axis">${esc(l)}</text>` : ''))
    .join('');
}

/** Säulen. values: [{v, color}], refs: [{v, color, dash, label}] */
let gradId = 0;

/** Halbkreis-Anzeige (z. B. Stress jetzt): farbiger Verlauf, Zeiger als Punkt. */
export function arcGauge({ value, max = 100, label = '', sub = '', size = 220 }) {
  const w = size;
  const h = size * 0.62;
  const r = size * 0.4;
  const cx = w / 2;
  const cy = size * 0.5;
  const start = Math.PI;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const pt = (f) => [cx + r * Math.cos(start + f * Math.PI), cy + r * Math.sin(start + f * Math.PI)];
  const [x0, y0] = pt(0);
  const [x1, y1] = pt(1);
  const [px, py] = pt(frac);
  const id = `ag${++gradId}`;
  return `<svg class="arcgauge" viewBox="0 0 ${w} ${f1(h)}" width="100%" style="max-width:${w}px" role="img" aria-label="${esc(label)} ${esc(sub)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d9cff"/><stop offset=".45" stop-color="#1ee08e"/><stop offset=".72" stop-color="#ffc23d"/><stop offset="1" stop-color="#ff5148"/></linearGradient></defs>
    <path d="M${f1(x0)},${f1(y0)} A${f1(r)},${f1(r)} 0 0 1 ${f1(x1)},${f1(y1)}" fill="none" stroke="var(--track)" stroke-width="${f1(size * 0.06)}" stroke-linecap="round"/>
    <path class="draw" pathLength="1" d="M${f1(x0)},${f1(y0)} A${f1(r)},${f1(r)} 0 0 1 ${f1(x1)},${f1(y1)}" fill="none" stroke="url(#${id})" stroke-width="${f1(size * 0.06)}" stroke-linecap="round" opacity=".9"/>
    ${value == null ? '' : `<circle class="agdot" cx="${f1(px)}" cy="${f1(py)}" r="${f1(size * 0.045)}" fill="#fff" stroke="#000" stroke-width="3"/>`}
    <text x="${cx}" y="${f1(cy - size * 0.06)}" text-anchor="middle" class="ag-val">${esc(label)}</text>
    <text x="${cx}" y="${f1(cy + size * 0.07)}" text-anchor="middle" class="ag-sub">${esc(sub)}</text>
  </svg>`;
}



/** Schwebende Kugel (Puls-Alter): Platzhalter, die Animation startet startOrbs(). */
export function orb({ size = 168, color = '#1ee08e', label = '', sub = '' }) {
  return `<div class="orbwrap" style="--orb:${color};width:${size}px;height:${size}px"><canvas class="orb" data-orb="${color}" width="${size * 2}" height="${size * 2}" style="width:${size}px;height:${size}px"></canvas><div class="orb-txt"><b>${esc(label)}</b><span>${esc(sub)}</span></div></div>`;
}

/** Kleine Kugel, die im Inneren eines Rings schwebt (ohne Rand und Umlaufbahn). */
export function innerOrb(color, px = 120) {
  return `<canvas class="orb inner" data-orb="${color}" data-soft="1" data-plain="1" width="${px * 2}" height="${px * 2}" aria-hidden="true"></canvas>`;
}

/** Zeichnet alle Kugeln auf der Seite: weiches Licht im Inneren, kreisende Lichtpunkte. */
export function startOrbs(root = document) {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('canvas[data-orb]:not([data-run])').forEach((cv) => {
    cv.dataset.run = '1';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W2 = cv.width;
    const c = W2 / 2;
    const R = W2 * 0.4;
    const color = cv.dataset.orb;
    const rgb = hexRgb(color);
    const soft = cv.dataset.soft === '1';
    const plain = cv.dataset.plain === '1';
    const k = soft ? 0.5 : 1;
    // Nur zeichnen, solange die Kugel zu sehen ist (spart Akku)
    let visible = true;
    let running = false;
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        visible = entries.some((en) => en.isIntersecting);
        if (visible && !running && !still && cv.isConnected) {
          running = true;
          requestAnimationFrame(frame);
        }
        if (!cv.isConnected) io.disconnect();
      });
      io.observe(cv);
    }
    const nDots = cv.dataset.plain === '1' ? 40 : 90;
    const dots = Array.from({ length: nDots }, (_, j) => ({ th: Math.acos(1 - (2 * (j + 0.5)) / nDots), ph: j * 2.39996, s: 0.6 + ((j * 37) % 10) / 10 }));
    const t0 = performance.now();
    const frame = (now) => {
      if (!cv.isConnected || (!visible && !still)) {
        running = false;
        return;
      }
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W2, W2);
      // Außenleuchten
      const glow = ctx.createRadialGradient(c, c, R * 0.7, c, c, R * (plain ? 1.05 : 1.25));
      glow.addColorStop(0, `rgba(${rgb},${0.35 * k})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W2, W2);
      // Kugel
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R);
      body.addColorStop(0, `rgba(${rgb},${0.55 * k})`);
      body.addColorStop(0.55, `rgba(${rgb},${0.18 * k})`);
      body.addColorStop(1, plain ? `rgba(${rgb},0)` : 'rgba(4,8,8,0.95)');
      ctx.fillStyle = body;
      ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
      // wandernde Lichtschleier
      ctx.globalCompositeOperation = 'screen';
      for (let k = 0; k < 3; k++) {
        const a = t * (0.25 + k * 0.11) + k * 2.1;
        const bx = c + Math.cos(a) * R * 0.38;
        const by = c + Math.sin(a * 1.3) * R * 0.32;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * (0.55 - k * 0.08));
        g.addColorStop(0, `rgba(${rgb},${(0.32 - k * 0.07) * (soft ? 0.7 : 1)})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
      }
      // Lichtpunkte auf einer sich drehenden Kugelschale
      const rot = t * 0.22;
      for (const d of dots) {
        const ph = d.ph + rot;
        const x3 = Math.sin(d.th) * Math.cos(ph);
        const y3 = Math.cos(d.th);
        const z3 = Math.sin(d.th) * Math.sin(ph);
        const depth = (z3 + 1) / 2;
        const tw = 0.55 + 0.45 * Math.sin(t * 2 * d.s + d.ph);
        ctx.fillStyle = `rgba(255,255,255,${(0.08 + depth * 0.6) * tw * k})`;
        ctx.beginPath();
        ctx.arc(c + x3 * R * 0.86, c + y3 * R * 0.86, (0.8 + depth * 1.8) * (W2 / 336) * d.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      if (plain) {
        if (!still) requestAnimationFrame(frame);
        return;
      }
      // Rand und Umlaufbahn
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.lineWidth = W2 / 160;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-0.35);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = W2 / 320;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 1.18, R * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
      const oa = t * 0.9;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = color;
      ctx.shadowBlur = W2 / 30;
      ctx.beginPath();
      ctx.arc(Math.cos(oa) * R * 1.18, Math.sin(oa) * R * 0.34, W2 / 110, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!still) requestAnimationFrame(frame);
    };
    running = true;
    requestAnimationFrame(frame);
  });
}

function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16);
  return Number.isFinite(n) ? `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}` : '30,224,142';
}

export function bars({ values, labels = [], height = 130, max = null, min = 0, refs = [], every = 1, unit = '', line = null }) {
  const top = unit ? 16 : 10;
  const bottom = height - 18;
  const n = values.length || 1;
  const nums = values.map((x) => x.v).filter((v) => v != null);
  const hi = max ?? Math.max(1, ...nums, ...refs.map((r) => r.v), ...(line || []).filter((v) => v != null)) * 1.12;
  const step = W / n;
  const bw = Math.max(2, step * 0.62);
  const y = (v) => bottom - ((Math.max(min, v) - min) / (hi - min || 1)) * (bottom - top);
  const x = (i) => step * i + step / 2;
  const rects = values
    .map((b, i) =>
      b.v == null
        ? ''
        : `<rect class="bar" style="--i:${i}" x="${f1(x(i) - bw / 2)}" y="${f1(y(b.v))}" width="${f1(bw)}" height="${f1(Math.max(1.5, bottom - y(b.v)))}" rx="${f1(Math.min(3, bw / 2))}" fill="${b.color}"/>`,
    )
    .join('');
  const refLines = refs
    .map(
      (r) => `<line x1="0" x2="${W}" y1="${f1(y(r.v))}" y2="${f1(y(r.v))}" stroke="${r.color}" stroke-width="1" ${r.dash ? 'stroke-dasharray="4 4"' : ''}/>
      ${r.label ? `<text x="${W - 2}" y="${f1(y(r.v) - 4)}" text-anchor="end" class="axis" fill="${r.color}">${esc(r.label)}</text>` : ''}`,
    )
    .join('');
  let path = '';
  if (line) {
    const pts = line.map((v, i) => (v == null ? null : `${f1(x(i))},${f1(y(v))}`));
    path = `<polyline class="draw" pathLength="1" points="${pts.filter(Boolean).join(' ')}" fill="none" stroke="var(--text)" stroke-opacity=".8" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${refLines}${rects}${path}${axisLabels(labels, x, height - 4, every)}
    ${unit ? `<text x="2" y="9" class="axis" text-anchor="start">${esc(unit)}</text>` : ''}
  </svg>`;
}

/** Linien mit optionalem Normalbereich (band: {lo: [], hi: []}). */
export function lines({ series, labels = [], height = 140, band = null, every = 1, unit = '', minPad = 0.08, dots = false, fixed = null }) {
  const top = 10;
  const bottom = height - 18;
  const all = series.flatMap((s) => s.values).concat(band ? [...band.lo, ...band.hi] : []).filter((v) => v != null);
  if (!all.length) return '<p class="muted small">Noch keine Daten.</p>';
  let lo = fixed ? fixed[0] : Math.min(...all);
  let hi = fixed ? fixed[1] : Math.max(...all);
  const pad = fixed ? 0 : (hi - lo || 1) * minPad;
  lo -= pad;
  hi += pad;
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const x = (i) => (n === 1 ? W / 2 : 6 + (i / (n - 1)) * (W - 12));
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const pathOf = (vals) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${f1(x(i))},${f1(y(v))}`;
      pen = true;
    });
    return d;
  };
  let bandPath = '';
  if (band) {
    const upper = band.hi.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    const lower = band.lo.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean).reverse();
    if (upper.length > 1) {
      bandPath = `<path d="M${upper.map((p) => p.map(f1).join(',')).join('L')}L${lower.map((p) => p.map(f1).join(',')).join('L')}Z" fill="var(--band)"/>`;
    }
  }
  // Weicher Farbverlauf unter der Hauptlinie (die breiteste Linie ohne Strichelung)
  const main = series.filter((s) => !s.dash).sort((a, b) => (b.width || 2) - (a.width || 2))[0];
  let area = '';
  if (main) {
    const pts = main.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (pts.length > 2) {
      const id = `g${++gradId}`;
      area = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${main.color}" stop-opacity=".28"/><stop offset="1" stop-color="${main.color}" stop-opacity="0"/></linearGradient></defs>
        <path class="area" d="M${f1(pts[0][0])},${f1(bottom)}L${pts.map((p) => p.map(f1).join(',')).join('L')}L${f1(pts[pts.length - 1][0])},${f1(bottom)}Z" fill="url(#${id})"/>`;
    }
  }
  const paths = series
    .map(
      (s) => `<path ${s.dash ? '' : 'class="draw" pathLength="1"'} d="${pathOf(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linecap="round" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="3 4"' : ''} ${s.opacity ? `stroke-opacity="${s.opacity}"` : ''}/>
      ${dots || s.dots ? s.values.map((v, i) => (v == null ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="2.2" fill="${s.color}"/>`)).join('') : ''}`,
    )
    .join('');
  const ticks = [lo + pad, hi - pad]
    .map((v) => `<text x="2" y="${f1(y(v) + (v === hi - pad ? 10 : -3))}" class="axis" text-anchor="start">${Math.round(v)}${unit ? ' ' + esc(unit) : ''}</text>`)
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${bandPath}${area}${paths}${ticks}${axisLabels(labels, x, height - 4, every)}
  </svg>`;
}

const STAGE = [
  { key: 3, label: 'Wach', color: 'var(--awake)' },
  { key: 2, label: 'REM', color: 'var(--rem)' },
  { key: 1, label: 'Leicht', color: 'var(--light)' },
  { key: 0, label: 'Tief', color: 'var(--deep)' },
];

/** Schlafphasen-Verlauf. levels: [[startMin, endMin, level], …] ab Einschlafen. */
export function hypnogram(levels, bedMin, clock) {
  const height = 150;
  const left = 44;
  const top = 6;
  const rowH = 30;
  const end = Math.max(...levels.map((l) => l[1]));
  const x = (m) => left + (m / end) * (W - left - 4);
  const rowY = (lvl) => top + STAGE.findIndex((s) => s.key === lvl) * rowH;
  const rects = levels
    .map(([s, e, lvl]) => {
      const st = STAGE.find((x2) => x2.key === lvl);
      return `<rect x="${f1(x(s))}" y="${rowY(lvl) + 4}" width="${f1(Math.max(1, x(e) - x(s)))}" height="${rowH - 8}" rx="2" fill="${st.color}"/>`;
    })
    .join('');
  const labels = STAGE.map((s) => `<text x="0" y="${rowY(s.key) + rowH / 2 + 4}" class="axis" text-anchor="start">${s.label}</text>`).join('');
  const hours = [];
  const first = Math.ceil(bedMin / 60) * 60;
  for (let t = first; t < bedMin + end; t += 120) {
    hours.push(`<text x="${f1(x(t - bedMin))}" y="${height - 4}" class="axis" text-anchor="middle">${clock(t)}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Schlafphasen">${labels}${rects}${hours.join('')}</svg>`;
}

/** Tagespuls mit Zonenfarben. series: [[minuteOfDay, bpm], …] */
export function hrCurve(series, zones, colors) {
  const height = 150;
  const top = 8;
  const bottom = height - 18;
  const vals = series.map((p) => p[1]);
  const lo = Math.min(...vals) - 6;
  const hi = Math.max(...vals, zones[0].lo) + 8;
  const x = (m) => (m / 1440) * W;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const color = (v) => {
    for (let z = 4; z >= 0; z--) if (v >= zones[z].lo) return colors[z];
    return 'var(--muted)';
  };
  const segs = [];
  for (let k = 1; k < series.length; k++) {
    const [m0, v0] = series[k - 1];
    const [m1, v1] = series[k];
    if (m1 - m0 > 30) continue;
    segs.push(`<line x1="${f1(x(m0))}" y1="${f1(y(v0))}" x2="${f1(x(m1))}" y2="${f1(y(v1))}" stroke="${color(Math.max(v0, v1))}" stroke-width="2" stroke-linecap="round"/>`);
  }
  const grid = [zones[0].lo, zones[2].lo, zones[4].lo]
    .filter((v) => v < hi)
    .map((v) => `<line x1="0" x2="${W}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="var(--grid)" stroke-dasharray="2 4"/><text x="${W - 2}" y="${f1(y(v) - 3)}" class="axis" text-anchor="end">${v}</text>`)
    .join('');
  const hours = [0, 6, 12, 18, 24].map((h) => `<text x="${f1(Math.min(W - 10, Math.max(10, x(h * 60))))}" y="${height - 4}" class="axis" text-anchor="middle">${h}:00</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Puls im Tagesverlauf">${grid}${segs.join('')}${hours}</svg>`;
}

/** Einschlaf-/Aufwachzeiten als Balken je Nacht. nights: [{bed, wake, label}] Minuten relativ zu Mitternacht. */
export function sleepWindows(nights, clock) {
  const height = 150;
  const top = 8;
  const bottom = height - 18;
  const valid = nights.filter((n) => n.bed != null);
  if (!valid.length) return '<p class="muted small">Noch keine Daten.</p>';
  const lo = Math.floor((Math.min(...valid.map((n) => n.bed)) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(...valid.map((n) => n.wake)) + 30) / 60) * 60;
  const step = (W - 40) / nights.length;
  const bw = step * 0.55;
  const x = (i) => 40 + step * i + step / 2;
  const y = (m) => top + ((m - lo) / (hi - lo)) * (bottom - top);
  const rects = nights
    .map((n, i) => (n.bed == null ? '' : `<rect x="${f1(x(i) - bw / 2)}" y="${f1(y(n.bed))}" width="${f1(bw)}" height="${f1(y(n.wake) - y(n.bed))}" rx="3" fill="var(--sleep)" fill-opacity=".85"/>`))
    .join('');
  const ticks = [];
  for (let t = lo; t <= hi; t += 120) ticks.push(`<text x="0" y="${f1(y(t) + 4)}" class="axis" text-anchor="start">${clock(t)}</text><line x1="36" x2="${W}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="var(--grid)" stroke-dasharray="2 4"/>`);
  const labels = nights.map((n, i) => (i % 2 === 0 ? `<text x="${f1(x(i))}" y="${height - 4}" class="axis" text-anchor="middle">${esc(n.label)}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Schlafenszeiten">${ticks.join('')}${rects}${labels}</svg>`;
}
