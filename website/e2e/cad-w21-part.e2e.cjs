// E2E vlna 21 – balík part: pružina z tabulky (průvodce i text), úprava v historii, výkres s tabulkou údajů pružiny.
//  - GUI: Tvorba › Pružina → průvodce (galerie druhů, tabulka, živé spočtené řádky, varování u řádku, náhled) → Vytvořit
//    → prvek spring.compression; těleso měří jako skutečná pružina (L0 × De, broušené konce v 0 a L0)
//  - úprava v historii = stejná tabulka (změna L0 a ends → přestavba), paleta Ctrl+K najde „Pružina“, knihovna Pružiny nabídne tabulku
//  - text: pružina tlačná / tažná / zkrutná / talířová (CS / EN / DE), pružina tabulka, pružina nápověda, starý zápis, stav
//  - výkres: výkres tabulka pružiny ano → stav listu hlásí tabulku
// Spuštění: E2E_BASE=http://localhost:3501 node e2e/cad-w21-part.e2e.cjs
const { chromium } = require(process.env.PW_PATH || 'playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const t00 = Date.now();
const log = (s) => process.stderr.write(`[${((Date.now() - t00) / 1000).toFixed(0)} s] ${s}\n`);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  const c0 = p.getByText('Pokračovat v práci');
  if (await c0.isVisible({ timeout: 6000 }).catch(() => false)) await c0.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 300000 });
  await p.waitForTimeout(1500);
  // úvodní obrazovka (čistý prohlížeč): Začít › Nový díl
  const start = p.getByRole('heading', { name: 'Začít' });
  for (let k = 0; k < 5 && (await start.isVisible({ timeout: 3000 }).catch(() => false)); k++) {
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Prázdný díl:'))?.click());
    await p.waitForTimeout(800);
  }
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const status = () => p.evaluate(() => window.mncad.status());
  const doc = () => p.evaluate(() => window.mncad.getDocument());

  // ---------- 1) průvodce z pásu karet ----------
  log('průvodce');
  await p.locator('button', { hasText: /^Pružina$/ }).first().click();
  const wiz = p.locator('[data-spring-wizard]');
  await wiz.waitFor({ timeout: 30000 });
  ok(await wiz.isVisible(), 'Tvorba › Pružina otevře průvodce s tabulkou');
  ok((await p.locator('[data-spring-kind]').count()) === 4, 'galerie: 4 druhy (tlačná, tažná, zkrutná, talířová)');
  ok((await p.locator('[data-spring-preview]').count()) >= 4, 'živé náhledy v galerii i u tabulky');
  const R0 = await p.locator('[data-spring-calc="R"]').innerText();
  ok(/3,494 N\/mm/.test(R0), `výchozí tabulka spočte tuhost (${R0.replace(/\s+/g, ' ')})`);
  const cell = (k) => p.locator(`[data-spring-row="${k}"] input`).first();
  await cell('d').fill('2,5');
  await cell('L0').fill('45');
  await cell('n').fill('7');
  await cell('L2').fill('33');
  await p.waitForTimeout(400);
  const R1 = await p.locator('[data-spring-calc="R"]').innerText();
  ok(/10,608 N\/mm/.test(R1), `tuhost se přepočte živě po změně řádků (${R1.replace(/\s+/g, ' ')})`);
  ok(/127,3 N/.test(await p.locator('[data-spring-calc="F2"]').innerText()), 'síla F2 při L2 33 mm = 127,3 N');
  // varování u řádku: L2 pod Ln + Sa
  await cell('L2').fill('24');
  await p.waitForTimeout(300);
  const issue = await p.locator('[data-spring-issue="L2"]').first().innerText().catch(() => '');
  ok(/Ln \+ Sa/.test(issue), `varování přímo u řádku L2 (${issue.trim().slice(0, 80)})`);
  await cell('L2').fill('');
  await cell('L0').fill('20');
  await p.waitForTimeout(300);
  ok(await p.locator('[data-spring-create] button').isDisabled(), 'chyba zadání (L0 pod Ln) zablokuje Vytvořit');
  await cell('L0').fill('45');
  await p.waitForTimeout(300);
  // druhý druh v galerii a zpět
  await p.locator('[data-spring-kind="extension"]').click();
  ok(await p.locator('[data-spring-row="F0"]').isVisible(), 'tažná pružina má vlastní tabulku (předpětí F0, očka)');
  await p.locator('[data-spring-kind="compression"]').click();
  ok((await cell('L0').inputValue()) === '45', 'po přepnutí druhu zůstanou zadané hodnoty');
  await p.locator('[data-spring-create] button').click();
  await wiz.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => window.mncad.getDocument().features.some((f) => f.ext === 'spring.compression'), null, { timeout: 60000 });
  let st = await status();
  for (let k = 0; k < 60 && !/Rozměry: 20 × 20 × 45 mm/.test(st); k++) {
    await p.waitForTimeout(1500);
    st = await status();
  }
  ok(/Rozměry: 20 × 20 × 45 mm \(X -10…10, Y -10…10, Z 0…45\)/.test(st), 'těleso měří De × De × L0 a leží mezi rovinami 0 a L0');
  ok(/Geometrie: platná/.test(st), 'těleso pružiny je platné');
  ok(/tlačná d 2,5 · De 20 · L0 45 · n 7 · R 10,608 N\/mm · Ln 22,5 mm/.test(st), 'stav: řádek pružiny se souhrnem výpočtu');
  const meas = await p.evaluate(() => window.mncad.measure('plochy rovinné'));
  ok(meas.lines.join('\n').length > 0, 'měření rovinných ploch (broušené konce) proběhlo');

  // ---------- 2) úprava v historii = stejná tabulka ----------
  log('úprava v historii');
  const sid = (await doc()).features.find((x) => x.ext === 'spring.compression').id;
  await p.locator(`[data-feature-row="${sid}"]`).click();
  let form;
  form = p.locator('[data-spring-form="compression"]');
  ok(await form.isVisible({ timeout: 15000 }).catch(() => false), 'úprava prvku otevře stejnou tabulku (formulář spring.compression)');
  if (await form.isVisible().catch(() => false)) {
    await form.locator('[data-spring-row="L0"] input').fill('50');
    await form.locator('[data-spring-row="ends"] select').selectOption('closed');
    await p.waitForTimeout(500);
    ok(/přiložené, neobroušené/.test(await form.locator('[data-spring-calc="ends"]').innerText()), 'formulář přepočítá řádky (konce neobroušené)');
    await p.keyboard.press('Enter').catch(() => {});
    await p.getByRole('button', { name: 'OK', exact: true }).click().catch(() => {});
    let ok2 = false;
    for (let k = 0; k < 60 && !ok2; k++) {
      await p.waitForTimeout(1500);
      const d = await doc();
      const f = d.features.find((x) => x.ext === 'spring.compression');
      ok2 = !!f && f.data.L0 === 50 && f.data.ends === 'closed';
    }
    ok(ok2, 'změna v tabulce prvku se uloží do historie (L0 50, konce přiložené)');
    st = await status();
    for (let k = 0; k < 60 && !/Z 0…50|Z 0,0…50/.test(st) && !/× 50 mm/.test(st); k++) {
      await p.waitForTimeout(1500);
      st = await status();
    }
    ok(/× 50 mm/.test(st), 'těleso se přestavělo na novou volnou délku 50 mm');
  }

  // nález 2: obálka broušené pružiny d ≥ 5 = 0…L0 (dřív Z −3,7…100)
  await run('nový díl Velká\npružina tlačná d 5 De 30 L0 100 n 10');
  let stBig = await status();
  for (let k = 0; k < 60 && !/Rozměry:/.test(stBig); k++) {
    await p.waitForTimeout(1500);
    stBig = await status();
  }
  ok(/Rozměry: 30 × 30 × 100 mm \(X -15…15, Y -15…15, Z 0…100\)/.test(stBig), `d 5 De 30 L0 100: stav Rozměry 30 × 30 × 100, Z 0…100 (${(stBig.match(/Rozměry:[^\n]*/) || [''])[0]})`);
  const mBig = await run('měřit těleso');
  ok(/obálka 30 × 30 × 100 mm/.test(mBig), `měřit těleso: obálka 30 × 30 × 100 mm (${(mBig.match(/obálka[^·]*/) || [''])[0]})`);

  // nález 9: pružina „do tohoto dílu“ s tělesem má operaci Přidat – formulář ji zvýrazní
  await run('nový díl Deska\nkvádr 100 60 20');
  await p.waitForTimeout(1500);
  await p.locator('button', { hasText: /^Pružina$/ }).first().click();
  await p.locator('[data-spring-wizard]').waitFor({ timeout: 30000 });
  await p.locator('[data-spring-target="this"]').click();
  await p.locator('[data-spring-create] button').click();
  await p.waitForFunction(() => window.mncad.getDocument().features.some((f) => f.ext === 'spring.compression'), null, { timeout: 60000 });
  const added = (await doc()).features.find((x) => x.ext === 'spring.compression');
  ok(added.data.mode === 'add', `pružina do dílu s tělesem: operace přidat (${added.data.mode})`);
  await p.waitForTimeout(1500);
  await p.locator(`[data-feature-row="${added.id}"]`).click();
  const form2 = p.locator('[data-spring-form="compression"]');
  await form2.waitFor({ timeout: 15000 }).catch(() => {});
  const activeOps = await form2.locator('button.bg-white').allInnerTexts().catch(() => []);
  ok(activeOps.includes('Přidat'), `formulář zvýrazní operaci Přidat (aktivní: ${activeOps.join(', ')})`);
  await p.keyboard.press('Escape').catch(() => {});
  await p.getByRole('button', { name: 'Zrušit', exact: true }).click().catch(() => {});

  // ---------- 3) paleta a knihovna ----------
  log('paleta a knihovna');
  await p.keyboard.press('Escape').catch(() => {});
  await p.keyboard.press('Control+k');
  const pal = p.getByPlaceholder(/Hledat|příkaz/i).first();
  if (await pal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pal.fill('Pružina');
    await p.waitForTimeout(500);
    ok(/Pružina/.test(await p.locator('body').innerText()), 'paleta Ctrl+K nabízí Pružina');
    await p.keyboard.press('Escape');
  } else ok(false, 'paleta Ctrl+K se neotevřela');

  // knihovna: rodina Pružiny nabídne tabulku s výpočtem (předvyplněnou)
  await p.locator('button', { hasText: /^Normálie$/ }).first().click().catch(() => {});
  await p.waitForTimeout(800);
  await p.keyboard.type('pružina 2x20x50', { delay: 20 });
  await p.waitForTimeout(1200);
  const libBtn = p.locator('[data-lib-spring-table]');
  ok(await libBtn.isVisible({ timeout: 10000 }).catch(() => false), 'knihovna (Normálie › pružina DIN 2095) nabízí „Pružina z tabulky s výpočtem“');
  if (await libBtn.isVisible().catch(() => false)) {
    await libBtn.click();
    await p.locator('[data-spring-wizard]').waitFor({ timeout: 15000 }).catch(() => {});
    const dv = await p.locator('[data-spring-row="d"] input').first().inputValue().catch(() => '');
    const lv = await p.locator('[data-spring-row="L0"] input').first().inputValue().catch(() => '');
    ok(dv === '2' && lv === '50', `průvodce z knihovny je předvyplněný (d ${dv}, L0 ${lv})`);
    await p.locator('[data-spring-cancel] button').click().catch(() => p.keyboard.press('Escape'));
    await p.waitForTimeout(500);
  }

  // ---------- 4) text ----------
  log('text');
  let out = await run('nový díl Text\npružina tlačná d 2 De 20 L0 50 n 8 konce broušené materiál SH L2 30');
  ok(/tlačná d 2 · De 20 · L0 50 · n 8 · R 3,494 N\/mm · Ln 20 mm · F2 69,9 N/.test(out), 'pružina tlačná textem – souhrn v protokolu');
  out = await run('spring extension d 1.6 De 12 n 12.5 F0 5 loop german L2 50\nfeder dreh d 2 De 20 n 6,25 schenkel radial a2 60\nfeder teller reihe A De 40 säule 4 1 L2 11,4 bei 60 0 0');
  ok(/tažná d 1,6/.test(out) && /zkrutná d 2/.test(out) && /talířová 40 × 20,4 × 2,25/.test(out), 'tažná (EN), zkrutná (DE), talířová (DE) textem');
  out = await run('pružina tabulka');
  // (výstup běhu končí stavem dokumentu s řádkem každého prvku – počítají se hlavičky tabulek „Pružina „…““)
  const tableHeads = (o) => (o.match(/Pružina „[^“]+“/g) || []).filter((x, i, a) => a.indexOf(x) === i);
  ok(tableHeads(out).join() === 'Pružina „Talířová pružina 1“', `pružina tabulka bez názvu vypíše poslední pružinu dílu (${tableHeads(out).join(', ')})`);
  out = await run('pružina tabulka vše');
  ok(/tuhost R: 3,494 N\/mm/.test(out) && /Tažná pružina/.test(out) && /Talířová pružina/.test(out), 'pružina tabulka vše vypíše spočtené údaje všech pružin');
  // nález 1: paleta Ctrl+K rozebírá text při psaní – rozepsaný příkaz nesmí změnit výsledek dalšího příkazu
  await p.keyboard.press('Escape').catch(() => {});
  await p.keyboard.press('Control+k');
  const pal2 = p.getByPlaceholder(/Hledat|příkaz/i).first();
  if (await pal2.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pal2.pressSequentially('pružina tabulka "Tažná pružina 1"', { delay: 15 });
    await p.waitForTimeout(400);
    await p.keyboard.press('Escape');
  }
  let good = 0;
  for (let k = 0; k < 4; k++) {
    out = await run('pružina tabulka "Tlačná pružina 1"');
    if (tableHeads(out).join() === 'Pružina „Tlačná pružina 1“' && !/^✗/m.test(out)) good++;
  }
  ok(good === 4, `po rozepsání jiného názvu v paletě vypíše pružina tabulka "Tlačná pružina 1" vždy jen ji (${good}/4)`);
  out = await run('pružina nápověda tlačná');
  ok(/EN 13906-1/.test(out) && /L0\|délka/.test(out), 'pružina nápověda vypíše řádky tabulky se slovy');
  out = await run('pružina tlačná d 1 De 12 n 6 L0 40 L2 12');
  ok(/⚠ při stlačení na L2 je napětí s korekcí k 101 % dovoleného .*staticky vyhoví \(τ2 90 %\)/.test(out), 'varování napětí česky v protokolu (statická kontrola bez korekce vyhoví, τk2 přísnější)');
  out = await run('pružina tlačná d 2 De 20 L0 50 n 8 F2 500');
  ok(/síla F2 500 N je větší než síla na doraz Fn 104,8 N/.test(out) && !/L2 -/.test(out), 'síla nad Fn = ✗ u síly, ne záporná L2');
  out = await run('pružina tlačná d 2 De 20 n 8');
  ok(/zadejte volnou délku L0/.test(out), 'chybějící L0 = chyba u řádku');
  out = await run('pružina 20 stoupání 5 závity 8 drát 2');
  ok(/\[spring,/.test(out), 'starý zápis pružina D stoupání … zůstává prvkem Pružina');
  st = await status();
  ok((st.match(/\[ext,|spring\.|tlačná d|tažná d|zkrutná d|talířová /g) || []).length >= 4, 'stav dokumentu má řádek pro každou pružinu');

  // ---------- 5) výkres s tabulkou údajů pružiny ----------
  log('výkres');
  out = await run('nový díl Výkres pružiny\npružina tlačná d 2 De 20 L0 50 n 8 L1 40 L2 30\nvýkres\nvýkres pohledy přední tabulka pružiny ano');
  let ds = '';
  for (let k = 0; k < 80 && !/Tabulka pružiny/.test(ds); k++) {
    await p.waitForTimeout(2500);
    ds = await p.evaluate(() => window.mncad.drawingStatus().catch((e) => String(e)));
  }
  ok(/Tabulka pružiny: 1× nad razítkem \(EN ISO 2162-2\)/.test(ds), `výkres tabulka pružiny ano → tabulka nad razítkem (${(ds.match(/Tabulka pružiny[^\n]*/) || [''])[0]})`);
  const svg = await p.evaluate(() => (document.querySelector('[data-drawing-sheet] svg, svg[data-sheet]') || {}).outerHTML || '');
  if (svg) ok(/Údaje pružiny/.test(svg), 'tabulka je na listu (SVG)');
  // nález 3: patička razítka („Rozměry v mm“, „List 1/1“) leží nad tabulkou, ne přes její spodní řádek
  const lay = await p.evaluate(() => {
    const texts = [...document.querySelectorAll('svg text')];
    const r = (re) => texts.filter((t) => re.test(t.textContent || '')).map((t) => t.getBoundingClientRect());
    const title = r(/^Údaje pružiny/)[0];
    const foot = r(/Rozměry v mm|List 1\/1/);
    return title && foot.length ? { titleTop: title.top, footBottom: Math.max(...foot.map((x) => x.bottom)), n: foot.length } : null;
  });
  ok(!!lay && lay.footBottom <= lay.titleTop + 0.5, `patička razítka nad tabulkou pružiny (${lay ? `patička dole ${lay.footBottom.toFixed(1)} px, titulek tabulky nahoře ${lay.titleTop.toFixed(1)} px` : 'texty nenalezeny'})`);

  ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  log('hotovo');
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + e.message);
  process.exit(1);
});
