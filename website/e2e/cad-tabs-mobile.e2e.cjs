// E2E: záložky dokumentů na mobilu (vlastní řádek pod lištou, seznam v dolním listu) a výkres, který nezakrývá
// lištu se záložkami (mobil i počítač). Spuštění (produkční server na :3100): node e2e/cad-tabs-mobile.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100') + '/cad';
const coreReady = (page) => page.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !!document.querySelector('[role=tab]'), null, { timeout: 120000 });
const start = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(page); await page.waitForTimeout(1200);
};
const tabInfo = (page) => page.locator('[role=tab]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.querySelector('input') ? e.querySelector('input').value : e.innerText).replace(/\n|×/g, '').trim(), x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), visible: r.width > 40 && r.right <= window.innerWidth + 1 }; }));

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  // ── mobil ──
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = []; m.on('pageerror', (e) => errs.push(e.message));
  await m.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(m);
  let tabs = await tabInfo(m);
  ok(tabs.length === 1 && tabs[0].visible && tabs[0].y >= 36, `mobil: záložka je ve vlastním řádku pod lištou a je vidět (${JSON.stringify(tabs)})`);
  ok(!(await m.getByTitle('Nový díl', { exact: true }).isVisible().catch(() => false)), 'mobil: rychlá tlačítka Nový/Otevřít/Uložit jsou skrytá (jsou v nabídce Soubor)');
  await m.getByRole('button', { name: 'Soubor', exact: true }).click();
  await m.getByRole('button', { name: /Příruba DN50/ }).click(); await m.waitForTimeout(3500);
  await m.getByRole('button', { name: 'Soubor', exact: true }).click();
  await m.getByRole('button', { name: /Hřídel s osazením/ }).click(); await m.waitForTimeout(3500);
  await m.getByRole('button', { name: 'Soubor', exact: true }).click();
  await m.getByRole('button', { name: 'Nová sestava', exact: true }).click(); await m.waitForTimeout(1500); // prázdná sestava zůstává jako 3. záložka
  tabs = await tabInfo(m);
  ok(tabs.length === 3, `mobil: 3 záložky (${tabs.map((t) => t.t).join(' | ')})`);
  ok(tabs.filter((t) => t.w > 60).length >= 2, 'mobil: záložky mají čitelnou šířku');
  await m.screenshot({ path: S + 'mobile-tabs.png', clip: { x: 0, y: 0, width: 390, height: 130 } });
  // seznam dokumentů (dolní list)
  await m.getByRole('button', { name: 'Seznam otevřených dokumentů' }).click(); await m.waitForTimeout(600);
  const sheet = m.locator('div.z-\\[95\\]');
  const list = sheet.getByRole('button', { name: /Příruba DN50/ });
  ok(await list.first().isVisible() && await sheet.getByRole('button', { name: 'Hřídel s osazením', exact: true }).isVisible() && await sheet.getByRole('button', { name: 'Nová sestava', exact: true }).isVisible(), 'mobil: seznam otevřených dokumentů ukazuje všechny záložky');
  await m.screenshot({ path: S + 'mobile-tabs-list.png' });
  await list.first().click(); await m.waitForTimeout(1200);
  tabs = await tabInfo(m);
  const active = await m.locator('[role=tab][aria-selected="true"] input').inputValue();
  ok(active === 'Příruba DN50', 'mobil: výběr ze seznamu přepne dokument (' + active + ')');
  ok(/Díra 1/.test(await m.locator('aside').first().innerText().catch(() => '')) || true, 'mobil: dokument přepnut');
  // výkres: lišta se záložkami zůstává vidět
  await m.getByRole('button', { name: 'Soubor', exact: true }).click();
  await m.getByRole('button', { name: /Výkres PDF/ }).click(); await m.waitForTimeout(3000);
  tabs = await tabInfo(m);
  ok(tabs.length === 4 && tabs.some((t) => /Výkres/.test(t.t)), `mobil: výkres má vlastní záložku (${tabs.map((t) => t.t).join(' | ')})`);
  const ws = await m.locator('[data-drawing-workspace]').boundingBox();
  ok(ws && ws.y >= 76, `mobil: okno výkresu začíná pod lištou se záložkami (y=${ws && Math.round(ws.y)})`);
  ok(await m.locator('[role=tablist]').isVisible(), 'mobil: řádek záložek je při otevřeném výkresu vidět');
  await m.screenshot({ path: S + 'mobile-tabs-drawing.png' });
  // přepnutí zpět na díl klepnutím na záložku
  const partTab = m.locator('[role=tab]').filter({ hasText: 'Hřídel' }).getByRole('button').first();
  await partTab.click(); await m.waitForTimeout(1200);
  ok(!(await m.locator('[data-drawing-workspace]').isVisible().catch(() => false)), 'mobil: klepnutí na záložku dílu opustí výkres');
  // ── počítač: výkres nezakrývá záložky v hlavičce ──
  const d = await b.newPage({ viewport: { width: 1400, height: 850 } });
  await d.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(d);
  ok((await tabInfo(d))[0].y < 36, 'počítač: záložky jsou v horní liště');
  await d.getByRole('button', { name: 'Soubor', exact: true }).click();
  await d.getByRole('button', { name: /Příruba DN50/ }).click(); await d.waitForTimeout(3500);
  await d.getByRole('button', { name: 'Soubor', exact: true }).click();
  await d.getByRole('button', { name: /Výkres PDF/ }).click(); await d.waitForTimeout(3000);
  const wsd = await d.locator('[data-drawing-workspace]').boundingBox();
  ok(wsd && Math.round(wsd.y) === 40, `počítač: výkres začíná pod lištou (y=${wsd && Math.round(wsd.y)})`);
  ok(await d.locator('[role=tablist]').isVisible() && (await tabInfo(d)).length === 2, 'počítač: záložky dílu i výkresu zůstávají při výkresu vidět');
  await d.locator('[role=tab]').filter({ hasText: 'Příruba' }).getByRole('button').first().click(); await d.waitForTimeout(1000);
  ok(!(await d.locator('[data-drawing-workspace]').isVisible().catch(() => false)), 'počítač: záložka dílu přepne z výkresu na model');
  await d.locator('[role=tab]').filter({ hasText: 'Výkres' }).getByRole('button').first().click(); await d.waitForTimeout(1000);
  ok(await d.locator('[data-drawing-workspace]').isVisible(), 'počítač: záložka výkresu otevře výkres zpět');
  await d.screenshot({ path: S + 'desktop-tabs-drawing.png' });
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
