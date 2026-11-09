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
  green: 'Dein Körper ist gut erholt – heute darfst du Gas geben.',
  yellow: 'Solide Basis – trainiere moderat und hör auf deinen Körper.',
  red: 'Dein Körper braucht Erholung – heute nur locker bewegen.',
};

export function buildCoach(model, i) {
  const d = model.days[i];
  const S = model.settings;
  const zones = hrZones(d.rhrRef, S.maxHr);
  const range = (z) => `${zones[z - 1].lo}–${zones[z - 1].hi} bpm`;
  if (d.recovery == null) {
    return {
      state: 'nodata',
      headline: 'Für diesen Tag gibt es noch keine Schlafdaten.',
      text: 'Öffne kurz die Garmin-Connect-App, damit deine Uhr synchronisiert. Der nächste Abgleich holt die Daten automatisch.',
    };
  }
  const zone = d.alarm ? 'red' : d.zone;
  const plan = PLANS[zone][S.sport]
    .replace('{z1top}', `${zones[0].hi} bpm`)
    .replace('{z2}', range(2))
    .replace('{z4}', range(4));

  const notes = [];
  if (d.target.notes.includes('alarm')) {
    notes.push('Mehrere Körperwerte sind auffällig (siehe unten). Schone dich heute, auch wenn du dich fit fühlst.');
  }
  if (d.target.notes.includes('spike')) {
    notes.push('Deine Belastung der letzten 7 Tage liegt über 50 % über deinem 4-Wochen-Schnitt – Ziel deshalb niedriger.');
  } else if (d.target.notes.includes('high')) {
    notes.push('Deine Belastung steigt gerade schnell – Ziel um 1 Punkt gesenkt.');
  } else if (d.target.notes.includes('low')) {
    notes.push('Du hast zuletzt weniger trainiert als üblich – heute ist Spielraum für mehr.');
  }

  let remaining = null;
  const current = d.strain ?? 0;
  if (current < d.target.low) {
    const delta = trimpFromStrain(d.target.low) - trimpFromStrain(current);
    remaining = {
      z2: minutesFor(delta, 0.65, S.sex),
      z4: minutesFor(delta, 0.85, S.sex),
      text: `Bis zum Zielbereich fehlen dir noch etwa ${minutesFor(delta, 0.65, S.sex)} Min. in Zone 2 (${range(2)}) oder ${minutesFor(delta, 0.85, S.sex)} Min. in Zone 4 (${range(4)}).`,
    };
  } else if (current > d.target.high) {
    remaining = { done: true, text: 'Du liegst über deinem Zielbereich. Ab jetzt Erholung: Essen, Trinken, früh schlafen.' };
  } else {
    remaining = { done: true, text: 'Du bist im Zielbereich – Training für heute erledigt.' };
  }

  return { state: zone, headline: d.alarm ? 'Dein Körper zeigt Warnsignale – heute Pause.' : HEADLINES[zone], plan, notes, remaining, zones };
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
      add(
        x.diff < 0 ? 'warn' : 'good',
        `${x.label} gestern`,
        `Bei dir ${x.diff < 0 ? 'kostet' : 'bringt'} das im Schnitt ${Math.abs(Math.round(x.diff))} Prozentpunkte Recovery (${Math.round(x.yes)} % statt ${Math.round(x.no)} %, aus ${x.ny} vs. ${x.nn} Tagen).`,
        x.diff < 0 ? 2 : 6,
      );
    }
  }

  if (d.alarm) {
    const parts = [];
    if (d.flags.rhrUp) parts.push(`Ruhepuls ${signed(d.rhr - d.base.rhr.mean)} bpm`);
    if (d.flags.hrvDown) parts.push(`HRV ${signed(100 * (d.hrv / Math.exp(d.base.hrv.mean) - 1))} %`);
    if (d.flags.respUp) parts.push(`Atemfrequenz ${signed(d.respDelta, 1)}/Min.`);
    if (d.flags.tempUp) parts.push(`Hauttemperatur ${signed(d.skinTemp, 1)} °C`);
    add(
      'bad',
      'Möglicher Infekt oder starke Überlastung',
      `${parts.join(', ')} gegenüber deinem Normalwert. Dieses Muster tritt oft 1–2 Tage vor einer Erkältung auf, aber auch nach Alkohol oder sehr wenig Schlaf. Heute kein intensives Training, viel trinken, früh ins Bett.`,
      0,
    );
  } else if (d.flags.rhrUp) {
    add('warn', 'Ruhepuls erhöht', `Dein Ruhepuls liegt mit ${d.rhr} bpm ${signed(d.rhr - d.base.rhr.mean)} über deinem Schnitt. Häufige Ursachen: spätes Essen, Alkohol, Stress, Hitze oder ein beginnender Infekt.`, 2);
  }
  if (d.flags.respUp && !d.alarm) {
    add('warn', 'Atemfrequenz erhöht', `Nachts ${de(d.resp)} Atemzüge/Min., ${signed(d.respDelta, 1)} über deinem Schnitt. Bleibt das 2 Nächte so, ist oft ein Infekt im Anmarsch.`, 2);
  }

  // HRV-Trend
  if (d.hrvTrend === 'low') {
    let streak = 0;
    for (let k = i; k >= 0 && days[k].hrvTrend === 'low'; k--) streak++;
    add(
      streak >= 3 ? 'bad' : 'warn',
      'HRV-Trend unter deinem Normalbereich',
      `Dein 7-Tage-Schnitt liegt bei ${Math.round(d.hrv7)} ms, dein Normalbereich bei ${Math.round(d.hrvNormal[0])}–${Math.round(d.hrvNormal[1])} ms${streak > 1 ? ` (seit ${streak} Tagen)` : ''}. Das deutet auf angesammelte Ermüdung hin. Plane 1–2 lockere Tage und viel Schlaf ein.`,
      1,
    );
  } else if (d.hrvTrend === 'high') {
    add('good', 'HRV-Trend über deinem Normalbereich', `7-Tage-Schnitt ${Math.round(d.hrv7)} ms (normal: ${Math.round(d.hrvNormal[0])}–${Math.round(d.hrvNormal[1])} ms). Dein Körper verkraftet die aktuelle Belastung sehr gut.`, 6);
  }

  // Trainingslast
  if (d.load) {
    const r = d.load.ratio;
    if (r > 1.5) add('bad', 'Belastungsspitze', `Deine Trainingslast der letzten 7 Tage liegt ${Math.round((r - 1) * 100)} % über deinem 4-Wochen-Schnitt. Ab etwa +50 % steigt das Verletzungs- und Infektrisiko deutlich.`, 1);
    else if (r > 1.3) add('warn', 'Belastung steigt schnell', `7-Tage-Last ${Math.round((r - 1) * 100)} % über deinem 4-Wochen-Schnitt. Steigere nicht weiter, bis sich deine HRV stabilisiert.`, 3);
    else if (r >= 0.8) add('good', 'Trainingslast im optimalen Bereich', `Verhältnis 7 zu 28 Tage: ${de(r, 2)} – ideal sind 0,8 bis 1,3.`, 8);
    else add('info', 'Weniger Belastung als üblich', `Verhältnis 7 zu 28 Tage: ${de(r, 2)}. Bleibt das länger so, sinkt deine Fitness langsam. Bei guter Recovery darfst du wieder steigern.`, 7);
  }

  // Schlaf
  if (d.sleep) {
    if (d.perf < 85) {
      add('warn', 'Zu wenig Schlaf', `Du hast ${fmtDurLong(d.sleepMin)} geschlafen, gebraucht hättest du ${fmtDurLong(d.need.total)} (${pct(d.perf)}). Das kostet dich heute Recovery-Punkte.`, 3);
    }
    const beds = days.slice(Math.max(0, i - 28), i).map((x) => x.sleep?.bed).filter(isNum);
    if (beds.length >= 7 && isNum(d.sleep.bed)) {
      const late = d.sleep.bed - median(beds);
      if (late >= 45) add('info', 'Später eingeschlafen als sonst', `Du bist um ${fmtClock(d.sleep.bed)} eingeschlafen – ${fmtDurLong(late)} später als üblich (${fmtClock(median(beds))}).`, 6);
    }
    if (d.stages.deep != null && d.stages.deep < 12) {
      add('info', 'Wenig Tiefschlaf', `Nur ${pct(d.stages.deep)} Tiefschlaf (normal 13–23 %). Hilft oft: kein Alkohol, kein schweres Essen und kein hartes Training in den 3 Stunden vor dem Schlafen, kühles Schlafzimmer.`, 6);
    }
    if (d.stages.rem != null && d.stages.rem < 15) {
      add('info', 'Wenig REM-Schlaf', `Nur ${pct(d.stages.rem)} REM-Schlaf (normal 20–25 %). REM kommt vor allem am Morgen – zu frühes Aufstehen und Alkohol kürzen ihn.`, 7);
    }
  }
  if (d.debt7 != null) {
    if (d.debt7 >= 180) add('warn', 'Schlafschuld', `In den letzten 7 Nächten fehlen dir ${fmtDurLong(d.debt7)} Schlaf. Hol sie in den nächsten Nächten mit 30–60 Min. früher ins Bett nach.`, 3);
    else if (d.debt7 < 30) add('good', 'Kaum Schlafschuld', 'Du hast in der letzten Woche fast genau so viel geschlafen, wie du gebraucht hast.', 8);
  }
  if (d.consistency != null) {
    if (d.consistency < 60) add('warn', 'Unregelmäßige Schlafzeiten', `Deine Einschlafzeit schwankt um ±${Math.round(d.sdBed)} Min., die Aufwachzeit um ±${Math.round(d.sdWake)} Min. Ein fester Rhythmus (auch am Wochenende ±30 Min.) verbessert HRV und Tiefschlaf messbar.`, 4);
    else if (d.consistency >= 80) add('good', 'Sehr regelmäßiger Schlafrhythmus', `Schlafkonstanz ${pct(d.consistency)} – das ist einer der stärksten Hebel für gute Recovery.`, 8);
  }

  // Spätes Training am Vortag
  const y = days[i - 1];
  if (y && d.sleep && isNum(d.sleep.bed)) {
    const late = y.acts.filter((a) => {
      const start = parseClock(a.start);
      return start != null && start + a.dur / 60 - 1440 > d.sleep.bed - 180;
    });
    if (late.length && d.comps.find((c) => c.key === 'hrv')?.z < -0.5) {
      add('info', 'Spätes Training', `Deine Einheit gestern um ${late[0].start} lag weniger als 3 Stunden vor dem Einschlafen. Deine HRV ist heute niedriger – intensives Training lieber früher legen.`, 5);
    }
  }

  // Stress am Vortag
  if (y?.stats?.stress >= 45) {
    add('info', 'Stressiger Tag gestern', `Durchschnittlicher Stresswert ${y.stats.stress} (hoch ab 50). Plane heute 10 Min. Atemübung oder einen Spaziergang ohne Handy ein.`, 6);
  }

  // Grüne Serie
  let greens = 0;
  for (let k = i; k >= 0 && days[k].zone === 'green'; k--) greens++;
  if (greens >= 3) add('good', `${greens} grüne Tage in Folge`, 'Deine Erholung passt zu deiner Belastung. Gute Phase, um Trainingsreize zu setzen.', 7);

  if (d.base.calibrating) {
    add('info', 'Puls lernt dich noch kennen', `Für genaue Werte braucht es 14 Nächte mit HRV-Messung, aktuell sind es ${d.base.hrvDays}. Bis dahin werden zum Teil Garmins Normalwerte genutzt.`, 9);
  }

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
