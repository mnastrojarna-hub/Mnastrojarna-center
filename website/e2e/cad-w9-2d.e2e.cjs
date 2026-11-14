// E2E: 2D CAD vlny 9 – přejímka „jako nástrojař“ (jádro + balíky edit, annot, layout, io dohromady):
//  1. podklad DWG vytvořený zapisovačem io (window.mncad.draft „export dwg“) → Ctrl+O → 2D výkres v záložce
//  2. hladiny v GUI: vypnout / zapnout, zmrazit / rozmrazit, aktuální; vzdálenost myší s uchopením
//  3. obrys desky čárami (příkazový řádek), zaoblení R10 (pás + kliknutí na úsečky), oblouk, díry, ekvidistanta (pás + klik),
//     ořez (pás + kliknutí na odebírané díly), osy, šrafa ANSI31 kliknutím dovnitř, kóty ISO-25 (lineární myší s uchopením,
//     základnicová, řetězová, průměr a poloměr kliknutím na objekt), MTEXT editorem na místě, GD&T rám
//  4. razítko jako blok s atributy a jeho vložení do rozvržení A3 se dvěma výřezy 1:1 a 2:1
//  5. Ctrl+P → PDF: úsečka 100 mm modelu měří na papíře 100 mm (1:1) a 200 mm (2:1)
//  6. export DWG a DXF z příkazového řádku (stažení) a znovu Ctrl+O – stejné počty entit
//  7. stejný výkres jen textem pro agenty (`2d …` přes window.mncad.draft) – stejné entity, kóty, plocha šrafy, PDF, DWG / DXF
// Spuštění: E2E_BASE=http://localhost:3385 node e2e/cad-w9-2d.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const zlib = require('zlib');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { process.exitCode = 1; fails++; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const r9 = (x) => Math.round(x * 1e9) / 1e9;

