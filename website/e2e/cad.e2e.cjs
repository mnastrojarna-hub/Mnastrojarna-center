// E2E Mnástrojárna CAD (nové UI): úvodní obrazovka → ukázka → skica + vysunutí → díra z palety → měření →
// knihovna normálií → výkres (PDF/DXF/DWG/SVG) → sestava (rám formy) → kusovník → export STEP → poptávka.
// Spuštění (produkční server na :3100): node e2e/cad.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2] || '/tmp/e2e';
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const dl = async (page, trigger) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]); return d; };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:3100/cad', { waitUntil: 'networkidle' });
  // úvodní obrazovka
  const cont = page.getByText('Pokračovat v práci');
  if (await cont.isVisible({ timeout: 5000 }).catch(() => false)) { await cont.click(); ok(true, 'úvodní obrazovka zavřena'); }
  await page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  ok(true, 'jádro OpenCascade připraveno');

  // ukázka: Soubor → Příruba DN50
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  await page.getByRole('button', { name: /Příruba DN50/ }).click();
  await page.waitForTimeout(3000);
  ok((await page.locator('text=Díra 1').count()) > 0, 'ukázka načtena (historie obsahuje Díra 1)');

  // skica na XY + obdélník + dokončit → vysunutí (automaticky) → OK
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await page.getByRole('button', { name: /^Skica/ }).first().click();
  await page.getByRole('button', { name: /Rovina XY/ }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('r');
  await page.mouse.click(700, 420);
  await page.mouse.click(760, 480);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Dokončit skicu/ }).click();
  await page.waitForTimeout(1500);
  ok((await page.locator('text=/Vysunutí \\d/').count()) > 0, 'po skice vzniklo vysunutí');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  // paleta příkazů → Díra
  await page.keyboard.press('Control+k');
  await page.keyboard.type('díra');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  ok((await page.locator('text=/Díra \\d/').count()) >= 2, 'paleta příkazů přidala díru');
  await page.keyboard.press('Escape');

  // měření (M) – dva kliky na model
  await page.keyboard.press('m');
  await page.mouse.click(900, 620);
  await page.waitForTimeout(500);
  await page.mouse.click(760, 480);
  await page.waitForTimeout(1500);
  ok(await page.getByText(/Měření/).first().isVisible(), 'panel měření otevřen');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // knihovna normálií: M8x30 → nový díl
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(500);
  await page.keyboard.type('M8x30');
  await page.waitForTimeout(2500);
  ok(await page.getByText(/ISO 4762/).first().isVisible(), 'knihovna rozpoznala ISO 4762 M8×30');
  await page.getByRole('button', { name: /Vložit jako nový díl|Otevřít jako nový díl/ }).click();
  await page.waitForTimeout(3000);
  ok(/Šroub/.test(await page.locator('header input').first().inputValue()), 'šroub otevřen jako nový díl');

  // výkres: PDF, DXF, DWG, SVG
  await page.getByRole('button', { name: 'Výkres', exact: true }).click();
  await page.getByRole('button', { name: /Nový výkres/ }).click();
  await page.waitForTimeout(6000);
  let d = await dl(page, () => page.getByRole('button', { name: 'DXF', exact: true }).click());
  ok(/\.dxf$/.test(d.suggestedFilename()), 'výkres DXF ' + d.suggestedFilename());
  d = await dl(page, () => page.getByRole('button', { name: 'DWG', exact: true }).click());
  const dwg = fs.readFileSync(await d.path());
  ok(dwg.slice(0, 6).toString() === 'AC1032', 'výkres DWG R2018 (' + dwg.length + ' B)');
  d = await dl(page, () => page.getByRole('button', { name: 'SVG', exact: true }).click());
  ok(/\.svg$/.test(d.suggestedFilename()), 'výkres SVG');
  d = await dl(page, () => page.getByRole('button', { name: 'PDF', exact: true }).click());
  const pdf = fs.readFileSync(await d.path());
  ok(pdf.slice(0, 5).toString() === '%PDF-', 'výkres PDF (' + pdf.length + ' B)');
  await page.locator('div.fixed.z-50 header').getByRole('button', { name: 'Zavřít', exact: true }).click();

  // sestava: rám formy → kusovník → export STEP
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  await page.getByRole('button', { name: /Rám vstřikovací formy/ }).click();
  await page.getByRole('button', { name: 'Vytvořit rám formy' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Stavím komponenty'), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  ok(/komponent/.test(await page.locator('footer').innerText()), 'rám formy postaven');
  await page.getByRole('button', { name: /Kusovník/ }).first().click();
  await page.waitForTimeout(800);
  ok((await page.locator('table tbody tr').count()) >= 8, 'kusovník má řádky');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: /^Export/ }).first().click();
  d = await dl(page, () => page.getByRole('button', { name: /STEP AP214/ }).click());
  ok(/\.step$/.test(d.suggestedFilename()), 'sestava exportována do STEP');

  await page.screenshot({ path: S + '/cad-final.png' });
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
