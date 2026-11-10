// Persönliches Infekt-Modell: lernt mit jedem Infekt, den du erlebst, dein eigenes Frühwarn-Muster.
//
// Idee (wie ein Arzt, der dich über die Jahre kennenlernt):
// 1. Startwissen aus Studien: Vor einem Infekt steigen Ruhepuls und Atemfrequenz, die HRV sinkt, die
//    Hauttemperatur steigt – oft 1–3 Tage vor den ersten Symptomen (Mishra 2020 Nat Biomed Eng; Alavi
//    2022 Nat Med: 80 % der COVID-Fälle per Ruhepuls-Alarm, im Median 3 Tage vor Symptomen; Grzesiak 2021
//    JAMA Netw Open: Grippe/Erkältung per Wearable vor Symptombeginn; Natarajan 2020/2021 npj Digit Med:
//    Atemfrequenz, HRV). Risikofaktoren: kurzer Schlaf (Prather 2015 Sleep: ≤ 6 Std. etwa 4× so oft
//    erkältet) und Lastspitzen im Training (Gabbett 2016; Nieman: „offenes Fenster“ nach harter Last).
// 2. Lernen aus deinen Infekten: Für jedes Signal wird gemessen, wie stark es in den Tagen vor deinen
//    Infekten abwich. Das verschiebt die Studien-Werte Richtung deines Musters (Bayes: 2 „Studien-
//    Infekte“ + deine echten). Nach wenigen Infekten zählt vor allem dein eigenes Muster.
// 3. Störfaktoren herausrechnen: Alkohol, Reisen und harte Trainingstage senken die HRV auch ohne Infekt.
//    Wie stark bei dir, misst Puls an deinen eigenen Tagen und zieht es ab (weniger Fehlalarme).
// 4. Rückblick: Hätte das Modell deine bisherigen Infekte erkannt (ohne den jeweiligen Infekt zu kennen)?
//    Daraus Trefferquote, Vorlauf und Fehlalarme – und eine persönliche Warnschwelle.
//
// Rechnung je Tag: Abweichung jedes Signals gegen deine Basis (Median/MAD der Tage −60 … −3, ohne
// Krankheitsphasen) → zwei Nächte geglättet → Likelihood-Verhältnis „vor Infekt“ gegen „normal“
// (Normalverteilung, Verschiebung μ) → Summe (gedämpft, weil die Signale zusammenhängen) + Basisrate +
// Risikofaktoren → Wahrscheinlichkeit, dass in den nächsten Tagen ein Infekt beginnt.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const signed = (v, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits).replace('.', ',')}`;

/** Signale: Richtung zum Infekt (dir), Studien-Verschiebung in Standardabweichungen (prior), Mindest-Streuung. */
export const FEATURES = [
  { key: 'rhr', label: 'Ruhepuls', prior: 1.0, dir: 1, floor: 1.5, get: (d) => d.rhr },
  { key: 'hrv', label: 'HRV', prior: 0.8, dir: -1, floor: 0.06, get: (d) => (isNum(d.hrv) && d.hrv > 0 ? Math.log(d.hrv) : null) },
  { key: 'resp', label: 'Atemfrequenz', prior: 0.9, dir: 1, floor: 0.3, get: (d) => d.resp },
  { key: 'temp', label: 'Hauttemperatur', prior: 1.0, dir: 1, floor: 0.2, get: (d) => d.skinTemp },
  { key: 'spo2', label: 'Sauerstoff', prior: 0.4, dir: -1, floor: 0.7, get: (d) => d.stats?.spo2 },
];
const FKEYS = FEATURES.map((f) => f.key);

/** Störfaktoren der Nacht davor: Studien-Annahme, wie stark sie die Signale verschieben (in Standardabweichungen). */
export const CONFOUNDERS = [
  { key: 'alkohol', label: 'Alkohol am Abend', prior: { hrv: 0.7, rhr: 0.6, temp: 0.2 } },
  { key: 'hart', label: 'Hartes Training am Vortag', prior: { hrv: 0.4, rhr: 0.3, temp: 0.2 } },
  { key: 'unterwegs', label: 'Unterwegs / fremdes Bett', prior: { hrv: 0.3, rhr: 0.3 } },
];

