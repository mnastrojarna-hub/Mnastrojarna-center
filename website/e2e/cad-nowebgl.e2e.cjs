// E2E: náhled modelu bez WebGL (softwarové vykreslení na 2D plátno) a řez číslem / obecnou rovinou.
//  A) WebGL vypnuté: místo chybové obrazovky je v 3D okně stínovaný náhled modelu – pohledy, přizpůsobení, přiblížení,
//     otáčení tažením; náhled se překreslí po textovém příkazu; „Proč nevidím 3D?“ ukáže příčinu a postup;
//     řez (poloha číslem, rovina z plochy podle čísla, vektor) se promítne do náhledu.
//  B) WebGL zapnuté (SwiftShader): nic se nemění – kreslí 3D okno, náhled se neobjeví; panel „Řez modelem“:
//     poloha zapsaná číslem / výrazem posune rovinu ořezu, rovina z vybrané plochy, normála vektorem, otočení strany.
// Spuštění: E2E_BASE=http://localhost:3203 node e2e/cad-nowebgl.e2e.cjs <složka pro výstupy>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const start = async (p) => {
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await p.waitForTimeout(1200);
};
/** rozbor softwarového náhledu: počet zakrytých pixelů, ohraničení obrysu, pixely v barvě řezu, otisk obrazu */
const soft = (p) => p.evaluate(() => {
  const c = document.querySelector('[data-soft-canvas]');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cap = 0, hash = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    if (!d[i + 3]) continue;
    n++;
    const x = k % c.width, y = (k / c.width) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (Math.abs(d[i] - 232) < 4 && Math.abs(d[i + 1] - 112) < 4 && Math.abs(d[i + 2] - 106) < 4) cap++;
    hash = (Math.imul(hash, 31) + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + k) | 0;
  }
  const at = (fx, fy) => { const x = Math.round(x0 + (x1 - x0) * fx), y = Math.round(y0 + (y1 - y0) * fy), i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  return { w: c.width, h: c.height, n, x0, y0, x1, y1, bw: n ? x1 - x0 + 1 : 0, bh: n ? y1 - y0 + 1 : 0, cap, hash, mid: n ? at(0.5, 0.5) : null, view: c.dataset.view, tris: Number(c.dataset.tris), ms: Number(c.dataset.ms), frame: Number(c.dataset.frame) };
});
/** rozbor 3D okna (WebGL): počet neprůhledných pixelů a pixelů v barvě řezu */
const gl = (p) => p.evaluate(() => {
  const c = [...document.querySelectorAll('main canvas')].find((x) => !x.hasAttribute('data-soft-canvas'));
  if (!c) return null;
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const g = t.getContext('2d');
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, t.width, t.height).data;
  let n = 0, cap = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    n++;
    if (d[i] > d[i + 1] + 50 && d[i] > d[i + 2] + 50) cap++;
  }
  return { w: c.width, h: c.height, n, cap };
});
const plane = async (p) => ((await p.locator('[data-section-controls]').getAttribute('data-section-plane')) || '').split(' ').map(Number);
const planeIs = (pl, exp, tol = 0.002) => pl.length === 4 && exp.every((v, i) => near(pl[i], v, tol));
const setPos = async (p, text) => {
  const f = p.locator('[data-section-controls] input[aria-label="Poloha"]');
  await f.fill(text);
  await f.press('Enter');
  await p.waitForTimeout(350);
};

