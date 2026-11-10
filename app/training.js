// Trainings-Coach: lernt aus deinen Garmin-Aktivitäten, was du trainierst (Gym im Push/Pull-Wechsel,
// Rad), und empfiehlt für heute das Passende – mit Dauer (Rad) bzw. Volumen und Intensität (Gym).
//
// Grundlagen (vereinfacht, für Freizeitsportler):
// - HRV-gesteuertes Training: hart nur, wenn HRV und Recovery es zulassen; bei niedriger HRV locker
//   (Kiviniemi 2007, Vesterinen 2016, Javaloyes 2019).
// - Autoregulation im Krafttraining über Wiederholungen in Reserve (RIR): an schlechten Tagen weniger
//   Sätze und nicht bis zum Versagen (Helms 2016, Zourdos 2016).
// - Zu wenig Schlaf senkt Kraft und Ausdauer und erhöht das Verletzungsrisiko (Fullagar 2015).
// - Akut-zu-chronische Last über 1,5 = erhöhtes Risiko für Überlastung (Gabbett 2016).
// - Infekt-Zeichen: kein intensives Training; „Neck-Check“ – Symptome unterhalb des Halses = Pause.
// - Dieselbe Muskelgruppe braucht rund 48 Stunden (Schoenfeld 2016).

import { activityKind, activityTitle, sportLabel } from './sport.js';
import { clamp, hrZones, illnessRisk, isNum, median, strainFromTrimp, trimpFromStrain, trimpWeight } from './engine.js';

export const KINDS = { gym: 'Gym', bike: 'Rad', run: 'Laufen', other: 'Sonstiges' };
export const SPLITS = { push: 'Push', pull: 'Pull', legs: 'Beine', upper: 'Oberkörper', lower: 'Unterkörper', full: 'Ganzkörper' };

// Art einer Aktivität: Garmins Sportart hat Vorrang (siehe sport.js)
export { activityKind };

/** Split einer Gym-Einheit: selbst markiert (labels[id]) oder aus dem Namen („Push“, „Pull“ …). */
export function splitOf(a, labels = {}) {
  if (a?.id != null && labels[a.id]) return labels[a.id];
  const n = String(a?.name || '').toLowerCase();
  if (/push|drück|brust|chest|schulter/.test(n)) return 'push';
  if (/pull|zieh|rücken|back|bizeps/.test(n)) return 'pull';
  if (/bein|leg|lower|unterkörper/.test(n)) return 'legs';
  if (/oberkörper|upper/.test(n)) return 'upper';
  if (/ganzkörper|full/.test(n)) return 'full';
  return null;
}

/**
 * Push/Pull usw. für alle Gym-Einheiten: aus deiner Markierung oder dem Namen – dazwischen im Wechsel
 * ergänzt (Push → Pull → Push …), vorwärts und rückwärts ab der nächsten bekannten Einheit.
 * Ergebnis: { map: { id: split }, inferred: Set(ids) }. Ohne eine bekannte Einheit bleibt alles offen.
 */
const effCache = new WeakMap();
export function effectiveLabels(model, labels = {}) {
  const key = JSON.stringify(labels || {});
  const hit = effCache.get(model);
  if (hit && hit.key === key) return hit.value;
  const seq = [];
  for (const d of model.days || []) for (const a of d.acts || []) if (activityKind(a) === 'gym' && (a.dur || 0) >= 600 && a.id != null) seq.push(a);
  const split = seq.map((a) => splitOf(a, labels));
  const kinds = new Set(split.filter(Boolean));
  const order = kinds.has('legs') ? ['push', 'pull', 'legs'] : kinds.has('upper') || kinds.has('lower') ? ['upper', 'lower'] : ['push', 'pull'];
  const inferred = new Set();
  const step = (sp, dir) => (order.includes(sp) ? order[(order.indexOf(sp) + dir + order.length) % order.length] : null);
  for (let k = 1; k < seq.length; k++) {
    if (!split[k] && split[k - 1]) {
      split[k] = step(split[k - 1], 1);
      if (split[k]) inferred.add(seq[k].id);
    }
  }
  for (let k = seq.length - 2; k >= 0; k--) {
    if (!split[k] && split[k + 1]) {
      split[k] = step(split[k + 1], -1);
      if (split[k]) inferred.add(seq[k].id);
    }
  }
  const map = { ...labels };
  seq.forEach((a, k) => {
    if (split[k]) map[a.id] = split[k];
  });
  const value = { map, inferred };
  effCache.set(model, { key, value });
  return value;
}