const K_PRIOR = 2; // so viele „Studien-Infekte“ zählen gegen deine echten
const K_CONF = 4; // so viele „Studien-Nächte“ je Störfaktor
const DAMP = 0.8; // Signale hängen zusammen (Ruhepuls ↔ HRV): Beweiskraft gedämpft
const PRIOR_RATE = 2.5; // Infekte pro Jahr bei Erwachsenen (2–4 Erkältungen/Jahr)
const WINDOW = 3; // „Infekt beginnt in den nächsten 3 Tagen“
export const DEFAULT_THRESHOLD = 0.15;
export const LEVEL_LABELS = ['unauffällig', 'beobachten', 'erhöht', 'hoch'];

/** Labels aus App/Abruf: { pos: [{s, e?, src}], neg: [Datum], conf: { Datum: { a: Gläser, u: 1, k: 1 } } } */
function normLabels(ill) {
  const cal = (Array.isArray(ill?.cal) ? ill.cal : []).map((x) => ({ ...x, src: 'kalender' }));
  const pos = [...(Array.isArray(ill?.pos) ? ill.pos : []), ...cal]
    .filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.s))
    .map((x) => ({ s: x.s, e: /^\d{4}-\d{2}-\d{2}$/.test(x.e || '') && x.e >= x.s ? x.e : addDays(x.s, 3), src: x.src || 'user' }))
    .sort((a, b) => (a.s < b.s ? -1 : 1));
  // Überlappende Phasen zusammenfassen (z. B. „krank“ im Morgen-Check an mehreren Tagen)
  const merged = [];
  for (const x of pos) {
    const last = merged[merged.length - 1];
    if (last && x.s <= addDays(last.e, 2)) {
      last.e = x.e > last.e ? x.e : last.e;
      if (x.src === 'kalender') last.src = 'kalender';
    }
    else merged.push({ ...x });
  }
  const neg = (Array.isArray(ill?.neg) ? ill.neg : []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const conf = ill?.conf && typeof ill.conf === 'object' ? ill.conf : {};
  return { pos: merged, neg, conf };
}

/**
 * Passt das Modell an deine Tage an. ``days`` = Tage aus engine.analyze (aufsteigend, lückenlos).
 * Ergebnis: { days: [Tagesergebnis je Tag], model: Zusammenfassung fürs Lernen und die App }
 */
