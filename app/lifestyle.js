// Lifestyle-Log: Verhalten per Knopfdruck festhalten (mit Uhrzeit) und auswerten, wie es deine
// nächste Nacht beeinflusst – Recovery, HRV, Ruhepuls, Tiefschlaf und Schlaf.
//
// Speicherformat im Morgen-Check (bleibt auf dem Gerät): journal[Datum] = {
//   alkohol: true, koffein: true, …          (Ja/Nein wie bisher)
//   _t: { koffein: ['07:30', '18:05'], … }   (Uhrzeiten aus dem Schnell-Log)
//   _done: true                               (Morgen-Check ausgefüllt: fehlende Angaben = Nein)
// }
// Verhalten an Tag D wirkt auf die Nacht D→D+1, also auf die Recovery am Morgen von D+1.
//
// Hintergrund für die Texte: Koffein hat eine Halbwertszeit von etwa 5 Stunden; 400 mg sogar 6 Std.
// vor dem Schlafen verkürzen den Schlaf messbar (Drake 2013). Alkohol senkt HRV und Tiefschlaf und
// hebt den Ruhepuls dosisabhängig (Pietilä 2018). Spätes Essen hebt den nächtlichen Puls.

import { addDays, isNum, mean, sd } from './engine.js';

export const BEHAVIORS = [
  { id: 'koffein', label: 'Kaffee', ask: 'Kaffee nach 14 Uhr', icon: 'coffee', mode: 'count', unit: ['Tasse', 'Tassen'], late: 14 * 60 },
  { id: 'alkohol', label: 'Alkohol', ask: 'Alkohol', icon: 'wine', mode: 'count', unit: ['Glas', 'Gläser'] },
  { id: 'spaetessen', label: 'Spät gegessen', ask: 'Spät gegessen', icon: 'meal', mode: 'time' },
  { id: 'bildschirm', label: 'Handy im Bett', ask: 'Handy im Bett', icon: 'phone', mode: 'bool' },
  { id: 'stress', label: 'Stress', ask: 'Stressiger Tag', icon: 'stress', mode: 'bool' },
  { id: 'sauna', label: 'Sauna', ask: 'Sauna', icon: 'sauna', mode: 'time' },
  { id: 'kalt', label: 'Kälte', ask: 'Kalte Dusche / Eisbad', icon: 'cold', mode: 'time' },
  { id: 'meditation', label: 'Meditation', ask: 'Meditation / Atemübung', icon: 'lotus', mode: 'time' },
  { id: 'nickerchen', label: 'Nickerchen', ask: 'Nickerchen', icon: 'nap', mode: 'time' },
  { id: 'magnesium', label: 'Magnesium', ask: 'Magnesium', icon: 'pill', mode: 'bool' },
  { id: 'unterwegs', label: 'Unterwegs', ask: 'Unterwegs / fremdes Bett', icon: 'bag', mode: 'bool' },
  { id: 'sex', label: 'Sex', ask: 'Sex', icon: 'heart', mode: 'bool' },
  { id: 'krank', label: 'Angeschlagen', ask: 'Krank / angeschlagen', icon: 'thermo', mode: 'bool' },
];
export const byId = Object.fromEntries(BEHAVIORS.map((b) => [b.id, b]));

const WHY = {
  koffein: 'Koffein blockiert den Müdigkeitsstoff Adenosin; nach rund 5 Stunden ist erst die Hälfte abgebaut.',
  alkohol: 'Alkohol beschleunigt nachts den Puls, senkt die HRV und raubt Tief- und REM-Schlaf.',
  spaetessen: 'Verdauen in der Nacht hält den Puls hoch – der Körper erholt sich weniger.',
  bildschirm: 'Licht und Inhalte halten das Gehirn wach und verschieben das Einschlafen.',
  stress: 'Stress hält das Nervensystem im „Alarm“ – die HRV sinkt, der Schlaf wird leichter.',
  sauna: 'Sauna entspannt und kann die HRV heben; direkt vor dem Schlafen ist der Körper noch zu warm.',
  kalt: 'Kälte aktiviert kurz stark und kann danach die Entspannung fördern.',
  meditation: 'Ruhiges Atmen aktiviert den Erholungsnerv (Vagus) – oft steigt die HRV.',
  nickerchen: 'Kurze Nickerchen (bis 20 Min., vor 15 Uhr) helfen; lange oder späte stören die Nacht.',
  magnesium: 'Die Studienlage ist gemischt – deine Daten zeigen, ob es dir hilft.',
  unterwegs: 'Fremdes Bett, andere Zeiten: die erste Nacht woanders ist oft schlechter.',
  sex: 'Kann entspannen und das Einschlafen erleichtern.',
  krank: 'Ein Infekt senkt HRV und hebt Ruhepuls und Atmung.',
};
export const why = (id) => WHY[id] || '';

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const round1 = (v) => Math.round(v * 10) / 10;

