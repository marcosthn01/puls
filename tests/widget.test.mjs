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
  assert.ok(JSON.stringify(p).length < 800);
});

test('Scriptable-Code ist gültiges JavaScript mit Adresse und Schlüssel', () => {
  const code = widgetScript({ url: 'https://example.org/w-abc.json', keyHex: 'ab'.repeat(32), app: 'https://example.org/' });
  assert.match(code, /const KEY = "abab/);
  assert.match(code, /function openWidgetBox/);
  assert.match(code, /function render/);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(code)); // nur übersetzen, nicht ausführen
});
