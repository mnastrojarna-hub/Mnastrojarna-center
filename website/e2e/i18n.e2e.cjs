// E2E: jazykové verze — přepínač EN/DE/CZ, anglická poptávka se zahraničním VAT ID, mobil bez přetékání.
// Spuštění (server :3100 s LEAD_WEBHOOK_URL na e2e/hook-server.cjs): node e2e/i18n.e2e.cjs <složka se shots/>
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
  // EN poptávka
  await page.goto('http://localhost:3100/en/request-a-quote', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Continue/ }).click();
  const err1 = await page.locator('[role=alert]').first().innerText();
  ok(/[a-z]/.test(err1) && !/[ěščřžý]/.test(err1), 'anglická validace: ' + err1);
  await page.getByRole('button', { name: 'CNC machining', exact: true }).click();
  await page.locator('input[name=budget][value="pod-50k"]').check();
  ok(await page.getByRole('button', { name: /Continue/ }).isDisabled(), 'pod 50k zablokováno (EN)');
  await page.locator('input[name=budget][value="1-5m"]').check();
  await page.locator('#description').fill('Spare rollers for our packaging line, 1.4301, quantity 40 per year.');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.locator('#ico').fill('DE123456789');
  await page.locator('#company').fill('Test Packaging GmbH');
  await page.locator('#name').fill('John Tester');
  await page.locator('#email').fill('john@test-packaging.de');
  await page.locator('input[type=checkbox]').last().check();
  await page.waitForTimeout(3100);
  await page.getByRole('button', { name: /Send request|Submit|Send/ }).click();
  await page.locator('h2').filter({ hasText: /.+/ }).first().waitFor();
  await page.waitForTimeout(1500);
  const h2 = await page.locator('h2').first().innerText();
  ok(!/[ěščřžý]/.test(h2), 'potvrzení v angličtině: ' + h2);
  const hook = JSON.parse(require('fs').readFileSync(S + '/hook.json', 'utf8'));
  ok(hook.lead.locale === 'en' && hook.score.grade, `lead locale=${hook.lead.locale} skóre ${hook.score.grade} ${hook.score.score} (${hook.score.reasons.join('; ')})`);
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