const quant = (arr, q) => {
  const a = arr.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (pos - lo);
};
const round15 = (m) => Math.max(30, Math.round(m / 15) * 15);

/** Was und wie du trainierst – aus den letzten 6 Wochen (ohne heute). */
export function trainingProfile(model, i = model.days.length - 1, { labels = {}, weeks = 6 } = {}) {
  const S = model.settings;
  const eff = effectiveLabels(model, labels);
  const raw = labels;
  labels = eff.map;
  const sessions = [];
  for (let k = Math.max(0, i - weeks * 7); k <= i; k++) {
    const d = model.days[k];
    for (const a of d.acts || []) {
      const kind = activityKind(a);
      const min = (a.dur || 0) / 60;
      if (min < 10) continue;
      sessions.push({
        date: d.date,
        idx: k,
        today: k === i,
        kind,
        split: kind === 'gym' ? splitOf(a, labels) : null,
        id: a.id ?? null,
        name: activityTitle(a),
        sport: sportLabel(a),
        min,
        avgHr: a.avgHr ?? null,
        trimp: a.trimp ?? null,
        strain: a.strain ?? null,
      });
    }
  }
  const past = sessions.filter((x) => !x.today);
  const per = (kind) => {
    const list = past.filter((x) => x.kind === kind);
    if (!list.length) return null;
    const days = [...new Set(list.map((x) => x.idx))].sort((a, b) => a - b);
    const gaps = days.slice(1).map((v, j) => v - days[j]);
    const last = list[list.length - 1];
    const hrs = list.map((x) => x.avgHr);
    const perMin = list.filter((x) => isNum(x.trimp) && x.min > 0).map((x) => x.trimp / x.min);
    return {
      kind,
      count: list.length,
      perWeek: Math.round((list.length / weeks) * 10) / 10,
      typicalMin: median(list.map((x) => x.min)),
      gap: gaps.length ? median(gaps) : 7,
      last,
      daysSince: i - last.idx,
      hr: { easy: quant(hrs, 0.25), normal: quant(hrs, 0.5), hard: quant(hrs, 0.8) },
      trimpPerMin: perMin.length ? median(perMin) : null,
    };
  };
  const gym = per('gym');
  const bike = per('bike');
  if (gym) {
    const splits = past.filter((x) => x.kind === 'gym').map((x) => x.split);
    gym.splits = [...new Set(splits.filter(Boolean))];
    gym.lastSplit = gym.last.split;
    // Zum Antippen: letzte Einheit ohne eigene Angabe (unbekannt oder nur im Wechsel ergänzt)
    gym.unlabeled = !splitOf(gym.last, raw) || eff.inferred.has(gym.last.id) ? gym.last : null;
    gym.guess = gym.unlabeled ? gym.last.split : null;
  }
  // Trainingstage in Folge bis gestern
  let streak = 0;
  for (let k = i - 1; k >= 0 && model.days[k].acts?.some((a) => (a.dur || 0) >= 600); k--) streak++;
  const today = sessions.filter((x) => x.today);
  const main = gym && bike ? (gym.count >= bike.count ? 'gym' : 'bike') : gym ? 'gym' : bike ? 'bike' : null;
  return { gym, bike, run: per('run'), main, streak, today, sessions: past.length, zones: hrZones(model.days[i].rhrRef, S.maxHr) };
}

