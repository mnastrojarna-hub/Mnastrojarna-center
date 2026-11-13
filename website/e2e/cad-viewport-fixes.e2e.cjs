// E2E: opravy náhledu bez WebGL a řezu po kontrole nasazené verze.
//  1) nový díl po předchozím modelu: model se vejde do plátna (dřív zůstalo měřítko 1 px/mm prázdné scény),
//  2) model stejné velikosti na jiném místě (daleko / vystředěný) se znovu přizpůsobí (dřív prázdné nebo napůl mimo plátno),
//  3) otevření a zavření skici zachová pohled, přiblížení i zavřené upozornění,
//  4) řez sestavy (klávesa X) začne uprostřed modelu, ne v Y = 0,
//  5) rozsah polohy řezu bez „-0“, číslo plochy i ve tvaru F3, v sestavě bez WebGL rada místo klikání,
//  6) upozornění „Zjednodušený náhled bez WebGL“ nezakrývá panel řezu (zavírací tlačítko jde stisknout),
//  7) stará adresa obrázku přejmenované zakázky přesměruje na novou.
// Spuštění: E2E_BASE=http://localhost:3305 node e2e/cad-viewport-fixes.e2e.cjs <složka pro výstupy>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const start = async (p) => {
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await p.waitForTimeout(1200);
};
/** rozbor softwarového náhledu: počet pixelů modelu a jejich ohraničení */
const soft = (p) => p.evaluate(() => {
  const c = document.querySelector('[data-soft-canvas]');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hash = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    if (!d[i + 3]) continue;
    n++;
    const x = k % c.width, y = (k / c.width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    hash = (Math.imul(hash, 31) + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + k) | 0;
  }
  return { w: c.width, h: c.height, n, x0, y0, x1, y1, hash, view: c.dataset.view, tris: Number(c.dataset.tris) };
});
const inside = (s) => s.n > 0 && s.x0 > 0 && s.y0 > 0 && s.x1 < s.w - 1 && s.y1 < s.h - 1;
const plane = async (p) => ((await p.locator('[data-section-controls]').getAttribute('data-section-plane')) || '').split(' ').map(Number);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const planeIs = (pl, exp, tol = 0.002) => pl.length === 4 && exp.every((v, i) => near(pl[i], v, tol));
const waitTris = (p, n) => p.waitForFunction((n) => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) === n, n, { timeout: 60000 }).catch(() => {});
const blur = (p) => p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {});

