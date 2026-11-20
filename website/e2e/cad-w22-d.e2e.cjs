// E2E vlna 22 – balík D, etapa D1 (body 22g a 19): kusovník v aplikaci BEZ WebGL (majitel testoval bez WebGL) i s ním.
//  - 22g: číslo a materiál zadané v záložce dílu AŽ PO vložení → panel komponenty ukáže „Kopie je starší než díl“
//    (data-copy-stale), Kusovník upozornění (data-bom-note="stale"); tlačítko „Obnovit z dílu“ (data-refresh-btn) = týž
//    příkaz `sestava obnovit` – pak kusovník i CSV nesou DA-001 / 1.2379 a upozornění zmizí;
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
  ok(/✓ list „List 1“ vydán jako rev\. A z modelu r·[0-9a-f]{6}/.test(log), `${label}: výkres vydat → rev. A z modelu r·…`);
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