/** Nächster Split im Wechsel (Push → Pull → Push … oder mit Beinen: Push → Pull → Beine). */
export function nextSplit(gym) {
  if (!gym) return null;
  const order = gym.splits?.includes('legs') ? ['push', 'pull', 'legs'] : gym.splits?.includes('upper') ? ['upper', 'lower'] : ['push', 'pull'];
  const last = gym.lastSplit;
  if (!last || !order.includes(last)) return null;
  return order[(order.indexOf(last) + 1) % order.length];
}

const LEVELS = ['locker', 'moderat', 'normal', 'hart'];
const wd = (iso) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(iso + 'T12:00:00Z').getUTCDay()];
const when = (days, iso) => (days === 1 ? 'gestern' : days === 2 ? 'vorgestern' : `${wd(iso)}, vor ${days} Tagen`);

/**
 * Trainingsempfehlung für heute.
 * Ergebnis: { kind: 'gym'|'bike'|'rest'|'done'|'none', title, sub, level, bullets, alt, … }
 */
export function trainingPlan(model, i = model.days.length - 1, { labels = {}, feel = null, journal = {} } = {}) {
  const d = model.days[i];
  const prof = trainingProfile(model, i, { labels });
  const ill = illnessRisk(model, i, { feel, journal });
  const base = { profile: prof, ill, date: d.date };
  if (d.recovery == null) {
    return { ...base, kind: 'none', title: 'Warte auf deine Nacht', sub: 'Sobald Schlaf und HRV da sind, steht hier dein Training.', bullets: [], level: null };
  }
  const bullets = [];
  const R = d.recovery;
  const hrvComp = d.comps?.find((c) => c.key === 'hrv');
  const hrvPct = hrvComp ? Math.round(100 * (hrvComp.value / hrvComp.ref - 1)) : null;
  const sleepShort = (isNum(d.sleepMin) && d.sleepMin < 6 * 60) || (isNum(d.perf) && d.perf < 70);
  const ratio = d.load?.ratio ?? null;

  const why = `Recovery ${R} %${hrvPct != null ? `, HRV ${hrvPct >= 0 ? '+' : '−'}${Math.abs(hrvPct)} % gegenüber normal` : ''}${isNum(d.sleepMin) ? `, ${Math.floor(d.sleepMin / 60)}:${String(Math.round(d.sleepMin % 60)).padStart(2, '0')} Std. Schlaf` : ''}.`;

  // 1) Krank oder deutliche Infekt-Zeichen: Pause
  if (ill.level >= 3 || feel === 'sick') {
    return {
      ...base,
      kind: 'rest',
      level: 'pause',
      title: 'Heute Pause',
      sub: feel === 'sick' ? 'Du fühlst dich angeschlagen – dein Körper braucht die Energie jetzt fürs Immunsystem.' : 'Deutliche Infekt-Zeichen in der Nacht.',
      bullets: [...ill.signals.filter((x) => x.key !== 'feel').slice(0, 3).map((x) => x.text), 'Training mit beginnendem Infekt verlängert ihn oft – und kann im Extremfall das Herz belasten (Myokarditis-Risiko).'],
      alt: 'Wenn du dich gut fühlst: 20–30 Min. Spazierengehen an der frischen Luft.',
    };
  }

  // 2) Heute schon trainiert?
  // (ab 30 Trainingsminuten gilt der Tag als erledigt – auch wenn der Strain knapp unter dem Ziel bleibt)
  const doneToday = prof.today.filter((x) => x.kind === 'gym' || x.kind === 'bike' || x.kind === 'run');
  const doneMin = doneToday.reduce((t, x) => t + x.min, 0);
  if (doneToday.length && d.target && ((d.strain ?? 0) >= d.target.low || doneMin >= 30)) {
    const f1 = (v) => v.toFixed(1).replace('.', ',');
    const inTarget = (d.strain ?? 0) >= d.target.low;
    return {
      ...base,
      kind: 'done',
      level: null,
      title: `Erledigt: ${doneToday.map((y) => (y.kind === 'gym' ? `Gym${y.split ? ` · ${SPLITS[y.split]}` : ''}` : `${y.sport} · ${Math.round(y.min)} Min.`)).join(' + ')}`,
      sub: inTarget
        ? `Strain ${f1(d.strain ?? 0)} – im Ziel ${f1(d.target.low)}–${f1(d.target.high)}. Jetzt zählt die Erholung.`
        : `Strain ${f1(d.strain ?? 0)} – knapp unter dem Ziel ${f1(d.target.low)}–${f1(d.target.high)}. Ein lockerer Spaziergang reicht, kein zweites Training nötig.`,
      bullets: ['Eiweiß in den nächsten 2 Stunden (ca. 30–40 g).', 'Heute Abend rechtzeitig ins Bett – siehe Schlafenszeit.'],
    };
  }

  // 3) Intensitätsstufe aus Recovery, HRV, Schlaf, Last und Infekt-Zeichen
  let lv = R < 34 ? 0 : R < 50 ? 1 : R < 80 ? 2 : 3;
  const reasons = [];
  if (R >= 80 && hrvComp && hrvComp.z < 0) lv = Math.min(lv, 2);
  if (d.hrvTrend === 'low' && lv > 1) {
    lv--;
    reasons.push('Dein HRV-Wochenschnitt liegt unter normal – heute nicht ans Limit.');
  }
  if (sleepShort && lv > 0) {
    lv--;
    reasons.push('Kurze Nacht – Kraft und Koordination sind heute schwächer, Verletzungsrisiko höher.');
  }
  if (ratio != null && ratio > 1.5 && lv > 0) {
    lv--;
    reasons.push(`Deine Last ist zuletzt stark gestiegen (${ratio.toFixed(1).replace('.', ',')}× deines Schnitts) – heute zurücknehmen.`);
  } else if (ratio != null && ratio > 1.3 && lv > 2) {
    lv = 2;
    reasons.push('Deine Last steigt schnell – heute solide, aber nicht hart.');
  }
  if (ill.level === 2 && lv > 0) {
    lv = 0;
    reasons.push('Infekt-Frühzeichen – nur locker, kein Gym-Volumen.');
  } else if (ill.level === 1) {
    if (lv > 1) lv = 1;
    const sig = ill.signals.filter((x) => ['rhr', 'hrv', 'resp', 'temp'].includes(x.key)).map((x) => x.label).join(' und ');
    reasons.push(`Leichte Infekt-Zeichen${sig ? ` (${sig})` : ''} – heute nicht ans Limit, morgen schaut Puls wieder nach.`);
  }
  if (prof.streak >= 3 && lv <= 1) reasons.push(`${prof.streak} Trainingstage in Folge – ein Ruhetag wäre auch völlig okay.`);

  // 4) Gym oder Rad?
  const { gym, bike } = prof;
  const yesterdayGym = gym && gym.daysSince === 1;
  const due = (x) => (x ? x.daysSince / Math.max(1, x.gap) : -1);
  let kind;
  if (!gym && !bike) kind = 'free';
  else if (!gym) kind = 'bike';
  else if (!bike) kind = 'gym';
  else if (lv === 0) kind = 'bike'; // an schlechten Tagen lieber locker radeln als Gewichte
  else if (yesterdayGym && !nextSplit(gym)) kind = 'bike';
  else kind = due(gym) >= due(bike) ? 'gym' : 'bike';
  if (kind === 'gym' && yesterdayGym && lv < 2 && bike) kind = 'bike';

  let split = kind === 'gym' ? nextSplit(gym) : null;
  const level = LEVELS[lv];
  const S = model.settings;
  const zones = prof.zones;
  // Strain eines Tages ohne Training (Alltag) – Grundlage für die Prognose am Morgen
  const restDays = [];
  for (let k = Math.max(0, i - 28); k < i; k++) {
    const x = model.days[k];
    if (!x.acts?.length && isNum(x.strain)) restDays.push(x.strain);
  }
  const dayBase = Math.max(d.strain ?? 0, restDays.length >= 3 ? median(restDays) : 6);

  // Rad: Dauer und Puls aus deinen eigenen Fahrten
  const bikePlan = () => {
    const typical = round15(bike?.typicalMin || 60);
    let min = lv === 0 ? 30 : lv === 1 ? Math.max(30, Math.min(45, typical - 15)) : lv === 2 ? typical : Math.min(120, typical + 15);
    const z2mid = (zones[1].lo + zones[1].hi) / 2;
    const normal = bike?.hr.normal ?? zones[2].lo;
    const hrTarget =
      lv === 0 ? zones[0].hi : lv === 1 ? Math.min(bike?.hr.easy ?? z2mid, z2mid) : lv === 2 ? normal : Math.max(bike?.hr.hard ?? zones[2].hi, normal + 3);
    const hrr = clamp((hrTarget - d.rhrRef) / (S.maxHr - d.rhrRef), 0.3, 0.9);
    const perMin = bike?.trimpPerMin && lv === 2 ? bike.trimpPerMin : trimpWeight(hrr, S.sex);
    const strainAfter = (m) => strainFromTrimp(trimpFromStrain(dayBase) + perMin * m);
    // Ans Tagesziel anpassen (in 15-Minuten-Schritten, innerhalb der Stufe)
    if (d.target && lv >= 1) {
      const lo = lv === 1 ? 30 : lv === 2 ? Math.max(30, typical - 15) : typical;
      const hi = lv === 1 ? 60 : lv === 2 ? typical + 15 : Math.min(120, typical + 30);
      while (min > lo && strainAfter(min) > d.target.high + 0.5) min -= 15;
      while (min < hi && strainAfter(min) < d.target.low) min += 15;
    }
    const feelWord = lv === 0 ? 'Ganz locker' : lv === 1 ? 'Locker' : lv === 2 ? 'Normal' : 'Zügig';
    const hrText = lv === 0 ? `Puls unter ${Math.round(hrTarget)} bpm` : `Puls im Schnitt um ${Math.round(hrTarget)} bpm`;
    return { min, hrTarget: Math.round(hrTarget), strainAfter: strainAfter(min), title: `Rad · ${min} Min.`, sub: `${feelWord} – ${hrText}${lv === 3 ? ', längere Anstiege gern kräftig' : ''}` };
  };

  // Gym: Volumen und Intensität (Push/Pull sind bei dir gleich lang – deshalb über Sätze und RIR)
  const gymPlan = () => {
    const sp = split || nextSplit(gym);
    const name = sp ? SPLITS[sp] : 'Push oder Pull';
    const dose = [
      { vol: '−40 % Volumen', how: 'Nur die Grundübungen, 2 Sätze statt 3–4, Gewicht −10 %, weit weg vom Versagen (3–4 Wdh. in Reserve).' },
      { vol: '−20 % Volumen', how: 'Je Übung einen Satz weniger, Gewichte halten, nicht bis zum Versagen (2–3 Wdh. in Reserve), Pausen nicht verkürzen.' },
      { vol: 'Volles Volumen', how: 'Normales Programm, letzte Sätze 1–2 Wdh. vor dem Versagen.' },
      { vol: 'Volles Volumen + 1 Satz', how: 'Ein Zusatzsatz bei den Grundübungen, letzte Sätze bis kurz vors Versagen; Zubehör gern als Supersätze. Guter Tag für ein neues Bestgewicht.' },
    ][lv];
    return { title: `Gym · ${name}`, sub: `${dose.vol} – ${dose.how}`, split: sp, splitName: name, volume: dose.vol };
  };

  let plan;
  if (kind === 'free') {
    plan = { title: lv >= 2 ? 'Trainingstag' : 'Lockerer Tag', sub: d.target ? `Ziel-Strain ${d.target.low.toFixed(1).replace('.', ',')}–${d.target.high.toFixed(1).replace('.', ',')}.` : '' };
  } else plan = kind === 'bike' ? bikePlan() : gymPlan();

  bullets.push(why);
  if (kind === 'gym' && gym) {
    bullets.push(`Letztes Gym ${when(gym.daysSince, gym.last.date)}${gym.lastSplit ? ` (${SPLITS[gym.lastSplit]})` : ''}${split ? ` – heute ist ${SPLITS[split]} dran.` : '.'}`);
  } else if (kind === 'bike' && bike) {
    const parts = [`Letzte Fahrt ${when(bike.daysSince, bike.last.date)}`];
    if (yesterdayGym) parts.push(`gestern Gym${gym.lastSplit ? ` (${SPLITS[gym.lastSplit]})` : ''} – die Muskeln brauchen rund 48 Stunden`);
    bullets.push(`${parts.join('; ')}.`);
    if (plan.strainAfter && d.target) bullets.push(`${plan.min} Min. bringen dich auf etwa Strain ${plan.strainAfter.toFixed(1).replace('.', ',')} (Ziel ${d.target.low.toFixed(1).replace('.', ',')}–${d.target.high.toFixed(1).replace('.', ',')}).`);
  }
  bullets.push(...reasons);

  // Alternative
  let alt = null;
  if (kind === 'gym' && bike) {
    const b = bikePlan();
    alt = `Lieber aufs Rad? ${b.min} Min. ${b.sub.split(' – ')[0].toLowerCase()} (${b.sub.split(' – ')[1]}).`;
  } else if (kind === 'bike' && gym) {
    if (lv === 0) alt = 'Gym heute besser auslassen – oder nur leichte Technik und Mobilität.';
    else if (!yesterdayGym || nextSplit(gym)) {
      const g = gymPlan();
      alt = `Lieber Gym? ${g.splitName} – ${g.volume}.`;
    }
  }
  return { ...base, kind: kind === 'free' ? 'free' : kind, level, title: plan.title, sub: plan.sub, bullets: bullets.filter(Boolean).slice(0, 4), alt, min: plan.min ?? null, hrTarget: plan.hrTarget ?? null, split, volume: plan.volume ?? null, strainAfter: plan.strainAfter ?? null };
}

