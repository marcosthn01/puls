import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/sport.js';
import * as T from '../app/training.js';

test('Garmins Sportart hat Vorrang vor dem Namen', () => {
  // Indoor-Rad im Studio „Gym“: bleibt Rad
  assert.equal(S.activityKind({ type: 'indoor_cycling', name: 'Gym' }), 'bike');
  assert.equal(S.activityKind({ type: 'road_biking', name: 'Push' }), 'bike');
  assert.equal(S.activityKind({ type: 'treadmill_running', name: 'Kraft danach' }), 'run');
  assert.equal(S.activityKind({ type: 'strength_training', name: 'Radfahren' }), 'gym');
  // Unklare Art: der Name entscheidet
  assert.equal(S.activityKind({ type: 'fitness_equipment', name: 'Indoor-Rad' }), 'bike');
  assert.equal(S.activityKind({ type: 'fitness_equipment', name: 'Push' }), 'gym');
  assert.equal(S.activityKind({ type: 'other', name: 'Pull' }), 'gym');
  assert.equal(S.activityKind({ type: 'other', ptype: 2 }), 'bike');
  assert.equal(S.activityKind({ type: 'walking', name: 'Spaziergang' }), 'other');
  // training.js nutzt dieselbe Erkennung
  assert.equal(T.activityKind({ type: 'indoor_cycling', name: 'Gym' }), 'bike');
});

test('Name und Titel wie auf der Uhr', () => {
  assert.equal(S.sportLabel({ type: 'indoor_cycling' }), 'Indoor-Rad');
  assert.equal(S.sportLabel({ type: 'strength_training' }), 'Krafttraining');
  assert.equal(S.sportLabel({ type: 'pickleball' }), 'Pickleball');
  assert.equal(S.activityTitle({ type: 'indoor_cycling', name: 'Gym' }), 'Indoor-Rad');
  assert.equal(S.activityTitle({ type: 'indoor_cycling', name: 'Dortmund Indoor-Radfahren' }), 'Indoor-Rad');
  assert.equal(S.activityTitle({ type: 'strength_training', name: 'Push' }), 'Push');
  assert.equal(S.activityTitle({ type: 'road_biking', name: 'Feierabendrunde' }), 'Feierabendrunde');
  assert.equal(T.sessionLabel({ type: 'indoor_cycling', name: 'Gym', dur: 3000 }), 'Indoor-Rad');
});

test('Messwerte je Sportart', () => {
  const ride = { type: 'indoor_cycling', dur: 3000, moving: 2700, pwr: 182, np: 190, maxPwr: 410, cad: 88, dist: 0, resp: 28.4 };
  const keys = S.sportFacts(ride).map((f) => f.k);
  assert.deepEqual(keys.slice(0, 4), ['Ø Leistung', 'Norm. Leistung', 'Max. Leistung', 'Ø Trittfrequenz']);
  assert.ok(!keys.includes('Distanz') && keys.includes('In Bewegung') && keys.includes('Ø Atmung'));
  assert.deepEqual(S.sportMeta(ride), ['182 W', '88 U/min']);
  const run = { type: 'running', dur: 3000, dist: 10000, spd: 3.333, cad: 168 };
  assert.equal(S.sportFacts(run).find((f) => f.k === 'Ø Pace').v, '5:00');
  const gym = { type: 'strength_training', name: 'Push', dur: 3900, sets: 18, reps: 164, ex: [{ c: 'BENCH_PRESS', s: 4, r: 32 }, { c: 'NEW_THING', s: 2 }] };
  assert.deepEqual(S.sportMeta(gym), ['18 Sätze', '164 Wiederholungen']);
  assert.deepEqual(S.exercises(gym), [{ name: 'Bankdrücken', sets: 4, reps: 32 }, { name: 'New thing', sets: 2, reps: null }]);
  assert.match(S.sportLine(gym), /^Push \(Krafttraining\), Sätze 18, Wiederholungen 164, Übungen: Bankdrücken 4×32/);
});

test('Training heute: nach Indoor-Rad gilt der Tag als erledigt – kein Gym obendrauf', async () => {
  const { makeDemoStore } = await import('../app/demo.js');
  const E = await import('../app/engine.js');
  const store = makeDemoStore();
  const days = Object.keys(store.days).sort();
  const last = days[days.length - 1];
  store.days[last].acts = [{ id: 1, type: 'indoor_cycling', name: 'Gym', start: '07:00', dur: 2700, avgHr: 118 }];
  const m = E.analyze(store, {});
  const plan = T.trainingPlan(m, m.days.length - 1);
  assert.equal(plan.kind, 'done');
  assert.match(plan.title, /^Erledigt: Indoor-Rad · 45 Min\.$/);
});

test('Sportart korrigieren: gilt für Auswertung und Plan, Garmins Angabe bleibt erhalten', () => {
  const store = { days: { '2026-11-10': { acts: [{ id: 25, type: 'strength_training', name: 'Krafttraining', dur: 1974, sets: 1, reps: 0 }] }, '2026-11-09': { stats: {} } } };
  const odd = S.suspicious(store.days['2026-11-10'].acts[0]);
  assert.match(odd, /in 33 Min\. nur 1 Satz erkannt/);
  const fixed = S.applySportLabels(store, { 25: 'sport:indoor_cycling', 3: 'push' });
  const a = fixed.days['2026-11-10'].acts[0];
  assert.equal(a.type, 'indoor_cycling');
  assert.equal(a.typeGarmin, 'strength_training');
  assert.equal(S.activityKind(a), 'bike');
  assert.equal(S.suspicious(a), null);
  assert.equal(store.days['2026-11-10'].acts[0].type, 'strength_training'); // Original unverändert
  // „wie Garmin“ nimmt die Korrektur zurück (auch wenn der Abruf sie schon eingetragen hat)
  const back = S.applySportLabels(fixed, { 25: 'sport:garmin' });
  assert.equal(back.days['2026-11-10'].acts[0].type, 'strength_training');
  assert.ok(!('typeGarmin' in back.days['2026-11-10'].acts[0]));
  // Sportart-Markierungen sind keine Push/Pull-Splits
  assert.equal(T.splitOf({ id: 25, name: 'Krafttraining' }, { 25: 'sport:indoor_cycling' }), null);
  // echte Kraft-Einheit mit vielen Sätzen ist nicht verdächtig
  assert.equal(S.suspicious({ id: 1, type: 'strength_training', dur: 4193, sets: 43, reps: 300 }), null);
});
