// Tests für den Essens-Tracker (ohne Netzwerk)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Food from '../app/food.js';

globalThis.localStorage = {
  m: new Map(),
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  },
  setItem(k, v) {
    this.m.set(k, String(v));
  },
  removeItem(k) {
    this.m.delete(k);
  },
};

const item = (o) => ({ name: 'X', menge: '1', gramm: 100, kcal: 100, eiweiss: 0, kohlenhydrate: 0, zucker: 0, ballaststoffe: 0, fett: 0, gesaettigte_fette: 0, salz: 0, alkohol: 0, koffein_mg: 0, obst_gemuese_gramm: 0, getraenk_ml: 0, verarbeitung: 'frisch', ...o });
const analysis = (titel, list, extra = {}) => ({ titel, mahlzeit: 'mittagessen', lebensmittel: list, mikro: { vitamin_c_mg: 20, vitamin_d_ug: 1, vitamin_b12_ug: 1, folat_ug: 60, eisen_mg: 2, zink_mg: 2, magnesium_mg: 80, calcium_mg: 200, kalium_mg: 600, omega3_g: 0.1 }, sicherheit: 'hoch', rueckfrage: '', fazit: 'ok', tipp: 'weiter so', ...extra });
const plan = { kcal: 2600, protein: 140, carbs: 300, fat: 85, fiber: 30, water: 2.8, perMeal: 30, lastMeal: '19:30', caffeineCut: '14:30', goal: 'gesund' };

test('Analyse von Claude wird sauber übernommen (Grenzen, Art, Werte)', () => {
  const m = Food.mealFromAnalysis(
    analysis('Pasta', [item({ name: 'Spaghetti', gramm: 250, kcal: 390, eiweiss: 13, kohlenhydrate: 78, fett: 2, verarbeitung: 'quatsch' }), item({ name: 'Soße', kcal: -50, eiweiss: 'viel' })], { mahlzeit: 'brunch' }),
    { date: '2026-11-22', time: '13:10' },
  );
  assert.equal(m.title, 'Pasta');
  assert.equal(m.type, 'mittagessen'); // unbekannte Art → nach Uhrzeit
  assert.equal(m.items[0].proc, 'verarbeitet');
  assert.equal(m.items[1].kcal, 0); // negative/ungültige Werte → 0
  assert.equal(m.items[1].p, 0);
  assert.ok(m.id.startsWith('m'));
  assert.equal(Food.guessType('07:30'), 'fruehstueck');
  assert.equal(Food.guessType('19:00'), 'abendessen');
});

test('Menge ändern skaliert alle Nährwerte, Entfernen rechnet Mikros anteilig', () => {
  const m = Food.mealFromAnalysis(analysis('Bowl', [item({ name: 'Reis', gramm: 200, kcal: 260, kohlenhydrate: 57, eiweiss: 5 }), item({ name: 'Hähnchen', gramm: 150, kcal: 165, eiweiss: 35 })]), { date: '2026-11-22', time: '12:00' });
  const half = Food.scaleItem(m, 0, 100);
  assert.equal(half.items[0].g, 100);
  assert.equal(half.items[0].kcal, 130);
  assert.equal(half.items[0].c, 28.5);
  assert.equal(half.items[1].kcal, 165);
  assert.ok(half.micro.vitc < m.micro.vitc && half.micro.vitc > 0);
  const one = Food.removeItem(m, 0);
  assert.equal(one.items.length, 1);
  assert.equal(Food.mealTotals(one).kcal, 165);
});

