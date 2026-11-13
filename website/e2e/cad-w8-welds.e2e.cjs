// E2E 8. vlna – svary: tupý svar s úpravou ISO 9692-1 (text i formulář), koutový oboustranný, děrový / bodový, tabulka svarů
// se součty (hmotnost svarového kovu, přídavný materiál), těleso „Svar k“, značky ISO 2553 na výkrese (SVG / DXF / PDF).
// Spuštění: E2E_BASE=http://localhost:3342 node e2e/cad-w8-welds.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-welds').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3342').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });
const first = (s, re) => (re.exec(s) || [])[0];
// plocha kruhové úseče (převýšení) – stejný vzorec jako weld-calc.ts
const segment = (w, h) => { const R = (w * w) / 4 / (2 * h) + h / 2; const phi = Math.atan2(w / 2, R - h); return R * R * (phi - Math.sin(phi) * Math.cos(phi)); };
const tan = (d) => Math.tan((d * Math.PI) / 180);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 8000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const status = () => p.evaluate(() => window.mncad.status());
  const num = (s) => parseFloat(String(s).replace(/\s| /g, '').replace(',', '.'));
  const ex = (f, o) => p.evaluate(([f, o]) => window.mncad.exportDrawing(f, o).then((r) => ({ ...r, head: atob(r.base64.slice(0, 64)), text: f === 'svg' || f === 'dxf' ? new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))) : '' })), [f, o]);
  /** index hrany podle koncových bodů (window.mncad.measure) */
  const edgeIdx = async (a, bb) => {
    const hints = await p.evaluate(() => window.mncad.hints());
    const n = Math.max(0, ...hints.filter((h) => h.kind === 'edge').map((h) => h.index)) + 40;
    for (let i = 0; i < n; i++) {
      const m = await p.evaluate((id) => window.mncad.measure(id).catch(() => null), `E${i + 1}`);
      const pts = m && m.points ? m.points : [];
      const near = (q, r) => q && Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) < 1e-3;
      if (pts.length >= 2 && ((near(pts.find((q) => near(q, a)), a) && pts.some((q) => near(q, bb))))) return i;
    }
    return -1;
  };

  // ── 1. text: tupý spoj dvou desek (dvě tělesa), V 60° s otupením a mezerou ──
  const log1 = await run(['nový díl Tupý spoj', 'kvádr 100 200 10 v -100 0 0', 'kvádr 100 200 10 v 2 0 0 nové', 'těleso 1', 'svar tupý V 60 otupení 1 mezera 2 plocha +X'].join('\n'));
  await idle();
  fs.writeFileSync(S + 'log1.txt', log1);
  ok(!/^✗/m.test(log1), 'tupý svar V textem bez chyb' + (first(log1, /^✗.*$/m) ? ' – ' + first(log1, /^✗.*$/m) : ''));
  let st = await status();
  fs.writeFileSync(S + 'status1.txt', st);
  ok(/Tělesa: .*Svar 1/.test(st), 'svarový kov = těleso „Svar 1“');
  const areaV = 2 * 10 + 81 * tan(30) + segment(2 + 2 * 9 * tan(30) + 2, 1.5);
  const mArea = /→ tupý V s10.*průřez ([\d\s ,]+) mm²/.exec(st);
  ok(mArea && Math.abs(num(mArea[1]) - areaV) / areaV < 0.005, `průřez svarového kovu V = b·t + (t−c)²·tg30° + převýšení = ${areaV.toFixed(2)} mm² (stav: ${mArea && mArea[1]})`);
  const mMass = /svarový kov ([\d\s ,]+) kg · přídavný materiál ≈ ([\d\s ,]+) kg \(135, η 0,9\)/.exec(st);
  ok(mMass && Math.abs(num(mMass[1]) - areaV * 200 * 7.85e-6) < 2e-4 && Math.abs(num(mMass[2]) - num(mMass[1]) / 0.9) < 2e-4, `hmotnost svarového kovu ≈ ${(areaV * 200 * 7.85e-6).toFixed(4)} kg a přídavný materiál = hmotnost / 0,9: ${mMass && mMass[0]}`);
  const log1t = await run('svar tabulka');
  fs.writeFileSync(S + 'table1.txt', log1t);
  ok(/Celkem: 1 svarů · délka 200 mm/.test(log1t) && /tupý V/.test(log1t), 'svar tabulka → řádek tupý V a součet „Celkem: 1 svarů · délka 200 mm“');
  // výkres se značkou ISO 2553
  const logD = await run('výkres A3 na šířku pohledy přední,horní,levý');
  ok(!/^✗/m.test(logD), 'výkres textem');
  const svg1 = await ex('svg', { sheet: 1 });
  fs.writeFileSync(S + 'tupy.svg', svg1.text);
  ok(svg1.text.includes('>s10<') && svg1.text.includes('60° b2 c1') && svg1.text.includes('>135<'), 'výkres SVG: značka V svaru s10, 60° b2 c1, metoda 135');
  const dxf1 = await ex('dxf', { sheet: 1 });
  ok(dxf1.text.includes('s10') && dxf1.text.includes('b2 c1') && dxf1.text.includes('135'), 'výkres DXF: texty značky svaru (s10, b2 c1, 135)');
  const pdf1 = await ex('pdf', { sheet: 1 });
  ok(pdf1.head.startsWith('%PDF') && pdf1.bytes > 3000, `výkres PDF se značkou (${Math.round(pdf1.bytes / 1024)} kB)`);
  const dwg1 = await ex('dwg', { sheet: 1 });
  ok(dwg1.head.startsWith('AC10') && dwg1.bytes > 3000, `výkres DWG se značkou (${dwg1.head.slice(0, 6)}, ${Math.round(dwg1.bytes / 1024)} kB)`);
  await p.keyboard.press('Escape').catch(() => {});

  // ── 2. text: T spoj (sloučený), koutový a5 oboustranně bodem, EN / DE příkazy ──
  const log2 = await run(['nový díl T spoj', 'kvádr 200 100 12 v -100 0 0', 'kvádr 10 100 80 v -5 0 12', 'svar koutový a5 hrana u 5 50 12 oboustranně metoda 135'].join('\n'));
  await idle();
  fs.writeFileSync(S + 'log2.txt', log2);
  ok(!/^✗/m.test(log2), 'koutový svar textem bez chyb' + (first(log2, /^✗.*$/m) ? ' – ' + first(log2, /^✗.*$/m) : ''));
  st = await status();
  fs.writeFileSync(S + 'status2.txt', st);
  ok(/→ koutový – oboustranný a5 \(z7,1\).*délka 200 mm.*průřez 25 mm².*objem 5 cm³/.test(st), 'oboustranný a5: 2 × 100 mm, průřez a² = 25 mm², objem 5 cm³');
  ok(/Svar 1 5 cm³/.test(st), 'těleso Svar 1 má 5 cm³');
  const logEn = await run('weld fillet z4 edge at -5 50 12 field\nweld table');
  await idle();
  ok(!/^✗/m.test(logEn) && /Celkem: 2 svarů/.test(logEn), 'EN: weld fillet z4 edge at … + weld table → 2 svary');
  const logDe = await run('naht tabelle');
  ok(/Celkem: 2 svarů · délka 300 mm/.test(logDe), 'DE: naht tabelle → součet délek 300 mm');

  // ── 3. formulář: T spoj dvou těles, Tupý svar ½V hranou spáry, koutový a4 z druhé strany ──
  await run(['nový díl T formulář', 'kvádr 200 100 12 v -100 0 0', 'kvádr 10 100 80 v -5 0 12 nové'].join('\n'));
  await idle();
  const eRight = await edgeIdx([5, 0, 12], [5, 100, 12]);
  ok(eRight >= 0, `spodní hrana stojiny na straně svaru: E${eRight + 1}`);
  await p.getByRole('button', { name: 'Svařence', exact: true }).click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: /Tupý svar/ }).first().click(); await p.waitForTimeout(1200);
  ok(await p.locator('[data-weld-form="groove"]').isVisible(), 'tlačítko Tupý svar otevře formulář tupého svaru');
  ok(await p.locator('[data-groove-preview]').isVisible(), 'formulář ukazuje náhled průřezu drážky');
  await p.locator('[data-weld-prep]').selectOption('HV'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Hrana spáry / kout' }).click(); await p.waitForTimeout(400);
  await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(900);
  const hints = await p.evaluate(() => window.mncad.hints());
  const h = hints.find((x) => x.kind === 'edge' && x.index === eRight);
  ok(!!h, 'popisek hrany E' + (eRight + 1) + ' je vidět');
  if (h) await p.evaluate((id) => window.mncad.clickHint(id), h.id);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.mncad.hints(false));
  let f = (await doc()).features.slice(-1)[0];
  ok(f.ext === 'weld.groove' && JSON.stringify(f.data.edges) === JSON.stringify([eRight]) && f.data.prep === 'HV', 'klik na hranu uloží hranu spáry do prvku: ' + JSON.stringify({ edges: f.data.edges, prep: f.data.prep }));
  const setNum = async (label, v) => { const inp = p.getByLabel(label).first(); await inp.fill(String(v)); await inp.press('Enter'); await p.waitForTimeout(250); };
  await setNum('Otupení c', 1);
  await setNum('Mezera b', 0);
  await p.waitForTimeout(600);
  await idle();
  const info = await p.locator('[data-groove-area]').innerText().catch(() => '');
  ok(/Průřez svarového kovu ≈ 50,68 mm² \(t = 10 mm\)/.test(info), 'formulář ukazuje živě průřez podle vzorce: ' + info);
  await p.getByRole('button', { name: 'OK', exact: true }).click(); await idle();
  st = await status();
  fs.writeFileSync(S + 'status3.txt', st);
  const areaHV = 9 * 9 * 1 / 2 + segment(9 + 1, 1.5);
  const m3 = /→ tupý ½V \(T spoj\) s10.*průřez ([\d\s ,]+) mm²/.exec(st);
  ok(m3 && Math.abs(num(m3[1]) - areaHV) / areaHV < 0.005, `½V v T spoji: průřez (t−c)²·tg45°/2 + převýšení = ${areaHV.toFixed(2)} mm² (stav: ${m3 && m3[1]})`);
  ok(/, 0 ✗\)/.test(st), 'model bez chyb');
  // koutový svar z druhé strany formulářem (číslo hrany po vyříznutí úpravy)
  const eLeft = await edgeIdx([-5, 0, 12], [-5, 100, 12]);
  ok(eLeft >= 0, `spodní hrana stojiny na druhé straně: E${eLeft + 1}`);
  await run('pohled levý'); await p.waitForTimeout(600); // hrana na druhé straně stojiny musí být vidět
  await p.getByRole('button', { name: /Svarová housenka/ }).first().click(); await p.waitForTimeout(1200);
  ok(await p.locator('[data-weld-form="bead"]').isVisible(), 'tlačítko Svarová housenka otevře formulář koutového svaru');
  await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(900);
  const hints2 = await p.evaluate(() => window.mncad.hints());
  const h2 = hints2.find((x) => x.kind === 'edge' && x.index === eLeft);
  ok(!!h2, 'popisek hrany E' + (eLeft + 1) + ' je v pohledu zleva vidět');
  if (h2) await p.evaluate((id) => window.mncad.clickHint(id), h2.id);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.mncad.hints(false));
  const aIn = p.getByLabel('Účinná tloušťka a').first();
  await aIn.fill('4'); await aIn.press('Enter'); await p.waitForTimeout(400);
  ok(/z = a·√2 = 5,66 mm/.test(await p.locator('[data-weld-az]').innerText()), 'převod a → z ve formuláři: z = a·√2 = 5,66 mm');
  await p.getByRole('button', { name: 'OK', exact: true }).click(); await idle();
  st = await status();
  fs.writeFileSync(S + 'status4.txt', st);
  ok(/→ koutový a4 \(z5,7\).*délka 100 mm.*průřez 16 mm²/.test(st) && /, 0 ✗\)/.test(st), 'koutový a4 formulářem: délka 100 mm, průřez 16 mm²');
  ok(/Svar 1 .*Svar 2/.test(first(st, /^Tělesa:.*$/m) || ''), 'dvě tělesa svarového kovu Svar 1, Svar 2');
  // tabulka svarů tlačítkem
  await p.getByRole('button', { name: /Tabulka svarů/ }).first().click(); await p.waitForTimeout(1500);
  const body = await p.evaluate(() => document.body.innerText);
  ok(/Celkem: 2 svarů · délka 200 mm/.test(body) && /Přídavný materiál \| Metoda/.test(body), 'tlačítko Tabulka svarů: dva řádky a součty');
  await p.screenshot({ path: S + 'tabulka.png' });
  await p.keyboard.press('Escape').catch(() => {});
  await run('pohled iso'); await p.waitForTimeout(600);
  await p.screenshot({ path: S + 'model.png' });
  await run('výkres A3 na šířku pohledy přední,horní,levý');
  const svg2 = await ex('svg', { sheet: 1 });
  fs.writeFileSync(S + 't-spoj.svg', svg2.text);
  ok(svg2.text.includes('>s10<') && svg2.text.includes('>a4<') && svg2.text.includes('45°'), 'výkres T spoje: značka ½V s10 45° a koutový a4');
  await p.keyboard.press('Escape').catch(() => {});

  // ── 4. text: přeplátování – děrový a bodový svar ──
  const log4 = await run(['nový díl Přeplátování', 'kvádr 200 100 10', 'kvádr 200 100 8 v 50 0 10 nové', 'svar děrový Ø12 počet 2 rozteč 60 plocha u 150 50 18', 'svar bodový Ø6 rozteč 40 počet 3 plocha u 150 50 18', 'svar tabulka'].join('\n'));
  await idle();
  fs.writeFileSync(S + 'log4.txt', log4);
  ok(!/^✗/m.test(log4), 'děrový a bodový svar textem bez chyb' + (first(log4, /^✗.*$/m) ? ' – ' + first(log4, /^✗.*$/m) : ''));
  ok(/děrový 2×/.test(log4) && /bodový 3×/.test(log4) && /Celkem: 2 svarů/.test(log4), 'tabulka: děrový 2× a bodový 3×');
  st = await status();
  ok(/→ děrový 2× Ø12.*objem 1,81 cm³/.test(st), 'děrový 2 × Ø12 × 8 mm = 1,81 cm³');
  // bodový svar formulářem: tlačítko → automatický formulář → klik na horní plochu horního plechu → OK
  await run(['nový díl Body formulář', 'kvádr 200 100 10', 'kvádr 200 100 8 v 50 0 10 nové'].join('\n'));
  await idle();
  let topFace = -1;
  for (let i = 0; i < 20 && topFace < 0; i++) {
    const m = await p.evaluate((id) => window.mncad.measure(id).catch(() => null), `F${i + 1}`);
    if (m && Math.abs((m.area || 0) - 20000) < 1 && (m.points || []).some((q) => Math.abs(q[2] - 18) < 1e-3)) topFace = i;
  }
  ok(topFace >= 0, `horní plocha horního plechu F${topFace + 1}`);
  await p.getByRole('button', { name: 'Svařence', exact: true }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Bodový svar/ }).first().click(); await p.waitForTimeout(1200);
  await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(900);
  const hf = (await p.evaluate(() => window.mncad.hints())).find((x) => x.kind === 'face' && x.index === topFace);
  ok(!!hf, 'popisek horní plochy je vidět');
  if (hf) await p.evaluate((id) => window.mncad.clickHint(id), hf.id);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.mncad.hints(false));
  f = (await doc()).features.slice(-1)[0];
  ok(f.ext === 'weld.spot' && JSON.stringify(f.data.faces) === JSON.stringify([topFace]), 'klik na plochu uloží plochu bodového svaru');
  await p.getByRole('button', { name: 'OK', exact: true }).click(); await idle();
  st = await status();
  ok(/→ bodový 5× \(40\) Ø6.*bez přídavného materiálu/.test(st) && /, 0 ✗\)/.test(st), 'bodový svar formulářem: 5 bodů Ø6 s roztečí 40, bez přídavného materiálu');

  ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
