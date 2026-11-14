// E2E – akceptační zkouška vlny 11: polní hlášení AI agenta přehrané tak, jak by ho přehrál agent.
// Agent má JEN (a) textovou konzoli (psaní do pole „Textové příkazy nebo JSON“ + Provést) a (b) klikání myší, a to
// v prohlížeči BEZ WebGL (softwarový náhled). Úkol: podle malého referenčního výkresu namodelovat přírubovou desku,
// ověřit 1 : 1, nakreslit výkres, uložit, exportovat STEP a PDF výkresu a vytvořit sdílený odkaz – vše uvnitř MN CAD.
//
// Referenční výkres (kóty v mm): deska 120 × 80 × 12, střed v počátku; spodní rohy (−Y) sražené 5 × 45°, horní rohy
// (+Y) R10, uprostřed horní hrany drážka 20 × 6; středový otvor Ø20 skrz; 6× Ø6,6 skrz na roztečné kružnici Ø50
// (první díra na +X); kapsa 14 × 40 hloubka 4 se středem [44; 0] v horní ploše; vnější roh drážky [−10; 40] R2.
// Obrys agent kreslí jako DVĚ lomené čáry + dva oblouky (přesně případ z hlášení, kdy se čáry uzavíraly samy).
//
// Kroky (každý vypíše ok:/FAIL: s důkazem – časy, velikosti, objemy; souhrn do <výstup>/journey.json):
//  0. reference STEP (orákulum testu, jiná konstrukce stejné geometrie: jedna uzavřená čára s rohy „r 10“ a „r 2“,
//     díry výčtem, kapsa ze skici XY odsazené) – stáhne se přes window.mncad.exportFile jen pro test
//  1. konzole otevřená kliknutím (Nápověda ▸ Textové příkazy), model obrysu + díry + pole, `stav` → profil platný
//  2. popisky pro výběr kliknutím (Nápověda ▸ Popisky…), klik na horní plochu v náhledu → `vyber` → F…, `měřit F…`
//     → `skica plocha F…` + kapsa (`vysunout 4 odebrat obráceně`)
//  3. klik na svislou hranu rohu drážky → Zaoblit na pásu karet převezme hranu → OK (výchozí R2) → objem klesne
//  4. ověření 1 : 1: `měřit těleso` (obálka, objem proti hodnotě z výkresu), `měřit díry` (počty, Ø, rozteč)
//  5. porovnání s referenčním STEP: Nástroje ▸ Porovnat s referencí ▸ Vybrat referenci… (výběr souboru, ne dialog
//     prohlížeče) → „modely se shodují“
//  6. výkres: `výkres A3 …`, `kótovat`, `výkres stav` → žádné duplicity, žádné chybějící kóty
//  7. `uložit`, `export step`, `výkres export pdf`, `sdílet` → stažení (download): .mncad platný, STEP se znovu otevře
//     se stejným objemem, PDF má razítko, odkaz z protokolu otevře model v nové kartě
//  – page.on('dialog') nesmí vystřelit nikdy, žádné chyby stránky.
// Spuštění: E2E_BASE=http://localhost:3364 node e2e/cad-agent-journey.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e-journey').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const T0 = Date.now();
const journey = [];
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; return c; };
/** krok cesty s důkazem (do souhrnu) */
const step = (name, c, evidence) => { journey.push({ step: name, ok: !!c, evidence }); return ok(c, `${name} – ${evidence}`); };
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const num = (s) => parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.'));

// ── hodnoty z referenčního výkresu ──
const PCD = 50, HOLE = 6.6, BORE = 20, R_CORNER = 10, CH = 5, NOTCH_W = 20, NOTCH_D = 6, T = 12;
const POCKET = { w: 14, h: 40, d: 4, cx: 44, cy: 0 };
const FILLET_R = 2; // svislá hrana vnějšího rohu drážky [−10; 40] (roh 90°, po celé tloušťce)
const AREA = 120 * 80 - 2 * (CH * CH) / 2 - 2 * (R_CORNER ** 2 - (Math.PI * R_CORNER ** 2) / 4) - NOTCH_W * NOTCH_D;
const VOL_BEFORE_FILLET = AREA * T - Math.PI * (BORE / 2) ** 2 * T - 6 * Math.PI * (HOLE / 2) ** 2 * T - POCKET.w * POCKET.h * POCKET.d;
const FILLET_CUT = (1 - Math.PI / 4) * FILLET_R ** 2 * T; // úběr zaoblení R2 na svislé hraně 90°
const VOL_REF = VOL_BEFORE_FILLET - FILLET_CUT;