(async () => {
  // ───────────────────────────── A) bez WebGL ─────────────────────────────
  {
    const b = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await start(p);
    ok(await p.evaluate(() => !document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('webgl2')), 'A: prostředí – WebGL je v prohlížeči vypnuté');
    const fb = p.locator('[data-viewport-fallback]');
    ok(await fb.isVisible() && (await fb.getAttribute('data-viewport-fallback')) === 'soft', 'A: v 3D okně je softwarový náhled (ne jen chybová obrazovka)');
    ok(await p.locator('[data-soft-canvas]').isVisible(), 'A: plátno náhledu je vidět');
    ok(/3D okno: nedostupné/.test(await p.locator('header').first().innerText()), 'A: stav v horní liště: 3D okno nedostupné');
    const note = await p.locator('[data-soft-note]').innerText();
    ok(/náhled bez WebGL/.test(note) && /Klik vybere plochu, hranu nebo vrchol/.test(note) && /vyber F3 E2/.test(note) && /window\.mncad\.select/.test(note), 'A: upozornění – zjednodušený náhled, výběr kliknutím, textem „vyber“ a window.mncad.select');

    // prázdný díl → prázdné plátno; po textovém příkazu se model objeví
    await run(p, 'nový díl Náhled');
    await p.waitForTimeout(900);
    let s = await soft(p);
    ok(s && s.n === 0, 'A: prázdný díl – plátno je prázdné (jen pozadí)');
    await run(p, 'kvádr 40 30 20');
    await p.waitForTimeout(1500);
    s = await soft(p);
    ok(s.n > 20000 && s.tris === 12, `A: po příkazu „kvádr 40 30 20“ náhled ukazuje model (${s.n} pixelů modelu, ${s.tris} trojúhelníků, ${s.ms} ms)`);
    ok(s.view === 'iso' && (await p.locator('[data-soft-view="iso"]').getAttribute('aria-pressed')) === 'true', 'A: výchozí pohled je izometrie');
    ok(s.x0 > 0 && s.y0 > 0 && s.x1 < s.w - 1 && s.y1 < s.h - 1, 'A: model se vešel do plátna celý');
    ok(s.mid[3] === 255 && Math.abs(s.mid[0] - s.mid[1]) < 30 && s.mid[2] >= s.mid[0], `A: model je stínovaný v barvě tělesa (šedá, střed ${s.mid.slice(0, 3).join(',')})`);
    const iso = s;
    await p.screenshot({ path: S + 'nowebgl-iso.png' });

    // tlačítka pohledů mění obraz: poměr stran obrysu odpovídá kvádru 40 × 30 × 20
    const views = {};
    for (const [v, ratio, label] of [['front', 40 / 20, 'Přední'], ['top', 40 / 30, 'Horní'], ['right', 30 / 20, 'Pravý'], ['back', 40 / 20, 'Zadní'], ['bottom', 40 / 30, 'Spodní'], ['left', 30 / 20, 'Levý']]) {
      await p.locator(`[data-soft-view="${v}"]`).click();
      await p.waitForTimeout(250);
      const r = await soft(p);
      views[v] = r;
      ok(r.view === v && near(r.bw / r.bh, ratio, 0.03 * ratio), `A: pohled ${label} – obrys ${r.bw} × ${r.bh} px, poměr ${(r.bw / r.bh).toFixed(3)} (čekáno ${ratio.toFixed(3)})`);
    }
    ok(new Set([iso.hash, views.front.hash, views.top.hash, views.right.hash]).size === 4, 'A: izometrie, přední, horní a pravý pohled dávají různé obrazy');
    ok((await p.locator('[data-soft-view="left"]').getAttribute('aria-pressed')) === 'true' && (await p.locator('[data-soft-view="iso"]').getAttribute('aria-pressed')) === 'false', 'A: zvýrazněné je tlačítko aktuálního pohledu');
    await p.locator('[data-soft-view="iso"]').click();
    await p.waitForTimeout(250);
    s = await soft(p);
    ok(s.hash === iso.hash, 'A: návrat do izometrie dá stejný obraz jako na začátku');

    // přiblížení tlačítky a kolečkem, přizpůsobení
    await p.locator('[data-soft-zoom="in"]').click();
    await p.waitForTimeout(250);
    let z = await soft(p);
    ok(near(z.n / iso.n, 1.5625, 0.06), `A: tlačítko + přiblíží 1,25× (plocha modelu ×${(z.n / iso.n).toFixed(3)})`);
    await p.locator('[data-soft-zoom="out"]').click();
    await p.locator('[data-soft-zoom="out"]').click();
    await p.waitForTimeout(250);
    z = await soft(p);
    ok(near(z.n / iso.n, 0.64, 0.03), `A: tlačítko − oddálí (plocha modelu ×${(z.n / iso.n).toFixed(3)})`);
    const box = await p.locator('[data-soft-canvas]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.wheel(0, -400);
    await p.waitForTimeout(450);
    const zw = await soft(p);
    ok(zw.n > z.n * 1.5, `A: kolečko myši přiblíží (plocha modelu ×${(zw.n / z.n).toFixed(2)})`);
    await p.locator('[data-soft-fit]').click();
    await p.waitForTimeout(250);
    s = await soft(p);
    ok(s.hash === iso.hash, 'A: Přizpůsobit vrátí model na celé plátno');

    // otáčení tažením
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(450);
    s = await soft(p);
    ok(s.view === 'free' && s.hash !== iso.hash && s.n > 20000, 'A: tažení myší model otočí (volný pohled)');
    ok((await p.locator('[data-soft-view="iso"]').getAttribute('aria-pressed')) === 'false', 'A: po otočení není zvýrazněný žádný pojmenovaný pohled');

    // klávesové zkratky a pás karet jdou do náhledu (stejné ovládání jako 3D okno)
    await p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press('2');
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.view === 'top' && s.hash === views.top.hash, 'A: klávesa 2 (pohled Horní) přepne náhled');
    await p.locator('[data-soft-zoom="in"]').click();
    await p.keyboard.press('f');
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.hash === views.top.hash, 'A: klávesa F (Přizpůsobit) funguje i v náhledu');
    await p.getByRole('button', { name: 'Zobrazení', exact: true }).first().click();
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Drátový', exact: true }).first().click();
    await p.waitForTimeout(350);
    s = await soft(p);
    ok(s.n > 300 && s.n < views.top.n * 0.1, `A: zobrazení Drátový – jen hrany (${s.n} pixelů)`);
    await p.getByRole('button', { name: 'Stínovaný s hranami', exact: true }).first().click().catch(async () => { await p.getByRole('button', { name: /Stínovaný/ }).first().click(); });
    await p.waitForTimeout(350);
    await p.keyboard.press('0');
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.view === 'iso' && s.hash === iso.hash, 'A: klávesa 0 vrátí izometrii, stínované zobrazení zpět');

    // model se po dalším textovém příkazu překreslí (díra skrz je v horním pohledu průhledná)
    await run(p, 'díra 10 skrz v 20 15');
    await p.waitForTimeout(1500);
    await p.locator('[data-soft-view="top"]').click();
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.mid[3] === 0 && s.tris > 12, `A: po příkazu „díra 10 skrz“ je uprostřed horního pohledu díra (${s.tris} trojúhelníků)`);
    ok(near(s.bw / s.bh, 40 / 30, 0.04), 'A: pohled se po změně modelu drží (horní)');

    // „Proč nevidím 3D?“ – příčina, postup, diagnostika; zpět k náhledu
    await p.locator('[data-soft-why]').click();
    await p.waitForTimeout(300);
    const help = await p.locator('[data-viewport-help]').innerText();
    ok(/3D okno nelze spustit/.test(help) && /neposkytl WebGL/.test(help) && /grafickou akceleraci/.test(help), 'A: Proč nevidím 3D? → příčina a postup');
    ok(/zjednodušený náhled/.test(help) && /nabídky, nápověda/.test(help), 'A: nápověda vysvětluje, co funguje dál');
    await p.locator('[data-viewport-help]').getByRole('button', { name: 'Zkopírovat diagnostiku' }).click();
    await p.waitForTimeout(400);
    const diag = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    ok(/Mnástrojárna CAD – diagnostika/.test(diag) && /WebGL: nedostupné/.test(diag), 'A: diagnostika z nápovědy se zkopíruje');
    await p.screenshot({ path: S + 'nowebgl-why.png' });
    await p.locator('[data-viewport-help]').getByRole('button', { name: 'Zpět k náhledu' }).click();
    await p.waitForTimeout(300);
    ok(!(await p.locator('[data-viewport-help]').count()) && await p.locator('[data-soft-canvas]').isVisible(), 'A: Zpět k náhledu zavře nápovědu');

    // řez v náhledu: poloha číslem, rovina z plochy podle čísla, vektor
    await p.locator('[data-soft-view="front"]').click();
    await p.waitForTimeout(300);
    const full = await soft(p);
    await p.keyboard.press('x');
    await p.waitForTimeout(400);
    ok(await p.locator('[data-section-controls]').isVisible(), 'A: klávesa X otevře panel Řez modelem');
    await p.locator('[data-section-tab="X"]').click();
    await p.waitForTimeout(300);
    ok(planeIs(await plane(p), [-1, 0, 0, 20]), 'A: řez kolmý na X začíná uprostřed modelu (x = 20)');
    s = await soft(p);
    ok(near(s.bw / full.bw, 0.5, 0.02) && s.x0 === full.x0, `A: náhled je oříznutý v polovině (šířka ×${(s.bw / full.bw).toFixed(3)})`);
    await setPos(p, '10');
    s = await soft(p);
    ok(planeIs(await plane(p), [-1, 0, 0, 10]) && near(s.bw / full.bw, 0.25, 0.02), `A: poloha 10 zapsaná číslem posune rovinu (šířka ×${(s.bw / full.bw).toFixed(3)})`);
    ok(Number(await p.locator('[data-section-controls] input[type=range]').inputValue()) === 10, 'A: posuvník ukazuje zapsanou polohu');
    // zůstává x ≤ 10: plocha řezu míří k +X, tedy ke kameře izometrie
    await p.locator('[data-soft-view="iso"]').click();
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.cap > 2000, `A: v izometrii je vidět plocha řezu barvou řezu (${s.cap} pixelů)`);
    await p.screenshot({ path: S + 'nowebgl-section.png' });
    await p.locator('[data-soft-view="front"]').click();
    await p.waitForTimeout(300);
    await p.locator('[data-section-flip]').click();
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(planeIs(await plane(p), [1, 0, 0, -10]) && near(s.bw / full.bw, 0.75, 0.02) && s.x1 === full.x1, 'A: Otočit stranu ponechá druhou část');
    // po otočení zůstává x ≥ 10: plocha řezu míří k −X → vidět zleva (obdélník 30 × 20), z izometrie ne
    await p.locator('[data-soft-view="left"]').click();
    await p.waitForTimeout(300);
    s = await soft(p);
    ok(s.cap > 0.8 * s.n, `A: po otočení strany je plocha řezu vidět zleva (${s.cap} z ${s.n} pixelů)`);
    // rovina z plochy: bez klikání číslem plochy; horní plocha kvádru = rovina z = 20
    await p.locator('[data-section-tab="face"]').click();
    await p.waitForTimeout(300);
    ok(await p.locator('[data-section-wait]').isVisible(), 'A: záložka Plocha bez výběru čeká na rovinnou plochu');
    let topNo = 0, curved = 0;
    for (let i = 1; i <= 7; i++) {
      await p.locator('[data-section-controls] input[aria-label="Číslo plochy"]').fill(String(i));
      await p.locator('[data-section-face-no]').click();
      await p.waitForTimeout(250);
      if (/není rovinná/.test(await p.locator('[data-section-controls]').innerText())) curved = i;
      else if (planeIs(await plane(p), [0, 0, -1, 20])) { topNo = i; break; }
    }
    ok(topNo > 0 && (await p.locator('[data-section-controls]').getAttribute('data-section-mode')) === 'face', `A: rovina z plochy č. ${topNo} (horní plocha): normála +Z, rovina z = 20`);
    await p.locator('[data-soft-view="front"]').click();
    await setPos(p, '-5');
    s = await soft(p);
    ok(planeIs(await plane(p), [0, 0, -1, 15]) && near(s.bh / full.bh, 0.75, 0.03), `A: posun −5 mm od plochy řeže do materiálu (výška ×${(s.bh / full.bh).toFixed(3)})`);
    if (!curved) {
      for (let i = 1; i <= 7 && !curved; i++) {
        await p.locator('[data-section-controls] input[aria-label="Číslo plochy"]').fill(String(i));
        await p.locator('[data-section-face-no]').click();
        await p.waitForTimeout(250);
        if (/není rovinná/.test(await p.locator('[data-section-controls]').innerText())) curved = i;
      }
    }
    ok(curved > 0, `A: zakřivená plocha (č. ${curved}, stěna díry) se odmítne s vysvětlením`);
    await p.locator('[data-section-tab="vector"]').click();
    await p.waitForTimeout(300);
    const vec = p.locator('[data-section-controls] input[aria-label="Normála roviny řezu"]');
    await vec.fill('1; 0; 1');
    await vec.press('Enter');
    await p.waitForTimeout(350);
    let pl = await plane(p);
    ok(near(Math.abs(pl[0]), Math.SQRT1_2, 0.001) && pl[1] === 0 && near(Math.abs(pl[2]), Math.SQRT1_2, 0.001), `A: normála 1; 0; 1 → rovina ${pl.join(' ')}`);
    s = await soft(p);
    ok(s.n > 0 && s.n < full.n * 0.8, 'A: šikmý řez je v náhledu vidět (část modelu chybí)');
    await p.screenshot({ path: S + 'nowebgl-section-vector.png' });
    await vec.fill('0; 0; 0');
    await vec.press('Enter');
    await p.waitForTimeout(300);
    ok(/nulový vektor/.test(await p.locator('[data-section-controls]').innerText()), 'A: nulová normála se odmítne');
    await p.keyboard.press('Escape');
    await p.locator('header').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press('x');
    await p.waitForTimeout(350);
    s = await soft(p);
    ok(!(await p.locator('[data-section-controls]').count()) && s.n === full.n, 'A: zrušení řezu vrátí celý model');

    // Zkusit znovu bez WebGL → opět náhled; zbytek aplikace žije
    await p.locator('[data-soft-why]').click();
    await p.locator('[data-viewport-help]').getByRole('button', { name: 'Zkusit znovu' }).click();
    await p.waitForTimeout(1200);
    s = await soft(p);
    ok(await p.locator('[data-viewport-fallback]').isVisible() && s && s.n > 20000, 'A: Zkusit znovu bez WebGL – opět náhled s modelem, bez pádu');
    ok(await p.getByRole('button', { name: 'Tvorba', exact: true }).first().isVisible(), 'A: pás karet je dostupný');

    // sestava: náhled kreslí všechny komponenty na svých místech (dva kvádry 40 × 30 × 20 vedle sebe s mezerou 40 mm).
    // Díl se tvoří jedním voláním: „vložit“ bere obsah záložky, jak byl uložen při posledním přepnutí / běhu příkazů.
    await run(p, 'nový díl Kostka\nkvádr 40 30 20\ndíra 10 skrz v 20 15');
    await p.waitForTimeout(1500);
    const one = (await soft(p)).tris;
    await run(p, 'nová sestava Sestava A\nvložit "Kostka" v 0 0 0\nvložit "Kostka" v 80 0 0');
    await p.waitForFunction((n) => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) >= 2 * n, one, { timeout: 60000 }).catch(() => {});
    // aplikace po vložení komponenty sama přepne na izometrii (se zpožděním) – až potom jiný pohled
    await p.waitForTimeout(1500);
    await p.locator('[data-soft-view="front"]').click();
    await p.waitForTimeout(400);
    s = await soft(p);
    ok(one > 12 && s.tris === 2 * one && near(s.bw / s.bh, 120 / 20, 0.2) && s.mid[3] === 0, `A: sestava – obě komponenty v náhledu (${s.tris} trojúhelníků, obrys ${s.bw} × ${s.bh} px, mezera uprostřed)`);
    await p.locator('[data-soft-view="top"]').click();
    await p.waitForTimeout(400);
    s = await soft(p);
    ok(near(s.bw / s.bh, 120 / 30, 0.15), `A: sestava shora – obrys ${s.bw} × ${s.bh} px (čekáno 120 : 30)`);
    await p.screenshot({ path: S + 'nowebgl-assembly.png' });
    ok(errs.length === 0, 'A: žádná nezachycená JS chyba: ' + errs.join(' | '));
    await b.close();
  }

  // ───────────────────────────── B) s WebGL ─────────────────────────────
  {
    const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await start(p);
    ok(await p.evaluate(() => !!(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'))), 'B: prostředí – WebGL je dostupné');
    await run(p, 'nový díl S WebGL\nkvádr 40 30 20');
    await p.waitForTimeout(2500);
    ok(!(await p.locator('[data-viewport-fallback]').count()) && !(await p.locator('[data-soft-canvas]').count()) && !(await p.locator('[data-soft-why]').count()), 'B: s WebGL se náhled ani tlačítko „Proč nevidím 3D?“ neobjeví');
    ok(!/3D okno: nedostupné/.test(await p.locator('header').first().innerText()), 'B: horní lišta nehlásí nedostupné 3D okno');
    ok(await p.getByRole('button', { name: 'Přední', exact: true }).first().isVisible() && await p.locator('main svg[aria-hidden]').first().isVisible(), 'B: ViewCube a osový kříž 3D okna jsou vidět');
    let g = await gl(p);
    ok(g && g.n > 20000, `B: 3D okno (WebGL) kreslí model (${g && g.n} pixelů)`);
    const full = g.n;

    // výběr horní plochy přes popisky (klik na plochu)
    await p.evaluate(() => window.mncad.hints(true));
    await p.waitForTimeout(900);
    const hints = await p.evaluate(() => window.mncad.hints());
    const top = hints.find((h) => h.kind === 'face' && /\+Z/.test(h.title));
    const side = hints.find((h) => h.kind === 'face' && /\+X/.test(h.title));
    ok(!!top && !!side, 'B: popisky ploch +Z a +X jsou k dispozici');

    // řez: poloha číslem a výrazem
    await p.keyboard.press('x');
    await p.waitForTimeout(500);
    ok(planeIs(await plane(p), [0, 1, 0, -15]), 'B: řez začíná kolmo na Y uprostřed modelu (y = 15)');
    const n15 = (await gl(p)).n;
    await setPos(p, '5');
    const n5 = (await gl(p)).n;
    ok(planeIs(await plane(p), [0, 1, 0, -5]) && Number(await p.locator('[data-section-controls] input[type=range]').inputValue()) === 5, 'B: poloha 5 zapsaná číslem → rovina y = 5, posuvník 5');
    await setPos(p, '50/2');
    const n25 = (await gl(p)).n;
    ok(planeIs(await plane(p), [0, 1, 0, -25]), 'B: poloha výrazem 50/2 → rovina y = 25');
    ok(full > n5 && n5 > n15 && n15 > n25 && n25 > 0, `B: zapsaná poloha posouvá rovinu ořezu ve 3D okně (pixelů modelu: bez řezu ${full}, y=5 ${n5}, y=15 ${n15}, y=25 ${n25})`);
    // posuvník → číslo
    await p.locator('[data-section-controls] input[type=range]').evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '12.5');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.waitForTimeout(350);
    ok((await p.locator('[data-section-controls] input[aria-label="Poloha"]').inputValue()) === '12.5' && planeIs(await plane(p), [0, 1, 0, -12.5]), 'B: posuvník přepíše číselné pole (12.5)');
    g = await gl(p);
    ok(g.cap > 500, `B: plocha řezu je ve 3D okně vidět (${g.cap} červených pixelů)`);
    await p.screenshot({ path: S + 'webgl-section-number.png' });

    // rovina z vybrané plochy: záložka Plocha čeká na výběr, klik na plochu ji nastaví
    await p.locator('[data-section-tab="face"]').click();
    await p.waitForTimeout(300);
    ok(await p.locator('[data-section-wait]').isVisible() && planeIs(await plane(p), [0, 1, 0, -12.5]), 'B: záložka Plocha bez výběru čeká, rovina se zatím nemění');
    await p.evaluate((id) => window.mncad.clickHint(id), top.id);
    await p.waitForTimeout(600);
    ok(planeIs(await plane(p), [0, 0, -1, 20]) && (await p.locator('[data-section-controls]').getAttribute('data-section-mode')) === 'face', 'B: kliknutí na horní plochu položí rovinu řezu na ni (normála +Z, z = 20)');
    const nFace0 = (await gl(p)).n;
    await setPos(p, '-8');
    const nFace8 = (await gl(p)).n;
    ok(planeIs(await plane(p), [0, 0, -1, 12]) && nFace8 < nFace0, `B: posun −8 mm od plochy řeže do materiálu (rovina z = 12; pixelů ${nFace0} → ${nFace8})`);
    await p.screenshot({ path: S + 'webgl-section-face.png' });
    // jiná plocha tlačítkem „Použít vybranou plochu“ (rovina x = 40 je mimo oříznutou část → vyber před posunem)
    await setPos(p, '0');
    await p.evaluate((id) => window.mncad.clickHint(id), side.id);
    await p.waitForTimeout(500);
    ok(planeIs(await plane(p), [0, 0, -1, 20]), 'B: další výběr plochy rovinu sám nezmění');
    await p.locator('[data-section-use-face]').click();
    await p.waitForTimeout(400);
    ok(planeIs(await plane(p), [-1, 0, 0, 40]), 'B: Použít vybranou plochu → rovina boční plochy (normála +X, x = 40)');
    await setPos(p, '-10');
    await p.locator('[data-section-flip]').click();
    await p.waitForTimeout(350);
    ok(planeIs(await plane(p), [1, 0, 0, -30]), 'B: posun −10 a Otočit stranu → zůstává část x ≥ 30');

    // normála vektorem
    await p.locator('[data-section-tab="vector"]').click();
    await p.waitForTimeout(300);
    const vec = p.locator('[data-section-controls] input[aria-label="Normála roviny řezu"]');
    ok(/^1; 0; 0$/.test(await vec.inputValue()) && planeIs(await plane(p), [1, 0, 0, -30]), 'B: záložka Vektor převezme aktuální rovinu (normála 1; 0; 0, stejná poloha)');
    await vec.fill('1; 1; 0');
    await vec.press('Enter');
    await p.waitForTimeout(400);
    const pl = await plane(p);
    ok(near(Math.abs(pl[0]), Math.SQRT1_2, 0.001) && near(Math.abs(pl[1]), Math.SQRT1_2, 0.001) && pl[2] === 0, `B: normála 1; 1; 0 → rovina ${pl.join(' ')}`);
    g = await gl(p);
    ok(g.n > 0 && g.n < full, 'B: šikmý řez je ve 3D okně vidět');
    await p.screenshot({ path: S + 'webgl-section-vector.png' });
    await p.locator('[data-section-tab="Z"]').click();
    await p.waitForTimeout(300);
    ok(planeIs(await plane(p), [0, 0, -1, 10]), 'B: návrat na osu Z → rovina uprostřed (z = 10)');
    ok(errs.length === 0, 'B: žádná nezachycená JS chyba: ' + errs.join(' | '));
    await b.close();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
