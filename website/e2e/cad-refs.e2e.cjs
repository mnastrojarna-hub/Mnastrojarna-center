const { chromium } = require('playwright');
// E2E zadávacích polí (vysunutí: ukončení / 2 směry / tenká stěna; díra: více poloh, k ploše, k tělesu, výběr odkazu klikem)
// a otisků výběru hran (zaoblení hrany vybrané ze seznamu přežije přečíslování hran po vložení díry před zaoblení).
// Spuštění: E2E_BASE=http://localhost:3100 node e2e/cad-refs.e2e.cjs <složka>
const O = process.argv[2] || '/tmp/e2e'; require('fs').mkdirSync(O, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); }); // headless: ukládání přes dotaz na název
  page.on('dialog', (d) => d.accept());
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
  for (let i = 0; i < 20; i++) { const st = page.locator('div.fixed.z-\\[65\\]'); if (await st.isVisible().catch(() => false)) { await st.getByText('Pokračovat v práci').first().click(); break; } await page.waitForTimeout(500); }
  await page.waitForTimeout(800);
  const run = (text) => page.evaluate((t) => window.mncad.run(t), text);
  const getDoc = () => page.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await page.waitForTimeout(300); };
  const vol = async () => { const m = (await page.evaluate(() => window.mncad.status())).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const okBtn = async () => { await page.locator('button[title="OK (Enter)"]').first().click(); await idle(); };

  // ── nový díl, skica obdélník na XY, dokončit → automatické vysunutí (formulář) ──
  await page.locator('header button[title="Nový díl"]').click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await page.getByRole('button', { name: /^Skica/ }).first().click();
  await page.getByRole('menu').getByRole('button', { name: /Rovina XY/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('r'); await page.mouse.click(700, 420); await page.mouse.click(900, 520); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Dokončit skicu/ }).click(); await page.waitForTimeout(1500);
  ok(await page.getByText('Ukončení (směr 1)').isVisible(), 'formulář vysunutí: pole Ukončení');
  // přepnout na Střední rovina
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Skrz vše' }) }).first();
  await sel.selectOption('midPlane'); await page.waitForTimeout(1500);
  ok(await page.getByText('Celková délka', { exact: true }).isVisible(), 'ukončení: střední rovina → pole Celková délka');
  // druhý směr
  await page.getByText('Druhý směr', { exact: true }).click(); await page.waitForTimeout(800);
  ok(await page.getByText('Ukončení (směr 2)').isVisible(), 'druhý směr: druhé pole ukončení');
  // pokročilé: tenká stěna
  await page.getByText(/Začátek, směr, tenká stěna/).click(); await page.waitForTimeout(300);
  await page.getByText(/Tenká stěna \(profil/).click(); await page.waitForTimeout(1500);
  ok(await page.getByText('Tloušťka', { exact: true }).isVisible(), 'tenká stěna: pole tloušťky');
  await page.getByText(/Tenká stěna \(profil/).click(); await page.waitForTimeout(1200); // zpět plné těleso
  const txt = await page.locator('main').innerText();
  ok(/mm/.test(txt), 'model postaven (štítek rozměrů)');
  await page.screenshot({ path: O + '/ui-vysunuti-formular.png' });
  // potvrdit Enter, pak Díra → K ploše → vybrat plochu klikem (pole odkazu)
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Díra/ }).first().click(); await page.waitForTimeout(800);
  ok(await page.getByText('Polohy děr (více naráz)').isVisible(), 'díra: pole více poloh');
  const hsel = page.locator('select').filter({ has: page.locator('option', { hasText: 'K dalšímu' }) }).first();
  ok((await hsel.locator('option').allInnerTexts()).includes('K tělesu'), 'díra: ukončení nabízí i „K tělesu“ (stejné varianty jako vysunutí)');
  await hsel.selectOption('toFace'); await page.waitForTimeout(500);
  ok(await page.getByText('Plocha / pomocná rovina').isVisible(), 'díra: ukončení k ploše → pole odkazu');
  await page.getByRole('button', { name: /Vyberte plochu/ }).first().click(); await page.waitForTimeout(300);
  ok(/vyberte plochu/i.test(await page.locator('footer').innerText()), 'výzva ve stavovém řádku při výběru odkazu');
  await page.mouse.move(740, 600); await page.waitForTimeout(300);
  await page.mouse.click(740, 600); await page.waitForTimeout(1500);
  const lbl = await page.locator('aside').last().innerText();
  ok(/Plocha \d+/.test(lbl), 'kliknutím vybrána plocha do pole odkazu');
  // pravé tlačítko v poli odkazu → nabídka způsobů zadání
  await page.locator('button[title^="Další způsoby zadání"]').first().click(); await page.waitForTimeout(400);
  ok(await page.getByRole('button', { name: /Použít aktuální výběr/ }).isVisible(), 'nabídka způsobů zadání v poli odkazu');
  await page.screenshot({ path: O + '/ui-dira-odkaz.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);

  // ── díra „k tělesu“: dutý profil (horní a dolní stěna 10 mm), díra Ø10 projde jen horní stěnou ──
  await run('nový díl Díra k tělesu\nkvádr 60 40 40\nkvádr 40 60 20 v 10 -10 10 odebrat\ndíra 10 k tělesu v 30 20 40'); await idle();
  const V0 = 60 * 40 * 40 - 40 * 40 * 20;
  const vTop = (V0 - Math.PI * 25 * 10) / 1000;
  const vBoth = (V0 - 2 * Math.PI * 25 * 10) / 1000;
  let hd = (await getDoc()).features.slice(-1)[0];
  ok(hd.type === 'hole' && hd.end && hd.end.kind === 'toBody', 'textový příkaz „díra 10 k tělesu …“ → ukončení toBody (' + JSON.stringify(hd.end) + ')');
  let v = await vol();
  ok(Math.abs(v - vTop) < 0.006, `díra k tělesu projde jen horní stěnou: ${v} cm³ (čeká se ${vTop.toFixed(2)})`);
  // formulář díry: ukončení „K tělesu“ je vybrané; přepnutí na Skrz vše a zpět mění model
  await page.locator('aside').first().getByText(hd.name, { exact: true }).click(); await page.waitForTimeout(1200);
  const endSel = page.locator('select').filter({ has: page.locator('option', { hasText: 'K tělesu' }) }).first();
  ok((await endSel.inputValue()) === 'toBody', 'formulář díry ukazuje ukončení „K tělesu“');
  ok(await page.getByText('po první stěnu stávajícího tělesa').first().isVisible(), 'nápověda k ukončení: po první stěnu stávajícího tělesa');
  await endSel.selectOption('throughAll'); await idle();
  v = await vol();
  ok(Math.abs(v - vBoth) < 0.006, `formulář: Skrz vše projde oběma stěnami: ${v} cm³`);
  await endSel.selectOption('toBody'); await idle();
  hd = (await getDoc()).features.slice(-1)[0];
  v = await vol();
  ok(hd.end && hd.end.kind === 'toBody' && Math.abs(v - vTop) < 0.006, `formulář: zpět „K tělesu“ → ${v} cm³, end ${JSON.stringify(hd.end)}`);
  await page.screenshot({ path: O + '/ui-dira-k-telesu.png' });
  await okBtn();

  // ── otisky výběru: zaoblení hrany vybrané ze seznamu přežije vložení díry PŘED zaoblení ──
  await run('nový díl Otisky\nkvádr 80 50 30'); await idle();
  await page.getByRole('button', { name: 'Tvorba', exact: true }).click().catch(() => {});
  await page.getByRole('button', { name: 'Zaoblit', exact: true }).first().click(); await page.waitForTimeout(800);
  const radius = page.locator('input[aria-label="Poloměr"]').first();
  await radius.fill('5'); await radius.press('Tab'); await page.waitForTimeout(600);
  await page.locator('[data-pick-list]').click(); await page.waitForTimeout(400);
  const list = page.locator('[data-entity-pick="edges"]');
  await page.waitForFunction(() => /Vybráno \d+ z 12/.test(document.querySelector('[data-entity-count]')?.textContent || ''), null, { timeout: 60000 });
  const row4 = await list.locator('[data-entity-row="4"]').innerText();
  ok(/Hrana 5/.test(row4) && /30 mm/.test(row4), 'seznam hran: Hrana 5 = svislá hrana 30 mm (' + row4.replace(/\s+/g, ' ') + ')');
  await list.locator('[data-entity-row="4"] input[type="checkbox"]').check(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Hotovo', exact: true }).click(); await page.waitForTimeout(400);
  // otisk se doplní sám (jádro ve workeru) – hrana 4 = svislá hrana x 80, y 0, délka 30
  const sigOk = await page.waitForFunction(() => { const f = window.mncad.getDocument().features.find((x) => x.type === 'fillet'); return !!(f && f.edgeSigs && f.edgeSigs['4']); }, null, { timeout: 30000 }).then(() => true, () => false);
  let fl = (await getDoc()).features.find((x) => x.type === 'fillet');
  const s4 = fl && fl.edgeSigs && fl.edgeSigs['4'];
  ok(sigOk && s4 && Math.abs(s4.s - 30) < 1e-6 && Math.abs(s4.c[0] - 80) < 1e-6 && Math.abs(s4.c[1]) < 1e-6, 'výběr ze seznamu dostal otisk hrany (' + JSON.stringify(s4) + ')');
  ok(fl.radius === 5 && JSON.stringify(fl.edges) === '[4]', 'zaoblení R5, hrany [4] (' + fl.radius + ', ' + JSON.stringify(fl.edges) + ')');
  await okBtn();
  const vFil = (r, L) => (1 - Math.PI / 4) * r * r * L;
  v = await vol();
  ok(Math.abs(v - (80 * 50 * 30 - vFil(5, 30)) / 1000) < 0.006, `kvádr se zaoblenou svislou hranou: ${v} cm³`);
  // díra na konci historie, pak „Posunout výš“ ve stromu → díra je PŘED zaoblením a přečísluje hrany
  await run('díra 10 skrz v 20 25 30'); await idle();
  const holeName = (await getDoc()).features.slice(-1)[0].name;
  await page.locator('aside').first().getByText(holeName, { exact: true }).click({ button: 'right' }); await page.waitForTimeout(400);
  await page.getByText('Posunout výš', { exact: true }).click(); await idle(); await page.waitForTimeout(800);
  let d = await getDoc();
  ok(d.features.map((x) => x.type).join(',') === 'box,hole,fillet', 'strom: díra posunuta před zaoblení (' + d.features.map((x) => x.type).join(',') + ')');
  const expected = (80 * 50 * 30 - Math.PI * 25 * 30 - vFil(5, 30)) / 1000;
  const wrong = (80 * 50 * 30 - Math.PI * 25 * 30 - vFil(5, 80)) / 1000;
  v = await vol();
  ok(Math.abs(v - expected) < 0.006, `zaoblení zůstalo na stejné hraně (otisk): ${v} cm³, čeká se ${expected.toFixed(2)} (jiná hrana by dala ${wrong.toFixed(2)})`);
  const st = await page.evaluate(() => window.mncad.status());
  ok(!/⚠|✗/.test(st.split('\n').filter((l) => /Zaoblení/.test(l)).join(' ')), 'zaoblení bez varování a chyby ve stavu');
  await page.screenshot({ path: O + '/ui-otisk-zaobleni.png' });
  // úprava zaoblení: indexy se přepíšou na znovunalezenou hranu (zvýraznění v modelu sedí) – hrana 4 → 5
  const fname = d.features[2].name;
  await page.locator('aside').first().getByText(fname, { exact: true }).click(); await page.waitForTimeout(600);
  const healed = await page.waitForFunction(() => { const f = window.mncad.getDocument().features.find((x) => x.type === 'fillet'); return f && JSON.stringify(f.edges) === '[5]' && f.edgeSigs && f.edgeSigs['5'] && !f.edgeSigs['4']; }, null, { timeout: 30000 }).then(() => true, () => false);
  fl = (await getDoc()).features.find((x) => x.type === 'fillet');
  ok(healed, 'otevřené zaoblení: index hrany přepsán na znovunalezenou hranu (' + JSON.stringify(fl.edges) + ', ' + Object.keys(fl.edgeSigs || {}).join(',') + ')');
  // klik v modelu (popisek hrany) přidá hranu a dostane otisk
  await page.evaluate(() => window.mncad.hints(true)); await page.waitForTimeout(800);
  const eh = await page.evaluate(() => window.mncad.hints().find((h) => h.kind === 'edge' && h.index !== 5));
  if (eh) {
    await page.evaluate((id) => window.mncad.clickHint(id), eh.id); await page.waitForTimeout(400);
    // nově přidaná hrana (klik trefí hranu pod popiskem) musí dostat otisk
    const added = await page.waitForFunction(() => { const f = window.mncad.getDocument().features.find((x) => x.type === 'fillet'); const n = f && f.edges.find((i) => i !== 5); return n !== undefined && f.edgeSigs && f.edgeSigs[String(n)] ? { n } : false; }, null, { timeout: 30000 }).then(async (h) => (await h.jsonValue()).n, () => false);
    ok(added !== false, `klik v modelu na hranu (popisek ${eh.id}): přidána hrana ${added === false ? '?' : added + 1} s otiskem`);
    if (added !== false) {
      await page.evaluate((id) => window.mncad.clickHint(id), eh.id); await page.waitForTimeout(400); // znovu = odebrat
      const removed = await page.waitForFunction((i) => { const f = window.mncad.getDocument().features.find((x) => x.type === 'fillet'); return f && JSON.stringify(f.edges) === '[5]' && !(f.edgeSigs && f.edgeSigs[String(i)]); }, added, { timeout: 30000 }).then(() => true, () => false);
      ok(removed, 'druhý klik hranu odebere a otisk odebrané hrany zmizí');
    }
  } else ok(false, 'popisky hran v režimu výběru hran nejsou k dispozici');
  await page.evaluate(() => window.mncad.hints(false));
  await okBtn();
  v = await vol();
  ok(Math.abs(v - expected) < 0.006, `po úpravě zaoblení stále stejný objem: ${v} cm³`);
  // kontrola: stejný dokument BEZ otisků (starý formát) zaoblí jinou hranu – index 4 je teď vodorovná hrana délky 80
  d = await getDoc();
  const legacy = JSON.parse(JSON.stringify(d));
  legacy.name = 'Bez otisků';
  for (const f of legacy.features) if (f.type === 'fillet') { delete f.edgeSigs; f.edges = [4]; }
  await page.evaluate((x) => window.mncad.setDocument(x), legacy); await idle();
  v = await vol();
  ok(Math.abs(v - wrong) < 0.006, `bez otisku (starý dokument) zasáhne index 4 jinou hranu: ${v} cm³ (≠ ${expected.toFixed(2)})`);

  // ── výběr pravidlem v textovém příkazu dostane otisky (hrany tělesa před prvkem) ──
  await run('nový díl Pravidlo\nkvádr 40 30 20\nzaoblit 1 hrany svislé'); await idle();
  const rf = (await getDoc()).features.slice(-1)[0];
  const keys = Object.keys(rf.edgeSigs || {}).sort().join(',');
  ok(rf.type === 'fillet' && rf.edges.length === 4 && keys === rf.edges.map(String).sort().join(',') && Object.values(rf.edgeSigs).every((s) => Math.abs(s.s - 20) < 1e-6), `„zaoblit 1 hrany svislé“: 4 hrany s otisky svislých hran délky 20 (${JSON.stringify(rf.edges)} / ${keys})`);

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
