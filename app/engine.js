// Puls – Auswertung deiner Garmin-Daten.
// Reines Modul ohne DOM: läuft im Browser und in den Node-Tests (tests/engine.test.mjs).
// Methodik in Kurzform steht in der App unter Einstellungen → "So rechnet Puls".

import * as Infekt from './infekt.js';

export const HR_BIN_START = 30;
export const HR_BIN_WIDTH = 5;
export const ZONE_LIMITS = { green: 67, yellow: 34 };

const STRAIN_C = 30;
const STRAIN_TMAX = 600;
const STRAIN_LN = Math.log(1 + STRAIN_TMAX / STRAIN_C);

// ---------------------------------------------------------------- Hilfsfunktionen

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const firstNum = (...vals) => vals.find(isNum) ?? null;

export function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}
export function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 = Sonntag
const isWeekend = (iso) => [0, 6].includes(weekday(iso));

export function fmtClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function fmtDur(min) {
  const r = Math.round(Math.abs(min));
  return `${min < 0 ? '−' : ''}${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
}
export function fmtDurLong(min) {
  const r = Math.round(Math.abs(min));
  const h = Math.floor(r / 60);
  const m = r % 60;
  if (!h) return `${m} Min.`;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const pct = (v) => `${Math.round(v)} %`;
const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits).replace('.', ',')}`;
const de = (v, digits = 1) => v.toFixed(digits).replace('.', ',');

// ---------------------------------------------------------------- Belastung (Strain)

/** Banister-TRIMP pro Minute. Unter 15 % Herzfrequenzreserve zählt nichts, bis 30 % steigt es weich an. */
export function trimpWeight(hrr, sex) {
  if (!(hrr > 0.15)) return 0;
  const ramp = Math.min(1, (hrr - 0.15) / 0.15);
  const [a, b] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92];
  const x = Math.min(hrr, 1.05);
  return ramp * x * a * Math.exp(b * x);
}
export function strainFromTrimp(t) {
  return Math.min(21, (21 * Math.log(1 + Math.max(0, t) / STRAIN_C)) / STRAIN_LN);
}
export function trimpFromStrain(s) {
  return STRAIN_C * (Math.exp((clamp(s, 0, 21) * STRAIN_LN) / 21) - 1);
}
const binMid = (i) => HR_BIN_START + i * HR_BIN_WIDTH + HR_BIN_WIDTH / 2;

export function trimpFromHist(hist, rhr, hrMax, sex) {
  let t = 0;
  hist.forEach((minutes, i) => {
    if (minutes > 0) t += minutes * trimpWeight((binMid(i) - rhr) / (hrMax - rhr), sex);
  });
  return t;
}
function activityTrimp(act, rhr, hrMax, sex) {
  if (!isNum(act.avgHr) || !isNum(act.dur)) return 0;
  return (act.dur / 60) * trimpWeight((act.avgHr - rhr) / (hrMax - rhr), sex);
}

/** Pulszonen nach Karvonen (Herzfrequenzreserve): Z1 50–60 %, … Z5 90–100 %. */
export function hrZones(rhr, hrMax) {
  const hr = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((p) => Math.round(rhr + p * (hrMax - rhr)));
  return [1, 2, 3, 4, 5].map((zone, i) => ({ zone, lo: hr[i], hi: hr[i + 1] }));
}
export function zoneMinutes(hist, zones) {
  const out = [0, 0, 0, 0, 0];
  hist.forEach((minutes, i) => {
    const bpm = binMid(i);
    for (let z = 4; z >= 0; z--) {
      if (bpm >= zones[z].lo) {
        out[z] += minutes;
        break;
      }
    }
  });
  return out.map((m) => Math.round(m));
}
/** Minuten in einer bestimmten Intensität, um eine TRIMP-Menge zu sammeln. */
function minutesFor(trimp, hrr, sex) {
  return Math.max(5, Math.round(trimp / trimpWeight(hrr, sex) / 5) * 5);
}

// ---------------------------------------------------------------- Einstellungen

export const SPORTS = {
  mix: 'Gemischt',
  laufen: 'Laufen',
  rad: 'Radfahren',
  kraft: 'Krafttraining',
};

export function resolveSettings(user = {}, profile = {}, rawDays = [], year = new Date().getFullYear()) {
  const sex = user.sex || profile.sex || 'male';
  const birthYear = Number(user.birthYear) || profile.birthYear || null;
  const age = birthYear ? year - birthYear : 35;
  const tanaka = Math.round(208 - 0.7 * age);
  const actMax = rawDays
    .flatMap((d) => (d.acts || []).map((a) => a.maxHr))
    .filter(isNum)
    .sort((a, b) => b - a);
  let observed = actMax.length >= 2 ? actMax[1] : actMax[0] ?? null;
  if (observed) observed = Math.min(observed, tanaka + 15);
  const maxHrAuto = Math.max(tanaka, observed || 0);
  const garminNeeds = rawDays.slice(-30).map((d) => d.sleep?.need).filter(isNum);
  const sleepNeedAuto = garminNeeds.length ? Math.round(median(garminNeeds)) : 480;
  return {
    sex,
    birthYear,
    age,
    maxHrAuto,
    maxHr: Number(user.maxHr) || maxHrAuto,
    sleepNeedAuto,
    sleepNeed: Number(user.sleepNeed) || sleepNeedAuto,
    wakeTime: parseClock(user.wakeTime) != null ? user.wakeTime : null,
    sport: SPORTS[user.sport] ? user.sport : 'mix',
  };
}

// ---------------------------------------------------------------- Schlafbedarf

/** Bedarf für die Nacht, die am Tag ``j`` endet (j darf = days.length sein: heute Nacht). */
export function needForNight(j, days, S) {
  const yesterday = days[j - 1];
  const base = S.sleepNeed;
  const strain = yesterday?.strain != null ? Math.max(0, yesterday.strain - 10) * 4 : 0;
  // Schlafschuld: ein Teil dessen, was in den letzten 3 Nächten gefehlt hat
  // (gemessen ohne deren eigene Schuld, damit sie sich nicht endlos aufschaukelt).
  let debt = 0;
  [0.3, 0.15, 0.05].forEach((w, k) => {
    const night = days[j - 1 - k];
    if (night?.sleepMin != null && night.need) debt += w * Math.max(0, night.need.total - night.need.debt - night.sleepMin);
  });
  debt = Math.min(60, debt);
  const recovery = yesterday?.recovery != null && yesterday.recovery < ZONE_LIMITS.yellow ? 15 : 0;
  return { base, strain, debt, recovery, total: base + strain + debt + recovery };
}

// ---------------------------------------------------------------- Tagesberechnung

export function zoneOf(rec) {
  if (rec == null) return null;
  return rec >= ZONE_LIMITS.green ? 'green' : rec >= ZONE_LIMITS.yellow ? 'yellow' : 'red';
}
const P = (z) => 100 * normCdf(z + 0.15);

/** Walking-Pad (z. B. PitPat über Apple Health): was die Uhr nicht gezählt hat. */
function padInfo(raw) {
  const p = raw.pad;
  if (!p || !isNum(p.total) || p.total <= 0) return null;
  return { total: p.total, added: isNum(p.add) ? p.add : p.total, minutes: p.min ?? null, units: p.units || [] };
}

/**
 * Schrittlänge in Metern fürs Laufband (wie walkpad.personal_stride beim Abruf): Garmins Tagesdistanz ÷
 * Uhr-Schritte der letzten 30 Tage – Garmin rechnet mit deiner Größe und Kalibrierung –, sonst 41,5 %
 * der Körpergröße.
 */
export function padStride(model, height = null) {
  let steps = 0;
  let dist = 0;
  for (const d of (model?.days || []).slice(-31)) {
    const n = d.stats?.watchSteps ?? d.stats?.steps;
    const m = d.stats?.dist;
    if (isNum(n) && isNum(m) && n >= 2000 && m > 0) {
      steps += n;
      dist += m;
    }
  }
  const clamp = (v) => Math.min(0.95, Math.max(0.5, v));
  if (steps >= 20000) return { stride: clamp(dist / steps), from: 'garmin' };
  if (isNum(height) && height >= 120 && height <= 230) return { stride: clamp(height * 0.00415), from: 'height' };
  return { stride: 0.72, from: 'default' };
}

/** Kilometer → Schritte; langsamer gehen = kürzere Schritte (Schrittlänge ~ Tempo^0,5, Bezug 5 km/h). */
export function padSteps(km, minutes, stride) {
  let s = stride;
  if (minutes > 0) s = stride * (Math.min(7, Math.max(2, km / (minutes / 60))) / 5) ** 0.5;
  return Math.round((km * 1000) / s);
}

/** Schritte = Uhr + Walking-Pad (ohne Doppelzählung). Die Uhr-Schritte bleiben als watchSteps erhalten. */
function withPad(raw) {
  const st = raw.stats || {};
  const p = padInfo(raw);
  if (!p || p.added <= 0) return st;
  return { ...st, steps: (isNum(st.steps) ? st.steps : 0) + p.added, watchSteps: st.steps ?? null, padSteps: p.added };
}

/** Ziel-Strain aus Recovery, Trainingslast und Warnsignalen. */
function setTarget(d) {
  if (d.recovery != null) {
    let c = 5.5 + 0.125 * d.recovery;
    const notes = [];
    const ratio = d.load?.ratio;
    if (ratio > 1.5) {
      c -= 2;
      notes.push('spike');
    } else if (ratio > 1.3) {
      c -= 1;
      notes.push('high');
    } else if (ratio != null && ratio < 0.8 && d.recovery >= 50) {
      c += 1;
      notes.push('low');
    }
    if (d.alarm) {
      c = Math.min(c, 7);
      notes.push('alarm');
    }
    c = clamp(c, 4, 19);
    d.target = { low: round1(c - 1.5), high: round1(c + 1.5), notes };
  } else {
    d.target = null;
  }

}

