// E2E (vlna 19, balík ui): průvodce „Kola a ozubení“ myší.
//  – 3 kliknutí + 2 čísla: pás karet › Kola a ozubení → dlaždice Čelní → modul, počet zubů → Vytvořit = jeden prvek
//    „Ozubené kolo m3 z30“; spočtený řádek dₐ se mění při psaní; chyba přímo pod řádkem (z = 3) a Vytvořit je zakázané,
//  – úprava z v historii TOU SAMOU tabulkou (formulář prvku = tabulka) → přestavba,
//  – výstup Polotovar a pak Zuby do tělesa (řez do polotovaru), 3D náhled v průvodci,
//  – soukolí z pásu karet (z₁ 20, z₂ 60, m 2, a 81) → 3 záložky, sestava se 2 komponentami a vazbou Ozubení, převod 3,
//  – sestava jako otevřený dokument → kolo jako nový díl (skript existujících příkazů),
//  – vstupy: paleta Ctrl+K, úvodní obrazovka, knihovna normálií (předvyplněná tabulka), text `akce gear.wizard` bez okna,
//  – angličtina a němčina: pás karet, tabulka, vytvoření.
// Spuštění (produkční build): E2E_BASE=http://localhost:3462 node e2e/cad-w19-ui.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w19-ui').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3462').replace(/\/$/, '');

