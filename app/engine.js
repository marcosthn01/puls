// Puls – Auswertung deiner Garmin-Daten.
// Reines Modul ohne DOM: läuft im Browser und in den Node-Tests (tests/engine.test.mjs).
// Methodik in Kurzform steht in der App unter Einstellungen → "So rechnet Puls".

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
    stats: raw.stats || {},
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

  // Zielbelastung für heute
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
  return {
    empty: false,
    settings: S,
    days,
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
  { id: 'unterwegs', label: 'Unterwegs / fremdes Bett' },
  { id: 'sex', label: 'Sex' },
];

/** Verhalten an Tag D wirkt auf die Recovery am Morgen von D+1. */
export function journalImpacts(model, journal) {
  const out = [];
  for (const q of JOURNAL_QUESTIONS) {
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
  const moderate = avg(full, (d) => (d.zoneMin ? d.zoneMin.reduce((a, b) => a + b, 0) : null));
  if (moderate != null) add('active', 'Aktive Minuten', `${Math.round(moderate * 7)} Min./Woche`, clamp(1.5 - (moderate * 7) / 100, -2.5, 1.5), 'Mindestens 150 Min. pro Woche mit erhöhtem Puls.');
  const vigorous = avg(full, (d) => (d.zoneMin ? d.zoneMin[2] + d.zoneMin[3] + d.zoneMin[4] : null));
  if (vigorous != null) add('vigorous', 'Intensive Minuten', `${Math.round(vigorous * 7)} Min./Woche`, clamp(0.5 - (vigorous * 7) / 50, -1, 0.5), '75 Min. pro Woche ab Zone 3 bringen viel.');
  const steps = avg(full, (d) => d.stats?.steps);
  if (steps != null) add('steps', 'Schritte', `${Math.round(steps / 100) * 100}/Tag`, clamp(((7000 - steps) / 2000) * 0.7, -1.2, 1.5), 'Ab 7.000–8.000 Schritten am Tag sinkt das Risiko deutlich.');

  if (items.length < 3) return null;
  const diff = items.reduce((t, x) => t + x.years, 0);
  return { age: S.age, pulsAge: Math.round((S.age + diff) * 10) / 10, diff: Math.round(diff * 10) / 10, items: items.sort((a, b) => b.years - a.years) };
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

// ---------------------------------------------------------------- Kontext für den KI-Coach

const fmtN = (v, digits = 0) => (isNum(v) ? (digits ? v.toFixed(digits).replace('.', ',') : String(Math.round(v))) : '–');

/** Kompakte Text-Zusammenfassung aller Daten für den Coach (ohne Rohdaten). */
export function coachContext(model, journal = {}, i = model.days.length - 1) {
  const S = model.settings;
  const d = model.days[i];
  const lines = [];
  const L = (t = '') => lines.push(t);
  const zones = hrZones(d.rhrRef, S.maxHr);
  const wd = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][weekday(iso)];

  L(`Datenstand: ${model.generated || 'unbekannt'} · Heute ist ${wd(d.date)}, ${d.date}.`);
  L(`Profil: ${S.sex === 'female' ? 'weiblich' : 'männlich'}, ${S.age} Jahre, Max-Puls ${S.maxHr}, Ruhepuls-Basis ${d.rhrRef} bpm, Hauptsport ${SPORTS[S.sport]}, Schlafbedarf-Basis ${fmtDur(S.sleepNeed)} h${isNum(model.profile?.vo2max) ? `, VO2max ${model.profile.vo2max}` : ''}.`);
  L(`Pulszonen (Herzfrequenzreserve): ${zones.map((z) => `Z${z.zone} ${z.lo}–${z.hi}`).join(', ')} bpm.`);
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
  const coach = buildCoach(model, i);
  if (coach.plan) L(`App-Empfehlung Training: ${coach.plan} ${coach.remaining?.text || ''}`);
  const st = d.stats || {};
  L(`Tageswerte: Schritte ${fmtN(st.steps)}, Kalorien ${fmtN(st.kcal)}, Stress Ø ${fmtN(st.stress)}, Body Battery max ${fmtN(st.bbHigh)}${isNum(st.bbNow) ? ` jetzt ${st.bbNow}` : ''}.`);
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

  const w = weeklyAssessment(model, model.days.length - 1);
  L(`## Woche: ${w.verdict.label}. ${w.bullets.join(' ')}`);
  const ha = healthAge(model, model.days.length - 1);
  if (ha) L(`Puls-Alter ${fmtN(ha.pulsAge, 1)} (echtes Alter ${ha.age}): ${ha.items.map((x) => `${x.label} ${x.value} ${signed(x.years, 1)} Jahre`).join(', ')}.`);
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
      stress: d.stats?.stress ?? null,
      activities: d.acts.map((a) => `${a.name || a.type} ${Math.round(a.dur / 60)}min`),
      behaviorsThisDay: j?._done ? JOURNAL_QUESTIONS.filter((q) => j[q.id]).map((q) => q.label) : null,
    });
  }
  return out;
}
