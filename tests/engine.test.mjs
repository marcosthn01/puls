// Tests der Auswertung: node --test tests/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openBox } from '../app/crypto.js';
import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-11-09T21:00:00');
const store = makeDemoStore({ now: NOW });
const model = E.analyze(store, {});
const last = model.days.length - 1;

test('Strain-Skala ist monoton, begrenzt und umkehrbar', () => {
  let prev = -1;
  for (const t of [0, 10, 50, 100, 200, 400, 800, 5000]) {
    const s = E.strainFromTrimp(t);
    assert.ok(s <= 21 && (s > prev || s === 21));
    prev = s;
    if (s < 21) assert.ok(Math.abs(E.trimpFromStrain(s) - t) < 1e-6);
  }
  assert.equal(E.trimpWeight(0.1, 'male'), 0);
  assert.ok(E.trimpWeight(0.9, 'male') > E.trimpWeight(0.6, 'male'));
});

test('Pulszonen nach Herzfrequenzreserve', () => {
  const z = E.hrZones(50, 190);
  assert.deepEqual(z[0], { zone: 1, lo: 120, hi: 134 });
  assert.equal(z[4].hi, 190);
});

test('Recovery liegt im gültigen Bereich und streut realistisch', () => {
  const recs = model.days.map((d) => d.recovery).filter((v) => v != null);
  assert.ok(recs.length >= 85);
  assert.ok(recs.every((r) => r >= 1 && r <= 99));
  const avg = E.mean(recs);
  assert.ok(avg > 45 && avg < 75, `Schnitt ${avg}`);
  for (const zone of ['green', 'yellow', 'red']) assert.ok(model.days.some((d) => d.zone === zone), zone);
});

test('Erkältung in den Demo-Daten wird als Warnsignal erkannt', () => {
  const sick = model.days[last - 36];
  assert.ok(sick.alarm, 'alarm');
  assert.equal(sick.zone, 'red');
  assert.ok(sick.target.high <= 9);
  assert.equal(E.buildInsights(model, last - 36)[0].tone, 'bad');
});

test('Harte Tage haben mehr Strain als Ruhetage', () => {
  const rest = model.days.filter((d) => !d.acts.length && d.strain != null).map((d) => d.strain);
  const hard = model.days.filter((d) => d.acts.some((a) => a.name === 'Langer Lauf')).map((d) => d.strain);
  assert.ok(E.mean(hard) > E.mean(rest) + 4);
  assert.ok(E.mean(rest) > 3 && E.mean(rest) < 10);
});

test('Schlafbedarf schaukelt sich nicht auf', () => {
  for (const d of model.days) {
    assert.ok(d.need.total >= d.need.base && d.need.total <= d.need.base + 60 + 44 + 15, d.date);
  }
});

test('Zielbelastung folgt der Recovery', () => {
  const g = model.days.filter((d) => d.zone === 'green' && !d.target.notes.length);
  const r = model.days.filter((d) => d.zone === 'red' && !d.target.notes.length);
  assert.ok(E.mean(g.map((d) => d.target.low)) > E.mean(r.map((d) => d.target.low)) + 4);
});

test('Coach, Erkenntnisse und Schlafenszeit für heute', () => {
  const coach = E.buildCoach(model, last);
  assert.ok(['green', 'yellow', 'red'].includes(coach.state));
  assert.match(coach.plan, /bpm|Krafttraining/);
  const plan = E.bedtimePlan(model, last);
  assert.equal(plan.options.length, 3);
  assert.ok(plan.options[0].bed < plan.options[1].bed && plan.options[1].bed < plan.options[2].bed);
  const bed = ((plan.options[0].bed % 1440) + 1440) % 1440;
  assert.ok(bed > 19 * 60 || bed < 60, `Schlafenszeit ${E.fmtClock(bed)}`);
  for (const x of E.buildInsights(model, last)) assert.ok(x.title && x.text && ['good', 'info', 'warn', 'bad'].includes(x.tone));
});

test('Einflüsse finden das eingebaute Wochenend-Muster', () => {
  assert.ok(model.influences.ready);
  const weekend = model.influences.items.find((x) => x.id === 'weekend');
  assert.ok(weekend && weekend.diff < 0);
});

test('Tag ohne Schlafdaten: keine Recovery, Coach erklärt warum', () => {
  const copy = structuredClone(store);
  const lastKey = Object.keys(copy.days).sort().pop();
  delete copy.days[lastKey].sleep;
  delete copy.days[lastKey].hrv;
  const m = E.analyze(copy, {});
  const d = m.days[m.days.length - 1];
  assert.equal(d.recovery, null);
  assert.equal(E.buildCoach(m, m.days.length - 1).state, 'nodata');
  assert.ok(d.strain != null);
});