export function fitIllness(days, illness = {}) {
  const n = days.length;
  const L = normLabels(illness);
  const index = Object.fromEntries(days.map((d, i) => [d.date, i]));
  const idxOf = (date) => {
    if (index[date] != null) return index[date];
    if (!n || date < days[0].date || date > days[n - 1].date) return null;
    return null;
  };

  // Infekt-Phasen (Beginn = erster Symptomtag) und Tage, die nicht in die Basis gehören
  const episodes = L.pos.map((x) => ({ ...x, o: idxOf(x.s), end: idxOf(x.e) ?? (idxOf(x.s) != null ? Math.min(n - 1, idxOf(x.s) + 3) : null) })).filter((x) => x.o != null);
  const excluded = new Uint8Array(n);
  for (const e of episodes) for (let k = Math.max(0, e.o - 3); k <= Math.min(n - 1, e.end + 5); k++) excluded[k] = 1;
  const isPre = (k) => episodes.some((e) => k >= e.o - 3 && k <= e.end);

  // 1) Rohwerte und Basis je Tag → Abweichung (orientiert: positiv = Richtung Infekt)
  const raw = FEATURES.map((f) => days.map((d) => {
    const v = f.get(d);
    return isNum(v) ? v : null;
  }));
  const z = FEATURES.map(() => new Array(n).fill(null));
  const baseInfo = FEATURES.map(() => new Array(n).fill(null));
  FEATURES.forEach((f, fi) => {
    for (let i = 0; i < n; i++) {
      const v = raw[fi][i];
      if (v == null) continue;
      const hist = [];
      for (let k = Math.max(0, i - 60); k <= i - 3; k++) if (!excluded[k] && raw[fi][k] != null) hist.push(raw[fi][k]);
      if (hist.length < 10) continue;
      const med = median(hist);
      const mad = median(hist.map((x) => Math.abs(x - med))) * 1.4826;
      const sdv = Math.max(f.floor, mad || 0);
      z[fi][i] = clamp((f.dir * (v - med)) / sdv, -4, 6);
      baseInfo[fi][i] = { med, sd: sdv };
    }
  });

  // 2) Störfaktoren je Tag (Verhalten am Vortag wirkt auf die Nacht)
  const strains = days.map((d) => (isNum(d.strain) ? d.strain : null));
  const confOn = days.map((d, i) => {
    const y = addDays(d.date, -1);
    const c = L.conf[y] || {};
    const out = {};
    if ((c.a || 0) > 0) out.alkohol = Math.min(2, c.a) / 2 + 0.25; // 1 Glas 0,75 · ab 2 Gläsern 1,25 (Faktor)
    if (c.u) out.unterwegs = 1;
    if (i > 0 && strains[i - 1] != null) {
      const hist = strains.slice(Math.max(0, i - 61), i - 1).filter(isNum);
      if (hist.length >= 14) {
        const p85 = [...hist].sort((a, b) => a - b)[Math.floor(hist.length * 0.85)];
        if (strains[i - 1] >= Math.max(12, p85)) out.hart = 1;
      }
    }
    return out;
  });
  // Persönliche Wirkung je Störfaktor: Ø Abweichung an solchen Morgen (ohne Krankheit, ohne anderen Störfaktor)
  const confEffect = {};
  for (const c of CONFOUNDERS) {
    confEffect[c.key] = {};
    for (const [fi, f] of FEATURES.entries()) {
      const pr = c.prior[f.key] || 0;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const on = confOn[i];
        if (!on[c.key] || Object.keys(on).length > 1 || excluded[i] || z[fi][i] == null) continue;
        xs.push(z[fi][i] / on[c.key]);
      }
      const post = (K_CONF * pr + xs.reduce((s, x) => s + x, 0)) / (K_CONF + xs.length);
      confEffect[c.key][f.key] = { prior: pr, post: clamp(post, 0, 2.5), n: xs.length };
    }
  }
  const adj = FEATURES.map((f, fi) =>
    z[fi].map((v, i) => {
      if (v == null) return null;
      let shift = 0;
      for (const [k, w] of Object.entries(confOn[i])) shift += (confEffect[k]?.[f.key]?.post || 0) * w;
      return v > 0 ? Math.max(0, v - shift) : v;
    }),
  );
  // Zwei Nächte geglättet: Infekte zeigen sich über mehrere Nächte, Ausreißer nur in einer
  const sm = adj.map((arr) =>
    arr.map((v, i) => {
      if (v == null) return null;
      const prev = i > 0 ? arr[i - 1] : null;
      return prev == null ? v * 0.85 : 0.65 * v + 0.35 * prev;
    }),
  );

  // 3) Lernen: Wie stark weicht jedes Signal rund um deinen Infektbeginn ab (Ø Vortag, Beginn, Folgetag –
  //    ein Tag Unschärfe beim Beginn schadet so kaum; ein Durchschnitt statt der stärksten Tage, damit
  //    Zufallsschwankungen ein Signal nicht wichtiger machen, als es ist). Ob es früh genug kommt, prüft
  //    danach der Rückblick.
  const learnMu = (skip = -1) => {
    const mu = {};
    FEATURES.forEach((f, fi) => {
      const obs = [];
      episodes.forEach((e, ei) => {
        if (ei === skip) return;
        const xs = [];
        for (let k = Math.max(0, e.o - 1); k <= Math.min(n - 1, e.o + 1); k++) if (sm[fi][k] != null) xs.push(sm[fi][k]);
        if (xs.length >= 2) obs.push(mean(xs));
      });
      const post = (K_PRIOR * f.prior + obs.reduce((s, x) => s + x, 0)) / (K_PRIOR + obs.length);
      mu[f.key] = { prior: f.prior, post: clamp(post, 0.1, 3), n: obs.length, mean: obs.length ? mean(obs) : null };
    });
    return mu;
  };
  const mu = learnMu();

  // Basisrate: Studien 2,5 Infekte/Jahr + deine beobachtete Häufigkeit
  const dataDays = days.filter((d) => isNum(d.rhr) || isNum(d.hrv)).length;
  const years = dataDays / 365;
  const rate = (PRIOR_RATE * 1 + episodes.length) / (1 + years);
  const base = 1 - Math.exp((-rate * WINDOW) / 365);

  // Risikofaktoren (Anfälligkeit): Schlafmangel, Lastspitze
  const modifiers = (i) => {
    const out = [];
    const sl = [];
    for (let k = Math.max(0, i - 2); k <= i; k++) if (isNum(days[k].sleepMin)) sl.push(days[k].sleepMin);
    if (sl.length >= 2) {
      const avg = mean(sl);
      if (avg < 360) out.push({ key: 'sleep', or: 2.5, text: `Wenig Schlaf: Ø ${(avg / 60).toFixed(1).replace('.', ',')} Std. in den letzten Nächten` });
      else if (avg < 420) out.push({ key: 'sleep', or: 1.4, text: `Etwas zu wenig Schlaf: Ø ${(avg / 60).toFixed(1).replace('.', ',')} Std.` });
    }
    const ratio = days[i].load?.ratio;
    if (ratio > 1.5) out.push({ key: 'load', or: 1.8, text: 'Lastspitze: deutlich mehr Training als in den Wochen davor' });
    else if (ratio > 1.3) out.push({ key: 'load', or: 1.3, text: 'Mehr Training als gewohnt' });
    return out;
  };

  // 4) Wahrscheinlichkeit je Tag
  const dayP = (i, m = mu) => {
    let sum = 0;
    let used = 0;
    const parts = [];
    FEATURES.forEach((f, fi) => {
      const x = sm[fi][i];
      if (x == null) return;
      used++;
      const u = m[f.key].post;
      const xc = clamp(x, -2, 5);
      const llr = Math.max(-0.6, u * xc - (u * u) / 2);
      sum += llr;
      parts.push({ key: f.key, fi, x, llr });
    });
    if (used < 2) return { p: null, parts, mods: [] };
    const mods = modifiers(i);
    const lo = logit(base) + DAMP * sum + mods.reduce((s, x) => s + Math.log(x.or), 0);
    return { p: sigmoid(lo), parts, mods };
  };
  const P = days.map((_, i) => dayP(i));

  // 5) Rückblick (ohne den jeweiligen Infekt gelernt) und persönliche Schwelle
  const looP = episodes.map((e, ei) => {
    const m = learnMu(ei);
    const out = {};
    for (let k = Math.max(0, e.o - 3); k <= e.o; k++) out[k] = dayP(k, m).p;
    return out;
  });
  const negIdx = new Set(L.neg.map(idxOf).filter((x) => x != null));
  const evaluate = (th) => {
    let hits = 0;
    const leads = [];
    episodes.forEach((e, ei) => {
      let first = null;
      for (let k = Math.max(0, e.o - 3); k <= e.o; k++) if ((looP[ei][k] ?? 0) >= th && first == null) first = k;
      if (first != null) {
        hits++;
        leads.push(e.o - first);
      }
    });
    // Fehlalarme: Warn-Phasen ohne Infekt in den Tagen danach
    let fa = 0;
    let evalDays = 0;
    for (let i = 0; i < n; i++) {
      if (P[i].p == null) continue;
      evalDays++;
      const alert = P[i].p >= th && !(i > 0 && (P[i - 1].p ?? 0) >= th);
      if (!alert) continue;
      const near = episodes.some((e) => i >= e.o - 4 && i <= e.end + 3);
      if (!near && i <= n - 4) fa++;
    }
    return { th, hits, n: episodes.length, leads, lead: leads.length ? mean(leads) : null, fa, evalDays, faMonth: evalDays ? (fa * 30) / evalDays : 0 };
  };
  let threshold = DEFAULT_THRESHOLD;
  let tuned = false;
  if (episodes.length >= 2) {
    let best = null;
    for (const th of [0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3]) {
      const r = evaluate(th);
      const score = r.hits / Math.max(1, r.n) - 0.25 * r.faMonth;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && th > best.th)) best = { score, th };
    }
    threshold = best.th;
    tuned = true;
  }
  const th1 = threshold / 2;
  const th3 = Math.max(0.4, threshold * 2.5);
  const backtest = evaluate(threshold);

  // 6) Muster deiner früheren Infekte (für den Vergleich „so sah es letztes Mal aus“)
  // Profil der letzten Tage: Wie weit ist jedes Signal verschoben (Ø 3 Tage) und steigt es an?
  const vec = (i) => {
    const v = {};
    FEATURES.forEach((f, fi) => {
      const xs = [];
      for (let k = Math.max(0, i - 2); k <= i; k++) if (sm[fi][k] != null) xs.push(sm[fi][k]);
      if (xs.length >= 2) v[`${f.key}m`] = clamp(mean(xs), -3, 5);
      if (i >= 3 && adj[fi][i] != null && adj[fi][i - 3] != null) v[`${f.key}s`] = clamp((adj[fi][i] - adj[fi][i - 3]) / 2, -3, 3);
    });
    return v;
  };
  // Vergleich mit den Tagen um deine früheren Infekte (Fenster endet 2 Tage vorher … 1 Tag danach)
  const patterns = [];
  for (const e of episodes) for (let off = -2; off <= 1; off++) if (e.o + off >= 3 && e.o + off < n) patterns.push({ date: e.s, o: e.o, before: -off, v: vec(e.o + off) });
  const matchFor = (i) => {
    if (i < 3 || !patterns.length) return null;
    const cur = vec(i);
    let best = null;
    for (const pt of patterns) {
      if (pt.o + 6 >= i) continue; // nur abgeschlossene, frühere Infekte
      const keys = Object.keys(cur).filter((k) => k in pt.v);
      if (keys.length < 4) continue;
      const dot = keys.reduce((s, k) => s + cur[k] * pt.v[k], 0);
      const na = Math.sqrt(keys.reduce((s, k) => s + cur[k] ** 2, 0));
      const nb = Math.sqrt(keys.reduce((s, k) => s + pt.v[k] ** 2, 0));
      if (!na || !nb) continue;
      const sim = (dot / (na * nb)) * (Math.min(na, nb) / Math.max(na, nb)) ** 0.3; // Richtung und Stärke
      const mag = keys.filter((k) => k.endsWith('m')).reduce((s, k) => s + Math.max(0, cur[k]), 0) / Math.max(1, keys.filter((k) => k.endsWith('m')).length);
      if (mag >= 0.35 && (!best || sim > best.sim)) best = { date: pt.date, sim, before: pt.before };
    }
    return best && best.sim >= 0.7 ? best : null;
  };

  // 7) Was bei dir zuerst anschlägt, und was deinen Infekten vorausging
  const earliest = FEATURES.map((f, fi) => {
    const hits = [];
    for (const e of episodes) {
      let first = null;
      for (let k = Math.max(0, e.o - 3); k <= e.o; k++) if (sm[fi][k] != null && sm[fi][k] >= 1 && first == null) first = e.o - k;
      if (first != null) hits.push(first);
    }
    return { key: f.key, label: f.label, hits: hits.length, of: episodes.filter((e) => sm[fi].slice(Math.max(0, e.o - 3), e.o + 1).some((x) => x != null)).length, lead: hits.length ? mean(hits) : null };
  })
    .filter((x) => x.of > 0)
    .sort((a, b) => b.hits / b.of - a.hits / a.of || (b.lead ?? 0) - (a.lead ?? 0));
  const before = (pred) => {
    const yes = episodes.filter((e) => pred(e.o)).length;
    let all = 0;
    let cnt = 0;
    for (let i = 7; i < n; i++) {
      if (excluded[i]) continue;
      cnt++;
      if (pred(i)) all++;
    }
    return { yes, of: episodes.length, share: cnt ? all / cnt : null };
  };
  const shortSleepWeek = (o) => {
    const xs = days.slice(Math.max(0, o - 7), o).map((d) => d.sleepMin).filter(isNum);
    return xs.length >= 4 && mean(xs) < 390;
  };
  const loadSpike = (o) => days.slice(Math.max(0, o - 7), o).some((d) => d.load?.ratio > 1.4);
  const triggers = episodes.length >= 2 ? [{ key: 'sleep', label: 'Woche mit < 6,5 Std. Schlaf', ...before(shortSleepWeek) }, { key: 'load', label: 'Lastspitze im Training', ...before(loadSpike) }] : [];

  // 8) Fragen zum Lernen: auffällige Phasen ohne Antwort
  const lastI = n - 1;
  const candidates = [];
  for (let i = Math.max(1, n - 150); i <= lastI - 2; i++) {
    const p = P[i].p;
    if (p == null || p < threshold || (P[i - 1].p ?? 0) >= threshold) continue;
    let run = 1;
    let peak = p;
    while (i + run <= lastI && (P[i + run].p ?? 0) >= threshold) {
      peak = Math.max(peak, P[i + run].p);
      run++;
    }
    if (run < 2 && peak < th3) continue;
    const date = days[i].date;
    if (episodes.some((e) => i >= e.o - 6 && i <= e.end + 5)) continue;
    if ([...negIdx].some((k) => Math.abs(k - i) <= 4)) continue;
    const top = P[i + run - 1].parts.filter((x) => x.llr > 0.3).sort((a, b) => b.llr - a.llr).map((x) => FEATURES[x.fi].label);
    candidates.push({ date, days: run, peak, signals: top.slice(0, 2), recent: lastI - i <= 7 });
  }
  candidates.reverse();

  // 9) Tagesergebnis mit Erklärung
  const describe = (fi, i) => {
    const f = FEATURES[fi];
    const b = baseInfo[fi][i];
    const v = raw[fi][i];
    if (!b || v == null) return '';
    if (f.key === 'hrv') return `HRV ${signed(100 * (Math.exp(v - b.med) - 1))} % gegenüber deinem Normalwert`;
    if (f.key === 'rhr') return `Ruhepuls ${signed(v - b.med)} bpm über deinem Normalwert`;
    if (f.key === 'resp') return `Atemfrequenz ${signed(v - b.med, 1)} Atemzüge/Min. gegenüber normal`;
    if (f.key === 'temp') return `Hauttemperatur ${signed(v - b.med, 1)} °C gegenüber normal`;
    return `Sauerstoffsättigung ${signed(v - b.med, 1)} %-Punkte gegenüber normal`;
  };
  const levelOf = (p) => (p == null ? 0 : p >= th3 ? 3 : p >= threshold ? 2 : p >= th1 ? 1 : 0);
  const out = days.map((d, i) => {
    const r = P[i];
    const level = levelOf(r.p);
    const signals = r.parts
      .filter((x) => x.llr > 0.25 && x.x >= 0.8)
      .sort((a, b) => b.llr - a.llr)
      .map((x) => ({ key: FEATURES[x.fi].key, label: FEATURES[x.fi].label, text: describe(x.fi, i), value: x.x, llr: x.llr, pts: x.llr >= 1.2 ? 2 : 1 }));
    const against = r.parts.filter((x) => x.x <= -0.8).map((x) => `${FEATURES[x.fi].label} besser als normal`);
    const confounders = Object.keys(confOn[i]).map((k) => {
      const c = CONFOUNDERS.find((y) => y.key === k);
      const e = confEffect[k];
      const hrvShift = e?.hrv?.n >= 3 ? ` (bei dir im Schnitt ${e.hrv.post.toFixed(1).replace('.', ',')} SD tiefere HRV – herausgerechnet)` : ' (herausgerechnet)';
      return { key: k, label: c.label, text: `${c.label}${hrvShift}` };
    });
    return {
      p: r.p,
      base,
      rel: r.p != null ? r.p / base : null,
      level,
      label: LEVEL_LABELS[level],
      score: r.p == null ? 0 : Math.round(r.p * 100),
      signals,
      against,
      confounders,
      modifiers: r.mods,
      match: level >= 1 ? matchFor(i) : null,
      calibrating: r.p == null,
      pre: isPre(i),
    };
  });

  const recentSd = (key) => {
    const fi = FKEYS.indexOf(key);
    const xs = baseInfo[fi].slice(-30).filter(Boolean).map((b) => b.sd);
    return xs.length ? median(xs) : null;
  };
  return {
    days: out,
    model: {
      scale: { hrv: recentSd('hrv'), rhr: recentSd('rhr'), resp: recentSd('resp') },
      episodes: episodes.map((e) => ({ s: e.s, e: e.e, src: e.src })),
      negatives: L.neg,
      mu,
      confEffect,
      base,
      rate,
      threshold,
      tuned,
      levels: [th1, threshold, th3],
      backtest,
      earliest,
      triggers,
      candidates,
      dataDays,
    },
  };
}

