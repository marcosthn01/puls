import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';
import * as T from '../app/training.js';

const store = makeDemoStore({ now: new Date('2026-11-10T08:30:00') });
const model = E.analyze(store, {});
const last = model.days.length - 1;

test('Aktivitäten werden als Gym oder Rad erkannt', () => {
  assert.equal(T.activityKind({ type: 'strength_training', name: 'Krafttraining' }), 'gym');
  assert.equal(T.activityKind({ type: 'other', name: 'Pull' }), 'gym');
  assert.equal(T.activityKind({ type: 'road_biking' }), 'bike');
  assert.equal(T.activityKind({ type: 'indoor_cycling', name: 'Spinning' }), 'bike');
  assert.equal(T.activityKind({ type: 'virtual_ride' }), 'bike');
  assert.equal(T.activityKind({ type: 'running' }), 'run');
  assert.equal(T.splitOf({ name: 'Push Day' }), 'push');
  assert.equal(T.splitOf({ name: 'Rücken & Bizeps' }), 'pull');
  assert.equal(T.splitOf({ id: 7, name: 'Krafttraining' }, { 7: 'pull' }), 'pull');
  assert.equal(T.splitOf({ name: 'Krafttraining' }), null);
});

test('Profil: Gym im Push/Pull-Wechsel und Rad mit typischer Dauer', () => {
  const p = T.trainingProfile(model, last);
  assert.ok(p.gym.perWeek > 2 && p.bike.perWeek > 2);
  assert.deepEqual([...p.gym.splits].sort(), ['pull', 'push']);
  assert.ok(p.bike.typicalMin >= 60 && p.bike.typicalMin <= 95);
  assert.equal(T.nextSplit({ splits: ['push', 'pull'], lastSplit: 'push' }), 'pull');
  assert.equal(T.nextSplit({ splits: ['push', 'pull', 'legs'], lastSplit: 'pull' }), 'legs');
});

test('Empfehlung: nur Gym oder Rad, mit Dauer bzw. Volumen – nie Zone-4-Intervalle', () => {
  for (let k = last - 60; k <= last; k++) {
    const p = T.trainingPlan(model, k, { journal: store.journal });
    assert.ok(['gym', 'bike', 'rest', 'done', 'none'].includes(p.kind), `${model.days[k].date}: ${p.kind}`);
    const text = [p.title, p.sub, ...p.bullets, p.alt || ''].join(' ');
    assert.doesNotMatch(text, /Zone 4|Intervall/);
    if (p.kind === 'bike') {
      assert.ok(p.min >= 30 && p.min <= 120 && p.min % 15 === 0, `${p.min} Min.`);
      assert.match(p.sub, /Puls/);
    }
    if (p.kind === 'gym') assert.match(p.sub, /Volumen/);
  }
});

test('Nach Gym gestern an einem mittleren Tag: Rad statt derselben Muskeln', () => {
  const k = model.days.findIndex((d, idx) => idx > 30 && d.recovery != null && d.recovery >= 34 && d.recovery < 50 && model.days[idx - 1].acts.some((a) => T.activityKind(a) === 'gym') && !d.acts.length && (d.ill?.level ?? 0) === 0);
  assert.ok(k > 0, 'Testtag gefunden');
  assert.equal(T.trainingPlan(model, k).kind, 'bike');
});

test('Angeschlagen oder Infekt: Pause; schlechte Tage: weniger Volumen', () => {
  assert.equal(T.trainingPlan(model, last, { feel: 'sick' }).kind, 'rest');
  const peak = model.days.findIndex((d) => (d.ill?.level ?? 0) >= 3);
  assert.ok(peak > 0);
  assert.equal(T.trainingPlan(model, peak).kind, 'rest');
  const gymRed = model.days.findIndex((d, idx) => idx > 30 && d.recovery != null && d.recovery < 50 && T.trainingPlan(model, idx).kind === 'gym');
  if (gymRed > 0) assert.match(T.trainingPlan(model, gymRed).sub, /−(20|40) % Volumen/);
});

test('Infekt-Frühwarnung erkennt die Erkältung vor dem Höhepunkt und deckelt die Recovery', () => {
  const peak = model.days.findIndex((d) => (d.ill?.level ?? 0) >= 3);
  assert.ok(model.days[peak - 1].ill.level >= 1 || model.days[peak - 2].ill.level >= 1, 'Frühzeichen am Vortag');
  for (const d of model.days) {
    if ((d.ill?.level ?? 0) >= 2 && d.recovery != null) assert.ok(d.recovery <= 55, d.date);
  }
  const r = E.illnessRisk(model, last, { journal: store.journal });
  assert.ok(r.history.episodes.length >= 1);
  assert.equal(r.history.leadKey, 'rhr');
  assert.ok(E.illnessRisk(model, last, { feel: 'sick' }).level >= 1);
});

test('Hohe Werte allein ohne Ausreißer: keine Warnung', () => {
  const calm = model.days.slice(-20).filter((d) => (d.ill?.level ?? 0) === 0).length;
  assert.ok(calm >= 12, `${calm} ruhige Tage`);
});

test('Coach bekommt Profil, Empfehlung und Frühwarnung', () => {
  const block = T.trainingBlock(model, last, { journal: store.journal });
  assert.match(block, /Was er trainiert: Gym .*Push/);
  assert.match(block, /Puls-Empfehlung heute: (Rad|Gym|Heute Pause)/);
  assert.match(block, /Infekt-Frühwarnung: /);
  const ctx = E.coachContext(model, store.journal, last, {}, block);
  assert.match(ctx, /## Training/);
  assert.doesNotMatch(ctx, /App-Empfehlung Training/);
});
