// E2E – pružiny na výkrese zjednodušeně podle ISO 2162-1 (w14 drawing-perf): díl s pružinou a sestava se dvěma pružinami
// se na listu spočítají rychle (obal vinutí místo šroubovice), `výkres stav` to uvádí ve Volbách, `výkres pružiny plně`
// a zaškrtávátko „Pružiny plným tvarem“ ve výkresovém prostředí přepnou list na skutečnou šroubovici a zpět.
// Spuštění: E2E_BASE=http://localhost:3341 node e2e/cad-drawing-springs.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-drawing-springs').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 300000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const first = (log, re) => (re.exec(log) || [])[0] || '';

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 }); await start(p);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const timed = async (t) => { const t0 = Date.now(); const log = await run(t); return { log, ms: Date.now() - t0 }; };

  // ── 1. díl s pružinou (6 závitů): list A4 se spočítá rychle, stav uvádí zjednodušené pružiny ──
  const r1 = await timed(['nový díl "Pružina T"', 'pružina 17,5 stoupání 6 závity 6 drát 2,5', 'výkres A4 pohledy přední,horní,iso', 'výkres stav'].join('\n'));
  fs.writeFileSync(S + 'log1.txt', r1.log);
  ok(!/^✗/m.test(r1.log), 'díl s pružinou + výkres bez chyb' + (first(r1.log, /^✗.*$/m) ? ' – ' + first(r1.log, /^✗.*$/m) : ''));
  ok(/Volby: .*pružiny zjednodušeně \(ISO 2162-1\)/.test(r1.log), 'výkres stav: Volby – pružiny zjednodušeně (ISO 2162-1)');
  ok(r1.ms < 60000, `list s pružinou spočítaný za ${r1.ms} ms (< 60 s; plný tvar šroubovice trvá v Node ~67 s)`);
  // Chytré kóty čtou skutečný tvar: vnitřní válec obalu se nekótuje jako díra (nález recenze: „horní: Ø15 skrz“)
  ok(!/^\s*(přední|horní|iso):.*(skrz|↧|Ø15)/m.test(r1.log), 'Chytré kóty: žádná díra z obalu pružiny' + (first(r1.log, /^\s*horní:.*$/m) ? ' – ' + first(r1.log, /^\s*horní:.*$/m).trim() : ''));
  // tisíciny modelu na listu (vlna 15, B7: 38,485 – dřív zaokrouhleno 38,49)
  ok(/^\s*přední:.*38,485?/m.test(r1.log), 'Chytré kóty: volná délka 38,485 jako u plného tvaru');
  const doc1 = await p.evaluate(() => window.mncad.getDocument());
  ok(doc1.features.some((f) => f.type === 'spring' && !f.envelope && !f.drawingEnvelope), 'dokument drží skutečnou pružinu (obal je jen kopie pro výkres)');

  // ── 2. sestava se dvěma pružinami jako komponentami ──
  const r2 = await timed(['nová sestava "S pružinami"', 'vložit "Pružina T" v 0 0 0', 'vložit "Pružina T" v 60 0 0', 'výkres A3 pohledy přední,horní', 'výkres stav'].join('\n'));
  fs.writeFileSync(S + 'log2.txt', r2.log);
  ok(!/^✗/m.test(r2.log), 'sestava s pružinami + výkres bez chyb' + (first(r2.log, /^✗.*$/m) ? ' – ' + first(r2.log, /^✗.*$/m) : ''));
  ok(/Volby: .*pružiny zjednodušeně \(ISO 2162-1\)/.test(r2.log), 'sestava: Volby – pružiny zjednodušeně (komponenty)');
  ok(r2.ms < 60000, `list sestavy se 2 pružinami za ${r2.ms} ms (< 60 s)`);

  // ── 3. text: výkres pružiny plně / zjednodušeně (malá pružina – plný tvar je pomalý) ──
  const r3 = await timed(['nový díl "Pružina M"', 'pružina 10 stoupání 4 závity 1 drát 1,5', 'výkres A4 pohledy přední', 'výkres pružiny plně', 'výkres stav'].join('\n'));
  fs.writeFileSync(S + 'log3.txt', r3.log);
  ok(!/^✗/m.test(r3.log), 'výkres pružiny plně bez chyb' + (first(r3.log, /^✗.*$/m) ? ' – ' + first(r3.log, /^✗.*$/m) : ''));
  ok(/→ výkres: pružiny plně \(šroubovice\)/.test(r3.log), '„výkres pružiny plně“ potvrzeno');
  ok(/Volby: .*pružiny plně \(šroubovice\)/.test(r3.log), 'výkres stav: Volby – pružiny plně');
  const bad = await run('výkres pružiny ano');
  ok(/^✗ .*pružiny: zjednodušeně .* nebo plně/m.test(bad), '„výkres pružiny ano“ = ✗ s nápovědou');
  const r4 = await run('výkres pružiny zjednodušeně\nvýkres stav');
  ok(/Volby: .*pružiny zjednodušeně/.test(r4), 'výkres pružiny zjednodušeně → zpět');

  // ── 4. výkresové prostředí: zaškrtávátko „Pružiny plným tvarem“ ──
  await run('výkres');
  await p.waitForSelector('[data-drawing-workspace]', { timeout: 120000 });
  const box = p.locator('[data-drawing-workspace] label', { has: p.locator('[data-springs-full]') });
  ok(await box.isVisible({ timeout: 60000 }).catch(() => false), 'výkresové prostředí: zaškrtávátko „Pružiny plným tvarem“ u dílu s pružinou');
  const cb = box.locator('input[type=checkbox]');
  ok(!(await cb.isChecked()), 'výchozí: nezaškrtnuto (zjednodušeně)');
  await cb.check();
  await p.waitForFunction(() => window.mncad.getDocument().drawings?.[0]?.options?.springs === 'full', null, { timeout: 60000 }).catch(() => {});
  const opt = await p.evaluate(() => window.mncad.getDocument().drawings?.[0]?.options?.springs);
  ok(opt === 'full', `zaškrtnutí uloží volbu listu springs = full (${opt})`);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: S + 'workspace-full.png' });
  await cb.uncheck();
  await p.waitForFunction(() => window.mncad.getDocument().drawings?.[0]?.options?.springs === 'simple', null, { timeout: 60000 }).catch(() => {});
  ok((await p.evaluate(() => window.mncad.getDocument().drawings?.[0]?.options?.springs)) === 'simple', 'odškrtnutí → springs = simple');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: S + 'workspace-simple.png' });
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click().catch(() => {});

  // ── 5. díl bez pružiny: zaškrtávátko není, Volby pružiny neuvádí ──
  const r5 = await run(['nový díl "Deska"', 'kvádr 40 30 10', 'výkres A4', 'výkres stav'].join('\n'));
  ok(!/pružiny/.test(r5), 'díl bez pružiny: stav listu pružiny neuvádí');

  // ── 6. šnek z normálií (chod = prvek Pružina přidaný na jádro) není pružina: kreslí se přesně, bez volby a zaškrtávátka ──
  const r6 = await run(['normálie šnek m1 q10 l12', 'výkres A4 pohledy přední,horní', 'výkres stav'].join('\n'));
  fs.writeFileSync(S + 'log6.txt', r6);
  ok(!/^✗/m.test(r6), 'šnek + výkres bez chyb' + (first(r6, /^✗.*$/m) ? ' – ' + first(r6, /^✗.*$/m) : ''));
  ok(!/pružiny/.test(r6), 'šnek: Volby pružiny neuvádí (není to pružina)');
  await run('výkres');
  await p.waitForSelector('[data-drawing-workspace]', { timeout: 120000 });
  await p.waitForTimeout(1500);
  ok((await p.locator('[data-springs-full]').count()) === 0, 'šnek: výkresové prostředí bez zaškrtávátka „Pružiny plným tvarem“');
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click().catch(() => {});

  // ── 7. list pojmenovaný „Pružina“ bez uvozovek (dřív ✗ pružiny: zjednodušeně … nebo plně) ──
  const r7 = await run(['nový díl "Sestava pružin"', 'kvádr 40 30 10', 'výkres A4', 'výkres list nový Pružina', 'výkres list nový Pružiny', 'výkres listy'].join('\n'));
  ok(!/^✗/m.test(r7), 'výkres list nový Pružina / Pružiny bez chyby' + (first(r7, /^✗.*$/m) ? ' – ' + first(r7, /^✗.*$/m) : ''));
  const names = await p.evaluate(() => (window.mncad.getDocument().drawings ?? []).map((s) => s.name));
  ok(names.includes('Pružina') && names.includes('Pružiny'), `listy „Pružina“ a „Pružiny“ vznikly (${names.join(', ')})`);

  // ── 8. pružina v sedle desky jako nové těleso (příklad z návodu) – řez A–A bez chyby ──
  const r8 = await run(['nový díl "Deska se sedlem"', 'kvádr 100 100 60 v -50 -50 0', 'válec 25 15 v -30 -30 60 osa -Z odebrat', 'pružina 22 stoupání 4 závity 5 drát 2 v -30 -30 45 nové těleso "Pružina"', 'výkres A3 pohledy přední,horní', 'výkres řez XZ odsazení -30 celý', 'výkres stav'].join('\n'));
  fs.writeFileSync(S + 'log8.txt', r8);
  ok(!/^✗/m.test(r8), 'deska se sedlem + řez bez chyby' + (first(r8, /^✗.*$/m) ? ' – ' + first(r8, /^✗.*$/m) : ''));
  // vlna 15 (B5): Volby uvádějí odsazení a rovinu řezu („řez XZ odsazení -30 (rovina Y = 30) celý“)
  ok(/Volby: .*řez XZ .*celý.*pružiny zjednodušeně/.test(r8), 'deska se sedlem: řez a pružiny zjednodušeně ve Volbách');

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ' – ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails ? `FAIL: ${fails}` : 'ok: vše');
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
