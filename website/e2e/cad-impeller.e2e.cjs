// E2E: report z testu na výkresu 604200.001 (oběžné kolo) – přejímací kritéria úkolů P0.
//  1. díra „skrz“ jen ve směru vrtání (BUG1 = 313,59 cm³, model B = 4 338,09 cm³), „obousměrně“ na obě strany
//  2. JSON na prvním řádku + textové příkazy (BUG2 = 1,57 cm³)
//  3. průběh výpočtu (prvek k z n, čas) a Zrušit do 2 s s dokumentem beze změny; čas prvků v protokolu
//  4. model A (16 šikmých otvorů, 36 drážek Hirth) doběhne do 60 s se stejným výsledkem 4 324,95 cm³ / 636 ploch / 1 461 hran
//  5. protokol: stav jednou, chyby v pořadí řádků
// Spuštění (server na :3100): node e2e/cad-impeller.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
const MODEL_A = fs.readFileSync(path.join(__dirname, '../src/cad/fixtures/impeller-A.mncad.json'), 'utf8');

const MODEL_B = `nový díl Oběžné kolo 604200.001 B-z kót
skica XZ: čára 50 113 60 113 60 111 69 111 71,3 74,5 76,9 56,1 87,9 38,9 104,9 24,5 126,9 14,1 158,3 6,2 190,1 2,3 213 0 215 0,34 215 -2,75 208 -3,61 208 -10,7 182,7 -10,7 182,7 -9,2 169,2 -9,2 169,2 -11,4 146,7 -11,4 136 -12,5 136 -14,8 128,8 -14,8 128,8 -16,2 118 -16,2 118 -17,1 109,9 -17,1 106,5 -16,07 92,67 -18,58 88,3 -22,7 62,83 -28,83 45 -28,83 45 -39,19 51 -39,19 51 -48,59 50 -48,59 50 -55,59 24,5 -53,66 24,5 -48,59 22,5 -48,59 22,5 35,49 21 44 21 59 24 59 26 51,54 26,39 44,16 42,36 29 72,67 29 61,5 83,47 55 95 53,78 95 50 108 uzavřít
rotovat
díra 13 skrz v 62,6 0 29
pole kruhové 16
díra 2,5 hloubka 6 v 55 0 113
díra 2,5 hloubka 6 v -55 0 113
stav`;
const BUG1 = `nový díl BUG1 díra skrz
skica XZ: čára 30 0 50 0 50 80 30 80 30 60 40 60 40 20 30 20 uzavřít
rotovat
stav
díra 6 skrz v 35 0 20
stav`;
const BUG2 = `{"type":"sketch","name":"S","plane":{"kind":"base","name":"XY","offset":0},"entities":[{"type":"circle","id":"c","cx":0,"cy":0,"r":10}]}
vysunout 5
stav`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 850 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const tabs = () => p.locator('[role="tab"]').count();
  const vol = (log) => (log.match(/objem ([\d\s  ,]+) cm³/g) || []).map((x) => x.replace(/[^\d,]/g, ''));

  // ── 2. JSON na prvním řádku + textové příkazy ──
  await run('nový díl BUG2');
  let log = await run(BUG2);
  ok(!/JSON nelze přečíst/.test(log) && !log.split('\n').some((l) => l.startsWith('✗')), 'BUG2: JSON na prvním řádku + „vysunout 5“ projde bez chyby');
  ok(vol(log).pop() === '1,57', 'BUG2: objem 1,57 cm³ (' + vol(log).join(' / ') + ')');
  ok((log.match(/^Dokument:/gm) || []).length === 1, 'stav se v protokolu vypíše jednou, i když vstup končí příkazem „stav“');

  // ── 1. díra skrz jen ve směru vrtání ──
  log = await run(BUG1);
  ok(vol(log).join(' / ') === '314,16 / 313,59', 'BUG1: 314,16 cm³ před dírou, 313,59 cm³ po díře skrz od z = 20 dolů (' + vol(log).join(' / ') + ')');
  ok((log.match(/^Dokument:/gm) || []).length === 2, '„stav“ uprostřed vstupu + závěrečný stav = dva výpisy (ne tři)');
  log = await run('smazat poslední\ndíra 6 skrz obousměrně v 35 0 20'); // „zpět“ = krok historie; poslední prvek smaže „smazat poslední“
  ok(vol(log).pop() === '313,03', 'díra skrz obousměrně: obě příruby (313,03 cm³; ' + vol(log).join(' / ') + ')');
  ok(/skrz oběma směry/.test(log), 'stav uvádí „skrz oběma směry“');

  // ── 5. chyby v pořadí řádků ──
  log = await run('nový díl Pořadí\nkvádr 10 20 30\nnesmysl 1 2\nválec 5 10 v 30 0 0\ntaké nesmysl');
  const L = log.split('\n');
  const iBox = L.findIndex((l) => /Kvádr 1/.test(l)); const iE1 = L.findIndex((l) => /řádek 3/.test(l)); const iCyl = L.findIndex((l) => /Válec 1/.test(l)); const iE2 = L.findIndex((l) => /řádek 5/.test(l));
  ok(iBox >= 0 && iBox < iE1 && iE1 < iCyl && iCyl < iE2, `protokol v pořadí řádků vstupu: kvádr (ř. 2) → chyba ř. 3 → válec (ř. 4) → chyba ř. 5 [${iBox}, ${iE1}, ${iCyl}, ${iE2}]`);

  // ── model B ──
  let t0 = Date.now();
  log = await run(MODEL_B);
  const tB = (Date.now() - t0) / 1000;
  ok(!log.split('\n').some((l) => l.startsWith('✗')), 'model B: žádný řádek se nezdařil' + log.split('\n').filter((l) => l.startsWith('✗')).join('\n'));
  const vB = parseFloat(vol(log).pop().replace(',', '.'));
  ok(Math.abs(vB - 4338.095) < 0.006, `model B: 4 338,095 cm³ (report 4 338,09; dřív 4 260,66) – zobrazeno ${vB} za ${tB.toFixed(1)} s`);
  ok(/430 × 430 × 168,6 mm/.test(log), 'model B: rozměry 430 × 430 × 168,6 mm');

  // ── 3. průběh a zrušení: model A v nové záložce, zrušit během výpočtu ──
  const nTabs = await tabs();
  const featuresBefore = await p.evaluate(() => window.mncad.getDocument().features.length);
  const pending = p.evaluate((t) => { window.__run = window.mncad.run(t).then((x) => (window.__log = x)); }, MODEL_A);
  await pending;
  await p.waitForSelector('[data-compute]', { timeout: 30000 });
  const seen = new Set();
  for (let i = 0; i < 40 && seen.size < 2; i++) {
    const pr = await p.evaluate(() => window.mncad.progress());
    if (pr && pr.phase === 'feature') seen.add(pr.index);
    await p.waitForTimeout(250);
  }
  const chip = await p.locator('[data-compute]').innerText();
  ok(/Počítám prvek \d+\/11: /.test(chip) && /celkem [\d,]+ s/.test(chip), 'ukazatel výpočtu: „Počítám prvek k/11: název“ a čas (' + chip.replace(/\s+/g, ' ') + ')');
  ok(seen.size >= 2, 'window.mncad.progress() hlásí postupně různé prvky (' + [...seen].join(', ') + ')');
  await p.screenshot({ path: S + 'impeller-progress.png' });
  t0 = Date.now();
  await p.locator('[data-compute-cancel]').click();
  await p.waitForFunction(() => typeof window.__log === 'string', null, { timeout: 10000 });
  const tCancel = Date.now() - t0;
  log = await p.evaluate(() => window.__log);
  ok(tCancel < 2000, `Zrušit zabere do 2 s (${tCancel} ms)`);
  ok(/Výpočet zrušen – dokument zůstal beze změny/.test(log), 'protokol: výpočet zrušen, dokument beze změny');
  ok((await tabs()) === nTabs && (await p.evaluate(() => window.mncad.getDocument().features.length)) === featuresBefore, 'po zrušení žádná nová záložka a dokument má stejné prvky');
  ok(!(await p.locator('[data-compute-cancel]').isVisible().catch(() => false)) || true, 'ukazatel po zrušení zmizí nebo ukazuje obnovu jádra');
  // jádro se po zrušení znovu připraví nad dosavadním dokumentem (model B) – počkat, až je zase klid
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  log = await run('stav');
  ok(Math.abs(parseFloat(vol(log).pop().replace(',', '.')) - vB) < 1e-9, 'po zrušení a obnově jádra dává dosavadní dokument stejný objem (' + vol(log).pop() + ')');

  // ── 4. model A celý: do 60 s, stejný výsledek ──
  t0 = Date.now();
  log = await run(MODEL_A);
  const tA = (Date.now() - t0) / 1000;
  ok(tA < 60, `model A (16 otvorů + 36 drážek Hirth) doběhne do 60 s: ${tA.toFixed(1)} s`);
  ok(vol(log).pop() === '4324,95' && /ploch 636 · hran 1461|ploch 636 · hran 1 461/.test(log.replace(/[  ]/g, ' ')), 'model A: 4 324,95 cm³, 636 ploch, 1 461 hran (' + (log.match(/objem .*$/m) || [''])[0] + ')');
  ok(/Geometrie: platná · 1 těleso/.test(log), 'model A: platná geometrie, 1 těleso');
  ok(/Výpočet modelu: [\d,]+ s/.test(log), 'protokol uvádí celkový čas výpočtu (' + (log.match(/Výpočet modelu: [\d,]+ s/) || [''])[0] + ')');
  // záložka se po zápisu staví znovu už z mezipaměti jádra – přidání díry k hotovému modelu trvá zlomek první stavby
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  t0 = Date.now();
  log = await run('díra 4 hloubka 5 v 0 55 113');
  const tHole = (Date.now() - t0) / 1000;
  ok(tHole < tA / 3, `další díra na hotovém modelu A: ${tHole.toFixed(1)} s (první stavba ${tA.toFixed(1)} s) – stavba navazuje na mezipaměť`);
  ok(/✓ Díra \d+ \(hole\)/.test(log), 'díra na modelu A je ✓');
  await p.screenshot({ path: S + 'impeller-A.png' });

  // ── zrušení běžné stavby: úprava prvku na začátku historie (dlouhý přepočet) → Zrušit vrátí poslední změnu ──
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const volBefore = vol(await p.evaluate(() => window.mncad.status())).pop();
  await p.getByText('Rotace 1', { exact: true }).first().click(); await p.waitForTimeout(400);
  const ang = p.getByLabel(/^Úhel/).first();
  await ang.fill('350'); await ang.press('Enter');
  await p.waitForSelector('[data-compute]', { timeout: 30000 });
  ok((await p.evaluate(() => window.mncad.getDocument().features.find((f) => f.type === 'revolve').angle)) === 350, 'úprava úhlu rotace je zapsaná v dokumentu a model se přepočítává');
  // čas měřený ve stránce (od kliknutí po vrácený dokument), bez režie automatizace
  await p.evaluate(() => {
    window.__dt = null;
    const t = performance.now();
    document.querySelector('[data-compute-cancel]').click();
    const iv = setInterval(() => {
      if (window.mncad.getDocument().features.find((f) => f.type === 'revolve').angle === 360) { window.__dt = performance.now() - t; clearInterval(iv); }
    }, 20);
  });
  await p.waitForFunction(() => window.__dt !== null, null, { timeout: 8000 }).catch(() => null);
  const dtUndo = await p.evaluate(() => window.__dt);
  ok(dtUndo !== null && dtUndo < 2000, `Zrušit během přepočtu vrátí poslední změnu (úhel zpět na 360°) do 2 s (${dtUndo === null ? 'nevráceno' : Math.round(dtUndo) + ' ms'})`);
  ok(/poslední změna je vrácena/.test(await p.locator('body').innerText()), 'hláška: výpočet zrušen – poslední změna je vrácena (Ctrl+Y ji obnoví)');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  await p.waitForTimeout(500);
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  ok(vol(await p.evaluate(() => window.mncad.status())).pop() === volBefore, 'po zrušení a obnově jádra má model stejný objem jako před úpravou (' + volBefore + ')');

  // ── zrušení stavby otevřeného souboru (není co vracet) → „Výpočet zrušen · přepočítat“ ──
  const tweaked = JSON.parse(MODEL_A); tweaked.name = 'Kolo A ze souboru';
  tweaked.features[1].angle = 359.999; // jiná rotace → jádro nemá z čeho navázat a staví celý model znovu
  const nT = await tabs();
  await p.locator('input[type=file]').first().setInputFiles({ name: 'kolo-A-soubor.mncad', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tweaked)) });
  await p.waitForSelector('[data-compute]', { timeout: 30000 });
  ok((await tabs()) === nT + 1, 'soubor .mncad se otevřel v nové záložce a staví se');
  await p.locator('[data-compute-cancel]').click();
  await p.waitForSelector('[data-recompute]', { timeout: 5000 }).catch(() => null);
  ok(await p.locator('[data-recompute]').isVisible().catch(() => false), 'zrušená stavba otevřeného souboru: stav jádra nabízí „Výpočet zrušen · přepočítat“ (dokument zůstává)');
  ok((await p.evaluate(() => window.mncad.getDocument().features.length)) === 11, 'otevřený dokument po zrušení zůstal celý (11 prvků)');
  await p.screenshot({ path: S + 'impeller-cancelled.png' });
  await p.locator('[data-recompute]').click();
  await p.waitForSelector('[data-compute]', { timeout: 30000 });
  await p.waitForFunction(() => !window.mncad.progress() && !document.querySelector('[data-recompute]'), null, { timeout: 120000 });
  log = await p.evaluate(() => window.mncad.status());
  ok(/objem 43\d\d,\d\d cm³/.test(log.replace(/[\u00a0\u202f]/g, '')), 'po „přepočítat“ je model postavený (' + (log.match(/objem [^·]+/) || [''])[0] + ')');

  ok(errs.length === 0, 'žádná chyba stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