/** Tag, zu dem ein Eintrag „jetzt“ gehört: nach Mitternacht bis 4 Uhr zählt noch der Vortag. */
export function logDate(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Eintrag mit Uhrzeit hinzufügen; Ja/Nein-Felder passend setzen. Gibt den neuen Tageseintrag zurück. */
export function addLog(entry, id, time) {
  const e = { ...(entry || {}), _t: { ...(entry?._t || {}) } };
  const list = [...(e._t[id] || []), time].sort();
  e._t[id] = list;
  derive(e, id);
  return e;
}

/** Einen Zeitpunkt wieder entfernen. */
export function removeLog(entry, id, time) {
  const e = { ...(entry || {}), _t: { ...(entry?._t || {}) } };
  const list = (e._t[id] || []).filter((t, k, arr) => !(t === time && arr.indexOf(time) === k));
  if (list.length) e._t[id] = list;
  else delete e._t[id];
  derive(e, id);
  return e;
}

function derive(e, id) {
  const times = (e._t?.[id] || []).map(toMin).filter(isNum);
  const b = byId[id];
  if (!b) return;
  if (b.late != null) {
    // „Kaffee nach 14 Uhr“: Ja nur bei später Tasse; frühe Tassen allein sind kein Ja
    if (times.some((m) => m >= b.late)) e[id] = true;
    else if (e._done) e[id] = false;
    else delete e[id];
  } else if (times.length) e[id] = true;
  else if (!e._done) delete e[id];
}

/** Uhrzeiten (Minuten) eines Verhaltens an einem Tag. */
export const timesOf = (entry, id) => (entry?._t?.[id] || []).map(toMin).filter(isNum).sort((a, b) => a - b);

// ---------------------------------------------------------------- Auswertung

const METRICS = [
  { key: 'recovery', label: 'Recovery', unit: '%', get: (x) => x.recovery, good: 1, digits: 0 },
  { key: 'hrv', label: 'HRV', unit: 'ms', get: (x) => x.hrv, good: 1, digits: 0 },
  { key: 'rhr', label: 'Ruhepuls', unit: 'bpm', get: (x) => x.rhr, good: -1, digits: 1 },
  { key: 'deep', label: 'Tiefschlaf', unit: '%-Pkt.', get: (x) => x.stages?.deep, good: 1, digits: 1 },
  { key: 'perf', label: 'Schlaf', unit: '%', get: (x) => x.perf, good: 1, digits: 0 },
];

function compare(yes, no) {
  const out = {};
  for (const m of METRICS) {
    const a = yes.map(m.get).filter(isNum);
    const b = no.map(m.get).filter(isNum);
    if (a.length < 3 || b.length < 3) continue;
    const diff = mean(a) - mean(b);
    const se = Math.sqrt((sd(a) ?? 0) ** 2 / a.length + (sd(b) ?? 0) ** 2 / b.length) || 1;
    out[m.key] = { diff, t: diff / se, label: m.label, unit: m.unit, good: m.good, digits: m.digits };
  }
  return out;
}

/** Nacht nach dem Verhaltenstag (Recovery am Morgen danach). */
function nightAfter(model, date) {
  const idx = model.index?.[addDays(date, 1)];
  const x = idx != null ? model.days[idx] : null;
  return x && x.recovery != null ? x : null;
}

/**
 * Persönliche Einflüsse: für jedes Verhalten Nächte mit gegen ohne (je mindestens 3), dazu bei
 * Kaffee die persönliche Uhrzeit-Grenze und bei Alkohol die Dosis.
 */
export function lifestyleInsights(model, journal = {}, extra = []) {
  const list = [...BEHAVIORS, ...extra.map((q) => ({ id: q.id, label: q.label, ask: q.label, icon: 'custom', mode: 'bool' }))];
  const items = [];
  for (const b of list) {
    const yes = [];
    const no = [];
    for (const [date, e] of Object.entries(journal || {})) {
      if (!e) continue;
      const logged = (e._t?.[b.id] || []).length > 0;
      if (!e._done && !logged) continue;
      const x = nightAfter(model, date);
      if (!x) continue;
      (e[b.id] ? yes : no).push(x);
    }
    const eff = compare(yes, no);
    const rec = eff.recovery;
    if (rec) {
      const strong = Object.values(eff).filter((v) => Math.abs(v.t) >= 1.5);
      items.push({ ...b, ny: yes.length, nn: no.length, effects: eff, diff: rec.diff, solid: Math.abs(rec.t) >= 1.5 || strong.length >= 2, why: why(b.id) });
    } else if (yes.length || b.mode !== 'bool') {
      items.push({ ...b, pending: true, ny: yes.length, nn: no.length, need: Math.max(0, 3 - yes.length) + Math.max(0, 3 - no.length), why: why(b.id) });
    }
  }
  items.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || Math.abs(b.diff || 0) - Math.abs(a.diff || 0));
  return { items, caffeine: caffeineCutoff(model, journal), alcohol: alcoholDose(model, journal), meal: lateMeal(model, journal) };
}

