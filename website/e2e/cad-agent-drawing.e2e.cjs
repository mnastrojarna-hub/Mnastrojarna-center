// E2E – výkres textem pro agenty (balík drawing): listy, razítko, revize, značky, ruční kóty, úpravy, detaily,
// rozšířený „výkres stav“ a export bez dialogu window.mncad.exportDrawing (PDF, DXF, DWG, SVG, PNG, CSV).
// Díl textem → výkres A3 → kótovat → značky na Ø40 → razítko → nový list „Detail“ → výkres stav vše (id, souřadnice
// pohledů) → export → výkresové prostředí ukáže značky na správném listu a přepne list podle „výkres list 1“.
// Spuštění: E2E_BASE=http://localhost:3322 node e2e/cad-agent-drawing.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-agent-drawing').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 300000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const first = (log, re) => (re.exec(log) || [])[0] || '';

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  let downloads = 0;
  p.on('download', () => downloads++);
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));
  const activeTab = () => p.evaluate(() => {
    const strip = document.querySelector('[data-drawing-workspace] > div:nth-of-type(1)');
    const act = strip && [...strip.querySelectorAll('div')].find((d) => d.className.includes('bg-white') && d.className.includes('font-semibold'));
    return act ? act.textContent.replace('×', '').trim() : '';
  });

  // ── 1. díl, výkres A3, Chytré kóty, značky, ruční kóta, razítko, revize ──
  const log1 = await run([
    'nový díl Příruba',
    'válec 100 20',
    'díra 40 skrz v 0 0 20',
    'výkres A3 na šířku pohledy přední,horní,iso',
    'kótovat',
    'výkres značka drsnost Ra 1,6 na Ø40',
    'výkres značka tolerance kolmost 0,02 A na Ø40',
    'výkres značka základna A pohled přední v 0 0',
    'výkres kóta vodorovně pohled přední -50 20 50 20 odsazení 18 text "(100)"',
    'výkres razítko číslo="MN-1" kreslil="AI" materiál="ČSN 11 523"',
    'výkres revize A "první vydání"',
  ].join('\n'));
  fs.writeFileSync(S + 'log1.txt', log1);
  ok(!/^✗/m.test(log1), 'díl + výkres + značky bez chyb' + (first(log1, /^✗.*$/m) ? ' – ' + first(log1, /^✗.*$/m) : ''));
  ok(/✓ značka drsnost Ra 1,6 → kóta Ø40( skrz)? \(horní, a\d+\) · a\d+/.test(log1), 'výkres značka drsnost Ra 1,6 na Ø40 → kóta Ø40 v horním pohledu');
  ok(/✓ značka geometrická tolerance Kolmost 0,02 A → kóta Ø40( skrz)? \(horní, a\d+\)/.test(log1), 'výkres značka tolerance kolmost 0,02 A na Ø40');
  ok(/✓ značka základna A → přední \[0; 0\] – (bod geometrie|hrana)/.test(log1), 'základna A v bodě předního pohledu (přichycená ke geometrii)');
  ok(/✓ kóta \(100\) \(přední, vodorovně, hrana\)/.test(log1), 'ruční kóta po hraně s vlastním textem');
  ok(!/^! /m.test(log1), 'značky na Ø40 a ruční kóta se nepřekrývají s jinými texty a nepřesahují rámeček' + (first(log1, /^! .*$/m) ? ' – ' + first(log1, /^! .*$/m) : ''));
  ok(/✓ razítko: číslo „MN-1“, kreslil „AI“, materiál „ČSN 11 523“/.test(log1), 'výkres razítko číslo / kreslil / materiál');
  ok(/✓ revize A .* „první vydání“/.test(log1), 'výkres revize A');
  const doc1 = await p.evaluate(() => window.mncad.getDocument());
  ok(doc1.props?.number === 'MN-1' && doc1.props?.author === 'AI' && doc1.materialName === 'ČSN 11 523', 'číslo / kreslil do vlastností dokumentu, materiál do označení materiálu');

  // ── 2. druhý list, stav všech listů (id, souřadnice, razítko) ──
  const log2 = await run('výkres list nový "Detail"\nvýkres A4 pohledy přední měřítko 2:1\nvýkres detail přední v 45 10 poloměr 5 měřítko 5:1\nvýkres značka text "JEN LIST 2" v 20 20 výška 5\nvýkres stav vše');
  fs.writeFileSync(S + 'log2.txt', log2);
  ok(!/^✗/m.test(log2), 'druhý list bez chyb' + (first(log2, /^✗.*$/m) ? ' – ' + first(log2, /^✗.*$/m) : ''));
  ok(/✓ nový list 2 „Detail“/.test(log2) && /✓ výkres: A4, pohledy přední, měřítko 2:1 · list 2 „Detail“/.test(log2), 'výkres list nový "Detail" + volby platí pro list 2');
  ok(/✓ detail A \(pohled přední, střed \[45; 10\], r 5, 5:1\) – na listu/.test(log2), 'výkres detail na listu 2');
  ok(/Listy \(2\): 1 „List 1“ A3 · 2 „Detail“ A4 \(aktivní\)/.test(log2), 'výkres stav vše: přehled listů');
  ok(/Výkres „List 1“ \(list 1\/2\)/.test(log2) && /Výkres „Detail“ \(list 2\/2\)/.test(log2), 'výkres stav vše: oba listy');
  ok(/přední \(x = X, y = Z\): x −50…50, y 0…20 mm · \d+:\d+ · na listu x [\d,]+…[\d,]+, y [\d,]+…[\d,]+/.test(log2), 'souřadnice pohledu: rozsah v mm modelu a poloha na listu');
  ok(/Id \(výkres upravit \/ smazat \/ značka na <id>\): a1 .* Ra 1,6 \(horní\)/.test(log2), 'id kót a značek (a1…)');
  ok(/Razítko: název Příruba · číslo MN-1 · kreslil AI · revize A/.test(log2) && /Revize \(1\): A .*„první vydání“/.test(log2), 'razítko a revize ve stavu');
  const idRa = (/(a\d+) Ra 1,6 \(horní\)/.exec(log2) || [])[1];

  // ── 3. upravit / smazat podle id, výkres list 1 ──
  const log3 = await run(`výkres list 1\nvýkres upravit ${idRa} text="Ra 0,8"\nvýkres upravit Ø40 přípona=H7\nvýkres stav`);
  fs.writeFileSync(S + 'log3.txt', log3);
  ok(!/^✗/m.test(log3), 'úpravy bez chyb' + (first(log3, /^✗.*$/m) ? ' – ' + first(log3, /^✗.*$/m) : ''));
  ok(new RegExp(`✓ upraveno ${idRa}: Ra 1,6 → Ra 0,8`).test(log3) && /✓ upraveno a\d+: Ø40.* → Ø40H7/.test(log3), 'výkres upravit podle id a popisku');
  ok(/^Výkres „List 1“ \(list 1\/2\)/m.test(log3), 'výkres list 1 → stav aktivního listu 1');
  const st = await p.evaluate(() => window.mncad.drawingStatus({ sheet: 2 }));
  ok(/^Výkres „Detail“ \(list 2\/2\)/.test(st) && /JEN LIST 2/.test(st), 'window.mncad.drawingStatus({ sheet: 2 })');

  // ── 4. export bez dialogu ──
  const ex = (f, o) => p.evaluate(([f, o]) => window.mncad.exportDrawing(f, o).then((r) => ({ ...r, head: atob(r.base64.slice(0, 64)), text: f === 'svg' || f === 'dxf' ? new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))) : '' })), [f, o]);
  const before = downloads;
  const pdf = await ex('pdf', { sheet: 1 });
  fs.writeFileSync(S + 'list1.pdf', Buffer.from(pdf.base64, 'base64'));
  ok(pdf.head.startsWith('%PDF') && pdf.mime === 'application/pdf' && pdf.bytes > 5000 && /_vykres\.pdf$/.test(pdf.name), `exportDrawing("pdf") – %PDF, ${Math.round(pdf.bytes / 1024)} kB`);
  const dxf = await ex('dxf', { sheet: 1 });
  ok(/SECTION/.test(dxf.text) && /ENTITIES/.test(dxf.text) && /AC1009/.test(dxf.text), 'exportDrawing("dxf") – DXF R12 se sekcemi');
  const dwg = await ex('dwg', { sheet: 1, dwgVersion: 'R2010' });
  ok(dwg.head.startsWith('AC1024') && dwg.mime === 'application/acad', `exportDrawing("dwg", R2010) – signatura ${dwg.head.slice(0, 6)}`);
  const dwg18 = await ex('dwg', { sheet: 1 });
  ok(dwg18.head.startsWith('AC1032'), `exportDrawing("dwg") výchozí R2018 – ${dwg18.head.slice(0, 6)}`);
  const svg1 = await ex('svg', { sheet: 1 });
  ok(svg1.text.startsWith('<svg') && svg1.text.includes('Ra 0,8') && svg1.text.includes('Ø40H7') && svg1.text.includes('MN-1') && !svg1.text.includes('JEN LIST 2'), 'exportDrawing("svg", list 1) – značky, tolerance a razítko listu 1');
  const svg2 = await ex('svg', { sheet: 'Detail' });
  ok(svg2.text.includes('JEN LIST 2') && !svg2.text.includes('Ra 0,8'), 'exportDrawing("svg", "Detail") – jen obsah listu 2');
  const png = await ex('png', { sheet: 1, width: 1200 });
  const pngBuf = Buffer.from(png.base64, 'base64');
  fs.writeFileSync(S + 'list1.png', pngBuf);
  ok(pngBuf.slice(1, 4).toString() === 'PNG' && png.width === 1200 && pngBuf.readUInt32BE(16) === 1200 && png.height === Math.round((1200 * 297) / 420), `exportDrawing("png", width 1200) – PNG ${png.width}×${png.height}`);
  const csvErr = await p.evaluate(() => window.mncad.exportDrawing('csv').then(() => '', (e) => e.message));
  ok(/Kusovník CSV je jen u sestavy/.test(csvErr), 'exportDrawing("csv") u dílu → srozumitelná chyba');
  const badSheet = await p.evaluate(() => window.mncad.exportDrawing('svg', { sheet: 9 }).then(() => '', (e) => e.message));
  ok(/list 9 neexistuje/.test(badSheet), 'exportDrawing s neexistujícím listem → chyba se seznamem listů');
  ok(downloads === before, 'export bez dialogu a bez stažení souboru');

  // ── 5. výkresové prostředí: otevře se na aktivním listu, značky na správném listu, přepnutí listu příkazem ──
  await run('výkres');
  await p.waitForSelector('[data-drawing-workspace]', { timeout: 120000 });
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === 'Ra 0,8'), null, { timeout: 120000 }).catch(() => {});
  let t = await sheetTexts();
  ok(t.includes('Ra 0,8') && t.includes('0,02') && !t.includes('JEN LIST 2'), 'výkres se otevřel na listu 1 se značkami (Ra 0,8, 0,02)');
  ok((await activeTab()) === 'List 1', `aktivní záložka listu: ${await activeTab()}`);
  await run('výkres list 2');
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === 'JEN LIST 2'), null, { timeout: 120000 }).catch(() => {});
  t = await sheetTexts();
  ok(t.includes('JEN LIST 2') && !t.includes('Ra 0,8'), 'výkres list 2 přepne otevřený výkres na list 2');
  ok((await activeTab()) === 'Detail', `aktivní záložka listu po přepnutí: ${await activeTab()}`);
  await p.screenshot({ path: S + 'detail-sheet.png' });
  // klik na záložku listu 1 → další příkaz pracuje s listem 1
  await p.locator('[data-drawing-workspace]').getByRole('button', { name: 'List 1', exact: true }).click();
  await p.waitForTimeout(1500);
  const log5 = await run('výkres značka poznámka "ZE ZÁLOŽKY" na Ø40');
  ok(/✓ značka poznámka ZE ZÁLOŽKY → kóta Ø40.* · list 1 „List 1“/.test(log5), 'po kliknutí na záložku List 1 pracují příkazy s listem 1');
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === 'ZE ZÁLOŽKY'), null, { timeout: 120000 }).catch(() => {});
  t = await sheetTexts();
  ok(t.includes('ZE ZÁLOŽKY') && t.includes('Ra 0,8'), 'poznámka se zobrazila na listu 1 ve výkresovém prostředí');
  await p.screenshot({ path: S + 'sheet1.png' });

  // ── 6. smazat, list smazat ──
  const log6 = await run('výkres smazat vlastní\nvýkres list smazat 2\nvýkres listy');
  ok(/✓ smazáno \d+: /.test(log6) && /✓ list 2 „Detail“ smazán – aktivní list 1 „List 1“/.test(log6) && /Listy \(1\): 1 „List 1“ A3 \(aktivní\)/.test(log6), 'výkres smazat vlastní, výkres list smazat 2');
  const d2 = await p.evaluate(() => window.mncad.getDocument());
  ok(d2.drawings.length === 1 && d2.drawings[0].annotations.every((a) => a.auto), 'dokument: 1 list, jen vygenerované kóty');

  // ── 7. příklad D z návodu pro AI (celý, v nové záložce) ──
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click().catch(() => {});
  await p.waitForTimeout(1000);
  const guide = await p.evaluate(() => window.mncad.guide());
  const gi = guide.indexOf('### Příklad D');
  const ga = guide.indexOf('```', gi) + 3;
  const D = gi < 0 ? '' : guide.slice(ga, guide.indexOf('```', ga)).trim();
  ok(/výkres list nový/.test(D) && /výkres značka/.test(D), 'návod pro AI obsahuje příklad D s listy a značkami');
  const logD = await run(D);
  fs.writeFileSync(S + 'logD.txt', logD);
  ok(!/^✗/m.test(logD) && /Listy \(2\)/.test(logD) && /✓ detail A/.test(logD), 'příklad D z návodu proběhl bez chyb' + (first(logD, /^✗.*$/m) ? ' – ' + first(logD, /^✗.*$/m) : ''));
  const pngD = await ex('png', { sheet: 1 });
  ok(pngD.width === 2000 && Buffer.from(pngD.base64, 'base64').slice(1, 4).toString() === 'PNG', 'příklad D: náhled listu 1 jako PNG 2000 px');
  fs.writeFileSync(S + 'exampleD.png', Buffer.from(pngD.base64, 'base64'));

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
