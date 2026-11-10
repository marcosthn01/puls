// Erzeugt realistische Beispieldaten im selben Format wie der Garmin-Sync.
// Enthält typische Muster: Gym (Push/Pull) und Rad, spätere Wochenenden, eine Erkältung,
// damit alle Auswertungen der App sichtbar werden.

import { HR_BIN_START, HR_BIN_WIDTH, addDays } from './engine.js';

const BINS = 39;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAN = {
  // Wochentag (0 = So): Training – Gym im Push/Pull-Wechsel und Rad
  0: { type: 'cycling', name: 'Lange Radtour', start: 10 * 60, dur: 95, hrr: 0.62 },
  1: { type: 'strength_training', name: 'Push', start: 18 * 60 + 30, dur: 65, hrr: 0.42 },
  2: { type: 'cycling', name: 'Rad', start: 18 * 60, dur: 50, hrr: 0.6 },
  3: { type: 'strength_training', name: 'Pull', start: 18 * 60 + 30, dur: 65, hrr: 0.42 },
  4: null,
  5: { type: 'strength_training', name: 'Push', start: 17 * 60, dur: 65, hrr: 0.42 },
  6: { type: 'cycling', name: 'Radtour', start: 9 * 60 + 30, dur: 75, hrr: 0.64 },
};

