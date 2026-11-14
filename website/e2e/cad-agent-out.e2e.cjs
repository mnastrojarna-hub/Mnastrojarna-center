// E2E: agent, který má jen textovou konzoli a klikání v prohlížeči BEZ WebGL, dokončí celou práci v CADu bez systémových oken
// (vlna 11, balík out – polní hlášení: „Ukládání se zastavilo na dialogu názvu souboru…“):
//  - konzole (psaní + Provést): model, `uložit`, `export step` (kontrola STEP v protokolu), `výkres A3`, `kótovat`,
//    `výkres export pdf`, `skica export dxf`, `sdílet` (adresa v protokolu) a `odkaz` → stažení (událost download)
//  - STEP ze stažení se v jiné kartě znovu otevře se stejným objemem; sdílený odkaz otevře model v nové kartě
//  - window.mncad.run vrací tytéž řádky, window.mncad.save(název) uloží projekt
//  - klik na Uložit projekt, Ctrl+S a Soubor ▸ STEP AP214 → stažení BEZ dialogu; Smazat těleso → potvrzení na stránce
//    ([data-ask="confirm"], Esc = zrušit, OK = smazat)
//  - člověk (navigator.webdriver = false): Uložit projekt dál otevírá systémový dialog „Uložit jako“; s ?agent=1 přímé stažení
//  - page.on('dialog') nesmí vystřelit nikdy (žádné window.prompt / confirm / alert / beforeunload)
//  - revize: DE „teilen XY“ = rozdělení těles (ne sdílení); potvrzení smazání maže nad aktuálním dokumentem (co přibylo,
//    zatímco bylo otevřené, zůstane); dvě rychlá Delete = jedno potvrzení; „sdílet“ s odmítnutou schránkou nechá fokus
//    v konzoli; Tisk v automatizaci = PDF bez dialogu tisku; „výkres export pdf 2“ = list 2; export step: kontrola bez
//    sítě (rychlá), opakovaná z paměti, „bez kontroly“; člověk: „uložit“ z konzole = nic neuloženého (žádný beforeunload);
//    ?agent=1 přežije přepnutí jazyka i přechod na adresu bez příznaku
//  - vlna 16: s úložištěm sdílení (skutečné PHP `php -S`, požadavky na /cad/share/ přesměrované jako u cad-w8-share) vypíše
//    `sdílet` NEJKRATŠÍ odkaz <web>/s#<KÓD 10 znaků> + kód po skupinách; `odkaz` ho zopakuje; odkaz se otevře v nové kartě
//    (bez příkazu php se tato část přeskočí)
// Spuštění: E2E_BASE=http://localhost:3361 node e2e/cad-agent-out.e2e.cjs <složka pro výstupy>   (výchozí server :3100)
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-out').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const ready = async (p, url = CAD) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};
const volumeOf = (status) => { const m = /objem ([\d\s  ]+,\d+) cm³/.exec(status); return m ? parseFloat(m[1].replace(/[\s  ]/g, '').replace(',', '.')) : NaN; };

