// E2E vlna 15 – balík asm (zkouška 959): agent BEZ WebGL jen přes textovou konzoli (Ctrl+Shift+K, Provést), ověření i v GUI.
//  - B10: `stav` sestavy = PŘESNÁ obálka těles (stopka natočená o 20° kolem Z dřív zvětšila 308 mm v Y na 313,85 mm)
//  - B11: šrouby vložené s `otočení 180 0 0`, které se v pohybové studii jen posouvají, nehlásí „natáčí se“
//  - B15 + P2-11: `vložit … jako "K48"` (přezdívka ve vazbách místo #k, ve výpisu a ve stromu), kusovník podle zdroje –
//    přejmenování instance řádek nerozdělí
//  - pružina mezi deskami: `sestava pružina … mezi … tuhost 25` (dosedací plochy automaticky) → délka 38 mm, síla 150 N;
//    přepočet vazby (ZDVIH 30) → 30 mm / 350 N; pohybová studie s kolizemi → ✗ pod délkou na doraz; export STEP = věrná kopie;
//    GUI: panel komponenty › Pružina mezi komponentami ukazuje stav a změní tuhost tímtéž příkazem
//  - revize: T2 se dvěma stejnými pružinami v délce 38 a 30 mm – kusovník (text, panel, čip, výkres) jedna položka s hmotností,
//    Σ hmotnost = stav; přesun dosedací desky v panelu bez vazeb; panel zruší tuhost / doraz; Duplikovat bez přezdívky;
//    název ≠ přezdívka jiné komponenty; přezdívka ve vazbě
// Spuštění: E2E_BASE=http://localhost:3423 node e2e/cad-w15-asm.e2e.cjs
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

