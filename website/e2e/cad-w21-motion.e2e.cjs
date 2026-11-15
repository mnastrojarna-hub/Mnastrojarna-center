// E2E vlna 21 – balík motion: pružiny v sestavě a v pohybu (produkční build).
//  - GUI: Sestava › Pružina mezi díly – klik na kapsu Ø21 v horní desce a na horní plochu stírací desky (seznam ploch), tabulka
//    předvyplněná podle díry (De, d, L0, n, tuhost, Ln, síla), „do všech děr vzoru“ → 4 pružiny se zámkem k horní desce;
//  - dynamická studie střižníku: horní deska motorem dolů 30 mm a zpět (tam a zpět), stírací deska na 4 pružinách dosedne na matrici,
//    stlačí pružiny a vrátí se na doraz – protokol (největší síla pružiny, návrat na doraz), graf v panelu, CSV s rychlostí a zrychlením;
//  - text CS/EN: pohyb dynamika / hmotnost / síla vazba / kinematika, window.mncad.motion({ mode: "dynamic" }), pérový kolík zaskočí;
//  - kinematická studie zůstává výchozí (bez „pohyb dynamika“ beze změny);
//  - recenze: desetinná čárka / tečka psaná z klávesnice v tabulce pružiny a v hodnotě zatížení, kontrola EN 13906-1 v tabulce
//    (napětí, Ln + Sa, ✗ L0 ≤ Ln) i v souhrnu pohybu (⚠ dotyk závitů), a max bez rázu, `sestava pružina nápověda`, fyzicky
//    správný pérový kolík (bez ⚠).
// Spuštění: E2E_BASE=http://localhost:3502 node e2e/cad-w21-motion.e2e.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();
const num = (s) => Number(String(s).replace(',', '.'));

