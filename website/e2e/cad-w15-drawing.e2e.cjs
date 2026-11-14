// E2E vlna 15 (test 959 – překreslení střihadla), balík výkresu – vše přes TEXTOVOU KONZOLI (Ctrl+Shift+K, psaní + Provést),
// jako agent v polním hlášení (bez window.mncad pro příkazy), a kontrola ve výkresovém prostředí (GUI):
//  - B5: `výkres … řez XZ odsazení N` = konvence skici (rovina Y = −N), rovina mimo těleso = řádek ✗ s rozsahem odsazení;
//        panel Řez A–A ukáže „Odsazení podél normály roviny jako u skici: XZ odsazení 20 (rovina Y = -20)“
//  - B6: „výkres A2 měřítko 1:2“ u velkého dílu = řádek ⚠ Pohledy se v měřítku 1:2 nevejdou na list A2.
//  - B7: kóta 74,175 (ne 74,18) a `výkres tolerance 74,175 -0,005` (hodnotou), `výkres tolerance a1 …` (id)
//  - B8: `kótovat funkční 50` → (42) je pomocná, 50 ne; tolerance na pomocnou kótu ji převede; panel Funkční rozměry
//  - B12: deska s 22 dírami → souřadnicové kóty, žádné „vynecháno“; panel Polohy děr → tabulkou děr = Tabulka děr na listu
//  - 5.3: `výkres kontrola tolerancí` → ⚠ s rozměrem bez tolerance
//  - 2. kontrola: přeurčený řetěz (tolerance celkové délky, když jsou funkční všechny články → pomocná (42), ne „(50-0,1)“),
//    tabulka děr v levém pohledu, značky skupin děr u souřadnicových kót, `kótovat díry souřadnicově` vypne tabulku
// Spuštění: E2E_BASE=http://localhost:3422 node e2e/cad-w15-drawing.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w15-drawing').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 300000 });

