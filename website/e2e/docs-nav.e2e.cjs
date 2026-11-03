// E2E: dokumentace CADu a příručka PDF jsou na dosah – hlavní menu (desktop 1280/1536 bez zalomení, mobil), pás na úvodní
// stránce, patička, stránka dokumentace, úvodní obrazovka CADu a nabídka Nápověda v horní liště CADu.
// Spuštění (produkční server na :3100): node e2e/docs-nav.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  // desktop 1280 (xl – nejužší, kde je vidět plné menu)
  for (const w of [1280, 1536]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } });
    await p.goto('http://localhost:3100/', { waitUntil: 'networkidle', timeout: 120000 });
    const nav = p.locator('header nav').first();
    const grp = nav.getByRole('group');
    ok(await grp.isVisible(), `${w}: skupina Online CAD + Návod + PDF viditelná`);
    const box = await grp.boundingBox(); const hb = await p.locator('header > div > div').first().boundingBox();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow && box && hb && box.x + box.width <= hb.x + hb.width, `${w}: menu nepřetéká (grp ${Math.round(box.x + box.width)} / header ${Math.round(hb.x + hb.width)})`);
    ok(await nav.getByRole('link', { name: /Návod/ }).isVisible(), `${w}: odkaz Návod vidět`);
    const heights = await nav.locator('a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    ok(heights.every((h) => h < 40), `${w}: žádná položka menu se nezalamuje na dva řádky (max ${Math.round(Math.max(...heights))} px)`);
    const rfq = await p.locator('header a.btn-primary').first().boundingBox();
    ok(rfq && rfq.x + rfq.width <= hb.x + hb.width + 1, `${w}: tlačítko Poptat výrobu je uvnitř hlavičky`);
    const pdf = nav.locator('a[href$=".pdf"]').first();
    ok((await pdf.getAttribute('href')) === '/cad/mnastrojarna-cad-prirucka.pdf', `${w}: PDF odkaz vede na příručku`);
    ok((await pdf.isVisible()) === (w >= 1536), `${w}: PDF v menu ${w >= 1536 ? 'viditelné' : 'skryté (až od 2xl)'}`);
    await p.screenshot({ path: S + `nav-${w}.png`, clip: { x: 0, y: 0, width: w, height: 90 } });
    if (w === 1280) {
      // pás CAD na úvodní stránce
      const strip = p.getByRole('link', { name: /Dokumentace a návod k obsluze/ }).first();
      await strip.scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
      ok(await strip.isVisible(), 'úvod: pás CAD má odkaz na dokumentaci');
      ok(await p.getByRole('link', { name: /Příručka PDF ke stažení/ }).first().isVisible(), 'úvod: pás CAD má odkaz na PDF');
      await p.screenshot({ path: S + 'home-strip.png', clip: { x: 0, y: (await strip.boundingBox()).y - 120, width: 1280, height: 230 } });
      await p.locator('footer').scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
      ok(await p.locator('footer').getByRole('link', { name: 'Příručka CAD (PDF)' }).isVisible(), 'patička: Příručka CAD (PDF)');
      // dokumentace: aktivní stav v menu
      await p.goto('http://localhost:3100/cad/dokumentace', { waitUntil: 'networkidle', timeout: 120000 });
      ok(/Stáhnout příručku PDF/.test(await p.locator('main').innerText()), 'dokumentace: tlačítko Stáhnout příručku PDF');
    }
    await p.close();
  }
  // mobil – otevřené menu
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto('http://localhost:3100/', { waitUntil: 'networkidle', timeout: 120000 });
  await m.getByRole('button', { name: 'Otevřít menu' }).click(); await m.waitForTimeout(900);
  const mnav = m.getByRole('navigation', { name: 'Mobilní navigace' });
  ok(await mnav.getByRole('link', { name: /Dokumentace a návod k obsluze/ }).isVisible(), 'mobil: menu má Dokumentace a návod');
  ok(await mnav.getByRole('link', { name: /Příručka PDF ke stažení/ }).isVisible(), 'mobil: menu má Příručka PDF');
  await m.screenshot({ path: S + 'nav-mobile.png' });
  await m.close();
  // CAD – horní lišta Nápověda + úvodní obrazovka
  const c = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; c.on('pageerror', (e) => errs.push(e.message));
  await c.goto('http://localhost:3100/cad', { waitUntil: 'networkidle', timeout: 180000 });
  await c.waitForTimeout(1500);
  const start = c.locator('div.fixed.z-\\[65\\]');
  ok(await start.getByRole('link', { name: /Návod a dokumentace/ }).isVisible(), 'start: odkaz Návod a dokumentace v hlavičce');
  ok(await start.getByRole('link', { name: /Příručka PDF/ }).first().isVisible(), 'start: odkaz Příručka PDF v hlavičce');
  ok(/Nevíte si rady\?/.test(await start.innerText()), 'start: nápovědní karta');
  await c.screenshot({ path: S + 'cad-start.png' });
  await start.getByText('Pokračovat v práci').click();
  await c.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await c.waitForTimeout(500);
  const help = c.getByRole('button', { name: 'Nápověda' });
  ok(await help.isVisible(), 'CAD: tlačítko Nápověda v horní liště');
  await help.click(); await c.waitForTimeout(400);
  ok(await c.getByRole('button', { name: /Dokumentace a návod k obsluze \(web\)/ }).isVisible(), 'CAD: nabídka má dokumentaci');
  ok(await c.getByRole('button', { name: /Příručka PDF – stáhnout/ }).isVisible(), 'CAD: nabídka má PDF');
  const menuBox = await c.getByRole('button', { name: /Příručka PDF – stáhnout/ }).boundingBox();
  ok(menuBox && menuBox.x + menuBox.width <= 1400, 'CAD: nabídka je uvnitř okna');
  await c.screenshot({ path: S + 'cad-help.png', clip: { x: 700, y: 0, width: 700, height: 360 } });
  // otevření dokumentace z nabídky → nová záložka
  const [pop] = await Promise.all([c.context().waitForEvent('page'), c.getByRole('button', { name: /Dokumentace a návod k obsluze \(web\)/ }).click()]);
  await pop.waitForLoadState('domcontentloaded');
  ok(/\/cad\/dokumentace/.test(pop.url()), 'CAD: dokumentace se otevře v nové záložce (' + pop.url() + ')');
  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