(async () => {
  const b = await chromium.launch({ args: NO_GL });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 6000 }).catch(() => false)) await c0.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForFunction(() => !!(window.mncad && window.mncad.run), null, { timeout: 120000 });
  const t00 = Date.now();
  const run = async (text) => {
    process.stderr.write(`[${((Date.now() - t00) / 1000).toFixed(0)} s] ${text.split('\n')[0]}\n`);
    return String(await p.evaluate((t) => window.mncad.run(t), text));
  };

  // ── díly a sestava střižníku (text) ──
  let log = '';
  for (const t of [
    'nový díl Spodní deska\nkvádr 200 120 30',
    'nový díl Horní deska\nkvádr 200 120 30\nválec 21 10 v 40 30 0 odebrat\nválec 21 10 v 160 30 0 odebrat\nválec 21 10 v 40 90 0 odebrat\nválec 21 10 v 160 90 0 odebrat',
    'nový díl Stírací deska\nkvádr 200 120 15',
  ]) log += await run(t);
  ok(!/^✗/m.test(log), 'díly: spodní deska, horní deska se 4 kapsami Ø21 hl. 10, stírací deska');
  log = await run([
    'nová sestava Střižník',
    'vložit "Spodní deska" ukotvit',
    'vložit "Stírací deska" v 0 0 45',
    'vložit "Horní deska" v 0 0 85',
    'sestava vazba vzdálenost "Horní deska" spodní "Spodní deska" horní hodnota 55 název "LIS"',
    'sestava vazba mez-vzdálenosti "Stírací deska" horní "Horní deska" spodní min 5 max 25 název "Doraz stírače"',
    'sestava vazba mez-vzdálenosti "Stírací deska" spodní "Spodní deska" horní min 0 max 500 název "Matrice"',
  ].join('\n'));
  ok(!/^✗/m.test(log), 'sestava Střižník: vazba LIS 55 mm a dvě meze vzdálenosti stírací desky\n' + log.split('\n').filter((l) => /vazba|✗/.test(l)).join('\n'));

  // ── GUI: Sestava › Pružina mezi díly ──
  await p.getByRole('button', { name: 'Sestava', exact: true }).first().click().catch(() => {});
  const btn = p.locator('button', { hasText: 'Pružina mezi díly' }).first();
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  const pickA = p.locator('[data-spring-pick="a"]');
  await pickA.waitFor({ timeout: 20000 });
  await pickA.locator('[data-spring-comp]').selectOption({ label: 'Horní deska' });
  const holeRow = pickA.locator('[data-spring-face]').filter({ hasText: 'Ø21' }).first();
  await holeRow.waitFor({ timeout: 60000 });
  ok(await pickA.locator('[data-spring-face]').filter({ hasText: 'Ø21' }).count() >= 4, 'krok A: seznam ploch horní desky nabízí 4 kapsy Ø21');
  await holeRow.click();
  const pickB = p.locator('[data-spring-pick="b"]');
  await pickB.waitFor({ timeout: 20000 });
  ok(/díra Ø21/.test(await pickB.locator('[data-spring-chosen]').innerText()), 'krok B: vybraná plocha A = díra Ø21');
  await pickB.locator('[data-spring-comp]').selectOption({ label: 'Stírací deska' });
  const topRow = pickB.locator('[data-spring-face]').filter({ hasText: 'rovinná +Z' }).first();
  await topRow.waitFor({ timeout: 60000 });
  await topRow.click();
  const dlg = p.locator('[data-spring-between]');
  await dlg.waitFor({ timeout: 20000 });
  const head = await dlg.innerText();
  ok(/vzdálenost dosedacích ploch 35 mm/.test(head), 'tabulka: vzdálenost dosedacích ploch 35 mm (dno kapsy → horní plocha stírače) – ' + line(head, /vzdálenost/));
  const val = async (k) => num(await dlg.locator(`[data-spring-row="${k}"]`).inputValue());
  const pre = { d: await val('d'), De: await val('De'), L0: await val('L0'), n: await val('n') };
  ok(pre.De === 19.5 && pre.d === 2 && pre.L0 === 41 && pre.n === 7.5, 'tabulka předvyplněná podle díry Ø21: ' + JSON.stringify(pre));
  const calcRow = async (k) => (await dlg.locator(`[data-spring-calc-row="${k}"]`).innerText()).trim();
  const R = num((await calcRow('R')).split(' ')[0]);
  ok(Math.abs(R - (81500 * 16) / (8 * 17.5 ** 3 * 7.5)) < 0.01, 'spočtená tuhost R = G·d⁴/(8·D³·n) = ' + (await calcRow('R')));
  ok(/^19 mm$/.test(await calcRow('Ln')) && /^24,3 N$/.test(await calcRow('F')), `Ln a síla při montáži: ${await calcRow('Ln')} · ${await calcRow('F')}`);
  ok(await dlg.locator('[data-spring-holes]').isChecked(), 'zaškrtnuto „Do všech děr vzoru“ (vybraná díra)');
  // změna v tabulce se hned přepočítá
  await dlg.locator('[data-spring-row="n"]').fill('7');
  ok(/^18 mm$/.test(await calcRow('Ln')), 'n 7 → Ln = (n + 2)·d = 18 mm (živý přepočet): ' + (await calcRow('Ln')));
  await dlg.locator('[data-spring-row="n"]').fill('7.5');
  // psaní z klávesnice (recenze: čárka / tečka se dřív smazala, „1,8“ → 18): Ctrl+A, Backspace, znak po znaku
  const typeIn = async (k, text) => {
    const el = dlg.locator(`[data-spring-row="${k}"]`);
    await el.click();
    await p.keyboard.press('Control+A');
    await p.keyboard.press('Backspace');
    await p.keyboard.type(text, { delay: 30 });
  };
  const typed = {};
  for (const [k, t, v] of [['d', '1,8', 1.8], ['De', '19,5', 19.5], ['L0', '42,5', 42.5], ['n', '7,5', 7.5], ['d', '1.8', 1.8]]) {
    await typeIn(k, t);
    typed[k + ' ' + t] = [await dlg.locator(`[data-spring-row="${k}"]`).inputValue(), await val(k)];
    ok((await val(k)) === v, `klávesnice: ${k} „${t}“ → pole „${await dlg.locator(`[data-spring-row="${k}"]`).inputValue()}“`);
  }
  // R = G·d⁴/(8·D³·n) pro d 1,8 · De 19,5 · n 7,5 (D 17,7) – ne pro d 18
  const R18 = (81500 * 1.8 ** 4) / (8 * 17.7 ** 3 * 7.5);
  ok(Math.abs(num((await calcRow('R')).split(' ')[0]) - R18) < 0.01, `tabulka počítá s d 1,8: R ${await calcRow('R')} (≈ ${R18.toFixed(3)} N/mm)`);
  await typeIn('rate', '0,5');
  ok(/^0,5 N\/mm$/.test(await calcRow('R')), 'ruční tuhost „0,5“ z klávesnice: ' + (await calcRow('R')));
  await typeIn('rate', '4,5');
  ok(/^4,5 N\/mm$/.test(await calcRow('R')), 'ruční tuhost „4,5“: ' + (await calcRow('R')));
  await typeIn('rate', '');
  ok(Math.abs(num((await calcRow('R')).split(' ')[0]) - R18) < 0.01, 'prázdná tuhost = spočtená: ' + (await calcRow('R')));
  // kontrola EN 13906-1 v tabulce: přetížená pružina d 3 · n 4 (recenze: dřív bez ⚠) a L0 17 < Ln 18 (✗, Vytvořit zakázáno)
  await typeIn('d', '3');
  await typeIn('L0', '41');
  await typeIn('n', '4');
  let issues = (await dlg.locator('[data-spring-issue]').allInnerTexts()).join(' | ');
  // integrace vlny 21: statická kontrola jako výpočet pružiny z tabulky (τn bez korekce 179 %), τkn = k·τn 226 % jako řádek tabulky
  ok(/⚠ na doraz Ln by napětí bylo 179 % dovoleného/.test(issues) && /179 %/.test(await calcRow('τn')) && /226 %/.test(await calcRow('τkn')), 'tabulka: d 3 · n 4 → ⚠ napětí na dorazu τn 179 % (' + (await calcRow('τn')) + ', τkn ' + (await calcRow('τkn')) + ') – ' + issues);
  ok(/^19,74 mm$/.test(await calcRow('Ln+Sa')), 'tabulka: nejmenší pracovní délka Ln + Sa = 19,74 mm: ' + (await calcRow('Ln+Sa')));
  await typeIn('L0', '17');
  issues = (await dlg.locator('[data-spring-issue]').allInnerTexts()).join(' | ');
  ok(/✗ volná délka L0 17 mm není větší než délka na doraz Ln 18 mm/.test(issues) && (await dlg.locator('[data-spring-create]').isDisabled()), 'tabulka: L0 17 < Ln 18 → ✗ a Vytvořit zakázáno – ' + issues.slice(0, 160));
  for (const [k, t] of [['d', '2'], ['De', '19,5'], ['L0', '41'], ['n', '7,5']]) await typeIn(k, t);
  ok((await val('d')) === 2 && (await val('L0')) === 41 && (await val('n')) === 7.5 && !(await dlg.locator('[data-spring-create]').isDisabled()), 'tabulka zpět na 2 × 19,5 × 41, n 7,5');
  const before = (await p.evaluate(() => window.mncad.getDocument())).components.length;
  await dlg.locator('[data-spring-create]').click();
  await dlg.waitFor({ state: 'detached', timeout: 180000 });
  let d = await p.evaluate(() => window.mncad.getDocument());
  const springs = d.components.filter((c) => c.spring);
  ok(d.components.length === before + 4 && springs.length === 4, `Vytvořit: 4 pružiny vloženy (${d.components.length - before})`);
  const up = d.components.find((c) => c.name === 'Horní deska');
  ok(springs.every((s) => d.mates.some((m) => m.type === 'lock' && m.a.compId === s.id && m.b.compId === up.id)), 'každá pružina má zámek k horní desce');
  ok(springs.every((s) => s.spring.free === 41 && Math.abs(s.spring.length - 35) < 1e-3 && s.spring.solid === 19), 'SpringDef: L0 41, délka 35 mm, Ln 19 – ' + JSON.stringify(springs[0].spring).slice(0, 160));
  log = await run('sestava pružiny');
  ok(/✓ pružina „Pružina 2×19,5×41“: délka 35 mm · L0 41 · Ln 19 · stlačení 6 mm · síla 24,3\d* N .*\(4×\)/.test(log), 'sestava pružiny: 4× 35 mm / 24,3 N – ' + line(log, /pružina „/));

  // ── kinematika zůstává výchozí ──
  log = await run('pohyb motor lineární vazba "LIS" 55..25 tam a zpět kroky 20');
  ok(/lineární motor · LIS .* 55…25 mm tam a zpět/.test(log) && /Pohybová studie: 20 kroků/.test(log) && !/Dynamika:/.test(log), 'kinematická studie (výchozí) s motorem tam a zpět: ' + line(log, /^Pohybová studie: 20/));
  ok(/„Horní deska“|Horní deska: rozsah pohybu X 0 · Y 0 · Z 30 mm/.test(log), 'kinematika: horní deska zdvih 30 mm – ' + line(log, /Horní deska: rozsah/));

  // ── dynamika textem ──
  log = await run('pohyb hmotnost "Stírací deska" 2,4\npohyb dynamika čas 0,5 krok 0,0005 gravitace -Z tlumení 0,05 odraz 0,2');
  const dynLine = line(log, /^Dynamika: 0,5 s/);
  ok(/krok 0,5 ms · 1000 kroků · gravitace −Z · tlumení 0,05 N·s\/mm · odraz 0,2/.test(dynLine), 'pohyb dynamika: ' + dynLine);
  ok(/„Stírací deska“ 2,4 kg \(zadaná\): zdvih Z/.test(log), 'stírací deska 2,4 kg ručně: ' + line(log, /„Stírací deska“ 2,4/));
  const fmax = line(log, /Největší síla pružiny/);
  const F = num((/„[^“]+“ ([\d,]+) N/.exec(fmax) || [])[1]);
  // stlačení: mezera 25 → 10 mm (zdvih 30, dosednutí po 15 mm) → délka 35 → 20 → F = R·(41 − 20)
  const Rr = (81500 * 16) / (8 * 17.5 ** 3 * 7.5);
  ok(Math.abs(F - Rr * 21) / (Rr * 21) < 0.03, `největší síla pružiny ≈ R·(L0 − 20) = ${(Rr * 21).toFixed(1)} N: ${fmax}`);
  const back = line(log, /návrat na doraz v t = /);
  const tBack = num((/t = ([\d,]+) s/.exec(back) || [])[1]);
  // horní deska: 55 − 15·(1 − cos 4πt); stírač dosedne při LIS 40 → cos = 0 → t = 0,125 s; návrat 0,375 s
  ok(Math.abs(tBack - 0.375) < 0.01, 'stírač se vrátí na doraz v t ≈ 0,375 s: ' + back);
  ok(/doraz „Matrice Stírací deska → Spodní deska“ \(min 0 mm\): dotyk 0,12\d*–0,37\d* s · nárazy/.test(log), 'dotyk s matricí 0,125–0,375 s: ' + line(log, /doraz „Matrice/));
  ok(/Energie: na začátku/.test(log), 'energie: s motorem bez kontroly bilance – ' + line(log, /Energie:/));
  // recenze: kontrola pružin v souhrnu pohybu (stlačení na 20 mm < Ln + Sa 22,22) a a max bez rázu na dorazu
  ok(/⚠ pružina „Pružina 2×19,5×41“: .*pracovní délka 20(,\d+)? mm je pod nejmenší přípustnou Ln \+ Sa = 22,22 mm .*závity se dotýkají/.test(log), 'souhrn pružin: ⚠ závity se dotýkají – ' + line(log, /pružina „Pružina 2×19,5×41“: délka/).slice(0, 220));
  const aLine = line(log, /„Stírací deska“ 2,4 kg \(zadaná\): zdvih/);
  const aMax = num((/a max ([\d,]+) m\/s²/.exec(aLine) || [])[1]);
  ok(/\(bez rázů na dorazech\)/.test(aLine) && aMax < 100, 'a max stírače bez rázu (dřív 452 m/s² = skok rychlosti / dt): ' + aLine);

  // ── panel Pohybová studie › Dynamika: graf a CSV ──
  const panel = p.locator('[data-motion-panel]');
  await panel.waitFor({ timeout: 30000 });
  ok(/font-semibold/.test(await panel.locator('[data-motion-mode-btn="dyn"]').getAttribute('class')), 'panel: přepínač na Dynamika');
  ok(await panel.locator('[data-motion-dyn]').isVisible(), 'panel: nastavení dynamiky (krok, gravitace, tlumení, hmotnosti, síly)');
  const massIn = panel.locator('[data-motion-mass="Stírací deska"]');
  ok((await massIn.inputValue()) === '2.4', 'panel: ruční hmotnost stírací desky 2,4 kg');
  if (!(await panel.locator('[data-motion-chart]').isVisible().catch(() => false))) await panel.locator('[data-motion-run]').click();
  await panel.locator('[data-motion-chart]').waitFor({ timeout: 180000 });
  const series = await panel.locator('[data-motion-chart] polyline[data-series]').count();
  ok(series >= 1, `graf polohy: ${series} řad (${await panel.locator('[data-motion-chart] polyline').first().getAttribute('data-series')})`);
  await panel.locator('[data-motion-chart-btn="force"]').click();
  await panel.locator('[data-motion-chart="force"]').waitFor({ timeout: 10000 });
  ok(/Pružina 2×19,5×41/.test(await panel.locator('[data-motion-chart="force"]').innerText()), 'graf sil pružin: 4 stejné pružiny jednou řadou');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), panel.locator('[data-motion-export="csv"]').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const h = csv.replace(/^﻿/, '').split('\r\n')[0];
  ok(/Stírací deska těžiště Z \[mm\];Stírací deska vZ \[mm\/s\];Stírací deska aZ \[m\/s²\]/.test(h) && / F \[N\]/.test(h), 'CSV: těžiště, rychlost a zrychlení stírače + síly pružin: …' + h.slice(-120));
  ok(csv.split('\r\n').length > 300, 'CSV: ' + (csv.split('\r\n').length - 2) + ' řádků (snímky)');

  // přehrávání: krok s nejvíc stlačenými pružinami – pružiny jsou v okně jako síť drátu v délce kroku (bez stavby v jádře),
  // softwarový náhled počítá jejich trojúhelníky (4 × ~3 000); snímek pro ruční kontrolu jen s E2E_SHOTS=adresář
  const tris = async () => num(((await p.locator('body').innerText()).match(/Softwarový náhled · ([\d\s ]+) trojúhelník/) || [, '0'])[1].replace(/[\s ]/g, ''));
  log = await run('pohyb krok 166');
  await p.waitForTimeout(2500);
  const t166 = await tris();
  ok(/Krok 166 \(t = 0,2/.test(log) && t166 > 10000, `pohyb krok 166: pružiny v okně jako síť drátu v délce kroku – ${t166} trojúhelníků (${line(log, /^Krok 166/)})`);
  if (process.env.E2E_SHOTS) await p.screenshot({ path: process.env.E2E_SHOTS + '/w21-motion-step166.png' });
  // ── window.mncad.motion({ mode: "dynamic" }) a EN text ──
  const api = await p.evaluate(() => window.mncad.motion({ mode: 'dynamic', duration: 0.5, dt: 0.0005, restitution: 0.2 }));
  ok(api.dynamic && api.dynamic.springMax && Math.abs(api.dynamic.springMax.force - Rr * 21) / (Rr * 21) < 0.03 && api.steps.length > 300 && api.steps[10].dyn, 'mncad.motion({mode:"dynamic"}): springMax ' + (api.dynamic && api.dynamic.springMax && api.dynamic.springMax.force.toFixed(1)) + ' N, kroky ' + api.steps.length);
  log = await run('motion kinematics');
  ok(/kinematika/.test(log) && !/^Dynamika:/m.test(log), 'motion kinematics → zpět na kinematiku: ' + line(log, /kinematika/));
  log = await run('pohyb stav');
  ok(/Pohybová studie: 20 kroků/.test(log), 'pohyb stav po kinematice: ' + line(log, /^Pohybová studie: 20/));

  // ── text: jedna pružina do kapsy a pak „do děr vzoru“ (stírač na 6 pružinách) ──
  log = await run('nový díl Deska 6 kapes\nkvádr 200 120 30' + [30, 100, 170].flatMap((x) => [30, 90].map((y) => `\nválec 21 10 v ${x} ${y} 0 odebrat`)).join(''));
  log = await run([
    'nová sestava Stírač 6',
    'vložit "Stírací deska" ukotvit',
    'vložit "Deska 6 kapes" v 0 0 40',
    'sestava pružina nová mezi "Deska 6 kapes" Ø21 "Stírací deska" horní',
  ].join('\n'));
  ok(/✓ nová pružina „Pružina 2×19,5×41“ 1× .* – zámek ke komponentě „Deska 6 kapes“/.test(log) && /✓ pružina „Pružina 2×19,5×41“: délka 35 mm/.test(log), 'text: nová pružina do kapsy Ø21: ' + line(log, /✓ nová pružina/));
  log = await run('sestava pružina "Pružina 2×19,5×41" mezi "Deska 6 kapes" "Stírací deska" do děr vzoru');
  ok(/do děr vzoru F\d+(\/F\d+){5} Ø21 komponenty „Deska 6 kapes“: \+5 kopií \(zámek k „Deska 6 kapes“\)/.test(log) && /✓ pružina „Pružina 2×19,5×41“: délka 35 mm · L0 41 · Ln 19 · stlačení 6 mm · síla 24,3 N \(c 4,055 N\/mm\) \(6×\)/.test(log), 'do děr vzoru: 6 pružin jedním příkazem – ' + line(log, /do děr vzoru/) + ' · ' + line(log, /síla 24,3 N .*\(6×\)/));
  d = await p.evaluate(() => window.mncad.getDocument());
  ok(d.components.filter((c) => c.spring).length === 6 && d.mates.filter((m) => m.type === 'lock').length === 6, 'sestava Stírač 6: 6 pružin, 6 zámků');

  // ── pérový kolík zaskočí do díry (2. příklad, fyzicky možná pružina – recenze: dřív 0,8×7×20 n 6 v montáži 4 mm < Ln 6,4):
  //    pouzdro s vývrtem Ø8,2 (dno z = 5), kolík Ø8 × 30 zatlačený 14 mm nad dnem vývrtu, pružina 0,8 × 7 × 30, n 11 (tuhost a Ln
  //    z tabulky), zdvih 13…24 mm; uvolněný kolík vystřelí na doraz 24 mm ──
  log = await run('sestava pružina nápověda');
  ok(/Pružina v sestavě – příkazy/.test(log) && /sestava pružina nová/.test(log) && !/^✗/m.test(log), 'sestava pružina nápověda: ' + line(log, /Pružina v sestavě/));
  for (const t of ['nový díl Pouzdro\nkvádr 30 30 40\nválec 8,2 35 v 15 15 5 odebrat', 'nový díl Kolík\nválec 8 30']) log = await run(t);
  log = await run([
    'nová sestava Západka',
    'vložit "Pouzdro" ukotvit',
    'vložit "Kolík" v 15 15 19',
    'sestava vazba souosost "Kolík" "Pouzdro"',
    'sestava vazba mez-vzdálenosti "Kolík" spodní "Pouzdro" nejmenší +Z min 13 max 24 název "Zdvih"',
    'sestava pružina nová d 0,8 De 7 L0 30 n 11 mezi "Pouzdro" nejmenší +Z "Kolík" spodní',
  ].join('\n'));
  ok(!/^[✗⚠]/m.test(log) && /✓ pružina „Pružina 0,8×7×30“: délka 14 mm · L0 30 · Ln 10,4 · stlačení 16 mm · síla 25,5 N \(c 1,592 N\/mm\)/.test(log), 'západka: souosost, zdvih 13…24 mm, nová pružina textem (14 mm, 25,5 N, bez ⚠): ' + line(log, /✓ pružina „/) + '\n' + log.split('\n').filter((l) => /^[✗⚠]/.test(l)).join('\n'));
  log = await run('pohyb dynamika čas 0,02 krok 0,00002 gravitace -Z odraz 0');
  const zd = line(log, /doraz „Zdvih/);
  const v = num((/nárazy ([\d,]+) m\/s/.exec(zd) || [])[1]);
  const tz = num((/\(t = ([\d,]+) s\)/.exec(zd) || [])[1]);
  // kolík m = π·4²·30·7,85e-6 = 0,011844 kg, R = 81 500·0,8⁴/(8·6,2³·11) = 1,5917 N/mm: L(t) = 30 − 16·cos(ω·t), ω = √(R/m) = 366,6 rad/s
  // → L = 24 v t = acos(6/16)/ω = 3,24 ms; ½·m·v² = ½·R·(16² − 6²) − m·g·10 mm → v = 5,42 m/s
  const mK = Math.PI * 16 * 30 * 7.85e-6;
  const RK = (81500 * 0.8 ** 4) / (8 * 6.2 ** 3 * 11);
  const vK = Math.sqrt((2 * (0.5 * RK * 1000 * (0.016 ** 2 - 0.006 ** 2) - mK * 9.81 * 0.01)) / mK);
  const tK = Math.acos(6 / 16) / Math.sqrt((RK * 1000) / mK);
  ok(Math.abs(v - vK) / vK < 0.02 && Math.abs(tz - tK) < 0.0001, `kolík zaskočí: náraz ${v} m/s v t = ${tz} s (analyticky ${vK.toFixed(2)} m/s, ${(tK * 1000).toFixed(2)} ms) – ${zd}`);
  ok(/„Kolík“ 0,011\d* kg \(z objemu × hustoty\)/.test(log), 'hmotnost kolíku z objemu: ' + line(log, /„Kolík“ 0,0/));
  ok(/✓ pružina „Pružina 0,8×7×30“: délka 14 → 24 mm/.test(log), 'souhrn pružiny kolíku ✓ (bez dotyku závitů a přetížení): ' + line(log, /pružina „Pružina 0,8×7×30“: délka/));
  // hodnota zatížení v panelu Dynamika z klávesnice (recenze: „12,5“ → 125)
  const loadIn = p.locator('[data-motion-panel] [aria-label="Hodnota zatížení"]');
  await loadIn.waitFor({ timeout: 30000 });
  await loadIn.click();
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Backspace');
  await p.keyboard.type('12,5', { delay: 30 });
  ok((await loadIn.inputValue()) === '12,5', 'hodnota zatížení „12,5“ z klávesnice zůstane v poli: ' + (await loadIn.inputValue()));
  await p.locator('[data-motion-panel] button').filter({ hasText: /^Přidat$/ }).first().click();
  await p.waitForTimeout(500);
  const loads = (await p.evaluate(() => window.mncad.getDocument())).motion?.dyn?.loads ?? [];
  ok(loads.length === 1 && loads[0].value === 12.5, 'Přidat: síla 12,5 N na vazbě – ' + JSON.stringify(loads));
  ok(errs.length === 0, 'bez chyb stránky: ' + errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
