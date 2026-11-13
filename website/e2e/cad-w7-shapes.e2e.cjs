// E2E 7. vlna – tvary: zaoblení se setbackem, eliptické / kuželosečkové zaoblení, úkos s dělicí křivkou a stupňovitý úkos.
// Ručně (pás karet → formulář → OK) i textem (window.mncad.run: CS / EN / DE, obecný příkaz „prvek“, stav).
// Spuštění (server na E2E_BASE, výchozí :3333): node e2e/cad-w7-shapes.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w7-shapes').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3333').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

const k = Math.tan((3 * Math.PI) / 180);
/** sloupec 30 × 40 nad / pod dělicí čarou: zkosené jsou přední, zadní a čelní stěna (průřez (30 − k·t)(40 − 2k·t)) */
const col = (H) => 1200 * H - 50 * k * H * H + (2 / 3) * k * k * H ** 3;
const STEP_VOL = (2 * (col(20) + col(10))) / 1000; // cm³
const CONIC_VOL = 48 - (4 * 2 * (1 - Math.PI / 4) * 60) / 1000; // jedna horní hrana 60 mm, D1 4 × D2 2

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const status = () => p.evaluate(() => window.mncad.status());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const last = async () => (await doc()).features.slice(-1)[0];
  const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();
  /** řádek prvku ve stavu (✓ / ⚠ / ✗) */
  const featLine = async (name) => (await status()).split('\n').find((l) => l.includes(` ${name} [`)) || '';
  /** výběr ploch / hran pravidlem v seznamu formuláře */
  const pickRule = async (kind, rule, count) => {
    await p.locator('[data-pick-list]').first().click(); await p.waitForTimeout(500);
    const list = p.locator(`[data-entity-pick="${kind}"]`);
    await list.locator('[data-entity-rule]').fill(rule); await list.locator('[data-entity-rule]').press('Enter'); await p.waitForTimeout(500);
    const txt = await list.innerText();
    ok(new RegExp(`Vybráno ${count} z`).test(txt), `pravidlo „${rule}“ vybere ${count} ${kind === 'faces' ? 'ploch' : 'hran'}`);
    await p.getByRole('button', { name: 'Hotovo', exact: true }).click(); await p.waitForTimeout(400);
  };
  const setNum = async (label, v) => { const f = p.getByLabel(label, { exact: true }).first(); await f.fill(String(v)); await f.press('Tab'); await p.waitForTimeout(250); };

  // ═════════════ ručně: zaoblení se setbackem ═════════════
  await run('nový díl Setback ručně\nkvádr 60 40 20'); await idle();
  await p.getByRole('button', { name: 'Zaoblení se setbackem', exact: true }).first().click(); await p.waitForTimeout(700);
  let f = await last();
  ok(f.type === 'fillet' && f.kind === 'setback' && /Zaoblení se setbackem 1/.test(f.name), `pás karet „Zaoblení se setbackem“ založí prvek druhu setback (${f.name})`);
  ok(await p.locator('[data-fillet-kinds] button', { hasText: 'Setback' }).isVisible(), 'formulář: přepínač druhů obsahuje Setback');
  ok(await p.locator('[data-fillet-kinds] button', { hasText: 'Eliptické / kuželosečkové' }).isVisible(), 'formulář: přepínač druhů obsahuje Eliptické / kuželosečkové');
  await setNum('Poloměr', 3);
  await setNum('Setback (od vrcholu podél hran)', 6);
  await p.getByRole('button', { name: 'Všechny', exact: true }).first().click(); await p.waitForTimeout(300);
  await p.screenshot({ path: S + 'shapes-setback-form.png' });
  await okBtn(); await idle(); await p.waitForTimeout(500);
  f = await last();
  const vSb = await vol();
  let line = await featLine(f.name);
  ok(f.radius === 3 && f.setback === 6 && f.edges === 'all' && /✓/.test(line) && !/[⚠✗]/.test(line), `setback R3 / 6 na všech hranách: ${line.trim()}`);
  ok(/R3, setback 6, hrany vše/.test(line), 'stav: souhrn „R3, setback 6, hrany vše“');
  await p.screenshot({ path: S + 'shapes-setback.png' });
  await run('nový díl Setback srovnání\nkvádr 60 40 20\nzaoblit 3'); await idle();
  const vDef = await vol();
  ok(vSb < vDef && vSb > vDef - (8 * 216) / 1000, `objem se setbackem ${vSb} cm³ < výchozí kulové rohy ${vDef} cm³ (rozdíl jen v rozích)`);

  // ═════════════ ručně: eliptické zaoblení ═════════════
  await run('nový díl Eliptické ručně\nkvádr 60 40 20'); await idle();
  await p.getByRole('button', { name: 'Eliptické zaoblení', exact: true }).first().click(); await p.waitForTimeout(700);
  f = await last();
  ok(f.kind === 'conic' && f.radius === 4 && f.r2 === 2, `pás karet „Eliptické zaoblení“: druh conic, D1 4, D2 2 (${JSON.stringify({ k: f.kind, r: f.radius, r2: f.r2 })})`);
  ok(await p.getByRole('button', { name: 'Prohodit D1 ↔ D2' }).isVisible() && await p.getByText('Kuželosečka (rho)').isVisible(), 'formulář: D1/D2, prohození a volba průřezu elipsa / kuželosečka');
  await pickRule('edges', 'horní -y', 1);
  await p.screenshot({ path: S + 'shapes-conic-form.png' });
  await okBtn(); await idle(); await p.waitForTimeout(500);
  const vC = await vol();
  line = await featLine((await last()).name);
  ok(Math.abs(vC - CONIC_VOL) < 0.006 && /✓/.test(line), `eliptické zaoblení horní přední hrany: ${vC} cm³ ≈ ${CONIC_VOL.toFixed(3)} (D1·D2·(1 − π/4)·60) – ${line.trim()}`);
  ok(/eliptické D1 4 × D2 2, hrany 1/.test(line), 'stav: souhrn „eliptické D1 4 × D2 2, hrany 1“');

  // ═════════════ ručně: úkos s dělicí křivkou, stupňovitý ═════════════
  await run('nový díl Úkos ručně\nkvádr 60 40 30\nskica XZ: čára 0 10 30 10 30 20 60 20'); await idle();
  await p.getByRole('button', { name: 'Úkos s dělicí křivkou', exact: true }).first().click(); await p.waitForTimeout(700);
  f = await last();
  const sk = (await doc()).features.find((x) => x.type === 'sketch');
  ok(f.type === 'draft' && f.partingSketchId === sk.id && f.pull && f.pull.axis === 'Z', `pás karet „Úkos s dělicí křivkou“: dělicí křivka = poslední skica, tah +Z (${f.name})`);
  ok(await p.getByRole('button', { name: 'Dělicí křivka', exact: true }).isVisible() && await p.getByText('Stupňovitý úkos (každý úsek od vlastní roviny, spojené stupni)').isVisible(), 'formulář: Neutrální prvek = Dělicí křivka, volba Stupňovitý');
  await pickRule('faces', 'boční', 4);
  await p.getByText('Stupňovitý úkos (každý úsek od vlastní roviny, spojené stupni)').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: S + 'shapes-draft-form.png' });
  await okBtn(); await idle(); await p.waitForTimeout(600);
  f = await last();
  const vD = await vol();
  line = await featLine(f.name);
  ok(f.step === true && f.faces.length === 4 && /✓/.test(line), `stupňovitý úkos 3° na 4 bočních plochách: ${line.trim()}`);
  ok(Math.abs(vD - STEP_VOL) < 0.01, `objem stupňovitého úkosu ${vD} cm³ ≈ analyticky ${STEP_VOL.toFixed(3)} cm³`);
  ok(/dělicí křivka „Skica 1“, stupňovitý/.test(line), 'stav: souhrn „dělicí křivka „Skica 1“, stupňovitý“');
  await p.screenshot({ path: S + 'shapes-step-draft.png' });

  // ═════════════ text: CS ═════════════
  let log = await run('nový díl Text CS\nkvádr 60 40 20\nzaoblit 3 setback 6'); await idle();
  line = await featLine('Zaoblení 1');
  ok(/✓/.test(line) && /setback 6/.test(line), `text „zaoblit 3 setback 6“: ${line.trim()}`);
  ok(Math.abs((await vol()) - vSb) < 0.002, 'text dá stejný objem jako formulář');
  log = await run('nový díl Text CS 2\nkvádr 60 40 20\nzaoblit eliptické 4 2 hrany horní -y'); await idle();
  ok(Math.abs((await vol()) - CONIC_VOL) < 0.006 && /1 hran podle pravidla/.test(log), `text „zaoblit eliptické 4 2 hrany horní -y“: ${(await vol())} cm³`);
  log = await run('nový díl Text CS 3\nkvádr 60 40 30\nskica XZ: čára 0 10 30 10 30 20 60 20\núkos 3 plochy boční dělicí "Skica 1" stupňovitý'); await idle();
  line = await featLine('Úkos 1');
  ok(Math.abs((await vol()) - STEP_VOL) < 0.01 && /✓/.test(line), `text „úkos 3 plochy boční dělicí "Skica 1" stupňovitý“: ${line.trim()}`);
  log = await run('nový díl Text CS 4\nkvádr 60 40 30\nskica XZ: čára 0 10 60 20\núkos 3 plochy boční dělicí'); await idle();
  line = await featLine('Úkos 1');
  ok(/✓/.test(line) && !/⚠/.test(line) && /dělicí křivka „Skica 1“/.test(line), `šikmá přímá dělicí čára (dělicí bez názvu = poslední skica): ${line.trim()}`);
  log = await run('nový díl Text CS 5\nkvádr 60 40 30\nskica XY odsazení 10: obdélník 60 40 roh 0 0\núkos 3 plochy boční dělicí "Skica 1"'); await idle();
  line = await featLine('Úkos 1');
  ok(/✓/.test(line) && (await status()).includes('X 0…60'), `rovinná dělicí křivka (skica XY ve výšce 10): díl zůstal v dělicí rovině 60 mm široký – ${line.trim()}`);

  // ═════════════ text: EN / DE / obecný příkaz ═════════════
  log = await run('nový díl Text EN\nkvádr 60 40 20\nfillet elliptical 4 2 edges top -y'); await idle();
  ok(Math.abs((await vol()) - CONIC_VOL) < 0.006, 'EN „fillet elliptical 4 2 edges top -y“');
  log = await run('nový díl Text DE\nkvádr 60 40 30\nskica XZ: čára 0 10 30 10 30 20 60 20\nschräge 3 flächen seite trennlinie "Skica 1" gestuft'); await idle();
  ok(Math.abs((await vol()) - STEP_VOL) < 0.01, 'DE „schräge 3 flächen seite trennlinie … gestuft“');
  log = await run('nový díl Text DE 2\nquader 60 40 20\nverrunden 3 rückversatz 6'); await idle();
  ok(Math.abs((await vol()) - vSb) < 0.002, 'DE „verrunden 3 rückversatz 6“');
  log = await run('nový díl Prvek\nkvádr 60 40 20\nprvek fillet kind=conic radius=4 r2=2 rho=0,5 edges=horní;-y'); await idle();
  const parab = 48 - (4 * 2 * 60) / 6 / 1000;
  ok(Math.abs((await vol()) - parab) < 0.006, `prvek fillet kind=conic rho=0,5 (parabola, odebráno D1·D2/6): ${await vol()} cm³`);
  log = await run('prvek fillet kind=setback radius=2 setback=4 setbacks=[{"at":{"kind":"vertex","index":0},"d":5}] edges=svislé'); await idle();
  line = await featLine('Zaoblení 2');
  ok(/⚠/.test(line) && /aspoň 3 hrany|nejsou vybrány všechny/.test(line), `setback bez rohu se 3 vybranými hranami → ⚠ s vysvětlením: ${line.trim().slice(0, 160)}`);

  // ═════════════ chyby ═════════════
  log = await run('úkos 3 plochy boční stupňovitý');
  ok(/stupňovitý úkos potřebuje dělicí křivku/.test(log), 'stupňovitý bez dělicí křivky → česká chyba');
  log = await run('zaoblit eliptické hrany horní');
  ok(/zaoblit eliptické D1 D2/.test(log), 'eliptické bez vzdáleností → nápověda se zápisem');
  log = await run('nový díl Chyba\nkvádr 60 40 30\nskica počátek 0 0 10 normála 0 1 1: úsečka 0 0 60 0\núkos 3 plochy boční dělicí "Skica 1"'); await idle();
  ok(/kolmá na směr tahu/.test(await featLine('Úkos 1')), 'šikmá rovina skici dělicí křivky → ✗ s vysvětlením');

  // nápověda příkazů
  const cmds = await p.evaluate(() => JSON.stringify(window.mncad.commands()));
  ok(/setback S/.test(cmds) && /eliptické D1 D2/.test(cmds) && /dělicí/.test(cmds), 'window.mncad.commands() obsahuje nové příkazy');
  const guide = await p.evaluate(() => window.mncad.guide());
  ok(/Zaoblení se setbackem, eliptické zaoblení a úkos s dělicí křivkou/.test(guide), 'návod pro AI obsahuje sekci tvarů');

  ok(errs.length === 0, 'žádné chyby stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL: výjimka ' + e.message); process.exit(1); });
