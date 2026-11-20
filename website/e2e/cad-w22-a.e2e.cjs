// E2E (vlna 22, balík A, etapa A1 – bod 1 zprávy majitele) na produkčním sestavení: zastaralý výsledek se nikdy neukáže jako platný.
//  1) dvě sestavy ve dvou záložkách: Kolize na A → panel ok s hlavičkou (dokument · komponenty · čas · r·rev · poloha);
//     přepnutí na B → žádné data-clash-state=ok, žádné „Bez kolizí ✓“ („Nezkontrolováno“ + tlačítko), kontrola B → její výsledek
//  2) změna modelu na A: poloha komponenty přepsaná ve formuláři → „Neplatí – sestava se od kontroly změnila“ + „Zkontrolovat znovu“;
//     textový stav hlásí NEPLATÍ; nová kontrola → platný výsledek; krok zpět → zase neplatí
//  3) přepnutí záložky, když kontrola běží: výsledek sestavy C se nad B neukáže (ani v panelu, ani zeleným oznámením)
//  4) stav vazeb: zelená sestavy M se nepřenese na sestavu N se stejnými id vazeb (a naopak); krok zpět = stav pro vrácený dokument
//  5) mapa porovnání s referencí (window.mncad.compare show) nepřežije přepnutí záložky ani změnu modelu
//  6) měření v panelu: po změně modelu „Neplatí“ + „Změřit znovu“
//  7) poloha mechanismu: zobrazený krok pohybové studie ≠ zkontrolovaná poloha → „neplatí“; kontrola v kroku uvádí polohu „krok studie“
//  8) změna konfigurace dílu v sestavě (bez posunu komponent) → „neplatí“
//  9) anglické rozhraní: tytéž stavy panelu
// 10) totéž (1–2) v náhledu bez WebGL (majitel testoval bez WebGL)
// Spuštění: E2E_BASE=http://localhost:3531 node e2e/cad-w22-a.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const S = (process.argv[2] || '/tmp/e2e-w22-a').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3531').replace(/\/$/, '');
const WEB = path.resolve(__dirname, '..');

const PARTS = 'nový díl "Deska A"\nkvádr 60 40 10\nnový díl "Přidržovač"\nkvádr 10 10 10\n';
const SETUP = PARTS + [
  'nová sestava "Sestava A"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 40 10 30',
  'nová sestava "Sestava B"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 40 10 5', 'vložit "Přidržovač" v 0 0 5',
  'nová sestava "Sestava C"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 40 10 30',
].join('\n');

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};