/** Kurztext für Benachrichtigung und Coach. */
export function planLine(p) {
  if (!p) return '';
  return p.kind === 'rest' ? 'Heute Pause' : p.kind === 'none' ? '' : `${p.title}${p.sub ? ` – ${p.sub.split(' – ')[0]}` : ''}`;
}

/** Wochenbild deiner Trainings für den Coach. */
export function profileLine(prof) {
  const parts = [];
  const f = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (prof.gym) parts.push(`Gym ${f(prof.gym.perWeek)}×/Woche${prof.gym.splits?.length ? ` (Split ${prof.gym.splits.map((s) => SPLITS[s]).join('/')})` : ''}, typisch ${Math.round(prof.gym.typicalMin)} Min., Ø-Puls ${Math.round(prof.gym.hr.normal || 0)}; zuletzt ${prof.gym.last.date}${prof.gym.lastSplit ? ` (${SPLITS[prof.gym.lastSplit]})` : ''}`);
  if (prof.bike) parts.push(`Rad ${f(prof.bike.perWeek)}×/Woche, typisch ${Math.round(prof.bike.typicalMin)} Min., Ø-Puls locker ${Math.round(prof.bike.hr.easy || 0)} / normal ${Math.round(prof.bike.hr.normal || 0)} / zügig ${Math.round(prof.bike.hr.hard || 0)}; zuletzt ${prof.bike.last.date}`);
  if (prof.run) parts.push(`Laufen ${f(prof.run.perWeek)}×/Woche`);
  return parts.length ? parts.join('. ') + '.' : 'Noch keine Trainings in den letzten 6 Wochen.';
}