function computeDay(i, date, raw, days, S) {
  const win = (n, f) => {
    const out = [];
    for (let k = Math.max(0, i - n); k < i; k++) {
      const v = f(days[k]);
      if (isNum(v)) out.push(v);
    }
    return out;
  };

  const sl = raw.sleep && isNum(raw.sleep.dur) ? raw.sleep : null;
  const d = {
    date,
    i,
    wd: weekday(date),
    raw,
    sleep: sl,
    stats: withPad(raw),
    pad: padInfo(raw),
    hrv: firstNum(raw.hrv?.avg, sl?.hrv),
    rhr: firstNum(sl?.rhr, raw.stats?.rhr, raw.hr?.rhr),
    resp: firstNum(sl?.resp),
    skinTemp: firstNum(sl?.skinTemp),
  };

  // Belastung
  const rhrHist = win(30, (x) => x.rhr);
  d.rhrRef = Math.round(median(d.rhr != null ? [...rhrHist, d.rhr] : rhrHist) ?? 60);
  const hist = Array.isArray(raw.hr?.hist) ? raw.hr.hist : null;
  d.acts = (raw.acts || []).map((a) => {
    const trimp = activityTrimp(a, d.rhrRef, S.maxHr, S.sex);
    return { ...a, trimp, strain: strainFromTrimp(trimp) };
  });
  if (hist) d.trimp = trimpFromHist(hist, d.rhrRef, S.maxHr, S.sex);
  else if (d.acts.length) d.trimp = d.acts.reduce((s, a) => s + a.trimp, 15);
  else d.trimp = null;
  d.strain = d.trimp == null ? null : strainFromTrimp(d.trimp);
  d.zoneMin = hist ? zoneMinutes(hist, hrZones(d.rhrRef, S.maxHr)) : null;
  d.stressSeries = raw.stressDay?.stress || null;
  d.bbSeries = raw.stressDay?.bb || null;

  // Schlaf
  if (sl) {
    d.sleepMin = sl.dur / 60;
    d.inBed = isNum(sl.bed) && isNum(sl.wake) && sl.wake > sl.bed ? sl.wake - sl.bed : null;
    d.eff = d.inBed ? clamp(d.sleepMin / d.inBed, 0, 1) : null;
    const share = (s) => (isNum(s) ? (100 * s) / sl.dur : null);
    d.stages = { deep: share(sl.deep), light: share(sl.light), rem: share(sl.rem) };
    d.restorative = isNum(sl.deep) && isNum(sl.rem) ? (sl.deep + sl.rem) / 60 : null;
  } else {
    d.sleepMin = null;
  }
  d.need = needForNight(i, days, S);
  d.perf = sl ? clamp((100 * d.sleepMin) / d.need.total, 0, 100) : null;

  // Basiswerte der letzten 30 Tage (ohne heute)
  const lnHist = win(30, (x) => (x.hrv ? Math.log(x.hrv) : null));
  let hrvBase = null;
  if (lnHist.length >= 5) {
    hrvBase = { mean: mean(lnHist), sd: Math.max(0.06, sd(lnHist) ?? 0.06), n: lnHist.length, src: 'own' };
  } else if (isNum(raw.hrv?.low) && isNum(raw.hrv?.high) && raw.hrv.high > raw.hrv.low) {
    const lo = Math.log(raw.hrv.low);
    const hi = Math.log(raw.hrv.high);
    hrvBase = { mean: (lo + hi) / 2, sd: Math.max(0.06, (hi - lo) / 2.5), n: lnHist.length, src: 'garmin' };
  }
  const rhrBase = rhrHist.length >= 5 ? { mean: mean(rhrHist), sd: Math.max(2, sd(rhrHist)) } : null;
  const respHist = win(30, (x) => x.resp);
  const respBase = respHist.length >= 5 ? { mean: mean(respHist), sd: sd(respHist) } : null;
  d.base = { hrv: hrvBase, rhr: rhrBase, resp: respBase, calibrating: lnHist.length < 14, hrvDays: lnHist.length };

  // Recovery
  const comps = [];
  if (d.hrv != null && hrvBase) {
    const z = clamp((Math.log(d.hrv) - hrvBase.mean) / hrvBase.sd, -3, 3);
    comps.push({ key: 'hrv', w: 0.5, z, score: P(z), value: d.hrv, ref: Math.exp(hrvBase.mean) });
  }
  if (d.rhr != null && rhrBase) {
    const z = clamp((rhrBase.mean - d.rhr) / rhrBase.sd, -3, 3);
    comps.push({ key: 'rhr', w: 0.2, z, score: P(z), value: d.rhr, ref: rhrBase.mean });
  }
  if (sl) {
    const quality = isNum(sl.score) ? sl.score : d.eff != null ? 100 * clamp((d.eff - 0.7) / 0.25, 0, 1) : 70;
    comps.push({ key: 'sleep', w: 0.3, score: 0.7 * d.perf + 0.3 * quality, value: d.sleepMin, ref: d.need.total, quality });
  }
  const penalties = [];
  if (d.resp != null && respBase) {
    const delta = d.resp - respBase.mean;
    d.respDelta = delta;
    if (delta > 0.7) penalties.push({ key: 'resp', points: Math.min(15, (delta - 0.7) * 15), delta });
  }
  if (d.skinTemp != null && d.skinTemp > 0.5) {
    penalties.push({ key: 'temp', points: Math.min(10, (d.skinTemp - 0.5) * 20), delta: d.skinTemp });
  }
  d.comps = comps;
  d.penalties = penalties;
  if (comps.some((c) => c.key === 'hrv' || c.key === 'sleep')) {
    const w = comps.reduce((s, c) => s + c.w, 0);
    const raw0 = comps.reduce((s, c) => s + c.w * c.score, 0) / w;
    const pen = penalties.reduce((s, p) => s + p.points, 0);
    d.recovery = Math.round(clamp(raw0 - pen, 1, 99));
    d.recoveryPartial = !comps.some((c) => c.key === 'hrv');
  } else {
    d.recovery = null;
  }
  d.zone = zoneOf(d.recovery);

  // Warnsignale (Infekt, Überlastung, Alkohol …)
  const hrvComp = comps.find((c) => c.key === 'hrv');
  d.flags = {
    rhrUp: !!(rhrBase && d.rhr != null && d.rhr - rhrBase.mean >= Math.max(3, 1.5 * rhrBase.sd)),
    hrvDown: !!(hrvComp && hrvComp.z <= -1.5),
    respUp: !!(d.respDelta != null && d.respDelta >= 1.0),
    tempUp: !!(d.skinTemp != null && d.skinTemp >= 0.5),
  };
  d.alarm = Object.values(d.flags).filter(Boolean).length >= 2;

  // Trainingslast: akut (7 Tage) zu chronisch (28 Tage), ohne heute
  const acute = win(7, (x) => x.trimp);
  const chronic = win(28, (x) => x.trimp);
  d.load =
    acute.length >= 4 && chronic.length >= 14 && mean(chronic) > 0
      ? { acute: mean(acute), chronic: mean(chronic), ratio: mean(acute) / mean(chronic) }
      : null;

  setTarget(d);

  // Trends inkl. heute
  const span = (n, f) => {
    const out = [];
    for (let k = Math.max(0, i - n + 1); k < i; k++) {
      const v = f(days[k]);
      if (isNum(v)) out.push(v);
    }
    const v = f(d);
    if (isNum(v)) out.push(v);
    return out;
  };
  const ln7 = span(7, (x) => (x.hrv ? Math.log(x.hrv) : null));
  d.hrv7 = ln7.length >= 4 ? Math.exp(mean(ln7)) : null;
  const ln60 = win(60, (x) => (x.hrv ? Math.log(x.hrv) : null));
  if (ln60.length >= 21 && d.hrv7) {
    const m = mean(ln60);
    const s = sd(ln60);
    d.hrvNormal = [Math.exp(m - 0.5 * s), Math.exp(m + 0.5 * s)];
    d.hrvTrend = d.hrv7 < d.hrvNormal[0] ? 'low' : d.hrv7 > d.hrvNormal[1] ? 'high' : 'normal';
  }
  const rhr3 = span(3, (x) => x.rhr);
  d.rhr3 = rhr3.length >= 2 ? mean(rhr3) : null;

  const nights = [];
  for (let k = Math.max(0, i - 6); k <= i; k++) {
    const s = k === i ? sl : days[k].sleep;
    if (s && isNum(s.bed) && isNum(s.wake)) nights.push(s);
  }
  if (nights.length >= 4) {
    d.sdBed = sd(nights.map((n) => n.bed));
    d.sdWake = sd(nights.map((n) => n.wake));
    d.consistency = Math.round(clamp(100 - (1.2 * (d.sdBed + d.sdWake)) / 2, 0, 100));
  } else {
    d.consistency = null;
  }

  let debt = 0;
  let counted = 0;
  for (let k = Math.max(0, i - 6); k <= i; k++) {
    const x = k === i ? d : days[k];
    if (x.sleepMin != null) {
      debt += x.need.total - x.need.debt - x.sleepMin;
      counted++;
    }
  }
  d.debt7 = counted >= 3 ? Math.max(0, debt) : null;

  return d;
}

/** Infekt-Frühwarnung (zweiter Durchlauf, lernendes Modell): bei deutlichen Frühzeichen nie „voll erholt“. */
function applyIllness(days, illness) {
  const fit = Infekt.fitIllness(days, illness || {});
  days.forEach((d, i) => {
    d.ill = fit.days[i];
    if (d.recovery != null && d.ill.level >= 2) {
      const cap = d.ill.level >= 3 ? 33 : 55;
      if (d.recovery > cap) {
        d.recoveryRaw = d.recovery;
        d.recovery = cap;
        d.zone = zoneOf(cap);
        setTarget(d);
      }
    }
  });
  return fit.model;
}

// ---------------------------------------------------------------- Infekt-Frühwarnung

export const ILL_LEVELS = Infekt.LEVEL_LABELS;
export const ILL_LABELS = { rhr: 'Ruhepuls', hrv: 'HRV', resp: 'Atemfrequenz', temp: 'Hauttemperatur', spo2: 'Sauerstoffsättigung', feel: 'Dein Gefühl' };
export { illnessBlock } from './infekt.js';

/**
 * Infekt-Radar für einen Tag: das lernende Modell (model.illness, d.ill) plus deine Angabe
 * „angeschlagen“ (Gefühl heute oder „krank“ im Morgen-Check) – Symptome zählen wie in DETECT (Quer 2021)
 * stark: Chance × 6.
 */
export function illnessRisk(model, i = model.days.length - 1, { feel = null, journal = {} } = {}) {
  const d = model.days[i];
  const ill = d.ill || { p: null, level: 0, signals: [], against: [], confounders: [], modifiers: [], match: null };
  const m = model.illness || null;
  const th = m?.levels || [0.075, 0.15, 0.4];
  const yesterday = addDays(d.date, -1);
  const symptoms = feel === 'sick' || !!journal?.[yesterday]?.krank || !!journal?.[d.date]?.krank;
  let p = ill.p;
  // Symptome: Chance × 6, mindestens „erhöht“ – wer sich krank fühlt, ist es meist auch
  if (symptoms) p = Math.max(th[1], p == null ? 0.6 : 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + Math.log(6)))));
  const level = p == null ? 0 : p >= th[2] ? 3 : p >= th[1] ? 2 : p >= th[0] ? 1 : 0;
  const signals = [...(ill.signals || [])];
  if (symptoms) signals.unshift({ key: 'feel', label: ILL_LABELS.feel, pts: 3, text: feel === 'sick' ? 'Du fühlst dich angeschlagen' : 'Im Morgen-Check: krank / angeschlagen', value: null });
  const advice =
    level >= 3
      ? ['Heute kein Training – Ruhe ist jetzt das beste Training.', 'Viel trinken, früh ins Bett, Alkohol meiden.', 'Fieber, Atemnot oder Brustschmerz: ärztlich abklären. Erst 1–2 Tage nach den Symptomen wieder locker anfangen.']
      : level >= 2
        ? ['Heute höchstens locker bewegen (Rad oder Spaziergang, Puls niedrig) – kein Gym-Volumen.', 'Viel trinken, 30–60 Min. früher schlafen.', 'Morgen früh schaut Puls wieder nach.']
        : level >= 1
          ? ['Training ist okay, aber nicht ans Limit gehen.', 'Achte heute auf Schlaf und Flüssigkeit.']
          : [];
  const note = ill.confounders?.length ? `Herausgerechnet: ${ill.confounders.map((c) => c.text).join('; ')}.` : null;
  return {
    level,
    label: ILL_LEVELS[level],
    p,
    rel: p != null && m ? p / m.base : null,
    score: p == null ? 0 : Math.round(p * 100),
    signals,
    against: ill.against || [],
    confounders: ill.confounders || [],
    modifiers: ill.modifiers || [],
    match: ill.match || null,
    calibrating: ill.calibrating,
    symptoms,
    advice,
    note,
    history: m,
    date: d.date,
  };
}

// ---------------------------------------------------------------- Gesamtauswertung

export function analyze(store, userSettings = {}) {
  const keys = Object.keys(store?.days || {}).sort();
  if (!keys.length) return { empty: true, status: store?.status || null, generated: store?.generated || null };
  const dates = [];
  for (let d = keys[0]; d <= keys[keys.length - 1]; d = addDays(d, 1)) dates.push(d);
  const raws = dates.map((date) => store.days[date] || {});
  const S = resolveSettings(userSettings, store.profile || {}, raws, Number(dates[dates.length - 1].slice(0, 4)));
  const days = [];
  dates.forEach((date, i) => days.push(computeDay(i, date, raws[i], days, S)));
  const illness = applyIllness(days, store.illness);
  return {
    empty: false,
    settings: S,
    days,
    illness,
    index: Object.fromEntries(dates.map((d, i) => [d, i])),
    generated: store.generated || null,
    status: store.status || null,
    profile: store.profile || {},
    influences: computeInfluences(days),
  };
}

// ---------------------------------------------------------------- Schlafenszeit

export function bedtimePlan(model, i) {
  const { days, settings: S } = model;
  const need = needForNight(i + 1, days, S);
  const tomorrow = addDays(days[i].date, 1);
  const weekend = isWeekend(tomorrow);
  const recent = days.slice(Math.max(0, i - 27), i + 1).filter((x) => isNum(x.sleep?.wake));
  let wake;
  let wakeSource;
  if (S.wakeTime) {
    wake = parseClock(S.wakeTime);
    wakeSource = 'setting';
  } else {
    const same = recent.filter((x) => isWeekend(x.date) === weekend).map((x) => x.sleep.wake);
    if (same.length >= 3) wake = median(same);
    else if (recent.length) wake = median(recent.map((x) => x.sleep.wake));
    else wake = 420;
    wakeSource = 'auto';
  }
  const effs = days.slice(Math.max(0, i - 13), i + 1).map((x) => x.eff).filter(isNum);
  const eff = clamp(effs.length ? median(effs) : 0.9, 0.8, 0.97);
  const options = [
    { key: 'peak', label: 'Optimal', pct: 100 },
    { key: 'perform', label: 'Gut', pct: 85 },
    { key: 'min', label: 'Minimum', pct: 70 },
  ].map((o) => {
    const sleepMin = (need.total * o.pct) / 100;
    return { ...o, sleepMin, bed: wake - sleepMin / eff - 10 };
  });
  return { need, wake, wakeSource, eff, weekend, options };
}

// ---------------------------------------------------------------- Coach

