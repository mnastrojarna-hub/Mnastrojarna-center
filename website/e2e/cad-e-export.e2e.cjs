// E2E vlna E, balík export (převodník dokument → textový skript, src/cad/doc-script*.ts) na produkčním sestavení:
//  A) díl s výkresem: celé razítko (šablona, firma, zákazník, projekt, polotovar, počet, tepelné, povrch, úhly, sražení, logo
//     data URL), nepředepsané tolerance podle desetinných míst, tabulka revizí se skrytými trojúhelníky, funkční kóty a polohy
//     děr, pružiny plně, detail, pomocný pohled, řez lomenou čarou, částečný řez, přerušení, uložení → window.mncad.script()
//     → skript v NOVÉM sezení → list výkresu má stejné volby i údaje razítka
//  B) sestava: přezdívky, pružiny „Pružina mezi díly“ do děr vzoru (vedené) a jedna změněná textem (vedená ne), dynamika,
//     výkres sestavy s modelem a upravenými vygenerovanými kótami (`výkres vygenerované skrýt|posun`) → skript → nové
//     sezení → stejné přezdívky, pružiny, pohyb a list; tlačítko „Obnovit vygenerované kóty a pozice (2)“ ve výkresu
//  C) vygenerovaná kóta skrytá MYŠÍ (klik + Delete ve výkresu) → skript ji zapíše `výkres vygenerované skrýt dim:…`
//  D) konzole `export skript` u dokumentu s volbou jen z JSON (dimRoom): řádek ℹ v protokolu a komentář `# ℹ` ve staženém souboru
// Spuštění: E2E_BASE=http://localhost:3523 node e2e/cad-e-export.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-e-export').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const J = (v) => JSON.stringify(v);
/** JSON se seřazenými klíči (pořadí klíčů objektu se po přečtení skriptu může lišit – obsah ne) */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
const ready = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro') && !document.body.innerText.includes('Loading'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};
/** list v porovnatelném tvaru (stejně jako doc-script-export.roundtrip.test.ts) */
const round = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 + 0 : x))));
const sheetCanon = (d) => {
  const s = d.drawings[0];
  const o = { ...s.options };
  for (const k of ['smartGen', 'dimPads', 'breakScale']) delete o[k];
  if (Array.isArray(o.smartOff) && !o.smartOff.length) delete o.smartOff;
  for (const k of ['aux', 'cuts', 'details', 'brokenOut', 'breaks', 'models'])
    if (Array.isArray(o[k])) o[k] = o[k].map(({ id, ...x }) => (x.source && x.source.kind === 'component' ? { ...x, source: { kind: 'component', comp: d.components.findIndex((c) => c.id === x.source.compId) } } : x));
  const m = { ...s.meta };
  if (m.logo) m.logo = { w: m.logo.w, h: m.logo.h, trace: m.logo.trace };
  return stable(round({ options: o, meta: m }));
};
const springs = (d) => (d.components || []).flatMap((c, i) => (c.spring ? [stable(round({ i, a: [d.components.findIndex((x) => x.id === c.spring.a.compId), c.spring.a.face], b: [d.components.findIndex((x) => x.id === c.spring.b.compId), c.spring.b.face], free: c.spring.free, solid: c.spring.solid, rate: c.spring.rate, guided: c.spring.guided, length: c.spring.length }))] : []));
const motion = (d) => {
  const mo = d.motion;
  const mate = (id) => d.mates.findIndex((m) => m.id === id);
  const comp = (id) => d.components.findIndex((c) => c.id === id);
  return stable(round({ motors: mo.motors.map((m) => ({ ...m, id: undefined, mate: mate(m.mate) })), duration: mo.duration, steps: mo.steps, mode: mo.mode || 'kinematic', dyn: mo.dyn && { ...mo.dyn, masses: Object.fromEntries(Object.entries(mo.dyn.masses || {}).map(([k, v]) => [comp(k), v])), loads: (mo.dyn.loads || []).map((l) => ({ ...l, mate: mate(l.mate) })) } }));
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  const dl = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('download', (d) => dl.push(d));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await ready(p, BASE + '/cad');
  // druhé sezení (čisté úložiště) – skript se čte tam, kde dokumenty ještě nejsou
  const ctx2 = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const q = await ctx2.newPage();
  q.on('pageerror', (e) => errs.push('q: ' + e.message));
  await ready(q, BASE + '/cad');
  const runIn = (pg, t) => pg.evaluate((x) => window.mncad.run(x), t);
  const docIn = (pg) => pg.evaluate(() => window.mncad.getDocument());
  const settle = async (pg, name) => { await pg.waitForFunction((n) => window.mncad.getDocument().name === n, name, { timeout: 240000 }); await pg.waitForTimeout(600); };
  const errLines = (log) => String(log).split('\n').filter((l) => /^\s*✗/.test(l));

  // ════════════ A) díl s výkresem ════════════
  // logo: 48 × 16 px PNG z canvasu prohlížeče (data URL)
  const logo = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 48; c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 48, 16); g.fillStyle = '#e03930'; g.fillRect(6, 4, 36, 8); return c.toDataURL('image/png'); });
  let log = await runIn(p, [
    'nový díl "Deska E"', 'kvádr 120 80 20', 'díra 8 skrz v 20 20 20', 'díra 8 skrz v 100 60 20',
    'výkres A2 pohledy přední,horní,levý řez XZ odsazení 40 pružiny plně',
    'výkres razítko šablona=nástrojářská číslo="E-100" kreslil="JN" kontroloval="KP" schválil="MV" zákazník="Zákazník A" projekt="P-1" firma="Firma s.r.o." polotovar="Plech 20" počet="4 ks" tepelné="kalit 58 HRC" povrch="černit" úhly="±0,5°" sražení="±0,2"',
    `výkres razítko logo="${logo}"`,
    'výkres nepředepsané desetinná ±0,2 ±0,1 ±0,02 ±0,01',
    'výkres revize A "první vydání" datum 1.11.2026 kreslil "JN"', 'výkres revize B "díra 8" datum 5.11.2026', 'výkres revize A značky ne',
    'výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 60 60',
    'výkres pohled pomocný přední hrana 0 0 120 20 podél umístit 400 120',
    'výkres řez zalomený horní body 0 -20 60 -20 60 -60 120 -60 umístit 400 300',
    'výkres řez částečný přední body 10 2 40 2 40 18 10 18 hloubka 10 křivka',
    'výkres přerušení přední x od 30 do 90 vlnovka',
    'výkres uložení zobrazení mezní', 'výkres uložení tabulka ano',
    'kótovat chytře funkční 80 120 díry souřadnicově',
  ].join('\n'));
  await settle(p, 'Deska E');
  ok(!errLines(log).length, `A: díl s výkresem a všemi volbami vznikl bez ✗ ${J(errLines(log))}`);
  const dA = await docIn(p);
  const sA = await p.evaluate(() => window.mncad.script());
  fs.writeFileSync(S + 'deska-e.mncad.txt', sA);
  const want = [
    /^výkres A2 pohledy přední,horní,levý řez XZ odsazení -?40 pružiny plně$/m,
    /^výkres revize A "první vydání" datum="1.11.2026" kreslil="JN"$/m,
    /^výkres revize A značky ne$/m,
    /^výkres razítko šablona=nástrojářská .*zákazník="Zákazník A" .*nepředepsané="X\. ±0,2 \/ X\.X ±0,1 \/ X\.XX ±0,02 \/ X\.XXX ±0,01"/m,
    /^výkres razítko logo="data:image\/png;base64,/m,
    /^výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 60 60$/m,
    /^výkres pohled pomocný přední hrana 0 0 120 20 podél umístit 400 120$/m,
    /^výkres řez zalomený horní body 0 -20 60 -20 60 -60 120 -60 umístit 400 300$/m,
    /^výkres řez částečný přední body 10 2 40 2 40 18 10 18 hloubka 10 křivka$/m,
    /^výkres přerušení přední x od 30 do 90 vlnovka$/m,
    /^výkres uložení zobrazení mezní$/m, /^výkres uložení tabulka ano$/m,
    /^kótovat chytře funkční 80 120 díry souřadnicově$/m,
  ];
  const miss = want.filter((r) => !r.test(sA)).map(String);
  ok(!miss.length, `A: skript zapsal razítko, revize, tolerance, funkční kóty, díry, pružiny, detail, pomocný pohled, řezy, přerušení, uložení ${J(miss)}`);
  log = await runIn(q, sA);
  await settle(q, 'Deska E');
  ok(!errLines(log).length, `A: skript v novém sezení bez ✗ ${J(errLines(log))}`);
  const dA2 = await docIn(q);
  const cA = sheetCanon(dA);
  const cA2 = sheetCanon(dA2);
  const diffKeys = (x, y) => { const a = JSON.parse(x); const b2 = JSON.parse(y); const out = []; for (const g of ['options', 'meta']) for (const k of new Set([...Object.keys(a[g]), ...Object.keys(b2[g])])) if (stable(a[g][k]) !== stable(b2[g][k])) out.push(`${g}.${k}: ${J(a[g][k])} → ${J(b2[g][k])}`.slice(0, 600)); return out; };
  ok(cA === cA2, 'A: list výkresu po přečtení skriptu má stejné volby i údaje razítka' + (cA === cA2 ? '' : `\n   ${diffKeys(cA, cA2).join('\n   ')}`));
  ok(dA2.drawings[0].meta.template === 'toolmaker' && J(dA2.drawings[0].meta.tolTable) === J(['±0,2', '±0,1', '±0,02', '±0,01']) && dA2.drawings[0].meta.logo && dA2.drawings[0].meta.logo.w === 48, 'A: šablona nástrojářská, tabulka nepředepsaných tolerancí a logo 48 px');

  // ════════════ B) sestava: přezdívky, pružiny, dynamika, výkres s vygenerovanými kótami ════════════
  log = await runIn(p, [
    'nový díl Spodní deska', 'kvádr 200 120 30',
    'nový díl Horní deska', 'kvádr 200 120 30', 'válec 21 10 v 40 30 0 odebrat', 'válec 21 10 v 160 30 0 odebrat',
    'nový díl Stírací deska', 'kvádr 200 120 15',
    'nová sestava Střižník E',
    'vložit "Spodní deska" ukotvit jako "SD"', 'vložit "Stírací deska" v 0 0 45 jako "K48"', 'vložit "Horní deska" v 0 0 85',
    'sestava komponenta #3 přezdívka "HD"',
    'sestava vazba vzdálenost "HD" spodní "SD" horní hodnota 55 název "LIS"',
    'sestava vazba mez-vzdálenosti "K48" horní "HD" spodní min 5 max 25 název "Doraz stírače"',
    'sestava vazba mez-vzdálenosti "K48" spodní "SD" horní min 0 max 500 název "Matrice"',
    'sestava pružina nová n 6 mezi "HD" Ø21 "K48" horní do děr vzoru',
    'sestava pružina #5 volná 42 blok 15 tuhost 4,5 vedená ne',
    'pohyb hmotnost "K48" 2,4', 'pohyb síla vazba 2 120',
    'pohyb motor lineární vazba "LIS" 55..50 tam a zpět',
    'pohyb dynamika čas 0,02 krok 0,0004 gravitace 0 -0,6 -0,8 tlumení 0,05 odraz 0,2 snímky 40',
    'výkres A2 pohledy přední,horní', 'výkres model "Stírací deska" pohled horní měřítko 1:4', 'kótovat celkově',
    'výkres vygenerované skrýt dim:front:t', 'výkres vygenerované posun pos:1 5 -3',
  ].join('\n'));
  await settle(p, 'Střižník E');
  ok(!errLines(log).length, `B: sestava s přezdívkami, pružinami, dynamikou a výkresem vznikla bez ✗ ${J(errLines(log))}`);
  const dB = await docIn(p);
  ok(J(dB.components.map((c) => c.alias || '')) === J(['SD', 'K48', 'HD', '', '']) && springs(dB).length === 2 && J(dB.drawings[0].options.genEdit) === J({ off: ['dim:front:t'], move: { 'pos:1': [5, 3] } }), `B: přezdívky, 2 pružiny a úpravy vygenerovaných kót (${J(dB.drawings[0].options.genEdit)})`);
  const sB = await p.evaluate(() => window.mncad.script());
  fs.writeFileSync(S + 'strizik-e.mncad.txt', sB);
  const wantB = [/^vložit "Spodní deska" ukotvit jako "SD"$/m, /^vložit "Horní deska" v 0 0 85 jako "HD"$/m, /^sestava pružina #4 mezi #3 F\d+ #2 F\d+ volná 41 blok 16 tuhost [\d.]+ vedená ano$/m, /^sestava pružina #5 mezi #3 F\d+ #2 F\d+ volná 42 blok 15 tuhost 4.5 vedená ne$/m, /^pohyb dynamika čas 0.02 krok 0.0004 gravitace 0 -0.6 -0.8 tlumení 0.05 odraz 0.2 snímky 40$/m, /^výkres model "Stírací deska" pohled horní měřítko 1:4$/m, /^výkres vygenerované skrýt dim:front:t$/m, /^výkres vygenerované posun pos:1 5 -3$/m];
  const missB = wantB.filter((r) => !r.test(sB)).map(String);
  ok(!missB.length, `B: skript zapsal přezdívky, pružiny (vedení), dynamiku, model a vygenerované kóty ${J(missB)}`);
  log = await runIn(q, sB);
  await settle(q, 'Střižník E');
  ok(!errLines(log).length, `B: skript sestavy v novém sezení bez ✗ ${J(errLines(log))}`);
  const dB2 = await docIn(q);
  ok(J(dB2.components.map((c) => c.alias || '')) === J(dB.components.map((c) => c.alias || '')), 'B: stejné přezdívky komponent');
  ok(J(springs(dB2)) === J(springs(dB)), `B: stejné pružiny (dosedací plochy, L0, Ln, tuhost, vedení, délka) ${J(springs(dB2))}`);
  ok(motion(dB2) === motion(dB), 'B: stejná pohybová studie (motor, dynamika, hmotnost, síla)');
  ok(sheetCanon(dB2) === sheetCanon(dB), 'B: stejný list výkresu sestavy (model, celkové kóty, skrytá kóta, posunutý balónek)');
  // výkres sestavy v GUI: úpravy textem = tlačítko Obnovit (2); klik ho vrátí
  await runIn(p, 'výkres');
  await p.waitForFunction(() => !!document.querySelector('[data-gen-restore]'), null, { timeout: 240000 }).catch(() => {});
  const rb = p.locator('[data-gen-restore]');
  ok((await rb.count()) === 1 && /\(2\)/.test((await rb.textContent().catch(() => '')) || ''), `B: ve výkresu je „Obnovit vygenerované kóty a pozice (2)“ (${await rb.textContent().catch(() => '—')})`);
  await p.screenshot({ path: S + 'e-export-asm-drawing.png' });
  if (await rb.count()) {
    await rb.click();
    await p.waitForTimeout(2000);
    ok(!(await docIn(p)).drawings[0].options.genEdit, 'B: Obnovit vrátí vygenerované kóty a pozice (genEdit zrušen)');
    const st = await runIn(p, 'výkres vygenerované');
    ok(/Upravené: —/.test(String(st)) && /dim:front:t/.test(String(st)), `B: výkres vygenerované vypíše klíče listu a žádné úpravy (${String(st).split('\n').filter((l) => /Vygenerované|Upravené/.test(l)).join(' | ')})`);
  }

  // ════════════ C) kóta skrytá myší → skript ════════════
  const tpos = (txt) => p.evaluate((t) => { const el = [...document.querySelectorAll('[data-sheet] > div svg text')].find((x) => x.textContent === t); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, txt);
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sheet] > div svg text')].some((x) => x.textContent === '200'), null, { timeout: 120000 }).catch(() => {});
  const T = await tpos('200');
  ok(!!T, 'C: kóta celkového rozměru „200“ je na listu');
  if (T) {
    await p.mouse.click(T.x, T.y);
    await p.waitForTimeout(500);
    await p.keyboard.press('Delete');
    await p.waitForTimeout(2500);
    const g = (await docIn(p)).drawings[0].options.genEdit;
    ok(!!g && (g.off || []).length === 1, `C: Delete skryl vybranou kótu (${J(g)})`);
    const sC = await p.evaluate(() => window.mncad.script());
    ok(!!g && new RegExp(`^výkres vygenerované skrýt ${(g.off || [''])[0]}$`, 'm').test(sC), `C: skript zapíše kótu skrytou myší: ${(sC.match(/^výkres vygenerované.*$/m) || [''])[0]}`);
  }

  // ════════════ D) export skript: co skript nepřenese ════════════
  const dD = JSON.parse(JSON.stringify(dA));
  dD.name = 'Deska JSON';
  dD.drawings[0].options.dimRoom = 12;
  await runIn(p, JSON.stringify(dD));
  await settle(p, 'Deska JSON');
  await p.evaluate(() => window.mncad.openConsole());
  const input = p.getByLabel('Textové příkazy nebo JSON');
  await input.waitFor({ timeout: 20000 });
  const out = p.locator('[data-agent-output]');
  const before = await out.innerText().catch(() => '');
  const n0 = dl.length;
  await input.fill('export skript');
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev && o.textContent.length > 0; }, before, { timeout: 240000 });
  const logD = await out.innerText();
  ok(/ℹ volby listu bez textového příkazu \(dimRoom\)/.test(logD), 'D: protokol konzole: ℹ volby listu bez textového příkazu (dimRoom)');
  const t0 = Date.now();
  while (dl.length <= n0 && Date.now() - t0 < 60000) await p.waitForTimeout(200);
  const d = dl[n0];
  const text = d ? fs.readFileSync(await d.path(), 'utf8') : '';
  ok(/^# ℹ co skript nepřenese \(\d+\):$/m.test(text) && /^# ℹ volby listu bez textového příkazu \(dimRoom\)/m.test(text), `D: stažený skript ${d ? d.suggestedFilename() : '—'} nese komentář # ℹ`);

  ok(!errs.length, `bez chyb stránky ${J(errs.slice(0, 3))}`);
  await b.close();
})().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exitCode = 1; });