async function open(b, path = '/cad') {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 300000 });
  const cont = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/);
  if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
  await p.waitForFunction(() => !!window.mncad && !/Načítám jádro|Loading kernel|Kernel wird geladen/.test(document.body.innerText), null, { timeout: 240000 });
  await p.waitForTimeout(1000);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const { p, errs } = await open(b);
    const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
    const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {}); await p.waitForTimeout(300); };
    const status = () => p.evaluate(() => window.mncad.status());
    const doc = () => p.evaluate(() => window.mncad.getDocument());
    const tabs = () => p.evaluate(() => window.mncad.tabs());
    const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
    const statusBecomes = async (re, ms = 90000) => { const t0 = Date.now(); let st = ''; while (Date.now() - t0 < ms) { st = await status(); if (re.test(st)) return st; await p.waitForTimeout(250); } return st; };
    const W = '[data-gear-wizard]';
    const wiz = (sel = '') => p.locator(`${W} ${sel}`.trim()).first();
    const rowIn = (key) => p.locator(`${W} [data-gear-row="${key}"] input`).first();
    const tabCreate = async () => { await p.getByRole('button', { name: /^(Tvorba|Create|Erstellen)$/ }).first().click().catch(() => {}); await p.waitForTimeout(300); };
    const ribbonBtn = (id) => p.locator(`[data-ribbon] [data-tip-id="${id}"] button`).first();
    const wizardOpen = (view) => p.waitForSelector(view ? `[data-gear-wizard="${view}"]` : W, { timeout: 15000 }).then(() => true, () => false);
    const wizardGone = () => p.waitForSelector(W, { state: 'detached', timeout: 60000 }).then(() => true, () => false);
    const cancel = async () => { await p.locator('[data-gear-cancel] button').first().click(); await wizardGone(); };

    // ── 1. 3 kliknutí + 2 čísla ──
    await run('nový díl');
    await idle();
    await tabCreate();
    let clicks = 0;
    await ribbonBtn('gear.wizard').click(); clicks++;
    ok(await wizardOpen('gallery'), 'pás karet › Tvorba › Kola a ozubení otevře galerii druhů');
    const tiles = await p.locator(`${W} [data-gear-kind]`).count();
    ok(tiles === 15, `galerie: 14 druhů + Soukolí (${tiles} dlaždic s obrázkem)`);
    await p.screenshot({ path: S + 'w19-ui-gallery.png' });
    await wiz('[data-gear-kind="spur"]').click(); clicks++;
    ok(await wizardOpen('table'), 'klik na dlaždici Čelní → tabulka druhu');
    const focused = await p.evaluate(() => document.activeElement?.closest('[data-gear-row]')?.getAttribute('data-gear-row'));
    ok(focused === 'm', `fokus je v prvním povinném řádku (modul): ${focused}`);
    const daBefore = await wiz('[data-gear-calc="da"]').innerText();
    await rowIn('m').fill('3');
    await rowIn('z').fill('30');
    const daAfter = await wiz('[data-gear-calc="da"]').innerText();
    ok(/52[.,]000/.test(daBefore) && /96[.,]000/.test(daAfter), `spočtený řádek dₐ se mění při psaní: „${daBefore.replace(/\s+/g, ' ')}“ → „${daAfter.replace(/\s+/g, ' ')}“`);
    const title = await wiz('[data-gear-title]').innerText();
    ok(title === 'Ozubené kolo m3 z30', `název pod náhledem: ${title}`);
    ok(await p.locator(`${W} [data-gear-preview="spur"] svg path`).count() > 0 && await p.locator(`${W} [data-gear-detail]`).count() === 1, 'živý 2D náhled: obrys zubů + detail zubu 0');
    await p.screenshot({ path: S + 'w19-ui-table.png' });
    let t0 = Date.now();
    await p.locator('[data-gear-create] button').first().click(); clicks++;
    await p.waitForFunction(() => window.mncad.getDocument().features.length === 1, null, { timeout: 30000 }).catch(() => {});
    const tCommit = Date.now() - t0;
    ok(await wizardGone(), 'Vytvořit zavře průvodce');
    let st = await statusBecomes(/prvků 1 \(1 ✓, 0 ✗\)/);
    const tCreate = Date.now() - t0;
    let d = await doc();
    const f = d.features[0];
    ok(d.features.length === 1 && f.type === 'ext' && f.ext === 'gear.spur' && f.name === 'Ozubené kolo m3 z30' && f.data.m === 3 && f.data.z === 30, `${clicks} kliknutí + 2 čísla → jeden prvek „${f && f.name}“ (gear.spur, m 3, z 30)`);
    ok(/Geometrie: platná/.test(st) && /Rozměry: 96 × /.test(st), `těleso platné, obálka X = 96 (dₐ = 96, zub 0 na +X); od kliknutí po hotové těleso ${tCreate} ms (z toho průvodce → prvek v historii ${tCommit} ms, zbytek stavba v jádře)`);
    ok(tCommit < 1000, `průvodce zapíše prvek do historie za ${tCommit} ms (< 1 s); stavba tělesa v jádře ve workeru ${tCreate - tCommit} ms`);
    ok(d.name === 'Ozubené kolo m3 z30', `prázdný díl převzal název kola: ${d.name}`);

    // ── 2. chyba pod řádkem ──
    await ribbonBtn('gear.wizard').click();
    await wizardOpen('gallery');
    await wiz('[data-gear-kind="spur"]').click();
    await wizardOpen('table');
    const zKept = await rowIn('z').inputValue();
    ok(zKept === '30', `naposledy použité hodnoty druhu se pamatují (z = ${zKept})`);
    await rowIn('z').fill('3');
    const iss = wiz('[data-gear-issue="z"]');
    const issText = await iss.innerText().catch(() => '');
    const disabled = await p.locator('[data-gear-create] button').first().isDisabled();
    ok(/✗/.test(issText) && /nejmenší hodnota je 5/.test(issText) && disabled, `z = 3 → hláška přímo pod řádkem „${issText.trim()}“, Vytvořit zakázané`);
    await p.screenshot({ path: S + 'w19-ui-error.png' });
    await rowIn('z').fill('30');
    await cancel();

    // ── 3. úprava z v historii tou samou tabulkou ──
    const v30 = await vol();
    await p.locator(`[data-feature-row="${f.id}"]`).first().click();
    const form = p.locator('[data-gear-form="spur"]').first();
    const formOk = await form.waitFor({ timeout: 15000 }).then(() => true, () => false);
    ok(formOk && await form.locator('[data-gear-table]').count() === 1 && await form.locator('[data-gear-calc="Wk"]').count() === 1, 'formulář úprav prvku = stejná tabulka (řádky, nápověda, spočtené řádky W_k …)');
    await p.screenshot({ path: S + 'w19-ui-edit.png' });
    const zEdit = form.locator('[data-gear-row="z"] input').first();
    await zEdit.fill('40'); await zEdit.press('Enter');
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: 'OK', exact: true }).first().click().catch(() => {});
    await idle();
    st = await statusBecomes(/čelní m3 z40/);
    const v40 = await vol();
    ok(/čelní m3 z40/.test(st) && v40 > v30 * 1.3 && (await doc()).features.length === 1, `změna z na 40 v tabulce prvku → přestavba (objem ${v30} → ${v40} cm³), pořád jeden prvek`);

    // ── 4. polotovar a zuby do tělesa, 3D náhled ──
    await run('nový díl "Polotovar"');
    await idle();
    await ribbonBtn('gear.wizard').click();
    await wizardOpen('gallery');
    await wiz('[data-gear-kind="spur"]').click();
    await rowIn('m').fill('2'); await rowIn('z').fill('24');
    await wiz('[data-gear-3d="off"]').click();
    const ready = await p.waitForSelector('[data-gear-3d="ready"]', { timeout: 90000 }).then(() => true, () => false);
    ok(ready, '3D náhled v průvodci (jádro ve workeru)');
    await p.locator('[data-gear-out="blank"]').click();
    const teethDisabled = await p.locator('[data-gear-out="teeth"]').isDisabled();
    ok(teethDisabled, 'Zuby do tělesa jsou v prázdném dílu zakázané (není do čeho řezat)');
    await p.locator('[data-gear-create] button').first().click();
    await wizardGone();
    st = await statusBecomes(/prvků 1 \(1 ✓/);
    const vBlank = await vol();
    ok(/Geometrie: platná/.test(st) && (await doc()).features[0].data.out === 'blank' && Math.abs(vBlank - Math.PI * 2.6 * 2.6 * 2.0) < 0.05, `výstup Polotovar: soustružený válec Ø52 × 20 (${vBlank} cm³)`);
    await ribbonBtn('gear.wizard').click();
    await wizardOpen('gallery');
    await wiz('[data-gear-kind="spur"]').click();
    await p.locator('[data-gear-out="teeth"]').click();
    await p.locator('[data-gear-create] button').first().click();
    await wizardGone();
    st = await statusBecomes(/prvků 2 \(2 ✓/);
    const vTeeth = await vol();
    d = await doc();
    ok(/Geometrie: platná/.test(st) && d.features[1].data.out === 'teeth' && d.features[1].data.mode === 'cut' && Math.abs(vTeeth - 35.75) < 0.05, `výstup Zuby do tělesa: mezery vyříznuté do polotovaru = hotové kolo (${vTeeth} cm³, kolo 35,75 cm³)`);

    // ── 5. soukolí ──
    const tabsBefore = (await tabs()).length;
    await ribbonBtn('gear.pair').click();
    ok(await wizardOpen('pair'), 'pás karet › Soukolí otevře tabulku soukolí');
    await rowIn('z1').fill('20'); await rowIn('z2').fill('60'); await rowIn('m').fill('2'); await rowIn('a').fill('81');
    const sumX = await wiz('[data-gear-calc="sumX"]').innerText();
    ok(/0[.,]52/.test(sumX), `zadaná osová vzdálenost 81 → Σx (DIN 3992) ${sumX.replace(/\s+/g, ' ')}`);
    ok(await p.locator(`${W} [data-gear-preview="pair-spur"] svg path`).count() >= 3, 'náhled soukolí: obě kola v záběru + přímka záběru');
    await p.screenshot({ path: S + 'w19-ui-pair.png' });
    t0 = Date.now();
    await p.locator('[data-gear-pair-create] button').first().click();
    ok(await wizardGone(), 'Vytvořit soukolí zavře průvodce');
    await idle();
    st = await statusBecomes(/Vazby: 1 \(1 ok\)/, 120000);
    const tb = await tabs();
    ok(tb.length === tabsBefore + 3 && tb.filter((t) => t.kind === 'assembly').length >= 1, `soukolí → 3 nové záložky (2 díly + sestava): ${tb.slice(-3).map((t) => t.title).join(' | ')} (${Date.now() - t0} ms)`);
    ok(/2 komponent/.test(st) && /Vazby: 1 \(1 ok\)/.test(st), 'sestava se 2 komponentami a vazbou ozubení (ok)');
    const mates = String(await run('sestava vazby'));
    ok(/Ozuben/i.test(mates) && /poměr 3\b|poměr 0[.,]333|zuby 20 60/.test(mates), `sestava vazby: ${mates.split('\n').find((l) => /Ozuben/i.test(l)) || mates.slice(0, 160)}`);
    await p.screenshot({ path: S + 'w19-ui-pair-asm.png' });

    // ── 6. sestava otevřená (karta Tvorba v sestavě není) → paleta Ctrl+K → kolo jako nový díl ──
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(400);
    await p.keyboard.type('kola a ozubení');
    await p.waitForTimeout(300);
    await p.keyboard.press('Enter');
    ok(await wizardOpen('gallery'), 'v sestavě: paleta Ctrl+K „kola a ozubení“ → průvodce');
    await wiz('[data-gear-kind="sprocket"]').click();
    await rowIn('z').fill('17');
    await p.locator('[data-gear-create] button').first().click();
    ok(await wizardGone(), 'v sestavě: Vytvořit → nový díl (průvodce zavřený)');
    st = await statusBecomes(/řetězové 08B z17/, 120000);
    ok(/řetězové 08B z17/.test(st) && /Geometrie: platná/.test(st), 'řetězové kolo 08B z17 otevřené jako nový díl v nové záložce');

    // ── 7. paleta Ctrl+K, úvodní obrazovka, knihovna, text ──
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(400);
    await p.keyboard.type('kola a ozubení');
    await p.waitForTimeout(300);
    await p.keyboard.press('Enter');
    ok(await wizardOpen('gallery'), 'paleta Ctrl+K „kola a ozubení“ → průvodce');
    await cancel();
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(400);
    await p.keyboard.type('úvodní obrazovka');
    await p.waitForTimeout(300);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(600);
    const startBtn = p.locator('button[title*="vyplníte tabulku"]').first(); // úvodní obrazovka: popis akce je v title
    const startVis = await startBtn.isVisible().catch(() => false);
    if (startVis) await startBtn.click();
    ok(startVis && (await wizardOpen('gallery')), 'úvodní obrazovka › Kola a ozubení → průvodce');
    if (await p.locator(W).count()) await cancel();
    await p.keyboard.press('Control+l');
    await p.waitForTimeout(600);
    await p.keyboard.type('kolo m2 z24');
    await p.waitForTimeout(800);
    const libBtn = p.locator('[data-lib-gears-open]').first();
    const libVis = await libBtn.isVisible().catch(() => false);
    if (libVis) await libBtn.click();
    const libOk = libVis && (await wizardOpen('table'));
    const libZ = libOk ? await rowIn('z').inputValue() : '';
    const libM = libOk ? await rowIn('m').inputValue() : '';
    ok(libOk && libZ === '24' && libM === '2', `knihovna normálií › čelní kolo › „Otevřít v tabulce Kola a ozubení“ → tabulka předvyplněná m ${libM}, z ${libZ}`);
    if (await p.locator(W).count()) await cancel();
    const act = String(await run('akce gear.wizard'));
    ok(/prvek gear\.spur/.test(act) && (await p.locator(W).count()) === 0, 'text `akce gear.wizard` (bez okna) vypíše, jak kolo zadat textem, a nic neotevře');

    ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);

    // ── 8. angličtina a němčina ──
    for (const [path, lang, label, create, row] of [['/en/cad', 'EN', 'Gears', 'Create', 'Module'], ['/de/cad', 'DE', 'Zahnräder', 'Erstellen', 'Modul']]) {
      const o = await open(b, path);
      await o.p.evaluate(() => window.mncad.run(window.mncad.lang === 'de' ? 'neu teil Rad' : 'new part Gear'));
      await o.p.getByRole('button', { name: /^(Create|Erstellen)$/ }).first().click().catch(() => {});
      await o.p.waitForTimeout(300);
      const btn = o.p.locator('[data-ribbon] [data-tip-id="gear.wizard"] button').first();
      const txt = await btn.innerText().catch(() => '');
      await btn.click();
      await o.p.waitForSelector('[data-gear-wizard="gallery"]', { timeout: 15000 }).catch(() => {});
      await o.p.locator('[data-gear-wizard] [data-gear-kind="spur"]').first().click();
      await o.p.waitForSelector('[data-gear-wizard="table"]', { timeout: 15000 }).catch(() => {});
      const mRow = await o.p.locator('[data-gear-wizard] [data-gear-row="m"]').first().innerText().catch(() => '');
      const cBtn = await o.p.locator('[data-gear-create] button').first().innerText().catch(() => '');
      await o.p.locator('[data-gear-wizard] [data-gear-row="z"] input').first().fill('20');
      await o.p.locator('[data-gear-create] button').first().click();
      await o.p.waitForSelector('[data-gear-wizard]', { state: 'detached', timeout: 60000 }).catch(() => {});
      await o.p.waitForTimeout(500); await o.p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {});
      const dd = await o.p.evaluate(() => window.mncad.getDocument());
      ok(txt.includes(label) && mRow.includes(row) && cBtn.includes(create) && dd.features.length === 1 && dd.features[0].ext === 'gear.spur' && dd.features[0].data.z === 20, `${lang}: pás karet „${txt.trim()}“, řádek „${mRow.split('\n')[0]}“, tlačítko „${cBtn.trim()}“ → kolo z 20`);
      await o.p.screenshot({ path: S + `w19-ui-${lang.toLowerCase()}.png` });
      ok(o.errs.length === 0, `${lang}: bez chyb stránky (${o.errs.slice(0, 2).join(' | ')})`);
      await o.ctx.close();
    }
  } finally {
    await b.close();
  }
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; });
