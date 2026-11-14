// E2E: korpus parity enginu (CAD-HEADLESS-NAVRH.md kap. 2.4, balík B2). Každý skript `src/cad/engine/__corpus__/*.txt`
// běží v čerstvém kontextu prohlížeče (prázdné úložiště, jedna záložka „Nový díl“) přes `window.mncad.run` – běh po běhu
// (oddělovač `#--- run`). Výstup = protokol konzole `runAgentText` po normalizaci (e2e/lib/engine-parity.cjs).
//   PARITY_MODE=capture  … zapíše zlaté snímky `__corpus__/golden/<skript>.txt` (commit 1: dnešní smyčka v cad-app.tsx)
//   (výchozí) compare    … porovná se zlatými snímky (po přesunu smyčky do engine/run.ts musí být shoda 100 %)
//   PARITY_ONLY=<regex>  … jen vybrané skripty; PARITY_JOBS=2 … dva kontexty souběžně
// Mezi běhy skriptu se počká na vykreslení; u sestavy s komponentami, až stav uvede objem Σ (díly načtené – dnešní stav
// sestavy bere objem z mezipaměti aplikace, kterou plní efekt po vykreslení).
// Korpus smlouvy B2 `__corpus__/cross/*.txt` (víc běhů nad týmž prostorem) se porovná s výstupem enginu v Node
// (cross/golden, zapisuje parity.test.ts s CROSS_UPDATE=1): prohlížeč = Node, včetně seznamu záložek na konci.
// Spuštění: E2E_BASE=http://localhost:3214 node e2e/cad-engine-parity.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const P = require('./lib/engine-parity.cjs');

const S = (process.argv[2] || '/tmp/e2e-parity').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const MODE = process.env.PARITY_MODE === 'capture' ? 'capture' : 'compare';
const JOBS = Math.max(1, Math.min(4, Number(process.env.PARITY_JOBS) || 1));

async function runScript(browser, sc) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
    const c = p.getByText('Pokračovat v práci');
    if (await c.isVisible({ timeout: 3000 }).catch(() => false)) await c.click();
    await p.waitForFunction(() => !!window.mncad && document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
    await p.waitForTimeout(500);
    const outs = [];
    for (const text of sc.runs) {
      outs.push(await p.evaluate((t) => window.mncad.run(t), text));
      await p.waitForTimeout(600);
      // sestava: počkat, až aplikace načte díly komponent (stav s objemem Σ), ať další běh nevidí rozpracovanou mezipaměť
      await p
        .waitForFunction(async () => {
          const d = window.mncad.getDocument();
          if (d.kind !== 'assembly' || !(d.components || []).length) return true;
          return /objem Σ/.test(await window.mncad.status());
        }, null, { timeout: 60000, polling: 500 })
        .catch(() => undefined);
    }
    return { out: P.joinRuns(outs), errs };
  } finally {
    await ctx.close();
  }
}

/** skript korpusu cross v čerstvém kontextu: běhy přes window.mncad.run (mezi nimi jen vykreslení), pak záložky bez výkresů */
async function runCross(browser, sc) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
    const c = p.getByText('Pokračovat v práci');
    if (await c.isVisible({ timeout: 3000 }).catch(() => false)) await c.click();
    await p.waitForFunction(() => !!window.mncad && document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
    await p.waitForTimeout(500);
    const outs = [];
    for (const text of sc.runs) {
      outs.push(await p.evaluate((t) => window.mncad.run(t), text));
      await p.waitForTimeout(600);
    }
    const tabs = await p.evaluate(() => window.mncad.tabs().filter((t) => t.kind !== 'drawing').map((t) => t.title));
    return { out: P.joinCross(outs, tabs), errs };
  } finally {
    await ctx.close();
  }
}