(async () => {
  // ════════════ A) agent bez WebGL: konzole + klikání ════════════
  {
    const b = await chromium.launch({ args: NO_GL });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const dialogs = [];
    const errs = [];
    const dl = [];
    p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('download', (d) => dl.push(d));
    /** čeká na n-té stažení (od začátku testu) a uloží ho */
    const nextDownload = async (n, ms = 180000) => {
      const t0 = Date.now();
      while (dl.length < n && Date.now() - t0 < ms) await p.waitForTimeout(200);
      const d = dl[n - 1];
      if (!d) return null;
      const path = S + d.suggestedFilename();
      await d.saveAs(path);
      return { name: d.suggestedFilename(), path, bytes: fs.statSync(path).size };
    };
    await ready(p);
    ok((await p.evaluate(() => navigator.webdriver)) === true, 'navigator.webdriver = true (prohlížeč ovládá automatizace)');
    ok(await p.evaluate(() => { try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch { return true; } }), 'WebGL není k dispozici (jako v polním hlášení)');

    // ── konzole: psaní + Provést ──
    await p.keyboard.press('Control+Shift+K');
    const input = p.getByLabel('Textové příkazy nebo JSON');
    if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) await p.evaluate(() => window.mncad.openConsole());
    await input.waitFor({ timeout: 20000 });
    const out = p.locator('[data-agent-output]');
    const consoleRun = async (text, ms = 240000) => {
      const before = await out.innerText().catch(() => '');
      await input.fill(text);
      await p.getByRole('button', { name: 'Provést', exact: true }).click();
      await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
      return out.innerText();
    };
    let log = await consoleRun('nový díl Konzola\nskica XY: obdélník 80 50\nvysunout 12\ndíra 8 skrz v -20 0\ndíra 8 skrz v 20 0\nzaoblit 3 hrany svislé');
    ok(/✓ Díra 1/.test(log) && /✓ Díra 2/.test(log) && /✓ Zaoblení 1/.test(log) && !/^[⚠✗]/m.test(log), 'konzole: model (skica, vysunutí, 2 díry, zaoblení) bez ⚠ / ✗');
    const status0 = await p.evaluate(() => window.mncad.status());
    const vol0 = volumeOf(status0);
    ok(vol0 > 40 && vol0 < 47.6, `objem modelu ${vol0} cm³`);

    log = await consoleRun('uložit\nexport step');
    const f1 = await nextDownload(1);
    const f2 = await nextDownload(2);
    ok(f1 && f1.name === 'Konzola.mncad' && f1.bytes > 200, `uložit → stažení ${f1 && f1.name} (${f1 && f1.bytes} B)`);
    ok(/✓ uloženo: Konzola\.mncad · [\d,]+ kB · projekt Mnástrojárna CAD \(\.mncad\) – staženo \(bez dialogu\)/.test(log), 'protokol: název, velikost, formát projektu');
    ok(/✓ kontrola: projekt jde znovu otevřít – „Konzola“, 5 prvků/.test(log), 'protokol: kontrola projektu (5 prvků)');
    const proj = f1 ? JSON.parse(fs.readFileSync(f1.path, 'utf8')) : null;
    ok(proj && proj.app === 'mnastrojarna-cad' && proj.features.length === 5, 'stažený .mncad je platný projekt s 5 prvky');
    ok(f2 && f2.name === 'Konzola.step' && f2.bytes > 5000, `export step → stažení ${f2 && f2.name} (${f2 && f2.bytes} B)`);
    ok(f2 && fs.readFileSync(f2.path, 'utf8').startsWith('ISO-10303-21;'), 'STEP začíná hlavičkou ISO-10303-21');
    ok(/✓ export STEP: Konzola\.step · [\d,]+ kB · STEP AP214 – staženo \(bez dialogu\)/.test(log), 'protokol: název, velikost, formát STEP');
    const chk = /✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem ([^(]+) \(rozdíl ([\d,]+) %\), obálka ([^m]+) mm \(odchylka ([\d,]+) mm\) → věrná kopie modelu/.exec(log);
    ok(!!chk, `protokol: kontrola STEP → věrná kopie (${chk ? chk.slice(1).join(' | ') : log.split('\n').filter((l) => /kontrola/.test(l)).join(' / ')})`);
    await p.screenshot({ path: S + 'out-console.png' });

    // ── výkres a skica ──
    log = await consoleRun('výkres A3\nkótovat\nvýkres export pdf\nskica export dxf');
    const f3 = await nextDownload(3);
    const f4 = await nextDownload(4);
    ok(f3 && /\.pdf$/.test(f3.name) && fs.readFileSync(f3.path).subarray(0, 5).toString() === '%PDF-', `výkres export pdf → ${f3 && f3.name} (${f3 && f3.bytes} B, %PDF)`);
    ok(/✓ výkres PDF: \S+\.pdf · [\d,]+ kB · výkres PDF – staženo \(bez dialogu\)/.test(log), 'protokol: výkres PDF s názvem a velikostí');
    ok(f4 && f4.name === 'Skica_1.dxf' && fs.readFileSync(f4.path, 'utf8').includes('SECTION'), `skica export dxf → ${f4 && f4.name}`);
    ok(/✓ skica „Skica 1“: Skica_1\.dxf · [\d,]+ (B|kB) · skica DXF, 1 entit/.test(log), 'protokol: skica DXF');

    // ── sdílet + odkaz ──
    log = await consoleRun('sdílet');
    const url = (/^URL: (\S+)$/m.exec(log) || [])[1] || '';
    ok(url.startsWith(CAD + '#s=1d.'), `sdílet → adresa v protokolu (${url.length} znaků)`);
    ok(/✓ sdílený odkaz vytvořen – „Konzola“ \(model\), platí do: .+, bez hesla, .+ v odkazu/.test(log), 'protokol: platnost, heslo, velikost');
    ok(/\(zkopírováno do schránky\)|\(schránka není dostupná/.test(log), 'schránka: zkopírováno, nebo jen poznámka (nikdy se nečeká)');
    log = await consoleRun('odkaz');
    ok(log.includes('URL: ' + url) && /✓ poslední sdílený odkaz/.test(log), 'odkaz → vypíše poslední odkaz znovu');
    log = await consoleRun('sdílet výkres dní 7 heslo tajne');
    ok(/#s=1dp\./.test(log) && /\(výkres\)/.test(log) && /s heslem/.test(log), 'sdílet výkres dní 7 heslo … → odkaz s heslem na výkres');
    await p.screenshot({ path: S + 'out-share-log.png' });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);

    // ── STEP ze stažení znovu otevřený v nové záložce (jedna karta prohlížeče – šetří paměť) ──
    const b64 = fs.readFileSync(f2.path).toString('base64');
    const imp = await p.evaluate(({ name, base64 }) => window.mncad.importFile({ name, base64 }, { as: 'tab' }), { name: f2.name, base64: b64 });
    const vol1 = volumeOf(imp);
    ok(Math.abs(vol1 - vol0) <= 0.01, `STEP ze stažení se znovu otevře se stejným objemem (${vol1} cm³ = ${vol0} cm³)`);
    await p.evaluate(() => window.mncad.closeTab());
    await p.waitForTimeout(800);

    // ── window.mncad: run vrací řádky, save(název) ──
    await p.evaluate(() => window.mncad.activateTab('Konzola'));
    await p.waitForTimeout(800);
    const n0 = dl.length;
    const runLog = await p.evaluate(() => window.mncad.run('export brep'));
    const f5 = await nextDownload(n0 + 1);
    ok(f5 && f5.name === 'Konzola.brep' && /✓ export BREP: Konzola\.brep/.test(runLog) && /✓ kontrola BREP: .* věrná kopie modelu/.test(runLog), `window.mncad.run('export brep') vrací řádky protokolu i kontrolu (${f5 && f5.name})`);
    const saved = await p.evaluate(() => window.mncad.save('API projekt'));
    const f6 = await nextDownload(n0 + 2);
    ok(saved.name === 'API projekt.mncad' && saved.bytes > 200 && saved.format === 'mncad' && saved.log[0].startsWith('✓ uloženo: API projekt.mncad'), `window.mncad.save('API projekt') → ${JSON.stringify({ name: saved.name, bytes: saved.bytes })}`);
    ok(f6 && f6.name === 'API projekt.mncad', 'save → stažení pod zadaným názvem');
    const bad = await p.evaluate(() => window.mncad.run('export pdf\nsdílet nesmysl'));
    ok(/✗ řádek 1: export pdf: výkres se exportuje příkazem „výkres export pdf“/.test(bad) && /✗ řádek 2: sdílet: neznámé slovo „nesmysl“/.test(bad), 'chybný zápis → ✗ se správným zápisem');

    // ── GUI: Uložit projekt, Ctrl+S, Export ▸ STEP – stažení bez dialogu ──
    const n1 = dl.length;
    await p.getByRole('button', { name: 'Uložit projekt (Ctrl+S)' }).click();
    const g1 = await nextDownload(n1 + 1, 30000);
    ok(g1 && g1.name === 'Konzola.mncad', `klik Uložit projekt → stažení bez dialogu (${g1 && g1.name})`);
    await p.locator('canvas, [data-viewport]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press('Control+s');
    const g2 = await nextDownload(n1 + 2, 30000);
    ok(g2 && g2.name === 'Konzola.mncad', `Ctrl+S → stažení bez dialogu (${g2 && g2.name})`);
    await p.getByRole('button', { name: 'Soubor', exact: true }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /STEP AP214 \(\.step\)/ }).first().click();
    const g3 = await nextDownload(n1 + 3, 120000);
    ok(g3 && g3.name === 'Konzola.step' && g3.bytes > 5000, `Soubor ▸ STEP AP214 → stažení bez dialogu (${g3 && g3.name}, ${g3 && g3.bytes} B)`);

    // ── Smazat těleso: potvrzení na stránce, ne window.confirm ──
    await p.keyboard.press('Escape');
    await p.evaluate(() => window.mncad.select(['těleso']));
    await p.waitForTimeout(500);
    await p.keyboard.press('Delete');
    const ask = p.locator('[data-ask="confirm"]');
    ok(await ask.isVisible({ timeout: 5000 }).catch(() => false), 'Delete s vybraným tělesem → potvrzení na stránce [data-ask="confirm"]');
    ok(/Smazat celé těleso/.test(await p.locator('[data-ask-title]').innerText().catch(() => '')), 'potvrzení má nadpis [data-ask-title]');
    ok(await p.evaluate(() => document.activeElement?.hasAttribute('data-ask-ok')), 'fokus je na OK (Enter = potvrdit)');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    ok(!(await ask.isVisible().catch(() => false)) && (await p.evaluate(() => window.mncad.getDocument().features.length)) === 5, 'Esc → zrušeno, těleso zůstalo');
    await p.evaluate(() => window.mncad.select(['těleso']));
    await p.waitForTimeout(300);
    await p.keyboard.press('Delete');
    await ask.waitFor({ timeout: 5000 });
    await p.locator('[data-ask-ok]').click();
    await p.waitForTimeout(600);
    ok((await p.evaluate(() => window.mncad.getDocument().features.length)) === 0, 'OK → těleso smazáno');
    await p.evaluate(() => window.mncad.undo());
    ok((await p.evaluate(() => window.mncad.getDocument().features.length)) === 5, 'zpět → těleso obnoveno');

    // ── zavření karty s neuloženými změnami: žádný dotaz beforeunload ──
    await p.evaluate(() => window.mncad.run('kvádr 5 5 5 v 0 0 12'));
    await p.close({ runBeforeUnload: true });
    await new Promise((res) => setTimeout(res, 1500));

    // ── příjemce: sdílený odkaz z protokolu v nové kartě ──
    const r2 = await ctx.newPage();
    r2.on('dialog', (d) => { dialogs.push(`(příjemce) ${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    r2.on('pageerror', (e) => errs.push(e.message));
    await r2.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
    await r2.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
    await r2.waitForFunction(() => window.mncad.getDocument().name === 'Konzola', null, { timeout: 60000 }).catch(() => {});
    await r2.waitForTimeout(2500);
    const shared = await r2.evaluate(() => window.mncad.getDocument());
    ok(shared.name === 'Konzola' && shared.features.length === 5, `odkaz z protokolu otevře model v nové kartě („${shared.name}“, ${shared.features.length} prvků)`);
    ok(Math.abs(volumeOf(await r2.evaluate(() => window.mncad.status())) - vol0) <= 0.01, 'sdílený model má stejný objem');
    await r2.screenshot({ path: S + 'out-recipient.png' });
    await r2.close();
    ok(dialogs.length === 0, `za celý test žádné systémové okno (page.on('dialog')): ${dialogs.join(' | ') || '0'}`);
    ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
    await b.close();
  }

  // ════════════ B) člověk (webdriver = false): systémový dialog zůstává; ?agent=1 = přímé stažení ════════════
  {
    const b = await chromium.launch({ args: [...NO_GL, '--disable-blink-features=AutomationControlled'] });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const dialogs = [];
    const dl = [];
    p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    p.on('download', (d) => dl.push(d.suggestedFilename()));
    await ready(p);
    ok((await p.evaluate(() => navigator.webdriver)) === false, 'navigator.webdriver = false (prohlížeč jako u člověka)');
    await p.evaluate(() => window.mncad.run('nový díl Clovek\nkvádr 20 20 5'));
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      window.__pick = 0;
      const o = window.showSaveFilePicker;
      if (o) window.showSaveFilePicker = (...a) => { window.__pick++; return o.apply(window, a); };
    });
    await p.getByRole('button', { name: 'Uložit projekt (Ctrl+S)' }).click();
    await p.waitForTimeout(3000);
    ok((await p.evaluate(() => window.__pick)) === 1 && dl.length === 0, 'člověk: Uložit projekt otevře systémový dialog „Uložit jako“ (File System Access), nic se nestáhne samo');
    // dotaz při zavření karty: obsluha beforeunload volaná přímo (bez systémového okna) – neuložená práce → dotaz by byl
    const wouldAsk = () => p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    ok((await wouldAsk()) === true, 'člověk: neuložená práce → zavření karty by se zeptalo (beforeunload)');
    await p.evaluate(() => window.mncad.run('uložit'));
    await p.waitForTimeout(1500);
    ok(dl.includes('Clovek.mncad'), 'člověk: příkaz „uložit“ z konzole stahuje přímo (bez dialogu)');
    ok((await wouldAsk()) === false, 'revize: po „uložit“ z konzole není nic neuloženého – zavření karty se neptá');
    await p.evaluate(() => window.mncad.run('kvádr 5 5 5 v 0 0 5\nuložit\nkvádr 4 4 4 v 0 0 10'));
    await p.waitForTimeout(1500);
    ok((await wouldAsk()) === true, 'změna po „uložit“ v témže vstupu → zase neuložené (dotaz by byl)');
    await p.evaluate(() => window.mncad.run('uložit'));
    await p.waitForTimeout(1000);
    const nDlg = dialogs.length;
    await p.close({ runBeforeUnload: true });
    await new Promise((res) => setTimeout(res, 1500));
    ok(dialogs.length === nDlg, 'revize: zavření karty po „uložit“ z konzole → žádný dotaz beforeunload');
    // ?agent=1 – příznak v adrese pro automatizaci, která webdriver nenastavuje (nová karta: odchod z karty s neuloženou
    // prací by člověku správně položil dotaz beforeunload)
    const q = await ctx.newPage();
    q.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    q.on('download', (d) => dl.push(d.suggestedFilename()));
    await ready(q, CAD + '?agent=1');
    await q.evaluate(() => window.mncad.run('nový díl Agent\nkvádr 20 20 5'));
    await q.waitForTimeout(1500);
    await q.evaluate(() => {
      window.__pick = 0;
      const o = window.showSaveFilePicker;
      if (o) window.showSaveFilePicker = (...a) => { window.__pick++; return o.apply(window, a); };
    });
    const before = dl.length;
    await q.getByRole('button', { name: 'Uložit projekt (Ctrl+S)' }).click();
    const t0 = Date.now();
    while (dl.length === before && Date.now() - t0 < 20000) await q.waitForTimeout(200);
    ok((await q.evaluate(() => window.__pick)) === 0 && dl[before] === 'Agent.mncad', `?agent=1: Uložit projekt → přímé stažení bez dialogu (${dl[before]})`);
    // revize: přepnutí jazyka v Nastavení (window.location.assign) – režim automatizace zůstane
    const guiSaveNoPicker = async (pg, label, name, wait = 20000) => {
      await pg.evaluate((t) => window.mncad.run(t), `new part ${name}\nbox 20 20 5`);
      await pg.waitForTimeout(1200);
      await pg.evaluate(() => { window.__pick = 0; const o = window.showSaveFilePicker; if (o) window.showSaveFilePicker = (...a) => { window.__pick++; return o.apply(window, a); }; });
      const n = dl.length;
      await pg.getByRole('button', { name: label }).click();
      const t1 = Date.now();
      while (dl.length === n && Date.now() - t1 < wait) await pg.waitForTimeout(200);
      return { pick: await pg.evaluate(() => window.__pick), file: dl[n] };
    };
    await q.keyboard.press('Control+,');
    const en = q.getByRole('button', { name: 'English', exact: true });
    await en.waitFor({ timeout: 10000 });
    await Promise.all([q.waitForURL(/\/en\/cad/, { timeout: 120000 }), en.click()]);
    await ready(q, q.url());
    const r1 = await guiSaveNoPicker(q, 'Save project (Ctrl+S)', 'AgentEn');
    ok(r1.pick === 0 && r1.file === 'AgentEn.mncad', `revize: ?agent=1 po přepnutí jazyka (${new URL(q.url()).pathname}${new URL(q.url()).search}) → Save project stahuje bez dialogu (${r1.file})`);
    // přechod na adresu BEZ příznaku v téže kartě (odkaz, ruční adresa) – karta si režim pamatuje
    await ready(q, BASE + '/de/cad');
    const r2 = await guiSaveNoPicker(q, 'Projekt speichern (Strg+S)', 'AgentDe');
    ok(r2.pick === 0 && r2.file === 'AgentDe.mncad', `revize: /de/cad bez ?agent v téže kartě → stále automatizace, bez dialogu (${r2.file})`);
    // ?agent=0 režim vypne → člověku zase systémový dialog
    await ready(q, CAD + '?agent=0');
    const r3 = await guiSaveNoPicker(q, 'Uložit projekt (Ctrl+S)', 'Off', 3000);
    ok(r3.pick === 1, `?agent=0 vypne zapamatovaný režim → systémový dialog Uložit jako (${r3.pick}×)`);
    ok(dialogs.length === 0, `B: žádné systémové okno: ${dialogs.join(' | ') || '0'}`);
    await b.close();
  }

  // ════════════ C) revize: nálezy oponentury (automatizace bez WebGL) ════════════
  {
    const b = await chromium.launch({ args: NO_GL });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const dialogs = [];
    const errs = [];
    const dl = [];
    p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('download', (d) => dl.push(d.suggestedFilename()));
    await ready(p);
    const run = (t) => p.evaluate((x) => window.mncad.run(x), t);
    const names = () => p.evaluate(() => window.mncad.getDocument().features.map((f) => f.name));
    const waitDl = async (n, ms = 60000) => { const t0 = Date.now(); while (dl.length < n && Date.now() - t0 < ms) await p.waitForTimeout(200); return dl[n - 1]; };

    // 1) DE „teilen“ = rozdělit tělesa, ne sdílet
    let log = await run('nový díl Teil3\nkvádr 40 20 10\nteilen XY');
    const types = await p.evaluate(() => window.mncad.getDocument().features.map((f) => f.type));
    ok(types.includes('splitBodies') && !/sdílet|URL:/.test(log), `revize: „teilen XY“ → rozdělení těles (${types.join(', ')}), žádný odkaz`);
    log = await run('freigeben');
    ok(/^URL: /m.test(log), 'DE „freigeben“ → sdílený odkaz s adresou v protokolu');

    // 2) potvrzení smazání nad aktuálním dokumentem (změna během otevřeného dotazu se neztratí)
    await run('nový díl Stale\nkvádr 30 20 10\nválec 10 20 v 15 10 10');
    await p.evaluate(() => window.mncad.setSettings({ confirmDelete: true }));
    await p.waitForTimeout(400);
    await p.evaluate(() => window.mncad.select(['feature:Válec 1']));
    await p.waitForTimeout(300);
    await p.keyboard.press('Delete');
    const ask = p.locator('[data-ask="confirm"]');
    await ask.waitFor({ timeout: 5000 });
    await run('díra 5 skrz v 5 5'); // agent pokračuje přes API, zatímco je dotaz otevřený
    ok((await names()).join(',') === 'Kvádr 1,Válec 1,Díra 1', 'během otevřeného potvrzení přibyla Díra 1');
    await p.locator('[data-ask-ok]').click();
    await p.waitForTimeout(800);
    ok((await names()).join(',') === 'Kvádr 1,Díra 1', `revize: OK smaže jen Válec 1, Díra 1 zůstane (${(await names()).join(', ')})`);

    // 3) dvě rychlá Delete = jedno potvrzení
    await run('nový díl Smaz\nkvádr 30 20 10');
    await p.evaluate(() => window.mncad.select(['těleso']));
    await p.waitForTimeout(300);
    await p.keyboard.press('Delete');
    await p.keyboard.press('Delete');
    await ask.waitFor({ timeout: 5000 });
    ok((await p.locator('[data-ask]').count()) === 1, 'jeden dotaz na stránce');
    await p.locator('[data-ask-ok]').click();
    await p.waitForTimeout(900);
    ok(!(await ask.isVisible().catch(() => false)), 'revize: dvě rychlá Delete → po OK žádné další (zdvojené) potvrzení');
    ok((await names()).length === 0, 'těleso smazáno jednou');
    await p.evaluate(() => window.mncad.setSettings({ confirmDelete: false }));

    // 4) „sdílet“ s odmítnutou schránkou – fokus zůstane v konzoli, další psaný příkaz jde do konzole
    await run('nový díl Fokus\nkvádr 30 20 10');
    await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')); });
    await p.keyboard.press('Control+Shift+K');
    const input = p.getByLabel('Textové příkazy nebo JSON');
    await input.waitFor({ timeout: 20000 });
    const out = p.locator('[data-agent-output]');
    const typeRun = async (text) => {
      const before = await out.innerText().catch(() => '');
      await input.click();
      await input.fill(text);
      await p.keyboard.press('Control+Enter');
      await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); return !!o && o.textContent !== prev && ![...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); }, before, { timeout: 120000 });
      await p.waitForTimeout(400);
    };
    await typeRun('sdílet');
    // Clipboard API odmítnuto → záložní kopírování (skryté pole + execCommand), které si na chvíli vezme fokus
    ok(/^URL: /m.test(await out.innerText()) && /\((zkopírováno do schránky|schránka není dostupná)/.test(await out.innerText()), 'Clipboard API odmítnuto → adresa v protokolu, záložní kopírování');
    ok((await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Textové příkazy nebo JSON', 'revize: po „sdílet“ (záložní kopírování) má fokus dál konzole');
    await input.fill('');
    await p.keyboard.type('odkaz');
    ok((await input.inputValue()) === 'odkaz', 'další psaný příkaz skončí v konzoli');
    await p.keyboard.press('Control+Enter');
    await p.waitForTimeout(800);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);

    // 5) export step: kontrola bez sítě (rychlá), opakovaná z paměti, „bez kontroly“
    await run('nový díl Tezky\nkvádr 200 200 10 v 0 0 0\ndíra 3 skrz v 5 5\npole 18 rozteč 10 směr X 18 rozteč 10 směr Y');
    await p.waitForTimeout(800);
    let t0 = Date.now();
    await p.evaluate(() => window.mncad.exportFile('step'));
    const tApi = Date.now() - t0;
    let n = dl.length;
    t0 = Date.now();
    log = await run('export step');
    const tCon = Date.now() - t0;
    await waitDl(n + 1);
    ok(/✓ kontrola STEP: .*věrná kopie modelu/.test(log), 'deska 18 × 18 děr: kontrola STEP → věrná kopie');
    ok(tCon < tApi * 4 + 4000, `revize: export step s kontrolou ${tCon} ms (exportFile ${tApi} ms; dřív ~10 s)`);
    t0 = Date.now();
    log = await run('export step');
    const tAgain = Date.now() - t0;
    ok(/věrná kopie modelu \(model od minulé kontroly beze změny\)/.test(log) && tAgain < tCon + 500, `opakovaný export nezměněného modelu: kontrola z paměti (${tAgain} ms)`);
    log = await run('export step Deska bez kontroly');
    ok(/✓ export STEP: Deska\.step/.test(log) && /kontrola STEP vynechána/.test(log), '„export step … bez kontroly“ → soubor bez kontroly, řečeno v protokolu');

    // 6) výkres: holé číslo = list, Tisk v automatizaci = PDF bez dialogu tisku
    log = await run('výkres A3\nkótovat');
    log = await run('výkres export pdf 2');
    ok(/✗ řádek 1: list 2 neexistuje/.test(log) && !dl.includes('2.pdf'), 'revize: „výkres export pdf 2“ = list 2 (neexistuje → ✗, žádný soubor „2.pdf“)');
    n = dl.length;
    log = await run('výkres export pdf 1');
    ok(/✓ výkres PDF, list 1: Tezky_vykres\.pdf/.test(log) && (await waitDl(n + 1)) === 'Tezky_vykres.pdf', '„výkres export pdf 1“ → list 1 v protokolu');
    const tisk = p.getByRole('button', { name: 'Tisk', exact: true });
    if (!(await tisk.isVisible({ timeout: 5000 }).catch(() => false))) await p.evaluate(() => window.mncad.run('výkres'));
    n = dl.length;
    // tisk jde přes skrytý rámec (iframe.contentWindow.print) – sledovat, jestli nějaký vznikne
    await p.evaluate(() => { window.__frames = 0; new MutationObserver((ms) => { for (const m of ms) for (const x of m.addedNodes) if (x.nodeName === 'IFRAME') window.__frames++; }).observe(document.body, { childList: true }); });
    await tisk.click({ timeout: 20000 });
    const pdf = await waitDl(n + 1, 60000);
    ok(pdf === 'Tezky_vykres.pdf', `revize: Tisk v automatizaci → PDF bez dialogu tisku (${pdf})`);
    ok((await p.evaluate(() => window.__frames)) === 0, 'žádný tiskový rámec (iframe.print) nevznikl');

    ok(dialogs.length === 0, `C: žádné systémové okno: ${dialogs.join(' | ') || '0'}`);
    ok(errs.length === 0, 'C: bez JS chyb ' + errs.join(' | '));
    await b.close();
  }

  // ════════════ D) vlna 16: konzole s úložištěm sdílení → nejkratší odkaz <web>/s#<KÓD> ════════════
  if (spawnSync('php', ['-v'], { stdio: 'ignore' }).status === 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-out-share-'));
    const docroot = path.join(root, 'www');
    fs.mkdirSync(path.join(docroot, 'cad', 'share'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'public', 'cad', 'share', 'index.php'), path.join(docroot, 'cad', 'share', 'index.php'));
    const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
    const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { stdio: 'ignore' });
    const phpOrigin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 200; i++) { try { if ((await fetch(phpOrigin + '/cad/share/?ping')).ok) break; } catch { /* start */ } await new Promise((r) => setTimeout(r, 50)); }
    const isShare = (url) => new URL(url).pathname.startsWith('/cad/share/');
    /** požadavky prohlížeče na /cad/share/ → PHP server (Origin přepíše na adresu PHP, jako reverzní proxy se stejným Host) */
    const forward = async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const headers = { ...req.headers() };
      for (const h of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[h];
      if (headers.origin) headers.origin = phpOrigin;
      try {
        const res = await fetch(phpOrigin + u.pathname + u.search, { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() || undefined });
        const out = {};
        res.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
        await route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
      } catch { await route.abort('failed').catch(() => {}); }
    };
    const b = await chromium.launch({ args: NO_GL });
    try {
      const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
      await ctx.route(isShare, forward);
      const p = await ctx.newPage();
      const dialogs = [];
      const errs = [];
      p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
      p.on('pageerror', (e) => errs.push(e.message));
      await ready(p);
      await p.keyboard.press('Control+Shift+K');
      const input = p.getByLabel('Textové příkazy nebo JSON');
      if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) await p.evaluate(() => window.mncad.openConsole());
      await input.waitFor({ timeout: 20000 });
      const out = p.locator('[data-agent-output]');
      const consoleRun = async (text, ms = 240000) => {
        const before = await out.innerText().catch(() => '');
        await input.fill(text);
        await p.getByRole('button', { name: 'Provést', exact: true }).click();
        await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
        return out.innerText();
      };
      await consoleRun('nový díl Konzola\nskica XY: obdélník 80 50\nvysunout 12\ndíra 8 skrz v -20 0');
      const CODE = '[1-9A-HJ-NP-Za-km-z]{10}';
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const SHORT = new RegExp('^' + esc(BASE) + '/s#(' + CODE + ')$');
      let log = await consoleRun('sdílet');
      const url = (/^URL: (\S+)$/m.exec(log) || [])[1] || '';
      const code = (SHORT.exec(url) || [])[1] || '';
      ok(!!code && url.length === BASE.length + 13, `D: sdílet → nejkratší odkaz v protokolu: ${url} (${url.length} znaků = adresa serveru + 13; na produkci https://mnastrojarna.cz/s#… = 36)`);
      ok(/✓ sdílený odkaz vytvořen – „Konzola“ \(model\), platí do: .+, bez hesla, .+ v úložišti/.test(log), 'D: protokol: platnost, heslo, velikost, „v úložišti“');
      const grouped = code.replace(/(.{4})(?=.)/g, '$1 ');
      ok(log.includes(`kód k přečtení nebo opsání: ${grouped} (${url.length} znaků odkazu)`), `D: protokol: kód po skupinách „${grouped}“ a délka odkazu`);
      ok(fs.readdirSync(path.join(root, 'cad-share-data')).filter((f) => f.endsWith('.bin')).length === 1 && !fs.readdirSync(path.join(root, 'cad-share-data')).some((f) => f.includes(code)), 'D: na serveru je jeden šifrovaný obsah, kód v názvu souboru není');
      log = await consoleRun('odkaz');
      ok(log.includes('URL: ' + url) && /✓ poslední sdílený odkaz/.test(log) && log.includes(grouped), 'D: odkaz → vypíše poslední krátký odkaz i kód znovu');
      log = await consoleRun('výkres A3\nsdílet výkres dní 7 heslo tajne');
      const urlPw = [...log.matchAll(/^URL: (\S+)$/gm)].map((m) => m[1]).pop() || '';
      ok(SHORT.test(urlPw) && urlPw !== url && /\(výkres\)/.test(log) && /s heslem/.test(log), `D: sdílet výkres dní 7 heslo … → stejně krátký odkaz s heslem (${urlPw.length} znaků)`);
      const api = await p.evaluate(() => window.mncad.share({ days: 1 }));
      ok(SHORT.test(api.url) && api.chars === api.url.length && api.mode === 'self' && api.code === api.url.slice(-10), `D: window.mncad.share() → ${api.url} (chars ${api.chars}, code ${api.code})`);
      // odkaz z protokolu otevře model v nové kartě (přes přesměrování /s → /cad?kod=1; část za # i parametr z adresy zmizí)
      const r = await ctx.newPage();
      await r.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
      await r.waitForFunction(() => !!window.mncad && window.mncad.getDocument().name === 'Konzola', null, { timeout: 240000 }).catch(() => {});
      const shared = await r.evaluate(() => window.mncad.getDocument());
      ok(new URL(r.url()).pathname === '/cad' && !r.url().includes('#') && new URL(r.url()).search === '' && shared.name === 'Konzola' && shared.features.length === 3, `D: krátký odkaz z protokolu otevře model v nové kartě („${shared.name}“, ${shared.features.length} prvků) na ${new URL(r.url()).pathname}`);
      ok(dialogs.length === 0, `D: žádné systémové okno: ${dialogs.join(' | ') || '0'}`);
      ok(errs.length === 0, 'D: bez JS chyb ' + errs.join(' | '));
    } finally {
      await b.close().catch(() => {});
      php.kill();
      fs.rmSync(root, { recursive: true, force: true });
    }
  } else console.log('# php chybí – část D (krátký odkaz z konzole proti úložišti) přeskočena');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
