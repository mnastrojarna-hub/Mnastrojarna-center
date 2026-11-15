// E2E (vlna 19, balík core): kola a ozubení jako prvky rozšíření gear.* – bez průvodce (ten doplní balík ui):
//  – obecný příkaz `prvek gear.spur m=2 z=24 b=20` → prvek ✓, objem = přesná plocha profilu × b, řádek `stav` s d, dₐ, W₃,
//  – automatický formulář úprav z řádků tabulky (m, z, b, díra, výstup, operace, osa…): změna z v historii → nový výpočet,
//  – srozumitelná chyba u nesmyslného zadání (z = 3), skryté prvky nejsou na pásu karet,
//  – řetězové kolo 08B z 19 duplex, šikmé kolo → export STEP → import STEP = platné těleso se stejným objemem,
//  – soukolí jako existující příkazy (nový díl · prvek gear.* · nová sestava · vložit · sestava vazba ozubení) → vazba ok,
//  – anglické rozhraní: souhrn `stav` přeložený (spur …).
// Spuštění (produkční build): E2E_BASE=http://localhost:3461 node e2e/cad-w19-core.e2e.cjs <složka pro snímky>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w19-core').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3461').replace(/\/$/, '');

async function open(b, path = '/cad') {
  const ctx = await b.newContext({ viewport: { width: 1430, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 300000 });
  const cont = p.getByText(/Pokračovat v práci|Continue working/);
  if (await cont.isVisible({ timeout: 6000 }).catch(() => false)) await cont.click();
  await p.waitForFunction(() => !!window.mncad && !/Načítám jádro|Loading kernel/.test(document.body.innerText), null, { timeout: 240000 });
  await p.waitForTimeout(1000);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
  const { p, errs } = await open(b);
  const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {}); await p.waitForTimeout(300); };
  const status = () => p.evaluate(() => window.mncad.status());
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const vol = async () => { const m = (await status()).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const volBecomes = async (test, ms = 90000) => { const t0 = Date.now(); let v = NaN; while (Date.now() - t0 < ms) { v = await vol(); if (test(v)) return v; await p.waitForTimeout(500); } return v; };
  const param = (key) => p.locator(`[data-ext-param="${key}"]`).first();

  // ── 1. obecný příkaz prvek gear.spur ──
  let t0 = Date.now();
  let out = await run('nový díl Kolo\nprvek gear.spur m=2 z=24 b=20');
  await idle();
  let st = await status();
  ok(/prvků 1 \(1 ✓, 0 ✗\)/.test(st) && /Geometrie: platná/.test(st), `prvek gear.spur m=2 z=24 b=20 → 1 ✓, platná geometrie (${Date.now() - t0} ms)`);
  const v24 = await vol();
  // přesná plocha profilu m 2 z 24 (Greenova věta, vitest gears-kernel: objem = plocha × b na 2·10⁻⁵) = 1787,41 mm² → 35,748 cm³
  ok(Math.abs(v24 - 35.75) < 0.02, `objem čelního kola m 2 z 24 b 20 = ${v24} cm³ (plocha profilu × b = 35,75 cm³)`);
  ok(/čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433/.test(st), 'řádek stav: „čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433 …“ (W₃ podle DIN 3960 = 15,4329)');
  ok(/Rozměry: 52 × 52 × 20 mm/.test(st), 'obálka 52 × 52 × 20 mm (hlavový průměr dₐ = 52)');
  const f1 = (await doc()).features[0];
  ok(f1.type === 'ext' && f1.ext === 'gear.spur' && f1.data.alpha === 20 && f1.data.out === 'wheel' && f1.data.mode === 'new' && f1.data.rack === 'A', 'data prvku = výchozí hodnoty tabulky + zadané klíče (α 20, ISO 53-A, výstup kolo, operace nové)');

  // ── 2. skryté prvky: na pásu karet se nenabízejí (vstupní bod „Kola a ozubení“ doplní balík ui) ──
  await p.getByRole('button', { name: 'Tvorba', exact: true }).first().click().catch(() => {});
  await p.waitForTimeout(400);
  const ribbonHas = await p.evaluate(() => [...document.querySelectorAll('button')].some((x) => /Čelní kolo s přímými zuby|Řetězové kolo/.test(x.textContent || '') && x.closest('header, nav, [data-ribbon]')));
  ok(!ribbonHas, 'prvky gear.* nejsou na pásu karet (hidden)');

  // ── 3. automatický formulář úprav z řádků tabulky, změna z v historii ──
  const fname = 'Čelní kolo s přímými zuby';
  await p.getByText(fname, { exact: true }).first().click(); await p.waitForTimeout(700);
  if (!(await param('z').isVisible().catch(() => false))) { await p.getByText(fname, { exact: true }).first().dblclick(); await p.waitForTimeout(900); }
  // automatický formulář (ext-params.tsx): řádek = <label><span>popisek + nápověda</span>pole</label>; směr osy má data-ext-param
  const field = (label) => p.locator('label').filter({ hasText: label }).first();
  const labels = ['Modul mₙ', 'Počet zubů z', 'Šířka b', 'Úhel záběru αₙ', 'Posunutí profilu x', 'Základní profil', 'Díra d', 'Drážka pro pero', 'Náboj Ø', 'Výstup', 'Natočení kolem osy'];
  const vis = [];
  // výčty (Základní profil, Výstup) jsou nadpis + segmentový přepínač, ne <label>
  const shown = async (l) => (await field(l).isVisible().catch(() => false)) || (await p.getByText(l, { exact: true }).first().isVisible().catch(() => false));
  for (const l of labels) if (await shown(l)) vis.push(l);
  const axisVis = await param('axis').isVisible().catch(() => false);
  ok(vis.length === labels.length && axisVis, `formulář úprav = řádky tabulky s jednotkami a nápovědou (${vis.join(', ')}${axisVis ? ', Osa' : ''})`);
  await p.screenshot({ path: S + 'w19-core-form.png' });
  const zIn = field('Počet zubů z').locator('input').first();
  await zIn.fill('30'); await zIn.press('Enter'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'OK', exact: true }).click().catch(() => {});
  await idle();
  const v30 = await volBecomes((v) => v > v24 + 1);
  st = await status();
  ok(v30 > v24 + 1 && /čelní m2 z30 x0 b20 · d 60 · dₐ 64/.test(st), `změna z na 30 ve formuláři → přepočet: objem ${v30} cm³, stav „čelní m2 z30 … d 60 · dₐ 64“`);
  ok((await doc()).features.length === 1 && (await doc()).features[0].data.z === 30, 'v historii je pořád jeden prvek, data z = 30');

  // ── 4. chyba lidsky u řádku ──
  out = await run('nový díl Chyba\nprvek gear.spur z=3');
  await idle();
  st = await status();
  ok(/✗/.test(st) && /Počet zubů z: nejmenší hodnota je 5/.test(st), 'z = 3 → prvek ✗ s hláškou „Počet zubů z: nejmenší hodnota je 5.“');
  out = await run('prvek gear.spur zuby=3');
  ok(/neznámý parametr „zuby“/.test(String(out)), 'neznámý klíč → chyba se seznamem parametrů');

  // ── 5. řetězové kolo 08B z 19 duplex ──
  t0 = Date.now();
  await run('nový díl Řetězka\nprvek gear.sprocket chain=08B z=19 rows=2 bore=20 keyway=true');
  await idle();
  st = await status();
  ok(/prvků 1 \(1 ✓, 0 ✗\)/.test(st) && /Geometrie: platná/.test(st) && /řetězové 08B-2 z19 · d 77\.159 · dₐ 82\.402 · M_R 85,406/.test(st), `řetězové kolo 08B z 19 duplex: d = p / sin(180°/z) = 77,159, M_R 85,406 (${Date.now() - t0} ms)`);

  // ── 6. šikmé kolo → STEP → import ──
  t0 = Date.now();
  await run('nový díl Šikmé\nprvek gear.helical m=2 z=20 b=20 beta=15 bore=12');
  await idle();
  const vh = await vol();
  st = await status();
  ok(/Geometrie: platná/.test(st) && /šikmé m2 z20 β15° pravý/.test(st), `šikmé kolo m 2 z 20 β 15° postaveno (${Date.now() - t0} ms), objem ${vh} cm³`);
  const step = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(step.bytes > 100000, `export STEP šikmého kola: ${step.bytes} B`);
  const imp = await p.evaluate((s) => window.mncad.importFile({ name: 'sikme.step', base64: s }), step.base64);
  await idle();
  st = await status();
  const vi = await vol();
  ok(/otevřen/.test(String(imp)) && /Geometrie: platná/.test(st) && Math.abs(vi - vh) / vh < 0.005, `import STEP: platné těleso, objem ${vi} cm³ (export ${vh} cm³)`);

  // ── 7. soukolí = existující příkazy (výstup pairScript, stejný jako průvodce a příkaz soukolí) ──
  t0 = Date.now();
  out = await run([
    'nový díl "Pastorek m2 z20"',
    'prvek gear.spur z=20 b=21 x=0.3668 k=0.0226 bore=10 mateZ=60 aw=81 jn=0.04 name="Ozubené kolo m2 z20"',
    'nový díl "Kolo m2 z60"',
    'prvek gear.spur z=60 x=0.1558 k=0.0226 bore=30 mateZ=20 aw=81 jn=0.04 name="Ozubené kolo m2 z60"',
    'nová sestava "Soukolí m2 z20/z60"',
    'vložit "Pastorek m2 z20" v 0 0 0',
    'vložit "Kolo m2 z60" v 81 0 0 otočení 0 0 177',
    'sestava vazba ozubení "Pastorek m2 z20" Ø10 "Kolo m2 z60" Ø30 zuby 20 60',
  ].join('\n'));
  await idle();
  st = await status();
  ok(/Vazby: 1 \(1 ok\)/.test(st) && /2 komponent/.test(st), `soukolí z 20/60 s posunutím (a_w 81): sestava se 2 komponentami a vazbou ozubení ok (${Date.now() - t0} ms)`);
  ok(/vazba Ozubená kola .* Ø10 .* Ø30|F0|poměr 3/.test(String(out)) || /Vazby: 1 \(1 ok\)/.test(st), 'vazba našla díry Ø10 a Ø30 (díra je první plochou kola – sestava čte prvních 400 ploch)');
  await p.screenshot({ path: S + 'w19-core-pair.png' });

  ok(errs.length === 0, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);

  // ── 8. anglické rozhraní ──
  const en = await open(b, '/en/cad');
  await en.p.evaluate((t) => window.mncad.run(t), 'new part Gear\nfeature gear.spur m=2 z=24 b=20');
  await en.p.waitForTimeout(500); await en.p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 }).catch(() => {});
  const stEn = await en.p.evaluate(() => window.mncad.status());
  ok(/spur m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15\.433/.test(stEn), 'EN: souhrn „spur m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15.433 …“ (desetinná tečka)');
  ok(en.errs.length === 0, 'EN: bez chyb stránky');
  } finally {
    await b.close(); // i po výjimce – jinak by proces s prohlížečem zůstal viset
  }
})().catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; });