/** Kurzfassung für den Coach/Tagesbericht. */
export function illnessBlock(model, i = model.days.length - 1) {
  const d = model.days[i];
  const m = model.illness;
  if (!m || !d?.ill) return '';
  const L = ['## Persönliches Infekt-Modell (lernt aus deinen Infekten)'];
  const x = d.ill;
  if (x.p != null) L.push(`Heute: Infekt-Risiko ${Math.round(x.p * 100)} % für die nächsten 3 Tage (${(x.rel ?? 1).toFixed(1).replace('.', ',')}× deine Basis von ${Math.round(m.base * 100)} %), Stufe ${x.label}.`);
  if (x.signals.length) L.push(`Signale: ${x.signals.map((s) => s.text).join('; ')}.`);
  if (x.confounders.length) L.push(`Herausgerechnet: ${x.confounders.map((c) => c.label).join(', ')}.`);
  if (x.modifiers.length) L.push(`Anfälligkeit: ${x.modifiers.map((c) => c.text).join('; ')}.`);
  if (x.match) L.push(`Muster ähnelt ${x.match.before > 0 ? `${x.match.before} Tag(en) vor` : x.match.before === 0 ? 'dem Beginn von' : 'dem Verlauf von'} deinem Infekt am ${x.match.date} (Ähnlichkeit ${Math.round(x.match.sim * 100)} %).`);
  L.push(`Gelernt aus ${m.episodes.length} Infekt${m.episodes.length === 1 ? '' : 'en'}${m.episodes.length ? `; Rückblick: ${m.backtest.hits} von ${m.backtest.n} vorher erkannt${m.backtest.lead != null ? `, Ø ${m.backtest.lead.toFixed(1).replace('.', ',')} Tage Vorlauf` : ''}, ${m.backtest.fa} Fehlalarm${m.backtest.fa === 1 ? '' : 'e'} in ${m.backtest.evalDays} Tagen` : ''}.`);
  const early = m.earliest.filter((e) => e.hits);
  if (early.length) L.push(`Bei dir schlägt zuerst an: ${early.slice(0, 2).map((e) => `${e.label} (${e.hits}/${e.of})`).join(', ')}.`);
  return L.join('\n');
}
