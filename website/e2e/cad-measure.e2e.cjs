// E2E: měření pro AI agenty – příkaz „měřit“ (window.mncad.run + konzole) a window.mncad.measure:
//  1. deska s průchozími a slepou dírou + čep textem → měřit díry / těleso / válce / plocha horní (řádky protokolu, čísla)
//  2. window.mncad.measure: plochy pravidlem → čísla F, vzdálenost rovnoběžných ploch = rozměr, úhel 90°, rozteč děr, bod
//  3. chyby: neexistující číslo plochy (platný rozsah), F0; měření nemění dokument
//  4. sestava: Komponenta:těleso / válce, vzdálenost komponent; konzole Textové příkazy
// Spuštění: E2E_BASE=http://localhost:3310 node e2e/cad-measure.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3310').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const bad = (log) => log.split('\n').filter((l) => /^(✗|⚠)/.test(l.trim()));
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();
const near = (a, b, tol = 1e-3) => typeof a === 'number' && Math.abs(a - b) < tol;

const PLATE = `nový díl Měření
kvádr 100 60 20
díra 8 skrz v 20 30 20
díra 8 skrz v 80 30 20
díra 6 hloubka 10 v 50 52 20
válec 30 15 v 50 30 20
měřit díry
měřit těleso
měřit válce
měřit plocha horní`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const measure = (a, bb) => p.evaluate(([x, y]) => window.mncad.measure(x, y === null ? undefined : y), [a, bb === undefined ? null : bb]);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });

  // ── 1. model textem + měřit v protokolu ──
  let log = await run(PLATE);
  await idle();
  ok(bad(log).length === 0, 'model a měření bez ✗ / ⚠ ' + bad(log).join(' | '));
  ok(log.includes('Díry: 3 – Ø 6 mm × 1, Ø 8 mm × 2'), 'měřit díry: souhrn po průměrech: ' + line(log, /^Díry:/));
  ok(/D1 Ø 6 mm: vstup \[50; 52; 20\] · slepá, hloubka 10 mm · směr vrtání −Z/.test(log), 'slepá díra: vstup, hloubka, směr: ' + line(log, /D1 /));
  ok(/D2 Ø 8 mm: vstup \[20; 30; 20\] · skrz, délka 20 mm · osa \+Z/.test(log) && /D3 Ø 8 mm: vstup \[80; 30; 20\] · skrz, délka 20 mm/.test(log), 'průchozí díry: vstup a délka: ' + line(log, /D2 /) + ' | ' + line(log, /D3 /));
  ok(/Těleso: obálka 100 × 60 × 35 mm \(X 0…100, Y 0…60, Z 0…35\) · objem [\d,]+ mm³/.test(log), 'měřit těleso: obálka a objem: ' + line(log, /^Těleso:/).slice(0, 120));
  ok(/hmotnost [\d,]+ kg \(7,85 g\/cm³\) · těžiště \[/.test(log), 'měřit těleso: hmotnost a těžiště');
  ok(/Válce: 1 – Ø 30 mm × 1/.test(log) && /C1 Ø 30 mm: délka 15 mm · osa \+Z · od \[50; 30; 20\] do \[50; 30; 35\]/.test(log), 'měřit válce: čep Ø30 × 15: ' + line(log, /C1 /));
  ok(/Plochy podle pravidla „horní“: 1/.test(log) && /F\d+: rovinná plocha · normála \+Z/.test(log), 'měřit plocha horní: ' + line(log, /rovinná plocha · normála \+Z/).slice(0, 100));
  const d0 = await doc();
  ok(d0.features.length === 5 && !d0.features.some((f) => f.type === 'measure'), `měření nepřidá prvky (${d0.features.length})`);

  // ── 2. window.mncad.measure ──
  const px = await measure('plocha +X'); const nx = await measure('plocha -X');
  const bot = await measure('plocha spodní');
  ok(px.ok && nx.ok && bot.ok && px.report.entities.length === 1, 'plochy pravidlem přes API: ' + [px, nx, bot].map((x) => x.lines && x.lines[1]).join(' | ').slice(0, 160));
  const fx = px.report.entities[0].label; const fnx = nx.report.entities[0].label; const fb = bot.report.entities[0].label;
  const w = await measure(fx, fnx);
  ok(w.ok && w.kind === 'pair' && near(w.distance, 100) && w.report.pair.parallel === true && near(w.report.pair.planeDistance, 100), `${fx} ↔ ${fnx}: vzdálenost rovin 100 (${w.distance}) – ${w.lines[0]}`);
  ok(/rovnoběžné\) · vzdálenost rovin 100 mm/.test(w.lines[0]), 'řádek dvojice uvádí „rovnoběžné“ a vzdálenost rovin');
  const a = await measure(fx, fb);
  ok(a.ok && near(a.angle, 90) && a.report.pair.perpendicular === true, `${fx} ↔ ${fb}: úhel 90° (${a.angle})`);
  const holes = await measure('díry');
  ok(holes.ok && holes.report.holes.length === 3, 'API díry: 3 (' + (holes.report && holes.report.holes.length) + ')');
  const h8 = holes.report.holes.filter((h) => near(h.diameter, 8));
  const pitch = await measure('F' + h8[0].faces[0], 'F' + h8[1].faces[0]);
  ok(pitch.ok && near(pitch.report.pair.axisDistance, 60) && near(pitch.angle, 0) && /vzdálenost os 60 mm/.test(pitch.lines[0]), 'rozteč děr Ø8: vzdálenost os 60 – ' + pitch.lines[0]);
  const fh = await measure('F' + h8[0].faces[0]);
  ok(fh.ok && near(fh.diameter, 8) && fh.report.entity.hole === true && near(fh.length, 20), 'plocha díry: Ø8, díra, délka 20 – ' + fh.lines[0]);
  const pos = await measure('F' + h8[0].faces[0], fnx);
  ok(pos.ok && near(pos.report.pair.planeDistance, 20), 'poloha díry od boku −X: 20 mm od osy (' + (pos.report && pos.report.pair.planeDistance) + ')');
  const pt = await measure('V1', [0, 0, 100]);
  ok(pt.ok && typeof pt.distance === 'number' && pt.points.length === 2, 'vrchol × bod [0, 0, 100]: ' + pt.lines[0]);
  const body = await measure('těleso');
  ok(body.ok && body.volume > 120000 && body.report.body.size[2] === 35, 'API těleso: objem ' + body.volume);

  // ── 3. chyby, konzole ──
  log = await run('měřit F999\nměřit F0');
  const nF = (await measure('těleso')).report.body.faces;
  ok(new RegExp(`✗ řádek 1: plocha F999 v tělese není – těleso má ${nF} ploch \\(F1 až F${nF}\\)`).test(log), 'neexistující plocha → platný rozsah: ' + line(log, /řádek 1/));
  ok(/✗ řádek 2: čísla ploch, hran a vrcholů začínají 1/.test(log), 'F0 → chyba čtení');
  const e = await measure('E99999');
  ok(e.ok === false && /hrana E99999 v tělese není/.test(e.error), 'API chyba: ' + e.error);
  ok((await doc()).features.length === 5, 'chybná měření nezměnila dokument');

  // ── 4. sestava: komponenta:entita (světové souřadnice) ──
  log = await run(`nový díl Kostka
kvádr 10 10 10
nový díl Čep
válec 10 10
nová sestava Sestava měření
vložit "Kostka" v 0 0 0
vložit "Čep" v 30 0 0
měřit Kostka:těleso
měřit Čep:válce
měřit Kostka:těleso Čep:těleso
měřit F1`);
  await idle();
  ok(/Kostka: obálka 10 × 10 × 10 mm \(X 0…10, Y 0…10, Z 0…10\)/.test(log), 'sestava: Kostka:těleso – ' + line(log, /^Kostka: obálka/).slice(0, 90));
  ok(/C1 Ø 10 mm: délka 10 mm · osa \+Z · od \[30; 0; 0\] do \[30; 0; 10\]/.test(log), 'sestava: Čep:válce ve světových souřadnicích – ' + line(log, /C1 /));
  ok(/Kostka:těleso ↔ Čep:těleso: vzdálenost 15 mm/.test(log), 'sestava: vzdálenost komponent 15 mm – ' + line(log, /↔/));
  ok(/✗ řádek 11: v sestavě uveďte komponentu: měřit Hřídel:F3 Deska:F1 – komponenty: Kostka, Čep/.test(log), 'sestava bez komponenty → nápověda se seznamem komponent');

  await p.evaluate(() => window.mncad.openConsole()); await p.waitForTimeout(500);
  const ta = p.getByLabel('Textové příkazy nebo JSON', { exact: true });
  await ta.fill('měřit Čep:válce');
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction(() => /Válce: 1/.test(document.querySelector('[data-agent-output]')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const out = await p.locator('[data-agent-output]').innerText();
  ok(/Čep: Válce: 1 – Ø 10 mm × 1/.test(out), 'konzole: měřit Čep:válce v protokolu');
  await p.screenshot({ path: S + 'measure-console.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  ok(errs.length === 0, 'bez chyb stránky ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
