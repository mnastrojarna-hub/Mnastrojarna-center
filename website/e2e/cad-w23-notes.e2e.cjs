// E2E vlna 23 – „výkres strojařsky“ (požadavek majitele 27. 11., R1–R7) na produkčním buildu, bez WebGL (jako majitel):
//  - agent (konzole = textová cesta): razítko s technickými údaji, popis plochy z modelu, oblastní úprava, 3 krátké řádky;
//    na listu v GUI: buňky razítka Tepelné zpracování / Tvrdost / Povrchová úprava / Hrany / Nepředepsané tolerance /
//    Obecná drsnost s hodnotami (R1), odkaz „Brousit“ z modelu (R2), tlustá čerchovaná čára (SVG 0,7 + čárkování) se
//    značkou Z1 a vysvětlivkou (R3), nad razítkem ≤ 5 řádků volného textu (R4); 6. řádek agenta = ✗ drawing.notes-limit,
//    žádné „✓ … bez nálezů“ po něm; poznámka s HRC se přesune do razítka (ℹ);
//  - člověk v GUI (R6): nástroj Text → dlouhá věta se vloží bez chyby a je na listu; panel Razítko ukáže jen nenápadnou
//    radu (data-notes-hint), pole Tvrdost / Obecná drsnost (data-title-field) nesou hodnoty z textu;
//  - kolo 3 (D1): archivní soubor člověka otevřený agentem = ⚠ drawing.notes-loaded a export povolen, úprava agentem = ✗.
// Spuštění: bin/e2e-run <worktree>/website 3640 <out> cad-w23-notes   (E2E_BASE nastaví e2e-run)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w23').replace(/\/?$/, '/');
fs.mkdirSync(S + 'shots', { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3640').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

(async () => {
  const b = await chromium.launch({ args: NO_GL });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 6000 }).catch(() => false)) await c0.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1500);

  const input = p.getByLabel('Textové příkazy nebo JSON');
  const out = p.locator('[data-agent-output]');
  const openConsole = async () => {
    for (let k = 0; k < 6 && !(await input.isVisible().catch(() => false)); k++) {
      await p.keyboard.press('Control+Shift+K');
      await input.waitFor({ timeout: 15000 }).catch(() => {});
    }
  };
  const closeConsole = async () => {
    const modal = p.locator('div.fixed.inset-0.grid.place-items-center').filter({ has: input });
    for (let i = 0; i < 3 && (await modal.count()) > 0; i++) {
      await modal.first().getByRole('button', { name: 'Zavřít', exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(500);
    }
  };
  const run = async (text, ms = 300000) => {
    await openConsole();
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent || ''));
  const waitSheet = (s, ms = 180000) => p.waitForFunction((s) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => (t.textContent || '').includes(s)), s, { timeout: ms }).then(() => true, () => false);

  // ── agent: výkres podle návodu „Výkres strojařsky“ ──
  const SCRIPT = [
    'nový díl "Deska"', 'kvádr 100 60 12', 'díra 9 skrz v 50 30', 'materiál 1.2379',
    'výkres A3 měřítko 1:1 pohledy přední,horní,iso', 'kótovat chytře', 'výkres nepředepsané ISO 2768-mK',
    'výkres razítko číslo="MN-1" tepelné="kalit a popustit" povrch="černit" hrany="ISO 13715 -0,3"',
    'výkres značka text "Tvrdost 58-60 HRC" v 30 70', 'výkres drsnost Ra 3,2',
    'poznámka F2 "Brousit"', 'úprava F3 tepelná "62+2 HRC" od 10 do 40',
    'výkres značka text "Odmastit" v 30 60', 'výkres značka text "Konzervovat" v 30 55', 'výkres poznámka "Balit"',
    'výkres stav',
  ].join('\n');
  let log = await run(SCRIPT);
  fs.writeFileSync(S + 'agent.txt', log);
  ok(/přesunuto do razítka – „Tvrdost 58-60 HRC“ → tvrdost „58-60 HRC“/.test(log), 'R1: text s HRC od agenta se přesunul do razítka (ℹ) – ' + line(log, /přesunuto do razítka/));
  ok(/Údaje razítka \(technické, v buňkách\): tepelné zpracování „kalit a popustit“ · tvrdost „58-60 HRC“ · povrchová úprava „černit“ · hrany „ISO 13715 -0,3“ · nepředepsané „ISO 2768-mK“ · drsnost „Ra 3,2“/.test(log), 'R1: výkres stav – všechny technické údaje v buňkách razítka');
  ok(/Poznámky nad razítkem: 4\/5 řádků \(agent 4\) · místní popisy 1\/8/.test(log), 'R4: výkres stav – 4/5 řádků nad razítkem (vysvětlivka úpravy agenta se počítá jako agentova), 1/8 místních popisů – ' + line(log, /Poznámky nad razítkem/));
  ok(/Z modelu: F2 „Brousit“ → \S+ \(odkaz se šipkou\) · Z1 F3 „62\+2 HRC“ → přední \(tlustá čerchovaná 04\.2 \+ kóta rozsahu\)/.test(log), 'R2/R3: výkres stav – popis a úprava z modelu na listu');
  ok(/✓ (řádek \d+: )?výkres: list „List 1“ vyhodnocen bez nálezů \(pohledy, řezy, Chytré kóty, poznámky a razítko\)/.test(log), 'R7: čistý list = ✓ bez nálezů (…, poznámky a razítko)');
  await closeConsole();
  // D7 (kolo 4, F10): popis plochy z modelu je vidět ve stromu prvků dílu – „Popisy ploch (2)“, F2 „Brousit“, úprava F3
  const pmi = await p.waitForSelector('[data-pmi-list]', { timeout: 30000 }).then(() => p.evaluate(() => ({ head: (document.querySelector('[data-pmi-list]') || {}).textContent || '', faces: [...document.querySelectorAll('[data-pmi]')].map((e) => `${e.getAttribute('data-pmi-face')} ${e.textContent || ''}`) })), () => null);
  ok(!!pmi && /Popisy ploch \(2\)/.test(pmi.head) && pmi.faces.some((f) => /^F2 .*Brousit/.test(f)) && pmi.faces.some((f) => /^F3 .*62\+2 HRC/.test(f)), 'D7 GUI: strom prvků – Popisy ploch (2): F2 „Brousit“, F3 úprava „62+2 HRC“ – ' + JSON.stringify(pmi && pmi.faces));
  log = await run('výkres');
  await p.waitForSelector('[data-sheet]', { timeout: 180000 }).catch(() => {});
  ok(await waitSheet('Brousit'), 'R2 GUI: odkaz „Brousit“ z modelu je na listu');
  const texts = await sheetTexts();
  for (const [lab, val] of [['Tepelné zpracování', 'kalit a popustit'], ['Tvrdost', '58-60 HRC'], ['Povrchová úprava', 'černit'], ['Hrany', 'ISO 13715 -0,3'], ['Nepředepsané tolerance', 'ISO 2768-mK'], ['Obecná drsnost', 'Ra 3,2']]) ok(texts.includes(lab) && texts.includes(val), `R1 GUI: buňka razítka „${lab}“ = „${val}“`);
  ok(!texts.some((t) => /Tepelné zpracování:|Hrany:|Nepředepsané tolerance ISO/.test(t)), 'R1 GUI: technické údaje nejsou v patičce nad razítkem');
  ok(texts.includes('Z1') && texts.some((t) => /Z1 tepelná: 62\+2 HRC/.test(t)), 'R3 GUI: značka Z1 a vysvětlivka „Z1 tepelná: 62+2 HRC“');
  const chain = await p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg polyline')].filter((e) => e.getAttribute('stroke-width') === '0.7' && (e.getAttribute('stroke-dasharray') || '').length > 0).length);
  ok(chain >= 1, `R3 GUI: tlustá čerchovaná čára 0,7 mm s čárkováním na listu (${chain})`);
  const free = ['Odmastit', 'Konzervovat'].filter((t) => texts.includes(t)).length + (texts.some((t) => /Balit/.test(t)) ? 1 : 0) + (texts.some((t) => /Z1 tepelná/.test(t)) ? 1 : 0);
  ok(free <= 5 && free === 4, `R4 GUI: nad razítkem ${free} řádků volného textu (≤ 5)`);
  await p.screenshot({ path: S + 'shots/agent-sheet.png' });

  // ── agent: 5. a 6. řádek, věta ──
  log = await run('výkres značka text "Expedovat" v 30 50\nvýkres značka text "Zabalit do fólie" v 30 45\nvýkres značka text "Při jakékoli nejasnosti kontaktujte konstruktéra." v 30 40');
  fs.writeFileSync(S + 'agent-limit.txt', log);
  ok(/✗ (řádek 2: )?.*poznámky nad razítkem – text „Zabalit do fólie“ – dokument by měl 6 řádků volného textu, nejvýš 5/.test(log), 'R4: 6. řádek agenta = ✗ drawing.notes-limit – ' + line(log, /nejvýš 5/));
  ok(/✗ (řádek 3: )?.*není strojařsky heslovitý/.test(log), 'R4: věta = ✗ drawing.note-style');
  ok(!/vyhodnocen bez nálezů/.test(log.split('\n').slice(-4).join('\n')) || /✗/.test(log), 'R7: po ✗ žádné samotné „bez nálezů“ bez chyby');
  await closeConsole();

  // ── člověk v GUI: nástroj Text, dlouhá věta – bez blokace, jen rada ──
  const LONG = 'Ruční poznámka: díl po tepelném zpracování zkontrolovat, pokud není uvedeno jinak, a předat do expedice.';
  await p.locator('[data-drawing-workspace] aside').getByRole('button', { name: 'Text', exact: true }).first().click();
  const svg = p.locator('[data-sheet] > div svg').first();
  const box = await svg.boundingBox();
  await p.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.62);
  const prompt = p.locator('div.fixed.z-\\[60\\]').filter({ hasText: 'Výška písma' }).first();
  await prompt.locator('input').first().fill(LONG);
  await prompt.getByRole('button', { name: 'OK', exact: true }).click();
  ok(await waitSheet('Ruční poznámka: díl po tepelném', 60000), 'R6 GUI: člověk vložil dlouhou větu nástrojem Text – je na listu');
  const hint = await p.locator('[data-notes-hint]').first().getAttribute('data-notes-hint').catch(() => null);
  ok(hint !== null && Number(hint) > 5, `R6 GUI: jen nenápadná rada v panelu Razítko (data-notes-hint=${hint})`);
  ok((await p.locator('[data-title-field="hardness"]').inputValue().catch(() => '')) === '58-60 HRC', 'R1 GUI: pole Tvrdost v panelu Razítko = 58-60 HRC');
  ok((await p.locator('[data-title-field="roughness"]').inputValue().catch(() => '')) === 'Ra 3,2', 'R1 GUI: pole Obecná drsnost = Ra 3,2');
  // R6: co člověk zapsal v GUI, nese v dokumentu razítko původu „user“ (pravidla pro agenty ho neomezují)
  await p.waitForTimeout(1500);
  const by = await p.evaluate((t) => { const d = window.mncad.getDocument(); return (d.drawings || []).flatMap((s) => s.annotations).filter((a) => a.type === 'text' && a.text === t).map((a) => a.by); }, LONG);
  ok(by.length === 1 && by[0] === 'user', `R6 GUI: ruční text má v dokumentu by="user" (${JSON.stringify(by)})`);
  await p.screenshot({ path: S + 'shots/human-note.png' });
  // R6 (oponent, bod 7/16): agent nesmí přerazítkovat text na „user“ – JSON přes window.mncad.run je dokument agenta → ✗
  const forged = await p.evaluate(async (t) => {
    const d = JSON.parse(JSON.stringify(window.mncad.getDocument()));
    d.name = 'Deska JSON';
    for (const s of d.drawings || []) s.annotations = s.annotations.map((a) => (a.type === 'text' ? { ...a, by: 'user' } : a));
    d.drawings[0].annotations.push(...[1, 2, 3, 4, 5, 6].map((i) => ({ id: 'z' + i, view: 'sheet', type: 'text', at: [30, 30 + i * 5], text: i + '. ' + t, size: 3.5, by: 'user' })));
    return window.mncad.run(JSON.stringify(d) + '\nvýkres export pdf');
  }, 'Kalit a popouštět na 58-60 HRC, pokud není uvedeno jinak.');
  fs.writeFileSync(S + 'forged.txt', String(forged));
  ok(/✗/.test(forged) && /drawing\.notes-limit|poznámky nad razítkem/.test(forged) && /export odmítnut/.test(forged) && !/vyhodnocen bez nálezů/.test(forged), 'R6/R7: JSON s "by":"user" od agenta = ✗, export odmítnut, žádné ✓ – ' + line(String(forged), /export odmítnut|✗/));
  // D1 (kolo 3): archivní výkres člověka ze souboru (otevřít připojeného .mncad) se 7 poznámkami – agent ho jen exportuje:
  // ⚠ drawing.notes-loaded, export PDF proběhne, žádné ✓ „bez nálezů“ ani „postaven … bez ⚠ a ✗“; úprava agentem = ✗
  const legacy = await p.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(window.mncad.getDocument()));
    d.name = 'Deska archiv';
    // archiv člověka = soubor bez razítka původu (kolo 4: text, který soubor nese jako agentův – i poznámka u razítka
    // meta.noteBy – zůstane agentův, proto se z „archivu“ smaže všude, nejen u značek)
    for (const s of d.drawings || []) {
      s.annotations = s.annotations.filter((a) => a.type !== 'text').map((a) => { const x = { ...a }; delete x.by; return x; });
      delete s.meta.noteBy; delete s.meta.by;
      for (const r of s.meta.revisions || []) delete r.by;
    }
    delete d.nameBy; delete d.materialBy;
    for (const f of d.functional || []) delete f.by;
    d.drawings[0].annotations.push(...[1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: 'h' + i, view: 'sheet', type: 'text', at: [30, 30 + i * 5], text: 'Bod ' + i, size: 3.5 })));
    window.mncad.attach({ name: 'archiv.mncad', text: JSON.stringify(d) });
    const r1 = await window.mncad.run('otevřít "archiv.mncad"\nvýkres export pdf');
    const r2 = await window.mncad.run('výkres značka text "Leštit" v 30 20');
    return { r1: String(r1), r2: String(r2) };
  });
  fs.writeFileSync(S + 'legacy.txt', legacy.r1 + '\n----\n' + legacy.r2);
  ok(/⚠ .*načtený výkres/.test(legacy.r1) && !/^✗/m.test(legacy.r1) && /výkres PDF/.test(legacy.r1) && !/vyhodnocen bez nálezů/.test(legacy.r1) && !/bez ⚠ a ✗/.test(legacy.r1), 'D1: soubor z disku se 7 poznámkami = ⚠ drawing.notes-loaded, PDF se zapíše, žádné ✓ – ' + line(legacy.r1, /načtený výkres/));
  ok(/✗ .*poznámky nad razítkem/.test(legacy.r2), 'D1: text, který agent do načteného výkresu přidá nad limit = ✗ – ' + line(legacy.r2, /✗/));
  ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 2).join(' | ')})`);
  await b.close();
})().catch((e) => {
  console.log('FAIL: výjimka ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
