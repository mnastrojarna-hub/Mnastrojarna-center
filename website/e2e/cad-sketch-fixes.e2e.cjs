// E2E: opravy skicáře po kontrole – zpožděné načtení podkladu po zavření skici / přepnutí záložky nic nepřepíše,
// přesun / otočení entit zadaných souřadnicemi (vazba „Pevně“ jde s nimi), „@“ psané přes AltGr, textová vazba jde do
// skici otevřené ve skicáři, podklad smazané skici se neuloží, pole šířky podkladu v němčině bez oddělovače tisíců.
// Spuštění: E2E_BASE=http://localhost:3302 node e2e/cad-sketch-fixes.e2e.cjs <složka>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const nearPt = (p, q, tol = 0.01) => !!p && near(p[0], q[0], tol) && near(p[1], q[1], tol);

async function open(b, path) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText(/Pokračovat v práci|Weiter arbeiten|Continue working/);
  if (await c.first().isVisible({ timeout: 6000 }).catch(() => false)) await c.first().click();
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Lade Kern|Loading kernel/.test(document.body.innerText), null, { timeout: 180000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}

function helpers(p) {
  const docOf = () => p.evaluate(() => window.mncad.getDocument());
  const sketch = async () => (await docOf()).features.filter((f) => f.type === 'sketch').pop();
  const flash = async () => (await p.locator('div.pointer-events-none.absolute.left-1\\/2.top-14').first().textContent({ timeout: 1500 }).catch(() => '')) || '';
  const typeEnter = async (t) => { await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(160); };
  const esc2 = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200); };
  const openSketch = async () => {
    await p.getByRole('button', { name: /^(Tvorba|Erstellen|Create)$/ }).click().catch(() => {});
    await p.getByRole('button', { name: /^(Skica|Skizze|Sketch)/ }).first().click().catch(() => {});
    await p.getByRole('button', { name: /(Rovina|Ebene|Plane) XY/ }).click({ timeout: 4000 }).catch(() => {});
    let opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 6000 }).then(() => true, () => false);
    if (!opened) { await p.keyboard.press('s'); opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 6000 }).then(() => true, () => false); }
    await p.waitForTimeout(500);
    return opened;
  };
  const finish = async () => {
    await esc2();
    const fin = p.getByRole('button', { name: /Dokončit skicu|Skizze beenden|Finish sketch/ }).first();
    if (await fin.isVisible().catch(() => false)) await fin.click();
    await p.waitForSelector('[data-sketch-canvas]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(300);
  };
  const canvas = () => p.locator('[data-sketch-canvas]').boundingBox();
  const hints = () => p.evaluate(() => window.mncad.hints());
  const hintMm = (h) => { const m = /\[(-?[\d,.]+); (-?[\d,.]+)\]$/.exec(h.title); return m ? [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] : null; };
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
  return { docOf, sketch, flash, typeEnter, esc2, openSketch, finish, canvas, viewOf, at };
}

