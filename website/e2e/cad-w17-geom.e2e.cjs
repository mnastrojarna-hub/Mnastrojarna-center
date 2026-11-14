// E2E vlny 17 (geom): střižnice se zadním odlehčením břitu – klíny odlehčení na natočených rovinách skici, tečné ke kuželům
// v zaoblených koncích otvoru, se souřadnicemi zaokrouhlenými na 5–6 desetinných míst. SYNTETICKÝ díl (deska 60 × 40 × 12).
// Dřív (přesné jádro bez kontroly výsledku operací) podle úhlu natočení: řez se tiše neprovedl (20°), těleso bylo neplatné
// a ✓ svítilo u všech prvků (7°), nebo těleso zaniklo (88°). Teď: všechny prvky ✓, „Geometrie: platná“, objem podle výpočtu,
// export STEP se načte zpět jako jedno těleso.
// Druhá část: skoro-dotyky, které přesně vycházejí, se nemění (dvě díry s přesahem 1e-5 mm + díra dál, kanál, který prorazí
// plochu o 1e-5 mm) – stavba je hotová hned, „Geometrie: platná“, objem přesný.
// Spuštění: E2E_BASE=http://localhost:3441 node e2e/cad-w17-geom.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');

// ── syntetická střižnice (stejná jako v src/cad/shape-health.test.ts) ──
const rd = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const W = 60, D = 40, T = 12, LAND = 9, R = 3, A = 8;
const WIDEN = rd((LAND + 1) * Math.tan((2 * Math.PI) / 180), 5);
function dieDoc(angle, dec = 6, odec = 5) {
  let n = 0;
  const id = () => `d${++n}`;
  const c = Math.cos((angle * Math.PI) / 180), s = Math.sin((angle * Math.PI) / 180);
  const u = [c, s], nn = [-s, c];
  const add = (p, q, k) => [p[0] + q[0] * k, p[1] + q[1] * k];
  const q = (p) => [rd(p[0], dec), rd(p[1], dec)];
  const cA = add([W / 2, D / 2], u, -A), cB = add([W / 2, D / 2], u, A);
  const P1 = q(add(cA, nn, R)), P2 = q(add(cB, nn, R)), P3 = q(add(cB, nn, -R)), P4 = q(add(cA, nn, -R));
  const sk = (name, plane, entities) => ({ id: id(), name, type: 'sketch', plane, entities });
  const features = [{ id: id(), name: 'Deska', type: 'box', size: [W, D, T], position: [0, 0, 0], centered: false, mode: 'new' }];
  const opening = sk('Otvor', { kind: 'base', name: 'XY', offset: 0 }, [
    { id: 'e1', type: 'line', a: P1, b: P2 },
    { id: 'e2', type: 'arc', a: P2, b: q(add(cB, u, R)), c: P3 },
    { id: 'e3', type: 'line', a: P3, b: P4 },
    { id: 'e4', type: 'arc', a: P4, b: q(add(cA, u, -R)), c: P1 },
  ]);
  features.push(opening, { id: id(), name: 'Otvor skrz', type: 'extrude', sketchId: opening.id, distance: T, symmetric: false, reverse: false, mode: 'cut' });
  const cone = (name, center) => {
    const s1 = sk(`Skica ${name}`, { kind: 'custom', origin: [rd(center[0], odec), rd(center[1], odec), 0], normal: [0, -1, 0], xDir: [1, 0, 0] }, [{ id: 'e1', type: 'polyline', points: [[0, -1], [rd(R + WIDEN, 5), -1], [R, LAND], [0, LAND]], closed: true }]);
    features.push(s1, { id: id(), name, type: 'revolve', sketchId: s1.id, angle: 360, axis: 'y', mode: 'cut' });
  };
  const wedge = (name, from, to, out) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const normal = [rd((to[0] - from[0]) / len, dec), rd((to[1] - from[1]) / len, dec), 0];
    const s1 = sk(`Skica ${name}`, { kind: 'custom', origin: [rd(from[0], odec), rd(from[1], odec), 0], normal, xDir: [rd(out[0], dec), rd(out[1], dec), 0] }, [{ id: 'e1', type: 'polyline', points: [[-0.02, LAND], [0, LAND], [WIDEN, -1], [-0.02, -1]], closed: true }]);
    features.push(s1, { id: id(), name, type: 'extrude', sketchId: s1.id, distance: rd(len, odec), symmetric: false, reverse: false, mode: 'cut' });
  };
  cone('Kužel B', cB);
  wedge('Klín 1', P1, P2, nn);
  cone('Kužel A', cA);
  wedge('Klín 2', P3, P4, [-nn[0], -nn[1]]);
  return { app: 'mnastrojarna-cad', version: 2, name: `Střižnice ${angle}`, material: 'ocel', features };
}
const K = WIDEN / (LAND + 1);
const EXPECTED = W * D * T - (2 * A * 2 * R + Math.PI * R * R) * T - ((2 * (2 * A) + 2 * Math.PI * R) * K * (LAND * LAND) / 2 + Math.PI * K * K * (LAND ** 3) / 3);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 920 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  for (let i = 0; i < 20; i++) { const st = p.locator('div.fixed.z-\\[65\\]'); if (await st.isVisible().catch(() => false)) { await st.getByText('Pokračovat v práci').first().click(); break; } await p.waitForTimeout(500); }
  await p.waitForTimeout(800);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }); await p.waitForTimeout(300); };
  const fails = (log) => log.split('\n').filter((l) => /^\s*✗/.test(l));
  const bodyVol = async () => { const r = await p.evaluate(() => window.mncad.measure('těleso')); return r && typeof r.volume === 'number' ? r.volume : NaN; };

  for (const [angle, was] of [[20, 'řez se tiše neprovedl'], [7, 'neplatné těleso bez varování'], [88, 'těleso zaniklo']]) {
    const doc = dieDoc(angle);
    const log = await p.evaluate((d) => window.mncad.setDocument(d), doc);
    await idle();
    const st = await p.evaluate(() => window.mncad.status());
    const geo = (st.split('\n').find((l) => l.startsWith('Geometrie')) || '').trim();
    ok(/platná/.test(geo) && !/NEPLATN/.test(geo) && /1 těleso/.test(geo), `natočení ${angle}° (dřív: ${was}): ${geo || 'řádek Geometrie chybí'}`);
    // souhrn „prvků 11 (11 ✓, 0 ✗)“ značky obsahuje vždy – vadí ⚠ kdekoli, řádek začínající ✗ a nenulový počet ✗
    const marks = st.split('\n').filter((l) => /⚠/.test(l) || /^\s*✗/.test(l) || /[1-9]\d* ✗/.test(l));
    ok(marks.length === 0, `natočení ${angle}°: žádný prvek s ⚠ / ✗ ${marks.slice(0, 2).join(' | ')}`);
    ok(/prvků 11 \(11 ✓, 0 ✗\)/.test(st), `natočení ${angle}°: ${(st.split('\n')[0] || '').slice(0, 120)}`);
    ok(!fails(log).length, `natočení ${angle}°: otevření dokumentu bez chyby ${fails(log).join(' | ')}`);
    const v = await bodyVol();
    ok(Math.abs(v - EXPECTED) < 0.03, `natočení ${angle}°: objem ${v.toFixed(4)} mm³ = výpočet ${EXPECTED.toFixed(4)} ± 0,03`);
    const nFeat = (st.match(/✓/g) || []).length;
    ok(nFeat >= 6, `natočení ${angle}°: stav vypíše ✓ u prvků (${nFeat}×)`);
  }

  // export STEP posledního dílu: soubor vznikne a kontrola načtením zpět hlásí jedno těleso se stejným objemem
  const out = await p.evaluate(() => window.mncad.run('export step'));
  await idle();
  ok(!fails(out).length, 'export step: bez chyby ' + fails(out).join(' | '));
  ok(/step/i.test(out), 'export step: protokol uvádí soubor – ' + (out.split('\n').find((l) => /step/i.test(l)) || '').slice(0, 160));
  await p.screenshot({ path: S + 'w17-geom.png' });

  // ── skoro-dotyky, které přesně vycházejí ──
  const part = (name, features) => ({ app: 'mnastrojarna-cad', version: 2, name, material: 'ocel', features });
  const plate = (size) => ({ id: 'p1', name: 'Deska', type: 'box', size, position: [0, 0, 0], centered: false, mode: 'new' });
  const cyl = (id, name, radius, height, position, axis) => ({ id, name, type: 'cylinder', radius, height, position, axis, mode: 'cut' });
  const near = [
    ['dvě díry s přesahem 1e-5 mm a díra dál', part('Díry', [plate([60, 40, 10]), cyl('h1', 'Díra 1', 5, 12, [20, 20, -1], 'Z'), cyl('h2', 'Díra 2', 5, 12, [29.99999, 20, -1], 'Z'), cyl('h3', 'Díra 3', 3, 12, [50, 8, -1], 'Z')]), 24000 - 2 * Math.PI * 25 * 10 - Math.PI * 9 * 10, 4],
    ['kanál, který prorazí horní plochu o 1e-5 mm', part('Kanál', [plate([60, 40, 20]), cyl('k1', 'Kanál', 4, 42, [30, -1, 16.00001], 'Y')]), 48000 - Math.PI * 16 * 40, 2],
  ];
  for (const [what, doc, volume, count] of near) {
    const t0 = Date.now();
    const log = await p.evaluate((d) => window.mncad.setDocument(d), doc);
    await idle();
    const sec = (Date.now() - t0) / 1000;
    const st = await p.evaluate(() => window.mncad.status());
    const geo = (st.split('\n').find((l) => l.startsWith('Geometrie')) || '').trim();
    ok(/platná/.test(geo) && !/NEPLATN/.test(geo) && /1 těleso/.test(geo), `${what}: ${geo || 'řádek Geometrie chybí'}`);
    ok(new RegExp(`prvků ${count} \\(${count} ✓, 0 ✗\\)`).test(st) && !/⚠/.test(st), `${what}: všechny prvky ✓ – ${(st.split('\n')[0] || '').slice(0, 120)}`);
    ok(!fails(log).length, `${what}: otevření dokumentu bez chyby ${fails(log).join(' | ')}`);
    const v = await bodyVol();
    ok(Math.abs(v - volume) < 1e-3, `${what}: objem ${v.toFixed(4)} mm³ = výpočet ${volume.toFixed(4)} ± 0,001`);
    ok(sec < 30, `${what}: stavba za ${sec.toFixed(1)} s (s tolerancí u každé operace 90 s a neplatné těleso)`);
  }
  await p.screenshot({ path: S + 'w17-geom-near.png' });
  ok(errs.length === 0, 'bez chyb stránky ' + errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