/** smlouva B2 mimo zlaté snímky (zamýšlené změny chování): dokumenty běhu nepřepíší záložku, jedna záložka na dokument, `otevřít` */
async function contract(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 3000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  const run = (t) => p.evaluate((x) => window.mncad.run(x), t);
  const tabs = () => p.evaluate(() => window.mncad.tabs().map((t) => t.title));
  await run('nová sestava Prázdná S\nnový díl A1\nkvádr 1 1 1\nnový díl B1\nkvádr 2 2 2');
  await p.waitForTimeout(800);
  let t = await tabs();
  ok(['Prázdná S', 'A1', 'B1'].every((x) => t.includes(x)), `dokument běhu nepřepíše záložku – prázdná sestava zůstala (5.2 č. 14): ${t.join(', ')}`);
  await run('nový díl X1\nkvádr 1 1 1\nvýkres\nválec 2 2');
  await p.waitForTimeout(1500);
  t = await tabs();
  ok(t.filter((x) => x === 'X1').length === 1, `nový dokument = jedna záložka i po zápisu uprostřed běhu (výkres) a dalších změnách: ${t.join(', ')}`);
  const doc = await p.evaluate(() => window.mncad.getDocument());
  ok(doc.name === 'X1' && doc.features.map((f) => f.type).join(',') === 'box,cylinder', `X1 má kvádr i válec: ${doc.features.map((f) => f.type).join(',')}`);
  const o = await run('otevřít "nic.mncad"');
  ok(/^✗ řádek 1: soubor „nic\.mncad“ není k dispozici – dostupné: —$/m.test(o), 'otevřít "soubor" v prohlížeči bez přiloženého souboru: ✗ s kódem file.missing');
  // window.mncad.status() = týž výpočet jako `stav` (díly sestavy postavené, stav vazeb a kolize podle dokumentu) – hned po běhu
  await run('nový díl P1\nkvádr 10 10 10\nnový díl P2\nválec 5 20\nnová sestava S\nvložit "P1" ukotvit\nvložit "P2" v 20 0 0');
  const st = await p.evaluate(() => window.mncad.status());
  const stav = await run('stav');
  const asmLine = (t) => (t.match(/^Sestava: .*$/m) || [''])[0];
  ok(/objem Σ [\d ,]+ cm³ · hmotnost Σ/.test(asmLine(st)) && asmLine(st) === asmLine(stav), `mncad.status() hned po běhu = stav (objem Σ, hmotnost Σ): ${asmLine(st)} | ${asmLine(stav)}`);
  ok(errs.length === 0, 'smlouva B2 bez JS chyb ' + errs.join(' | '));
  await ctx.close();
}

(async () => {
  const corpus = P.listCorpus(process.env.PARITY_ONLY);
  const cross = P.listCross(process.env.PARITY_ONLY);
  ok(corpus.length + cross.length > 0, `korpus: ${corpus.length} skriptů (${MODE}), korpus cross: ${cross.length}`);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const t0 = Date.now();
  let same = 0;
  let deltas = 0;
  const queue = [...corpus];
  const worker = async () => {
    for (let sc = queue.shift(); sc; sc = queue.shift()) {
      const t1 = Date.now();
      let res;
      try {
        res = await runScript(b, sc);
      } catch (e) {
        ok(false, `${sc.name}: běh selhal – ${e.message}`);
        continue;
      }
      const norm = P.normalize(res.out);
      fs.writeFileSync(path.join(S, sc.name + '.raw.txt'), res.out);
      fs.writeFileSync(path.join(S, sc.name + '.txt'), norm + '\n');
      const secs = ((Date.now() - t1) / 1000).toFixed(1);
      if (res.errs.length) ok(false, `${sc.name}: JS chyby ${res.errs.join(' | ')}`);
      if (MODE === 'capture') {
        P.writeGolden(sc.name, norm);
        ok(true, `${sc.name}: zlatý snímek ${norm.split('\n').length} řádků (${secs} s)`);
        continue;
      }
      const g = P.readGolden(sc.name);
      if (g === null) {
        ok(false, `${sc.name}: chybí zlatý snímek`);
        continue;
      }
      const cmp = P.compare(g, norm);
      if (cmp.ok) same++;
      deltas += cmp.deltas;
      ok(cmp.ok, `${sc.name}: parita ${cmp.ok ? (g === norm ? 'shoda' : `shoda + ${cmp.deltas} zamýšlený rozdíl stavu sestavy (díly postavené před stavem)`) : 'ROZDÍL'} (${secs} s)` + (cmp.ok ? '' : '\n' + cmp.text));
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  if (MODE === 'compare' && !process.env.PARITY_ONLY) await contract(b);
  // smlouva B2: prohlížeč = Node na korpusu cross (zlaté snímky z Node)
  let crossSame = 0;
  if (MODE === 'compare')
    for (const sc of cross) {
      const t1 = Date.now();
      let res;
      try {
        res = await runCross(b, sc);
      } catch (e) {
        ok(false, `cross ${sc.name}: běh selhal – ${e.message}`);
        continue;
      }
      const norm = P.normalize(res.out);
      fs.writeFileSync(path.join(S, sc.name + '.cross.txt'), norm + '\n');
      if (res.errs.length) ok(false, `cross ${sc.name}: JS chyby ${res.errs.join(' | ')}`);
      const g = P.readCrossGolden(sc.name);
      const same = g !== null && g === norm;
      if (same) crossSame++;
      ok(same, `cross ${sc.name}: prohlížeč ${same ? '= Node' : '≠ Node'} (${((Date.now() - t1) / 1000).toFixed(1)} s)` + (same || g === null ? '' : '\n' + P.diffText(g, norm)));
    }
  await b.close();
  if (MODE === 'compare' && corpus.length) ok(same === corpus.length, `parita prohlížeče ${same}/${corpus.length} (${(100 * same / corpus.length).toFixed(0)} %), zamýšlených rozdílů stavu sestavy ${deltas}, za ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (MODE === 'compare' && cross.length) ok(crossSame === cross.length, `smlouva B2 prohlížeč = Node: ${crossSame}/${cross.length} skriptů korpusu cross`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