/** Abschnitt für den KI-Coach: was du trainierst, die Empfehlung von Puls und die Infekt-Frühwarnung. */
export function trainingBlock(model, i = model.days.length - 1, opts = {}) {
  const p = trainingPlan(model, i, opts);
  const ill = p.ill;
  const out = [];
  const L = (t) => out.push(t);
  L('## Training (von Puls aus den Garmin-Aktivitäten der letzten 6 Wochen gelernt)');
  L(`Was er trainiert: ${profileLine(p.profile)}`);
  if (p.kind !== 'none') {
    L(`Puls-Empfehlung heute: ${p.title}${p.sub ? ` – ${p.sub}` : ''}.${p.bullets.length ? ` Gründe: ${p.bullets.join(' ')}` : ''}${p.alt ? ` Alternative: ${p.alt}` : ''}`);
  }
  L(`Infekt-Frühwarnung: ${ill.label}${ill.signals.length ? ` (${ill.signals.map((x) => x.text).join('; ')})` : ''}.${ill.note ? ` ${ill.note}` : ''}`);
  if (ill.p != null) L(`Infekt-Risiko nächste 3 Tage: ${Math.round(ill.p * 100)} %${ill.rel ? ` (${ill.rel.toFixed(1).replace('.', ',')}× seine Basis)` : ''}.`);
  if (opts.feel === 'sick') L('Er hat heute angegeben, dass er sich angeschlagen fühlt.');
  return out.join('\n');
}

