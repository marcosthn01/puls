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
const summary = await page.evaluate(() => window.__puls?.summary());
console.log('Zusammenfassung:', JSON.stringify(summary));

if (summary?.view === 'main') {
  const tabs = ['heute', 'schlaf', 'recovery', 'belastung'];
  for (const tab of tabs) {
    await page.click(`#tabbar [data-tab=${tab}]`);
    let steps = 0;
    for (;;) {
      const moved = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.wd')];
        const on = cells.findIndex((c) => c.classList.contains('on'));
        if (on > 0) {
          cells[on - 1].click();
          return true;
        }
        return false;
      });
      if (!moved) break;
      steps++;
      if (steps > 800) break;
    }
    await page.evaluate(() => [...document.querySelectorAll('.wd')].pop()?.click());
    console.log(`Bereich ${tab}: ${steps + 1} Tage geöffnet`);
  }
  for (const tab of ['trends']) await page.click(`#tabbar [data-tab=${tab}]`);
  await page.click('[data-act=settings]');
  await page.click('[data-act=back]');
  await page.click('#tabbar [data-tab=heute]');
  const cta = await page.$('[data-act=journal]');
  if (cta) {
    await cta.click();
    await page.click('[data-act=sheet-close]');
  }
} else {
  errors.push(`App zeigt keine Daten (Ansicht: ${summary?.view})`);
}

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} Problem(e):`);
  for (const e of [...new Set(errors)]) console.log(' - ' + e);
  process.exit(1);
}
console.log('\nAlles in Ordnung: keine Fehler.');
