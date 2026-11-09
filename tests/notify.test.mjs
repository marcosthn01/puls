// Tests für Zeitplan-Entscheidung und Benachrichtigungen (ohne Versand)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';
import { dueMessages, localNow, planRun, seal, unseal } from '../sync/notify.mjs';

const store = makeDemoStore({ now: new Date('2026-11-09T16:30:00') });
const model = E.analyze(store, {});
const today = model.days[model.days.length - 1].date;
const at = (h, m = 0, date = today) => ({ date, minutes: h * 60 + m, weekday: E.weekday(date) });
const sub = { subscription: { endpoint: 'https://x' } };

test('Morgens kommt die Recovery-Nachricht genau einmal', () => {
  const m = dueMessages(model, at(7, 30), {}).find((x) => x.kind === 'morning');
  assert.ok(m && /Recovery \d+ %/.test(m.title) && /Ziel-Strain/.test(m.body));
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
  assert.equal(planRun({ now: at(16), state: { ...sub, sent: { afternoon: today } }, model }).sync, at(16).weekday === 0);
  const bed = E.bedtimePlan(model, model.days.length - 1).options[0].bed;
  assert.equal(planRun({ now: { ...at(0), minutes: 1440 + bed - 30 }, state: { ...sub, sent: {} }, model }).sync, true);
  assert.equal(planRun({ now: { ...at(0), minutes: 1440 + bed - 100 }, state: { ...sub, sent: {} }, model }).sync, false);
  assert.equal(planRun({ now: at(13), state: { ...sub, sent: {} }, model }).sync, false);
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
