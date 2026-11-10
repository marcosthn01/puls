// Tests für Zeitplan-Entscheidung und Benachrichtigungen (ohne Versand)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';
import { dueMessages, localNow, needsNightWatch, planRun, seal, unseal } from '../sync/notify.mjs';

const store = makeDemoStore({ now: new Date('2026-11-09T16:30:00') });
const model = E.analyze(store, {});
const today = model.days[model.days.length - 1].date;
const at = (h, m = 0, date = today) => ({ date, minutes: h * 60 + m, weekday: E.weekday(date) });
const sub = { subscription: { endpoint: 'https://x' } };

test('Morgens kommt der Morgenbericht genau einmal', () => {
  const m = dueMessages(model, at(7, 30), {}).find((x) => x.kind === 'morning');
  assert.ok(m && /Morgenbericht · Recovery \d+ %/.test(m.title) && /Training: (Rad|Gym|Heute Pause|Erledigt)/.test(m.body), m?.body);
  // Schlaf, HRV/Ruhepuls gegenüber normal und die Schlafenszeit stehen drin; Tippen öffnet die App auf „Heute“
  assert.match(m.body, /Schlaf \d+:\d\d Std\./);
  assert.match(m.body, /HRV \d+ ms \([+−]\d+ %\)/);
  assert.match(m.body, /Heute ins Bett um \d\d:\d\d/);
  assert.match(m.url, /\?tab=heute$/);
  assert.ok(!dueMessages(model, at(7, 30), { morning: today }).some((x) => x.kind === 'morning'));
  assert.ok(!dueMessages(model, at(15), {}).some((x) => x.kind === 'morning'));
  assert.deepEqual(dueMessages(model, at(8, 0, E.addDays(today, 1)), {}), []);
});

test('Nachmittags kommt ein Hinweis zum Trainingsziel', () => {
  const m = dueMessages(model, at(16), { morning: today }).find((x) => x.kind === 'afternoon');
  assert.ok(m, 'afternoon fehlt');
  assert.match(m.title, /Ziel|Min\.|Energie|Genug/);
  assert.ok(!dueMessages(model, at(16), { morning: today, afternoon: today }).some((x) => x.kind === 'afternoon'));
});

test('Abends kommt die Schlaf-Erinnerung kurz vor der Schlafenszeit', () => {
  const bed = E.bedtimePlan(model, model.days.length - 1).options[0].bed;
  const msgs = dueMessages(model, { ...at(0), minutes: 1440 + bed - 30 }, { morning: today, afternoon: today });
  assert.equal(msgs.filter((x) => x.kind === 'bedtime').length, 1);
  assert.match(msgs.find((x) => x.kind === 'bedtime').body, /Ins Bett um \d\d:\d\d/);
  assert.ok(!dueMessages(model, { ...at(0), minutes: 1440 + bed - 150 }, { morning: today }).some((x) => x.kind === 'bedtime'));
});

test('Zeitplan: morgens bis die Nacht da ist, sonst nur mit Anlass', () => {
  assert.equal(planRun({ now: at(6), state: null, model }).sync, true);
  assert.equal(planRun({ now: at(6), state: { morningDone: today }, model }).sync, false);
  assert.equal(planRun({ now: at(16), state: null, model }).sync, false); // ohne Benachrichtigungen
  assert.equal(planRun({ now: at(16), state: { ...sub, sent: {} }, model }).sync, true);
  const weeklyDay = [0, 5].includes(at(16).weekday);
  assert.equal(planRun({ now: at(16), state: { ...sub, sent: { afternoon: today } }, model }).sync, weeklyDay);
  assert.equal(planRun({ now: at(16), state: { ...sub, sent: { afternoon: today, weekly: today } }, model }).sync, false);
  const bed = E.bedtimePlan(model, model.days.length - 1).options[0].bed;
  assert.equal(planRun({ now: { ...at(0), minutes: 1440 + bed - 30 }, state: { ...sub, sent: {} }, model }).sync, true);
  assert.equal(planRun({ now: { ...at(0), minutes: 1440 + bed - 100 }, state: { ...sub, sent: { steps: today } }, model }).sync, false);
  assert.equal(planRun({ now: at(14, 45), state: { ...sub, sent: {} }, model }).sync, false);
  // Mittag und früher Abend
  assert.equal(planRun({ now: at(12, 17), state: { ...sub, sent: {} }, model }).sync, true);
  assert.equal(planRun({ now: at(12, 17), state: { ...sub, sent: { midday: today } }, model }).sync, false);
  assert.equal(planRun({ now: at(12, 17), state: null, model }).sync, false);
  assert.equal(planRun({ now: at(18, 17), state: { ...sub, sent: {} }, model }).sync, true);
  assert.equal(planRun({ now: at(18, 17), state: { ...sub, sent: { steps: today } }, model }).sync, false);
  // abgewählte Arten lösen keinen Lauf aus
  const off = { ...sub, sent: {}, prefs: { midday: false, steps: false } };
  assert.equal(planRun({ now: at(12, 17), state: off, model }).sync, false);
  assert.equal(planRun({ now: at(18, 17), state: off, model }).sync, false);
});

