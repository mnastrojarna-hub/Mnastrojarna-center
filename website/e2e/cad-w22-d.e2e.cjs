// E2E vlna 22 – balík D, etapa D1 (body 22g a 19): kusovník v aplikaci BEZ WebGL (majitel testoval bez WebGL) i s ním.
//  - 22g: číslo a materiál zadané v záložce dílu AŽ PO vložení → panel komponenty ukáže „Kopie je starší než díl“
//    (data-copy-stale), Kusovník upozornění (data-bom-note="stale"); tlačítko „Obnovit z dílu“ (data-refresh-btn) = týž
//    příkaz `sestava obnovit` – pak kusovník i CSV nesou DA-001 / 1.2379 a upozornění zmizí;
//  - kolo 7: přepočítat vše s kolizí (⚠, ne ✓), materiál po označení jiné třídy (⚠), Kusovník → Výrobní dokumentace (data-part-drawings)
//  - 19: výběr „Druh v kusovníku“ (data-supply-select) → nakupovaný; Katalogové číslo; Kusovník v oddílech
//    (data-bom-section make/standard/buy), normálie s třídou 12.9 a kolík s m6; text v konzoli dává totéž.
//  - D2 (bod 20, výkresy a výstupy): vydaný list nese revizi modelu (odznak rev. A na záložce listu, data-sheet-issued),
//    po změně modelu odznak ⚠ (data-sheet-stale) a pruh „Model se změnil po vydání rev. A“ (data-drawing-stale-banner)
//    s tlačítkem „Vydat novou revizi B“ (data-issue-new); panel „Zastaralé výstupy“ v rohu 3D okna (data-outputs-chip,
//    data-outputs-item) a „Přepočítat vše“ (data-recompute-all) = text `přepočítat vše`; patička listu „Model r·…“.
//  - D3 (bod 18, kontrola kót pro výrobu): repro „okno vyříznuté pomocným tělesem“ – panel Kontrola kót (data-dim-check,
//    data-dim-size / data-dim-pos) bez výšky nástroje 40, pomocné těleso šedě (data-dim-aux); po smazání kót polohy 0/6
//    (data-dim-incomplete="1"), tlačítko „Přidat kótu“ (data-dim-add) u polohy díry přidá kótu (polohy 1/6), „Přidat všechny
//    navržené kóty“ (data-dim-add-all) → nic nechybí; funkční díra textem i pravým tlačítkem na plochu (Označit jako funkční)
//    → položka data-dim-functional="missing" (bez tolerance); text v konzoli dává totéž (⚠ drawing.dims-incomplete).
//  - D4 (bod 17, čitelný výkres sestavy): 12 dílů – panel „Pozice a překryvy“ (data-positions-panel) s počtem překryvů
//    (data-overlap-count), pohled pozice výběrem (data-balloon-view-select → data-balloon-view), zámek (data-balloon-lock →
//    data-balloon-mode="locked"), tažení balónku myší (posunutá pozice v textu), přesun přes geometrii → značky překryvů
//    (data-overlap-marker), umístění kusovníku (data-bom-place → data-bom-layout); text `výkres pozice` dává totéž.
//  - kolo 4 / 6 (bod 20): ztracená ruční kóta (hrana po změně modelu zmizela) – „⚠ Vybrat znovu“ (data-dim-repick) →
//    klik na novou hranu v pohledu a umístění → kóta nahrazena se stejným id a textem, ⚠ zmizí, `výkres stav` bez ⚠.
//  - D4 (bod 22j): panel Razítko – „Uložit jako šablonu“ (data-title-tpl-name, data-title-tpl-save) → `výkres hlavička`
//    vypíše šablonu; nový díl: výběr šablony (data-title-tpl-select) → razítko s firmou a nástrojářskou šablonou.
// Spuštění (fáze 2): bin/e2e-run <worktree>/website 3534 <out> cad-w22-d   (E2E_BASE nastaví e2e-run)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3534').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

