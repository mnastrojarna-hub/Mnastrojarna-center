// E2E: velké sestavy STEP (chyba „sestava 46 MB se otevře, ale nic není vidět“).
// Vygeneruje (nebo použije z dočasné složky) realistickou sestavu STEP AP214 ~47 MB, ~12 MB a ~12 MB v metrech
// (scripts/gen-big-step.mjs), otevře ji přes výběr souboru v záložce dílu a v záložce sestavy, přetažením, jako .mncad
// a useknutou, a ověří: obraz (pixely modelu v 3D okně) do 60 s, komponenty s názvy ze stromu výrobku, úspěch až po
// zobrazení, srozumitelnou chybu u useknutého souboru, jednotky (metry = milimetry) a vypíše naměřené kroky (perf).
// Spuštění: E2E_BASE=http://localhost:3209 node e2e/cad-big-step.e2e.cjs <složka>   (výchozí server http://localhost:3100)
//   E2E_BIG_DIR = složka pro vygenerované soubory (výchozí dočasná složka OS); generování 47 MB trvá ~3 min (jen poprvé).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const DIR = process.env.E2E_BIG_DIR || os.tmpdir();
const GEN = path.join(__dirname, '..', 'scripts', 'gen-big-step.mjs');

/** vygeneruje soubor jen jednou (opakované běhy ho použijí z dočasné složky) */
function fixture(mb, unit = 'mm') {
  const file = path.join(DIR, `mn-big-${mb}${unit === 'm' ? '-m' : ''}.step`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
    console.log(`… generuji ${path.basename(file)} (jen poprvé)`);
    execFileSync(process.execPath, [GEN, '--mb', String(mb), '--unit', unit, '--out', file], { stdio: 'inherit', timeout: 900000 });
  }
  return file;
}

const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the OpenCascade kernel/.test(document.body.innerText), null, { timeout: 240000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
/** počet pixelů modelu v 3D okně (plátno je průhledné, pozadí je CSS) – zmenšeno na 200 × 130 */
const modelPixels = (p) => p.evaluate(() => {
  const cv = document.querySelector('main canvas');
  if (!cv) return -1;
  const c2 = document.createElement('canvas');
  c2.width = 200; c2.height = 130;
  const g = c2.getContext('2d');
  g.drawImage(cv, 0, 0, 200, 130);
  const d = g.getImageData(0, 0, 200, 130).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
  return n;
});
/** záznam hlášek (toast, modální okna) s časem – zachytí i krátké hlášky */
const watchTexts = () => {
  window.__seen = [];
  const rec = () => {
    const t = document.body ? document.body.innerText : '';
    for (const m of t.match(/(Model [^\n]* zobrazen za[^\n]*|Sestava [^\n]* zobrazena za[^\n]*|Model importován[^\n]*|Otevřeno:[^\n]*|Soubor [^\n]* je neúplný[^\n]*|Soubor [^\n]* se nepodařilo[^\n]*|Jádro CAD[^\n]*|Sestava STEP [^\n]*)/g) || [])
      if (!window.__seen.some((x) => x.text === m)) window.__seen.push({ at: Date.now(), text: m });
  };
  let timer = 0;
  new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = 0; rec(); }, 80); }).observe(document, { subtree: true, childList: true, characterData: true });
};
const seen = (p) => p.evaluate(() => window.__seen || []);
const perf = (p) => p.evaluate(() => (window.mncad.perf ? window.mncad.perf() : []));
/** kroky po dílech (opakují se u každého dílu) se sečtou; ostatní kroky se vypíšou jednotlivě */
const PER_PART = /^(kernel\.step\.(read|transfer)|kernel\.(bounds|mesh|part)|ui\.fromKernel|ui\.three\.firstRender|ui\.fit)$/;
const fmtPerf = (list, from) => {
  const l = list.filter((e) => e.at >= from);
  const groups = new Map();
  for (const e of l) if (PER_PART.test(e.stage)) { const g = groups.get(e.stage) || { n: 0, sum: 0, max: 0, tris: 0, wasm: 0 }; g.n++; g.sum += e.ms; g.max = Math.max(g.max, e.ms); g.tris += (e.info && e.info.triangles) || 0; g.wasm = Math.max(g.wasm, (e.info && e.info.wasmMB) || 0); groups.set(e.stage, g); }
  const one = l.filter((e) => !PER_PART.test(e.stage)).map((e) => `${e.stage} ${e.ms} ms${e.info ? ' ' + JSON.stringify(e.info) : ''}`);
  const agg = [...groups].map(([k, g]) => g.n === 1 ? `${k} ${g.sum} ms${g.tris ? ` (${g.tris} trojúhelníků)` : ''}${g.wasm ? `, WASM ${g.wasm} MB` : ''}` : `${k} ${g.n}× součet ${g.sum} ms, nejdelší ${g.max} ms${g.tris ? `, ${g.tris} trojúhelníků` : ''}${g.wasm ? `, WASM nejvýš ${g.wasm} MB` : ''}`);
  return [...one, ...agg].join('\n   ');
};

