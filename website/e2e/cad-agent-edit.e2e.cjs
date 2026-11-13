// E2E: úpravy existujícího modelu textem (balík „edit“) přes window.mncad – bez nové záložky, s historií Zpět:
//  1. příruba textem → upravit "Díra 1" diameter=20 změní objem i stav; protokol „✓ Díra 1: diameter 18 → 20“ + ✓ prvku a pole
//  2. zpět / znovu (text i window.mncad.undo / redo / history) vrátí a obnoví objem
//  3. potlačit + zapnout, přejmenovat, duplikovat, smazat <prvek> (závislé prvky v protokolu) a zpět
//  4. proměnná t = 18 + upravit "Vysunutí 1" distance==t + proměnná t = 25 + konfigurace „Nízká“ t=10 přepne výšku, řádky stavu
//  5. přesunout skicu za vysunutí → ✗ s důvodem, pořadí beze změny; přesunout díru o krok výš
//  6. skica "Skica 1" + entita e1 průměr=170 (úprava existující skici), kóta k1 / smazat v1 ve skici s vazbami
//  7. setDocument(doc, { inPlace: true }) nahradí dokument bez nové záložky, zpět ho vrátí; setDocument(doc) otevře záložku
// Spuštění: E2E_BASE=http://localhost:3100 node e2e/cad-agent-edit.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const vol = (log) => { const m = (log.match(/objem ([\d\s  ,]+) cm³/g) || []).pop(); return m ? parseFloat(m.replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
/** výška podle řádku Rozměry: „Z 0…18“ */
const zMax = (log) => { const m = (log.match(/Z (-?[\d,]+)…(-?[\d,]+)\)/g) || []).pop(); return m ? parseFloat(m.split('…')[1].replace(',', '.')) : NaN; };
const xSize = (log) => { const m = (log.match(/Rozměry: ([\d,]+) ×/g) || []).pop(); return m ? parseFloat(m.replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
const bad = (log) => log.split('\n').filter((l) => /^(✗|⚠)/.test(l.trim()));
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

const FLANGE = `nový díl Příruba edit
skica XY: kružnice 165
vysunout 18
díra 18 skrz v 62,5 0
pole kruhové 4`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const reactWarn = []; p.on('console', (m) => { if (/flushSync|Cannot update a component/.test(m.text())) reactWarn.push(m.text().slice(0, 160)); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 });
  const run = async (text) => { const r = await p.evaluate((t) => window.mncad.run(t), text); await idle(); return r; };
  const status = () => p.evaluate(() => window.mncad.status());
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const hist = () => p.evaluate(() => window.mncad.history());
  const tabs = () => p.locator('[role=tab]').count();
  const F = async (name) => (await doc()).features.find((f) => f.name === name);

  // ── 1. příruba textem, upravit průměr díry ──
  let log = await run(FLANGE);
  ok(bad(log).length === 0, 'příruba: žádný řádek ✗ / ⚠ ' + bad(log).join(' | '));
  const v0 = vol(log);
  ok(v0 > 300, `příruba: objem ${v0} cm³`);
  const tabs0 = await tabs();
  const h0 = await hist();
  log = await run('upravit "Díra 1" diameter=20');
  const v1 = vol(log);
  ok(/✓ Díra 1: diameter 18 → 20/.test(log), 'protokol úpravy: ' + line(log, /Díra 1: diameter/));
  ok(/^✓ Díra 1 \(hole\)/m.test(log) && /^✓ Pole 1 \(pattern\)/m.test(log), 'po výpočtu ✓ upraveného prvku i závislého pole');
  ok(v1 < v0 - 0.3, `objem po zvětšení děr klesl: ${v0} → ${v1} cm³ (4 × π(10²−9²) × 18 ≈ 4,3 cm³)`);
  ok(/Ø20 skrz/.test(log), 'stav ukazuje Ø20: ' + line(log, /Díra 1 \[hole/));
  ok((await F('Díra 1')).diameter === 20, 'dokument: diameter = 20');
  ok((await tabs()) === tabs0, `úprava na místě – bez nové záložky (${tabs0} → ${await tabs()})`);
  const h1 = await hist();
  ok(h1.undo === h0.undo + 1 && h1.redo === 0, `jeden běh = jeden krok historie (${JSON.stringify(h0)} → ${JSON.stringify(h1)})`);

  // ── 2. zpět / znovu ──
  log = await run('zpět');
  ok(/✓ zpět o 1 krok\(ů\) \(zbývá zpět \d+, znovu 1\)/.test(log), 'zpět: ' + line(log, /zpět o/));
  ok(near(vol(log), v0), `zpět vrátil objem ${vol(log)} = ${v0}`);
  ok((await F('Díra 1')).diameter === 18, 'zpět: diameter = 18');
  log = await run('znovu');
  ok(near(vol(log), v1) && (await F('Díra 1')).diameter === 20, `znovu obnovil objem ${vol(log)} = ${v1}`);
  log = await p.evaluate(() => window.mncad.undo(1)); await idle();
  ok(near(vol(log), v0), `window.mncad.undo(1): objem ${vol(log)}`);
  ok((await hist()).redo === 1, 'history().redo = 1 po undo');
  log = await p.evaluate(() => window.mncad.redo()); await idle();
  ok(near(vol(log), v1), `window.mncad.redo(): objem ${vol(log)}`);
  log = await run('znovu 3');
  ok(/^✗ znovu: není co obnovit/m.test(log), 'znovu bez vráceného kroku → ✗: ' + line(log, /znovu:/));

  // ── 3. potlačit / zapnout, přejmenovat, duplikovat, smazat ──
  log = await run('potlačit "Díra 1"');
  ok(/✓ potlačeno: Díra 1/.test(log) && vol(log) > v1 + 3, `potlačit: díry zmizely, objem ${vol(log)}`);
  ok(/Díra 1 \[hole, id \w+\] .*\(potlačen\)/.test(log), 'stav: (potlačen)');
  log = await run('zapnout "Díra 1"');
  ok(/✓ zapnuto: Díra 1/.test(log) && near(vol(log), v1), `zapnout: objem ${vol(log)} = ${v1}`);
  log = await run('přejmenovat "Díra 1" na "Díra šroubu"');
  ok(/✓ přejmenováno: Díra 1 → Díra šroubu/.test(log) && !!(await F('Díra šroubu')), 'přejmenovat');
  log = await run('duplikovat "Pole 1" jako "Pole 2"\nupravit "Pole 2" count=8');
  ok(/✓ Pole 1 duplikován jako „Pole 2“/.test(log) && /✓ Pole 2: count 4 → 8/.test(log), 'duplikovat + upravit kopii');
  ok(/^✓ Pole 2 \(pattern\)/m.test(log), 'kopie pole se postavila: ' + line(log, /Pole 2 \(pattern\)/));
  log = await run('smazat "Pole 2"\nsmazat "Díra šroubu"');
  ok(/✓ smazáno: Díra šroubu/.test(log) && /⚠ na smazané odkazují: Pole 1 \(featureId\)/.test(log), 'smazat díru: protokol vypíše závislé pole: ' + line(log, /odkazují/));
  ok(/^✗ Pole 1/m.test(log), 'po výpočtu ✗ pole bez zdroje: ' + line(log, /^✗ Pole 1/));
  log = await run('zpět');
  const names = (await doc()).features.map((f) => f.name).join(', ');
  ok(names === 'Skica 1, Vysunutí 1, Díra šroubu, Pole 1, Pole 2', 'zpět vrátil smazané prvky (celý běh = 1 krok): ' + names);
  log = await run('smazat "Pole 2"\npřejmenovat "Díra šroubu" na "Díra 1"');
  ok(near(vol(log), v1), `zpět na příruby s Ø20: objem ${vol(log)}`);

  // ── 4. proměnná, vazba parametru, konfigurace ──
  log = await run('proměnná t = 18\nupravit "Vysunutí 1" distance==t');
  ok(/✓ proměnná t = 18 → 18/.test(log) && /✓ Vysunutí 1: distance = t \(= 18\) – vazba na proměnné/.test(log), 'proměnná + vazba: ' + line(log, /Vysunutí 1: distance/));
  ok(/Vazby parametrů: Vysunutí 1\.distance = t \(= 18\)/.test(log), 'stav: řádek Vazby parametrů');
  log = await run('proměnná t = 25');
  ok(near(zMax(log), 25), `proměnná t = 25 → výška ${zMax(log)}`);
  ok(/vazby: Vysunutí 1\.distance/.test(log), 'protokol proměnné vypíše vázané parametry');
  log = await run('konfigurace "Nízká" t=10 potlačit "Pole 1"\nkonfigurace aktivní "Nízká"');
  ok(/✓ konfigurace „Nízká“ založena: t = 10; potlačeno: Pole 1/.test(log), 'konfigurace založena: ' + line(log, /konfigurace „Nízká“/));
  ok(near(zMax(log), 10), `aktivní konfigurace Nízká → výška ${zMax(log)}`);
  ok(/Konfigurace: Nízká \(aktivní\)/.test(log) && /Vysunutí 1\.distance = t \(= 10\)/.test(log), 'stav: Konfigurace: Nízká (aktivní), vazba = 10');
  log = await run('konfigurace aktivní žádná');
  ok(near(zMax(log), 25), `konfigurace žádná → výška ${zMax(log)}`);
  log = await run('proměnné\nproměnná x = y*2');
  ok(/Proměnné \(1\): t = 25 → 25/.test(log), 'výpis proměnných');
  ok(/✗ řádek 2: proměnná x = y\*2: Neznámá proměnná „y“/.test(log), 'chybná proměnná se nezapíše: ' + line(log, /řádek 2/));
  log = await run('upravit "Vysunutí 1" distance=18');
  ok(/vazba distance = t zrušena/.test(log) && near(zMax(log), 18), `číslo zruší vazbu, výška ${zMax(log)}`);

  // ── 5. přesunout ──
  log = await run('přesunout "Skica 1" za "Vysunutí 1"');
  ok(/✗ řádek 1: přesunout „Skica 1“ na pozici 2 nelze: „Vysunutí 1“ používá „Skica 1“ \(sketchId\)/.test(log), 'přesunout skicu za vysunutí → ✗ s důvodem');
  ok((await doc()).features[0].name === 'Skica 1', 'pořadí beze změny');
  log = await run('přesunout "Pole 1" nahoru');
  ok(/✗ řádek 1: přesunout „Pole 1“ na pozici 3 nelze: „Pole 1“ používá „Díra 1“ \(featureId\)/.test(log), 'pole nad díru nelze: ' + line(log, /řádek 1/));

  // ── 6. existující skica: entita, vazby a kóty s čísly ──
  log = await run('skica "Skica 1"\nentita e1 průměr=170');
  ok(/✓ skica „Skica 1“ je cílem dalších řádků/.test(log) && /✓ entita e1 ve skice „Skica 1“: r 82,5 → 85 = e1 kružnice Ø170/.test(log), 'entita e1 průměr=170: ' + line(log, /entita e1/));
  ok(near(xSize(log), 170, 0.05), `těleso má průměr ${xSize(log)} mm`);
  log = await run('skica XY odsazení 18: úsečka 0 0 30 0; úsečka 30 0 30 20\nvazba kolmo e1 e2; vodorovně e1\nkóta délka e1 30; délka e2 20\nstav');
  ok(/vazby: v1 kolmo e1 e2 · v2 vodorovně e1/.test(log) && /kóty: k1 délka e1 = 30 · k2 délka e2 = 20/.test(log), 'stav skici: vazby a kóty s čísly v1, k1');
  log = await run('kóta k1 45\nsmazat v1');
  ok(/✓ kóta k1 ve skice „Skica 2“: délka e1 30 → délka e1 45/.test(log) && /✓ ze skici „Skica 2“ smazáno: v1 kolmo e1 e2/.test(log), 'kóta k1 45, smazat v1 (poslední skica): ' + line(log, /kóta k1/));
  const sk2 = (await doc()).features.find((f) => f.name === 'Skica 2');
  ok(sk2.constraints.length === 1 && Math.abs(sk2.entities[0].b[0] - sk2.entities[0].a[0] - 45) < 1e-3, 'skica 2: 1 vazba, úsečka 45 mm');
  // promítnout hrany modelu (horní plocha příruby v rovině z = 18) a odsadit entitu – jádro skutečné
  log = await run('skica XY odsazení 18\npromítnout hrany pomocné\nodsadit e1 3 vlevo');
  const nProj = Number((log.match(/✓ do skici „Skica 3“ promítnuto \(hrany v rovině skici\): (\d+) úseček/) || [])[1] || 0);
  ok(nProj >= 20, `promítnout hrany: ${nProj} úseček z kružnic horní plochy (Ø170 + 4 × Ø20) – ` + line(log, /promítnuto/));
  ok(/✓ ve skice „Skica 3“ odsazeno o 3 mm vlevo: e1 → nové entity e\d+/.test(log), 'odsadit e1 3 vlevo: ' + line(log, /odsazeno/));
  const sk3 = (await doc()).features.find((f) => f.name === 'Skica 3');
  ok(sk3 && sk3.entities.length === nProj + 1 && sk3.entities.slice(0, nProj).every((e) => e.construction), `skica 3: ${sk3 && sk3.entities.length} entit, promítnuté jako pomocné`);
  await run('smazat "Skica 2" "Skica 3"');

  // ── 7. setDocument inPlace ──
  const d = await doc();
  d.name = 'Příruba v2';
  d.features = d.features.filter((f) => f.type !== 'pattern');
  const hb = await hist();
  log = await p.evaluate((x) => window.mncad.setDocument(x, { inPlace: true }), d); await idle();
  ok(/✓ dokument „Příruba v2“ \(3 prvků\) nahradil otevřený dokument/.test(log), 'setDocument inPlace: ' + line(log, /dokument „Příruba v2“/));
  ok((await tabs()) === tabs0, `setDocument inPlace nepřidal záložku (${await tabs()})`);
  const ha = await hist();
  ok(ha.undo === hb.undo + 1, `setDocument inPlace = jeden krok historie (${hb.undo} → ${ha.undo})`);
  ok((await doc()).name === 'Příruba v2' && (await doc()).features.length === 3, 'otevřený dokument je nahrazený');
  log = await run('zpět');
  ok((await doc()).name === 'Příruba edit' && (await doc()).features.length === 4, 'zpět vrátil původní dokument ve stejné záložce');
  log = await p.evaluate((x) => window.mncad.setDocument(x), d); await idle();
  ok((await tabs()) === tabs0 + 1, `setDocument bez inPlace otevře novou záložku (${tabs0} → ${await tabs()})`);

  // ── konzole (UI): stejný příkaz v protokolu ──
  await p.evaluate(() => window.mncad.openConsole()); await p.waitForTimeout(500);
  const ta = p.getByLabel('Textové příkazy nebo JSON', { exact: true });
  await ta.fill('upravit "Díra 1" depth=5');
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction(() => /Díra 1: depth/.test(document.querySelector('[data-agent-output]')?.textContent || ''), null, { timeout: 120000 });
  const out = await p.locator('[data-agent-output]').innerText();
  ok(/✓ Díra 1: depth 0 → 5/.test(out), 'konzole: protokol úpravy');
  await ta.fill('zpět');
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction(() => /zpět o 1 krok/.test(document.querySelector('[data-agent-output]')?.textContent || ''), null, { timeout: 120000 });
  ok((await F('Díra 1')).depth === 0, 'konzole: zpět vrátil hloubku díry (krok historie z tlačítka Provést)');
  ok(reactWarn.length === 0, 'bez varování Reactu o flushSync / aktualizaci při vykreslení ' + reactWarn.join(' | '));
  await p.screenshot({ path: S + 'agent-edit.png' });

  ok(errs.length === 0, 'bez chyb stránky ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.log('FAIL: ' + e.message); process.exit(1); });
