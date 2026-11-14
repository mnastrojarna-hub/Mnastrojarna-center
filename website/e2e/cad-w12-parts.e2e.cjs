// E2E 12. vlny – přejímka po sloučení balíků extr / hole / prim: nástrojařské díly jen přes konzoli (window.mncad.run),
// tak jak je modeluje agent v terénu. Každý krok porovná odebraný objem s analytickou hodnotou (do 0,1 %).
//  1. střižnice 120 × 80 × 20: otvor střižníku = obdélník 40 × 20 se zaoblením R5 + kružnice Ø16, břit 3 mm a odlehčení 2° ven
//  2. propad pod střižnicí (podložka 120 × 80 × 30): kanál skloněný o 25° k +X (šikmý hranol, objem = plocha × výška kolmo)
//  3. 4× M8 (2× tabulkový vrták Ø6,8, 2× jádro Ø6,647 zadané průměrem) a sedlo pružiny Ø10 s plochým dnem hloubky 12;
//     měřit díry (průměry, hloubky, dno), stav
//  4. kuželová kapsa odebraná v poloze na skloněné ose (osa 0 0,5 −0,866) – objem = šikmo uříznutý kužel
//  5. výkres A3 + kótovat + výkres stav: popisy děr se skutečným vrtákem, závitem a plochým dnem; závit v odebraném válci
//     s vrtákem jádra Ø6,647 (drawing-prim po sloučení s hole)
//  6. prvek nápověda díra / vysunutí / kužel
// Spuštění: E2E_BASE=http://localhost:3374 node e2e/cad-w12-parts.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
/** relativní odchylka do 0,1 % */
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const within = (a, b) => rel(a, b) <= 1e-3;
const pct = (a, b) => (100 * rel(a, b)).toFixed(4) + ' %';
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

// ── analytické hodnoty ──
const k2 = Math.tan((2 * Math.PI) / 180);
/** obdélník W × H se zaoblením R: plocha a obvod */
const rrA = (W, H, R) => W * H - (4 - Math.PI) * R * R;
const rrP = (W, H, R) => 2 * (W + H) - 8 * R + 2 * Math.PI * R;
/** otvor s břitem `land` a odlehčením tan a ven do hloubky `t` (obrys z úseček a oblouků: plocha(o) = A + P·o + π·o² na smyčku) */
const relief = (A, P, loops, t, land, k) => { const h = t - land; return A * t + (P * k * h * h) / 2 + (loops * Math.PI * k * k * h * h * h) / 3; };
/** slepá díra Ø d, válcová hloubka h, hrot `tip` (null = ploché dno) */
const blind = (d, h, tip) => { const r = d / 2; return Math.PI * r * r * h + (tip === null ? 0 : (Math.PI * r * r * (r / Math.tan((tip * Math.PI) / 360))) / 3); };
/**
 * Kužel (vrchol, poloviční úhel α, osa svírá s normálou roviny úhel θ, θ + α < 90°) uříznutý rovinou ve vzdálenosti d od vrcholu:
 * řez je elipsa s poloosami d·cosα·sinα / k a d·sinα / √k, k = cos²α − sin²θ → V = π d³ cosα sin²α / (3 k^1,5).
 */