/** otevře soubor přes výběr souboru a čeká na první obraz a na dokončení; vrací časy */
async function openAndWait(p, file, label, { expectAsm = true, limit = 300000 } = {}) {
  const t0 = Date.now();
  const px0 = await modelPixels(p);
  await p.locator('input[type=file]').first().setInputFiles(file);
  let first = null;
  let done = null;
  let doneText = '';
  while (Date.now() - t0 < limit) {
    const px = await modelPixels(p);
    if (first === null && px > Math.max(80, px0 * 1.2 + 40)) first = Date.now() - t0;
    const s = await seen(p);
    const fin = s.find((x) => x.at >= t0 && /zobrazena? za|se nepodařilo|je neúplný|Jádro CAD/.test(x.text));
    if (fin) { done = fin.at - t0; doneText = fin.text; break; }
    await p.waitForTimeout(500);
  }
  if (first === null && (await modelPixels(p)) > 80) first = Date.now() - t0;
  const s = await seen(p);
  const claims = s.filter((x) => x.at >= t0 && /Model importován|zobrazena? za/.test(x.text));
  const early = first !== null && claims.some((x) => x.at - t0 < first - 1500);
  console.log(`   ${label}: první obraz ${first} ms, hotovo ${done} ms – ${doneText}`);
  return { first, done, doneText, early, t0 };
}

