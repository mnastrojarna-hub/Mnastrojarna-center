// E2E vlny 22, balík G, etapa G1 (produkční sestavení) – úrovně stavu prvku a bod 22i / 22b zprávy majitele:
//  1) 22i: skript s úpravou na nemožný poloměr a řezem mimo těleso → window.mncad.run(…, { protocol: "full" }) dá TYTÉŽ řádky
//     jako CLI (mncad run - --full) kromě t= / slow= / mem= a id prvků: přijetí ℹ op.accepted, ✗ na řádku úpravy, žádný
//     řádek s ✓ i ✗; stručný protokol totéž (≤ 2 kB, řádek D se solids= valid=)
//  2) konzole Textové příkazy (Provést): „→ … – výsledek po výpočtu níže“, pak ✗ prvku; žádné „✓ Zaoblení 1: radius…“
//  3) 22b + úrovně: strom prvků (data-feature-state / -effect / -body / -levels) ukazuje stejný stav jako protokol JSON
//     (entries[].data.levels): ✓ s čísly účinku, ⚠ žádný účinek, ✗ prvek nevznikl; popisek = text za ✓ v protokolu
//  3b) těleso nad limit ploch: ℹ „nezkontrolováno“ v protokolu, ve stromu (značka ?) i ve stavovém řádku (čip); účinek i nad 400 ploch
//  3c) prvek potlačený aktivní konfigurací: ℹ feature.suppressed (dřív „✓ Kvádr 2 (box)“), řádek D off=1, strom „potlačen“ (značka –)
//  1b) načtený dokument (JSON na řádku): načtení = ℹ přijetí, ✗ vadného prvku na řádku načtení, ✓ „dokument … postaven“ až po stavbě
//  4) anglické rozhraní: stejné kódy, přeložené texty
//  5) bez WebGL (softwarový náhled, jak zkoušel majitel): protokol = CLI, strom prvků = protokol
//  6) etapa G2 (22a, 22d): ⚠ thread.tip-tangent / thread.no-reach místo ✓ (prohlížeč = CLI), „m18 x 1,5 … šroubovice“,
//     kontrola přesně (Geometrie „· přesná kontrola“, D vcheck=exact), formulář Závit (Provedení, ⚠ ISO 261), čip platnosti
//  7) etapa G3 (22c): objemový export bez tělesa – text v prohlížeči = CLI (✗ out.no-solid, nikdy „věrná kopie“ bez tělesa),
//     export z menu Soubor ▸ STEP / STL ukáže tutéž hlášku ([data-export-check] error / warn / ok), panel „Objem –“
// Spuštění: E2E_BASE=http://localhost:3532 node e2e/cad-w22-g.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const S = (process.argv[2] || '/tmp/e2e-w22-g').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3532').replace(/\/$/, '');
const WEB = path.resolve(__dirname, '..');
const latest = JSON.parse(fs.readFileSync(path.join(WEB, 'public/cad/cli/latest.json'), 'utf8'));
const BIN = path.join(WEB, 'public/cad/cli', latest.bundle);
const cli = (script, extra = [], lang = 'cs') => {
  const out = fs.mkdtempSync(path.join(S, 'cli-'));
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', BIN, 'run', '-', '--out', out, '--formats', 'none', ...extra], { input: script, encoding: 'utf8', env: { ...process.env, MNCAD_LANG: lang } });
  return (r.stdout || '').trim();
};
// časy, paměť a náhodná id prvků se mezi běhy liší
const norm = (s) => s.replace(/ t=[\d.]+/g, '').replace(/ slow=\S+/g, '').replace(/ mem=\d+MB/g, '').replace(/\bid [a-z0-9]{1,9}\]/g, 'id #]').replace(/ · [\d.,]+ s$/gm, '').trim();
const linesOf = (full, re) => full.split('\n').filter((l) => re.test(l));
/** řádky skriptu, které mají ✓ i ✗ (pravidlo 22i: nesmí být žádný) */
const greenThenRed = (full) => {
  const at = (sym) => new Set(full.split('\n').filter((l) => l.startsWith(sym + ' L')).map((l) => l.split(' ')[1]));
  const green = at('✓');
  return [...at('✗')].filter((l) => green.has(l));
};

