// E2E – výkres: kóty podle vybrané geometrie (kružnice → Ø / R, hrana → délka, dvě hrany → úhel, dva body → vzdálenost),
// zvýraznění pod kurzorem, pole u kurzoru (tolerance / přípona, odsazení; Enter potvrdí, Esc ponechá výchozí), úprava v seznamu,
// uložení do dokumentu a znovuotevření výkresu, export DXF / PDF / DWG s novými kótami, asociativita po změně modelu
// (kóta sleduje průměr díry a délku hrany, zmizelá geometrie se označí ⚠), přejmenování listu přímo na záložce (bez window.prompt).
// Spuštění: E2E_BASE=http://localhost:3202 node e2e/cad-drawing-dims.e2e.cjs <složka>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const has = (bin) => { try { execFileSync('which', [bin]); return true; } catch { return false; } };
const near = (a, b, e = 0.06) => Math.abs(a - b) <= e;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); }); // headless: ukládání přes dotaz na název
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await start(p);

  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const getDoc = () => p.evaluate(() => window.mncad.getDocument());
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));
  const hoverText = () => p.evaluate(() => document.querySelector('[data-dim-hover]')?.textContent || '');
  const waitText = (s) => p.waitForFunction((s) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === s), s, { timeout: 15000 }).then(() => true, () => false);
  const openDrawing = async () => {
    await p.getByRole('button', { name: 'Soubor', exact: true }).click();
    await p.getByRole('button', { name: /Výkres PDF/ }).click();
    await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 180000 });
    await p.waitForTimeout(700);
  };
  const closeDrawing = async () => { await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click(); await p.waitForTimeout(900); };
  /** přepočet: bod modelu (x, y) v půdorysu → px obrazovky (umístění pohledů dává atribut data-views) */
  const topMap = async () => {
    const g = await p.evaluate(() => { const s = document.querySelector('[data-sheet] > div svg'); const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, k: r.width / Number(s.getAttribute('viewBox').split(' ')[2]), views: JSON.parse(document.querySelector('[data-sheet]').getAttribute('data-views')) }; });
    const v = g.views.find((x) => x.key === 'top');
    return (x, y) => [g.l + (v.px + (x - v.x0) * v.s) * g.k, g.t + (v.py + (-y - v.y0) * v.s) * g.k];
  };
  let T;
  const move = async (x, y) => { const [cx, cy] = T(x, y); await p.mouse.move(cx, cy); await p.waitForTimeout(150); };
  const click = async (x, y, shift) => {
    const [cx, cy] = T(x, y);
    await p.mouse.move(cx, cy); await p.waitForTimeout(100);
    if (shift) await p.keyboard.down('Shift');
    await p.mouse.click(cx, cy);
    if (shift) await p.keyboard.up('Shift');
    await p.waitForTimeout(300);
  };
  const boxOpen = () => p.locator('[data-dim-box]').isVisible();

  // deska 100 × 60 × 20 (X 0…100, Y 0…60) s dírou Ø12 v [30; 30] a sraženými svislými hranami 10 mm (→ šikmé hrany 45° v půdorysu)
  const log = await run('nový díl Kóty\nkvádr 100 60 20\ndíra 12 skrz v 30 30\nsrazit 10 hrany svislé\nstav');
  ok(!/^✗/m.test(log) && /Geometrie: platná/.test(log), 'díl pro výkres vytvořen (deska s dírou Ø12 a sraženími)');
  await openDrawing();
  // nové výkresy mají Chytré kóty (vygenerované poznámky) – tento test ověřuje vlastní kóty uživatele v dřívějším režimu „Auto + Ø“
  await p.locator('[data-drawing-workspace] aside').getByRole('button', { name: 'Auto + Ø', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('[data-drawing-workspace] aside ul li'), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  T = await topMap();

  // ── 1. přejmenování listu přímo na záložce (žádný window.prompt) ──
  const tabs = p.locator('[data-drawing-workspace] > div').nth(0);
  const tab = () => tabs.locator('button[title="Dvojklik = přejmenovat"]').first();
  await tab().dblclick(); await p.waitForTimeout(200);
  const ren = p.locator('[data-sheet-rename]');
  ok(await ren.isVisible() && (await ren.inputValue()) === 'List 1' && dialogs.length === 0, 'dvojklik na záložku listu otevře pole přímo na záložce (bez dialogu prohlížeče)');
  await ren.fill('Detail A'); await ren.press('Enter'); await p.waitForTimeout(200);
  ok((await tab().textContent()) === 'Detail A' && !(await ren.isVisible()), 'Enter potvrdí nový název listu');
  await tab().dblclick(); await ren.fill('Zahodit'); await ren.press('Escape'); await p.waitForTimeout(200);
  ok((await tab().textContent()) === 'Detail A' && (await p.locator('[data-drawing-workspace]').count()) === 1, 'Esc přejmenování zruší (název zůstane, výkres se nezavře)');
  await tab().dblclick(); await ren.fill('Hlavní'); await p.locator('[data-drawing-workspace] header p').first().click(); await p.waitForTimeout(250);
  ok((await tab().textContent()) === 'Hlavní', 'opuštění pole (klik jinam) název potvrdí');
  await tab().dblclick(); await ren.fill('   '); await ren.press('Enter'); await p.waitForTimeout(200);
  ok((await tab().textContent()) === 'Hlavní' && dialogs.length === 0, 'prázdný název se nepřijme; žádný dialog prohlížeče');

  // ── 2. nástroj Kóta: co by se vybralo pod kurzorem ──
  await p.keyboard.press('d'); await p.waitForTimeout(250);
  ok(/Kóta/.test((await p.locator('[data-active-tool]').textContent()) || '') && await p.locator('[data-circ-kind]').isVisible(), 'klávesa D zapne nástroj Kóta s přepínačem Kružnice (Auto / Ø / R)');
  await move(36, 30);
  let h = await hoverText();
  ok(/Kružnice: Ø12 · Shift = R6/.test(h) && (await p.locator('[data-dim-overlay] [data-pick="circle"]').count()) === 1, `nad dírou: zvýrazněná kružnice a popisek „${h}“`);
  await p.screenshot({ path: S + 'dims-hover-circle.png' });
  await move(50, 60); h = await hoverText();
  ok(/Hrana: délka 80/.test(h) && (await p.locator('[data-dim-overlay] [data-pick="line"]').count()) === 1, `nad hranou: zvýrazněná hrana a popisek „${h}“`);
  await move(10.4, 59.8); h = await hoverText();
  ok(/^Bod$/.test(h) && (await p.locator('[data-dim-overlay] [data-pick="point"]').count()) === 1, 'u konce hrany: bod (přichycení ke konci hrany)');
  await move(30.3, 30.2); h = await hoverText();
  ok(/^Bod$/.test(h), 'uprostřed díry: bod (střed kružnice)');

  // ── 3. průměr díry Ø + tolerance v poli u kurzoru ──
  await click(36, 30);
  await move(55, 45); h = await hoverText();
  ok(/Ø12/.test(h) && (await p.locator('[data-dim-preview] text').count()) >= 1, `po kliknutí na kružnici: náhled kóty u kurzoru („${h}“)`);
  await click(55, 45);
  ok(await boxOpen() && await p.evaluate(() => document.activeElement?.hasAttribute('data-dim-suffix')), 'po umístění kóty: pole u kurzoru s fokusem v „tolerance / přípona“');
  await p.keyboard.type('H7');
  await p.screenshot({ path: S + 'dims-box.png' });
  await p.keyboard.press('Enter');
  ok(await waitText('Ø12H7') && !(await boxOpen()), 'kóta průměru s tolerancí: Ø12H7 (Enter potvrdí a pole zavře)');
  ok(/Kóta/.test((await p.locator('[data-active-tool]').textContent()) || ''), 'nástroj Kóta zůstává aktivní pro další kóty');

  // ── 4. poloměr R (Shift + klik); Esc v poli ponechá výchozí hodnoty ──
  await click(30, 24, true);
  await move(14, 14); h = await hoverText();
  ok(/R6/.test(h), `Shift + klik na kružnici → kóta poloměru („${h}“)`);
  await click(14, 14);
  ok(await boxOpen(), 'pole u kurzoru i u kóty poloměru');
  await p.locator('[data-dim-suffix]').fill('zahodit');
  await p.locator('[data-dim-offset]').fill('40');
  ok(await waitText('R6zahodit'), 'psaní v poli se hned propisuje do kóty (náhled)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  let t = await sheetTexts();
  ok(t.includes('R6') && !t.includes('R6zahodit') && !(await boxOpen()), 'Esc v poli: kóta R6 zůstane s výchozími hodnotami (bez přípony)');
  let doc = await getDoc(); // (uložení do dokumentu běží s prodlevou 0,5 s)
  await p.waitForTimeout(700); doc = await getDoc();
  const annR = doc.drawings?.[0]?.annotations?.find((a) => a.kind === 'radius');
  ok(annR && near(annR.r, 6) && annR.suffix === undefined && !near(annR.offset, 40, 0.5), `dokument: kóta poloměru r = ${annR?.r}, odsazení ${annR?.offset} (ne 40), bez přípony`);

  // ── 5. délka hrany jedním kliknutím + tolerance a odsazení číslem ──
  await click(50, 60);
  await move(50, 68); h = await hoverText();
  ok(/80/.test(h), `klik na hranu → náhled kóty její délky („${h}“)`);
  await click(50, 68);
  await p.locator('[data-dim-suffix]').fill('±0,1');
  await p.locator('[data-dim-offset]').fill('14');
  await p.locator('[data-dim-offset]').press('Enter');
  ok(await waitText('80±0,1'), 'kóta délky hrany s tolerancí: 80±0,1 (konce hrany vzaty z geometrie)');

  // ── 6. úhel dvou hran ──
  await click(60, 60);
  await move(5, 55); h = await hoverText();
  ok(/Druhá hrana: úhel 45° \/ 135°/.test(h), `druhá hrana: popisek úhlu („${h}“)`);
  await click(5, 55);
  await move(22, 50); h = await hoverText();
  await p.screenshot({ path: S + 'dims-angle-preview.png' });
  await click(22, 50);
  await p.keyboard.press('Enter');
  ok(await waitText('135°'), `úhlová kóta dvou hran: 135° (náhled „${h}“)`);
  await click(60, 60); await click(5, 55); await click(3, 57.5); await p.keyboard.press('Enter');
  ok(await waitText('45°'), 'tytéž hrany, kóta položená do vedlejšího sektoru: 45°');

  // ── 7. dva body jako dosud (3 kliknutí) ──
  const n80 = (await sheetTexts()).filter((x) => x === '80').length;
  await click(10, 0); await click(90, 0); await move(50, -9); await click(50, -9);
  ok(await boxOpen(), 'kóta dvou bodů: po 3. kliknutí pole u kurzoru');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok((await sheetTexts()).filter((x) => x === '80').length === n80 + 1, 'délková kóta mezi dvěma body (konce spodní hrany): 80');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250); // vypnout nástroj
  ok((await p.locator('[data-active-tool]').count()) === 0 && (await p.locator('[data-drawing-workspace]').count()) === 1, 'Esc vypne nástroj (výkres zůstane otevřený)');

  // ── 8. seznam: nové druhy kót, úprava odsazení a přípony později ──
  const rows = p.locator('[data-drawing-workspace] aside ul li');
  ok((await rows.count()) === 6 && (await p.locator('[data-ann-flag]').count()) === 0, 'seznam: 6 kót, žádná označená ⚠');
  const rowTxt = await rows.allTextContents();
  ok(/Ø/.test(rowTxt[0]) && /R/.test(rowTxt[1]) && /∠/.test(rowTxt[3]), 'seznam ukazuje druh kóty (Ø, R, ∠)');
  const off0 = rows.nth(0).locator('[data-dim-list-offset]');
  await off0.fill('9'); await off0.press('Enter');
  await rows.nth(3).locator('input[aria-label="Přípona kóty"]').fill(' ±0,5°');
  ok(await waitText('135° ±0,5°'), 'přípona doplněná později v seznamu (úhel 135° ±0,5°)');
  await p.waitForTimeout(800);
  doc = await getDoc();
  const anns = doc.drawings?.[0]?.annotations || [];
  ok(anns.map((a) => a.kind).join() === 'diameter,radius,horizontal,angle,angle,horizontal', 'dokument: druhy kót ' + anns.map((a) => a.kind).join());
  ok(anns[0].suffix === 'H7' && near(anns[0].r, 6) && near(anns[0].c[0], 30) && near(anns[0].c[1], -30) && near(anns[0].offset, 9), `Ø: střed [${anns[0].c}], r ${anns[0].r}, přípona ${anns[0].suffix}, odsazení ze seznamu ${anns[0].offset}`);
  ok(anns[2].edge === true && near(Math.abs(anns[2].offset), 14) && near(Math.min(anns[2].a[0], anns[2].b[0]), 10) && near(Math.max(anns[2].a[0], anns[2].b[0]), 90) && anns[2].suffix === '±0,1', `hrana: konce x ${anns[2].a[0]}…${anns[2].b[0]}, odsazení zadané číslem ${anns[2].offset}`);
  ok(anns[5].edge === undefined && near(anns[5].a[0], 10) && near(anns[5].b[0], 90), 'kóta dvou bodů je uložená jako dosud (bez vazby na hranu)');
  ok(doc.drawings?.[0]?.name === 'Hlavní', 'název listu z přejmenování na záložce je v dokumentu');
  await p.screenshot({ path: S + 'dims-all.png' });

  // ── 9. export: DXF (text), PDF (pdftotext), DWG ──
  const header = p.locator('[data-drawing-workspace] header');
  const [dx] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), header.getByRole('button', { name: 'DXF', exact: true }).click()]);
  await dx.saveAs(S + 'dims.dxf');
  const dxf = fs.readFileSync(S + 'dims.dxf', 'utf8');
  // DXF R12: ne-ASCII znaky jako \U+XXXX → Ø = \U+00D8, ° = \U+00B0, ± = \U+00B1
  const inDxf = ['\\U+00D812H7', '\nR6\n', '80\\U+00B10,1', '135\\U+00B0 \\U+00B10,5\\U+00B0', '45\\U+00B0'];
  const missDxf = inDxf.filter((x) => !dxf.includes(x));
  ok(missDxf.length === 0, `DXF obsahuje nové kóty (Ø12H7, R6, 80±0,1, 135°, 45°)${missDxf.length ? ' – chybí: ' + JSON.stringify(missDxf) : ''}`);
  const [pd] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), header.getByRole('button', { name: 'PDF', exact: true }).click()]);
  await pd.saveAs(S + 'dims.pdf');
  ok(fs.statSync(S + 'dims.pdf').size > 5000, `PDF uloženo (${Math.round(fs.statSync(S + 'dims.pdf').size / 1024)} kB)`);
  if (has('pdftotext')) {
    const text = execFileSync('pdftotext', ['-layout', S + 'dims.pdf', '-']).toString();
    const want = ['Ø12H7', 'R6', '80±0,1', '135°', '45°'];
    const miss = want.filter((x) => !text.includes(x));
    ok(miss.length === 0, `PDF: nové kóty jsou v textu (${want.join(', ')})${miss.length ? ' – chybí: ' + miss.join(', ') : ''}`);
  } else ok(true, 'pdftotext není k dispozici – kontrola textu PDF přeskočena');
  if (has('pdftoppm')) execFileSync('pdftoppm', ['-r', '70', '-png', '-singlefile', S + 'dims.pdf', S + 'dims-pdf']);
  const [dw] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), header.getByRole('button', { name: 'DWG', exact: true }).click()]);
  await dw.saveAs(S + 'dims.dwg');
  ok(fs.statSync(S + 'dims.dwg').size > 10000 && fs.readFileSync(S + 'dims.dwg').subarray(0, 2).toString() === 'AC', `DWG uloženo (${Math.round(fs.statSync(S + 'dims.dwg').size / 1024)} kB) – stejná geometrie a texty jako DXF`);

  // ── 10. zavření a znovuotevření výkresu: kóty zůstanou ──
  await closeDrawing();
  ok((await p.locator('[data-drawing-workspace]').count()) === 0, 'výkres zavřen');
  doc = await getDoc();
  ok((doc.drawings?.[0]?.annotations || []).length === 6, 'po zavření je v dokumentu 6 kót');
  await openDrawing();
  t = await sheetTexts();
  const back = ['Ø12H7', 'R6', '80±0,1', '135° ±0,5°', '45°'].filter((x) => !t.includes(x));
  ok(back.length === 0 && (await p.locator('[data-drawing-workspace] aside ul li').count()) === 6, 'po znovuotevření výkresu jsou kóty Ø, R, hrany i úhlu zpět' + (back.length ? ' – chybí: ' + back.join(', ') : ''));
  ok((await tab().textContent()) === 'Hlavní', 'název listu po znovuotevření: Hlavní');
  await closeDrawing();

  // ── 11. asociativita: změna modelu (díra Ø12 → Ø14, deska 100 → 120) – kóty sledují geometrii ──
  doc = await getDoc();
  const d2 = JSON.parse(JSON.stringify(doc));
  d2.features.find((f) => f.type === 'hole').diameter = 14;
  d2.features.find((f) => f.type === 'box').size = [120, 60, 20];
  const log2 = await run(JSON.stringify(d2));
  ok(!/^✗/m.test(log2), 'model změněn (díra Ø14, délka 120)');
  await p.waitForTimeout(1500);
  await openDrawing();
  t = await sheetTexts();
  ok(t.includes('Ø14H7') && t.includes('R7'), 'po změně průměru díry kóty ukazují Ø14H7 a R7 (drží se kružnice ve stejném středu)');
  ok(t.includes('100±0,1'), 'kóta délky hrany sleduje delší hranu: 100±0,1');
  ok((await p.locator('[data-ann-flag]').count()) === 0, 'žádná kóta není označená – geometrie byla dohledána');
  await closeDrawing();
  // sražení odstraněno → šikmá hrana úhlových kót zmizí
  const d3 = JSON.parse(JSON.stringify(await getDoc()));
  d3.features = d3.features.filter((f) => f.type !== 'chamfer');
  await run(JSON.stringify(d3));
  await p.waitForTimeout(1500);
  await openDrawing();
  t = await sheetTexts();
  ok((await p.locator('[data-ann-flag="lost"]').count()) === 2 && await p.locator('[data-ann-flagged]').isVisible(), 'po odstranění sražení jsou obě úhlové kóty označené ⚠ (v seznamu i ve stavovém řádku)');
  ok(t.includes('120±0,1'), 'kóta hrany sleduje celou hranu bez sražení: 120±0,1');
  await p.screenshot({ path: S + 'dims-flagged.png' });
  // pohled s kótami vypnut → kóty se nekreslí a jsou označené
  await p.locator('[data-drawing-workspace] aside').getByText('Shora', { exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll('[data-ann-flag="noView"]').length === 6, null, { timeout: 30000 }).catch(() => {});
  t = await sheetTexts();
  ok((await p.locator('[data-ann-flag="noView"]').count()) === 6 && !t.includes('Ø14H7') && !t.includes('120±0,1'), 'vypnutý pohled: jeho kóty se nekreslí a v seznamu jsou označené');

  ok(dialogs.every((m) => /Uložit jako/.test(m)), 'jediné dialogy prohlížeče byly dotazy na název ukládaného souboru: ' + dialogs.length);
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
