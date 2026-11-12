// E2E: více těles v dílu (text, formuláře, správce) a textové příkazy doplněné po analýze nástrojů:
// oblouk / spline / zaoblení rohu ve skice, šikmá díra, více děr, obecný příkaz „prvek“ (i rozšíření), normálie, vložit, výkres.
// Spuštění (server na :3100): node e2e/cad-bodies.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const bad = (l) => l.split('\n').filter((x) => x.startsWith('✗'));
  const vol = (log) => { const m = log.match(/objem ([\d\s  ,]+) cm³/g) || []; return m.length ? parseFloat(m[m.length - 1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 60000 });

  // ── tělesa textem ──
  let log = await run(`nový díl Tělesa
kvádr 100 60 20
válec 30 40 v 50 30 20 nové těleso Čep
stav`);
  ok(bad(log).length === 0, 'nové těleso textem bez chyby' + bad(log).join('\n'));
  ok(/těles 2/.test(log) && /Tělesa: Čep \(aktivní\) 28,27 cm³ · Těleso 1 120 cm³/.test(log), 'stav: 2 tělesa, nové těleso „Čep“ je aktivní (' + (log.match(/Tělesa:.*/) || [''])[0] + ')');
  const v2 = vol(log);
  ok(Math.abs(v2 - (120 + Math.PI * 225 * 40 / 1000)) < 0.02, `objem obou těles ${v2} cm³ (kvádr 120 + válec 28,27)`);
  log = await run('těleso 1\ndíra 10 skrz v 20 30 20\nstav');
  ok(bad(log).length === 0 && /další prvky pracují s tělesem „Těleso 1“/.test(log), '„těleso 1“ přepne další prvky na Těleso 1');
  ok(Math.abs(vol(log) - (v2 - Math.PI * 25 * 20 / 1000)) < 0.02, `díra jde do Tělesa 1 (objem ${vol(log)} cm³)`);
  ok(/Čep 28,27 cm³/.test(log), 'těleso Čep zůstalo beze změny (28,27 cm³)');
  log = await run('těleso 7');
  ok(/těleso „Těleso 7“ v dílu není – tělesa: Těleso 1, Čep/.test(log), 'neexistující těleso → chyba se seznamem těles');

  // ── správce: seznam těles, aktivace kliknutím ──
  await idle(); await p.waitForTimeout(600);
  const bodies = p.locator('[data-bodies] [data-body]');
  ok((await bodies.count()) === 2, 'správce ukazuje seznam těles (2)');
  await p.locator('[data-body="Čep"]').click(); await idle(); await p.waitForTimeout(500);
  ok((await p.locator('[data-body="Čep"]').getAttribute('aria-pressed')) === 'true', 'kliknutím ve správci se těleso stane aktivním');
  ok((await p.evaluate(() => window.mncad.getDocument().activeBody)) === 'Čep', 'aktivní těleso je zapsané v dokumentu');
  await p.screenshot({ path: S + 'bodies-manager.png' });

  // ── pás karet: Sloučit tělesa (formulář) ──
  await p.getByRole('button', { name: /Sloučit tělesa/ }).first().click(); await p.waitForTimeout(500);
  ok(await p.getByLabel('Nástrojové těleso', { exact: true }).isVisible(), 'Tvorba → Tělesa → Sloučit tělesa otevře formulář');
  await p.getByLabel('Cílové těleso', { exact: true }).selectOption('Těleso 1');
  await p.getByLabel('Nástrojové těleso', { exact: true }).selectOption('Čep');
  await idle(); await p.waitForTimeout(800); await idle();
  log = await p.evaluate(() => window.mncad.status());
  ok(!/těles 2/.test(log) && Math.abs(vol(log) - (120 - Math.PI * 25 * 20 / 1000 + Math.PI * 225 * 40 / 1000)) < 0.02, `sloučení formulářem: jedno těleso, objem ${vol(log)} cm³`);
  await p.getByRole('button', { name: 'OK', exact: true }).click(); await p.waitForTimeout(400); // potvrdit prvek (Esc by ho zrušil)

  // ── rozdělit, kopie, sloučit textem ──
  log = await run('rozdělit XY odsazení 10 jako Spodek\nkopie těleso Spodek posun 0 0 -30 jako Kopie\nstav');
  ok(bad(log).length === 0 && /těles 3/.test(log), 'rozdělit + kopie textem → 3 tělesa ' + bad(log).join('\n'));
  ok(/Spodek/.test(log) && /Kopie/.test(log), 'tělesa mají zadané názvy (' + (log.match(/Tělesa:.*/) || [''])[0] + ')');
  log = await run('sloučit Spodek Kopie průnik\nstav');
  ok(/⚠|✗/.test(log) || /těles 2/.test(log), 'sloučit průnikem dvou těles, která se neprotínají, se nahlásí nebo sníží počet těles');
  log = await run('zpět\nsloučit 1 Spodek\nstav');
  ok(bad(log).length === 0 && /těles 2/.test(log), 'sloučit 1 Spodek → 2 tělesa (zbylo Těleso 1 a Kopie) ' + bad(log).join('\n'));

  // ── formulář: operace „Nové těleso“ u primitiva ──
  await p.getByRole('button', { name: 'Kvádr', exact: true }).first().click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Nové těleso', exact: true }).click(); await idle(); await p.waitForTimeout(600);
  const nb = await p.evaluate(() => { const f = window.mncad.getDocument().features.slice(-1)[0]; return { mode: f.mode, body: f.body }; });
  ok(nb.mode === 'new' && /^Těleso \d+$/.test(nb.body || ''), 'formulář: operace „Nové těleso“ založí těleso s dalším volným názvem (' + JSON.stringify(nb) + ')');
  ok(await p.getByLabel('Název nového tělesa', { exact: true }).isVisible(), 'formulář nabízí název nového tělesa');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // ── skica: zaoblení rohu, oblouk, spline ──
  log = await run('nový díl Skica\nskica XY: čára 0 0 60 0 r 8 60 40 r 8 0 40 uzavřít\nvysunout 10\nstav');
  ok(bad(log).length === 0 && Math.abs(vol(log) - (2400 - 2 * (64 - Math.PI * 16)) * 10 / 1000) < 0.02, `čára se dvěma zaoblenými rohy r 8 → ${vol(log)} cm³ (23,73)` + bad(log).join('\n'));
  log = await run('nový díl Oblouk\nskica XY: oblouk -10 0 0 10 10 0; úsečka 10 0 -10 0\nvysunout 5\nstav');
  ok(bad(log).length === 0 && Math.abs(vol(log) - Math.PI * 100 / 2 * 5 / 1000) < 0.01, `oblouk třemi body + úsečka = půlkruh → ${vol(log)} cm³ (0,79)` + bad(log).join('\n'));
  log = await run('nový díl Spline\nskica XY: spline 0 0 20 12 40 0 20 -12 uzavřít\nvysunout 4\nstav');
  ok(bad(log).length === 0 && vol(log) > 1 && vol(log) < 4, `uzavřená spline se vysune (${vol(log)} cm³)` + bad(log).join('\n'));
  log = await run('nový díl Šikmá\nskica počátek 0 0 10 normála 0 1 1: kružnice 20\nvysunout 5\nstav');
  ok(bad(log).length === 0 && Math.abs(vol(log) - Math.PI * 100 * 5 / 1000) < 0.01, `skica v obecné rovině (normála 0 1 1) → ${vol(log)} cm³ (1,57)` + bad(log).join('\n'));

  // ── díry: šikmá, více poloh ──
  log = await run('nový díl Díry\nkvádr 40 40 20\nstav\ndíra 6 skrz v 20 20 20 sklon 30\nstav');
  const [vA, vB] = (log.match(/objem ([\d,]+) cm³/g) || []).map((x) => parseFloat(x.replace(/[^\d,]/g, '').replace(',', '.')));
  ok(bad(log).length === 0 && Math.abs((vA - vB) - Math.PI * 9 * (20 / Math.cos(Math.PI / 6)) / 1000) < 0.02, `šikmá díra sklon 30°: úbytek ${(vA - vB).toFixed(3)} cm³ (válec Ø6 délky 23,09 = 0,653)` + bad(log).join('\n'));
  log = await run('díra 4 skrz v 5 5 20 v 35 5 20 v 35 35 20 v 5 35 20\nstav');
  ok(bad(log).length === 0 && Math.abs((vB - vol(log)) - 4 * Math.PI * 4 * 20 / 1000) < 0.02, `čtyři díry jedním příkazem: úbytek ${(vB - vol(log)).toFixed(3)} cm³ (1,005)` + bad(log).join('\n'));

  // ── obecný příkaz prvek ──
  log = await run('prvek chamfer distance=2 edges=horní;rovné\nstav');
  ok(bad(log).length === 0 && /Sražení \d+ \(chamfer\) – 4 hran podle pravidla „horni rovne“/.test(log), 'prvek chamfer edges=horní;rovné: 4 hrany vybrané pravidlem ' + bad(log).join('\n') + (log.match(/→ Sražení.*/) || [''])[0]);
  log = await run('nový díl Rozšíření\nskica XY: obdélník 20 20\nprvek adv.twist sketch=$last height=30 angle=45\nstav');
  ok(bad(log).length === 0 && vol(log) > 11 && vol(log) < 12.1, `prvek rozšíření adv.twist (zkrut) z textu: ${vol(log)} cm³` + bad(log).join('\n'));
  log = await run('prvek adv.twist nesmysl=1');
  ok(/neznámý parametr „nesmysl“ – parametry: sketch, height, angle/.test(log), 'neznámý parametr rozšíření → chyba se seznamem parametrů');
  log = await run('nesmysl 1 2');
  ok(/neznámý příkaz „nesmysl“ – příkazy: nový díl, nová sestava, název, materiál, barva, kvádr/.test(log) && /prvek, normálie, vložit, výkres/.test(log), 'hláška o neznámém příkazu uvádí stejný seznam jako tabulka příkazů');

  // ── normálie, sestava, výkres ──
  const tabs = () => p.locator('[role="tab"]').count();
  let n = await tabs();
  log = await run('normálie M8x30\nstav');
  ok(bad(log).length === 0 && /✓ normálie „.*M8.*“ – nová záložka/.test(log) && (await tabs()) === n + 1, 'normálie M8x30 → díl v nové záložce (' + (log.match(/✓ normálie.*/) || [''])[0] + ')');
  log = await run('nová sestava Sestava textem\nnormálie M8x30 v 0 0 0\nvložit "Díry" v 60 0 0 otočení 0 0 90 ukotvit\nstav');
  ok(bad(log).length === 0 && /komponenta „Díry“ vložena do sestavy \(ukotvená\)/.test(log), 'vložit "Díry" do sestavy z otevřené záložky ' + bad(log).join('\n'));
  await p.waitForTimeout(800);
  const comps = await p.evaluate(() => (window.mncad.getDocument().components || []).map((c) => ({ name: c.name, fixed: !!c.fixed, pos: c.placement.position, rot: c.placement.rotation })));
  ok(comps.length === 2 && comps[1].name === 'Díry' && comps[1].fixed && comps[1].pos[0] === 60 && comps[1].rot[2] === 90, 'sestava má 2 komponenty, druhá ukotvená na [60; 0; 0] s otočením Z 90° (' + JSON.stringify(comps) + ')');
  log = await run('vložit "Neexistuje"');
  ok(/díl „Neexistuje“ není mezi otevřenými záložkami – otevřené díly: /.test(log), 'vložit neexistující záložku → chyba se seznamem otevřených dílů');
  n = await tabs();
  await run('výkres'); await p.waitForTimeout(2500);
  ok((await tabs()) === n + 1 && await p.locator('[data-sheet]').first().isVisible().catch(() => false), 'příkaz „výkres“ otevře výkres v záložce');

  // ── anglicky ──
  const en = await ctx.newPage();
  await en.goto(BASE + '/en/cad', { waitUntil: 'networkidle', timeout: 180000 });
  const ce = en.getByText('Continue working');
  if (await ce.isVisible({ timeout: 4000 }).catch(() => false)) await ce.click();
  await en.waitForFunction(() => document.body.innerText.includes('OCCT') && !!window.mncad, null, { timeout: 120000 }); await en.waitForTimeout(800);
  log = await en.evaluate((t) => window.mncad.run(t), 'new part Bodies\nbox 40 40 10\ncylinder 10 30 at 20 20 10 newbody\nbody 1\nhole 5 through at 5 5 10\ncombine 1 2\nstatus');
  ok(!log.split('\n').some((x) => x.startsWith('✗')) && !/bodies 2/.test(log), 'anglicky: newbody, body 1, combine 1 2 → jedno těleso ' + log.split('\n').filter((x) => x.startsWith('✗')).join('\n'));
  ok((await en.evaluate(() => window.mncad.missing())).length === 0, 'anglické rozhraní: žádný chybějící překlad (' + (await en.evaluate(() => window.mncad.missing())).slice(0, 5).join(' | ') + ')');

  ok(errs.length === 0, 'žádná chyba stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