/** Ab welcher Uhrzeit Kaffee deiner Nacht schadet: beste Trennung später/früher (je ≥ 3 Nächte). */
export function caffeineCutoff(model, journal = {}) {
  const nights = [];
  for (const [date, e] of Object.entries(journal || {})) {
    const x = nightAfter(model, date);
    if (!x) continue;
    const t = timesOf(e, 'koffein');
    if (t.length) nights.push({ last: t[t.length - 1], x });
    else if (e?._done && !e.koffein) nights.push({ last: null, early14: true, x }); // kein Kaffee nach 14 Uhr
  }
  const cands = [];
  for (let h = 12; h <= 19; h++) {
    const T = h * 60;
    const late = nights.filter((n) => n.last != null && n.last >= T).map((n) => n.x);
    const early = nights.filter((n) => (n.last != null ? n.last < T : n.early14 && T >= 14 * 60)).map((n) => n.x);
    const eff = compare(late, early);
    if (eff.recovery) cands.push({ hour: h, drop: -eff.recovery.diff, effects: eff, nLate: late.length, nEarly: early.length });
  }
  // Gleich gute Grenzen: die späteste nehmen – sie ist die weniger strenge Regel, die deine Daten stützen
  const top = Math.max(...cands.map((c) => c.drop));
  const best = cands.filter((c) => c.drop >= top - 0.5).pop() || null;
  const logged = nights.filter((n) => n.last != null).length;
  if (!best || best.drop < 3) return { cutoff: null, logged, nights: nights.length };
  return { cutoff: best.hour, drop: Math.round(best.drop), deep: best.effects.deep ? round1(-best.effects.deep.diff) : null, hrv: best.effects.hrv ? Math.round(-best.effects.hrv.diff) : null, nLate: best.nLate, nEarly: best.nEarly, logged, nights: nights.length };
}

/** Alkohol nach Menge: kein, 1 Glas, ab 2 Gläsern. */
export function alcoholDose(model, journal = {}) {
  const g = { 0: [], 1: [], 2: [] };
  for (const [date, e] of Object.entries(journal || {})) {
    const x = nightAfter(model, date);
    if (!x) continue;
    // Menge nur, wenn die Gläser einzeln geloggt sind; „Ja“ ohne Anzahl ist unklar
    const n = timesOf(e, 'alkohol').length;
    if (e?.alkohol && !n) continue;
    if (!e?._done && !n) continue;
    g[Math.min(2, n)].push(x);
  }
  const avg = (xs, f) => {
    const v = xs.map(f).filter(isNum);
    return v.length >= 3 ? mean(v) : null;
  };
  const base = avg(g[0], (x) => x.recovery);
  const out = [1, 2].map((k) => {
    const rec = avg(g[k], (x) => x.recovery);
    const hrv = avg(g[k], (x) => x.hrv);
    const hrv0 = avg(g[0], (x) => x.hrv);
    return { drinks: k, n: g[k].length, recovery: base != null && rec != null ? Math.round(rec - base) : null, hrv: hrv0 != null && hrv != null ? Math.round(hrv - hrv0) : null };
  });
  return { none: g[0].length, groups: out };
}

