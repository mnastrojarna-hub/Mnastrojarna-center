// E2E: sestava čistě textem přes window.mncad (jako AI agent) – díly Deska + Čep, nová sestava, vložit, plochy komponenty,
// vazby Souosost a Kontakt podle F-čísel / pravidel, poloha čepu ve výpisu „sestava“ i ve stavu, kolize = 0, výpis a úprava
// vazeb, komponenta (posun, barva, číslo), pole, šroub do díry, podsestava, kusovník + bom() CSV, úprava dílu v kontextu
// (sestava upravit … sestava hotovo změní hmotnost v kusovníku), záložky (záložka, tabs(), activateTab, closeTab), rám formy,
// anglické a německé příkazy.
// Spuštění: E2E_BASE=http://localhost:3321 node e2e/cad-agent-asm.e2e.cjs <složka>   (výchozí server http://localhost:3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));
  const show = (l, re) => (l.match(re) || [''])[0];
  const doc = () => p.evaluate(() => window.mncad.getDocument());

  // ── díly a sestava ──
  let log = await run(`nový díl Deska
kvádr 80 60 10
díra 10,5 skrz v 40 30
díra 9 skrz v 20 15`);
  ok(!bad(log).length && /Rozměry: 80 × 60 × 10 mm/.test(log), 'díl Deska 80 × 60 × 10 se dvěma dírami' + (bad(log).length ? '\n' + bad(log).join('\n') : ''));
  log = await run(`nový díl Čep
válec 10 30
válec 16 5 v 0 0 30`);
  ok(!bad(log).length && /Rozměry: 16 × 16 × 35 mm/.test(log), 'díl Čep Ø10 × 30 s hlavou Ø16 × 5');
  log = await run(`nová sestava Čep v desce
vložit "Deska" ukotvit
vložit "Čep" v 100 0 0`);
  ok(/✓ komponenta „Čep“ vložena do sestavy/.test(log) && /Komponenty: Deska \[0; 0; 0\] ⚓ · Čep \[100; 0; 0\]/.test(log), 'nová sestava, 2× vložit; stav: Komponenty s polohou a ukotvením (' + show(log, /Komponenty:[^\n]*/) + ')');

  // ── plochy a vazby ──
  log = await run('sestava plochy "Čep" válcové');
  ok(/Plochy komponenty „Čep“/.test(log) && /F\d+ · válcová Ø10 · osa Z · střed osy \[100; 0; 15\] · délka 30 mm/.test(log) && /F\d+ · válcová Ø16 · osa Z/.test(log), 'sestava plochy "Čep" válcové: Ø10 a Ø16 s osou a středem v souřadnicích sestavy');
  log = await run('sestava plochy "Čep" rovinné');
  const under = log.split('\n').find((l) => /normála −Z · střed \[100; 0; 30\]/.test(l)) || '';
  const fUnder = (under.match(/F\d+/) || [''])[0];
  ok(!!fUnder && /mm²/.test(under), 'sestava plochy "Čep" rovinné: spodní plocha hlavy ' + under.trim());
  log = await run('sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5');
  ok(/✓ vazba Souosost „Čep“ F\d+ → „Deska“ F\d+: ok · „Čep“ poloha \[40; 30; 0\]/.test(log), 'vazba souosost Ø10 → Ø10,5: čep v ose díry [40; 30; 0] (' + show(log, /^.*vazba Souosost[^\n]*/m) + ')');
  log = await run(`sestava vazba kontakt "Čep" ${fUnder} "Deska" horní`);
  ok(new RegExp(`✓ vazba Kontakt „Čep“ ${fUnder} → „Deska“ F\\d+: ok · „Čep“ poloha \\[40; 30; -20\\]`).test(log), `vazba kontakt ${fUnder} (spodek hlavy) → horní plocha desky: čep [40; 30; -20] (` + show(log, /^.*vazba Kontakt[^\n]*/m) + ')');
  ok(/Vazby: 2 \(2 ok\)/.test(log), 'stav: Vazby: 2 (2 ok)');
  log = await run('sestava');
  ok(/#2 Čep · díl · poloha \[40; 30; -20\]/.test(log) && /#1 Deska · díl · poloha \[0; 0; 0\] · ukotvená ⚓/.test(log), 'sestava: výpis komponent s polohou a ukotvením');
  log = await run('kolize');
  ok(/✓ kolize: žádné/.test(log), 'kolize = 0 (čep Ø10 v díře Ø10,5, hlava na desce)' + (/✓ kolize: žádné/.test(log) ? '' : '\n' + show(log, /^.*kolize[^\n]*/m)));
  log = await run('sestava vazby');
  ok(/Vazby sestavy „Čep v desce“: 2 \(2 ok\)/.test(log) && / 1\. Souosost „Čep“ F\d+ → „Deska“ F\d+ – ok/.test(log), 'sestava vazby: číslovaný výpis se stavem');
  log = await run('sestava vazba 2 obráceně');
  ok(/✓ vazba 2 \(Kontakt .* obráceně\): obráceně/.test(log), 'sestava vazba 2 obráceně');
  log = await run('sestava vazba 2 obráceně');
  ok(/původní orientace · ok/.test(log) && /Komponenty: Deska \[0; 0; 0\] ⚓ · Čep \[40; 30; -20\]/.test(log), 'otočení zpět: čep opět [40; 30; -20]');
  log = await run('assembly mates');
  ok(/2 \(2 ok\)/.test(log), 'anglicky: assembly mates');
  log = await run('baugruppe verknüpfungen');
  ok(/2 \(2 ok\)/.test(log), 'německy: baugruppe verknüpfungen');

  // ── komponenta, pole, šroub, podsestava ──
  log = await run('sestava pole "Čep" 3 rozteč 25 směr Y');
  ok(/✓ pole „Čep“: 3 ks/.test(log) && (await doc()).components.length === 4, 'sestava pole "Čep" 3 rozteč 25 → 4 komponenty');
  log = await run('sestava komponenta "Čep (3)" posun 0 0 50 barva #e03930 číslo "C-3"');
  ok(/✓ komponenta „Čep \(3\)“: poloha \[40; 80; 30\] · barva #e03930 · číslo „C-3“/.test(log), 'sestava komponenta: posun, barva, číslo (' + show(log, /^✓ komponenta[^\n]*/m) + ')');
  log = await run('sestava šroub "Deska" Ø9 matice');
  ok(/✓ šroub „Šroub M8×\d+“ \(ISO 4762 – M8×\d+ – 12\.9\) do díry F\d+ komponenty „Deska“ \(Ø9, délka díry 10 mm\) \+ podložka \+ matice · vazba Souosost: ok · poloha \[20; 15; 11,6\]/.test(log), 'sestava šroub "Deska" Ø9 matice: M8, podložka, matice, Souosost ok (' + show(log, /^.*šroub[^\n]*/m) + ')');
  log = await run('sestava podsestava "Čep (2)" "Čep (3)" jako "Kolíky"');
  ok(/✓ podsestava „Kolíky“: „Čep \(2\)“, „Čep \(3\)“/.test(log), 'sestava podsestava');
  log = await run('sestava rozpustit "Kolíky"');
  ok(/✓ podsestava „Kolíky“ rozpuštěna/.test(log) && !bad(log).length, 'sestava rozpustit');

  // ── kusovník ──
  log = await run('kusovník');
  ok(/Kusovník „Čep v desce“ \(plochý\): položek \d+, kusů 8, hmotnost Σ [\d,]+ kg/.test(log) && /\| Šroub M8×\d+ \| ISO 4762/.test(log) && /\| Podložka M8 \|/.test(log) && /\| Matice M8 \|/.test(log), 'kusovník: 8 ks (deska, 3 čepy, šroub, 2 podložky, matice) – ' + show(log, /Kusovník[^\n]*/));
  let bom = await p.evaluate(() => window.mncad.bom());
  const deska0 = bom.rows.find((r) => r.name === 'Deska');
  ok(bom.csv.startsWith('﻿Pozice;Název;') && bom.rows.reduce((s, r) => s + r.qty, 0) === 8 && deska0 && deska0.massKg > 0.3, 'window.mncad.bom(): řádky, CSV, hmotnost desky ' + (deska0 && deska0.massKg));
  const st = await p.evaluate(() => window.mncad.bom({ structured: true }));
  ok(st.rows.length > 0 && /strukturovaný/.test(st.text), 'bom({ structured: true })');

  // ── úprava dílu v kontextu ──
  log = await run(`sestava upravit "Deska"
kvádr 20 20 10 v 50 30 0 odebrat
sestava hotovo`);
  ok(/✓ úprava dílu „Deska“ v kontextu sestavy/.test(log) && /✓ „Deska“ vrácen do sestavy „Čep v desce“/.test(log) && !bad(log).length, 'sestava upravit "Deska" + kvádr odebrat + sestava hotovo' + (bad(log).length ? '\n' + bad(log).join('\n') : ''));
  bom = await p.evaluate(() => window.mncad.bom());
  const deska1 = bom.rows.find((r) => r.name === 'Deska');
  ok(deska1 && Math.abs(deska0.massKg - deska1.massKg - (4000 / 1000) * 7.85 / 1000) < 0.002, `kusovník po úpravě v kontextu: hmotnost desky ${deska0.massKg.toFixed(4)} → ${deska1 && deska1.massKg.toFixed(4)} kg (−20×20×10 mm)`);
  ok((await doc()).kind === 'assembly', 'po „sestava hotovo“ je otevřená zase sestava');
  ok(/vazby 4\/4 ok/.test(log), 'po úpravě desky platí všechny 4 vazby (' + show(log, /^✓ „Deska“ vrácen[^\n]*/m) + (/přečíslovány/.test(log) ? ' · ' + show(log, /plochy vazeb přečíslovány[^\n]*/) : '') + ')');
  // úprava v kontextu přes více volání run(): stav úpravy drží aplikace (pruh „Úprava dílu v sestavě“, tlačítko Zpět)
  log = await run('sestava upravit "Čep"');
  ok(/✓ úprava dílu „Čep“/.test(log) && /Dokument: „Čep“ · díl/.test(log), 'sestava upravit "Čep" (samostatné volání): otevřený je díl Čep');
  ok(/v sestavě „Čep v desce“/.test(await p.locator('body').innerText()), 'aplikace ukazuje pruh „Úprava dílu v sestavě „Čep v desce““');
  log = await run('válec 4 5 v 0 0 35');
  ok(!bad(log).length && /Rozměry: 16 × 16 × 40 mm/.test(log), 'další volání pracuje s dílem Čep (40 mm vysoký)');
  const cep0 = bom.rows.find((r) => r.name === 'Čep');
  log = await run('sestava hotovo');
  ok(/✓ „Čep“ vrácen do sestavy „Čep v desce“ \(změnu převzalo komponent: 3\)/.test(log), 'sestava hotovo (samostatné volání): změnu převzaly 3 čepy (originál + 2 kopie z pole)');
  bom = await p.evaluate(() => window.mncad.bom());
  const cep1 = bom.rows.find((r) => r.name === 'Čep');
  ok(cep0 && cep1 && cep1.massKg > cep0.massKg, `kusovník: hmotnost čepu ${cep0 && cep0.massKg.toFixed(4)} → ${cep1 && cep1.massKg.toFixed(4)} kg`);

  // ── záložky ──
  let tabs = await p.evaluate(() => window.mncad.tabs());
  ok(['Deska', 'Čep', 'Čep v desce'].every((t) => tabs.some((x) => x.title === t)) && tabs.find((x) => x.active).title === 'Čep v desce', 'tabs(): ' + tabs.map((t) => `${t.title}${t.active ? '*' : ''} (${t.kind})`).join(', '));
  log = await run('záložky');
  ok(/Záložky \(\d+\):/.test(log) && /Čep v desce · sestava · aktivní/.test(log), 'záložky: výpis');
  log = await run('záložka "Čep"\nstav');
  ok(/✓ záložka „Čep“ \(díl\) je aktivní/.test(log) && /Dokument: „Čep“ · díl/.test(log), 'záložka "Čep": další příkazy pracují s dílem Čep');
  tabs = await p.evaluate(() => window.mncad.tabs());
  ok(tabs.find((x) => x.active).title === 'Čep', 'tabs(): aktivní Čep');
  ok(await p.evaluate(() => window.mncad.activateTab('Čep v desce')), 'activateTab("Čep v desce") = true');
  await p.waitForFunction(() => window.mncad.getDocument().kind === 'assembly', null, { timeout: 20000 });
  ok(!(await p.evaluate(() => window.mncad.activateTab('Neexistuje'))), 'activateTab("Neexistuje") = false');

  // ── rám formy ──
  log = await run('rám formy 246 296 dutina 100 120 20');
  ok(/✓ rám formy „Rám formy 246×296“ – nová záložka: komponent \d+, 246×296 mm/.test(log) && /Dokument: „Rám formy 246×296“ · sestava/.test(log) && /Komponenty: Upínací deska pohyblivá \[0; 0; 0\] ⚓/.test(log), 'rám formy → nová záložka se sestavou (' + show(log, /^✓ rám formy[^\n]*/m) + ')');
  const nTabs = (await p.evaluate(() => window.mncad.tabs())).length;
  log = await run('zavřít záložku');
  ok(/✓ záložka „Rám formy 246×296“ zavřena/.test(log) && (await p.evaluate(() => window.mncad.tabs())).length === nTabs - 1, 'zavřít záložku (rám formy)');
  log = await run('moldbase 296 346 no cavity');
  ok(/✓ rám formy „Rám formy 296×346“/.test(log), 'anglicky: moldbase 296 346 no cavity');
  ok(await p.evaluate(() => window.mncad.closeTab()), 'closeTab() = true');

  // ── vše v jednom vstupu: nová sestava + úprava v kontextu + návrat ──
  log = await run(`nová sestava Jeden vstup
vložit "Deska" ukotvit
vložit "Čep" v 0 0 50
sestava upravit "Čep"
díra 3 skrz v 0 0
sestava hotovo
sestava`);
  ok(!bad(log).length && /✓ „Čep“ vrácen do sestavy „Jeden vstup“/.test(log) && /#2 Čep · díl · poloha \[0; 0; 50\]/.test(log) && /Dokument: „Jeden vstup“ · sestava/.test(log), 'jeden vstup: nová sestava, vložit, sestava upravit, díra, sestava hotovo' + (bad(log).length ? '\n' + bad(log).join('\n') : ''));
  tabs = await p.evaluate(() => window.mncad.tabs());
  ok(tabs.filter((t) => t.title === 'Jeden vstup').length === 1 && tabs.find((t) => t.active).title === 'Jeden vstup', 'jeden vstup: sestava má jednu záložku a je aktivní (' + tabs.map((t) => t.title).join(', ') + ')');
  await p.evaluate(() => window.mncad.closeTab());
  await p.waitForTimeout(500);

  // ── chyby ──
  log = await run('záložka "Čep v desce"\nsestava vazba kontakt "Čep" F99 "Deska" horní');
  ok(/✗ řádek 2: A: komponenta „Čep“ nemá plochu F99/.test(log) && /rovinné plochy: F\d+ rovinná/.test(log), 'chyba: neexistující plocha s výčtem ploch');
  log = await run('sestava vazba souosost "Čep" rovinná "Deska" Ø9');
  ok(/✗ řádek 1: A: „rovinná“: vazba potřebuje válcovou plochu, ne rovinnou/.test(log), 'chyba: plocha nevyhovuje druhu vazby (' + show(log, /✗ řádek[^\n]*/) + ')');
  log = await run('sestava komponenta "Nic" v 0 0 0');
  ok(/✗ řádek 1: komponenta „Nic“ v sestavě není – komponenty: #1 Deska, #2 Čep/.test(log), 'chyba: neznámá komponenta s výčtem');

  await p.screenshot({ path: S + 'agent-asm.png' });
  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + e.message);
  process.exitCode = 1;
});