/** úsečky obsahu PDF v mm (po „cm“) */
function pdfSegments(buf) {
  const s = buf.toString('latin1');
  const segs = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const len = Number((/\/Length (\d+)/.exec(m[1]) || [])[1] ?? -1);
    let body = Buffer.from(s.slice(start, len >= 0 ? start + len : s.indexOf('endstream', start)), 'latin1');
    if (/FlateDecode/.test(m[1])) { try { body = zlib.inflateSync(body); } catch { continue; } }
    const ops = body.toString('latin1').split('\n');
    for (let i = 1; i < ops.length; i++) {
      const a = /^(-?[\d.]+) (-?[\d.]+) m$/.exec(ops[i - 1]);
      const b = /^(-?[\d.]+) (-?[\d.]+) l$/.exec(ops[i]);
      if (a && b) segs.push([+a[1], +a[2], +b[1], +b[2]]);
    }
  }
  return segs;
}
/** změřená hodnota kóty z definičních bodů (lineární s natočením, průměr, poloměr) */
function dimValue(d) {
  if (d.kind === 'linear') { const a = ((d.rot || 0) * Math.PI) / 180; return Math.abs((d.p2[0] - d.p1[0]) * Math.cos(a) + (d.p2[1] - d.p1[1]) * Math.sin(a)); }
  if (d.kind === 'aligned') return Math.hypot(d.p2[0] - d.p1[0], d.p2[1] - d.p1[1]);
  if (d.kind === 'diameter') return Math.hypot(d.chord[0] - d.far[0], d.chord[1] - d.far[1]);
  if (d.kind === 'radius') return Math.hypot(d.chord[0] - d.center[0], d.chord[1] - d.center[1]);
  return NaN;
}
/** podpis výkresu pro porovnání (počty podle druhu v modelu, rozvržení, bloky, hladiny) */
function sig(m) {
  const by = {};
  for (const e of m.entities) by[e.type] = (by[e.type] || 0) + 1;
  return JSON.stringify({ by: Object.entries(by).sort(), layouts: (m.layouts || []).map((l) => [l.name, l.entities.length]), blocks: (m.blocks || []).filter((b) => !/^\*/.test(b.name)).map((b) => [b.name, b.entities.length]).sort(), layers: m.layers.map((l) => l.name).sort() });
}
/** geometrie modelu zaokrouhlená (bez id) pro porovnání GUI × text */
function geom(m) {
  const g = (e) => {
    const o = {};
    for (const k of ['a', 'b', 'c', 'r', 'a0', 'a1', 'p1', 'p2', 'center', 'chord', 'far', 'pts', 'kind', 'block', 'p']) if (e[k] !== undefined) o[k] = JSON.parse(JSON.stringify(e[k]), (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
    return e.type + ':' + e.layer + ':' + JSON.stringify(o);
  };
  return m.entities.filter((e) => !['hatch', 'mtext', 'tolerance', 'dimension'].includes(e.type)).map(g).sort();
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  p.on('dialog', (dg) => dg.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 180000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 5000 }).catch(() => false)) await c0.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const model = async () => (await doc()).draft;
  const ents = async () => (await model()).entities;
  const draft = (t) => p.evaluate((x) => window.mncad.draft(x), t);
  const waitDoc = (fn, ms = 60000) => p.waitForFunction(fn, null, { timeout: ms, polling: 250 });
  const prompt = async () => (await p.textContent('[data-draft-prompt]').catch(() => '')) || '';
  const logText = async () => (await p.textContent('[data-draft-log]').catch(() => '')) || '';
  /** celý řádek do příkazového řádku (GUI) */
  const cmd = async (text) => {
    // Esc Esc: ukončí rozpracovaný příkaz a zruší výběr (jinak by PICKFIRST použil vybrané objekty)
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.fill('[data-draft-input]', text);
    await p.press('[data-draft-input]', 'Enter');
    await p.waitForTimeout(350);
  };
  /** zadání aktuální výzvy z klávesnice (psaní kamkoli) */
  const type = async (t) => { await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(150); };
  const canvasBox = async () => p.locator('[data-draft-canvas]').boundingBox();
  const scr = async (X, Y) => { const box = await canvasBox(); const v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view')); return [box.x + (X - v.cx) * v.scale + v.w / 2, box.y + v.h / 2 - (Y - v.cy) * v.scale]; };
  /** klik do výkresu na souřadnice modelu (pohyb myši = uchopení se vyhodnotí) */
  const clickAt = async (X, Y) => { const [x, y] = await scr(X, Y); await p.mouse.move(x - 3, y + 3); await p.mouse.move(x, y); await p.waitForTimeout(180); await p.mouse.click(x, y); await p.waitForTimeout(200); };
  const tab = async (id) => { await p.locator(`[data-draft-tab="${id}"]`).click(); await p.waitForTimeout(250); };
  const btn = (label) => p.locator('[data-draft-workspace] [data-ribbon]').getByRole('button', { name: new RegExp('^' + label + '(\\s|$)') }).first();
  /** tlačítko s nabídkou: otevřít nabídku a zvolit položku */
  const menu = async (label, item) => { await btn(label).click(); await p.waitForTimeout(200); await p.locator('[data-cad-menu]').getByRole('button', { name: item }).first().click(); await p.waitForTimeout(200); };
  /** fokus na plátno bez rozpracovaného příkazu (klávesové zkratky pracovní plochy) */
  const focusCanvas = async () => { await p.keyboard.press('Escape'); await p.locator('[data-draft-canvas]').click({ position: { x: 5, y: 5 } }); await p.keyboard.press('Escape'); await p.waitForTimeout(150); };
  const chooser = async (act, what) => {
    for (let i = 0; i < 3; i++) {
      const r = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }), act()]).then(([f]) => f).catch(() => null);
      if (r) return r;
      await p.waitForTimeout(1500);
    }
    throw new Error(`výběr souboru se neotevřel: ${what}`);
  };
  const download = async (act) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), act()]);
    const path = S + dl.suggestedFilename();
    await dl.saveAs(path);
    return path;
  };
  const evidence = {};

  // ── 1. podklad DWG zapisovačem io → Ctrl+O ──
  await p.evaluate(() => window.mncad.run('2d nový Vstup'));
  await p.waitForSelector('[data-draft-workspace]', { timeout: 120000 });
  const src = await p.evaluate(async () => {
    const r = await window.mncad.draft([
      'hladina nová OBRYS barva 7 tloušťka 0.5; hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25; hladina nová KÓTY barva 3; hladina nová ŠRAFY barva 8; hladina nová RAZÍTKO barva 7; hladina nová PODKLAD barva 9',
      'hladina aktuální PODKLAD; obdélník -10,-10 @140,100',
      'hladina aktuální OSY; čára 84,40 96,40; čára 90,34 90,46',
      'hladina aktuální 0',
    ].join('\n'));
    const e = await window.mncad.draft('export dwg verze R2013 název "vstup"');
    return { ok: r.ok && e.ok, b64: e.results[0].data.file.base64, n: r.status.entities };
  });
  fs.writeFileSync(S + 'vstup.dwg', Buffer.from(src.b64, 'base64'));
  ok(src.ok && src.n === 3, `podklad: 6 hladin, polotovar a osy díry zapsány zapisovačem io jako DWG R2013 (${fs.statSync(S + 'vstup.dwg').size} B)`);
  await p.evaluate(() => window.mncad.closeTab());
  await p.waitForTimeout(600);
  await p.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => undefined);
  let fc = await chooser(() => p.keyboard.press('Control+o'), 'Ctrl+O');
  await fc.setFiles(S + 'vstup.dwg');
  await waitDoc(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === 'vstup'; }, 90000);
  await p.click('[data-io-done-close]').catch(() => undefined);
  let m = await model();
  ok(m.entities.length === 3 && ['OBRYS', 'OSY', 'KÓTY', 'ŠRAFY', 'RAZÍTKO', 'PODKLAD'].every((n) => m.layers.some((l) => l.name === n)) && m.layers.find((l) => l.name === 'OSY').linetype === 'CENTER', `Ctrl+O vstup.dwg → 2D výkres: 3 entity, hladiny s barvou a typem čáry (${m.layers.map((l) => l.name).join(', ')})`);
  await draft('zoom okno -30,-100 200,110');
  await p.waitForTimeout(500);

  // ── 2. hladiny v GUI ──
  await tab('layers');
  await btn('Správce hladin').click();
  await p.waitForSelector('[data-layer-panel]');
  await p.locator('[data-layer-row="PODKLAD"] [data-layer-on]').click(); await p.waitForTimeout(300);
  let v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  m = await model();
  ok(m.layers.find((l) => l.name === 'PODKLAD').on === false && v.drawn === 2, `vypnout hladinu PODKLAD: on = false, vykresleno ${v.drawn} entit`);
  await p.locator('[data-layer-row="PODKLAD"] [data-layer-on]').click(); await p.waitForTimeout(200);
  await p.locator('[data-layer-row="OSY"] [data-layer-frozen]').click(); await p.waitForTimeout(300);
  v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  m = await model();
  ok(m.layers.find((l) => l.name === 'OSY').frozen === true && m.layers.find((l) => l.name === 'PODKLAD').on !== false && v.drawn === 1, `zmrazit OSY (a PODKLAD zase zapnutý): vykreslena ${v.drawn} entita`);
  await p.locator('[data-layer-row="OSY"] [data-layer-frozen]').click(); await p.waitForTimeout(200);
  await p.locator('[data-layer-row="OBRYS"] [data-layer-current]').click(); await p.waitForTimeout(300);
  m = await model();
  ok(m.vars.clayer === 'OBRYS' && !m.layers.find((l) => l.name === 'OSY').frozen, 'rozmrazit OSY; aktuální hladina OBRYS kliknutím');
  await p.evaluate(() => document.activeElement && document.activeElement.blur());

  // ── vzdálenost myší s uchopením (konce polotovaru) ──
  await tab('draw');
  await btn('Vzdálenost').click();
  await clickAt(-9.6, -10.3);
  await clickAt(130.4, -9.6);
  await p.waitForTimeout(300);
  const lg = await logText();
  ok(/Vzdálenost = 140[.,]0+/.test(lg), `VZDÁLENOST kliknutím na rohy polotovaru (uchopení konců): ${(/Vzdálenost = [^\n]*/.exec(lg) || [''])[0].slice(0, 80)}`);
  await p.screenshot({ path: S + '2d-open.png' });

  // ── 3. obrys desky ──
  await focusCanvas();
  await p.keyboard.type('l'); await p.keyboard.press('Space');
  for (const t of ['0,0', '120,0', '120,80', '0,80']) await type(t);
  await type('c');
  m = await model();
  const ids0 = m.entities.map((e) => e.id);
  const L = m.entities.filter((e) => e.type === 'line' && e.layer === 'OBRYS');
  ok(L.length === 4 && L[1].b[0] === 120 && L[1].b[1] === 80, `ČÁRA z příkazového řádku: obrys 120 × 80 (4 úsečky na OBRYS)`);
  const [lB, lR, lT, lL] = L.map((e) => e.id);
  // zaoblení R10: pás Úpravy ▸ Zaoblit, Poloměr 10, kliknutí na dvě úsečky (dva rohy)
  await tab('modify');
  await menu('Zaoblit', 'Zaoblit dva objekty');
  ok(/první objekt/i.test(await prompt()), `Zaoblit → výzva „${(await prompt()).slice(0, 60)}“`);
  await type('poloměr'); await type('10');
  await clickAt(120, 60); await clickAt(100, 80);
  await p.waitForTimeout(300);
  await menu('Zaoblit', 'Zaoblit dva objekty');
  await clickAt(20, 80); await clickAt(0, 60);
  await p.waitForTimeout(300);
  m = await model();
  const arcs = m.entities.filter((e) => e.type === 'arc');
  const R = (id) => m.entities.find((e) => e.id === id);
  ok(arcs.length === 2 && arcs.every((a) => a.r === 10) && R(lR).b[1] === 70 && R(lT).a[0] === 110 && R(lT).b[0] === 10 && R(lL).a[1] === 70, `ZAOBLIT R10 kliknutím: oblouky ${JSON.stringify(arcs.map((a) => [a.c, a.a0, a.a1]))}, úsečky zkrácené tečně`);
  // oblouk (výřez dole), díry
  await cmd('oblouk střed 60,0 75,0 45,0');
  await cmd('kružnice 30,40 6');
  await cmd('kružnice 90,40 6');
  // ekvidistanta: pás + vzdálenost + klik na úsečku + klik na stranu
  await btn('Ekvidistanta').click(); await p.waitForTimeout(200);
  await type('5');
  await clickAt(100, 0); await clickAt(100, 30);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  m = await model();
  const off = m.entities.find((e) => e.type === 'line' && e.a[1] === 5 && e.b[1] === 5);
  ok(!!off && off.a[0] === 0 && off.b[0] === 120, `EKVIDISTANTA 5 kliknutím na spodní hranu a stranu: ${JSON.stringify(off && [off.a, off.b])}`);
  // ořez: příčka přes obrys, pás Oříznout, klik na přesahující díly
  await cmd('čára -10,20 130,20');
  await btn('Oříznout').click(); await p.waitForTimeout(200);
  await clickAt(-5, 20); await clickAt(125, 20);
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  m = await model();
  const tr0 = m.entities.find((e) => e.type === 'line' && e.a[1] === 20 && e.b[1] === 20);
  ok(!!tr0 && Math.min(tr0.a[0], tr0.b[0]) === 0 && Math.max(tr0.a[0], tr0.b[0]) === 120, `OŘÍZNOUT (rychlý režim) kliknutím na přesahy: příčka 0…120 (${JSON.stringify(tr0 && [tr0.a, tr0.b])}) ${tr0 && tr0.a[0] === 0 ? '' : (await logText()).slice(-300)}`);
  // osy otvoru
  await cmd('hladina aktuální OSY');
  await cmd('čára 24,40 36,40');
  await cmd('čára 30,34 30,46');
  // šrafa: karta Poznámky ▸ Šrafa, klik dovnitř nad příčkou
  await cmd('hladina aktuální ŠRAFY');
  await tab('annotate');
  await menu('Šrafa', /^ANSI31/);
  await clickAt(60, 60);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  m = await model();
  const h = m.entities.find((e) => e.type === 'hatch');
  const hlog = await logText();
  const harea = Number(((/plocha ([\d.,]+)/.exec(hlog) || [])[1] || 'NaN').replace(',', '.'));
  const expArea = 120 * 60 - 2 * (100 - 25 * Math.PI) - 2 * Math.PI * 36;
  ok(!!h && h.layer === 'ŠRAFY' && h.loops.length === 3 && near(harea, expArea, 1e-3), `ŠRAFA kliknutím dovnitř: ${h && h.pattern}, 3 smyčky (obrys + 2 díry), plocha ${harea} (analyticky ${expArea.toFixed(4)})`);
  evidence.guiHatch = harea;
  // kóty ISO-25
  await cmd('hladina aktuální KÓTY');
  await btn('Lineární').click(); await p.waitForTimeout(200);
  await clickAt(0.4, 0.3); // uchopení konce (0,0)
  await clickAt(30.3, 40.2); // průsečík os
  await clickAt(15, -15);
  await p.waitForTimeout(300);
  await btn('Základnicová').click(); await p.waitForTimeout(200);
  await type('90,40'); await type('120,0');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await btn('Lineární').click(); await p.waitForTimeout(200);
  await type('120,0'); await type('120,40'); await type('140,20');
  await btn('Řetězová').click(); await p.waitForTimeout(200);
  await type('120,80');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await btn('Průměr').click(); await p.waitForTimeout(200);
  await clickAt(30 + 6 * Math.SQRT1_2, 40 - 6 * Math.SQRT1_2);
  await clickAt(30, 55);
  await menu('Poloměr', 'Poloměr');
  await clickAt(10 - 10 * Math.SQRT1_2, 70 + 10 * Math.SQRT1_2);
  await clickAt(-10, 95);
  await p.waitForTimeout(300);
  m = await model();
  let dims = m.entities.filter((e) => e.type === 'dimension');
  const guiDims = dims.map((d) => [d.kind, r9(dimValue(d))]);
  ok(JSON.stringify(guiDims) === JSON.stringify([['linear', 30], ['linear', 90], ['linear', 120], ['linear', 40], ['linear', 40], ['diameter', 12], ['radius', 10]]) && dims.every((d) => d.style === 'ISO-25' && d.layer === 'KÓTY'), `KÓTY ISO-25 (lineární myší s uchopením, základnicová ×2, svislá + řetězová, průměr a poloměr kliknutím): ${JSON.stringify(guiDims)} styl/hladina ${[...new Set(dims.map((d) => d.style + '/' + d.layer))].join(', ')}`);
  evidence.guiDims = guiDims;
  // MTEXT editorem na místě
  await btn('Odstavcový text').click(); await p.waitForTimeout(200);
  await clickAt(130, 80); await clickAt(190, 60);
  await p.waitForSelector('[data-annot-editor]', { timeout: 10000 });
  await p.locator('[data-annot-editor-text]').fill('Neoznačená sražení 1×45°\nDrsnost Ra 3,2');
  await p.locator('[data-annot-editor-ok]').click(); await p.waitForTimeout(400);
  // GD&T rám z příkazového řádku
  await cmd('tolerance poloha ø0.05M A,B 130,40');
  m = await model();
  const mt = m.entities.find((e) => e.type === 'mtext');
  const tol = m.entities.find((e) => e.type === 'tolerance');
  ok(!!mt && /Neoznačená sražení 1×45°\\PDrsnost Ra 3,2/.test(mt.s) && !!tol && /0\.05/.test(tol.s), `MTEXT editorem (2 odstavce: ${mt && JSON.stringify(mt.s)}) a rám GD&T (${tol && JSON.stringify(tol.s)})`);
  await draft('zoom rozsah');
  await p.waitForTimeout(600);
  await p.screenshot({ path: S + '2d-plate.png' });

  // ── 4. razítko jako blok s atributy, rozvržení A3, dva výřezy ──
  await cmd('hladina aktuální RAZÍTKO');
  await cmd('obdélník 0,-60 @80,-20');
  await cmd('definice-atributu NAZEV "Název" "Deska" 2,-68 3.5 0');
  await cmd('definice-atributu CISLO "Číslo výkresu" "V-000" 2,-75 3.5 0');
  await cmd('blok RAZITKO 0,-80 okno -1,-81 81,-59 smazat');
  await cmd('hladina aktuální OBRYS');
  await cmd('čára 0,-30 100,-30');
  m = await model();
  const blk = (m.blocks || []).find((x) => x.name === 'RAZITKO');
  ok(!!blk && blk.entities.filter((e) => e.type === 'attdef').map((e) => e.tag).sort().join() === 'CISLO,NAZEV', `BLOK RAZITKO s atributy NAZEV a CISLO (${blk ? blk.entities.map((e) => e.type).join(', ') : (await logText()).slice(-300)})`);
  await cmd('rozvržení nové Výroba A3 bez-výřezu bez-razítka');
  await p.waitForTimeout(500);
  const lay0 = ((await model()).layouts || []).find((l) => l.name === 'Výroba');
  ok(!!lay0 && await p.locator(`[data-layout-tab="${lay0.id}"]`).isVisible(), 'ROZVRŽENÍ A3 „Výroba“: záložka ve stavovém řádku, zobrazený papír');
  await cmd('výřez 15,35 175,285 1:1');
  await cmd('výřez střed poslední 60,30');
  await cmd('výřez 180,35 410,285 2:1');
  await cmd('výřez střed poslední 50,-30');
  await cmd('vložit RAZITKO 330,8 1 1 0 "V-001" "Deska 120×80"');
  m = await model();
  const lay = m.layouts.find((l) => l.name === 'Výroba');
  const vps = lay.entities.filter((e) => e.type === 'viewport');
  const tb = lay.entities.find((e) => e.type === 'insert' && e.block === 'RAZITKO');
  ok(vps.length === 2 && vps[0].scale === 1 && vps[1].scale === 2 && tb && tb.attribs.find((a) => a.tag === 'NAZEV').value === 'Deska 120×80' && tb.attribs.find((a) => a.tag === 'CISLO').value === 'V-001', `výřezy 1:1 a 2:1 (${vps.map((x) => x.scale + '@' + x.viewCenter).join(' ; ')}), razítko vložené s atributy`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + '2d-layout.png' });

  // ── 5. Ctrl+P → PDF, úsečka 100 mm na papíře 100 / 200 mm ──
  await focusCanvas();
  await p.keyboard.press('Control+p');
  await p.waitForSelector('[data-plot-panel]', { timeout: 10000 });
  const pdfPath = await download(() => p.click('[data-plot-go]'));
  const pdf = fs.readFileSync(pdfPath);
  const segs = pdfSegments(pdf);
  const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
  const lens = vps.map((vp) => {
    const a = [vp.c[0] + (0 - vp.viewCenter[0]) * vp.scale, vp.c[1] + (-30 - vp.viewCenter[1]) * vp.scale];
    const s = segs.find((q) => near(q[0], a[0], 1e-3) && near(q[1], a[1], 1e-3) && near(q[3], a[1], 1e-3));
    return s ? Math.hypot(s[2] - s[0], s[3] - s[1]) : NaN;
  });
  ok(media && near(+media[1], 1190.551181, 1e-5) && near(+media[2], 841.889764, 1e-5), `PDF ${pdfPath.split('/').pop()}: stránka A3 na šířku (${media && media[1]} × ${media && media[2]} pt)`);
  ok(near(lens[0], 100, 1e-6) && near(lens[1], 200, 1e-6), `PDF: úsečka 100 mm modelu měří na papíře ${lens[0]} mm (1:1) a ${lens[1]} mm (2:1)`);
  evidence.guiPdf = lens;

  // ── 6. export DWG a DXF z příkazového řádku a znovu otevřít ──
  const before = await model();
  const dwgPath = await download(() => cmd('export dwg verze R2013 název "Deska-gui"'));
  const dxfPath = await download(() => cmd('export dxf verze R2018 název "Deska-gui"'));
  ok(/\.dwg$/.test(dwgPath) && fs.readFileSync(dwgPath).subarray(0, 6).toString() === 'AC1027' && /\.dxf$/.test(dxfPath) && fs.readFileSync(dxfPath, 'latin1').includes('AC1032'), `EXPORT DWG R2013 (${fs.statSync(dwgPath).size} B) a DXF R2018 (${fs.statSync(dxfPath).size} B) stažením`);
  for (const f of [dwgPath, dxfPath]) {
    const nm = f.split('/').pop().replace(/\.[^.]+$/, '');
    await focusCanvas();
    fc = await chooser(() => p.keyboard.press('Control+o'), 'Ctrl+O ' + f);
    await fc.setFiles(f);
    await waitDoc(`(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === ${JSON.stringify(nm)} && (d.draft.layouts || []).length > 0; })()`, 90000);
    await p.click('[data-io-done-close]').catch(() => undefined);
    const back = await model();
    ok(sig(back) === sig(before) && JSON.stringify(back.entities.filter((e) => e.type === 'dimension').map((d) => r9(dimValue(d)))) === JSON.stringify(guiDims.map((x) => x[1])), `${f.split('/').pop()} znovu otevřen: stejné počty entit (model ${back.entities.length}, rozvržení ${JSON.stringify((back.layouts || []).map((l) => l.entities.length))}, bloky) a hodnoty kót`);
    await p.evaluate(() => window.mncad.closeTab());
    await p.waitForTimeout(500);
  }

  // ── 7. stejný výkres jen textem (agent) ──
  const agent = await p.evaluate(async ({ b64, oldIds }) => {
    const out = { steps: [] };
    await window.mncad.importFile({ name: 'vstup.dwg', base64: b64 }, { as: 'draft' });
    const run = async (t) => { const r = await window.mncad.draft(t); out.steps.push({ t: t.slice(0, 70), ok: r.ok, err: r.results.filter((x) => !x.ok).map((x) => x.error) }); return r; };
    void oldIds;
    await run('hladina PODKLAD vypnout; hladina PODKLAD zapnout; hladina OSY zmrazit; hladina OSY rozmrazit; hladina aktuální OBRYS');
    const dist = await run('vzdálenost -10,-10 130,-10');
    out.dist = dist.results[0].data.distance;
    await run('čára 0,0 120,0 120,80 0,80 uzavřít');
    const st = (await window.mncad.draft('stav')).status;
    void st;
    const ids = window.mncad.getDocument().draft.entities.filter((e) => e.type === 'line' && e.layer === 'OBRYS').map((e) => e.id);
    const [b, r, t, l] = ids;
    await run(`zaoblit poloměr 10 ${r}@120,60 ${t}@100,80`);
    await run(`zaoblit poloměr 10 ${t}@20,80 ${l}@0,60`);
    await run('oblouk střed 60,0 75,0 45,0; kružnice 30,40 6; kružnice 90,40 6');
    await run(`ekvidistanta 5 ${b}@100,0 100,30`);
    const cr = await run('čára -10,20 130,20');
    const xid = cr.results[0].created[0];
    await run(`oříznout ${xid}@-5,20 ${xid}@125,20`);
    await run('hladina aktuální OSY; čára 24,40 36,40; čára 30,34 30,46');
    const hr = await run('hladina aktuální ŠRAFY; šrafa 60,60');
    out.hatch = hr.results[1].data.area;
    await run('hladina aktuální KÓTY; kóta-lineární 0,0 30,40 15,-15; kóta-základnicová 90,40; kóta-základnicová 120,0');
    await run('kóta-lineární 120,0 120,40 140,20; kóta-řetězová 120,80');
    const holes = window.mncad.getDocument().draft.entities.filter((e) => e.type === 'circle');
    const arcs = window.mncad.getDocument().draft.entities.filter((e) => e.type === 'arc' && e.r === 10 && e.c[0] === 10);
    await run(`kóta-průměr ${holes[0].id} 30,55; kóta-poloměr ${arcs[0].id} -10,95`);
    await run('mtext 130,80 @60,-20 "Neoznačená sražení 1×45°\\PDrsnost Ra 3,2"; tolerance poloha ø0.05M A,B 130,40');
    await run('hladina aktuální RAZÍTKO; obdélník 0,-60 @80,-20');
    await run('definice-atributu NAZEV "Název" "Deska" 2,-68 3.5 0; definice-atributu CISLO "Číslo výkresu" "V-000" 2,-75 3.5 0');
    await run('blok RAZITKO 0,-80 okno -1,-81 81,-59 smazat; hladina aktuální OBRYS; čára 0,-30 100,-30');
    await run('rozvržení nové Výroba A3 bez-výřezu bez-razítka; výřez 15,35 175,285 1:1; výřez střed poslední 60,30; výřez 180,35 410,285 2:1; výřez střed poslední 50,-30');
    await run('vložit RAZITKO 330,8 1 1 0 "V-001" "Deska 120×80"');
    const pl = await run('tisk mono název Deska');
    out.pdf = pl.results[0].data.file.base64;
    const dw = await run('export dwg verze R2013 název "Deska"');
    const dx = await run('export dxf verze R2018 název "Deska"');
    out.dwg = dw.results[0].data.file.base64;
    out.dxf = dx.results[0].data.file.text;
    out.model = window.mncad.getDocument().draft;
    for (const [nm, f] of [['a.dwg', { base64: out.dwg }], ['a.dxf', { text: out.dxf }]]) {
      const r = await window.mncad.draftImport({ name: nm, ...f });
      out[nm] = r.ok ? window.mncad.getDocument().draft : null;
      window.mncad.closeTab();
    }
    return out;
  }, { b64: src.b64, oldIds: ids0 });
  const bad = agent.steps.filter((s) => !s.ok);
  ok(!bad.length, `agent: ${agent.steps.length} řádků „2d …“ bez chyby (${JSON.stringify(bad).slice(0, 300)})`);
  ok(agent.dist === 140, `agent: vzdálenost polotovaru ${agent.dist}`);
  const am = agent.model;
  ok(sig(am) === sig(before), `agent × GUI: stejné druhy a počty entit, rozvržení, bloky a hladiny (${sig(am).slice(0, 160)}…)`);
  ok(JSON.stringify(geom(am)) === JSON.stringify(geom(before)), `agent × GUI: stejná geometrie úseček, oblouků, kružnic a vložení (${geom(am).length} entit)`);
  const agentDims = am.entities.filter((e) => e.type === 'dimension').map((d) => [d.kind, r9(dimValue(d))]);
  ok(JSON.stringify(agentDims) === JSON.stringify(evidence.guiDims), `agent × GUI: kóty ${JSON.stringify(agentDims)}`);
  ok(near(agent.hatch, evidence.guiHatch, 1e-3), `agent × GUI: plocha šrafy ${agent.hatch.toFixed(4)} = ${evidence.guiHatch}`);
  const aseg = pdfSegments(Buffer.from(agent.pdf, 'base64'));
  const avps = am.layouts.find((l) => l.name === 'Výroba').entities.filter((e) => e.type === 'viewport');
  const alens = avps.map((vp) => {
    const a = [vp.c[0] + (0 - vp.viewCenter[0]) * vp.scale, vp.c[1] + (-30 - vp.viewCenter[1]) * vp.scale];
    const s = aseg.find((q) => near(q[0], a[0], 1e-3) && near(q[1], a[1], 1e-3) && near(q[3], a[1], 1e-3));
    return s ? Math.hypot(s[2] - s[0], s[3] - s[1]) : NaN;
  });
  ok(near(alens[0], 100, 1e-6) && near(alens[1], 200, 1e-6), `agent: PDF úsečka ${alens[0]} mm (1:1) a ${alens[1]} mm (2:1)`);
  ok(agent['a.dwg'] && sig(agent['a.dwg']) === sig(am) && agent['a.dxf'] && sig(agent['a.dxf']) === sig(am), 'agent: DWG a DXF zpět – stejné počty entit (model, rozvržení, bloky, hladiny)');

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  console.log(`hotovo: ${fails ? fails + ' chyb' : 'vše ok'}`);
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exit(1); });
