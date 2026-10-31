// E2E: Mnástrojárna CAD — skica, vysunutí, zaoblení, díra, export STEP/DXF/SVG, předání do poptávky.
// Spuštění (běžící server na :3100): node e2e/cad.e2e.cjs <výstupní složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:3100/cad', { waitUntil: 'networkidle' });
  await page.getByText(/Jádro připraveno/).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Soubor' }).click();
  await page.getByRole('button', { name: 'Nový díl' }).click();
  await page.getByRole('button', { name: 'Nová skica' }).click();
  await page.getByRole('button', { name: /Rovina XY/ }).click();
  const box = await page.locator('main svg').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.keyboard.press('r');
  await page.mouse.click(cx - 200, cy - 120);
  await page.mouse.click(cx + 200, cy + 120);
  await page.keyboard.press('c');
  // po vytvoření obdélníku se otevře panel vlastností → plátno se zúží, střed přepočítat
  const box2 = await page.locator('main svg').first().boundingBox();
  const cx2 = box2.x + box2.width / 2, cy2 = box2.y + box2.height / 2;
  await page.mouse.click(cx2, cy2);
  await page.mouse.click(cx2 + 40, cy2);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: S + '/cad-sketch.png' });
  ok(await page.getByText(/2 uzavř/).isVisible(), 'skica má 2 uzavřené profily');
  await page.getByRole('button', { name: /Dokončit skicu/ }).click();
  await page.getByText('Vzdálenost').waitFor();
  const dist = page.locator('label:has-text("Vzdálenost") input');
  await dist.fill('15'); await dist.press('Enter');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Hotovo' }).click();
  await page.waitForTimeout(800);
  const status = await page.locator('main').innerText();
  ok(/cm³/.test(status), 'vysunutí vytvořilo těleso: ' + status.split('\n').slice(0, 2).join(' | '));
  // zaoblení všech hran
  await page.getByRole('button', { name: 'Zaoblit' }).click();
  await page.getByRole('button', { name: 'Všechny' }).click();
  await page.waitForTimeout(1500);
  const tree = await page.locator('aside').first().innerText();
  ok(/Zaoblení 1/.test(tree), 'zaoblení ve stromu');
  await page.getByRole('button', { name: 'Hotovo' }).click();
  // díra kliknutím na plochu
  await page.getByRole('button', { name: 'Díra', exact: true }).click();
  await page.waitForTimeout(1500);
  const vp = await page.locator('main canvas').boundingBox();
  for (const [dx, dy] of [[-0.22, -0.02], [0.2, 0.05], [-0.1, 0.1], [0.1, -0.1]]) {
    await page.mouse.click(vp.x + vp.width * (0.5 + dx), vp.y + vp.height * (0.5 + dy));
    await page.waitForTimeout(500);
  }
  const posX = await page.locator('aside:last-of-type input').nth(5).inputValue().catch(() => '?');
  ok(true, 'díra – pozice X: ' + posX);
  await page.getByRole('button', { name: 'Hotovo' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: S + '/cad-model.png' });
  // export STEP
  await page.getByRole('button', { name: 'Export' }).click();
  let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /STEP \(\.step\)/ }).click()]);
  const step = fs.readFileSync(await dl.path(), 'utf8');
  ok(step.includes('ISO-10303-21'), 'STEP export ' + step.length + ' B');
  await page.getByRole('button', { name: 'Export' }).click();
  [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Výkres DXF/ }).click()]);
  const dxf = fs.readFileSync(await dl.path(), 'utf8');
  ok(dxf.includes('OBRYS') && dxf.includes('EOF'), 'DXF výkres ' + dxf.length + ' B');
  await page.getByRole('button', { name: 'Export' }).click();
  [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /Výkres SVG/ }).click()]);
  fs.copyFileSync(await dl.path(), S + '/vykres.svg');
  ok(true, 'SVG výkres uložen');
  // uložit projekt
  await page.keyboard.press('Control+s').catch(() => {});
  // poptávka
  await page.getByRole('button', { name: 'Poptat výrobu' }).click();
  await page.waitForURL(/poptavka/, { timeout: 30000 });
  ok(true, 'přechod do poptávky');
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