function localDate(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function makeDemoStore({ now = new Date(), days = 90, seed = 11 } = {}) {
  const r = rng(seed);
  const gauss = () => {
    let u = 0;
    for (let k = 0; k < 6; k++) u += r();
    return (u - 3) / Math.sqrt(0.5);
  };
  const today = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rhrBase = 51;
  const hrMax = 189;
  const hrvBase = 58;
  let fatigue = 0;
  let prevB = {}; // Verhalten vom Vortag (Morgen-Check)
  const store = { v: 1, demo: true, tz: 'Europe/Berlin', generated: now.toISOString(), profile: { sex: 'male', birthYear: 1993 }, days: {}, journal: {}, status: { auth: 'ok', sync: 'ok' } };

  for (let n = days - 1; n >= 0; n--) {
    const date = addDays(today, -n);
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    const isToday = n === 0;
    const sick = n >= 34 && n <= 38 ? 1 - Math.abs(n - 36) / 3 : 0; // Erkältung vor ~5 Wochen
    const wkNight = wd === 6 || wd === 0; // Nacht Fr→Sa bzw. Sa→So
    const party = !!prevB.alkohol;
    const fx = (prevB.spaetessen ? -0.07 : 0) + (prevB.koffein ? -0.03 : 0) + (prevB.meditation ? 0.05 : 0) + (prevB.stress ? -0.04 : 0);

    // ---- Schlaf (Nacht, die heute endet)
    const bed = Math.round(-65 + (wkNight ? 65 : 0) + gauss() * 22 + (party ? 50 : 0) + (prevB.bildschirm ? 25 : 0));
    const wake = Math.round((wkNight ? 480 : 410) + gauss() * 14);
    const inBed = wake - bed;
    const eff = Math.min(0.97, 0.91 + gauss() * 0.025 - sick * 0.05);
    const dur = Math.round(inBed * eff);
    const deepPct = Math.max(0.07, 0.17 + gauss() * 0.03 - (party ? 0.05 : 0) - fatigue * 0.02 - (prevB.spaetessen || prevB.koffein ? 0.025 : 0));
    const remPct = Math.max(0.1, 0.22 + gauss() * 0.03 - (party ? 0.04 : 0));
    const hrv = Math.round(hrvBase * Math.exp(gauss() * 0.08 - fatigue * 0.12 - sick * 0.35 - (party ? 0.12 : 0) + fx + (dur - 450) / 1500));
    const rhr = Math.round(rhrBase + gauss() * 1.2 + fatigue * 2 + sick * 7 + (party ? 4 : 0));
    const resp = Math.round((14.2 + gauss() * 0.3 + sick * 1.6) * 10) / 10;
    const levels = [];
    if (n < 14) {
      let t = 0;
      while (t < inBed) {
        const cyc = [
          [1, 15 + r() * 15],
          [0, 15 + r() * 30 * (deepPct / 0.17)],
          [1, 15 + r() * 20],
          [2, 10 + r() * 25 * (t / inBed + 0.4)],
        ];
        if (r() < 0.35) cyc.push([3, 2 + r() * 6]);
        for (const [lvl, len] of cyc) {
          const e = Math.min(inBed, t + Math.round(len));
          if (e > t) levels.push([t, e, lvl]);
          t = e;
          if (t >= inBed) break;
        }
      }
    }
    const sleep = {
      dur: dur * 60,
      bed,
      wake,
      deep: Math.round(dur * deepPct * 60),
      rem: Math.round(dur * remPct * 60),
      light: Math.round(dur * (1 - deepPct - remPct) * 60),
      awake: (inBed - dur) * 60,
      score: Math.round(Math.max(35, Math.min(96, 78 + (dur - 450) / 4 + gauss() * 5 - sick * 15 - (party ? 10 : 0)))),
      awakeCount: Math.round(1 + r() * 3),
      stress: Math.round(14 + gauss() * 4 + sick * 12),
      resp,
      spo2: 95,
      rhr,
      hrv,
      bb: Math.round(55 + gauss() * 10 - sick * 25),
      need: 480,
      ...(n < 14 ? { levels } : {}),
    };

    // ---- Tag: Puls-Histogramm, Aktivität, Statistiken
    const minutes = new Array(1440).fill(null);
    const act0 = sick > 0.2 ? null : PLAN[wd];
    const act = act0 && !(isToday && act0.start + act0.dur > nowMin) ? act0 : null;
    const limit = isToday ? nowMin : 1440;
    for (let m = 0; m < limit; m++) {
      let hr;
      if (m < wake) hr = rhr + 2 + gauss() * 3;
      else if (m >= 1440 + bed - 30 && !isToday) hr = rhr + 4 + gauss() * 3;
      else hr = 72 + gauss() * 7 + sick * 6;
      if ((m > 7 * 60 + 40 && m < 8 * 60 + 5) || (m > 12 * 60 + 30 && m < 12 * 60 + 50) || (m > 17 * 60 + 20 && m < 17 * 60 + 45)) hr = 98 + gauss() * 6;
      if (act && m >= act.start && m < act.start + act.dur) {
        const prog = (m - act.start) / act.dur;
        const warm = Math.min(1, prog * 6);
        const interval = act.name === 'Intervalle' && Math.floor(prog * 10) % 2 === 1 ? 0.12 : 0;
        hr = rhr + (0.35 + (act.hrr - 0.35) * warm + interval) * (hrMax - rhr) + gauss() * 4;
      }
      minutes[m] = Math.round(hr);
    }
    const hist = new Array(BINS).fill(0);
    const series = [];
    for (let b = 0; b < 144; b++) {
      const chunk = minutes.slice(b * 10, b * 10 + 10).filter((v) => v != null);
      if (chunk.length) series.push([b * 10, Math.round(chunk.reduce((s, v) => s + v, 0) / chunk.length)]);
    }
    minutes.forEach((bpm) => {
      if (bpm == null) return;
      hist[Math.min(BINS - 1, Math.max(0, Math.floor((bpm - HR_BIN_START) / HR_BIN_WIDTH)))] += 1;
    });

    // Stress (0–100) und Body Battery im Tagesverlauf (nur letzte 14 Tage, wie beim echten Abruf)
    let stressDay;
    const stressMin = { rest: 0, low: 0, med: 0, high: 0 };
    {
      const stress = [];
      const bb = [];
      let level = Math.min(100, 30 + sleep.bb);
      for (let b = 0; b < (isToday ? Math.floor(nowMin / 10) : 144); b++) {
        const m = b * 10;
        const hrv = minutes[m] ?? rhr;
        const asleep = m < wake || (!isToday && m >= 1440 + bed);
        let st = asleep ? 8 + r() * 10 : Math.max(0, Math.min(100, (hrv - rhr) * 1.4 + gauss() * 8 + (wd >= 1 && wd <= 5 && m > 540 && m < 1020 ? 12 : 0)));
        if (act && m >= act.start && m < act.start + act.dur) st = null; // während Sport kein Stresswert
        if (st != null) {
          stress.push([m, Math.round(st)]);
          const k = st <= 25 ? 'rest' : st <= 50 ? 'low' : st <= 75 ? 'med' : 'high';
          stressMin[k] += 10;
        }
        level += asleep ? 0.9 : st == null ? -2.5 : -(0.15 + (st || 0) / 120);
        level = Math.max(5, Math.min(100, level));
        bb.push([m, Math.round(level)]);
      }
      if (n < 14) stressDay = { stress, bb };
    }

    const acts = [];
    if (act) {
      const avgHr = Math.round(rhr + act.hrr * (hrMax - rhr));
      acts.push({
        id: 1000 + n,
        name: act.name,
        type: act.type,
        start: `${String(Math.floor(act.start / 60)).padStart(2, '0')}:${String(act.start % 60).padStart(2, '0')}`,
        dur: act.dur * 60,
        dist: act.type === 'running' ? Math.round(act.dur * 175) : act.type === 'cycling' ? Math.round(act.dur * 420) : undefined,
        avgHr,
        maxHr: Math.round(avgHr + 12 + r() * 8),
        kcal: Math.round(act.dur * (act.hrr * 14)),
        load: Math.round(act.dur * act.hrr * act.hrr * 2.6),
        te: Math.round((1.5 + act.hrr * 3 + r() * 0.5) * 10) / 10,
      });
    }
    const intensity = act ? act.hrr : 0;
    fatigue = Math.max(0, fatigue * 0.6 + intensity * intensity * (act ? act.dur / 60 : 0) * 0.9 - 0.08);

    if (n > 0) {
      const b = {};
      if ((wd === 6 && r() < 0.6) || (wd === 5 && r() < 0.35) || r() < 0.04) b.alkohol = true;
      if (r() < 0.2) b.spaetessen = true;
      if (r() < 0.3) b.koffein = true;
      if (r() < 0.45) b.bildschirm = true;
      if (wd >= 1 && wd <= 5 && r() < 0.25) b.stress = true;
      if (r() < 0.2) b.meditation = true;
      if (sick > 0.2 && n <= 36) b.krank = true; // Symptome ab dem Höhepunkt – Körper-Signale kommen 1–2 Tage früher (wie in Studien)
      prevB = b;
      // gestern bleibt offen, damit der Morgen-Check in der Demo erscheint
      if (n > 1 && r() < 0.85) store.journal[date] = { _done: true, ...b };
    }

    const steps = Math.round((isToday ? nowMin / 1440 : 1) * (7200 + gauss() * 1800 + (act?.type === 'cycling' ? 0 : act ? 900 : 0) - sick * 3000));
    store.days[date] = {
      sleep,
      hrv: { avg: hrv, weekly: hrvBase, low: 49, high: 66, status: 'BALANCED' },
      stats: {
        steps,
        stepGoal: 8000,
        kcal: Math.round(2100 + steps * 0.04 + (act ? act.dur * 9 : 0)),
        stress: Math.round(Math.max(10, 28 + gauss() * 8 + sick * 10 + (wd >= 1 && wd <= 5 ? 6 : -4))),
        bbHigh: Math.min(100, Math.round(70 + gauss() * 10 - sick * 30 + (sleep.bb - 55) / 2)),
        bbLow: Math.max(5, Math.round(22 + gauss() * 8 - (act ? 8 : 0))),
        bbNow: isToday ? Math.round(80 - nowMin / 25) : undefined,
        stressRest: stressMin.rest * 60,
        stressLow: stressMin.low * 60,
        stressMed: stressMin.med * 60,
        stressHigh: stressMin.high * 60,
        rhr,
        imMod: act ? Math.round(act.dur * 0.6) : Math.round(10 + r() * 15),
        imVig: act && act.hrr > 0.7 ? Math.round(act.dur * 0.5) : 0,
      },
      hr: { hist: hist.map((v) => Math.round(v * 10) / 10), rhr, ...(n < 14 ? { series } : {}) },
      ...(acts.length ? { acts } : {}),
      ...(stressDay ? { stressDay } : {}),
    };
    // Walking-Pad im Homeoffice: dienstags und donnerstags 14:00–14:45 (Uhr zählt am Schreibtisch kaum mit)
    if ((wd === 2 || wd === 4) && sick < 0.3 && (!isToday || nowMin > 15 * 60)) {
      const total = 3600 + (n % 5) * 220;
      const counted = 400 + (n % 3) * 150;
      store.days[date].pad = { samples: [[50400, 53100, total]], total, add: total - counted, units: [[840, 885, total]], min: 45 };
    }
  }
  return store;
}
