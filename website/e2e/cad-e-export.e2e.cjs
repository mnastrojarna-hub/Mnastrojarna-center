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
//  E) nálezy kontroly (skript se píše proti stavu při čtení): razítko dalšího listu, umístění na rostoucím listu s automatickým
//     formátem (umístit x y odshora), zastaralé úpravy vygenerovaných kót a pozic (i skryté myší), pořadí pohledů (řez před
//     pohledem z něj), pohledy na vypnutém pohledu, přezdívky D / H / R, obnovit s neznámým klíčem, revize dokumentu
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
  // klíče vygenerovaných pozic ověřilo jádro podle kusovníku a pozic otevřené sestavy (ne jen podle voleb listu)
  ok(!/nejsou ověřené jádrem|už na listu nejsou/.test(sB), 'B: window.mncad.script() ověřil klíče vygenerovaných kót a pozic jádrem (bez poznámky)');
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

  // ════════════ E) nálezy kontroly: skript se píše proti stavu při čtení ════════════
  /** postaví dokument v p, převede window.mncad.script() a skript přečte v novém sezení q */
  const trip = async (lines, name) => {
    const l1 = await runIn(p, lines.join('\n'));
    await settle(p, name);
    const d1 = await docIn(p);
    const sc = await p.evaluate(() => window.mncad.script());
    const l2 = await runIn(q, sc);
    await settle(q, name);
    return { d1, sc, d2: await docIn(q), e1: errLines(l1), e2: errLines(l2) };
  };
  const filled = (m) => Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== '' && v !== undefined && k !== 'date'));
  // E1: razítko dalšího listu – list 2 (založený před vyplněním listu 1) nepřevezme šablonu, číslo, revizi, zákazníka, tolerance
  const e1 = await trip(['nový díl "E1 dva listy"', 'kvádr 80 60 10', 'výkres A3 pohledy přední,horní', 'výkres list nový "Detaily"', 'výkres A4 pohledy iso', 'výkres list 1', 'výkres razítko šablona=nástrojářská číslo="D-7" zákazník="Zákazník G" polotovar="P 10×80×60"', 'výkres nepředepsané desetinná ±0,2 ±0,1 ±0,02 ±0,01', 'výkres revize A "první vydání" datum 3.3.2026'], 'E1 dva listy');
  ok(!e1.e2.length, `E1: skript v novém sezení bez ✗ ${J(e1.e2)}`);
  const m2 = e1.d2.drawings[1].meta;
  ok(stable(filled(m2)) === stable(filled(e1.d1.drawings[1].meta)) && !m2.template && !m2.number && !m2.revision && !m2.customer && !m2.tolerance && !m2.tolTable, `E1: list 2 má po přečtení vlastní razítko ${J(filled(m2))} (původní ${J(filled(e1.d1.drawings[1].meta))})`);
  ok(stable(filled(e1.d2.drawings[0].meta)) === stable(filled(e1.d1.drawings[0].meta)) && (e1.d2.props || {}).number === 'D-7', `E1: list 1 a číslo dokumentu beze změny (${J(e1.d2.props)})`);
  ok(/^výkres razítko šablona=iso7200 číslo="" revize="" zákazník="" polotovar="" nepředepsané=""$/m.test(e1.sc), 'E1: skript na listu 2 vyprázdní zděděná pole');
  // E2: automatický formát, který při čtení roste (A4 → A3) – umístěný řez zůstane na místě
  const e2 = await trip(['nový díl "E2 auto"', 'kvádr 300 40 30', 'válec 60 80 v 150 20 0', 'výkres pohledy přední,horní', 'výkres řez zalomený horní body -10 20 150 20 150 60 310 60 umístit 150 30', 'výkres pohled pomocný přední směr 0,5 0 0,87'], 'E2 auto');
  ok(!e2.e2.length && /umístit 150 180 odshora$/m.test(e2.sc), `E2: skript píše umístění od levého horního rohu (${(e2.sc.match(/^výkres řez zalomený.*$/m) || [''])[0]})`);
  ok(J(e2.d2.drawings[0].options.cuts[0].at) === J(e2.d1.drawings[0].options.cuts[0].at), `E2: řez je po přečtení na stejném místě ${J(e2.d1.drawings[0].options.cuts[0].at)} → ${J(e2.d2.drawings[0].options.cuts[0].at)}`);
  // E3: kóty skryté MYŠÍ, pak pohled vypnut – skript zapíše jen kótu, která na listu je (žádné ✗)
  log = await runIn(p, ['nový díl "E3 stale"', 'kvádr 100 60 40', 'výkres A3 pohledy přední,horní,levý', 'kótovat celkově'].join('\n'));
  await settle(p, 'E3 stale');
  await runIn(p, 'výkres');
  await p.waitForFunction(() => ['60', '100'].every((t) => [...document.querySelectorAll('[data-sheet] > div svg text')].some((x) => x.textContent === t)), null, { timeout: 120000 }).catch(() => {});
  for (const t of ['60', '100']) {
    const at = await tpos(t);
    ok(!!at, `E3: kóta celkového rozměru „${t}“ je na listu`);
    if (!at) continue;
    await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(500);
    await p.keyboard.press('Delete');
    await p.waitForTimeout(2000);
  }
  const g3 = ((await docIn(p)).drawings[0].options.genEdit || {}).off || [];
  ok(J([...g3].sort()) === J(['dim:front:t', 'dim:left:t']), `E3: Delete skryl kóty levého a předního pohledu (${J(g3)})`);
  await runIn(p, 'výkres A3 pohledy přední,horní');
  await p.waitForTimeout(1500);
  const s3 = await p.evaluate(() => window.mncad.script());
  ok(/^výkres vygenerované skrýt dim:front:t$/m.test(s3) && !/dim:left:t/.test(s3.replace(/^#.*$/gm, '')) && /^# ℹ úpravy vygenerovaných kót a pozic listu „List 1“, které už na listu nejsou \(dim:left:t\), skript vynechá$/m.test(s3), `E3: skript zapíše jen kótu, která na listu je, zastaralou ohlásí ℹ (${(s3.match(/^výkres vygenerované.*$/gm) || []).join(' | ')})`);
  log = await runIn(q, s3);
  await settle(q, 'E3 stale');
  ok(!errLines(log).length && J(((await docIn(q)).drawings[0].options.genEdit || {}).off) === J(['dim:front:t']), `E3: skript v novém sezení bez ✗ a přední kóta zůstala skrytá ${J(errLines(log))}`);
  // E3b: pozice sestavy – skryté 3 a 1, komponenta 3 odebrána: skript skryje jen pozici 1 (pozice podle kusovníku otevřené sestavy)
  const e3b = await trip(['nový díl "E3 A1"', 'kvádr 40 40 10', 'nový díl "E3 A2"', 'válec 10 30', 'nový díl "E3 A3"', 'koule 20', 'nová sestava "E3 sestava"', 'vložit "E3 A1" ukotvit', 'vložit "E3 A2" v 20 20 10', 'vložit "E3 A3" v 80 20 10', 'výkres A3 pohledy přední,horní kusovník ano', 'kótovat celkově', 'výkres vygenerované skrýt pos:3 pos:1', 'výkres vygenerované posun pos:2 4 4', 'sestava odebrat "E3 A3"'], 'E3 sestava');
  ok(!e3b.e2.length && J((e3b.sc.match(/^výkres vygenerované.*$/gm) || [])) === J(['výkres vygenerované skrýt pos:1', 'výkres vygenerované posun pos:2 4 4']), `E3b: skript sestavy bez zastaralé pozice 3, bez ✗ (${J(e3b.sc.match(/^výkres vygenerované.*$/gm))} ${J(e3b.e2)})`);
  ok(J(e3b.d2.drawings[0].options.genEdit) === J({ off: ['pos:1'], move: { 'pos:2': [4, -4] } }), `E3b: po přečtení skrytá pozice 1 a posunutá 2 (${J(e3b.d2.drawings[0].options.genEdit)})`);
  // E4: pomocný pohled z řezu vytvořený po smazání pohledu B – řez první, pohled z něj s jeho novým písmenem
  const e4 = await trip(['nový díl "E4 pořadí"', 'kvádr 120 80 40', 'válec 30 60 v 60 40 0 odebrat', 'výkres A1 měřítko 1:1 pohledy přední,horní', 'výkres pohled pomocný přední hrana 0 0 120 40', 'výkres řez zalomený horní body -10 20 60 20 60 60 130 60', 'výkres pohled pomocný smazat B', 'výkres pohled pomocný řez C směr 0,5 0 0,87'], 'E4 pořadí');
  const o4 = e4.d2.drawings[0].options;
  ok(!e4.e2.length && J((o4.cuts || []).map((c) => c.label)) === J(['B']) && J((o4.aux || []).map((a) => [a.label, a.parent])) === J([['C', 'cut:B']]), `E4: řez B a pomocný pohled C z řezu B, bez ✗ (${J(e4.e2)} ${J((o4.aux || []).map((a) => [a.label, a.parent]))})`);
  // E5: pohledy na vypnutém základním pohledu se vynechají s ℹ
  const e5 = await trip(['nový díl "E5 vypnuté"', 'kvádr 200 60 40', 'výkres A2 měřítko 1:1 pohledy přední,horní,levý', 'výkres přerušení levý y od 10 do 30 mezera 4', 'výkres detail levý v 30 20 poloměr 8 měřítko 2:1', 'výkres pohled pomocný levý směr 0,5 0 0,87', 'výkres A2 měřítko 1:1 pohledy přední'], 'E5 vypnuté');
  ok(!e5.e2.length && (e5.sc.match(/^# ℹ .*visí na pohledu, který na listu není \(levý\)/gm) || []).length === 3, `E5: tři položky na vypnutém levém pohledu vynechány s ℹ, bez ✗ ${J(e5.e2)}`);
  // E6 + E7: přezdívky D / H / R (dřív „chybí přezdívka“) a umístění detailu na listu sestavy s automatickým formátem
  const e6 = await trip(['nový díl "E6 Q"', 'kvádr 100 40 30', 'nová sestava "E6 sestava"', 'vložit "E6 Q" ukotvit', 'sestava komponenta #1 přezdívka "D"', 'vložit "E6 Q" v 0 60 0 jako "H"', 'vložit "E6 Q" v 0 120 0', 'sestava komponenta #3 přezdívka "R"', 'výkres pohledy přední,horní', 'výkres detail přední v 50 15 poloměr 10 měřítko 2:1 umístit 230 60'], 'E6 sestava');
  ok(!e6.e1.length && !e6.e2.length && J(e6.d2.components.map((c) => c.alias)) === J(['D', 'H', 'R']) && !/přezdívku/.test(e6.sc), `E6: přezdívky D, H, R tam a zpět (${J(e6.d2.components.map((c) => c.alias))} ${J(e6.e1)} ${J(e6.e2)})`);
  ok(/umístit 230 150 odshora$/m.test(e6.sc) && J(e6.d2.drawings[0].options.details[0].at) === J(e6.d1.drawings[0].options.details[0].at) && !/bez jádra/.test(e6.sc), `E7: detail na listu sestavy s automatickým formátem na stejném místě ${J(e6.d2.drawings[0].options.details[0].at)}`);
  // E8 + E9: obnovit ověří klíč; stav pružiny píše vedení
  const l8 = String(await runIn(p, 'výkres vygenerované obnovit pos:99'));
  ok(errLines(l8).length === 1 && /„pos:99“ na listu není/.test(l8), `E8: výkres vygenerované obnovit pos:99 = ✗ (${l8.split('\n').filter((l) => /pos:99/.test(l)).join(' | ').slice(0, 160)})`);
  // E10: revize v popisových údajích dokumentu i s tabulkou revizí
  const e10 = await trip(['nový díl "E10 revize"', 'kvádr 50 40 30', 'výkres A3 pohledy přední', 'výkres razítko číslo="MN-1" revize="C"', 'výkres revize A "první" datum 1.10.2026', 'výkres revize C "třetí" datum 19.11.2026'], 'E10 revize');
  ok(!e10.e2.length && stable(e10.d2.props) === stable(e10.d1.props) && (e10.d2.props || {}).revision === 'C', `E10: popisové údaje dokumentu po přečtení ${J(e10.d2.props)} (původní ${J(e10.d1.props)})`);

  ok(!errs.length, `bez chyb stránky ${J(errs.slice(0, 3))}`);
  await b.close();
})().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exitCode = 1; });