/** Letzte Mahlzeit: weniger als 3 Std. vor dem Schlafen gegen früher – Ruhepuls und Recovery. */
export function lateMeal(model, journal = {}) {
  const close = [];
  const early = [];
  for (const [date, e] of Object.entries(journal || {})) {
    const x = nightAfter(model, date);
    const t = timesOf(e, 'spaetessen');
    if (!x || !t.length || !isNum(x.sleep?.bed)) continue;
    const bed = 1440 + x.sleep.bed; // Schlafbeginn relativ zur Mitternacht des Aufwachtags → Minuten am Verhaltenstag
    (bed - t[t.length - 1] < 180 ? close : early).push(x);
  }
  const eff = compare(close, early);
  return eff.recovery ? { n: close.length, m: early.length, recovery: Math.round(eff.recovery.diff), rhr: eff.rhr ? round1(eff.rhr.diff) : null } : null;
}

/**
 * Persönlicher Hinweis direkt beim Loggen („Kaffee um 18:05 …“).
 * bedMin = geplante Schlafenszeit in Minuten ab Mitternacht (ggf. > 1440).
 */
export function adviceFor(id, minute, insights, { bedMin = null } = {}) {
  const lines = [];
  const bed = isNum(bedMin) ? (bedMin < minute ? bedMin + 1440 : bedMin) : null;
  if (id === 'koffein') {
    if (bed != null) {
      const left = Math.round(100 * 0.5 ** ((bed - minute) / 300));
      if (left >= 20) lines.push(`Bis zu deiner Schlafenszeit (${hhmm(bed)}) ist noch etwa ${left} % davon aktiv.`);
    }
    const c = insights?.caffeine;
    if (c?.cutoff != null) {
      if (minute >= c.cutoff * 60) lines.push(`Bei dir kostet Kaffee nach ${c.cutoff} Uhr im Schnitt ${c.drop} % Recovery${c.deep ? ` und ${String(c.deep).replace('.', ',')} %-Punkte Tiefschlaf` : ''} (${c.nLate} gegen ${c.nEarly} Nächte).`);
      else lines.push(`Gut: vor deiner persönlichen Grenze von ${c.cutoff} Uhr.`);
    } else if (minute >= 14 * 60) {
      lines.push(`Faustregel: kein Koffein 8 Std. vor dem Schlafen. Puls lernt deine persönliche Grenze, wenn du deinen Kaffee ein paar Tage loggst${c?.logged ? ` (bisher ${c.logged} Tage)` : ''}.`);
    }
  } else if (id === 'alkohol') {
    const a = insights?.alcohol?.groups || [];
    const one = a.find((g) => g.drinks === 1);
    const two = a.find((g) => g.drinks === 2);
    if (one?.recovery != null || two?.recovery != null) {
      lines.push(`Bei dir: ${one?.recovery != null ? `1 Glas ${one.recovery > 0 ? '+' : '−'}${Math.abs(one.recovery)} % Recovery` : ''}${one?.recovery != null && two?.recovery != null ? ', ' : ''}${two?.recovery != null ? `ab 2 Gläsern ${two.recovery > 0 ? '+' : '−'}${Math.abs(two.recovery)} %${two.hrv != null ? ` (HRV ${two.hrv > 0 ? '+' : '−'}${Math.abs(two.hrv)} ms)` : ''}` : ''}.`);
    } else lines.push('Alkohol senkt bei fast allen HRV und Tiefschlaf – je später und je mehr, desto deutlicher. Ein Glas Wasser dazu hilft.');
    if (bed != null && bed - minute < 180) lines.push('Weniger als 3 Std. vor dem Schlafen wirkt er am stärksten auf die Nacht.');
  } else if (id === 'spaetessen') {
    const m = insights?.meal;
    if (bed != null) lines.push(`${Math.max(0, Math.round((bed - minute) / 60 * 10) / 10).toString().replace('.', ',')} Std. bis zur Schlafenszeit – ideal sind 3 Std. Abstand.`);
    if (m) lines.push(`Bei dir: Essen weniger als 3 Std. vor dem Schlafen → Ruhepuls ${m.rhr != null ? `${m.rhr > 0 ? '+' : '−'}${String(Math.abs(m.rhr)).replace('.', ',')} bpm, ` : ''}Recovery ${m.recovery > 0 ? '+' : '−'}${Math.abs(m.recovery)} %.`);
  } else if (id === 'nickerchen' && minute >= 15 * 60) {
    lines.push('Späte Nickerchen senken den Schlafdruck – heute Abend vielleicht etwas später müde.');
  } else if (id === 'sauna' && bed != null && bed - minute < 90) {
    lines.push('Direkt vor dem Schlafen: lauwarm abduschen, damit die Körpertemperatur sinken kann.');
  }
  const it = insights?.items?.find((x) => x.id === id && !x.pending);
  if (it && id !== 'koffein' && id !== 'alkohol') {
    const r = it.effects.recovery;
    lines.push(`Deine Daten: an solchen Tagen ist deine Recovery am Morgen danach im Schnitt ${r.diff > 0 ? '+' : '−'}${Math.abs(Math.round(r.diff))} % (${it.ny} gegen ${it.nn} Nächte).`);
  }
  return lines;
}

