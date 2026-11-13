// E2E: směr a osa u prvků rozšíření (parametry „direction“ / „axis“), skryté starší duplicitní prvky a směr vyhození
// ve formařských nástrojích zadaný vektorem nebo odkazem.
// Spuštění (server na :3100 nebo E2E_BASE): node e2e/cad-ext-forms.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

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
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const status = () => p.evaluate(() => window.mncad.status());
  const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  /** čeká, až objem odpovídá (přepočet po změně formuláře běží asynchronně) */
  const volBecomes = async (want, tol = 0.01, ms = 60000) => { const t0 = Date.now(); let v = NaN; while (Date.now() - t0 < ms) { v = await vol(); if (Math.abs(v - want) < tol) return v; await p.waitForTimeout(400); } return v; };
  /** stav dokumentu: „prvků n (n ✓, 0 ✗)“ a platná geometrie */
  const noErrors = async () => { const t = await status(); return /, 0 ✗\)/.test(t) && /Geometrie: platná/.test(t); };
  const last = async () => (await doc()).features.slice(-1)[0];
  const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();
  const param = (key) => p.locator(`[data-ext-param="${key}"]`).first();
  /** vybere entitu přes popisky (F/E) stejnou cestou jako myš; `test(title)` vybere vhodnou */
  const pickHint = async (kind, test) => {
    await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(900);
    const hints = await p.evaluate(() => window.mncad.hints());
    const h = hints.find((x) => x.kind === kind && test(x.title));
    await p.evaluate((id) => id && window.mncad.clickHint(id), h && h.id); await p.waitForTimeout(700);
    await p.evaluate(() => window.mncad.hints(false));
    return h;
  };
  const openFeature = async (name) => {
    await p.getByText(name, { exact: true }).first().click(); await p.waitForTimeout(700);
    if (!(await param('axis').isVisible().catch(() => false))) { await p.getByText(name, { exact: true }).first().dblclick(); await p.waitForTimeout(700); }
  };

  // ── 1. převedený prvek rozšíření: Rohová úleva, osa výřezu jako směr ──
  await run('nový díl Rozšíření\nkvádr 40 40 20'); await idle();
  const V0 = 32;
  ok(Math.abs((await vol()) - V0) < 0.001, 'kvádr 40 × 40 × 20 = 32 cm³');
  await p.getByRole('button', { name: 'Plech', exact: true }).click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Rohová úleva/ }).first().click(); await p.waitForTimeout(900);
  ok(await param('axis').isVisible(), 'formulář Rohové úlevy má pole „Osa výřezu“ jako směr (data-ext-param="axis")');
  ok((await param('axis').locator('select').inputValue()) === 'axis', 'výchozí osa Z se zobrazí jako „Osa X / Y / Z“ (převedeno z dřívějšího zápisu)');
  const kinds = await param('axis').locator('select option').evaluateAll((os) => os.map((o) => o.value));
  ok(['axis', 'vector', 'edge', 'faceNormal', 'twoPoints'].every((k) => kinds.includes(k)) && !kinds.includes('normal') && !kinds.includes('angle'), 'nabídka druhů směru: osa, vektor, hrana, normála plochy, dva body (bez normály skici a úhlu): ' + kinds.join(', '));
  // střed úlevy uprostřed kvádru, Ø 6
  const center = p.locator('xpath=//p[normalize-space()="Střed úlevy"]/following-sibling::div[1]//input');
  for (const [i, v] of [[0, '20'], [1, '20'], [2, '10']]) { await center.nth(i).fill(v); await center.nth(i).press('Enter'); await p.waitForTimeout(150); }
  const size = p.getByLabel('Velikost (Ø / strana)');
  await size.fill('6'); await size.press('Enter'); await p.waitForTimeout(300);
  // směr typovaným vektorem 1; 0; 0
  await param('axis').locator('select').selectOption('vector'); await p.waitForTimeout(300);
  const vin = param('axis').locator('input');
  ok((await vin.count()) === 3, 'druh „Vektor“ ukáže tři pole X / Y / Z');
  await vin.nth(0).fill('1'); await vin.nth(0).press('Enter'); await p.waitForTimeout(200);
  await vin.nth(2).fill('0'); await vin.nth(2).press('Enter'); await p.waitForTimeout(300);
  await okBtn(); await idle();
  let f = await last();
  ok(f.ext === 'sheet.relief' && f.data.axis && f.data.axis.kind === 'vector' && JSON.stringify(f.data.axis.v) === '[1,0,0]', 'uložený směr je vektor [1,0,0]: ' + JSON.stringify(f.data.axis));
  const VH = V0 - Math.PI * 9 * 40 / 1000;
  let v = await volBecomes(VH);
  ok(Math.abs(v - VH) < 0.01 && (await noErrors()), `úleva Ø6 podél X přes celý kvádr: ${v} cm³ (čekáno ${VH.toFixed(3)}), bez chyby`);
  await p.screenshot({ path: S + 'ext-forms-vector.png' });

  // ── 2. směr odkazem na hranu vybranou v modelu (svislá hrana → výřez podél Z) ──
  await openFeature(f.name);
  ok(await param('axis').isVisible(), 'formulář prvku se znovu otevře z historie');
  await param('axis').locator('select').selectOption('edge'); await p.waitForTimeout(300);
  await param('axis').getByRole('button', { name: /Vyberte/ }).first().click(); await p.waitForTimeout(400);
  const edge = await pickHint('edge', (t) => /svislá úsečka/.test(t));
  f = await last();
  ok(!!edge && f.data.axis.kind === 'edge' && f.data.axis.ref.kind === 'edge' && f.data.axis.ref.index >= 0 && !!f.data.axis.ref.sig, `hrana vybraná v modelu (${edge && edge.title}) je v prvku jako odkaz s otiskem: ` + JSON.stringify(f.data.axis.ref).slice(0, 90));
  await okBtn(); await idle();
  const VV = V0 - Math.PI * 9 * 20 / 1000;
  v = await volBecomes(VV);
  ok(Math.abs(v - VV) < 0.01 && (await noErrors()), `úleva podél svislé hrany (Z, délka 20): ${v} cm³ (čekáno ${VV.toFixed(3)}), model se přestavěl bez chyby`);

  // ── 3. směr odkazem na normálu plochy (boční plocha → zase vodorovně) ──
  await openFeature(f.name);
  await param('axis').locator('select').selectOption('faceNormal'); await p.waitForTimeout(300);
  await param('axis').getByRole('button', { name: /Vyberte/ }).first().click(); await p.waitForTimeout(400);
  const face = await pickHint('face', (t) => /normála [+−-]?[XY]\b/.test(t));
  f = await last();
  ok(!!face && f.data.axis.kind === 'faceNormal' && f.data.axis.ref.kind === 'face' && f.data.axis.ref.index >= 0, `boční plocha (${face && face.title}) jako normála: ` + JSON.stringify(f.data.axis.ref).slice(0, 80));
  await okBtn(); await idle();
  v = await volBecomes(VH);
  ok(Math.abs(v - VH) < 0.01 && (await noErrors()), `úleva ve směru normály boční plochy: ${v} cm³ (čekáno ${VH.toFixed(3)}), bez chyby`);
  await p.screenshot({ path: S + 'ext-forms-face.png' });

  // ── 4. starší dokument s osou „X“ (dřívější zápis) se postaví stejně a formulář ukáže osu X ──
  const old = await doc();
  old.features[old.features.length - 1].data.axis = 'X';
  await p.evaluate((d) => window.mncad.setDocument(d), old); await idle();
  v = await volBecomes(VH);
  ok(Math.abs(v - VH) < 0.01 && (await noErrors()), `dokument s dřívějším "axis": "X" se postaví stejně: ${v} cm³`);
  await openFeature(f.name);
  const xActive = await param('axis').locator('button', { hasText: /^X$/ }).first().getAttribute('class');
  ok((await param('axis').locator('select').inputValue()) === 'axis' && /border-brand/.test(xActive || ''), 'formulář ukáže dřívější „X“ převedené na Osa X / Y / Z → X');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // ── 5. starší duplicitní prvky: nejsou na pásu karet ani v paletě, uložený dokument i příkaz prvek fungují ──
  const LEGACY = ['Proměnné zaoblení', 'Plné zaoblení', 'Sražení D1×D2 / D×úhel', 'Pole podél křivky', 'Výplňové pole', 'Díry v bodech'];
  await p.getByRole('button', { name: 'Tvorba', exact: true }).click(); await p.waitForTimeout(400);
  const ribbonText = await p.evaluate(() => { const r = document.querySelector('[data-ribbon]'); return [...r.querySelectorAll('*')].map((e) => `${e.getAttribute('title') || ''} ${e.getAttribute('aria-label') || ''} ${e.children.length ? '' : e.textContent}`).join('\n'); });
  ok(LEGACY.every((l) => !ribbonText.includes(l)) && /Zaoblení řetězce/.test(ribbonText), 'karta Tvorba: žádný ze 6 starších prvků, „Zaoblení řetězce“ zůstává');
  await p.keyboard.press('Control+k'); await p.waitForTimeout(500);
  const palInput = p.locator('input[placeholder]').last();
  const palette = async (q) => { await palInput.fill(q); await p.waitForTimeout(400); return p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.closest('[role="dialog"], .fixed')).map((b) => b.innerText.split('\n')[0]).join(' | ')); };
  let legacyInPalette = [];
  for (const l of LEGACY) { const res = await palette(l); if (res.includes(l)) legacyInPalette.push(l); }
  const chain = await palette('Zaoblení řetězce');
  ok(legacyInPalette.length === 0 && /Zaoblení řetězce/.test(chain), 'paleta příkazů: starší prvky nenabízí (' + legacyInPalette.join(', ') + '), „Zaoblení řetězce“ najde');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  let log = await run('nový díl Starší\nkvádr 40 40 20\nprvek adv.varFillet edges=svislé r1=2 r2=4\nstav'); await idle();
  ok(!log.split('\n').some((l) => l.startsWith('✗')), 'obecný příkaz „prvek adv.varFillet edges=svislé …“ dál funguje ' + log.split('\n').filter((l) => l.startsWith('✗')).join(' '));
  const legacyDoc = await doc();
  const lf = legacyDoc.features.find((x) => x.type === 'ext' && x.ext === 'adv.varFillet');
  ok(!!lf && lf.data.edges.length === 4, 'prvek má 4 svislé hrany: ' + JSON.stringify(lf && lf.data.edges));
  await run('nový díl Načtený'); await idle();
  await p.evaluate((d) => window.mncad.setDocument(d), legacyDoc); await idle();
  v = await vol();
  ok(v < V0 - 0.01 && v > V0 - 1 && (await noErrors()), `uložený dokument se starším prvkem (Proměnné zaoblení) se postaví: ${v} cm³ < 32`);
  await p.getByText(lf.name, { exact: true }).first().click(); await p.waitForTimeout(800);
  const hint = await p.locator('[data-legacy-hint]').first().innerText().catch(() => '');
  ok(/Totéž umí vestavěné Zaoblení, druh R1 → R2/.test(hint), 'formulář staršího prvku ukáže nápovědu k vestavěné náhradě: ' + hint.replace(/\s+/g, ' '));
  await p.screenshot({ path: S + 'ext-forms-legacy.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ── 6. formařské nástroje: směr vyhození vektorem (a odkazem) ──
  await run('nový díl Forma\nkvádr 40 40 20'); await idle();
  await p.getByRole('button', { name: 'Nástroje', exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Formařské/ }).click(); await p.waitForTimeout(700);
  const pull = p.locator('[data-mold-pull]');
  ok(await pull.isVisible(), 'karta Úkosy má pole „Směr vyhození“ (X / Y / Z, ±, vektor, odkaz)');
  const legend = async (label) => { const t = await p.locator('text=' + label).first().locator('xpath=..').innerText().catch(() => ''); const m = t.match(/([\d,]+) %/); return m ? parseFloat(m[1].replace(',', '.')) : NaN; };
  await pull.locator('[data-pull-dir="Z"]').click(); await p.waitForTimeout(800);
  const vertZ = await legend('Svislá stěna');
  ok(Math.abs(vertZ - 50) < 0.6, `směr Z: svislé stěny 50 % povrchu (${vertZ} %)`);
  const pin = pull.locator('input');
  await pin.nth(0).fill('1'); await pin.nth(0).press('Enter'); await p.waitForTimeout(200);
  await pin.nth(2).fill('0'); await pin.nth(2).press('Enter'); await p.waitForTimeout(900);
  const vertX = await legend('Svislá stěna');
  ok(Math.abs(vertX - 75) < 0.6, `typovaný vektor 1; 0; 0: svislé stěny 75 % povrchu (${vertX} %)`);
  await pin.nth(2).fill('1'); await pin.nth(2).press('Enter'); await p.waitForTimeout(900);
  // šikmo 1; 0; 1: svislé zůstanou jen stěny ±Y (25 %), horní a přední +X mají úkos 45° (37,5 %)
  const vertXZ = await legend('Svislá stěna');
  const okXZ = await legend('Dostatečný úkos');
  ok(Math.abs(vertXZ - 25) < 0.6 && Math.abs(okXZ - 37.5) < 0.6, `šikmý vektor 1; 0; 1: svislé jen stěny ±Y (${vertXZ} %), dostatečný úkos horní a +X (${okXZ} %)`);
  await pull.locator('[data-dir-byref]').click(); await p.waitForTimeout(400);
  await pull.getByRole('button', { name: /Vyberte/ }).first().click(); await p.waitForTimeout(400);
  const top = await pickHint('face', (t) => /normála \+?Z\b/.test(t) && !/−Z|-Z/.test(t));
  await p.waitForTimeout(1200);
  const resolved = await pull.locator('[data-dir-resolved]').innerText().catch(() => '');
  const vertRef = await legend('Svislá stěna');
  ok(!!top && /Směr: 0; 0; 1/.test(resolved) && Math.abs(vertRef - 50) < 0.6, `směr odkazem na normálu horní plochy (${top && top.title}) → ${resolved}, svislé stěny ${vertRef} %`);
  await p.screenshot({ path: S + 'ext-forms-mold.png' });
  // vyhazovače a chlazení používají stejný směr – karta Vyhazovače ukáže totéž pole
  await p.getByRole('button', { name: 'Vyhazovače', exact: true }).click(); await p.waitForTimeout(400);
  ok(await p.locator('[data-mold-eject-dir] [data-dir-field]').isVisible(), 'karta Vyhazovače: směr otevírání formy stejným polem');
  await p.getByRole('button', { name: 'Chlazení', exact: true }).click(); await p.waitForTimeout(400);
  ok(await p.locator('[data-mold-cool-dir] [data-dir-field]').isVisible(), 'karta Chlazení: směr otevírání formy stejným polem');
  // obecný vektor zadaný po složkách (2; 1; 0 od Z): pole ukazuje zadání a díry vyhazovačů mají směr (0,894; 0,447; 0)
  await p.getByRole('button', { name: 'Vyhazovače', exact: true }).click(); await p.waitForTimeout(400);
  const ej = p.locator('[data-mold-eject-dir]');
  const toVector = ej.getByRole('button', { name: 'Zadat čísly (vektor)' });
  if (await toVector.isVisible().catch(() => false)) { await toVector.click(); await p.waitForTimeout(300); }
  await ej.locator('[data-pull-dir="Z"]').click(); await p.waitForTimeout(500);
  const ein = ej.locator('input');
  for (const [i, v] of [[0, '2'], [1, '1'], [2, '0']]) { await ein.nth(i).fill(v); await ein.nth(i).press('Enter'); await p.waitForTimeout(600); }
  const shown = [await ein.nth(0).inputValue(), await ein.nth(1).inputValue(), await ein.nth(2).inputValue()].map((x) => parseFloat(x.replace(',', '.')));
  ok(shown[0] === 2 && shown[1] === 1 && shown[2] === 0, 'vektor 2; 1; 0 zadaný po složkách zůstane v poli, jak byl zadán: ' + shown.join('; '));
  const nHoles = (await doc()).features.length;
  await p.getByRole('button', { name: 'Díry do dílu' }).click(); await p.waitForTimeout(800); await idle();
  const holes = (await doc()).features.slice(nHoles).filter((f) => f.type === 'hole');
  const hv = holes[0] && holes[0].dirDef && holes[0].dirDef.v;
  const want = [2 / Math.sqrt(5), 1 / Math.sqrt(5), 0];
  ok(holes.length > 0 && !!hv && hv.every((c, k) => Math.abs(c - want[k]) < 1e-4), `díry vyhazovačů ve směru (0,894; 0,447; 0): ${holes.length} děr, směr ${JSON.stringify(hv)}`);

  ok(errs.length === 0, 'žádná chyba stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + e.message.split('\n')[0]); process.exit(1); });
