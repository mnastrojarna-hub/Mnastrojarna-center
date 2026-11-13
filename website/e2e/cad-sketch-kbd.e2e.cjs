// E2E: skica zadaná z klávesnice (body psané souřadnicemi se kotví vazbou „Pevně“, pohled se sám přizpůsobí, živý náhled
// spline, seznam souřadnic ze schránky Ctrl+V a z dialogu „Body ze seznamu“) a podklad skici (obrázek / stránka PDF pod
// geometrií: krytí, skrytí, kalibrace měřítka dvěma body, posun tažením, natočení, šířka, stránka PDF 1:1, změna stránky,
// převod vektorových čar PDF na entity, obrázek ze schránky, chování bez čtečky PDF).
// Spuštění: E2E_BASE=http://localhost:3201 node e2e/cad-sketch-kbd.e2e.cjs <složka>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const conErrs = []; p.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GL Driver|favicon|Failed to load resource/.test(m.text())) conErrs.push(m.text().slice(0, 300)); });
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await start(p);

  // ── pomocníci ──
  const canvas = () => p.locator('[data-sketch-canvas]').boundingBox();
  const tool = () => p.getAttribute('[data-sketch-canvas]', 'data-tool');
  const hints = () => p.evaluate(() => window.mncad.hints());
  const docOf = () => p.evaluate(() => window.mncad.getDocument());
  const sketch = async () => (await docOf()).features.filter((f) => f.type === 'sketch').pop();
  const ents = async (type) => (await sketch()).entities.filter((e) => !type || e.type === type);
  const cons = async (type) => ((await sketch()).constraints || []).filter((c) => !type || c.type === type);
  const flash = async () => (await p.locator('div.pointer-events-none.absolute.left-1\\/2.top-14').first().textContent({ timeout: 1500 }).catch(() => '')) || '';
  const statusText = () => p.evaluate(() => [...document.querySelectorAll('span')].map((s) => s.textContent || '').find((t) => /^(Plně určeno|Nedourčeno|Přeurčeno|Fully|Under|Over)/.test(t.trim())) || '');
  const waitStatus = async (re) => { await p.waitForFunction((src) => [...document.querySelectorAll('span')].some((s) => new RegExp(src).test((s.textContent || '').trim())), re.source, { timeout: 6000 }).catch(() => {}); return statusText(); };
  const typeEnter = async (t) => { await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(140); };
  const esc2 = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200); };
  /** souřadnice bodu [mm] ze štítku („… [60; 40]“) */
  const hintMm = (h) => { const m = /\[(-?[\d,.]+); (-?[\d,.]+)\]$/.exec(h.title); return m ? [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] : null; };
  /** jsou všechny dané body [mm] vidět na plátně? (štítky se vrací jen pro body uvnitř plátna) */
  const visible = async (pts) => { const hs = (await hints()).map(hintMm).filter(Boolean); return pts.every((q) => hs.some((h) => near(h[0], q[0], 0.011) && near(h[1], q[1], 0.011))); };
  /** pohled skici odečtený ze štítků → měřítko [px/mm] a poloha počátku v okně */
  const viewOf = async () => {
    const bx = await canvas();
    const pts = (await hints()).map((h) => { const mm = hintMm(h); return mm ? { mm, px: [bx.x + h.x, bx.y + h.y] } : null; }).filter(Boolean);
    let best = null;
    for (const a of pts) for (const c of pts) { const d = Math.hypot(c.px[0] - a.px[0], c.px[1] - a.px[1]); if (!best || d > best.d) best = { a, c, d }; }
    if (!best || best.d < 20) throw new Error('viewOf: na plátně nejsou aspoň dva štítky');
    const scale = best.d / Math.hypot(best.c.mm[0] - best.a.mm[0], best.c.mm[1] - best.a.mm[1]);
    return { scale, ox: best.a.px[0] - best.a.mm[0] * scale, oy: best.a.px[1] + best.a.mm[1] * scale };
  };
  const at = (v, mm) => ({ x: v.ox + mm[0] * v.scale, y: v.oy - mm[1] * v.scale });
  /** vloží text do schránky a stiskne Ctrl+V; když prohlížeč schránku nedovolí, pošle událost paste přímo */
  const paste = async (text) => {
    const wrote = await p.evaluate((t) => navigator.clipboard.writeText(t).then(() => true, () => false), text);
    const before = JSON.stringify(await sketch());
    if (wrote) { await p.keyboard.press('Control+V'); await p.waitForTimeout(350); }
    if (!wrote || (JSON.stringify(await sketch()) === before && !(await flash()))) {
      await p.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
      await p.waitForTimeout(350);
      return 'událost';
    }
    return 'Ctrl+V';
  };
  /** otevře novou skicu v rovině XY (nabídkou Tvorba → Skica → Rovina XY; klávesa S se může ptát na rovinu) */
  const openSketch = async () => {
    await p.getByRole('button', { name: 'Tvorba', exact: true }).click().catch(() => {});
    await p.getByRole('button', { name: /^Skica/ }).first().click().catch(() => {});
    await p.getByRole('button', { name: /Rovina XY/ }).click({ timeout: 4000 }).catch(() => {});
    let opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 6000 }).then(() => true, () => false);
    if (!opened) { await p.keyboard.press('s'); opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 6000 }).then(() => true, () => false); }
    await p.waitForTimeout(500);
    return opened;
  };

  // ═══════════════════════ A. skica zadaná z klávesnice ═══════════════════════
  await p.evaluate(() => window.mncad.run('nový díl Klávesnice'));
  await p.waitForTimeout(500);
  const opened = await openSketch();
  ok(opened, 'skica v rovině XY otevřena');
  if (!opened) { await p.screenshot({ path: S + 'kbd-fail-open.png' }); await b.close(); return; }

  // ── A1 + A3: tři úsečky a spline jen souřadnicemi z klávesnice (myš je mimo plátno) ──
  await p.keyboard.press('l'); await p.waitForTimeout(120);
  ok((await tool()) === 'line', `nástroj Úsečka (${await tool()})`);
  for (const t of ['0;0', '40;0', '40;30', '0;30']) await typeEnter(t);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  let lines = await ents('line');
  ok(lines.length === 3 && lines[0].a.join() === '0,0' && lines[0].b.join() === '40,0' && lines[2].b.join() === '0,30', `tři úsečky psané souřadnicemi: ${lines.map((l) => `[${l.a}]→[${l.b}]`).join(' ')}`);
  let fx = await cons('fixed');
  ok(fx.length === 4 && fx.every((c) => c.value && c.value.length === 2), `každý psaný bod je ukotven vazbou „Pevně“ jednou (4 body → ${fx.length} vazby, totožností ${(await cons('coincident')).length})`);
  ok((await cons('horizontal')).length === 0 && (await cons('vertical')).length === 0, 'mezi dvěma pevnými body se nepřidává nadbytečná vazba vodorovně / svisle');

  await p.keyboard.press('n'); await p.waitForTimeout(120);
  ok((await tool()) === 'spline', `nástroj Spline (${await tool()})`);
  await typeEnter('0;30'); await typeEnter('10;45');
  // živý náhled: po dvou bodech je křivka vidět, i když kurzor na plátně není
  let prev = await p.locator('[data-sketch-preview="spline"]').getAttribute('points').catch(() => null);
  ok(!!prev && prev.trim().split(/\s+/).length >= 2, `spline: náhled po 2 bodech bez kurzoru na plátně (${prev ? prev.trim().split(/\s+/).length : 0} bodů křivky)`);
  await typeEnter('25;38');
  prev = await p.locator('[data-sketch-preview="spline"]').getAttribute('points').catch(() => null);
  const n3 = prev ? prev.trim().split(/\s+/).length : 0;
  ok(n3 > 20, `spline: náhled po 3 bodech je hladká křivka (${n3} bodů)`);
  // rozepsaná souřadnice (ještě bez Enter) náhled prodlouží až k psanému bodu
  await p.keyboard.type('40;30'); await p.waitForTimeout(150);
  prev = await p.locator('[data-sketch-preview="spline"]').getAttribute('points').catch(() => null);
  const n4 = prev ? prev.trim().split(/\s+/).length : 0;
  ok(n4 > n3, `spline: rozepsaná souřadnice náhled prodlouží (${n3} → ${n4} bodů křivky)`);
  await p.screenshot({ path: S + 'kbd-spline-preview.png' });
  await p.keyboard.press('Enter'); await p.waitForTimeout(140);
  await p.keyboard.press('Enter'); await p.waitForTimeout(300); // dokončit spline
  const sp = (await ents('spline'))[0];
  ok(!!sp && sp.points.length === 4 && sp.points[3].join() === '40,30', `spline se 4 body psanými souřadnicemi: ${sp && JSON.stringify(sp.points)}`);
  fx = await cons('fixed');
  ok(fx.length === 8, `spline: každý bod ukotven (celkem ${fx.length} vazeb „Pevně“ = 4 + 4)`);
  let st = await waitStatus(/^Plně určeno/);
  ok(/^Plně určeno/.test(st), `AKCEPTACE: tři úsečky + spline jen ze souřadnic → stav skici „${st}“`);
  ok(await visible([[0, 0], [40, 0], [40, 30], [0, 30], [10, 45], [25, 38]]), 'AKCEPTACE: všechny zadané body jsou vidět na plátně');
  await p.screenshot({ path: S + 'kbd-full.png' });

  // pevný bod drží: tažení koncového bodu úsečky myší s ním nepohne
  await esc2();
  {
    const v = await viewOf();
    const a = at(v, [40, 0]);
    const mid = at(v, [20, 0]);
    await p.mouse.click(mid.x, mid.y); await p.waitForTimeout(150); // výběr první úsečky → úchyty
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(a.x + 60, a.y - 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
    lines = await ents('line');
    ok(lines[0].b.join() === '40,0' && lines[1].a.join() === '40,0', `tažení pevného bodu myší s ním nepohne: [${lines[0].b}]`);
    await esc2();
  }

  // ── A2: bod psaný mimo viditelnou část plátna → zobrazit vše, zadání pokračuje ──
  await p.keyboard.press('l'); await p.waitForTimeout(120);
  await p.keyboard.type('500;300'); await p.waitForTimeout(120);
  const dyn = await p.locator('[data-sketch-dyn]').boundingBox().catch(() => null);
  const bxA = await canvas();
  ok(!!dyn && dyn.x >= bxA.x && dyn.x + dyn.width <= bxA.x + bxA.width + 1 && dyn.y >= bxA.y && dyn.y + dyn.height <= bxA.y + bxA.height + 1, 'pole zadání zůstává na plátně, i když psaná souřadnice leží mimo pohled');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  ok((await tool()) === 'line' && (await ents('line')).length === 3, 'po prvním bodu mimo pohled zadání pokračuje (nástroj Úsečka, úsečka ještě nevznikla)');
  ok(await visible([[0, 0], [40, 30], [10, 45]]), 'pohled se oddálil a původní geometrie zůstala vidět');
  await typeEnter('600;300');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  lines = await ents('line');
  ok(lines.length === 4 && lines[3].a.join() === '500,300' && lines[3].b.join() === '600,300', `úsečka z bodů mimo původní pohled: [${lines[3] && lines[3].a}]→[${lines[3] && lines[3].b}]`);
  ok(await visible([[0, 0], [40, 0], [0, 30], [500, 300], [600, 300]]), 'po zadání bodů mimo pohled je vidět vše (staré i nové body)');
  st = await waitStatus(/^Plně určeno/);
  ok(/^Plně určeno/.test(st), `stav skici zůstává „${st}“`);
  // relativní zadání od pevného bodu je také pevné; délka + úhel (Tab) kótuje / zůstává volné
  await p.keyboard.press('l'); await p.waitForTimeout(120);
  await typeEnter('0;-20'); await typeEnter('@30;0'); await typeEnter('20<90');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  lines = await ents('line');
  ok(lines.length === 6 && lines[4].b.join() === '30,-20' && lines[5].b.join() === '30,0', `relativní „@30;0“ a polární „20<90“ od pevného bodu: [${lines[4] && lines[4].b}] [${lines[5] && lines[5].b}]`);
  st = await waitStatus(/^Plně určeno/);
  ok(/^Plně určeno/.test(st), `relativní zadání od pevného bodu je pevné → „${st}“`);
  // bod zadaný myší zůstává volný (dosavadní chování)
  const fixedBefore = (await cons('fixed')).length;
  await p.keyboard.press('b'); await p.waitForTimeout(120);
  { const bx = await canvas(); await p.mouse.click(bx.x + bx.width * 0.3, bx.y + bx.height * 0.25); await p.waitForTimeout(250); }
  st = await waitStatus(/^Nedourčeno/);
  ok(/^Nedourčeno \(2/.test(st) && (await ents('point')).length === 1 && (await cons('fixed')).length === fixedBefore, `bod položený myší se nekotví → „${st}“ (vazeb „Pevně“ ${fixedBefore} → ${(await cons('fixed')).length})`);
  await esc2();
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  ok((await ents('point')).length === 0, 'Ctrl+Z vrátil bod položený myší');

  // ── A4: seznam souřadnic ze schránky ──
  const nBefore = (await ents()).length;
  await p.keyboard.press('k'); await p.waitForTimeout(120);
  const how = await paste('100 0\n110 5\n120;0\n130,5 8');
  let fl = await flash();
  let pl = (await ents('polyline')).pop();
  ok(!!pl && JSON.stringify(pl.points) === '[[100,0],[110,5],[120,0],[130.5,8]]' && pl.closed === false, `Ctrl+V (${how}) při nástroji Lomená čára: ${pl && JSON.stringify(pl.points)}`);
  ok(/bodů: 4/.test(fl) && /lomená čára/.test(fl) && /Pevně/.test(fl), `hlášení o vložení: „${fl}“`);
  ok((await cons('fixed')).filter((c) => c.refs[0].e === (pl && pl.id)).length === 4, 'vložené body lomené čáry jsou ukotveny');
  await p.keyboard.press('n'); await p.waitForTimeout(120);
  await paste('100 20 110 25 120 20');
  const sp2 = (await ents('spline')).pop();
  ok(!!sp2 && JSON.stringify(sp2.points) === '[[100,20],[110,25],[120,20]]', `jeden řádek čísel při nástroji Spline → spline ${sp2 && JSON.stringify(sp2.points)}`);
  await p.keyboard.press('l'); await p.waitForTimeout(120);
  await paste('100\t40\r\n110\t45\r\n120\t40\r\n100\t40');
  lines = await ents('line');
  ok(lines.length === 9 && lines[8].b.join() === '100,40' && lines[6].a.join() === '100,40', `tabulka z Excelu při nástroji Úsečka → uzavřený řetěz 3 úseček (úseček celkem ${lines.length})`);
  // lichý počet čísel = srozumitelná chyba, nic se nevloží
  const nOdd = (await ents()).length;
  await paste('1 2 3 4 5');
  fl = await flash();
  ok(/lichý počet čísel \(5\)/.test(fl) && (await ents()).length === nOdd, `lichý počet čísel: „${fl}“, nic se nevložilo`);
  await p.waitForTimeout(200);
  await paste('ahoj 12');
  fl = await flash();
  ok(/není číslo/.test(fl) && /ahoj/.test(fl) && (await ents()).length === nOdd, `text místo čísel: „${fl}“`);
  // bez kreslicího nástroje: lomená čára
  await esc2();
  ok((await tool()) === 'select', 'nástroj Výběr');
  await paste('200 0\n210 10\n220 0');
  const pl2 = (await ents('polyline')).pop();
  fl = await flash();
  ok(!!pl2 && JSON.stringify(pl2.points) === '[[200,0],[210,10],[220,0]]' && /bodů: 3/.test(fl), `Ctrl+V bez kreslicího nástroje → lomená čára (${fl})`);
  ok(await visible([[200, 0], [220, 0], [0, 0]]), 'vložené body jsou vidět (pohled se přizpůsobil)');
  st = await waitStatus(/^Plně určeno/);
  ok(/^Plně určeno/.test(st), `po vložení ze schránky je skica „${st}“ (entit ${(await ents()).length}, před vkládáním ${nBefore})`);
  // dialog „Body ze seznamu“ z pásu karet
  await esc2();
  await p.getByRole('button', { name: /Body ze seznamu/ }).first().click().catch(() => {});
  const dlg = p.locator('[data-sketch-coords]');
  ok(await dlg.isVisible({ timeout: 3000 }).catch(() => false), 'pás karet → „Body ze seznamu…“ otevřel dialog');
  await dlg.locator('textarea').fill('300 0 310 10 320');
  ok(/lichý počet čísel \(5\)/.test(await dlg.locator('[data-sketch-coords-status]').textContent()), 'dialog hlásí lichý počet čísel už při psaní');
  ok(await dlg.getByRole('button', { name: 'Vložit do skici' }).isDisabled(), 'dialog: tlačítko Vložit je při chybě neaktivní');
  await dlg.locator('textarea').fill('300 0\n310 10\n320 0\n330 10');
  ok(/Přečteno bodů: 4/.test(await dlg.locator('[data-sketch-coords-status]').textContent()), 'dialog: „Přečteno bodů: 4“');
  await dlg.getByText('Spline', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Vložit do skici' }).click(); await p.waitForTimeout(350);
  const sp3 = (await ents('spline')).pop();
  ok(!!sp3 && sp3.points.length === 4 && sp3.points[3].join() === '330,10' && !(await dlg.isVisible().catch(() => false)), `dialog vložil spline ${sp3 && JSON.stringify(sp3.points)} a zavřel se`);
  await p.screenshot({ path: S + 'kbd-paste.png' });

  // ═══════════════════════ B. podklad skici ═══════════════════════
  await esc2();
  await p.evaluate(() => window.mncad.run('nový díl Podklad'));
  // nová záložka: skicář předchozího dílu se zavře
  await p.waitForSelector('[data-sketch-canvas]', { state: 'detached', timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(500);
  ok(await openSketch(), 'nová skica pro podklad otevřena');
  ok((await p.evaluate(() => window.mncad.getDocument().name)) === 'Podklad' && (await ents()).length === 0, 'skica je v novém dílu „Podklad“ a je prázdná');
  const ul = async () => { const d = await docOf(); const s = (d.features.filter((f) => f.type === 'sketch').pop() || {}); return { u: (d.underlays || {})[s.id] || null, d, s }; };
  const img = () => p.locator('[data-sketch-underlay-img]');
  const imgBox = () => img().boundingBox();
  const panel = p.locator('[data-sketch-underlay]');
  const wUl = (u) => u.w * u.mmPerPx;
  // testovací obrázek 400 × 200 px: vodorovná čára se značkami v x = 50 a x = 350 px (300 px od sebe)
  const png = Buffer.from((await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 200; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 200); g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(50, 100); g.lineTo(350, 100); g.moveTo(50, 80); g.lineTo(50, 120); g.moveTo(350, 80); g.lineTo(350, 120); g.stroke();
    return c.toDataURL('image/png');
  })).split(',')[1], 'base64');

  // B1: vložení obrázku z pásu karet (bez podkladu se rovnou otevře výběr souboru)
  {
    const chooser = p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await p.locator('[data-ribbon] button[aria-label^="Podklad…"]').first().click();
    const fc = await chooser;
    ok(!!fc, 'pás karet → „Podklad…“ otevřel výběr souboru');
    if (fc) await fc.setFiles({ name: 'podklad.png', mimeType: 'image/png', buffer: png });
    else await p.setInputFiles('[data-sketch-underlay-file]', { name: 'podklad.png', mimeType: 'image/png', buffer: png });
    await p.waitForSelector('[data-sketch-underlay-img]', { timeout: 15000 }).catch(() => {});
  }
  let { u, s: skUl } = await ul();
  ok(!!u && /^data:image\/(png|jpeg);base64,/.test(u.src) && u.w === 400 && u.h === 200 && u.name === 'podklad.png', `podklad uložen v doc.underlays (${u && u.w}×${u && u.h} px, ${u && u.src.length} znaků)`);
  ok(!JSON.stringify(skUl).includes('data:image') && !('underlay' in skUl), 'obrázek není v prvku skici (klíč mezipaměti stavby se nemění)');
  ok(await panel.isVisible() && (await img().count()) === 1, 'panel podkladu a obrázek pod geometrií jsou vidět');
  // krytí, skrytí, zobrazení
  await panel.locator('[data-ul-opacity]').fill('30'); await p.waitForTimeout(250);
  ({ u } = await ul());
  ok(u && Math.abs(u.opacity - 0.3) < 1e-9 && Math.abs(parseFloat(await img().getAttribute('opacity')) - 0.3) < 1e-9, `krytí 30 % (${u && u.opacity})`);
  await panel.locator('[data-ul-visible]').uncheck(); await p.waitForTimeout(200);
  ({ u } = await ul());
  ok(u && u.hidden === true && (await img().count()) === 0, 'skrytí podkladu');
  await panel.locator('[data-ul-visible]').check(); await p.waitForTimeout(200);
  ({ u } = await ul());
  ok(u && !u.hidden && (await img().count()) === 1, 'zobrazení podkladu');

  // B2: kalibrace dvěma body: značky 300 px od sebe = 150 mm → 0,5 mm/px, šířka 200 mm
  {
    await panel.locator('[data-ul-calib]').click(); await p.waitForTimeout(150);
    const bx = await imgBox();
    const at = (px, py) => ({ x: bx.x + (px / 400) * bx.width, y: bx.y + (py / 200) * bx.height });
    const a = at(50, 100); const c = at(350, 100);
    await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
    ok((await p.locator('[data-ul-calib-marks]').count()) === 1, 'kalibrace: první bod označen');
    await p.mouse.click(c.x, c.y); await p.waitForTimeout(300);
    const askInput = p.locator('input.w-24').first();
    ok(await askInput.isVisible().catch(() => false), 'kalibrace: po druhém bodu se ptá na skutečnou vzdálenost');
    await askInput.fill('150'); await askInput.press('Enter'); await p.waitForTimeout(350);
    ({ u } = await ul());
    ok(u && Math.abs(wUl(u) - 200) < 1 && Math.abs(u.mmPerPx - 0.5) < 0.003, `kalibrace: šířka podkladu ${u && wUl(u).toFixed(3)} mm (čekáno 200), ${u && u.mmPerPx.toFixed(5)} mm/px`);
    ok(/Podklad zkalibrován/.test(await flash()), 'kalibrace: hlášení');
    ok((await p.locator('[data-ul-hint]').count()) === 0, 'kalibrace: režim skončil');
  }

  // B3: posun tažením + Zpět jedním krokem; natočení a šířka číslem
  {
    const before = (await ul()).u;
    await panel.locator('[data-ul-move]').click(); await p.waitForTimeout(150);
    ok((await p.locator('[data-ul-outline]').count()) === 1, 'posun: obrys podkladu');
    const bx = await imgBox();
    const k = bx.width / wUl(before); // px na mm
    const c0 = { x: bx.x + bx.width / 2, y: bx.y + bx.height / 2 };
    await p.mouse.move(c0.x, c0.y); await p.mouse.down(); await p.mouse.move(c0.x + 50, c0.y - 25, { steps: 5 }); await p.mouse.move(c0.x + 100, c0.y - 50, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
    ({ u } = await ul());
    ok(u && Math.abs(u.x - before.x - 100 / k) < 0.6 && Math.abs(u.y - before.y - 50 / k) < 0.6 && u.mmPerPx === before.mmPerPx, `posun tažením o [${u && (u.x - before.x).toFixed(2)}; ${u && (u.y - before.y).toFixed(2)}] mm (čekáno [${(100 / k).toFixed(2)}; ${(50 / k).toFixed(2)}])`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok((await p.locator('[data-ul-outline]').count()) === 0, 'Esc ukončil posun');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(350);
    ({ u } = await ul());
    ok(u && Math.abs(u.x - before.x) < 1e-9 && Math.abs(u.y - before.y) < 1e-9, 'Ctrl+Z vrátil posun podkladu jedním krokem');
    await p.keyboard.press('Control+y').catch(() => {}); await p.waitForTimeout(300);
    const ang = panel.locator('[data-ul-angle]');
    await ang.fill('90'); await ang.press('Enter'); await p.waitForTimeout(300);
    ({ u } = await ul());
    const rb = await imgBox();
    ok(u && u.angle === 90 && Math.abs(rb.width / rb.height - 0.5) < 0.05, `natočení 90° (poměr stran na plátně ${(rb.width / rb.height).toFixed(3)})`);
    await ang.fill('0'); await ang.press('Enter'); await p.waitForTimeout(200);
    const wi = panel.locator('[data-ul-width]');
    await wi.fill('100'); await wi.press('Enter'); await p.waitForTimeout(300);
    ({ u } = await ul());
    ok(u && u.angle === 0 && Math.abs(wUl(u) - 100) < 1e-6, `šířka podkladu číslem: ${u && wUl(u)} mm`);
  }

  // B4: stránka PDF ve skutečné velikosti, změna stránky, převod čar na entity
  {
    const { jsPDF } = require('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    pdf.setLineWidth(0.3); pdf.line(20, 20, 120, 20); pdf.rect(30, 100, 50, 30); pdf.circle(200, 60, 25); pdf.text('Rozmer 100', 40, 15);
    pdf.addPage(); pdf.line(10, 10, 60, 10);
    const pdfBuf = Buffer.from(pdf.output('arraybuffer'));
    const chooser = p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await panel.locator('[data-ul-pick]').click();
    const fc = await chooser;
    if (fc) await fc.setFiles({ name: 'vykres.pdf', mimeType: 'application/pdf', buffer: pdfBuf });
    else await p.setInputFiles('[data-sketch-underlay-file]', { name: 'vykres.pdf', mimeType: 'application/pdf', buffer: pdfBuf });
    await p.waitForFunction(() => { const d = window.mncad.getDocument(); return Object.values(d.underlays || {}).some((x) => x.page); }, null, { timeout: 60000 }).catch(() => {});
    ({ u } = await ul());
    const err = await p.locator('[data-ul-error]').textContent().catch(() => '');
    ok(u && u.page === 1 && u.pages === 2 && u.pxPerPt > 0 && Math.abs(wUl(u) - 297) < 0.5 && Math.abs(u.h * u.mmPerPx - 210) < 0.5, `PDF: strana 1 ze 2 ve skutečné velikosti ${u && wUl(u).toFixed(2)} × ${u && (u.h * u.mmPerPx).toFixed(2)} mm (${u && u.w}×${u && u.h} px)${err ? ' – ' + err : ''}`);
    ok(/1:1/.test(await panel.locator('[data-ul-size]').textContent()), `PDF: měřítko 1:1 (${await panel.locator('[data-ul-size]').textContent()})`);
    await p.screenshot({ path: S + 'underlay-pdf.png' });
    const nEnt = (await ents()).length;
    await panel.locator('[data-ul-convert]').click();
    await p.waitForFunction((n) => { const d = window.mncad.getDocument(); return d.features.filter((f) => f.type === 'sketch').pop().entities.length > n; }, nEnt, { timeout: 60000 }).catch(() => {});
    const es = (await ents()).slice(nEnt);
    const tl = [u.x - wUl(u) / 2, u.y + (u.h * u.mmPerPx) / 2]; // levý horní roh stránky ve skice
    const P = (x, y) => [tl[0] + x, tl[1] - y];
    const nearP = (q, r, t = 0.05) => near(q[0], r[0], t) && near(q[1], r[1], t);
    const ln = es.find((e) => e.type === 'line' && nearP(e.a, P(20, 20)) && nearP(e.b, P(120, 20)));
    const ci = es.find((e) => e.type === 'circle');
    const rc = es.find((e) => e.type === 'polyline' && e.closed && e.points.length === 4);
    ok(!!ln, `PDF → úsečka 100 mm na správném místě (${es.length} entit: ${es.map((e) => e.type).join(', ')})`);
    ok(!!ci && near(ci.r, 25, 0.05) && nearP([ci.cx, ci.cy], P(200, 60)), `PDF → kružnice R ${ci && ci.r} se středem na místě`);
    ok(!!rc && nearP(rc.points[0], P(30, 100)) && nearP(rc.points[2], P(80, 130)), 'PDF → obdélník jako uzavřená lomená čára');
    ok(/Z PDF vloženo entit: 3/.test(await flash()), `hlášení převodu: „${await flash()}“`);
    await p.screenshot({ path: S + 'underlay-pdf-entities.png' });
    // druhá stránka: poloha a měřítko zůstávají
    const idBefore = u.id;
    await panel.getByRole('button', { name: '›' }).click();
    await p.waitForFunction(() => Object.values(window.mncad.getDocument().underlays || {}).some((x) => x.page === 2), null, { timeout: 30000 }).catch(() => {});
    const u2 = (await ul()).u;
    ok(u2 && u2.page === 2 && u2.id === idBefore && Math.abs(u2.x - u.x) < 1e-9 && Math.abs(wUl(u2) - wUl(u)) < 0.5, `změna stránky PDF: ${u2 && u2.page} / ${u2 && u2.pages}, poloha a velikost zůstaly`);
    ok(/2 \/ 2/.test(await panel.locator('[data-ul-page]').textContent()), 'panel ukazuje stránku 2 / 2');
    // odebrání
    await panel.locator('[data-ul-remove]').click(); await p.waitForTimeout(300);
    const after = await ul();
    ok(!after.u && !('underlays' in after.d) && (await img().count()) === 0, 'odebrání podkladu (doc.underlays zmizel)');
  }

  // B5: obrázek ze schránky (Ctrl+V snímku obrazovky) → podklad
  {
    await p.evaluate((b64) => {
      const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([a], 'image.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png.toString('base64'));
    await p.waitForSelector('[data-sketch-underlay-img]', { timeout: 15000 }).catch(() => {});
    ({ u } = await ul());
    ok(!!u && u.w === 400 && u.name === 'image.png', 'obrázek vložený ze schránky se stal podkladem');
  }

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(conErrs.length === 0, 'bez chyb v konzoli' + (conErrs.length ? ': ' + conErrs.join(' | ') : ''));
  // B6: čtečka PDF se nenačte (blokovaný /vendor/pdfjs-*) → srozumitelná česká chyba, obrázkový podklad funguje dál
  {
    const q = await ctx.newPage();
    const qErrs = []; q.on('pageerror', (e) => qErrs.push(e.message));
    await q.route('**/vendor/pdfjs-*/**', (r) => r.abort());
    await q.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
    { const c = q.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); }
    await q.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 }).catch(() => {});
    await q.evaluate(() => window.mncad.run('nový díl Bez PDF'));
    await q.waitForTimeout(600);
    await q.getByRole('button', { name: 'Tvorba', exact: true }).click().catch(() => {});
    await q.getByRole('button', { name: /^Skica/ }).first().click().catch(() => {});
    await q.getByRole('button', { name: /Rovina XY/ }).click({ timeout: 4000 }).catch(() => {});
    await q.waitForSelector('[data-sketch-canvas]', { timeout: 10000 }).catch(() => {});
    const { jsPDF } = require('jspdf');
    const pdf = new jsPDF(); pdf.line(10, 10, 50, 10);
    const ch = q.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await q.locator('[data-ribbon] button[aria-label^="Podklad…"]').first().click();
    const fc = await ch;
    if (fc) await fc.setFiles({ name: 'blok.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
    await q.waitForSelector('[data-ul-error]', { timeout: 30000 }).catch(() => {});
    const e1 = await q.locator('[data-ul-error]').textContent().catch(() => '');
    ok(/Čtečku PDF se nepodařilo načíst/.test(e1 || ''), `bez čtečky PDF: česká chyba „${e1}“`);
    const ch2 = q.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await q.locator('[data-ul-pick]').click();
    const fc2 = await ch2;
    if (fc2) await fc2.setFiles({ name: 'podklad.png', mimeType: 'image/png', buffer: png });
    await q.waitForSelector('[data-sketch-underlay-img]', { timeout: 15000 }).catch(() => {});
    const qu = await q.evaluate(() => { const d = window.mncad.getDocument(); return Object.values(d.underlays || {})[0] || null; });
    ok(!!qu && qu.w === 400 && (await q.locator('[data-ul-error]').count()) === 0, 'bez čtečky PDF obrázkový podklad funguje dál');
    ok(qErrs.length === 0, 'bez chyb stránky (bez čtečky PDF)' + (qErrs.length ? ': ' + qErrs.join(' | ') : ''));
    await q.close();
  }
  console.log(fails ? `\nCHYBY: ${fails}` : '\nVše v pořádku.');
  await b.close();
})().catch((e) => { console.error('FAIL: skript spadl – ' + (e && e.stack || e)); process.exit(1); });
