import test from 'node:test';
import assert from 'node:assert/strict';
import { callouts, ecgShape, hudDeco, tickPath } from '../app/hud.js';

test('EKG-Form: R-Zacke ist der höchste Punkt, Grundlinie flach', () => {
  const pts = Array.from({ length: 1000 }, (_, k) => ecgShape(k / 1000));
  const max = Math.max(...pts);
  const at = pts.indexOf(max) / 1000;
  assert.ok(max > 0.9 && max < 1.1);
  assert.ok(at > 0.3 && at < 0.33);
  assert.ok(Math.abs(ecgShape(0.9)) < 0.01);
  assert.ok(Math.min(...pts) > -0.4);
});

test('Skala: 72 Striche minus 8 Lücken', () => {
  assert.equal((tickPath().match(/M/g) || []).length, 64);
});

test('Ring-Ebenen tragen die Farbe und schließen sauber', () => {
  const html = hudDeco('#1ee08e');
  assert.match(html, /^<div class="hx" aria-hidden="true" style="--hx:#1ee08e">/);
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);
  assert.equal((html.match(/<svg/g) || []).length, 3);
});

test('Messwerte: leere Werte fallen weg, zwei links, zwei rechts, Text wird maskiert', () => {
  const { left, right } = callouts([
    { k: 'HRV', v: 47, u: 'ms' },
    { k: 'Leer', v: null },
    { k: 'Ruhepuls', v: 53, u: 'bpm' },
    { k: '<b>', v: '1&2' },
    { k: 'Null', v: 0 },
  ]);
  assert.equal((left.match(/class="co"/g) || []).length, 2);
  assert.equal((right.match(/class="co"/g) || []).length, 2);
  assert.ok(!left.includes('Leer'));
  assert.ok(right.includes('&lt;b&gt;') && right.includes('1&amp;2'));
  assert.ok(right.includes('<b>0</b>'));
});
