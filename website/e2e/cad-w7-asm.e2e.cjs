// E2E vlna 7 – sestavy: pokročilé a mechanické vazby + pohybová studie, ručně (GUI) i textem / API.
// GUI: panel komponenty ▸ Mechanické vazby ▸ Ozubená kola – entity ze seznamů, poměr z poloměrů, Vytvořit vazbu; karta Sestava ▸
// Pohybová studie – motor na Závěsu, počet kroků, Vypočítat, posuvník časové osy (3D se změní), přehrávání, export CSV / PNG (ZIP) / WebM.
// Text: sestava vazba závěs / souosost / kontakt (klika – ojnice – píst), pohyb motor rotační "Klika" 0..360 krok 10 kolize stopa,
// pohyb stav / krok / export csv, window.mncad.motion() – poloha pístu = analytický vzorec klikového mechanismu, první kolize
// s dorazem v kroku 14 (140°), převod ozubených kol 2 : 1; stav; angličtina (motion, assembly mate gear).
// Spuštění: E2E_BASE=http://localhost:3331 node e2e/cad-w7-asm.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the OpenCascade kernel/.test(document.body.innerText), null, { timeout: 180000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const getDoc = (p) => p.evaluate(() => window.mncad.getDocument());
const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));
const line = (l, re) => (l.match(re) || [''])[0];

