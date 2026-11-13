// E2E – Chytré kóty výkresu a textové příkazy výkresu (pro AI agenty):
// hřídel z příkladu A návodu pro AI → „výkres A3 …“ → „kótovat“ → „výkres stav“ (očekávané kóty, žádné duplicity,
// Kontrola kót bez chybějících) → list: texty se nepřekrývají (obdélníky textů SVG v prohlížeči), svislé kóty zdola nahoru;
// deska z příkladu C: popis díry se značkou hloubky (↧ jako čáry), tolerance, export PDF; volba Chytré kóty / řetězově /
// od základny a tlačítko Přegenerovat kóty; window.mncad.drawingStatus().
// Spuštění: E2E_BASE=http://localhost:3208 node e2e/cad-drawing-smart.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-smart').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };

/** příklad z návodu pro AI (blok ``` za nadpisem) */
const example = (guide, title) => {
  const i = guide.indexOf(title);
  const a = guide.indexOf('```', i) + 3;
  return guide.slice(a, guide.indexOf('```', a)).trim();
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const guide = await p.evaluate(() => window.mncad.guide());
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));
  const waitSheet = () => p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 240000 });
  /** obdélníky textů listu (mm listu) mimo razítko a dvojice, které se překrývají */
  const textOverlaps = () => p.evaluate(() => {
    const svg = document.querySelector('[data-sheet] > div svg');
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const R = svg.getBoundingClientRect();
    const k = vb[2] / R.width;
    const W = vb[2], H = vb[3];
    const boxes = [...svg.querySelectorAll('text')].map((t) => {
      const r = t.getBoundingClientRect();
      return { s: t.textContent, x0: (r.left - R.left) * k, y0: (r.top - R.top) * k, x1: (r.right - R.left) * k, y1: (r.bottom - R.top) * k, rot: t.getAttribute('transform') || '' };
    }).filter((q) => !(q.x0 > W - 195 && q.y0 > H - 70)); // razítko a text nad ním
    const out = [];
    // písmo prohlížeče má oproti tělu znaku vyšší řádek – obdélník se zúží na tělo písma (65 % výšky / šířky otočeného textu)
    const shrink = (q) => { const rot = /rotate/.test(q.rot); const cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2, w = q.x1 - q.x0, h = q.y1 - q.y0; return rot ? { ...q, x0: cx - w * 0.33, x1: cx + w * 0.33 } : { ...q, y0: cy - h * 0.33, y1: cy + h * 0.33 }; };
    const bs = boxes.map(shrink);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], c = bs[j];
      if (a.x0 < c.x1 - 0.05 && c.x0 < a.x1 - 0.05 && a.y0 < c.y1 - 0.05 && c.y0 < a.y1 - 0.05) out.push(`${a.s} × ${c.s}`);
    }
    return { n: boxes.length, out };
  });

  // ── 1. hřídel: model + výkres + kótovat + tolerance + stav (příklad A z návodu pro AI) ──
  const A = example(guide, '### Příklad A');
  ok(/kótovat/.test(A) && /výkres stav/.test(A), 'návod pro AI obsahuje příklad A s příkazy výkresu');
  const log = await run(A);
  fs.writeFileSync(S + 'smart-shaft-log.txt', log);
  ok(!/^✗/m.test(log), 'příklad A proběhl bez chyb' + (/^✗.*$/m.exec(log)?.[0] ? ' – ' + /^✗.*$/m.exec(log)[0] : ''));
  ok(/✓ výkres: A3, na šířku, pohledy přední, levý, iso/.test(log), 'výkres A3 na šířku s pohledy přední, levý, iso');
  ok(/✓ Chytré kóty \(řetězově\): 14 kót a popisů – přední 14/.test(log), 'kótovat: 14 kót v předním pohledu');
  ok(/Duplicity: žádné/.test(log), 'výkres stav: žádné duplicity');
  ok(/Kontrola kót: všech \d+ očekávaných rozměrů je na listu/.test(log), 'výkres stav: Kontrola kót bez chybějících rozměrů');
  const want = ['M20×1,5', 'Ø30h6', 'Ø40', 'Ø25', 'Ø17', '30', '3', '(50)', '15', '42', '140', '25', '1,5×45°', '2× R1'];
  const st0 = /přední: (.*)/.exec(log)?.[1] ?? '';
  const parts = st0.split(' · ');
  ok(want.every((w) => parts.includes(w)) && parts.length === 14, `výkres stav vypíše všechny kóty předního pohledu (${parts.join(' · ')})`);

  // výkres se otevřel v záložce s vygenerovanými kótami
  await waitSheet();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === 'Ø30h6'), null, { timeout: 120000 }).catch(() => {});
  let t = await sheetTexts();
  const onSheet = ['M20×1,5', 'Ø30h6', 'Ø40', 'Ø25', 'Ø17', '(50)', '140', '1,5×45°', '2× R1'];
  ok(onSheet.every((w) => t.includes(w)), 'list: vygenerované kóty jsou na listu (' + onSheet.filter((w) => !t.includes(w)).join(', ') + ')');
  ok(await p.locator('[data-smart-dims]').isVisible(), 'výkresové prostředí: volba Chytré kóty s řetězově / od základny a Přegenerovat kóty');
  const ov = await textOverlaps();
  ok(ov.out.length === 0 && ov.n >= 14, `texty listu se nepřekrývají (${ov.n} textů)${ov.out.length ? ' – ' + ov.out.slice(0, 5).join('; ') : ''}`);
  const rot = await p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].filter((x) => /^(Ø|M20)/.test(x.textContent)).map((x) => x.getAttribute('transform') || ''));
  ok(rot.length >= 4 && rot.filter((r) => /rotate\(-90/.test(r)).length >= 4, 'svislé kóty průměrů se čtou zdola nahoru (ISO 129: zprava)');
  await p.screenshot({ path: S + 'smart-shaft.png' });

  // od základny → přegenerovat (UI)
  const side = p.locator('[data-drawing-workspace] aside');
  await side.getByRole('button', { name: 'od základny', exact: true }).click();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === '33'), null, { timeout: 60000 }).catch(() => {});
  t = await sheetTexts();
  ok(t.includes('33') && t.includes('83') && t.includes('98') && !t.includes('(50)'), 'od základny: délky 30, 33, 83, 98, 140 od jednoho čela, bez pomocné kóty');
  await side.getByRole('button', { name: 'řetězově', exact: true }).click();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === '(50)'), null, { timeout: 60000 }).catch(() => {});
  await side.getByRole('button', { name: 'Přegenerovat kóty', exact: true }).click();
  await p.waitForTimeout(800);
  t = await sheetTexts();
  ok(t.includes('(50)') && t.includes('Ø30h6'), 'řetězově + Přegenerovat kóty: řetěz zpět, tolerance Ø30h6 se přenesla');

  // ── 2. deska (příklad C): popis díry se značkou hloubky, tolerance, PDF ──
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click();
  await p.waitForTimeout(1200);
  const C = example(guide, '### Příklad C');
  const log2 = await run(C);
  fs.writeFileSync(S + 'smart-plate-log.txt', log2);
  ok(!/^✗/m.test(log2) && /Duplicity: žádné/.test(log2) && /Kontrola kót: všech/.test(log2), 'příklad C: bez chyb, bez duplicit, Kontrola kót bez chybějících');
  const st = await p.evaluate(() => window.mncad.drawingStatus());
  ok(/4× M8 ↧10 \/ Ø6,8 ↧14/.test(st) && /2× Ø8,5 skrz/.test(st) && /90±0,05/.test(st), 'window.mncad.drawingStatus(): popis díry se značkou hloubky ↧ a tolerance 90±0,05');
  await waitSheet();
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === '4× M8'), null, { timeout: 120000 }).catch(() => {});
  t = await sheetTexts();
  ok(t.includes('4× M8') && t.includes('Ø6,8') && t.includes('10') && t.includes('14') && !t.some((x) => /[↧⌴⌵]/.test(x)), 'list: popis „4× M8 ↧10 / Ø6,8 ↧14“ – text bez značky, ↧ kreslená čarami');
  const glyph = await p.evaluate(() => {
    // značka hloubky: svislá čára + šipka + vodorovná čára mezi „4× M8“ a „10“
    const svg = document.querySelector('[data-sheet] > div svg');
    const txt = [...svg.querySelectorAll('text')].find((x) => x.textContent === '4× M8');
    if (!txt) return 0;
    const x = Number(txt.getAttribute('x'));
    const y = Number(txt.getAttribute('y'));
    return [...svg.querySelectorAll('polyline')].filter((pl) => pl.getAttribute('points').split(' ').every((q) => { const [px, py] = q.split(',').map(Number); return px >= x - 0.1 && px <= x + 4 && py >= y - 3.5 && py <= y + 0.2; })).length;
  });
  ok(glyph >= 3, `značka ↧ nakreslená čarami vedle textu (${glyph} čar)`);
  const ov2 = await textOverlaps();
  ok(ov2.out.length === 0, `deska: texty listu se nepřekrývají (${ov2.n})${ov2.out.length ? ' – ' + ov2.out.slice(0, 5).join('; ') : ''}`);
  await p.screenshot({ path: S + 'smart-plate.png' });
  const header = p.locator('[data-drawing-workspace] header');
  const [pd] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), header.getByRole('button', { name: 'PDF', exact: true }).click()]);
  await pd.saveAs(S + 'smart-plate.pdf');
  const pdf = fs.readFileSync(S + 'smart-plate.pdf');
  ok(pdf.length > 10000 && pdf.slice(0, 5).toString() === '%PDF-', `PDF export s popisy děr (${Math.round(pdf.length / 1024)} kB)`);

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