const obliqueCone = (d, alpha, theta) => { const k = Math.cos(alpha) ** 2 - Math.sin(theta) ** 2; return (Math.PI * d ** 3 * Math.cos(alpha) * Math.sin(alpha) ** 2) / (3 * k ** 1.5); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 920 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  for (let i = 0; i < 20; i++) { const st = p.locator('div.fixed.z-\\[65\\]'); if (await st.isVisible().catch(() => false)) { await st.getByText('Pokračovat v práci').first().click(); break; } await p.waitForTimeout(500); }
  await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }); await p.waitForTimeout(300); };
  const measure = (q) => p.evaluate((x) => window.mncad.measure(x), q);
  const vol = async () => { const r = await measure('těleso'); return r && typeof r.volume === 'number' ? r.volume : NaN; };
  const fails = (log) => log.split('\n').filter((l) => /^\s*✗/.test(l));
  const step = async (cmd) => { const log = await run(cmd); await idle(); return log; };
  const evidence = [];
  const ev = (part, cmds, data) => evidence.push({ part, cmds, ...data });

  try {
    // ── 1. střižnice: otvor (zaoblený obdélník + kružnice), břit 3 mm, odlehčení 2° ven ──
    const PLATE = 120 * 80 * 20;
    const c1 = 'nový díl Střižnice W12\nmateriál 1.2379\nkvádr 120 80 20 název Deska';
    let log = await step(c1);
    ok(!fails(log).length, '1: deska bez chyb ' + fails(log).join(' | '));
    let v0 = await vol();
    ok(Math.abs(v0 - PLATE) < 0.01, `1: deska 120 × 80 × 20 = ${f3(v0)} mm³`);
    const c1b = 'skica XY odsazení 20: obdélník 40 20 v 45 40 zaoblení-rohů 5; kružnice 16 v 90 40\nvysunout skrz odebrat obráceně úkos 2 ven břit 3 název Otvor\nstav';
    log = await step(c1b);
    ok(!fails(log).length, '1: otvor bez chyb ' + fails(log).join(' | '));
    let v1 = await vol();
    const A1 = rrA(40, 20, 5) + Math.PI * 64;
    const P1 = rrP(40, 20, 5) + 2 * Math.PI * 8;
    const want1 = relief(A1, P1, 2, 20, 3, k2);
    ok(within(v0 - v1, want1), `1: odebráno ${f3(v0 - v1)} mm³, analyticky ${f3(want1)} (odchylka ${pct(v0 - v1, want1)})`);
    const straight = A1 * 20;
    ok(v0 - v1 - straight > 0.5 * (want1 - straight), `1: odlehčení rozšiřuje otvor (navíc proti rovnému ${f3(v0 - v1 - straight)} mm³, analyticky ${f3(want1 - straight)})`);
    ok(/úkos 2° ven \(obrys se rozšiřuje\), břit 3 mm/.test(log), '1: stav „úkos 2° ven (obrys se rozšiřuje), břit 3 mm“');
    const ex = (await doc()).features.find((f) => f.type === 'extrude');
    ok(ex && ex.draftAngle === -2 && ex.draftLand === 3 && ex.mode === 'cut' && ex.extent && ex.extent.kind === 'throughAll', '1: JSON vysunutí draftAngle −2, draftLand 3, cut, skrz (' + JSON.stringify(ex && { a: ex.draftAngle, l: ex.draftLand, c: ex.draftCorners }) + ')');
    ev('1 střižnice – otvor s břitem 3 mm a odlehčením 2°', c1 + '\n' + c1b, { removed: f3(v0 - v1), analytic: f3(want1), dev: pct(v0 - v1, want1) });

    // ── 3. 4× M8 (2× Ø6,8, 2× Ø6,647) a sedlo pružiny Ø10 s plochým dnem hl. 12 ──
    const c3 = 'díra závit M8 hloubka 16 hloubka-závitu 12 v 10 10 20 v 110 10 20\ndíra 6,647 závit M8 hloubka 16 hloubka-závitu 12 v 10 70 20 v 110 70 20\ndíra 10 hloubka 12 dno ploché v 60 70';
    log = await step(c3);
    ok(!fails(log).length, '3: díry bez chyb ' + fails(log).join(' | '));
    ok(/vrták Ø6,647 zadán ručně \(tabulkový 6,8\)/.test(log), '3: protokol „vrták Ø6,647 zadán ručně (tabulkový 6,8)“');
    const v3 = await vol();
    const want3 = 2 * blind(6.8, 16, 118) + 2 * blind(6.647, 16, 118) + blind(10, 12, null);
    ok(within(v1 - v3, want3), `3: odebráno ${f3(v1 - v3)} mm³, analyticky ${f3(want3)} (odchylka ${pct(v1 - v3, want3)})`);
    const hs = (await doc()).features.filter((f) => f.type === 'hole');
    ok(hs.length === 3 && hs[0].diameter === 6.8 && !hs[0].tapDrill && hs[1].diameter === 6.647 && hs[1].tapDrill === 'custom' && hs[2].tipAngle === 180, '3: JSON díry Ø6,8 table / Ø6,647 custom / tipAngle 180 (' + hs.map((h) => `${h.diameter}/${h.tapDrill || 'table'}/${h.tipAngle || 118}`).join(', ') + ')');
    const mh = await measure('díry');
    const rep = (mh.report && mh.report.holes) || [];
    const d68 = rep.filter((h) => Math.abs(h.diameter - 6.8) < 1e-3);
    const d6647 = rep.filter((h) => Math.abs(h.diameter - 6.647) < 1e-3);
    const seat = rep.find((h) => Math.abs(h.diameter - 10) < 1e-3);
    ok(d68.length === 2 && d68.every((h) => !h.through && Math.abs(h.depth - 16) < 1e-3 && h.bottom === 'cone' && Math.abs(h.tipAngle - 118) < 0.01), '3: měřit díry – 2× Ø6,8 slepá hl. 16, hrot 118° (' + JSON.stringify(d68.map((h) => ({ d: h.diameter, h: h.depth, b: h.bottom, a: h.tipAngle }))) + ')');
    ok(d6647.length === 2 && d6647.every((h) => !h.through && Math.abs(h.depth - 16) < 1e-3 && h.bottom === 'cone'), '3: měřit díry – 2× Ø6,647 slepá hl. 16 (' + JSON.stringify(d6647.map((h) => ({ d: h.diameter, h: h.depth, b: h.bottom }))) + ')');
    ok(seat && !seat.through && Math.abs(seat.depth - 12) < 1e-3 && seat.bottom === 'flat', '3: měřit díry – sedlo Ø10 hl. 12, dno ploché (' + JSON.stringify(seat && { d: seat.diameter, h: seat.depth, b: seat.bottom }) + ')');
    const mlog = await run('měřit díry');
    ok(/dno ploché/.test(mlog) && /hrot 118°/.test(mlog), '3: protokol měřit díry: „dno ploché“ i „hrot 118°“');
    const st3 = await p.evaluate(() => window.mncad.status());
    ok(/vrták Ø6,647 zadán ručně/.test(st3) && /Ø10 hloubka 12 · dno ploché/.test(st3), '3: stav – vrták zadán ručně, Ø10 hloubka 12 · dno ploché');
    ev('3 díry M8 (Ø6,8 / Ø6,647) a sedlo pružiny', c3, { removed: f3(v1 - v3), analytic: f3(want3), dev: pct(v1 - v3, want3), holes: rep.map((h) => `Ø${h.diameter} ${h.through ? 'skrz' : 'hl. ' + h.depth} ${h.bottom || ''}${h.tipAngle ? ' ' + h.tipAngle + '°' : ''}`) });

    // ── 4. kuželová kapsa v poloze na skloněné ose ──
    const c4 = 'kužel 12 0 15 v 100 12 27 osa 0 0,5 -0,866 odebrat název Kapsa';
    log = await step(c4);
    ok(!fails(log).length, '4: kužel bez chyb ' + fails(log).join(' | '));
    const v4 = await vol();
    const u = [0, 0.5, -0.866]; const ul = Math.hypot(...u); const uz = u[2] / ul;
    const apexZ = 27 + 15 * uz; // vrchol: poloha + H · osa (D2 = 0)
    const want4 = obliqueCone(20 - apexZ, Math.atan(6 / 15), Math.acos(-uz));
    ok(apexZ > 0 && apexZ < 20 && 27 - 6 * Math.sqrt(1 - uz * uz) >= 20, `4: podstava nad deskou, vrchol v desce (z = ${f3(apexZ)})`);
    ok(within(v3 - v4, want4), `4: odebráno ${f3(v3 - v4)} mm³, analyticky ${f3(want4)} (odchylka ${pct(v3 - v4, want4)})`);
    const cone = (await doc()).features.find((f) => f.type === 'cone');
    ok(cone && cone.mode === 'cut' && cone.dirDef && cone.dirDef.kind === 'vector' && cone.position.join(';') === '100;12;27', '4: JSON kužel cut, poloha 100;12;27, dirDef vektor (' + JSON.stringify(cone && { m: cone.mode, d: cone.dirDef }) + ')');
    const st4 = await p.evaluate(() => window.mncad.status());
    ok(/Ø12→Ø0 × 15 mm, cut/.test(st4) && /osa \[0; 0,5; -0,866\]/.test(st4), '4: stav kužele s osou [0; 0,5; -0,866]');
    ev('4 kuželová kapsa na skloněné ose', c4, { removed: f3(v3 - v4), analytic: f3(want4), dev: pct(v3 - v4, want4) });
    const total = PLATE - want1 - want3 - want4;
    ok(within(v4, total), `1+3+4: objem střižnice ${f3(v4)} mm³, analyticky ${f3(total)} (odchylka ${pct(v4, total)})`);

    // ── 5. výkres: popisy děr se skutečným vrtákem, závitem a plochým dnem ──
    const c5 = 'výkres A3 na šířku pohledy horní,přední\nkótovat\nvýkres stav';
    log = await run(c5);
    await idle();
    fs.writeFileSync(S + 'w12-parts-vykres.txt', log);
    ok(!fails(log).length, '5: výkres bez chyb ' + fails(log).join(' | '));
    ok(/2× M8 ↧12 \/ Ø6,8 ↧16/.test(log), '5: popis „2× M8 ↧12 / Ø6,8 ↧16“ (tabulkový vrták)');
    ok(/2× M8 ↧12 \/ Ø6,647 ↧16/.test(log), '5: popis „2× M8 ↧12 / Ø6,647 ↧16“ (skutečný vrták 6,647)');
    ok(/Ø10 ↧12 \(ploché dno\)/.test(log), '5: popis „Ø10 ↧12 (ploché dno)“');
    const callouts = (log.match(/[^\n]*(M8 ↧|ploché dno)[^\n]*/g) || []).map((l) => l.trim());
    ev('5 výkres střižnice', c5, { callouts });

    // ── 2. propad pod střižnicí: podložka s kanálem skloněným o 25° ──
    const c2 = 'nový díl Podložka W12\nkvádr 120 80 30 v 0 0 -30\nskica XY: obdélník 44 24 v 45 40 zaoblení-rohů 6; kružnice 20 v 90 40\nvysunout skrz odebrat obráceně sklon 25 k +X název Propad\nstav';
    log = await step(c2);
    ok(!fails(log).length, '2: propad bez chyb ' + fails(log).join(' | '));
    const v2 = await vol();
    const want2 = (rrA(44, 24, 6) + Math.PI * 100) * 30;
    ok(within(120 * 80 * 30 - v2, want2), `2: odebráno ${f3(120 * 80 * 30 - v2)} mm³, analyticky plocha × výška kolmo ${f3(want2)} (odchylka ${pct(120 * 80 * 30 - v2, want2)})`);
    ok(/směr sklon 25° k \+X/.test(log), '2: stav „směr sklon 25° k +X“');
    const shift = 30 * Math.tan((25 * Math.PI) / 180);
    // přímá hrana ústí na Y = 28 (spodní strana zaobleného obdélníku 44 × 24 R6): nahoře X 29…61, dole posunutá o 30 · tan 25°
    const edgeX = (ml, z) => { const m = ml.match(new RegExp('úsečka · délka 32 mm · z \\[([\\d,]+); 28; ' + z + '\\] do \\[([\\d,]+); 28; ' + z + '\\]')); return m ? Math.min(...[m[1], m[2]].map((t) => parseFloat(t.replace(',', '.')))) : NaN; };
    const xTop = edgeX(await run('měřit hrany horní'), 0);
    const xLow = edgeX(await run('měřit hrany spodní'), -30);
    ok(Math.abs(xTop - 29) < 1e-3 && Math.abs(xLow - xTop - shift) < 0.01, `2: dolní ústí kanálu posunuté o ${f3(xLow - xTop)} mm k +X (analyticky 30 · tan 25° = ${f3(shift)}; hrana Y 28: nahoře X ${f3(xTop)}, dole X ${f3(xLow)})`);
    ev('2 propad pod 25°', c2, { removed: f3(120 * 80 * 30 - v2), analytic: f3(want2), dev: pct(120 * 80 * 30 - v2, want2), shiftX: f3(xLow - xTop), shiftAnalytic: f3(shift) });

    // ── 5b. závit v odebraném válci s vrtákem jádra Ø6,647 (drawing-prim + hole-spec po sloučení) ──
    const c5b = 'nový díl W12 závit jádro\nkvádr 60 40 20\nválec 6,647 16 v 15 20 20 osa -Z odebrat\nzávit M8 délka 12 na střed kružnice E10 osa -Z vnitřní';
    log = await step(c5b);
    ok(!fails(log).length, '5b: válec Ø6,647 + vnitřní závit bez chyb ' + fails(log).join(' | '));
    log = await run('výkres A3 na šířku pohledy horní,přední\nkótovat\nvýkres stav');
    await idle();
    ok(/M8 ↧12 \/ Ø6,647 ↧16/.test(log) && !/doplňte ručně/.test(log), '5b: výkres „M8 ↧12 / Ø6,647 ↧16“ (dřív „závit v popisu díry doplňte ručně“)');
    ev('5b závit ve válci s jádrem Ø6,647', c5b, { callouts: (log.match(/[^\n]*M8 ↧[^\n]*/g) || []).map((l) => l.trim()) });

    // ── 6. prvek nápověda díra / vysunutí / kužel ──
    const c6 = 'nový díl W12 nápověda\nprvek nápověda díra\nprvek nápověda vysunutí\nprvek nápověda kužel';
    log = await run(c6);
    fs.writeFileSync(S + 'w12-parts-napoveda.txt', log);
    ok(!fails(log).length, '6: nápověda bez chyb ' + fails(log).join(' | '));
    ok(/Díra \(hole\)/.test(log) && /• tapDrill[^\n]*table\|minor\|custom/.test(log) && /• tipAngle[^\n]*180 = ploché dno/.test(log), '6: prvek nápověda díra – tapDrill a tipAngle (180 = ploché dno)');
    ok(/\(extrude\)/.test(log) && /• draftLand[^\n]*břit N/.test(log) && /• draftCorners[^\n]*sharp\|round/.test(log) && /• normalHeight[^\n]*výška H/.test(log) && /• dir[^\n]*sklon a \[k \+X\]/.test(log) && /• draftAngle[^\n]*dovnitř\|ven/.test(log), '6: prvek nápověda vysunutí – dir, draftAngle, draftLand, draftCorners, normalHeight s textovým zápisem');
    ok(/\(cone\)/.test(log) && /• positionRef[^\n]*na V3/.test(log) && /• dirDef[^\n]*osa/.test(log) && /• mode[^\n]*odebrat/.test(log), '6: prvek nápověda kužel – positionRef, dirDef, mode');
    ev('6 nápověda polí', c6, { lines: log.split('\n').filter((l) => /• (tapDrill|tipAngle|draftLand|draftCorners|normalHeight|dir|positionRef|dirDef) /.test(l)).map((l) => l.trim().slice(0, 160)) });
  } catch (e) {
    ok(false, 'výjimka: ' + ((e && e.stack) || e));
  }
  fs.writeFileSync(S + 'w12-parts-evidence.json', JSON.stringify(evidence, null, 2));
  ok(errs.length === 0, 'žádné chyby stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})();
