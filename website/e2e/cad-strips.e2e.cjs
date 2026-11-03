// E2E: vodorovné pruhy CADu (pás karet, řádek záložek pásu, záložky dokumentů, lišta výkresu) se posouvají jen
// vodorovně – žádný svislý přetok („plavání“ nahoru a dolů na dotyku) – a na mobilu jsou všechny karty pásu dosažitelné.
// Spuštění (produkční server na :3100): node e2e/cad-strips.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = 'http://localhost:3100/cad';
const start = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await page.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !!document.querySelector('[role=tab]'), null, { timeout: 120000 });
  await page.waitForTimeout(1200);
};
/** všechny vodorovně posuvné prvky: svislý přetok a touch-action */
const strips = (page) => page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => { const cs = getComputedStyle(el); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1; }).map((el) => { const cs = getComputedStyle(el); return { cls: el.className.toString().slice(0, 40), vOverflow: el.scrollHeight > el.clientHeight, oy: cs.overflowY, ta: cs.touchAction }; }));

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  // ── mobil ──
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = []; m.on('pageerror', (e) => errs.push(e.message));
  await m.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(m);
  let st = await strips(m);
  ok(st.length >= 2, `mobil: posuvné pruhy: ${st.map((x) => x.cls.split(' ').slice(0, 3).join(' ')).join(' | ')}`);
  ok(st.every((x) => !x.vOverflow && x.oy === 'hidden' && x.ta === 'pan-x'), 'mobil: žádný pruh nemá svislý přetok, posun jen vodorovně (touch-action: pan-x)');
  // karty pásu: Data je mimo obrazovku, ale lze k ní dorolovat
  const dataTab = m.getByRole('button', { name: 'Data', exact: true }).first();
  const before = await dataTab.boundingBox();
  ok(before && before.x + before.width > 390, `mobil: karta Data je zpočátku mimo obrazovku (x=${before && Math.round(before.x)})`);
  await dataTab.scrollIntoViewIfNeeded(); await m.waitForTimeout(300);
  const after = await dataTab.boundingBox();
  ok(after && after.x + after.width <= 391, `mobil: řádek karet pásu se posouvá vodorovně (x=${after && Math.round(after.x)})`);
  await dataTab.click(); await m.waitForTimeout(500);
  ok(/Kusovník|Proměnné|Export|Vlastnosti|Hmotnost/i.test(await m.locator('body').innerText()), 'mobil: karta Data se aktivuje po dorolování');
  await m.screenshot({ path: S + 'mobile-ribbon-tabs.png', clip: { x: 0, y: 0, width: 390, height: 200 } });
  // nabídka Soubor v posuvném řádku se neořezává – otevře se jako spodní list
  await m.getByRole('button', { name: 'Tvorba', exact: true }).first().scrollIntoViewIfNeeded();
  await m.getByRole('button', { name: 'Soubor', exact: true }).click(); await m.waitForTimeout(600);
  const sheet = m.locator('div.z-\\[95\\]');
  ok(await sheet.getByRole('button', { name: 'Nový díl', exact: true }).isVisible() && await sheet.getByRole('button', { name: 'Uložit jako…' }).isVisible(), 'mobil: nabídka Soubor se otevře celá (spodní list), nic není oříznuté');
  await m.screenshot({ path: S + 'mobile-file-menu.png' });
  await sheet.getByRole('button', { name: /Příruba DN50/ }).click(); await m.waitForTimeout(3500);
  // lišta výkresu: posuvná, Zavřít dosažitelné
  await m.getByRole('button', { name: 'Soubor', exact: true }).click();
  await m.locator('div.z-\\[95\\]').getByRole('button', { name: /Výkres PDF/ }).click(); await m.waitForTimeout(2500);
  st = await strips(m);
  ok(st.every((x) => !x.vOverflow && x.ta === 'pan-x'), 'mobil (výkres): pruhy bez svislého přetoku');
  const close = m.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true });
  await close.scrollIntoViewIfNeeded(); await m.waitForTimeout(300);
  const cb = await close.boundingBox();
  ok(cb && cb.x + cb.width <= 391 && cb.x >= 0, `mobil: lišta výkresu se posouvá, Zavřít je dosažitelné (x=${cb && Math.round(cb.x)})`);
  await m.screenshot({ path: S + 'mobile-drawing-toolbar.png', clip: { x: 0, y: 0, width: 390, height: 160 } });
  await close.click(); await m.waitForTimeout(800);
  ok(!(await m.locator('[data-drawing-workspace]').isVisible().catch(() => false)), 'mobil: Zavřít výkres funguje');
  // ── počítač: nabídka Soubor pod tlačítkem, pás bez svislého přetoku ──
  const d = await b.newPage({ viewport: { width: 1400, height: 850 } });
  await d.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(d);
  const sd = await strips(d);
  ok(sd.every((x) => !x.vOverflow), 'počítač: pás karet bez svislého přetoku');
  const fileBtn = d.getByRole('button', { name: 'Soubor', exact: true });
  await fileBtn.click(); await d.waitForTimeout(400);
  const entry = d.getByRole('button', { name: 'Uložit jako…' });
  const fb = await fileBtn.boundingBox(); const eb = await entry.boundingBox();
  ok(await entry.isVisible() && eb && fb && eb.y > fb.y + fb.height - 2 && Math.abs(eb.x - fb.x) < 40, `počítač: nabídka Soubor se otevře pod tlačítkem (menu y=${eb && Math.round(eb.y)}, tlačítko y=${fb && Math.round(fb.y + fb.height)})`);
  await d.keyboard.press('Escape'); await d.waitForTimeout(300);
  await d.screenshot({ path: S + 'desktop-file-menu.png', clip: { x: 0, y: 0, width: 700, height: 500 } });
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
