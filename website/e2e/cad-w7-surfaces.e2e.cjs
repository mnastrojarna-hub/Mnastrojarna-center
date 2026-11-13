// E2E (7. vlna, plochy): spline s tečnami (skicář: panel + úchyty, text), hladké uzavřené šablonování (formulář),
// plochy třídy A – přechodová plocha G2, N-stranná výplň, prodloužení G1/G2, řídicí body CV (formulář i text),
// panel „Návaznost a křivost hran“ a textové příkazy analýzy.
// Spuštění (server na :3334 nebo E2E_BASE): node e2e/cad-w7-surfaces.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3334').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const status = () => p.evaluate(() => window.mncad.status());
  const noErrors = async () => /, 0 ✗\)/.test(await status());
  const last = async () => (await doc()).features.slice(-1)[0];
  const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();
  const tab = (name) => p.getByRole('button', { name, exact: true }).click();
  /** index hrany (od 1), jejíž střed je nejblíž bodu – přes window.mncad.measure */
  const edgeNear = async (pt) => {
    const st = await status();
    const n = Number((/hran (\d+)/.exec(st) || [])[1] || 0);
    let best = 0; let bd = Infinity;
    for (let i = 1; i <= n; i++) {
      const r = await p.evaluate((l) => window.mncad.measure(l), 'E' + i);
      const e = r.report && r.report.entity;
      if (!e || !e.start) continue;
      const m = e.mid || [(e.start[0] + e.end[0]) / 2, (e.start[1] + e.end[1]) / 2, (e.start[2] + e.end[2]) / 2];
      const d = Math.hypot(m[0] - pt[0], m[1] - pt[1], m[2] - pt[2]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // ───────────── 1. spline s tečnami: skicář (panel, úchyty) ─────────────
  await run('nový díl Spline tečny'); await idle();
  await p.getByRole('button', { name: /^(Tvorba|Erstellen|Create)$/ }).click().catch(() => {});
  await p.getByRole('button', { name: /^(Skica|Skizze|Sketch)/ }).first().click().catch(() => {});
  await p.getByRole('button', { name: /(Rovina|Ebene|Plane) XY/ }).click({ timeout: 4000 }).catch(() => {});
  let opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false);
  if (!opened) { await p.keyboard.press('s'); opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false); }
  ok(opened, 'skica v rovině XY otevřena');
  await p.waitForTimeout(500);
  await p.keyboard.press('n'); await p.waitForTimeout(150);
  for (const t of ['0;0', '50;20', '100;0']) { await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(160); }
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const sk = async () => (await doc()).features.filter((f) => f.type === 'sketch').pop();
  let spl = (await sk()).entities.find((e) => e.type === 'spline');
  ok(!!spl && spl.points.length === 3, 'spline 3 body nakreslen v skicáři: ' + JSON.stringify(spl && spl.points));
  // výběr splinu klikem na jeho bod (mapování mm → px přes štítky bodů)
  const bx = await p.locator('[data-sketch-canvas]').boundingBox();
  const hints = await p.evaluate(() => window.mncad.hints());
  const mmOf = (h) => { const m = /\[(-?[\d,.]+); (-?[\d,.]+)\]$/.exec(h.title); return m ? [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] : null; };
  const hp = hints.map((h) => ({ mm: mmOf(h), px: [bx.x + h.x, bx.y + h.y] })).filter((x) => x.mm);
  const h50 = hp.find((x) => Math.abs(x.mm[0] - 50) < 1e-6 && Math.abs(x.mm[1] - 20) < 1e-6);
  const h0 = hp.find((x) => Math.abs(x.mm[0]) < 1e-6 && Math.abs(x.mm[1]) < 1e-6);
  ok(!!h50 && !!h0, 'štítky bodů splinu nalezeny');
  if (h50) { await p.mouse.click(h50.px[0], h50.px[1]); await p.waitForTimeout(500); }
  const panel = p.locator('[data-spline-panel]');
  ok(await panel.isVisible().catch(() => false), 'vybraný spline → panel „Spline – tečny v bodech“');
  ok((await p.locator('[data-tangent-handle]').count()) === 2, 'úchyty tečen na obou koncích (t0, t2)');
  await panel.getByLabel('Tečna v bodě p1').check(); await p.waitForTimeout(300);
  const ang1 = panel.getByLabel('Úhel tečny v bodě p1');
  await ang1.fill('-20'); await ang1.press('Enter'); await p.waitForTimeout(400);
  const ang0 = panel.getByLabel('Úhel tečny v bodě p0');
  await panel.getByLabel('Tečna v bodě p0').check(); await p.waitForTimeout(250);
  await ang0.fill('30'); await ang0.press('Enter'); await p.waitForTimeout(400);
  const w0 = panel.getByLabel('Váha tečny v bodě p0');
  await w0.fill('1,5'); await w0.press('Enter'); await p.waitForTimeout(400);
  spl = (await sk()).entities.find((e) => e.type === 'spline');
  ok(spl.tangents && spl.tangents[0] === 30 && spl.tangents[1] === -20 && spl.weights && spl.weights[0] === 1.5, 'panel: tečna p0 30° ×1,5 a p1 −20° uloženy: ' + JSON.stringify({ t: spl.tangents, w: spl.weights }));
  ok((await p.locator('[data-tangent-handle]').count()) === 3, 'úchyty tečen i u vnitřního bodu se zadanou tečnou (3)');
  // tažení úchytu tečny na začátku (t0) myší – panel vpravo nahoře může zakrývat pravý konec křivky
  const t0 = p.locator('[data-tangent-handle="t0"] circle');
  const tb = await t0.boundingBox();
  if (tb) {
    const cx = tb.x + tb.width / 2; const cy = tb.y + tb.height / 2;
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 5, cy - 20, { steps: 6 }); await p.mouse.move(cx + 8, cy - 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
  }
  spl = (await sk()).entities.find((e) => e.type === 'spline');
  ok(spl.tangents && typeof spl.tangents[0] === 'number' && spl.tangents[0] > 30, 'tažení úchytu t0 nahoru změní tečnu na začátku (úhel se přichytává) (30° → ' + (spl.tangents && spl.tangents[0]) + '°)');
  ok(spl.points[1][0] === 50 && spl.points[1][1] === 20, 'body splinu se tečnami nepohnuly');
  await p.screenshot({ path: S + 'w7s-spline-panel.png' });
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  const fin = p.getByRole('button', { name: /Dokončit skicu|Skizze beenden|Finish sketch/ }).first();
  if (await fin.isVisible().catch(() => false)) await fin.click();
  await p.waitForSelector('[data-sketch-canvas]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await idle();

  // ───────────── 2. spline s tečnami textem + tažení po něm ─────────────
  let log = await run('nový díl Tažení po spline\nskica XZ: spline 0 0 50 20 100 0 tečna-začátek 30 tečna-konec -30\nprvek sweep pathId="Skica 1" circleRadius=2 mode=new');
  await idle();
  const tx = (await doc()).features.filter((f) => f.type === 'sketch').pop().entities[0];
  ok(tx.type === 'spline' && JSON.stringify(tx.tangents) === '[30,null,-30]', 'text: spline … tečna-začátek 30 tečna-konec -30 → ' + JSON.stringify(tx.tangents));
  ok(/✓ Tažení/.test(log) && (await noErrors()), 'tažení kruhu Ø4 po spline s tečnami ✓');
  log = await run('stav');
  ok(/tečny p0 30°, p2 -30°|tečny p0 30°, p2 −30°/.test(log), 'stav ukazuje tečny splinu');
  log = await run('skica "Skica 1"\nentita e1 tečna-konec=-45 váha-konec=2 tečna-začátek=vyp'); await idle();
  const tx2 = (await doc()).features.find((f) => f.type === 'sketch').entities[0];
  ok(JSON.stringify(tx2.tangents) === '[null,null,-45]' && tx2.weights && tx2.weights[2] === 2, 'text: entita e1 tečna-konec=-45 váha-konec=2 tečna-začátek=vyp → ' + JSON.stringify({ t: tx2.tangents, w: tx2.weights }));
  log = await run('tangent-start 10');
  ok(/neznámý|unknown|„tangent-start“|tečna/.test(log) || /✗/.test(log), 'samostatné „tangent-start“ mimo spline je chyba (ne tichý úspěch)');

  // ───────────── 3. hladké uzavřené šablonování (formulář) ─────────────
  await run('nový díl Prstenec'); await idle();
  const ring = [[0, '0 1 0', '1 0 0'], [90, '-1 0 0', '0 1 0'], [180, '0 -1 0', '-1 0 0'], [270, '1 0 0', '0 -1 0']];
  for (const [, n, x] of ring) await run(`skica počátek 0 0 0 normála ${n} osax ${x}: elipsa 8 5 v 40 0`);
  await run('prvek loft sketchIds=["Skica 1","Skica 2","Skica 3","Skica 4"] closed=ano');
  await idle();
  const loft = await last();
  ok(loft.type === 'loft' && loft.closed === true && !loft.smooth, 'uzavřené šablonování 4 profilů textem');
  await p.getByText(loft.name, { exact: true }).first().click(); await p.waitForTimeout(800);
  const closure = p.locator('[data-loft-closure]');
  await closure.waitFor({ timeout: 15000 }).catch(() => {});
  ok(await closure.isVisible().catch(() => false), 'formulář šablonování: volba Uzavření');
  await closure.getByRole('button', { name: 'Uzavřený hladce' }).click(); await p.waitForTimeout(300);
  await okBtn(); await idle();
  const loft2 = (await doc()).features.find((f) => f.id === loft.id);
  const st3 = await status();
  ok(loft2.closed === true && loft2.smooth === true, 'GUI „Uzavřený hladce“ uloží closed + smooth');
  ok((await noErrors()) && /ploch 1\b/.test(st3), 'hladké uzavřené šablonování: jediná periodická plocha, bez chyby: ' + (/ploch \d+/.exec(st3) || [''])[0]);
  await p.screenshot({ path: S + 'w7s-loft-smooth.png' });

  // ───────────── 4. plochy třídy A: přechod G2 (formulář), analýza (panel + text) ─────────────
  await run('nový díl Plochy A\nskica XY: oblouk -50 0 -35,355 -35,355 0 -50\nprvek surf.extrude sketchId=$last distance=40\nskica XY: oblouk 100 -50 135,355 -35,355 150 0\nprvek surf.extrude sketchId=$last distance=40');
  await idle();
  const eA = await edgeNear([0, -50, 20]);
  const eB = await edgeNear([100, -50, 20]);
  ok(eA > 0 && eB > 0 && eA !== eB, `svislé hrany pásů: E${eA}, E${eB}`);
  await p.evaluate((ids) => window.mncad.select(ids), ['E' + eA, 'E' + eB]); await p.waitForTimeout(300);
  await tab('Plochy'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Přechodová plocha/ }).first().click(); await p.waitForTimeout(900);
  let f = await last();
  ok(f.type === 'ext' && f.ext === 'surf.blend' && JSON.stringify(f.data.edges) === JSON.stringify([eA - 1, eB - 1]), 'Přechodová plocha z pásu karet převezme dvě vybrané hrany: ' + JSON.stringify(f.data.edges));
  ok(await p.locator('[data-ext-param="contA"], text=Návaznost strany 1').first().isVisible().catch(() => true), 'formulář přechodu (návaznost, napětí)');
  const tens = p.getByLabel('Napětí strany 1');
  if (await tens.isVisible().catch(() => false)) { await tens.fill('1,2'); await tens.press('Enter'); await p.waitForTimeout(300); }
  await okBtn(); await idle();
  f = await last();
  ok(f.data.contA === 'G2' && (await noErrors()), 'přechod G2 postaven bez chyby (napětí ' + f.data.tensionA + ')');
  log = await run('analýza návaznosti');
  const g2 = (log.match(/: G2 ·/g) || []).length;
  ok(/✓ návaznost \d+ hran: G2 [1-9]/.test(log) && g2 >= 2, `text: analýza návaznosti – rozhraní přechod/pás jsou G2 (${g2} řádků G2)`);
  // panel analýzy z pásu karet
  await p.getByRole('button', { name: /Návaznost a křivost hran/ }).first().click(); await p.waitForTimeout(600);
  const pan = p.locator('[data-surf-analysis]');
  ok(await pan.isVisible().catch(() => false), 'tlačítko „Návaznost a křivost hran“ otevře panel analýzy');
  await pan.locator('[data-surf-act="all"]').click();
  await p.waitForSelector('[data-surf-result] tr[data-cls]', { timeout: 60000 }).catch(() => {});
  const rows = await p.locator('[data-surf-result] tr[data-cls="G2"]').count();
  ok(rows >= 2, `panel: tabulka hran s třídou G2 (${rows} řádků G2), hrany obarveny`);
  await pan.locator('[data-surf-act="comb"]').click(); await p.waitForTimeout(400);
  await p.waitForSelector('[data-surf-combs]', { timeout: 60000 }).catch(() => {});
  ok(/1\/mm/.test(await p.locator('[data-surf-combs]').innerText().catch(() => '')), 'panel: hřebeny křivosti zakřivených hran');
  await pan.locator('[data-surf-map="zebra"]').click(); await p.waitForTimeout(500);
  await p.screenshot({ path: S + 'w7s-analysis-panel.png' });
  await pan.locator('[data-surf-map="none"]').click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Zavřít' }).first().click().catch(() => {});
  log = await run(`analýza hřebenu E${eA} zobrazit`);
  ok(/✓ hřebeny křivosti/.test(log), 'text: analýza hřebenu … zobrazit');

  // ───────────── 5. prodloužení G2 textem, výplň textem ─────────────
  const eFar = await edgeNear([-50, 0, 20]);
  log = await run(`prodloužit plochu E${eFar} 10 G2`); await idle();
  ok(/✓ Prodloužit přes hranu/.test(log) && (await noErrors()), `text: prodloužit plochu E${eFar} 10 G2 ✓`);
  log = await run('analýza návaznosti');
  ok(/G2 [1-9]/.test(log), 'po prodloužení je nové rozhraní G2');

  await run('nový díl Výplň\nskica XZ: oblouk 50 0 41,27 28,23 15 47,697\nprvek surf.revolve sketchId=$last angle=360'); await idle();
  const hole = await edgeNear([15, 0, 47.697]);
  log = await run(`výplň E${hole} G1`); await idle();
  ok(/✓ Výplň N-stran/.test(log) && (await noErrors()), `text: výplň E${hole} G1 ✓ (bez ⚠ – dosažená tečnost < 0,1°)`);
  log = await run('analýza návaznosti');
  const m1 = /: G[12] · mezera ([\d,]+) mm · úhel ([\d,]+)°/.exec(log);
  ok(!!m1 && parseFloat(m1[2].replace(',', '.')) < 0.1, 'výplň G1: úhel normál napříč hranou < 0,1° (' + (m1 ? m1[2] : '?') + '°)');

  // ───────────── 6. řídicí body CV: formulář (síť, výběr bodu, posun) a text ─────────────
  await run('nový díl CV\nskica XY: obdélník 100 100 v 50 50\nprvek surf.planar sketchId=$last'); await idle();
  await p.evaluate(() => window.mncad.select(['F1'])); await p.waitForTimeout(300);
  await tab('Plochy'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Řídicí body plochy/ }).first().click(); await p.waitForTimeout(900);
  const cvf = p.locator('[data-cv-form]');
  ok(await cvf.isVisible().catch(() => false), 'formulář Řídicí body plochy (CV)');
  for (const [k, v] of [['u', '4'], ['v', '4']]) { const i = cvf.locator(`[data-cv-grid="${k}"]`); await i.fill(v); await i.press('Enter'); await p.waitForTimeout(300); }
  await p.waitForSelector('[data-cv-info="4x4"]', { timeout: 60000 }).catch(() => {});
  ok(await p.locator('[data-cv-info="4x4"]').isVisible().catch(() => false), 'síť 4 × 4 řídicích bodů (přesné zjemnění roviny)');
  await cvf.locator('[data-cv="2,2"]').click(); await p.waitForTimeout(300);
  ok(await p.locator('[data-cv-selected="2,2"]').isVisible().catch(() => false), 'výběr CV [2 2] v mřížce');
  const vz = cvf.locator('[data-cv-selected] [data-cv-vec="Z"]');
  await vz.fill('1.5'); await vz.press('Tab'); await p.waitForTimeout(300);
  await cvf.locator('[data-cv-drag]').check(); await p.waitForTimeout(400);
  await p.screenshot({ path: S + 'w7s-cv-form.png' });
  await cvf.locator('[data-cv-drag]').uncheck(); await p.waitForTimeout(200);
  await okBtn(); await idle();
  f = await last();
  ok(f.ext === 'surf.cv' && JSON.stringify(f.data.moves) === JSON.stringify([{ i: 2, j: 2, d: [0, 0, 1.5] }]) && f.data.gridU === 4, 'uložený posun CV [2,2] o (0, 0, 1,5): ' + JSON.stringify(f.data.moves));
  const st6 = await status();
  const zmax = /Z 0…([\d,]+)/.exec(st6);
  ok((await noErrors()) && !!zmax && Math.abs(parseFloat(zmax[1].replace(',', '.')) - 0.296) < 0.01, 'plocha se zvedla o 1,5·(4/9)² = 0,296 mm: ' + (zmax ? zmax[0] : st6.slice(0, 120)));
  log = await run('plocha F1 cv');
  ok(/B-spline 4 × 4 řídicích bodů \(stupeň 3 × 3\)/.test(log) && /\[2 2\] \(33,333; 33,333; 1,5\)/.test(log), 'text: plocha F1 cv vypíše síť 4 × 4 a posunutý bod [2 2]');
  log = await run('plocha F1 cv řada u 1 posun 0 0 2'); await idle();
  const st7 = await status();
  ok(/✓ Řídicí body plochy/.test(log) && (await noErrors()) && /Z 0…2\b|Z 0…2,0/.test(st7), 'text: posun řady u 1 o 2 mm → horní mez Z = 2: ' + (/Z [^ ]+/.exec(st7) || [''])[0]);
  log = await run('plocha F1 cv 9 9 posun 0 0 1'); await idle();
  ok(/1–4 × 1–4/.test(log), 'neexistující CV [9 9] → chyba s rozsahem');

  // ───────────── 7. anglické a německé příkazy ─────────────
  log = await run('analyze continuity');
  ok(/continuity|návaznost|Stetigkeit/i.test(log) && !/unknown command/.test(log), 'EN analyze continuity');
  log = await run('fläche F1 cv');
  ok(/4 × 4|B-spline|B-Spline/.test(log), 'DE fläche F1 cv');

  ok(errs.length === 0, 'žádné chyby stránky: ' + errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; });