test('Tagesbilanz: Ziele, Eiweiß, Timing, Zucker, Alkohol und Score', () => {
  const d = '2026-11-21';
  const meals = [
    Food.mealFromAnalysis(analysis('Frühstück', [item({ kcal: 500, eiweiss: 20, kohlenhydrate: 70, fett: 12, ballaststoffe: 6, zucker: 30 })], { mahlzeit: 'fruehstueck' }), { date: d, time: '07:30' }),
    Food.mealFromAnalysis(analysis('Mittag', [item({ kcal: 800, eiweiss: 35, kohlenhydrate: 90, fett: 30, ballaststoffe: 5, zucker: 10, salz: 4 })]), { date: d, time: '12:30' }),
    Food.mealFromAnalysis(analysis('Kaffee', [item({ kcal: 5, koffein_mg: 90, getraenk_ml: 250 })], { mahlzeit: 'getraenk' }), { date: d, time: '16:00' }),
    Food.mealFromAnalysis(analysis('Pizza & Bier', [item({ kcal: 1100, eiweiss: 40, kohlenhydrate: 120, fett: 45, zucker: 40, salz: 4, alkohol: 20, verarbeitung: 'hochverarbeitet' })], { mahlzeit: 'abendessen' }), { date: d, time: '21:15' }),
  ];
  const r = Food.dayReview(meals, { plan, sex: 'male', isToday: false });
  assert.equal(r.done, true);
  const keys = r.items.map((x) => `${x.tone}:${x.key}`);
  assert.ok(keys.includes('warn:protein'), keys.join());
  assert.ok(keys.includes('warn:late'));
  assert.ok(keys.includes('warn:caffeine'));
  assert.ok(keys.includes('warn:alcohol'));
  assert.ok(keys.includes('warn:salt'));
  assert.ok(keys.includes('warn:sugar'));
  assert.ok(keys.includes('warn:fiber'));
  assert.ok(r.score < 60, String(r.score));
  assert.equal(r.micro.length, 10);
  // tagsüber: noch kein Score, nur „offen“
  const live = Food.dayReview(meals.slice(0, 1), { plan, sex: 'male', isToday: true, nowMin: 9 * 60 });
  assert.equal(live.score, null);
  assert.ok(live.items.some((x) => x.key === 'kcal' && x.tone === 'info'));
  // guter Tag
  const good = [
    Food.mealFromAnalysis(analysis('A', [item({ kcal: 700, eiweiss: 45, kohlenhydrate: 80, fett: 20, ballaststoffe: 12, obst_gemuese_gramm: 200 })], { mahlzeit: 'fruehstueck' }), { date: d, time: '08:00' }),
    Food.mealFromAnalysis(analysis('B', [item({ kcal: 900, eiweiss: 50, kohlenhydrate: 110, fett: 28, ballaststoffe: 12, obst_gemuese_gramm: 150 })]), { date: d, time: '12:30' }),
    Food.mealFromAnalysis(analysis('C', [item({ kcal: 950, eiweiss: 45, kohlenhydrate: 100, fett: 35, ballaststoffe: 10, obst_gemuese_gramm: 150 })], { mahlzeit: 'abendessen' }), { date: d, time: '18:30' }),
  ];
  const g = Food.dayReview(good, { plan, sex: 'male', isToday: false });
  assert.ok(g.score >= 90, String(g.score));
  assert.ok(g.items.some((x) => x.key === 'protein-dist' && x.tone === 'good'));
});

test('Woche und Zusammenhänge erst mit genug Tagen', () => {
  const food = [];
  const days = [];
  const start = new Date('2026-09-01T12:00:00Z');
  for (let k = 0; k < 40; k++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + k);
    const date = d.toISOString().slice(0, 10);
    const late = k % 2 === 0;
    const afterLate = k % 2 === 1; // die Nacht nach einem späten Abendessen zählt für den nächsten Morgen
    days.push({ date, recovery: afterLate ? 50 : 70, hrv: afterLate ? 45 : 55, perf: 80 });
    food.push(Food.mealFromAnalysis(analysis('Mittag', [item({ kcal: 900, eiweiss: 40 })]), { date, time: '12:30' }));
    food.push(Food.mealFromAnalysis(analysis('Abend', [item({ kcal: 900, eiweiss: 40 })], { mahlzeit: 'abendessen' }), { date, time: late ? '22:00' : '18:00' }));
  }
  const fx = Food.foodEffects(food, days, () => plan);
  const late = fx.factors.find((x) => x.key === 'late');
  assert.equal(late.ready, true);
  assert.equal(late.rec, -20);
  assert.equal(late.hrv, -18);
  assert.equal(fx.factors.find((x) => x.key === 'alcohol').ready, false); // nie Alkohol → keine Gruppe
  // mit wenigen Tagen: nichts zeigen
  const few = Food.foodEffects(food.slice(0, 10), days, () => plan);
  assert.ok(few.factors.every((x) => !x.ready));
  const w = Food.weekStats(food, '2026-10-10', () => plan);
  assert.equal(w.logged, 7);
  assert.equal(w.kcal, 1800);
  assert.equal(w.proteinDays, 0);
  const block = Food.foodBlock(food, '2026-10-10', plan, { sex: 'male' });
  assert.match(block, /Ernährungstagebuch/);
  assert.match(block, /Heute bisher: 1800 kcal von 2600/);
});

test('Schema für Claude ist strikt (strukturierte Ausgabe) und die Anfrage enthält Foto und Person', async () => {
  const Coach = await import('../app/coach.js');
  const check = (node, path = 'root') => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) check(v, `${path}.${k}`);
    }
    if (node.type === 'array') check(node.items, `${path}[]`);
  };
  check(Coach.FOOD_SCHEMA);
  // Antwort im Schema-Format → passt zu mealFromAnalysis
  const keys = Object.keys(Coach.FOOD_SCHEMA.properties.lebensmittel.items.properties);
  for (const k of ['gramm', 'kcal', 'eiweiss', 'getraenk_ml', 'verarbeitung']) assert.ok(keys.includes(k));

  // Anfrage abfangen (kein Netz): Bild als Base64-JPEG, Schema, System-Prompt gecacht
  Coach.saveCoachConfig({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });
  let body = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'test' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(Coach.analyzeMeal({ images: ['QUJD'], time: '12:30', about: 'Ziel: Muskeln' }));
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.match(body.messages[0].content.at(-1).text, /Ziel: Muskeln/);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
});
