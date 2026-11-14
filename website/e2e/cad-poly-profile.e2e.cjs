// E2E: profily ze skici textem (hlášení agenta, 11. vlna) – konzole „Textové příkazy“ a window.mncad.run:
//  1. profil z lomených čar + oblouku po řádcích (přesně jak ho zadal agent) → čáry se neuzavřou, jedno těleso 13,21 cm³
//     (dřív se každá čára uzavřela sama: 2 tělesa, 12 cm³); protokol ohlásí uzavření i znovuotevření čáry
//  2. osamocená čára se uzavře automaticky (ℹ + „↺ uzavřená automaticky“ ve stavu); „otevřená“ / open / offen ji nechá otevřenou
//  3. čára se zaoblenými rohy: osamocená se uzavře úsečkou, pozdější navázání úsečku odebere
//  4. vadné profily: otevřený konec, mezera 0,02 mm → vysunutí ✗ s důvodem (id entit + souřadnice) v protokolu i ve stavu;
//     křížící se obdélníky → ⚠ s místem křížení; stav vypíše řádek „profil:“
//  5. po revizi: lopatky z jednoho bodu (starší skripty), osamocená čára jako dráha tažení / dělicí čára (automatické
//     uzavření se nepoužije), výslovně uzavřená čára v obrysu z více entit → ⚠, dělicí čára z návodu bez ⚠, odškrtnutí
//     „Uzavřená“ v GUI vydrží další textový řádek, velká skica (300 splinů) – stav nespadne
//  6. žádný systémový dialog (window.alert / confirm / prompt) během celého testu
// Spuštění: E2E_BASE=http://localhost:3362 node e2e/cad-poly-profile.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
const vol = (log) => { const m = (log.match(/objem ([\d\s  ,]+) cm³/g) || []).pop(); return m ? parseFloat(m.replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
const bad = (log) => log.split('\n').filter((l) => /^(✗|⚠)/.test(l.trim()));
const line = (log, re) => (log.split('\n').find((l) => re.test(l)) || '').trim();

const ARC = 'oblouk 20 10 12,928932 12,928932 10 20';
const L_PROFILE = `nový díl Úhelník
skica XY
čára 0 0 80 0 80 10 20 10
${ARC}
čára 10 20 10 60 0 60 0 0
vysunout 10
stav`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 180000 });
  const lastSketch = async () => (await p.evaluate(() => window.mncad.getDocument())).features.filter((f) => f.type === 'sketch').pop();

  // ── 1. hlášení agenta: profil z čar a oblouku, zadaný v konzoli (UI) ──
  await p.evaluate(() => window.mncad.openConsole()); await p.waitForTimeout(500);
  const ta = p.getByLabel('Textové příkazy nebo JSON', { exact: true });
  await ta.fill(L_PROFILE);
  await p.getByRole('button', { name: 'Provést', exact: true }).click();
  await p.waitForFunction(() => /Dokument: „Úhelník“/.test(document.querySelector('[data-agent-output]')?.textContent || ''), null, { timeout: 180000 });
  await idle();
  let log = await p.locator('[data-agent-output]').innerText();
  fs.writeFileSync(S + 'poly-1.txt', log);
  ok(bad(log).length === 0, 'konzole: žádný řádek ✗ / ⚠ ' + bad(log).join(' | '));
  ok(/ℹ čára e1 uzavřena – konce nebyly napojené; „otevřená“ ji nechá otevřenou/.test(log), 'první čára se nejdřív uzavře (ℹ): ' + line(log, /ℹ čára e1 uzavřena/));
  ok(/ℹ čára e1 otevřena – na její konce nově navazuje e3 \(uzavřená byla jen automaticky\)/.test(log), 'obrys uzavřený druhou čárou první čáru znovu otevře: ' + line(log, /ℹ čára e1 otevřena/));
  ok(/ℹ čára e3 je otevřená – její konce navazují na/.test(log), 'druhá čára je otevřená hned: ' + line(log, /ℹ čára e3/));
  ok(Math.abs(vol(log) - 13.21) < 0.006, `objem ${vol(log)} cm³ (správně 13,21; dřív 12)`);
  ok(/Geometrie: platná · 1 těleso/.test(log), 'jedno těleso (dřív 2): ' + line(log, /^Geometrie:/));
  ok(/profil: 1 uzavřený obrys \(e1–e3\) ✓/.test(log), 'stav: ' + line(log, /profil:/));
  ok(/e1 čára 4 b\. \[0; 0\]→\[80; 0\]→\[80; 10\]→\[20; 10\] otevřená/.test(log), 'stav vypíše čáru jako otevřenou');
  let sk = await lastSketch();
  ok(sk.entities.filter((e) => e.type === 'polyline').every((e) => e.closed === false && !e.autoClose), 'dokument: obě čáry closed=false bez značky autoClose');

  // ── 2. osamocená čára, otevřená / open / offen ──
  log = await run('nový díl Trojúhelník\nskica XY: čára 0 0 60 0 60 40\nvysunout 5\nstav'); await idle();
  ok(bad(log).length === 0 && Math.abs(vol(log) - 6) < 0.005, `osamocená čára se uzavře a vysune: ${vol(log)} cm³ (6)`);
  ok(/ℹ čára e1 uzavřena/.test(log) && /e1 čára 3 b\. .*↺ uzavřená automaticky/.test(log), 'protokol i stav říkají „uzavřena automaticky“');
  log = await run('nový díl Otevřená\nskica XY: čára 0 0 60 0 60 40 otevřená\nstav');
  ok(/e1 čára 3 b\. .* otevřená/.test(log) && /profil: žádný uzavřený obrys – otevřená křivka e1 \(konce \[0; 0\] a \[60; 40\]\)/.test(log), '„otevřená“: ' + line(log, /profil:/));
  log = await run('new part Open EN\nsketch XY: polyline 0 0 60 0 60 40 open\nstatus');
  sk = await lastSketch();
  ok(sk.entities[0].closed === false, 'EN „open“ → closed=false');
  log = await run('neu teil Offen DE\nskizze XY: polylinie 0 0 60 0 60 40 offen\nzustand');
  sk = await lastSketch();
  ok(sk.entities[0].closed === false, 'DE „offen“ → closed=false');

  // ── 3. čára se zaoblenými rohy ──
  log = await run('nový díl Zaoblená\nskica XY: čára 0 0 60 0 r 8 60 40 r 8 0 40');
  ok(/ℹ čára se zaoblenými rohy uzavřena úsečkou e6/.test(log), 'osamocená zaoblená čára: ' + line(log, /zaoblenými rohy/));
  log = await run('úsečka 0 40 -20 40\núsečka -20 40 -20 0\núsečka -20 0 0 0\nvysunout 10\nstav'); await idle();
  ok(/ℹ uzavírací úsečka e6 čáry se zaoblenými rohy odebrána – na konec \[0; 0\] nově navazuje e9/.test(log), 'uzavření obrysu odebere uzavírací úsečku: ' + line(log, /uzavírací úsečka/));
  const vz = (2400 - 2 * (64 - Math.PI * 16) + 800) * 10 / 1000;
  ok(bad(log).length === 0 && Math.abs(vol(log) - vz) < 0.006, `zaoblená čára + 3 úsečky = jeden obrys: ${vol(log)} cm³ (${vz.toFixed(2)})`);

  // ── 4. vadné profily: důvod v protokolu i ve stavu ──
  log = await run('nový díl Otevřený\nskica XY\núsečka 0 40 0 0\núsečka 0 0 60 0\núsečka 60 0 60 40\nvysunout 10\nstav'); await idle();
  fs.writeFileSync(S + 'poly-4a.txt', log);
  ok(/✗ Vysunutí 1 \(extrude\): .*Profil skici „Skica 1“: otevřený konec e1 v \[0; 40\]; otevřený konec e3 v \[60; 40\]\./.test(log), 'otevřený profil → ✗ s otevřenými konci: ' + line(log, /✗ Vysunutí 1/));
  ok(/profil: žádný uzavřený obrys · ⚠ problémů 2:/.test(log) || /profil: žádný uzavřený obrys – otevřená křivka e1–e3/.test(log), 'stav: ' + line(log, /profil:/));
  log = await run('nový díl Mezera\nskica XY\nčára 0 0 80 0 80 10 20 10\núsečka 20,02 10 0 0\nvysunout 10\nstav'); await idle();
  fs.writeFileSync(S + 'poly-4b.txt', log);
  ok(/✗ Vysunutí 1 \(extrude\): .*mezera 0,02 mm mezi e1 \[20; 10\] a e2 \[20,02; 10\]/.test(log), 'mezera 0,02 mm → ✗ s mezerou: ' + line(log, /✗ Vysunutí 1/));
  ok(/· mezera 0,02 mm mezi e1 \[20; 10\] a e2 \[20,02; 10\]/.test(log), 'stav vypíše mezeru zvlášť');
  sk = await lastSketch();
  ok(/ℹ čára e1 otevřena – na její konce nově navazuje e2/.test(log) && sk.entities[0].closed === false, 'konec 0,02 mm od čáry ji otevře (napojení), mezeru pak ohlásí kontrola profilu');
  log = await run('nový díl Křížení\nskica XY: obdélník 40 20; obdélník 20 40\nvysunout 5\nstav'); await idle();
  ok(/⚠ Vysunutí 1 \(extrude\): .*Profil skici „Skica 1“: e1 kříží e2 v \[/.test(log), 'křížící se obdélníky → ⚠ s místem křížení: ' + line(log, /⚠ Vysunutí 1/));
  ok(/· e1 kříží e2 v \[/.test(log), 'stav: ' + line(log, /· e1 kříží e2/));

  // ── 5. po revizi ──
  log = await run('nový díl Lopatky\nskica XY: čára 0 0 40 5 40 -5; čára 0 0 -40 5 -40 -5; čára 0 0 5 40 -5 40\nvysunout 3\nstav'); await idle();
  fs.writeFileSync(S + 'poly-5a.txt', log);
  ok(bad(log).length === 0 && Math.abs(vol(log) - 1.8) < 0.005, `lopatky z jednoho bodu (čáry navázané jen jedním koncem se uzavřou): ${vol(log)} cm³ (1,8) ${bad(log).join(' | ')}`);
  ok(/ℹ čára e1 uzavřena – navazuje na e2, e3, ale uzavřený obrys s nimi netvoří/.test(log), 'protokol: ' + line(log, /ℹ čára e1/));
  log = await run('nový díl Dráha\nskica XZ: čára 0 0 0 50 r 10 50 50\nprvek sweep pathId="Skica 1" circleRadius=3 mode=new\nstav'); await idle();
  fs.writeFileSync(S + 'poly-5b.txt', log);
  const vs = (Math.PI * 9 * (80 + 5 * Math.PI)) / 1000;
  ok(bad(log).length === 0 && Math.abs(vol(log) - vs) < 0.006, `zaoblená čára jako dráha tažení zůstane otevřená: ${vol(log)} cm³ (${vs.toFixed(2)}; s uzavírací úsečkou 4,71)`);
  log = await run('nový díl Dělicí\nkvádr 60 40 30\nskica XZ: čára -10 10 20 10 r 30 50 20 70 20\núkos 3 plochy boční dělicí "Skica 1"\nstav'); await idle();
  fs.writeFileSync(S + 'poly-5c.txt', log);
  ok(!bad(log).some((l) => l.trim().startsWith('✗')) && /✓ Úkos 1|⚠ Úkos 1/.test(log), 'dělicí čára se zaobleným rohem bez „otevřená“ projde: ' + (line(log, /^(✓|⚠|✗) Úkos 1/) || bad(log).join(' | ')));
  log = await run('nový díl Dělicí z návodu\nskica XZ: čára 0 10 30 10 30 20 60 20\nstav');
  ok(/ℹ čára e1 je otevřená – uzavírací úsek by ji křížil nebo překrýval v \[30; 15\]/.test(log) && /profil: žádný uzavřený obrys – otevřená křivka e1/.test(log) && !/⚠/.test(line(log, /profil:/)), 'dělicí čára z návodu: ' + line(log, /profil:/));
  log = await run('nový díl Uzavřít navíc\nskica XY\nčára 0 0 80 0 80 10 20 10 uzavřít\n' + ARC + '\nčára 10 20 10 60 0 60 0 0\nvysunout 10\nstav'); await idle();
  fs.writeFileSync(S + 'poly-5d.txt', log);
  ok(/⚠ Vysunutí 1 \(extrude\): .*leží na obrysu e1 – e2 do žádného obrysu nepatří; e1 je uzavřená čára – má-li být částí obrysu s e2, napište u ní „otevřená“/.test(log), 'výslovně uzavřená čára v obrysu z více entit už neprojde tiše: ' + line(log, /^(✓|⚠|✗) Vysunutí 1/));
  log = await run('entita e1 uzavřená=ne\nstav'); await idle();
  fs.writeFileSync(S + 'poly-5e.txt', log);
  ok(/ℹ čára e3 otevřena/.test(log) && Math.abs(vol(log) - 13.21) < 0.006 && bad(log).length === 0, `oprava „entita e1 uzavřená=ne“ → e3 se otevře, ${vol(log)} cm³ (13,21) ${bad(log).join(' | ')}`);
  // GUI: odškrtnout „Uzavřená“ ve skicáři, pak textový řádek do téže skici – čára zůstane otevřená
  await run('nový díl GUI\nskica XY: čára 0 0 60 0 60 40'); await idle();
  const closeConsole = p.getByRole('button', { name: 'Zavřít', exact: true }).first();
  if (await closeConsole.isVisible().catch(() => false)) await closeConsole.click(); // konzole z bodu 1 překrývá strom
  await p.waitForTimeout(400);
  await p.getByText('Skica 1', { exact: true }).first().dblclick();
  await p.waitForSelector('[data-sketch-canvas]', { timeout: 15000 });
  await p.locator('[data-sketch-canvas]').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('Control+a'); await p.waitForTimeout(400);
  const cb = p.getByLabel('Uzavřená', { exact: true });
  await cb.click(); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  const fin = p.getByRole('button', { name: /Dokončit skicu/ }).first();
  if (await fin.isVisible().catch(() => false)) await fin.click();
  await p.waitForTimeout(800);
  sk = await lastSketch();
  ok(sk.entities[0].closed === false && !sk.entities[0].autoClose, `GUI „Uzavřená“ odškrtnuto → closed=${sk.entities[0].closed}, autoClose=${sk.entities[0].autoClose}`);
  log = await run('kružnice 5 v 100 100\nstav'); await idle();
  sk = await lastSketch();
  ok(sk.entities[0].closed === false && /e1 čára 3 b\. .* otevřená/.test(log) && !/ℹ/.test(log), 'čára otevřená v GUI zůstane otevřená i po dalším textovém řádku: ' + line(log, /e1 čára/));
  // velká skica (štítek: obdélník + 300 uzavřených splinů po 30 bodech) – stav i protokol doběhnou
  const spl = [];
  for (let k = 0; k < 300; k++) {
    const cx = (k % 30) * 40, cy = Math.floor(k / 30) * 30, pts = [];
    for (let i = 0; i < 30; i++) pts.push((cx + Math.cos((i / 30) * 2 * Math.PI) * 8).toFixed(3), (cy + Math.sin((i / 30) * 2 * Math.PI) * (10 + (i % 2))).toFixed(3));
    spl.push('spline ' + pts.join(' ').replace(/\./g, ',') + ' uzavřít');
  }
  const big = await p.evaluate((t) => window.mncad.run(t).then((r) => r, (e) => 'REJECT ' + String(e)), 'nový díl Štítek\nskica XY: obdélník 1300 360 v 600 150\n' + spl.join('\n') + '\nstav');
  const pl = line(big, /profil:/);
  ok(!/^REJECT/.test(big) && /profil: 301 uzavřených obrysů \(e\d+; .*; … \+289\)/.test(pl) && pl.length < 220, `velká skica: stav doběhne, řádek profil: ${pl.length} znaků – ${pl.slice(0, 120)}`);

  // ── 6. bez systémových dialogů a chyb stránky ──
  ok(dialogs.length === 0, 'žádný systémový dialog: ' + dialogs.join(' | '));
  ok(errs.length === 0, 'bez chyb stránky: ' + errs.join(' | '));
  await p.screenshot({ path: S + 'poly-profile.png' });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