async function scenario(args, label) {
  const b = await chromium.launch({ args });
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

  const input = p.getByLabel('Textové příkazy nebo JSON');
  const openConsole = async () => {
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    for (let k = 0; k < 6 && !(await input.isVisible().catch(() => false)); k++) {
      await p.keyboard.press('Control+Shift+K');
      await input.waitFor({ timeout: 15000 }).catch(() => {});
    }
    await input.waitFor({ timeout: 10000 });
  };
  const closeConsole = async () => {
    await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click().catch(() => {});
    await input.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  };
  const out = p.locator('[data-agent-output]');
  const run = async (text, ms = 300000) => {
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };
  const treeRow = (name) => p.locator('div.group.ml-3').filter({ has: p.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
  const closeModal = async () => {
    const overlay = p.locator('div.fixed.inset-0.z-\\[70\\]');
    for (let k = 0; k < 3 && (await overlay.count()) > 0; k++) {
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    }
  };

  // ── 22g: metadata dílu po vložení ──
  await openConsole();
  let log = await run('nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20');
  ok(/vložena do sestavy/.test(log), `${label}: sestava se dvěma komponentami`);
  log = await run('záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"\nzáložka "Nástroj"\nkusovník');
  ok(/asm\.stale-copy|starší než díl/.test(log), `${label}: kusovník hlásí kopii starší než díl – ` + line(log, /starší než díl/));
  ok(/Deska A \|  \| 1 \| — \(třída Ocel\)/.test(log), `${label}: kopie z vložení je v kusovníku označená (— (třída Ocel)), ne tiché „Ocel“`);
  await closeConsole();

  // panel komponenty: odznak + Obnovit z dílu
  await treeRow('Deska A').click();
  const stale = p.locator('[data-copy-stale]');
  await stale.waitFor({ timeout: 20000 }).catch(() => {});
  ok((await stale.count()) === 1 && /číslo|materiál/.test((await stale.getAttribute('data-copy-stale')) || ''), `${label}: panel „Kopie je starší než díl“ – ` + ((await stale.getAttribute('data-copy-stale').catch(() => '')) || '–'));
  // Kusovník: upozornění se stejným textem
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  ok((await p.locator('[data-bom-note="stale"]').count()) >= 1, `${label}: okno Kusovník – upozornění na zastaralou kopii`);
  // kolo 6 (22g, recenze): text upozornění v okně = text příkazu `kusovník` – u Desky A rada obnovit, ne „materiál … v dílu“
  const bomNotes = (await p.locator('[data-bom-note]').allInnerTexts().catch(() => [])).join('\n');
  ok(/Deska A: v kusovníku chybí číslo DA-001, materiál 1\.2379 – díl v záložce je má, kopie v sestavě je starší: sestava obnovit #1/.test(bomNotes) && !/Deska A[^\n]*– materiál 1\.2379 v dílu/.test(bomNotes) && !/bez čísla výkresu: Deska A/.test(bomNotes), `${label}: okno Kusovník – u starší kopie rada „sestava obnovit #1“ (ne „materiál 1.2379 v dílu“) – ` + bomNotes.replace(/\n/g, ' ¦ ').slice(0, 400));
  ok(/vyráběné díly bez označení materiálu \(jen třída\): Přidržovač – materiál 1\.2379 v dílu/.test(bomNotes), `${label}: okno Kusovník – Přidržovač (bez materiálu v dílu) dál s radou doplnit v dílu`);
  await closeModal();
  await p.locator('[data-refresh-btn="all"]').first().click();
  await p.waitForTimeout(2500);
  ok((await p.locator('[data-copy-stale]').count()) === 0, `${label}: po „Obnovit z dílu“ odznak zmizel`);
  await openConsole();
  log = await run('kusovník csv');
  ok(/Deska A \| DA-001 \| 1 \| 1\.2379/.test(log), `${label}: po obnově kusovník DA-001 / 1.2379 – ` + line(log, /Deska A \|/));
  ok(/\n1;Deska A;DA-001;1;1\.2379;/.test(log) || /1;Deska A;DA-001;1;1\.2379;/.test(log), `${label}: CSV DA-001 / 1.2379`);
  ok(!/asm\.stale-copy/.test(log), `${label}: po obnově bez ⚠ asm.stale-copy`);
  await closeConsole();

  // ── 19: druh v panelu + oddíly ──
  await treeRow('Přidržovač').click();
  const sel = p.locator('[data-supply-select]').first();
  await sel.waitFor({ timeout: 20000 });
  await sel.selectOption('buy');
  await p.waitForTimeout(800);
  const cat = p.locator('[data-supply-field="catalog"]').first();
  await cat.fill('PR-77');
  await cat.press('Enter');
  await p.waitForTimeout(800);
  ok((await p.locator('[data-supply-kind="buy"]').count()) >= 1, `${label}: druh komponenty v panelu = nakupovaný`);
  await openConsole();
  log = await run('normálie M12x40 v 50 30 20\nnormálie kolík 8x30 v 80 10 20\nkusovník');
  ok(/— Vyráběné díly —/.test(log) && /— Normálie —/.test(log) && /— Nakupované díly —/.test(log), `${label}: kusovník v oddílech`);
  ok(/ISO 4762 – M12×40 – 12\.9 \| 1 \| 12\.9/.test(log), `${label}: normálie – materiál = pevnostní třída 12.9`);
  ok(/ISO 8734 – 8×30 – m6/.test(log), `${label}: kolík si drží toleranci m6`);
  ok(/Přidržovač \| PR-77 \| 1/.test(log), `${label}: nakupovaný díl s katalogovým číslem z panelu`);
  await closeConsole();
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const sections = await p.locator('[data-bom-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bom-section')));
  ok(JSON.stringify(sections) === JSON.stringify(['make', 'standard', 'buy']), `${label}: okno Kusovník – oddíly ${JSON.stringify(sections)}`);
  await closeModal();

  // ── D2 (bod 20): vydání listu, zastaralý list, panel Zastaralé výstupy ──
  await openConsole();
  log = await run('nový díl "Deska V"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres vydat\nexport step');
  // příkaz výkresu je přijatý (→, vlna 22 – 22i), výsledek dá vyhodnocení listu (✓ list vyhodnocen / ⚠ / ✗)
  ok(/→ list „List 1“ vydán jako rev\. A z modelu r·[0-9a-f]{6}.* – výsledek po vyhodnocení listu níže/.test(log) && /✓ výkres: list „List 1“ vyhodnocen/.test(log) && !/^✗/m.test(log), `${label}: výkres vydat → rev. A z modelu r·…`);
  await closeConsole();
  await p.waitForTimeout(1500);
  const issued = p.locator('[data-sheet-issued="A"]').first();
  await issued.waitFor({ timeout: 30000 }).catch(() => {});
  ok((await issued.count()) === 1 && (await issued.getAttribute('data-sheet-stale')) === null, `${label}: záložka listu – odznak rev. A bez ⚠`);
  ok(/model r·[0-9a-f]{6}/.test(await p.locator('[data-model-rev]').first().innerText().catch(() => '')), `${label}: lišta listů ukazuje revizi modelu`);
  // změna modelu textem → list zastaralý: odznak ⚠, pruh s tlačítky
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska V"\nupravit "Kvádr 1" size=30;40;10\nvýkres stav');
  ok(/⚠ Vydání: rev\. A z modelu r·\w{6} .* list je ZASTARALÝ/.test(log) && /drawing\.stale|vydaný výkres neodpovídá modelu/.test(log), `${label}: výkres stav po změně – ⚠ zastaralý list`);
  await closeConsole();
  const chip = p.locator('[data-outputs-chip]').first();
  await chip.waitFor({ timeout: 20000 }).catch(() => {});
  ok(Number(await chip.getAttribute('data-outputs-chip').catch(() => '0')) >= 2, `${label}: odznak Zastaralé výstupy (list + STEP)`);
  await chip.click().catch(() => {});
  const kinds = await p.locator('[data-outputs-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-outputs-item')));
  ok(kinds.includes('sheet') && kinds.includes('export'), `${label}: panel – položky ${JSON.stringify(kinds)}`);
  await p.locator('[data-recompute-all]').first().click().catch(() => {});
  const res = p.locator('[data-recompute-result]').first();
  await res.waitFor({ timeout: 120000 }).catch(() => {});
  const resText = await res.innerText().catch(() => '');
  ok(/Zbývá udělat ručně \(2\)/.test(resText) && /výkres vydat B/.test(resText) && /export step/.test(resText), `${label}: Přepočítat vše – vypíše, co musí udělat člověk`);
  // výkres: pruh + nová revize tlačítkem
  await openConsole();
  await run('výkres');
  await closeConsole();
  const banner = p.locator('[data-drawing-stale-banner="A"]').first();
  await banner.waitFor({ timeout: 30000 }).catch(() => {});
  ok((await banner.count()) === 1 && (await p.locator('[data-sheet-stale="1"]').count()) >= 1, `${label}: výkres – pruh „Model se změnil po vydání rev. A“ a odznak ⚠`);
  await p.locator('[data-issue-new="B"]').first().click().catch(() => {});
  await p.waitForTimeout(1500);
  ok((await p.locator('[data-sheet-issued="B"]').count()) === 1 && (await p.locator('[data-drawing-stale-banner]').count()) === 0, `${label}: Vydat novou revizi B → odznak rev. B, pruh zmizel`);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska V"\nvýstupy');
  ok(/List 1: Vydání: rev\. B z modelu r·\w{6} .* – odpovídá modelu/.test(log) && /Zastaralé výstupy \(1\)/.test(log), `${label}: výstupy – list rev. B odpovídá, zbývá jen STEP`);
  await closeConsole();
  // kolo 3 (bod 20): změna jen materiálu (geometrie a revize r·… stejné) – vydaný list rev. B je zastaralý (údaje razítka), STEP ne
  await openConsole();
  log = await run('záložka "Deska V"\nmateriál 1.2379\nvýkres stav');
  ok(/⚠ Vydání: rev\. B z modelu (r·\w{6}) .* model je teď \1 se změněnými údaji dílu/.test(log), `${label}: kolo 3 – jen materiál: ⚠ vydaný list rev. B zastaralý (údaje dílu) – ` + line(log, /Vydání: rev\. B/));
  await run('výkres');
  await closeConsole();
  const banner2 = p.locator('[data-drawing-stale-banner="B"]').first();
  await banner2.waitFor({ timeout: 30000 }).catch(() => {});
  ok((await banner2.count()) === 1 && /se změněnými údaji dílu/.test(await banner2.innerText().catch(() => '')) && (await p.locator('[data-sheet-stale="1"]').count()) >= 1, `${label}: kolo 3 – pruh a odznak ⚠ po změně jen materiálu`);
  await p.keyboard.press('Escape').catch(() => {});

  // ── D3 (bod 18): kontrola kót pro výrobu ──
  await openConsole();
  log = await run('nový díl "Deska K"\nkvádr 100 60 20\nkvádr 30 20 40 v 35 20 -10 nové těleso Nástroj\nsloučit 1 Nástroj odebrat\ndíra 8 skrz v 15 15 20 těleso 1\ndíra 8 skrz v 85 45 20 těleso 1\nvýkres A3 na šířku pohledy přední,horní\nvýkres nepředepsané ISO 2768-mK\nkótovat\nvýkres stav');
  ok(/Kontrola kót: velikosti (\d+)\/\1 · polohy (\d+)\/\2 · pomocná tělesa \(nekótují se\): Nástroj/.test(log) && !/40 \(Kvádr 2\)/.test(log) && !/všech \d+ očekávaných/.test(log), `${label}: výkres stav – okno a polohy, bez výšky nástroje 40, bez „všech“`);
  await run('výkres');
  await closeConsole();
  const checkBtn = p.getByRole('button', { name: /Kontrola kót/ }).first();
  await checkBtn.waitFor({ timeout: 60000 }).catch(() => {});
  await checkBtn.click().catch(() => {});
  const dc = p.locator('[data-dim-check]').first();
  await dc.waitFor({ timeout: 30000 }).catch(() => {});
  const sz = await dc.getAttribute('data-dim-size').catch(() => '');
  const ps = await dc.getAttribute('data-dim-pos').catch(() => '');
  ok(/^(\d+)\/\1$/.test(sz || '') && /^(\d+)\/\1$/.test(ps || '') && (await dc.getAttribute('data-dim-incomplete')) === '0', `${label}: panel Kontrola kót – velikosti ${sz}, polohy ${ps}, nic nechybí`);
  ok(/Nástroj/.test(await p.locator('[data-dim-aux]').first().innerText().catch(() => '')), `${label}: panel – pomocné těleso Nástroj se nekótuje`);
  ok(!/\b40\b/.test(await p.locator('[data-dim-sizes]').first().innerText().catch(() => '')), `${label}: panel – velikost 40 (nástroj) se neočekává`);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska K"\nvýkres smazat vše\nvýkres kóta vodorovně pohled horní 0 0 100 0\nvýkres kóta svisle pohled horní 0 0 0 60\nvýkres kóta svisle pohled přední 0 0 0 20\nvýkres kóta vodorovně pohled horní 35 20 65 20\nvýkres kóta průměr pohled horní střed 15 15 r 4\nvýkres stav');
  ok(/drawing\.dims-incomplete|kóty neúplné/.test(log) && /polohy 0\/6/.test(log) && /na listu 1× z 2×/.test(log), `${label}: text – ⚠ kóty neúplné, polohy 0/6, Ø8 1× z 2×`);
  await run('výkres');
  await closeConsole();
  await p.getByRole('button', { name: /Kontrola kót/ }).first().click().catch(() => {});
  const dc2 = p.locator('[data-dim-check]').first();
  await dc2.waitFor({ timeout: 30000 }).catch(() => {});
  ok((await dc2.getAttribute('data-dim-incomplete').catch(() => '')) === '1' && (await dc2.getAttribute('data-dim-pos').catch(() => '')) === '0/6', `${label}: panel – chybí polohy (0/6)`);
  const addHole = p.locator('[data-dim-add^="holepos:"]').first();
  await addHole.click().catch(() => {});
  await p.waitForTimeout(1200);
  ok((await p.locator('[data-dim-check]').first().getAttribute('data-dim-pos').catch(() => '')) === '1/6', `${label}: Přidat kótu u polohy díry → polohy 1/6`);
  await p.locator('[data-dim-add-all]').first().click().catch(() => {});
  await p.waitForTimeout(1500);
  ok((await p.locator('[data-dim-check]').first().getAttribute('data-dim-incomplete').catch(() => '')) === '0', `${label}: Přidat všechny navržené kóty → nic nechybí`);
  await p.keyboard.press('Escape').catch(() => {});
  // funkční díra textem → v panelu funkční položka bez tolerance
  await openConsole();
  log = await run('záložka "Deska K"\nfunkční "Díra 1" H7\nvýkres stav');
  ok(/✓ funkční Díra 1 · tolerance H7/.test(log) && /funkční prvky: tolerance 0\/\d+/.test(log), `${label}: funkční „Díra 1“ H7 → tolerance 0/n ve výkres stav`);
  await run('výkres');
  await closeConsole();
  await p.getByRole('button', { name: /Kontrola kót/ }).first().click().catch(() => {});
  await p.locator('[data-dim-check]').first().waitFor({ timeout: 30000 }).catch(() => {});
  ok((await p.locator('[data-dim-functional="missing"]').count()) >= 1 && /Díra 1/.test(await p.locator('[data-dim-functional-marks]').first().innerText().catch(() => '')), `${label}: panel – funkční Díra 1 bez tolerance`);
  await p.keyboard.press('Escape').catch(() => {});
  // pravé tlačítko na plochu modelu → Označit jako funkční (text přes engine)
  const vpBox = await p.locator('main canvas, [data-soft-view-canvas], [data-soft]').first().boundingBox().catch(() => null);
  if (vpBox) {
    await p.mouse.click(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2, { button: 'right' });
    await p.waitForTimeout(500);
    const mark = p.getByRole('button', { name: 'Označit jako funkční' }).first();
    const has = await mark.isVisible().catch(() => false);
    if (has) await mark.click();
    await p.waitForTimeout(1500);
    await openConsole();
    log = await run('záložka "Deska K"\nfunkční');
    ok(has && /Funkční prvky a základny \(2\):/.test(log), `${label}: pravé tlačítko na plochu → Označit jako funkční (funkční prvky 2)`);
    await closeConsole();
  } else ok(false, `${label}: 3D okno pro pravé tlačítko nenalezeno`);

  // ── D4 (bod 17): pozice po pohledech, zámek, tažení, překryvy, kusovník ──
  await openConsole();
  {
    const L = [];
    for (let i = 1; i <= 12; i++) L.push(`nový díl Deska P${i}`, `kvádr 20 10 ${4 + (i % 4)}`);
    L.push('nová sestava Sestava P');
    for (let i = 1; i <= 12; i++) L.push(i === 1 ? 'vložit "Deska P1" ukotvit' : `vložit "Deska P${i}" v ${((i - 1) % 4) * 25} ${Math.floor((i - 1) / 4) * 15} ${(i % 3) * 8}`);
    L.push('výkres A3 na šířku pohledy přední,horní', 'výkres kusovník ano', 'výkres balónky ano', 'výkres pozice');
    log = await run(L.join('\n'), 600000);
  }
  ok(/Pozice: 12 \(/.test(log) && /Překryvy na listu: 0 \(zkontrolováno/.test(log), `${label}: výkres pozice – 12 pozic, překryvy 0 (zkontrolováno)`);
  await run('výkres');
  await closeConsole();
  const panel = p.locator('[data-positions-panel]').first();
  await panel.waitFor({ timeout: 60000 }).catch(() => {});
  // list se v okně výkresu počítá asynchronně (prodleva + jádro): počkat na hotový list, ne číst první snímek panelu
  await p.waitForFunction(() => document.querySelectorAll('[data-balloon-row]').length === 12 && !!document.querySelector('[data-positions-panel] [data-overlap-count="0"]'), null, { timeout: 90000 }).catch(() => {});
  ok((await panel.locator('[data-overlap-count="0"]').count()) === 1, `${label}: panel Pozice a překryvy – odznak Překryvy: 0`);
  ok((await p.locator('[data-balloon-row]').count()) === 12, `${label}: panel – 12 řádků pozic`);
  await p.locator('[data-balloon-view-select="1"]').first().selectOption('top').catch(() => {});
  await p.waitForFunction(() => document.querySelector('[data-balloon-row="1"]')?.getAttribute('data-balloon-view') === 'top', null, { timeout: 60000 }).catch(() => {});
  ok((await p.locator('[data-balloon-row="1"]').getAttribute('data-balloon-view').catch(() => '')) === 'top', `${label}: pozice 1 → pohled horní (výběrem v panelu)`);
  // změna pohledu pozice 1 list přepočítá a panel překreslí – zámek klikat až na hotový panel (12 řádků), případně znovu
  for (let i = 0; i < 3; i++) {
    await p.waitForFunction(() => document.querySelectorAll('[data-balloon-row]').length === 12 && !!document.querySelector('[data-positions-panel] [data-overlap-count]:not([data-overlap-count=""])'), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(500);
    await p.locator('[data-balloon-lock="2"]').first().check().catch(() => {});
    const done = await p.waitForFunction(() => document.querySelector('[data-balloon-row="2"]')?.getAttribute('data-balloon-mode') === 'locked', null, { timeout: 20000 }).then(() => true).catch(() => false);
    if (done) break;
  }
  ok((await p.locator('[data-balloon-row="2"]').getAttribute('data-balloon-mode').catch(() => '')) === 'locked', `${label}: zámek pozice 2 v panelu`);
  // tažení balónku 5 myší (výběr ve výkresu – genEdit move)
  await p.waitForFunction(() => document.querySelectorAll('[data-balloon-row]').length === 12, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(800); // list po zámku přepočítán (prodleva okna výkresu)
  const b5 = p.locator('[data-sheet] svg text').filter({ hasText: /^5$/ }).first();
  const bb5 = await b5.boundingBox().catch(() => null);
  if (bb5) {
    const cx = bb5.x + bb5.width / 2;
    const cy = bb5.y + bb5.height / 2;
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx + 15, cy + 25, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(1500);
  }
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Sestava P"\nvýkres pozice');
  ok(/zamčené 1/.test(log) && /horní: 1/.test(log), `${label}: text po GUI – pozice 1 u horního pohledu, zámek pozice 2`);
  ok(!!bb5 && /posunuté [1-9]/.test(log), `${label}: tažení balónku myší → posunutá pozice`);
  // přesun pozice do geometrie → překryv: odznak a značky na listu
  log = await run('výkres vygenerované posun pos:7 0 -40\nvýkres pozice');
  ok(/Překryvy na listu: [1-9]/.test(log), `${label}: přesun přes geometrii → překryv v textu`);
  await run('výkres');
  await closeConsole();
  await p.waitForFunction(() => Number(document.querySelector('[data-overlap-count]')?.getAttribute('data-overlap-count') || '0') > 0, null, { timeout: 60000 }).catch(() => {});
  ok(Number(await p.locator('[data-overlap-count]').first().getAttribute('data-overlap-count').catch(() => '0')) > 0 && (await p.locator('[data-overlap-marker]').count()) > 0, `${label}: odznak překryvů > 0 a červené značky na listu`);
  await p.locator('[data-bom-place]').first().selectOption('columns').catch(() => {});
  await p.waitForFunction(() => document.querySelector('[data-bom-layout]')?.getAttribute('data-bom-layout') === 'columns', null, { timeout: 60000 }).catch(() => {});
  ok((await p.locator('[data-bom-layout]').first().getAttribute('data-bom-layout').catch(() => '')) === 'columns', `${label}: Kusovník ve sloupcích (výběr v panelu)`);

  // ── D4 (bod 22j): šablona hlavičky z panelu Razítko ──
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  await run('nový díl "Deska H"\nkvádr 60 40 10\nvýkres A4\nvýkres razítko šablona=nástrojářská firma="Firma s.r.o."\nvýkres');
  await closeConsole();
  await p.getByRole('button', { name: /Razítko/ }).first().click().catch(() => {});
  await p.locator('[data-title-tpl-name]').first().fill('Firma').catch(() => {});
  await p.locator('[data-title-tpl-save]').first().click().catch(() => {});
  await p.waitForTimeout(1000);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska H"\nvýkres hlavička');
  ok(/Šablony hlavičky: v dokumentu „Firma“ \(nástrojářská/.test(log), `${label}: Uložit jako šablonu → výkres hlavička vypíše „Firma“`);
  await run('nový díl "Deska H2"\nkvádr 30 20 10\nvýkres A4\nvýkres');
  await closeConsole();
  await p.getByRole('button', { name: /Razítko/ }).first().click().catch(() => {});
  await p.locator('[data-title-tpl-select]').first().selectOption('Firma').catch(() => {});
  await p.waitForTimeout(1000);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska H2"\nvýkres razítko');
  ok(/nástrojářská/.test(log) && /firma „Firma s\.r\.o\.“/.test(log) && /šablona hlavičky „Firma“/.test(log), `${label}: výběr šablony hlavičky v panelu → razítko podle šablony`);
  await closeConsole();

  // ── kolo 3 (fáze 2): ruční kóta po změně modelu (bod 20) a list sestavy ze zastaralé kopie (22g) – GUI ──
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('nový díl "Deska R"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres kóta vodorovně pohled přední 0 10 60 10 odsazení 10');
  ok(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/.test(log), `${label}: kolo 3 – ruční kóta 60 na listu, list bez nálezů`);
  log = await run('záložka "Deska R"\nupravit "Kvádr 1" size=30;40;10\nvýkres stav');
  ok(/drawing\.dim-detached|neodpovídají geometrii/.test(log) && /30 \(zadáno 60\) \* ⚠/.test(log) && !/vyhodnocen bez nálezů/.test(log), `${label}: kolo 3 – po změně ⚠ odpojená kóta, žádné „bez nálezů“ – ` + line(log, /zadáno 60/));
  await run('výkres');
  await closeConsole();
  // konzole nad výkresem (s WebGL se „Zavřít“ občas netrefí) – zavřít zkratkou, jinak modální okno kryje seznam kót
  // („Zavřít“ .last() může trefit jiné tlačítko Zavřít na stránce – zavřít tlačítkem v okně konzole)
  const consoleBox = p.locator('div.fixed.inset-0.z-\\[70\\]').filter({ has: input });
  for (let k = 0; k < 3 && (await input.isVisible().catch(() => false)); k++) {
    await consoleBox.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {});
    await input.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
  if (await input.isVisible().catch(() => false)) {
    console.log('KONZOLE zůstala otevřená:', JSON.stringify(await p.getByRole('button', { name: 'Zavřít', exact: true }).evaluateAll((els) => els.map((e) => (e.closest('[class]') || e).className.slice(0, 80)))));
    await p.screenshot({ path: process.argv[2] + '/kolo3-konzole.png' }).catch(() => {});
  }
  const moved = p.locator('[data-ann-flag="moved"]');
  await moved.first().waitFor({ timeout: 60000 }).catch(() => {});
  ok((await moved.count()) === 1 && (await p.locator('[data-ann-flagged]').count()) === 1, `${label}: kolo 3 – seznam kót: ⚠ u přichycené kóty a souhrn ve stavovém řádku`);
  // list se po otevření ještě dopočítává (Chytré kóty) – jako v cad-drawing-dims: počkat a klikat, dokud značka nezmizí
  // (nejvýš 5×); počet kliknutí je ve zprávě, 0 kliknutí = neprošlo (značka zmizela jinak než potvrzením)
  await p.waitForTimeout(2000);
  // otevřené modální okno (z-[70]) nad výkresem – jen vypsat (diagnostika; klik by nedopadl na seznam kót)
  const modal = p.locator('div.fixed.inset-0.z-\\[70\\]');
  if ((await modal.count()) > 0) console.log('MODAL:', (await modal.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
  let clicks = 0;
  for (; clicks < 5 && (await moved.count()) > 0; clicks++) {
    await moved.first().click().catch((e) => console.log('klik:', String(e).replace(/\s+/g, ' ').slice(0, 1500)));
    await p.waitForTimeout(1500);
  }
  ok(clicks >= 1 && (await p.locator('[data-ann-flag]').count()) === 0 && (await p.locator('[data-ann-row]').count()) > 0, `${label}: kolo 3 – kliknutím potvrzená kóta už označená není (kliknutí: ${clicks}, seznam kót otevřený)`);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska R"\nvýkres stav');
  ok(!/drawing\.dim-detached|neodpovídají geometrii/.test(log) && /přední: 30 \*/.test(log), `${label}: kolo 3 – po potvrzení v GUI text bez ⚠, kóta 30 *`);
  // ── kolo 4 / 6: ztracená ruční kóta (hrana zmizela) – „⚠ Vybrat znovu“ (data-dim-repick), klik na novou hranu a umístění
  //    → kóta zůstane s týmž id, ⚠ zmizí, text bez drawing.dim-detached
  log = await run('nový díl "Deska L"\nkvádr 60 40 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres kóta svisle pohled přední 60 0 60 10 odsazení 10 text \"(10)\"');
  log = await run('záložka "Deska L"\nupravit "Kvádr 1" size=30;40;10\nvýkres stav');
  ok(/drawing\.dim-detached|neodpovídají geometrii/.test(log) && /geometrie, ke které se kóta váže, v pohledu není/.test(log), `${label}: kolo 6 – ztracená kóta ⚠ v textu – ` + line(log, /v pohledu není/));
  await run('výkres');
  for (let k = 0; k < 3 && (await input.isVisible().catch(() => false)); k++) {
    await consoleBox.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {});
    await input.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
  const rp = p.locator('[data-dim-repick]');
  await rp.first().waitFor({ timeout: 60000 }).catch(() => {});
  const rpId = await rp.first().getAttribute('data-dim-repick').catch(() => null);
  ok((await rp.count()) === 1 && !!rpId, `${label}: kolo 6 – u ztracené kóty tlačítko „Vybrat znovu“ (data-dim-repick)`);
  const rowsBefore = await p.locator('[data-ann-row]').count();
  await rp.first().click().catch(() => {});
  ok((await p.locator('[data-dim-repicking="1"]').count()) === 1, `${label}: kolo 6 – po kliknutí výběr nové geometrie (data-dim-repicking)`);
  // přední pohled: model (x, z) → obrazovka podle data-views (z nahoru = −y pohledu)
  const fm = await p.evaluate(() => { const s = document.querySelector('[data-sheet] > div svg'); const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, k: r.width / Number(s.getAttribute('viewBox').split(' ')[2]), views: JSON.parse(document.querySelector('[data-sheet]').getAttribute('data-views')) }; }).catch(() => null);
  const fv = fm && fm.views.find((x) => x.key === 'front');
  const F = (x, z) => [fm.l + (fv.px + (x - fv.x0) * fv.s) * fm.k, fm.t + (fv.py + (-z - fv.y0) * fv.s) * fm.k];
  if (fv) {
    // pravá svislá hrana (x = 30) a umístění vpravo od ní
    for (const [x, z] of [[30, 5], [30 + 12 / fv.s, 5]]) {
      const [cx, cy] = F(x, z);
      await p.mouse.move(cx, cy);
      await p.waitForTimeout(200);
      await p.mouse.click(cx, cy);
      await p.waitForTimeout(500);
    }
  }
  // (bez Esc – nástroj se po novém výběru vypne sám a Esc bez nástroje by zavřel výkres)
  await p.waitForFunction(() => !document.querySelector('[data-dim-repick]'), null, { timeout: 30000 }).catch(() => {});
  ok(!!fv && (await p.locator('[data-dim-repick]').count()) === 0 && (await p.locator(`[data-ann-row="${rpId}"]`).count()) === 1 && (await p.locator('[data-ann-row]').count()) === rowsBefore, `${label}: kolo 6 – kóta znovu přichycena: ⚠ zmizel, id ${rpId} zůstalo, počet kót ${rowsBefore}`);
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska L"\nvýkres stav');
  ok(!/drawing\.dim-detached|neodpovídají geometrii/.test(log) && /přední: \(10\) \*/.test(log), `${label}: kolo 6 – po novém výběru text bez ⚠, kóta „(10)“ s textem uživatele – ` + line(log, /přední:/));
  log = await run('nový díl "Deska S"\nkvádr 50 30 10\nnová sestava "Nástroj S"\nvložit "Deska S" ukotvit\nzáložka "Deska S"\nmateriál 1.2379\nzáložka "Nástroj S"\nvýkres A3');
  ok(/starší než díl/.test(log) && !/✓ výkres: list „List 1“ vyhodnocen bez nálezů/.test(log), `${label}: kolo 3 – list sestavy se zastaralou kopií bez „bez nálezů“`);
  await run('výkres');
  await closeConsole();
  const sc = p.locator('[data-drawing-stale-copy]').first();
  await sc.waitFor({ timeout: 60000 }).catch(() => {});
  ok(Number(await sc.getAttribute('data-drawing-stale-copy').catch(() => '0')) === 1 && /Deska S/.test(await sc.innerText().catch(() => '')), `${label}: kolo 3 – výkresové prostředí sestavy: odznak „kusovník z kopie starší než díl“`);
  await p.locator('[data-drawing-stale-copy-refresh]').first().click().catch(() => {});
  await p.waitForFunction(() => !document.querySelector('[data-drawing-stale-copy]'), null, { timeout: 120000 }).catch(() => {});
  ok((await p.locator('[data-drawing-stale-copy]').count()) === 0, `${label}: kolo 3 – Přepočítat vše obnoví kopii, odznak zmizí`);
  await p.keyboard.press('Escape').catch(() => {});

  // ── kolo 7: přepočítat vše bez falešné zelené, materiál, Výrobní dokumentace (body 20, 22g, 19) ──
  await openConsole();
  log = await run('nový díl "Deska K"\nkvádr 100 60 20\nnový díl "Přidržovač K"\nkvádr 40 30 10\nnová sestava "Nástroj K"\nvložit "Deska K" ukotvit\nvložit "Přidržovač K" v 10 10 20\nkolize\nzáložka "Deska K"\nupravit "Kvádr 1" size=100;60;25\nzáložka "Nástroj K"\npřepočítat vše');
  ok(!/✓ kontrola kolizí znovu/.test(log) && /⚠ kontrola kolizí znovu \(kolize\) – nalezeno kolizí: 1/.test(log), `${label}: kolo 7 – přepočítat vše s kolizí: ⚠ s počtem, žádné ✓ – ` + line(log, /kontrola kolizí znovu/));
  log = await run('nový díl "Deska M"\nkvádr 10 10 10\nmateriál ČSN 11 423\nmateriál nerez');
  ok(!/✓ materiál = Nerez/.test(log) && /je třídy Ocel, hustota se ale počítá podle třídy Nerez/.test(log), `${label}: kolo 7 – materiál nerez po ČSN 11 423 = ⚠ class-conflict – ` + line(log, /třídy Ocel/));
  log = await run('nový díl "Deska V"\nkvádr 50 30 10\nnová sestava "Nástroj V"\nvložit "Deska V" ukotvit');
  await closeConsole();
  await p.locator('button', { hasText: /^Kusovník/ }).first().click().catch(() => {});
  const pdBtn = p.locator('[data-part-drawings]').first();
  await pdBtn.waitFor({ timeout: 20000 }).catch(() => {});
  ok((await pdBtn.count()) === 1, `${label}: kolo 7 – okno Kusovník: tlačítko „Výrobní dokumentace“`);
  await pdBtn.click().catch(() => {});
  await p.waitForFunction(() => /Výkresy dílů sestavy/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  const flashText = await p.evaluate(() => document.body.innerText);
  ok(/Výkresy dílů sestavy „Nástroj V“/.test(flashText) && /Deska V – list „List 1“/.test(flashText), `${label}: kolo 7 – Výrobní dokumentace založí list dílu – ` + line(flashText, /Deska V – list/));
  await closeModal();
  await p.keyboard.press('Escape').catch(() => {});
  await openConsole();
  log = await run('záložka "Deska V"\nvýkres výkresy\nzáložka "Nástroj V"\nvýkresy dílů');
  ok(/List 1/.test(log) && /Výkres už mají \(1\)/.test(log) && !/Založeno/.test(log.split('Výkresy dílů sestavy').pop() || ''), `${label}: kolo 7 – díl má list, opakování nic nezaloží – ` + line(log, /Výkres už mají/));
  await closeConsole();

  ok(errs.length === 0, `${label}: bez chyb stránky ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
}

(async () => {
  await scenario(NO_GL, 'bez WebGL');
  await scenario([], 'WebGL');
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