test('Wenige Tage: Kalibrierung mit Garmins HRV-Normalbereich', () => {
  const keys = Object.keys(store.days).sort().slice(0, 3);
  const small = { ...store, days: Object.fromEntries(keys.map((k) => [k, store.days[k]])) };
  const m = E.analyze(small, {});
  assert.equal(m.days[0].base.hrv.src, 'garmin');
  assert.ok(m.days[0].base.calibrating);
  assert.equal(m.influences.ready, false);
});

test('Einstellungen überschreiben Automatik', () => {
  const m = E.analyze(store, { maxHr: 200, sleepNeed: 450, sport: 'laufen', wakeTime: '06:00' });
  assert.equal(m.settings.maxHr, 200);
  assert.equal(m.days[5].need.base, 450);
  assert.equal(E.bedtimePlan(m, m.days.length - 1).wake, 360);
  assert.equal(E.analyze({ days: {} }).empty, true);
});

test('Python-Verschlüsselung lässt sich in der App öffnen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'puls-'));
  const plain = join(dir, 'store.json');
  writeFileSync(plain, JSON.stringify({ hallo: 'Grüße', n: [1, 2, 3] }));
  const py = process.env.PYTHON || 'python3';
  const out = execFileSync(py, ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(here, '..', 'sync'))})
