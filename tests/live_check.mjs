// Selbsttest gegen die echte, veröffentlichte App (läuft in .github/workflows/check.yml).
// Entsperrt die App mit DATA_PASSPHRASE, klickt alle Bereiche und Tage durch und meldet Fehler.
// Ins Log kommen nur Anzahlen und Fehlermeldungen – keine Gesundheitswerte.
import { chromium } from 'playwright';

const url = process.env.SITE_URL;
const pass = process.env.DATA_PASSPHRASE;
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`Fehler: ${e.message} | ${(e.stack || '').split('\n').slice(1, 3).join(' | ').trim()}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`Konsole: ${m.text()}`);
});

await page.goto(url + `?t=${Date.now()}`, { waitUntil: 'networkidle' });
await page.waitForSelector('#pass, .rings, .lock h1', { timeout: 30000 });
if (await page.$('#pass')) {
  await page.fill('#pass', pass);
  await page.click('button[type=submit]');
}
await page.waitForTimeout(3000);
await page.evaluate(() => window.__puls?.skipOnboarding?.());
const summary = await page.evaluate(() => window.__puls?.summary());
console.log('Zusammenfassung:', JSON.stringify(summary));

if (summary?.view === 'main') {
  // Wochenleiste Tag für Tag in eine Richtung durchklicken, bis es nicht weitergeht
  const walk = async (dir) => {
    let steps = 0;
    for (; steps < 800; steps++) {
      const moved = await page.evaluate((d) => {
        const cells = [...document.querySelectorAll('.wd')];
        const on = cells.findIndex((c) => c.classList.contains('on'));
        const next = cells[on + d];
        if (!next) return false;
        next.click();
        return true;
      }, dir);
      if (!moved) break;
    }
    return steps;
  };
  for (const tab of ['heute', 'schlaf', 'recovery', 'belastung']) {
    await page.click(`#tabbar [data-tab=${tab}]`);
    const back = await walk(-1);
    const forward = await walk(1);
    console.log(`Bereich ${tab}: ${forward + 1} Tage geöffnet (${back} zurück, ${forward} vor)`);
  }
  await page.click('#tabbar [data-tab=coach]');
  console.log('Coach: ' + ((await page.$('#askbox')) ? 'Chat bereit' : 'noch nicht aktiviert'));
  await page.click('#tabbar [data-tab=recovery]');
  await page.click('[data-tab=trends] >> nth=0');
  await page.click('[data-act=back]');
  await page.click('[data-act=settings]');
  await page.click('[data-act=back]');
  await page.click('#tabbar [data-tab=heute]');
  const cta = await page.$('[data-act=journal]');
  if (cta) {
    await cta.click();
    await page.click('.backdrop', { position: { x: 20, y: 20 } });
  }
  for (const key of ['recovery', 'strain', 'sleep']) {
    const b = await page.$(`[data-info=${key}]`);
    if (b) {
      await b.click();
      await page.click('.backdrop', { position: { x: 20, y: 20 } });
    }
  }
} else {
  errors.push(`App zeigt keine Daten (Ansicht: ${summary?.view})`);
}

await browser.close();

// Trainingskalender unter dem geheimen Link: erreichbar? Nur Anzahlen ins Log.
{
  const { createHmac } = await import('node:crypto');
  const token = createHmac('sha256', pass).update('puls-kalender-v1').digest('hex').slice(0, 24);
  const res = await fetch(new URL(`kal-${token}.ics`, url.endsWith('/') ? url : url + '/'), { cache: 'no-store' });
  if (!res.ok) {
    errors.push(`Trainingskalender nicht erreichbar (${res.status}).`);
  } else {
    const ics = await res.text();
    const n = (re) => (ics.match(re) || []).length;
    console.log(`Trainingskalender: ${n(/BEGIN:VEVENT/g)} Einträge (Push ${n(/SUMMARY:Push/g)}, Pull ${n(/SUMMARY:Pull/g)}, Gym ohne Split ${n(/SUMMARY:Gym/g)}, Cardio ${n(/SUMMARY:Cardio/g)}).`);
    if (!ics.startsWith('BEGIN:VCALENDAR')) errors.push('Trainingskalender: Datei ist kein Kalender.');
  }
}

if (errors.length) {
  console.log(`\n${errors.length} Problem(e):`);
  for (const e of [...new Set(errors)]) console.log(' - ' + e);
  process.exit(1);
}
console.log('\nAlles in Ordnung: keine Fehler.');
