// Tests für die Coach-Werkzeuge (ohne Netzwerk)
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.localStorage = {
  m: new Map(),
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; },
  setItem(k, v) { this.m.set(k, String(v)); },
  removeItem(k) { this.m.delete(k); },
};

const { makeDemoStore } = await import('../app/demo.js');
const E = await import('../app/engine.js');
const Coach = await import('../app/coach.js');

const store = makeDemoStore({ now: new Date('2026-11-09T19:00:00') });
let model = E.analyze(store, {});
const saved = { journal: {}, settings: {} };
const app = {
  model: () => model,
  journal: () => saved.journal,
  saveJournal: (d, a) => (saved.journal[d] = a),
  saveSettings: (p) => Object.assign(saved.settings, p),
  changed: () => {},
};

test('Werkzeuge liefern Daten und prüfen Eingaben', () => {
  const days = Coach.runTool('get_days', { from: '2026-11-01', to: '2026-11-07' }, app);
  assert.equal(days.days.length, 7);
  assert.ok(Coach.runTool('get_days', { from: 'gestern', to: 'heute' }, app).error);
  assert.ok(Coach.runTool('get_day_details', { date: '2026-11-08' }, app).sleep);
  assert.ok(Coach.runTool('unbekannt', {}, app).error);
});

test('Morgen-Check und Einstellungen nur mit gültigen Werten', () => {
  assert.deepEqual(Coach.runTool('save_morning_check', { date: '2026-11-08', items: ['alkohol'] }, app).saved, true);
  assert.deepEqual(saved.journal['2026-11-08'], { _done: true, alkohol: true });
  assert.ok(Coach.runTool('save_morning_check', { date: '2026-11-08', items: ['bier'] }, app).error);
  assert.equal(Coach.runTool('update_settings', { wake_time: '06:30', sleep_need_hours: 8.5 }, app).saved, true);
  assert.deepEqual(saved.settings, { wakeTime: '06:30', sleepNeed: 510 });
  assert.ok(Coach.runTool('update_settings', { max_hr: 300 }, app).error);
});

test('Werkzeug-Definitionen sind gültig', () => {
  for (const t of Coach.TOOLS) {
    assert.ok(t.name && t.description && t.input_schema.type === 'object');
    assert.equal(t.eager_input_streaming, true);
  }
});

test('Markdown-Ausgabe ist sicher', () => {
  const html = Coach.md('**Fett** <script>x</script>\n- eins\n- zwei');
  assert.ok(html.includes('<b>Fett</b>') && html.includes('&lt;script&gt;') && html.includes('<ul><li>eins</li><li>zwei</li></ul>'));
});