(async () => {
  // ───────────── 7) stará adresa obrázku zakázky ─────────────
  {
    const r = await fetch(BASE + '/img/zakazky/upinaci-pripravek-2015/1.jpg', { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    ok([301, 308].includes(r.status) && /\/img\/zakazky\/upinaci-pripravek-s-celistmi\/1\.jpg$/.test(loc), `stará adresa obrázku → trvalé přesměrování (${r.status} → ${loc})`);
    const f = await fetch(BASE + '/img/zakazky/upinaci-pripravek-2015/1.jpg');
    ok(f.status === 200 && /image\/jpeg/.test(f.headers.get('content-type') || ''), `po přesměrování se obrázek načte (${f.status}, ${f.headers.get('content-type')})`);
  }

  const b = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await start(p);
  ok((await p.locator('[data-viewport-fallback]').getAttribute('data-viewport-fallback')) === 'soft', 'prostředí: bez WebGL, softwarový náhled');

  // ───────────── 1) nový díl po předchozím modelu ─────────────
  await run(p, 'nový díl První\nkvádr 40 30 20');
  await waitTris(p, 12);
  await p.waitForTimeout(1200);
  const first = await soft(p);
  ok(first.n > 20000 && inside(first), `první díl: kvádr na celé plátno (${first.n} px)`);
  await run(p, 'nový díl Druhý');
  await p.waitForTimeout(1600); // aplikace po 700 ms přepne prázdný díl do izometrie
  ok((await soft(p)).n === 0, 'nový díl je prázdný');
  await run(p, 'kvádr 40 30 20');
  await waitTris(p, 12);
  await p.waitForTimeout(800);
  let s = await soft(p);
  ok(s.n > 0.9 * first.n && inside(s), `nový díl: stejný kvádr opět na celé plátno (${s.n} px, první díl ${first.n} px)`);
  await p.screenshot({ path: S + 'vpfix-new-part.png' });

  // ───────────── 2) model stejné velikosti na jiném místě ─────────────
  await run(p, 'smazat poslední\nkvádr 40 30 20 v 5000 0 0');
  await p.waitForTimeout(1800);
  s = await soft(p);
  ok(s.tris === 12 && s.n > 0.9 * first.n && inside(s), `kvádr přesunutý na x = 5000: náhled se přizpůsobí (${s.n} px)`);
  await run(p, 'smazat poslední\nkvádr 40 30 20');
  await p.waitForTimeout(1800);
  await run(p, 'smazat poslední\nkvádr 40 30 20 střed');
  await p.waitForTimeout(1800);
  s = await soft(p);
  ok(s.n > 0.9 * first.n && inside(s), `vystředěný kvádr: celý na plátně (${s.n} px, x ${s.x0}–${s.x1}, y ${s.y0}–${s.y1})`);
  // drobná změna modelu pohled drží
  await p.locator('[data-soft-view="front"]').click();
  await p.locator('[data-soft-zoom="in"]').click();
  await p.waitForTimeout(300);
  const zoomed = await soft(p);
  await run(p, 'smazat poslední\nkvádr 40 30 22 střed');
  await p.waitForTimeout(1800);
  s = await soft(p);
  ok(s.view === 'front' && s.n > zoomed.n, `drobná změna modelu: pohled Přední i přiblížení zůstávají (${zoomed.n} → ${s.n} px)`);

  // ───────────── 3) skica zachová pohled, přiblížení i zavřené upozornění ─────────────
  await p.locator('[data-soft-note] button').click();
  await p.waitForTimeout(200);
  ok(!(await p.locator('[data-soft-note]').count()), 'upozornění bez WebGL zavřeno');
  await blur(p);
  await p.keyboard.press('2');
  await p.waitForTimeout(300);
  await p.locator('[data-soft-zoom="in"]').click();
  await p.waitForTimeout(300);
  const before = await soft(p);
  await p.getByRole('button', { name: 'Tvorba', exact: true }).click().catch(() => {});
  await p.getByRole('button', { name: /^Skica/ }).first().click().catch(() => {});
  await p.getByRole('button', { name: /Rovina XY/ }).click({ timeout: 4000 }).catch(() => {});
  const opened = await p.waitForSelector('[data-sketch-canvas]', { timeout: 8000 }).then(() => true, () => false);
  ok(opened, 'skica XY otevřena');
  ok(!(await p.locator('[data-soft-canvas]').isVisible()), 'během skici náhled není vidět (kreslí se skica)');
  await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click();
  await p.waitForTimeout(800);
  ok(!(await p.locator('[data-sketch-canvas]').count()), 'skica zavřena');
  const after = await soft(p);
  ok(after.view === 'top' && after.hash === before.hash, `po skice zůstal pohled Horní s přiblížením (pohled ${after.view}, ${before.n} → ${after.n} px)`);
  ok(!(await p.locator('[data-soft-note]').count()), 'zavřené upozornění se po skice nevrátí');
  ok((await p.locator('[data-soft-view="top"]').getAttribute('aria-pressed')) === 'true', 'tlačítko pohledu Horní zůstává zvýrazněné');

  // ───────────── 5) rozsah bez „-0“, číslo plochy F3 ─────────────
  await run(p, 'nový díl Zaoblený\nkvádr 80 60 20\nzaoblit 5 hrany svislé');
  await p.waitForTimeout(2500);
  await blur(p);
  await p.keyboard.press('x');
  await p.waitForTimeout(500);
  const secText = await p.locator('[data-section-controls]').innerText();
  const m = secText.match(/model (\S+) až (\S+)/);
  ok(!!m && m[1] !== '-0' && !/-0(?![\d,.])/.test(m[0]), `rozsah řezu bez „-0“ (${m && m[0]})`);
  ok(planeIs(await plane(p), [0, 1, 0, -30]), 'řez dílu začíná uprostřed (y = 30)');
  await p.locator('[data-section-tab="face"]').click();
  await p.waitForTimeout(300);
  const waitHint = await p.locator('[data-section-wait]').innerText();
  ok(!/kliknutím ve 3D okně/.test(waitHint) && /číslo/i.test(waitHint), `bez WebGL rada zadat číslo plochy místo klikání („${waitHint.trim()}“)`);
  const faceIn = p.locator('[data-section-controls] input[aria-label="Číslo plochy"]');
  let fNo = 0;
  for (let i = 1; i <= 12 && !fNo; i++) {
    await faceIn.fill('F' + i);
    await faceIn.press('Enter');
    await p.waitForTimeout(250);
    const t = await p.locator('[data-section-controls]').innerText();
    if (/Zadejte číslo plochy/.test(t)) break;
    if ((await p.locator('[data-section-controls]').getAttribute('data-section-mode')) === 'face' && !(await p.locator('[data-section-wait]').count())) fNo = i;
  }
  ok(fNo > 0, `číslo plochy zapsané jako „F${fNo}“ se přijme (rovina z plochy)`);
  await faceIn.fill('f2');
  await faceIn.press('Enter');
  await p.waitForTimeout(250);
  ok(!/Zadejte číslo plochy/.test(await p.locator('[data-section-controls]').innerText()), 'i malé „f2“ se přijme');
  await faceIn.fill('F999');
  await faceIn.press('Enter');
  await p.waitForTimeout(250);
  ok(/Zadejte číslo plochy/.test(await p.locator('[data-section-controls]').innerText()), 'neexistující plocha „F999“ se odmítne');

  // ───────────── 6) upozornění vs. panel řezu ─────────────
  await p.locator('[data-soft-why]').click();
  await p.locator('[data-viewport-help]').getByRole('button', { name: 'Zkusit znovu' }).click();
  await p.waitForTimeout(1500);
  ok(await p.locator('[data-soft-note]').isVisible(), 'upozornění je po „Zkusit znovu“ opět vidět');
  if (!(await p.locator('[data-section-controls]').count())) { await blur(p); await p.keyboard.press('x'); await p.waitForTimeout(400); }
  ok(await p.locator('[data-section-controls]').isVisible(), 'panel Řez modelem je otevřený');
  const closeBtn = p.locator('[data-soft-note] button');
  const bb = await closeBtn.boundingBox();
  const hit = bb && await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-soft-note]'), { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
  const noteBox = await p.locator('[data-soft-note]').boundingBox();
  const panelBox = await p.locator('[data-section-controls]').boundingBox();
  const overlap = noteBox && panelBox && !(noteBox.x > panelBox.x + panelBox.width || noteBox.x + noteBox.width < panelBox.x || noteBox.y > panelBox.y + panelBox.height || noteBox.y + noteBox.height < panelBox.y);
  ok(hit && !overlap, `upozornění není zakryté panelem řezu (zavírací tlačítko dosažitelné: ${hit}, překryv: ${!!overlap})`);
  await p.screenshot({ path: S + 'vpfix-note-section.png' });
  const closed = await closeBtn.click({ timeout: 5000 }).then(() => true, () => false);
  await p.waitForTimeout(200);
  ok(closed && !(await p.locator('[data-soft-note]').count()), 'upozornění jde zavřít i při otevřeném řezu');
  await blur(p);
  await p.keyboard.press('x');
  await p.waitForTimeout(300);

  // ───────────── 4) řez sestavy začne uprostřed modelu ─────────────
  await run(p, 'nový díl Kostka\nkvádr 40 30 20');
  await p.waitForTimeout(1500);
  await run(p, 'nová sestava Daleko\nvložit "Kostka" v 0 5000 0\nvložit "Kostka" v 80 5000 0');
  await waitTris(p, 24);
  await p.waitForTimeout(1500);
  const whole = await soft(p);
  ok(whole.tris === 24 && whole.n > 20000 && inside(whole), `sestava daleko od počátku je v náhledu celá (${whole.n} px)`);
  await blur(p);
  await p.keyboard.press('x');
  await p.waitForTimeout(600);
  ok(planeIs(await plane(p), [0, 1, 0, -5015]), `řez sestavy (X) začíná uprostřed modelu, y = 5015 (rovina ${(await plane(p)).join(' ')})`);
  const cut = await soft(p);
  ok(cut.n > 0 && cut.hash !== whole.hash, `řez sestavy je v náhledu vidět (${whole.n} → ${cut.n} px)`);
  await p.locator('[data-section-tab="face"]').click();
  await p.waitForTimeout(300);
  const asmHint = await p.locator('[data-section-wait]').innerText();
  ok(/Vektor/.test(asmHint) && !/kliknutím ve 3D okně/.test(asmHint), `sestava bez WebGL: rada použít záložku Vektor („${asmHint.trim()}“)`);
  await p.screenshot({ path: S + 'vpfix-asm-section.png' });

  ok(errs.length === 0, 'žádná nezachycená JS chyba: ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
