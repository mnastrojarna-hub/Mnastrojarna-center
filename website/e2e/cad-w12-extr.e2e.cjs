// E2E vlny 12 (extr): šikmé vysunutí a úkos dovnitř / ven s břitem textem i ve formuláři.
//  - konzole: propad pod 25° (sklon k +X), střižnice s břitem a odlehčením 2° (i na ploše modelu, EN zápis), pomocná osa názvem,
//    chyby místo tichého ignorování, stav vypíše nové parametry
//  - formulář: stav z textu (Úkos 2 / Ven / Břit 3 / Ostré rohy, směr „Pod úhlem od normály“ + „Směrem k +X“), přepnutí na Dovnitř,
//    záporné číslo v poli Úkos = Ven
//  - nálezy kontroly: úkos s ukončením k ploše / rovině / dalšímu, skrz od tělesa, symetricky, rovinné stěny (měřit, STEP),
//    směr odkazem jen za „směr“, volby jiných příkazů = chyba, číslování názvů, upravit draftCorners
// Spuštění: E2E_BASE=http://localhost:3371 node e2e/cad-w12-extr.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const near = (a, b, t) => Math.abs(a - b) <= t;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 920 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  await p.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  for (let i = 0; i < 20; i++) { const st = p.locator('div.fixed.z-\\[65\\]'); if (await st.isVisible().catch(() => false)) { await st.getByText('Pokračovat v práci').first().click(); break; } await p.waitForTimeout(500); }
  await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const bodyVol = async () => { const r = await p.evaluate(() => window.mncad.measure('těleso')); return r && typeof r.volume === 'number' ? r.volume : NaN; };
  const lastExtrude = async () => (await doc()).features.filter((f) => f.type === 'extrude').slice(-1)[0];
  const fails = (log) => log.split('\n').filter((l) => l.startsWith('✗'));
  const k2 = Math.tan(2 * Math.PI / 180);

  // ── propad pod 25° ──
  let log = await run('nový díl Propad\nkvádr 80 60 20\nskica XY odsazení 20: obdélník 20 10 v 30 30\nvysunout skrz odebrat obráceně sklon 25 k +X\nstav');
  await idle();
  ok(!fails(log).length, 'propad: bez chyb ' + fails(log).join(' | '));
  let v = await bodyVol();
  ok(near(v, 96000 - 4000, 0.5), `propad pod 25°: objem ${v} mm³ (deska 96 000 − 20·10·20)`);
  ok(/směr sklon 25° k \+X/.test(log), 'stav vypíše „směr sklon 25° k +X“');
  let f = await lastExtrude();
  ok(f.dir && f.dir.kind === 'angle' && f.dir.deg === 25 && JSON.stringify(f.dir.toward) === '[1,0,0]', 'prvek: dir = sklon 25° k [1,0,0] ' + JSON.stringify(f.dir));

  // ── formulář: stav směru z textu, výška kolmo ──
  await p.locator('aside').first().getByText(f.name, { exact: true }).click(); await p.waitForTimeout(1200);
  const details = p.getByText(/Začátek, směr, tenká stěna/).first();
  if (!(await p.locator('[data-dir-tilt]').isVisible().catch(() => false))) { await details.click(); await p.waitForTimeout(400); }
  ok(await p.locator('[data-dir-tilt]').isVisible(), 'formulář: směr „Pod úhlem od normály“ se sklonem z textu');
  ok((await p.locator('[data-dir-toward]').inputValue()) === '+X', 'formulář: „Směrem k“ = +X');
  ok(await p.getByText('Vzdálenost kolmo na skicu (výška), ne podél směru').isVisible(), 'formulář: u šikmého směru volba „výška kolmo“');
  await p.locator('[data-dir-toward]').selectOption('+Y'); await p.waitForTimeout(800);
  await p.locator('button[title="OK (Enter)"]').first().click({ timeout: 4000 }).catch(() => {}); await idle();
  f = await lastExtrude();
  ok(JSON.stringify(f.dir && f.dir.toward) === '[0,1,0]', 'formulář → dokument: směr sklonu +Y ' + JSON.stringify(f.dir));
  v = await bodyVol();
  ok(near(v, 92000, 0.5), `propad k +Y: objem stejný ${v} mm³`);
  await p.screenshot({ path: S + 'w12-extr-propad-form.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ── střižnice: břit 3 + odlehčení 2° (příklad z návodu) ──
  log = await run('nový díl Střižnice\nkvádr 120 80 25 název Deska\nskica XY odsazení 25: obdélník 40 20 v 60 40\nvysunout skrz odebrat obráceně úkos 2 ven břit 3\nstav');
  await idle();
  ok(!fails(log).length, 'střižnice: bez chyb ' + fails(log).join(' | '));
  v = await bodyVol();
  const removed = 40 * 20 * 3 + 40 * 20 * 22 + 60 * k2 * 22 * 22 + (4 / 3) * k2 * k2 * 22 ** 3;
  ok(near(240000 - v, removed, 0.5), `střižnice: odebráno ${(240000 - v).toFixed(2)} mm³ (analyticky ${removed.toFixed(2)})`);
  ok(/skrz vše, cut, úkos 2° ven \(obrys se rozšiřuje\), břit 3 mm, ostré rohy/.test(log), 'stav: „skrz vše, cut, úkos 2° ven (obrys se rozšiřuje), břit 3 mm, ostré rohy“');
  f = await lastExtrude();
  ok(f.draftAngle === -2 && f.draftLand === 3 && f.draftCorners === 'sharp' && f.reverse && f.mode === 'cut', 'prvek: draftAngle −2, draftLand 3, ostré rohy, obráceně, cut');

  // ── formulář: úkos z textu, přepnout na Dovnitř ──
  await p.locator('aside').first().getByText(f.name, { exact: true }).click(); await p.waitForTimeout(1200);
  if (!(await p.locator('[data-extrude-draft]').isVisible().catch(() => false))) { await p.getByText(/Začátek, směr, tenká stěna/).first().click(); await p.waitForTimeout(400); }
  const draftBox = p.locator('[data-extrude-draft]');
  ok(await draftBox.isVisible(), 'formulář vysunutí: pole úkosu');
  const angle = await draftBox.getByLabel('Úkos', { exact: true }).inputValue();
  const land = await draftBox.getByLabel('Břit (rovná část)').inputValue();
  ok(angle === '2' && land === '3', `formulář: Úkos ${angle}°, Břit ${land} mm`);
  const outCls = await draftBox.getByRole('button', { name: 'Ven', exact: true }).getAttribute('class');
  ok(/bg-white/.test(outCls || ''), 'formulář: přepínač Ven je aktivní');
  ok(await draftBox.getByLabel('Ostré rohy (jinak zaoblené)').isChecked(), 'formulář: Ostré rohy zaškrtnuté');
  ok(await p.getByText(/u odebrání se otvor do hloubky rozšiřuje/).isVisible(), 'formulář: vysvětlení „ven“ pro odebrání');
  await p.screenshot({ path: S + 'w12-extr-strizenice-form.png' });
  await draftBox.getByRole('button', { name: 'Dovnitř', exact: true }).click(); await p.waitForTimeout(800);
  await p.locator('button[title="OK (Enter)"]').first().click({ timeout: 4000 }).catch(() => {}); await idle();
  f = await lastExtrude();
  ok(f.draftAngle === 2, 'formulář → dokument: Dovnitř = draftAngle +2 (' + f.draftAngle + ')');
  v = await bodyVol();
  const removedIn = 40 * 20 * 3 + 40 * 20 * 22 - 60 * k2 * 22 * 22 + (4 / 3) * k2 * k2 * 22 ** 3;
  ok(near(240000 - v, removedIn, 0.5), `dovnitř: otvor se do hloubky zužuje, odebráno ${(240000 - v).toFixed(2)} mm³ (analyticky ${removedIn.toFixed(2)})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ── na ploše modelu a anglicky ──
  log = await run('nový díl Střižnice 2\nkvádr 120 80 25\nskica plocha horní: obdélník 40 20\nextrude through cut reverse draft 2 out land 3');
  await idle();
  v = await bodyVol();
  ok(!fails(log).length && near(240000 - v, removed, 0.5), `skica na horní ploše + EN zápis: odebráno ${(240000 - v).toFixed(2)} mm³ ` + fails(log).join(' | '));

  // ── pomocná osa názvem ──
  log = await run('nový díl Osa\nprvek datumAxis def={"kind":"twoPoints","a":{"kind":"xyz","p":[0,0,0]},"b":{"kind":"xyz","p":[1,0,1]}} length=50 název="Osa 1"\nskica XY: kružnice 10\nvysunout 20 směr osa "Osa 1"');
  await idle();
  v = await bodyVol();
  ok(!fails(log).length && near(v, Math.PI * 25 * 20 * Math.SQRT1_2, 0.5), `směr osa "Osa 1": šikmý válec ${v} mm³ ` + fails(log).join(' | '));
  f = await lastExtrude();
  const axisId = (await doc()).features.find((x) => x.type === 'datumAxis').id;
  ok(f.dir && f.dir.ref && f.dir.ref.featureId === axisId, 'název pomocné osy převeden na id prvku');
  log = await run('skica XY: kružnice 10\nvysunout 20 směr osa "Osa 9"');
  ok(/„Osa 9“ v historii není – k dispozici: Osa 1/.test(log), 'neexistující osa → chyba s výčtem: ' + fails(log).join(' | '));

  // ── chyby místo tichého ignorování ──
  log = await run('vysunout 20 nesmysl');
  ok(/neznámé slovo „nesmysl“/.test(log), 'neznámé slovo → chyba se zápisem příkazu');
  log = await run('vysunout 20 ven');
  ok(/patří k úkosu/.test(log), '„ven“ bez úkosu → chyba');

  // ── nálezy kontroly: úkos s ukončením odkazem, symetricky, rovinné stěny, žádné tiché změny ──
  const prism = (a, bb, h, s) => a * bb * h + (a + bb) * s * h * h + (4 / 3) * s * s * h ** 3;
  const k3 = Math.tan(3 * Math.PI / 180);
  log = await run('nový díl K ploše\nkvádr 100 100 30\nskica XY odsazení 30: obdélník 20 20 v 50 50\nvysunout odebrat obráceně k ploše F5 odsazení 5 úkos 2');
  await idle(); v = await bodyVol();
  ok(!fails(log).length && near(v, 300000 - prism(20, 20, 25, -k2), 0.5), `k ploše F5 odsazení 5 úkos 2: ${v} mm³ (290 847,614) ` + fails(log).join(' | '));
  log = await run('nový díl K rovině\nprvek datum origin=0;0;15 normal=0;0;1 xDir=1;0;0 size=50 název="Rovina 1"\nskica XY: obdélník 20 10\nvysunout k rovině "Rovina 1" úkos 3\nstav');
  await idle(); v = await bodyVol();
  ok(!fails(log).length && near(v, prism(20, 10, 15, -k3), 0.5), `k rovině "Rovina 1" úkos 3: ${v} mm³ (2 658,607) ` + fails(log).join(' | '));
  ok(/k rovině „Rovina 1“/.test(log), 'stav: „k rovině „Rovina 1““ (ne „k ploše“)');
  log = await run('nový díl K dalšímu\nkvádr 100 100 10\nkvádr 100 100 10 v 0 0 60\nskica XY odsazení 10: obdélník 10 10 v 50 50\nvysunout k dalšímu úkos 3');
  await idle(); v = await bodyVol();
  ok(!fails(log).length && near(v, 200000 + prism(10, 10, 50, -k3), 0.5), `k dalšímu úkos 3: ${v} mm³ (202 837,374) ` + fails(log).join(' | '));
  log = await run('nový díl Skrz\nkvádr 120 80 25\nskica XY odsazení 25: obdélník 40 20 v 60 40\nvysunout skrz odebrat úkos 2');
  await idle();
  ok(/míří od tělesa.*obráceně/.test(log), 'skrz s úkosem od tělesa → rada „obráceně“: ' + fails(log).join(' | '));
  log = await run('nový díl Sym\nskica XY: obdélník 20 20\nvysunout 20 symetricky úkos 5');
  await idle(); v = await bodyVol();
  ok(near(v, 7320.502, 0.5), `symetricky úkos 5: ${v} mm³ (7 320,502 – obrys v rovině skici)`);
  log = await run('nový díl T\nkvádr 30 30 30 v 100 0 0\nskica XY odsazení 30: obdélník 4 4 v 104 4\nvysunout 10 hrana E1 odebrat obráceně');
  ok(/směr hrana E1/.test(log) && fails(log).length === 1, '„hrana E1“ bez „směr“ → chyba s nápovědou (dřív tiše přidání): ' + fails(log).join(' | '));
  log = await run('vysunout 10 směr body V1 V8 odebrat obráceně');
  ok(!/těleso „V1 V8“/.test(log), '„směr body V1 V8“ se nebere jako těleso: ' + log.split('\n').slice(-1)[0]);
  log = await run('vysunout 20 úhel 25');
  ok(/volba „úhel“ sem nepatří.*sklon 25/.test(log), '„úhel 25“ → chyba s nápovědou sklon 25');
  log = await run('nový díl Jména\nskica XY: obdélník 20 20\nvysunout\nvysunout 5 sklon\nvysunout 5\nstav');
  await idle();
  ok(/Vysunutí 1 \[extrude/.test(log) && !/Vysunutí [23]/.test(log), 'chybné řádky nespotřebují číslo názvu (Vysunutí 1): ' + (log.split('\n').find((l) => /\[extrude/.test(l)) || ''));
  log = await run('nový díl Střižnice EN\nkvádr 120 80 25\nskica XY odsazení 25: obdélník 40 20 v 60 40\nextrude cut reverse to body land 3 draft 2 out');
  await idle(); v = await bodyVol();
  ok(!fails(log).length && near(240000 - v, removed, 0.5), `EN „to body land 3 draft 2 out“: odebráno ${(240000 - v).toFixed(2)} ` + fails(log).join(' | '));
  // rovinné stěny odlehčení: měřit neukáže B-spline, STEP bez B_SPLINE_SURFACE
  let bs = 0;
  for (let i = 1; i <= 14; i++) if (/B-spline/i.test(await run('měřit F' + i))) bs++;
  ok(bs === 0, `ostré rohy: žádná B-spline plocha v měřit F1…F14 (${bs})`);
  const step = await p.evaluate(async () => { const r = await window.mncad.exportFile('step'); return atob(r.base64); });
  ok(!/B_SPLINE_SURFACE/.test(step) && /PLANE/.test(step), 'STEP střižnice: roviny, žádná B_SPLINE_SURFACE');
  log = await run('upravit "Vysunutí 1" draftCorners=hranaté');
  ok(/sharp.*round/.test(log), 'upravit draftCorners=hranaté → chyba');
  log = await run('upravit "Vysunutí 1" draftCorners=zaoblené\nstav');
  await idle();
  ok(/zaoblené rohy/.test(log), 'upravit draftCorners=zaoblené → stav „zaoblené rohy“');

  // ── formulář: záporné číslo v poli Úkos = Ven (dřív tiše 0) ──
  log = await run('nový díl Formulář\nkvádr 120 80 25\nskica XY odsazení 25: obdélník 40 20 v 60 40\nvysunout 10 odebrat obráceně');
  await idle();
  f = await lastExtrude();
  await p.locator('aside').first().getByText(f.name, { exact: true }).click(); await p.waitForTimeout(1200);
  if (!(await p.locator('[data-extrude-draft]').isVisible().catch(() => false))) { await p.getByText(/Začátek, směr, tenká stěna/).first().click(); await p.waitForTimeout(400); }
  const box2 = p.locator('[data-extrude-draft]');
  await box2.getByLabel('Úkos', { exact: true }).fill('-2');
  await box2.getByLabel('Úkos', { exact: true }).press('Tab'); await p.waitForTimeout(800);
  const shown = await box2.getByLabel('Úkos', { exact: true }).inputValue();
  const outActive = /bg-white/.test((await box2.getByRole('button', { name: 'Ven', exact: true }).getAttribute('class')) || '');
  await p.locator('button[title="OK (Enter)"]').first().click({ timeout: 4000 }).catch(() => {}); await idle();
  f = await lastExtrude();
  ok(f.draftAngle === -2 && f.draftCorners === 'sharp' && shown === '2' && outActive, `formulář: „-2“ v poli Úkos = Ven 2° (draftAngle ${f.draftAngle}, pole ${shown}, Ven ${outActive})`);
  v = await bodyVol();
  ok(near(240000 - v, prism(40, 20, 10, k2), 0.5), `formulář úkos −2: odebráno ${(240000 - v).toFixed(2)} mm³`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  ok(errs.length === 0, 'žádná chyba stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + e.message.split('\n')[0]); process.exit(1); });
