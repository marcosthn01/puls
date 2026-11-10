import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { makeDemoStore } from '../app/demo.js';
import * as E from '../app/engine.js';
import { hmacSha256, openWidgetBox, sha256, widgetScript } from '../app/widget.js';
import { sealWidget, widgetFileName, widgetPayload } from '../sync/notify.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
const enc = (s) => new TextEncoder().encode(s);
const PASS = 'mein-geheimes-passwort';

test('SHA-256 und HMAC im Widget stimmen mit Node überein', () => {
  assert.equal(hex(sha256(enc('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const long = 'x'.repeat(1000);
  assert.equal(hex(sha256(enc(long))), crypto.createHash('sha256').update(long).digest('hex'));
  assert.equal(hex(hmacSha256(enc(PASS), enc('puls-widget-key-v1'))), crypto.createHmac('sha256', PASS).update('puls-widget-key-v1').digest('hex'));
});

test('Widget entschlüsselt, was der Abruf verschlüsselt – und erkennt Manipulation', () => {
  const data = { recovery: 64, zone: 'yellow', plan: { title: 'Gym · Pull', sub: '−20 % Volumen', short: 'Gym Pull' }, note: 'Ümlaute ✓'.repeat(20) };
  const box = sealWidget(data, PASS);
  const keyHex = crypto.createHmac('sha256', PASS).update('puls-widget-key-v1').digest('hex');
  assert.deepEqual(openWidgetBox(box, keyHex), data);
  const bad = { ...box, ct: Buffer.from(Buffer.from(box.ct, 'base64').map((b, i) => (i === 3 ? b ^ 1 : b))).toString('base64') };
  assert.throws(() => openWidgetBox(bad, keyHex), /passen nicht/);
  assert.throws(() => openWidgetBox(box, '00'.repeat(32)), /passen nicht/);
  assert.match(widgetFileName(PASS), /^w-[0-9a-f]{24}\.json$/);
});

test('Widget-Inhalt: Recovery, Schlaf, Strain, Training – ohne Rohdaten', () => {
  const store = makeDemoStore({ now: new Date('2026-11-10T08:30:00') });
  const model = E.analyze(store, {});
  const p = widgetPayload(model);
  assert.equal(p.date, model.days[model.days.length - 1].date);
  assert.ok(p.recovery >= 1 && p.recovery <= 99);
  assert.ok(['green', 'yellow', 'red'].includes(p.zone));
  assert.ok(p.plan && p.plan.title && p.plan.short);
  assert.match(p.week, /Training/);
  assert.ok(JSON.stringify(p).length < 2000);
  assert.equal(p.wk.length, 7);
  assert.ok(p.hrv > 0 && p.rhr > 0);
});

test('Scriptable-Code ist gültiges JavaScript mit Adresse und Schlüssel', () => {
  const code = widgetScript({ url: 'https://example.org/w-abc.json', keyHex: 'ab'.repeat(32), app: 'https://example.org/' });
  assert.match(code, /const KEY = "abab/);
  assert.match(code, /function openWidgetBox/);
  assert.match(code, /function render/);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(code)); // nur übersetzen, nicht ausführen
});

test('Widget läuft mit der echten Scriptable-API: alle Größen, Sperrbildschirm, Parameter, Menü', async () => {
  const { installScriptable } = await import('./scriptable-mock.mjs');
  const store = makeDemoStore({ now: new Date('2026-11-10T08:30:00') });
  const payload = widgetPayload(E.analyze(store, {}));
  payload.ill = { level: 2, label: 'erhöht' };
  const box = sealWidget(payload, PASS);
  const keyHex = crypto.createHmac('sha256', PASS).update('puls-widget-key-v1').digest('hex');
  const code = widgetScript({ url: 'https://example.org/puls/w-x.json', keyHex, app: 'https://example.org/puls/' });
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = async (opts) => {
    const log = installScriptable({ fetchJSON: async () => JSON.parse(JSON.stringify(box)), ...opts });
    await new AsyncFunction(code)();
    return log;
  };
  const cases = [
    ['large', null, false], ['medium', null, false], ['small', null, false],
    ['accessoryCircular', null, true], ['accessoryCircular', 'schlaf', true], ['accessoryCircular', 'Strain', true],
    ['accessoryRectangular', null, true], ['accessoryRectangular', 'training', true], ['accessoryInline', null, true],
  ];
  for (const [family, parameter, accessory] of cases) {
    const log = await run({ family, parameter, accessory });
    assert.ok(log.widget, `${family}: kein Widget`);
    assert.ok(!log.texts.some((t) => t.startsWith('Puls:')), `${family}: Fehler-Widget ${log.texts.join(' | ')}`);
    assert.ok(log.texts.length + log.images > 0, family);
  }
  const large = await run({ family: 'large' });
  assert.ok(large.texts.includes('SCHLAF') && large.texts.includes('RECOVERY') && large.texts.includes('STRAIN'));
  assert.ok(large.texts.some((t) => /Infekt-Frühwarnung/.test(t)));
  assert.ok(large.texts.includes('HRV') && large.texts.includes('RUHEPULS'));
  // Ohne Test: Tippen startet das Script; keine Lifestyle-Knöpfe
  assert.ok(large.urls.every((u) => u.startsWith('scriptable:///run/Puls')));
  assert.ok(!large.urls.some((u) => /log=/.test(u)));

  // Im Scriptable-App: Menü → „direkt öffnen testen“ → Test 1 „Los“ → „Ja“ → gespeichert; dann „Fertig“
  const app = await run({ runsInWidget: false, alerts: [0, 0, 0, 0, -1] });
  assert.equal(app.opened[0], 'webapp://example.org/puls/');
  const saved = JSON.parse(app.files['/docs/puls-widget-settings.json']);
  assert.deepEqual(saved, { open: 'webapp', variant: 'a' });

  // Danach (gleiche Dateien): Tippen öffnet Puls direkt, Ringe springen in Bereiche, Lifestyle-Knöpfe sind da
  const log2 = installScriptable({ fetchJSON: async () => JSON.parse(JSON.stringify(box)), family: 'large' });
  Object.assign(log2.files, app.files);
  await new AsyncFunction(code)();
  assert.ok(log2.urls.includes('webapp://example.org/puls/?tab=schlaf'));
  assert.ok(log2.urls.includes('webapp://example.org/puls/?log=koffein'));
  assert.ok(log2.urls.includes('webapp://example.org/puls/?open=laufband'));

  // Beide Tests „Nein“: Script merkt sich, dass es nicht geht
  const no = await run({ runsInWidget: false, alerts: [0, 0, 1, 0, 1, 0, -1] });
  assert.deepEqual(no.opened, ['webapp://example.org/puls/', 'webapp://https://example.org/puls/']);
  assert.equal(JSON.parse(no.files['/docs/puls-widget-settings.json']).open, 'run');

  // Vorschau groß aus dem Menü
  const prev = await run({ runsInWidget: false, alerts: [1, -1] });
  assert.deepEqual(prev.presented, ['large']);

  // Alte Widget-Datei (v1, ohne neue Felder) zeigt trotzdem etwas
  const old = { v: 1, date: payload.date, recovery: 70, zone: 'green', sleep: 80, strain: 9.5, plan: { title: 'Gym · Push', sub: 'volles Volumen', short: 'Gym Push' }, ill: { level: 0, label: '' }, week: '2 Trainings' };
  const oldBox = sealWidget(old, PASS);
  for (const family of ['large', 'medium', 'small']) {
    const l = installScriptable({ fetchJSON: async () => JSON.parse(JSON.stringify(oldBox)), family });
    await new AsyncFunction(code)();
    assert.ok(!l.texts.some((t) => t.startsWith('Puls:')), `alt ${family}`);
  }
});
