// E2E: vlna 13, balík ui – chování tlačítek karet Nástroje / Zobrazení / Data a rychlé lišty (12 chyb z psaní mikronávodů).
//  1 Hmotnost v sestavě (součet dílů, těžiště; příznak okna nezůstane viset), 2 Vlastnosti (první klik ukáže údaje),
//  3 Proměnné / Stavy dílu přepnou záložku správce (v sestavě neaktivní), 4 filtr Prvek vybere prvek plochy,
//  5 barva v sestavě obarví komponenty, 6 mřížka a přichycení z Nastavení při startu, 7 rám formy v nové záložce,
//  8 Otevřít v sestavě = nová záložka, Import do sestavy = komponenta, 9 skryté těleso jde znovu zobrazit (3 cesty),
//  10 Souřadnice otevře skrytý panel Vlastnosti, 11 skupiny uložené česky a ve stromu přeložené / sloučené, 12 G nepřesune ukotvenou komponentu.
// Spuštění: E2E_BASE=http://localhost:3401 node e2e/cad-w13-ui.e2e.cjs [složka]   (ONLY=1,2,… jen vybrané)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = (process.argv[2] || path.join(os.tmpdir(), 'e2e-w13-ui')).replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };

async function open(p, url = '/cad') {
  await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading kernel|Lade Kern/.test(document.body.innerText), null, { timeout: 180000 });
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape').catch(() => {});
}
const idle = (p) => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
const run = async (p, text) => { const r = await p.evaluate((t) => window.mncad.run(t), text); await idle(p); await p.waitForTimeout(700); return r; };
const doc = (p) => p.evaluate(() => window.mncad.getDocument());
const tabs = (p) => p.evaluate(() => window.mncad.tabs());
const clickTab = (p, name) => p.evaluate((n) => { const row = document.querySelector('[data-ribbon]').previousElementSibling; const b = [...row.querySelectorAll(':scope > button')].find((x) => x.innerText.trim() === n); if (!b) throw new Error('karta ' + n); b.click(); }, name);
const btnSel = (l) => [...document.querySelectorAll('[data-ribbon] button')].find((x) => (x.getAttribute('aria-label') || x.innerText).replace('▼', '').trim() === l);
const ribbonBtn = (p, label) => p.evaluate((l) => { const b = [...document.querySelectorAll('[data-ribbon] button')].find((x) => (x.getAttribute('aria-label') || x.innerText).replace('▼', '').trim() === l); return b ? { disabled: b.disabled, active: /bg-\[#fde3e1\]/.test(b.className) } : null; }, label);
const clickRibbon = async (p, label) => { await p.evaluate((l) => { const b = [...document.querySelectorAll('[data-ribbon] button')].find((x) => (x.getAttribute('aria-label') || x.innerText).replace('▼', '').trim() === l); if (!b) throw new Error('tlačítko ' + l); b.click(); }, label); await p.waitForTimeout(350); };
// nabídky pásu a rychlá lišta mají data-cad-menu, kontextová nabídka (pravé tlačítko) je pevná vrstva .fixed
const MENU = '[data-cad-menu] button, div.fixed button';
const clickMenu = async (p, label) => { await p.evaluate(([l, sel]) => { const b = [...document.querySelectorAll(sel)].find((x) => x.innerText.trim() === l); if (!b) throw new Error('položka ' + l); b.click(); }, [label, MENU]); await p.waitForTimeout(400); };
const menuHas = (p, label) => p.evaluate(([l, sel]) => [...document.querySelectorAll(sel)].some((x) => x.innerText.trim() === l), [label, MENU]);
const bodyHas = (p, t) => p.evaluate((x) => document.body.innerText.includes(x), t);
const closeModal = (p) => p.evaluate(() => { const b = [...document.querySelectorAll('.fixed button[aria-label]')].find((x) => /Zavřít|Close|Schließen/.test(x.getAttribute('aria-label'))); b && b.click(); });
const hints = async (p) => { await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(1200); return p.evaluate(() => window.mncad.hints(true)); };
const clickHint = async (p, id, additive = false) => { await p.evaluate(([i, a]) => window.mncad.clickHint(i, a), [id, additive]); await p.waitForTimeout(900); };
const setFilter = (p, f) => p.evaluate((v) => { const s = document.querySelector('footer select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); }, f);
const treeRow = (p, name) => p.evaluate((n) => { const el = [...document.querySelectorAll('aside span')].find((s) => s.innerText.trim() === n); el && el.click(); return !!el; }, name);
const inspectPanel = (p) => p.evaluate(() => [...document.querySelectorAll('main .absolute.z-20')].some((d) => d.className.includes('bottom-12')));
const mgrTab = (p) => p.evaluate(() => [...document.querySelectorAll('aside button')].filter((x) => /border-brand/.test(x.className)).map((x) => x.innerText.trim())[0] || '');

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await open(p);

  // ── díl: deska s dírou a menším kvádrem nahoře ──
  await run(p, 'kvádr 100 60 20\ndíra 8 skrz v 20 30 20\nkvádr 20 20 10 v 40 20 20');
  await p.waitForTimeout(1500);

  if (want(2)) {
    await clickTab(p, 'Nástroje');
    ok((await ribbonBtn(p, 'Vlastnosti'))?.active === true, '#2 Vlastnosti je při startu zvýrazněné (zapnuté)');
    await clickRibbon(p, 'Vlastnosti');
    ok((await ribbonBtn(p, 'Vlastnosti'))?.active === true && (await bodyHas(p, 'Vlastnosti: klikněte na plochu')), '#2 první klik bez výběru tlačítko nevypne a řekne, co vybrat');
    const h = (await hints(p)).find((x) => x.kind === 'face');
    await clickHint(p, h.id);
    ok(await inspectPanel(p), '#2 výběr plochy ukáže panel Vlastnosti');
    await clickRibbon(p, 'Vlastnosti');
    ok(!(await inspectPanel(p)) && (await ribbonBtn(p, 'Vlastnosti'))?.active === false, '#2 klik při otevřeném panelu ho skryje a tlačítko vypne');
    await clickRibbon(p, 'Vlastnosti');
    await p.waitForTimeout(700);
    ok((await inspectPanel(p)) && (await ribbonBtn(p, 'Vlastnosti'))?.active === true, '#2 další klik ukáže údaje o aktuálním výběru (dělá, co slibuje popisek)');
    await p.evaluate(() => window.mncad.hints(false));
  }

  if (want(10)) {
    // panel Vlastnosti skrýt, pak Souřadnice vrcholu v rychlé liště ho musí otevřít
    await clickTab(p, 'Nástroje');
    if ((await ribbonBtn(p, 'Vlastnosti'))?.active) {
      if (!(await inspectPanel(p))) { const h = (await hints(p)).find((x) => x.kind === 'face'); await clickHint(p, h.id); }
      await clickRibbon(p, 'Vlastnosti');
    }
    ok((await ribbonBtn(p, 'Vlastnosti'))?.active === false, '#10 příprava: panel Vlastnosti vypnutý');
    await setFilter(p, 'vertex');
    await p.waitForTimeout(300);
    const v = (await hints(p)).find((x) => x.kind === 'vertex');
    await clickHint(p, v.id);
    const co = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-cad-menu] button')].find((x) => /^Souřadnice/.test(x.innerText.trim())); if (b) b.click(); return !!b; });
    await p.waitForTimeout(900);
    ok(co && (await inspectPanel(p)), '#10 Souřadnice v rychlé liště otevře skrytý panel Vlastnosti');
    await p.evaluate(() => window.mncad.hints(false));
    await setFilter(p, 'all');
  }

  if (want(3)) {
    await clickTab(p, 'Nástroje');
    await clickRibbon(p, 'Proměnné');
    ok((await mgrTab(p)) === 'Proměnné' && (await ribbonBtn(p, 'Proměnné'))?.active === true, '#3 Proměnné přepne levý panel na záložku Proměnné');
    await clickRibbon(p, 'Stavy dílu');
    ok((await mgrTab(p)) === 'Stavy', '#3 Stavy dílu přepne levý panel na záložku Stavy');
    await p.evaluate(() => { const b = [...document.querySelectorAll('aside button')].find((x) => x.innerText.trim() === 'Historie'); b && b.click(); });
    await p.waitForTimeout(300);
    ok((await mgrTab(p)) === 'Historie' && (await ribbonBtn(p, 'Stavy dílu'))?.active === false, '#3 klik na záložku Historie ve správci tlačítka vypne');
  }

  if (want(4)) {
    await clickTab(p, 'Nástroje');
    await clickRibbon(p, 'Filtr: Vše');
    await clickMenu(p, 'Prvek');
    const d = await doc(p);
    const [box, , top] = d.features;
    // boční stěny: menšího kvádru (střed Z mezi 20 a 30) a desky (střed Z = 10)
    const faces = [];
    for (const h of (await hints(p)).filter((x) => x.kind === 'face')) {
      const r = await p.evaluate((id) => window.mncad.measure(id), h.id);
      const e = r.report && r.report.entity;
      if (e && e.center && e.normal) faces.push({ id: h.id, z: e.center[2], nz: e.normal[2] });
    }
    const side = faces.find((f) => Math.abs(f.nz) < 0.01 && f.z > 20.5 && f.z < 29.5);
    const plane = faces.find((f) => Math.abs(f.nz) < 0.01 && Math.abs(f.z - 10) < 0.5);
    ok(!!side && !!plane, `#4 příprava: boční stěna horního kvádru a desky (${JSON.stringify(faces)})`);
    await clickHint(p, side.id);
    await p.waitForTimeout(1500);
    const picked1 = await p.evaluate(() => [...document.querySelectorAll('[data-feature-row][data-picked]')].map((x) => x.getAttribute('data-feature-row')));
    ok(picked1.length === 1 && picked1[0] === top.id, `#4 klik na stěnu horního kvádru vybere jeho prvek ve stromu (${picked1.join(',')})`);
    ok(await bodyHas(p, `Prvek „${top.name}“ – ploch: 5`), '#4 hláška: prvek a počet jeho ploch (4 boky + horní plocha)');
    await clickHint(p, plane.id, true);
    await p.waitForTimeout(1500);
    const picked2 = await p.evaluate(() => [...document.querySelectorAll('[data-feature-row][data-picked]')].map((x) => x.getAttribute('data-feature-row')).sort());
    ok(JSON.stringify(picked2) === JSON.stringify([box.id, top.id].sort()), '#4 Ctrl+klik na boční stěnu desky přidá první kvádr (desku)');
    ok(!(await p.evaluate(() => [...document.querySelectorAll('[data-cad-menu]')].some((m) => m.innerText.includes('Přesunout / otočit (gizmo)')))), '#4 filtr Prvek už nevybírá těleso (žádná lišta tělesa)');
    await p.evaluate(() => window.mncad.hints(false));
    await setFilter(p, 'all');
    await p.waitForTimeout(400);
    ok((await p.evaluate(() => document.querySelectorAll('[data-feature-row][data-picked]').length)) === 0, '#4 změna filtru výběr prvků zruší');
    // výběr i zvýraznění musí zmizet spolu: Delete po změně filtru nesmí smazat neviditelně vybraný prvek
    const nF = (await doc(p)).features.length;
    await p.mouse.move(700, 500);
    await p.keyboard.press('Delete');
    await p.waitForTimeout(1200);
    ok((await doc(p)).features.length === nF, `#4 po změně filtru Delete nic nesmaže (prvků ${nF} → ${(await doc(p)).features.length})`);
    if ((await doc(p)).features.length !== nF) { await p.evaluate(() => window.mncad.undo(1)); await idle(p); }
    // Esc zruší zvýraznění ve stromu i výběr – Delete pak nic nesmaže
    await setFilter(p, 'feature');
    await p.waitForTimeout(400);
    await clickHint(p, (await hints(p)).find((x) => x.id === side.id)?.id || side.id);
    await p.waitForTimeout(1500);
    const pk = await p.evaluate(() => document.querySelectorAll('[data-feature-row][data-picked]').length);
    await p.evaluate(() => window.mncad.hints(false));
    await p.mouse.move(700, 500);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    const pkEsc = await p.evaluate(() => document.querySelectorAll('[data-feature-row][data-picked]').length);
    ok(pk === 1 && pkEsc === 0, `#4 Esc zruší zvýraznění prvku ve stromu (${pk} → ${pkEsc})`);
    await p.keyboard.press('Delete');
    await p.waitForTimeout(1200);
    ok((await doc(p)).features.length === nF, '#4 po Esc Delete nic nesmaže');
    await setFilter(p, 'all');
    await p.waitForTimeout(300);
  }

  if (want(9)) {
    await setFilter(p, 'body');
    await p.waitForTimeout(300);
    const roundTrip = async (how) => {
      const h = (await hints(p)).find((x) => x.kind === 'face');
      await clickHint(p, h.id);
      const hid = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-cad-menu] button')].find((x) => x.innerText.trim() === 'Skrýt těleso'); if (b) b.click(); return !!b; });
      await p.waitForTimeout(500);
      const banner = await p.evaluate(() => !!document.querySelector('[data-body-hidden]'));
      const eye = await p.evaluate(() => document.querySelector('[data-body-eye]')?.getAttribute('data-body-eye'));
      ok(hid && banner && eye === 'hidden', `#9 Skrýt těleso: pruh „Těleso je skryté“ a oko ve stromu (${how})`);
      if (how === 'pruh') await p.click('[data-body-hidden]');
      else if (how === 'strom') await p.click('[data-body-eye]');
      else {
        const cv = await p.evaluate(() => { const r = document.querySelector('main canvas').getBoundingClientRect(); return { x: r.left + 60, y: r.top + 120 }; });
        await p.mouse.click(cv.x, cv.y, { button: 'right' });
        await p.waitForTimeout(500);
        ok(await menuHas(p, 'Zobrazit těleso'), '#9 pravé tlačítko na prázdném místě nabízí Zobrazit těleso');
        await clickMenu(p, 'Zobrazit těleso');
      }
      await p.waitForTimeout(500);
      const shown = await p.evaluate(() => !document.querySelector('[data-body-hidden]') && document.querySelector('[data-body-eye]')?.getAttribute('data-body-eye') === 'shown');
      const pick = (await hints(p)).some((x) => x.kind === 'face');
      ok(shown && pick, `#9 Zobrazit těleso přes ${how}: těleso je zpět a jde znovu kliknout`);
    };
    await roundTrip('pruh');
    await roundTrip('strom');
    await roundTrip('nabídka');
    await p.evaluate(() => window.mncad.hints(false));
    await setFilter(p, 'all');
  }

  if (want(6)) {
    const setPrefs = (grid, snap) => p.evaluate(([g, sn]) => { const s = JSON.parse(localStorage.getItem('mn-cad-settings-v2') || '{}'); s.rev = 3; s.showGrid = g; s.snapGrid = sn; localStorage.setItem('mn-cad-settings-v2', JSON.stringify(s)); }, [grid, snap]);
    const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('mn-cad-settings-v2') || '{}'));
    await setPrefs(true, false);
    await open(p);
    await clickTab(p, 'Zobrazení');
    ok((await ribbonBtn(p, 'Mřížka a osy'))?.active === true, '#6 po startu je mřížka zapnutá podle Nastavení (dřív vždy vypnutá)');
    await clickRibbon(p, 'Mřížka a osy');
    ok((await stored()).showGrid === false, '#6 přepnutí mřížky na pásu se uloží do Nastavení');
    await open(p);
    await clickTab(p, 'Zobrazení');
    ok((await ribbonBtn(p, 'Mřížka a osy'))?.active === false, '#6 … a platí po dalším spuštění');
    // skica: Přichytit k mřížce podle Nastavení (vypnuto), přepnutí se uloží
    await p.evaluate(() => window.mncad.setDocument({ app: 'mnastrojarna-cad', version: 2, name: 'Skica', material: 'ocel', features: [] }));
    await idle(p);
    await clickTab(p, 'Tvorba');
    await clickRibbon(p, 'Skica');
    await p.evaluate(() => { const b = [...document.querySelectorAll('[data-cad-menu] button')][0]; b && b.click(); });
    await p.waitForTimeout(1500);
    ok((await ribbonBtn(p, 'Přichytit k mřížce'))?.active === false, '#6 ve skice je Přichytit k mřížce vypnuté podle Nastavení (dřív vždy zapnuté)');
    await clickRibbon(p, 'Přichytit k mřížce');
    ok((await stored()).snapGrid === true && (await ribbonBtn(p, 'Přichytit k mřížce'))?.active === true, '#6 přepnutí přichycení ve skice se uloží');
    await setPrefs(false, true);
    await open(p);
  }

  if (want(7)) {
    await p.evaluate(() => window.mncad.setDocument({ app: 'mnastrojarna-cad', version: 2, name: 'Vložka', material: 'ocel', features: [] }));
    await idle(p);
    await run(p, 'kvádr 40 40 10');
    const t0 = await tabs(p);
    const before = (await doc(p)).features.length;
    await clickTab(p, 'Data');
    await clickRibbon(p, 'Sestava');
    await clickMenu(p, 'Rám vstřikovací formy…');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Vytvořit rám formy'); b && b.click(); });
    await p.waitForTimeout(2500);
    const t1 = await tabs(p);
    ok(t1.length === t0.length + 1 && /Rám formy/.test(t1.find((t) => t.active)?.title || ''), `#7 Data › Rám formy otevře novou záložku (${t0.length} → ${t1.length})`);
    await p.evaluate(() => window.mncad.activateTab('Vložka'));
    await p.waitForTimeout(1200);
    const vl = await doc(p);
    ok(vl.kind !== 'assembly' && vl.features.length === before, '#7 rozpracovaný díl zůstal v původní záložce beze změny');
    // tlačítko Rám formy na kartě Sestava (v otevřené sestavě) – taky nová záložka, sestava zůstane
    await p.evaluate(() => window.mncad.activateTab(window.mncad.tabs().find((t) => /Rám formy/.test(t.title)).id));
    await p.waitForTimeout(1500);
    const n0 = (await tabs(p)).length;
    const comps0 = (await doc(p)).components.length;
    await clickTab(p, 'Sestava');
    await clickRibbon(p, 'Rám formy');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Vytvořit rám formy'); b && b.click(); });
    await p.waitForTimeout(2500);
    ok((await tabs(p)).length === n0 + 1, '#7 Sestava › Rám formy otevře další záložku');
    await p.evaluate(() => window.mncad.activateTab(2));
    await p.waitForTimeout(800);
  }

  // ── sestava: deska (ukotvená) a čep ──
  await run(p, 'nový díl Deska\nkvádr 40 30 20');
  const plate = await p.evaluate(() => window.mncad.measure('těleso'));
  await run(p, 'nový díl Čep\nválec 10 30');
  const pin = await p.evaluate(() => window.mncad.measure('těleso'));
  await run(p, 'nová sestava Test\nvložit "Deska" ukotvit\nvložit "Čep" v 60 0 0');
  await p.waitForTimeout(3000);

  if (want(1)) {
    await clickTab(p, 'Nástroje');
    ok((await ribbonBtn(p, 'Hmotnost'))?.disabled === false, '#1 Hmotnost je v sestavě aktivní');
    await clickRibbon(p, 'Hmotnost');
    await p.waitForSelector('[data-asm-mass="ready"]', { timeout: 60000 }).catch(() => {});
    const r = await p.evaluate(() => { const e = document.querySelector('[data-asm-mass]'); return e ? { st: e.getAttribute('data-asm-mass'), kg: +e.getAttribute('data-mass-kg'), cog: (e.getAttribute('data-cog') || '').split(';').map(Number), rows: [...document.querySelectorAll('[data-mass-row]')].map((x) => x.getAttribute('data-mass-row')) } : null; });
    const pb = plate.report.body;
    const cb = pin.report.body;
    const kg = pb.mass + cb.mass;
    const ex = [0, 1, 2].map((k) => (pb.mass * pb.com[k] + cb.mass * (cb.com[k] + (k === 0 ? 60 : 0))) / kg);
    ok(r && r.st === 'ready', '#1 Hmotnost v sestavě otevře okno hmotnostních vlastností sestavy');
    ok(r && Math.abs(r.kg - kg) < 1e-6, `#1 hmotnost = součet dílů podle materiálu (${r && r.kg.toFixed(5)} kg ≈ ${kg.toFixed(5)} kg)`);
    ok(r && r.cog.every((v, k) => Math.abs(v - ex[k]) < 1e-4), `#1 těžiště sestavy podle umístění dílů (${r && r.cog.map((v) => v.toFixed(3)).join(';')} ≈ ${ex.map((v) => v.toFixed(3)).join(';')})`);
    ok(r && r.rows.length === 2, '#1 tabulka dílů (2 řádky)');
    await closeModal(p);
    await p.waitForTimeout(400);
    // příznak okna nesmí zůstat viset: otevřít, přepnout záložku (okno se zavře), díl → nic se samo neotevře
    await clickRibbon(p, 'Hmotnost');
    await p.waitForTimeout(300);
    await p.evaluate(() => window.mncad.activateTab('Deska'));
    await p.waitForTimeout(2500);
    ok(!(await bodyHas(p, 'Hmotnostní vlastnosti')), '#1 po přepnutí záložky se okno hmotnosti samo neotevře');
    await p.evaluate(() => window.mncad.activateTab('Test'));
    await p.waitForTimeout(2000);
  }

  if (want(2)) {
    await clickTab(p, 'Nástroje');
    if (!(await ribbonBtn(p, 'Vlastnosti'))?.active) await clickRibbon(p, 'Vlastnosti');
    await treeRow(p, 'Čep');
    await p.waitForTimeout(800);
    const shown = (await inspectPanel(p)) && (await p.evaluate(() => [...document.querySelectorAll('main .absolute.z-20.bottom-12')].some((d) => d.innerText.includes('Komponenta · Čep'))));
    ok(shown && (await ribbonBtn(p, 'Vlastnosti'))?.active === true, '#2 v sestavě: klik na komponentu ve stromu ukáže panel Vlastnosti (jak slibuje mikronávod)');
    await treeRow(p, 'Čep');
    await p.waitForTimeout(500);
    ok(!(await inspectPanel(p)), '#2 zrušení výběru ve stromu panel skryje');
  }

  if (want(3)) {
    await clickTab(p, 'Nástroje');
    const v = await ribbonBtn(p, 'Proměnné');
    const c = await ribbonBtn(p, 'Stavy dílu');
    ok(v?.disabled === true && c?.disabled === true, '#3 v sestavě jsou Proměnné a Stavy dílu neaktivní (důvod v mikronávodu)');
  }

  if (want(4)) {
    await clickTab(p, 'Nástroje');
    await clickRibbon(p, 'Filtr: Komponenta');
    ok(!(await menuHas(p, 'Prvek')), '#4 v sestavě filtr Prvek v nabídce není (choval by se jako Těleso)');
    await p.keyboard.press('Escape');
    await p.mouse.click(700, 700);
  }

  if (want(5)) {
    await clickTab(p, 'Zobrazení');
    ok(!!(await ribbonBtn(p, 'Barva komponent')), '#5 v sestavě se tlačítko jmenuje Barva komponent');
    await treeRow(p, 'Čep');
    await p.waitForTimeout(400);
    await clickRibbon(p, 'Barva komponent');
    await clickMenu(p, 'Červená');
    let cs = (await doc(p)).components.map((c) => [c.name, c.color]);
    ok(cs.find((x) => x[0] === 'Čep')[1] === '#e03930' && cs.find((x) => x[0] === 'Deska')[1] !== '#e03930', `#5 barva vybrané komponenty (${JSON.stringify(cs)})`);
    // výběr zrušit klikem do prázdného místa 3D okna
    const cv = await p.evaluate(() => { const r = document.querySelector('main canvas').getBoundingClientRect(); return { x: r.left + 60, y: r.top + 120 }; });
    await p.mouse.click(cv.x, cv.y);
    await p.waitForTimeout(500);
    await clickTab(p, 'Zobrazení');
    await clickRibbon(p, 'Barva komponent');
    await clickMenu(p, 'Modrá');
    cs = (await doc(p)).components.map((c) => c.color);
    ok(cs.every((c) => c === '#4f81bd'), `#5 bez výběru se obarví všechny komponenty (${JSON.stringify(cs)})`);
    await p.evaluate(() => window.mncad.undo(2));
    await p.waitForTimeout(500);
  }

  if (want(12)) {
    const fixed = (await doc(p)).components.find((c) => c.fixed);
    await treeRow(p, fixed.name);
    await p.waitForTimeout(500);
    await p.mouse.move(700, 500);
    await p.keyboard.press('g');
    await p.waitForTimeout(600);
    ok(!(await bodyHas(p, 'Přesun komponenty')) && (await bodyHas(p, 'Komponenta je ukotvená')), '#12 G u ukotvené komponenty gizmo neotevře a ohlásí ukotvení');
    ok(await p.evaluate(() => { const f = document.querySelector('[data-placement-locked]'); return !!f && f.disabled; }), '#12 pole Poloha / Natočení ukotvené komponenty jsou zamčená');
    await treeRow(p, 'Čep');
    await p.waitForTimeout(500);
    await p.mouse.move(700, 500);
    await p.keyboard.press('g');
    await p.waitForTimeout(600);
    ok(await bodyHas(p, 'Přesun komponenty'), '#12 G u volné komponenty gizmo otevře');
    await p.keyboard.press('g');
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('[data-placement-locked]')), '#12 volná komponenta má pole polohy odemčená');
  }

  if (want(8)) {
    await run(p, 'nový díl Kolík ze souboru\nválec 6 20');
    const exp = await p.evaluate(() => window.mncad.exportFile('mncad'));
    const file = path.join(S, 'kolik.mncad');
    fs.writeFileSync(file, Buffer.from(exp.base64, 'base64'));
    await p.evaluate(() => window.mncad.closeTab('Kolík ze souboru'));
    await p.evaluate(() => window.mncad.activateTab('Test'));
    await p.waitForTimeout(1500);
    await clickTab(p, 'Data');
    ok(!!(await ribbonBtn(p, 'Otevřít')) && !!(await ribbonBtn(p, 'Import do sestavy')), '#8 v sestavě má karta Data tlačítka Otevřít a Import do sestavy');
    const n0 = (await tabs(p)).length;
    const c0 = (await doc(p)).components.length;
    let fc = p.waitForEvent('filechooser', { timeout: 15000 });
    await clickRibbon(p, 'Otevřít');
    await (await fc).setFiles(file);
    await p.waitForTimeout(2500);
    const t1 = await tabs(p);
    ok(t1.length === n0 + 1 && t1.find((t) => t.active)?.title === 'Kolík ze souboru', '#8 Otevřít v sestavě otevře soubor v nové záložce');
    await p.evaluate(() => window.mncad.activateTab('Test'));
    await p.waitForTimeout(1500);
    ok((await doc(p)).components.length === c0, '#8 … a do sestavy nic nevložil');
    await clickTab(p, 'Data');
    fc = p.waitForEvent('filechooser', { timeout: 15000 });
    await clickRibbon(p, 'Import do sestavy');
    await (await fc).setFiles(file);
    await p.waitForTimeout(2500);
    const d = await doc(p);
    ok(d.kind === 'assembly' && d.components.length === c0 + 1 && (await tabs(p)).length === n0 + 1, '#8 Import do sestavy vloží komponentu (bez nové záložky)');
    await clickTab(p, 'Sestava');
    fc = p.waitForEvent('filechooser', { timeout: 15000 });
    await clickRibbon(p, 'Vložit díl / model');
    await (await fc).setFiles(file);
    await p.waitForTimeout(2500);
    ok((await doc(p)).components.length === c0 + 2, '#8 Vložit díl / model (karta Sestava) vkládá dál');
    // Otevřít DXF se stejným názvem jako otevřený dokument nesmí přepsat jeho záložku (dřív sestava → díl se skicou)
    const dxf = (n) => { const f = path.join(S, n); fs.writeFileSync(f, ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '30', '0', '11', '50', '21', '0', '31', '0', '0', 'LINE', '8', '0', '10', '50', '20', '0', '30', '0', '11', '50', '21', '30', '31', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n')); return f; };
    const asmBefore = await doc(p);
    const asmTab = (await tabs(p)).find((t) => t.active).id;
    const n1 = (await tabs(p)).length;
    fc = p.waitForEvent('filechooser', { timeout: 15000 });
    await clickTab(p, 'Data');
    await clickRibbon(p, 'Otevřít');
    await (await fc).setFiles(dxf(`${asmBefore.name}.dxf`));
    await p.waitForTimeout(2500);
    const t2 = await tabs(p);
    const act = await doc(p);
    // DXF / DWG se otevírá jako 2D výkres (vlna 9; do 3D skici jen volbou) – v nové záložce, sestava se nemění
    ok(t2.length === n1 + 1 && act.kind !== 'assembly' && (act.kind === 'draft' || (act.features || []).some((f) => f.type === 'sketch')), `#8 Otevřít ${asmBefore.name}.dxf v sestavě ${asmBefore.name}: 2D výkres v nové záložce (${n1} → ${t2.length}, ${act.kind})`);
    await p.evaluate((id) => window.mncad.activateTab(id), asmTab);
    await p.waitForTimeout(1500);
    const asmAfter = await doc(p);
    ok(asmAfter.kind === 'assembly' && asmAfter.components.length === asmBefore.components.length, `#8 sestava ${asmBefore.name} zůstala beze změny (${asmAfter.components.length} komponent)`);
    const partTab = (await tabs(p)).find((t) => t.title === 'Deska').id;
    await p.evaluate((id) => window.mncad.activateTab(id), partTab);
    await p.waitForTimeout(1500);
    const partBefore = (await doc(p)).features.map((f) => f.type);
    const n2 = (await tabs(p)).length;
    fc = p.waitForEvent('filechooser', { timeout: 15000 });
    await p.mouse.move(700, 500);
    await p.keyboard.press('Control+o');
    await (await fc).setFiles(dxf('Deska.dxf'));
    await p.waitForTimeout(2500);
    ok((await tabs(p)).length === n2 + 1, `#8 Ctrl+O Deska.dxf v dílu Deska otevře novou záložku (${n2} → ${(await tabs(p)).length})`);
    await p.evaluate((id) => window.mncad.activateTab(id), partTab);
    await p.waitForTimeout(1500);
    const partAfter = (await doc(p)).features.map((f) => f.type);
    ok(JSON.stringify(partAfter) === JSON.stringify(partBefore), `#8 díl Deska si nechal historii (${JSON.stringify(partAfter)})`);
    await p.evaluate((id) => window.mncad.activateTab(id), asmTab);
    await p.waitForTimeout(1500);
  }

  if (want(11)) {
    const g = (await doc(p)).components;
    await clickTab(p, 'Sestava');
    await clickRibbon(p, 'Středicí kroužek');
    await p.waitForTimeout(800);
    const ring = (await doc(p)).components.filter((c) => !g.some((x) => x.id === c.id));
    ok(ring.length === 1 && ring[0].group === 'Normálie', '#11 (cs) středicí kroužek ve skupině Normálie');
    // angličtina: skupina se ukládá česky (jako rám formy a knihovna), strom ji ukáže přeloženou a stejné skupiny sloučí
    const pe = await ctx.newPage();
    const dup = [];
    pe.on('pageerror', (e) => errs.push(e.message));
    pe.on('console', (m) => { if (/same key/.test(m.text())) dup.push(m.text().slice(0, 100)); });
    await open(pe, '/en/cad');
    const heads = () => pe.evaluate(() => [...document.querySelectorAll('aside button')].filter((x) => x.querySelector('span.font-mono')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((x) => !/VAZBY|MATES/i.test(x)));
    await run(pe, 'new assembly Groups');
    await clickTab(pe, 'Assembly');
    await clickRibbon(pe, 'Locating ring');
    await pe.waitForTimeout(800);
    await clickRibbon(pe, 'ISO 4762 screw');
    await clickMenu(pe, 'M8 × 20');
    await pe.waitForTimeout(800);
    await clickRibbon(pe, 'New part');
    await pe.waitForTimeout(1500);
    await pe.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '← Back to assembly'); b && b.click(); });
    await pe.waitForTimeout(1500);
    const asmDoc = await pe.evaluate(() => window.mncad.getDocument());
    ok(asmDoc.kind === 'assembly' && asmDoc.components.length === 3, `#11 Nový díl zůstane v sestavě i po „Zpět do sestavy“ (${asmDoc.components.length} komponenty)`);
    const groups = asmDoc.components.map((c) => c.group);
    ok(JSON.stringify(groups) === JSON.stringify(['Normálie', 'Normálie', 'Díly']), `#11 (en) skupiny uložené česky jako všude jinde: ${JSON.stringify(groups)}`);
    let hs = await heads();
    ok(JSON.stringify(hs) === JSON.stringify(['Standard parts 2', 'Parts 1']), `#11 (en) strom sestavy: Standard parts a Parts (${hs.join(' | ')})`);
    // dokument z EN UI otevřený v češtině: české názvy skupin
    const pc = await ctx.newPage();
    pc.on('pageerror', (e) => errs.push(e.message));
    await open(pc, '/cad');
    await pc.evaluate((d) => window.mncad.setDocument(d), { ...asmDoc, components: [...asmDoc.components, { ...asmDoc.components[0], id: 'legacy-en', name: 'Starý kroužek', group: 'Standard parts' }] });
    await pc.waitForTimeout(2500);
    const hc = await pc.evaluate(() => [...document.querySelectorAll('aside button')].filter((x) => x.querySelector('span.font-mono')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((x) => !/VAZBY|MATES/i.test(x)));
    ok(JSON.stringify(hc) === JSON.stringify(['Normálie 3', 'Díly 1']), `#11 (cs) tentýž dokument + starší skupina „Standard parts“: Normálie 3, Díly 1 (${hc.join(' | ')})`);
    await pc.close();
    // rám formy (české skupiny) + kroužek + import agentem i z karty Data: žádné zdvojené skupiny ani duplicitní klíče
    await run(pe, 'rám formy 246 296');
    await pe.waitForTimeout(3000);
    await clickTab(pe, 'Assembly');
    await clickRibbon(pe, 'Locating ring');
    await pe.waitForTimeout(1200);
    const mold = await pe.evaluate(() => window.mncad.getDocument());
    const pinFile = path.join(S, 'Pin.mncad');
    await run(pe, 'new part Pin\ncylinder 6 20');
    const pinExp = await pe.evaluate(() => window.mncad.exportFile('mncad'));
    fs.writeFileSync(pinFile, Buffer.from(pinExp.base64, 'base64'));
    await pe.evaluate(() => window.mncad.closeTab('Pin'));
    await pe.evaluate((n) => window.mncad.activateTab(n), mold.name);
    await pe.waitForTimeout(1500);
    await pe.evaluate((b64) => window.mncad.importFile({ name: 'Pin.mncad', base64: b64 }, { as: 'component' }), pinExp.base64);
    await pe.waitForTimeout(1500);
    await clickTab(pe, 'Data');
    const fc = pe.waitForEvent('filechooser', { timeout: 15000 });
    await clickRibbon(pe, 'Import into assembly');
    await (await fc).setFiles(pinFile);
    await pe.waitForTimeout(2500);
    const md = await pe.evaluate(() => window.mncad.getDocument());
    const mg = [...new Set(md.components.map((c) => c.group))];
    ok(mg.every((x) => ['Desky', 'Vyhazování', 'Normálie', 'Vedení', 'Díly'].includes(x)), `#11 (en) rám formy + kroužek + 2× import: jen české skupiny (${mg.join(', ')})`);
    hs = await heads();
    const labels = hs.map((x) => x.replace(/ \d+$/, ''));
    ok(new Set(labels).size === labels.length && labels.includes('Standard parts') && labels.includes('Parts'), `#11 (en) strom bez zdvojených skupin (${hs.join(' | ')})`);
    const nParts = md.components.filter((c) => c.group === 'Díly').length;
    ok(nParts >= 2 && hs.includes(`Parts ${nParts}`), `#11 (en) import agentem i z karty Data v jedné skupině Parts ${nParts} (${hs.join(' | ')})`);
    ok(!dup.length, `#11 bez varování Reactu o duplicitních klíčích (${dup.length})`);
    await pe.close();
  }

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await p.screenshot({ path: S + 'w13-ui-end.png' });
  await b.close();
})().catch((e) => { console.error('FAIL: výjimka', e); process.exit(1); });
