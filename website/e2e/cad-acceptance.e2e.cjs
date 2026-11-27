// E2E (balík B6, brána hotovosti – nálezy, které mění aplikaci v prohlížeči): obálka sestavy v `stav` přesně (natočený
// válec změřený jádrem, ne rohy lokální obálky), uprostřed skriptu, v závěrečném stavu konzole i ve window.mncad.status(); pohybová studie má
// v konzoli dál výpis s rozsahem komponent (strojový souhrn na jeden řádek je jen v protokolu CLI/HTTP); kolize a
// kontrola sestavy beze změny. Bez chyb stránky.
// Spuštění: E2E_BASE=http://localhost:3473 node e2e/cad-acceptance.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-acceptance').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p);
  await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));
  const line = (l, re) => (l.match(re) || [''])[0];

  // ── obálka sestavy s natočeným dílem: přesně 120 × 20 × 75 (rohy lokální obálky dávaly 124,14 × 28,28) ──
  let log = await run('nový díl Čep\nválec 20 75\nnová sestava Natočení\nvložit "Čep" ukotvit\nvložit "Čep" v 100 0 0 otočení 0 0 45\nstav\nkolize');
  fs.writeFileSync(S + 'stav.txt', log);
  ok(!bad(log).length, 'sestava s natočeným válcem bez ✗');
  const env = log.match(/obálka ([\d,]+) × ([\d,]+) × ([\d,]+) mm/g) || [];
  ok(env.length >= 2 && env.every((e) => /obálka 120 × 20 × 75 mm/.test(e)), 'stav uprostřed skriptu i závěrečný stav: obálka 120 × 20 × 75 mm (' + env.join(' | ') + ')');
  const st = await p.evaluate(() => window.mncad.status());
  ok(/Sestava: 2 komponent[^\n]*obálka 120 × 20 × 75 mm/.test(st), 'window.mncad.status(): táž přesná obálka (' + line(st, /^Sestava:[^\n]*/m).slice(0, 140) + ')');

  // ── pohybová studie: konzole s výpisem rozsahu komponent jako dřív ──
  log = await run('nový díl Vodítko\nkvádr 100 20 10\nnový díl Jezdec\nkvádr 20 20 10\nnová sestava Pohyb\nvložit "Vodítko" ukotvit\nvložit "Jezdec" v 0 0 10\nsestava vazba vzdálenost "Jezdec" -X "Vodítko" -X hodnota 10\npohyb motor lineární vazba 1 10..50 kroky 4\npohyb stav');
  fs.writeFileSync(S + 'pohyb.txt', log);
  // vlna 22, bod 15: číslovka podle počtu v hlavičce studie (1 krok · 2–4 kroky · 5+ kroků) – dřív „4 kroků“
  ok(!bad(log).length && /Pohybová studie: 4 kroky · 2 s/.test(log) && !/Pohybová studie: 4 kroků/.test(log), 'pohyb motor + pohyb stav bez ✗');
  ok((log.match(/ „Jezdec“: ΔX −40 mm/g) || []).length === 2, 'konzole: pohyb tuhé skupiny u motoru i u pohyb stav (vlna 22, M3: výchozí souhrn po skupinách)');
  ok(!/motion steps=/.test(log), 'strojový souhrn `motion …` jen v protokolu CLI/HTTP, ne v konzoli');

  ok(!errs.length, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
