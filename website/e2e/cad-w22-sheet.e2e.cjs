// E2E: spodní listy CADu na mobilu (hlášení majitele 25. 11.: „okno, co vyskakuje jako výběr zespodu, nejde
// zatáhnout dolů – např. když otevřu Soubor“). Skutečná dotyková gesta (CDP Input.dispatchTouchEvent) na telefonu
// Pixel 7 a iPhone 13 (parametry zařízení v Chromiu): tažení dolů za úchyt zavře, krátké tažení vrátí, posunutý
// seznam se posouvá místo zavírání, ze seznamu nahoře se list stáhne, švihnutí zavře, klepnutí na podklad zavře,
// systémové Zpět zavře list (stránka zůstane, bez nového načtení), Esc zavře; panel prvku (Kvádr) jako spodní list.
// Spuštění (produkční server): E2E_BASE=http://localhost:3538 node e2e/cad-w22-sheet.e2e.cjs <složka>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S + 'shots', { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100') + '/cad';
const coreReady = (page) => page.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !!document.querySelector('[role=tab]'), null, { timeout: 120000 });
const start = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(page); await page.waitForTimeout(1200);
};
const device = (name) => { const { defaultBrowserType, ...d } = devices[name]; return d; }; // eslint-disable-line no-unused-vars
const SHEET = '[data-bottom-sheet][data-cad-menu]';
const navIndex = (p) => p.evaluate(() => (window.navigation && window.navigation.currentEntry ? window.navigation.currentEntry.index : history.length));
const sheetOpen = async (p) => (await p.locator(SHEET).count()) > 0;

/** dotykové gesto: prst dolů v (x, y0), tah do y1 v `steps` krocích po `stepMs`, `holdMs` zastavení, puštění */
// Události nesou svůj čas (timestamp) jako skutečný dotyk – rychlost gesta pak nezávisí na zatížení stroje při testu.
async function swipe(p, cdp, x, y0, y1, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }], timestamp: t0 });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }], timestamp: t0 + (i * stepMs) / 1000 });
    await p.waitForTimeout(stepMs);
  }
  if (holdMs) await p.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + (steps * stepMs + holdMs) / 1000 });
}

async function openFileMenu(p) {
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.locator(SHEET).waitFor({ state: 'visible', timeout: 5000 });
  await p.waitForTimeout(250);
}

