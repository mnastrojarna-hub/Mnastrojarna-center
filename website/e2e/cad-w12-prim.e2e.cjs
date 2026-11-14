// E2E 12. vlny – primitiva textem jako holé jádro: poloha a osa odkazem, pružina, nápověda polí prvku, odkazy u rotace / pole /
// zrcadlení / sražení; formulář ukáže totéž, co zadal text.
// Spuštění: E2E_BASE=http://localhost:3373 node e2e/cad-w12-prim.e2e.cjs   (výchozí server :3100)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1000);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const vol = async () => { const m = (await p.evaluate(() => window.mncad.status())).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

  // ── kužel odebraný v poloze na šikmé ose (dřív „směr“ tiše ignorován) ──
  let log = await run('nový díl W12 primitiva\nkvádr 100 100 60 v -50 -50 0\nkužel 20 0 15 v 0 0 40 osa 0 0,5 -0,866 odebrat');
  await idle();
  ok(!/(^|\n)✗/.test(log), 'kvádr + kužel na šikmé ose bez chyby');
  let v = await vol();
  ok(near(v, (600000 - Math.PI * 100 * 15 / 3) / 1000), `kužel odebrán celý: objem ${v} cm³ = 600 − πr²h/3`);
  let f = (await doc()).features.find((x) => x.type === 'cone');
  ok(f && f.mode === 'cut' && f.dirDef && f.dirDef.kind === 'vector' && f.dirDef.v[1] === 0.5, 'kužel: mode cut, dirDef vektor 0 0,5 -0,866');

  // ── válec odebraný podél vektoru 1 0 1 ──
  log = await run('válec 10 150 v -80 -20 -40 osa 1 0 1 odebrat');
  await idle();
  const v2 = await vol();
  ok(near(v - v2, Math.PI * 25 * 60 * Math.SQRT2 / 1000, 0.03), `válec podél 1 0 1: odebráno ${(v - v2).toFixed(3)} cm³ = πr²·t/cos45°`);

  // ── kvádr vystředěný na pomocném bodu názvem (aplikace převede název na id) + válec po pomocné ose názvem ──
  log = await run('prvek datumPoint ref={"kind":"xyz","p":[0,30,60]} název="Bod A"\nkvádr 10 10 10 střed na bod "Bod A" odebrat\nprvek datumAxis def={"kind":"global","axis":"X"} length=50 název="Osa A"\nválec 6 30 v -60 -30 30 osa "Osa A" odebrat');
  await idle();
  ok(!/(^|\n)✗/.test(log), 'pomocný bod a osa názvem bez chyby: ' + (log.match(/(^|\n)✗[^\n]*/) || [''])[0]);
  const v3 = await vol();
  ok(near(v2 - v3, (500 + Math.PI * 9 * 20) / 1000, 0.02), `kapsa na bodu „Bod A“ + otvor po ose „Osa A“: odebráno ${(v2 - v3).toFixed(3)} cm³`);
  const d = await doc();
  const box2 = d.features.filter((x) => x.type === 'box')[1];
  const pt = d.features.find((x) => x.type === 'datumPoint');
  ok(box2 && box2.positionRef && box2.positionRef.kind === 'datumPoint' && box2.positionRef.featureId === pt.id, 'kvádr: positionRef = id pomocného bodu (název převeden)');
  const st = await run('stav');
  ok(/střed bod „Bod A“/.test(st) && /osa pomocná osa „Osa A“/.test(st), 'stav ukáže polohu a osu odkazem');
  ok(/podstava \[0; 0; 40\], osa \[0; 0,5; -0,866\]/.test(st), 'stav ukáže polohu a šikmou osu kuželu');

  // ── pružina textem ──
  log = await run('pružina 20 stoupání 5 závity 4 drát 2 v 100 0 0 osa X nové těleso "Pružina"');
  await idle();
  ok(!/(^|\n)✗/.test(log) && (await doc()).features.some((x) => x.type === 'spring' && x.axis === 'X' && x.turns === 4), 'pružina 20 stoupání 5 závity 4 drát 2 osa X → prvek spring');
  ok(/Tělesa: .*Pružina/.test(await p.evaluate(() => window.mncad.status())), 'pružina jako nové těleso „Pružina“');

  // ── chyby místo tichého ignorování ──
  log = await run('kužel 20 10 30 směr');
  ok(/✗ řádek 1: osa \/ směr potřebuje hodnotu/.test(log), 'kužel … směr bez hodnoty → ✗');
  log = await run('koule 10 osa X');
  ok(/koule nemá osu/.test(log), 'koule s osou → ✗ koule nemá osu');

  // ── nápověda polí ──
  log = await run('prvek nápověda kužel');
  ok(/Kužel \(cone\) – pole pro „prvek cone klíč=hodnota“/.test(log) && / • dirDef – směr \(JSON Direction\)/.test(log) && /text: osa -Z/.test(log), 'prvek nápověda kužel → všechna pole s textovým zápisem');
  log = await run('nápověda díra');
  ok(/Díra \(hole\)/.test(log) && / • tipAngle – /.test(log), 'nápověda díra → pole díry');
  log = await run('prvek nápověda sheet.bend');
  ok(/\(sheet\.bend\) – parametry/.test(log) && / • angle \(/.test(log), 'prvek nápověda sheet.bend → parametry rozšíření');
  log = await run('prvek nápověda');
  ok(/ • sweep \(Tažení\): bez textového příkazu/.test(log) && / • cone \(Kužel\): text ✓ · vše textem/.test(log), 'prvek nápověda → přehled mezer textu');

  // ── odkazy u rotace / pole / zrcadlení / sražení ──
  log = await run('nový díl W12 odkazy\nkvádr 40 60 20\nprvek datum origin=50;0;0 normal=1;0;0 xDir=0;1;0 size=50 název="Rovina Z"\nzrcadlit rovina "Rovina Z"');
  await idle();
  ok(!/(^|\n)✗/.test(log) && near(await vol(), 2 * 40 * 60 * 20 / 1000), 'zrcadlit rovina "Rovina Z" → objem 2×');
  ok(/Zrcadlení 1 \[mirror, id \w+\] ✓ – pomocná rovina „Rovina Z“/.test(log), 'stav zrcadlení ukáže pomocnou rovinu názvem');
  log = await run('srazit 2 úhel 45 plocha F6\nzaoblit 1 hrany E1');
  await idle();
  const fs = (await doc()).features;
  const ch = fs.find((x) => x.type === 'chamfer');
  ok(ch && ch.kind === 'distanceAngle' && ch.angle === 45 && ch.faceRef && ch.faceRef.index === 5, 'srazit 2 úhel 45 plocha F6 → distanceAngle + referenční plocha');
  const fi = fs.find((x) => x.type === 'fillet');
  ok(fi && Array.isArray(fi.edges) && fi.edges.length === 1 && fi.edges[0] === 0, 'zaoblit 1 hrany E1 → hrana číslem (index 0)');

  // ── formulář ukáže totéž co text (osa libovolným směrem, poloha odkazem) ──
  await run('nový díl W12 formulář\nkvádr 60 40 20\nválec 8 30 na V3 osa 0 1 1');
  await idle();
  await p.getByText('Válec 1', { exact: true }).first().click();
  await p.waitForTimeout(800);
  const dirBox = p.getByLabel(/Osa libovolným směrem/).first();
  ok(await dirBox.isChecked().catch(() => false), 'formulář válce: „Osa libovolným směrem“ zaškrtnuto (dirDef z textu)');
  ok(await p.getByText('Vrchol 3').first().isVisible().catch(() => false), 'formulář válce: poloha odkazem „Vrchol 3“ (na V3 z textu)');

  // ── oprava po kontrole: CS „osa body V1 V7“ ≠ EN „body“ = těleso ──
  log = await run('nový díl W12 kontrola\nkvádr 40 40 20\nválec 6 30 v 20 20 20 osa body V1 V7 odebrat');
  await idle();
  ok(!/(^|\n)✗/.test(log) && (await vol()) < 32 - 0.3, 'válec … osa body V1 V7 odebrat staví (dřív ✗ těleso „V1 V7“): ' + (log.match(/(^|\n)✗[^\n]*/) || [''])[0]);
  // ── nové těleso s polohou odkazem: pružina do sedla ──
  log = await run('nový díl W12 pružina\nkvádr 60 40 30\nválec 12,5 15 v 30 20 30 osa -Z odebrat\npružina 11 stoupání 4 závity 5 drát 1,5 na střed plochy F8 nové těleso "Pružina"');
  await idle();
  ok(!/(^|\n)✗/.test(log) && /Tělesa: .*Pružina/.test(await p.evaluate(() => window.mncad.status())), 'pružina na střed plochy F8 jako nové těleso (dřív ✗ odkaz vyžaduje těleso)');
  // ── kruhové pole: osa kruhovou hranou = osa kružnice; rovinná plocha = chyba ──
  log = await run('nový díl W12 pole\nválec 80 20\nválec 6 20 v 35 0 0 odebrat\npole kruhové 36 osa hrana E1\nměřit díry');
  await idle();
  ok(/Díry: 36 – Ø 6 mm × 36/.test(log), 'pole kruhové 36 osa hrana E1 → 36 děr (dřív 5 a bez varování)');
  log = await run('nový díl W12 pole2\nválec 80 20\nválec 20 20 odebrat\nválec 6 20 v 30 0 0 odebrat\npole kruhové 6 osa plocha F2');
  await idle();
  ok(/✗ Pole 1 \(pattern\): Plocha F2 není válcová ani kuželová/.test(log), 'pole kruhové osa plocha F<rovinná> → ✗ (dřív posunuté díry bez varování)');
  // ── kvádr „střed F1“ = vystředit; dvě operace = chyba; číslo za osou ──
  log = await run('nový díl W12 kvádr\nkvádr 60 40 20\nkvádr 10 10 10 střed F1 odebrat\nválec 10 20 přidat odebrat\nkužel 20 0 15 v 20 20 20 osa 0 0,5 -0,866 0 odebrat');
  await idle();
  ok(near(await vol(), 48 - 0.5), 'kvádr 10 10 10 střed F1 odebrat = vystředěný (odebráno 0,5 cm³)');
  ok(/operace „přidat“ a „odebrat“ se vylučují/.test(log), 'válec … přidat odebrat → ✗ (dřív tiše cut)');
  ok(/osa vektorem má tři složky – číslo „0“/.test(log), 'číslo navíc za osou vektorem → hláška o ose');
  // ── výkres: díra z odebraného válce + vnitřní závit odkazem ──
  log = await run('nový díl W12 výkres\nkvádr 60 40 20\nválec 6,8 16 v 15 20 20 osa -Z odebrat\nzávit M8 délka 12 na střed kružnice E10 osa -Z vnitřní');
  await idle();
  log = await run('výkres A3 na šířku pohledy horní,přední\nkótovat\nvýkres stav');
  ok(/M8 ↧12 \/ Ø6,8 ↧16/.test(log) && /Kontrola kót: všech \d+ očekávaných rozměrů je na listu/.test(log), 'výkres: válec odebrat + vnitřní závit odkazem → „M8 ↧12 / Ø6,8 ↧16“, kontrola kót bez chybějících');
  // ── příklad z návodu vložený beze změny ──
  const guide = await p.evaluate(() => window.mncad.guide());
  const gi = guide.indexOf('### Primitiva – poloha a osa odkazem');
  const ga = guide.indexOf('```', gi) + 3;
  log = await run('nový díl W12 návod\n' + guide.slice(ga, guide.indexOf('```', ga)).trim());
  await idle();
  ok(!/(^|\n)✗/.test(log) && /Tělesa: .*Pružina/.test(await p.evaluate(() => window.mncad.status())), 'příklad z návodu (primitiva odkazem) – všechny řádky ✓: ' + (log.match(/(^|\n)✗[^\n]*/) || [''])[0]);

  ok(errs.length === 0, 'bez chyb stránky: ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exitCode = 1; });
