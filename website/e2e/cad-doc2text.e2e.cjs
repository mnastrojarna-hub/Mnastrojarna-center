// E2E: dokument → textový skript a zpět (vlna 17, balík doc2text – src/cad/doc-script.ts) na produkčním sestavení:
//  A) díl vytvořený KLIKÁNÍM (pás karet Kvádr, Válec) → Data ▸ Export ▸ Textový skript (.txt) → stažený soubor = window.mncad.script()
//     → text vložený do konzole (Provést) → nová záložka se STEJNÝM objemem, stejnými typy a názvy prvků
//  B) díl s proměnnou, vazbou parametru, skicou na ploše a potlačeným prvkem (operace, které zkušební stroj v Node nemá)
//     → skript → stejný objem, vazba parametru, potlačení
//  C) sestava se dvěma díly, vložením 3×, vazbami (souosost, vzdálenost, zámek), pohybovou studií a výkresem dílu → skript →
//     stejný počet komponent, polohy, vazby splněny, kusovník, listy výkresu
//  D) příkaz konzole `export skript` stáhne <název>.mncad.txt a vypíše řádky, velikost a pokrytí; v anglickém rozhraní
//     `export script` dá anglická klíčová slova; `export skript de` německá
//  E) nálezy kontroly – každý případ: dokument v jednom sezení → window.mncad.script() → NOVÉ sezení (čisté úložiště, jiný
//     jazyk rozhraní tam, kde na něm záleží) → stejný model bez ✗: odkazy na pomocnou rovinu / osu uvnitř prvku, zastaralá
//     čísla hran a plochy skici (prvek přesunutý před výběr), díl s výchozím názvem v sestavě, český skript v anglickém
//     rozhraní a export pro en / de, pořadí proměnných, „#“ a „//“ v názvech, závěs s dosedacími rovinami a motorem,
//     smazané vygenerované kóty, výraz vazby s mezerami, stejné názvy prvků, skica založená klikem na plochu
// Spuštění: E2E_BASE=http://localhost:3442 node e2e/cad-doc2text.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-doc2text').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const ready = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro') && !document.body.innerText.includes('Loading'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};
const num = (s) => parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
const volumeOf = (status) => { const m = /(?:objem|volume) (?:Σ )?([\d\s  .,]+) cm³/.exec(status); return m ? num(m[1]) : NaN; };
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  const dl = [];
  const dialogs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('download', (d) => dl.push(d));
  p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const nextDownload = async (n, ms = 120000) => {
    const t0 = Date.now();
    while (dl.length < n && Date.now() - t0 < ms) await p.waitForTimeout(200);
    const d = dl[n - 1];
    if (!d) return null;
    const path = S + d.suggestedFilename();
    await d.saveAs(path);
    return { name: d.suggestedFilename(), path, text: fs.readFileSync(path, 'utf8') };
  };
  const run = (t) => p.evaluate((x) => window.mncad.run(x), t);
  const docOf = () => p.evaluate(() => window.mncad.getDocument());
  const status = () => p.evaluate(() => window.mncad.status());
  const tabs = () => p.evaluate(() => window.mncad.tabs());
  /** přesný objem tělesa z jádra [mm³] (příkaz měřit těleso) – stav dokumentu ho zaokrouhluje na 0,01 cm³ */
  const exactVolume = async () => (await p.evaluate(() => window.mncad.measure('těleso'))).volume;
  /** po běhu, který otevírá novou záložku, počká na její dokument */
  const settle = async (name) => { await p.waitForFunction((n) => window.mncad.getDocument().name === n, name, { timeout: 120000 }); await p.waitForTimeout(600); };
  await ready(p, BASE + '/cad');

  // ════════════ A) model klikáním → skript → vložit do konzole → stejný objem ════════════
  await run('nový díl Klikaný');
  await settle('Klikaný');
  const clickCreate = async (label) => {
    await p.getByRole('button', { name: 'Vytvořit', exact: true }).first().click().catch(() => {});
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: label, exact: true }).first().click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'OK', exact: true }).click();
    await p.waitForTimeout(900);
  };
  await clickCreate('Kvádr');
  await clickCreate('Válec');
  const dA = await docOf();
  ok(dA.features.length === 2 && dA.features[0].type === 'box' && dA.features[1].type === 'cylinder', `A: díl vytvořený klikáním má 2 prvky (${dA.features.map((f) => f.type).join(', ')})`);
  const vA = volumeOf(await status());
  ok(vA > 0, `A: objem dílu z klikání ${vA} cm³`);
  const xA = await exactVolume();
  // Data ▸ Export ▸ Textový skript (.txt)
  await p.getByRole('button', { name: 'Data', exact: true }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Export/ }).first().click();
  await p.waitForTimeout(400);
  const item = p.getByText('Textový skript (.txt)', { exact: true }).first();
  ok(await item.isVisible({ timeout: 5000 }).catch(() => false), 'A: nabídka Data ▸ Export obsahuje „Textový skript (.txt)“');
  // mikronávod položky (cs)
  await item.hover();
  await p.waitForTimeout(1500);
  ok(await p.getByText('Uloží dokument jako textový skript', { exact: false }).first().isVisible({ timeout: 4000 }).catch(() => false), 'A: mikronávod položky „Textový skript“ se zobrazí po najetí myší');
  await item.click();
  const f1 = await nextDownload(1);
  const apiText = await p.evaluate(() => window.mncad.script());
  ok(!!f1 && f1.name === 'Klikany.mncad.txt', `A: klik stáhl soubor ${f1 && f1.name}`);
  ok(!!f1 && f1.text === apiText, 'A: stažený soubor = window.mncad.script()');
  ok(/^nový díl "Klikaný"$/m.test(apiText) && /^kvádr /m.test(apiText) && /^válec /m.test(apiText) && !/^[{[]/m.test(apiText), 'A: skript má vlastní příkazy (nový díl, kvádr, válec), žádný JSON');
  ok(apiText === (await p.evaluate(() => window.mncad.script())), 'A: stejný dokument → stejný text');
  // vložit do konzole → nová záložka
  await p.evaluate(() => window.mncad.openConsole());
  const input = p.getByLabel('Textové příkazy nebo JSON');
  await input.waitFor({ timeout: 20000 });
  const out = p.locator('[data-agent-output]');
  const consoleRun = async (text, ms = 240000) => {
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev && o.textContent.length > 0; }, before, { timeout: ms });
    return out.innerText();
  };
  const tabsBefore = (await tabs()).length;
  const logA = await consoleRun(apiText.replace('"Klikaný"', '"Klikaný zpět"'));
  await settle('Klikaný zpět');
  ok(!/^✗/m.test(logA), 'A: vložený skript proběhl v konzoli bez ✗');
  ok((await tabs()).length === tabsBefore + 1, 'A: skript otevřel novou záložku');
  const dA2 = await docOf();
  const vA2 = volumeOf(await status());
  const xA2 = await exactVolume();
  ok(rel(vA, vA2) < 1e-6 && xA > 0 && rel(xA, xA2) < 1e-9, `A: stejný objem po kontrole tam a zpět (${vA} → ${vA2} cm³; jádro ${xA} → ${xA2} mm³)`);
  ok(JSON.stringify(dA2.features.map((f) => [f.type, f.name])) === JSON.stringify(dA.features.map((f) => [f.type, f.name])), 'A: stejné typy a názvy prvků');

  // ════════════ B) proměnná, vazba parametru, skica na ploše, potlačený prvek ════════════
  let log = await run(['nový díl Parametrický', 'proměnná H = 12', 'kvádr 60 40 10', 'upravit "Kvádr 1" size.2==H', 'skica plocha horní: kružnice 16 v 30 20', 'vysunout 5', 'díra 6 skrz v 10 10 12', 'díra 4 hloubka 5 v 50 30 12', 'potlačit "Díra 1"', 'zaoblit 2 hrany svislé'].join('\n'));
  await settle('Parametrický');
  ok(!/^✗/m.test(log), 'B: díl s proměnnou, skicou na ploše a potlačenou dírou vznikl bez ✗');
  const dB = await docOf();
  const vB = volumeOf(await status());
  const xB = await exactVolume();
  const sB = await p.evaluate(() => window.mncad.script());
  ok(/^proměnná H = 12$/m.test(sB) && /^upravit poslední size\.2==H$/m.test(sB) && /^skica plocha F\d+$/m.test(sB) && /^potlačit poslední$/m.test(sB) && /^zaoblit 2 hrany E\d+( E\d+)+$/m.test(sB), 'B: skript má proměnnou, vazbu parametru a potlačení na poslední prvek, skicu na ploše F a hrany čísly (ověřené jádrem)');
  log = await run(sB.replace('"Parametrický"', '"Parametrický zpět"'));
  await settle('Parametrický zpět');
  ok(!/^✗/m.test(log), 'B: skript proběhl bez ✗');
  const dB2 = await docOf();
  const vB2 = volumeOf(await status());
  const xB2 = await exactVolume();
  ok(rel(vB, vB2) < 1e-6 && xB > 0 && rel(xB, xB2) < 1e-9, `B: stejný objem (${vB} → ${vB2} cm³; jádro ${xB} → ${xB2} mm³)`);
  ok(JSON.stringify(dB2.features.map((f) => [f.type, f.name, !!f.suppressed])) === JSON.stringify(dB.features.map((f) => [f.type, f.name, !!f.suppressed])), 'B: stejné prvky včetně potlačení');
  ok(JSON.stringify(Object.values(dB2.bindings || {})) === JSON.stringify(Object.values(dB.bindings || {})) && Object.keys(dB2.bindings || {}).length === 1 && dB2.variables[0].expr === '12', 'B: proměnná a vazba parametru přenesena');
  const skB = dB.features.find((f) => f.type === 'sketch');
  const skB2 = dB2.features.find((f) => f.type === 'sketch');
  ok(!!skB.planeDef && JSON.stringify({ ...skB2.planeDef, ref: { ...skB2.planeDef.ref, sig: 0 } }) === JSON.stringify({ ...skB.planeDef, ref: { ...skB.planeDef.ref, sig: 0 } }) && JSON.stringify(skB2.plane) === JSON.stringify(skB.plane), 'B: skica na ploše má stejnou plochu a stejnou vyřešenou rovinu');

  // ════════════ C) sestava: díly, vložení, vazby, pohyb, výkres ════════════
  log = await run([
    'nový díl Deska', 'kvádr 120 80 15', 'díra 10 skrz v 30 40 15', 'díra 10 skrz v 90 40 15', 'výkres A3 pohledy přední,horní', 'kótovat chytře', 'výkres razítko číslo="MN-17-01" kreslil="e2e"',
    'nový díl Čep', 'válec 10 40', 'srazit 1 hrany horní',
    'nová sestava Přípravek',
    'vložit "Deska" ukotvit', 'vložit "Čep" v 30 40 0', 'vložit "Čep" v 90 40 0', 'vložit "Čep" v 200 0 0 otočení 0 90 0',
    'sestava komponenta #4 skupina "Náhradní" číslo "N-4"',
    'sestava vazba souosost #2 válcová #1 Ø10',
    'sestava vazba vzdálenost #2 -Z #1 -Z hodnota 5 název "Vůle čepu"',
    'sestava vazba zámek #3 #1',
    'pohyb motor lineární vazba 2 5..15 kroky 4 čas 1',
  ].join('\n'));
  await settle('Přípravek');
  ok(!/^✗/m.test(log), 'C: sestava se dvěma díly, 4 komponentami, 3 vazbami a pohybem vznikla bez ✗');
  const dC = await docOf();
  const stC = await status();
  const bomC = await p.evaluate(() => window.mncad.bom());
  const sC = await p.evaluate(() => window.mncad.script());
  fs.writeFileSync(S + 'pripravek.mncad.txt', sC);
  ok((sC.match(/^nový díl /gm) || []).length === 2 && (sC.match(/^vložit /gm) || []).length === 4 && (sC.match(/^sestava vazba /gm) || []).length === 3 && /^pohyb motor lineární vazba 2 5\.\.15 kroky 4 čas 1$/m.test(sC) && /^výkres A3 pohledy přední,horní$/m.test(sC) && /^kótovat chytře$/m.test(sC), 'C: skript: 2 díly (Čep jednou, vložen 3×), 4× vložit, 3 vazby, pohyb, výkres dílu');
  log = await run(sC.replace('nová sestava "Přípravek"', 'nová sestava "Přípravek zpět"'));
  await settle('Přípravek zpět');
  ok(!/^✗/m.test(log), 'C: skript sestavy proběhl bez ✗');
  const dC2 = await docOf();
  const stC2 = await status();
  const bomC2 = await p.evaluate(() => window.mncad.bom());
  ok(dC2.components.length === 4, `C: 4 komponenty (${dC2.components.length})`);
  const placeMax = Math.max(...dC.components.flatMap((c, i) => ['position', 'rotation'].flatMap((k) => c.placement[k].map((v, j) => Math.abs(v - dC2.components[i].placement[k][j])))));
  ok(placeMax < 1e-6, `C: polohy komponent stejné (největší rozdíl ${placeMax})`);
  ok(JSON.stringify(dC2.components.map((c) => [c.name, !!c.fixed, c.group || '', c.number || ''])) === JSON.stringify(dC.components.map((c) => [c.name, !!c.fixed, c.group || '', c.number || ''])), 'C: názvy, ukotvení, skupina a číslo komponent');
  const mateSig = (d) => d.mates.map((m) => [m.type, d.components.findIndex((c) => c.id === m.a.compId), m.a.face, d.components.findIndex((c) => c.id === m.b.compId), m.b.face, m.value ?? null, !!m.flip, m.name || '']);
  ok(JSON.stringify(mateSig(dC2)) === JSON.stringify(mateSig(dC)), 'C: vazby – typ, komponenty, plochy, hodnota, orientace, název');
  const matesLine = (s) => (/^(Vazby|Mates)[^\n]*/m.exec(s) || [''])[0];
  ok(matesLine(stC2) === matesLine(stC) && /3/.test(matesLine(stC2)), `C: stav vazeb stejný („${matesLine(stC2)}“)`);
  ok(rel(volumeOf(stC), volumeOf(stC2)) < 1e-6 && volumeOf(stC2) > 0, `C: objem Σ sestavy stejný (${volumeOf(stC)} → ${volumeOf(stC2)} cm³)`);
  ok(JSON.stringify(bomC2.rows.map((r) => [r.name, r.number || '', r.qty])) === JSON.stringify(bomC.rows.map((r) => [r.name, r.number || '', r.qty])) && bomC.rows.every((r, i) => rel(r.massKg || 0, bomC2.rows[i].massKg || 0) < 1e-6), 'C: kusovník (název, číslo, kusy, hmotnost)');
  ok(JSON.stringify(dC2.motion && [dC2.motion.motors.map((m) => [m.kind, m.from, m.to]), dC2.motion.steps, dC2.motion.duration]) === JSON.stringify([dC.motion.motors.map((m) => [m.kind, m.from, m.to]), dC.motion.steps, dC.motion.duration]), 'C: pohybová studie (motor, rozsah, kroky, čas)');
  const sheetsOf = (d) => d.components.map((c) => (c.source.doc.drawings || []).map((s) => [s.name, s.options.sheet, s.options.views.front, s.options.views.top, s.options.views.iso, s.options.dimensions, s.meta.number || '', s.annotations.filter((a) => a.auto).length > 0]));
  ok(JSON.stringify(sheetsOf(dC2)) === JSON.stringify(sheetsOf(dC)) && sheetsOf(dC2)[0].length === 1, 'C: list výkresu dílu (formát, pohledy, Chytré kóty, číslo v razítku)');
  ok(dC2.components[0].source.doc.props && dC2.components[0].source.doc.props.number === 'MN-17-01', 'C: číslo dílu z razítka je i v popisových údajích dílu');

  // ════════════ D) příkaz konzole: export skript ════════════
  const n0 = dl.length;
  const logD = await consoleRun('export skript');
  const f2 = await nextDownload(n0 + 1);
  ok(!!f2 && f2.name === 'Pripravek_zpet.mncad.txt', `D: „export skript“ stáhl ${f2 && f2.name}`);
  ok(new RegExp(`✓ textový skript: Pripravek_zpet\\.mncad\\.txt · [\\d,]+ (B|kB) · textové příkazy, ${f2 ? f2.text.split('\n').length - 1 : '?'} řádků – staženo \\(bez dialogu\\)`).test(logD), 'D: protokol: název, velikost, počet řádků');
  ok(/\d+ prvků: \d+ vlastním příkazem, 0 obecným příkazem „prvek“, 0 jako JSON/.test(logD), 'D: protokol: pokrytí (vlastní příkaz / prvek / JSON)');
  ok(/ℹ vygenerované kóty výkresů/.test(logD), 'D: protokol: poznámka o vygenerovaných kótách');
  const logDe = await consoleRun('export skript de "priprava-de"');
  const f3 = await nextDownload(n0 + 2);
  ok(!!f3 && f3.name === 'priprava-de.mncad.txt' && /^neu baugruppe /m.test(f3.text) && /^einfügen /m.test(f3.text) && /^baugruppe verknüpfung konzentrisch #2 F\d+ #1 F\d+$/m.test(f3.text) && !/^✗/m.test(logDe), 'D: „export skript de <název>“ – německá klíčová slova a zadaný název');
  ok((await p.evaluate(() => window.mncad.commands())).some((c) => c.startsWith('export skript')), 'D: příkaz je ve window.mncad.commands()');
  ok(/Dokument → textový skript/.test(await p.evaluate(() => window.mncad.guide())), 'D: návod pro AI má oddíl „Dokument → textový skript“');

  // anglické rozhraní: export script → anglická slova; skript jde přečíst a dá stejný objem
  const pe = await ctx.newPage();
  const dle = [];
  pe.on('download', (d) => dle.push(d));
  pe.on('pageerror', (e) => errs.push(e.message));
  await ready(pe, BASE + '/en/cad');
  await pe.evaluate(() => window.mncad.run('new part Bracket\nbox 50 30 8\nhole 6 through at 10 10 8\nfillet 2 edges vertical'));
  await pe.waitForFunction(() => window.mncad.getDocument().name === 'Bracket', null, { timeout: 120000 });
  await pe.waitForTimeout(600);
  const vE = volumeOf(await pe.evaluate(() => window.mncad.status()));
  const logE = await pe.evaluate(() => window.mncad.run('export script'));
  const t0 = Date.now();
  while (!dle.length && Date.now() - t0 < 60000) await pe.waitForTimeout(200);
  const pathE = S + 'Bracket.mncad.txt';
  if (dle[0]) await dle[0].saveAs(pathE);
  const textE = dle[0] ? fs.readFileSync(pathE, 'utf8') : '';
  ok(!!dle[0] && dle[0].suggestedFilename() === 'Bracket.mncad.txt' && /^new part "Bracket"$/m.test(textE) && /^box 50 30 8$/m.test(textE) && /^hole 6 through at 10 10 8$/m.test(textE) && /^fillet 2 edges E\d+/m.test(textE), 'D: /en/cad „export script“ – anglická klíčová slova');
  ok(/✓ text script: Bracket\.mncad\.txt/.test(logE) && !/[áčěířšžůú]/.test(logE.split('\n').filter((l) => /text script|features:/.test(l)).join(' ')), 'D: anglický protokol exportu (bez českých slov)');
  const logE2 = await pe.evaluate((t) => window.mncad.run(t), textE.replace('"Bracket"', '"Bracket back"'));
  await pe.waitForFunction(() => window.mncad.getDocument().name === 'Bracket back', null, { timeout: 120000 });
  await pe.waitForTimeout(600);
  const vE2 = volumeOf(await pe.evaluate(() => window.mncad.status()));
  ok(!/^✗/m.test(logE2) && vE > 0 && rel(vE, vE2) < 1e-6, `D: anglický skript → stejný objem (${vE} → ${vE2} cm³)`);

  // ════════════ E) nálezy kontroly: dokument → skript → NOVÉ sezení → stejný model ════════════
  /** nové sezení s čistým úložištěm (v něm je jen prázdná záložka „Nový díl“ – jako u člověka, který skript dostal) */
  const session = async (path = '/cad') => {
    const c2 = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const q = await c2.newPage();
    q.on('pageerror', (e) => errs.push(e.message));
    q.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await ready(q, BASE + path);
    const api = {
      q,
      run: (t) => q.evaluate((x) => window.mncad.run(x), t),
      setDoc: (d) => q.evaluate((x) => window.mncad.setDocument(x), d),
      doc: () => q.evaluate(() => window.mncad.getDocument()),
      status: () => q.evaluate(() => window.mncad.status()),
      script: (o) => q.evaluate((x) => window.mncad.script(x), o || {}),
      volume: () => q.evaluate(() => window.mncad.measure('těleso').then((r) => r.volume)),
      bom: () => q.evaluate(() => window.mncad.bom().then((r) => r.rows.map((x) => [x.name, x.number || '', x.qty]))),
      /** aktivuje poslední záložku se zadaným názvem (dokument, který skript právě postavil) */
      activate: async (name) => {
        await q.waitForFunction((n) => window.mncad.tabs().some((t) => t.title === n), name, { timeout: 120000 });
        await q.evaluate((n) => { const t = window.mncad.tabs().filter((x) => x.title === n); const last = t[t.length - 1]; if (last && !last.active) window.mncad.activateTab(last.id); }, name);
        await q.waitForFunction((n) => window.mncad.getDocument().name === n, name, { timeout: 120000 });
        await q.waitForTimeout(500);
      },
      close: () => c2.close(),
    };
    return api;
  };
  const bad = (l) => l.split('\n').filter((x) => /^\s*✗/.test(x));
  const warn = (l) => l.split('\n').filter((x) => /^\s*[✗⚠]/.test(x));
  /** postaví dokument (text / JSON), vrátí ho se skriptem; pak ho skript v novém sezení postaví znovu */
  const roundTrip = async (c) => {
    const A = await session(c.path || '/cad');
    let la = '';
    if (c.doc) la += await A.setDoc(c.doc);
    if (c.text) la += await A.run(c.text);
    await A.activate(c.name);
    const orig = await A.doc();
    const script = await A.script(c.opts);
    const volA = orig.kind === 'assembly' || orig.kind === 'draft' ? null : await A.volume();
    const bomA = orig.kind === 'assembly' ? await A.bom() : null;
    const statusA = await A.status();
    if (c.keepA) return { A, orig, script, volA, bomA, statusA, buildLog: la };
    await A.close();
    const B = await session(c.pathB || c.path || '/cad');
    const lb = await B.run(script);
    await B.activate(c.name);
    const rt = await B.doc();
    const volB = rt.kind === 'assembly' || rt.kind === 'draft' ? null : await B.volume();
    const bomB = rt.kind === 'assembly' ? await B.bom() : null;
    const statusB = await B.status();
    const tabsB = await B.q.evaluate(() => window.mncad.tabs().map((t) => t.title));
    await B.close();
    return { orig, script, volA, bomA, statusA, rt, volB, bomB, statusB, tabsB, log: lb, buildLog: la };
  };
  const names = (d) => d.features.map((f) => [f.type, f.name, !!f.suppressed]);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  // E1 – pomocná rovina / osa / bod uvnitř prvku (planeDef, axisDef, extent, positionRef)
  let r = await roundTrip({ name: 'Pomocné roviny a osy', text: ['nový díl "Pomocné roviny a osy"', 'kvádr 60 40 20', 'prvek datum origin=30;20;30 normal=0;0;1 xDir=1;0;0 size=80 name="Rovina A"', 'prvek datumAxis def={"kind":"global","axis":"Z"} length=100 name="Osa A"', 'prvek datumPoint ref={"kind":"xyz","p":[30,20,40]} name="Bod A"', 'válec 10 8 v 50 20 20', 'zrcadlit rovina "Rovina A"', 'skica XZ', '  obdélník 5 10 roh 40 20', 'rotovat 90 osa "Osa A"', 'skica XY odsazení 20', '  kružnice 8 v 10 10', 'vysunout k rovině "Rovina A"', 'válec 4 12 v 10 30 20', 'pole kruhové 3 osa "Osa A" v 30 20 0', 'koule 8 na bod "Bod A"'].join('\n') });
  ok(bad(r.buildLog).length === 0 && r.orig.features.length === 13, 'E1: díl s odkazy na pomocnou rovinu / osu / bod vznikl bez ✗ (13 prvků)');
  ok(/^zrcadlit rovina "Rovina A"$/m.test(r.script) && /^rotovat 90 osa "Osa A"$/m.test(r.script) && /^vysunout k rovině "Rovina A"$/m.test(r.script) && /^pole kruhové 3 osa "Osa A" v 30 20 0$/m.test(r.script) && /^koule 8 na bod "Bod A"$/m.test(r.script) && !r.orig.features.some((f) => r.script.includes(f.id)), 'E1: skript píše odkazy názvem vlastními příkazy, žádné původní id');
  ok(warn(r.log).length === 0 && same(names(r.rt), names(r.orig)) && rel(r.volA, r.volB) < 1e-9 && r.volA > 60000, `E1: nové sezení – bez ✗/⚠, 13 prvků, stejný objem (${r.volA} → ${r.volB} mm³)`);

  // E2 – zastaralá čísla hran: prvek přesunutý před zaoblení (aplikace hledá hrany podle otisků)
  //   a) kapsa uprostřed – všechny čtyři hrany existují dál, jen pod jinými čísly → vlastní příkaz s čísly ověřenými jádrem
  r = await roundTrip({ name: 'Otisky hran', text: ['nový díl "Otisky hran"', 'kvádr 60 40 20', 'zaoblit 4 hrany svislé', 'kvádr 10 10 30 v 25 15 -5 odebrat', 'přesunout "Kvádr 2" před "Zaoblení 1"'].join('\n') });
  const stored = r.orig.features[2].edges.map((i) => `E${i + 1}`).join(' ');
  const written = (/^zaoblit 4 hrany (.*)$/m.exec(r.script) || [])[1];
  ok(!!written && written !== stored, `E2: skript nese čísla hran ověřená jádrem (${written}), ne uložená zastaralá (${stored})`);
  ok(warn(r.log).length === 0 && rel(r.volA, r.volB) < 1e-9 && r.volA > 0, `E2: nové sezení – bez ✗/⚠, stejný objem (${r.volA} → ${r.volB} mm³)`);
  ok(!/edgeSigs/.test(r.script) && !/^prvek /m.test(r.script), 'E2: zaoblení vlastním příkazem, bez otisků ve skriptu');
  //   b) výřez rohu – jedna ze čtyř hran zanikla (dokument má u zaoblení ⚠) → prvek zůstane i s otisky, objem stejný
  r = await roundTrip({ name: 'Otisky hran', text: ['nový díl "Otisky hran"', 'kvádr 60 40 20', 'zaoblit 4 hrany svislé', 'kvádr 20 20 30 v -5 -5 -5 odebrat', 'přesunout "Kvádr 2" před "Zaoblení 1"'].join('\n') });
  ok(/^prvek fillet radius=4 edges=0;2;4;6 edgeSigs=/m.test(r.script) && bad(r.log).length === 0 && rel(r.volA, r.volB) < 1e-9, `E2: zaniklá hrana – zaoblení zapsáno i s otisky, stejný objem (${r.volA} → ${r.volB} mm³; dřív 43214,277 → 42973,923)`);

  // E3 – zastaralé číslo plochy skici (válec přesunutý před skicu na ploše)
  r = await roundTrip({ name: 'Otisk plochy', text: ['nový díl "Otisk plochy"', 'kvádr 60 40 20', 'skica plocha horní', 'kružnice 10 v 0 0', 'vysunout 5', 'válec 10 30 v -20 0 10 osa X', 'přesunout "Válec 1" před "Skica 1"'].join('\n') });
  ok(/^skica plocha F\d+$/m.test(r.script) && !new RegExp(`^skica plocha F${r.orig.features[2].planeDef.ref.index + 1}$`, 'm').test(r.script), `E3: skica na ploše s číslem ověřeným jádrem (${(/^skica plocha (F\d+)$/m.exec(r.script) || [])[1]}, uloženo F${r.orig.features[2].planeDef.ref.index + 1})`);
  ok(warn(r.log).length === 0 && r.rt.features.length === 4 && rel(r.volA, r.volB) < 1e-9, `E3: nové sezení – bez ✗, 4 prvky, stejný objem (${r.volA} → ${r.volB} mm³)`);

  // E4 – díl s výchozím názvem „Nový díl“ v sestavě; ve stejném sezení se do nové sestavy vloží právě postavený díl
  const e4 = await roundTrip({ name: 'Nová sestava', text: ['kvádr 40 30 20', 'díra 6 skrz v 10 10 20', 'nová sestava', 'vložit "Nový díl" ukotvit', 'vložit "Nový díl" v 60 0 0'].join('\n'), keepA: true });
  ok(/^nový díl "Nový díl"\nnázev "Nový díl"$/m.test(e4.script) && /^nová sestava "Nová sestava"\nnázev "Nová sestava"$/m.test(e4.script), 'E4: výchozí názvy dílu a sestavy jsou ve skriptu ještě příkazem název');
  const logSame = await e4.A.run(e4.script.replace('kvádr 40 30 20', 'kvádr 40 30 50'));
  await e4.A.q.waitForTimeout(1500);
  const docSame = await e4.A.doc();
  ok(bad(logSame).length === 0 && docSame.kind === 'assembly' && docSame.components.length === 2 && same(docSame.components[0].source.doc.features[0].size, [40, 30, 50]), `E4: stejné sezení – nová sestava drží právě postavený díl (kvádr ${docSame.components && docSame.components[0] ? docSame.components[0].source.doc.features[0].size : '?'})`);
  await e4.A.close();
  const B4 = await session('/cad');
  const log4 = await B4.run(e4.script);
  await B4.q.waitForTimeout(1500);
  const rt4 = await B4.doc();
  const bom4 = rt4.kind === 'assembly' ? await B4.bom() : null;
  ok(bad(log4).length === 0 && rt4.kind === 'assembly' && rt4.name === 'Nová sestava' && rt4.components.length === 2 && rt4.components.every((c) => c.source.doc.name === 'Nový díl') && same(bom4, e4.bomA), `E4: nové sezení – 2 komponenty dílu „Nový díl“, stejný kusovník (${JSON.stringify(bom4)})`);
  await B4.close();

  // E5 – jazyk rozhraní: český skript v /en/cad; export pro en → /en/cad a de → /de/cad se stejnými názvy
  const langText = ['nový díl "Parametry"', 'proměnná t = 12', 'kvádr 100 50 12', 'upravit "Kvádr 1" size.2==t', 'díra 6 skrz v 20 25 12', 'díra 8 skrz v 60 25 12', 'potlačit "Díra 2"', 'zaoblit 3 hrany svislé', 'konfigurace "Tenká" t=6 potlačit "Zaoblení 1"', 'konfigurace aktivní "Tenká"'].join('\n');
  const cfgOf = (d) => (d.configs || []).map((c) => [c.name, c.values, c.suppressed.map((id) => d.features.findIndex((f) => f.id === id)), d.activeConfig === c.id]);
  const bindOf = (d) => Object.entries(d.bindings || {}).map(([k, v]) => `${d.features.findIndex((f) => f.id === k.slice(0, k.indexOf(':')))}:${k.slice(k.indexOf(':') + 1)}=${v}`).sort();
  r = await roundTrip({ name: 'Parametry', text: langText, pathB: '/en/cad' });
  ok(bad(r.log).length === 0 && rel(r.volA, r.volB) < 1e-9 && same(bindOf(r.rt), bindOf(r.orig)) && same(cfgOf(r.rt), cfgOf(r.orig)) && same(r.rt.features.map((f) => !!f.suppressed), r.orig.features.map((f) => !!f.suppressed)), `E5: český skript v anglickém rozhraní – bez ✗, stejný objem (${r.volA} → ${r.volB}), vazba, potlačení i konfigurace`);
  for (const lang of ['en', 'de']) {
    r = await roundTrip({ name: 'Parametry', text: langText, opts: { lang }, pathB: `/${lang}/cad` });
    ok(bad(r.log).length === 0 && rel(r.volA, r.volB) < 1e-9 && same(names(r.rt), names(r.orig)) && same(bindOf(r.rt), bindOf(r.orig)) && same(cfgOf(r.rt), cfgOf(r.orig)), `E5: export ${lang} → /${lang}/cad – bez ✗, stejný objem a stejné názvy prvků (${r.rt.features.map((f) => f.name).join(', ')})`);
  }

  // E6 – pořadí proměnných (proměnná odkazuje na pozdější)
  r = await roundTrip({ name: 'Pořadí proměnných', text: ['nový díl "Pořadí proměnných"', 'proměnná a = 10', 'proměnná b = 5', 'proměnná a = b*4', 'kvádr 20 30 10', 'upravit "Kvádr 1" size.0==a size.1==b+25'].join('\n') });
  ok(bad(r.log).length === 0 && same(r.rt.variables, r.orig.variables) && same(bindOf(r.rt), bindOf(r.orig)) && bindOf(r.rt).length === 2 && rel(r.volA, r.volB) < 1e-9, `E6: proměnné ve stejném pořadí (${r.rt.variables.map((v) => `${v.name}=${v.expr}`).join(', ')}), obě vazby`);

  // E7 – „#“ a „//“ v názvech: díly v sestavě, vazba mezi nimi; samostatný díl; 2D výkres s textem „// …“
  r = await roundTrip({ name: 'Sestava # 1', text: ['nový díl "Deska # levá"', 'kvádr 40 30 20', 'nový díl "Čep // dlouhý"', 'válec 10 30', 'nová sestava "Sestava # 1"', 'vložit "Deska # levá" ukotvit', 'vložit "Čep // dlouhý" v 20 15 20', 'sestava vazba kontakt #2 spodní #1 horní'].join('\n') });
  ok(r.orig.components.length === 2 && r.orig.components[0].source.doc.name === 'Deska # levá', 'E7: název dílu s „#“ v uvozovkách přečte konzole celý (komentář jen mimo uvozovky)');
  ok(bad(r.log).length === 0 && !/null/.test(r.script) && r.rt.components.length === 2 && same(r.rt.components.map((c) => c.source.doc.name), ['Deska # levá', 'Čep // dlouhý']) && (r.rt.mates || []).length === 1 && same(r.bomB, r.bomA), `E7: sestava s díly „Deska # levá“ a „Čep // dlouhý“ – 2 komponenty, vazba, stejný kusovník`);
  r = await roundTrip({ name: 'Náčrt s poznámkou', doc: { app: 'mnastrojarna-cad', version: 2, name: 'Náčrt s poznámkou', material: 'ocel', features: [], kind: 'draft', draft: { v: 1, id: 'p0u8', seq: 3, vars: { units: 'mm', prec: 4, aprec: 0, ltscale: 1, celtscale: 1, clayer: '0', cecolor: 'ByLayer', celtype: 'ByLayer', celweight: 'ByLayer', lwdefault: 0.25, lwdisplay: false, textsize: 5, textstyle: 'Standard', pdmode: 0, pdsize: 0, grid: 10, snap: 10, measurement: 1, mirrtext: 0 }, layers: [{ name: '0', color: 7, linetype: 'Continuous', lineweight: 'Default', on: true, frozen: false, locked: false, plot: true }], linetypes: [{ name: 'Continuous', desc: 'Solid line', pattern: [] }], textStyles: [{ name: 'Standard', font: 'Arial', height: 0, wf: 1, oblique: 0 }], entities: [{ type: 'line', a: [0, 0], b: [100, 0], id: 'e1', layer: '0' }, { type: 'text', p: [10, 10], h: 5, s: '4x M6 // viz detail A # 2', id: 'e2', layer: '0' }] } } });
  ok(bad(r.log).length === 0 && r.rt.kind === 'draft' && same(r.rt.draft.entities.map((e) => e.s || e.type), ['line', '4x M6 // viz detail A # 2']), 'E7: 2D výkres s textem „4x M6 // viz detail A # 2“ se přenese celý');

  // E8 – závěs s dosedacími rovinami a motor na něm (vlna 22: rozsah + rychlost = dojede na 180° rychlostí 10 ot/min za 3 s;
  // dřívější „čas 2“ je s tímto zadáním v rozporu a příkaz by ho odmítl s vysvětlením)
  r = await roundTrip({ name: 'Závěs', text: ['nový díl "Deska"', 'kvádr 100 80 20', 'díra 10 skrz v 20 20 20', 'nový díl "Kolo"', 'válec 40 10', 'díra 10 skrz v 0 0 10', 'nová sestava "Závěs"', 'vložit "Deska" ukotvit', 'vložit "Kolo" v 20 20 20', 'sestava vazba závěs #2 F1 F3 #1 F7 F3 název "Otoč"', 'pohyb motor rotační vazba 1 0..180 kroky 6 čas 3 ot/min 10'].join('\n') });
  const mateOf = (d) => (d.mates || []).map((m) => [m.type, m.name || '', ...['a', 'b', 'c', 'd'].map((k) => (m[k] ? `${d.components.findIndex((c) => c.id === m[k].compId)}:${m[k].face}` : '-'))]);
  ok(/^sestava vazba závěs #2 F1 F3 #1 F7 F3 název "Otoč"$/m.test(r.script) && /^pohyb motor rotační vazba 1 0\.\.180 /m.test(r.script), 'E8: skript má závěs s dosedacími rovinami a motor');
  ok(bad(r.log).length === 0 && same(mateOf(r.rt), mateOf(r.orig)) && mateOf(r.rt).length === 1 && !!r.rt.motion && r.rt.motion.motors.length === 1 && same([r.rt.motion.motors[0].kind, r.rt.motion.motors[0].from, r.rt.motion.motors[0].to, r.rt.motion.steps], [r.orig.motion.motors[0].kind, r.orig.motion.motors[0].from, r.orig.motion.motors[0].to, r.orig.motion.steps]), `E8: nové sezení – vazba ${JSON.stringify(mateOf(r.rt)[0])} a pohybová studie`);

  // E9 – smazané vygenerované kóty se po přečtení nevrátí
  r = await roundTrip({ name: 'Kóty', text: ['nový díl "Kóty"', 'kvádr 120 80 20', 'díra 8 skrz v 20 20 20', 'díra 8 skrz v 100 60 20', 'výkres A3 pohledy přední,horní', 'kótovat chytře', 'výkres smazat a3 a8'].join('\n') });
  const dimsOf = (d) => d.drawings[0].annotations.filter((a) => a.type !== 'centerline').length;
  ok(/^kótovat chytře\nvýkres smazat a\d+ a\d+$/m.test(r.script), `E9: skript maže smazané vygenerované kóty podle id od jádra (${(/^výkres smazat .*$/m.exec(r.script) || [''])[0]})`);
  ok(bad(r.log).length === 0 && dimsOf(r.rt) === dimsOf(r.orig) && (r.rt.drawings[0].options.smartOff || []).length === 2 && r.rt.drawings[0].annotations.length === r.orig.drawings[0].annotations.length, `E9: nové sezení – ${dimsOf(r.rt)} kót (původně ${dimsOf(r.orig)}), smazané zůstaly smazané`);

  // E10 – výraz vazby s mezerami (dokument z JSON)
  r = await roundTrip({ name: 'Výraz s mezerami', doc: { app: 'mnastrojarna-cad', version: 2, name: 'Výraz s mezerami', material: 'ocel', kind: 'part', variables: [{ name: 'b', expr: '5' }], features: [{ id: 'b1', name: 'Kvádr 1', type: 'box', size: [40, 30, 10], position: [0, 0, 0], centered: false, mode: 'new' }], bindings: { 'b1:size.1': 'b + 25', 'b1:size.0': 'max(b, 3) * 8' } } });
  ok(bad(r.log).length === 0 && same(bindOf(r.rt), bindOf(r.orig)) && bindOf(r.rt).length === 2, `E10: vazby s mezerami ve výrazu (${bindOf(r.rt).join(' · ')})`);

  // E11 – stejné názvy prvků: potlačený je jen ten správný
  r = await roundTrip({ name: 'Stejné názvy', text: ['nový díl "Stejné názvy"', 'kvádr 60 40 10', 'díra 5 skrz v 10 10 10', 'díra 5 skrz v 30 10 10', 'díra 5 skrz v 50 10 10', 'přejmenovat "Díra 2" na "Díra 1"', 'přejmenovat "Díra 3" na "Díra 1"', 'potlačit @3'].join('\n') });
  ok(bad(r.log).length === 0 && same(names(r.rt), names(r.orig)) && rel(r.volA, r.volB) < 1e-9, `E11: stejné názvy i potlačení (${r.rt.features.map((f) => `${f.name}${f.suppressed ? ' ×' : ''}`).join(', ')}), stejný objem (${r.volA} → ${r.volB})`);

  // E12 – skica založená klikem na plochu (obecná rovina s popisem „Plocha 6“) – vlastní příkaz místo JSON
  r = await roundTrip({ name: 'Klikaný díl', doc: { app: 'mnastrojarna-cad', version: 2, name: 'Klikaný díl', material: 'ocel', kind: 'part', features: [{ id: 'b', name: 'Kvádr 1', type: 'box', size: [60, 40, 20], position: [0, 0, 0], centered: false, mode: 'new' }, { id: 'p9x8c7', name: 'Skica 1', type: 'sketch', plane: { kind: 'custom', origin: [30, 20, 20], normal: [0, 0, 1], xDir: [1, 0, 0], label: 'Plocha 6' }, entities: [{ id: 'k9', type: 'circle', cx: 0, cy: 0, r: 8 }] }, { id: 'x', name: 'Vysunutí 1', type: 'extrude', sketchId: 'p9x8c7', distance: 12, symmetric: false, reverse: false, mode: 'add' }] } });
  ok(/^skica počátek 30 20 20 normála 0 0 1 osax 1 0 0$/m.test(r.script) && /^upravit poslední plane\.label="Plocha 6"$/m.test(r.script) && !/^[{[]/m.test(r.script), 'E12: skica na kliknuté ploše vlastním příkazem (popis roviny řádkem upravit), žádný JSON');
  ok(bad(r.log).length === 0 && same(r.rt.features[1].plane, r.orig.features[1].plane) && rel(r.volA, r.volB) < 1e-9, `E12: nové sezení – stejná rovina skici včetně popisu, stejný objem (${r.volA} → ${r.volB})`);

  ok(dialogs.length === 0, `žádné systémové okno (${dialogs.length})`);
  ok(errs.length === 0, `žádná chyba stránky (${errs.slice(0, 2).join(' | ')})`);
  await b.close();
})().catch((e) => { console.log('FAIL: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
