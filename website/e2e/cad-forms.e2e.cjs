// E2E: opravy z analýzy nástrojů – vlastní dotaz místo window.prompt, výběr hran / ploch ze seznamu a pravidlem,
// zkratky B / N / S s výběrem, zkratky prvků rozšíření, samozhušťovací pás karet, číslování záložek, nápověda,
// zrcadlení vybraných prvků, rovina odkazem u prvků rozšíření, seznam příkazů v konzoli.
// Spuštění (server na :3100): node e2e/cad-forms.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let nativeDialogs = 0; p.on('dialog', (d) => { nativeDialogs++; d.dismiss().catch(() => {}); });
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 60000 });
  const vol = async () => { const m = (await p.evaluate(() => window.mncad.status())).match(/objem ([\d\s  ,]+) cm³/); return m ? parseFloat(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : NaN; };
  const last = async () => (await doc()).features.slice(-1)[0];
  const okBtn = () => p.getByRole('button', { name: 'OK', exact: true }).click();

  // ── pás karet: při 1430 px se karta Skica vejde nebo má šipky, žádný vodorovný posuvník ──
  await run('nový díl Formuláře\nkvádr 60 40 20');
  await idle();
  const ribbonFits = async () => p.evaluate(() => {
    const r = document.querySelector('[data-ribbon]'); const s = r.firstElementChild;
    return { density: r.getAttribute('data-ribbon-density'), overflow: s.scrollWidth - s.clientWidth, arrows: document.querySelectorAll('[data-ribbon-scroll]').length, scrollbar: getComputedStyle(s).scrollbarWidth };
  });
  let rb = await ribbonFits();
  ok(rb.scrollbar === 'none' && (rb.overflow <= 1 || rb.arrows > 0), `karta Tvorba při 1430 px: bez posuvníku, vejde se nebo má šipky (${JSON.stringify(rb)})`);
  await p.keyboard.press('s'); await p.waitForTimeout(400);
  ok(await p.getByText('Rovina XZ (nárys)').isVisible().catch(() => false) && (await doc()).features.length === 1, 'klávesa S bez vybrané plochy nabídne roviny skici (nezaloží mlčky skicu na XY)');
  await p.getByText('Rovina XZ (nárys)').click(); await p.waitForTimeout(700);
  ok((await last()).type === 'sketch' && (await last()).plane.name === 'XZ', 'výběr z nabídky založí skicu na rovině XZ');
  rb = await ribbonFits();
  const groups = await p.evaluate(() => [...document.querySelectorAll('[data-ribbon-group]')].map((g) => ({ label: g.getAttribute('data-ribbon-group'), right: Math.round(g.getBoundingClientRect().right) })));
  ok(rb.scrollbar === 'none' && (rb.overflow <= 1 || rb.arrows > 0), `karta Skica při 1430 px: bez posuvníku, hustota ${rb.density}, přesah ${rb.overflow} px, šipky ${rb.arrows}`);
  const koty = groups.find((g) => /Kóty/.test(g.label));
  if (koty && koty.right > 1430) {
    await p.locator('[data-ribbon-scroll="right"]').click(); await p.waitForTimeout(600);
    const r2 = await p.evaluate(() => Math.round([...document.querySelectorAll('[data-ribbon-group]')].find((g) => /Kóty/.test(g.getAttribute('data-ribbon-group'))).getBoundingClientRect().right));
    ok(r2 <= 1430, `skupina Kóty je po kliknutí na šipku celá vidět (pravý okraj ${r2} px)`);
  } else ok(!!koty, `skupina Kóty je celá vidět bez posunu (pravý okraj ${koty ? koty.right : '?'} px)`);
  await p.screenshot({ path: S + 'forms-ribbon-sketch.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Dokončit skicu|Hotovo/ }).first().click().catch(() => {}); await p.waitForTimeout(500);
  await run('smazat poslední'); await idle();

  // ── vlastní dotaz místo window.prompt: skica s odsazením, výraz ──
  await p.getByRole('button', { name: /^Skica/ }).first().click(); await p.waitForTimeout(300);
  await p.getByText('XY s odsazením…').first().click(); await p.waitForTimeout(400);
  ok(await p.locator('[data-ask]').isVisible() && nativeDialogs === 0, 'odsazená rovina skici: vlastní dialog, žádné systémové okno');
  await p.locator('[data-ask-input]').fill('nesmysl'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await p.locator('[data-ask] [role="alert"]').isVisible(), 'neplatná hodnota → chyba v dialogu, dialog zůstává');
  await p.locator('[data-ask-input]').fill('25/2'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  const sk = await last();
  ok(sk.type === 'sketch' && sk.plane.offset === 12.5, 'výraz 25/2 → skica na rovině XY s odsazením 12,5 (' + JSON.stringify(sk.plane) + ')');
  await p.getByRole('button', { name: /Dokončit skicu|Hotovo/ }).first().click().catch(() => {}); await p.waitForTimeout(500);
  await run('smazat poslední'); await idle();

  // ── zaoblení: hrany ze seznamu pravidlem, popis vybraných ──
  await p.getByRole('button', { name: 'Zaoblit', exact: true }).first().click(); await p.waitForTimeout(500);
  await p.locator('[data-pick-list]').click(); await p.waitForTimeout(400);
  const list = p.locator('[data-entity-pick="edges"]');
  await p.waitForFunction(() => /Vybráno \d+ z 12/.test(document.querySelector('[data-entity-count]')?.textContent || ''), null, { timeout: 30000 });
  ok(await list.isVisible(), 'Zaoblit → „Ze seznamu / pravidlem…“ otevře seznam 12 hran kvádru');
  await list.locator('[data-entity-rule]').fill('modré'); await list.locator('[data-entity-rule]').press('Enter'); await p.waitForTimeout(300);
  ok(/neznámé pravidlo pro hrany „modre“ – vše, horní/.test(await list.innerText()), 'neznámé pravidlo → chyba s výčtem pravidel');
  await list.locator('[data-entity-rule]').fill('svislé'); await list.locator('[data-entity-rule]').press('Enter'); await p.waitForTimeout(400);
  ok(/Vybráno 4 z 12/.test(await list.innerText()), 'pravidlo „svislé“ vybere 4 hrany');
  const firstRow = await list.locator('[data-entity-row]').first().innerText();
  ok(/Hrana 1/.test(firstRow) && /úsečka/.test(firstRow) && /mm/.test(firstRow), 'řádek seznamu popisuje hranu (typ, směr, délka): ' + firstRow.replace(/\s+/g, ' '));
  await list.locator('[data-entity-search]').fill('směr +z'); await p.waitForTimeout(300);
  ok(/zobrazeno 4/.test(await list.innerText()), 'hledání „směr +z“ zúží seznam na 4 svislé hrany');
  await p.getByRole('button', { name: 'Hotovo', exact: true }).click(); await p.waitForTimeout(400);
  ok((await last()).edges.length === 4, 'výběr ze seznamu je zapsaný v prvku (4 hrany)');
  await p.locator('[data-pick-details]').click(); await p.waitForTimeout(1500);
  ok((await p.locator('[data-pick-detail-list] li').count()) === 4 && /směr [+−]Z/.test(await p.locator('[data-pick-detail-list]').innerText()), '„Popis vybraných“ ukáže 4 hrany s popisem (směr ±Z)');
  await p.screenshot({ path: S + 'forms-pick-list.png' });
  await okBtn(); await idle(); await p.waitForTimeout(400);
  const vF = await vol();
  ok(Math.abs(vF - (48 - 4 * (4 - Math.PI) * 20 / 1000)) < 0.01, `zaoblení R2 čtyř svislých hran: ${vF} cm³`);

  // ── N s vybranou hranou: sražení ji použije rovnou; + aktuální výběr ──
  await p.evaluate(() => window.mncad.hints(true)); await p.waitForTimeout(700);
  const edgeHint = await p.evaluate(() => window.mncad.hints().find((h) => h.kind === 'edge')?.id);
  await p.evaluate((id) => window.mncad.clickHint(id), edgeHint); await p.waitForTimeout(400);
  await p.evaluate(() => window.mncad.hints(false));
  await p.keyboard.press('n'); await p.waitForTimeout(600);
  const ch = await last();
  ok(ch.type === 'chamfer' && Array.isArray(ch.edges) && ch.edges.length === 1, 'klávesa N s vybranou hranou založí sražení rovnou s touto hranou (' + JSON.stringify(ch.edges) + ')');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // ── zkratka prvku rozšíření (Shift+F = příruba plechu) ──
  const before = (await doc()).features.length;
  await p.keyboard.press('Shift+F'); await p.waitForTimeout(700);
  const after = await doc();
  const toast = await p.locator('body').innerText();
  ok(after.features.length > before || /plech/i.test(toast), 'Shift+F spustí prvek rozšíření Příruba (nový prvek nebo hláška o plechu), ne jen přizpůsobení pohledu');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  if ((await doc()).features.length > before) { await run('smazat poslední'); await idle(); }

  // ── zrcadlení vybraných prvků ──
  await run('nový díl Zrcadlení\nkvádr 100 60 20\ndíra 10 skrz v 20 30 20'); await idle(); await p.waitForTimeout(400);
  const v0 = await vol();
  await p.getByRole('button', { name: 'Zrcadlit', exact: true }).first().click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Vybrané prvky', exact: true }).click(); await p.waitForTimeout(300);
  await p.locator('[data-mirror-features] label', { hasText: 'Díra 1' }).locator('input').check();
  await p.getByLabel('Posunutí roviny').fill('50'); await p.getByLabel('Posunutí roviny').press('Tab'); await p.waitForTimeout(300);
  await okBtn(); await idle(); await p.waitForTimeout(500);
  const v1 = await vol();
  ok(Math.abs((v0 - v1) - Math.PI * 25 * 20 / 1000) < 0.01, `zrcadlení jen díry přes rovinu YZ +50: přibyla jedna díra (úbytek ${(v0 - v1).toFixed(3)} cm³)`);

  // ── rovina odkazem u prvku rozšíření (text i formulář) ──
  let log = await run('prvek surf.split keep=positive planeDef={"kind":"custom","origin":[0,0,12],"normal":[0,0,1],"xDir":[1,0,0]}\nstav');
  ok(!log.split('\n').some((l) => l.startsWith('✗')) && /100 × 60 × 8 mm/.test(log), 'prvek surf.split s rovinou odkazem (z = 12) ponechá horních 8 mm ' + log.split('\n').filter((l) => l.startsWith('✗')).join(' '));
  await p.getByText('Rozdělit těleso rovinou', { exact: false }).first().click().catch(() => {}); await p.waitForTimeout(500);

  // ── číslování záložek ──
  await p.getByRole('button', { name: 'Nový díl', exact: true }).first().click().catch(async () => { await p.locator('[title="Nový díl"]').first().click(); }); await p.waitForTimeout(500);
  await run('kvádr 5 5 5'); await idle();
  await p.locator('[title="Nový díl"]').first().click(); await p.waitForTimeout(500);
  const titles = await p.locator('[role="tab"]').allInnerTexts();
  const activeName = (await doc()).name; // aktivní záložka má název v editačním poli
  ok(titles.some((t) => /^Nový díl\s*$/.test(t.replace(/×/g, '').trim())) && activeName === 'Nový díl 2', 'druhý nový díl se jmenuje „Nový díl 2“ (' + titles.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ') + ' + aktivní „' + activeName + '“)');

  // ── nápověda a seznam příkazů ──
  await p.getByRole('button', { name: 'Nápověda' }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Klávesové zkratky a ovládání/ }).first().click(); await p.waitForTimeout(400);
  const help = await p.locator('body').innerText();
  ok(/B zaoblení · N sražení/.test(help) && /S nová skica/.test(help) && /Ctrl\+Shift\+K textové příkazy/.test(help) && /Shift\+F/.test(help), 'nápověda uvádí B, N, S, Ctrl+Shift+K i zkratky prvků rozšíření');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.keyboard.press('Control+Shift+K'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Seznam příkazů', exact: true }).click(); await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-agent-commands] li')].map((li) => li.querySelector('span').getBoundingClientRect().width));
  ok(rows.length >= 30 && Math.min(...rows) > 200, `seznam příkazů: ${rows.length} řádků, popis má šířku nejméně ${Math.round(Math.min(...rows))} px (dřív sloupec na jedno slovo)`);
  await p.screenshot({ path: S + 'forms-commands.png' });

  ok(nativeDialogs === 0, 'během testu se neotevřelo žádné systémové okno (window.prompt)');
  ok(errs.length === 0, 'žádná chyba stránky' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('ERR ' + e.message.split('\n')[0]); process.exit(1); });
