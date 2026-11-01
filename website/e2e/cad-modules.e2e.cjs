// E2E nových modulů CADu: svařence (rám z profilů), plech (základní plech → rozvin DXF), plochy (plošné vysunutí),
// pokročilé (zkrut), knihovna 2 (kuželíkové ložisko). Spuštění: node e2e/cad-modules.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2] || '/tmp/e2e';
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const dl = async (page, trigger) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]); return d; };
const palette = async (page, text) => { await page.keyboard.press('Control+k'); await page.waitForTimeout(300); await page.keyboard.type(text); await page.waitForTimeout(400); await page.keyboard.press('Enter'); };
const historyHas = async (page, re) => (await page.locator('aside').first().innerText()).match(re) != null;
const chips = async (page) => page.locator('footer').innerText();

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:3100/cad', { waitUntil: 'networkidle' });
  const cont = page.getByText('Pokračovat v práci');
  if (await cont.isVisible({ timeout: 5000 }).catch(() => false)) await cont.click();
  await page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });

  // nový díl (rychlé tlačítko v hlavičce)
  const newPart = async () => { await page.locator('header button[title="Nový díl"]').click(); await page.waitForTimeout(600); };
  await newPart();

  // svařence: rám z profilů (bez skici)
  await palette(page, 'Rám z profilů');
  await page.waitForTimeout(4000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  ok(await historyHas(page, /Rám z profilů/), 'svařenec: rám z profilů v historii');
  ok(/mm/.test(await page.locator('main').innerText()), 'svařenec: těleso postaveno (rozměry ve štítku)');
  await palette(page, 'Kusovník řezů');
  await page.waitForTimeout(800);
  ok(await page.getByText(/Kusovník řezů/).first().isVisible(), 'svařenec: kusovník řezů otevřen');
  await page.keyboard.press('Escape');

  // plech: nový díl → skica obdélník → základní plech → rozvin DXF
  await newPart();
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await page.getByRole('button', { name: /^Skica/ }).first().click();
  await page.getByRole('button', { name: /Rovina XY/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('r');
  await page.mouse.click(700, 420); await page.mouse.click(900, 520);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Dokončit skicu/ }).click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape'); // zrušit automatické vysunutí
  await page.waitForTimeout(600);
  await palette(page, 'Základní plech');
  await page.waitForTimeout(3000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  ok(await historyHas(page, /Základní plech/), 'plech: základní plech v historii');
  const d1 = await dl(page, () => palette(page, 'Rozvin → DXF'));
  const dxf = fs.readFileSync(await d1.path(), 'utf8');
  ok(/OBRYS/.test(dxf) && /\$INSUNITS/.test(dxf), 'plech: rozvin DXF stažen (' + dxf.length + ' B)');

  // plochy: plošné vysunutí poslední skici
  await palette(page, 'Plošné vysunutí');
  await page.waitForTimeout(3000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  ok(await historyHas(page, /Plošné vysunutí/), 'plochy: plošné vysunutí v historii');

  // pokročilé: zkrut na čistém dílu (skica → zkrut)
  await newPart();
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await page.getByRole('button', { name: /^Skica/ }).first().click();
  await page.getByRole('button', { name: /Rovina XY/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('r');
  await page.mouse.click(700, 420); await page.mouse.click(820, 520);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Dokončit skicu/ }).click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await palette(page, 'Zkrut');
  await page.waitForTimeout(3500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  ok(await historyHas(page, /Zkrut/), 'pokročilé: zkrut v historii');
  const bad = await page.locator('aside').first().locator('[title]').filter({ hasText: '!' }).count();
  ok(bad === 0, 'žádný prvek s chybou v historii (' + bad + ')');

  // knihovna 2
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(500);
  await page.keyboard.type('kuželíkové ložisko 30206');
  await page.waitForTimeout(3500);
  ok(await page.getByText(/30206/).first().isVisible(), 'knihovna 2: rozpoznáno 30206');
  await page.getByRole('button', { name: /Vložit jako nový díl|Otevřít jako nový díl/ }).click();
  await page.waitForTimeout(3500);
  ok(/30206|ložisko/i.test(await page.locator('header input').first().inputValue()), 'knihovna 2: ložisko otevřeno jako díl');

  // analýza ploch: zebra
  await page.getByRole('button', { name: 'Nástroje', exact: true }).click();
  await page.getByRole('button', { name: /Formařské/ }).click();
  await page.waitForTimeout(400);
  const panel = page.locator('div.absolute.z-20').filter({ hasText: 'Formařské nástroje' });
  await panel.getByRole('button', { name: 'Plochy', exact: true }).click();
  await panel.getByText(/Zebra pruhy/).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: S + '/modules-final.png' });
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
