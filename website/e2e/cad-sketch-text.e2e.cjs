// E2E: vazby, kóty a roviny skici textem (analýza nástrojů, bod 6) – přes window.mncad.run a konzoli Textové příkazy:
//  1. obdélník ze čtyř úseček + vazby + kóty → protokol „Plně určeno“, id e1–e4, souřadnice 80 × 50, stav s id entit; vysunout → 40 cm³
//  2. chybný odkaz → česká chyba na správném řádku (window.mncad.run i konzole), nic se nepřidá
//  3. kvádr, skica na horní ploše „skica plocha F<n>“ (číslo z popisků pro výběr) + vysunout 3 → objem vzroste; otisk plochy v planeDef
//  4. plocha pravidlem (horní, +X) – příklad 4 z návodu pro AI; skica na pomocné rovině podle názvu
// Spuštění: E2E_BASE=http://localhost:3100 node e2e/cad-sketch-text.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const vol = (log) => { const m = (log.match(/objem ([\d\s  ,]+) cm³/g) || []).pop(); return m ? parseFloat(m.replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
const bad = (log) => log.split('\n').filter((l) => /^(✗|⚠)/.test(l.trim()));
const near = (a, b, tol = 1e-3) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tol);

const RECT = `nový díl Vazby textem
skica XY
úsečka 0 0 60 0
úsečka 60 0 60 40
úsečka 60 40 0 40
úsečka 0 40 0 0
vazba shodně e1.b e2.a; shodně e2.b e3.a; shodně e3.b e4.a; shodně e4.b e1.a
vazba vodorovně e1; vodorovně e3; svisle e2; svisle e4
vazba shodně e1.a počátek
kóta délka e1 80
kóta délka e2 50`;

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
  const status = () => p.evaluate(() => window.mncad.status());
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const lastSketch = async () => (await doc()).features.filter((f) => f.type === 'sketch').pop();

  // ── 1. obdélník ze čtyř úseček: vazby + kóty → Plně určeno ──
  let log = await run(RECT);
  await idle();
  ok(bad(log).length === 0, 'obdélník: žádný řádek ✗ / ⚠ ' + bad(log).join(' | '));
  ok(/✓ 1 entita do skici „Skica 1“ \(e1\)/.test(log) && /\(e4\)/.test(log), 'protokol vypíše id entit e1 … e4');
  ok(/vazby ve skice „Skica 1“: vodorovně e1, vodorovně e3, svisle e2, svisle e4 → Nedourčeno \(4 st\. volnosti\)/.test(log), 'po vazbách vodorovně/svisle: Nedourčeno (4 st. volnosti)');
  ok(/kóty ve skice „Skica 1“: délka e2 50 → Plně určeno/.test(log), 'po poslední kótě protokol napíše „Plně určeno“: ' + (log.match(/.*délka e2 50.*/) || [''])[0]);
  let sk = await lastSketch();
  const E = (id) => sk.entities.find((e) => e.id === id);
  ok(sk.entities.map((e) => e.id).join(',') === 'e1,e2,e3,e4', 'entity skici mají id e1–e4 (' + sk.entities.map((e) => e.id).join(',') + ')');
  ok(near(E('e1').a, [0, 0]) && near(E('e1').b, [80, 0]) && near(E('e2').b, [80, 50]) && near(E('e3').b, [0, 50]) && near(E('e4').a, [0, 50]), 'řídicí kóty změnily geometrii: obdélník 80 × 50 od počátku (' + JSON.stringify(sk.entities.map((e) => [e.a, e.b])) + ')');
  ok(sk.constraints.length === 9 && sk.dims.length === 2, `vazby (${sk.constraints.length}) a kóty (${sk.dims.length}) jsou uložené ve skice`);
  let st = await status();
  ok(/entity: e1 úsečka \[0; 0\]→\[80; 0\] · e2 úsečka \[80; 0\]→\[80; 50\]/.test(st), 'stav vypíše entity skici s id a souřadnicemi');
  ok(/vazby 9, kóty 2 · Plně určeno/.test(st), 'stav vypíše počet vazeb a kót a „Plně určeno“');
  log = await run('vysunout 10\nstav');
  await idle();
  ok(bad(log).length === 0 && Math.abs(vol(log) - 40) < 0.005, `vysunutí plně určeného obdélníku: objem ${vol(log)} cm³ (80 × 50 × 10 = 40)`);

  // ── 2. chybný odkaz → česká chyba na správném řádku ──
  log = await run('# chybný odkaz na entitu\nvazba kolmo e1 e9');
  ok(/✗ řádek 2: entita „e9“ ve skice „Skica 1“ není – entity: e1, e2, e3, e4/.test(log), 'neexistující entita: ' + (log.match(/✗.*/) || [''])[0]);
  log = await run('vazba kolmo e1\nkóta délka e1\nvazba kolmo e1 e2.a');
  ok(/✗ řádek 1: vazba kolmo: špatný počet odkazů \(1\) – zápis: vazba kolmo e1 e2 \(dvě úsečky\)/.test(log), 'špatný počet odkazů → zápis vazby (řádek 1)');
  ok(/✗ řádek 2: kóta délka potřebuje hodnotu/.test(log), 'kóta bez hodnoty → chyba na řádku 2');
  ok(/✗ řádek 3: vazba kolmo: „e2.a“ je bod, čeká se úsečka – zápis: vazba kolmo e1 e2/.test(log), 'bod místo úsečky → chyba na řádku 3: ' + (log.match(/✗ řádek 3.*/) || [''])[0]);
  sk = await lastSketch();
  ok(sk.constraints.length === 9 && sk.dims.length === 2, 'chybné řádky nic nepřidaly (vazeb ' + sk.constraints.length + ', kót ' + sk.dims.length + ')');
  // konzole Textové příkazy (UI): stejná chyba v protokolu
  await p.evaluate(() => window.mncad.openConsole()); await p.waitForTimeout(500);
  const ta = p.getByLabel('Textové příkazy nebo JSON', { exact: true });
  await ta.fill('kóta poloměr e1 5');
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction(() => /řádek 1/.test(document.querySelector('[data-agent-output]')?.textContent || ''), null, { timeout: 60000 });
  const out = await p.locator('[data-agent-output]').innerText();
  ok(/✗ řádek 1: kóta poloměr: „e1“ je úsečka, čeká se kružnice \/ oblouk/.test(out), 'konzole: chyba kóty poloměr na úsečce je v protokolu');
  await p.screenshot({ path: S + 'sketch-text-console.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const closeBtn = p.getByRole('button', { name: /Zavřít/ }).first();
  if (await p.locator('[data-agent-output]').isVisible().catch(() => false)) await closeBtn.click().catch(() => {});

  // ── 3. kvádr + skica na horní ploše číslem F z popisků pro výběr ──
  log = await run('nový díl Plocha\nkvádr 40 30 20\nstav');
  await idle(); await p.waitForTimeout(1500);
  const v0 = vol(log);
  await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(1200);
  const hints = await p.evaluate(() => window.mncad.hints());
  const top = hints.find((h) => h.kind === 'face' && /normála \+Z/.test(h.title));
  ok(!!top, 'popisky pro výběr: horní plocha kvádru má štítek ' + (top ? top.id + ' – ' + top.title : '(nenalezen) ' + hints.filter((h) => h.kind === 'face').map((h) => h.id + ' ' + h.title).join('; ')));
  await p.evaluate(() => window.mncad.hints(false));
  const F = top ? top.id : 'F1';
  log = await run(`skica plocha ${F}: kružnice 5\nvysunout 3\nstav`);
  await idle();
  ok(bad(log).length === 0, `skica plocha ${F}: bez chyb ` + bad(log).join(' | '));
  ok(new RegExp(`✓ Skica 1 na ploše ${F} – rovina: počátek \\[20; 15; 20\\], normála \\+Z`).test(log), 'protokol: skica na ploše, počátek ve středu horní plochy, normála +Z: ' + (log.match(/.*na ploše.*/) || [''])[0]);
  const v1 = vol(log);
  ok(Math.abs(v1 - v0 - Math.PI * 6.25 * 3 / 1000) < 0.006, `vysunout 3 z horní plochy: objem ${v0} → ${v1} cm³ (+0,059)`);
  sk = await lastSketch();
  ok(sk.planeDef && sk.planeDef.kind === 'face' && sk.planeDef.ref.index === Number(F.slice(1)) - 1 && !!sk.planeDef.ref.sig, 'planeDef = plocha s indexem F−1 a otiskem (' + JSON.stringify(sk.planeDef) + ')');
  ok(sk.plane.kind === 'custom' && near(sk.plane.origin, [20, 15, 20]) && near(sk.plane.normal, [0, 0, 1]), 'vyřešená rovina skici v dokumentu (' + JSON.stringify(sk.plane) + ')');
  ok(sk.entities[0].id === 'e1', 'entita skici na ploše má id e1');
  log = await run('skica plocha F999: kružnice 2');
  ok(/✗ řádek 1: plocha F999 v tělese není – těleso má \d+ ploch \(F1 až F\d+\) – rovinné plochy: F\d+ \(normála/.test(log) && !/✓ 1 entita/.test(log), 'neexistující plocha → chyba s výčtem rovinných ploch, entita se nikam nepřidá');

  // ── 4. plocha pravidlem: příklad 4 z návodu pro AI; pomocná rovina podle názvu ──
  log = await run(`nový díl Návod příklad 4
kvádr 80 50 20
skica plocha horní: kružnice 12
vazba soustředně e1 počátek
vysunout 8
skica plocha +X: obdélník 30 10
vazba shodně e1.střed počátek; vodorovně e1.s0
kóta délka e1.s0 30; délka e1.s1 10
vysunout 2 odebrat obráceně
stav`);
  await idle();
  const expV = (80 * 50 * 20 + Math.PI * 36 * 8 - 30 * 10 * 2) / 1000;
  ok(bad(log).length === 0, 'příklad 4 z návodu: bez chyb ' + bad(log).join(' | '));
  ok(/kóty ve skice „Skica 2“: délka e1\.s0 30, délka e1\.s1 10 → Plně určeno/.test(log), 'obdélník na boku +X je plně určený');
  ok(Math.abs(vol(log) - expV) < 0.006, `čep na horní ploše a kapsa do boku +X: objem ${vol(log)} cm³ (${expV.toFixed(2)})`);
  log = await run(`nový díl Pomocná rovina
kvádr 20 20 10
prvek datum origin=[10,10,5] normal=[0,0,1] xDir=[1,0,0] size=40
skica rovina "Rovina 1" odsazení 5: kružnice 10
vysunout 5
stav`);
  await idle();
  ok(bad(log).length === 0 && /✓ Skica 1 na pomocné rovině „Rovina 1“ \+5 mm – rovina: počátek \[10; 10; 10\], normála \+Z/.test(log), 'skica na pomocné rovině podle názvu + odsazení: ' + ((log.match(/.*pomocné rovině.*/) || [''])[0] || bad(log).join(' | ')));
  ok(Math.abs(vol(log) - (4000 + Math.PI * 25 * 5) / 1000) < 0.006, `vysunutí ze skici na pomocné rovině: objem ${vol(log)} cm³ (4,39)`);
  sk = await lastSketch();
  ok(sk.planeDef && sk.planeDef.kind === 'datum' && sk.planeDef.offset === 5, 'planeDef = pomocná rovina s odsazením (' + JSON.stringify(sk.planeDef) + ')');

  await p.screenshot({ path: S + 'sketch-text-final.png' });
  ok(errs.length === 0, 'bez chyb stránky ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