const ready = async (p, url = CAD) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
  // úvodní obrazovka se může objevit až po načtení jádra (pomalý první překlad)
  if (await c.isVisible().catch(() => false)) await c.click();
};

(async () => {
  const b = await chromium.launch({ args: NO_GL });

  // ════════ 0) orákulum testu: referenční STEP stejné geometrie, jinou konstrukcí ════════
  const refPath = S + 'reference-deska.step';
  {
    const t = Date.now();
    const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
    const o = await ctx.newPage();
    await ready(o);
    const log = await o.evaluate((t) => window.mncad.run(t), [
      'nový díl Reference',
      `skica XY: čára -60 -35 -55 -40 55 -40 60 -35 60 40 r ${R_CORNER} 10 40 10 34 -10 34 -10 40 r ${FILLET_R} -60 40 r ${R_CORNER} uzavřít`,
      `vysunout ${T}`,
      `díra ${BORE} skrz v 0 0`,
      `díra 6,6 skrz ${[0, 60, 120, 180, 240, 300].map((a) => `v ${(25 * Math.cos((a * Math.PI) / 180)).toFixed(6)} ${(25 * Math.sin((a * Math.PI) / 180)).toFixed(6)} ${T}`).join(' ')}`,
      `skica XY odsazení ${T}: obdélník ${POCKET.w} ${POCKET.h} střed v ${POCKET.cx} ${POCKET.cy}`,
      `vysunout ${POCKET.d} odebrat obráceně`,
      'měřit těleso',
    ].join('\n'));
    fs.writeFileSync(S + 'oracle.log', log);
    const v = /objem ([\d\s  ]+,\d+) mm³/.exec(log);
    const step0 = await o.evaluate(() => window.mncad.exportFile('step'));
    fs.writeFileSync(refPath, Buffer.from(step0.base64, 'base64'));
    step('0 reference STEP (orákulum)', v && Math.abs(num(v[1]) - VOL_REF) < 0.05 && !/^\s*[⚠✗]/m.test(log), `jiná konstrukce: objem ${v && v[1]} mm³ (výkres ${VOL_REF.toFixed(3)}), ${path.basename(refPath)} ${fs.statSync(refPath).size} B, ${sec(Date.now() - t)}`);
    await ctx.close();
  }

  // ════════ agent: jen konzole + klikání, bez WebGL ════════
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const dialogs = [];
  const errs = [];
  const dl = [];
  p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); console.log(`FAIL: systémové okno ${d.type()}: ${d.message()}`); process.exitCode = 1; d.dismiss().catch(() => {}); });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('download', (d) => dl.push(d));
  const nextDownload = async (n, ms = 180000) => {
    const t = Date.now();
    while (dl.length < n && Date.now() - t < ms) await p.waitForTimeout(200);
    const d = dl[n - 1];
    if (!d) return null;
    const file = S + d.suggestedFilename();
    await d.saveAs(file);
    return { name: d.suggestedFilename(), path: file, bytes: fs.statSync(file).size };
  };
  let t = Date.now();
  await ready(p);
  ok(await p.evaluate(() => { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); }), 'prostředí: WebGL vypnuté (jako v polním hlášení)');
  ok((await p.locator('[data-viewport-fallback]').getAttribute('data-viewport-fallback').catch(() => null)) === 'soft', 'v 3D okně je softwarový náhled');
  ok((await p.evaluate(() => navigator.webdriver)) === true, 'navigator.webdriver = true (prohlížeč ovládá automatizace)');

  // ── konzole: otevřít / zavřít kliknutím, psát, Provést ──
  const input = p.getByLabel('Textové příkazy nebo JSON');
  const out = p.locator('[data-agent-output]');
  const helpMenu = async (entry) => {
    await p.getByRole('button', { name: /Nápověda/ }).first().click();
    await p.waitForTimeout(300);
    await p.getByText(entry).first().click();
    await p.waitForTimeout(500);
  };
  const openConsole = async () => {
    if (await input.isVisible().catch(() => false)) return;
    await helpMenu('Textové příkazy – pro AI agenty i rychlé zadání');
    await input.waitFor({ timeout: 20000 });
  };
  const closeConsole = async () => {
    if (!(await input.isVisible().catch(() => false))) return;
    await p.locator('div[class*="z-[70]"]').filter({ has: out }).getByRole('button', { name: 'Zavřít', exact: true }).last().click(); // tlačítko Zavřít v patičce konzole
    await p.waitForTimeout(400);
  };
  const consoleRun = async (text, ms = 240000) => {
    await openConsole();
    const clr = p.getByRole('button', { name: 'Vymazat', exact: true });
    if (await clr.isEnabled().catch(() => false)) await clr.click();
    const before = await out.innerText();
    await input.fill(text);
    const t1 = Date.now();
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    const log = await out.innerText();
    fs.appendFileSync(S + 'console.log', `\n>>> ${text}\n[${Date.now() - t1} ms]\n${log}\n`);
    return { log, ms: Date.now() - t1 };
  };
  /** popisky pro výběr (štítky F/E/V v náhledu) – agent je čte ze snímku obrazovky, test z DOM (jen čtení) */
  const labels = () => p.locator('[data-hint]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.textContent, title: e.getAttribute('title') || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }));
  const volOf = (log) => { const m = /objem ([\d\s  ]+,\d+) mm³/.exec(log); return m ? num(m[1]) : NaN; };

  // ════════ 1) model z výkresu: obrys = 2 lomené čáry + 2 oblouky, díry, pole ════════
  fs.writeFileSync(S + 'console.log', '');
  let r = await consoleRun([
    'nový díl Deska',
    'skica XY',
    'čára -60 30 -60 -35 -55 -40 55 -40 60 -35 60 30',
    'oblouk 60 30 57,0710678 37,0710678 50 40',
    'čára 50 40 10 40 10 34 -10 34 -10 40 -50 40',
    'oblouk -50 40 -57,0710678 37,0710678 -60 30',
    `vysunout ${T}`,
    `díra ${BORE} skrz v 0 0`,
    'díra 6,6 skrz v 25 0',
    'pole kruhové 6',
  ].join('\n'));
  const okModel = /✓ Vysunutí 1/.test(r.log) && /✓ Pole 1/.test(r.log) && !/^\s*[⚠✗]/m.test(r.log);
  step('1 model z konzole (2 lomené čáry + 2 oblouky, Ø20, 6× Ø6,6)', okModel, `${r.ms} ms; ${(/Rozměry: [^\n]+/.exec(r.log) || [''])[0]}`);
  r = await consoleRun('stav');
  const prof = /profil: 1 uzavřený obrys \(e1–e4\) ✓/.test(r.log);
  const polyOpen = /e1 čára 6 b\.[^·]*otevřená/.test(r.log) && /e3 čára 6 b\.[^·]*otevřená/.test(r.log);
  step('1b profil platný (stav)', prof && polyOpen && /Geometrie: platná · 1 těleso/.test(r.log), `${(/profil: [^\n]+/.exec(r.log) || ['?'])[0]}; obě lomené čáry „otevřená“ = části obrysu: ${polyOpen}; ${r.ms} ms`);
  await p.screenshot({ path: S + 'j1-console.png' });

  // ════════ 2) klik na horní plochu v náhledu → skica na ní (kapsa) ════════
  await closeConsole();
  // popisky zapnout (položka nabídky říká „– zapnout“, jsou-li vypnuté)
  if (!(await p.locator('[data-hint]').count())) await helpMenu(/Popisky pro výběr myší .* – zapnout/);
  await p.locator('[data-soft-view="iso"]').click();
  await p.waitForTimeout(700);
  let L = await labels();
  const topFace = L.find((l) => /rovinná · normála \+Z/.test(l.title));
  ok(L.length > 20 && !!topFace, `popisky pro výběr v náhledu: ${L.length} štítků, horní plocha ${topFace && topFace.id} v [${topFace && [topFace.x, topFace.y]}]`);
  await p.screenshot({ path: S + 'j2-labels.png' });
  await p.mouse.click(topFace.x, topFace.y);
  await p.waitForTimeout(500);
  r = await consoleRun('vyber');
  const faceId = (/^Výběr: (F\d+)$/m.exec(r.log) || [])[1];
  step('2 klik na horní plochu v náhledu bez WebGL', faceId === topFace.id, `vyber → „${(/^Výběr: [^\n]*/m.exec(r.log) || ['?'])[0]}“ (štítek ${topFace.id})`);
  r = await consoleRun(`měřit ${faceId}`);
  const cen = /těžiště plochy \[([-\d,]+); ([-\d,]+); ([-\d,]+)\]/.exec(r.log);
  const c0 = cen ? [num(cen[1]), num(cen[2]), num(cen[3])] : [NaN, NaN, NaN];
  ok(/normála \+Z/.test(r.log) && Math.abs(c0[2] - T) < 1e-6, `měřit ${faceId}: ${(/^F\d+: [^\n]*/m.exec(r.log) || ['?'])[0]}`);
  // skica na ploše má počátek v těžišti plochy (protokol ho vypíše) – souřadnice kapsy z výkresu se přepočtou
  const lx = +(POCKET.cx - c0[0]).toFixed(3), ly = +(POCKET.cy - c0[1]).toFixed(3);
  const fmt = (v) => String(v).replace('.', ',');
  r = await consoleRun(`skica plocha ${faceId}: obdélník ${POCKET.w} ${POCKET.h} střed v ${fmt(lx)} ${fmt(ly)}\nvysunout ${POCKET.d} odebrat obráceně`);
  const org = /✓ Skica 2 na ploše (F\d+) – rovina: počátek \[([-\d,]+); ([-\d,]+); ([-\d,]+)\], normála \+Z, osa X skici \+X/.exec(r.log);
  const v2 = await consoleRun('měřit těleso');
  const vPocket = volOf(v2.log);
  const expPocket = VOL_BEFORE_FILLET;
  step('2b skica na kliknuté ploše + kapsa 14 × 40 × 4', !!org && org[1] === faceId && /✓ Vysunutí 2/.test(r.log) && !/^\s*[⚠✗]/m.test(r.log) && Math.abs(vPocket - expPocket) < 0.5, `počátek skici [${org && org.slice(2).join('; ')}] = těžiště ${faceId}; kapsa v [${fmt(lx)}; ${fmt(ly)}] lokálně = [44; 0] modelu; objem ${vPocket} mm³ (výkres před zaoblením ${expPocket.toFixed(3)}); ${r.ms} ms`);

  // ════════ 3) klik na svislou hranu vnějšího rohu drážky [−10; 40] → Zaoblit (pás karet) → OK ════════
  await closeConsole();
  await p.locator('[data-soft-view="iso"]').click();
  await p.waitForTimeout(700);
  L = await labels();
  // na snímku: štítek vrcholu [-10; 40; 12] a pod ním štítek svislé hrany 12 mm
  const vx = L.find((l) => /\[-10; 40; 12\]/.test(l.title));
  const edge = vx && L.filter((l) => /svislá úsečka · délka ≈ 12 mm/.test(l.title)).sort((a, b) => Math.hypot(a.x - vx.x, a.y - vx.y) - Math.hypot(b.x - vx.x, b.y - vx.y))[0];
  ok(!!vx && !!edge, `štítek vrcholu ${vx && vx.id} [-10; 40; 12] a nejbližší svislá hrana ${edge && edge.id} v [${edge && [edge.x, edge.y]}]`);
  await p.mouse.click(edge.x, edge.y);
  await p.waitForTimeout(500);
  r = await consoleRun(`vyber\nměřit ${edge.id}`);
  const edgeLine = (/^E\d+: [^\n]*/m.exec(r.log) || [''])[0];
  const edgeOk = new RegExp(`^Výběr: ${edge.id}$`, 'm').test(r.log) && /délka 12 mm/.test(edgeLine) && /\[-10; 40; 0\]/.test(edgeLine) && /\[-10; 40; 12\]/.test(edgeLine);
  step('3 klik na svislou hranu rohu drážky', edgeOk, `vyber → ${edge.id}; ${edgeLine}`);
  await closeConsole();
  // výběr zůstal (konzole ho nemění) – Zaoblit na pásu karet ho převezme, výchozí R2 = výkres → OK
  t = Date.now();
  await p.getByRole('button', { name: 'Zaoblit', exact: true }).first().click();
  await p.getByRole('button', { name: 'OK', exact: true }).waitFor({ timeout: 30000 });
  const tForm = Date.now() - t;
  await p.screenshot({ path: S + 'j3-fillet-form.png' });
  const fForm = await p.evaluate(() => window.mncad.getDocument().features.slice(-1)[0]); // jen čtení stavu (důkaz)
  t = Date.now();
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }).catch(() => {});
  const tOk = Date.now() - t;
  r = await consoleRun('stav');
  const filletLine = (/Zaoblení 1 \[fillet[^\n]*/.exec(r.log) || [''])[0];
  step('3b Zaoblit převezme kliknutou hranu → OK', fForm.type === 'fillet' && fForm.radius === FILLET_R && JSON.stringify(fForm.edges) === `[${Number(edge.id.slice(1)) - 1}]` && /✓ – R2, hrany 1/.test(filletLine) && !/^\s*[⚠✗]/m.test(r.log), `formulář: hrany ${JSON.stringify(fForm.edges)} (= ${edge.id}), R${fForm.radius}; ${filletLine.replace(/, id \w+/, '')}; formulář ${sec(tForm)}, OK → hotovo ${sec(tOk)}`);
  await p.screenshot({ path: S + 'j3-fillet.png' });

  // ════════ 4) ověření 1 : 1 měřením proti hodnotám z výkresu ════════
  r = await consoleRun('měřit těleso\nměřit díry');
  const vol = volOf(r.log);
  const env = /obálka 120 × 80 × 12 mm \(X -60…60, Y -40…40, Z 0…12\)/.test(r.log);
  const holes = /Díry: 7 – Ø 6,6 mm × 6, Ø 20 mm × 1/.test(r.log);
  const pcd = [...r.log.matchAll(/D\d Ø 6,6 mm: vstup \[([-\d,]+); ([-\d,]+); 12\] · skrz, délka 12 mm/g)].map((m) => Math.hypot(num(m[1]), num(m[2])));
  const pcdOk = pcd.length === 6 && pcd.every((x) => Math.abs(x - PCD / 2) < 0.002);
  const bore = /D7 Ø 20 mm: vstup \[0; 0; 12\] · skrz/.test(r.log);
  step('4 ověření 1 : 1 (měřit těleso, měřit díry)', env && holes && pcdOk && bore && Math.abs(vol - VOL_REF) < 0.5, `obálka 120 × 80 × 12: ${env}; objem ${vol} mm³ vs. výkres ${VOL_REF.toFixed(3)} (Δ ${(vol - VOL_REF).toFixed(3)} mm³); díry 6× Ø6,6 + Ø20 skrz: ${holes && bore}; rozteč Ø${pcd.length ? (2 * Math.max(...pcd)).toFixed(3) : '?'} (výkres Ø${PCD}); ${r.ms} ms`);

  // ════════ 5) porovnání s referenčním STEP – kliknutím (Nástroje ▸ Porovnat s referencí) ════════
  await closeConsole();
  t = Date.now();
  await p.getByRole('button', { name: 'Nástroje', exact: true }).first().click(); // karta pásu karet
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Porovnat s referencí/ }).first().click();
  await p.locator('[data-compare-dialog]').waitFor({ timeout: 20000 });
  const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 20000 }), p.getByRole('button', { name: /Vybrat referenci/ }).click()]);
  await chooser.setFiles(refPath); // po výběru souboru se porovnání spustí samo
  await p.waitForFunction(() => !!document.querySelector('[data-compare-result]') && document.querySelector('[data-compare-run]')?.textContent !== 'Porovnávám…', null, { timeout: 180000 });
  const res = p.locator('[data-compare-result]');
  const vd = Number(await res.getAttribute('data-volume-diff'));
  const regions = Number(await res.getAttribute('data-regions'));
  const resText = await res.innerText();
  await p.screenshot({ path: S + 'j5-compare.png' });
  step('5 porovnání s referenčním STEP (klik + výběr souboru)', Math.abs(vd) < 1 && regions === 0 && /modely se shodují/.test(resText), `rozdíl objemů ${vd.toFixed(4)} mm³, rozdílových oblastí ${regions}, „${(/Žádné rozdíly[^\n]*/.exec(resText) || ['?'])[0]}“; ${sec(Date.now() - t)}`);
  await p.getByRole('button', { name: /Porovnat s referencí/ }).first().click(); // druhý klik na tlačítko porovnání zavře
  await p.waitForTimeout(400);

  // ════════ 6) výkres: list, Chytré kóty, kontrola ════════
  r = await consoleRun('výkres A3 na šířku pohledy přední,horní,iso\nkótovat\nvýkres stav');
  const dup = /Duplicity: žádné/.test(r.log);
  const allDims = /Kontrola kót: všech \d+ (?:rozměrů )?je na listu/.test(r.log) || /Kontrola kót: všech/.test(r.log);
  const missing = (/Kontrola kót: [^\n]*/.exec(r.log) || ['?'])[0];
  const dimsLine = (/✓ Chytré kóty[^\n]*/.exec(r.log) || ['?'])[0];
  step('6 výkres A3 + kótovat + výkres stav', dup && allDims && !/^✗/m.test(r.log), `${dimsLine}; ${missing}; Duplicity žádné: ${dup}; ${r.ms} ms`);
  await p.screenshot({ path: S + 'j6-drawing.png' });

  // ════════ 7) výstupy z konzole: uložit, export step, výkres export pdf, sdílet ════════
  const n0 = dl.length;
  r = await consoleRun('uložit\nexport step\nvýkres export pdf\nsdílet');
  const outLog = r.log;
  const fSave = await nextDownload(n0 + 1);
  const fStep = await nextDownload(n0 + 2);
  const fPdf = await nextDownload(n0 + 3);
  ok(r.ms < 120000, `výstupy z konzole doběhly za ${sec(r.ms)}`);
  // .mncad
  const proj = fSave ? JSON.parse(fs.readFileSync(fSave.path, 'utf8')) : null;
  step('7a uložit → .mncad', fSave && fSave.name === 'Deska.mncad' && proj && proj.app === 'mnastrojarna-cad' && proj.features.length === 8 && /✓ uloženo: Deska\.mncad · [\d,]+ kB · projekt Mnástrojárna CAD \(\.mncad\) – staženo \(bez dialogu\)/.test(outLog), `${fSave && fSave.name} ${fSave && fSave.bytes} B, prvků ${proj && proj.features.length}; ${(/✓ kontrola: projekt[^\n]*/.exec(outLog) || ['?'])[0]}`);
  // STEP + kontrola v protokolu
  const chk = /✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem ([^(]+) \(rozdíl ([\d,]+) %\), obálka ([^m]+) mm \(odchylka ([\d,]+) mm\) → věrná kopie modelu/.exec(outLog);
  step('7b export step → .step + kontrola v protokolu', fStep && fStep.name === 'Deska.step' && fs.readFileSync(fStep.path, 'utf8').startsWith('ISO-10303-21;') && !!chk, `${fStep && fStep.name} ${fStep && fStep.bytes} B; kontrola: objem ${chk && chk[1].trim()} (rozdíl ${chk && chk[2]} %), obálka ${chk && chk[3].trim()} mm (odchylka ${chk && chk[4]} mm)`);
  // PDF výkresu s razítkem
  let pdfText = '';
  let pdfPages = 0;
  if (fPdf) {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(fPdf.path)), useSystemFonts: false, isEvalSupported: false });
      const doc = await task.promise;
      pdfPages = doc.numPages;
      const pg = await doc.getPage(1);
      pdfText = (await pg.getTextContent()).items.map((i) => i.str).join(' ');
      await task.destroy();
    } catch (e) {
      pdfText = 'ERR ' + e.message;
    }
  }
  const stamp = ['Deska', 'Ocel', '1:1'].filter((w) => pdfText.includes(w));
  step('7c výkres export pdf → PDF s razítkem', fPdf && /\.pdf$/.test(fPdf.name) && fs.readFileSync(fPdf.path).subarray(0, 5).toString() === '%PDF-' && fPdf.bytes > 5000 && pdfPages === 1 && stamp.length === 3 && /✓ výkres PDF: \S+\.pdf · [\d,]+ kB · výkres PDF – staženo \(bez dialogu\)/.test(outLog), `${fPdf && fPdf.name} ${fPdf && fPdf.bytes} B, stran ${pdfPages}, text razítka: ${stamp.join(', ')} (${pdfText.length} znaků textu${stamp.length === 3 ? '' : ': ' + pdfText.slice(0, 160)})`);
  // sdílený odkaz
  const url = (/^URL: (\S+)$/m.exec(outLog) || [])[1] || '';
  step('7d sdílet → adresa v protokolu', url.startsWith(CAD + '#s=') && /✓ sdílený odkaz vytvořen – „Deska“ \(model\)/.test(outLog), `${url.length} znaků; ${(/✓ sdílený odkaz[^\n]*/.exec(outLog) || ['?'])[0]}`);
  await p.screenshot({ path: S + 'j7-outputs.png' });
  const totalAgent = Date.now() - T0;

  // ════════ příjemce: odkaz v nové kartě; STEP ze stažení znovu otevřený (orákulum) ════════
  const q = await ctx.newPage();
  q.on('dialog', (d) => { dialogs.push(`(příjemce) ${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  q.on('pageerror', (e) => errs.push(e.message));
  t = Date.now();
  await q.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  await q.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  await q.waitForFunction(() => window.mncad.getDocument().name === 'Deska', null, { timeout: 60000 }).catch(() => {});
  await q.waitForFunction(() => Number(document.querySelector('[data-soft-canvas]')?.dataset.tris) > 100, null, { timeout: 60000 }).catch(() => {});
  const shared = await q.evaluate(() => window.mncad.getDocument());
  const sharedVol = volOf(await q.evaluate(() => window.mncad.run('měřit těleso')));
  const tris = Number(await q.locator('[data-soft-canvas]').getAttribute('data-tris').catch(() => 0));
  await q.screenshot({ path: S + 'j7-recipient.png' });
  step('7e odkaz z protokolu otevře model v nové kartě', shared.name === 'Deska' && shared.features.length === 8 && Math.abs(sharedVol - vol) < 0.01 && tris > 100, `„${shared.name}“, ${shared.features.length} prvků, objem ${sharedVol} mm³ (agent ${vol}), náhled ${tris} trojúhelníků; ${sec(Date.now() - t)}`);
  if (fStep) {
    const imp = await q.evaluate(({ name, base64 }) => window.mncad.importFile({ name, base64 }, { as: 'tab' }), { name: fStep.name, base64: fs.readFileSync(fStep.path).toString('base64') });
    const m = /objem ([\d\s  ]+,\d+) cm³/.exec(imp);
    const vImp = volOf(await q.evaluate(() => window.mncad.run('měřit těleso')));
    step('7f STEP ze stažení znovu otevřený', Math.abs(vImp - vol) < 0.05, `objem ${vImp} mm³ (model ${vol}, Δ ${(vImp - vol).toFixed(4)} mm³; stav ${m && m[1]} cm³)`);
  }
  await q.close();

  ok(dialogs.length === 0, `za celou cestu žádné systémové okno (page.on('dialog')): ${dialogs.join(' | ') || '0'}`);
  ok(errs.length === 0, 'bez chyb stránky ' + errs.join(' | '));
  journey.push({ step: 'souhrn', ok: process.exitCode !== 1, evidence: `agent ${sec(totalAgent)} (včetně orákula a načtení jádra), stažení ${dl.length}, systémová okna ${dialogs.length}, chyby stránky ${errs.length}` });
  fs.writeFileSync(S + 'journey.json', JSON.stringify(journey, null, 2));
  console.log(`souhrn: ${journey.filter((j) => j.ok).length}/${journey.length} kroků ok, celkem ${sec(Date.now() - T0)}`);
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); fs.writeFileSync(S + 'journey.json', JSON.stringify(journey, null, 2)); process.exit(1); });
