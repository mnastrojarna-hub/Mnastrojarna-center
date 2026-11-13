// E2E – rozvržení výkresu soustruženého dílu (oběžné kolo 604200.001, model B z src/cad/fixtures/impeller-B.mncad.json):
// skryté hrany ve výchozím stavu vypnuté, řez nemění formát listu (A2 1:2), automatické kóty průměrů v řadě u řezu bez
// překrytí textů, poloviční řez, otočení hlavního pohledu o 90° (kóta z geometrie v otočeném pohledu), skryté hrany bez
// nové projekce, další model ze souboru na tomtéž listu s vlastním měřítkem, uložení voleb do dokumentu a znovuotevření.
// Spuštění: E2E_BASE=http://localhost:3202 node e2e/cad-drawing-layout.e2e.cjs <složka>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const MODEL_B = fs.readFileSync(path.resolve(__dirname, '../src/cad/fixtures/impeller-B.mncad.json'), 'utf8');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };

/** čep Ø30 × 60 – další model vložený ze souboru */
const PIN = {
  app: 'mnastrojarna-cad', version: 2, name: 'Čep', material: 'ocel',
  features: [
    { id: 's', name: 'Skica', type: 'sketch', plane: { kind: 'base', name: 'XY', offset: 0 }, entities: [{ id: 'c', type: 'circle', cx: 0, cy: 0, r: 15 }] },
    { id: 'e', name: 'Vysunutí', type: 'extrude', sketchId: 's', distance: 60, symmetric: false, reverse: false, mode: 'new' },
  ],
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 }); await start(p);

  const W = '[data-drawing-workspace]';
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const getDoc = () => p.evaluate(() => window.mncad.getDocument());
  const format = () => p.locator('[data-sheet]').getAttribute('data-sheet-format');
  const views = async () => JSON.parse((await p.locator('[data-sheet]').getAttribute('data-views')) || '[]');
  const stacks = async () => JSON.parse((await p.locator('[data-sheet]').getAttribute('data-stacks')) || '[]');
  const status = () => p.locator(W).getByText(/ mm · .* ms$/).first().textContent().catch(() => '');
  /** čeká na dokončení přepočtu (stavový řádek „… · N ms“) a vrátí dobu přepočtu v ms */
  const settled = async (timeout = 180000) => {
    await p.waitForTimeout(400);
    await p.waitForFunction((w) => { const t = document.querySelector(w)?.innerText || ''; return !t.includes('Přepočítávám') && !t.includes('Promítám pohledy'); }, W, { timeout });
    await p.waitForTimeout(250);
    const m = /· (\d+) ms/.exec((await status()) || '');
    return m ? Number(m[1]) : NaN;
  };
  const check = (label) => p.locator(`${W} aside label`).filter({ hasText: label }).locator('input[type=checkbox]');
  const segBtn = (name) => p.locator(`${W} aside button`, { hasText: new RegExp(`^${name}$`) }).first();
  /** texty kót na listu (obrazovka): Ø…, n× Ø…, čísla – obdélníky se nesmí překrývat */
  const dimClashes = () => p.evaluate(() => {
    const els = [...document.querySelectorAll('[data-sheet] > div svg text')].filter((t) => /^(\d+× )?Ø|^\d+([,.]\d+)?$/.test(t.textContent || ''));
    const r = els.map((e) => ({ s: e.textContent, b: e.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i].b, c = r[j].b;
        if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) out.push(`${r[i].s} × ${r[j].s}`);
      }
    return { n: r.length, out };
  });
  const sheetTexts = () => p.evaluate(() => [...document.querySelectorAll('[data-sheet] > div svg text')].map((t) => t.textContent));

  // ── 1. model B z JSON, výkres textovým příkazem ──
  const setLog = await p.evaluate((j) => window.mncad.setDocument(j), MODEL_B);
  ok(/✓/.test(setLog) && !/^✗/m.test(setLog), 'model B otevřen přes window.mncad.setDocument');
  const t0 = Date.now();
  await run('výkres');
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 300000 });
  const firstMs = await settled();
  console.log(`   (první projekce modelu B v prohlížeči: ${firstMs} ms podle stavového řádku, ${Date.now() - t0} ms od příkazu)`);
  ok(Number.isFinite(firstMs), `výkres otevřen (${await status()})`);
  ok((await check('Skryté hrany').isChecked()) === false, 'nový výkres: skryté hrany vypnuté');
  ok((await p.locator('[data-sheet] > div svg [stroke-dasharray="3 1.5"]').count()) === 0, 'na listu nejsou čárkované skryté hrany');
  // nový výkres má Chytré kóty (podle prvků modelu, víc místa kolem pohledů) – jen se ověří, že se texty nepřekrývají
  let cl = await dimClashes();
  ok(cl.out.length === 0, `Chytré kóty (výchozí): list ${await format()}, ${cl.n} textů kót, překryvy: ${cl.out.join(', ') || 'žádné'}`);
  // rozvržení listu a řada průměrů se ověřují v režimu „Auto + Ø“
  await segBtn('Auto \\+ Ø').click();
  await settled();
  ok((await format()) === 'A2 1:2', `bez řezu: list ${await format()}`);
  cl = await dimClashes();
  ok(cl.n >= 15 && cl.out.length === 0, `bez řezu: ${cl.n} textů kót, překryvy: ${cl.out.join(', ') || 'žádné'}`);

  // ── 2. řez: formát listu zůstane, průměry v řadě u řezu ──
  await check('Zobrazit řez se šrafováním').check();
  const secMs = await settled();
  ok((await format()) === 'A2 1:2', `s řezem: list ${await format()} (dřív se přepnul na A1)`);
  ok(secMs < 10000, `zapnutí řezu přepočítá výkres za ${secMs} ms (cíl < 10 s; hlavní pohledy z mezipaměti)`);
  const st = await stacks();
  ok(st.length === 1 && st[0].view === 'section' && st[0].count === 14, `kóty průměrů v řezu: ${JSON.stringify(st)}`);
  cl = await dimClashes();
  ok(cl.n >= 15 && cl.out.length === 0, `s řezem: ${cl.n} textů kót, překryvy: ${cl.out.join(', ') || 'žádné'}`);
  const texts = await sheetTexts();
  ok(texts.includes('A–A') && texts.includes('Ø430') && texts.includes('Ø42'), 'označení řezu A–A a průměry Ø42 … Ø430');
  await p.screenshot({ path: S + 'layout-section.png' });

  // ── 3. poloviční řez ──
  await segBtn('Poloviční řez').click();
  await settled();
  ok((await format()) === 'A2 1:2' && (await p.locator('[data-sheet] > div svg').count()) === 1, `poloviční řez: list ${await format()}`);
  cl = await dimClashes();
  ok(cl.out.length === 0, `poloviční řez: texty kót se nepřekrývají (${cl.n})`);
  await p.screenshot({ path: S + 'layout-half.png' });

  // ── 4. otočení hlavního pohledu o 90° ──
  const before = (await views()).find((v) => v.key === 'front');
  await segBtn('90°').click();
  const rotMs = await settled();
  const front = (await views()).find((v) => v.key === 'front');
  ok(Math.abs(front.w - before.h) < 1e-6 && Math.abs(front.h - before.w) < 1e-6, `otočení 90°: čelní pohled ${before.w.toFixed(1)}×${before.h.toFixed(1)} → ${front.w.toFixed(1)}×${front.h.toFixed(1)} (osa vodorovně), ${rotMs} ms`);
  cl = await dimClashes();
  ok(cl.out.length === 0, `otočený pohled s řezem: texty kót se nepřekrývají (${cl.n}), list ${await format()}`);
  await p.screenshot({ path: S + 'layout-rot90.png' });
  // kóta z geometrie v otočeném pohledu: nad čelem příruby Ø430 (svislá hrana délky 430) nabídne nástroj Kóta „délka 430“
  await p.keyboard.press('d'); await p.waitForTimeout(300);
  const g = await p.evaluate(() => { const s = document.querySelector('[data-sheet] > div svg'); const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, k: r.width / Number(s.getAttribute('viewBox').split(' ')[2]) }; });
  const T = (u, v) => [g.l + (front.px + (u - front.x0) * front.s) * g.k, g.t + (front.py + (v - front.y0) * front.s) * g.k];
  let found = '';
  for (let u = front.x0; u <= front.x0 + front.w && !found; u += 0.5) {
    const [x, y] = T(u, front.y0 + front.h * 0.85);
    await p.mouse.move(x, y); await p.waitForTimeout(40);
    const h = (await p.evaluate(() => document.querySelector('[data-dim-hover]')?.textContent || '')) || '';
    if (/délka 430\b/.test(h)) found = h;
  }
  ok(!!found, `nástroj Kóta v otočeném pohledu: nad čelem příruby „${found || 'nic'}“`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // ── 5. skryté hrany: zapnutí bez nové projekce (rychle), čárkovaně ──
  await check('Skryté hrany').check();
  const hidMs = await settled();
  const dashed = await p.locator('[data-sheet] > div svg [stroke-dasharray="3 1.5"]').count();
  ok(dashed > 0 && hidMs < 5000, `skryté hrany zapnuté: ${dashed} čárkovaných čar, přepočet ${hidMs} ms (bez nové projekce)`);
  await check('Skryté hrany').uncheck();
  await settled();

  // ── 6. další model ze souboru na tomtéž listu ──
  await p.locator('[data-model-file]').setInputFiles({ name: 'cep.mncad', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PIN)) });
  await p.waitForFunction(() => document.querySelectorAll('[data-model-row]').length === 1, null, { timeout: 20000 });
  await settled();
  let vs = await views();
  const mv = vs.find((v) => v.key.startsWith('m:'));
  ok(!!mv && Math.abs(mv.w - 30) < 1e-3, `pohled čepu na listu (${mv ? `${mv.key}, ${mv.w.toFixed(1)}×${mv.h.toFixed(1)} mm modelu` : 'chybí'})`);
  const pinLabel = (await sheetTexts()).find((t) => /^Čep \(/.test(t || ''));
  ok(pinLabel === `Čep (${(await format()).split(' ')[1]})`, `popisek s vlastním měřítkem: „${pinLabel}“`);
  // vlastní měřítko 1:1
  await p.locator('[data-model-row] select[aria-label="Měřítko modelu"]').selectOption('1');
  await settled();
  ok((await sheetTexts()).includes('Čep (1:1)'), 'měřítko čepu 1:1 → popisek „Čep (1:1)“');
  vs = await views();
  const rects = vs.map((v) => ({ k: v.key, x: v.px, y: v.py, w: v.w * v.s, h: v.h * v.s }));
  const over = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], c = rects[j]; if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) over.push(`${a.k}×${c.k}`); }
  ok(over.length === 0, `pohledy se nepřekrývají (${rects.map((r) => r.k).join(', ')})`);
  await p.screenshot({ path: S + 'layout-models.png' });

  // ── 7. uložení voleb do dokumentu a znovuotevření ──
  await p.waitForTimeout(900);
  const doc = await getDoc();
  const o = doc.drawings?.[0]?.options || {};
  ok(o.rotation === 90 && o.section?.kind === 'half' && o.hidden === false && o.models?.length === 1 && o.models[0].source?.kind === 'doc', `dokument: otočení ${o.rotation}°, řez ${o.section?.kind}, skryté hrany ${o.hidden}, modely ${o.models?.length}`);
  await p.locator(`${W} header`).getByRole('button', { name: 'Zavřít', exact: true }).click(); await p.waitForTimeout(900);
  await run('výkres');
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 300000 });
  await settled();
  const f2 = (await views()).find((v) => v.key === 'front');
  ok(Math.abs(f2.w - front.w) < 1e-6 && (await sheetTexts()).includes('Čep (1:1)') && (await segBtn('90°').getAttribute('class')).includes('font-semibold'), 'znovuotevřený výkres: otočení, poloviční řez a čep zůstaly');

  ok(errs.length === 0, `bez chyb stránky ${errs.slice(0, 3).join(' | ')}`);
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