(async () => {
  const f46 = fixture(46);
  const f10 = fixture(10);
  const f10m = fixture(10, 'm');
  const sz = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
  console.log(`soubory: ${path.basename(f46)} ${sz(f46)}, ${path.basename(f10)} ${sz(f10)}, ${path.basename(f10m)} ${sz(f10m)}`);
  // useknutý soubor (nedokončené stažení): 60 % z 12 MB
  const cut = path.join(DIR, 'mn-big-useknuty.step');
  const b10 = fs.readFileSync(f10);
  fs.writeFileSync(cut, b10.subarray(0, Math.floor(b10.length * 0.6)));

  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(watchTexts);
  let p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);

  // ── 1. sestava 47 MB v záložce dílu (výběr souboru) ──
  const r1 = await openAndWait(p, f46, '47 MB v záložce dílu');
  ok(r1.first !== null && r1.first < 60000, `47 MB sestava: první obraz za ${r1.first} ms (cíl < 60 s)`);
  ok(/Sestava .* zobrazena za/.test(r1.doneText), `47 MB sestava: dokončení ohlášeno až po načtení (${(r1.done / 1000).toFixed(1)} s): ${r1.doneText}`);
  ok(!r1.early, 'úspěch se nehlásí dřív, než je model vidět');
  const d1 = await p.evaluate(() => window.mncad.getDocument());
  const names = JSON.stringify(d1).match(/"name":"(Ram_svarenec|Stanice_\d+|Podelnik_3000|Sroub_zavit_\d+)"/g) || [];
  ok(d1.kind === 'assembly' && (d1.components || []).length >= 10 && names.length >= 10, `otevřeno jako sestava: ${(d1.components || []).length} komponent nejvyšší úrovně, názvy ze stromu výrobku (${[...new Set(names)].slice(0, 4).join(', ')}…)`);
  const tree = await p.locator('aside').first().innerText();
  ok(/Ram_svarenec/.test(tree) && /Stanice_01/.test(tree), 'strom sestavy vypisuje komponenty (Ram_svarenec, Stanice_01…)');
  ok(!/"data":"[A-Za-z0-9+/]{1000}/.test(JSON.stringify(d1)), 'dokument nese odkazy na data (mnblob:), ne megabajty base64');
  const st1 = await p.evaluate(() => window.mncad.status());
  const env1 = (st1.match(/obálka ([^·\n]*) mm/) || ['', ''])[1].trim();
  ok(/Sestava: \d+ komponent \((\d+) dílů/.test(st1) && env1, `stav sestavy: ${(st1.match(/Sestava[^\n]*/) || [''])[0].slice(0, 160)}`);
  const pf1 = await perf(p);
  console.log('   naměřené kroky (47 MB):\n   ' + fmtPerf(pf1, r1.t0));
  const heap = await p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
  console.log(`   paměť JS po otevření: ${heap} MB`);
  ok(pf1.some((e) => e.stage === 'ui.three.firstRender' && e.at >= r1.t0) && !pf1.some((e) => e.stage === 'ui.webgl.lost'), 'síť nahrána do WebGL, kontext WebGL nebyl ztracen');
  await p.screenshot({ path: S + 'big-step-46.png' });

  // ── 2. .mncad (~60 MB, data vložená do souboru) – uložit, otevřít v nové kartě (studené jádro) ──
  const mncadFile = path.join(DIR, 'mn-big-sestava.mncad');
  const [dl, savedBytes] = await Promise.all([
    p.waitForEvent('download', { timeout: 180000 }),
    p.evaluate(async () => {
      const r = await window.mncad.exportFile('mncad');
      const bin = atob(r.base64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([u], { type: 'application/json' }));
      a.download = 'mn-big-sestava.mncad';
      document.body.appendChild(a);
      a.click();
      return r.bytes;
    }),
  ]);
  await dl.saveAs(mncadFile);
  ok(savedBytes > 40 * 1048576 && fs.statSync(mncadFile).size === savedBytes, `.mncad uložen jako samostatný soubor se vloženými daty (${(savedBytes / 1048576).toFixed(1)} MB, každý díl jednou)`);
  await p.close();
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const r2 = await openAndWait(p, mncadFile, `.mncad ${(savedBytes / 1048576).toFixed(0)} MB (nová karta)`);
  ok(r2.first !== null && r2.first < 60000 && /Sestava .* zobrazena za/.test(r2.doneText), `.mncad sestava: první obraz za ${r2.first} ms, ${r2.doneText}`);
  const d2 = await p.evaluate(() => window.mncad.getDocument());
  ok(d2.kind === 'assembly' && JSON.stringify(d2).length < 2 * 1048576, `otevřený .mncad drží odkazy (dokument ${(JSON.stringify(d2).length / 1024).toFixed(0)} kB místo ${(savedBytes / 1048576).toFixed(0)} MB)`);
  console.log('   naměřené kroky (.mncad):\n   ' + fmtPerf(await perf(p), r2.t0));
  await p.close();

  // ── 2b. starší .mncad: jeden díl s celou sestavou 47 MB v prvku Import (base64) – přesná cesta jádra ──
  const partMncad = path.join(DIR, 'mn-big-dil.mncad');
  if (!fs.existsSync(partMncad)) fs.writeFileSync(partMncad, JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Stroj jako dil', material: 'ocel', features: [{ id: 'imp1', name: 'Import mn-big-46.step', type: 'import', fileName: 'mn-big-46.step', format: 'step', data: fs.readFileSync(f46).toString('base64') }] }));
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const r2b = await openAndWait(p, partMncad, `starší .mncad ${(fs.statSync(partMncad).size / 1048576).toFixed(0)} MB (jeden díl)`, { expectAsm: false });
  ok(r2b.first !== null && r2b.first < 60000 && /Model .* zobrazen za/.test(r2b.doneText) && !r2b.early, `jeden díl 47 MB (přesné těleso): první obraz za ${r2b.first} ms, ${r2b.doneText}`);
  const pf2 = await perf(p);
  console.log('   naměřené kroky (jeden díl):\n   ' + fmtPerf(pf2, r2b.t0));
  await p.close();

  // ── 3. useknutý STEP → srozumitelná chyba, žádný „úspěch“ ──
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const t3 = Date.now();
  await p.locator('input[type=file]').first().setInputFiles(cut);
  await p.waitForFunction(() => /je neúplný/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => undefined);
  const body3 = await p.locator('body').innerText();
  const s3 = (await seen(p)).filter((x) => x.at >= t3);
  ok(/je neúplný – chybí konec souboru STEP/.test(body3), 'useknutý STEP: hláška „Soubor … je neúplný – chybí konec souboru STEP (END-ISO-10303-21)…“');
  ok(!s3.some((x) => /Model importován|zobrazena? za/.test(x.text)), 'useknutý STEP: žádná hláška o úspěchu');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);

  // ── 4. sestava v metrech = stejné rozměry v mm; v záložce sestavy jako podsestava ──
  await p.evaluate(() => window.mncad.run('nová sestava Linka'));
  await p.waitForTimeout(1200);
  const r4 = await openAndWait(p, f10m, '12 MB v metrech v záložce sestavy', { limit: 180000 });
  ok(r4.first !== null && r4.first < 60000 && /zobrazena za/.test(r4.doneText), `sestava v metrech vložena do otevřené sestavy a zobrazena (první obraz ${r4.first} ms)`);
  const d4 = await p.evaluate(() => window.mncad.getDocument());
  ok(d4.name === 'Linka' && (d4.components || []).length === 1 && d4.components[0].source.kind === 'asm', 'v otevřené sestavě se soubor vloží jako podsestava');
  const env4 = ((await p.evaluate(() => window.mncad.status())).match(/obálka ([^·\n]*) mm/) || ['', ''])[1].trim();
  await p.evaluate(() => window.mncad.run('nový díl Prázdný'));
  await p.waitForTimeout(800);
  const r5 = await openAndWait(p, f10, '12 MB v mm', { limit: 180000 });
  const env5 = ((await p.evaluate(() => window.mncad.status())).match(/obálka ([^·\n]*) mm/) || ['', ''])[1].trim();
  const nums = (s) => s.replace(/\s/g, '').replace(/,/g, '.').split('×').map(Number);
  const e4 = nums(env4);
  const e5 = nums(env5);
  ok(e4.length === 3 && e5.length === 3 && e4.every((v, i) => Math.abs(v - e5[i]) < 1) && e5[0] > 3000, `jednotky: obálka sestavy v metrech ${env4} mm = sestava v mm ${env5} mm`);
  ok(r5.first !== null && /zobrazena za/.test(r5.doneText), `12 MB sestava zobrazena (první obraz ${r5.first} ms, hotovo ${r5.done} ms)`);

  // ── 5. přetažení souboru do okna ──
  await p.evaluate(() => window.mncad.run('nový díl Prázdný 2'));
  await p.waitForTimeout(800);
  const small = path.join(DIR, 'mn-big-2.step');
  if (!fs.existsSync(small)) execFileSync(process.execPath, [GEN, '--mb', '2', '--out', small], { stdio: 'inherit', timeout: 600000 });
  const t6 = Date.now();
  const dt = await p.evaluateHandle(async (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = new DataTransfer();
    d.items.add(new File([u], 'pretazeny.step', { type: 'application/step' }));
    return d;
  }, fs.readFileSync(small).toString('base64'));
  await p.dispatchEvent('div.fixed.inset-0', 'drop', { dataTransfer: dt });
  await p.waitForFunction((t) => (window.__seen || []).some((x) => x.at >= t && /zobrazena za|se nepodařilo/.test(x.text)), t6, { timeout: 120000 }).catch(() => undefined);
  const s6 = (await seen(p)).filter((x) => x.at >= t6);
  ok(s6.some((x) => /Sestava .* zobrazena za/.test(x.text)) && (await modelPixels(p)) > 80, `přetažený STEP (${(fs.statSync(small).size / 1048576).toFixed(1)} MB) otevřen a zobrazen: ${(s6.find((x) => /zobrazena/.test(x.text)) || {}).text}`);

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
