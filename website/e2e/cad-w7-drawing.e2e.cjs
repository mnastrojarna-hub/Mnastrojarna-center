// E2E – výkres vlny 7: pomocný pohled (nástroj → klik na šikmou hranu → Enter), zalomený řez (body → Enter), přerušení
// (2 kliky), částečný řez (oblast → Enter), výběr uložení ISO 286 u popisu díry (úchylky na listu), Tabulka uložení, revize
// s trojúhelníkem a zóny listu – ručně v prostředí výkresu; textové příkazy (řez natočený, přerušení, uložení, revize,
// zóny, stav) a export DXF / PDF / DWG / SVG přes window.mncad.
// Spuštění: E2E_BASE=http://localhost:3332 node e2e/cad-w7-drawing.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w7-drawing').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const getDoc = () => p.evaluate(() => window.mncad.getDocument());
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));
  const waitText = (s, ms = 60000) => p.waitForFunction((s) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === s), s, { timeout: ms }).then(() => true, () => false);
  const waitNoText = (s, ms = 60000) => p.waitForFunction((s) => ![...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === s), s, { timeout: ms }).then(() => true, () => false);
  const opts = async () => { await p.waitForTimeout(900); const d = await getDoc(); return d.drawings?.[0]?.options ?? {}; };
  /** bod modelu v rovině pohledu (x, y nahoru) → px obrazovky podle data-views */
  const mapper = async (key) => {
    const g = await p.evaluate(() => { const s = document.querySelector('[data-sheet] > div svg'); const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, k: r.width / Number(s.getAttribute('viewBox').split(' ')[2]), views: JSON.parse(document.querySelector('[data-sheet]').getAttribute('data-views')) }; });
    const v = g.views.find((x) => x.key === key);
    if (!v) return null;
    return { v, at: (x, y) => [g.l + (v.px + (x - v.x0) * v.s) * g.k, g.t + (v.py + (-y - v.y0) * v.s) * g.k] };
  };
  const clickAt = async (xy) => { await p.mouse.move(xy[0], xy[1]); await p.waitForTimeout(120); await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(250); };
  const busyDone = () => p.waitForFunction(() => !/Přepočítávám/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});

  // ── 1. díl: deska 100 × 60 × 20 se sraženými svislými hranami (šikmé plochy v půdorysu) a třemi dírami ──
  const log0 = await run('nový díl Deska W7\nkvádr 100 60 20\ndíra 12 skrz v 30 30\ndíra 8 skrz v 70 15\ndíra 8 skrz v 70 45\nsrazit 10 hrany svislé\nvýkres A3 na šířku pohledy přední,horní');
  ok(!/^✗/m.test(log0), 'díl a výkres A3 (přední, horní) textem' + (/^✗.*$/m.exec(log0)?.[0] ? ' – ' + /^✗.*$/m.exec(log0)[0] : ''));
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 240000 });
  await busyDone(); await p.waitForTimeout(1500);
  ok(await p.locator('[data-view-tools]').isVisible(), 'prostředí výkresu: sekce Pomocné pohledy a řezy');

  // ── 2. GUI: pomocný pohled z šikmé hrany sražení v půdorysu (roh 0,0: hrana z [10; 0] do [0; 10]) ──
  await p.locator('[data-view-tool="aux"]').click();
  ok(await p.locator('[data-view-tool-active]').isVisible(), 'nástroj Pomocný pohled aktivní s nápovědou');
  let T = await mapper('top');
  await clickAt(T.at(5, 5));
  ok(await p.locator('[data-view-tool-overlay] polyline').count() > 0, 'vybraná hrana zvýrazněná v překryvu');
  await p.keyboard.press('Enter');
  ok(await waitText('POHLED B'), 'Enter → POHLED B na listu');
  let o = await opts();
  ok(o.aux?.length === 1 && o.aux[0].parent === 'top' && o.aux[0].edge, 'pomocný pohled uložený v dokumentu (rodič horní, hrana)');
  const auxV = await mapper('aux:B');
  ok(!!auxV && auxV.v.w > 0, 'pomocný pohled má umístění v data-views');

  // ── 3. GUI: zalomený řez přes díry Ø12 a Ø8 (půdorys) ──
  await busyDone();
  await p.locator('[data-view-tool="stepped"]').click();
  T = await mapper('top');
  for (const [x, y] of [[-10, 30], [50, 30], [50, 15], [110, 15]]) await clickAt(T.at(x, y));
  await p.keyboard.press('Enter');
  ok(await waitText('ŘEZ C–C'), 'zalomený řez → ŘEZ C–C na listu');
  o = await opts();
  ok(o.cuts?.length === 1 && o.cuts[0].kind === 'stepped' && o.cuts[0].pts.length === 4, 'zalomený řez uložen (4 body)');
  const hatch = await p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg polyline')].filter((e) => e.getAttribute('stroke') === '#333' && e.getAttribute('stroke-width') === '0.18').length);
  ok(hatch > 20, `šrafy řezu na listu (${hatch} čar)`);

  // ── 3b. GUI: natočený řez – 3 kliky (konec hlavního ramena, vrchol, konec šikmého ramena) ──
  await busyDone();
  await p.locator('[data-view-tool="aligned"]').click();
  T = await mapper('top');
  for (const [x, y] of [[100, 30], [50, 30], [70, 45]]) await clickAt(T.at(x, y));
  ok(await waitText('ŘEZ D–D'), 'natočený řez (3 kliky) → ŘEZ D–D na listu');
  o = await opts();
  ok(o.cuts?.length === 2 && o.cuts[1].kind === 'aligned' && o.cuts[1].pts.length === 3, 'natočený řez uložen (3 body)');

  // ── 4. GUI: přerušení předního pohledu 30…70 (dva kliky) – kóta 100 zůstane ──
  await busyDone();
  let F = await mapper('front');
  const w0 = F.v.w * F.v.s;
  await p.locator('[data-view-tool="break"]').click();
  await clickAt(F.at(30, 10));
  await clickAt(F.at(70, 10));
  await p.waitForTimeout(1500); await busyDone();
  o = await opts();
  ok(o.breaks?.length === 1 && o.breaks[0].axis === 'x' && Math.abs(o.breaks[0].from - 30) < 1.5 && Math.abs(o.breaks[0].to - 70) < 1.5, `přerušení uloženo (x ${o.breaks?.[0]?.from?.toFixed?.(1)}…${o.breaks?.[0]?.to?.toFixed?.(1)})`);
  F = await mapper('front');
  ok(F.v.w * F.v.s < w0 - 10, `přední pohled je na listu kratší (${(F.v.w * F.v.s).toFixed(1)} < ${w0.toFixed(1)} mm)`);
  ok((await sheetTexts()).includes('100'), 'kóta délky 100 drží skutečnou délku i přes přerušení');

  // ── 5. GUI: částečný řez v předním pohledu kolem díry Ø12 (oblast → Enter) ──
  await p.locator('[data-view-tool="bo"]').click();
  F = await mapper('front');
  for (const [x, y] of [[20, 2], [28, 2], [28, 18], [20, 18]]) await clickAt(F.at(x, y));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500); await busyDone();
  o = await opts();
  ok(o.brokenOut?.length === 1 && o.brokenOut[0].view === 'front' && o.brokenOut[0].depth === 10, 'částečný řez uložen (přední, hloubka 10)');
  ok(await p.locator('[data-bo-row="1"]').isVisible() && await p.locator('[data-break-row="1"]').isVisible() && await p.locator('[data-cut-row="C"]').isVisible() && await p.locator('[data-aux-row="B"]').isVisible(), 'seznamy pohledů, řezů, částečných řezů a přerušení v panelu');

  // ── 6. GUI: uložení H7 u popisu díry Ø12 (výběr ISO 286) → úchylky na listu ──
  const row = p.locator('[data-drawing-workspace] li', { hasText: 'Ø12' }).first();
  await row.locator('[data-fit-open]').click();
  ok(await p.locator('[data-fit-picker]').isVisible(), 'výběr uložení ISO 286 otevřen');
  ok(/12 H7: \+0,018\/0/.test(await p.locator('[data-fit-preview]').textContent()), 'náhled úchylek ve výběru (12 H7: +0,018/0)');
  await p.locator('[data-fit-letter]').selectOption('H');
  await p.locator('[data-fit-grade]').selectOption('7');
  await p.locator('[data-fit-apply]').click();
  ok(await waitText('(+0,018/0)'), 'popis díry Ø12H7 s úchylkami (+0,018/0) na listu');
  await p.locator('[data-fit-table]').check();
  ok(await waitText('Tabulka uložení (ISO 286)'), 'Tabulka uložení na listu');

  // ── 7. GUI: revize A, trojúhelník u Ø12, zóny listu ──
  await p.getByRole('button', { name: '+ Přidat revizi' }).click();
  await p.waitForTimeout(400);
  await row.locator('[data-ann-rev]').selectOption('A');
  await p.locator('[data-zones]').check();
  ok(await waitText('Zóna'), 'zóny listu → sloupec Zóna v tabulce revizí');
  await p.waitForTimeout(1500);
  const tri = await p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].filter((t) => t.textContent === 'A' && t.getAttribute('font-size') === '2.4').length);
  ok(tri === 1, 'trojúhelník revize A u kóty');
  const zone = (await sheetTexts()).filter((s) => /^[A-F][1-8]$/.test(s));
  ok(zone.length >= 1, `zóna trojúhelníku v tabulce revizí (${zone.join(', ')})`);
  await p.screenshot({ path: S + 'w7-drawing-gui.png' });

  // ── 8. text: stav (uložení, zóny, revize), natočený řez, dotaz na uložení ──
  const log0b = await run('výkres stav');
  fs.writeFileSync(S + 'w7-drawing-status.txt', log0b);
  ok(/Uložení ISO 286 \(zobrazení úchylky, tabulka ano\): Ø12H7 skrz H7 \+0,018\/0/.test(log0b), 'stav: uložení Ø12H7 a Tabulka uložení');
  ok(/Zóny listu: 8 × 6 · trojúhelníky revizí: A: Ø12H7 skrz \([A-F]\d\)/.test(log0b), 'stav: zóny a trojúhelník revize A se zónou');
  // export (window.mncad.exportDrawing): DXF, SVG, PDF, DWG obsahují nové prvky
  const ex = (f) => p.evaluate((f) => window.mncad.exportDrawing(f), f);
  const dxf = await ex('dxf');
  const dxfText = Buffer.from(dxf.base64, 'base64').toString('utf8');
  ok(dxfText.includes('POHLED B') && dxfText.includes('\\U+0158EZ C\\U+2013C') && dxfText.includes('Tabulka ulo\\U+017Een\\U+00ED (ISO 286)') && dxfText.includes('Z\\U+00F3na'), 'DXF: POHLED B, ŘEZ C–C, Tabulka uložení, Zóna');
  const svg = Buffer.from((await ex('svg')).base64, 'base64').toString('utf8');
  ok(['POHLED B', 'ŘEZ C–C', '(+0,018/0)', 'Tabulka uložení (ISO 286)', '>Zóna<'].every((s) => svg.includes(s)), 'SVG: pohledy, řezy, úchylky, tabulky');
  const pdf = await ex('pdf');
  ok(pdf.mime === 'application/pdf' && pdf.bytes > 20000, `PDF ${pdf.bytes} B`);
  const dwg = await ex('dwg');
  ok(dwg.bytes > 10000, `DWG ${dwg.bytes} B`);
  const log1 = await run('výkres řez natočený horní body 100 30 50 30 70 15 otočit\nvýkres uložení dotaz 40 H7/g6\nvýkres stav');
  fs.writeFileSync(S + 'w7-drawing-log.txt', log1);
  ok(!/^✗/m.test(log1), 'textové příkazy bez chyb' + (/^✗.*$/m.exec(log1)?.[0] ? ' – ' + /^✗.*$/m.exec(log1)[0] : ''));
  ok(/✓ řez E–E natočený \(pohled horní, 3 bodů\)/.test(log1), 'výkres řez natočený … otočit → ŘEZ E–E');
  ok(/Ø40 H7\/g6: díra \+0,025\/0, hřídel −0,009\/−0,025/.test(log1), 'výkres uložení dotaz 40 H7/g6');
  ok(/Pomocné pohledy: B \(horní, hrana/.test(log1) && /Řezy lomenou čarou: C–C zalomený .* D–D natočený .* E–E natočený/.test(log1), 'stav: pomocný pohled a řezy lomenou čarou');
  ok(/Přerušení: 1 přední x 30…70|Přerušení: 1 přední x [\d,]+…[\d,]+/.test(log1) && /Částečné řezy: 1 přední hloubka 10/.test(log1), 'stav: přerušení a částečný řez');
  ok(await waitText('ŘEZ E–E'), 'ŘEZ E–E na listu');

  const st = await p.evaluate(() => window.mncad.drawingStatus());
  ok(/Řezy lomenou čarou/.test(typeof st === 'string' ? st : JSON.stringify(st)), 'window.mncad.drawingStatus() obsahuje řezy lomenou čarou');

  // ── 10. smazání v panelu a textem ──
  await p.locator('[data-aux-row="B"] button[title="Smazat pohled"]').click();
  ok(await waitNoText('POHLED B'), 'smazání pomocného pohledu v panelu');
  const log2 = await run('výkres přerušení smazat vše\nvýkres řez smazat E\nvýkres zóny ne');
  ok(/✓ smazána všechna přerušení \(1\)/.test(log2) && /✓ řez E–E smazán/.test(log2) && /✓ zóny listu vypnuty/.test(log2), 'smazání přerušení, řezu a vypnutí zón textem');
  ok(await waitNoText('ŘEZ E–E'), 'ŘEZ E–E zmizel z listu');

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
