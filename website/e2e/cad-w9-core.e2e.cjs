// E2E: 2D CAD – jádro (vlna 9, fáze A): nový 2D výkres ze Souboru, kreslení myší s psanými souřadnicemi a uchopením,
// příkazový řádek (psaní kamkoli, mezera = Enter, Esc), hladiny v GUI (nová, barva ACI, vypnout), panel vlastností,
// textové příkazy `2d …` a window.mncad.draft (strukturované výsledky), zpět, uložení a znovuotevření .mncad,
// DXF export → import (hladiny), 20 000 entit (vykreslení).
// Spuštění (server na :3100): E2E_BASE=http://localhost:3100 node e2e/cad-w9-core.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 120000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const ents = async () => (await doc()).draft.entities;

  // ── nový 2D výkres ze Souboru ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByText('Nový 2D výkres', { exact: true }).first().click();
  await p.waitForSelector('[data-draft-workspace]', { timeout: 90000 });
  await p.waitForTimeout(800);
  let d = await doc();
  ok(d.kind === 'draft' && d.draft.layers[0].name === '0' && d.draft.vars.units === 'mm', `Soubor → Nový 2D výkres: dokument druhu draft, hladina 0, mm (${d.kind}, ${d.draft && d.draft.vars.units})`);
  const tabs = await p.evaluate(() => window.mncad.tabs());
  ok(tabs.some((t) => t.kind === 'draft' && t.active), 'záložka 2D výkresu je aktivní');
  ok(await p.locator('[data-draft-tab="draw"]').isVisible() && await p.locator('[data-draft-tab="output"]').isVisible(), 'vlastní pás karet: Kreslení … Výstup');

  // ── úsečky psanými souřadnicemi (příkazový řádek) ──
  await p.locator('[data-draft-canvas]').click({ position: { x: 20, y: 20 } }); // fokus do plátna, prázdný klik = začátek okna
  await p.keyboard.press('Escape');
  await p.keyboard.type('l');
  await p.keyboard.press('Space');
  ok((await p.textContent('[data-draft-prompt]')).includes('první bod'), 'psaní kamkoli: „l“ + mezera spustí ČÁRU a ukáže výzvu');
  for (const t of ['0,0', '100,0', '@0,50', '@-100,0']) {
    await p.keyboard.type(t);
    await p.keyboard.press('Enter');
  }
  await p.keyboard.type('c'); // klíčové slovo Uzavřít
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  let e = await ents();
  ok(e.length === 4 && e[0].b[0] === 100 && e[2].b[0] === 0 && e[2].b[1] === 50 && e[3].b[0] === 0 && e[3].b[1] === 0, `ČÁRA 0,0 100,0 @0,50 @-100,0 Uzavřít → 4 úsečky přesně (${JSON.stringify(e.map((x) => [x.a, x.b]))})`);

  // přepočet souřadnic výkresu na obrazovku (atribut data-view plátna)
  await p.evaluate(() => window.mncad.draft('zoom okno -20,-20 140,80'));
  await p.waitForTimeout(500);
  const box = await p.locator('[data-draft-canvas]').boundingBox();
  const scr = async (X, Y) => { const v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view')); return [box.x + (X - v.cx) * v.scale + v.w / 2, box.y + v.h / 2 - (Y - v.cy) * v.scale]; };

  // ── uchopení: klik vedle koncového bodu = přesně koncový bod; kružnice ze středu uchopeného na průsečík ──
  await p.locator('[data-draft-workspace] [data-ribbon] button').filter({ hasText: 'Úsečka' }).first().click();
  let [x, y] = await scr(100.6, 49.4);
  await p.mouse.move(x - 5, y + 5); await p.mouse.move(x, y); await p.waitForTimeout(250);
  await p.screenshot({ path: S + 'w9-snap.png' });
  await p.mouse.click(x, y);
  [x, y] = await scr(49.6, 0.5);
  await p.mouse.move(x, y); await p.waitForTimeout(250);
  await p.mouse.click(x, y);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  e = await ents();
  const l5 = e[4];
  ok(l5 && l5.a[0] === 100 && l5.a[1] === 50 && l5.b[0] === 50 && l5.b[1] === 0, `uchopení: koncový bod (100,50) a polovina (50,0) přesně (${JSON.stringify(l5 && [l5.a, l5.b])})`);
  await p.keyboard.type('kruznice');
  await p.keyboard.press('Space');
  await p.keyboard.type('50,25'); await p.keyboard.press('Enter');
  await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  e = await ents();
  ok(e[5] && e[5].type === 'circle' && e[5].r === 20 && e[5].c[0] === 50, 'KRUŽNICE 50,25 20 z příkazového řádku (česky bez diakritiky)');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
  ok((await ents()).length === 5, 'Ctrl+Z vrátí celý poslední příkaz');
  await p.keyboard.press('Control+y'); await p.waitForTimeout(400);
  ok((await ents()).length === 6, 'Ctrl+Y ho obnoví');

  // ── hladiny v GUI ──
  await p.locator('[data-draft-tab="layers"]').click();
  await p.getByRole('button', { name: /Správce hladin/ }).first().click();
  await p.waitForSelector('[data-layer-panel]');
  await p.locator('[data-layer-new]').click();
  await p.waitForTimeout(200);
  await p.keyboard.type('OSY'); await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  await p.locator('[data-layer-row="OSY"] [data-layer-color]').click();
  await p.locator('[data-aci="1"]').first().click();
  await p.locator('[data-layer-row="OSY"] [data-layer-lt]').selectOption('CENTER');
  await p.locator('[data-layer-row="OSY"] [data-layer-current]').click();
  await p.waitForTimeout(300);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  d = await doc();
  const osy = d.draft.layers.find((l) => l.name === 'OSY');
  ok(osy && osy.color === 1 && osy.linetype === 'CENTER' && d.draft.vars.clayer === 'OSY', `správce hladin: nová OSY, barva ACI 1, CENTER, aktuální (${JSON.stringify(osy)})`);
  await p.keyboard.type('l'); await p.keyboard.press('Space');
  for (const t of ['-10,25', '110,25']) { await p.keyboard.type(t); await p.keyboard.press('Enter'); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  e = await ents();
  ok(e[e.length - 1].layer === 'OSY', 'nová úsečka je na aktuální hladině OSY');
  await p.locator('[data-layer-row="0"] [data-layer-on]').click(); await p.waitForTimeout(300);
  ok((await doc()).draft.layers.find((l) => l.name === '0').on === false, 'vypnutí hladiny 0 tlačítkem');
  await p.screenshot({ path: S + 'w9-layers.png' });
  await p.locator('[data-layer-row="0"] [data-layer-on]').click(); await p.waitForTimeout(200);

  // ── výběr kliknutím a panel vlastností ──
  await p.locator('[data-draft-panel] button', { hasText: 'Vlastnosti' }).first().click();
  [x, y] = await scr(25, 0);
  await p.mouse.click(x, y); await p.waitForTimeout(300);
  ok((await p.getAttribute('[data-props-panel]', 'data-props-panel')) === '1', 'klik na úsečku ji vybere a panel vlastností ukáže 1 entitu');
  await p.locator('[data-prop-layer]').selectOption('OSY'); await p.waitForTimeout(300);
  ok((await ents())[0].layer === 'OSY', 'panel vlastností: změna hladiny vybrané úsečky');
  await p.evaluate(() => document.activeElement && document.activeElement.blur());

  // ── textové příkazy a window.mncad.draft ──
  const log = await p.evaluate(() => window.mncad.run('2d hladina nová TEXT barva 3\n2d hladina aktuální TEXT\n2d text 0,60 5 0 "Deska 100×50"\n2d stav'));
  ok(/Text: e\d+/.test(log) && /Hladiny \(3\), aktuální: TEXT/.test(log), 'textové příkazy 2d: hladina, text, stav v protokolu');
  const r = await p.evaluate(() => window.mncad.draft('vzdálenost e1.start e1.end; plocha objekt e6; kružnice x(e5,e7) 5; vyber typ circle'));
  console.log('   draft:', JSON.stringify({ ok: r.ok, d: r.results[0].data, a: r.results[1].data, c: r.results[2].created, sel: r.status && r.status.selection, log: r.log.slice(0, 300) }));
  ok(r.ok && r.results[0].data.distance === 100 && near(r.results[1].data.area, Math.PI * 400, 1e-6) && r.results[2].created.length === 1 && r.status.selection.length === 2, `window.mncad.draft: vzdálenost 100, plocha kružnice, kružnice v průsečíku, výběr 2 (${JSON.stringify(r.results.map((q) => [q.cmd, q.ok, q.error]))})`);
  const bad = await p.evaluate(() => window.mncad.draft('kružnice 0,0 abc'));
  ok(!bad.ok && /abc/.test(bad.results[0].error), 'chybné zadání vrátí ok: false s důvodem');
  const en = await p.evaluate(() => window.mncad.run('draft circle 200,0 10\nzeichnen kreis 230,0 10'));
  ok(/Kružnice: e\d+/.test(en) && (await ents()).filter((q) => q.type === 'circle').length === 4, 'předpony draft (en) a zeichnen (de)');

  // ── uložení a znovuotevření .mncad ──
  const f = await p.evaluate(() => window.mncad.exportFile('mncad'));
  const json = Buffer.from(f.base64, 'base64').toString('utf8');
  const saved = JSON.parse(json);
  ok(saved.kind === 'draft' && saved.draft.entities.length === (await ents()).length, `.mncad obsahuje 2D výkres (${saved.draft.entities.length} entit)`);
  await p.evaluate((j) => window.mncad.setDocument(j), json);
  await p.waitForTimeout(1200);
  d = await doc();
  ok(d.kind === 'draft' && d.draft.entities.length === saved.draft.entities.length && d.draft.layers.map((l) => l.name).join() === saved.draft.layers.map((l) => l.name).join() && await p.locator('[data-draft-workspace]').isVisible(), 'znovuotevřený .mncad v nové záložce: stejné entity a hladiny, 2D pracovní plocha');

  // ── DXF export → import (hladiny) ──
  await p.evaluate(() => window.mncad.draft('hladina OSY vypnout; hladina nová SKRYTE barva #336699 typčáry HIDDEN tloušťka 0.35 zamknout'));
  const ex = await p.evaluate(() => window.mncad.draft('export dxf'));
  const file = ex.results[0].data.file;
  ok(file && /\.dxf$/.test(file.name) && file.text.includes('SKRYTE'), `export DXF (${file && file.bytes} B)`);
  const imp = await p.evaluate((t) => window.mncad.draftImport({ name: 'zpet.dxf', text: t }), file.text);
  await p.waitForTimeout(1200);
  const L = (n) => imp.status.layers.find((l) => l.name === n);
  ok(imp.ok && L('OSY') && L('OSY').color === 1 && L('OSY').linetype === 'CENTER' && L('OSY').on === false && L('SKRYTE').color === '#336699' && L('SKRYTE').linetype === 'HIDDEN' && L('SKRYTE').lineweight === 0.35 && L('SKRYTE').locked && L('TEXT').color === 3, `DXF zpět: hladiny (barva ACI i pravá, typ čáry, tloušťka, vypnutá, zamčená) (${JSON.stringify(imp.status.layers.map((l) => [l.name, l.color, l.linetype, l.on, l.locked]))})`);
  d = await doc();
  ok(d.kind === 'draft' && d.name === 'zpet' && d.draft.entities.length === saved.draft.entities.length, `import DXF otevřel nový 2D výkres se všemi entitami (${d.draft.entities.length})`);

  // ── 20 000 entit ──
  const big = await p.evaluate(async () => {
    const lines = ['nový Velký'];
    for (let i = 0; i < 20000; i++) lines.push(`čára ${(i % 200) * 10},${Math.floor(i / 200) * 10} @8,6`);
    const t0 = performance.now();
    const r = await window.mncad.draft(lines.join('\n'));
    return { ms: performance.now() - t0, n: r.status.entities, ok: r.ok };
  });
  ok(big.ok && big.n === 20000, `20 000 úseček skriptem za ${Math.round(big.ms)} ms`);
  await p.evaluate(() => window.mncad.draft('zoom rozsah'));
  await p.waitForTimeout(1500);
  const v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  console.log('   view:', JSON.stringify(v));
  ok(v.drawn === 20000 && v.ms < 400, `vykreslení 20 000 entit: ${v.ms} ms (cíl < 400 ms na sdíleném stroji)`);
  // posun kolečkem = nové vykreslení
  const t1 = Date.now();
  await p.mouse.move(box.x + 400, box.y + 300);
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(60); }
  await p.waitForTimeout(400);
  const v2 = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  ok(v2.scale > v.scale && v2.ms < 400, `zoom kolečkem: měřítko ${v.scale.toFixed(3)} → ${v2.scale.toFixed(3)}, snímek ${v2.ms} ms (${Date.now() - t1} ms celkem)`);
  await p.screenshot({ path: S + 'w9-20k.png' });

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exit(1); });
