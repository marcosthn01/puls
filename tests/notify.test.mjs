// Tests für die Benachrichtigungs-Logik (ohne Versand)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';
import { dueMessages, localNow, seal, unseal } from '../sync/notify.mjs';

const store = makeDemoStore({ now: new Date('2026-11-09T07:30:00') });
const model = E.analyze(store, {});
const today = model.days[model.days.length - 1].date;

test('Morgens kommt die Recovery-Nachricht genau einmal', () => {
  const msgs = dueMessages(model, { date: today, minutes: 7 * 60 + 30 }, {});
  const m = msgs.find((x) => x.kind === 'morning');
  assert.ok(m && /Recovery \d+ %/.test(m.title));
  assert.equal(dueMessages(model, { date: today, minutes: 7 * 60 + 30 }, { morning: today }).filter((x) => x.kind === 'morning').length, 0);
  assert.equal(dueMessages(model, { date: today, minutes: 15 * 60 }, {}).filter((x) => x.kind === 'morning').length, 0);
  assert.deepEqual(dueMessages(model, { date: E.addDays(today, 1), minutes: 8 * 60 }, {}), []);
});

test('Abends kommt die Schlaf-Erinnerung kurz vor der Schlafenszeit', () => {
  const bed = E.bedtimePlan(model, model.days.length - 1).options[0].bed;
  const before = 1440 + bed - 30;
  const msgs = dueMessages(model, { date: today, minutes: before }, { morning: today });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, 'bedtime');
  assert.match(msgs[0].body, /ins Bett um \d\d:\d\d/);
  assert.equal(dueMessages(model, { date: today, minutes: before - 120 }, { morning: today }).length, 0);
});

test('Zustand wird verschlüsselt und wieder gelesen', async () => {
  const box = await seal({ a: 1, sub: { endpoint: 'https://x' } }, 'test-passwort-123', 1000);
  assert.ok(!JSON.stringify(box).includes('https://x'));
  assert.deepEqual(await unseal(box, 'test-passwort-123'), { a: 1, sub: { endpoint: 'https://x' } });
  await assert.rejects(unseal(box, 'falsch-falsch'));
});

test('Lokale Zeit in Berlin', () => {
  const t = localNow(new Date('2026-11-09T21:15:00Z'), 'Europe/Berlin');
  assert.deepEqual(t, { date: '2026-11-09', minutes: 22 * 60 + 15 });
});
