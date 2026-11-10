import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays } from '../app/engine.js';
import * as L from '../app/lifestyle.js';

// Kleines Modell: Tage mit Recovery/HRV/Ruhepuls; das Verhalten an Tag D wirkt auf den Morgen D+1.
function makeModel(n, night) {
  const days = [];
  const index = {};
  const start = '2026-09-01';
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    index[date] = i;
    days.push({ date, recovery: 70, hrv: 60, rhr: 52, perf: 85, stages: { deep: 18 }, sleep: { bed: -60 }, ...(night ? night(i, date) : {}) });
  }
  return { days, index };
}
const jitter = (i) => ((i * 7) % 5) - 2; // −2 … +2, damit die Streuung nicht null ist

test('Schnell-Log: Kaffee am Morgen ist kein „Kaffee nach 14 Uhr“, am Abend schon', () => {
  let e = L.addLog({}, 'koffein', '08:00');
  assert.deepEqual(e._t.koffein, ['08:00']);
  assert.equal('koffein' in e, false);
  e = L.addLog(e, 'koffein', '18:05');
  assert.equal(e.koffein, true);
  e = L.removeLog(e, 'koffein', '18:05');
  assert.equal('koffein' in e, false);
  assert.equal(L.removeLog({ _done: true, _t: { koffein: ['18:05'] }, koffein: true }, 'koffein', '18:05').koffein, false);
  const a = L.addLog(L.addLog({}, 'alkohol', '21:00'), 'alkohol', '20:00');
  assert.deepEqual(a._t.alkohol, ['20:00', '21:00']);
  assert.equal(a.alkohol, true);
  assert.deepEqual(L.timesOf(a, 'alkohol'), [1200, 1260]);
});

test('Nach Mitternacht bis 4 Uhr zählt der Eintrag noch zum Vortag', () => {
  assert.equal(L.logDate(new Date('2026-11-10T02:30:00')), '2026-11-09');
  assert.equal(L.logDate(new Date('2026-11-10T07:30:00')), '2026-11-10');
});

test('Persönliche Koffein-Grenze: später Kaffee kostet Recovery', () => {
  const journal = {};
  const lastCup = {};
  for (let i = 0; i < 30; i++) lastCup[i] = i % 3 === 0 ? '18:00' : i % 3 === 1 ? '10:00' : '15:00';
  const model = makeModel(31, (i) => (i > 0 && lastCup[i - 1] === '18:00' ? { recovery: 50 + jitter(i), stages: { deep: 13 } } : { recovery: 70 + jitter(i) }));
  for (let i = 0; i < 30; i++) journal[model.days[i].date] = L.addLog({ _done: true }, 'koffein', lastCup[i]);

  const c = L.caffeineCutoff(model, journal);
  assert.equal(c.cutoff, 18); // zwischen 15 und 18 Uhr gibt es keine Daten: die weniger strenge Grenze
  assert.ok(c.drop >= 18 && c.drop <= 22, `drop ${c.drop}`);
  assert.equal(c.nLate, 10);

  const ins = L.lifestyleInsights(model, journal);
  const k = ins.items.find((x) => x.id === 'koffein');
  assert.ok(k && !k.pending && k.diff < -7 && k.solid, JSON.stringify(k?.diff)); // „nach 14 Uhr“ enthält auch die 15-Uhr-Tassen

  const late = L.adviceFor('koffein', 18 * 60 + 5, ins, { bedMin: 23 * 60 });
  assert.match(late[0], /noch etwa 5\d % davon aktiv/);
  assert.match(late[1], /nach 18 Uhr im Schnitt \d+ % Recovery/);
  assert.match(L.adviceFor('koffein', 9 * 60, ins, { bedMin: 23 * 60 }).join(' '), /vor deiner persönlichen Grenze von 18 Uhr/);
  assert.match(L.lifestyleBlock(model, journal), /Persönliche Koffein-Grenze: nach 18 Uhr/);
});

test('Alkohol nach Menge und spätes Essen', () => {
  const drinks = (i) => (i % 4 === 0 ? 2 : i % 4 === 1 ? 1 : 0);
  const model = makeModel(41, (i) => {
    const d = i > 0 ? drinks(i - 1) : 0;
    return { recovery: 72 - 6 * d * d + jitter(i), hrv: 62 - 5 * d + jitter(i) };
  });
  const journal = {};
  for (let i = 0; i < 40; i++) {
    let e = { _done: true };
    for (let k = 0; k < drinks(i); k++) e = L.addLog(e, 'alkohol', `2${k}:00`);
    journal[model.days[i].date] = e;
  }
  const a = L.alcoholDose(model, journal);
  const [one, two] = a.groups;
  assert.equal(a.none, 20);
  assert.ok(one.recovery <= -4 && one.recovery >= -8, `1 Glas ${one.recovery}`);
  assert.ok(two.recovery <= -20, `2 Gläser ${two.recovery}`);
  assert.ok(two.hrv <= -8);
  assert.match(L.adviceFor('alkohol', 22 * 60, L.lifestyleInsights(model, journal), { bedMin: 23 * 60 }).join(' '), /ab 2 Gläsern −\d+ %.*Weniger als 3 Std\./);

  // Spätes Essen: Schlafbeginn 23:00 (bed −60 Min. relativ zum Aufwachtag)
  const meal = makeModel(21, (i) => (i > 0 && (i - 1) % 2 === 0 ? { recovery: 62 + jitter(i), rhr: 56 } : { recovery: 70 + jitter(i), rhr: 52 }));
  const mj = {};
  for (let i = 0; i < 20; i++) mj[meal.days[i].date] = L.addLog({ _done: true }, 'spaetessen', i % 2 === 0 ? '21:30' : '18:30');
  const m = L.lateMeal(meal, mj);
  assert.equal(m.n, 10);
  assert.ok(m.recovery <= -6 && m.rhr >= 3, JSON.stringify(m));
});

test('Zu wenige Nächte: keine Behauptung, nur „lernt noch“', () => {
  const model = makeModel(5);
  const journal = { [model.days[0].date]: L.addLog({}, 'koffein', '19:00') };
  const ins = L.lifestyleInsights(model, journal);
  assert.equal(ins.caffeine.cutoff, null);
  assert.ok(ins.items.every((x) => x.pending));
  assert.match(L.adviceFor('koffein', 19 * 60, ins, { bedMin: 23 * 60 }).join(' '), /Faustregel/);
});