/** Modell mit geänderten Werten für heute. */
function todayWith(stats = {}, stressDay) {
  const copy = structuredClone(store);
  const key = Object.keys(copy.days).sort().pop();
  Object.assign(copy.days[key].stats, stats);
  if (stressDay !== undefined) copy.days[key].stressDay = stressDay;
  return E.analyze(copy, {});
}

test('Mittags: Hinweis auf zu wenig Schritte oder hohen Stress', () => {
  const lazy = todayWith({ steps: 1200, stepGoal: 9000 }, null);
  const m = dueMessages(lazy, at(12, 30), { morning: today }).find((x) => x.kind === 'midday');
  assert.ok(m, 'midday fehlt');
  assert.match(m.title, /Erst 1\.200 Schritte/);
  assert.match(m.body, /9\.000/);
  assert.ok(!dueMessages(lazy, at(12, 30), { morning: today, midday: today }).some((x) => x.kind === 'midday'));
  assert.ok(!dueMessages(lazy, at(10, 30), { morning: today }).some((x) => x.kind === 'midday'));
  // genug gelaufen, wenig Stress: keine Nachricht
  const fine = todayWith({ steps: 6000, stepGoal: 9000 }, null);
  assert.ok(!dueMessages(fine, at(12, 30), { morning: today }).some((x) => x.kind === 'midday'));
  // hoher Stress in der letzten Stunde geht vor
  const stress = Array.from({ length: 8 }, (_, k) => [12 * 60 + 30 - 70 + k * 10, 70]);
  const tense = todayWith({ steps: 1200 }, { stress, bb: [] });
  assert.match(dueMessages(tense, at(12, 30), { morning: today }).find((x) => x.kind === 'midday').title, /Stress/);
});

test('Früher Abend: noch fehlende Schritte oder Ziel geschafft', () => {
  const short = todayWith({ steps: 5400, stepGoal: 8000 });
  const m = dueMessages(short, at(18, 20), { morning: today }).find((x) => x.kind === 'steps');
  assert.ok(m && /Noch 2\.600 Schritte/.test(m.title), m?.title);
  assert.match(m.body, /5\.400 von 8\.000 .* \d+ Min\./);
  const done = todayWith({ steps: 10400, stepGoal: 8000 });
  assert.match(dueMessages(done, at(18, 20), { morning: today }).find((x) => x.kind === 'steps').title, /geschafft/);
  assert.ok(!dueMessages(short, at(18, 20), { steps: today }).some((x) => x.kind === 'steps'));
  assert.ok(!dueMessages(short, at(21, 0), {}).some((x) => x.kind === 'steps'));
});

test('Abgewählte Benachrichtigungen kommen nicht', () => {
  const short = todayWith({ steps: 1200 });
  const prefs = { morning: false, midday: false, steps: false };
  assert.ok(!dueMessages(short, at(7, 30), {}, prefs).some((x) => x.kind === 'morning'));
  assert.ok(!dueMessages(short, at(12, 30), {}, prefs).some((x) => x.kind === 'midday'));
  assert.ok(!dueMessages(short, at(18, 20), {}, prefs).some((x) => x.kind === 'steps'));
  assert.ok(dueMessages(short, at(18, 20), {}, { midday: false }).some((x) => x.kind === 'steps'));
});

