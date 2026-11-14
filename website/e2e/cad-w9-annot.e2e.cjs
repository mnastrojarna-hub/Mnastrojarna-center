// E2E: 2D CAD – balík 2 (annot): kóty, MTEXT s editorem na místě, šrafa vnitřním bodem, odkaz, tolerance, značka
// drsnosti, kótovací styly v panelu, měřítko poznámek, poklepání = úprava textu, textové příkazy `2d …` a
// window.mncad.draft (strukturované výsledky), zpět / znovu.
// Spuštění (server na :3382): E2E_BASE=http://localhost:3382 node e2e/cad-w9-annot.e2e.cjs <složka>
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
  const cerr = []; p.on('console', (m) => { if (m.type() === 'error') cerr.push(m.text().slice(0, 200)); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const ents = async () => (await doc()).draft.entities;
  const draft = (t) => p.evaluate((x) => window.mncad.draft(x), t);

  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByText('Nový 2D výkres', { exact: true }).first().click();
  await p.waitForSelector('[data-draft-workspace]', { timeout: 90000 });
  await p.waitForTimeout(800);

  // ── textem: geometrie, kóty, šrafa, odkaz, tolerance, značka (agent) ──
  let r = await draft('obdélník 0,0 100,50; kružnice 50,25 10; kóta-lineární 0,0 100,0 50,-15; kóta-průměr e2 70,40; kótovací-styl nový Přesný z ISO-25 dimdec 3 dimzin 0; kóta-lineární 0,50 100,50 50,65');
  const dims = r.results.filter((x) => x.cmd === 'DIMLINEAR' || x.cmd === 'DIMDIAMETER');
  ok(r.ok && dims.length === 3, `kóty textem: ${JSON.stringify(r.results.map((x) => [x.cmd, x.ok, x.error]))}`);
  const meas = dims.map((x) => x.data && x.data.measurement);
  ok(near(meas[0], 100) && near(meas[1], 20) && near(meas[2], 100), `naměřené hodnoty v data.measurement: ${JSON.stringify(meas)}`);
  ok(/✓ Kóta e\d+ \(linear\): 100,000/.test(String(r.log)), `styl DIMDEC 3 DIMZIN 0 → „100,000“ (${String(r.log).split('\n').filter((l) => /Kóta/.test(l)).join(' | ')})`);
  r = await draft('šrafa vzor ANSI31 5,5; odkaz 100,50 120,70 "Sražení 1×45°"; tolerance poloha ø0.05M A,B 120,0; drsnost 30,50 0 "Ra 1,6"; mtext 0,-30 @60,-10 "Poznámka\\P2. řádek"');
  ok(r.ok, `šrafa, odkaz, tolerance, drsnost, mtext textem (${JSON.stringify(r.results.map((x) => [x.cmd, x.ok, x.error]))})`);
  const area = r.results[0].data && r.results[0].data.area;
  ok(near(area, 5000 - Math.PI * 100, 1e-6), `šrafa vnitřním bodem: plocha s ostrovem = 5000 − π·100 (${area})`);
  let e = await ents();
  const kinds = e.map((x) => x.type);
  ok(['dimension', 'hatch', 'leader', 'tolerance', 'surfsym', 'mtext'].every((k) => kinds.includes(k)), `entity balíku v dokumentu: ${[...new Set(kinds)].join(', ')}`);
  await draft('zoom rozsah');
  await p.waitForTimeout(800);
  let v = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  ok(v.drawn === e.length, `vykresleno všech ${e.length} entit (${v.drawn}, ${v.ms} ms)`);
  await p.screenshot({ path: S + 'w9-annot-text.png' });

  // ── karta Poznámky: skupiny pásu ──
  await p.locator('[data-draft-tab="annotate"]').click();
  await p.waitForTimeout(300);
  const ribbon = await p.locator('[data-draft-workspace] [data-ribbon]').innerText();
  ok(['Kóty', 'Odkazy', 'Šrafy', 'Styly', 'Odstavcový text', 'Lineární', 'Šrafa'].every((t) => ribbon.includes(t)), 'karta Poznámky: Text, Kóty, Odkazy, Šrafy, Styly');

  // přepočet souřadnic výkresu na obrazovku
  await draft('zoom okno -30,-60 160,90');
  await p.waitForTimeout(500);
  const box = await p.locator('[data-draft-canvas]').boundingBox();
  const scr = async (X, Y) => { const w = JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view')); return [box.x + (X - w.cx) * w.scale + w.w / 2, box.y + w.h / 2 - (Y - w.cy) * w.scale]; };
  const btn = (label) => p.locator('[data-draft-workspace] [data-ribbon]').getByRole('button', { name: new RegExp('^' + label + '\\s*▼?$') }).first();
  /** tlačítko s nabídkou: otevřít nabídku a zvolit položku */
  const menu = async (label, item) => { await btn(label).click(); await p.waitForTimeout(150); await p.locator('[data-cad-menu]').getByRole('button', { name: item }).first().click(); };

  // ── GUI: lineární kóta z pásu + psané body ──
  const n0 = (await ents()).length;
  await btn('Lineární').click();
  await p.waitForTimeout(200);
  ok((await p.textContent('[data-draft-prompt]')).includes('první vynášecí'), 'tlačítko Lineární → výzva „počátek první vynášecí čáry“');
  for (const t of ['0,0', '0,50', '-15,25']) { await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(120); }
  await p.waitForTimeout(300);
  e = await ents();
  let d = e[e.length - 1];
  ok(e.length === n0 + 1 && d.type === 'dimension' && d.kind === 'linear' && d.rot === 90, `GUI kóta svislá: ${JSON.stringify(d && { kind: d.kind, rot: d.rot, p1: d.p1, p2: d.p2 })}`);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
  ok((await ents()).length === n0, 'Ctrl+Z vrátí kótu (jeden krok)');
  await p.keyboard.press('Control+y'); await p.waitForTimeout(400);

  // ── GUI: kóta poloměru myší (klik na kružnici, poloha) ──
  await menu('Poloměr', 'Poloměr');
  let [x, y] = await scr(60, 25);
  await p.mouse.move(x - 4, y); await p.mouse.move(x, y); await p.waitForTimeout(200);
  await p.mouse.click(x, y); await p.waitForTimeout(250);
  [x, y] = await scr(75, 40);
  await p.mouse.move(x, y); await p.waitForTimeout(250);
  await p.screenshot({ path: S + 'w9-annot-radius-preview.png' });
  await p.mouse.click(x, y); await p.waitForTimeout(400);
  e = await ents();
  d = e[e.length - 1];
  ok(d.type === 'dimension' && d.kind === 'radius' && near(Math.hypot(d.chord[0] - 50, d.chord[1] - 25), 10, 1e-9), `GUI kóta poloměru myší: bod na kružnici přesně (r = ${d.chord && Math.hypot(d.chord[0] - 50, d.chord[1] - 25)})`);

  // ── GUI: šrafa vnitřním bodem (klik) ──
  await menu('Šrafa', 'Plná výplň (SOLID)');
  await p.waitForTimeout(200);
  [x, y] = await scr(50, 25);
  await p.mouse.click(x, y); await p.waitForTimeout(400);
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  e = await ents();
  const h = e[e.length - 1];
  ok(h.type === 'hatch' && h.loops.length === 1 && h.loops[0].bulges && h.loops[0].bulges.length === 2, `GUI šrafa kliknutím do kružnice: 1 smyčka z oblouků (${JSON.stringify(h.loops && h.loops.map((l) => l.pts.length))})`);

  // ── GUI: MTEXT – dva rohy, editor na místě, OK ──
  await btn('Odstavcový text').click();
  [x, y] = await scr(110, 85);
  await p.mouse.click(x, y); await p.waitForTimeout(200);
  [x, y] = await scr(150, 70);
  await p.mouse.click(x, y); await p.waitForTimeout(400);
  ok(await p.locator('[data-annot-editor]').isVisible(), 'MTEXT: po druhém rohu se otevře editor na místě');
  await p.locator('[data-annot-editor-text]').fill('První řádek\nDruhý');
  await p.locator('[data-annot-editor-tools] button[title="Tučně"]').click();
  await p.locator('[data-annot-editor-ok]').click();
  await p.waitForTimeout(500);
  e = await ents();
  const mt = e[e.length - 1];
  ok(mt.type === 'mtext' && mt.s.includes('\\P') && mt.s.includes('Druhý') && near(mt.w, 40, 0.5), `MTEXT z editoru: ${JSON.stringify(mt && { s: mt.s, w: mt.w, p: mt.p })}`);
  ok(!mt.s.includes('{\\f'), `Tučně bez výběru nevloží prázdnou skupinu (${JSON.stringify(mt.s)})`);
  ok(!(await p.locator('[data-annot-editor]').isVisible().catch(() => false)), 'editor se po OK zavře');

  // ── MTEXT: natočení zadané u protilehlého rohu (jako AutoCAD) – rámeček i šířka v natočené soustavě ──
  await btn('Odstavcový text').click();
  [x, y] = await scr(10, 10); await p.mouse.click(x, y); await p.waitForTimeout(200);
  await p.keyboard.type('natočení'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.keyboard.type('90'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.keyboard.type('-10,60'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  if (await p.locator('[data-annot-editor]').isVisible().catch(() => false)) {
    await p.locator('[data-annot-editor-text]').fill('Svislý');
    await p.locator('[data-annot-editor-ok]').click(); await p.waitForTimeout(400);
  }
  e = await ents();
  const mr = e[e.length - 1];
  // body myší (přesnost 1e-4 – klik), dřív p = (−10, 60), w = 20
  ok(mr.type === 'mtext' && mr.rot === 90 && near(mr.p[0], -10, 1e-4) && near(mr.p[1], 10, 1e-4) && near(mr.w, 50, 1e-4), `MTEXT natočení u 2. rohu: p = (−10, 10), w = 50 (${JSON.stringify(mr && { p: mr.p, w: mr.w, rot: mr.rot })})`);
  // Tučně s výběrem: písmo textového stylu, ne pevně Arial
  await p.keyboard.press('Escape');
  // natočený text běží nahoru, řádek leží vpravo od bodu vložení (TL)
  [x, y] = await scr(mr.p[0] + 1.25, mr.p[1] + 5);
  await p.mouse.dblclick(x, y); await p.waitForTimeout(400);
  if (await p.locator('[data-annot-editor]').isVisible().catch(() => false)) {
    await p.locator('[data-annot-editor-text]').evaluate((el) => { el.focus(); el.setSelectionRange(0, 3); });
    await p.locator('[data-annot-editor-tools] button[title="Tučně"]').click(); await p.waitForTimeout(150);
    await p.locator('[data-annot-editor-ok]').click(); await p.waitForTimeout(400);
  }
  const font = ((await doc()).draft.textStyles.find((t) => t.name === 'Standard') || {}).font;
  const mb = (await ents()).find((q) => q.id === mr.id);
  ok(mb.s.startsWith(`{\\f${font}|b1;Svi}`), `Tučně výběru písmem stylu „${font}“ (${JSON.stringify(mb.s)})`);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);

  // ── poklepání na MTEXT = úprava (jeden krok historie) ──
  [x, y] = await scr(mt.p[0] + 5, mt.p[1] - 1.5);
  await p.mouse.dblclick(x, y); await p.waitForTimeout(400);
  const editorOpen = await p.locator('[data-annot-editor]').isVisible().catch(() => false);
  ok(editorOpen, 'poklepání na odstavcový text otevře editor');
  if (editorOpen) {
    await p.locator('[data-annot-editor-text]').fill('Upraveno');
    await p.keyboard.press('Control+Enter');
    await p.waitForTimeout(400);
  }
  e = await ents();
  ok(e.find((q) => q.id === mt.id).s === 'Upraveno', 'Ctrl+Enter v editoru uloží nový obsah');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
  ok((await ents()).find((q) => q.id === mt.id).s === mt.s, 'Ctrl+Z vrátí původní obsah');

  // ── GUI: odkaz (dva body + editor textu) a tolerance z nabídky (hodnota, základny, bod) ──
  await btn('Multiodkaz').click();
  [x, y] = await scr(100, 0); await p.mouse.click(x, y); await p.waitForTimeout(150);
  [x, y] = await scr(125, -25); await p.mouse.click(x, y); await p.waitForTimeout(400);
  ok(await p.locator('[data-annot-editor]').isVisible(), 'odkaz: po bodu zalomení se otevře editor textu');
  await p.locator('[data-annot-editor-text]').fill('Sražení 2×45°');
  await p.locator('[data-annot-editor-ok]').click(); await p.waitForTimeout(400);
  e = await ents();
  const ld = e[e.length - 1];
  ok(ld.type === 'leader' && ld.text === 'Sražení 2×45°' && ld.pts.length === 2, `odkaz z GUI: ${JSON.stringify(ld && { text: ld.text, pts: ld.pts && ld.pts.length })}`);
  await menu('Tolerance tvaru a polohy', 'Kolmost');
  await p.waitForTimeout(200);
  await p.keyboard.type('0.02'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.keyboard.type('A'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  [x, y] = await scr(130, 70); await p.mouse.click(x, y); await p.waitForTimeout(400);
  e = await ents();
  const tl = e[e.length - 1];
  ok(tl.type === 'tolerance' && tl.s === '{\\Fgdt;b}%%v0.02%%vA', `tolerance z nabídky Kolmost: ${JSON.stringify(tl && tl.s)}`);
  await p.screenshot({ path: S + 'w9-annot-gui.png' });

  // ── panel stylů: DIMTXT aktuálního stylu ──
  await btn('Kótovací styly').click();
  await p.waitForSelector('[data-annot-styles]');
  await p.locator('[data-dimstyle="ISO-25"]').click();
  await p.locator('[data-dimstyle-current]').click();
  await p.waitForTimeout(200);
  const f = p.locator('[data-annot-styles] [data-dimvar="dimtxt"]');
  await f.fill('3.5'); await f.press('Enter'); await p.waitForTimeout(400);
  d = await doc();
  const iso = (d.draft.dimStyles || []).find((s) => s.name === 'ISO-25');
  ok(iso && iso.dimtxt === 3.5 && d.draft.vars.dimstyle === 'ISO-25', `panel stylů: ISO-25 aktuální, DIMTXT 3,5 (${JSON.stringify(iso)})`);
  await p.screenshot({ path: S + 'w9-annot-styles.png' });

  // ── měřítko poznámek ve stavovém řádku ──
  await p.locator('[data-annot-scale]').click();
  await p.locator('[data-annot-scale-menu]').getByRole('button', { name: '1:50', exact: true }).click();
  await p.waitForTimeout(400);
  ok(near((await doc()).draft.vars.cannoscale, 0.02, 1e-12) && (await p.textContent('[data-annot-scale]')).includes('1:50'), 'měřítko poznámek 1:50 ze stavového řádku (CANNOSCALE 0,02 = papír : skutečnost)');
  await draft('kótovací-styl měřítko-poznámek 1:1');

  // ── poklepání: kóta na zamčené hladině editor neotevře (hlášení), šrafa = HATCHEDIT ──
  r = await draft('vyber nic; hladina nová ZAM; hladina aktuální ZAM; kóta-lineární 0,-40 60,-40 30,-50; hladina aktuální 0; hladina ZAM zamknout; zoom okno -30,-60 160,90');
  const lk = (await ents()).filter((q) => q.type === 'dimension').pop();
  await p.waitForTimeout(400);
  [x, y] = await scr(30, -50 + 0.625 + 1.25);
  await p.mouse.dblclick(x, y); await p.waitForTimeout(400);
  ok(r.ok && lk.layer === 'ZAM' && !(await p.locator('[data-annot-editor]').isVisible().catch(() => false)), `poklepání na kótu na zamčené hladině editor neotevře (hladina ${lk.layer}, ${JSON.stringify(r.results.filter((q) => !q.ok).map((q) => q.error))})`);
  await p.keyboard.press('Escape');
  const hid = (await ents()).find((q) => q.type === 'hatch').id;
  await draft('zoom okno 30,5 70,45'); await p.waitForTimeout(400);
  // uvnitř plné šrafy v kružnici, mimo kótovací čáry Ø a R
  [x, y] = await scr(46.4, 29.8);
  await p.mouse.dblclick(x, y); await p.waitForTimeout(400);
  const prm = await p.textContent('[data-draft-prompt]');
  ok(/volbu|option/i.test(prm || ''), `poklepání na šrafu → HATCHEDIT (${prm} / ${hid})`);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await draft('hladina ZAM odemknout; zoom okno -30,-60 160,90');

  // ── window.mncad.draft: výpis kóty, nastavit, upravit-text, chyby ──
  const did = (await ents()).find((q) => q.type === 'dimension').id;
  r = await draft(`vyber nic; výpis ${did}; nastavit ${did} p2 120,0; upravit-text ${did} "<> h7"`);
  e = await ents();
  ok(r.ok && e.find((q) => q.id === did).p2[0] === 120 && e.find((q) => q.id === did).text === '<> h7', `nastavit / upravit-text kóty (${JSON.stringify(r.results.map((x) => [x.cmd, x.ok, x.error]))})`);
  const bad = await draft('šrafa 500,500');
  ok(!bad.ok && /uzavřené oblasti/.test(bad.results[0].error), 'šrafa mimo uzavřenou oblast: ok false s důvodem');
  const en = await p.evaluate(() => window.mncad.run('draft dimaligned 0,0 30,40 -10,50\nzeichnen bemradius e2 60,40'));
  ok(/Kóta e\d+ \(aligned\): 50/.test(en) && /Kóta e\d+ \(radius\): R10/.test(en), `předpony draft / zeichnen s anglickými a německými názvy (${en.split('\n').slice(-2).join(' | ')})`);
  await p.screenshot({ path: S + 'w9-annot-final.png' });

  if (cerr.length) console.log('   console errors:', JSON.stringify(cerr.slice(0, 5)));
  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exit(1); });
