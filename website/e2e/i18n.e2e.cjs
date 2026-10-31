// E2E: jazykové verze — přepínač EN/DE/CZ, přesměrování zrušené poptávky, kontakt na V. Volného, mobil bez přetékání.
// Spuštění (server :3100): node e2e/i18n.e2e.cjs <složka se shots/>
const { chromium } = require('playwright');
const S = process.argv[2];
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  // přepínač jazyků
  await page.goto('http://localhost:3100/en/services/wire-edm', { waitUntil: 'networkidle' });
  await page.locator('a[hreflang="de"]').first().click();
  await page.waitForURL(/\/de\/leistungen\/drahterodieren/);
  ok(true, 'EN → DE přepínač: ' + page.url());
  await page.locator('a[hreflang="cs-CZ"]').first().click();
  await page.waitForURL(/\/sluzby\/elektroerozivni-obrabeni/);
  ok(true, 'DE → CZ přepínač: ' + page.url());
  ok(await page.evaluate(() => document.documentElement.lang) === 'cs', 'html lang cs');
  // poptávkový formulář je zrušen → přesměrování na kontakt, CTA = e-mail V. Volnému
  await page.goto('http://localhost:3100/en/request-a-quote', { waitUntil: 'networkidle' });
  ok(/\/en\/contact/.test(page.url()), 'EN /request-a-quote → kontakt: ' + page.url());
  const cta = await page.locator('header a[href^="mailto:"]').first().getAttribute('href');
  ok(cta && cta.startsWith('mailto:vit.volny@mnastrojarna.cz'), 'CTA v hlavičce: ' + (cta || '').slice(0, 60));
  const body = await page.locator('main').innerText();
  ok(!/Semor/i.test(body), 'kontakt bez J. Semoráda');
  // screenshoty
  for (const [p, n] of [['/en', 'en-home'], ['/en/references', 'en-refs'], ['/de/leistungen/werkzeugbau', 'de-service'], ['/de', 'de-home']]) {
    await page.goto('http://localhost:3100' + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${S}/shots/${n}.png` });
  }
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:3100/de', { waitUntil: 'networkidle' }); await m.waitForTimeout(2000);
  await m.getByRole('button', { name: /Menü|Menu/ }).click(); await m.waitForTimeout(900);
  await m.screenshot({ path: `${S}/shots/de-mob-menu.png` });
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, 'mobil bez horizontálního scrollu');
  ok(errs.length === 0, 'bez JS chyb ' + errs.join('|'));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