from crypto_box import encrypt_json
print(json.dumps(encrypt_json(json.load(open(sys.argv[1])), "test-passwort-123", iterations=1000)))
`, plain]).toString();
  const box = JSON.parse(out);
  const { data, cache } = await openBox(box, 'test-passwort-123', null);
  assert.deepEqual(data, { hallo: 'Grüße', n: [1, 2, 3] });
  const again = await openBox(box, null, cache); // mit gespeichertem Schlüssel, ohne Passwort
  assert.deepEqual(again.data, data);
  await assert.rejects(openBox(box, 'falsch-falsch', null), /WRONG_PASSPHRASE/);
  await assert.rejects(openBox(box, null, null), /NEED_PASSPHRASE/);
});

test('Körper-Check: normale Tage grün, Erkältung auffällig', () => {
  const normal = E.vitals(model, last);
  assert.ok(normal.items.find((x) => x.key === 'hrv'));
  const sickIdx = model.days.findIndex((d) => d.alarm);
  const sick = E.vitals(model, sickIdx);
  assert.ok(sick.outside >= 2, `auffällig: ${sick.outside}`);
  assert.ok(sick.items.find((x) => x.key === 'rhr').bad);
});

test('Statistiken vergleichen mit dem 30-Tage-Schnitt', () => {
  const rows = E.keyStats(model, last - 1);
  const hrv = rows.find((r) => r.key === 'hrv');
  assert.ok(hrv.base > 30 && hrv.base < 90);
  assert.ok(['up', 'down', 'flat'].includes(hrv.trend));
  const partial = E.keyStats(model, last, { partial: true });
  assert.equal(partial.find((r) => r.key === 'steps').trend, null);
});

test('Morgen-Check: Alkohol senkt in den Demo-Daten die Recovery', () => {
  const imp = E.journalImpacts(model, store.journal);
  const alk = imp.find((x) => x.id === 'alkohol');
  assert.ok(alk && !alk.pending && alk.diff < -10, JSON.stringify(alk));
  assert.deepEqual(E.journalImpacts(model, {}), []);
  const yesterday = E.addDays(model.days[last].date, -1);
  const j = { ...store.journal, [yesterday]: { _done: true, alkohol: true } };
  const ins = E.buildInsights(model, last, j);
  assert.ok(ins.some((x) => x.title === 'Alkohol gestern'));
});

test('Wochenbericht liefert Urteil und Stichpunkte', () => {
  const w = E.weeklyAssessment(model, last);
  assert.ok(['Optimal', 'Ausgewogen', 'Überlastet', 'Erholung nötig', 'Erholungswoche'].includes(w.verdict.label));
  assert.ok(w.bullets.length >= 2);
  assert.equal(w.current.n, 7);
});

test('Puls-Alter: plausibel und mit Begründung', () => {
  const a = E.healthAge(model);
  assert.ok(a && a.items.length >= 5);
  assert.ok(Math.abs(a.pulsAge - a.age) <= 15);
  assert.equal(Math.round((a.age + a.items.reduce((t, x) => t + x.years, 0)) * 10) / 10, a.pulsAge);
  assert.equal(E.healthAge({ ...model, settings: { ...model.settings, birthYear: null } }), null);
});

test('Stress-Zusammenfassung und Tagesverlauf aus den Daten', () => {
  const s = E.stressSummary(model.days[last - 1]);
  assert.ok(s.minutes && s.series.length > 50 && s.battery.length > 50);
  assert.equal(E.stressSummary(model.days[0]).series, null);
});

test('Coach-Kontext enthält alle wichtigen Abschnitte und bleibt kompakt', () => {
  const ctx = E.coachContext(model, store.journal);
  for (const s of ['## Heute', 'Recovery', 'Ziel-Strain', 'Pulszonen', '## Woche', '## Letzte 14 Tage', '30-Tage-Schnitt']) assert.ok(ctx.includes(s), s);
  assert.ok(ctx.length < 12000, `zu lang: ${ctx.length}`);
  const dd = E.dayDetails(model, model.days[last - 1].date, store.journal);
  assert.ok(dd.sleep && dd.components.length);
  assert.ok(E.dayDetails(model, '1999-01-01').error);
  assert.equal(E.daysTable(model, model.days[last - 6].date, model.days[last].date).length, 7);
});

test('Walking-Pad: Schritte werden ohne Doppelzählung addiert', () => {
  const d = model.days.find((x) => x.pad);
  assert.ok(d, 'Demo hat Walking-Pad-Tage');
  const raw = store.days[d.date];
  assert.equal(d.stats.steps, raw.stats.steps + raw.pad.add);
  assert.equal(d.stats.watchSteps, raw.stats.steps);
  assert.equal(d.stats.padSteps, raw.pad.add);
  assert.equal(d.pad.total, raw.pad.total);
  const det = E.dayDetails(model, d.date);
  assert.match(det.walkingPad.sessions[0], /^14:00–14:45: \d+ Schritte$/);
  assert.match(E.coachContext({ ...model, days: [...model.days.slice(0, d.i + 1)] }, {}), /vom Walking-Pad/);
  // Uhr hat alles gezählt: Schritte bleiben wie gemessen
  const copy = structuredClone(store);
  copy.days[d.date].pad.add = 0;
  const m = E.analyze(copy, {});
  assert.equal(m.days[d.i].stats.steps, raw.stats.steps);
  assert.ok(m.days[d.i].pad);
  // nur Walking-Pad, keine Uhr-Daten an dem Tag
  const only = E.analyze({ days: { '2026-11-09': { pad: { samples: [[0, 60, 500]], total: 500 } } } }, {});
  assert.equal(only.days[0].stats.steps, 500);
});

test('Ernährung: Ziele folgen Gewicht, Ziel und Belastung', () => {
  assert.deepEqual(E.nutritionPlan(model, last, {}), { missing: 'weight' });
  const base = E.nutritionPlan(model, last, { weight: 80, height: 180 });
  assert.ok(base.kcal > 1800 && base.kcal < 4500, base.kcal);
  assert.equal(base.protein, 110); // 1,4 g/kg
  assert.ok(Math.abs(base.protein * 4 + base.carbs * 4 + base.fat * 9 - base.kcal) <= 50);
  assert.ok(base.fat >= 0.8 * 80 - 5);
  const cut = E.nutritionPlan(model, last, { weight: 80, height: 180, goal: 'abnehmen' });
  const bulk = E.nutritionPlan(model, last, { weight: 80, height: 180, goal: 'muskeln' });
  assert.ok(cut.kcal < base.kcal && base.kcal < bulk.kcal);
  assert.equal(cut.protein, 160);
  assert.ok(cut.kcal >= cut.bmr * 1.1 - 50, 'nie unter Grundumsatz');
  // Bezugsgewicht bei Übergewicht
  assert.ok(E.nutritionPlan(model, last, { weight: 130, height: 175, goal: 'abnehmen' }).refKg < 80);
  // harter Tag braucht mehr Kohlenhydrate als Ruhetag
  const idx = model.days.map((d, k) => k).filter((k) => k > 40 && model.days[k].strain != null);
  const hard = idx.reduce((a, b) => (model.days[b].strain > model.days[a].strain ? b : a));
  const easy = idx.reduce((a, b) => (model.days[b].strain < model.days[a].strain ? b : a));
  const h = E.nutritionPlan(model, hard, { weight: 80 }, {}, { partial: false });
  const e = E.nutritionPlan(model, easy, { weight: 80 }, {}, { partial: false });
  assert.ok(h.carbs > e.carbs, `${h.carbs} > ${e.carbs}`);
  // Garmin-Gewicht als Ersatz
  assert.ok(!E.nutritionPlan({ ...model, profile: { weight: 75 } }, last, {}).missing);
  assert.match(base.caffeineCut, /^\d\d:\d\d$/);
});

test('Gesundheits-Check: Trends gegen die eigene Basis, Erkältung fällt auf', () => {
  const ok = E.healthTrends(model, last);
  assert.ok(ok.ready);
  for (const key of ['rhr', 'hrv', 'resp', 'sleep']) assert.ok(ok.items.find((x) => x.key === key), key);
  const cold = E.healthTrends(model, last - 34);
  assert.ok(cold.flags.length >= 1, JSON.stringify(cold.flags));
  assert.notEqual(cold.verdict, 'gut');
  // stark erhöhter Ruhepuls über eine Woche → Arzt
  const copy = structuredClone(store);
  const keys = Object.keys(copy.days).sort().slice(-7);
  for (const k of keys) {
    if (copy.days[k].sleep) copy.days[k].sleep.rhr = (copy.days[k].sleep.rhr || 52) + 12;
    if (copy.days[k].stats) copy.days[k].stats.rhr = (copy.days[k].stats.rhr || 52) + 12;
    if (copy.days[k].hr) copy.days[k].hr.rhr = (copy.days[k].hr.rhr || 52) + 12;
  }
  const sick = E.healthTrends(E.analyze(copy, {}));
  assert.equal(sick.verdict, 'arzt');
  assert.equal(sick.flags[0].key, 'rhr');
  // wenige Tage: noch keine Basis
  const small = { ...store, days: Object.fromEntries(Object.keys(store.days).sort().slice(-10).map((k) => [k, store.days[k]])) };
  assert.equal(E.healthTrends(E.analyze(small, {})).ready, false);
});

test('Coach-Kontext enthält Profil, Ernährung und Gesundheits-Check', () => {
  const ctx = E.coachContext(model, store.journal, last, { weight: 80, height: 180, goal: 'muskeln', health: 'Betablocker' });
  for (const s of ['Ziel: Muskeln aufbauen', '## Gesundheits-Check', '## Ernährung heute', '<nutzerangaben>', 'Betablocker']) assert.ok(ctx.includes(s), s);
  assert.ok(ctx.length < 12000);
  assert.match(E.coachContext(model, store.journal), /Gewicht fehlt/);
});

test('Neue Funktionen: Tempo des Alterns, Monatsbericht, Rückblick, Ziele, Stress, Gewohnheiten', () => {
  const pace = E.paceOfAging(model);
  assert.ok(pace && pace.pace >= -1 && pace.pace <= 3, JSON.stringify(pace));
  const keys = E.healthAge(model).items.map((x) => x.key);
  for (const k of ['z13', 'z45', 'strength']) assert.ok(keys.includes(k), k);
  const mon = E.monthlyAssessment(model);
  assert.ok(['Aufwärtstrend', 'Abwärtstrend', 'Stabil'].includes(mon.verdict.label));
  assert.equal(mon.current.n, 30);
  const rv = E.dayReview(model, last);
  assert.match(rv.title, /^Strain \d+,\d/);
  assert.match(rv.tonight, /ins Bett um \d\d:\d\d/);
  const g = E.weekGoals(model, last, { train: 5 });
  assert.equal(g.train.goal, 5);
  assert.ok(g.days >= 1 && g.days <= 7);
  const sn = E.stressNow(model.days[last - 1]);
  assert.ok(sn && sn.value >= 0 && sn.value <= 100 && sn.level);
  assert.equal(E.stressDays(model, last, 7).length, 7);
  const qs = E.journalQuestions([{ id: 'c_x', label: 'Lesen' }, { id: 'boese', label: 'X' }]);
  assert.equal(qs.length, E.JOURNAL_QUESTIONS.length + 1);
  const tr = E.journalTrends(store.journal, qs, model.days[last].date);
  assert.ok(tr.answered > 10 && tr.items[0].count >= tr.items[tr.items.length - 1].count);
  const strength = model.days.flatMap((d) => d.acts).find((a) => E.isStrength(a.type));
  if (strength) assert.ok(E.muscleLoad(strength).score > 0);
  assert.equal(E.muscleLoad({ type: 'running', dur: 3600 }), null);
});