test('Freitags: Erinnerung an die Intensitätsminuten der Woche', () => {
  const friday = model.days.map((d) => d.date).filter((d) => E.weekday(d) === 5).pop();
  const keys = Object.keys(store.days).filter((k) => k <= friday);
  const copy = structuredClone(Object.fromEntries(keys.map((k) => [k, store.days[k]])));
  for (const k of keys.slice(-5)) Object.assign(copy[k].stats, { imMod: 10, imVig: 5 }); // Mo–Fr je 20
  const m5 = E.analyze({ ...store, days: copy }, {});
  const w = dueMessages(m5, at(16, 0, friday), {}).find((x) => x.kind === 'weekly');
  assert.ok(w, 'weekly fehlt');
  assert.equal(w.title, 'Noch 50 Intensitätsminuten diese Woche');
  assert.match(w.body, /Bisher 100 von 150/);
  for (const k of keys.slice(-5)) Object.assign(copy[k].stats, { imMod: 40, imVig: 0 });
  const m6 = E.analyze({ ...store, days: copy }, {});
  assert.ok(!dueMessages(m6, at(16, 0, friday), {}).some((x) => x.kind === 'weekly'));
});

test('Sonntags kommt der Wochenbericht', () => {
  const sunday = model.days.map((d) => d.date).filter((d) => E.weekday(d) === 0).pop();
  const keys = Object.keys(store.days).filter((k) => k <= sunday);
  const m2 = E.analyze({ ...store, days: Object.fromEntries(keys.map((k) => [k, store.days[k]])) }, {});
  const w = dueMessages(m2, at(17, 0, sunday), {}).find((x) => x.kind === 'weekly');
  assert.ok(w && w.title.startsWith('Deine Woche'));
});

test('Zustand wird verschlüsselt und wieder gelesen', async () => {
  const box = await seal({ a: 1, sub: { endpoint: 'https://x' } }, 'test-passwort-123', 1000);
  assert.ok(!JSON.stringify(box).includes('https://x'));
  assert.deepEqual(await unseal(box, 'test-passwort-123'), { a: 1, sub: { endpoint: 'https://x' } });
  await assert.rejects(unseal(box, 'falsch-falsch'));
});

test('Lokale Zeit in Berlin', () => {
  const t = localNow(new Date('2026-11-09T21:15:00Z'), 'Europe/Berlin');
  assert.deepEqual(t, { date: '2026-11-09', minutes: 22 * 60 + 15, weekday: 1 });
});

test('Walking-Pad: Bestätigung nach dem Laufen, nur bei neuen Schritten', async () => {
  const { padMessage } = await import('../sync/notify.mjs');
  const m = todayWith({ steps: 5000, stepGoal: 8000 });
  const copy = structuredClone(store);
  const key = Object.keys(copy.days).sort().pop();
  Object.assign(copy.days[key].stats, { steps: 5000, stepGoal: 8000 });
  copy.days[key].pad = { samples: [[50400, 53100, 3600]], total: 3600, add: 3000, units: [[840, 885, 3600]], min: 45 };
  const withPad = E.analyze(copy, {});
  const msg = padMessage(withPad, at(15), 0);
  assert.equal(msg.title, '👟 Walking-Pad: 3.600 Schritte heute');
  assert.equal(msg.body, 'Heute insgesamt 8.000 von 8.000 – Ziel geschafft 🎉');
  assert.equal(padMessage(withPad, at(15), 3600), null); // schon gemeldet
  assert.equal(padMessage(withPad, at(15), 0, { pad: false }), null);
  assert.equal(padMessage(m, at(15), 0)?.kind ?? null, m.days[m.days.length - 1].pad ? 'pad' : null);
  copy.days[key].pad.add = 0;
  const counted = padMessage(E.analyze(copy, {}), at(15), 0);
  assert.match(counted.body, /^Deine Uhr hatte sie schon mitgezählt\. Heute insgesamt 5\.000 von 8\.000 – noch 3\.000\.$/);
});