(async () => {
  const b = await chromium.launch({ args: NO_GL });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 6000 }).catch(() => false)) await c0.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => { try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch { return true; } }), 'WebGL není k dispozici (jako v polním hlášení 959)');

  const input = p.getByLabel('Textové příkazy nebo JSON');
  // konzole: na pomalém stroji se zkratka může minout s dokončením hydratace – zkusit znovu
  for (let k = 0; k < 6 && !(await input.isVisible().catch(() => false)); k++) {
    await p.keyboard.press('Control+Shift+K');
    await input.waitFor({ timeout: 20000 }).catch(() => {});
  }
  await input.waitFor({ timeout: 10000 });
  const out = p.locator('[data-agent-output]');
  const t00 = Date.now();
  const run = async (text, ms = 300000) => {
    process.stderr.write(`[${((Date.now() - t00) / 1000).toFixed(0)} s] ${text.split('\n')[0]}\n`);
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };

  /** konzole po práci v panelu: pole s fokusem zkratku nepustí – nejdřív fokus pryč, pak zkratka (i opakovaně) */
  const openConsole = async () => {
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    for (let k = 0; k < 5 && !(await input.isVisible().catch(() => false)); k++) {
      await p.keyboard.press('Control+Shift+K');
      await input.waitFor({ timeout: 8000 }).catch(() => {});
    }
    await input.waitFor({ timeout: 5000 });
  };

  // ── díly (nejdřív díly, pak sestava – pracovní postup z hlášení; každý díl zvlášť: B2 = víc „nový díl“ v jednom běhu řeší jiný balík) ──
  let log = '';
  for (const t of ['nový díl Vodicí deska\nkvádr 189.8 308 20 v -2.4 -308 0', 'nový díl Kotevní deska\nkvádr 189.8 308 20 v -2.4 -308 0', 'nový díl Stopka\nválec 80 60\nkvádr 20 100 62 v 30 -50 -1 odebrat', 'nový díl Šroub M6x20\nválec 6 20', 'normálie pružina d2 D20 L44 n8']) log += await run(t);
  const springTab = 'Pružina 2×20×44';
  const tabs = await run('záložky');
  ok(/✓ normálie „Pružina 2×20×44/.test(log) && !/^✗/m.test(log) && ['Vodicí deska', 'Kotevní deska', 'Stopka', 'Šroub M6x20', springTab].every((t) => tabs.includes(t)), `díly + normálie pružina DIN 2095 – záložky: ${line(tabs, /Pružina/)}`);

  log = await run([
    'nová sestava ZKOUSKA 959',
    'vložit "Vodicí deska" ukotvit',
    'vložit "Kotevní deska" v 0 0 58',
    'vložit "Stopka" v 92.5 -42 78 otočení 0 0 20',
    'vložit "Šroub M6x20" v 20 -20 78 otočení 180 0 0 jako "K48"',
    'vložit "Šroub M6x20" v 160 -20 78 otočení 180 0 0 jako "K49"',
    `vložit "${springTab}" v 20 -250 21`,
    'sestava vazba vzdálenost "Kotevní deska" spodní "Vodicí deska" horní hodnota 38 název "ZDVIH"',
    'sestava vazba zámek "K48" "Kotevní deska"',
    'sestava vazba zámek "K49" "Kotevní deska"',
    'sestava vazba zámek "Stopka" "Kotevní deska"',
    `sestava vazba zámek "${springTab}" "Vodicí deska"`,
    'sestava',
  ].join('\n'));
  ok(/✓ komponenta „Šroub M6x20“ vložena do sestavy · přezdívka „K48“/.test(log), 'vložit … jako "K48": ' + line(log, /přezdívka „K48“/));
  ok(/#4 Šroub M6x20 \[K48\]/.test(log) && /#5 Šroub M6x20 \[K49\]/.test(log), 'výpis sestavy: #4 … [K48], #5 … [K49]');
  ok(!/^✗/m.test(log) && /Zámek „K48|Zámek „Šroub M6/.test(log), 'vazby s přezdívkou místo #k bez ✗');
  log = await run('vložit "Šroub M6x20" jako "K48"');
  ok(/✗ řádek 1: vložit: přezdívku „K48“ už má komponenta/.test(log), 'duplicitní přezdívka → ✗ s číslem řádku: ' + line(log, /✗ řádek 1/));

  // ── B10: přesná obálka ──
  log = await run('stav');
  const env = line(log, /^Sestava: /);
  ok(/obálka 189,8 × 308 × 138 mm/.test(env), 'B10 stav: ' + env);

  // ── pružina mezi deskami ──
  log = await run(`sestava pružina "${springTab}" mezi "Vodicí deska" "Kotevní deska" tuhost 25`);
  ok(/dosedací plochy pružiny .*„Vodicí deska“ F\d+ rovinná \+Z → „Kotevní deska“ F\d+ rovinná −Z/.test(log), 'pružina: dosedací plochy automaticky ' + line(log, /dosedací plochy/));
  ok(/✓ pružina „[^“]+“: délka 38 mm · L0 44 · Ln 18 · stlačení 6 mm · síla 150 N \(c 25 N\/mm\)/.test(log), 'pružina 38 mm / 150 N: ' + line(log, /pružina „/));
  log = await run('sestava vazba "ZDVIH" hodnota=30\nsestava pružiny\nstav');
  ok(/✓ pružina „[^“]+“: délka 30 mm .* síla 350 N/.test(log), 'přepočet vazby ZDVIH 30 → ' + line(log, /✓ pružina „/));
  ok(/Pružiny: „[^“]+“ 30 mm \(L0 44 · Ln 18\) · F 350 N ✓/.test(log), 'stav: ' + line(log, /^Pružiny:/));
  log = await run('assembly springs');
  ok(/délka 30 mm/.test(log), 'EN assembly springs: ' + line(log, /pružina „/));

  // ── B15: kusovník podle zdroje ──
  log = await run('kusovník');
  const screwRow = line(log, /\| Šroub M6x20 \|/);
  ok(/\| Šroub M6x20 \|  \| 2 \|/.test(log), 'kusovník: šrouby jeden řádek 2 ks – ' + screwRow);
  log = await run('sestava komponenta "K49" název "Šroub M6x20 -1"\nkusovník');
  ok(/✓ komponenta „Šroub M6x20“: název „Šroub M6x20 -1“/.test(log) && /\| Šroub M6x20 \|  \| 2 \|/.test(log) && !/\| Šroub M6x20 -1 \|/.test(log), 'B15 přejmenování instance řádek kusovníku nerozdělí: ' + line(log, /\| Šroub M6x20/));

  // ── pohybová studie: B11 + pružina v pohybu ──
  log = await run('sestava vazba "ZDVIH" hodnota=38\npohyb motor lineární vazba "ZDVIH" 38..16 kroky 11 kolize\npohyb', 600000);
  const sumLines = log.split('\n').filter((l) => /rozsah pohybu/.test(l));
  ok(sumLines.some((l) => /Šroub M6x20/.test(l) && /Z 22 mm/.test(l)) && !sumLines.some((l) => /Šroub M6x20/.test(l) && /natáčí se/.test(l)), 'B11 šrouby 180 0 0 se jen posouvají: ' + (sumLines.find((l) => /Šroub M6x20/.test(l)) || '').trim());
  ok(/✗ pružina „[^“]+“: délka 38 → 16 mm \(min 16 · L0 44 · Ln 18\) · síla 150 → 700 N \(max 700 N\) – pod délkou na doraz v krocích 11/.test(log), 'pružina v pohybu: ' + line(log, /pružina „[^“]+“: délka 38/));
  log = await run('pohyb export csv');
  const head = (log.split('\n').find((l) => /^﻿?Krok;/.test(l.trim())) || '').trim();
  ok(/ L \[mm\];[^;]+ F \[N\]$/.test(head), 'CSV studie: sloupce délky a síly pružiny – ' + head.slice(-60));

  // ── export STEP s pružinou v aktuální délce ──
  log = await run('pohyb smazat\nsestava vazba "ZDVIH" hodnota=30\nexport step', 300000);
  ok(/✓ kontrola STEP: soubor znovu načten jádrem – těles: 6/.test(log) && /věrná kopie modelu/.test(log), 'export STEP sestavy: ' + line(log, /kontrola STEP/));

  // ── GUI: strom (přezdívka) a panel komponenty (pružina) – konzoli (modální okno) nejdřív zavřít ──
  await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  const badges = await p.locator('[data-tree-alias]').allInnerTexts();
  ok(badges.includes('K48') && badges.includes('K49'), 'strom sestavy: přezdívky ' + badges.join(', '));
  await p.locator('div.group.ml-3', { hasText: springTab }).first().click(); // řádek stromu sestavy (ne záložka dokumentu)
  const st = p.locator('[data-asm-spring-state]');
  await st.waitFor({ timeout: 30000 });
  const stText = await st.innerText();
  ok(/délka 30 mm · L0 44 · Ln 18 · F 350 N/.test(stText), 'panel komponenty › pružina: ' + stText);
  const rate = p.getByLabel('Tuhost c (0 = neuvádět)');
  await rate.fill('30');
  await rate.press('Enter');
  await p.locator('[data-asm-spring-apply]').click();
  await p.waitForFunction(() => /F 420 N/.test(document.querySelector('[data-asm-spring-state]')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
  ok(/F 420 N/.test(await st.innerText()), 'panel: tuhost 30 (F = 30 · 14 = 420 N) → ' + (await st.innerText()));
  // panel zadal tentýž textový příkaz – ověření konzolí
  await p.keyboard.press('Control+Shift+K');
  await input.waitFor({ timeout: 20000 });
  log = await run('sestava pružiny');
  ok(/síla 420 N \(c 30 N\/mm\)/.test(log), 'po změně v panelu: ' + line(log, /pružina „/));

  // ── revize: T2 z hlášení recenzenta (pružiny 38 a 30 mm) – kusovník textem / v panelu / na čipu / ve výkrese, hmotnost,
  //    přesun dosedací komponenty bez vazeb (panel), zrušení tuhosti a dorazu v panelu, kopie bez přezdívky, název ≠ přezdívka ──
  log = await run('nový díl ZAKLAD\nkvádr 300 100 20');
  log += await run('nový díl B\nkvádr 100 100 20');
  log = await run([
    'nová sestava T2',
    'vložit "ZAKLAD" ukotvit',
    'vložit "B" v 0 0 58',
    'vložit "B" v 200 0 50',
    `vložit "${springTab}" v 30 30 20`,
    `vložit "${springTab}" v 230 30 20`,
    'sestava pružina #4 mezi "ZAKLAD" #2 blok 20 tuhost 25',
    'sestava pružina #5 mezi "ZAKLAD" #3 tuhost 25',
    'kusovník',
    'stav',
  ].join('\n'));
  ok(/✓ pružina „Pružina 2×20×44“ #4: délka 38 mm/.test(log) && /✓ pružina „Pružina 2×20×44“ #5: délka 30 mm/.test(log), 'T2: pružiny se stejným názvem s #k – ' + line(log, /#5: délka/));
  const bomHead = line(log, /^Kusovník „T2“/);
  const springRow = line(log, /\| Pružina 2×20×44 \|/);
  ok(/položek 3, kusů 5/.test(bomHead) && !/nepostavily/.test(bomHead), 'revize: textový kusovník 3 položky, bez „nepostavily“ – ' + bomHead);
  ok(/\| 2 \| [^|]+ \| \d+,\d+$/.test(springRow), 'revize: řádek pružiny 2 ks s hmotností – ' + springRow);
  const kgOf = (s) => Number(((s.match(/hmotnost Σ ([\d,]+) kg/) || [])[1] || 'NaN').replace(',', '.'));
  const stavLine = line(await run('stav'), /^Sestava: /);
  ok(Math.abs(kgOf(bomHead) - kgOf(stavLine)) < 0.0015, `revize: Σ hmotnost kusovníku ${kgOf(bomHead)} = stav ${kgOf(stavLine)} (${stavLine})`);
  await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  const chip = (await p.locator('body').innerText()).match(/(\d+) komponent · (\d+) položek kusovníku/);
  ok(!!chip && chip[1] === '5' && chip[2] === '3', 'revize: čip sestavy ' + (chip ? chip[0] : '–'));
  // panel Kusovník – řádek pružiny jednou, 2 ks
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const bomRows = (await p.locator('table tr').allInnerTexts()).filter((t) => t.includes('Pružina 2×20×44'));
  ok(bomRows.length === 1 && /\b2\b/.test(bomRows[0]), 'revize: panel Kusovník – pružina 1 řádek: ' + bomRows.map((t) => t.replace(/\s+/g, ' ')).join(' / '));
  // okno Kusovník zavřít (modální překryv by zakryl strom)
  const overlay = p.locator('div.fixed.inset-0.z-\\[70\\]');
  for (let k = 0; k < 3 && (await overlay.count()) > 0; k++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    if ((await overlay.count()) > 0) await overlay.getByRole('button', { name: /^(Zavřít|×|✕)$/ }).first().click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(400);
  }
  const treeRow = (name, k = 0) => p.locator('div.group.ml-3').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).nth(k);
  // přesun dosedací komponenty B #2 v panelu (sestava BEZ vazeb) → délka pružiny #4 38 → 30 mm
  await treeRow('B', 0).click();
  const z = p.getByLabel('Z', { exact: true }).first();
  await z.waitFor({ timeout: 20000 });
  await z.fill('50');
  await z.press('Enter');
  await p.waitForTimeout(2500);
  await openConsole();
  log = await run('stav');
  ok(/„Pružina 2×20×44“ #4 30 mm \(L0 44 · Ln 20\) · F 350 N ✓/.test(line(log, /^Pružiny:/)), 'revize: přesun v panelu bez vazeb přepočítá pružinu – ' + line(log, /^Pružiny:/));
  // panel pružiny #4: Tuhost 0 a Ln 0 = zrušit
  await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await treeRow(springTab, 0).click();
  await p.locator('[data-asm-spring-state]').waitFor({ timeout: 30000 });
  for (const [lab, v] of [['Tuhost c (0 = neuvádět)', '0'], ['Délka na doraz Ln (0 = z modelu)', '0']]) {
    const f = p.getByLabel(lab);
    await f.fill(v);
    await f.press('Enter');
  }
  await p.locator('[data-asm-spring-apply]').click();
  await p.waitForFunction(() => /Ln 18/.test(document.querySelector('[data-asm-spring-state]')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
  const st2 = await p.locator('[data-asm-spring-state]').innerText();
  ok(/délka 30 mm · L0 44 · Ln 18/.test(st2) && !/F \d/.test(st2), 'revize: panel zrušil tuhost a doraz – ' + st2);
  // kopie (Duplikovat v nabídce stromu) bez přezdívky; název nesmí být přezdívkou jiné komponenty
  await openConsole();
  log = await run('sestava komponenta #3 přezdívka "B2"\nsestava pružiny');
  ok(/#4: délka 30 mm · L0 44 · Ln 18 · stlačení 14 mm$/m.test(log), 'revize: po panelu bez síly a s dorazem z modelu – ' + line(log, /#4: délka/));
  await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await treeRow('B', 1).click({ button: 'right' });
  await p.getByText('Duplikovat (+ posun X)').first().click();
  await p.waitForTimeout(800);
  const aliases = await p.locator('[data-tree-alias]').allInnerTexts();
  ok(aliases.filter((a) => a === 'B2').length === 1, 'revize: Duplikovat v nabídce stromu – přezdívka B2 jen jednou: ' + aliases.join(', '));
  await treeRow('B', 0).click();
  const nameField = p.getByLabel('Název', { exact: true }).first();
  await nameField.fill('B2');
  await nameField.press('Enter');
  await p.waitForTimeout(500);
  ok(await p.getByText(/„B2“ je přezdívka komponenty #3 B/).first().isVisible().catch(() => false), 'revize: přejmenování na přezdívku jiné komponenty odmítnuto v panelu');
  await openConsole();
  log = await run('sestava komponenta "B2" barva #ff0000\nsestava vazba zámek "B2" "ZAKLAD"\nsestava komponenta #1 název "B2"');
  ok(/✓ komponenta „B“: barva #ff0000/.test(log), 'revize: přezdívka B2 po kopii dál platí – ' + line(log, /barva #ff0000/));
  ok(/vazba Zámek „B“ \[B2\]/.test(log), 'revize: vazba s přezdívkou v protokolu – ' + line(log, /vazba Zámek/));
  ok(/✗ řádek 3: „B2“ je přezdívka komponenty #3 B/.test(log), 'revize: textové přejmenování na přezdívku ✗ – ' + line(log, /✗ řádek 3/));

  log = await run('výkres A3 na šířku měřítko 1:5 pohledy přední,horní\nvýkres kusovník ano', 300000);
  const svgRows = await p.evaluate(async () => {
    const r = await window.mncad.exportDrawing('svg');
    const s = new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)));
    return [...s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((t) => /DIN 2095/.test(t)).length;
  });
  ok(svgRows === 1, 'revize: tabulka kusovníku na výkrese – pružina 1 řádek (dřív 2): ' + svgRows);
  ok(!errs.length, 'bez chyb stránky ' + errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
  process.exit(1); // prohlížeč by jinak držel proces
});
