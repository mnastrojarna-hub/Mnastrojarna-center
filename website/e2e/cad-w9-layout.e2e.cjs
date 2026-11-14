// E2E: 2D CAD – balík 3 (layout): blok z výběru (pás karet + příkazový řádek), vložení s atributy, rozvržení A3
// s rámečkem a razítkem (záložka ve stavovém řádku, papír pod entitami), poklepání do výřezu = modelový prostor (kreslení
// v modelu), zpět na papír, měřítko výřezu v panelu Vzhled stránky, zmrazení hladiny ve výřezu, úprava atributů
// razítka poklepáním, úprava bloku (pruh Uložit), Ctrl+P = panel Tisk s náhledem, tisk PDF textem – velikost stránky A3
// a délka čáry na papíře = délka v modelu × měřítko (rozbalení obsahu PDF v prohlížeči), EXPORT-PDF, PNG.
// Spuštění (server na :3100): E2E_BASE=http://localhost:3100 node e2e/cad-w9-layout.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 }, acceptDownloads: true });
  const p = await ctx.newPage();
  // headless: ukládání přes dotaz na název a stažení (bez systémového dialogu File System Access)
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 120000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const draft = (t) => p.evaluate((x) => window.mncad.draft(x), t);
  // celý řádek do příkazového řádku (mezera v GUI = Enter, proto vyplnit a potvrdit)
  const cmd = async (text) => {
    await p.keyboard.press('Escape');
    await p.fill('[data-draft-input]', text);
    await p.press('[data-draft-input]', 'Enter');
    await p.waitForTimeout(300);
  };

  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByText('Nový 2D výkres', { exact: true }).first().click();
  await p.waitForSelector('[data-draft-workspace]', { timeout: 90000 });
  await p.waitForTimeout(600);

  // ── model: obrys 1000 × 500 na hladině OBRYS (0,5 mm), osy, šroub ──
  let r = await draft('hladina nová OBRYS tloušťka 0.5; hladina nová OSY barva 1 typčáry CENTER; hladina aktuální OBRYS; obdélník 0,0 @1000,500; kružnice 500,250 100; hladina aktuální OSY; čára 500,100 500,400; hladina aktuální OBRYS');
  ok(r.ok, `model textem (${r.ok ? '' : r.log})`);

  // ── blok z výběru: pás Bloky → Vytvořit blok, výzvy na příkazovém řádku ──
  await draft('kružnice 100,100 10; čára 90,100 110,100');
  await draft('vyber poslední'); // vybere jen čáru (poslední příkaz) – výběr doplníme oknem textem
  await draft('vyber okno 85,85 115,115');
  await p.locator('[data-draft-tab="blocks"]').click();
  await p.locator('[data-draft-workspace] [data-ribbon] button').filter({ hasText: 'Vytvořit blok' }).first().click();
  await p.waitForTimeout(200);
  ok((await p.textContent('[data-draft-prompt]')).includes('název bloku'), 'Vytvořit blok → výzva „Zadejte název bloku“');
  await p.keyboard.type('SROUB'); await p.keyboard.press('Enter');
  await p.keyboard.type('100,100'); await p.keyboard.press('Enter');
  await p.keyboard.press('Enter'); // Převést (výchozí)
  await p.waitForTimeout(400);
  let d = await doc();
  const blk = (d.draft.blocks || []).find((x) => x.name === 'SROUB');
  ok(blk && blk.entities.length === 2 && d.draft.entities.some((e) => e.type === 'insert' && e.block === 'SROUB'), `blok SROUB ze 2 entit, objekty nahrazeny vložením (${blk && blk.entities.length})`);
  // vložení příkazovým řádkem: VLOŽIT SROUB 900,100 (měřítko 2, natočení 90)
  await cmd('vložit SROUB 900,100 2 2 90');
  d = await doc();
  const ins = d.draft.entities.filter((e) => e.type === 'insert');
  ok(ins.length === 2 && ins[1].sx === 2 && ins[1].rot === 90, `VLOŽIT z příkazového řádku: 2. vložení (sx ${ins[1] && ins[1].sx}, rot ${ins[1] && ins[1].rot})`);

  // ── rozvržení A3 z pásu karet ──
  await p.locator('[data-draft-tab="layout"]').click();
  await p.locator('[data-draft-workspace] [data-ribbon] button').filter({ hasText: 'Nové rozvržení' }).first().click();
  await p.locator('[data-cad-menu] button').filter({ hasText: 'A3 s rámečkem a razítkem' }).first().click();
  await p.waitForTimeout(800);
  d = await doc();
  const lay = (d.draft.layouts || [])[0];
  ok(lay && lay.paper.size === 'A3' && lay.paper.w === 420 && lay.paper.h === 297, `Nové rozvržení: A3 420 × 297 (${lay && JSON.stringify(lay.paper)})`);
  const vp0 = lay && lay.entities.find((e) => e.type === 'viewport');
  ok(!!vp0 && Math.abs(vp0.scale - 0.2) < 1e-12, `výřez s měřítkem ISO 1:5 (${vp0 && vp0.scale})`);
  ok((await p.getAttribute(`[data-layout-tab="${lay.id}"]`, 'data-active')) === '1', 'záložka rozvržení ve stavovém řádku je aktivní');
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + 'w9-layout-sheet.png' });
  const view = async () => JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  const box = await p.locator('[data-draft-canvas]').boundingBox();
  const scr = async (X, Y) => { const v = await view(); return [box.x + (X - v.cx) * v.scale + v.w / 2, box.y + v.h / 2 - (Y - v.cy) * v.scale]; };
  let v = await view();
  ok(v.scale > 1 && v.scale < 4 && Math.abs(v.cx - 210) < 15, `pohled na celý list (scale ${v.scale.toFixed(2)} px/mm, střed ${v.cx.toFixed(0)},${v.cy.toFixed(0)})`);
  // papír: pixel uprostřed listu mimo výřez je jiný než okolí listu
  const px = await p.evaluate(([x, y]) => { const cv = document.querySelector('[data-draft-canvas] canvas'); const r = cv.getBoundingClientRect(); const k = cv.width / r.width; const g = cv.getContext('2d'); const a = g.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data; const o = g.getImageData(3, 3, 1, 1).data; return [Array.from(a), Array.from(o)]; }, await scr(15, 150));
  ok(px[0].join() !== px[1].join(), `papír listu pod entitami (list ${px[0].slice(0, 3)} ≠ okolí ${px[1].slice(0, 3)})`);

  // ── poklepání do výřezu = modelový prostor, kreslení v modelu, poklepání mimo = papír ──
  const vc = await scr(vp0.c[0] + vp0.w * 0.3, vp0.c[1] + vp0.h * 0.3);
  await p.mouse.dblclick(vc[0], vc[1]);
  await p.waitForTimeout(500);
  ok(await p.locator('[data-mspace-badge]').isVisible(), 'poklepání do výřezu → MODEL ve výřezu (stavový řádek)');
  await p.screenshot({ path: S + 'w9-layout-mspace.png' });
  const nModel = (await doc()).draft.entities.length;
  await cmd('čára 0,600 1000,600');
  await p.press('[data-draft-input]', 'Enter'); // konec ČÁRY
  await p.waitForTimeout(300);
  d = await doc();
  ok(d.draft.entities.length === nModel + 1 && d.draft.entities[d.draft.entities.length - 1].b[0] === 1000, 'v modelovém prostoru výřezu se kreslí do modelu (souřadnice modelu)');
  // poklepání vlevo dole (mimo výřez, na okraji listu) → papír
  await p.mouse.dblclick(box.x + 12, box.y + box.height - 12);
  await p.waitForTimeout(500);
  ok(await p.locator('[data-pspace-badge]').isVisible(), 'poklepání mimo výřez → zpět na papír');

  // ── panel Vzhled stránky: měřítko výřezu 1:10, zmrazení hladiny OSY ve výřezu ──
  await p.locator('[data-draft-workspace] [data-ribbon] button').filter({ hasText: 'Vzhled stránky' }).first().click();
  await p.waitForSelector('[data-pagesetup-panel]');
  await p.selectOption(`[data-vp-scale="${vp0.id}"]`, '1:10');
  await p.waitForTimeout(300);
  d = await doc();
  let vp = d.draft.layouts[0].entities.find((e) => e.id === vp0.id);
  ok(vp.scale === 0.1, `panel: měřítko výřezu 1:10 (${vp.scale})`);
  await p.locator(`[data-vp-row="${vp0.id}"] button`).filter({ hasText: 'Hladiny' }).click();
  await p.locator(`[data-vp-freeze="${vp0.id}:OSY"]`).check();
  await p.waitForTimeout(400);
  d = await doc();
  vp = d.draft.layouts[0].entities.find((e) => e.id === vp0.id);
  ok(JSON.stringify(vp.frozenLayers) === '["OSY"]', `zmrazení hladiny OSY jen ve výřezu (${JSON.stringify(vp.frozenLayers)})`);
  await p.locator(`[data-vp-lock="${vp0.id}"]`).check();
  await p.waitForTimeout(300);
  r = await draft(`nastavit ${vp0.id} scale=1:20`);
  ok(!r.ok && /zamčen/.test(r.log), 'zamčený výřez: změna měřítka odmítnuta');

  // ── razítko: poklepání → panel Atributy → NAZEV ──
  d = await doc();
  const tb = d.draft.layouts[0].entities.find((e) => e.type === 'insert' && e.block === 'ISO7200_TITLE');
  const tpt = await scr(tb.p[0] - 100, tb.p[1] + 25.5); // svislá čára razítka x = 55 od levého okraje razítka
  await p.mouse.dblclick(tpt[0], tpt[1]);
  await p.waitForTimeout(500);
  const attPanel = await p.locator('[data-attribs-panel]').isVisible().catch(() => false);
  ok(attPanel, 'poklepání na razítko → panel Atributy');
  if (attPanel) {
    await p.fill('[data-att="NAZEV"]', 'Rám stroje');
    await p.click('[data-att-apply]');
    await p.waitForTimeout(400);
    d = await doc();
    const tb2 = d.draft.layouts[0].entities.find((e) => e.id === tb.id);
    ok(tb2.attribs.find((a) => a.tag === 'NAZEV').value === 'Rám stroje', 'atribut NAZEV razítka upraven panelem');
  }

  // ── úprava bloku: UPRAVIT-BLOK → pruh → Uložit ──
  await p.locator('[data-layout-tab="model"]').click();
  await p.waitForTimeout(300);
  await cmd('upravit-blok SROUB');
  ok(await p.locator('[data-bedit-bar]').isVisible(), 'úprava bloku: žlutý pruh ve stavovém řádku');
  await cmd('kružnice 100,100 4');
  await p.locator('[data-bedit-bar] button').filter({ hasText: 'Uložit' }).click();
  await p.waitForTimeout(400);
  d = await doc();
  ok(d.draft.blocks.find((x) => x.name === 'SROUB').entities.length === 3 && !(await p.locator('[data-bedit-bar]').isVisible()), 'Uložit: blok má 3 entity, zpět v modelu');

  // ── Ctrl+P = panel Tisk s náhledem ──
  await p.locator(`[data-layout-tab="${lay.id}"]`).click();
  await p.waitForTimeout(400);
  await p.locator('[data-draft-canvas]').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+p');
  await p.waitForTimeout(800);
  ok(await p.locator('[data-plot-panel]').isVisible(), 'Ctrl+P → panel Tisk');
  const prevH = await p.evaluate(() => document.querySelector('[data-plot-preview]').height);
  ok(prevH > 50, `náhled tisku vykreslen (${prevH} px)`);
  ok(/A3|420/.test(await p.textContent('[data-plot-info]')), `náhled: ${await p.textContent('[data-plot-info]')}`);
  await p.screenshot({ path: S + 'w9-layout-plot.png' });
  const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await p.click('[data-plot-go]');
  const file = await dl;
  ok(!!file && /\.pdf$/.test(file.suggestedFilename()), `Tisk PDF z panelu → soubor ${file && file.suggestedFilename()}`);

  // ── PDF textem: velikost stránky a délka čáry na papíře (1000 mm × 1:10 = 100 mm) ──
  r = await draft('tisk rozvržení ' + JSON.stringify(lay.name) + ' mono');
  const f = r.results[0] && r.results[0].data && r.results[0].data.file;
  ok(r.ok && f && f.mime === 'application/pdf', 'tisk textem → PDF v results[].data.file');
  const chk = await p.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const txt = new TextDecoder('latin1').decode(bin);
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt);
    const m = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(txt);
    const start = m.index + m[0].length;
    const ds = new Blob([bin.subarray(start, start + Number(m[1]))]).stream().pipeThrough(new DecompressionStream('deflate'));
    const content = await new Response(ds).text();
    // nejdelší vodorovná úsečka „x y m X y l“
    let best = 0;
    for (const mm of content.matchAll(/(-?[\d.]+) (-?[\d.]+) m\n(-?[\d.]+) (-?[\d.]+) l/g)) {
      const dx = Number(mm[3]) - Number(mm[1]);
      const dy = Number(mm[4]) - Number(mm[2]);
      if (Math.abs(dy) < 1e-9) best = Math.max(best, Math.abs(dx));
    }
    return { w: Number(media[1]), h: Number(media[2]), lens: [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) m\n(-?[\d.]+) \2 l/g)].map((x) => Math.abs(Number(x[3]) - Number(x[1]))), best, lw: /0\.5 w/.test(content), font: /\/FontFile2/.test(txt) };
  }, f.base64);
  ok(Math.abs(chk.w - 1190.551181) < 1e-6 && Math.abs(chk.h - 841.889764) < 1e-6, `PDF stránka A3 v bodech (${chk.w} × ${chk.h})`);
  ok(chk.lens.some((x) => Math.abs(x - 100) < 1e-6), `čára 1000 mm ve výřezu 1:10 = 100 mm na papíře (délky: ${chk.lens.filter((x) => x > 50).slice(0, 6).map((x) => x.toFixed(6)).join(', ')})`);
  ok(chk.lw && chk.font, 'PDF: tloušťka 0,5 mm a vložené písmo');
  r = await draft('export-pdf');
  ok(r.ok && r.results[0].data.plot.length === 1, 'EXPORT-PDF všech rozvržení');
  r = await draft('tisk png dpi 72');
  ok(r.ok && r.results[0].data.file.mime === 'image/png' && atob(r.results[0].data.file.base64).startsWith('\x89PNG'), 'tisk PNG (72 DPI)');
  ok(errs.length === 0, `bez chyb stránky (${errs.join(' | ')})`);
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
