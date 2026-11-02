const { chromium } = require('playwright');
// E2E zadávacích polí (vysunutí: ukončení / 2 směry / tenká stěna; díra: více poloh, k ploše, výběr odkazu klikem). Spuštění: node e2e/cad-refs.e2e.cjs <složka>
const O = process.argv[2] || '/tmp/e2e'; require('fs').mkdirSync(O, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:3100/cad', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => /×.*mm/.test(document.body.innerText) && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  for (let i = 0; i < 20; i++) { const st = page.locator('div.fixed.z-\\[65\\]'); if (await st.isVisible().catch(() => false)) { await st.getByText('Pokračovat v práci').first().click(); break; } await page.waitForTimeout(500); }
  await page.waitForTimeout(800);
  // nový díl, skica obdélník na XY, dokončit → automatické vysunutí (formulář)
  await page.locator('header button[title="Nový díl"]').click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await page.getByRole('button', { name: /^Skica/ }).first().click();
  await page.getByRole('menu').getByRole('button', { name: /Rovina XY/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('r'); await page.mouse.click(700, 420); await page.mouse.click(900, 520); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Dokončit skicu/ }).click(); await page.waitForTimeout(1500);
  const panel = page.locator('aside').last();
  ok(await page.getByText('Ukončení (směr 1)').isVisible(), 'formulář vysunutí: pole Ukončení');
  // přepnout na Střední rovina
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Skrz vše' }) }).first();
  await sel.selectOption('midPlane'); await page.waitForTimeout(1500);
  ok(await page.getByText('Celková délka', { exact: true }).isVisible(), 'ukončení: střední rovina → pole Celková délka');
  // druhý směr
  await page.getByText('Druhý směr', { exact: true }).click(); await page.waitForTimeout(800);
  ok(await page.getByText('Ukončení (směr 2)').isVisible(), 'druhý směr: druhé pole ukončení');
  // pokročilé: tenká stěna
  await page.getByText(/Začátek, směr, tenká stěna/).click(); await page.waitForTimeout(300);
  await page.getByText(/Tenká stěna \(profil/).click(); await page.waitForTimeout(1500);
  ok(await page.getByText('Tloušťka', { exact: true }).isVisible(), 'tenká stěna: pole tloušťky');
  await page.getByText(/Tenká stěna \(profil/).click(); await page.waitForTimeout(1200); // zpět plné těleso
  const txt = await page.locator('main').innerText();
  ok(/mm/.test(txt), 'model postaven (štítek rozměrů)');
  await page.screenshot({ path: O + '/ui-vysunuti-formular.png' });
  // potvrdit Enter, pak Díra → K ploše → vybrat plochu klikem (pole odkazu)
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Díra/ }).first().click(); await page.waitForTimeout(800);
  ok(await page.getByText('Polohy děr (více naráz)').isVisible(), 'díra: pole více poloh');
  const hsel = page.locator('select').filter({ has: page.locator('option', { hasText: 'K dalšímu' }) }).first();
  await hsel.selectOption('toFace'); await page.waitForTimeout(500);
  ok(await page.getByText('Plocha / pomocná rovina').isVisible(), 'díra: ukončení k ploše → pole odkazu');
  await page.getByRole('button', { name: /Vyberte plochu/ }).first().click(); await page.waitForTimeout(300);
  ok(/vyberte plochu/i.test(await page.locator('footer').innerText()), 'výzva ve stavovém řádku při výběru odkazu');
  await page.mouse.move(740, 600); await page.waitForTimeout(300);
  await page.mouse.click(740, 600); await page.waitForTimeout(1500);
  const lbl = await page.locator('aside').last().innerText();
  ok(/Plocha \d+/.test(lbl), 'kliknutím vybrána plocha do pole odkazu');
  // pravé tlačítko v poli odkazu → nabídka způsobů zadání
  await page.locator('button[title^="Další způsoby zadání"]').first().click(); await page.waitForTimeout(400);
  ok(await page.getByRole('button', { name: /Použít aktuální výběr/ }).isVisible(), 'nabídka způsobů zadání v poli odkazu');
  await page.screenshot({ path: O + '/ui-dira-odkaz.png' });
  await page.keyboard.press('Escape');
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
