// E2E (balík B5, CAD-HEADLESS-NAVRH.md kap. 6): kontrola dílu textem (tabulka děr se sloučeným zahloubením, závitem a dnem),
// přiložený soubor reference (window.mncad.attach i tlačítko „Připojit soubor…“ v konzoli), porovnat s vlastním STEP = shoda,
// změněný díl = ⚠ compare.mismatch, chybějící soubor = ✗ se seznamem přiložených, kolize šroub × závit = šroub v závitu
// (ne ⚠), kolík s přesahem = ⚠ skutečná kolize, kontrola sestavy s V.sum / V.union a třídami kolizí; po změně sestavy stav
// označí kolize jako neplatné, knihovní šroub ISO 4762 v průchozí díře je jen šroub v závitu, průchozí díra má vstup u prvku.
// Spuštění: E2E_BASE=http://localhost:3341 node e2e/cad-check-compare.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-check').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

const P4 = `nový díl Spodní deska
kvádr 300 200 40
díra 8,5 hloubka 25 v 30 25 40 v 90 25 40 v 150 25 40 v 210 25 40 závit M10 hloubka-závitu 20
díra 25 skrz v 15 100 40 v 285 100 40
díra 8 hloubka 20 v 60 60 40 v 240 60 40
díra 11 skrz v 150 100 40 zahloubení 18 11`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p);
  await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const line = (l, re) => (l.match(re) || [''])[0];
  const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));

  // ── kontrola dílu (P4) ──
  let log = await run(`${P4}\nkontrola polohy`);
  ok(!bad(log).length && /Kontrola „Spodní deska“: objem 2\s?347,216 cm³ · hmotnost 18,426 kg \(hustota 7,85 g\/cm³\) · obálka 300 × 200 × 40 mm/.test(log), 'kontrola: přesný objem, hmotnost, hustota a obálka (' + line(log, /^Kontrola[^\n]*/m).slice(0, 140) + ')');
  ok(/^Díry \(9\):$/m.test(log) && /^ {2}4× M10 ↧20 · Ø8,5 ↧25 · dno kužel 118° · směr -Z · polohy \[30; 25; 40\]/m.test(log), 'tabulka děr: 4× M10 ↧20, vrták Ø8,5 ↧25, kužel 118°, polohy');
  ok(/^ {2}Ø11 skrz · zahloubení Ø18 ↧11 · směr -Z/m.test(log), 'zahloubení + průchod = jedna díra (souosé úseky sloučené)');
  ok(/^ {2}2× Ø25 skrz/m.test(log) && /^ {2}2× Ø8 ↧20 · dno kužel 118°/m.test(log), 'průchozí Ø25 a slepé Ø8 s hrotem');

  // ── přiložený soubor + porovnat ──
  const step = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(step && step.base64 && step.base64.length > 1000, 'export STEP dílu přes window.mncad.exportFile (' + (step && step.bytes) + ' B)');
  const list = await p.evaluate((b64) => window.mncad.attach({ name: 'deska.step', base64: b64 }), step.base64);
  ok(Array.isArray(list) && list.length === 1 && list[0].name === 'deska.step' && list[0].bytes === step.bytes, 'window.mncad.attach vrátí přiložené soubory ' + JSON.stringify(list));
  log = await run('porovnat "deska.step" tolerance 0,05');
  ok(!bad(log).length && /POROVNÁNÍ S REFERENČNÍM MODELEM/.test(log) && /Žádné rozdílové oblasti nad prahem šumu\./.test(log) && !/⚠/.test(log.split('\nDokument:')[0]), 'porovnat s vlastním STEP: shoda bez ⚠');
  log = await run('upravit "Díra 2" diameter=26\nporovnat deska.step');
  ok(/⚠ řádek 2: model se od reference liší: /.test(log), 'změněný díl (Ø26 místo Ø25): ⚠ compare.mismatch (' + line(log, /^⚠ řádek 2:[^\n]*/m).slice(0, 160) + ')');
  log = await run('porovnat deska.step přísně');
  ok(/✗ řádek 1: model se od reference liší/.test(log), 's přísně: ✗');
  log = await run('porovnat "jiny.step"');
  ok(/✗ řádek 1: soubor „jiny\.step“ není k dispozici – dostupné: deska\.step/.test(log), 'chybějící soubor: ✗ se seznamem přiložených (' + line(log, /^✗[^\n]*/m) + ')');

  // ── tlačítko „Připojit soubor…“ v konzoli (jedno úložiště s logem razítka a předlohou – integrace fáze B s vlnou 15) ──
  await p.keyboard.press('Control+Shift+K');
  const btn = p.getByRole('button', { name: 'Připojit soubor…' });
  ok(await btn.isVisible({ timeout: 10000 }).catch(() => false), 'konzole: tlačítko Připojit soubor…');
  const f = path.join(S, 'ref2.step');
  fs.writeFileSync(f, Buffer.from(step.base64, 'base64'));
  await p.locator('[data-agent-attach-input]').setInputFiles(f);
  await p.waitForSelector('[data-attached="ref2.step"]', { timeout: 15000 }).catch(() => {});
  ok(await p.locator('[data-attached="ref2.step"]').isVisible().catch(() => false) && /Připojeno: ref2\.step/.test(await p.evaluate(() => document.body.innerText)), 'po výběru souboru hláška „Připojeno: …“ a soubor v seznamu připojených');
  const names = await p.evaluate(() => window.mncad.attachments().map((x) => x.name));
  ok(JSON.stringify(names) === JSON.stringify(['deska.step', 'ref2.step']), 'window.mncad.attachments() = ' + JSON.stringify(names));
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.mncad.detach('ref2.step'));

  // ── kolize šroub × závit a kontrola sestavy ──
  log = await run(`nový díl Deska
kvádr 40 40 30
díra 8,5 hloubka 25 v 20 20 30 závit M10
díra 7,9 hloubka 20 v 10 10 30
nový díl Šroub
válec 10 25
nový díl Kolík
válec 8 20
nová sestava Spoj
vložit "Deska" ukotvit
vložit "Šroub" v 20 20 5
vložit "Kolík" v 10 10 10
kolize`);
  ok(/^kolize: 2 – šroub v závitu 1, skutečné 1$/m.test(log), 'kolize: šroub v závitu se nehlásí jako ⚠ (' + line(log, /^kolize:[^\n]*/m) + ')');
  ok(/⚠ řádek 13: kolize „Deska“ × „Kolík“/.test(log) && !/⚠[^\n]*„Šroub“/.test(log), 'jen kolík s přesahem je ⚠ skutečná kolize');
  log = await run('kontrola sestava díry');
  ok(/Kontrola sestavy „Spoj“: 3 komponent \(3 různých dílů\) · objem Σ [\d\s,]+ cm³, sjednocení [\d\s,]+ cm³/.test(log) && /kolize 2 \(šroub v závitu 1, pod hlavou 0, skutečné 1, nevyhodnotitelné 0\)/.test(log), 'kontrola sestava: V.sum, V.union, třídy kolizí (' + line(log, /^Kontrola sestavy[^\n]*/m).slice(0, 160) + ')');
  ok(/1× „Deska“ – objem/.test(log) && /M10 · Ø8,5 ↧25/.test(log), 'kontrola sestava díry: řádek dílu a jeho díry');
  let st = await p.evaluate(() => window.mncad.status());
  ok(/Kolize: 2 –/.test(st) && !/NEPLATÍ/.test(st), 'stav sestavy: Kolize: 2 (výsledek kontroly)');
  // po změně sestavy výsledek kontroly kolizí neplatí – stav to řekne; nová kontrola ho obnoví
  log = await run('sestava komponenta "Šroub" v 21 20 5\nstav');
  ok(!bad(log).length && /Kolize: 2 – .*NEPLATÍ: sestava se od kontroly změnila/.test(log), 'posunutý šroub: stav označí kolize jako neplatné (' + line(log, /^Kolize:[^\n]*/m).slice(-90) + ')');
  log = await run('kolize');
  st = await p.evaluate(() => window.mncad.status());
  ok(/^kolize: 2 – šroub v závitu 0, skutečné 2$/m.test(log) && !/NEPLATÍ/.test(st), 'nová kontrola: šroub mimo osu = skutečná kolize, stav zase platí (' + line(log, /^kolize:[^\n]*/m) + ')');
  log = await run('kontrola díl "Šroub"');
  ok(/^Kontrola „Šroub“: objem 1,963 cm³/m.test(log), 'kontrola díl komponenty: výpis patří komponentě (' + line(log, /^Kontrola[^\n]*/m).slice(0, 80) + ')');

  // ── knihovní šroub ISO 4762 v průchozí díře: bez prstence pod hlavou, jen šroub v závitu ──
  log = await run(`nový díl Horní
kvádr 60 40 10
díra 11 skrz v 20 20 10
nový díl Spodní
kvádr 60 40 30
díra 8,5 hloubka 25 v 20 20 30 závit M10
nová sestava Šroubový spoj
vložit "Spodní" ukotvit
vložit "Horní" v 0 0 30
normálie M10x30 v 20 20 40
kolize`);
  ok(!bad(log).length && /^kolize: 1 – šroub v závitu 1, skutečné 0$/m.test(log) && !/⚠ řádek 11/.test(log), 'ISO 4762 M10×30 v průchozí díře Ø11: jen šroub v závitu (' + line(log, /^kolize:[^\n]*/m) + ')');
  // průchozí díra: vstup na straně polohy prvku
  log = await run('nový díl Bok\nkvádr 40 10 40\ndíra 8,5 skrz v 20 0 20 směr 0 1 0 závit M10\nkontrola polohy');
  ok(/M10 skrz · Ø8,5 skrz · směr \+Y · polohy \[20; 0; 20\]/.test(log), 'průchozí závitová díra: směr +Y, vstup [20; 0; 20] (' + line(log, /^ {2}M10[^\n]*/m) + ')');
  await p.screenshot({ path: S + 'check-compare.png' });
  ok(!errs.length, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