const PLANS = {
  green: {
    laufen: 'Intervalle oder Tempolauf, z. B. 5 × 4 Min. in Zone 4 ({z4}) mit 3 Min. Trabpause.',
    rad: 'Intervalle auf dem Rad, z. B. 4 × 8 Min. in Zone 4 ({z4}) mit 4 Min. locker dazwischen.',
    kraft: 'Schweres Krafttraining: Grundübungen mit 3–6 Wiederholungen, volle Intensität möglich.',
    mix: 'Harte Einheit möglich: Intervalle in Zone 4 ({z4}) oder schweres Krafttraining.',
  },
  yellow: {
    laufen: 'Lockerer Dauerlauf 40–60 Min. in Zone 2 ({z2}). Keine Intervalle.',
    rad: 'Grundlagenfahrt 60–90 Min. in Zone 2 ({z2}).',
    kraft: 'Moderates Krafttraining: 8–12 Wiederholungen, 2 Wiederholungen Reserve lassen.',
    mix: 'Moderat trainieren: Zone 2 ({z2}) oder Kraft mit Reserve. Keine Maximalbelastung.',
  },
  red: {
    laufen: 'Heute kein Lauftraining. 20–40 Min. Spaziergang, Puls unter {z1top}.',
    rad: 'Höchstens 30–45 Min. ganz locker rollen, Puls unter {z1top}.',
    kraft: 'Kein schweres Krafttraining. Mobility und Dehnen, 20–30 Min.',
    mix: 'Aktive Erholung: Spaziergang, Mobility oder Dehnen. Puls unter {z1top} halten.',
  },
};

const HEADLINES = {
  green: 'Bereit für Belastung – gib heute Gas.',
  yellow: 'Solide – trainiere moderat.',
  red: 'Erholung hat heute Vorrang.',
};

export function buildCoach(model, i) {
  const d = model.days[i];
  const S = model.settings;
  const zones = hrZones(d.rhrRef, S.maxHr);
  const range = (z) => `${zones[z - 1].lo}–${zones[z - 1].hi} bpm`;
  if (d.recovery == null) {
    return {
      state: 'nodata',
      headline: 'Noch keine Schlafdaten.',
      text: 'Öffne kurz Garmin Connect, damit die Uhr synchronisiert – Puls holt die Daten dann automatisch.',
    };
  }
  const zone = d.alarm ? 'red' : d.zone;
  const plan = PLANS[zone][S.sport]
    .replace('{z1top}', `${zones[0].hi} bpm`)
    .replace('{z2}', range(2))
    .replace('{z4}', range(4));

  const notes = [];
  if (d.target.notes.includes('alarm')) {
    notes.push('Mehrere Körperwerte auffällig – schone dich heute.');
  }
  if (d.target.notes.includes('spike')) {
    notes.push('Deine Last ist stark gestiegen – Ziel gesenkt.');
  } else if (d.target.notes.includes('high')) {
    notes.push('Last steigt schnell – Ziel leicht gesenkt.');
  } else if (d.target.notes.includes('low')) {
    notes.push('Zuletzt wenig trainiert – heute ist mehr drin.');
  }

  let remaining = null;
  const current = d.strain ?? 0;
  if (current < d.target.low) {
    const delta = trimpFromStrain(d.target.low) - trimpFromStrain(current);
    remaining = {
      z2: minutesFor(delta, 0.65, S.sex),
      z4: minutesFor(delta, 0.85, S.sex),
      short: `noch ${minutesFor(delta, 0.65, S.sex)} Min. Zone 2`,
      text: `Noch ca. ${minutesFor(delta, 0.65, S.sex)} Min. in Zone 2 (${range(2)}) oder ${minutesFor(delta, 0.85, S.sex)} Min. in Zone 4 (${range(4)}).`,
    };
  } else if (current > d.target.high) {
    remaining = { done: true, short: 'Ziel überschritten', text: 'Über dem Zielbereich – ab jetzt Erholung.' };
  } else {
    remaining = { done: true, short: 'Ziel erreicht', text: 'Im Zielbereich – Training für heute erledigt.' };
  }

  return { state: zone, headline: d.alarm ? 'Warnsignale – heute Pause.' : HEADLINES[zone], plan, notes, remaining, zones };
}

// ---------------------------------------------------------------- Erkenntnisse des Tages

export function buildInsights(model, i, journal = null) {
  const d = model.days[i];
  const days = model.days;
  const out = [];
  const add = (tone, title, text, prio = 5) => out.push({ tone, title, text, prio });

  // Verhalten von gestern (Morgen-Check) mit gemessenem Effekt verknüpfen
  const yAnswers = journal?.[addDays(d.date, -1)];
  if (yAnswers?._done && d.recovery != null) {
    const impacts = journalImpacts(model, journal).filter((x) => !x.pending && yAnswers[x.id] && Math.abs(x.diff) >= 3);
    for (const x of impacts.slice(0, 2)) {
      add(x.diff < 0 ? 'warn' : 'good', `${x.label} gestern`, `Kostet dich im Schnitt ${Math.abs(Math.round(x.diff))} % Recovery.`.replace('Kostet', x.diff < 0 ? 'Kostet' : 'Bringt'), x.diff < 0 ? 2 : 6);
    }
  }

  if (d.alarm) {
    const parts = [];
    if (d.flags.rhrUp) parts.push(`Ruhepuls ${signed(d.rhr - d.base.rhr.mean)}`);
    if (d.flags.hrvDown) parts.push(`HRV ${signed(100 * (d.hrv / Math.exp(d.base.hrv.mean) - 1))} %`);
    if (d.flags.respUp) parts.push(`Atmung ${signed(d.respDelta, 1)}`);
    if (d.flags.tempUp) parts.push(`Temperatur ${signed(d.skinTemp, 1)} °C`);
    add('bad', 'Warnsignal: Infekt oder Überlastung?', `${parts.join(', ')}. Heute schonen, viel trinken, früh schlafen.`, 0);
  } else if (d.flags.rhrUp) {
    add('warn', 'Ruhepuls erhöht', `${d.rhr} bpm, ${signed(d.rhr - d.base.rhr.mean)} über normal. Oft: spätes Essen, Alkohol, Stress.`, 2);
  }
  if (d.flags.respUp && !d.alarm) {
    add('warn', 'Atemfrequenz erhöht', `${signed(d.respDelta, 1)} Atemzüge/Min. über normal – ein Infekt kündigt sich oft so an.`, 2);
  }

  if (d.hrvTrend === 'low') {
    let streak = 0;
    for (let k = i; k >= 0 && days[k].hrvTrend === 'low'; k--) streak++;
    add(streak >= 3 ? 'bad' : 'warn', 'HRV-Trend zu niedrig', `${streak > 1 ? `Seit ${streak} Tagen` : 'Gerade'} unter deinem Normalbereich – Zeichen für Ermüdung. 1–2 lockere Tage einplanen.`, 1);
  } else if (d.hrvTrend === 'high') {
    add('good', 'HRV-Trend stark', 'Über deinem Normalbereich – du verkraftest die Belastung gut.', 6);
  }

  if (d.load) {
    const r = d.load.ratio;
    if (r > 1.5) add('bad', 'Belastungsspitze', `${Math.round((r - 1) * 100)} % mehr Last als üblich – Verletzungsrisiko steigt.`, 1);
    else if (r > 1.3) add('warn', 'Belastung steigt schnell', 'Erst weiter steigern, wenn deine HRV mitzieht.', 3);
    else if (r >= 0.8) add('good', 'Trainingslast optimal', 'Genau im richtigen Bereich für Fortschritt.', 8);
    else add('info', 'Weniger Training als üblich', 'Bei guter Recovery darfst du wieder steigern.', 7);
  }

  if (d.sleep) {
    if (d.perf < 85) add('warn', 'Zu wenig Schlaf', `${fmtDur(d.sleepMin)} von ${fmtDur(d.need.total)} Std. geschafft (${pct(d.perf)}).`, 3);
    const beds = days.slice(Math.max(0, i - 28), i).map((x) => x.sleep?.bed).filter(isNum);
    if (beds.length >= 7 && isNum(d.sleep.bed)) {
      const late = d.sleep.bed - median(beds);
      if (late >= 45) add('info', 'Später eingeschlafen', `${fmtDurLong(late)} später als üblich.`, 6);
    }
    if (d.stages.deep != null && d.stages.deep < 12) add('info', 'Wenig Tiefschlaf', `Nur ${pct(d.stages.deep)}. Hilft: kühles Zimmer, kein Alkohol oder Sport spät abends.`, 6);
    if (d.stages.rem != null && d.stages.rem < 15) add('info', 'Wenig REM-Schlaf', `Nur ${pct(d.stages.rem)}. Kommt vor allem morgens – länger schlafen hilft.`, 7);
  }
  if (d.debt7 != null) {
    if (d.debt7 >= 180) add('warn', 'Schlafschuld', `${fmtDurLong(d.debt7)} fehlen aus den letzten 7 Nächten. Ein paar Abende früher ins Bett.`, 3);
    else if (d.debt7 < 30) add('good', 'Kaum Schlafschuld', 'Du hast diese Woche so viel geschlafen, wie du brauchst.', 8);
  }
  if (d.consistency != null) {
    if (d.consistency < 60) add('warn', 'Unregelmäßiger Schlaf', `Schlafzeiten schwanken um ±${Math.round((d.sdBed + d.sdWake) / 2)} Min. Feste Zeiten verbessern HRV und Tiefschlaf.`, 4);
    else if (d.consistency >= 80) add('good', 'Sehr regelmäßiger Schlaf', 'Einer der stärksten Hebel für gute Recovery.', 8);
  }

  const y = days[i - 1];
  if (y && d.sleep && isNum(d.sleep.bed)) {
    const late = y.acts.filter((a) => {
      const start = parseClock(a.start);
      return start != null && start + a.dur / 60 - 1440 > d.sleep.bed - 180;
    });
    if (late.length && d.comps.find((c) => c.key === 'hrv')?.z < -0.5) {
      add('info', 'Training zu spät', `Gestern ${late[0].start} Uhr – deine HRV ist heute niedriger. Lieber früher trainieren.`, 5);
    }
  }
  if (y?.stats?.stress >= 45) add('info', 'Stressiger Tag gestern', 'Heute 10 Min. Atemübung oder ein Spaziergang ohne Handy.', 6);

  let greens = 0;
  for (let k = i; k >= 0 && days[k].zone === 'green'; k--) greens++;
  if (greens >= 3) add('good', `${greens} grüne Tage in Folge`, 'Gute Phase für harte Trainingsreize.', 7);

  if (d.base.calibrating) add('info', 'Puls lernt dich noch kennen', `${d.base.hrvDays} von 14 Nächten – danach werden die Werte genauer.`, 9);

  return out.sort((a, b) => a.prio - b.prio);
}

// ---------------------------------------------------------------- Einflüsse auf die Recovery

