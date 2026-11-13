// E2E: dotykové ovládání 2D skicáře (jeden prst = levé tlačítko, dlouhý stisk = pravé tlačítko, dva prsty = posun + zoom),
// štítky skici pro automatizaci (window.mncad.hints() / clickHint() při otevřené skice) a nastavitelné zkratky nástrojů skici
// (Nastavení → Klávesové zkratky → Skica). Dotyk se posílá přes CDP (Input.dispatchTouchEvent) – skutečné vícedotykové události.
// Spuštění: E2E_BASE=http://localhost:3201 node e2e/cad-sketch-touch.e2e.cjs <složka>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const r1 = (v) => Math.round(v * 10) / 10;
const MENU = 'div.fixed.z-\\[60\\]'; // kontextová nabídka skici
const SETTINGS_KEY = 'mn-cad-settings-v2';

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const conErrs = []; p.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GL Driver|favicon|Failed to load resource/.test(m.text())) conErrs.push(m.text().slice(0, 300)); });
  const cdp = await ctx.newCDPSession(p);
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await start(p);

  // ── pomocníci ──
  const canvas = () => p.locator('[data-sketch-canvas]').boundingBox();
  const tool = () => p.getAttribute('[data-sketch-canvas]', 'data-tool');
  const hints = () => p.evaluate(() => window.mncad.hints());
  const sketch = async () => { const d = await p.evaluate(() => window.mncad.getDocument()); return d.features.filter((f) => f.type === 'sketch').pop(); };
  const entity = async (type, nth = 0) => (await sketch()).entities.filter((e) => e.type === type)[nth];
  const count = async () => (await sketch()).entities.length;
  /**
   * Pohled skici odečtený ze štítků: popis štítku nese souřadnice bodu v mm („… [60; 40]“), API jeho polohu v px vůči plátnu
   * → měřítko [px/mm] a poloha počátku skici v okně prohlížeče (i když je počátek mimo plátno).
   */
  const viewOf = async () => {
    const bx = await canvas();
    const pts = (await hints()).map((h) => { const m = /\[(-?[\d,.]+); (-?[\d,.]+)\]$/.exec(h.title); return m ? { mm: [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))], px: [bx.x + h.x, bx.y + h.y] } : null; }).filter(Boolean);
    let best = null;
    for (const a of pts) for (const c of pts) { const d = Math.hypot(c.px[0] - a.px[0], c.px[1] - a.px[1]); if (!best || d > best.d) best = { a, c, d }; }
    if (!best || best.d < 20) throw new Error('viewOf: na plátně nejsou aspoň dva štítky');
    const scale = best.d / Math.hypot(best.c.mm[0] - best.a.mm[0], best.c.mm[1] - best.a.mm[1]);
    return { scale, ox: best.a.px[0] - best.a.mm[0] * scale, oy: best.a.px[1] + best.a.mm[1] * scale };
  };
  /** bod skici [mm] → souřadnice v okně prohlížeče */
  const at = (v, mm) => ({ x: v.ox + mm[0] * v.scale, y: v.oy - mm[1] * v.scale });
  /** bod na horní straně obdélníku ve čtvrtině šířky (mimo popisky kót) */
  const topEdge = async () => { const r = await entity('rect'); return at(await viewOf(), [r.cx - r.w / 4, r.cy + r.h / 2]); };
  // CDP: touchStart / touchMove = prsty, které dosedly nebo se pohnuly (ostatní zůstávají na místě);
  // touchEnd s body = zvednou se jen tyto prsty, touchEnd s prázdným seznamem = zvednou se všechny
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), id: q.id || 0, radiusX: 6, radiusY: 6, force: 1 })) });
  const tap = async (q) => { await touch('touchStart', [q]); await p.waitForTimeout(60); await touch('touchEnd', []); await p.waitForTimeout(170); };
  /** tažení jedním prstem po krocích; `hold` = prst zůstane dole (vrací koncovou polohu) */
  const dragTouch = async (q, dx, dy, hold = false) => {
    await touch('touchStart', [q]); await p.waitForTimeout(30);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: q.x + (dx * i) / 6, y: q.y + (dy * i) / 6 }]); await p.waitForTimeout(25); }
    if (!hold) { await touch('touchEnd', []); await p.waitForTimeout(220); }
    return { x: q.x + dx, y: q.y + dy };
  };
  /** gesto dvěma prsty: z poloh a0, b0 do a1, b1 po krocích */
  const twoFingers = async (a0, b0, a1, b1, lift = true) => {
    await touch('touchStart', [{ ...a0, id: 0 }]); await p.waitForTimeout(30);
    await touch('touchStart', [{ ...a0, id: 0 }, { ...b0, id: 1 }]); await p.waitForTimeout(30);
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      await touch('touchMove', [{ x: a0.x + (a1.x - a0.x) * t, y: a0.y + (a1.y - a0.y) * t, id: 0 }, { x: b0.x + (b1.x - b0.x) * t, y: b0.y + (b1.y - b0.y) * t, id: 1 }]);
      await p.waitForTimeout(25);
    }
    if (lift) { await touch('touchEnd', []); await p.waitForTimeout(220); }
  };
  /** položky otevřené kontextové nabídky (null = nabídka není) */
  const menuItems = () => p.evaluate((sel) => { const m = document.querySelector(sel); return m ? [...m.querySelectorAll('button, p')].map((e) => (e.querySelector('span.flex-1') || e).textContent.trim()) : null; }, MENU);
  const closeMenu = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); };
  /** úchyty vybrané entity na plátně (0 = nic není vybráno) */
  const handles = () => p.locator('[data-sketch-canvas] rect[stroke="#E03930"]').count();
  const esc2 = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200); };

  // ═══ 1. stejná klávesa ve 3D a ve skice: S = Nová skica (3D) / Drážka (skica) ═══
  await p.evaluate(() => window.mncad.run('nový díl Dotyk'));
  await p.waitForTimeout(500);
  await p.keyboard.press('s');
  const opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false);
  ok(opened, '3D: klávesa S (sketch.new) založila skicu a otevřela skicář');
  if (!opened) { await p.screenshot({ path: S + 'touch-fail-open.png' }); await b.close(); return; }
  await p.waitForTimeout(500);
  ok((await tool()) === 'line', `nová skica začíná nástrojem Úsečka (${await tool()})`);
  await p.keyboard.press('s'); await p.waitForTimeout(150);
  const doc = await p.evaluate(() => window.mncad.getDocument());
  ok((await tool()) === 'slot' && doc.features.filter((f) => f.type === 'sketch').length === 1, `skica: stejná klávesa S vybrala Drážku (nástroj ${await tool()}) a nezaložila další skicu (prvků ${doc.features.length})`);

  // ═══ 2. plátno: stránku neposouvá ani nezvětšuje prohlížeč, bez výběru textu ═══
  const css = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('[data-sketch-canvas]')); return { ta: s.touchAction, us: s.userSelect || s.webkitUserSelect }; });
  ok(css.ta === 'none' && css.us === 'none', `plátno skici: touch-action ${css.ta}, user-select ${css.us}`);

  // ═══ 3. štítky skici pro automatizaci ═══
  let list = await hints();
  ok(list.length === 1 && list[0].id === 'O' && list[0].kind === 'origin' && list[0].index === 0 && /\[0; 0\]/.test(list[0].title), `prázdná skica: hints() vrací počátek O (${JSON.stringify(list).slice(0, 110)})`);
  ok((await p.locator('[data-sketch-hint]').count()) === 0, 'hints() vrací štítky i při vypnutém zobrazení (na plátně žádný není)');
  // obdélník 60 × 40 z počátku: nástroj R, první roh klikem na štítek O přes API, rozměry číselně
  await p.keyboard.press('r'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.mncad.clickHint('O')), 'clickHint("O") v nástroji Obdélník vrátil true');
  await p.waitForTimeout(150);
  await p.keyboard.type('60'); await p.keyboard.press('Tab'); await p.keyboard.type('40'); await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  let rect = await entity('rect');
  ok(!!rect && rect.w === 60 && rect.h === 40 && rect.cx === 30 && rect.cy === 20, `clickHint("O") položil první roh přesně do počátku: obdélník ${rect && `${rect.w}×${rect.h}, střed [${rect.cx}; ${rect.cy}]`}`);
  await esc2(); await p.keyboard.press('f'); await p.waitForTimeout(400); // výběr + zobrazit vše
  list = await hints();
  const bx0 = await canvas();
  ok(list.length >= 5 && list[0].id === 'O' && list.slice(1).every((h, i) => h.id === `P${i + 1}` && h.kind === 'point' && h.index === i + 1 && typeof h.title === 'string' && h.title.length > 3), `hints() ve skice: ${list.map((h) => h.id).join(' ')} – každý má kind, index, x, y, title`);
  ok(list.every((h) => h.x >= 0 && h.y >= 0 && h.x <= bx0.width && h.y <= bx0.height), 'souřadnice štítků jsou vůči plátnu skici (leží uvnitř něj)');
  ok(list.some((h) => /obdélník 1 – pravý horní roh \[60; 40\]/.test(h.title)) && list.some((h) => /obdélník 1 – střed \[30; 20\]/.test(h.title)), 'popis štítku říká, co bod je a kde leží (pravý horní roh [60; 40], střed [30; 20])');
  // zapnutí zobrazení: štítky na plátně leží přesně na souřadnicích z API
  const afterOn = await p.evaluate(() => window.mncad.hints(true));
  await p.waitForFunction(() => document.querySelectorAll('[data-sketch-hint]').length >= 5, null, { timeout: 5000 }).catch(() => {});
  const dom = await p.evaluate(() => { const c = document.querySelector('[data-sketch-canvas]').getBoundingClientRect(); return [...document.querySelectorAll('[data-sketch-hint]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.sketchHint, kind: el.dataset.kind, index: Number(el.dataset.index), x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }; }); });
  ok(afterOn.length === list.length && dom.length === list.length && dom.every((d) => { const h = list.find((x) => x.id === d.id); return h && h.kind === d.kind && h.index === d.index && near(h.x, d.x, 1) && near(h.y, d.y, 1); }), `hints(true) zobrazilo ${dom.length} štítků přesně na souřadnicích z API (±1 px)`);
  await p.screenshot({ path: S + 'touch-hints.png' });
  // clickHint kreslí stejnou cestou jako myš: úsečka z pravého horního rohu do počátku (uchopení → vazba totožnosti)
  await p.keyboard.press('l'); await p.waitForTimeout(100);
  const pTop = list.find((h) => /pravý horní roh/.test(h.title)).id;
  const c1 = await p.evaluate((id) => window.mncad.clickHint(id), pTop);
  const c2 = await p.evaluate(() => window.mncad.clickHint('o')); // na velikosti písmen nezáleží
  await p.waitForTimeout(300);
  await esc2();
  let sk = await sketch();
  let line = sk.entities.find((e) => e.type === 'line');
  ok(c1 && c2 && !!line && line.a[0] === 60 && line.a[1] === 40 && line.b[0] === 0 && line.b[1] === 0, `clickHint("${pTop}") + clickHint("o") nakreslily úsečku [60; 40] → [0; 0] (${line && JSON.stringify([line.a, line.b])})`);
  ok((sk.constraints || []).some((c) => c.type === 'coincident' && c.refs.some((r) => r.e === (line && line.id))), `klik přes štítek uchopil roh obdélníku jako myš (vazby: ${(sk.constraints || []).map((c) => c.type).join(', ') || 'žádné'})`);
  ok((await p.evaluate(() => window.mncad.clickHint('P99'))) === false, 'clickHint na neexistující štítek vrací false');
  // výběr přes štítek: střed obdélníku leží na úhlopříčce → klik vybere úsečku, Delete ji smaže
  const pMid = (await hints()).find((h) => /obdélník 1 – střed/.test(h.title)).id;
  await p.evaluate((id) => window.mncad.clickHint(id), pMid); await p.waitForTimeout(200);
  await p.keyboard.press('Delete'); await p.waitForTimeout(300);
  sk = await sketch();
  ok(sk.entities.length === 1 && sk.entities[0].type === 'rect', `clickHint ve Výběru vybral entitu pod bodem – úsečka smazána (zbylo: ${sk.entities.map((e) => e.type).join(', ')})`);
  await p.evaluate(() => window.mncad.hints(false)); await p.waitForTimeout(200);

  // ═══ 4. jeden prst = levé tlačítko: výběr, kreslení, tažení ═══
  const v0 = await viewOf();
  let e0 = await topEdge();
  await tap(e0);
  ok((await handles()) >= 2, `klepnutí prstem na stranu obdélníku ho vybralo (úchytů ${await handles()})`);
  rect = await entity('rect');
  ok(rect.cx === 30 && rect.cy === 20, 'klepnutí s entitou nepohnulo');
  const bx = await canvas();
  const empty = { x: bx.x + 90, y: bx.y + bx.height - 110 }; // prázdné místo vlevo dole
  await tap(empty);
  ok((await handles()) === 0, 'klepnutí do prázdna výběr zrušilo');
  // kreslení: kružnice dvěma klepnutími
  await p.keyboard.press('c'); await p.waitForTimeout(100);
  await tap(empty); await tap({ x: empty.x + 40, y: empty.y });
  const circle = await entity('circle');
  ok(!!circle && near(circle.r, 40 / v0.scale, 10 / v0.scale + 0.6), `dvě klepnutí nástrojem Kružnice nakreslila kružnici R${circle && r1(circle.r)} (čekáno ≈ ${r1(40 / v0.scale)} mm)`);
  await esc2();
  // tažení entity jedním prstem
  e0 = await topEdge();
  await dragTouch(e0, 80, 0);
  rect = await entity('rect');
  ok(rect.cx > 30 + 0.5 * (80 / v0.scale) && rect.cy === 20, `tažení jedním prstem přesunulo obdélník (střed X ${rect.cx}, čekáno ≈ ${r1(30 + 80 / v0.scale)})`);
  await tap(empty); // zrušit výběr
  await p.screenshot({ path: S + 'touch-one-finger.png' });

  // ═══ 5. druhý prst rozpracovanou akci čistě zruší ═══
  const cx0 = rect.cx;
  const n0 = await count();
  e0 = await topEdge();
  const held = await dragTouch(e0, 0, -70, true); // prst zůstává dole
  await p.waitForTimeout(150);
  const mid = await entity('rect');
  ok(mid.cy > 20.5, `tažení prstem hýbe entitou živě (střed Y ${mid.cy} > 20)`);
  await touch('touchStart', [{ ...held, id: 0 }, { x: held.x + 150, y: held.y + 40, id: 1 }]); // dosedl druhý prst
  await p.waitForTimeout(300);
  rect = await entity('rect');
  ok(rect.cx === cx0 && rect.cy === 20, `druhý prst tažení zrušil a obdélník se vrátil (střed [${rect.cx}; ${rect.cy}], před tažením [${cx0}; 20])`);
  await touch('touchEnd', []); await p.waitForTimeout(300);
  rect = await entity('rect');
  ok(rect.cx === cx0 && rect.cy === 20 && (await count()) === n0, 'po zvednutí obou prstů nic nepřibylo ani se nepohnulo');
  await tap(empty); // zrušit výběr
  // rozpracovaný klik v kreslicím nástroji: druhý prst ho zahodí, rozkreslená úsečka ale zůstane
  await p.keyboard.press('l'); await p.waitForTimeout(100);
  const A = { x: empty.x + 160, y: empty.y + 30 };
  const C = { x: empty.x + 260, y: empty.y + 30 };
  await tap(A); // první bod úsečky
  await touch('touchStart', [{ x: A.x + 60, y: A.y - 60, id: 0 }]); await p.waitForTimeout(40);
  await touch('touchStart', [{ x: A.x + 60, y: A.y - 60, id: 0 }, { x: A.x + 200, y: A.y - 60, id: 1 }]); await p.waitForTimeout(80);
  await touch('touchEnd', []); await p.waitForTimeout(300);
  ok((await count()) === n0, 'dva prsty během kreslení nepoložily bod (žádná nová entita)');
  await tap(C);
  await esc2();
  line = (await sketch()).entities.find((e) => e.type === 'line');
  const len = line ? Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]) : 0;
  ok((await count()) === n0 + 1 && !!line && near(len, 100 / v0.scale, 12 / v0.scale + 0.6) && near(line.a[1], line.b[1], 0.01), `rozkreslená úsečka gesto přežila – další klepnutí ji dokončilo (délka ${r1(len)} mm ≈ ${r1(100 / v0.scale)})`);

  // ═══ 6. dva prsty: zoom kolem středu sevření, posun ═══
  rect = await entity('rect');
  const before = await viewOf();
  const pc = at(before, [rect.cx, rect.cy]); // střed sevření = střed obdélníku
  await twoFingers({ x: pc.x - 100, y: pc.y }, { x: pc.x + 100, y: pc.y }, { x: pc.x - 130, y: pc.y }, { x: pc.x + 130, y: pc.y });
  const zoomed = await viewOf();
  const kz = zoomed.scale / before.scale;
  ok(near(kz, 1.3, 0.03), `roztažení prstů z 200 na 260 px přiblížilo 1,3× (${r1(before.scale)} → ${r1(zoomed.scale)} px/mm, poměr ${kz.toFixed(3)})`);
  ok(near(zoomed.ox, pc.x + (before.ox - pc.x) * kz, 2.5) && near(zoomed.oy, pc.y + (before.oy - pc.y) * kz, 2.5), `zoom je kolem středu sevření (počátek skici [${r1(zoomed.ox)}; ${r1(zoomed.oy)}] px, čekáno [${r1(pc.x + (before.ox - pc.x) * kz)}; ${r1(pc.y + (before.oy - pc.y) * kz)}])`);
  await p.screenshot({ path: S + 'touch-pinch.png' });
  // posun dvěma prsty (rozteč se nemění)
  await twoFingers({ x: pc.x, y: pc.y - 60 }, { x: pc.x, y: pc.y + 60 }, { x: pc.x - 60, y: pc.y - 60 + 30 }, { x: pc.x - 60, y: pc.y + 60 + 30 });
  const panned = await viewOf();
  ok(near(panned.scale / zoomed.scale, 1, 0.01) && near(panned.ox - zoomed.ox, -60, 2.5) && near(panned.oy - zoomed.oy, 30, 2.5), `tažení dvěma prsty skicu posunulo o [${r1(panned.ox - zoomed.ox)}; ${r1(panned.oy - zoomed.oy)}] px (čekáno [-60; 30]) beze změny měřítka`);
  // sevření zpět; pak se zvedne jen jeden prst a druhý se dál hýbe – nesmí nic nakreslit, vybrat ani přetáhnout
  const pc2 = { x: pc.x - 60, y: pc.y + 30 };
  await twoFingers({ x: pc2.x - 130, y: pc2.y }, { x: pc2.x + 130, y: pc2.y }, { x: pc2.x - 100, y: pc2.y }, { x: pc2.x + 100, y: pc2.y }, false);
  const n1 = await count();
  const ents = JSON.stringify((await sketch()).entities);
  await touch('touchEnd', [{ x: pc2.x + 100, y: pc2.y, id: 1 }]); await p.waitForTimeout(60); // zvedl se jen druhý prst
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: pc2.x - 100 + i * 25, y: pc2.y + i * 10, id: 0 }]); await p.waitForTimeout(25); }
  await touch('touchEnd', []); await p.waitForTimeout(300);
  const back = await viewOf();
  ok(near(back.scale / before.scale, 1, 0.03), `sevření prstů oddálilo zpět (${r1(back.scale)} px/mm ≈ ${r1(before.scale)})`);
  ok(near(back.ox, panned.ox + (pc2.x - panned.ox) * (1 - back.scale / panned.scale), 3) && (await count()) === n1 && JSON.stringify((await sketch()).entities) === ents && (await handles()) === 0, 'prst, který po gestu zůstal na plátně, pohled neposunul a nic nenakreslil, nevybral ani nepřetáhl');
  const page = await p.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, zoom: window.visualViewport ? window.visualViewport.scale : 1 }));
  ok(page.sx === 0 && page.sy === 0 && page.zoom === 1, `stránka se při gestech neposunula ani nezvětšila (scroll ${page.sx},${page.sy}, zoom ${page.zoom})`);

  // ═══ 7. dlouhý stisk = pravé tlačítko ═══
  await p.keyboard.press('f'); await p.waitForTimeout(400);
  const bxl = await canvas();
  const free = { x: bxl.x + 70, y: bxl.y + bxl.height / 2 }; // prázdný levý okraj (po „zobrazit vše“ je kresba ve středních 2/3)
  await touch('touchStart', [free]); await p.waitForTimeout(750);
  const lpDown = await menuItems();
  ok(!!lpDown && lpDown.includes('Zobrazit vše') && lpDown.includes('Vybrat vše'), `dlouhý stisk (750 ms) do prázdna otevřel nabídku ještě před zvednutím prstu (${lpDown ? lpDown.length + ' položek' : 'nic'})`);
  await touch('touchEnd', []); await p.waitForTimeout(250);
  const lpUp = await menuItems();
  ok(!!lpUp && (await handles()) === 0, 'po zvednutí prstu nabídka zůstala otevřená a nic se nevybralo');
  await p.screenshot({ path: S + 'touch-longpress-menu.png' });
  await closeMenu();
  await p.mouse.click(free.x, free.y, { button: 'right' }); await p.waitForTimeout(250);
  const rcEmpty = await menuItems();
  ok(!!rcEmpty && JSON.stringify(rcEmpty) === JSON.stringify(lpUp), `nabídka po dlouhém stisku = nabídka po pravém kliku na stejném místě (${rcEmpty ? rcEmpty.length : 0} položek)`);
  await closeMenu();
  // na entitě
  e0 = await topEdge();
  await touch('touchStart', [e0]); await p.waitForTimeout(750); await touch('touchEnd', []); await p.waitForTimeout(250);
  const lpEnt = await menuItems();
  ok(!!lpEnt && lpEnt.includes('Smazat') && lpEnt.includes('Okótovat') && (await handles()) >= 2, `dlouhý stisk na straně obdélníku: nabídka entity (${lpEnt ? lpEnt.slice(0, 4).join(' · ') : 'nic'}) a obdélník je vybraný`);
  rect = await entity('rect');
  ok(rect.cx === cx0 && rect.cy === 20, 'dlouhý stisk s entitou nepohnul');
  await p.screenshot({ path: S + 'touch-longpress-entity.png' });
  await closeMenu(); await p.keyboard.press('Escape'); await p.waitForTimeout(200); // zavřít nabídku, zrušit výběr
  e0 = await topEdge();
  await p.mouse.click(e0.x, e0.y, { button: 'right' }); await p.waitForTimeout(250);
  const rcEnt = await menuItems();
  ok(!!rcEnt && JSON.stringify(rcEnt) === JSON.stringify(lpEnt), 'nabídka entity po dlouhém stisku = po pravém kliku');
  await closeMenu(); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // krátké klepnutí a stisk s pohybem nabídku neotevřou; drobné zachvění (pod 8 px) dlouhý stisk neruší
  await tap(free);
  ok((await menuItems()) === null, 'krátké klepnutí nabídku neotevře');
  await touch('touchStart', [free]); await p.waitForTimeout(60);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [{ x: free.x - i * 8, y: free.y + i * 4 }]); await p.waitForTimeout(25); }
  await p.waitForTimeout(700);
  const moved = await menuItems();
  await touch('touchEnd', []); await p.waitForTimeout(250);
  ok(moved === null && (await menuItems()) === null, 'stisk s pohybem (36 px) není dlouhý stisk – nabídka se neotevře');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await touch('touchStart', [free]); await p.waitForTimeout(60);
  await touch('touchMove', [{ x: free.x + 3, y: free.y - 3 }]); await p.waitForTimeout(700);
  const jitter = await menuItems();
  await touch('touchEnd', []); await p.waitForTimeout(200);
  ok(!!jitter, 'drobné zachvění prstu (4 px) dlouhý stisk neruší');
  await closeMenu();
  // v kreslicím nástroji ukončí dlouhý stisk rozpracovaný krok (jako pravé tlačítko) – bez nabídky
  const n2 = await count();
  await p.keyboard.press('l'); await p.waitForTimeout(100);
  const L1 = { x: bxl.x + 420, y: bxl.y + 70 }; // prázdný horní okraj
  await tap(L1); // první bod
  await touch('touchStart', [{ x: L1.x + 60, y: L1.y + 10 }]); await p.waitForTimeout(750);
  const lpTool = await menuItems();
  await touch('touchEnd', []); await p.waitForTimeout(250);
  await tap({ x: L1.x + 100, y: L1.y }); await tap({ x: L1.x + 180, y: L1.y }); // nový řetěz: vznikne jen jedna úsečka
  await esc2();
  ok(lpTool === null && (await count()) === n2 + 1, `dlouhý stisk při kreslení úsečky ukončil řetěz bez nabídky (přibylo úseček: ${(await count()) - n2}, ne 2)`);

  // ═══ 8. myš a kolečko beze změny ═══
  await p.keyboard.press('f'); await p.waitForTimeout(400);
  const m0 = await viewOf();
  const mc = { x: bxl.x + bxl.width / 2 - 40, y: bxl.y + bxl.height / 2 + 30 };
  await p.mouse.move(mc.x, mc.y); await p.mouse.wheel(0, -200); await p.waitForTimeout(300);
  const m1 = await viewOf();
  const kw = m1.scale / m0.scale;
  ok(near(kw, Math.exp(0.3), 0.03) && near(m1.ox, mc.x + (m0.ox - mc.x) * kw, 2.5) && near(m1.oy, mc.y + (m0.oy - mc.y) * kw, 2.5), `kolečko přibližuje ke kurzoru jako dřív (poměr ${kw.toFixed(3)} ≈ ${Math.exp(0.3).toFixed(3)})`);
  await p.mouse.move(mc.x, mc.y); await p.mouse.down({ button: 'middle' }); await p.mouse.move(mc.x + 45, mc.y + 25, { steps: 4 }); await p.mouse.up({ button: 'middle' }); await p.waitForTimeout(250);
  const m2 = await viewOf();
  ok(near(m2.ox - m1.ox, 45, 1.5) && near(m2.oy - m1.oy, 25, 1.5), `prostřední tlačítko posouvá (o [${r1(m2.ox - m1.ox)}; ${r1(m2.oy - m1.oy)}] px)`);
  await p.mouse.move(mc.x, mc.y); await p.mouse.down({ button: 'right' }); await p.mouse.move(mc.x - 30, mc.y + 20, { steps: 4 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(250);
  const m3 = await viewOf();
  ok(near(m3.ox - m2.ox, -30, 1.5) && near(m3.oy - m2.oy, 20, 1.5) && (await menuItems()) === null, 'pravé tlačítko s tahem posouvá a nabídku neotevře');
  await p.keyboard.press('f'); await p.waitForTimeout(400);
  const n3 = await count();
  await p.keyboard.press('r'); await p.waitForTimeout(100);
  const fbx = await canvas();
  await p.mouse.click(fbx.x + 40, fbx.y + 90); await p.mouse.click(fbx.x + 110, fbx.y + 150); await p.waitForTimeout(300);
  await esc2();
  ok((await count()) === n3 + 1, 'levé tlačítko myši kreslí jako dřív (obdélník dvěma kliky)');
  await p.mouse.click(fbx.x + 40, fbx.y + 90); await p.waitForTimeout(250); // klik na roh nového obdélníku ho vybere
  ok((await handles()) >= 2, 'klik myší vybírá jako dřív');
  await p.keyboard.press('Delete'); await p.waitForTimeout(250);
  ok((await count()) === n3, 'Delete smazal vybranou entitu');
  await p.screenshot({ path: S + 'touch-final-sketch.png' });

  // ═══ 9. nastavitelné zkratky skici ═══
  await esc2();
  for (const [k, t] of [['c', 'circle'], ['a', 'arc'], ['d', 'dimension'], ['v', 'select']]) { await p.keyboard.press(k); await p.waitForTimeout(80); ok((await tool()) === t, `výchozí zkratka ${k.toUpperCase()} → ${t}`); }
  await p.keyboard.press('Control+,');
  await p.getByRole('button', { name: 'Klávesové zkratky' }).click(); await p.waitForTimeout(300);
  const groups = await p.evaluate(() => [...document.querySelectorAll('[data-shortcut-group]')].map((g) => ({ id: g.dataset.shortcutGroup, title: g.querySelector('h3').textContent, rows: g.querySelectorAll('[data-shortcut]').length })));
  ok(groups.length === 2 && groups[0].id === 'model' && groups[1].id === 'sketch' && groups[1].title === 'Skica' && groups[1].rows >= 16, `Nastavení → Klávesové zkratky: skupiny ${groups.map((g) => `${g.title} (${g.rows})`).join(' + ')}`);
  const keyOf = (id) => p.evaluate((id) => { const k = document.querySelector(`[data-shortcut="${id}"] kbd`); return k ? k.textContent : ''; }, id);
  ok((await keyOf('sketch.line')) === 'L' && (await keyOf('sketch.ellipse')) === 'E' && (await keyOf('feature.extrude')) === 'E', 'výchozí: Úsečka = L; stejná klávesa E je ve 3D (Vysunutí) i ve skice (Elipsa)');
  await p.locator('[data-shortcut-group="sketch"]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: S + 'touch-shortcuts-settings.png' });
  const record = async (id, key) => { await p.locator(`[data-shortcut="${id}"] button`).first().click(); await p.waitForTimeout(100); await p.keyboard.press(key); await p.waitForTimeout(150); };
  await record('sketch.line', 'q');
  await record('sketch.measure', 'c'); // duplicita s Kružnicí (C) – nezakazuje se, vyhrává dřívější příkaz
  ok((await keyOf('sketch.line')) === 'Q' && (await keyOf('sketch.measure')) === 'C', 'záznam zkratek: Úsečka = Q, Měřit = C');
  ok((await tool()) === 'select', `klávesy stisknuté při záznamu nespustily příkaz skici (nástroj ${await tool()})`);
  await p.getByRole('button', { name: 'OK', exact: true }).click(); await p.waitForTimeout(300);
  await p.keyboard.press('q'); await p.waitForTimeout(100);
  ok((await tool()) === 'line', `nová zkratka Q platí hned, bez znovunačtení (nástroj ${await tool()})`);
  await p.keyboard.press('v'); await p.keyboard.press('l'); await p.waitForTimeout(100);
  ok((await tool()) === 'select', `původní klávesa L už úsečku nevybírá (nástroj ${await tool()})`);
  await p.keyboard.press('c'); await p.waitForTimeout(100);
  ok((await tool()) === 'circle', `duplicitní C (Kružnice i Měřit): provede se dřívější příkaz v seznamu (nástroj ${await tool()})`);
  await p.keyboard.press('m'); await p.waitForTimeout(100);
  ok((await tool()) === 'circle', 'uvolněná klávesa M nic nedělá');
  await p.keyboard.press('v'); await p.waitForTimeout(100);
  ok((await p.locator('button[title^="Úsečka (Q)"]').count()) >= 1, 'pás karet ukazuje novou klávesu: „Úsečka (Q)“');
  const stored = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').shortcuts || {}, SETTINGS_KEY);
  ok(stored['sketch.line'] === 'Q' && stored['feature.extrude'] === 'E' && stored['sketch.ellipse'] === 'E', 'uloženo v nastavení (sketch.line = Q; klávesa E zároveň pro 3D i skicu)');
  // dříve uložené nastavení bez příkazů skici: po načtení platí výchozí klávesy skici
  await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ rev: 3, startScreen: false, shortcuts: { 'view.fit': 'F', 'sketch.new': 'S' } })), SETTINGS_KEY);
  p.on('dialog', (d) => d.accept().catch(() => {})); // „neuložené změny“ při opuštění stránky
  await p.reload({ waitUntil: 'networkidle', timeout: 240000 }); await start(p);
  await p.evaluate(() => window.mncad.run('nový díl Staré nastavení')); await p.waitForTimeout(500);
  await p.keyboard.press('s');
  await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
  await p.keyboard.press('r'); await p.waitForTimeout(100);
  const tOld = await tool();
  await p.keyboard.press('q'); await p.waitForTimeout(100);
  ok(tOld === 'rect' && (await tool()) === 'rect', `dříve uložené nastavení bez zkratek skici: platí výchozí (R → ${tOld}, Q nic)`);

  // ═══ 10. angličtina: skupina zkratek skici a její popisky jsou přeložené ═══
  await p.goto(BASE + '/en/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Loading the OpenCascade/.test(document.body.innerText), null, { timeout: 180000 });
  await p.waitForTimeout(800);
  await p.keyboard.press('Control+,');
  await p.getByRole('button', { name: 'Keyboard shortcuts' }).click(); await p.waitForTimeout(300);
  const en = await p.evaluate(() => {
    const label = (id) => { const s = document.querySelector(`[data-shortcut="${id}"] span`); return s ? s.textContent : ''; };
    const hint = document.querySelector('[data-shortcut-group="sketch"] p');
    return { titles: [...document.querySelectorAll('[data-shortcut-group] h3')].map((h) => h.textContent), line: label('sketch.line'), horizontal: label('sketch.horizontal'), dim: label('sketch.dimension'), hint: hint ? hint.textContent : '' };
  });
  ok(en.titles.join(' | ') === '3D model | Sketch' && en.line === 'Line' && en.dim === 'Dimension' && en.horizontal === 'Horizontal constraint (selected entities)' && /sketch is open/.test(en.hint), `EN: skupiny „${en.titles.join('“ + „')}“, popisky ${en.line} / ${en.dim} / ${en.horizontal}`);
  const miss = await p.evaluate(() => window.mncad.missing().filter((k) => /\p{L}{3,}/u.test(k.replace(/\{\d+\}/g, ' '))));
  ok(miss.length === 0, `EN: žádný chybějící překlad v Nastavení → Klávesové zkratky${miss.length ? ': ' + miss.slice(0, 5).join(' | ') : ''}`);
  await p.screenshot({ path: S + 'touch-shortcuts-en.png' });

  ok(errs.length === 0, `bez chyb stránky${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  ok(conErrs.length === 0, `bez chyb v konzoli${conErrs.length ? ': ' + conErrs.slice(0, 3).join(' | ') : ''}`);
  await b.close();
})().catch((e) => { console.log('FAIL: skript spadl – ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); process.exit(1); });
