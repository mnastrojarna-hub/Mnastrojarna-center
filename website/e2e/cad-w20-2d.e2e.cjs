// E2E W20 – výběr oknem ve 2D skutečným tažením myší (Playwright mouse.down / move / up) a dotykem (CDP):
//   2D výkres (draft), skica a výkres dílu. Okno zleva doprava = celé uvnitř, zprava doleva = křížení; bez modifikátoru
//   nahradí (ve výzvě „Vyberte objekty“ přidá), Ctrl / Shift přidá, Ctrl+Shift / Alt odebere, Esc zruší jen okno.
// Spuštění: E2E_BASE=http://localhost:3492 node e2e/cad-w20-2d.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w20-2d').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const J = (x) => JSON.stringify(x);
const sorted = (a) => [...a].sort();

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  await start(p);

  /** tažení levým tlačítkem z bodu do bodu (obrazovka) v krocích; volitelně modifikátory, Esc před puštěním, snímek */
  const dragPx = async (x0, y0, x1, y1, opt = {}) => {
    for (const m of opt.mods || []) await p.keyboard.down(m);
    await p.mouse.move(x0, y0); await p.mouse.down({ button: opt.button || 'left' });
    for (let i = 1; i <= 8; i++) { await p.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8); await p.waitForTimeout(25); }
    if (opt.mid) await opt.mid();
    if (opt.shot) await p.screenshot({ path: S + opt.shot });
    if (opt.esc) { await p.keyboard.press('Escape'); await p.waitForTimeout(80); }
    await p.mouse.up({ button: opt.button || 'left' });
    for (const m of [...(opt.mods || [])].reverse()) await p.keyboard.up(m);
    await p.waitForTimeout(opt.wait ?? 300);
  };
  /** klik levým tlačítkem s modifikátory (najetí před klikem jako skutečná myš) */
  const clickPx = async (x, y, mods = [], wait = 250) => {
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(x - 2, y + 2); await p.mouse.move(x, y);
    await p.mouse.click(x, y);
    for (const m of [...mods].reverse()) await p.keyboard.up(m);
    await p.waitForTimeout(wait);
  };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: Math.round(q[0]), y: Math.round(q[1]), id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  /** dotyk jedním prstem: podržet `hold` ms, pak táhnout */
  const touchDrag = async (x0, y0, x1, y1, hold) => {
    await touch('touchStart', [[x0, y0]]);
    await p.waitForTimeout(hold);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8]]); await p.waitForTimeout(30); }
    await touch('touchEnd', []);
    await p.waitForTimeout(350);
  };

  // ═══════════════════════════════ 1. 2D výkres ═══════════════════════════════
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.mncad.run('2d nový W20'));
  await p.waitForSelector('[data-draft-workspace]', { timeout: 90000 });
  await p.waitForTimeout(800);
  // e1..e3 kružnice, e4 dlouhá úsečka pod nimi, e5..e64 hustá mřížka svislých úseček (rozteč 1 mm)
  let script = 'kružnice 10,10 5; kružnice 30,10 5; kružnice 50,10 5; čára -20,-10 80,-10';
  for (let i = 0; i < 60; i++) script += `; čára ${100 + i},0 ${100 + i},40`;
  let r = await p.evaluate((s) => window.mncad.draft(s), script);
  ok(r.ok && r.status.entities === 64, `výchozí geometrie: 3 kružnice, úsečka, mřížka 60 úseček (${r.status.entities})`);
  await p.evaluate(() => window.mncad.draft('zoom okno -30,-30 170,60'));
  await p.waitForTimeout(500);
  const dbox = await p.locator('[data-draft-canvas]').boundingBox();
  const view = async () => JSON.parse(await p.getAttribute('[data-draft-canvas]', 'data-view'));
  const scr = async (X, Y) => { const v = await view(); return [dbox.x + (X - v.cx) * v.scale + v.w / 2, dbox.y + v.h / 2 - (Y - v.cy) * v.scale]; };
  const sel = async () => sorted((await p.evaluate(() => window.mncad.draft('stav'))).status.selection);
  const clear = async () => { await p.evaluate(() => window.mncad.draft('vyber nic')); await p.waitForTimeout(150); };
  const dragW = async (A, B, opt) => { const [x0, y0] = await scr(...A); const [x1, y1] = await scr(...B); await dragPx(x0, y0, x1, y1, opt); };
  const prompt = () => p.textContent('[data-draft-prompt]');
  const ents = async () => (await p.evaluate(() => window.mncad.getDocument())).draft.entities.map((e) => e.id);

  // okno zleva doprava z prázdného místa: jen celé kružnice; během tažení počítadlo u okna
  await clear();
  let live = null;
  await dragW([3, 22], [37, -2], { shot: 'w20-draft-window.png', mid: async () => { live = await p.getAttribute('[data-draft-canvas]', 'data-boxsel-live'); } });
  ok(J(await sel()) === J(['e1', 'e2']), `okno zleva doprava vybere celé e1, e2 (${J(await sel())}), počítadlo během tažení ${live}`);
  ok(live === '2', `živé počítadlo u okna během tažení = 2 (${live})`);
  // křížení zprava doleva: kružnice e3 a dlouhá úsečka e4 bez koncového bodu v okně
  await clear();
  await dragW([56, 6], [44, -14], { shot: 'w20-draft-crossing.png' });
  ok(J(await sel()) === J(['e3', 'e4']), `křížení zprava doleva vybere e3 i protnutou e4 (${J(await sel())})`);
  // stisk PŘÍMO na úsečce husté mřížky a tažení = okno (dřív se jen vybrala ta jedna úsečka)
  await clear();
  await dragW([130.3, 30], [110.3, 10]);
  let s = await sel();
  ok(s.length === 20 && s.every((id) => +id.slice(1) >= 16 && +id.slice(1) <= 35), `tažení ze stisku na entitě husté mřížky = křížení: 20 úseček x 111…130 (e16…e35) (${s.length}: ${s.slice(0, 3).join(',')}…)`);
  // bez modifikátoru nahradí, Ctrl přidá, Shift přidá, Ctrl+Shift odebere, Alt odebere
  await clear();
  await dragW([3, 22], [17, -2]);
  await dragW([23, 22], [37, -2]);
  ok(J(await sel()) === J(['e2']), `druhé okno bez modifikátoru výběr nahradí (${J(await sel())})`);
  await dragW([3, 22], [17, -2], { mods: ['Control'] });
  ok(J(await sel()) === J(['e1', 'e2']), `Ctrl + okno přidá (${J(await sel())})`);
  await dragW([43, 22], [57, -2], { mods: ['Shift'] });
  ok(J(await sel()) === J(['e1', 'e2', 'e3']), `Shift + okno přidá (${J(await sel())})`);
  await dragW([23, 22], [37, -2], { mods: ['Control', 'Shift'] });
  ok(J(await sel()) === J(['e1', 'e3']), `Ctrl+Shift + okno odebere (${J(await sel())})`);
  await dragW([3, 22], [17, -2], { mods: ['Alt'] });
  ok(J(await sel()) === J(['e3']), `Alt + okno odebere (${J(await sel())})`);
  // Esc během tažení: okno zmizí, výběr zůstane
  await dragW([3, 22], [37, -2], { esc: true });
  ok(J(await sel()) === J(['e3']), `Esc během tažení zruší jen okno, výběr zůstane (${J(await sel())})`);
  // klik: nahradí, Shift + klik přepne
  const clickW = async (X, Y, mods = []) => { const [x, y] = await scr(X, Y); for (const m of mods) await p.keyboard.down(m); await p.mouse.move(x - 2, y + 2); await p.mouse.move(x, y); await p.mouse.click(x, y); for (const m of mods) await p.keyboard.up(m); await p.waitForTimeout(250); };
  await clickW(15, 10);
  ok(J(await sel()) === J(['e1']), `klik na kružnici výběr nahradí (${J(await sel())})`);
  await clickW(35, 10, ['Shift']);
  await clickW(15, 10, ['Shift']);
  ok(J(await sel()) === J(['e2']), `Shift + klik přepíná: přidá e2, odebere e1 (${J(await sel())})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok((await sel()).length === 0, 'Esc bez okna výběr zruší');
  // klik do prázdna, druhý klik = okno dvěma kliky (AutoCAD)
  await clickW(3, 22); await clickW(17, -2);
  ok(J(await sel()) === J(['e1']), `klik do prázdna + druhý klik = okno dvěma kliky (${J(await sel())})`);
  await clear();

  // nález W20-2d: Alt (odebrat) na úchopu vybrané entity úchop nechytí – klik odebere, tažení odebírá křížením
  const ent = async (id) => (await p.evaluate(() => window.mncad.getDocument())).draft.entities.find((e) => e.id === id);
  const idle = async () => /Příkaz/.test(await prompt());
  await clickW(10, -10);
  const e4a = await ent('e4');
  await clickW(30, -10, ['Alt']); // střed úsečky = úchop
  ok(J(await sel()) === J([]) && (await idle()), `Alt + klik na úchopu (střed) vybrané e4 ji odebere, žádné PROTÁHNOUT (${J(await sel())}, „${await prompt()}“)`);
  await clickW(30, 25); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(J(await ent('e4')) === J(e4a), 'další obyčejný klik e4 nepřesune');
  await clickW(10, -10);
  await dragW([80, -10], [60, 5], { mods: ['Alt'] }); // z koncového úchopu zprava doleva = křížení, odebere
  ok(J(await sel()) === J([]) && J(await ent('e4')) === J(e4a), `Alt + tažení z koncového úchopu vybrané e4 = odebrání křížením, e4 se neprotáhne (${J(await sel())})`);
  await clickW(10, -10);
  await clickW(30, -10, ['Control', 'Shift']);
  ok(J(await sel()) === J([]) && (await idle()), `Ctrl+Shift + klik na úchopu vybrané e4 ji odebere (${J(await sel())})`);
  await clickW(10, -10);
  await clickW(30, -10);
  ok(/PROTÁHNOUT/.test(await prompt()), `obyčejný klik na úchop vybrané entity dál začne úpravu úchopem („${await prompt()}“)`);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(J(await ent('e4')) === J(e4a), 'Esc úpravu úchopem zruší, e4 beze změny');
  // nález W20-2d: Esc po stisku, ale před posunem o 5 px – stisk se zruší (žádné okno), výběr zůstane
  await clear();
  await clickW(13.54, 13.54);
  ok(J(await sel()) === J(['e1']), `klik vybere e1 (${J(await sel())})`);
  {
    const [ax, ay] = await scr(43, 22);
    await p.mouse.move(ax, ay); await p.mouse.down();
    await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    for (let i = 1; i <= 8; i++) { const [x, y] = await scr(43 + (14 * i) / 8, 22 - (24 * i) / 8); await p.mouse.move(x, y); await p.waitForTimeout(25); }
    await p.mouse.up(); await p.waitForTimeout(300);
  }
  ok(J(await sel()) === J(['e1']), `Esc v mrtvé zóně stisku: okno nevznikne a výběr e1 zůstane (${J(await sel())})`);
  await clickW(43, 22); await clickW(57, -2);
  ok(J(await sel()) === J(['e3']), `potom klik + klik = okno dvěma kliky normálně funguje (${J(await sel())})`);
  await clear();

  // SMAZAT: výzva „Vyberte objekty“ – okna se sčítají, Esc v okně nezruší příkaz, Enter smaže
  await p.keyboard.type('smazat'); await p.keyboard.press('Space'); await p.waitForTimeout(300);
  ok(/Vyberte objekty/.test(await prompt()) && /Okno/.test(await prompt()), `SMAZAT: výzva s volbami Okno/Křížení („${await prompt()}“)`);
  await dragW([3, 22], [17, -2]);
  await dragW([23, 22], [37, -2]);
  ok(J(await sel()) === J(['e1', 'e2']), `ve výzvě výběru se okna sčítají (${J(await sel())})`);
  await dragW([43, 22], [57, -2], { esc: true });
  ok(/Vyberte objekty/.test(await prompt()) && J(await sel()) === J(['e1', 'e2']), `Esc během okna ve výzvě: příkaz běží dál, výběr e1, e2 („${await prompt()}“)`);
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  let E = await ents();
  ok(!E.includes('e1') && !E.includes('e2') && E.includes('e3'), `Enter: SMAZAT smazal e1, e2 (${E.length} entit)`);
  await p.evaluate(() => window.mncad.run('2d zpět')); await p.waitForTimeout(400);
  ok((await ents()).includes('e1'), 'zpět vrátí smazané');
  await clear();

  // volby o (Okno) a k (Křížení) dvěma kliky – směr pak nerozhoduje
  await p.keyboard.type('smazat'); await p.keyboard.press('Space'); await p.waitForTimeout(300);
  await p.keyboard.type('o'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const histTxt = () => p.evaluate(() => document.querySelector('[data-draft-cmdline]')?.innerText || '');
  ok(/Okno – klikněte na první roh/.test(await histTxt()) && !/nadbytečné/.test(await histTxt()), 'o ve výzvě výběru: „Okno – klikněte na první roh“');
  await clickW(57, -2); await clickW(43, 22); // zprava doleva, ale vynucené okno → jen e3 (ne e4)
  ok(J(await sel()) === J(['e3']), `o + dva kliky zprava doleva = okno: jen e3 (${J(await sel())})`);
  await p.locator('[data-kw="crossing"]').first().click(); await p.waitForTimeout(250);
  await clickW(25, 7); await clickW(35, -12); // zleva doprava, ale vynucené křížení → e2 a e4
  ok(J(await sel()) === J(['e2', 'e3', 'e4']), `tlačítko Křížení + dva kliky zleva doprava = křížení: přidá e2, e4 (${J(await sel())})`);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await clear();
  r = await p.evaluate(() => window.mncad.draft('vyber o 3,22 37,-2; stav'));
  ok(r.ok && J(sorted(r.status.selection)) === J(['e1', 'e2']), `text: vyber o x,y x,y (${J(r.status.selection)})`);
  r = await p.evaluate(() => window.mncad.draft('vyber nic; vyber k 56,6 44,-14; stav'));
  ok(r.ok && J(sorted(r.status.selection)) === J(['e3', 'e4']), `text: vyber k x,y x,y (${J(r.status.selection)})`);
  await clear();

  // dotyk: dlouhý stisk a tažení = okno (pohled se neposune); krátké tažení prstem dál posouvá
  const v0 = await view();
  let [tx0, ty0] = await scr(3, 22); let [tx1, ty1] = await scr(37, -2);
  await touchDrag(tx0, ty0, tx1, ty1, 700);
  const v1 = await view();
  ok(J(await sel()) === J(['e1', 'e2']) && v1.cx === v0.cx && v1.cy === v0.cy, `dotyk: dlouhý stisk + tažení = okno e1, e2, pohled stojí (${J(await sel())}, Δcx ${(v1.cx - v0.cx).toFixed(3)})`);
  await touchDrag(tx0, ty0, tx0 + 120, ty0 + 40, 60);
  const v2 = await view();
  ok(Math.abs(v2.cx - v1.cx) > 1 && J(await sel()) === J(['e1', 'e2']), `dotyk: rychlé tažení prstem posune pohled (Δcx ${(v2.cx - v1.cx).toFixed(1)} mm), výběr beze změny`);
  await p.evaluate(() => window.mncad.draft('zoom okno -30,-30 170,60')); await p.waitForTimeout(400);

  // výkon: 10 000 entit, okno přes všechno skutečným tažením < 200 ms (výběr + vykreslení zvýraznění)
  await p.evaluate(() => window.mncad.draft('vyber vše; smazat výběr'));
  const big = [];
  for (let i = 0; i < 10000; i++) { const x = (i % 100) * 3, y = Math.floor(i / 100) * 3; big.push(`čára ${x},${y} ${x + 2},${y + 2}`); }
  await p.evaluate((t) => window.mncad.draft(t), big.join('; '));
  await p.evaluate(() => window.mncad.draft('zoom okno -20,-20 320,320')); await p.waitForTimeout(800);
  await clear();
  await dragW([-10, 310], [310, -10], { wait: 900 });
  const bs = JSON.parse((await p.getAttribute('[data-draft-canvas]', 'data-boxsel')) || '{}');
  const n10 = (await sel()).length;
  ok(n10 >= 10000 && bs.n === n10 && bs.total < 200, `10 000 entit: okno vybere ${n10}, výběr ${bs.ms} ms, do vykreslení ${bs.total} ms (< 200)`);
  await p.screenshot({ path: S + 'w20-draft-10k.png' });

  // ═══════════════════════════════ 2. skica ═══════════════════════════════
  await p.evaluate(() => window.mncad.run('nový díl W20Skica'));
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape');
  await p.keyboard.press('s');
  const xy = p.getByRole('button', { name: /Rovina XY/ }).first();
  if (await xy.isVisible({ timeout: 3000 }).catch(() => false)) await xy.click();
  await p.waitForSelector('[data-sketch-canvas]', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => window.mncad.run('úsečka 0 0 60 0\núsečka -20 30 80 30\nkružnice 10 v 10 15\nkružnice 10 v 50 15\nbod 30 15'));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.keyboard.press('f'); await p.waitForTimeout(500);
  const sb = await p.locator('[data-sketch-canvas]').boundingBox();
  const sat = async (X, Y) => { const [cx, cy, sc, w, h] = (await p.getAttribute('[data-sketch-canvas]', 'data-view')).split(' ').map(Number); return [sb.x + w / 2 + (X - cx) * sc, sb.y + h / 2 - (Y - cy) * sc]; };
  const ssel = async () => sorted(((await p.getAttribute('[data-sketch-canvas]', 'data-sel')) || '').split(' ').filter(Boolean));
  const sk = async () => { const d = await p.evaluate(() => window.mncad.getDocument()); return d.features.filter((f) => f.type === 'sketch').pop(); };
  const ids = (await sk()).entities.map((e) => `${e.id}:${e.type}`);
  ok(ids.length === 5, `skica: 2 úsečky, 2 kružnice, bod (${ids.join(' ')})`);
  const [L1, L2, C1, C2, P1] = (await sk()).entities.map((e) => e.id);
  const dragS = async (A, B, opt) => { const [x0, y0] = await sat(...A); const [x1, y1] = await sat(...B); await dragPx(x0, y0, x1, y1, opt); };
  await dragS([-5, 0.5 + 2], [25, 25], { shot: 'w20-sketch-window.png' });
  ok(J(await ssel()) === J([C1]), `skica: okno zleva doprava vybere celou kružnici (${J(await ssel())})`);
  await dragS([55, 33], [5, 27], { shot: 'w20-sketch-crossing.png' });
  ok(J(await ssel()) === J([L2]), `skica: křížení zprava doleva vybere úsečku bez vrcholu v okně (${J(await ssel())})`);
  await dragS([35, 2], [65, 25], { mods: ['Control'] });
  ok(J(await ssel()) === J(sorted([L2, C2])), `skica: Ctrl + okno přidá (${J(await ssel())})`);
  await dragS([35, 2], [65, 25], { mods: ['Control', 'Shift'] });
  ok(J(await ssel()) === J([L2]), `skica: Ctrl+Shift + okno odebere (${J(await ssel())})`);
  await dragS([-5, 2], [65, 25], { esc: true });
  ok(J(await ssel()) === J([L2]), `skica: Esc během tažení zruší okno, výběr zůstane (${J(await ssel())})`);
  // nález W20-2d: klik s modifikátory jako ve 2D výkresu – Ctrl/Shift přepne, Ctrl+Shift / Alt jen odebere (i na úchopu)
  const clickS = async (X, Y, mods = []) => { const [x, y] = await sat(X, Y); await clickPx(x, y, mods, 700); };
  const d45 = 5 / Math.SQRT2;
  await dragS([-5, 2], [65, 28]);
  ok(J(await ssel()) === J(sorted([C1, C2, P1])), `skica: okno vybere obě kružnice a bod (${J(await ssel())})`);
  await clickS(10 + d45, 15 + d45, ['Alt']);
  ok(J(await ssel()) === J(sorted([C2, P1])), `skica: Alt + klik na vybranou kružnici ji odebere (${J(await ssel())})`);
  await clickS(45, 30, ['Alt']);
  ok(J(await ssel()) === J(sorted([C2, P1])), `skica: Alt + klik na nevybranou úsečku výběr nezmění (${J(await ssel())})`);
  await clickS(10 + d45, 15 + d45, ['Control', 'Shift']);
  ok(J(await ssel()) === J(sorted([C2, P1])), `skica: Ctrl+Shift + klik na nevybranou kružnici ji nepřidá (${J(await ssel())})`);
  await clickS(50 + d45, 15 + d45, ['Control', 'Shift']);
  ok(J(await ssel()) === J([P1]), `skica: Ctrl+Shift + klik na vybranou kružnici ji odebere (${J(await ssel())})`);
  await clickS(45, 30, ['Shift']);
  ok(J(await ssel()) === J(sorted([L2, P1])), `skica: Shift + klik přidá úsečku (${J(await ssel())})`);
  await clickS(30, 0, ['Shift']);
  ok(J(await ssel()) === J(sorted([L1, L2, P1])), `skica: Shift + klik přidá druhou úsečku (${J(await ssel())})`);
  const l1a = (await sk()).entities.find((e) => e.id === L1);
  await clickS(60, 0, ['Alt']); // koncový bod vybrané úsečky = úchyt (pravý konec L2 zakrývá panel vlastností)
  const l1b = (await sk()).entities.find((e) => e.id === L1);
  ok(J(await ssel()) === J(sorted([L2, P1])) && J(l1a) === J(l1b), `skica: Alt + klik na úchytu vybrané úsečky ji odebere, úchyt se nechytí (${J(await ssel())})`);
  await dragS([25, 10], [35, 20]);
  ok(J(await ssel()) === J([P1]), `skica: okno vybere bod skici (${J(await ssel())})`);
  // nástroj Přesunout: fáze výběru oknem (přidává), Enter → další krok
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const clicked = await p.evaluate(() => { const bt = [...document.querySelectorAll('button')].find((x) => /^Přesunout/.test((x.textContent || '').trim())); if (bt) bt.click(); return !!bt; });
  await p.waitForTimeout(300);
  if (clicked && (await p.getAttribute('[data-sketch-canvas]', 'data-tool')) === 'move') {
    await dragS([-5, 2], [25, 25]);
    await dragS([35, 2], [65, 25]);
    const pr = await p.evaluate(() => document.querySelector('[data-sketch-canvas]')?.parentElement?.innerText || '');
    ok(J(await ssel()) === J(sorted([C1, C2])) && /Vybráno 2/.test(pr), `skica, Přesunout: dvě okna se sečtou (${J(await ssel())})`);
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  } else ok(false, 'skica: tlačítko Přesunout nenalezeno');
  // dotyk: tažení jedním prstem z prázdna = okno
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  [tx0, ty0] = await sat(-5, 2); [tx1, ty1] = await sat(25, 25);
  await touchDrag(tx0, ty0, tx1, ty1, 80);
  ok(J(await ssel()) === J([C1]), `skica: dotyk – tažení prstem z prázdna = okno (${J(await ssel())})`);
  await dragS([-5, 2], [65, 25]);
  ok(J(await ssel()) === J(sorted([C1, C2, P1])) && (await p.textContent('[data-sketch-selcount]').catch(() => '')).includes('3'), `skica: okno přes obě kružnice a bod, „vybráno 3“ (${J(await ssel())})`);
  await p.keyboard.press('Delete'); await p.waitForTimeout(500);
  ok((await sk()).entities.length === 2, `skica: Delete smaže celý výběr oknem (zbývá ${(await sk()).entities.length})`);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ═══════════════════════════════ 3. výkres dílu ═══════════════════════════════
  await p.evaluate(() => window.mncad.run('nový díl W20Vykres\nkvádr 80 50 20\nvýkres\nvýkres značka text "AAA" v 40 40\nvýkres značka text "BBB" v 80 40\nvýkres značka text "CCC" v 120 40'));
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  const anns = async () => { const d = await p.evaluate(() => window.mncad.getDocument()); return (d.drawings || []).flatMap((x) => x.annotations || []); };
  const tpos = (txt) => p.evaluate((t) => { const el = [...document.querySelectorAll('[data-sheet] > div svg text')].find((x) => x.textContent === t); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, txt);
  const dsel = async () => Number((await p.getAttribute('[data-ann-selection]', 'data-ann-selection').catch(() => null)) || 0);
  const tf = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div')].map((d) => d.style.transform).join('|'));
  const a0 = await anns();
  const A = await tpos('AAA'); const B = await tpos('BBB');
  ok(a0.length >= 6 && A && B, `výkres: ${a0.length} poznámek a kót (3 texty + chytré kóty)`);
  const tf0 = await tf();
  await dragPx(A.x - 30, A.y - 25, B.x + 35, B.y + 25, { shot: 'w20-drawing-window.png' });
  ok((await tf()) === tf0 && (await dsel()) === 2, `výkres: levé tažení = okno, vybere AAA a BBB (${await dsel()}), list se neposunul`);
  const rows = await p.locator('[data-ann-selected]').count();
  ok(rows === 2, `výkres: seznam poznámek ukazuje 2 vybrané řádky (${rows})`);
  // Ctrl + klik na CCC přidá
  const C = await tpos('CCC');
  await p.keyboard.down('Control'); await p.mouse.click(C.x, C.y); await p.keyboard.up('Control'); await p.waitForTimeout(300);
  ok((await dsel()) === 3, `výkres: Ctrl + klik přidá CCC (${await dsel()})`);
  // Ctrl+Shift + okno odebere AAA
  await dragPx(A.x - 30, A.y - 25, A.x + 30, A.y + 25, { mods: ['Control', 'Shift'] });
  ok((await dsel()) === 2, `výkres: Ctrl+Shift + okno odebere AAA (${await dsel()})`);
  // tažení vybrané poznámky = posun (BBB, CCC o 40 px doprava)
  const ccc0 = (await anns()).find((a) => a.text === 'CCC').at;
  const B2 = await tpos('BBB');
  await dragPx(B2.x, B2.y, B2.x + 40, B2.y, { wait: 900 });
  const after = await anns();
  const ccc1 = after.find((a) => a.text === 'CCC').at;
  const aaa = after.find((a) => a.text === 'AAA').at;
  ok(ccc1[0] > ccc0[0] + 1 && Math.abs(ccc1[1] - ccc0[1]) < 0.5 && J(aaa) === J(a0.find((a) => a.text === 'AAA').at), `výkres: tažení vybrané poznámky posune BBB i CCC (CCC x ${ccc0[0]} → ${ccc1[0]}), AAA zůstane`);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(600);
  const ccc2 = (await anns()).find((a) => a.text === 'CCC').at;
  ok(Math.abs(Math.abs(ccc2[1] - ccc1[1]) - 1) < 0.05, `výkres: šipka posune vybrané o 1 mm (y ${ccc1[1]} → ${ccc2[1]})`);
  // křížení zprava doleva přes kóty
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok((await dsel()) === 0 && (await p.locator('[data-sheet]').count()) === 1, 'výkres: Esc zruší výběr, pracovní plocha zůstane otevřená');
  const sheet = await p.locator('[data-sheet] > div.origin-top-left').first().boundingBox(); // papír listu
  await dragPx(sheet.x + sheet.width * 0.92, sheet.y + sheet.height * 0.92, sheet.x + sheet.width * 0.03, sheet.y + sheet.height * 0.03, { shot: 'w20-drawing-crossing.png' });
  const nCross = await dsel();
  ok(nCross === a0.length, `výkres: křížení přes celý list vybere všechny kóty i texty (${nCross} z ${a0.length})`);
  await p.keyboard.press('Delete'); await p.waitForTimeout(800);
  const left = await anns();
  ok(left.length === a0.length - nCross, `výkres: Delete smaže všech ${nCross} vybraných (zbývá ${left.length} z ${a0.length})`);
  // posun listu: prostřední a pravé tlačítko; Esc během okna
  const tf1 = await tf();
  await dragPx(sheet.x + 200, sheet.y + 200, sheet.x + 260, sheet.y + 230, { button: 'middle' });
  const tf2 = await tf();
  await dragPx(sheet.x + 200, sheet.y + 200, sheet.x + 140, sheet.y + 170, { button: 'right' });
  const tf3 = await tf();
  ok(tf1 !== tf2 && tf2 !== tf3, 'výkres: prostřední i pravé tlačítko posouvají list');
  await dragPx(sheet.x + 300, sheet.y + 300, sheet.x + 500, sheet.y + 400, { esc: true });
  ok((await dsel()) === 0 && (await p.locator('[data-sheet]').count()) === 1, 'výkres: Esc během okna okno zruší (nic nevybráno, výkres otevřený)');

  // ═══════════════════════════════ 4. výkres sestavy ═══════════════════════════════
  // nález W20-2d: vygenerované kóty celkových rozměrů a pozice (balónky) jdou vybrat klikem / oknem, Delete je skryje,
  // tažení posune, „Obnovit vygenerované“ je vrátí
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.evaluate(() => window.mncad.run('nový díl Deska\nkvádr 100 60 10\nnový díl Čep\nválec 10 30'));
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.mncad.run('nová sestava S21\nvložit "Deska" ukotvit\nvložit "Čep" v 20 20 10\nvýkres'));
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || '') && [...document.querySelectorAll('[data-sheet] > div svg text')].some((x) => x.textContent === '100'), null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  const gsel = async () => ((await p.getAttribute('[data-ann-selection]', 'data-ann-sel-ids').catch(() => null)) || '').split(' ').filter(Boolean).sort();
  const sheetOpts = async () => (await p.evaluate(() => window.mncad.getDocument())).drawings?.[0]?.options || {};
  const T100 = await tpos('100');
  ok(!!T100, 'výkres sestavy: kóta celkového rozměru „100“ je na listu');
  // křížení začíná v prázdnu nad kótou (stisk na kótě by ji táhl – posun) a končí na jejím textu
  await dragPx(T100.x + 30, T100.y - 25, T100.x - 30, T100.y + 2, { shot: 'w20-asm-crossing.png' });
  const g1 = await gsel();
  ok(g1.length === 1 && /^gen:dim:/.test(g1[0]) && !(await sheetOpts()).genEdit, `výkres sestavy: křížení přes text kóty „100“ ji vybere, nic se neposune (${J(g1)})`);
  await clickPx(T100.x, T100.y);
  ok(J(await gsel()) === J(g1), `výkres sestavy: klik na „100“ vybere tutéž kótu (${J(await gsel())})`);
  const ball = async (n) => p.evaluate((t) => { const el = [...document.querySelectorAll('[data-sheet] > div svg text')].find((x) => x.textContent === t && x.getAttribute('font-weight') === '700' && x.getAttribute('font-size') === '3.5'); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, String(n));
  const B1 = await ball(1);
  ok(!!B1, 'výkres sestavy: balónek pozice 1 je na listu');
  await clickPx(B1.x, B1.y, ['Control']);
  ok(J(await gsel()) === J(sorted([g1[0], 'gen:pos:1'])), `výkres sestavy: Ctrl + klik na balónek 1 ho přidá (${J(await gsel())})`);
  await clickPx(B1.x, B1.y);
  ok(J(await gsel()) === J(['gen:pos:1']), `výkres sestavy: klik na balónek vybere jen jeho (${J(await gsel())})`);
  // tažení balónku = posun (přepočet výkresu s genEdit.move)
  await dragPx(B1.x, B1.y, B1.x + 60, B1.y, { wait: 2500 });
  const o1 = await sheetOpts();
  const B1b = await ball(1);
  ok(o1.genEdit?.move?.['pos:1']?.[0] > 1 && B1b && B1b.x > B1.x + 30, `výkres sestavy: tažení balónku ho posune (genEdit ${J(o1.genEdit)}, x ${B1.x.toFixed(0)} → ${B1b?.x.toFixed(0)})`);
  // Delete skryje vybranou kótu (klik), Obnovit vrátí obojí
  await clickPx(T100.x, T100.y);
  await p.keyboard.press('Delete'); await p.waitForTimeout(2500);
  const o2 = await sheetOpts();
  ok((o2.genEdit?.off || []).length === 1 && !(await tpos('100')), `výkres sestavy: Delete skryje vybranou kótu „100“ (${J(o2.genEdit)})`);
  const rb = p.locator('[data-gen-restore]');
  ok((await rb.count()) === 1 && /\(2\)/.test(await rb.textContent()), `výkres sestavy: tlačítko „Obnovit vygenerované kóty a pozice (2)“ (${await rb.textContent().catch(() => '')})`);
  await rb.click(); await p.waitForTimeout(2500);
  const B1c = await ball(1);
  ok(!(await sheetOpts()).genEdit && !!(await tpos('100')) && B1c && Math.abs(B1c.x - B1.x) < 3, 'výkres sestavy: Obnovit vrátí kótu i balónek na výchozí místo');
  // okno kolem balónku vybere jen balónek (odkazová čára se do tvaru nepočítá)
  await dragPx(B1c.x - 22, B1c.y - 22, B1c.x + 22, B1c.y + 22);
  ok(J(await gsel()) === J(['gen:pos:1']), `výkres sestavy: okno kolem balónku 1 vybere jen jeho (${J(await gsel())})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
