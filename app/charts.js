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
  const style = glow && frac > 0 ? ` style="filter:drop-shadow(0 0 ${Math.round(size / 16)}px ${color})"` : '';
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${esc(sub)}"${style}>
    <circle cx="${mid}" cy="${mid}" r="${f1(r)}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    ${valArc}
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
        : `<rect x="${f1(x(i) - bw / 2)}" y="${f1(y(b.v))}" width="${f1(bw)}" height="${f1(Math.max(1.5, bottom - y(b.v)))}" rx="${f1(Math.min(3, bw / 2))}" fill="${b.color}"/>`,
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
    path = `<polyline points="${pts.filter(Boolean).join(' ')}" fill="none" stroke="var(--text)" stroke-opacity=".8" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${refLines}${rects}${path}${axisLabels(labels, x, height - 4, every)}
    ${unit ? `<text x="2" y="9" class="axis" text-anchor="start">${esc(unit)}</text>` : ''}
  </svg>`;
}

/** Linien mit optionalem Normalbereich (band: {lo: [], hi: []}). */
export function lines({ series, labels = [], height = 140, band = null, every = 1, unit = '', minPad = 0.08, dots = false }) {
  const top = 10;
  const bottom = height - 18;
  const all = series.flatMap((s) => s.values).concat(band ? [...band.lo, ...band.hi] : []).filter((v) => v != null);
  if (!all.length) return '<p class="muted small">Noch keine Daten.</p>';
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo || 1) * minPad;
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
  const paths = series
    .map(
      (s) => `<path d="${pathOf(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linecap="round" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="3 4"' : ''} ${s.opacity ? `stroke-opacity="${s.opacity}"` : ''}/>
      ${dots || s.dots ? s.values.map((v, i) => (v == null ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="2.2" fill="${s.color}"/>`)).join('') : ''}`,
    )
    .join('');
  const ticks = [lo + pad, hi - pad]
    .map((v) => `<text x="2" y="${f1(y(v) + (v === hi - pad ? 10 : -3))}" class="axis" text-anchor="start">${Math.round(v)}${unit ? ' ' + esc(unit) : ''}</text>`)
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${bandPath}${paths}${ticks}${axisLabels(labels, x, height - 4, every)}
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
