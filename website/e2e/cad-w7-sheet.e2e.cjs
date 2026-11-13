// E2E 7. vlna – plech: tvářecí nástroje (žaluzie, prolis, žebro, výstřih, můstek, lem díry, vodítko) a křížový zlom.
// Ručně (pás karet Plech → formulář → klik na plochu / body číselně → OK) i textem (window.mncad.run: CS / EN / DE,
// obecný příkaz „prvek“, stav), rozvin DXF / tabulka (vrstva FORM) a poznámka KŘÍŽOVÝ ZLOM na výkrese.
// Spuštění (server na E2E_BASE, výchozí :3335): node e2e/cad-w7-sheet.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w7-sheet').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3335').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const status = () => p.evaluate(() => window.mncad.status());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 });
  const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const last = async () => (await doc()).features.slice(-1)[0];
  const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();
  const featLine = async (name) => (await status()).split('\n').find((l) => l.includes(` ${name} [`)) || '';
  const setNum = async (label, v) => { const f = p.getByLabel(label, { exact: true }).first(); await f.fill(String(v)); await f.press('Tab'); await p.waitForTimeout(300); };
  const ribbon = async (name) => { await p.getByRole('button', { name, exact: true }).first().click(); await p.waitForTimeout(800); };
  const hints = async (pred) => p.evaluate(() => [...document.querySelectorAll('[data-hint]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.hint, kind: el.dataset.kind, title: el.title, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })).then((l) => l.filter(pred));
  const PLATE = 'skica XY: obdélník 200 120\nprvek sheet.base sketchId=$last t=2 r=1';

  // ═════════════ ručně: žaluzie (klik na plochu + bod číselně + natočení) ═════════════
  await run('nový díl Plech ručně\n' + PLATE); await idle();
  ok(Math.abs((await vol()) - 48) < 0.01, `základní plech 200 × 120 × 2 = ${await vol()} cm³`);
  await p.getByRole('button', { name: 'Plech', exact: true }).first().click(); await p.waitForTimeout(600);
  for (const n of ['Žaluzie', 'Prolis (důlek)', 'Žebro podél dráhy', 'Výstřih (jazýček)', 'Můstek', 'Lem díry (límec)', 'Vodítko desky', 'Křížový zlom']) ok(await p.getByRole('button', { name: n, exact: true }).first().isVisible(), `pás karet Plech → Tvarování: tlačítko „${n}“`);
  await ribbon('Žaluzie');
  let f = await last();
  ok(f.type === 'ext' && f.ext === 'sheet.louvre' && /Žaluzie/.test(f.name), `pás karet „Žaluzie“ založí prvek sheet.louvre (${f.name})`);
  ok(await p.locator('[data-form-points]').isVisible() && await p.locator('[data-pick-info="faces"]').first().isVisible(), 'formulář: plocha plechu (výběr) a editor bodů umístění');
  ok(/stopa 8,\d+ × 40 mm|stopa \d+(,\d+)? × \d+ mm/.test(await p.locator('[data-form-info]').innerText()), 'formulář: živé shrnutí řezu (R, stopa) – ' + (await p.locator('[data-form-info]').innerText()));
  // klik na horní plochu (štítek plochy s normálou +Z) přidá bod umístění
  await p.keyboard.press('Control+Shift+L'); await p.waitForTimeout(600);
  const top = await hints((h) => h.kind === 'face' && /normála \+Z/.test(h.title));
  ok(top.length >= 1, `štítek horní plochy (${top.map((h) => h.id).join(',')})`);
  if (top.length) { await p.mouse.click(top[0].x, top[0].y); await p.waitForTimeout(1200); }
  await p.keyboard.press('Control+Shift+L'); await p.waitForTimeout(300);
  f = await last();
  ok(f.data.face.length === 1 && f.data.points.length === 1 && f.data.faceGeom && Math.abs(f.data.points[0][2] - 2) < 0.01, `klik na plochu: plocha F${f.data.face[0] + 1}, bod ${JSON.stringify(f.data.points)}, uložená rovina plochy`);
  // další body číselně (seznam „x y; x y“)
  await p.locator('[data-points-text]').fill('-60 0; 60 0'); await p.locator('[data-points-add]').click(); await p.waitForTimeout(400);
  f = await last();
  ok(f.data.points.length === 3, `zadání seznamem přidá body (${JSON.stringify(f.data.points)})`);
  ok((await p.locator('[data-point-row]').count()) === 3, 'formulář: tři řádky bodů');
  // první bod (klik) nahradit přesnou polohou
  await p.locator('[data-point-row="0"] input[aria-label="x"]').fill('0'); await p.locator('[data-point-row="0"] input[aria-label="x"]').press('Enter');
  await p.locator('[data-point-row="0"] input[aria-label="y"]').fill('0'); await p.locator('[data-point-row="0"] input[aria-label="y"]').press('Enter'); await p.waitForTimeout(300);
  await setNum('Natočení', 90);
  await p.screenshot({ path: S + 'sheet-louvre-form.png' });
  await okBtn(); await idle(); await p.waitForTimeout(600);
  f = await last();
  let line = await featLine(f.name);
  ok(/✓/.test(line) && !/[⚠✗]/.test(line), `žaluzie ve 3 bodech, natočení 90°: ${line.trim()}`);
  ok(/žaluzie 40 × 8 × \d+ mm, otevřená vlevo/.test(line) && /3 b\.:/.test(line) && /natočení 90°/.test(line), 'stav: souhrn žaluzie, 3 body, natočení');
  const vLouvre = await vol();
  ok(vLouvre > 48 && vLouvre < 49, `objem s žaluziemi ${vLouvre} cm³ (skořepina tloušťky plechu)`);
  await p.screenshot({ path: S + 'sheet-louvres.png' });

  // ═════════════ ručně: prolis – body jen číselně, dolů ═════════════
  await ribbon('Prolis (důlek)');
  await p.locator('[data-points-text]').fill('-60 -40; -60 40'); await p.locator('[data-points-text]').press('Enter'); await p.waitForTimeout(400);
  await setNum('Průměr', 14);
  await setNum('Hloubka', 2.5);
  await p.getByRole('button', { name: 'Dolů (do plochy)', exact: true }).click(); await p.waitForTimeout(300);
  await okBtn(); await idle(); await p.waitForTimeout(600);
  f = await last();
  line = await featLine(f.name);
  ok(f.ext === 'sheet.dimple' && f.data.direction === 'down' && f.data.points.length === 2 && /✓/.test(line), `prolis Ø14 hl. 2,5 dolů ve 2 bodech: ${line.trim()}`);
  ok((await status()).includes('Z -2,5…'), 'prolis dolů: model sahá pod spodní plochu plechu (Z -2,5)');

  // ═════════════ ručně: křížový zlom (výchozí panel = horní plocha základu) ═════════════
  await ribbon('Křížový zlom');
  f = await last();
  ok(f.ext === 'sheet.crossbreak' && f.data.angle === 1.5, 'pás karet „Křížový zlom“ – úhel 1,5° výchozí');
  await setNum('Úhel zlomu', 1);
  await okBtn(); await idle(); await p.waitForTimeout(600);
  line = await featLine((await last()).name);
  ok(/✓/.test(line) && /křížový zlom 1° nahoru/.test(line), `křížový zlom po nástrojích: ${line.trim()}`);
  await p.screenshot({ path: S + 'sheet-crossbreak.png' });

  // rozvin: vrstva FORM, tabulka tvarování
  let act = await p.evaluate(() => window.mncad.action('sheet.dxf'));
  let dxf = act.files[0] ? b64(act.files[0].base64) : '';
  ok(/\nFORM\n/.test(dxf) && dxf.includes('T1 \\U+017D') && dxf.includes('K\\U+0158\\U+00CD\\U+017D'), `Rozvin → DXF: vrstva FORM, T1 ŽALUZIE a KŘÍŽOVÝ ZLOM (${dxf.length} B)`);
  act = await p.evaluate(() => window.mncad.action('sheet.table'));
  ok(/Tvarování \(nerozvinuto, vrstva FORM\)/.test(act.log) && /T1: Žaluzie.*3 ks/.test(act.log) && /T2: Prolis \(důlek\).*dolů, 2 ks/.test(act.log) && /Z1: KŘÍŽOVÝ ZLOM 1°/.test(act.log), 'Tabulka ohybů: oddíl Tvarování (T1 žaluzie 3 ks, T2 prolis dolů 2 ks, Z1 zlom)');
  act = await p.evaluate(() => window.mncad.action('sheet.svg'));
  ok(act.files[0] && b64(act.files[0].base64).includes('data-form="louvre"'), 'Rozvin → SVG: stopa žaluzií');

  // ═════════════ text: CS (příklady ze zadání) ═════════════
  let log = await run('nový díl Plech text\n' + PLATE + '\nplech tvarování žaluzie 40 8 4 v 50 30 natočení 90\nplech prolis 12 2 v -50 -30 v -20 -30\nplech lem díry 8 3 v 70 -30 dolů\nplech výstřih 20 10 3 úhel 45 v -70 25\nplech můstek 30 8 3 v 40 -35\nplech vodítko 25 6 mezera 1,6 v 0 40 natočení 90\nskica XY odsazení 2: úsečka -60 0 20 0\nplech žebro 6 2 skica $last\nplech křížový zlom úhel 1,5'); await idle(); await p.waitForTimeout(500);
  const st = await status();
  const names = ['Žaluzie 1', 'Prolis (důlek) 1', 'Lem díry (límec) 1', 'Výstřih (jazýček) 1', 'Můstek 1', 'Vodítko desky 1', 'Žebro podél dráhy 1', 'Křížový zlom 1'];
  for (const n of names) {
    const l = st.split('\n').find((x) => x.includes(` ${n} [`)) || '';
    ok(/✓/.test(l) && !/[⚠✗]/.test(l), `text: ${l.trim().slice(0, 170) || n + ' chybí'}`);
  }
  ok(/lem díry Ø8 mm, výška límce 3 mm · dolů/.test(st) && /vodítko desky 25 × 6 mm, mezera 1,6 mm/.test(st), 'stav: souhrny lemu díry a vodítka');
  const vText = await vol();
  ok(vText > 48 && vText < 50, `objem dílu s nástroji ${vText} cm³`);
  await p.screenshot({ path: S + 'sheet-text.png' });
  // rozvin z textových prvků (plochy bez uložené roviny se dopočtou v jádře)
  act = await p.evaluate(() => window.mncad.action('sheet.table'));
  ok(/T1: Žaluzie/.test(act.log) && /T6: Vodítko desky/.test(act.log) && /T7: Žebro podél dráhy/.test(act.log) && /Z1: KŘÍŽOVÝ ZLOM 1,5°/.test(act.log) && /předděr/.test(act.log), 'tabulka: 7 nástrojů, křížový zlom, předděr lemu díry');
  // výkres: poznámka KŘÍŽOVÝ ZLOM v patičce
  const svgD = await p.evaluate(() => window.mncad.exportDrawing('svg'));
  ok(b64(svgD.base64).includes('KŘÍŽOVÝ ZLOM 1,5° nahoru'), 'výkres SVG: poznámka „KŘÍŽOVÝ ZLOM 1,5° nahoru“');

  // ═════════════ text: EN / DE / obecný příkaz / plocha pravidlem ═════════════
  log = await run('nový díl Plech EN\n' + PLATE + '\nsheet forming louvre 30 6 3 at 0 0 rotation 90\nsheet dimple 10 2 at 40 0 down\nsheet cross break angle 2'); await idle();
  let lines = (await status()).split('\n').filter((l) => /\[ext,/.test(l));
  ok(lines.length === 4 && lines.every((l) => /✓/.test(l) && !/[⚠✗]/.test(l)), 'EN: louvre, dimple, cross break ✓');
  log = await run('nový díl Plech DE\n' + PLATE + '\nblech umformen kieme 30 6 3 bei 0 0\nblech napf 10 2 bei 40 0\nblech durchzug 8 3 bei -40 0\nblech kreuzbruch winkel 1,5 unten'); await idle();
  lines = (await status()).split('\n').filter((l) => /\[ext,/.test(l));
  ok(lines.length === 5 && lines.every((l) => /✓/.test(l)), 'DE: kieme, napf, durchzug, kreuzbruch ✓');
  log = await run('nový díl Plech prvek\n' + PLATE + '\nplech prolis 10 2 v 0 -30 plocha horní\nprvek sheet.bridge název="Můstek A" points=[[-40,0],[40,0]] length=30 width=8 height=3 rotation=90\nprvek sheet.dimple points=0;30 diameter=10 height=2 wallAngle=45 rounded=ne'); await idle();
  lines = (await status()).split('\n').filter((l) => /\[ext,/.test(l));
  ok(lines.length === 4 && lines.every((l) => /✓/.test(l)), 'obecný příkaz prvek (body JSON, jeden bod 0;30) a plocha pravidlem ✓');
  f = (await doc()).features.find((x) => x.ext === 'sheet.dimple');
  ok(f.data.face.length === 1 && !f.data.faceGeom, `plocha pravidlem „horní“ vybrána aplikací: F${f.data.face[0] + 1} (bez uložené roviny)`);
  act = await p.evaluate(() => window.mncad.action('sheet.dxf'));
  dxf = act.files[0] ? b64(act.files[0].base64) : '';
  ok((dxf.match(/T1 PROLIS/g) || []).length === 1 && (dxf.match(/T2 M\\U\+016ESTEK/g) || []).length === 2, 'rozvin: nástroj s plochou zadanou pravidlem (bez uložené roviny) dopočten jádrem a nakreslen, můstek ve 2 bodech – ' + (dxf.match(/T\d [A-Z\\+0-9]+/g) || []).join(', '));
  // úprava existujícího nástroje textem
  log = await run('upravit "Můstek A" points=[[-50,0],[50,0]] height=4'); await idle();
  f = (await doc()).features.find((x) => x.name === 'Můstek A');
  ok(f && f.data.points.length === 2 && f.data.points[0][0] === -50 && f.data.height === 4 && /✓/.test(await featLine('Můstek A')), 'upravit „Můstek A“ points=[[…]] height=4 – ' + log.split('\n')[0]);

  // ═════════════ chyby ═════════════
  log = await run('nový díl Plech chyby\n' + PLATE + '\nplech prolis 12 2 v 98 0'); await idle();
  ok(/neleží celý na rovné ploše/.test(await featLine('Prolis (důlek) 1')), 'prolis přes okraj → ✗ s vysvětlením');
  log = await run('plech žaluzie 40 8 4');
  ok(/zadejte bod umístění/.test(log), 'žaluzie bez bodu → nápověda se zápisem');
  log = await run('plech prolis 12 2 v 0 0 v 5 0'); await idle();
  ok(/překrývají/.test(await featLine('Prolis (důlek) 2')), 'překrývající se prolisy → ✗');

  // nápověda příkazů a návod
  const cmds = await p.evaluate(() => JSON.stringify(window.mncad.commands()));
  ok(/plech \[tvarování\] žaluzie/.test(cmds) && /plech křížový zlom/.test(cmds), 'window.mncad.commands() obsahuje příkazy plechu');
  const guide = await p.evaluate(() => window.mncad.guide());
  ok(/Plech – tvářecí nástroje a křížový zlom/.test(guide), 'návod pro AI obsahuje sekci plechu');

  ok(errs.length === 0, 'žádné chyby stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + e.message); process.exit(1); });