export function computeInfluences(days) {
  const withRec = days.filter((d) => d.recovery != null);
  if (withRec.length < 14) return { ready: false, n: withRec.length };
  const items = [];
  const test = (id, cond, phrase) => {
    const yes = [];
    const no = [];
    for (const d of days) {
      if (d.recovery == null) continue;
      const c = cond(d);
      if (c === true) yes.push(d.recovery);
      else if (c === false) no.push(d.recovery);
    }
    if (yes.length >= 5 && no.length >= 5) {
      const a = mean(yes);
      const b = mean(no);
      if (Math.abs(a - b) >= 4) items.push({ id, diff: a - b, a, b, na: yes.length, nb: no.length, ...phrase(a, b) });
    }
  };
  const prev = (d) => days[d.i - 1];

  const beds = withRec.map((d) => d.sleep?.bed).filter(isNum);
  if (beds.length >= 10) {
    const m = median(beds);
    test('bed', (d) => (isNum(d.sleep?.bed) ? d.sleep.bed < m : null), (a, b) => ({
      title: `Einschlafen vor ${fmtClock(m)}`,
      text: `Wenn du vor ${fmtClock(m)} einschläfst, liegt deine Recovery im Schnitt bei ${pct(a)} – sonst bei ${pct(b)}.`,
    }));
  }
  const lens = withRec.map((d) => d.sleepMin).filter(isNum);
  if (lens.length >= 10) {
    const m = median(lens);
    test('len', (d) => (d.sleepMin != null ? d.sleepMin >= m : null), (a, b) => ({
      title: `Mehr als ${fmtDur(m)} Std. Schlaf`,
      text: `Mit mindestens ${fmtDur(m)} Std. Schlaf liegt deine Recovery bei ${pct(a)}, mit weniger bei ${pct(b)}.`,
    }));
  }
  test('strain', (d) => {
    const s = prev(d)?.strain;
    if (s == null) return null;
    return s >= 14 ? true : s <= 10 ? false : null;
  }, (a, b) => ({
    title: 'Harter Vortag (Strain ≥ 14)',
    text: `Nach harten Tagen liegt deine Recovery bei ${pct(a)}, nach lockeren Tagen (Strain ≤ 10) bei ${pct(b)}.`,
  }));
  test('late', (d) => {
    const p = prev(d);
    if (!p?.acts?.length || !isNum(d.sleep?.bed)) return null;
    return p.acts.some((a) => {
      const st = parseClock(a.start);
      return st != null && st + a.dur / 60 - 1440 > d.sleep.bed - 180;
    });
  }, (a, b) => ({
    title: 'Training weniger als 3 Std. vor dem Schlafen',
    text: `Nach späten Einheiten liegt deine Recovery bei ${pct(a)}, nach früheren Einheiten bei ${pct(b)}.`,
  }));
  test('weekend', (d) => isWeekend(d.date), (a, b) => ({
    title: 'Wochenend-Nächte',
    text: `Nach Freitag- und Samstagnacht liegt deine Recovery bei ${pct(a)}, unter der Woche bei ${pct(b)}.`,
  }));
  const stresses = days.map((d) => d.stats?.stress).filter(isNum);
  if (stresses.length >= 10) {
    const m = median(stresses);
    test('stress', (d) => (isNum(prev(d)?.stats?.stress) ? prev(d).stats.stress > m : null), (a, b) => ({
      title: `Stressiger Vortag (Stress > ${Math.round(m)})`,
      text: `Nach stressigen Tagen liegt deine Recovery bei ${pct(a)}, nach ruhigeren bei ${pct(b)}.`,
    }));
  }
  const steps = days.map((d) => d.stats?.steps).filter(isNum);
  if (steps.length >= 10) {
    const m = median(steps);
    test('steps', (d) => (isNum(prev(d)?.stats?.steps) ? prev(d).stats.steps >= m : null), (a, b) => ({
      title: `Mehr als ${Math.round(m / 100) * 100} Schritte am Vortag`,
      text: `Nach aktiven Tagen liegt deine Recovery bei ${pct(a)}, nach weniger Bewegung bei ${pct(b)}.`,
    }));
  }
  test('consistency', (d) => (d.consistency == null ? null : d.consistency >= 75 ? true : d.consistency < 60 ? false : null), (a, b) => ({
    title: 'Regelmäßige Schlafzeiten',
    text: `In Wochen mit festem Rhythmus (Konstanz ≥ 75 %) liegt deine Recovery bei ${pct(a)}, bei unregelmäßigem Schlaf bei ${pct(b)}.`,
  }));

  return { ready: true, n: withRec.length, items: items.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)) };
}

// ---------------------------------------------------------------- Wochenvergleich

export function weeklySummary(model, i) {
  const agg = (arr) => {
    const vals = (f) => arr.map(f).filter(isNum);
    const zones = arr.map((d) => d.zone);
    return {
      n: arr.length,
      recovery: mean(vals((d) => d.recovery)),
      strain: mean(vals((d) => d.strain)),
      sleep: mean(vals((d) => d.sleepMin)),
      hrv: mean(vals((d) => d.hrv)),
      rhr: mean(vals((d) => d.rhr)),
      green: zones.filter((z) => z === 'green').length,
      yellow: zones.filter((z) => z === 'yellow').length,
      red: zones.filter((z) => z === 'red').length,
    };
  };
  const days = model.days;
  return {
    current: agg(days.slice(Math.max(0, i - 6), i + 1)),
    previous: agg(days.slice(Math.max(0, i - 13), Math.max(0, i - 6))),
  };
}

// ---------------------------------------------------------------- Körper-Check (Vitalwerte)

export function vitals(model, i) {
  const d = model.days[i];
  const days = model.days;
  const hist = (f) => {
    const out = [];
    for (let k = Math.max(0, i - 30); k < i; k++) {
      const v = f(days[k]);
      if (isNum(v)) out.push(v);
    }
    return out;
  };
  const items = [];
  const add = (key, label, unit, value, values, { k, minSd, badHigh = false, badLow = false, digits = 0 }) => {
    if (value == null) return;
    if (values.length < 5) {
      items.push({ key, label, unit, value, digits, status: 'na' });
      return;
    }
    const m = mean(values);
    const s = Math.max(minSd, sd(values));
    const lo = m - k * s;
    const hi = m + k * s;
    const status = value > hi ? 'high' : value < lo ? 'low' : 'ok';
    items.push({ key, label, unit, value, digits, lo, hi, mean: m, status, bad: (status === 'high' && badHigh) || (status === 'low' && badLow) });
  };
  add('hrv', 'HRV', 'ms', d.hrv, hist((x) => x.hrv), { k: 1.5, minSd: 3, badLow: true });
  add('rhr', 'Ruhepuls', 'bpm', d.rhr, hist((x) => x.rhr), { k: 1.5, minSd: 2, badHigh: true });
  add('resp', 'Atemfrequenz', '/Min.', d.resp, hist((x) => x.resp), { k: 2, minSd: 0.4, badHigh: true, digits: 1 });
  add('spo2', 'Blutsauerstoff', '%', d.sleep?.spo2 ?? null, hist((x) => x.sleep?.spo2), { k: 2, minSd: 1, badLow: true });
  if (d.skinTemp != null) {
    const status = d.skinTemp > 0.5 ? 'high' : d.skinTemp < -0.5 ? 'low' : 'ok';
    items.push({ key: 'temp', label: 'Hauttemperatur', unit: '°C', value: d.skinTemp, digits: 1, lo: -0.5, hi: 0.5, mean: 0, status, bad: status === 'high', delta: true });
  }
  const measured = items.filter((x) => x.status !== 'na');
  return { items, outside: items.filter((x) => x.bad).length, measured: measured.length };
}

// ---------------------------------------------------------------- Statistiken vs. 30 Tage

