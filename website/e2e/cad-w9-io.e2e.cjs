// E2E: 2D CAD – balík 4 (io, vlna 9 fáze B): DWG / DXF v GUI, textem i přes API.
//  - Ctrl+O a přetažení .dxf / .dwg z 3D dílu → 2D výkres v nové záložce; hláška s volbou „Otevřít jako 3D skicu“
//  - karta Výstup ▸ DWG / DXF: Otevřít (průběh + Zrušit u velkého DWG, čas otevření 20 MB DWG), Vložit výkres
//    (entity vybrané, Ctrl+Z jedním krokem), Export (rychlá nabídka verzí), panel Možnosti (DWG R2000, název, jednotky)
//  - příkazový řádek: „import“ / „import sloučit“ otevře výběr souboru; text „2d export dxf verze R12“
//  - window.mncad.importFile(…, { as: "draft" | "auto" | "sketch" })
// Spuštění: E2E_BASE=http://localhost:3384 [E2E_BIG_DXF=…/big-10mb.dxf] [E2E_BIG_DWG=…/big-20mb.dwg] node e2e/cad-w9-io.e2e.cjs <složka>
// (velké soubory vytvoří: IO_PERF_OUT=<složka> npx vitest run src/cad/draft/io/io-perf.test.ts)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const BIG = process.env.E2E_BIG_DWG || '';

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); }); // headless: uložení přes dotaz na název
  p.on('dialog', (dg) => dg.accept()); // „Uložit jako“ – výchozí název
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const tabs = () => p.evaluate(() => window.mncad.tabs());
  const active = async () => (await tabs()).find((t) => t.active);
  const waitDoc = (fn, ms = 60000) => p.waitForFunction(fn, null, { timeout: ms, polling: 250 });
  const toast = () => p.evaluate(() => [...document.querySelectorAll('div')].filter((d) => /bottom-14/.test(d.className) && d.offsetParent).map((d) => d.textContent).join(' | '));
  const newPart = () => p.evaluate(() => window.mncad.setDocument({ app: 'mnastrojarna-cad', version: 2, name: 'Díl', material: 'ocel', features: [] }));
  // tlačítko pásu podle popisku (s mikronávody nemá nativní title; velké tlačítko = text, malé = aria-label); „(Ctrl+O)“ = zkratka, ne popisek
  const ribbonBtn = (title) => {
    const label = title.replace(/\s*\([^)]*\)$/, '');
    const all = p.locator('[data-draft-workspace] [data-ribbon] button');
    return all.filter({ hasText: label }).or(p.locator(`[data-draft-workspace] [data-ribbon] button[aria-label^="${label}"]`)).first();
  };
  /** výběr souboru vyvolaný akcí (klávesa, tlačítko); pomalý stroj → až 3 pokusy */
  const chooser = async (act, what) => {
    for (let i = 0; i < 3; i++) {
      const r = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }), act()]).then(([f]) => f).catch(() => null);
      if (r) return r;
      await p.waitForTimeout(1500);
    }
    await p.screenshot({ path: S + 'io-chooser-fail.png' });
    throw new Error(`výběr souboru se neotevřel: ${what}`);
  };
  const outputTab = async () => { await p.locator('[data-draft-tab="output"]').click(); await p.waitForTimeout(300); };

  // ── zdrojové soubory: malý výkres (rám A4 + kružnice) jako DXF R2018 a DWG R2013 ──
  await p.evaluate(() => window.mncad.run('2d nový Zdroj'));
  await p.waitForSelector('[data-draft-workspace]', { timeout: 120000 });
  const src = await p.evaluate(async () => {
    await window.mncad.draft('hladina nová RAM barva 3; hladina aktuální RAM; obdélník 0,0 @210,297; hladina nová OBRYS barva 1; hladina aktuální OBRYS; kružnice 50,50 10');
    const a = await window.mncad.draft('export dxf');
    const b = await window.mncad.draft('export dwg verze R2013');
    return { dxf: a.results[0].data.file.text, dwg: b.results[0].data.file.base64, ok: a.ok && b.ok };
  });
  ok(src.ok && src.dxf.includes('AC1032') && src.dwg.length > 1000, 'zdroj: 2d export dxf / export dwg verze R2013 (results[].data.file)');
  fs.writeFileSync(S + 'ram.dxf', src.dxf);
  fs.writeFileSync(S + 'ram.dwg', Buffer.from(src.dwg, 'base64'));

  // ── Ctrl+O z 3D dílu: .dxf → 2D výkres v nové záložce + hláška s volbou 3D skici ──
  await newPart();
  await p.waitForFunction(() => window.mncad.getDocument().kind !== 'draft', null, { timeout: 30000 });
  await p.locator('canvas').first().click({ position: { x: 300, y: 300 } }).catch(() => undefined);
  let n0 = (await tabs()).length;
  let fc = await chooser(() => p.keyboard.press('Control+o'), 'Ctrl+O');
  await fc.setFiles(S + 'ram.dxf');
  await waitDoc(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === 'ram'; });
  let d = await doc();
  ok(d.draft.entities.length === 2 && d.draft.layers.some((l) => l.name === 'RAM' && l.color === 3) && (await active()).kind === 'draft', `Ctrl+O ram.dxf z dílu → 2D výkres „ram“ v záložce (prázdný díl se nahradí) (${d.draft.entities.map((e) => e.type)})`);
  await p.waitForSelector('[data-io-done]', { timeout: 10000 });
  ok(/ram\.dxf: .*Načteno 2 entit/.test(await p.textContent('[data-io-done]')), 'hláška po otevření: poznámka importu');
  await p.screenshot({ path: S + 'io-opened.png' });
  n0 = (await tabs()).length;
  await p.click('[data-io-to-sketch]');
  await waitDoc(() => { const d = window.mncad.getDocument(); return d.kind !== 'draft' && d.features.some((f) => f.type === 'sketch'); });
  d = await doc();
  const sk = d.features.find((f) => f.type === 'sketch');
  ok(sk && sk.entities.length >= 2 && (await tabs()).length === n0 + 1, `„Otevřít jako 3D skicu“ → díl se skicou v nové záložce (${sk && sk.entities.length} entit skici)`);

  // ── přetažení .dwg do okna → 2D výkres ──
  n0 = (await tabs()).length;
  const dt = await p.evaluateHandle((b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const t = new DataTransfer();
    t.items.add(new File([u], 'ram.dwg'));
    return t;
  }, src.dwg);
  const root = 'header'; // událost probublá ke kořeni aplikace (onDrop)
  await p.dispatchEvent(root, 'dragenter', { dataTransfer: dt });
  await p.dispatchEvent(root, 'dragover', { dataTransfer: dt });
  await p.dispatchEvent(root, 'drop', { dataTransfer: dt });
  await waitDoc(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === 'ram' && d.draft.entities.length === 2; });
  ok((await tabs()).length === n0 + 1, 'přetažení ram.dwg → 2D výkres v nové záložce (DWG R2013)');
  await p.click('[data-io-done-close]').catch(() => undefined);

  // ── karta Výstup ▸ DWG / DXF: skupina a tlačítka ──
  await outputTab();
  ok(await p.locator('[data-ribbon-group="DWG / DXF"]').isVisible(), 'karta Výstup: skupina DWG / DXF');
  for (const t of ['Otevřít DXF / DWG (Ctrl+O)', 'Vložit výkres', 'Uložit jako…', 'Možnosti DWG / DXF']) ok(await ribbonBtn(t).count() === 1, `tlačítko „${t}“`);
  await p.screenshot({ path: S + 'io-ribbon.png', clip: { x: 0, y: 0, width: 1430, height: 220 } });

  // ── velké soubory: průběh, Zrušit, pak otevření a čas (cíl < 15 s) ──
  const BIGS = [process.env.E2E_BIG_DXF, BIG].filter((f) => f && fs.existsSync(f));
  for (let bi = 0; bi < BIGS.length; bi++) {
    const file = BIGS[bi];
    const nm = file.split('/').pop();
    const mb = fs.statSync(file).size / 1048576;
    await outputTab();
    if (bi === 0) {
      n0 = (await tabs()).length;
      fc = await chooser(() => ribbonBtn('Otevřít DXF / DWG (Ctrl+O)').click(), 'Otevřít DXF / DWG');
      await fc.setFiles(file);
      await p.waitForSelector('[data-io-progress]', { timeout: 20000 });
      await p.waitForTimeout(600);
      await p.screenshot({ path: S + 'io-progress.png' });
      const pct = Number(await p.getAttribute('[data-io-progress]', 'data-io-pct').catch(() => '-1'));
      await p.click('[data-io-cancel]', { timeout: 5000 });
      await p.waitForSelector('[data-io-progress]', { state: 'detached', timeout: 10000 });
      await p.waitForTimeout(500);
      ok((await tabs()).length === n0 && /zrušeno/.test(await toast()), `${nm} ${mb.toFixed(1)} MB: průběh (${pct} %), Zrušit → bez nové záložky, hláška „zrušeno“`);
    }
    fc = await chooser(() => ribbonBtn('Otevřít DXF / DWG (Ctrl+O)').click(), 'Otevřít DXF / DWG');
    // hlídač v prohlížeči: fáze okénka průběhu a počet záložek ve chvíli, kdy okénko zmizí (vykreslení blokuje vlákno)
    await p.evaluate(() => {
      const w = (window.__ioWatch = { stages: [], n0: window.mncad.tabs().length, tabsAtEnd: -1, seen: false });
      const mo = new MutationObserver(() => {
        const el = document.querySelector('[data-io-progress]');
        if (el) {
          const st = el.getAttribute('data-io-stage');
          if (w.stages[w.stages.length - 1] !== st) w.stages.push(st);
          w.seen = true;
        } else if (w.seen && w.tabsAtEnd < 0) {
          w.tabsAtEnd = window.mncad.tabs().length;
          mo.disconnect();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-io-stage'] });
    });
    const t0 = Date.now();
    await fc.setFiles(file);
    const base = nm.replace(/\.[^.]+$/, '');
    await waitDoc(`(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === ${JSON.stringify(base)} && d.draft.entities.length > 1000; })()`, 600000);
    const sec = (Date.now() - t0) / 1000;
    d = await doc();
    ok(sec < 15, `${nm} ${mb.toFixed(1)} MB otevřen za ${sec.toFixed(1)} s (cíl < 15 s), ${d.draft.entities.length} entit`);
    await p.waitForSelector('[data-io-progress]', { state: 'detached', timeout: 60000 }).catch(() => undefined);
    const w = await p.evaluate(() => window.__ioWatch);
    ok(w.stages.includes('show') && w.tabsAtEnd === w.n0 + 1, `${nm}: okénko průběhu zůstane i při vykreslení („zobrazení výkresu“) a zmizí až s novou záložkou (fáze ${w.stages.join('→')})`);
    await p.waitForTimeout(1000);
    await p.screenshot({ path: S + `io-big-${bi}.png` });
    await p.evaluate(() => window.mncad.closeTab());
    await p.waitForTimeout(800);
  }
  if (!BIGS.length) ok(true, 'velké soubory: E2E_BIG_DXF / E2E_BIG_DWG nezadány – vynecháno (výkon ověřuje io-perf.test.ts)');

  // ── Vložit výkres: obsah do otevřeného výkresu, vybrané, Ctrl+Z jedním krokem ──
  await p.evaluate(() => window.mncad.run('2d nový Cíl'));
  await waitDoc(() => window.mncad.getDocument().name === 'Cíl');
  await p.evaluate(() => window.mncad.draft('čára -50,-50 -10,-10'));
  await outputTab();
  fc = await chooser(() => ribbonBtn('Vložit výkres').click(), 'Vložit výkres');
  await fc.setFiles(S + 'ram.dwg');
  await waitDoc(() => window.mncad.getDocument().draft.entities.length === 3);
  d = await doc();
  const st = await p.evaluate(() => window.mncad.draft('stav'));
  ok(d.draft.entities.map((e) => e.type).join() === 'line,polyline,circle' && d.draft.layers.some((l) => l.name === 'RAM'), `Vložit výkres ram.dwg → 2 entity + hladiny RAM / OBRYS (${d.draft.entities.map((e) => e.type)})`);
  ok(st.status && st.status.selection && st.status.selection.length === 2, `vložené entity jsou vybrané (${JSON.stringify(st.status && st.status.selection)})`);
  await p.locator('[data-draft-canvas]').click({ position: { x: 30, y: 30 } });
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+z');
  await waitDoc(() => window.mncad.getDocument().draft.entities.length === 1, 10000).catch(() => undefined);
  ok((await doc()).draft.entities.length === 1, 'Ctrl+Z vrátí celé vložení jedním krokem');

  // ── příkazový řádek: „import“ a „import sloučit“ otevřou výběr souboru ──
  n0 = (await tabs()).length;
  fc = await chooser(async () => { await p.locator('[data-draft-input]').fill('import'); await p.locator('[data-draft-input]').press('Enter'); }, 'příkaz import');
  await fc.setFiles(S + 'ram.dxf');
  await waitDoc(() => { const d = window.mncad.getDocument(); return d.kind === 'draft' && d.name === 'ram'; });
  ok((await tabs()).length === n0 + 1, 'příkazový řádek „import“ + Enter → výběr souboru → nová záložka');
  await p.locator('[data-draft-canvas]').click({ position: { x: 30, y: 30 } });
  await p.keyboard.press('Escape');
  fc = await chooser(async () => { await p.locator('[data-draft-input]').fill('import sloučit'); await p.locator('[data-draft-input]').press('Enter'); }, 'příkaz import sloučit');
  await fc.setFiles(S + 'ram.dxf');
  await waitDoc(() => window.mncad.getDocument().draft.entities.length === 4);
  ok(true, '„import sloučit“ → obsah vložen do otevřeného výkresu (4 entity)');

  // ── Export: rychlá nabídka DXF R12, panel Možnosti → DWG R2000 s názvem, jednotky ──
  await outputTab();
  await ribbonBtn('Uložit jako…').click();
  let [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.locator('[data-cad-menu] button, [role="menu"] button').filter({ hasText: 'DXF R12 (AC1009)' }).first().click()]);
  let path = S + dl.suggestedFilename();
  await dl.saveAs(path);
  let txt = fs.readFileSync(path, 'latin1');
  ok(/\.dxf$/.test(dl.suggestedFilename()) && txt.includes('AC1009') && txt.includes('POLYLINE') && !txt.includes('LWPOLYLINE'), `Export ▸ DXF R12 → ${dl.suggestedFilename()} (AC1009, POLYLINE)`);
  await ribbonBtn('Možnosti DWG / DXF').click();
  await p.waitForSelector('[data-io-panel]', { timeout: 10000 });
  ok(await p.locator('[data-io-last]').isVisible(), 'panel DWG / DXF: protokol posledního importu');
  await p.click('[data-io-fmt="dwg"]');
  await p.selectOption('[data-io-ver]', 'R2000');
  await p.fill('[data-io-name]', 'Plech');
  [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-io-export-go]')]);
  path = S + dl.suggestedFilename();
  await dl.saveAs(path);
  const head = fs.readFileSync(path).subarray(0, 6).toString('latin1');
  ok(dl.suggestedFilename() === 'Plech.dwg' && head === 'AC1015', `panel: DWG R2000 „Plech“ → ${dl.suggestedFilename()} (${head})`);
  await p.screenshot({ path: S + 'io-panel.png' });
  await p.selectOption('[data-io-units]', 'cm');
  await waitDoc(() => window.mncad.getDocument().draft.vars.units === 'cm', 10000).catch(() => undefined);
  ok((await doc()).draft.vars.units === 'cm', 'panel: jednotky výkresu → cm (INSUNITS)');

  // ── text: 2d export dxf verze R12 binární = chyba, verze R2000 binární = AutoCAD Binary DXF ──
  let r = await p.evaluate(() => window.mncad.draft('export dxf verze R2000 binární'));
  ok(r.ok && r.results[0].data.file.version === 'R2000 binary', `2d export dxf verze R2000 binární (${r.results[0].data && r.results[0].data.file.version})`);
  r = await p.evaluate(() => window.mncad.draft('export dwg verze R12'));
  ok(!r.ok && /R12/.test(r.results[0].error), 'export dwg verze R12 → srozumitelná chyba');
  // DXF R12 velkého výkresu (dřív „Maximum call stack size exceeded“ nad ~8000 úsečkami)
  await p.evaluate(() => window.mncad.run('2d nový Velký R12'));
  await waitDoc(() => window.mncad.getDocument().name === 'Velký R12');
  r = await p.evaluate(async () => {
    await window.mncad.draft(Array.from({ length: 9000 }, (_, i) => `čára ${i},0 ${i},10`).join('\n'));
    const e = await window.mncad.draft('export dxf verze R12');
    return { ok: e.ok, err: e.results[0].error, bytes: e.results[0].data && e.results[0].data.file.bytes, n: window.mncad.getDocument().draft.entities.length };
  });
  ok(r.ok && r.n === 9000 && r.bytes > 700000, `9000 úseček → export dxf verze R12 (${r.bytes} B${r.err ? ', ' + r.err : ''})`);

  // ── API: importFile as draft / auto / sketch ──
  let line = await p.evaluate((b64) => window.mncad.importFile({ name: 'api.dwg', base64: b64 }, { as: 'draft' }), src.dwg);
  d = await doc();
  ok(/otevřen jako 2D výkres „api“/.test(line) && d.kind === 'draft' && d.draft.entities.length === 2, 'importFile({ name: "api.dwg" }, { as: "draft" }) → 2D výkres, protokol + stav');
  line = await p.evaluate((t) => window.mncad.importFile({ name: 'auto.dxf', text: t }), src.dxf);
  d = await doc();
  ok(/otevřen jako 2D výkres/.test(line) && d.kind === 'draft' && d.name === 'auto', 'importFile DXF bez volby (auto) = jako Otevřít → 2D výkres');
  await newPart();
  await p.waitForFunction(() => window.mncad.getDocument().kind !== 'draft', null, { timeout: 30000 });
  line = await p.evaluate((b64) => window.mncad.importFile({ name: 'skica.dwg', base64: b64 }, { as: 'sketch' }), src.dwg);
  d = await doc();
  ok(/DXF skica\.dxf/.test(line) && d.features.some((f) => f.type === 'sketch'), `importFile DWG { as: "sketch" } → 3D skica (${line.split('\n')[0].slice(0, 90)})`);

  // API: poškozený soubor a STL jako 2D výkres → srozumitelné chyby
  const apiErr = (f, o) => p.evaluate(async ([f, o]) => { try { await window.mncad.importFile(f, o); return 'ok'; } catch (e) { return String(e && e.message || e); } }, [f, o]);
  let msg = await apiErr({ name: 'bad.dwg', base64: Buffer.from('AC1015 garbage garbage').toString('base64') }, { as: 'draft' });
  ok(/DWG je poškozený, neúplný/.test(msg) && !/readSentinel/.test(msg.split('(chyba čtení')[0]), `importFile poškozený DWG → srozumitelná chyba (${msg.slice(0, 110)})`);
  msg = await apiErr({ name: 'empty.dxf', text: '' }, { as: 'draft' });
  ok(/soubor je prázdný/.test(msg), `importFile prázdný DXF → „soubor je prázdný“ (${msg.slice(0, 80)})`);
  const stl = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
  msg = await apiErr({ name: 'cube.stl', text: stl }, { as: 'draft' });
  ok(/jen pro DXF \/ DWG/.test(msg), `importFile STL s { as: "draft" } → odmítnuto (${msg.slice(0, 90)})`);

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exitCode = 1; process.exit(1); });
