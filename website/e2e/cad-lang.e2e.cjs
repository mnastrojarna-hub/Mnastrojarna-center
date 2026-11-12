// E2E: jazykové verze CADu – /en/cad a /de/cad: rozhraní, jádro (chybové hlášky), textové příkazy anglicky a německy,
// stavový text, přepínač jazyka v Nastavení, odkazy na webu, dokumentace EN/DE, žádné chybějící překlady.
// Spuštění (server na :3100): node e2e/cad-lang.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = 'http://localhost:3100';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the OpenCascade|OpenCascade-Kern wird geladen/.test(document.body.innerText), null, { timeout: 120000 });
const start = async (page, cont) => { const c = page.getByText(cont); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const run = (p, t) => p.evaluate((t) => window.mncad.run(t), t);
const missing = (p) => p.evaluate(() => window.mncad.missing().filter((k) => /\p{L}{3,}/u.test(k.replace(/\{\d+\}/g, ' '))));
const CZ = /Nástroje|Zobrazení|Výkres|Soubor|Nový díl|Načítám|Přepočítávám|Sestava|Pokračovat/;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // ── EN ──
  await p.goto(BASE + '/en/cad', { waitUntil: 'networkidle', timeout: 180000 }); await start(p, 'Continue working');
  ok(await p.evaluate(() => document.documentElement.lang) === 'en', 'html lang=en');
  ok(await p.evaluate(() => window.mncad.lang) === 'en', 'window.mncad.lang = en');
  ok(!(await p.locator('a[href="/en/about-us"], a[href="/en/contact"]').count()), 'bez hlavičky a patičky webu (aplikace mimo (site) skupinu)');
  for (const name of ['Tools', 'View', 'Drawing', 'File']) ok(await p.getByRole('button', { name, exact: true }).first().isVisible(), `EN karta „${name}“`);
  let body = await p.locator('body').innerText();
  ok(!CZ.test(body), 'EN: v rozhraní nezůstala čeština ' + (body.match(CZ) || [''])[0]);
  let log = await run(p, 'shell 2');
  ok(/Nothing to shell\./.test(log), 'EN: chyba jádra přeložená (worker): ' + (log.match(/Nothing[^\n]*/) || [''])[0]);
  log = await run(p, 'new part Plate\nmaterial stainless steel\nbox 100 60 12\nhole 8.5 depth 10 at 20 30 12\nfillet 2 edges vertical');
  ok(/→ Fillet 1 \(fillet\)/.test(log) && /✓ Fillet 1/.test(log), 'EN: anglické příkazy, názvy prvků anglicky (Fillet 1)\n' + (log.match(/[→✓⚠✗] Fillet 1[^\n]*/g) || []).join('\n'));
  ok(/Size: 100 × 60 × 12 mm/.test(log) && /Document: “Plate”/.test(log) && /depth 10/.test(log), 'EN: stavový text anglicky (Size, Document, depth)\n' + (log.match(/Size[^\n]*/) || [''])[0]);
  ok(/Geometry: valid/.test(log), 'EN: řádek Geometry: ' + (log.match(/Geometry[^\n]*/) || [''])[0]);
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Tools', exact: true }).first().click(); await p.waitForTimeout(400);
  await p.screenshot({ path: S + 'lang-en.png' });
  // nastavení → jazyk rozhraní
  await p.keyboard.press('Control+,'); await p.waitForTimeout(700);
  ok(await p.getByText('Interface language').first().isVisible(), 'EN: Nastavení obsahuje „Interface language“');
  await p.screenshot({ path: S + 'lang-en-settings.png' });
  let miss = await missing(p);
  ok(miss.length === 0, 'EN: žádné chybějící překlady (' + miss.length + ') ' + miss.slice(0, 8).join(' | '));
  // přepnutí na němčinu
  await p.getByRole('button', { name: 'Deutsch', exact: true }).first().click();
  await p.waitForURL(/\/de\/cad/, { timeout: 30000 });
  ok(/\/de\/cad/.test(p.url()), 'přepínač jazyka EN → DE: ' + p.url());

  // ── DE ──
  await p.waitForLoadState('networkidle'); await start(p, 'Weiterarbeiten');
  ok(await p.evaluate(() => window.mncad.lang) === 'de', 'window.mncad.lang = de');
  for (const name of ['Werkzeuge', 'Ansicht', 'Zeichnung', 'Datei']) ok(await p.getByRole('button', { name, exact: true }).first().isVisible(), `DE karta „${name}“`);
  body = await p.locator('body').innerText();
  ok(!CZ.test(body), 'DE: v rozhraní nezůstala čeština ' + (body.match(CZ) || [''])[0]);
  log = await run(p, 'schale 2');
  ok(/Nichts zu schalen\./.test(log), 'DE: chyba jádra přeložená: ' + (log.match(/Nichts[^\n]*/) || [''])[0]);
  log = await run(p, 'neues teil Platte\nwerkstoff edelstahl\nquader 100 60 12\nbohrung 8,5 tiefe 10 bei 20 30 12\nverrunden 2 kanten senkrecht');
  ok(/→ Verrundung 1 \(fillet\)/.test(log) && /✓ Verrundung 1/.test(log), 'DE: německé příkazy, názvy prvků německy (Verrundung 1)\n' + (log.match(/[→✓⚠✗] Verrundung 1[^\n]*/g) || []).join('\n'));
  ok(/Abmessungen: 100 × 60 × 12 mm/.test(log) && /Dokument: „Platte“/.test(log) && /Tiefe 10/.test(log), 'DE: stavový text německy\n' + (log.match(/Abmessungen[^\n]*/) || [''])[0]);
  // výkres německy (razítko)
  await p.getByRole('button', { name: 'Zeichnung', exact: true }).first().click(); await p.waitForTimeout(400);
  const dwgBtn = p.getByRole('button', { name: /Zeichnung erstellen|Neue Zeichnung|Zeichnung/ }).nth(1);
  if (await dwgBtn.isVisible().catch(() => false)) { await dwgBtn.click(); await p.waitForTimeout(6000); }
  body = await p.locator('body').innerText();
  ok(!CZ.test(body), 'DE: výkresové prostředí bez češtiny ' + (body.match(CZ) || [''])[0]);
  await p.screenshot({ path: S + 'lang-de.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  miss = await missing(p);
  ok(miss.length === 0, 'DE: žádné chybějící překlady (' + miss.length + ') ' + miss.slice(0, 8).join(' | '));

  // ── CS zůstává česky ──
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 180000 }); await start(p, 'Pokračovat v práci');
  ok(await p.evaluate(() => window.mncad.lang) === 'cs', 'window.mncad.lang = cs');
  ok(await p.getByRole('button', { name: 'Nástroje', exact: true }).first().isVisible(), 'CS karta „Nástroje“');
  log = await run(p, 'skořepina 2');
  ok(/Není co skořepinovat\./.test(log), 'CS: chyba jádra česky');

  // ── web: odkazy a dokumentace ──
  await p.goto(BASE + '/en', { waitUntil: 'networkidle' });
  ok((await p.locator('a[href="/en/cad"]').count()) > 0, 'EN web odkazuje na /en/cad');
  await p.goto(BASE + '/de', { waitUntil: 'networkidle' });
  ok((await p.locator('a[href="/de/cad"]').count()) > 0, 'DE web odkazuje na /de/cad');
  for (const [u, re] of [['/en/cad/documentation', /Documentation|documentation/], ['/de/cad/dokumentation', /Dokumentation/]]) {
    const r = await p.goto(BASE + u, { waitUntil: 'networkidle' });
    const t = await p.locator('main').innerText();
    ok(r.status() === 200 && re.test(t) && /\/cad\/dokumentace/.test(await p.content()), `${u}: 200, text, odkaz na českou dokumentaci`);
    await p.screenshot({ path: S + 'lang-docs' + u.replace(/\//g, '-') + '.png', fullPage: false });
  }
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | ').slice(0, 300));
  await b.close();
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