export function keyStats(model, i, { partial = false } = {}) {
  const d = model.days[i];
  const dayTotals = new Set(['strain', 'kcal', 'steps']);
  const days = model.days;
  const avg = (f) => {
    const v = [];
    for (let k = Math.max(0, i - 30); k < i; k++) {
      const x = f(days[k]);
      if (isNum(x)) v.push(x);
    }
    return v.length >= 5 ? mean(v) : null;
  };
  const rows = [
    ['hrv', 'HRV', 'ms', (x) => x.hrv, true, 0],
    ['rhr', 'Ruhepuls', 'bpm', (x) => x.rhr, false, 0],
    ['resp', 'Atemfrequenz', '/Min.', (x) => x.resp, false, 1],
    ['perf', 'Schlafperformance', '%', (x) => x.perf, true, 0],
    ['sleep', 'Schlafdauer', 'Std.', (x) => x.sleepMin, true, 'dur'],
    ['restorative', 'Erholsamer Schlaf', 'Std.', (x) => x.restorative, true, 'dur'],
    ['strain', 'Strain', '', (x) => x.strain, null, 1],
    ['kcal', 'Kalorien', 'kcal', (x) => x.stats?.kcal, null, 0],
    ['steps', 'Schritte', '', (x) => x.stats?.steps, true, 0],
    ['stress', 'Stress Ø', '', (x) => x.stats?.stress, false, 0],
  ];
  return rows
    .map(([key, label, unit, f, higherBetter, digits]) => {
      const value = f(d);
      if (!isNum(value)) return null;
      const base = avg(f);
      const delta = base == null ? null : value - base;
      const rel = base ? delta / base : 0;
      const trend = delta == null || (partial && dayTotals.has(key)) ? null : Math.abs(rel) < 0.03 ? 'flat' : delta > 0 ? 'up' : 'down';
      const good = higherBetter == null || !trend || trend === 'flat' ? null : (trend === 'up') === higherBetter;
      return { key, label, unit, value, base, trend, good, digits };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- Morgen-Check (Journal)

export const JOURNAL_QUESTIONS = [
  { id: 'alkohol', label: 'Alkohol' },
  { id: 'spaetessen', label: 'Spät gegessen' },
  { id: 'koffein', label: 'Koffein nach 14 Uhr' },
  { id: 'bildschirm', label: 'Handy im Bett' },
  { id: 'stress', label: 'Stressiger Tag' },
  { id: 'krank', label: 'Krank / angeschlagen' },
  { id: 'sauna', label: 'Sauna' },
  { id: 'kalt', label: 'Kalte Dusche / Eisbad' },
  { id: 'meditation', label: 'Meditation / Atemübung' },
  { id: 'magnesium', label: 'Magnesium' },
  { id: 'nickerchen', label: 'Nickerchen' },
  { id: 'unterwegs', label: 'Unterwegs / fremdes Bett' },
  { id: 'sex', label: 'Sex' },
];

/** Verhalten an Tag D wirkt auf die Recovery am Morgen von D+1. */
export function journalImpacts(model, journal, questions = JOURNAL_QUESTIONS) {
  const out = [];
  for (const q of questions) {
    const yes = [];
    const no = [];
    for (const [date, answers] of Object.entries(journal || {})) {
      if (!answers?._done) continue;
      const idx = model.index?.[addDays(date, 1)];
      const rec = idx != null ? model.days[idx].recovery : null;
      if (rec == null) continue;
      (answers[q.id] ? yes : no).push(rec);
    }
    if (yes.length >= 3 && no.length >= 3) {
      out.push({ ...q, diff: mean(yes) - mean(no), yes: mean(yes), no: mean(no), ny: yes.length, nn: no.length, solid: yes.length >= 5 && no.length >= 5 });
    } else if (yes.length) {
      out.push({ ...q, pending: true, ny: yes.length, nn: no.length });
    }
  }
  return out.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || Math.abs(b.diff || 0) - Math.abs(a.diff || 0));
}

/** Eigene Fragen des Nutzers ergänzen die festen (ids beginnen mit „c_“). */
export function journalQuestions(custom = []) {
  const extra = (Array.isArray(custom) ? custom : []).filter((q) => q && typeof q.id === 'string' && q.id.startsWith('c_') && typeof q.label === 'string');
  return [...JOURNAL_QUESTIONS, ...extra];
}

/** Wie oft jedes Verhalten in den letzten ``days`` Tagen vorkam (nur beantwortete Tage zählen). */
export function journalTrends(journal, questions, endDate, days = 30) {
  const dates = [];
  for (let k = 1; k <= days; k++) dates.push(addDays(endDate, -k));
  const answered = dates.filter((d) => journal?.[d]?._done);
  return {
    answered: answered.length,
    items: questions
      .map((q) => ({ id: q.id, label: q.label, count: answered.filter((d) => journal[d][q.id]).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- Wochenbericht

export function weeklyAssessment(model, i) {
  const w = weeklySummary(model, i);
  const c = w.current;
  const p = w.previous;
  const d = model.days[i];
  const r = d.load?.ratio ?? null;
  let verdict;
  if (c.recovery == null) {
    verdict = { label: 'Zu wenig Daten', tone: 'info', text: 'Für eine Bewertung braucht es mindestens ein paar Nächte mit Recovery.' };
  } else if (r != null && r > 1.3 && p.recovery != null && c.recovery < p.recovery - 5) {
    verdict = { label: 'Überlastet', tone: 'bad', text: 'Deine Belastung steigt, während deine Recovery sinkt. Plane 2–3 lockere Tage und mehr Schlaf ein, bevor du wieder steigerst.' };
  } else if (c.recovery < 45) {
    verdict = { label: 'Erholung nötig', tone: 'warn', text: 'Deine Recovery lag im Schnitt unter 45 %. Am schnellsten hilft mehr und regelmäßigerer Schlaf, dazu weniger Intensität.' };
  } else if (r != null && r < 0.8) {
    verdict = { label: 'Erholungswoche', tone: 'info', text: 'Du hast weniger trainiert als üblich. Wenn du dich fit fühlst, kannst du nächste Woche wieder steigern.' };
  } else if (c.recovery >= 60 && (r == null || r <= 1.3)) {
    verdict = { label: 'Optimal', tone: 'good', text: 'Belastung und Erholung sind im Gleichgewicht – so baust du Fitness auf, ohne dich zu überlasten.' };
  } else {
    verdict = { label: 'Ausgewogen', tone: 'info', text: 'Solide Woche. Mit etwas mehr Schlaf ist mehr Recovery drin.' };
  }
  const bullets = [];
  const span = model.days.slice(Math.max(0, i - 6), i + 1);
  const needs = span.filter((x) => x.sleepMin != null).map((x) => x.need.total - x.need.debt);
  if (c.sleep != null && needs.length) {
    const gap = c.sleep - mean(needs);
    bullets.push(
      gap < -15
        ? `Du hast im Schnitt ${fmtDur(c.sleep)} Std. geschlafen – ${fmtDurLong(-gap)} weniger als du pro Nacht brauchst.`
        : `Du hast im Schnitt ${fmtDur(c.sleep)} Std. geschlafen und damit deinen Bedarf gut gedeckt.`,
    );
  }
  const rec = span.filter((x) => x.recovery != null);
  if (rec.length >= 3) {
    const best = rec.reduce((a, b) => (b.recovery > a.recovery ? b : a));
    const worst = rec.reduce((a, b) => (b.recovery < a.recovery ? b : a));
    const name = (x) => new Date(x.date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' });
    bullets.push(`Beste Recovery am ${name(best)} (${best.recovery} %), schwächste am ${name(worst)} (${worst.recovery} %).`);
  }
  if (c.strain != null) {
    const trained = span.filter((x) => x.acts.length).length;
    bullets.push(`${trained} Trainingstag${trained === 1 ? '' : 'e'}, Ø Strain ${de(c.strain)}${p.strain != null ? ` (Vorwoche ${de(p.strain)})` : ''}.`);
  }
  return { ...w, verdict, bullets };
}

// ---------------------------------------------------------------- Puls-Alter (wie Whoops Healthspan)

/** Schätzt ein „biologisches“ Alter aus Fitness, Schlaf und Aktivität der letzten 30 Tage.
 *  Jede Größe verschiebt das Alter um wenige Jahre (gedeckelt), grob nach Studienlage. */
export function healthAge(model, i = model.days.length - 1) {
  const S = model.settings;
  if (!S.birthYear) return null;
  const all = model.days.slice(Math.max(0, i - 29), i + 1);
  const full = model.days.slice(Math.max(0, i - 30), i); // ganze Tage (ohne heute)
  if (all.filter((d) => d.sleep).length < 14) return null;
  const avg = (arr, f) => {
    const v = arr.map(f).filter(isNum);
    return v.length >= 7 ? mean(v) : null;
  };
  const items = [];
  const add = (key, label, value, years, better) => items.push({ key, label, value, years: Math.round(years * 10) / 10, better });

  const vo2 = model.profile?.vo2max;
  if (isNum(vo2)) {
    const norm = S.sex === 'female' ? 44 - 0.3 * S.age : 50.5 - 0.33 * S.age;
    add('vo2', 'VO₂max', `${Math.round(vo2)}`, clamp(-(vo2 - norm) * 0.6, -6, 6), 'Ausdauertraining in Zone 2 und Intervalle heben die VO₂max.');
  }
  const rhr = avg(all, (d) => d.rhr);
  if (rhr != null) add('rhr', 'Ruhepuls', `${Math.round(rhr)} bpm`, clamp((rhr - 60) * 0.15, -2.5, 3), 'Regelmäßiges Ausdauertraining senkt den Ruhepuls.');
  const sleepH = avg(all, (d) => (d.sleepMin != null ? d.sleepMin / 60 : null));
  if (sleepH != null) {
    const y = sleepH < 7 ? clamp((7 - sleepH) * 1.2, 0, 3) : sleepH > 9 ? clamp((sleepH - 9) * 1, 0, 2) : -0.5;
    add('sleep', 'Schlafdauer', `${fmtDur(sleepH * 60)} Std.`, y, '7–9 Stunden pro Nacht sind ideal.');
  }
  const cons = avg(all, (d) => d.consistency);
  if (cons != null) add('consistency', 'Schlafrhythmus', `${Math.round(cons)} %`, clamp(-(cons - 70) / 20, -1.5, 1.5), 'Jeden Tag ähnliche Schlafzeiten, auch am Wochenende.');
  const z13 = avg(full, (d) => (d.zoneMin ? d.zoneMin[0] + d.zoneMin[1] + d.zoneMin[2] : null));
  if (z13 != null) add('z13', 'Zonen 1–3 (Woche)', `${fmtDur(z13 * 7)} Std.`, clamp(1.2 - ((z13 * 7) / 150) * 1.4, -1.5, 1.2), 'Mindestens 2,5 Std. pro Woche mit leicht erhöhtem Puls (zügiges Gehen, lockeres Radeln).');
  const z45 = avg(full, (d) => (d.zoneMin ? d.zoneMin[3] + d.zoneMin[4] : null));
  if (z45 != null) add('z45', 'Zonen 4–5 (Woche)', `${fmtDur(z45 * 7)} Std.`, clamp(0.6 - (z45 * 7) / 40, -1.2, 0.6), 'Ein bis zwei kurze, harte Einheiten (Intervalle) pro Woche halten das Herz jung.');
  if (full.length >= 14) {
    const strengthMin = full.reduce((t, d) => t + d.acts.filter((a) => isStrength(a.type)).reduce((u, a) => u + (a.dur || 0) / 60, 0), 0);
    const week = (strengthMin * 7) / full.length;
    add('strength', 'Krafttraining (Woche)', `${fmtDur(week)} Std.`, clamp(0.6 - week / 90, -1.2, 0.6), 'Zwei Kraft-Einheiten pro Woche schützen Muskeln, Knochen und Stoffwechsel.');
  }
  const steps = avg(full, (d) => d.stats?.steps);
  if (steps != null) add('steps', 'Schritte', `${Math.round(steps / 100) * 100}/Tag`, clamp(((7000 - steps) / 2000) * 0.7, -1.2, 1.5), 'Ab 7.000–8.000 Schritten am Tag sinkt das Risiko deutlich.');

  if (items.length < 3) return null;
  const diff = items.reduce((t, x) => t + x.years, 0);
  return { age: S.age, pulsAge: Math.round((S.age + diff) * 10) / 10, diff: Math.round(diff * 10) / 10, items: items.sort((a, b) => b.years - a.years) };
}

export const isStrength = (type) => /strength|weight|krafttraining|hiit|functional/i.test(type || '');

/**
 * Tempo des Alterns: wie schnell sich dein Puls-Alter verändert – 1,0 = ein Jahr pro Jahr.
 * Geglättet aus 4 Wochenwerten jetzt gegen 4 Wochenwerte 60 Tage früher.
 */
export function paceOfAging(model, i = model.days.length - 1, back = 60) {
  const at = (k) => {
    const v = [0, 7, 14, 21].map((o) => healthAge(model, k - o)?.pulsAge).filter(isNum);
    return v.length >= 3 ? mean(v) : null;
  };
  if (i - back < 27) return null;
  const now = at(i);
  const then = at(i - back);
  if (now == null || then == null) return null;
  const pace = clamp(1 + ((now - then) * 365) / back / 4, -1, 3);
  return { pace: Math.round(pace * 10) / 10, now: Math.round(now * 10) / 10, then: Math.round(then * 10) / 10, days: back };
}

/** Muskel-Belastung einer Kraft- oder HIIT-Einheit (0–10), geschätzt aus Dauer und anaerobem Effekt. */
export function muscleLoad(a) {
  if (!isStrength(a?.type)) return null;
  const min = (a.dur || 0) / 60;
  const score = clamp((min / 60) * 4 + (isNum(a.ate) ? a.ate : 1.5) * 1.4, 0, 10);
  return { score: Math.round(score * 10) / 10, level: score >= 7 ? 'hoch' : score >= 4 ? 'mittel' : 'niedrig' };
}

// ---------------------------------------------------------------- Monatsbericht, Tagesrückblick, Ziele

function windowStats(days) {
  const avg = (f) => {
    const v = days.map(f).filter(isNum);
    return v.length ? mean(v) : null;
  };
  return {
    n: days.length,
    recovery: avg((d) => d.recovery),
    green: days.filter((d) => d.zone === 'green').length,
    hrv: avg((d) => d.hrv),
    rhr: avg((d) => d.rhr),
    sleep: avg((d) => d.sleepMin),
    strain: avg((d) => d.strain),
    steps: avg((d) => d.stats?.steps),
    training: days.filter((d) => d.acts.length).length,
  };
}

/** Monatsbericht: letzte 30 Tage gegen die 30 davor. */
export function monthlyAssessment(model, i = model.days.length - 1) {
  const cur = model.days.slice(Math.max(0, i - 29), i + 1);
  const prev = model.days.slice(Math.max(0, i - 59), Math.max(0, i - 29));
  const c = windowStats(cur);
  const p = windowStats(prev);
  if (c.recovery == null) return null;
  const dRec = p.recovery != null ? c.recovery - p.recovery : null;
  const dHrv = p.hrv != null && c.hrv != null ? (100 * (c.hrv - p.hrv)) / p.hrv : null;
  let verdict;
  if (dRec == null) verdict = { label: 'Erster Monat', tone: 'info', text: 'Ab nächstem Monat siehst du hier den Vergleich zum Vormonat.' };
  else if (dRec >= 4 && (dHrv ?? 0) >= 0) verdict = { label: 'Aufwärtstrend', tone: 'good', text: 'Recovery und HRV steigen – dein Körper verkraftet die Belastung besser als im Vormonat.' };
  else if (dRec <= -4 || (dHrv ?? 0) <= -8) verdict = { label: 'Abwärtstrend', tone: 'warn', text: 'Deine Erholung war schlechter als im Vormonat. Prüfe Schlafdauer, Stress und ob die Belastung zu schnell gestiegen ist.' };
  else verdict = { label: 'Stabil', tone: 'info', text: 'Ähnlich wie im Vormonat – eine gute Basis, um gezielt an einer Stellschraube zu drehen.' };
  const withRec = cur.filter((d) => d.recovery != null);
  const best = withRec.reduce((a, b) => (b.recovery > a.recovery ? b : a), withRec[0]);
  const hard = cur.filter((d) => d.strain != null).reduce((a, b) => (!a || b.strain > a.strain ? b : a), null);
  return { current: c, previous: p, verdict, best: best ? { date: best.date, recovery: best.recovery } : null, hardest: hard ? { date: hard.date, strain: hard.strain } : null };
}

/** Tagesrückblick (abends): Belastung gegen Ziel, Bewegung, Stress und was heute Nacht wichtig ist. */
export function dayReview(model, i = model.days.length - 1) {
  const d = model.days[i];
  if (d.strain == null) return null;
  const st = d.stats || {};
  const items = [];
  let title;
  if (d.target) {
    if (d.strain < d.target.low) title = `Strain ${d.strain.toFixed(1).replace('.', ',')} – unter deinem Ziel`;
    else if (d.strain > d.target.high) title = `Strain ${d.strain.toFixed(1).replace('.', ',')} – über deinem Ziel`;
    else title = `Strain ${d.strain.toFixed(1).replace('.', ',')} – genau im Ziel`;
  } else title = `Strain ${d.strain.toFixed(1).replace('.', ',')}`;
  if (d.acts.length) items.push(`${d.acts.length} ${d.acts.length === 1 ? 'Aktivität' : 'Aktivitäten'}, zusammen ${fmtDurLong(d.acts.reduce((t, a) => t + (a.dur || 0) / 60, 0))}`);
  if (isNum(st.steps)) items.push(`${Math.round(st.steps).toLocaleString('de-DE')} Schritte${isNum(st.stepGoal) ? (st.steps >= st.stepGoal ? ' – Ziel geschafft' : ` – ${Math.round(st.stepGoal - st.steps).toLocaleString('de-DE')} unter Ziel`) : ''}`);
  if (isNum(st.stress)) items.push(`Stress Ø ${st.stress} (${st.stress >= 50 ? 'hoch' : st.stress >= 26 ? 'mittel' : 'niedrig'})`);
  if (isNum(st.bbNow)) items.push(`Body Battery jetzt ${st.bbNow}`);
  let tonight = null;
  if (i === model.days.length - 1) {
    const plan = bedtimePlan(model, i);
    tonight = `Heute Nacht brauchst du ${fmtDur(plan.need.total)} Std. Schlaf – ins Bett um ${fmtClock(plan.options[0].bed)}.`;
  }
  return { title, items, tonight };
}

/** Wochenziele (Mo–heute): Trainingstage, Schlafnächte, Schrittziel-Tage. */
export function weekGoals(model, i, goals = {}) {
  const g = { train: 4, sleepH: 7.5, steps: 8000, ...goals };
  const last = model.days[i];
  const back = (weekday(last.date) + 6) % 7;
  const week = model.days.slice(Math.max(0, i - back), i + 1);
  return {
    goals: g,
    days: week.length,
    train: { done: week.filter((d) => d.acts.length || (d.strain ?? 0) >= 12).length, goal: g.train },
    sleep: { done: week.filter((d) => d.sleepMin != null && d.sleepMin >= g.sleepH * 60).length, goal: 7 },
    steps: { done: week.filter((d) => (d.stats?.steps ?? 0) >= g.steps).length, goal: 7 },
  };
}

/** Stress der letzten Tage als Tageswerte (für Woche/Monat). */
export function stressDays(model, i, n = 7) {
  return model.days.slice(Math.max(0, i - n + 1), i + 1).map((d) => ({ date: d.date, v: isNum(d.stats?.stress) ? d.stats.stress : null }));
}

/** Aktueller Stress: letzter Messwert der Tageskurve, sonst Tagesschnitt. */
export function stressNow(d) {
  const s = d.stressSeries;
  const v = s?.length ? s[s.length - 1][1] : isNum(d.stats?.stress) ? d.stats.stress : null;
  if (v == null) return null;
  const level = v >= 76 ? 'Hoch' : v >= 51 ? 'Mittel' : v >= 26 ? 'Niedrig' : 'Ruhe';
  return { value: Math.round(v), level, at: s?.length ? s[s.length - 1][0] : null };
}

// ---------------------------------------------------------------- Stress des Tages

export function stressSummary(d) {
  const st = d.stats || {};
  const parts = ['stressRest', 'stressLow', 'stressMed', 'stressHigh'].map((k) => (isNum(st[k]) ? st[k] / 60 : null));
  const known = parts.every(isNum);
  return {
    avg: isNum(st.stress) ? st.stress : null,
    minutes: known ? { rest: Math.round(parts[0]), low: Math.round(parts[1]), med: Math.round(parts[2]), high: Math.round(parts[3]) } : null,
    series: d.stressSeries,
    battery: d.bbSeries,
  };
}

// ---------------------------------------------------------------- Ernährung

export const GOALS = {
  gesund: 'Gesund & fit bleiben',
  abnehmen: 'Abnehmen',
  muskeln: 'Muskeln aufbauen',
  ausdauer: 'Ausdauer verbessern',
  leistung: 'Wettkampf & Leistung',
};
export const DIETS = { alles: 'Alles', vegetarisch: 'Vegetarisch', vegan: 'Vegan', pescetarisch: 'Pescetarisch' };

/**
 * Tagesziele für Energie, Makros und Wasser – aus Garmin-Verbrauch, Belastung und Ziel.
 * Grundlagen: Mifflin-St-Jeor (Grundumsatz), ISSN/ACSM (Eiweiß 1,4–2,2 g/kg, Kohlenhydrate 3–8 g/kg je
 * nach Belastung), DGE (Ballaststoffe, Wasser ~35 ml/kg + Sport), Koffein ≥ 8 Std. vor dem Schlafen.
 */
export function nutritionPlan(model, i, profile = {}, journal = {}, { partial = i === model.days.length - 1 } = {}) {
  const d = model.days[i];
  const S = model.settings;
  const kg = Number(profile.weight) || model.profile?.weight || null;
  const cm = Number(profile.height) || model.profile?.height || null;
  if (!isNum(kg) || kg < 30) return { missing: 'weight' };
  const goal = GOALS[profile.goal] ? profile.goal : 'gesund';
  const bmr = 10 * kg + 6.25 * (cm || (S.sex === 'female' ? 165 : 178)) - 5 * S.age + (S.sex === 'female' ? -161 : 5);
  const refKg = cm && kg / (cm / 100) ** 2 > 27 ? Math.round(25 * (cm / 100) ** 2) : kg; // Bezugsgewicht bei Übergewicht

  // Verbrauch: dein typischer Garmin-Gesamtverbrauch, angepasst an die heutige Belastung
  const past = model.days.slice(Math.max(0, i - 14), i).map((x) => x.stats?.kcal).filter((v) => isNum(v) && v > bmr);
  const base = past.length >= 4 ? median(past) : bmr * 1.45;
  const strains = model.days.slice(Math.max(0, i - 28), i).map((x) => x.strain).filter(isNum);
  const avgStrain = strains.length ? mean(strains) : 10;
  const target = d.target ? (d.target.low + d.target.high) / 2 : avgStrain;
  const strainBasis = partial ? Math.max(target, d.strain ?? 0) : d.strain ?? target;
  let burn = partial ? base * (1 + clamp((strainBasis - avgStrain) * 0.03, -0.1, 0.25)) : isNum(d.stats?.kcal) ? d.stats.kcal : base;
  if (partial && isNum(d.stats?.kcal)) burn = Math.max(burn, d.stats.kcal);

  const red = d.alarm || d.zone === 'red';
  const adjust = { gesund: 0, abnehmen: red ? -0.1 : -0.18, muskeln: 0.08, ausdauer: 0, leistung: 0.03 }[goal];
  const kcalTarget = Math.max(bmr * 1.1, burn * (1 + adjust));

  const protein = Math.round((refKg * { gesund: 1.4, abnehmen: 2.0, muskeln: 1.9, ausdauer: 1.6, leistung: 1.8 }[goal]) / 5) * 5;
  const cPerKg = strainBasis >= 17 ? 7 : strainBasis >= 14 ? 6 : strainBasis >= 10 ? 4.5 : strainBasis >= 7 ? 3.5 : 3;
  let carbs = refKg * Math.max(2, cPerKg - (goal === 'abnehmen' ? 1 : 0));
  let fat = (kcalTarget - protein * 4 - carbs * 4) / 9;
  const fatMin = 0.8 * refKg;
  if (fat < fatMin) {
    fat = fatMin;
    carbs = Math.max(2 * refKg, (kcalTarget - protein * 4 - fat * 9) / 4);
  }
  carbs = Math.round(carbs / 5) * 5;
  fat = Math.round(fat / 5) * 5;
  const kcal = Math.round((protein * 4 + carbs * 4 + fat * 9) / 50) * 50;

  // Training heute (gemacht oder noch geplant)
  const doneMin = d.acts.reduce((s, a) => s + (a.dur || 0) / 60, 0);
  const coach = d.recovery != null ? buildCoach(model, i) : null;
  const planMin = partial && coach?.remaining && !coach.remaining.done ? coach.remaining.z2 : 0;
  const trainMin = Math.round(doneMin + planMin);
  const water = Math.round((kg * 0.035 + (trainMin / 60) * 0.6) * 10) / 10;

  const plan = i === model.days.length - 1 ? bedtimePlan(model, i) : null;
  const bed = plan?.options[1].bed ?? null; // „Gut“-Zeit: realistisch spätestes Zubettgehen
  const caffeineCut = bed != null ? fmtClock(bed - 8 * 60) : null;
  const lastMeal = bed != null ? fmtClock(bed - 3 * 60) : null;
  const perMeal = Math.round((0.4 * refKg) / 5) * 5;

  const tips = [];
  const add = (key, text) => tips.push({ key, text });
  if (trainMin >= 30) {
    add('training', `Vor dem Training Kohlenhydrate, danach ${perMeal}–${perMeal + 10} g Eiweiß.`);
  }
  add('protein', `Eiweiß auf 4 Mahlzeiten à ${perMeal} g verteilen.`);
  if (red) add('red', 'Erholungstag: viel Gemüse, Obst und Wasser, kein Alkohol.');
  const y = journal?.[addDays(d.date, -1)];
  if (y?._done && y.alkohol) add('alkohol', 'Nach Alkohol gestern: 0,5 L extra trinken, mit etwas Salz.');
  if (caffeineCut) add('koffein', `Letzter Kaffee bis ${caffeineCut}, letzte große Mahlzeit bis ${lastMeal}.`);
  if (profile.diet === 'vegan') add('vegan', 'Vegan: Soja, Linsen und Seitan kombinieren, an B12 denken.');
  if (profile.diet === 'vegetarisch') add('vegetarisch', 'Eier, Milchprodukte und Hülsenfrüchte decken das Eiweiß.');
  if (goal === 'abnehmen') add('abnehmen', `Defizit ca. ${Math.round(burn - kcal)} kcal – viel Eiweiß schützt die Muskeln.`);

  const strainWord = strainBasis >= 17 ? 'sehr harter Tag' : strainBasis >= 14 ? 'harter Tag' : strainBasis >= 10 ? 'Trainingstag' : 'ruhiger Tag';
  const basis = `Verbrauch ca. ${Math.round(burn / 10) * 10} kcal (dein Garmin-Schnitt ${Math.round(base / 10) * 10} kcal, angepasst an Strain ${strainBasis.toFixed(1).replace('.', ',')} = ${strainWord}). Ziel „${GOALS[goal]}“: ${adjust ? `${adjust > 0 ? '+' : '−'}${Math.round(Math.abs(adjust) * 100)} %` : 'ausgeglichen'}. Eiweiß ${(protein / refKg).toFixed(1).replace('.', ',')} g/kg, Kohlenhydrate ${(carbs / refKg).toFixed(1).replace('.', ',')} g/kg${refKg !== kg ? ` (bezogen auf ${refKg} kg Normalgewicht)` : ''}.`;

  return { kcal, protein, carbs, fat, water, fiber: 30, burn: Math.round(burn), base: Math.round(base), bmr: Math.round(bmr), goal, goalLabel: GOALS[goal], strainBasis, strainWord, trainMin, perMeal, caffeineCut, lastMeal, tips, basis, kg, refKg };
}

// ---------------------------------------------------------------- Gesundheits-Check (Trends wie beim Arzt)

/**
 * Letzte 7 Tage gegen deine eigene Basis (die bis zu 60 Tage davor) – plus Hinweise, wann ein Arzt draufschauen sollte.
 * Schwellen orientieren sich an üblichen Faustregeln aus Sportmedizin und Schlafmedizin; keine Diagnose.
 */
export function healthTrends(model, i = model.days.length - 1) {
  const days = model.days;
  const recent = days.slice(Math.max(0, i - 6), i + 1);
  const two = days.slice(Math.max(0, i - 13), i + 1);
  const base = days.slice(Math.max(0, i - 67), Math.max(0, i - 6));
  const avg = (arr, f, min = 3) => {
    const v = arr.map(f).filter(isNum);
    return v.length >= min ? mean(v) : null;
  };
  const items = [];
  const flags = [];
  const flag = (level, key, title, text) => flags.push({ level, key, title, text });
  const ready = base.filter((x) => x.rhr != null).length >= 14;
  const r1 = (v) => Math.round(v * 10) / 10;

  const item = (key, label, unit, now, ref, { digits = 0, goodUp, warnAbs, warnRel, text }) => {
    if (now == null) return null;
    const delta = ref != null ? now - ref : null;
    const rel = ref ? delta / ref : null;
    let status = 'ok';
    if (delta != null) {
      const bad = goodUp ? -delta : delta;
      const badRel = goodUp ? -rel : rel;
      if ((warnAbs != null && bad >= warnAbs) || (warnRel != null && badRel >= warnRel)) status = 'watch';
      else if ((warnAbs != null && -bad >= warnAbs * 0.6) || (warnRel != null && -badRel >= warnRel * 0.6)) status = 'good';
    }
    const it = { key, label, unit, value: digits ? r1(now) : Math.round(now), base: ref == null ? null : digits ? r1(ref) : Math.round(ref), delta: delta == null ? null : digits ? r1(delta) : Math.round(delta), status, text };
    items.push(it);
    return it;
  };

  const rhrNow = avg(recent, (x) => x.rhr);
  const rhrBase = ready ? avg(base, (x) => x.rhr, 14) : null;
  const rhr = item('rhr', 'Ruhepuls', 'bpm', rhrNow, rhrBase, { goodUp: false, warnAbs: 4, text: 'Steigt bei Infekten, Stress, Übertraining und Schlafmangel; sinkt mit besserer Fitness.' });
  if (rhr && rhrBase != null && rhrNow - rhrBase >= 8) flag('arzt', 'rhr', 'Ruhepuls seit Tagen deutlich erhöht', `Seit einer Woche im Schnitt ${Math.round(rhrNow - rhrBase)} bpm über deinem Normalwert. Wenn du dich krank fühlst, Fieber, Herzstolpern oder Atemnot hast: ärztlich abklären lassen und bis dahin nicht hart trainieren.`);
  else if (rhr?.status === 'watch') flag('beobachten', 'rhr', 'Ruhepuls erhöht', `Seit 7 Tagen ${Math.round(rhrNow - rhrBase)} bpm über deiner Basis – oft Stress, wenig Schlaf, Alkohol oder ein beginnender Infekt. Belastung etwas zurückfahren.`);
  if (rhrNow != null && rhrNow > 90) flag('arzt', 'rhr-high', 'Ruhepuls über 90', 'Ein dauerhaft so hoher Ruhepuls sollte ärztlich angeschaut werden.');

  const hrvNow = avg(recent, (x) => x.hrv);
  const hrvBase = ready ? avg(base, (x) => x.hrv, 14) : null;
  const hrv = item('hrv', 'HRV', 'ms', hrvNow, hrvBase, { goodUp: true, warnRel: 0.12, text: 'Höher = Nervensystem gut erholt. Fällt bei Belastung, Stress, Alkohol und Infekten.' });
  if (hrv?.status === 'watch') flag('beobachten', 'hrv', 'HRV unter deinem Normalbereich', `Die Woche liegt ${Math.round(-100 * (hrvNow / hrvBase - 1))} % unter deiner Basis. Zeichen für zu wenig Erholung – Schlaf und lockere Tage priorisieren.`);

  const respNow = avg(recent, (x) => x.resp);
  const respBase = ready ? avg(base, (x) => x.resp, 10) : null;
  const resp = item('resp', 'Atemfrequenz', '/Min.', respNow, respBase, { digits: 1, goodUp: false, warnAbs: 0.8, text: 'Im Schlaf sehr stabil – ein Anstieg ist ein frühes Infektzeichen.' });
  const respHigh = respBase != null ? recent.filter((x) => isNum(x.resp) && x.resp - respBase >= 2).length : 0;
  if (respHigh >= 3) flag('arzt', 'resp', 'Atemfrequenz mehrere Nächte erhöht', 'In mindestens 3 Nächten 2 Atemzüge pro Minute über normal. Zusammen mit Husten, Fieber oder Atemnot ärztlich abklären.');
  else if (resp?.status === 'watch') flag('beobachten', 'resp', 'Atemfrequenz leicht erhöht', 'Kann ein frühes Infektzeichen sein – auf Symptome achten, Training locker halten.');

  const sleepNow = avg(two, (x) => (x.sleepMin != null ? x.sleepMin / 60 : null), 5);
  const sleepBase = ready ? avg(base, (x) => (x.sleepMin != null ? x.sleepMin / 60 : null), 14) : null;
  item('sleep', 'Schlaf (14 Tage)', 'Std.', sleepNow, sleepBase, { digits: 1, goodUp: true, warnAbs: 0.5, text: 'Erwachsene brauchen 7–9 Std. Dauerhaft unter 6 Std. erhöht Infekt-, Herz- und Stoffwechselrisiken.' });
  if (sleepNow != null && sleepNow < 6) flag('beobachten', 'sleep', 'Zu wenig Schlaf', `Seit 2 Wochen im Schnitt nur ${fmtDur(sleepNow * 60)} Std. – das bremst Erholung, Leistung und Abnehmen.`);

  const beds = two.map((x) => x.sleep?.bed).filter(isNum);
  if (beds.length >= 7) {
    const spread = Math.round(sd(beds));
    items.push({ key: 'rhythm', label: 'Schlafrhythmus', unit: 'Min.', value: spread, base: null, delta: null, status: spread > 60 ? 'watch' : spread <= 30 ? 'good' : 'ok', text: 'Wie stark deine Einschlafzeit schwankt (Standardabweichung). Unter 30 Min. ist ideal.', spread: true });
    if (spread > 60) flag('beobachten', 'rhythm', 'Unregelmäßiger Schlafrhythmus', `Deine Einschlafzeit schwankt um ±${spread} Min. Feste Zeiten (auch am Wochenende) verbessern Tiefschlaf und HRV.`);
  }

  const spo = two.map((x) => x.sleep?.spo2).filter(isNum);
  if (spo.length >= 5) {
    const low = spo.filter((v) => v < 92).length;
    items.push({ key: 'spo2', label: 'Blutsauerstoff nachts', unit: '%', value: Math.round(mean(spo)), base: null, delta: null, status: low >= 3 ? 'watch' : 'ok', text: 'Normal sind 95–100 %. Garmin misst am Handgelenk – einzelne tiefe Werte sind oft Messfehler.', lowNights: low });
    if (low >= 3) flag('arzt', 'spo2', 'Blutsauerstoff nachts öfter niedrig', `In ${low} von ${spo.length} Nächten im Schnitt unter 92 %. Wenn du schnarchst, tagsüber müde bist oder morgens Kopfschmerzen hast: beim Arzt Schlafapnoe abklären lassen.`);
  }

  const temps = recent.filter((x) => isNum(x.skinTemp) && x.skinTemp >= 0.6).length;
  if (temps >= 2) flag('beobachten', 'temp', 'Hauttemperatur erhöht', `In ${temps} Nächten mehr als 0,5 °C über normal – möglicher Infekt (bei Frauen auch zyklusbedingt).`);

  const imWeek = recent.reduce((s, x) => s + (x.stats?.imMod || 0) + 2 * (x.stats?.imVig || 0), 0);
  if (recent.some((x) => isNum(x.stats?.imMod))) {
    items.push({ key: 'im', label: 'Intensitätsminuten (7 Tage)', unit: 'Min.', value: Math.round(imWeek), base: 150, delta: null, status: imWeek >= 150 ? 'good' : imWeek < 75 ? 'watch' : 'ok', text: 'WHO-Empfehlung: mindestens 150 Min. moderate Bewegung pro Woche (intensive zählt doppelt).' });
    if (imWeek < 75) flag('beobachten', 'im', 'Wenig Bewegung diese Woche', `Nur ${Math.round(imWeek)} von empfohlenen 150 Intensitätsminuten. Zügiges Gehen oder lockeres Radfahren zählt schon.`);
  }

  const stepsNow = avg(recent.slice(0, -1), (x) => x.stats?.steps, 3);
  if (stepsNow != null) items.push({ key: 'steps', label: 'Schritte (Ø)', unit: '', value: Math.round(stepsNow / 100) * 100, base: null, delta: null, status: stepsNow >= 8000 ? 'good' : stepsNow < 5000 ? 'watch' : 'ok', text: 'Ab ca. 7.000–8.000 Schritten am Tag sinkt das Sterberisiko deutlich (Meta-Analysen).' });

  const vo2 = model.profile?.vo2max;
  if (isNum(vo2)) {
    const S = model.settings;
    const norm = S.sex === 'female' ? 44 - 0.3 * S.age : 50.5 - 0.33 * S.age;
    const diff = vo2 - norm;
    items.push({ key: 'vo2', label: 'VO₂max', unit: '', value: Math.round(vo2), base: Math.round(norm), delta: Math.round(diff), status: diff >= 3 ? 'good' : diff <= -5 ? 'watch' : 'ok', text: `Stärkster Einzelfaktor für Lebenserwartung. Durchschnitt für dein Alter ca. ${Math.round(norm)}.` });
  }

  const order = { arzt: 0, beobachten: 1, info: 2 };
  flags.sort((a, b) => order[a.level] - order[b.level]);
  const verdict = flags.some((f) => f.level === 'arzt') ? 'arzt' : flags.length ? 'beobachten' : 'gut';
  return { ready, items, flags, verdict };
}

// ---------------------------------------------------------------- Kontext für den KI-Coach

const fmtN = (v, digits = 0) => (isNum(v) ? (digits ? v.toFixed(digits).replace('.', ',') : String(Math.round(v))) : '–');

/** Kompakte Text-Zusammenfassung aller Daten für den Coach (ohne Rohdaten). */
export function coachContext(model, journal = {}, i = model.days.length - 1, profile = {}, training = '') {
  const S = model.settings;
  const d = model.days[i];
  const lines = [];
  const L = (t = '') => lines.push(t);
  const zones = hrZones(d.rhrRef, S.maxHr);
  const wd = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][weekday(iso)];

  L(`Datenstand: ${model.generated || 'unbekannt'} · Heute ist ${wd(d.date)}, ${d.date}.`);
  L(`Profil: ${S.sex === 'female' ? 'weiblich' : 'männlich'}, ${S.age} Jahre, Max-Puls ${S.maxHr}, Ruhepuls-Basis ${d.rhrRef} bpm, Hauptsport ${SPORTS[S.sport]}, Schlafbedarf-Basis ${fmtDur(S.sleepNeed)} h${isNum(model.profile?.vo2max) ? `, VO2max ${model.profile.vo2max}` : ''}.`);
  L(`Pulszonen (Herzfrequenzreserve): ${zones.map((z) => `Z${z.zone} ${z.lo}–${z.hi}`).join(', ')} bpm.`);
  const kg = Number(profile?.weight) || model.profile?.weight;
  const cm = Number(profile?.height) || model.profile?.height;
  const me = [
    profile?.goal && GOALS[profile.goal] ? `Ziel: ${GOALS[profile.goal]}` : 'Ziel: nicht angegeben',
    kg ? `Gewicht ${fmtN(kg, 1)} kg` : 'Gewicht unbekannt',
    cm ? `Größe ${cm} cm${kg ? `, BMI ${fmtN(kg / (cm / 100) ** 2, 1)}` : ''}` : null,
    profile?.diet && DIETS[profile.diet] ? `Ernährung: ${DIETS[profile.diet]}` : null,
  ].filter(Boolean);
  L(`Angaben des Nutzers: ${me.join(', ')}.`);
  const free = [['Training & Wünsche', profile?.training], ['Essen (Vorlieben, Unverträglichkeiten)', profile?.food], ['Gesundheit (Vorerkrankungen, Medikamente, Beschwerden)', profile?.health]]
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}: ${v.trim().slice(0, 400)}`);
  if (free.length) L(`<nutzerangaben>\n${free.join('\n')}\n</nutzerangaben>`);
  L();

  L('## Heute');
  if (d.recovery != null) {
    L(`Recovery ${d.recovery} % (${{ green: 'grün', yellow: 'gelb', red: 'rot' }[d.zone]})${d.base.calibrating ? ' – noch in Kalibrierung' : ''}.`);
    for (const c of d.comps) {
      if (c.key === 'hrv') L(`- HRV ${fmtN(c.value)} ms, normal ${fmtN(c.ref)} ms (${signed(100 * (c.value / c.ref - 1))} %), Teilscore ${fmtN(c.score)}/100.`);
      if (c.key === 'rhr') L(`- Ruhepuls ${fmtN(c.value)} bpm, normal ${fmtN(c.ref, 1)} bpm, Teilscore ${fmtN(c.score)}/100.`);
      if (c.key === 'sleep') L(`- Schlaf ${fmtDur(c.value)} von ${fmtDur(c.ref)} Std. Bedarf (${fmtN(d.perf)} %), Qualität ${fmtN(c.quality)}, Teilscore ${fmtN(c.score)}/100.`);
    }
    for (const p of d.penalties) L(`- Abzug ${p.key === 'resp' ? 'Atemfrequenz' : 'Hauttemperatur'}: −${fmtN(p.points)} Punkte (${signed(p.delta, 1)}).`);
    if (d.alarm) L(`- WARNSIGNALE aktiv: ${Object.entries(d.flags).filter(([, v]) => v).map(([k]) => k).join(', ')}.`);
    L(`Ziel-Strain heute ${fmtN(d.target.low, 1)}–${fmtN(d.target.high, 1)}${d.target.notes.length ? ` (Anpassung: ${d.target.notes.join(', ')})` : ''}.`);
  } else {
    L('Recovery: noch keine Schlafdaten für heute.');
  }
  L(`Strain bisher ${fmtN(d.strain, 1)} von 21${d.acts.length ? `; Aktivitäten: ${d.acts.map((a) => `${a.name || a.type} ${a.start} ${Math.round(a.dur / 60)} Min. Ø${a.avgHr || '–'} bpm (Strain ${fmtN(a.strain, 1)})`).join('; ')}` : ''}.`);
  if (!training) {
    const coach = buildCoach(model, i);
    if (coach.plan) L(`App-Empfehlung Training: ${coach.plan} ${coach.remaining?.text || ''}`);
  }
  const st = d.stats || {};
  L(`Tageswerte: Schritte ${fmtN(st.steps)}${st.padSteps ? ` (davon ${fmtN(st.padSteps)} vom Walking-Pad, das die Uhr nicht gezählt hat)` : ''}, Kalorien ${fmtN(st.kcal)}, Stress Ø ${fmtN(st.stress)}, Body Battery max ${fmtN(st.bbHigh)}${isNum(st.bbNow) ? ` jetzt ${st.bbNow}` : ''}.`);
  if (i === model.days.length - 1) {
    const plan = bedtimePlan(model, i);
    L(`Schlaf heute Nacht: Bedarf ${fmtDur(plan.need.total)} Std. (Basis ${fmtDur(plan.need.base)}, +${Math.round(plan.need.strain)} Belastung, +${Math.round(plan.need.debt)} Schlafschuld, +${plan.need.recovery} Erholung). Aufstehen ${fmtClock(plan.wake)} → ins Bett ${plan.options.map((o) => `${o.label} ${fmtClock(o.bed)}`).join(', ')}.`);
  }
  if (d.sleep) {
    const s = d.sleep;
    L(`Letzte Nacht: ${isNum(s.bed) ? `${fmtClock(s.bed)}–${fmtClock(s.wake)}` : ''}, Tief ${fmtN(d.stages.deep)} %, REM ${fmtN(d.stages.rem)} %, Leicht ${fmtN(d.stages.light)} %, Wach ${fmtN(s.awake / 60)} Min., Effizienz ${fmtN(d.eff * 100)} %, Konstanz ${fmtN(d.consistency)} %, Schlafschuld 7 Tage ${fmtDur(d.debt7 || 0)} Std., Garmin-Score ${fmtN(s.score)}.`);
  }
  const v = vitals(model, i);
  L(`Körper-Check: ${v.items.map((x) => `${x.label} ${x.digits ? fmtN(x.value, 1) : fmtN(x.value)} ${x.unit} (${x.status})`).join(', ')}.`);
  if (d.load) L(`Trainingslast: akut/chronisch ${d.load.ratio.toFixed(2)} (optimal 0,8–1,3).`);
  if (d.hrv7) L(`HRV-Trend: 7-Tage-Schnitt ${fmtN(d.hrv7)} ms${d.hrvNormal ? `, Normalbereich ${fmtN(d.hrvNormal[0])}–${fmtN(d.hrvNormal[1])} ms (${d.hrvTrend})` : ''}.`);
  const ins = buildInsights(model, i, journal);
  if (ins.length) L(`Hinweise der App: ${ins.map((x) => `${x.title} (${x.text})`).join(' | ')}`);
  L();
  if (training) {
    L(training);
    L();
  }

  const ht = healthTrends(model, i);
  if (ht.items.length) {
    L(`## Gesundheits-Check (letzte 7 Tage gegen die ${ht.ready ? 'bis zu 60 Tage davor' : 'wenigen Tage davor – Basis noch dünn'})`);
    L(ht.items.map((x) => `${x.label} ${x.value}${x.unit ? ` ${x.unit}` : ''}${x.base != null ? ` (Basis ${x.base}${x.delta != null ? `, ${signed(x.delta, x.key === 'resp' || x.key === 'sleep' ? 1 : 0)}` : ''})` : ''} [${x.status}]`).join('; ') + '.');
    for (const f of ht.flags) L(`- ${f.level.toUpperCase()}: ${f.title} – ${f.text}`);
    L();
  }
  const np = nutritionPlan(model, i, profile || {}, journal);
  if (np.missing) {
    L('## Ernährung: Gewicht fehlt – Puls kann noch keine Zielwerte berechnen (Nutzer kann es unter Einstellungen → Über dich eintragen).');
  } else {
    L(`## Ernährung heute (von Puls berechnet – diese Zahlen verwenden): ${np.kcal} kcal, Eiweiß ${np.protein} g, Kohlenhydrate ${np.carbs} g, Fett ${np.fat} g, Ballaststoffe ${np.fiber} g, Wasser ${fmtN(np.water, 1)} L. ${np.basis}${np.caffeineCut ? ` Koffein bis ${np.caffeineCut}, letzte große Mahlzeit bis ${np.lastMeal}.` : ''} Training heute ca. ${np.trainMin} Min.`);
  }
  L();

  const w = weeklyAssessment(model, model.days.length - 1);
  L(`## Woche: ${w.verdict.label}. ${w.bullets.join(' ')}`);
  const ha = healthAge(model, model.days.length - 1);
  if (ha) L(`Puls-Alter ${fmtN(ha.pulsAge, 1)} (echtes Alter ${ha.age}): ${ha.items.map((x) => `${x.label} ${x.value} ${signed(x.years, 1)} Jahre`).join(', ')}.`);
  const pace = paceOfAging(model);
  if (pace) L(`Tempo des Alterns ${fmtN(pace.pace, 1)}x (Puls-Alter vor ${pace.days} Tagen ${fmtN(pace.then, 1)}, jetzt ${fmtN(pace.now, 1)}).`);
  const mon = monthlyAssessment(model);
  if (mon) L(`Monat: ${mon.verdict.label} – Recovery Ø ${fmtN(mon.current.recovery)} % (Vormonat ${fmtN(mon.previous.recovery)} %), HRV Ø ${fmtN(mon.current.hrv)} ms (Vormonat ${fmtN(mon.previous.hrv)}), ${mon.current.training} Trainingstage.`);
  const imp = journalImpacts(model, journal).filter((x) => !x.pending);
  const inf = model.influences.ready ? model.influences.items : [];
  if (imp.length || inf.length) {
    L(`Einflüsse auf die Recovery (Prozentpunkte, Tage mit vs. ohne): ${[...imp.map((x) => `${x.label} ${signed(x.diff)} (${x.ny}/${x.nn})`), ...inf.map((x) => `${x.title} ${signed(x.diff)} (${x.na}/${x.nb})`)].join(', ')}.`);
  }
  L();

  L('## Letzte 14 Tage (Datum | Recovery | HRV | Ruhepuls | Schlaf Std. | Schlaf-% | Strain | Schritte | Stress | Training | Morgen-Check des Vortags)');
  for (let k = Math.max(0, i - 13); k <= i; k++) {
    const x = model.days[k];
    const j = journal?.[addDays(x.date, -1)];
    const jtxt = j?._done ? JOURNAL_QUESTIONS.filter((q) => j[q.id]).map((q) => q.label).join('+') || 'nichts' : '';
    L(`${wd(x.date)} ${x.date} | ${x.recovery ?? '–'} | ${fmtN(x.hrv)} | ${fmtN(x.rhr)} | ${x.sleepMin != null ? fmtDur(x.sleepMin) : '–'} | ${fmtN(x.perf)} | ${fmtN(x.strain, 1)} | ${fmtN(x.stats?.steps)} | ${fmtN(x.stats?.stress)} | ${x.acts.map((a) => `${a.name || a.type} ${Math.round(a.dur / 60)}′`).join(', ') || '–'} | ${jtxt}`);
  }
  const last30 = model.days.slice(Math.max(0, i - 29), i + 1);
  const m30 = (f) => mean(last30.map(f).filter(isNum));
  L(`30-Tage-Schnitt: Recovery ${fmtN(m30((x) => x.recovery))} %, HRV ${fmtN(m30((x) => x.hrv))} ms, Ruhepuls ${fmtN(m30((x) => x.rhr), 1)}, Schlaf ${fmtDur(m30((x) => x.sleepMin) || 0)} Std., Strain ${fmtN(m30((x) => x.strain), 1)}, Schritte ${fmtN(m30((x) => x.stats?.steps))}.`);
  L(`Daten vorhanden ab ${model.days[0].date} (${model.days.length} Tage).`);
  return lines.join('\n');
}

/** Detailansicht eines Tages für das Coach-Tool get_day_details. */
export function dayDetails(model, date, journal = {}) {
  const i = model.index[date];
  if (i == null) return { error: `Keine Daten für ${date}. Verfügbar: ${model.days[0].date} bis ${model.days[model.days.length - 1].date}.` };
  const d = model.days[i];
  const coach = buildCoach(model, i);
  return {
    date,
    recovery: d.recovery,
    zone: d.zone,
    components: d.comps.map((c) => ({ key: c.key, value: c.value, normal: c.ref, score: Math.round(c.score) })),
    penalties: d.penalties,
    warnings: d.alarm ? d.flags : null,
    strain: d.strain != null ? Math.round(d.strain * 10) / 10 : null,
    target: d.target,
    coach: coach.state === 'nodata' ? coach.text : { headline: coach.headline, plan: coach.plan, remaining: coach.remaining?.text },
    sleep: d.sleep
      ? {
          start: isNum(d.sleep.bed) ? fmtClock(d.sleep.bed) : null,
          end: isNum(d.sleep.wake) ? fmtClock(d.sleep.wake) : null,
          hours: fmtDur(d.sleepMin),
          need: fmtDur(d.need.total),
          needParts: d.need,
          performance: Math.round(d.perf),
          stagesPct: { deep: d.stages.deep && Math.round(d.stages.deep), rem: d.stages.rem && Math.round(d.stages.rem), light: d.stages.light && Math.round(d.stages.light) },
          awakeMin: d.sleep.awake != null ? Math.round(d.sleep.awake / 60) : null,
          efficiencyPct: d.eff != null ? Math.round(d.eff * 100) : null,
          consistencyPct: d.consistency,
          garminScore: d.sleep.score ?? null,
          respiration: d.resp,
          spo2: d.sleep.spo2 ?? null,
        }
      : null,
    activities: d.acts.map((a) => ({ name: a.name, type: a.type, start: a.start, minutes: Math.round(a.dur / 60), km: a.dist ? Math.round(a.dist / 100) / 10 : null, avgHr: a.avgHr, maxHr: a.maxHr, strain: Math.round(a.strain * 10) / 10, trainingEffect: a.te ?? null })),
    hrZoneMinutes: d.zoneMin,
    stats: d.stats,
    walkingPad: d.pad ? { steps: d.pad.total, addedToWatch: d.pad.added, minutes: d.pad.minutes, sessions: d.pad.units.map(([s, e, n]) => `${fmtClock(s)}–${fmtClock(e)}: ${n} Schritte`) } : null,
    stress: stressSummary(d).minutes,
    insights: buildInsights(model, i, journal).map((x) => `${x.title}: ${x.text}`),
    morningCheckPreviousDay: journal?.[addDays(date, -1)] || null,
  };
}

/** Tabelle mehrerer Tage für das Coach-Tool get_days. */
export function daysTable(model, from, to, journal = {}) {
  const out = [];
  for (const d of model.days) {
    if (d.date < from || d.date > to) continue;
    const j = journal?.[d.date];
    out.push({
      date: d.date,
      recovery: d.recovery,
      hrv: d.hrv,
      rhr: d.rhr,
      sleepHours: d.sleepMin != null ? Math.round((d.sleepMin / 60) * 10) / 10 : null,
      sleepPerf: d.perf != null ? Math.round(d.perf) : null,
      strain: d.strain != null ? Math.round(d.strain * 10) / 10 : null,
      steps: d.stats?.steps ?? null,
      ...(d.pad ? { walkingPad: { steps: d.pad.total, addedToWatch: d.pad.added, minutes: d.pad.minutes } } : {}),
      stress: d.stats?.stress ?? null,
      activities: d.acts.map((a) => `${a.name || a.type} ${Math.round(a.dur / 60)}min`),
      behaviorsThisDay: j?._done ? JOURNAL_QUESTIONS.filter((q) => j[q.id]).map((q) => q.label) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Kontext für die Oberfläche

/** Was die Recovery heute gehoben bzw. gebremst hat – stärkster Einfluss zuerst. */
export function recoveryDrivers(d) {
  const out = [];
  for (const c of d.comps || []) {
    if (c.key === 'hrv') {
      const p = 100 * (c.value / c.ref - 1);
      out.push({ key: 'hrv', label: `HRV ${signed(p)} %`, good: p >= 0, neutral: Math.abs(p) < 3, impact: c.w * (c.score - 56) });
    } else if (c.key === 'rhr') {
      const diff = Math.round(c.value - c.ref);
      out.push({ key: 'rhr', label: `Ruhepuls ${signed(diff)} bpm`, good: diff <= 0, neutral: Math.abs(diff) <= 1, impact: c.w * (c.score - 56) });
    } else if (c.key === 'sleep') {
      out.push({ key: 'sleep', label: `Schlaf ${Math.round(d.perf)} %`, good: d.perf >= 85, neutral: d.perf >= 80 && d.perf < 90, impact: c.w * (c.score - 80) });
    }
  }
  for (const p of d.penalties || []) {
    out.push({ key: p.key, label: p.key === 'resp' ? `Atmung ${signed(p.delta, 1)}` : `Temperatur ${signed(p.delta, 1)} °C`, good: false, impact: -p.points });
  }
  return out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

/** Trend der letzten 7 Werte gegenüber den 7 davor. */
export function trend(values, rel = 0.03) {
  const v = values.filter(isNum);
  if (v.length < 8) return null;
  const a = mean(v.slice(-7));
  const b = mean(v.slice(-14, -7));
  if (!b) return null;
  const change = (a - b) / Math.abs(b);
  return { dir: change > rel ? 'up' : change < -rel ? 'down' : 'flat', change, recent: a, before: b };
}

/** Zeitraum mit dem höchsten Stress (2-Stunden-Fenster) aus der 10-Minuten-Kurve. */
export function stressPeak(series) {
  if (!series || series.length < 12) return null;
  let best = null;
  for (let k = 0; k + 12 <= series.length; k++) {
    const win = series.slice(k, k + 12);
    if (win[11][0] - win[0][0] > 150) continue;
    const m = mean(win.map((p) => p[1]));
    if (!best || m > best.avg) best = { from: win[0][0], to: win[11][0] + 10, avg: m };
  }
  return best;
}
