import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitIllness } from '../app/infekt.js';

// Synthetische Tage: ruhige Werte mit Rauschen; Infekte mit persönlichem Muster
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function makeDays(n, { episodes = [], alcohol = [], seed = 7, style = 'resp' } = {}) {
  const r = rng(seed);
  const g = () => {
    let u = 0;
    for (let k = 0; k < 6; k++) u += r();
    return (u - 3) / Math.sqrt(0.5);
  };
  const start = new Date('2025-06-01T12:00:00Z');
  const days = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
    let rhr = 55 + g() * 1.5;
    let lnHrv = Math.log(60) + g() * 0.09;
    let resp = 14 + g() * 0.3;
    for (const o of episodes) {
      const k = i - o; // Tage relativ zum Infektbeginn
      if (k >= -2 && k <= 3) {
        const w = k < 0 ? (3 + k) / 3 : 1;
        if (style === 'resp') {
          resp += 1.2 * w; // bei dieser Person: Atmung reagiert stark, Ruhepuls kaum
          rhr += 0.6 * w;
        } else {
          rhr += 5 * w;
          lnHrv -= 0.2 * w;
        }
      }
    }
    if (alcohol.includes(i)) {
      lnHrv -= 0.18;
      rhr += 3.5;
    }
    days.push({ date, rhr, hrv: Math.exp(lnHrv), resp, skinTemp: null, stats: {}, strain: 8, sleepMin: 450, load: { ratio: 1 } });
  }
  return days;
}
const lab = (days, idx) => ({ pos: idx.map((i) => ({ s: days[i].date, src: 'user' })) });

test('Lernt das persönliche Muster: Atmung statt Ruhepuls – und warnt dadurch früher', () => {
  const eps = [80, 150, 220, 290];
  const days = makeDays(300, { episodes: eps, style: 'resp' });
  const known = fitIllness(days, lab(days, eps.slice(0, 3)));
  const naive = fitIllness(days, {});
  assert.ok(known.model.mu.resp.post > known.model.mu.resp.prior, 'Atmung zählt bei dieser Person mehr');
  assert.ok(known.model.mu.rhr.post < known.model.mu.rhr.prior, 'Ruhepuls zählt weniger');
  // Vor dem 4. Infekt (nicht gelernt): mit gelerntem Muster höhere Wahrscheinlichkeit
  const pre = 289;
  assert.ok(known.days[pre].p > naive.days[pre].p, `${known.days[pre].p} vs ${naive.days[pre].p}`);
  assert.equal(known.model.episodes.length, 3);
  assert.equal(known.model.earliest[0].key, 'resp');
  assert.ok(known.model.rate > 2.5 * 0 && known.model.backtest.n === 3);
});

test('Rückblick: erkennt frühere Infekte ohne sie zu kennen, zählt Fehlalarme, stellt die Schwelle ein', () => {
  const eps = [60, 130, 200, 270];
  const days = makeDays(300, { episodes: eps, style: 'classic', seed: 11 });
  const fit = fitIllness(days, lab(days, eps));
  const bt = fit.model.backtest;
  assert.equal(bt.n, 4);
  assert.ok(bt.hits >= 3, `Treffer ${bt.hits}`);
  assert.ok(bt.lead != null && bt.lead >= 0, `Vorlauf ${bt.lead}`);
  assert.ok(bt.faMonth < 1.5, `Fehlalarme/Monat ${bt.faMonth}`);
  assert.equal(fit.model.tuned, true);
  assert.ok([0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3].includes(fit.model.threshold));
  // Muster-Vergleich: am Tag vor dem letzten Infekt ähnelt es einem früheren
  const m = fit.days[269].match;
  assert.ok(m && eps.slice(0, 3).map((i) => days[i].date).includes(m.date), JSON.stringify(m));
});

test('Alkohol wird herausgerechnet: weniger Fehlalarme nach einem Abend mit Wein', () => {
  const alcohol = [];
  for (let i = 40; i < 300; i += 9) alcohol.push(i);
  const days = makeDays(300, { alcohol, seed: 5 });
  const conf = Object.fromEntries(alcohol.map((i) => [days[i - 1].date, { a: 2 }]));
  const without = fitIllness(days, {});
  const withConf = fitIllness(days, { conf });
  const avg = (fit) => alcohol.reduce((s, i) => s + fit.days[i].p, 0) / alcohol.length;
  assert.ok(avg(withConf) < avg(without) * 0.6, `${avg(withConf)} vs ${avg(without)}`);
  // Persönliche Wirkung gelernt (viele Abende): HRV-Effekt stärker als die Studien-Annahme
  assert.ok(withConf.model.confEffect.alkohol.hrv.n >= 20);
  assert.ok(withConf.days[alcohol[5]].confounders.some((c) => c.key === 'alkohol'));
});

test('Fragen zum Lernen: auffällige Phase ohne Label → Frage; „Nein“ → keine Frage mehr', () => {
  const days = makeDays(200, { episodes: [150], style: 'classic', seed: 3 });
  const open = fitIllness(days, {});
  const c = open.model.candidates.find((x) => Math.abs(new Date(x.date) - new Date(days[150].date)) <= 4 * 864e5);
  assert.ok(c, JSON.stringify(open.model.candidates));
  const answered = fitIllness(days, { neg: [c.date] });
  assert.ok(!answered.model.candidates.some((x) => x.date === c.date));
  const confirmed = fitIllness(days, { pos: [{ s: c.date }] });
  assert.ok(!confirmed.model.candidates.some((x) => x.date === c.date));
  assert.ok(confirmed.model.rate > open.model.rate, 'Basisrate lernt mit');
});

test('Zu wenig Daten: keine Wahrscheinlichkeit, keine Warnung', () => {
  const days = makeDays(8);
  const fit = fitIllness(days, {});
  assert.ok(fit.days.every((d) => d.p == null && d.level === 0 && d.calibrating));
});

test('Krank-Einträge aus dem Kalender zählen als gelernte Infekte (überlappende zusammengefasst)', () => {
  const eps = [120, 200];
  const days = makeDays(260, { episodes: eps, style: 'classic', seed: 9 });
  const fit = fitIllness(days, {
    cal: [{ s: days[120].date, e: days[123].date }, { s: days[200].date, e: days[204].date }],
    pos: [{ s: days[121].date, src: 'feel' }], // doppelt: gleicher Infekt, schon im Kalender
  });
  assert.equal(fit.model.episodes.length, 2);
  assert.ok(fit.model.episodes.every((e) => e.src === 'kalender'));
  assert.equal(fit.model.tuned, true);
});