const PLATE22 = (() => {
  const pts = [[57.4, 15.1], [64.7, 64.2], [90.3, 67.9], [107.3, 51.3], [9.4, 42.2], [9.6, 19.9], [26.9, 46.4], [55.9, 51.6], [101.6, 19.8], [67.4, 48.5], [80.2, 34.3], [17, 11.6], [30.4, 25.2], [42, 61.6], [48.3, 32.6], [85.7, 13.7], [34.6, 70.9], [19, 33.9], [91.9, 45.4], [44.4, 21.7], [68.9, 19.9], [31.7, 35.5]];
  return `nový díl Deska22\nkvádr 120 80 15\n${pts.map(([x, y], i) => `díra ${i % 2 ? 6 : 8} skrz v ${String(x).replace('.', ',')} ${String(y).replace('.', ',')}`).join('\n')}`;
})();
const SHAFT = 'nový díl Hřídel\nskica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít\nrotovat osa X';

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click();
  await coreReady(p);
  await p.waitForTimeout(1000);

  // ── konzole: psaní + Provést (jako agent bez window.mncad) ──
  await p.keyboard.press('Control+Shift+K');
  const input = p.getByLabel('Textové příkazy nebo JSON');
  await input.waitFor({ timeout: 30000 });
  const out = p.locator('[data-agent-output]');
  const consoleRun = async (text, ms = 300000) => {
    if (!(await input.isVisible().catch(() => false))) {
      await p.keyboard.press('Control+Shift+K');
      await input.waitFor({ timeout: 30000 });
    }
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));
  const waitSheetText = (s, ms = 180000) => p.waitForFunction((s) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => t.textContent === s), s, { timeout: ms }).then(() => true, () => false);
  const waitSheetHas = (s, ms = 180000) => p.waitForFunction((s) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((t) => (t.textContent || '').includes(s)), s, { timeout: ms }).then(() => true, () => false);
  /** zavře konzoli (modální okno nad výkresem) jejím tlačítkem Zavřít – Esc by zavřel i výkresové prostředí */
  const closeConsole = async () => {
    const modal = p.locator('div.fixed.inset-0.grid.place-items-center').filter({ has: p.getByLabel('Textové příkazy nebo JSON') });
    for (let i = 0; i < 3 && (await modal.count()) > 0; i++) {
      await modal.first().getByRole('button', { name: 'Zavřít', exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(500);
    }
  };
  const closeDrawing = async () => {
    await closeConsole();
    const close = p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true });
    if (await close.isVisible().catch(() => false)) { await close.click(); await p.waitForTimeout(1200); }
  };

  // ── B5: řez v konvenci skici, ✗ mimo těleso ──
  let log = await consoleRun('nový díl Hranol\nskica XZ: obdélník 40 30 v 0 15\nvysunout 60\nvýkres A3 pohledy přední,horní řez XZ odsazení -80');
  fs.writeFileSync(S + 'b5-miss.txt', log);
  ok(/✓ výkres: A3, pohledy přední, horní, řez XZ odsazení -80 \(rovina Y = 80\)/.test(log), 'B5: protokol ukáže rovinu řezu (odsazení -80 = rovina Y = 80)');
  ok(/✗ rovina řezu Y = 80 leží mimo těleso \(Y -60…0\) – odsazení -80 se měří podél normály roviny XZ jako u skici; řez protne těleso pro odsazení větší než 0 a menší než 60 \(krajní hodnoty leží na ploše tělesa\), např\. 30/.test(log), 'B5: rovina mimo těleso = řádek ✗ s otevřeným rozsahem odsazení 0…60 a příkladem');
  // starší zápis (číslo jako souřadnice osy): dnešní výklad těleso mine, starý ho protne → vyloží se postaru s ⚠, bez ✗
  await closeDrawing();
  log = await consoleRun('výkres řez XZ odsazení -20');
  fs.writeFileSync(S + 'b5-legacy.txt', log);
  ok(/✓ výkres: řez XZ odsazení 20 \(rovina Y = -20\)/.test(log) && /⚠ řez XZ odsazení -20: rovina Y = 20 těleso míjí – číslo vyloženo postaru jako souřadnice Y = -20 .*dnes pište: výkres řez XZ odsazení 20/.test(log) && !/✗ rovina řezu/.test(log.split('\n').slice(-5).join('\n')), 'B5: starší zápis odsazení -20 = ⚠ s dnešním zápisem, řez uložen jako odsazení 20, bez ✗');
  await closeDrawing();
  log = await consoleRun('výkres řez XZ odsazení 20');
  fs.writeFileSync(S + 'b5-ok.txt', log);
  const last = log.split('\n').slice(-4).join('\n');
  ok(/✓ výkres: řez XZ odsazení 20 \(rovina Y = -20\)/.test(log) && !/✗ rovina řezu/.test(last), 'B5: řez XZ odsazení 20 (jako skica XZ odsazení 20) protne těleso – bez ✗');
  await p.waitForSelector('[data-sheet]', { timeout: 180000 }).catch(() => {});
  ok(await waitSheetHas('A–A'), 'B5: řez A–A je na listu');
  const pos = await p.locator('[data-section-pos]').innerText().catch(() => '');
  ok(/Odsazení podél normály roviny jako u skici: XZ odsazení 20 \(rovina Y = -20\)/.test(pos), `B5 GUI: panel Řez A–A ukáže konvenci (${pos})`);
  await p.screenshot({ path: S + 'b5-section.png' });
  await closeDrawing();

  // ── B6: nevejde se na list ──
  log = await consoleRun('nový díl Velky\nkvádr 800 600 300\nvýkres A2 měřítko 1:2 pohledy přední,horní,levý,iso');
  fs.writeFileSync(S + 'b6.txt', log);
  ok(/⚠ Pohledy se v měřítku 1:2 nevejdou na list A2\./.test(log), 'B6: „nevejdou se na list A2“ jako řádek ⚠ v protokolu příkazu');
  await closeDrawing();

  // ── B7: desetinná místa a tolerance hodnotou / id ──
  log = await consoleRun('nový díl Presny\nkvádr 74,175 40 20\nvýkres A3 pohledy přední,horní,iso\nkótovat\nvýkres tolerance 74,175 -0,005\nvýkres stav');
  fs.writeFileSync(S + 'b7.txt', log);
  ok(/✓ tolerance -0,005 → 74,175-0,005 \(přední\)/.test(log), 'B7: výkres tolerance 74,175 najde kótu hodnotou (ne „74,18“)');
  ok(/přední: 74,175-0,005/.test(log) && /x 0…74,175, y 0…20 mm/.test(log) && !/74,18\b/.test(log), 'B7: výkres stav – kóta i rozsah pohledu s tisícinami 74,175');
  ok(await waitSheetText('74,175-0,005'), 'B7 GUI: list ukazuje 74,175-0,005');
  await closeDrawing();
  log = await consoleRun('výkres tolerance a1 h7');
  ok(/✓ tolerance h7 → 74,175h7/.test(log), 'B7: výkres tolerance a1 h7 (id kóty)');
  await closeDrawing();

  // ── B8 + 5.3: funkční rozměry, převod pomocné kóty, kontrola tolerancí ──
  log = await consoleRun(`${SHAFT}\nvýkres A3 na šířku pohledy přední,levý,iso\nkótovat funkční 50 30\nvýkres stav`);
  fs.writeFileSync(S + 'b8.txt', log);
  const front = /přední: (.*)/.exec(log)?.[1] ?? '';
  ok(/· funkční 50, 30/.test(log), 'B8: protokol kótovat uvádí funkční rozměry');
  ok(front.split(' · ').includes('50') && front.split(' · ').includes('(42)') && !front.includes('(50)'), `B8: funkční 50 není v závorce, pomocná je (42) (${front})`);
  ok(/Funkční rozměry: 50, 30 · kontrola tolerancí: bez tolerance 2 z 2 funkčních rozměrů/.test(log), 'B8: výkres stav – řádek Funkční rozměry s kontrolou tolerancí');
  await closeDrawing();
  log = await consoleRun('výkres tolerance 42 ±0,05');
  ok(/✓ tolerance ±0,05 → 42±0,05 \(přední\) – rozměr 42 je nyní funkční \(pomocnou kótou řetězu je \(15\)\)/.test(log), 'B8: tolerance na pomocnou kótu (42) ji převede na funkční, pomocná je (15)');
  await closeDrawing();
  log = await consoleRun('výkres tolerance 50 -0,1\nvýkres kontrola tolerancí\nvýkres');
  fs.writeFileSync(S + 'tolcheck.txt', log);
  ok(/⚠ kontrola tolerancí: bez tolerance 1 z 3 funkčních rozměrů \(předloha není připojena/.test(log), '5.3: výkres kontrola tolerancí – 1 ze 3 funkčních bez tolerance');
  ok(/⚠ 30 \(funkční\): kóta bez tolerance a\d+ 30 \(přední\) – výkres tolerance a\d+ …/.test(log), '5.3: řádek s kótou 30 bez tolerance a radou s id');
  await waitSheetText('42±0,05');
  const side = p.locator('[data-drawing-workspace] aside');
  const fun = await side.locator('[data-functional]').inputValue().catch(() => '');
  ok(fun === '50; 30; 42', `B8 GUI: pole Funkční rozměry = „${fun}“`);
  const t8 = await sheetTexts();
  ok(t8.includes('(15)') && t8.includes('50-0,1') && t8.includes('42±0,05') && !t8.includes('(42)'), 'B8 GUI: list – (15) pomocná, 50-0,1 a 42±0,05 bez závorek');
  await p.screenshot({ path: S + 'b8-shaft.png' });
  await closeDrawing();

  // ── B12: deska s 22 dírami ──
  log = await consoleRun(`${PLATE22}\nvýkres A3 na šířku pohledy přední,horní,iso\nkótovat\nvýkres stav`);
  fs.writeFileSync(S + 'b12.txt', log);
  ok(!/vynecháno/i.test(log), 'B12: žádné „vynecháno“ v protokolu kótovat ani ve stavu');
  ok(/· polohy děr souřadnicově \(horní\)/.test(log) && /Polohy děr: souřadnicové kóty od levého dolního rohu \(horní\)/.test(log), 'B12: automaticky souřadnicové kóty v horním pohledu');
  ok(await waitSheetText('57,4'), 'B12 GUI: souřadnicová kóta 57,4 na listu');
  const t12 = await sheetTexts();
  ok(['0', '120', '80', '15,1', '107,3'].every((s) => t12.includes(s)), 'B12 GUI: počátek 0, vzdálené hrany 120 / 80 a hodnoty poloh');
  await p.screenshot({ path: S + 'b12-ordinate.png' });
  // panel: Polohy děr → tabulkou děr
  await closeConsole();
  const holeBtn = side.locator('[data-hole-mode]').getByRole('button', { name: 'tabulkou děr', exact: true });
  await holeBtn.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  try {
    await holeBtn.click({ timeout: 30000 });
  } catch (e) {
    await p.screenshot({ path: S + 'b12-click-fail.png' });
    console.log('DEBUG overlays:', await p.evaluate(() => [...document.querySelectorAll('div.fixed.inset-0')].map((d) => d.className + ' :: ' + (d.textContent || '').slice(0, 120)).join(' || ')));
    throw e;
  }
  ok(await waitSheetHas('Tabulka děr', 240000), 'B12 GUI: Polohy děr → tabulkou děr = Tabulka děr na listu');
  await p.waitForTimeout(1500);
  const tt = await sheetTexts();
  ok(!tt.includes('0') && tt.includes('57,4') && tt.includes('15,1') && tt.includes('A1') && tt.includes('11× Ø8 skrz'), 'B12 GUI: režim tabulky – polohy (57,4 / 15,1) v tabulce děr se značkami A1…, bez souřadnicových kót (žádná „0“), popisy děr zůstávají');
  await p.screenshot({ path: S + 'b12-table.png' });
  await closeDrawing();
  log = await consoleRun('kótovat díry souřadnicově');
  ok(/· polohy děr souřadnicově \(horní\)/.test(log) && !/vynecháno/.test(log), 'B12: kótovat díry souřadnicově (text) přepne zpět');
  await closeDrawing();

  // ── 2. kontrola: přeurčený řetěz ──
  log = await consoleRun(`${SHAFT}\nvýkres A3 na šířku pohledy přední,levý,iso\nkótovat funkční 30 3 50 15 42\nvýkres tolerance 50 -0,1\nvýkres tolerance 140 ±0,2`);
  fs.writeFileSync(S + 'r2-overdetermined.txt', log);
  ok(/✓ tolerance ±0,2 → 140±0,2 \(přední\) – rozměr 140 je nyní funkční; řetěz by byl přeurčený, pomocnou kótou je proto funkční rozměr bez tolerance \(42\)/.test(log), 'B8 (2. kontrola): tolerance celkové délky u přeurčeného řetězu – pomocná je funkční rozměr bez tolerance (42)');
  ok(await waitSheetText('140±0,2'), 'B8 GUI: 140±0,2 na listu');
  const tr2 = await sheetTexts();
  ok(tr2.includes('(42)') && tr2.includes('50-0,1') && !tr2.some((t) => /^\(50/.test(t || '')), 'B8 GUI: (42) pomocná, 50-0,1 bez závorek – žádná „(50-0,1)“');
  await closeDrawing();
  log = await consoleRun('výkres tolerance 50 -0,1');
  ok(/✓ tolerance -0,1 → 50-0,1 \(přední\)/.test(log), 'B8: tolerance 50 znovu ✓ (dřív ✗ „pomocná kóta se netoleruje“)');
  await closeDrawing();

  // ── 2. kontrola: tabulka děr v levém pohledu ──
  const SIDE = [[8, 6], [15, 30], [22, 12], [29, 34], [36, 8], [43, 26], [50, 14], [57, 32], [64, 10], [71, 28], [78, 18], [85, 6], [92, 24], [99, 33]].map(([y, z]) => `díra 5 hloubka 12 v 0 ${y} ${z} směr 1 0 0`).join('\n');
  log = await consoleRun(`nový díl BokDiry\nkvádr 40 110 40\n${SIDE}\nvýkres A3 na šířku pohledy přední,horní,levý\nkótovat díry tabulka\nvýkres stav`);
  fs.writeFileSync(S + 'r2-side-table.txt', log);
  ok(/· polohy děr tabulkou děr \(levý\)/.test(log) && /Polohy děr: tabulka děr \(levý\)/.test(log) && !/vynecháno/.test(log), 'B12 (2. kontrola): díry v levém pohledu → tabulka děr levého pohledu, nic vynecháno');
  ok(await waitSheetHas('Tabulka děr', 240000), 'B12 GUI: Tabulka děr na listu (levý pohled)');
  const ts2 = await sheetTexts();
  ok(ts2.includes('A14') && ts2.includes('Ø5'), 'B12 GUI: 14 řádků (A1…A14) s průměrem Ø5');
  await p.screenshot({ path: S + 'r2-side-table.png' });
  await closeDrawing();

  // ── 2. kontrola: souřadnicové kóty se značkami skupin; souřadnicově vypne tabulku ──
  log = await consoleRun(`${PLATE22.replace(/díra 6 /g, 'díra 6,647 ')}\nvýkres A3 na šířku pohledy přední,horní,iso tabulka děr ano\nkótovat díry souřadnicově`);
  fs.writeFileSync(S + 'r2-ordinate-tags.txt', log);
  ok(/· tabulka děr vypnuta – polohy děr jsou kótami/.test(log), 'B12: kótovat díry souřadnicově vypne tabulku děr listu (polohy jednou)');
  ok(await waitSheetText('11× Ø8 skrz (A)'), 'B12 GUI: popis skupiny se značkou „11× Ø8 skrz (A)“');
  const tg = await sheetTexts();
  ok(tg.filter((t) => t === 'A').length >= 11 && tg.filter((t) => t === 'B').length >= 11 && tg.includes('11× Ø6,647 skrz (B)') && !tg.includes('Tabulka děr'), 'B12 GUI: značky A / B u každé díry, bez tabulky děr');
  await p.screenshot({ path: S + 'r2-ordinate-tags.png' });
  await closeDrawing();

  ok(dialogs.length === 0, `žádné systémové dialogy (${dialogs.join(' | ')})`);
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL OK');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
