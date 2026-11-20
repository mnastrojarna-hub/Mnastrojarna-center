// E2E 15. vlna (test 959, balík „hole“) – agent, který má jen textovou konzoli (Ctrl+Shift+K) a prohlížeč BEZ WebGL,
// bez window.mncad: všechno se zadá psaním do konzole a ověří z řádků protokolu (✓ / ⚠ / ✗ s čísly řádků) a z formuláře.
//  B3: `díra … v x y v x y` – polohy po skupinách (2 čísla = na povrchu tělesa v místě díry, 3 = x y z), stav vypíše
//      všechny polohy, objem z `měřit těleso` = 2 díry od povrchu (různé výšky) + 1 od z = 5; skupina s 1 číslem = ✗ řádku.
//  B4: zahloubení + závit = zahloubení + vrták + závit: stav, objem, `měřit díry`, ⚠ při zahloubení menším než závit,
//      ✗ zahloubení + kuželové; výkres (`výkres stav`): popis „M8 skrz / Ø6,8 skrz / ⌴ Ø20 ↧7“, kontrola kót;
//      formulář závitové díry: „Zahloubení závitové díry“ (Bez / Válc. zahl. / Kuž. zahl.) mění model (ověřeno textem `stav`).
//  B9: soustružený díl Ø10 / Ø8 s vrtáním Ø4: `výkres … tabulka děr ano` + `výkres stav` → jen „A1 Ø4“; `měřit díry` jen Ø4.
//  Revize: `head=senkung` = válcové zahloubení; `upravit … kind=tapped thread=M8` u zahloubené díry zahloubení ponechá (i formulář
//      Typ díry → Závit); starší JSON díra bez head s uloženým zahloubením = ⚠ + poznámka ve stavu; stav ukáže směr vrtání nahoru
//      a všechny polohy; tabulka děr: závitová díra se zahloubením jedním řádkem („M8 Ø6,8 ⌴Ø20“); hřídel podél X s pohledem
//      shora: tabulka z pohledu, který díru vidí, díry jiné osy vyjmenované; průchozí závit s hloubka-závitu „M8 ↧12“.
// Spuštění: E2E_BASE=http://localhost:3421 node e2e/cad-w15-hole.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w15-hole').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m, log) => { console.log((c ? 'ok: ' : 'FAIL: ') + m + (!c && log ? '\n    protokol: ' + String(log).slice(-900).replace(/\n/g, '\n    ') : '')); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const PI = Math.PI;
/** objem z řádku `měřit těleso` („… · objem 47123,456 mm³ (47,123 cm³) …“) */
const volumeOf = (log) => { const m = /objem (-?[\d,.]+) mm³/.exec(log); return m ? parseFloat(m[1].replace(',', '.')) : NaN; };
const near = (a, b, tol = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= tol;

(async () => {
  const b = await chromium.launch({ args: NO_GL });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  try {
    await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
    const cont = p.getByText('Pokračovat v práci');
    if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
    await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
    await p.waitForTimeout(1500);
    ok(await p.evaluate(() => { try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch { return true; } }), 'WebGL není k dispozici (jako v polním hlášení)');

    // ── konzole: Ctrl+Shift+K, psaní, Provést, protokol ──
    await p.keyboard.press('Control+Shift+K');
    const input = p.getByLabel('Textové příkazy nebo JSON');
    await input.waitFor({ timeout: 30000 });
    const out = p.locator('[data-agent-output]');
    const run = async (text, ms = 240000) => {
      const before = await out.innerText().catch(() => '');
      await input.fill(text);
      await p.getByRole('button', { name: 'Provést', exact: true }).click();
      await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
      await p.waitForTimeout(300);
      return out.innerText();
    };

    // ════════ B3: polohy po skupinách ════════
    let log = await run('nový díl W15 B3\nkvádr 40 40 30\nkvádr 20 40 10 v 0 0 30\ndíra 5 skrz v 10 10 v 30 10 v 30 30 5');
    ok(/✓ Díra 1 \(hole\)/.test(log) && !/^[✗⚠]/m.test(log), 'B3: „díra 5 skrz v 10 10 v 30 10 v 30 30 5“ → ✓ Díra 1, bez ⚠ / ✗');
    ok(/· polohy \(3\): \[10; 10; 40\] \[30; 10; 30\] \[30; 30; 5\]/.test(log), 'B3: stav – tři polohy, z = povrch v místě každé díry (40 / 30) a zadané 5');
    log = await run('měřit těleso');
    const full = 40 * 40 * 30 + 20 * 40 * 10;
    let v = volumeOf(log);
    // díra od z = 5 uvnitř materiálu má nad bodem krátký nástup = poloměr díry (2,5)
    let want = full - PI * 2.5 * 2.5 * (40 + 30 + 5 + 2.5);
    ok(near(v, want), `B3: měřit těleso – objem ${v} mm³ (analyticky ${want.toFixed(3)})`);
    log = await run('měřit díry');
    ok(/Díry: 3 – Ø 5 mm × 3/.test(log), 'B3: měřit díry – 3 díry Ø5');
    log = await run('díra 6,8 skrz v 15,1 -30 v 15,1 závit M8');
    ok(/✗ řádek 1: díra: poloha 2 „v 15,1“ – počet čísel 1; každá poloha má dvě čísla/.test(log), 'B3: poloha s jedním číslem → ✗ řádek 1 s číslem polohy (nález: tichá díra se z z další polohy)');
    log = await run('díra 6,8 skrz v 15,1 5 v 15,1 25 závit M8');
    ok(/✓ Díra 2 \(hole\)/.test(log) && !/^[✗⚠]/m.test(log) && /M8 skrz \(vrták Ø6,8\) v \[15,1; 5; 40\], osa Z · polohy \(2\): \[15,1; 5; 40\] \[15,1; 25; 40\]/.test(log), 'B3: „díra 6,8 skrz v 15,1 5 v 15,1 25 závit M8“ = 2 závitové díry na povrchu (nález: ✗ „tři souřadnice“)');

    // ════════ B4: zahloubení + závit ════════
    log = await run('nový díl W15 B4\nkvádr 40 40 30 v -20 -20 0\ndíra 6,8 skrz v 0 0 30 zahloubení 20 7 závit M8');
    ok(/✓ Díra 1 \(hole\)/.test(log) && !/^[✗⚠]/m.test(log), 'B4: „díra 6,8 skrz … zahloubení 20 7 závit M8“ → ✓ bez ⚠');
    ok(/M8 skrz \(vrták Ø6,8\) zahl\. Ø20×7 v \[0; 0; 30\]/.test(log), 'B4: stav „M8 skrz (vrták Ø6,8) zahl. Ø20×7“');
    log = await run('měřit těleso');
    v = volumeOf(log);
    want = 40 * 40 * 30 - PI * (10 * 10 * 7 + 3.4 * 3.4 * 23);
    ok(near(v, want), `B4: objem ${v} mm³ = kvádr − Ø20×7 − Ø6,8×23 (${want.toFixed(3)}; nález: zahloubení zahozeno, o ${(PI * (100 - 3.4 * 3.4) * 7).toFixed(1)} mm³ víc)`);
    log = await run('měřit díry');
    ok(/Ø 20 mm: .*slepá, hloubka 7 mm/.test(log) && /Ø 6,8 mm: .*skrz/.test(log), 'B4: měřit díry – zahloubení Ø20 slepé hl. 7 + vrták Ø6,8 skrz');
    log = await run('díra závit M8 skrz zahloubení 7,5 3 v 10 10 30');
    ok(/⚠ Díra 2 \(hole\): Zahloubení Ø7,5 je menší než závit M8 \(Ø8\)/.test(log), 'B4: zahloubení menší než závit → ⚠ ve výsledku stavby');
    log = await run('díra závit M8 skrz zahloubení 15 9 kuželové 16 v -10 -10 30');
    ok(/✗ řádek 1: díra: „zahloubení“ a „kuželové“ najednou nejde/.test(log), 'B4: zahloubení + kuželové → ✗ řádku');
    log = await run('výkres A3 pohledy přední,horní\nvýkres stav');
    ok(/M8 skrz \/ Ø6,8 skrz \/ ⌴ Ø20 ↧7/.test(log), 'B4: výkres stav – popis „M8 skrz / Ø6,8 skrz / ⌴ Ø20 ↧7“');
    ok(!/Kontrola kót: [^\n]*chybí: [^\n]*(zahloubení|vrták závitu)/.test(log), 'B4: kontrola kót nehlásí chybějící zahloubení / vrták');

    // ── formulář závitové díry: Zahloubení závitové díry ──
    log = await run('nový díl W15 B4 form\nkvádr 40 40 30 v -20 -20 0\ndíra závit M8 skrz v 0 0 30');
    ok(/M8 skrz \(vrták Ø6,8\) v \[0; 0; 30\]/.test(log), 'formulář: výchozí závitová díra bez zahloubení');
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
    if (await input.isVisible().catch(() => false)) { await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {}); await p.waitForTimeout(600); }
    await p.locator('aside').first().getByText('Díra 1', { exact: true }).click(); await p.waitForTimeout(1500);
    ok(await p.getByText('Zahloubení závitové díry').isVisible().catch(() => false), 'formulář: pole „Zahloubení závitové díry“ u závitové díry');
    await p.locator('[data-tapped-head]').getByRole('button', { name: 'Válc. zahl.', exact: true }).click(); await p.waitForTimeout(2500);
    ok(await p.getByText(/Vrtá se zahloubení, pod ním vrták Ø6,8 a závit M8 – výkres: M8 \+ ⌴ Ø16 ↧8\./).isVisible().catch(() => false), 'formulář: Válc. zahl. → výchozí Ø16 × 8 a informace o vrtání');
    await p.screenshot({ path: S + 'w15-hole-form-cbore.png' });
    await p.keyboard.press('Control+Shift+K');
    await input.waitFor({ timeout: 20000 });
    log = await run('stav');
    ok(/M8 skrz \(vrták Ø6,8\) zahl\. Ø16×8/.test(log), 'formulář → stav: „zahl. Ø16×8“ (ověřeno textem)');
    log = await run('měřit těleso');
    v = volumeOf(log);
    want = 40 * 40 * 30 - PI * (8 * 8 * 8 + 3.4 * 3.4 * 22);
    ok(near(v, want), `formulář: objem ${v} mm³ = kvádr − Ø16×8 − Ø6,8×22 (${want.toFixed(3)})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
    if (await input.isVisible().catch(() => false)) { await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {}); await p.waitForTimeout(600); }
    await p.locator('aside').first().getByText('Díra 1', { exact: true }).click(); await p.waitForTimeout(1200);
    await p.locator('[data-tapped-head]').getByRole('button', { name: 'Kuž. zahl.', exact: true }).click(); await p.waitForTimeout(2500);
    const csD = p.locator('[data-tapped-head] input[aria-label="Ø zahloubení"]');
    await csD.fill('7'); await csD.press('Tab'); await p.waitForTimeout(2500);
    ok(await p.locator('[data-head-warning]').isVisible().catch(() => false), 'formulář: kuželové Ø7 < M8 → upozornění ⚠ ve formuláři');
    await p.screenshot({ path: S + 'w15-hole-form-csink.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); // Esc opustí číselné pole – zkratky v poli neplatí
    await p.keyboard.press('Control+Shift+K');
    await input.waitFor({ timeout: 20000 });
    log = await run('stav');
    ok(/M8 skrz \(vrták Ø6,8\) kuž\. Ø7/.test(log) && /⚠ Zahloubení Ø7 je menší než závit M8/.test(log), 'formulář → stav: „kuž. Ø7“ + ⚠ zahloubení menší než závit');

    // ════════ B9: tabulka děr bez vnějších válců ════════
    log = await run('nový díl W15 B9 čep\nválec 10 20\nválec 8 10 v 0 0 20\ndíra 4 skrz v 0 0 30');
    ok(/✓ Díra 1 \(hole\)/.test(log), 'B9: soustružený díl Ø10 / Ø8 s vrtáním Ø4');
    log = await run('měřit díry');
    ok(/Díry: 1 – Ø 4 mm × 1/.test(log), 'B9: měřit díry – jen Ø4');
    log = await run('měřit válce');
    ok(/Válce: 2 – /.test(log) && /Ø 8 mm/.test(log) && /Ø 10 mm/.test(log), 'B9: měřit válce – vnější Ø8 a Ø10');
    log = await run('výkres A4 pohledy přední,horní tabulka děr ano\nvýkres stav');
    ok(/Tabulka děr \(pohled horní, 1\): A1 Ø4 \[5; 5\]/.test(log) && !/Tabulka děr[^\n]*Ø(8|10) \[/.test(log), 'B9: výkres stav – tabulka děr jen „A1 Ø4“ (nález: A1 Ø8, B1 Ø10)');
    await p.screenshot({ path: S + 'w15-hole-b9.png' });

    // ════════ Revize: nálezy kontroly balíku ════════
    log = await run('nový díl W15 rev\nkvádr 60 60 20\ndíra 6,6 skrz v 20 20 zahloubení 11 6,8\nupravit "Díra 1" kind=tapped thread=M8');
    ok(/závitová díra se zahloubením \(zahloubení \+ vrták \+ závit\) – bez zahloubení: head=none/.test(log) && /M8 skrz \(vrták Ø6,8\) zahl\. Ø11×6,8 v \[20; 20; 20\], osa Z/.test(log), 'revize: upravit kind=tapped thread=M8 u zahloubené díry – zahloubení zůstane a protokol to oznámí (nález: tiše zahozeno)');
    log = await run('měřit díry');
    ok(/Ø 11 mm: .*slepá, hloubka 6,8 mm/.test(log) && /Ø 6,8 mm/.test(log), 'revize: měřit díry – zahloubení Ø11 hl. 6,8 + vrták Ø6,8');
    log = await run('prvek hole kind=tapped thread=M8 head=senkung cbDiameter=20 cbDepth=7 position=40;40;20 depth=0');
    ok(!/^✗/m.test(log) && /✓ Díra 2 \(hole\)/.test(log) && /M8 skrz \(vrták Ø6,8\) zahl\. Ø20×7 v \[40; 40; 20\]/.test(log), 'revize: head=senkung = válcové zahloubení (nález: ✗ head=countersink potřebuje csDiameter)', log);
    log = await run('díra 6 skrz v 50 50 0 směr 0 0 1');
    ok(/Ø6 skrz v \[50; 50; 0\], osa Z, vrtá \+Z/.test(log), 'revize: stav – díra vrtaná nahoru „osa Z, vrtá +Z“ (nález: jen „osa Z“)');
    log = await run('{"type":"hole","name":"Stara","position":[10,50,20],"axis":"Z","diameter":6.8,"depth":0,"kind":"tapped","thread":"M8","cbDiameter":20,"cbDepth":7}');
    ok(/⚠ Stara \(hole\): Uložené zahloubení Ø20×7 se nevrtá – závitová díra nemá head/.test(log) && /\(uložené zahl\. Ø20×7 se nevrtá – chybí head\)/.test(log), 'revize: starší JSON díra bez head s uloženým zahloubením → ⚠ a poznámka ve stavu (nález: ✓ bez stopy)');
    log = await run('výkres A3 pohledy přední,horní tabulka děr ano\nvýkres stav');
    ok(/Tabulka děr \(pohled horní, 4\): /.test(log) && /M8 Ø6,8 ⌴Ø11 \[/.test(log) && /M8 Ø6,8 ⌴Ø20 \[/.test(log) && !/[A-Z]\d+ Ø(11|20) \[/.test(log), 'revize: tabulka děr – závitové díry se zahloubením jedním řádkem s M8 a ⌴ (nález: zahloubení jako další díra)');
    log = await run('nový díl W15 rev hřídel\nskica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít\nrotovat osa X\ndíra 6 hloubka 15 v 0 0 osa X\ndíra 5 skrz obousměrně v 60 0 0 osa Y\nvýkres A3 pohledy přední,levý,pravý,horní tabulka děr ano\nvýkres stav');
    ok(/Tabulka děr \(pohled přední, 1\): A1 Ø5 \[60; 20\] · díry s jinou osou nejsou v tabulce \(1\): Ø6 osa X/.test(log) && !/Tabulka děr: žádné díry/.test(log), 'revize: hřídel podél X – tabulka děr z pohledu přední, Ø6 (osa X) vyjmenovaná (nález: „žádné díry … vnější válce“)');
    log = await run('nový díl W15 rev závit\nkvádr 80 40 30\ndíra 6,8 skrz v 20 20 zahloubení 20 7 závit M8 hloubka-závitu 12\nvýkres A3 pohledy přední,horní\nkótovat chytře\nvýkres stav');
    ok(/M8 ↧12 \/ Ø6,8 skrz \/ ⌴ Ø20 ↧7/.test(log) && /zahl\. Ø20×7, délka závitu 12/.test(log), 'revize: průchozí závit s hloubka-závitu – výkres „M8 ↧12 / Ø6,8 skrz / ⌴ Ø20 ↧7“, stav „délka závitu 12“');
    // formulář: zahloubená díra → Typ díry „Závit“ zahloubení ponechá (jako upravit)
    log = await run('nový díl W15 rev formulář\nkvádr 60 60 20\ndíra 6,6 skrz v 20 20 zahloubení 11 6,8');
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
    if (await input.isVisible().catch(() => false)) { await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {}); await p.waitForTimeout(600); }
    await p.locator('aside').first().getByText('Díra 1', { exact: true }).click(); await p.waitForTimeout(1500);
    await p.getByText('Typ díry', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Závit', exact: true }).click(); await p.waitForTimeout(2500);
    ok(await p.locator('[data-tapped-head] input[aria-label="Ø zahloubení"]').isVisible().catch(() => false), 'revize: formulář Typ díry → Závit u zahloubené díry – pole zahloubení zůstane (Válc. zahl.)');
    await p.screenshot({ path: S + 'w15-hole-rev-form.png' });
    await p.getByRole('button', { name: 'OK', exact: true }).click(); await p.waitForTimeout(2500); // potvrdit úpravu (Esc = Storno)
    await p.keyboard.press('Control+Shift+K');
    await input.waitFor({ timeout: 20000 });
    log = await run('stav');
    ok(/M6 skrz[^\n]*zahl\. Ø11×6,8 v \[20; 20; 20\]/.test(log), 'revize: formulář → stav „M6 skrz … zahl. Ø11×6,8“ (zahloubení zůstalo)', log);

    ok(dialogs.length === 0, 'žádné systémové dialogy (' + dialogs.join('; ') + ')');
    ok(errs.length === 0, 'žádné chyby stránky (' + errs.slice(0, 3).join(' | ') + ')');
  } catch (e) {
    ok(false, 'výjimka: ' + (e && e.stack || e));
    await p.screenshot({ path: S + 'w15-hole-error.png' }).catch(() => {});
  } finally {
    await b.close();
  }
})();