test('Morgenwache: startet nur morgens und nur, wenn die Nacht von heute fehlt', () => {
  const last = model.days[model.days.length - 1];
  assert.ok(last.sleep, 'Demo hat eine Nacht');
  assert.equal(needsNightWatch(model, at(7)), false); // Nacht ist da
  const noNight = { ...model, days: [...model.days.slice(0, -1), { ...last, sleep: null }] };
  assert.equal(needsNightWatch(noNight, at(7)), true);
  assert.equal(needsNightWatch(noNight, at(3, 59)), false); // vor 4 Uhr
  assert.equal(needsNightWatch(noNight, at(12, 30)), false); // nach 12:30
  const yesterday = { ...model, days: model.days.slice(0, -1) };
  assert.equal(needsNightWatch(yesterday, at(8)), true); // heute noch gar kein Tag
  assert.equal(needsNightWatch(null, at(8)), true);
});

test('Morgens mit Infekt-Zeichen: Warnung statt Trainingsplan', () => {
  const last = model.days[model.days.length - 1];
  const ill = { level: 2, score: 4, raw: 4, signals: [{ key: 'rhr', pts: 2, text: 'Ruhepuls +5 bpm über deinem Normalwert' }, { key: 'resp', pts: 2, text: 'Atemfrequenz +1,1 Atemzüge/Min. über normal' }] };
  const sickModel = { ...model, days: [...model.days.slice(0, -1), { ...last, ill }] };
  const m = dueMessages(sickModel, at(7, 30), {}).find((x) => x.kind === 'morning');
  assert.match(m.title, /Morgenbericht · Infekt-Frühwarnung erhöht/);
  assert.match(m.body, /Ruhepuls \+5 bpm/);
  assert.match(m.body, /nur locker/);
});

test('Abends kommt der Abendbericht mit Training, Schritten und Schlafenszeit', () => {
  const i = model.days.length - 1;
  const last = model.days[i];
  const ride = { id: 9, type: 'indoor_cycling', name: 'Gym', start: '17:30', dur: 3300, avgHr: 138, pwr: 182, cad: 88, strain: 9.5 };
  const m2 = { ...model, days: [...model.days.slice(0, -1), { ...last, acts: [ride], stats: { ...(last.stats || {}), steps: 9100, stepGoal: 10000, stress: 31 } }] };
  const msgs = dueMessages(m2, at(20, 30), { morning: today });
  const ev = msgs.find((x) => x.kind === 'evening');
  assert.ok(ev, 'Abendbericht fehlt');
  assert.match(ev.title, /^🌙 Abendbericht · Strain \d+,\d/);
  // Sportart genau wie von Garmin: Indoor-Rad, nicht „Gym“
  assert.match(ev.body, /Training: Indoor-Rad 55 Min\. · 182 W · Ø 138 bpm/);
  assert.match(ev.body, /9\.100 von 10\.000 Schritten · Stress Ø 31/);
  assert.match(ev.body, /Heute Nacht: ins Bett um \d\d:\d\d für \d+:\d\d Std\. Schlaf/);
  // Schritte stehen im Abendbericht – keine zweite Schritt-Nachricht im selben Lauf
  assert.ok(!msgs.some((x) => x.kind === 'steps'));
  assert.ok(!dueMessages(m2, at(20, 30), { morning: today, evening: today }).some((x) => x.kind === 'evening'));
  assert.ok(!dueMessages(m2, at(19, 0), { morning: today }).some((x) => x.kind === 'evening'));
  assert.ok(!dueMessages(m2, at(20, 30), { morning: today }, { evening: false }).some((x) => x.kind === 'evening'));
});

test('Abendbericht: Lauf wird zur passenden Zeit geplant', () => {
  const st = { subscription: { endpoint: 'https://x' }, sent: {}, morningDone: today };
  assert.equal(planRun({ now: at(20, 47), state: st, model }).sync, true);
  assert.equal(planRun({ now: at(20, 47), state: { ...st, sent: { evening: today, steps: today, bedtime: today } }, model }).sync, false);
});
