// E2E 12. vlna – díra: průměr vrtáku závitové díry a ploché dno, textem (konzole / window.mncad.run) i formulářem.
//  1. text: „díra 6,647 závit M8“ ponechá Ø6,647 (protokol „vrták … zadán ručně“), „díra závit M8“ = tabulkový 6,8,
//     „jádro“ = D1 6,647, „dno ploché“ = rovné dno; objemy z window.mncad.measure proti analytickým vzorcům;
//     „měřit díry“ ukáže dno ploché / hrot 118°, stav vrták; chyby (vrták větší než závit, dno u díry skrz).
//  1b. 2. kolo kontroly: „název M8“ je název, upravit diameter / tapDrill / tipAngle a prvek hole platí jako text,
//     měřit díry najde hrot i v tenké desce a u strmého hrotu 65°, blízké zápisy dna nejsou tiše přehlédnuté.
//  2. formulář díry: „Vrták pro závit“ (tabulkový / jádro D1 / vlastní) a „Dno díry“ (kužel vrtáku / ploché) mění model
//     stejně jako text; změna závitu u vlastního vrtáku, který se k novému závitu nehodí → tabulkový vrták.
// Spuštění: E2E_BASE=http://localhost:3372 node e2e/cad-w12-hole.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

/** analytický objem slepé díry Ø d hloubky h s hrotem `tip` (null = ploché dno) */
const blind = (d, h, tip) => { const r = d / 2; return Math.PI * r * r * h + (tip === null ? 0 : (Math.PI * r * r * (r / Math.tan((tip * Math.PI) / 360))) / 3); };
const BOXV = 60 * 40 * 30;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 90000 }); };
  const measure = (q) => p.evaluate((x) => window.mncad.measure(x), q);
  const volume = async () => (await measure('těleso')).volume;
  const holes = () => doc().then((d) => d.features.filter((f) => f.type === 'hole'));

  try {
    // ── 1. text ──
    let log = await run('nový díl Díra W12\nkvádr 60 40 30\ndíra 6,647 závit M8 hloubka 20 v 15 20 30\ndíra 10 hloubka 15 dno ploché v 45 20');
    await idle();
    ok(/vrták Ø6,647 zadán ručně \(tabulkový 6,8\)/.test(log), 'protokol: „vrták Ø6,647 zadán ručně (tabulkový 6,8)“');
    let hs = await holes();
    ok(hs[0] && hs[0].diameter === 6.647 && hs[0].tapDrill === 'custom' && hs[0].thread === 'M8', 'díra 6,647 závit M8 → Ø6,647, tapDrill custom (' + JSON.stringify({ d: hs[0] && hs[0].diameter, t: hs[0] && hs[0].tapDrill }) + ')');
    ok(hs[1] && hs[1].tipAngle === 180, 'díra … dno ploché → tipAngle 180');
    let v = await volume();
    let want = BOXV - blind(6.647, 20, 118) - blind(10, 15, null);
    ok(Math.abs(v - want) < 0.01, `objem: ${v.toFixed(3)} mm³ (analyticky ${want.toFixed(3)})`);
    const mh = await measure('díry');
    const rep = mh.report && mh.report.holes || [];
    const flat = rep.find((h) => Math.abs(h.diameter - 10) < 1e-6);
    const tap = rep.find((h) => Math.abs(h.diameter - 6.647) < 1e-6);
    ok(flat && flat.bottom === 'flat' && Math.abs(flat.depth - 15) < 1e-6, 'měřit díry: Ø10 dno ploché, hloubka 15 (' + JSON.stringify(flat && { b: flat.bottom, d: flat.depth }) + ')');
    ok(tap && tap.bottom === 'cone' && Math.abs(tap.tipAngle - 118) < 0.01 && Math.abs(tap.depth - 20) < 1e-6, 'měřit díry: Ø6,647 hrot 118°, hloubka 20 (' + JSON.stringify(tap && { b: tap.bottom, a: tap.tipAngle, d: tap.depth }) + ')');
    log = await run('měřit díry');
    ok(/slepá, hloubka 15 mm · směr vrtání −Z · dno ploché/.test(log) && /hrot 118° \(ke špičce 21,997 mm\)/.test(log), 'protokol měřit díry: dno ploché / hrot 118° (ke špičce 21,997 mm)');
    const st = await p.evaluate(() => window.mncad.status());
    ok(/M8 hl\. 20 \(vrták Ø6,647 zadán ručně\)/.test(st) && /Ø10 hloubka 15 · dno ploché/.test(st), 'stav: vrták a dno díry');

    log = await run('nový díl Díra W12 b\nkvádr 60 40 30\ndíra závit M8 hloubka 20 v 15 20 30\ndíra závit M8 hloubka 20 jádro v 45 20 30\nhole 8 thread M8 depth 20 at 30 10 30');
    await idle();
    hs = await holes();
    ok(hs.length === 3 && hs[0].diameter === 6.8 && !hs[0].tapDrill && hs[1].diameter === 6.647 && hs[1].tapDrill === 'minor' && hs[2].diameter === 6.8, 'bez průměru = tabulkový 6,8; jádro = D1 6,647; EN „hole 8 thread M8“ = tabulkový (' + hs.map((h) => h.diameter + '/' + (h.tapDrill || 'table')).join(', ') + ')');
    ok(/jmenovitý průměr závitu M8 – vrtá se tabulkový vrták Ø6,8/.test(log), 'protokol: jmenovitý průměr → tabulkový vrták s poznámkou');
    v = await volume();
    want = BOXV - 2 * blind(6.8, 20, 118) - blind(6.647, 20, 118);
    ok(Math.abs(v - want) < 0.01, `objem tří závitových děr: ${v.toFixed(3)} mm³ (analyticky ${want.toFixed(3)})`);

    log = await run('díra 10 závit M8 hloubka 20 v 30 30 30');
    ok(/vrták Ø10 musí být menší než závit M8/.test(log), 'chyba: vrták větší než závit');
    log = await run('díra 10 skrz dno ploché v 30 30 30');
    ok(/jen pro slepou díru/.test(log), 'chyba: dno ploché u díry skrz');
    await idle();

    // ── 1b. 2. kolo kontroly: název, upravit / prvek, měřit dno v tenké desce, strmý hrot ──
    log = await run('nový díl Díra W12 c\nkvádr 60 40 25\ndíra 6,8 hloubka 20 v 15 20 25 název M8\ndíra závit M8 hloubka 20 v 45 20 25\ndíra 10 hloubka 12 hrot 65 v 30 30 25');
    await idle();
    hs = await holes();
    ok(hs[0] && hs[0].name === 'M8' && !hs[0].kind && !hs[0].thread && hs[0].diameter === 6.8, 'díra … název M8 = díra pojmenovaná M8, ne závit (' + JSON.stringify(hs[0] && { n: hs[0].name, k: hs[0].kind, t: hs[0].thread }) + ')');
    let rep2 = ((await measure('díry')).report || {}).holes || [];
    const tap2 = rep2.find((x) => Math.abs(x.diameter - 6.8) < 1e-6 && Math.abs(x.entry[0] - 45) < 1e-6);
    ok(tap2 && tap2.bottom === 'cone' && Math.abs(tap2.tipAngle - 118) < 0.01 && Math.abs(tap2.tipDepth - 22.043) < 0.001, 'měřit díry: M8 hl. 20 v desce 25 má hrot 118° (ke špičce 22,043) (' + JSON.stringify(tap2 && { b: tap2.bottom, a: tap2.tipAngle, t: tap2.tipDepth }) + ')');
    const steep = rep2.find((x) => Math.abs(x.diameter - 10) < 1e-6);
    ok(steep && steep.through === false && steep.bottom === 'cone' && Math.abs(steep.tipAngle - 65) < 0.01, 'měřit díry: hrot 65° = slepá díra s hrotem (' + JSON.stringify(steep && { th: steep.through, a: steep.tipAngle }) + ')');
    const v0 = await volume();
    log = await run('upravit "Díra 1" diameter=6,647'); // „M8“ je název první díry, závitová je Díra 1
    await idle();
    v = await volume();
    hs = await holes();
    ok(/vrták Ø6,647 zadán ručně \(tabulkový 6,8\)/.test(log) && hs[1].tapDrill === 'custom' && Math.abs((v - v0) - (blind(6.8, 20, 118) - blind(6.647, 20, 118))) < 0.01, `upravit diameter=6,647 u závitové díry: vrtá Ø6,647 (objem +${(v - v0).toFixed(3)} mm³)`);
    log = await run('upravit "Díra 1" tapDrill=foo');
    ok(/tapDrill „foo“ – zadejte table/.test(log), 'upravit tapDrill=foo = chyba s platnými hodnotami');
    log = await run('upravit "Díra 2" tipAngle=175');
    ok(/zadejte 60 až 170/.test(log), 'upravit tipAngle=175 = chyba (jako text)');
    log = await run('prvek hole diameter=8');
    ok(/chybí poloha – position=x;y;z/.test(log), 'prvek hole bez polohy = chyba řádku, ne výjimka');
    log = await run('díra 10 hloubka 12 s plochým dnem v 30 10 25');
    await idle();
    hs = await holes();
    ok(hs[3] && hs[3].tipAngle === 180, '„s plochým dnem“ = ploché dno');
    log = await run('díra 10 hloubka 12 kužel v 10 10 25');
    ok(/nerozumím slovu „kužel“/.test(log), 'slovo podobné volbě dna = chyba řádku');
    await idle();

    // ── 2. formulář ──
    await run('nový díl Díra W12 form\nkvádr 60 40 30\ndíra 6,647 závit M8 hloubka 20 v 30 20 30');
    await idle();
    let h = (await holes())[0];
    await p.locator('aside').first().getByText(h.name, { exact: true }).click(); await p.waitForTimeout(1200);
    ok(await p.getByText('Vrták pro závit').isVisible(), 'formulář závitové díry: pole „Vrták pro závit“');
    ok(await p.getByRole('button', { name: 'Vlastní', exact: true }).isVisible() && await p.locator('input[aria-label="Průměr vrtáku"]').isVisible(), 'formulář: díra z textu má „Vlastní“ a pole Průměr vrtáku');
    ok((await p.locator('input[aria-label="Průměr vrtáku"]').inputValue()).replace(',', '.') === '6.647', 'formulář: Průměr vrtáku = 6,647');
    await p.screenshot({ path: S + 'w12-hole-form-custom.png' });
    await p.getByRole('button', { name: 'Jádro D1 Ø6,647', exact: true }).click(); await idle();
    h = (await holes())[0];
    ok(h.tapDrill === 'minor' && h.diameter === 6.647, 'formulář: Jádro D1 → tapDrill minor, Ø6,647');
    await p.getByRole('button', { name: 'Tabulkový Ø6,8', exact: true }).click(); await idle();
    h = (await holes())[0];
    v = await volume();
    ok(!h.tapDrill && h.diameter === 6.8 && Math.abs(v - (BOXV - blind(6.8, 20, 118))) < 0.01, `formulář: Tabulkový → Ø6,8, objem ${v.toFixed(3)} mm³`);
    ok(await p.getByText(/Vrtá se Ø6,8 mm – tabulkový vrták; závit M8 se uvede ve výkrese\./).isVisible(), 'formulář: informace o vrtaném průměru');
    await p.getByRole('button', { name: 'Vlastní', exact: true }).click(); await p.waitForTimeout(400);
    const dIn = p.locator('input[aria-label="Průměr vrtáku"]');
    await dIn.fill('6,7'); await dIn.press('Tab'); await idle();
    h = (await holes())[0];
    v = await volume();
    ok(h.tapDrill === 'custom' && Math.abs(h.diameter - 6.7) < 1e-9 && Math.abs(v - (BOXV - blind(6.7, 20, 118))) < 0.01, `formulář: Vlastní 6,7 → objem ${v.toFixed(3)} mm³`);
    // dno
    ok(await p.getByText('Dno díry').isVisible() && await p.locator('input[aria-label="Úhel špičky vrtáku"]').isVisible(), 'formulář slepé díry: Dno díry (kužel vrtáku) + úhel špičky');
    await p.getByRole('button', { name: 'Ploché', exact: true }).click(); await idle();
    h = (await holes())[0];
    v = await volume();
    ok(h.tipAngle === 180 && Math.abs(v - (BOXV - blind(6.7, 20, null))) < 0.01, `formulář: Dno ploché → tipAngle 180, objem ${v.toFixed(3)} mm³`);
    ok(!(await p.locator('input[aria-label="Úhel špičky vrtáku"]').isVisible().catch(() => false)), 'formulář: u plochého dna se úhel špičky skryje');
    await p.screenshot({ path: S + 'w12-hole-form-flat.png' });
    ok(/M8 hl\. 20 \(vrták Ø6,7 zadán ručně\) · dno ploché/.test(await p.evaluate(() => window.mncad.status())), 'stav po úpravě formulářem: vrták Ø6,7, dno ploché');
    await p.getByRole('button', { name: 'Kužel vrtáku', exact: true }).click(); await idle();
    const ang = p.locator('input[aria-label="Úhel špičky vrtáku"]');
    await ang.fill('90'); await ang.press('Tab'); await idle();
    h = (await holes())[0];
    v = await volume();
    ok(h.tipAngle === 90 && Math.abs(v - (BOXV - blind(6.7, 20, 90))) < 0.01, `formulář: Kužel vrtáku 90° → objem ${v.toFixed(3)} mm³`);
    // změna závitu u vlastního vrtáku (6,647 pro M8) na M10: vrták se k M10 nehodí → tabulkový 8,5 (jako text „díra 6,647 závit M10“)
    await p.getByRole('button', { name: 'Vlastní', exact: true }).click(); await p.waitForTimeout(400);
    await dIn.fill('6,647'); await dIn.press('Tab'); await idle();
    ok(await p.getByText(/Vrtá se Ø6,647 mm – zadaný průměr \(tabulkový 6,8\)/).isVisible(), 'formulář: u vlastního vrtáku je vidět i tabulkový');
    await p.locator('label:has-text("Závit (hrubé i jemné stoupání)") select').selectOption('M10'); await idle();
    h = (await holes())[0];
    ok(h.thread === 'M10' && !h.tapDrill && h.diameter === 8.5, 'formulář: M8 → M10 s vrtákem 6,647 → tabulkový Ø8,5 (' + JSON.stringify({ t: h.thread, d: h.diameter, m: h.tapDrill }) + ')');
    await p.getByRole('button', { name: 'OK', exact: true }).click().catch(() => {});
  } catch (e) {
    ok(false, 'výjimka: ' + (e && e.stack || e));
  }
  ok(errs.length === 0, 'žádné chyby stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();