/** jeden průchod kroky 1–2 (panel Kolize) – s WebGL i bez něj */
async function clashFlow(p, tag) {
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  const status = () => p.evaluate(() => window.mncad.status());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const tab = async (name) => {
    await p.getByRole('tab').filter({ hasText: name }).locator('button').first().click();
    await p.waitForFunction((n) => document.querySelector('[role=tab][aria-selected=true] input')?.value === n, name, { timeout: 15000 });
    await p.waitForTimeout(400);
  };
  const panel = () => p.evaluate(() => {
    const el = document.querySelector('[data-clash-panel]');
    return el ? { state: el.getAttribute('data-clash-state'), doc: el.getAttribute('data-clash-doc'), name: el.getAttribute('data-clash-name'), rev: el.getAttribute('data-clash-rev'), pose: el.getAttribute('data-clash-pose'), text: el.parentElement.parentElement.innerText } : null;
  });
  const waitState = (st) => p.waitForFunction((s) => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state') === s, st, { timeout: 60000 }).then(() => true, () => false);
  const kolize = async () => {
    await p.getByRole('button', { name: 'Sestava', exact: true }).first().click().catch(() => {});
    await p.getByRole('button', { name: 'Kolize', exact: true }).first().click();
  };

  const log = await run(SETUP);
  ok(!/^✗/m.test(log), `[${tag}] sestavy A, B, C založeny textem bez chyby`);
  await idle();
  await p.waitForTimeout(1500);

  // ── 1. kontrola na A → zelený výsledek jen s hlavičkou, pro co platí ──
  await tab('Sestava A');
  await kolize();
  ok(await waitState('ok'), `[${tag}] Kolize na sestavě A: panel ve stavu ok`);
  const a = await panel();
  ok(a && /Bez průniku · vůle nekontrolována/.test(a.text) && !/✓/.test(a.text.split('\n')[0]) && a.name === 'Sestava A', `[${tag}] A: titulek „Bez průniku · vůle nekontrolována“ (vlna 22 C2, dřív „Bez kolizí ✓“) patří sestavě A (${a && a.name})`);
  ok(a && /„Sestava A“ · 2 komponent · [^·]+ · r·[0-9a-f]{6} · poloha z dokumentu/.test(a.text), `[${tag}] A: hlavička výsledku = dokument · komponenty · čas · revize · poloha\n   ${a && a.text.split('\n').find((l) => l.includes('zkontrolováno'))}`);
  ok(a && /^r·[0-9a-f]{6}$/.test(a.rev) && a.pose === 'doc' && !!a.doc, `[${tag}] A: data-clash-rev / pose / doc vyplněné (${a && [a.rev, a.pose].join(', ')})`);
  await p.screenshot({ path: `${S}w22a-${tag}-1-A-ok.png` });

  // ── přepnutí na B (3 komponenty, přidržovač zasahuje do desky): žádné zelené potvrzení ──
  await tab('Sestava B');
  const b0 = await panel();
  ok(b0 && b0.state === 'unchecked', `[${tag}] po přepnutí na B je panel „nezkontrolováno“ (stav ${b0 && b0.state})`);
  ok((await p.locator('[data-clash-state="ok"]').count()) === 0, `[${tag}] B: žádný prvek s data-clash-state=ok`);
  ok(b0 && !/Bez kolizí|Bez průniku|✓/.test(b0.text) && /Nezkontrolováno – pro tuto sestavu kontrola kolizí neproběhla/.test(b0.text), `[${tag}] B: text „Nezkontrolováno…“, žádné „Bez kolizí ✓“\n   ${b0 && b0.text.replace(/\n/g, ' | ')}`);
  ok(b0 && b0.doc !== a.doc && b0.name === 'Sestava B' && b0.rev === '', `[${tag}] B: panel patří dokumentu B (jiný klíč), bez revize výsledku`);
  ok(!/2 komponent/.test(b0.text), `[${tag}] B: počet komponent z kontroly A (2) se nad B neukazuje`);
  ok(/Kolize: nezkontrolováno/.test(await status()), `[${tag}] B: textový stav „Kolize: nezkontrolováno“`);
  await p.screenshot({ path: `${S}w22a-${tag}-2-B-unchecked.png` });
  await p.locator('[data-clash-recheck]').click();
  ok(await waitState('clash'), `[${tag}] B: „Zkontrolovat kolize“ → vlastní výsledek sestavy B (kolize)`);
  const b1 = await panel();
  ok(b1 && /Kolize \(2\)/.test(b1.text) && /„Sestava B“ · 3 komponent/.test(b1.text), `[${tag}] B: Kolize (2), hlavička „Sestava B“ · 3 komponent\n   ${b1 && b1.text.split('\n').slice(0, 2).join(' | ')}`);

  // zpět na A: její vlastní (nezměněný) výsledek platí dál a je pojmenovaný
  await tab('Sestava A');
  const a2 = await panel();
  ok(a2 && a2.state === 'ok' && a2.doc === a.doc && /„Sestava A“ · 2 komponent/.test(a2.text), `[${tag}] zpět na A: platný výsledek sestavy A (stav ${a2 && a2.state})`);

  // ── 2. změna modelu: poloha komponenty přepsaná ve formuláři komponenty ──
  await p.locator('[data-mates-list]').count(); // (strom je vykreslený)
  await p.locator('div.cursor-default', { hasText: 'Přidržovač' }).first().click();
  const z = p.locator('p', { hasText: 'Poloha [mm]' }).locator('xpath=following-sibling::div[1]').locator('input').nth(2);
  await z.waitFor({ timeout: 15000 });
  await z.fill('5');
  await z.press('Enter');
  ok(await waitState('stale'), `[${tag}] A po posunu přidržovače do desky: panel „neplatí“`);
  const a3 = await panel();
  ok(a3 && /Neplatí – sestava se od kontroly změnila/.test(a3.text) && /Zkontrolovat znovu/.test(a3.text) && !/Bez kolizí|Bez průniku|✓/.test(a3.text), `[${tag}] A: „Neplatí – sestava se od kontroly změnila“ + „Zkontrolovat znovu“, žádná zelená\n   ${a3 && a3.text.replace(/\n/g, ' | ')}`);
  ok((await p.locator('[data-clash-state="ok"]').count()) === 0, `[${tag}] A po změně: žádné data-clash-state=ok`);
  const st = await status();
  ok(/NEPLATÍ: sestava se od kontroly změnila/.test(st), `[${tag}] A po změně: textový stav „NEPLATÍ…“`);
  await p.screenshot({ path: `${S}w22a-${tag}-3-A-stale.png` });
  await p.locator('[data-clash-recheck]').click();
  ok(await waitState('clash'), `[${tag}] A: „Zkontrolovat znovu“ → nový výsledek (kolize přidržovače s deskou)`);
  const a4 = await panel();
  ok(a4 && /Kolize \(1\)/.test(a4.text) && a4.rev && a4.rev !== a.rev, `[${tag}] A: Kolize (1) s novou revizí modelu (${a.rev} → ${a4 && a4.rev})`);
  // krok zpět (Ctrl+Z): dokument je jinde než zkontrolovaný stav → výsledek zase neplatí
  // (potvrzení pole klávesou Enter může zapsat týž stav dvakrát – krok zpět se opakuje, dokud se přidržovač nevrátí na Z = 30)
  await p.locator('main').click({ position: { x: 700, y: 500 } }).catch(() => {});
  const zNow = () => p.evaluate(() => window.mncad.getDocument().components.find((c) => c.name === 'Přidržovač').placement.position[2]);
  for (let i = 0; i < 4 && (await zNow()) !== 30; i++) {
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(400);
  }
  ok((await zNow()) === 30, `[${tag}] krok zpět vrátil přidržovač na Z = 30`);
  ok(await waitState('stale'), `[${tag}] A po kroku zpět: výsledek kontroly pro jiný stav sestavy „neplatí“`);
  const a5 = await panel();
  ok(a5 && !/Bez kolizí|Bez průniku|✓/.test(a5.text), `[${tag}] A po kroku zpět: žádná zelená (stav ${a5 && a5.state})`);
  return { tab, run, status, idle, panel, waitState, kolize };
}

const browsers = [];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p, BASE + '/cad');
  const { tab, run, status, idle, panel, waitState, kolize } = await clashFlow(p, 'webgl');

  // ── 3. přepnutí záložky, když kontrola běží: klik na Kolize (sestava C) a hned klik na záložku B v téže úloze ──
  await tab('Sestava C');
  await p.getByRole('button', { name: 'Sestava', exact: true }).first().click().catch(() => {});
  const keyC = await p.evaluate(() => document.querySelector('main')?.getAttribute('data-doc-key'));
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Kolize');
    const tabB = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('Sestava B'));
    btn.click(); // kontrola sestavy C se rozběhne (asynchronně v jádře)…
    tabB.querySelector('button').click(); // …a uživatel hned přepne na B
  });
  // oznámení o doběhlé kontrole sestavy C (bez ✓, s názvem sestavy); B je mezitím aktivní
  const toast = await p.waitForFunction(() => { const t = document.body.innerText; return /Kontrola kolizí sestavy „Sestava C“ doběhla/.test(t) ? t : null; }, null, { timeout: 60000 }).then((h) => h.jsonValue(), () => '');
  ok(/Kontrola kolizí sestavy „Sestava C“ doběhla – výsledek je uložen u ní; zobrazený stav zkontrolován není/.test(toast), 'pozdní výsledek kontroly sestavy C: oznámení bez ✓ jmenuje sestavu C');
  const body = await p.evaluate(() => document.body.innerText);
  ok(!/Bez kolizí|Bez průniku/.test(body), 'nad sestavou B se po doběhnutí kontroly C neukáže žádné „Bez kolizí ✓“ (panel ani oznámení)');
  const bLate = await panel();
  ok(bLate && bLate.name === 'Sestava B' && bLate.state === 'clash' && bLate.doc !== keyC, `B si drží vlastní výsledek (stav ${bLate && bLate.state}, dokument ${bLate && bLate.name})`);
  ok((await p.locator('[data-clash-state="ok"]').count()) === 0, 'B: žádné data-clash-state=ok po pozdním výsledku jiné sestavy');
  await tab('Sestava C');
  const c1 = await panel();
  ok(c1 && c1.state === 'ok' && c1.doc === keyC && /„Sestava C“ · 2 komponent/.test(c1.text), `výsledek kontroly je u sestavy C, pro kterou vznikl (stav ${c1 && c1.state})`);
  await p.screenshot({ path: `${S}w22a-4-race.png` });

  // ── 4. stav vazeb: zelená se nepřenese mezi sestavami se stejnými id vazeb; krok zpět ──
  let log = await run('nová sestava "Sestava M"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 40 10 30\nsestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 20');
  ok(/✓ vazba Vzdálenost/.test(log), 'sestava M: vazba Vzdálenost 20 mm splněna');
  await idle();
  const docM = await p.evaluate(() => window.mncad.getDocument());
  // sestava N = kopie M (stejná id komponent i vazby), přidržovač ukotvený o 25 mm výš → vazba nesplnitelná
  const docN = JSON.parse(JSON.stringify(docM));
  docN.name = 'Sestava N';
  const cn = docN.components.find((c) => c.name === 'Přidržovač');
  cn.fixed = true;
  cn.placement.position = [40, 10, 55];
  log = await run(JSON.stringify(docN));
  await idle();
  const mates = () => p.evaluate(() => ({ state: document.querySelector('[data-mates-list]')?.getAttribute('data-mates-state'), st: [...document.querySelectorAll('[data-mate]')].map((m) => m.getAttribute('data-mate-status')) }));
  const waitMate = (want) => p.waitForFunction((w) => { const m = document.querySelector('[data-mate]'); return !!m && m.getAttribute('data-mate-status') === w; }, want, { timeout: 30000 }).then(() => true, () => false);
  ok(await waitMate('conflict'), 'sestava N (ukotvený přidržovač mimo vazbu): vazba v konfliktu');
  await tab('Sestava M');
  ok(await waitMate('ok'), 'přepnutí na M: vazba splněna (stav sestavy M, ne konflikt sestavy N)');
  await tab('Sestava N');
  await p.waitForTimeout(700);
  const mn = await mates();
  ok(!mn.st.includes('ok'), `přepnutí na N: zelené „splněno“ sestavy M se nepřeneslo (stav ${JSON.stringify(mn)})`);
  ok(await waitMate('conflict'), 'N: vazba dál v konfliktu');
  ok(/mates=0\/1\(conflict=1\)/.test(await run('stav', { protocol: 'short' })), 'N: textový stav mates=0/1(conflict=1)');
  // M: hodnota vazby přepsaná textem (jiný krok historie) a krok zpět → stav platí pro vrácený dokument
  await tab('Sestava M');
  await run('sestava ukotvit "Přidržovač"\nsestava komponenta "Přidržovač" v 40 10 55');
  ok(await waitMate('conflict'), 'M po posunu ukotvené komponenty: konflikt');
  await p.locator('main').click({ position: { x: 700, y: 500 } }).catch(() => {});
  await p.keyboard.press('Control+z');
  ok(await waitMate('ok'), 'M po kroku zpět (Ctrl+Z): vazba zase splněna – stav se vzal pro vrácený dokument, ne z doby před krokem zpět');
  await p.keyboard.press('Control+y');
  ok(await waitMate('conflict'), 'M po kroku znovu (Ctrl+Y): konflikt – žádná zelená z předchozího stavu');
  await p.screenshot({ path: `${S}w22a-5-mates.png` });

  // ── 5. mapa porovnání s referencí nepřežije přepnutí záložky ani změnu modelu ──
  const latest = JSON.parse(fs.readFileSync(path.join(WEB, 'public/cad/cli/latest.json'), 'utf8'));
  const BIN = path.join(WEB, 'public/cad/cli', latest.bundle);
  const out = fs.mkdtempSync(path.join(S, 'cli-'));
  const r = spawnSync(process.execPath, [BIN, 'run', '-', '--out', out, '--formats', 'step'], { input: 'nový díl "Ref"\nkvádr 60 40 12\n', encoding: 'utf8' });
  const stepFile = fs.readdirSync(out).find((f) => /\.step$/i.test(f));
  ok(r.status === 0 && !!stepFile, 'reference STEP (kvádr 60×40×12) z CLI');
  const ref = { name: 'ref.step', base64: fs.readFileSync(path.join(out, stepFile)).toString('base64') };
  await tab('Deska A');
  await idle();
  const cmp = await p.evaluate((ref) => window.mncad.compare(ref, { show: true, tolerance: 0.1 }).then((x) => ({ ok: x.ok, n: x.regions.length }), (e) => ({ err: String(e) })), ref);
  ok(cmp && cmp.ok === false, `porovnání dílu Deska A s referencí (vyšší o 2 mm) hlásí rozdíl: ${JSON.stringify(cmp)}`);
  const mapOn = () => p.evaluate(() => document.querySelector('main')?.getAttribute('data-compare-map') || '');
  await p.waitForFunction(() => !!document.querySelector('main')?.getAttribute('data-compare-map'), null, { timeout: 15000 }).catch(() => {});
  const keyA = await mapOn();
  ok(!!keyA, 'barevná mapa odchylek je zobrazená na dílu Deska A');
  await tab('Přidržovač');
  ok((await mapOn()) === '', 'po přepnutí na díl Přidržovač se mapa dílu Deska A nekreslí');
  await tab('Deska A');
  ok((await mapOn()) === '', 'po návratu na Deska A se stará mapa sama neobjeví (nepřežila přepnutí)');
  await p.evaluate((ref) => window.mncad.compare(ref, { show: true, tolerance: 0.1 }), ref);
  await p.waitForFunction(() => !!document.querySelector('main')?.getAttribute('data-compare-map'), null, { timeout: 15000 }).catch(() => {});
  ok((await mapOn()) !== '', 'nové porovnání mapu zobrazí');
  await run('kvádr 10 10 30 v 0 0 10');
  await idle();
  await p.waitForTimeout(800);
  ok((await mapOn()) === '', 'po změně modelu (přidaný kvádr) se mapa z dřívější geometrie nekreslí');
  ok(/Porovnání s referencí: výsledek[^\n]*NEPLATÍ/.test(await status()), 'textový stav: „Porovnání s referencí … NEPLATÍ“ po změně modelu');

  // ── 6. měření v panelu: po změně modelu „Neplatí“ + „Změřit znovu“ ──
  await run('nový díl "Měrka"\nkvádr 80 50 20');
  await idle();
  await p.waitForTimeout(1500);
  await p.locator('main').click({ position: { x: 300, y: 60 } }).catch(() => {});
  await p.keyboard.press('m');
  await p.getByText('Měření', { exact: true }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const box = await p.locator('main').boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const mstate = () => p.evaluate(() => document.querySelector('[data-measure-state]')?.getAttribute('data-measure-state') || '');
  await p.waitForFunction(() => document.querySelector('[data-measure-state]')?.getAttribute('data-measure-state') === 'ok', null, { timeout: 20000 }).catch(() => {});
  ok((await mstate()) === 'ok', `měření kliknuté entity v panelu platí (stav ${await mstate()})`);
  await run('kvádr 10 10 30 v 0 0 20');
  await idle();
  await p.waitForFunction(() => document.querySelector('[data-measure-state]')?.getAttribute('data-measure-state') === 'stale', null, { timeout: 20000 }).catch(() => {});
  ok((await mstate()) === 'stale' && (await p.locator('[data-measure-stale]').isVisible()), 'po změně modelu panel Měření hlásí „Neplatí – model se od měření změnil.“ a staré hodnoty neukazuje');
  ok(/Měření: výsledek[^\n]*NEPLATÍ/.test(await status()), 'textový stav: „Měření … NEPLATÍ“ po změně modelu');
  await p.locator('[data-measure-recheck]').click();
  await p.waitForFunction(() => document.querySelector('[data-measure-state]')?.getAttribute('data-measure-state') === 'ok', null, { timeout: 20000 }).catch(() => {});
  ok((await mstate()) === 'ok', '„Změřit znovu“ → platný výsledek pro nový model');
  await p.screenshot({ path: `${S}w22a-6-measure.png` });

  // ── 7. poloha mechanismu: zobrazený krok pohybové studie není stav, pro který kontrola proběhla ──
  log = await run('nový díl "Deska P"\nkvádr 60 40 10\nnový díl "Razník"\nkvádr 10 10 10\nnová sestava "Sestava P"\nvložit "Deska P" ukotvit\nvložit "Razník" v 40 10 30\nsestava vazba vzdálenost "Razník" spodní "Deska P" horní hodnota 20\npohyb motor lineární vazba 1 20..-5 kroky 5');
  ok(!/^✗/m.test(log), 'sestava P s vazbou Vzdálenost a lineárním motorem 20 → −5 mm (5 kroků) založena');
  await idle();
  await p.waitForTimeout(1200);
  await kolize();
  ok(await waitState('ok'), 'P: kontrola kolizí v poloze z dokumentu → stav ok');
  const p0 = await panel();
  ok(p0 && p0.pose === 'doc' && /poloha z dokumentu/.test(p0.text), `P: výsledek platí pro polohu z dokumentu (${p0 && p0.pose})`);
  // příkaz „pohyb motor“ panel studie otevírá sám; kdyby otevřený nebyl, otevře ho tlačítko v pásu karet
  const mp = p.locator('[data-motion-panel]');
  if (!(await mp.count())) await p.locator('button', { hasText: 'Pohybová studie' }).first().click();
  await mp.waitFor({ timeout: 10000 });
  await mp.locator('[data-motion-run]').click();
  await mp.locator('[data-motion-result]').waitFor({ timeout: 120000 });
  const p0b = await panel();
  ok(p0b && p0b.state === 'ok', `P: krok 0 studie = poloha z dokumentu → výsledek dál platí (stav ${p0b && p0b.state})`);
  await mp.locator('[data-motion-scrub]').fill('5');
  ok(await waitState('stale'), 'P: po posunu mechanismu na krok 5 (razník v desce) panel Kolize „neplatí“');
  const p5 = await panel();
  ok(p5 && !/Bez kolizí|Bez průniku|✓/.test(p5.text) && (await p.locator('[data-clash-state="ok"]').count()) === 0, 'P krok 5: žádné „Bez kolizí ✓“ ani data-clash-state=ok nad jinou polohou mechanismu');
  await p.locator('[data-clash-recheck]').click();
  ok(await waitState('clash'), 'P krok 5: „Zkontrolovat znovu“ zkontroluje ZOBRAZENOU polohu → kolize razníku s deskou');
  const p5b = await panel();
  ok(p5b && p5b.pose === 'step' && /zobrazený krok pohybové studie/.test(p5b.text) && p5b.rev !== p0.rev, `P krok 5: hlavička uvádí polohu „zobrazený krok pohybové studie“ a jinou revizi (${p0.rev} → ${p5b && p5b.rev})`);
  await p.screenshot({ path: `${S}w22a-7-pose.png` });
  await mp.locator('[data-motion-scrub]').fill('0');
  ok(await waitState('stale'), 'P zpět na krok 0: výsledek spočítaný pro krok 5 pro polohu z dokumentu neplatí');
  ok(/Kolize: 1[^\n]*NEPLATÍ/.test(await status()), 'P: textový stav – kolize z kroku studie pro polohy v dokumentu „NEPLATÍ“');
  await p.locator('button', { hasText: 'Pohybová studie' }).first().click(); // zavřít panel studie (poloha zpět z dokumentu)
  await mp.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

  // ── 8. změna konfigurace dílu v sestavě (polohy komponent stejné) ──
  log = await run('nový díl "Deska K"\nkvádr 60 40 10\nkvádr 10 10 30 v 40 10 10\nkonfigurace "Bez výstupku" potlačit "Kvádr 2"\nkonfigurace aktivní "Bez výstupku"\nnová sestava "Sestava K"\nvložit "Deska K" ukotvit\nvložit "Přidržovač" v 40 10 30');
  ok(!/^✗/m.test(log), 'sestava K: deska v konfiguraci „Bez výstupku“ + přidržovač');
  await idle();
  await p.waitForTimeout(1200);
  await kolize();
  ok(await waitState('ok'), 'K (konfigurace bez výstupku): kontrola kolizí → stav ok');
  const k0 = await panel();
  log = await run('sestava upravit "Deska K"\nkonfigurace aktivní žádná\nsestava hotovo');
  ok(/vrácen do sestavy/.test(log), 'K: konfigurace dílu přepnuta v kontextu sestavy (výstupek zasahuje do přidržovače)');
  await idle();
  ok(await waitState('stale'), 'K po změně konfigurace dílu (bez posunu komponent): panel Kolize „neplatí“');
  const k1 = await panel();
  ok(k1 && !/Bez kolizí|Bez průniku|✓/.test(k1.text) && /Zkontrolovat znovu/.test(k1.text), 'K: žádná zelená z dřívější konfigurace, nabídnuto „Zkontrolovat znovu“');
  await p.locator('[data-clash-recheck]').click();
  ok(await waitState('clash'), 'K: nová kontrola → kolize výstupku s přidržovačem');
  const k2 = await panel();
  ok(k2 && /Kolize \(1\)/.test(k2.text) && k2.rev !== k0.rev, `K: Kolize (1) s jinou revizí modelu (${k0 && k0.rev} → ${k2 && k2.rev})`);
  await p.screenshot({ path: `${S}w22a-8-config.png` });
  ok(errs.length === 0, 'žádná chyba stránky (WebGL): ' + errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ── 9. anglické rozhraní: tytéž stavy panelu v jazyce aplikace ──
  const ctxE = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const pe = await ctxE.newPage();
  pe.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(pe, BASE + '/en/cad');
  const runE = (t) => pe.evaluate((t) => window.mncad.run(t), t);
  const stateE = (st) => pe.waitForFunction((s) => document.querySelector('[data-clash-panel]')?.getAttribute('data-clash-state') === s, st, { timeout: 60000 }).then(() => true, () => false);
  const textE = () => pe.evaluate(() => document.querySelector('[data-clash-panel]')?.parentElement.parentElement.innerText || '');
  await runE(SETUP);
  await runE('záložka "Sestava A"');
  await runE('kolize');
  ok(await stateE('ok'), 'EN: příkaz kolize na sestavě A → panel ve stavu ok');
  const eOk = await textE();
  // vlna 22 C2: bez průniku ≠ bez kolize – panel říká „No intersection · clearance not checked“ a nikde ✓
  ok(/No intersection · clearance not checked/.test(eOk) && !/✓/.test(eOk) && /“Sestava A”|„Sestava A“/.test(eOk) && /positions from the document/.test(eOk), `EN: „No intersection · clearance not checked“ (bez ✓) s hlavičkou (dokument · poloha)\n   ${eOk.replace(/\n/g, ' | ')}`);
  await runE('sestava komponenta "Přidržovač" v 40 10 5');
  ok(await stateE('stale'), 'EN: po posunu komponenty stav stale');
  const eSt = await textE();
  ok(/Interference: not valid/.test(eSt) && /Not valid – the assembly has changed since the check\./.test(eSt) && /Check again/.test(eSt) && !/✓/.test(eSt), `EN: „Interference: not valid“ + „Check again“, žádné ✓\n   ${eSt.replace(/\n/g, ' | ')}`);
  await runE('záložka "Sestava B"');
  ok(await stateE('unchecked'), 'EN: přepnutí na sestavu B → stav unchecked');
  const eUn = await textE();
  ok(/Interference: not checked/.test(eUn) && /Check interference/.test(eUn) && !/✓/.test(eUn), `EN: „Interference: not checked“ + „Check interference“\n   ${eUn.replace(/\n/g, ' | ')}`);
  await ctxE.close();

  // ── 10. totéž bez WebGL (softwarový náhled) – majitel testoval bez WebGL ──
  const b2 = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  browsers.push(b2);
  const ctx2 = await b2.newContext({ viewport: { width: 1430, height: 880 } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  p2.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p2, BASE + '/cad');
  const noGl = await p2.evaluate(() => { try { const c = document.createElement('canvas'); return !(c.getContext('webgl2') || c.getContext('webgl')); } catch { return true; } });
  ok(noGl, 'druhý průchod běží bez WebGL (softwarový náhled)');
  await clashFlow(p2, 'nowebgl');
  ok(errs2.length === 0, 'žádná chyba stránky (bez WebGL): ' + errs2.slice(0, 3).join(' | '));
  await b2.close();
  await b.close();
})().catch(async (e) => {
  // chyba průchodu: zavřít prohlížeče a skončit (jinak by proces visel do časového limitu sady)
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  for (const x of browsers) await x.close().catch(() => {});
  process.exit(1);
});