const pdfBytes = () => {
  const { jsPDF } = require('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  pdf.line(20, 20, 120, 20);
  pdf.circle(200, 60, 25);
  return Buffer.from(pdf.output('arraybuffer'));
};

/** začne načítat podklad PDF (čtečka PDF je zpožděná o `delay` ms) a vrátí se, když skicář ukazuje „Načítám…“ */
async function startSlowUnderlay(p, delay) {
  await p.route('**/vendor/pdfjs-*/pdf.min.mjs', async (r) => { await new Promise((res) => setTimeout(res, delay)); await r.continue(); });
  const chooser = p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await p.locator('[data-ribbon] button[aria-label^="Podklad…"]').first().click();
  const fc = await chooser;
  if (!fc) return false;
  await fc.setFiles({ name: 'vykres.pdf', mimeType: 'application/pdf', buffer: pdfBytes() });
  await p.waitForTimeout(400);
  return /Načítám/.test((await p.locator('[data-ul-busy]').textContent({ timeout: 3000 }).catch(() => '')) || '');
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ═══════ A. podklad se načítá, skica se zavře a přibude prvek → po načtení prvek zůstane ═══════
  {
    const { ctx, p, errs } = await open(b, '/cad');
    const h = helpers(p);
    await p.evaluate(() => window.mncad.run('nový díl Race\nkvádr 100 50 20'));
    await p.waitForTimeout(600);
    ok(await h.openSketch(), 'A: skica otevřená');
    ok(await startSlowUnderlay(p, 6000), 'A: podklad se načítá (čtečka PDF zpožděná)');
    await h.finish();
    ok((await p.locator('[data-sketch-canvas]').count()) === 0, 'A: skicář zavřený během načítání');
    await p.evaluate(() => window.mncad.run('válec 10 30 v 20 20 20'));
    const before = (await h.docOf()).features.map((f) => f.type).join(',');
    ok(before === 'box,sketch,cylinder', `A: před dokončením načítání ${before}`);
    await p.waitForTimeout(9000);
    const d = await h.docOf();
    const after = d.features.map((f) => f.type).join(',');
    ok(after === 'box,sketch,cylinder', `A: po dokončení načítání prvky zůstaly (${after})`);
    ok(!d.underlays, `A: podklad zavřené skice se nezapsal (${Object.keys(d.underlays || {}).length})`);
    ok(errs.length === 0, `A: bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await ctx.close();
  }

  // ═══════ B. podklad se načítá, uživatel otevře jinou záložku → po načtení jiný dokument nepřepsán ═══════
  {
    const { ctx, p, errs } = await open(b, '/cad');
    const h = helpers(p);
    await p.evaluate(() => window.mncad.run('nový díl Race\nkvádr 100 50 20'));
    await p.waitForTimeout(600);
    ok(await h.openSketch(), 'B: skica otevřená');
    ok(await startSlowUnderlay(p, 6000), 'B: podklad se načítá');
    await p.evaluate(() => window.mncad.run('nový díl Druhy\nválec 10 30'));
    await p.waitForTimeout(500);
    let d = await h.docOf();
    ok(d.name === 'Druhy' && d.features.map((f) => f.type).join(',') === 'cylinder', `B: aktivní je nový díl (${d.name}: ${d.features.map((f) => f.type)})`);
    await p.waitForTimeout(9000);
    d = await h.docOf();
    ok(d.name === 'Druhy' && d.features.map((f) => f.type).join(',') === 'cylinder' && !d.underlays, `B: po načtení podkladu je „Druhy“ beze změny (${d.name}: ${d.features.map((f) => f.type)}, podklady ${Object.keys(d.underlays || {}).length})`);
    ok(errs.length === 0, `B: bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await ctx.close();
  }

  // ═══════ C–F. přesun ukotvených entit, AltGr, textová vazba do otevřené skici, podklad smazané skici ═══════
  {
    const { ctx, p, errs } = await open(b, '/cad');
    const h = helpers(p);
    // C. přesun: úsečka myší i úsečka zadaná souřadnicemi (ukotvená „Pevně“) se posunou o stejný vektor
    await p.evaluate(() => window.mncad.run('nový díl Presun'));
    await p.waitForTimeout(500);
    ok(await h.openSketch(), 'C: skica otevřená');
    const bx = await h.canvas();
    await p.keyboard.press('l'); await p.waitForTimeout(120);
    await p.mouse.click(bx.x + bx.width * 0.3, bx.y + bx.height * 0.5); await p.waitForTimeout(150);
    await p.mouse.click(bx.x + bx.width * 0.6, bx.y + bx.height * 0.3); await p.waitForTimeout(150);
    await h.esc2();
    await p.keyboard.press('l'); await p.waitForTimeout(120);
    await h.typeEnter('0;0'); await h.typeEnter('30;10');
    await h.esc2();
    const lines = async () => (await h.sketch()).entities.filter((e) => e.type === 'line').map((l) => [l.a, l.b]);
    const L0 = await lines();
    const fixed = ((await h.sketch()).constraints || []).filter((c) => c.type === 'fixed').length;
    ok(L0.length === 2 && fixed === 2, `C: dvě úsečky, ukotvení zadané ${fixed}`);
    await p.keyboard.press('Control+a'); await p.waitForTimeout(150);
    await p.locator('[data-ribbon] button[aria-label^="Přesunout"]').first().click();
    await p.waitForTimeout(200);
    const v = await h.viewOf();
    const from = [5, 40]; const to = [25, 60];
    const a = h.at(v, from); const c = h.at(v, to);
    await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
    await p.mouse.click(c.x, c.y); await p.waitForTimeout(600);
    const L1 = await lines();
    const dx = L1[0][0][0] - L0[0][0][0]; const dy = L1[0][0][1] - L0[0][0][1];
    ok(Math.hypot(dx, dy) > 5, `C: úsečka kreslená myší se posunula o [${dx.toFixed(2)}; ${dy.toFixed(2)}]`);
    ok(nearPt(L1[1][0], [L0[1][0][0] + dx, L0[1][0][1] + dy], 0.02) && nearPt(L1[1][1], [L0[1][1][0] + dx, L0[1][1][1] + dy], 0.02), `C: ukotvená úsečka se posunula stejně: ${JSON.stringify(L1[1])}`);
    const fx = ((await h.sketch()).constraints || []).filter((q) => q.type === 'fixed').map((q) => q.value);
    ok(fx.length === 2 && nearPt(fx[0], [L0[1][0][0] + dx, L0[1][0][1] + dy], 0.02) && nearPt(fx[1], [L0[1][1][0] + dx, L0[1][1][1] + dy], 0.02), `C: vazby „Pevně“ jdou s úsečkou: ${JSON.stringify(fx)}`);
    // otočení o 90° kolem počátku zadané číslem
    await p.keyboard.press('Control+a'); await p.waitForTimeout(150);
    await p.locator('[data-ribbon] button[aria-label^="Otočit"]').first().click();
    await p.waitForTimeout(200);
    const vr = await h.viewOf();
    const o = h.at(vr, [0, 0]);
    const r0 = h.at(vr, [10, 0]);
    await p.mouse.click(o.x, o.y); await p.waitForTimeout(200);
    await p.mouse.move(r0.x, r0.y); await p.waitForTimeout(150);
    await p.mouse.click(r0.x, r0.y); await p.waitForTimeout(200);
    const c0 = (await h.sketch()).entities.length;
    await h.typeEnter('90'); await p.waitForTimeout(500); // úhel číslem (střed z kliknutí – uchopí se k počátku)
    const L2 = await lines();
    // střed otáčení = bod uchopený prvním kliknutím (počátek); kontrola nezávislá na středu: úsečka se otočí o 90°
    const dir = (l) => [l[1][0] - l[0][0], l[1][1] - l[0][1]];
    const d1 = dir(L1[1]); const d2 = dir(L2[1]);
    ok(c0 === (await h.sketch()).entities.length && nearPt(d2, [-d1[1], d1[0]], 0.01) && !nearPt(L2[1][0], L1[1][0], 1), `C: ukotvená úsečka se otočila o 90°: ${JSON.stringify(L1[1])} → ${JSON.stringify(L2[1])}`);
    await h.esc2();

    // D. relativní zadání „@“ psané přes AltGr (Windows hlásí Ctrl+Alt)
    await p.keyboard.press('l'); await p.waitForTimeout(120);
    await h.typeEnter('100;100');
    const key = (k, mods = {}) => p.evaluate(([k, m]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })), [k, mods]);
    await key('@', { ctrlKey: true, altKey: true });
    for (const ch of '10;5') await key(ch);
    await p.waitForTimeout(150);
    const dynText = (await p.locator('[data-sketch-dyn]').textContent().catch(() => '')) || '';
    ok(dynText.includes('@10;5'), `D: pole zadání ukazuje „@10;5“ (${JSON.stringify(dynText)})`);
    await key('Enter'); await p.waitForTimeout(250);
    await h.esc2();
    const last = (await h.sketch()).entities.filter((e) => e.type === 'line').pop();
    ok(nearPt(last.a, [100, 100]) && nearPt(last.b, [110, 105]), `D: úsečka [100;100]→[110;105]: ${JSON.stringify([last.a, last.b])}`);
    await h.finish();

    // E. textová vazba jde do skici otevřené ve skicáři, ne do poslední
    await p.evaluate(() => window.mncad.run('nový díl Dve\nskica XY: úsečka 0 0 50 5\nskica XZ: úsečka 0 0 40 7'));
    await p.waitForTimeout(600);
    await p.getByText('Skica 1', { exact: true }).first().dblclick().catch(() => {});
    const opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 6000 }).then(() => true, () => false);
    ok(opened, 'E: Skica 1 otevřená ve skicáři');
    const log = await p.evaluate(() => window.mncad.run('vazba vodorovně e1'));
    ok(/vazby ve skice „Skica 1“: vodorovně e1/.test(log), `E: protokol: ${log.split('\n')[0]}`);
    const sk = (await h.docOf()).features.filter((f) => f.type === 'sketch');
    ok((sk[0].constraints || []).map((q) => q.type).join() === 'horizontal' && !(sk[1].constraints || []).length, `E: vazba ve Skica 1, Skica 2 beze změny`);
    ok(near(sk[1].entities[0].b[1], 7), `E: úsečka Skica 2 nezměněna ${JSON.stringify(sk[1].entities[0].b)}`);
    const over = await p.evaluate(() => window.mncad.run('vazba vodorovně e1'));
    ok(/✗ vazba vodorovně e1 ve skice „Skica 1“ nepřidána – nadbytečná/.test(over), `E: nadbytečná vazba odmítnuta: ${over.split('\n')[0]}`);
    await h.finish();

    // F. podklad smazané skici se do .mncad neuloží
    await p.evaluate(() => window.mncad.run('nový díl Podklad'));
    await p.waitForTimeout(500);
    ok(await h.openSketch(), 'F: skica otevřená');
    const chooser = p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await p.locator('[data-ribbon] button[aria-label^="Podklad…"]').first().click();
    const fc = await chooser;
    if (fc) await fc.setFiles({ name: 'vykres.pdf', mimeType: 'application/pdf', buffer: pdfBytes() });
    await p.waitForSelector('[data-sketch-underlay-img]', { timeout: 30000 }).catch(() => {});
    ok(Object.keys((await h.docOf()).underlays || {}).length === 1, 'F: podklad vložen');
    await h.finish();
    const del = await p.evaluate(() => window.mncad.run('smazat poslední'));
    ok(/odstraněn prvek/.test(del), `F: ${del.split('\n')[0]}`);
    const file = await p.evaluate(() => window.mncad.exportFile('mncad'));
    const saved = JSON.parse(Buffer.from(file.base64, 'base64').toString('utf8'));
    ok(!saved.underlays && file.bytes < 5000, `F: .mncad bez podkladu smazané skice (${file.bytes} B)`);
    ok(errs.length === 0, `C–F: bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await p.screenshot({ path: S + 'sketch-fixes.png' });
    await ctx.close();
  }

  // ═══════ G. /de/cad: šířka podkladu 1500 mm se v poli ukáže bez oddělovače tisíců a úprava se přečte správně ═══════
  {
    const { ctx, p, errs } = await open(b, '/de/cad');
    const h = helpers(p);
    await p.evaluate(() => window.mncad.run('nový díl Breite'));
    await p.waitForTimeout(500);
    ok(await h.openSketch(), 'G: Skizze geöffnet');
    const png = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 200); g.fillStyle = '#000'; g.fillRect(50, 99, 300, 2); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
    const chooser = p.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await p.locator('[data-ribbon] button[aria-label^="Unterlage…"], [data-ribbon] button[aria-label^="Podklad…"]').first().click();
    const fc = await chooser;
    if (fc) await fc.setFiles({ name: 'podklad.png', mimeType: 'image/png', buffer: png });
    await p.waitForSelector('[data-sketch-underlay-img]', { timeout: 15000 }).catch(() => {});
    const wi = p.locator('[data-sketch-underlay] [data-ul-width]');
    const width = async () => { const u = Object.values((await h.docOf()).underlays || {})[0]; return u ? u.w * u.mmPerPx : NaN; };
    await wi.fill('1500'); await wi.press('Enter'); await p.waitForTimeout(300);
    const shown = await wi.inputValue();
    ok(near(await width(), 1500, 0.01) && shown === '1500', `G: Breite 1500 mm, Feld zeigt ${JSON.stringify(shown)}`);
    await wi.fill(shown.replace('500', '600')); await wi.press('Enter'); await p.waitForTimeout(300);
    ok(near(await width(), 1600, 0.01), `G: nach Bearbeitung 1600 mm (${await width()})`);
    await wi.fill('1.234,5'); await wi.press('Enter'); await p.waitForTimeout(300);
    ok(near(await width(), 1234.5, 0.01), `G: „1.234,5“ = 1234,5 mm (${await width()})`);
    ok(errs.length === 0, `G: bez chyb stránky ${JSON.stringify(errs).slice(0, 200)}`);
    await ctx.close();
  }

  await b.close();
  console.log(fails ? `FAIL: ${fails} kontrol selhalo` : 'ok: vše prošlo');
})().catch((e) => { console.log('FAIL: ' + (e && e.stack)); process.exit(1); });