const EDIT = 'nový díl "Plech"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=15\nvýkres A4\nvýkres řez XZ odsazení 500\nstav';
const TREE = 'nový díl "Deska M"\nkvádr 100 50 10\nkvádr 20 20 5 v 40 15 10 odebrat\ndíra 8 skrz v 20 25\nkvádr 20 20 5 v 60 15 5 odebrat\nzaoblit 60 hrany svislé';

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !/Načítám (CAD )?jádro|Loading (the )?(CAD )?kernel/.test(document.body.innerText), null, { timeout: 300000 });
  await p.waitForTimeout(1200);
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  /** čerstvý kontext (prázdné úložiště, jedna záložka) – porovnání s CLI nesmí vidět dokumenty dřívějších běhů (mají vlastní řádky D) */
  const fresh = async (url = BASE + '/cad') => {
    const c = await b.newContext({ viewport: { width: 1400, height: 860 } });
    const q = await c.newPage();
    q.on('pageerror', (e) => errs.push(e.message));
    q.on('dialog', (d) => d.dismiss().catch(() => {}));
    await start(q, url);
    return q;
  };
  /** jeden běh skriptu v čerstvém kontextu */
  const runFresh = async (t, o) => {
    const q = await fresh();
    try {
      return await q.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
    } finally {
      await q.context().close();
    }
  };
  const p = await fresh();
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);

  // ════════════ 1) 22i: prohlížeč = CLI, přijetí ≠ výsledek ════════════
  const bFull = norm(await run(EDIT, { protocol: 'full' }));
  const cFull = norm(cli(EDIT, ['--full']));
  fs.writeFileSync(S + 'w22g-edit-browser.txt', bFull + '\n');
  fs.writeFileSync(S + 'w22g-edit-cli.txt', cFull + '\n');
  ok(bFull === cFull, '1: plný protokol v prohlížeči = CLI (' + bFull.split('\n').length + ' řádků)' + (bFull === cFull ? '' : ' – první rozdíl: ' + (bFull.split('\n').find((l, i) => l !== cFull.split('\n')[i]) || '').slice(0, 120)));
  ok(bFull.includes('ℹ L4 op.accepted "Plech": Zaoblení 1: radius 1 → 15 – výsledek po výpočtu níže'), '1: úprava je jen přijatá (ℹ op.accepted)');
  ok(/^✗ L4 feature\.failed "Plech": prvek „Zaoblení 1“ se nepostavil/m.test(bFull) && !/^✗ L3 /m.test(bFull), '1: ✗ na řádku úpravy (L4), ne na řádku vzniku (L3)');
  ok(linesOf(bFull, /^✓ L[34] /).length === 0, '1: řádek vzniku ani úpravy zaoblení nemá ✓');
  ok(/^ℹ L6 op\.accepted "Plech": výkres: řez XZ odsazení 500 .* – výsledek po vyhodnocení listu níže$/m.test(bFull) && /^✗ L6 drawing\.section-miss /m.test(bFull), '1: příkaz výkresu přijat (ℹ), ✗ řez mimo těleso po vyhodnocení listu');
  ok(greenThenRed(bFull).length === 0, '1: žádný řádek nemá ✓ i ✗ (' + (greenThenRed(bFull).join(',') || 'žádný') + ')');
  ok(/^✓ L2 Kvádr 1 \(box\) · přidáno 4000 mm³ · těleso platné$/m.test(bFull), '1: ✓ nese úrovně: ' + (linesOf(bFull, /^✓ L2 /)[0] || ''));
  const bShort = norm(await runFresh(EDIT, { protocol: 'short' }));
  const cShort = norm(cli(EDIT));
  fs.writeFileSync(S + 'w22g-edit-short-browser.txt', bShort + '\n');
  fs.writeFileSync(S + 'w22g-edit-short-cli.txt', cShort + '\n');
  ok(bShort === cShort && Buffer.byteLength(bShort, 'utf8') <= 2048, `1: stručný protokol prohlížeč = CLI, ${Buffer.byteLength(bShort, 'utf8')} B ≤ 2048` + (bShort === cShort ? '' : ' – první rozdíl: ' + (bShort.split('\n').find((l, i) => l !== cShort.split('\n')[i]) || '').slice(0, 140)));
  // + aditivní pole D z balíku D na konci: rev= (revize modelu, D2) a overlaps= (kontrola překryvů listů, D4)
  ok(/^D "Plech" part feat=1\/0\/1 .* sheets=1 solids=1 valid=1 rev=r·[0-9a-f]{6} overlaps=0$/m.test(bShort), '1: řádek D nese solids= valid=: ' + (linesOf(bShort, /^D /)[0] || ''));

  // 1b) načtený dokument (JSON na řádku – korpus 58-status-load): načtení je přijetí, ✗ vadného prvku na řádku načtení;
  //     dokument bez vady dostane ✓ „postaven“ až po ověřovací stavbě – prohlížeč = CLI
  const LOAD = fs.readFileSync(path.join(WEB, 'src/cad/engine/__corpus__/58-status-load.txt'), 'utf8').split(/^#--- run.*$/m).map((t) => t.trim());
  const bLoad = norm(await runFresh(LOAD[0], { protocol: 'full' }));
  const cLoad = norm(cli(LOAD[0], ['--full']));
  fs.writeFileSync(S + 'w22g-load-browser.txt', bLoad + '\n');
  fs.writeFileSync(S + 'w22g-load-cli.txt', cLoad + '\n');
  const jl = bLoad.split('\n').findIndex((l) => /op\.accepted "Deska A": dokument „Deska A“ \(2 prvků\)/.test(l));
  ok(bLoad === cLoad, '1b: načtený dokument – plný protokol prohlížeč = CLI' + (bLoad === cLoad ? '' : ' – první rozdíl: ' + (bLoad.split('\n').find((l, i) => l !== cLoad.split('\n')[i]) || '').slice(0, 140)));
  ok(jl > 0 && /^✗ L3 feature\.failed "Deska A": prvek „Zaoblení 1“ se nepostavil/m.test(bLoad) && !/^✓ L3 /m.test(bLoad) && greenThenRed(bLoad).length === 0, '1b: načtení = ℹ op.accepted, ✗ prvku na řádku načtení, žádné ✓ dokumentu: ' + (linesOf(bLoad, /^[ℹ✗✓] L3 /).map((l) => l.slice(0, 60)).join(' | ')));
  const bGood = norm(await runFresh(LOAD[2].split('\n').filter((l) => !/^upravit|^stav/.test(l)).join('\n'), { protocol: 'full' }));
  ok(/^ℹ L2 op\.accepted "Deska C": dokument „Deska C“ \(2 prvků\) .* – výsledek po výpočtu níže$/m.test(bGood) && /^✓ L2 dokument „Deska C“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné$/m.test(bGood), '1b: dokument bez vady: přijetí a po stavbě ✓ „postaven“: ' + (linesOf(bGood, /^✓ L2 /)[0] || ''));

  // ════════════ 2) konzole Textové příkazy ════════════
  await p.keyboard.press('Control+Shift+K').catch(() => {});
  const input = p.getByLabel('Textové příkazy nebo JSON');
  if (!(await input.isVisible().catch(() => false))) await p.getByRole('button', { name: /Textové příkazy/ }).first().click().catch(() => {});
  await input.waitFor({ timeout: 20000 });
  await input.fill(EDIT);
  const out = p.locator('[data-agent-output]');
  const prev = (await out.textContent().catch(() => '')) || '';
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev && /Dokument:/.test(o.textContent); }, prev, { timeout: 180000 });
  const con = (await out.innerText()).split('\n');
  fs.writeFileSync(S + 'w22g-console.txt', con.join('\n') + '\n');
  ok(con.includes('→ Zaoblení 1: radius 1 → 15 – výsledek po výpočtu níže'), '2: konzole – přijetí úpravy „→ … – výsledek po výpočtu níže“');
  ok(con.some((l) => l.startsWith('✗ Zaoblení 1 (fillet): Zaoblení R15 nelze provést')), '2: konzole – ✗ prvku po výpočtu');
  ok(!con.some((l) => /^✓ Zaoblení 1/.test(l)), '2: konzole – žádné ✓ Zaoblení (dřív „✓ Zaoblení 1: radius 1 → 15“ a pak ✗)');
  ok(con.includes('→ výkres: řez XZ odsazení 500 (rovina Y = -500) – výsledek po vyhodnocení listu níže') && !con.some((l) => /^✓ (výkres|nový list)/.test(l)), '2: konzole – příkazy výkresu jen přijaté, žádné ✓ výkresu');
  // texty záznamů CLI (✗ / ℹ přijetí) jsou v konzoli stejné
  const accepted = linesOf(cFull, /^ℹ L\d+ op\.accepted /).map((l) => l.replace(/^ℹ L\d+ op\.accepted "[^"]*": /, ''));
  ok(accepted.length >= 6 && accepted.every((t) => con.includes('→ ' + t)), `2: všech ${accepted.length} řádků přijetí z CLI je v konzoli se stejným textem`);

  // konzole je modální okno – zavřít, ať jde klikat do stromu prvků
  await p.keyboard.press('Escape').catch(() => {});
  await input.waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => { await p.mouse.click(5, 5); });
  await p.waitForFunction(() => !document.querySelector('[aria-label="Textové příkazy nebo JSON"]'), null, { timeout: 10000 }).catch(() => {});

  // ════════════ 3) strom prvků = protokol ════════════
  const rep = JSON.parse(await run(TREE, { protocol: 'json' }));
  await p.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length === 5 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-feature-row]')].map((r) => ({ name: r.getAttribute('data-feature-name'), state: r.getAttribute('data-feature-state'), effect: r.getAttribute('data-feature-effect'), body: r.getAttribute('data-feature-body'), levels: r.getAttribute('data-feature-levels'), warn: !!r.querySelector('[data-feature-warning]') })));
  fs.writeFileSync(S + 'w22g-tree.json', JSON.stringify({ rows, entries: rep.entries }, null, 1));
  const want = (name) => {
    const e = rep.entries.find((x) => (x.level === 'ok' && x.text.startsWith(name + ' (')) || ((x.code === 'feature.warning' || x.code === 'feature.failed' || x.code === 'feature.unchecked' || x.code === 'feature.built') && x.text.includes('„' + name + '“')));
    if (!e) return null;
    const state = e.level === 'ok' || e.code === 'feature.built' ? 'ok' : e.code === 'feature.warning' ? 'warn' : e.code === 'feature.failed' ? 'error' : 'unchecked';
    return { state, levels: e.data && e.data.levels, text: e.level === 'ok' ? e.text.split(' · ').slice(1).join(' · ') : null };
  };
  for (const r of rows) {
    const w = want(r.name);
    ok(!!w && r.state === w.state, `3: ${r.name}: strom ${r.state} = protokol ${w && w.state}`);
    if (w && w.levels && w.levels.effect) ok(r.effect === w.levels.effect.level, `3: ${r.name}: účinek ve stromu ${r.effect} = protokol ${w.levels.effect.level}`);
    if (w && w.text) ok(r.levels === w.text, `3: ${r.name}: popisek stromu „${r.levels}“ = text za ✓ v protokolu`);
  }
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  ok(by['Kvádr 2'] && by['Kvádr 2'].state === 'warn' && by['Kvádr 2'].effect === 'none' && by['Kvádr 2'].warn, '3: nástroj ležící na ploše: ⚠ ve stromu, účinek none');
  ok(by['Díra 1'] && by['Díra 1'].state === 'ok' && by['Díra 1'].effect === 'partial' && /^úběr 502,7 mm³ \(\d+ % nástroje\) · těleso platné$/.test(by['Díra 1'].levels || ''), '3: díra: ✓, část nástroje, čísla: ' + (by['Díra 1'] && by['Díra 1'].levels));
  ok(by['Kvádr 3'] && by['Kvádr 3'].effect === 'full' && by['Kvádr 3'].levels === 'úběr 2000 mm³ (celý nástroj) · těleso platné', '3: kapsa: celý nástroj: ' + (by['Kvádr 3'] && by['Kvádr 3'].levels));
  ok(by['Zaoblení 1'] && by['Zaoblení 1'].state === 'error' && !by['Zaoblení 1'].levels, '3: neproveditelné zaoblení: ✗ ve stromu, bez úrovní');
  // aktivní prvek ukáže úrovně pod řádkem
  await p.locator('[data-feature-row][data-feature-name="Díra 1"]').click();
  const note = await p.locator('[data-feature-levels-note]').first().innerText({ timeout: 10000 }).catch(() => '');
  ok(note === by['Díra 1'].levels, '3: úrovně pod aktivním prvkem: ' + note);
  await p.screenshot({ path: S + 'w22g-tree.png' });
  await p.keyboard.press('Escape').catch(() => {});

  // ════════════ 3b) nezkontrolováno není ✓: těleso nad limit ploch (korpus 59-unchecked-large) ════════════
  const GRID = fs.readFileSync(path.join(WEB, 'src/cad/engine/__corpus__/59-unchecked-large.txt'), 'utf8').trim();
  const pg = await fresh();
  const gFull = norm(await pg.evaluate(([t, o]) => window.mncad.run(t, o), [GRID, { protocol: 'full' }]));
  const gCli = norm(cli(GRID, ['--full']));
  fs.writeFileSync(S + 'w22g-grid-browser.txt', gFull + '\n');
  ok(gFull === gCli, '3b: velké těleso – plný protokol prohlížeč = CLI' + (gFull === gCli ? '' : ' – první rozdíl: ' + (gFull.split('\n').find((l, i) => l !== gCli.split('\n')[i]) || '').slice(0, 140)));
  ok(/^ℹ L\d+ feature\.unchecked "Mřížka": prvek „Pole 1“: .*180 těles, platnost nezkontrolována \(velké těleso, 1085 ploch/m.test(gFull) && !/^✓ L\d+ Pole 1/m.test(gFull), '3b: prvek bez kontroly platnosti je ℹ feature.unchecked s důvodem, ne ✓');
  ok(/^ℹ L\d+ feature\.unchecked "Mřížka": prvek „Kvádr 2“: úběr 0,5 mm³ \(50 % nástroje\)/m.test(gFull) && /^⚠ L\d+ feature\.warning "Mřížka": prvek „Kvádr 3“: Prvek těleso nezměnil/m.test(gFull), '3b: účinek operace se posoudí i nad 400 ploch (část nástroje s čísly; žádný účinek = ⚠)');
  ok(/^D "Mřížka" part feat=1\/1\/0 .* solids=180 valid=unchecked unchecked=2$/m.test(gFull) && /Geometrie: nezkontrolováno \(velké těleso, 1085 ploch/.test(gFull) && !/Geometrie: platná/.test(gFull), '3b: řádek D valid=unchecked unchecked=2, Geometrie: nezkontrolováno: ' + (linesOf(gFull, /^D /)[0] || ''));
  await pg.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length === 4 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
  const gRows = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-feature-row]')].map((r) => [r.getAttribute('data-feature-name'), { state: r.getAttribute('data-feature-state'), effect: r.getAttribute('data-feature-effect'), body: r.getAttribute('data-feature-body'), badge: !!r.querySelector('[data-feature-unchecked]') }])));
  ok(gRows['Kvádr 1'] && gRows['Kvádr 1'].state === 'ok' && gRows['Pole 1'] && gRows['Pole 1'].state === 'unchecked' && gRows['Pole 1'].body === 'unchecked' && gRows['Pole 1'].badge, '3b: strom – Pole 1 „nezkontrolováno“ se značkou ?, Kvádr 1 ✓: ' + JSON.stringify(gRows['Pole 1']));
  ok(gRows['Kvádr 2'] && gRows['Kvádr 2'].state === 'unchecked' && gRows['Kvádr 2'].effect === 'partial' && gRows['Kvádr 3'] && gRows['Kvádr 3'].state === 'warn' && gRows['Kvádr 3'].effect === 'none', '3b: strom – Kvádr 2 nezkontrolováno + část nástroje, Kvádr 3 ⚠ bez účinku');
  const chip = await pg.locator('[data-geom-unchecked]').first().innerText({ timeout: 10000 }).catch(() => '');
  const chipTitle = await pg.locator('[data-geom-unchecked]').first().getAttribute('title').catch(() => '');
  ok(chip === 'platnost nezkontrolována' && /nezkontrolováno \(velké těleso, 1085 ploch/.test(chipTitle || ''), '3b: stavový řádek – čip „platnost nezkontrolována“ s důvodem: ' + chipTitle);
  await pg.screenshot({ path: S + 'w22g-unchecked.png' });

  await pg.context().close();

  // ════════════ 3c) potlačený prvek (aktivní konfigurace) se nestavěl – ℹ, ne ✓ (protokol = CLI, strom = protokol) ════════════
  const OFF = 'nový díl "Deska K"\nkvádr 60 40 10\nkvádr 10 10 30 v 40 10 10\nkonfigurace "Bez výstupku" potlačit "Kvádr 2"\nkonfigurace aktivní "Bez výstupku"\nstav';
  const po = await fresh();
  const oFull = norm(await po.evaluate(([t, o]) => window.mncad.run(t, o), [OFF, { protocol: 'full' }]));
  const oCli = norm(cli(OFF, ['--full']));
  ok(oFull === oCli, '3c: potlačený prvek – plný protokol prohlížeč = CLI' + (oFull === oCli ? '' : ' – první rozdíl: ' + (oFull.split('\n').find((l, i) => l !== oCli.split('\n')[i]) || '').slice(0, 140)));
  ok(/^ℹ L3 feature\.suppressed "Deska K": prvek „Kvádr 2“ je potlačený – nestaví se \(bez výsledku\)$/m.test(oFull) && !/^✓ L\d+ Kvádr 2/m.test(oFull), '3c: potlačený prvek je ℹ feature.suppressed, ne „✓ Kvádr 2 (box)“ (dřív)');
  ok(/^D "Deska K" part feat=1\/0\/0 .* off=1$/m.test(oFull) && /prvků 2 \(1 ✓, 1 ℹ potlačeno, 0 ✗\)/.test(oFull), '3c: řádek D off=1, stav „1 ℹ potlačeno“: ' + (linesOf(oFull, /^D /)[0] || ''));
  await po.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length === 2 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
  const oRows = await po.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-feature-row]')].map((r) => [r.getAttribute('data-feature-name'), { state: r.getAttribute('data-feature-state'), badge: !!r.querySelector('[data-feature-off]'), levels: r.getAttribute('data-feature-levels') }])));
  ok(oRows['Kvádr 2'] && oRows['Kvádr 2'].state === 'off' && oRows['Kvádr 2'].badge && oRows['Kvádr 2'].levels === 'potlačen – nestaví se' && oRows['Kvádr 1'] && oRows['Kvádr 1'].state === 'ok', '3c: strom – Kvádr 2 „potlačen“ se značkou –, Kvádr 1 ✓: ' + JSON.stringify(oRows));
  await po.context().close();

  // ════════════ 4) anglicky ════════════
  const pe = await fresh(BASE + '/en/cad');
  const EN = 'new part "Plate A"\nbox 20 20 10\nfillet 1 edges vertical\nedit "Fillet 1" radius=15';
  const eFull = norm(await pe.evaluate(([t, o]) => window.mncad.run(t, o), [EN, { protocol: 'full' }]));
  const eCli = norm(cli(EN, ['--full'], 'en'));
  ok(eFull === eCli, '4: EN plný protokol prohlížeč = CLI');
  ok(eFull.includes('ℹ L4 op.accepted "Plate A": Fillet 1: radius 1 → 15 – result after computation below') && /^✗ L4 feature\.failed /m.test(eFull) && greenThenRed(eFull).length === 0, '4: EN přijetí ℹ + ✗ na řádku úpravy');
  ok(/^✓ L2 Box 1 \(box\) · added 4000 mm³ · body valid$/m.test(eFull), '4: EN úrovně: ' + (linesOf(eFull, /^✓ L2 /)[0] || ''));

  await pe.context().close();

  // ════════════ 5) bez WebGL (majitel zkoušel v softwarovém náhledu): protokol = CLI, strom prvků = protokol ════════════
  {
    const nb = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
    const nc = await nb.newContext({ viewport: { width: 1400, height: 860 } });
    const q = await nc.newPage();
    q.on('pageerror', (e) => errs.push(e.message));
    q.on('dialog', (d) => d.dismiss().catch(() => {}));
    await start(q, BASE + '/cad');
    ok(await q.evaluate(() => !document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('webgl2')) && (await q.locator('[data-viewport-fallback]').getAttribute('data-viewport-fallback').catch(() => '')) === 'soft', '5: prostředí – WebGL vypnuté, softwarový náhled');
    const nFull = norm(await q.evaluate(([t, o]) => window.mncad.run(t, o), [EDIT, { protocol: 'full' }]));
    ok(nFull === cFull && greenThenRed(nFull).length === 0 && /^✗ L4 feature\.failed /m.test(nFull), '5: bez WebGL – plný protokol = CLI, ✗ na řádku úpravy, žádný řádek s ✓ i ✗');
    const nRep = JSON.parse(await q.evaluate(([t, o]) => window.mncad.run(t, o), [TREE, { protocol: 'json' }]));
    await q.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length === 5 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
    const nRows = await q.evaluate(() => [...document.querySelectorAll('[data-feature-row]')].map((r) => ({ name: r.getAttribute('data-feature-name'), state: r.getAttribute('data-feature-state'), effect: r.getAttribute('data-feature-effect') })));
    const nWant = (name) => {
      const e = nRep.entries.find((x) => (x.level === 'ok' && x.text.startsWith(name + ' (')) || ((x.code === 'feature.warning' || x.code === 'feature.failed' || x.code === 'feature.unchecked' || x.code === 'feature.built') && x.text.includes('„' + name + '“')));
      return !e ? null : e.level === 'ok' || e.code === 'feature.built' ? 'ok' : e.code === 'feature.warning' ? 'warn' : e.code === 'feature.failed' ? 'error' : 'unchecked';
    };
    const bad = nRows.filter((r) => r.state !== nWant(r.name));
    ok(nRows.length === 5 && bad.length === 0 && nRows.map((r) => r.state).join(',') === rows.map((r) => r.state).join(','), '5: bez WebGL – strom prvků = protokol (' + nRows.map((r) => r.name + ':' + r.state + (r.effect ? '/' + r.effect : '')).join(', ') + ')');
    await q.screenshot({ path: S + 'w22g-nowebgl-tree.png' });
    await nb.close();
  }

  // ════════════ 6) etapa G2 (22a, 22d): závity a přesná kontrola platnosti ════════════
  {
    // 6a) prohlížeč = CLI: tečná špička / skrytý kanál = ⚠ s kódem (ne ✓), „m18 x 1,5“ i šroubovice z označení, kontrola přesně
    const THR = 'nový díl "Deska C"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 mode=cut\nnový díl "Deska H"\ntrubka 30 16.4 20\nprvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=12 side=internal mode=cut\nnový díl "Čep"\nválec 18 30\nzávit m18 x 1,5 délka 20 v 0 0 10 šroubovice\nkontrola přesně\nstav';
    const tFull = norm(await runFresh(THR, { protocol: 'full' }));
    const tCli = norm(cli(THR, ['--full']));
    fs.writeFileSync(S + 'w22g-g2-threads-browser.txt', tFull + '\n');
    fs.writeFileSync(S + 'w22g-g2-threads-cli.txt', tCli + '\n');
    ok(tFull === tCli, '6a: závity – plný protokol v prohlížeči = CLI');
    ok(/^⚠ L3 thread\.tip-tangent "Deska C": /m.test(tFull) && /^⚠ L6 thread\.no-reach "Deska H": /m.test(tFull) && !/^✓ L(3|6) /m.test(tFull), '6a: tečná špička / skrytý kanál = ⚠ s kódem, žádné ✓');
    ok(!/parse\.error/.test(tFull) && /^✓ L9 Závit 1 \(thread\) · úběr /m.test(tFull) && /skutečná šroubovice/.test(tFull), '6a: „m18 x 1,5 … šroubovice“ = ✓ skutečná šroubovice');
    ok(/platné \(přesná kontrola\)/.test(tFull) && /Geometrie: platná · 1 těleso · přesná kontrola/.test(tFull) && /^D "Čep" .* valid=1 vcheck=exact$/m.test(norm(await runFresh(THR, { protocol: 'short' }))), '6a: kontrola přesně → „· přesná kontrola“ a vcheck=exact');

    // 6b) GUI: formulář Závit – Provedení kosmetický / drážky / šroubovice (data-thread-geometry), varování ISO 261 (M18×3)
    const q = await fresh();
    await q.evaluate((t) => window.mncad.run(t), 'nový díl "Čep B"\nválec 18 30\nzávit M18×3 délka 10 v 0 0 10');
    await q.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length === 2 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
    // formulář prvku otevře JEDEN klik na řádek stromu (manager.tsx onSelect); dvojklik je přejmenování (2. klik formulář zase zavře)
    await q.locator('[data-feature-row][data-feature-name="Závit 1"]').click();
    await q.waitForSelector('[data-thread-geometry]', { timeout: 30000 });
    ok((await q.locator('[data-thread-geometry]').getAttribute('data-thread-geometry')) === 'cosmetic' && /není pro M18 v ISO 261/.test((await q.locator('[data-thread-pitch-warning]').textContent().catch(() => '')) || ''), '6b: formulář Závit – kosmetický, ⚠ stoupání mimo ISO 261 ve formuláři');
    const warnRow = await q.locator('[data-feature-row][data-feature-name="Závit 1"]').getAttribute('data-feature-state');
    ok(warnRow === 'warn', '6b: strom prvků – M18×3 je ⚠ (ne ✓): ' + warnRow);
    await q.locator('[data-thread-geometry]').getByText('Šroubovice', { exact: true }).click();
    await q.waitForFunction(() => document.querySelector('[data-thread-geometry]')?.getAttribute('data-thread-geometry') === 'helix', null, { timeout: 30000 });
    ok(true, '6b: přepnuto na Šroubovice (data-thread-geometry=helix)');
    // 6c) stavový řádek: „platné · rychlá kontrola“ → klik → přesná kontrola (data-validity)
    await q.evaluate((t) => window.mncad.run(t), 'nový díl "Deska V"\nkvádr 40 20 10');
    await q.waitForSelector('[data-validity]', { timeout: 120000 });
    ok((await q.locator('[data-validity]').getAttribute('data-validity')) === 'fast' && /rychlá kontrola/.test((await q.locator('[data-validity]').textContent()) || ''), '6c: stavový řádek říká „rychlá kontrola“ (ne jen „platné“)');
    await q.locator('[data-validity]').click();
    await q.waitForFunction(() => /^exact-/.test(document.querySelector('[data-validity]')?.getAttribute('data-validity') || ''), null, { timeout: 120000 });
    ok((await q.locator('[data-validity]').getAttribute('data-validity')) === 'exact-ok' && /přesná kontrola/.test((await q.locator('[data-validity]').textContent()) || ''), '6c: klik → přesná kontrola „platné · přesná kontrola“');
    await q.evaluate((t) => window.mncad.run(t), 'kvádr 5 5 5 v 0 0 10');
    await q.waitForFunction(() => document.querySelector('[data-validity]')?.getAttribute('data-validity') === 'fast', null, { timeout: 120000 });
    ok(true, '6c: po změně modelu se přesný výsledek neukazuje (zpět „rychlá kontrola“)');
    await q.screenshot({ path: S + 'w22g-g2-validity.png' });
    await q.context().close();
  }

  // ════════════ 7) etapa G3 (22c): objemový export bez tělesa – GUI = text ════════════
  {
    const SHELL = 'nový díl "Deska A"\nskica XY: obdélník 40 30\nprvek surf.extrude sketchId="Skica 1" distance=20\nskica XY: obdélník 40 30\nprvek surf.planar sketchId="Skica 2"\nskica XY odsazení 20: obdélník 40 30\nprvek surf.planar sketchId="Skica 3"\nprvek surf.sew tolerance=0.01';
    const FREE = 'nový díl "Deska B"\nkvádr 40 30 20\nskica XZ: čára -10 5 50 5 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=60 symmetric=ano';
    const SOLID = 'nový díl "Deska C"\nkvádr 120 100 40 v -60 -50 0\nskica XY odsazení 35: spline -60 45 -20 30 20 45 60 30\nprvek sweep pathId="Skica 1" circleRadius=3 mode=cut';
    // 7a) text: prohlížeč = CLI, ✗ out.no-solid místo „✓ … věrná kopie“, F check=fail
    const sFull = norm(await runFresh(SHELL + '\nexport step', { protocol: 'full' }));
    const sCli = norm(cli(SHELL + '\nexport step', ['--full']));
    fs.writeFileSync(S + 'w22g-g3-shell-browser.txt', sFull + '\n');
    fs.writeFileSync(S + 'w22g-g3-shell-cli.txt', sCli + '\n');
    const noSolidLine = (t) => linesOf(t, /^✗ L\d+ out\.no-solid /)[0] || '';
    ok(!!noSolidLine(sFull) && noSolidLine(sFull) === noSolidLine(sCli), '7a: ✗ out.no-solid v prohlížeči = CLI: ' + noSolidLine(sFull).slice(0, 140));
    ok(!/věrná kopie/.test(sFull) && /^ℹ L9 msg\.note "Deska A": export STEP: /m.test(sFull) && !/^✓ L9 /m.test(sFull), '7a: bez tělesa žádné „věrná kopie“ ani ✓ exportu (zápis jen ℹ)');
    ok(/^D "Deska A" part .*V=- m=- .*solids=0/m.test(sFull) && /objem – \(žádné těleso\)/.test(norm(await runFresh(SHELL + '\nstav', { protocol: 'full' }))), '7a: řádek D V=- m=- solids=0, stav „objem – (žádné těleso)“');
    const fFull = norm(await runFresh(FREE + '\nexport step', { protocol: 'full' }));
    ok(/^⚠ L\d+ out\.free-surfaces "Deska B": /m.test(fFull) && !/věrná kopie/.test(fFull) && /^D "Deska B" part feat=\S+ V=24cm3 /m.test(fFull), '7a: těleso + volná plocha → ⚠ out.free-surfaces, objem jen tělesa 24 cm³');
    const cFull = norm(await runFresh(SOLID + '\nexport step', { protocol: 'full' }));
    ok(/^✓ L\d+ kontrola STEP: soubor znovu načten jádrem – těles: 1, .*věrná kopie modelu/m.test(cFull) && !/out\.(no-solid|free-surfaces|check-failed)/.test(cFull), '7a: forma s kanálem po spline (oprava 4. 11.) – platné těleso, „věrná kopie“');

    // 7b) GUI: Soubor ▸ STEP AP214 / STL – stejná hláška jako textový export (lišta [data-export-check][data-export-format];
    // samotné [data-export-check] nesou i položky úloh exportu v run-chip.tsx – data-export-job, balík A3)
    const gc = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    await gc.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const g = await gc.newPage();
    g.on('pageerror', (e) => errs.push(e.message));
    g.on('dialog', (d) => d.dismiss().catch(() => {}));
    await start(g, BASE + '/cad');
    const menuExport = async (name) => {
      await g.getByRole('button', { name: 'Soubor', exact: true }).click();
      await g.waitForTimeout(400);
      const [d] = await Promise.all([g.waitForEvent('download', { timeout: 120000 }), g.getByRole('button', { name }).first().click()]);
      await g.waitForSelector('[data-export-check][data-export-format]', { timeout: 120000 });
      return { file: d.suggestedFilename(), level: await g.locator('[data-export-check][data-export-format]').getAttribute('data-export-check'), text: ((await g.locator('[data-export-check][data-export-format]').innerText()) || '').replace(/×\s*$/, '').trim() };
    };
    await g.evaluate((t) => window.mncad.run(t), SHELL);
    await g.waitForFunction(() => document.querySelectorAll('[data-feature-row]').length >= 7 && ![...document.querySelectorAll('[data-feature-row]')].some((r) => r.getAttribute('data-feature-state') === 'pending'), null, { timeout: 120000 });
    const gs = await menuExport(/STEP AP214 \(\.step\)/);
    const want = noSolidLine(sFull).replace(/^✗ L\d+ out\.no-solid "Deska A": /, '');
    ok(gs.level === 'error' && gs.text.replace(/^✗\s*/, '') === want && !/věrná kopie/.test(gs.text), '7b: GUI export STEP skořepiny → ✗ stejná věta jako text (' + gs.file + '): ' + gs.text.slice(0, 120));
    await g.screenshot({ path: S + 'w22g-g3-export-noshell.png' });
    const gl = await menuExport(/STL \(\.stl\)/);
    ok(gl.level === 'error' && /STL: model nemá objemové těleso/.test(gl.text), '7b: GUI export STL skořepiny → ✗ model nemá objemové těleso: ' + gl.text.slice(0, 100));
    ok((await g.locator('[data-volume-chip]').getAttribute('data-volume-chip').catch(() => '')) === 'none' && /^V –$/.test(((await g.locator('[data-volume-chip]').innerText().catch(() => '')) || '').trim()), '7b: čip objemu „V –“ u dílu bez tělesa (data-volume-chip=none)');
    await g.evaluate((t) => window.mncad.run(t), FREE);
    await g.waitForFunction(() => !document.querySelector('[data-export-check][data-export-format]'), null, { timeout: 60000 }).catch(() => {});
    await g.waitForTimeout(1500);
    const gw = await menuExport(/STEP AP214 \(\.step\)/);
    ok(gw.level === 'warn' && /plochy mimo tělesa/.test(gw.text) && !/věrná kopie/.test(gw.text), '7b: GUI export STEP tělesa s volnou plochou → ⚠: ' + gw.text.slice(0, 100));
    await g.evaluate((t) => window.mncad.run(t), SOLID);
    await g.waitForTimeout(1500);
    const go = await menuExport(/STEP AP214 \(\.step\)/);
    ok(go.level === 'ok' && /věrná kopie modelu/.test(go.text) && /těles: 1/.test(go.text), '7b: GUI export STEP platného tělesa → ✓ věrná kopie (těles: 1)');
    await gc.close();
  }

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(1); });