/** Kurzname einer Einheit für Wochenübersicht und Kalender: „Push“, „Pull“, „Rad“ … */
export function sessionLabel(a, labels = {}) {
  const kind = activityKind(a);
  if (kind === 'gym') {
    const sp = splitOf(a, labels);
    return sp ? SPLITS[sp] : 'Gym';
  }
  if (kind === 'bike' || kind === 'run') return sportLabel(a);
  const n = String(a?.name || a?.type || 'Training').trim();
  return n.length > 14 ? `${n.slice(0, 13)}…` : n;
}

/** Trainings pro Tag (nur Einheiten ab 10 Min.): [{ kind, label, min }] */
export function sessionsOn(day, labels = {}) {
  return (day?.acts || [])
    .filter((a) => (a.dur || 0) >= 600)
    .map((a) => ({ kind: activityKind(a), label: sessionLabel(a, labels), min: Math.round((a.dur || 0) / 60), id: a.id ?? null }));
}

/** Trainingswoche Mo–So um den Tag ``i``: Tage, Anzahl und Vergleich mit der Vorwoche. */
export function trainingWeek(model, i = model.days.length - 1, labels = {}) {
  labels = effectiveLabels(model, labels).map;
  const date = model.days[i].date;
  const monday = (iso) => {
    const wdn = (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - wdn);
    return d.toISOString().slice(0, 10);
  };
  const shift = (iso, n) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const build = (start) =>
    Array.from({ length: 7 }, (_, k) => {
      const iso = shift(start, k);
      const idx = model.index[iso];
      return { date: iso, future: iso > model.days[model.days.length - 1].date, sessions: idx == null ? [] : sessionsOn(model.days[idx], labels) };
    });
  const start = monday(date);
  const days = build(start);
  const prev = build(shift(start, -7));
  const count = (ds) => ds.reduce((t, d) => t + d.sessions.length, 0);
  const byLabel = {};
  for (const d of days) for (const s of d.sessions) byLabel[s.label] = (byLabel[s.label] || 0) + 1;
  return { start, days, count: count(days), trainingDays: days.filter((d) => d.sessions.length).length, prevCount: count(prev), byLabel };
}