const part = (name, features) => ({ app: 'mnastrojarna-cad', version: 2, name, kind: 'part', material: 'ocel', features });
const box = (id, position, size, mode = 'new', centered = false) => ({ id, name: 'Kvádr ' + id, type: 'box', size, position, centered, mode });
const cyl = (id, position, radius, height, mode) => ({ id, name: 'Válec ' + id, type: 'cylinder', radius, height, position, axis: 'Z', mode });
const at = (position) => ({ position, rotation: [0, 0, 0] });
const R = 20, L = 60;
const ASM = { app: 'mnastrojarna-cad', version: 2, name: 'Mechanismy', kind: 'assembly', material: 'ocel', features: [], components: [
  { id: 'ram', name: 'Rám', fixed: true, source: { kind: 'part', doc: part('Rám', [box('a', [-40, -30, -10], [200, 60, 10]), cyl('h', [0, 0, -20], 5.1, 30, 'cut'), box('r', [20, -15, 0], [140, 5, 10], 'add')]) }, placement: at([0, 0, 0]) },
  { id: 'klika', name: 'Klika', source: { kind: 'part', doc: part('Klika', [box('a', [-5, -5, 0], [30, 10, 5]), cyl('s', [0, 0, -10], 5, 10, 'add'), cyl('p', [R, 0, 5], 3, 15, 'add')]) }, placement: at([0, 0, 0]) },
  { id: 'ojnice', name: 'Ojnice', source: { kind: 'part', doc: part('Ojnice', [box('a', [-6, -4, 12], [L + 12, 8, 4]), cyl('h1', [0, 0, 0], 3.1, 40, 'cut'), cyl('h2', [L, 0, 0], 2.6, 40, 'cut')]) }, placement: at([R, 0, 0]) },
  { id: 'pist', name: 'Píst', source: { kind: 'part', doc: part('Píst', [box('a', [0, 0, 5], [20, 20, 10], 'new', true), cyl('p', [0, 0, 10], 2.5, 12, 'add')]) }, placement: at([R + L, 0, 0]) },
  { id: 'doraz', name: 'Doraz', fixed: true, source: { kind: 'part', doc: part('Doraz', [box('a', [26, 0, 0], [8, 8, 10])]) }, placement: at([0, 0, 0]) },
  { id: 'drzak', name: 'Držák', fixed: true, source: { kind: 'part', doc: part('Držák', [box('a', [-10, 90, -10], [60, 20, 10]), cyl('p1', [0, 100, -10], 3, 20, 'add'), cyl('p2', [30, 100, -10], 4, 20, 'add')]) }, placement: at([0, 0, 0]) },
  // kola s výstupkem nahoře, aby bylo natočení vidět
  { id: 'kolo1', name: 'Kolo1', source: { kind: 'part', doc: part('Kolo1', [cyl('c', [0, 0, 0], 10, 5, 'new'), cyl('b', [0, 0, -1], 3.1, 8, 'cut'), box('k', [5, -1.5, 5], [4, 3, 3], 'add')]) }, placement: at([0, 100, 0]) },
  { id: 'kolo2', name: 'Kolo2', source: { kind: 'part', doc: part('Kolo2', [cyl('c', [0, 0, 0], 20, 5, 'new'), cyl('b', [0, 0, -1], 4.1, 8, 'cut'), box('k', [12, -2, 5], [6, 4, 3], 'add')]) }, placement: at([30, 100, 0]) },
] };
const slider = (deg) => { const t = (deg * Math.PI) / 180; return R * Math.cos(t) + Math.sqrt(L * L - R * R * Math.sin(t) ** 2); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 }); await start(p);

  let log = await run(p, JSON.stringify(ASM));
  ok(/✓ dokument „Mechanismy“/.test(log), 'sestava z JSON otevřena');
  await p.waitForTimeout(5000); // stavba komponent

  // ── 1. text: závěsy, souosost, kontakty (klika – ojnice – píst) a závěsy ozubených kol ──
  log = await run(p, `sestava vazba závěs "Klika" Ø10 "Rám" Ø10,2
sestava vazba souosost "Ojnice" Ø6,2 "Klika" Ø6
sestava vazba souosost "Ojnice" Ø5,2 "Píst" Ø5
sestava vazba kontakt "Píst" -Y "Rám" +Y nejmenší
sestava vazba kontakt "Píst" -Z "Rám" +Z největší
sestava vazba závěs "Kolo1" Ø6,2 "Držák" Ø6
sestava vazba závěs "Kolo2" Ø8,2 "Držák" Ø8`);
  ok(!bad(log).length && (log.match(/^✓ vazba/gm) || []).length === 7, 'textem 7 vazeb (2× Závěs + Souosost / Kontakt, 2× Závěs kol) – vše ok\n' + (bad(log).join('\n') || line(log, /^.*vazba Závěs[^\n]*/m)));
  let d = await getDoc(p);
  ok(d.mates.length === 7 && d.mates[0].type === 'hinge' && Array.isArray(d.mates[0].phase), 'Závěs uložen s výchozí osovou polohou (phase) ' + JSON.stringify(d.mates[0].phase));
  log = await run(p, 'sestava vazby');
  ok(/7 \(7 ok\)/.test(log), 'sestava vazby: 7 (7 ok)\n' + line(log, /Vazby sestavy[^\n]*/));

  // ── 2. GUI: Ozubená kola z panelu komponenty (seznamy entit, poměr z poloměrů) ──
  const tree = p.locator('aside').first();
  const panel = p.locator('aside').filter({ hasText: 'Komponenta ·' });
  await tree.getByText('Kolo1', { exact: true }).first().click();
  await panel.getByText('Komponenta · Kolo1', { exact: false }).waitFor({ timeout: 8000 });
  await panel.locator('[data-mate-group="mechanical"] > button').first().click();
  const kinBtns = await panel.locator('[data-mate-group] [data-mate-mode]').count();
  await panel.locator('[data-mate-group="advanced"] > button').first().click();
  const kinAll = await panel.locator('[data-mate-group] [data-mate-mode]').count();
  ok(kinBtns === 5 && kinAll === 16, `panel komponenty: Mechanické vazby 5 tlačítek, s Pokročilými 16 (+ 8 základních = 24 tlačítek vazeb) – ${kinBtns} / ${kinAll}`);
  await panel.locator('[data-mate-mode="gear"]').click();
  const rowsA = panel.locator('[data-ent-list="a"] [data-ent-row]');
  await rowsA.first().waitFor({ timeout: 30000 });
  const listA = await rowsA.allInnerTexts();
  ok(listA.some((t) => /válcová Ø20/.test(t)) && listA.some((t) => /válcová Ø6,2/.test(t)) && listA.every((t) => /válcová|úsečka/.test(t)), 'krok 1 Ozubení: nabízí jen osy (válce / úsečky) komponenty Kolo1 – ' + listA.length + ' řádků');
  await p.screenshot({ path: S + 'w7-asm-gear-pick.png' });
  await rowsA.filter({ hasText: 'válcová Ø20' }).first().click();
  await panel.locator('[data-kin-chosen="a"]').waitFor({ timeout: 5000 });
  await panel.locator('[data-kin-comp="target"]').selectOption({ label: 'Kolo2' });
  const rowsB = panel.locator('[data-ent-list="b"] [data-ent-row]');
  await rowsB.filter({ hasText: 'válcová Ø40' }).first().waitFor({ timeout: 30000 });
  await rowsB.filter({ hasText: 'válcová Ø40' }).first().click();
  await panel.locator('[data-kin-params]').waitFor({ timeout: 5000 });
  await p.waitForTimeout(400);
  const ratio = await panel.locator('[data-kin-params] input').first().inputValue();
  ok(ratio === '2', 'poměr předvyplněn z poloměrů os 20 / 10 = 2 (je ' + ratio + ')');
  await panel.locator('[data-mate-confirm]').click();
  d = await (async () => { const t0 = Date.now(); let x = await getDoc(p); while (!(x.mates || []).some((m) => m.type === 'gear' && m.phase) && Date.now() - t0 < 15000) { await p.waitForTimeout(200); x = await getDoc(p); } return x; })();
  const gear = d.mates.find((m) => m.type === 'gear');
  ok(!!gear && gear.value === 2 && gear.a.compId === 'kolo1' && gear.b.compId === 'kolo2' && JSON.stringify(gear.phase) === '[0,0]', 'GUI: vazba Ozubená kola Kolo1 → Kolo2, poměr 2, výchozí natočení zachyceno ' + JSON.stringify(gear));
  ok(await tree.locator(`[data-mate="${gear?.id}"]`).count() === 1 && /Ozubená kola/.test(await tree.locator(`[data-mate="${gear?.id}"]`).innerText()), 'vazba je v seznamu Vazby pod stromem (s polem poměru)');

  // ── 2b. GUI: Mez vzdálenosti (pokročilá vazba s mezemi min / max předvyplněnými z aktuální polohy) ──
  await tree.getByText('Píst', { exact: true }).first().click();
  await panel.getByText('Komponenta · Píst', { exact: false }).waitFor({ timeout: 8000 });
  if (!(await panel.locator('[data-mate-mode="limitDistance"]').isVisible().catch(() => false))) await panel.locator('[data-mate-group="advanced"] > button').first().click();
  await panel.locator('[data-mate-mode="limitDistance"]').click();
  const la = panel.locator('[data-ent-list="a"] [data-ent-row]');
  await la.filter({ hasText: 'normála −Z' }).first().waitFor({ timeout: 30000 });
  await la.filter({ hasText: 'normála −Z' }).first().click();
  await panel.locator('[data-kin-comp="target"]').selectOption({ label: 'Rám' });
  const lb = panel.locator('[data-ent-list="b"] [data-ent-row]');
  await lb.filter({ hasText: 'normála +Z' }).first().waitFor({ timeout: 30000 });
  const lbTexts = await lb.allInnerTexts();
  ok(lbTexts.length >= 6 && lbTexts.every((t) => /rovinná/.test(t)), 'Mez vzdálenosti: cílová entita jen rovinné plochy rámu (' + lbTexts.length + ')');
  // největší plocha +Z (horní plocha rámu z = 0)
  const top = lbTexts.findIndex((t) => /normála \+Z/.test(t) && /střed [^·]*; 0 ·/.test(t));
  await lb.nth(top >= 0 ? top : 0).click();
  await panel.locator('[data-kin-params]').waitFor({ timeout: 5000 });
  await p.waitForTimeout(400);
  const mm = await panel.locator('[data-kin-params] input:not([type=checkbox])').evaluateAll((els) => els.map((e) => e.value));
  ok(mm.join('|') === '-10|10', 'meze předvyplněné kolem naměřené mezery 0 mm: min −10, max 10 (' + mm.join(' | ') + ')');
  await panel.locator('[data-mate-confirm]').click();
  d = await (async () => { const t0 = Date.now(); let x = await getDoc(p); while (!(x.mates || []).some((m) => m.type === 'limitDistance') && Date.now() - t0 < 15000) { await p.waitForTimeout(200); x = await getDoc(p); } return x; })();
  const lim = d.mates.find((m) => m.type === 'limitDistance');
  ok(!!lim && lim.min === -10 && lim.max === 10 && lim.a.compId === 'pist' && lim.b.compId === 'ram' && d.components.find((c) => c.id === 'pist').placement.position.join(';') === '80;0;0', 'GUI: vazba Mez vzdálenosti Píst → Rám ⟨−10; 10⟩ mm, píst zůstal na místě ' + JSON.stringify(lim && { min: lim.min, max: lim.max }));
  ok((await tree.locator(`[data-mate-limits="${lim?.id}"] input`).count()) === 2, 'seznam vazeb: pole Min a Max u meze');
  await p.waitForTimeout(800);
  log = await run(p, 'sestava vazby');
  ok(/9 \(9 ok\)/.test(log) && /Mez vzdálenosti „Píst“ F\d+ → „Rám“ F\d+ · ⟨-10; 10⟩ mm – ok/.test(log), 'sestava vazby: 9 (9 ok), mez ⟨-10; 10⟩ mm\n' + line(log, /^.*Mez vzdálenosti[^\n]*/m));

  // ── 3. GUI: pohybová studie – motor na Závěsu kola 1, kroky, výpočet, časová osa, přehrávání, export ──
  await p.locator('button', { hasText: 'Pohybová studie' }).first().click();
  const mp = p.locator('[data-motion-panel]');
  await mp.waitFor({ timeout: 8000 });
  const opts = await mp.locator('[data-motor-mate] option').allInnerTexts();
  const hingeOpt = opts.find((o) => /Závěs · Kolo1 → Držák/.test(o));
  ok(!!hingeOpt && opts.length >= 4, 'rotační motor nabízí vazby Závěs / Souosost: ' + opts.join(' | '));
  await mp.locator('[data-motor-mate]').selectOption({ label: hingeOpt });
  await mp.locator('[data-motor-add]').click();
  await mp.locator('[data-motor]').first().waitFor({ timeout: 5000 });
  const steps = mp.locator('input[aria-label="Počet kroků"]');
  await steps.fill('36'); await steps.press('Enter');
  await p.waitForTimeout(300);
  d = await getDoc(p);
  ok(d.motion && d.motion.motors.length === 1 && d.motion.motors[0].from === 0 && d.motion.motors[0].to === 360 && d.motion.steps === 36, 'studie uložena v sestavě: 1 motor 0…360°, 36 kroků ' + JSON.stringify(d.motion));
  await mp.locator('[data-motion-run]').click();
  await mp.locator('[data-motion-result]').waitFor({ timeout: 120000 });
  const sum = await mp.locator('[data-motion-summary]').innerText();
  ok(/Pohybová studie: 36 kroků/.test(sum) && /Vazby splněny ve všech krocích/.test(sum) && /Kolo2: .* natáčí se/.test(sum), 'výsledek: 36 kroků, vazby splněny, Kolo2 se natáčí\n' + sum.split('\n').slice(0, 3).join(' | '));
  // výřez 3D okna vpravo od panelu studie (změna textu v panelu se nepočítá)
  const cb = await p.locator('main canvas').first().boundingBox();
  const clip = { x: cb.x + 400, y: cb.y, width: cb.width - 400, height: cb.height };
  const img0 = await p.screenshot({ clip });
  const scrub = mp.locator('[data-motion-scrub]');
  await scrub.fill('9'); await p.waitForTimeout(800);
  const img9 = await p.screenshot({ clip, path: S + 'w7-asm-step9.png' });
  const stepTxt = await mp.locator('[data-motion-step]').innerText();
  ok(/krok 9\/36 · t = 0,5 s · motory 90°/.test(stepTxt), 'posuvník časové osy: krok 9 – ' + stepTxt);
  ok(!img0.equals(img9), 'posuvník časové osy: 3D okno ukazuje polohu kroku (kola s výstupkem natočená)');
  d = await getDoc(p);
  ok(d.components.find((c) => c.id === 'kolo1').placement.rotation.every((v) => Math.abs(v) < 1e-9), 'zobrazení kroku nemění dokument (Kolo1 v dokumentu stále 0°)');
  await mp.locator('[data-motion-play]').click(); await p.waitForTimeout(1200);
  const playing = await mp.locator('[data-motion-step]').innerText();
  await mp.locator('[data-motion-play]').click();
  ok(!/krok 9\/36/.test(playing), 'přehrávání posouvá krok (' + playing.split('·')[0].trim() + ')');
  let dl = p.waitForEvent('download', { timeout: 20000 });
  await mp.locator('[data-motion-export="csv"]').click();
  let file = await dl;
  const csvPath = S + 'w7-asm-motion.csv'; await file.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  ok(/\.csv$/.test(file.suggestedFilename()) && csv.length === 38 && /^Krok;Čas \[s\];Motor 1 \[°\];Rám X;/.test(csv[0]), 'export CSV: hlavička + 37 kroků – ' + file.suggestedFilename());
  dl = p.waitForEvent('download', { timeout: 120000 });
  await mp.locator('[data-motion-export="png"]').click();
  file = await dl;
  const zipPath = S + 'w7-asm-frames.zip'; await file.saveAs(zipPath);
  const zip = fs.readFileSync(zipPath);
  const pngCount = (zip.toString('latin1').match(/krok-\d{4}\.png/g) || []).length / 2; // název v lokální i centrální hlavičce
  ok(pngCount === 37 && zip.readUInt32LE(0) === 0x04034b50, 'export snímků: ZIP s 37 PNG + CSV (' + pngCount + ' snímků, ' + zip.length + ' B)');
  const webm = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await mp.locator('[data-motion-export="webm"]').click();
  const wf = await webm;
  if (wf) { const wp = S + 'w7-asm-motion.webm'; await wf.saveAs(wp); const w = fs.readFileSync(wp); ok(w.length > 1000 && w.readUInt32BE(0) === 0x1a45dfa3, 'export videa WebM (MediaRecorder): ' + w.length + ' B, hlavička EBML'); }
  else ok(/neumí nahrát video/.test(await p.locator('body').innerText()), 'video WebM: prohlížeč MediaRecorder nemá – ohlášeno');

  // ── 4. text / API: klikový mechanismus – motor, kolize, stopa; přesnost vůči vzorci ──
  log = await run(p, 'pohyb motor rotační "Klika" 0..360 krok 10 kolize stopa "Ojnice" bod 30 0 14');
  ok(!bad(log).length && /✓ motor 2: rotační motor · Závěs „Klika“ → „Rám“ · 0…360°/.test(log), 'text: pohyb motor rotační "Klika" 0..360 krok 10 kolize stopa – motor 2 na Závěsu klika → rám\n' + (bad(log).join('\n') || line(log, /^✓ motor[^\n]*/m)));
  ok(/⚠ první kolize v kroku 14 \(t = 0,778 s\): „(Píst|Doraz)“ × „(Píst|Doraz)“/.test(log), 'kolize v krocích: první v kroku 14 (140°) píst × doraz\n' + line(log, /^.*kolize[^\n]*/m));
  const api = await p.evaluate(() => window.mncad.motion());
  let worst = 0;
  for (const s of api.steps) worst = Math.max(worst, Math.abs(s.comps['Píst'].position[0] - slider(s.motors[1])), Math.abs(s.comps['Píst'].position[1]));
  ok(api.steps.length === 37 && worst < 1e-4, `window.mncad.motion(): 37 kroků, poloha pístu = r·cos θ + √(l² − r²·sin² θ) s max. chybou ${worst.toExponential(2)} mm`);
  const k2 = api.steps.map((s) => s.comps['Kolo2'].rotation[2]);
  ok(Math.abs(k2[9] + 45) < 1e-6 && Math.abs(k2[18] + 90) < 1e-6 && Math.abs(Math.abs(k2[36]) - 180) < 1e-6, 'převod 2 : 1 v téže studii: Kolo1 90° → Kolo2 −45°, 180° → −90°, 360° → ±180° (' + [k2[9], k2[18], k2[36]].join(', ') + ')');
  ok(api.collision && api.collision.step === 14 && ['Píst', 'Doraz'].includes(api.collision.a) && api.steps[14].clashes?.length && !api.steps[13].clashes?.length, 'API: první kolize krok 14, dvojice ' + JSON.stringify(api.collision));
  ok(api.steps[0].trace && Math.abs(api.steps[0].trace[0] - (R + 30)) < 1e-6 && /Stopa X/.test(api.csv.split('\n')[0]), 'stopa bodu ojnice: krok 0 v [' + api.steps[0].trace.join('; ') + '], sloupce Stopa X/Y/Z v CSV');
  log = await run(p, 'pohyb krok 18');
  ok(/Krok 18 \(t = 1 s, motory 180; 180\):/.test(log) && new RegExp(`Píst \\[${String(slider(180)).replace('.', ',')}; 0; 0\\]`).test(log), 'pohyb krok 18: píst na 40 mm (dolní úvrať) ' + line(log, /Píst \[[^\]]*\]/));
  log = await run(p, 'pohyb export csv');
  ok(log.split('\n').filter((l) => /^\d+;/.test(l)).length === 37, 'pohyb export csv: 37 řádků tabulky v protokolu');
  log = await run(p, 'stav');
  ok(/Pohybová studie: motorů 2 · kroků 36 · 2 s · kolize – pohyb stav/.test(log), 'stav: řádek Pohybová studie ' + line(log, /Pohybová studie[^\n]*/));
  log = await run(p, 'pohyb přehrát');
  await p.waitForTimeout(1500);
  ok(/▶ přehrávání 36 kroků/.test(log) && (await mp.locator('[data-motion-step]').count()) === 1, 'pohyb přehrát: panel přehrává ' + line(log, /▶[^\n]*/));
  await run(p, 'pohyb zastavit');

  // ── 5. angličtina a mechanické vazby textem ──
  log = await run(p, 'assembly mate gear "Kolo2" "Kolo1" teeth 40 20');
  ok(/✓ vazba Ozubená kola „Kolo2“ F\d+ → „Kolo1“ F\d+ · poměr 0,5: ok/.test(log), 'EN: assembly mate gear … teeth 40 20 → poměr 0,5 (shodný s první vazbou, bez konfliktu) ' + line(log, /^.*vazba Ozubená[^\n]*/m));
  log = await run(p, 'motion status');
  ok(/Pohybová studie: motorů 2/.test(log) && /Vazby splněny ve všech krocích/.test(log), 'EN: motion status');

  // ── 6. vačka s rovinným zdvihátkem (síť plochy vačky z jádra), dráha po hraně a vrchol na rovinu ──
  const CAM = { app: 'mnastrojarna-cad', version: 2, name: 'Vačkový mechanismus', kind: 'assembly', material: 'ocel', features: [], components: [
    { id: 'ram2', name: 'Rám2', fixed: true, source: { kind: 'part', doc: part('Rám2', [box('a', [-30, -30, -10], [60, 100, 10]), cyl('h', [0, 0, -10], 4, 20, 'add'), { id: 'g', name: 'Vodítko', type: 'cylinder', radius: 3, height: 40, position: [0, 30, 5], axis: 'Y', mode: 'add' }]) }, placement: at([0, 0, 0]) },
    { id: 'vacka', name: 'Vačka', source: { kind: 'part', doc: part('Vačka', [cyl('c', [5, 0, 0], 20, 10, 'new'), cyl('b', [0, 0, -1], 4.1, 12, 'cut')]) }, placement: at([0, 0, 0]) },
    { id: 'zdvih', name: 'Zdvihátko', source: { kind: 'part', doc: part('Zdvihátko', [box('a', [-10, 0, 0], [20, 20, 10]), { id: 'v', name: 'Otvor', type: 'cylinder', radius: 3.1, height: 40, position: [0, -5, 5], axis: 'Y', mode: 'cut' }]) }, placement: at([0, 20, 0]) },
    { id: 'kulicka', name: 'Kulička', source: { kind: 'part', doc: part('Kulička', [{ id: 's', name: 'Koule', type: 'sphere', radius: 2, position: [0, 0, 0], mode: 'new' }]) }, placement: at([60, -40, 30]) },
    { id: 'klin', name: 'Klín', source: { kind: 'part', doc: part('Klín', [box('a', [0, 0, 0], [10, 10, 10])]) }, placement: at([100, 0, 50]) },
  ] };
  log = await run(p, JSON.stringify(CAM));
  await p.waitForTimeout(4000);
  log = await run(p, `sestava vazba závěs "Vačka" Ø8,2 "Rám2" Ø8
sestava vazba souosost "Zdvihátko" Ø6,2 "Rám2" Ø6
sestava vazba vačka "Zdvihátko" -Y "Vačka" válcová Ø40`);
  ok(!bad(log).length && /✓ vazba Vačka „Zdvihátko“ F\d+ → „Vačka“ F\d+: ok/.test(log), 'text: vazba Vačka (rovinné zdvihátko → válcová plocha vačky Ø40) ok\n' + (bad(log).join('\n') || line(log, /^.*vazba Vačka[^\n]*/m)));
  const camApi = await p.evaluate(() => window.mncad.motion('motor rotační "Vačka" 0..360 krok 15'));
  let camErr = 0;
  for (const s of camApi.steps) camErr = Math.max(camErr, Math.abs(s.comps['Zdvihátko'].position[1] - (20 + 5 * Math.sin((s.motors[0] * Math.PI) / 180))));
  ok(camApi.steps.length === 25 && camErr < 5e-3 && /Vazby splněny ve všech krocích/.test(camApi.summary.join('\n')), `vačka: zdvih zdvihátka = R + e·sin θ (excentr 5 mm) v 25 krocích, max. odchylka ${camErr.toExponential(2)} mm (síť plochy vačky ±0,002 mm)`);
  log = await run(p, 'sestava vazba dráha "Kulička" koule "Vačka" kružnice Ø40 +Z');
  d = await getDoc(p);
  const kp = d.components.find((c) => c.id === 'kulicka').placement.position;
  ok(/✓ vazba Dráha „Kulička“ F1 → „Vačka“ E\d+: ok/.test(log) && Math.abs(Math.hypot(kp[0] - 5, kp[1]) - 20) < 1e-3 && Math.abs(kp[2] - 10) < 1e-3, 'dráha: střed kuličky na horní kružnici vačky Ø40 (hrana z jádra) – ' + kp.map((v) => v.toFixed(3)).join('; '));
  // vrchol (GUI seznam vrcholů) na rovinu – vazba Shodně
  await tree.getByText('Klín', { exact: true }).first().click();
  await panel.getByText('Komponenta · Klín', { exact: false }).waitFor({ timeout: 8000 });
  if (!(await panel.locator('[data-mate-mode="coincident"]').isVisible().catch(() => false))) await panel.locator('[data-mate-group="advanced"] > button').first().click();
  await panel.locator('[data-mate-mode="coincident"]').click();
  const va = panel.locator('[data-ent-list="a"] [data-ent-row]');
  await va.filter({ hasText: 'Vrchol' }).first().waitFor({ timeout: 30000 });
  const vRows = await va.filter({ hasText: 'Vrchol' }).allInnerTexts();
  ok(vRows.length === 8, 'Shodně: seznam nabízí 8 vrcholů kvádru (a jeho roviny / hrany) – ' + vRows.length);
  const lowV = vRows.findIndex((t) => /střed [^·]*; 50(\s|$)/.test(t));
  await va.filter({ hasText: 'Vrchol' }).nth(Math.max(0, lowV)).click();
  await panel.locator('[data-kin-comp="target"]').selectOption({ label: 'Rám2' });
  const vb = panel.locator('[data-ent-list="b"] [data-ent-row]');
  await vb.filter({ hasText: 'normála +Z' }).first().waitFor({ timeout: 30000 });
  await vb.filter({ hasText: 'normála +Z' }).first().click();
  await panel.locator('[data-mate-confirm]').click();
  d = await (async () => { const t0 = Date.now(); let x = await getDoc(p); while (!(x.mates || []).some((m) => m.type === 'coincident') && Date.now() - t0 < 15000) { await p.waitForTimeout(200); x = await getDoc(p); } await p.waitForTimeout(1500); return getDoc(p); })();
  const co = d.mates.find((m) => m.type === 'coincident');
  const klin = d.components.find((c) => c.id === 'klin').placement.position;
  ok(!!co && co.a.ent === 'vertex' && Math.abs(klin[0] - 100) < 1e-6 && Math.abs(klin[1]) < 1e-6 && (Math.abs(klin[2]) < 1e-6 || Math.abs(klin[2] + 10) < 1e-6), 'GUI Shodně: vrchol klínu (V) na horní rovinu rámu – klín sjel z z = 50 na ' + klin[2] + ' (x, y beze změny)');

  // ── 7. anglické a německé rozhraní: průvodce vazbou, pohybová studie, protokol – žádný chybějící překlad ──
  for (const [lang, cont, comp, gearTxt, studyTxt] of [['en', 'Continue working', 'Component ·', 'Gears', 'Motion study'], ['de', 'Weiterarbeiten', 'Komponente ·', 'Zahnräder', 'Bewegungsstudie']]) {
    const e = await ctx.newPage();
    e.on('pageerror', (x) => errs.push(lang + ': ' + x.message));
    await e.goto(BASE + '/' + lang + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
    const cbtn = e.getByText(cont); if (await cbtn.isVisible({ timeout: 6000 }).catch(() => false)) await cbtn.click();
    await coreReady(e); await e.waitForTimeout(800);
    await run(e, JSON.stringify(ASM)); await e.waitForTimeout(4000);
    await run(e, 'assembly mate hinge "Kolo1" Ø6,2 "Držák" Ø6\nassembly mate hinge "Kolo2" Ø8,2 "Držák" Ø8');
    const et = e.locator('aside').first();
    const ep = e.locator('aside').filter({ hasText: comp });
    await et.getByText('Kolo1', { exact: true }).first().click();
    await ep.locator('[data-mate-group="mechanical"] > button').first().click();
    await ep.locator('[data-mate-group="advanced"] > button').first().click();
    const lbl = await ep.locator('[data-mate-mode="gear"]').innerText();
    await ep.locator('[data-mate-mode="gear"]').click();
    await ep.locator('[data-ent-list="a"] [data-ent-row]').first().waitFor({ timeout: 30000 });
    await ep.locator('[data-ent-list="a"] [data-ent-row]').first().click();
    await ep.locator('[data-kin-comp="target"]').selectOption({ label: 'Kolo2' });
    await ep.locator('[data-ent-list="b"] [data-ent-row]').first().waitFor({ timeout: 30000 });
    await ep.locator('[data-ent-list="b"] [data-ent-row]').first().click();
    await ep.locator('[data-kin-params]').waitFor({ timeout: 5000 });
    await ep.locator('[data-mate-confirm]').click(); await e.waitForTimeout(1500);
    await e.locator('button', { hasText: studyTxt }).first().click();
    const emp = e.locator('[data-motion-panel]'); await emp.waitFor({ timeout: 8000 });
    await emp.locator('[data-motor-add]').click(); await emp.locator('[data-motor]').first().waitFor({ timeout: 5000 });
    await emp.locator('[data-motion-run]').click(); await emp.locator('[data-motion-result]').waitFor({ timeout: 120000 });
    const elog = await run(e, 'motion status\nassembly mates');
    await e.screenshot({ path: S + 'w7-asm-' + lang + '.png' });
    const miss = await e.evaluate(() => window.mncad.missing());
    ok(lbl.trim() === gearTxt && miss.length === 0 && !/Pohybová|vazba/.test(elog), `${lang.toUpperCase()}: tlačítko „${lbl.trim()}“, průvodce, pohybová studie a protokol přeložené, chybějící klíče ${JSON.stringify(miss.slice(0, 8))}`);
    await e.close();
  }
  ok(!errs.length, 'bez chyb stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await p.screenshot({ path: S + 'w7-asm-end.png' });
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.stack); process.exitCode = 1; process.exit(); });