/** Zeile für den Coach: Lifestyle-Log der letzten Tage mit Uhrzeiten und deine persönlichen Einflüsse. */
export function lifestyleBlock(model, journal = {}, extra = [], days = 14) {
  const ins = lifestyleInsights(model, journal, extra);
  const L = ['## Lifestyle-Log (Schnell-Log mit Uhrzeiten und Morgen-Check, wirkt auf die Nacht danach)'];
  const last = model.days[model.days.length - 1].date;
  for (let k = days - 1; k >= 0; k--) {
    const date = addDays(last, -k);
    const e = journal?.[date];
    if (!e) continue;
    const parts = [];
    for (const b of BEHAVIORS) {
      const t = e._t?.[b.id] || [];
      if (t.length) parts.push(`${b.label} ${t.join('+')}`);
      else if (e[b.id]) parts.push(b.ask);
    }
    if (parts.length) L.push(`${date}: ${parts.join(', ')}`);
  }
  const solid = ins.items.filter((x) => !x.pending);
  if (solid.length) {
    L.push(`Persönliche Einflüsse (Recovery am Morgen danach, mit gegen ohne): ${solid.map((x) => `${x.label} ${x.diff > 0 ? '+' : ''}${Math.round(x.diff)} % (${x.ny}/${x.nn}${x.solid ? '' : ', Tendenz'})`).join('; ')}.`);
  }
  if (ins.caffeine.cutoff != null) L.push(`Persönliche Koffein-Grenze: nach ${ins.caffeine.cutoff} Uhr → Recovery −${ins.caffeine.drop} %${ins.caffeine.deep ? `, Tiefschlaf −${ins.caffeine.deep} %-Punkte` : ''} (${ins.caffeine.nLate} gegen ${ins.caffeine.nEarly} Nächte).`);
  const a = ins.alcohol.groups.filter((g) => g.recovery != null);
  if (a.length) L.push(`Alkohol nach Menge: ${a.map((g) => `${g.drinks === 2 ? 'ab 2' : '1'} Glas ${g.recovery > 0 ? '+' : ''}${g.recovery} % Recovery${g.hrv != null ? `, HRV ${g.hrv > 0 ? '+' : ''}${g.hrv} ms` : ''} (${g.n} Nächte)`).join('; ')}.`);
  if (ins.meal) L.push(`Essen < 3 Std. vor dem Schlafen: Recovery ${ins.meal.recovery > 0 ? '+' : ''}${ins.meal.recovery} %, Ruhepuls ${ins.meal.rhr ?? '–'} bpm (${ins.meal.n} gegen ${ins.meal.m} Nächte).`);
  return L.join('\n');
}

export { hhmm, toMin };