async function phone(b, name) {
  const tag = name.replace(/\s+/g, '').toLowerCase();
  const ctx = await b.newContext({ ...device(name) });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(p);
  const cdp = await ctx.newCDPSession(p);
  await p.evaluate(() => { window.__sheetMarker = 42; });
  const vw = p.viewportSize().width;
  const cx = Math.round(vw / 2);
  const idx0 = await navIndex(p);

  // ── 1. list Soubor: úchyt, styly proti obnovení stažením ──
  await openFileMenu(p);
  const box = await p.locator(SHEET).boundingBox();
  const handle = p.locator(SHEET + ' [data-sheet-handle]');
  ok(await handle.isVisible(), `${name}: list Soubor má viditelný úchyt (výška listu ${Math.round(box.height)} px)`);
  const css = await p.evaluate((sel) => {
    const s = document.querySelector(sel);
    const body = s.querySelector('[data-sheet-body]');
    const bd = document.querySelector('[data-sheet-backdrop]');
    return { sheet: getComputedStyle(s).overscrollBehaviorY, body: getComputedStyle(body).overscrollBehaviorY, handle: getComputedStyle(s.querySelector('[data-sheet-handle]')).touchAction, bd: getComputedStyle(bd).touchAction, scrollable: body.scrollHeight > body.clientHeight + 20 };
  }, SHEET);
  ok(css.sheet === 'contain' && css.body === 'contain', `${name}: overscroll-behavior: contain na listu i seznamu (${css.sheet}/${css.body}) – žádné obnovení stránky stažením`);
  ok(css.handle === 'none' && css.bd === 'none', `${name}: touch-action: none na úchytu a podkladu (${css.handle}/${css.bd})`);
  ok(css.scrollable, `${name}: seznam v listu Soubor je delší než list (posouvá se)`);
  ok((await navIndex(p)) === idx0 + 1, `${name}: otevřený list přidal jeden záznam historie (pro tlačítko Zpět)`);
  await p.screenshot({ path: `${S}shots/${tag}-open.png` });

  // ── 2. krátké pomalé tažení za úchyt → list se vrátí ──
  const hb = await handle.boundingBox();
  const hy = hb.y + hb.height / 2;
  await swipe(p, cdp, cx, hy, hy + Math.round(box.height * 0.12), { steps: 10, stepMs: 30, holdMs: 160 });
  await p.waitForTimeout(450);
  const tf = await p.evaluate((sel) => { const s = document.querySelector(sel); return s ? { t: getComputedStyle(s).transform, y: Math.round(s.getBoundingClientRect().y) } : null; }, SHEET);
  ok(tf && (tf.t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(tf.t)) && Math.abs(tf.y - box.y) <= 1, `${name}: krátké tažení (12 % výšky) – list se vrátil na místo (${tf && tf.t}, y ${tf && tf.y} = ${Math.round(box.y)})`);

  // ── 3. list jde za prstem, dlouhé tažení za úchyt → zavře ──
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: hy }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: hy + i * 15 }] }); await p.waitForTimeout(20); }
  const mid = await p.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().y), SHEET);
  ok(mid - box.y > 60 && mid - box.y < 130, `${name}: list během tažení jde za prstem (posun ${mid - Math.round(box.y)} px při tahu 120 px)`);
  for (let i = 9; i <= 24; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: hy + i * 15 }] }); await p.waitForTimeout(20); }
  await p.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
  ok(!(await sheetOpen(p)), `${name}: tažení dolů za úchyt (360 px) list Soubor zavřelo`);
  ok((await navIndex(p)) === idx0, `${name}: po zavření tažením je historie zpět na původním místě (Zpět pak neopustí CAD omylem)`);

  // ── 4. posunutý seznam se posouvá, nezavírá; nahoře se list stáhne ──
  await openFileMenu(p);
  const bodySel = SHEET + ' [data-sheet-body]';
  const bb = await p.locator(bodySel).boundingBox();
  // prst nahoru (posun seznamu dolů); zastavení před puštěním = bez setrvačného dojezdu
  await swipe(p, cdp, cx, Math.round(bb.y + bb.height * 0.8), Math.round(bb.y + bb.height * 0.3), { steps: 12, stepMs: 25, holdMs: 250 });
  await p.waitForTimeout(500);
  const st1 = await p.evaluate((sel) => document.querySelector(sel).scrollTop, bodySel);
  ok(st1 > 40 && (await sheetOpen(p)), `${name}: tah prstem nahoru posunul seznam (scrollTop ${st1}), list zůstal`);
  await swipe(p, cdp, cx, Math.round(bb.y + bb.height * 0.3), Math.round(bb.y + bb.height * 0.3) + Math.min(st1 - 10, 160), { steps: 10, stepMs: 20 });
  await p.waitForTimeout(600);
  const st2 = await p.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.scrollTop : -1; }, bodySel);
  ok(await sheetOpen(p), `${name}: tah dolů v posunutém seznamu list NEzavřel`);
  ok(st2 >= 0 && st2 < st1, `${name}: tah dolů v posunutém seznamu posunul seznam zpět (scrollTop ${st1} → ${st2})`);
  await p.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; }, bodySel);
  await p.waitForTimeout(150);
  await swipe(p, cdp, cx, Math.round(bb.y + 60), Math.round(bb.y + 60 + box.height * 0.45), { steps: 14, stepMs: 18 });
  await p.waitForTimeout(500);
  ok(!(await sheetOpen(p)), `${name}: seznam nahoře (scrollTop 0) – tah dolů v obsahu list zavřel`);
  ok((await navIndex(p)) === idx0, `${name}: historie po zavření z obsahu na původním místě`);

  // ── 5. rychlé švihnutí (krátká dráha, vysoká rychlost) zavře ──
  await openFileMenu(p);
  await swipe(p, cdp, cx, hy, hy + 70, { steps: 4, stepMs: 12 });
  await p.waitForTimeout(500);
  ok(!(await sheetOpen(p)), `${name}: rychlé švihnutí dolů (70 px za ~50 ms) list zavřelo`);

  // ── 6. klepnutí na podklad zavře (a klepnutí nepropadne do modelu) ──
  await openFileMenu(p);
  await p.touchscreen.tap(cx, Math.max(20, Math.round(box.y / 2)));
  await p.waitForTimeout(500);
  ok(!(await sheetOpen(p)), `${name}: klepnutí na podklad nad listem list zavřelo`);
  ok((await navIndex(p)) === idx0, `${name}: historie po klepnutí na podklad na původním místě`);

  // ── 7. systémové Zpět zavře list, stránka zůstane (bez nového načtení) ──
  await openFileMenu(p);
  await p.goBack({ timeout: 4000 }).catch(() => null);
  await p.waitForTimeout(700);
  ok(!(await sheetOpen(p)), `${name}: tlačítko Zpět list zavřelo`);
  ok(/\/cad$/.test(new URL(p.url()).pathname) && (await p.evaluate(() => window.__sheetMarker)) === 42, `${name}: po Zpět zůstává CAD bez nového načtení (${p.url()})`);
  ok((await navIndex(p)) === idx0, `${name}: po Zpět je historie na původním místě`);

  // ── 8. Esc zavře ──
  await openFileMenu(p);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await sheetOpen(p)), `${name}: Esc list zavřel`);

  // ── 9. položka nabídky dál funguje klepnutím (gesto nerozbilo klik) ──
  await openFileMenu(p);
  await p.locator(SHEET).getByRole('button', { name: /Příruba DN50/ }).tap();
  await p.waitForTimeout(3500);
  ok(!(await sheetOpen(p)) && (await p.locator('[role=tab]').count()) >= 1 && /Příruba/.test(await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => (t.querySelector('input') ? t.querySelector('input').value : t.textContent)).join('|'))), `${name}: klepnutí na položku (Příruba DN50) ji otevřelo a list zavřelo`);
  ok((await navIndex(p)) === idx0, `${name}: historie po výběru položky na původním místě`);

  // ── 10. panel prvku (Kvádr) je na mobilu spodní list: tažení za záhlaví zavře (= Storno), Zpět zavře ──
  const aside = p.locator('aside[data-bottom-sheet]');
  await p.getByRole('button', { name: 'Kvádr', exact: true }).first().click();
  await aside.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
  ok(await aside.isVisible(), `${name}: panel nového prvku (Kvádr) je spodní list s úchytem`);
  if (await aside.isVisible()) {
    ok((await aside.locator('[data-sheet-handle]').count()) === 1 && (await navIndex(p)) === idx0 + 1, `${name}: panel prvku má úchyt a záznam historie`);
    const ab = await aside.boundingBox();
    const head = await aside.locator('[data-sheet-grip]').nth(1).boundingBox();
    await swipe(p, cdp, Math.round(head.x + head.width * 0.35), Math.round(head.y + head.height / 2), Math.round(head.y + head.height / 2 + ab.height * 0.5), { steps: 14, stepMs: 18 });
    await p.waitForTimeout(600);
    ok(!(await aside.isVisible().catch(() => false)), `${name}: tažení záhlaví panelu prvku dolů panel zavřelo`);
    ok((await navIndex(p)) === idx0, `${name}: historie po zavření panelu na původním místě`);
    await p.getByRole('button', { name: 'Kvádr', exact: true }).first().click();
    await aside.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    await p.goBack({ timeout: 4000 }).catch(() => null);
    await p.waitForTimeout(700);
    ok(!(await aside.isVisible().catch(() => false)) && (await p.evaluate(() => window.__sheetMarker)) === 42, `${name}: Zpět zavřel panel prvku, CAD zůstal`);
    // obsah panelu se dál posouvá / pole jdou upravit – krátké klepnutí do pole tažení nespustí
    await p.getByRole('button', { name: 'Kvádr', exact: true }).first().click();
    await aside.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    const inp = aside.locator('input').first();
    if (await inp.count()) { await inp.tap(); await p.waitForTimeout(200); }
    ok(await aside.isVisible(), `${name}: klepnutí do pole panelu prvku panel nezavřelo`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${S}shots/${tag}-end.png` });
  ok(errs.length === 0, `${name}: bez JS chyb ${errs.join(' | ')}`);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  await phone(b, 'Pixel 7');
  await phone(b, 'iPhone 13');
  // ── počítač: nabídka zůstává rozbalovací (bez listu, bez záznamu historie), panel prvku bez úchytu ──
  const d = await b.newPage({ viewport: { width: 1400, height: 850 } });
  await d.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(d);
  const i0 = await navIndex(d);
  await d.getByRole('button', { name: 'Soubor', exact: true }).click(); await d.waitForTimeout(400);
  ok((await d.locator('[data-cad-menu][role=menu]').count()) === 1 && (await d.locator('[data-bottom-sheet]').count()) === 0, 'počítač: Soubor je rozbalovací nabídka, ne spodní list');
  ok((await navIndex(d)) === i0, 'počítač: rozbalovací nabídka nepřidává záznam historie');
  await d.keyboard.press('Escape'); await d.waitForTimeout(300);
  await d.getByRole('button', { name: 'Kvádr', exact: true }).first().click(); await d.waitForTimeout(800);
  ok((await d.locator('aside[data-bottom-sheet]').count()) === 0 && (await d.locator('[data-sheet-handle]').count()) === 0 && (await navIndex(d)) === i0, 'počítač: panel prvku je boční panel bez úchytu a bez záznamu historie');
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
