// E2E – předloha (w15, zpráva 959 kap. 5.1 / 5.2) přes TEXTOVOU KONZOLI (bez window.mncad) a v GUI:
//  - konzole: díl desky textem, předloha bez připojeného souboru (✗ s návodem), Připojit soubor… (DXF předlohy
//    z src/cad/reference/__fixtures__/deska-predloha.dxf – vygenerovaná, žádná data zákazníka), předloha "…" (stav:
//    listy, pohledy, kóty, rozpor text × geometrie, rozpor kusovník × razítko), výtah kót / kusovníku / razítka
//    (cs / en / de), porovnat předloha pohled horní (100 %, obrázek SVG ke stažení), kontrola kót (✓), předloha stav
//    (poslední kontroly v dokumentu); druhý díl s menší dírou: pokrytí < 100 %, úsek mimo toleranci na místě díry,
//    kontrola kót ✗ s hodnotou modelu; předloha otevřít → 2D výkres v nové záložce;
//  - GUI: seznam připojených souborů v konzoli, záložka 2D výkresu předlohy.
// Spuštění: E2E_BASE=http://localhost:3425 node e2e/cad-w15-reference.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-w15-reference').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const first = (log, re) => (re.exec(log) || [])[0] || '';
const DXF = fs.readFileSync(path.join(__dirname, '../src/cad/reference/__fixtures__/deska-predloha.dxf'));
const PLATE = (dc) => ['kvádr 120 80 20 střed', 'díra 8 skrz v -45 -25 20 v 45 -25 20 v -45 25 20 v 45 25 20', `díra ${dc} skrz v 0 0 20`];

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  const dl = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  p.on('download', (d) => dl.push(d));
  const nextDownload = async (n, ms = 60000) => {
    const t0 = Date.now();
    while (dl.length < n && Date.now() - t0 < ms) await p.waitForTimeout(200);
    const d = dl[n - 1];
    if (!d) return null;
    const file = S + d.suggestedFilename();
    await d.saveAs(file);
    return { name: d.suggestedFilename(), path: file, data: fs.readFileSync(file) };
  };
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro') && document.body.innerText.includes('OCCT'), null, { timeout: 300000 });
  await p.waitForTimeout(1000);

  const openConsole = async () => {
    const input = p.getByLabel('Textové příkazy nebo JSON');
    if (!(await input.isVisible({ timeout: 1500 }).catch(() => false))) {
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await p.keyboard.press('Control+Shift+K');
    }
    await input.waitFor({ timeout: 20000 });
    return input;
  };
  const out = p.locator('[data-agent-output]');
  const run = async (text, ms = 300000) => {
    const input = await openConsole();
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };

  // 1. díl desky textem (shodný s předlohou: 120 × 80 × 20, 4× Ø8, Ø20 uprostřed)
  let log = await run(['nový díl Deska předloha', ...PLATE(20)].join('\n'));
  fs.writeFileSync(S + 'log1.txt', log);
  ok(!/^✗/m.test(log), 'díl desky bez ✗' + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));

  // 2. předloha bez připojeného souboru → ✗ s návodem (žádné tiché nic)
  log = await run('předloha "deska-predloha.dxf"');
  ok(/✗ řádek 1: předloha „deska-predloha\.dxf“: soubor není připojený – připojte ho v konzoli tlačítkem „Připojit soubor…“/.test(log), 'bez souboru: ✗ soubor není připojený + návod');

  // 3. Připojit soubor… (GUI konzole) a připojení předlohy
  await openConsole();
  await p.locator('[data-agent-attach-input]').setInputFiles({ name: 'deska-predloha.dxf', mimeType: 'application/dxf', buffer: DXF });
  await p.waitForSelector('[data-attached="deska-predloha.dxf"]', { timeout: 10000 }).catch(() => {});
  ok(await p.locator('[data-attached="deska-predloha.dxf"]').isVisible().catch(() => false), 'konzole: Připojit soubor… → deska-predloha.dxf v seznamu připojených');
  log = await run('předloha "deska-predloha.dxf"');
  fs.writeFileSync(S + 'log3.txt', log);
  ok(/✓ připojeno: předloha „deska-predloha\.dxf“ \(DXF R2018 \(AC1032\), \d+ kB\): listy 1 \(1× A3\), pohledy 2, kóty 7, díry a normálie 5, pozice 1, razítka 1/.test(log), 'předloha: listy, pohledy, kóty, díry, pozice, razítka');
  ok(/· list 1: A3 1:1 „DESKA 120x80“, pohledy 2, číslo výkresu RD-001, pozice 1/.test(log), 'stav: list A3 1:1 s razítkem');
  ok(/✗ text kóty ≠ geometrie: 1 – list 1 kóta \w+: text 19\.8, geometrie 20/.test(log), 'rozpor: text kóty 19.8 × geometrie 20');
  ok(/✗ rozpor: pozice 1: kusovník „20\*80\*125“, razítko listu 1 „20\*80\*120“/.test(log), 'rozpor: kusovník × razítko');
  ok(log.length < 2500, `protokol připojení krátký (${log.length} znaků)`);

  // 4. výtah textem v cs / en / de
  log = await run('předloha výtah kóty\nreference extract bom\nvorlage auszug schriftfeld\npředloha výtah díry');
  fs.writeFileSync(S + 'log4.txt', log);
  ok(/✗ 1\.2 \w+: 19\.8 · změřeno 20/.test(log), 'výtah kót: ✗ 19.8 · změřeno 20 v pohledu 1.2');
  ok(/· 1\.1 \w+: 80±0,10 · změřeno 80/.test(log) && /Ø20 H7 \(uložení H7\)/.test(log) && /4x Ø8/.test(log), 'výtah kót: tolerance, uložení H7, počet 4×');
  ok(/1 \| 1 \| DESKA \| S235JR \| 20\*80\*125/.test(log), 'EN reference extract bom: řádek kusovníku ve sloupcích hlavičky');
  ok(/NAZEV=DESKA 120x80 · CISLO=RD-001 · MATERIAL=S235JR/.test(log), 'DE vorlage auszug schriftfeld: pole razítka');
  ok(/4× kružnice Ø8 – pohled 1\.1/.test(log) && /1× kružnice Ø20 – pohled 1\.1/.test(log), 'výtah děr: 4× Ø8, 1× Ø20');

  // 5. porovnání pohledu modelu s předlohou + obrázek SVG
  const nDl = dl.length;
  log = await run('porovnat předloha pohled horní');
  fs.writeFileSync(S + 'log5.txt', log);
  ok(/✓ porovnání pohled horní × předloha 1\.1 \(tolerance 0,06 mm\): předloha pokryta modelem 100 %, model pokryt předlohou 100 %/.test(log), 'porovnání: horní × 1.1 = 100 % / 100 %' + (first(log, /porovnání.*$/m) ? ' – ' + first(log, /porovnání.*$/m) : ''));
  const svg = await nextDownload(nDl + 1);
  ok(!!svg && svg.name === 'porovnani-horni-1.1.svg' && /^<svg[^>]*data-ref-view="1\.1"/.test(svg.data.toString()), 'obrázek překryvu SVG stažen bez dialogu' + (svg ? ` (${svg.name}, ${svg.data.length} B)` : ''));

  // 6. kontrola kót (pohledy se spárují samy) a stav s uloženými výsledky
  log = await run('předloha kontrola kót\npředloha stav');
  fs.writeFileSync(S + 'log6.txt', log);
  ok(/✓ kontrola kót předlohy 1\.1 × model \(pohled horní\): 6 ✓, 0 ✗, 0 bez bodu v modelu/.test(log), 'kontrola kót půdorysu: 6 ✓, 0 ✗, 0 bez bodu');
  ok(/✗ kontrola kót předlohy 1\.2 × model \(pohled (přední|zadní)\): 0 ✓, 1 ✗/.test(log) && /✗ kóta \w+ „19\.8“ [^\n]*předloha si odporuje: text 19\.8, geometrie předlohy 20/.test(log), 'kontrola kót nárysu: 19.8 ✗ – předloha si odporuje (ne ✓ „zaokrouhleno“)');
  ok(/✓ poslední porovnání \([^)]+\): pohled horní × předloha 1\.1: pokrytí 100 % \/ model 100 %/.test(log) && /✗ poslední kontrola kót \([^)]+\): 6 ✓, 1 ✗/.test(log), 'předloha stav: poslední porovnání a kontrola kót uložené v dokumentu');
  // 6b. změna modelu → uložené výsledky zastaralé
  log = await run('díra 30 skrz v 0 0 20\npředloha stav');
  fs.writeFileSync(S + 'log6b.txt', log);
  ok(/⚠ poslední porovnání [^\n]*ZASTARALÉ/.test(log) && /⚠ poslední kontrola kót [^\n]*ZASTARALÉ/.test(log), 'po změně modelu: poslední porovnání i kontrola kót ⚠ ZASTARALÉ');

  // 7. druhý díl s menší středovou dírou (Ø18): pokrytí < 100 %, úsek na místě díry, kontrola kót ✗
  log = await run(['nový díl Deska jiná', ...PLATE(18), 'předloha "deska-predloha.dxf"', 'porovnat předloha pohled horní', 'kontrola kót pohled horní'].join('\n'));
  fs.writeFileSync(S + 'log7.txt', log);
  const cov = Number((/předloha pokryta modelem ([\d,]+) %/.exec(log) || [])[1]?.replace(',', '.'));
  ok(/✗ porovnání pohled horní × předloha 1\.1/.test(log) && cov > 70 && cov < 99, `Ø18: porovnání ✗, pokrytí ${cov} %`);
  ok(/· chybí v modelu: úsek předlohy 62,8\d? mm u \[60; 40\]/.test(log), 'Ø18: chybí úsek 62,8 mm (obvod Ø20) ve středu pohledu [60; 40]');
  ok(/✗ kóta \w+ „Ø20 H7“ \[[^\]]+\]: model 18/.test(log), 'kontrola kót: ✗ Ø20 H7 – model 18');

  // 8. předloha jako 2D výkres v nové záložce (GUI)
  log = await run('předloha otevřít\nzáložky');
  fs.writeFileSync(S + 'log8.txt', log);
  ok(/✓ předloha „deska-predloha\.dxf“ otevřena jako 2D výkres v nové záložce/.test(log), 'předloha otevřít: 2D výkres v nové záložce');
  ok(/Předloha deska-predloha/.test(log), 'záložky: záložka „Předloha deska-predloha“');
  await p.screenshot({ path: S + 'predloha-2d.png' }).catch(() => {});

  // 9. vektorové PDF jako předloha: výkres modelu 1:2 → PDF (stažení z konzole) → připojit → porovnat
  const nPdf = dl.length;
  log = await run('záložka "Deska předloha"\nvýkres A3 na šířku měřítko 1:2 pohledy přední,horní\nvýkres export pdf');
  fs.writeFileSync(S + 'log9a.txt', log);
  const pdf = await nextDownload(nPdf + 1);
  ok(!!pdf && /\.pdf$/.test(pdf.name) && pdf.data.slice(0, 5).toString() === '%PDF-', 'výkres 1:2 exportován do PDF' + (pdf ? ` (${pdf.name}, ${pdf.data.length} B)` : '') + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));
  if (pdf) {
    await openConsole();
    await p.locator('[data-agent-attach-input]').setInputFiles({ name: pdf.name, mimeType: 'application/pdf', buffer: pdf.data });
    await p.waitForSelector(`[data-attached="${pdf.name}"]`, { timeout: 10000 }).catch(() => {});
    log = await run(`předloha "${pdf.name}"\nporovnat předloha pohled horní bez skrytých tolerance 0,1`);
    fs.writeFileSync(S + 'log9b.txt', log);
    ok(new RegExp(`✓ připojeno: předloha „${pdf.name.replace(/[.()]/g, '\\$&')}“ \\(PDF, [^)]*\\): listy 1 \\(1× A3\\)`).test(log), 'PDF předloha: 1 list A3');
    const pc = Number((/předloha pokryta modelem ([\d,]+) %, model pokryt předlohou ([\d,]+) %/.exec(log) || [])[1]?.replace(',', '.'));
    const mc = Number((/předloha pokryta modelem ([\d,]+) %, model pokryt předlohou ([\d,]+) %/.exec(log) || [])[2]?.replace(',', '.'));
    ok(pc >= 95 && mc >= 95, `PDF předloha × model (pohled horní, tolerance 0,1): pokrytí ${pc} % / ${mc} %` + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));
  }

  // 10. vlastní výkres jako předloha: export DXF R12 (rozložené kóty, výkres 1:2) → připojit → porovnat 100 %
  const nDxf = dl.length;
  log = await run('záložka "Deska předloha"\nvýkres A3 na šířku měřítko 1:2 pohledy přední,horní,pravý\nvýkres export dxf');
  fs.writeFileSync(S + 'log10a.txt', log);
  const dxf = await nextDownload(nDxf + 1);
  ok(!!dxf && /\.dxf$/i.test(dxf.name), 'výkres exportován do DXF' + (dxf ? ` (${dxf.name}, ${dxf.data.length} B)` : '') + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));
  if (dxf) {
    await openConsole();
    await p.locator('[data-agent-attach-input]').setInputFiles({ name: 'vlastni.dxf', mimeType: 'application/dxf', buffer: dxf.data });
    await p.waitForSelector('[data-attached="vlastni.dxf"]', { timeout: 10000 }).catch(() => {});
    log = await run('předloha "vlastni"\npředloha výtah pohledy\nporovnat předloha pohled horní\nporovnat s předlohou pohled přední');
    fs.writeFileSync(S + 'log10b.txt', log);
    ok(/✓ připojeno: předloha „vlastni\.dxf“ [^\n]*listy 1 \(1× A3\)/.test(log), 'vlastní DXF: list A3 (rámeček z čar / křivek), název bez přípony');
    ok(/✓ porovnání pohled horní × předloha [\d.]+ [^\n]*pokryta modelem 100 %, model pokryt předlohou 100 %/.test(log), 'vlastní DXF 1:2: porovnání horní 100 % / 100 % (kóty a rámeček mimo obrys)' + (first(log, /porovnání pohled horní.*$/m) ? ' – ' + first(log, /porovnání pohled horní.*$/m) : first(log, /^✗.*$/m)));
    ok(/✓ porovnání pohled přední × předloha [\d.]+ [^\n]*pokryta modelem 100 %/.test(log), 'porovnat s předlohou pohled přední: ✓' + (first(log, /porovnání pohled přední.*$/m) ? ' – ' + first(log, /porovnání pohled přední.*$/m) : first(log, /^✗.*$/m)));
  }

  // 11. API hned za sebou: další volání vidí dokument předchozího (attach → reference → reference, run → run)
  const api = await p.evaluate(async (b64) => {
    const m = window.mncad;
    m.attach('api-deska.dxf', b64);
    const a = await m.reference('"api-deska.dxf"');
    const b = await m.reference('výtah kóty');
    const c = await m.reference('dimension check');
    await m.run('nový díl API kostka\nkvádr 10 10 10');
    const d = await m.run('stav');
    return { a: a.log, b: b.log, c: c.log, d };
  }, DXF.toString('base64'));
  fs.writeFileSync(S + 'log11.txt', JSON.stringify(api, null, 1));
  ok(/✓ připojeno: předloha „api-deska\.dxf“/.test(api.a) && /19\.8 · změřeno 20/.test(api.b), 'API: reference hned po připojení vidí předlohu (výtah kót)' + (/není připojená/.test(api.b) ? ' – ' + first(api.b, /^.*není připojená.*$/m) : ''));
  ok(/kontrola kót předlohy/.test(api.c) && !/data nejsou base64|weder Base64/.test(api.c), 'API reference("dimension check") = kontrola kót');
  ok(/10 × 10 × 10/.test(api.d) && !/120 × 80 × 20/.test(api.d), 'API run → run: stav nového dílu (10 × 10 × 10), ne předchozího');

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails ? `FAIL ${fails}` : 'ALL OK');
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
