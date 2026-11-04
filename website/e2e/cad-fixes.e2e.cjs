// E2E k opravám ze souhrnného reportu z testování (3. 11. 2026, II):
// ztráta rychlé změny ve formuláři, formát výkresu při okamžitém zavření, kusovník (číslo dílu, označení materiálu),
// protokol agenta až po výpočtu (⚠ / ✓ / ✗), stav sestavy a kolize v textovém stavu, závit M18×1,5 v díře, patička bez automatické poznámky.
// Spuštění (server na :3100): node e2e/cad-fixes.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = 'http://localhost:3100/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const status = (p) => p.evaluate(() => window.mncad.status());
const part = (name, number, materialName, size) => ({ app: 'mnastrojarna-cad', version: 2, name, kind: 'part', material: 'ocel', materialName, props: { number }, features: [{ id: 'b', name: 'Kvádr', type: 'box', size, position: [0, 0, 0], centered: false, mode: 'new' }] });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(p);

  // ── 1. protokol: výsledek prvku až po výpočtu; prvek, který nic nezměnil = ⚠ ──
  let log = await run(p, 'nový díl Protokol\nkvádr 60 40 20\nsrazit 1 hrany svislé\nzaoblit 2 hrany horní');
  ok(/→ Sražení 1 \(chamfer\) – 4 hran podle pravidla/.test(log) && /→ Zaoblení 1 \(fillet\)/.test(log), 'protokol: přidání prvku je „→“, ne ✓');
  const linesF = log.split('\n').filter((l) => /Zaoblení 1 \(fillet\)/.test(l));
  ok(linesF.length === 2 && /^→/.test(linesF[0]) && /^[✓⚠✗]/.test(linesF[1]), 'výsledek zaoblení je jediný řádek ✓/⚠/✗ po výpočtu (žádné „✓“ následované „✗“)\n' + linesF.join('\n'));
  log = await run(p, 'koule 10 v 200 200 200 odebrat');
  ok(/⚠ Koule 1 \(sphere\): Prvek těleso nezměnil/.test(log), 'odebrání mimo těleso → ⚠ s vysvětlením\n' + (log.match(/Koule 1[^\n]*/) || [''])[0]);
  ok(/1 ⚠/.test(log) && /Geometrie: platná · 1 těleso/.test(log), 'stav: počet ⚠ a řádek Geometrie');
  await p.waitForTimeout(600);
  ok((await p.locator('[data-feature-warning]').count()) >= 1, 'historie: oranžový štítek ⚠ u prvku');
  ok(await p.locator('[data-warn-chip]').isVisible(), 'stavový řádek: čip „prvek s upozorněním“');
  await p.screenshot({ path: S + 'fixes-warning.png' });

  // ── 2. formulář: změna průměru a hned nato názvu v jednom tiku (automatizace bez čekání) – nic se neztratí ──
  await run(p, 'nový díl Formulář\nkvádr 60 40 20');
  await p.getByRole('button', { name: 'Tvorba', exact: true }).click();
  await p.getByRole('button', { name: 'Díra', exact: true }).first().click(); await p.waitForTimeout(600);
  await p.evaluate(() => {
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const dia = document.querySelector('input[aria-label="Průměr"]');
    const name = [...document.querySelectorAll('aside input, div.z-\\[95\\] input')].find((i) => i.value === 'Díra 1' || /^Díra \d+$/.test(i.value));
    dia.focus(); setVal(dia, '7'); dia.dispatchEvent(new FocusEvent('blur', { bubbles: true })); // potvrzení hodnoty
    setVal(name, 'Moje díra'); // ve stejném tiku: změna názvu
  });
  await p.waitForTimeout(700);
  await p.locator('button[title="OK (Enter)"]').first().click(); await p.waitForTimeout(1200);
  let st = await status(p);
  ok(/Moje díra \[hole/.test(st) && /Moje díra[^\n]*Ø7\b/.test(st), 'průměr 7 i název „Moje díra“ se uložily (žádné přepsání zastaralou kopií)\n' + (st.match(/\d+\. [^\n]*hole[^\n]*/) || [''])[0]);
  // průběžné potvrzení: číslo napsané bez Tab/Enter/kliknutí jinam se uloží samo
  await p.getByRole('button', { name: 'Díra', exact: true }).first().click(); await p.waitForTimeout(600);
  await p.locator('input[aria-label="Průměr"]').first().fill('9'); await p.waitForTimeout(900);
  await p.locator('button[title="OK (Enter)"]').first().click(); await p.waitForTimeout(1200);
  st = await status(p);
  ok(/Ø9\b/.test(st), 'hodnota napsaná do pole bez opuštění pole se uložila (průběžné potvrzení)\n' + (st.match(/Díra 2[^\n]*/) || [''])[0]);

  // ── 3. výkres: změna formátu a okamžité zavření (Esc) – formát se neztratí; patička bez automatické poznámky ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click();
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 120000 }); await p.waitForTimeout(500);
  const sheetTxt = await p.evaluate(() => document.querySelector('[data-sheet]')?.textContent || '');
  ok(!/Nekótované rozměry/.test(sheetTxt) && /List 1\/1/.test(sheetTxt), 'patička bez „Nekótované rozměry dle 3D modelu“ (jen na vyžádání)');
  const sel = p.getByLabel('Formát listu');
  const before = await sel.inputValue();
  const target = before === 'A3' ? 'A2' : 'A3';
  await sel.selectOption(target);
  await p.keyboard.press('Escape'); // hned – bez čekání na přepočet a odložené uložení
  await p.waitForTimeout(800);
  const dwg = await p.evaluate(() => window.mncad.getDocument());
  ok(dwg.drawings?.[0]?.options?.sheet === target, `formát ${target} uložen i při okamžitém zavření (bylo ${before}, dokument má ${dwg.drawings?.[0]?.options?.sheet})`);

  // ── 4. sestava: kusovník s číslem dílu a označením materiálu, stav sestavy, kolize do protokolu ──
  const asm = { app: 'mnastrojarna-cad', version: 2, name: 'QA sestava', kind: 'assembly', material: 'ocel', features: [], components: [
    { id: 'c1', name: 'Deska', source: { kind: 'part', doc: part('Deska', 'QA-101', 'TEST - S235', [100, 60, 10]) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
    { id: 'c2', name: 'Vložka', source: { kind: 'part', doc: part('Vložka', 'QA-102', 'TEST - 1.2311', [40, 30, 20]) }, placement: { position: [30, 15, 10], rotation: [0, 0, 0] } },
    { id: 'c3', name: 'Čep', source: { kind: 'part', doc: part('Čep', 'QA-103', '', [6, 6, 30]) }, placement: { position: [5, 5, 10], rotation: [0, 0, 0] } },
    { id: 'c4', name: 'Čep', source: { kind: 'part', doc: part('Čep', 'QA-103', '', [6, 6, 30]) }, placement: { position: [85, 5, 10], rotation: [0, 0, 0] } },
  ] };
  log = await run(p, JSON.stringify(asm));
  ok(/✓ dokument „QA sestava“/.test(log), 'sestava z JSON otevřena');
  await p.waitForFunction(() => /Sestava: 4 komponent/.test(document.body.innerText) || true, null, { timeout: 1000 }).catch(() => {});
  await p.waitForTimeout(4000); // stavba komponent
  st = await status(p);
  ok(/Sestava: 4 komponent \(4 dílů/.test(st) && /objem Σ/.test(st) && /hmotnost Σ/.test(st), 'stav sestavy: komponenty, objem, hmotnost (ne „žádné těleso“)\n' + (st.match(/Sestava[^\n]*/) || [''])[0]);
  ok(!/Rozměry: žádné těleso/.test(st) && /Kolize: nezkontrolováno/.test(st), 'stav sestavy bez „žádné těleso“, kolize zatím nekontrolovány');
  log = await run(p, 'kolize');
  ok(/✓ kolize: žádné \(4 komponent\)/.test(log) || /⚠ kolize: \d+/.test(log), 'příkaz kolize vrátí výsledek do protokolu\n' + (log.match(/kolize[^\n]*/) || [''])[0]);
  st = await status(p);
  ok(/Kolize: (žádné|\d+ –)[^\n]*zkontrolováno/.test(st), 'stav: řádek Kolize s časem kontroly');
  ok(await p.locator('[data-clash-result]').isVisible(), 'panel Kolize zůstává viditelný i bez kolizí (trvalý výsledek)');
  await p.getByRole('button', { name: 'Sestava', exact: true }).first().click().catch(() => {});
  await p.getByRole('button', { name: 'Kusovník', exact: true }).first().click();
  await p.waitForTimeout(600);
  const bom = await p.evaluate(() => document.querySelector('table')?.textContent || '');
  ok(/QA-101/.test(bom) && /QA-102/.test(bom) && /QA-103/.test(bom), 'kusovník: čísla dílů z vlastností dílu');
  ok(/TEST - S235/.test(bom) && /TEST - 1\.2311/.test(bom), 'kusovník: označení materiálu dílu (ne jen Ocel)');
  ok(/Čep[^\n]*4|4[^\n]*Čep/.test(bom.replace(/\s+/g, ' ')), 'kusovník: 4 čepy v jedné položce');
  await p.screenshot({ path: S + 'fixes-bom.png' });
  await p.keyboard.press('Escape');

  // ── 5. závit M18×1,5 v díře: šroubovice i katalogový závit; výkres kótuje M18×1,5 ──
  log = await run(p, 'nový díl Matice\ntrubka 42 16.5 30\n' + JSON.stringify({ type: 'ext', ext: 'surf.helixSweep', data: { profile: 'thread60', side: 'internal', depth: 0.75, radius: 8.25, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: 'Z', mode: 'cut' } }) + '\nstav');
  ok(/✓ Prvek \d+ \(ext\)|✓ [^\n]*\(ext\)/.test(log) && /Geometrie: platná/.test(log), 'vnitřní závit tažením po šroubovici: ✓ a platná geometrie\n' + (log.match(/Geometrie[^\n]*/) || [''])[0]);
  // náběh jako u kalibru: snímek pohledu do díry (vybroušený hřbet prvního závitu)
  const lead = await run(p, 'nový díl Kalibr\ntrubka 42 16.5 12\n' + JSON.stringify({ type: 'ext', ext: 'surf.helixSweep', data: { profile: 'thread60', side: 'internal', depth: 0.75, radius: 8.25, pitch: 1.5, turns: 9, leadIn: 1, position: [0, 0, -1], axis: 'Z', mode: 'cut' } }) + '\nzobraz horní\nstav');
  ok(/✓ [^\n]*\(ext\)/.test(lead) && /Geometrie: platná/.test(lead), 'náběh (výbrus hřbetu prvního závitu): ✓ a platná geometrie\n' + (lead.match(/⚠[^\n]*|✗[^\n]*/) || [''])[0]);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: S + 'fixes-lead-in-top.png' });
  await p.evaluate(() => window.mncad.run('zobraz iso'));
  await p.waitForTimeout(800);
  await p.screenshot({ path: S + 'fixes-lead-in-iso.png' });
  log = await run(p, 'nový díl Matice\ntrubka 42 16.5 30\n' + JSON.stringify({ type: 'ext', ext: 'surf.helixSweep', data: { profile: 'thread60', side: 'internal', depth: 0.75, radius: 8.25, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: 'Z', mode: 'cut' } }) + '\nstav');
  log = await run(p, 'závit M18×1,5 délka 30 v 0 0 0 vnitřní');
  ok(/✓ Závit 1 \(thread\)/.test(log) && /M18×1,5 délka 30 mm, vnitřní/.test(log), 'katalogový závit M18×1,5 vnitřní (kosmetický)');
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click();
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 120000 }); await p.waitForTimeout(500);
  const dims = await p.evaluate(() => [...document.querySelectorAll('[data-sheet] svg text')].map((t) => t.textContent));
  ok(dims.some((t) => /M18×1,5 dl\. 30/.test(t)), 'výkres: kružnice jádra kótována katalogovým označením M18×1,5 dl. 30 (ne odvozeným z šroubovice)\n' + dims.filter((t) => /M|Ø/.test(t)).join(' | '));
  await p.keyboard.press('Escape');

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
