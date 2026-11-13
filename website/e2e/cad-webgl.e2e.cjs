// E2E: CAD bez WebGL (vypnuté 3D API v prohlížeči) – místo pádu srozumitelná česká chybová obrazovka,
// nabídky, nápověda, soubory a diagnostika fungují dál; jádro OCCT počítá i bez 3D okna.
// Místo 3D okna je softwarový náhled modelu; příčina a postup jsou pod tlačítkem „Proč nevidím 3D?“.
// Spuštění (výchozí server :3100): E2E_BASE=http://localhost:3100 node e2e/cad-webgl.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '') + '/cad';

(async () => {
  const b = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const consoleErrs = []; p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 });
  ok(await p.evaluate(() => !document.createElement('canvas').getContext('webgl') && !document.createElement('canvas').getContext('webgl2')), 'prostředí: WebGL je v prohlížeči vypnuté');
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  const fb = p.locator('[data-viewport-fallback]');
  ok(await fb.isVisible(), 'místo pádu je náhrada 3D okna');
  // se softwarovým náhledem modelu jsou příčina a postup pod tlačítkem „Proč nevidím 3D?“
  const why = p.locator('[data-soft-why]');
  if (await why.count()) await why.click();
  ok(await p.locator('[data-viewport-help]').isVisible(), 'Proč nevidím 3D? otevře příčinu a postup');
  const txt = await fb.innerText();
  ok(/3D okno nelze spustit/.test(txt), 'nadpis česky: 3D okno nelze spustit');
  ok(/neposkytl WebGL/.test(txt) && /grafickou akceleraci/.test(txt), 'příčina a postup: grafická akcelerace prohlížeče');
  ok(/vzdálenou plochu/.test(txt) && /jiný prohlížeč/.test(txt) && /jiné zařízení/.test(txt), 'postup: vzdálená plocha, jiný prohlížeč, jiné zařízení');
  ok(/nabídky, nápověda/.test(txt), 'upozornění, že zbytek programu funguje');
  ok(/3D okno: nedostupné/.test(await p.locator('header').first().innerText()), 'stav v horní liště: 3D okno nedostupné');
  await p.screenshot({ path: S + 'webgl-fallback.png' });
  // zbytek aplikace funguje: pás karet, nápověda, nabídka Soubor, načtení dílu (jádro OCCT počítá bez 3D)
  ok(await p.getByRole('button', { name: 'Tvorba', exact: true }).first().isVisible(), 'pás karet je dostupný');
  await p.getByRole('button', { name: 'Nápověda' }).click(); await p.waitForTimeout(400);
  ok(await p.getByRole('button', { name: /Dokumentace a návod k obsluze \(web\)/ }).isVisible(), 'nabídka Nápověda funguje');
  await p.getByRole('button', { name: /Zkopírovat diagnostiku/ }).first().click(); await p.waitForTimeout(500);
  const diag = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/Mnástrojárna CAD – diagnostika/.test(diag) && /WebGL: nedostupné/.test(diag) && /Prohlížeč: /.test(diag) && /Verze CADu: /.test(diag), 'Nápověda → Zkopírovat diagnostiku: verze, prohlížeč, WebGL');
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Příruba DN50/ }).click(); await p.waitForTimeout(4000);
  ok(/Díra 1/.test(await p.locator('aside').first().innerText()), 'díl se načte a jádro ho přepočítá i bez 3D okna');
  const tris = Number(await p.locator('[data-soft-canvas]').getAttribute('data-tris'));
  ok(tris > 100, `načtený díl je vidět v náhledu bez WebGL (${tris} trojúhelníků)`);
  ok(await fb.isVisible(), 'chybová obrazovka zůstává (3D se nezobrazí), aplikace nespadla');
  // diagnostika z chybové obrazovky obsahuje chybu rendereru, ale nic z dokumentu
  await fb.getByRole('button', { name: 'Zkopírovat diagnostiku' }).click(); await p.waitForTimeout(500);
  const diag2 = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/Chyba: /.test(diag2) && /Jádro OCCT: ready/.test(diag2), 'diagnostika z chybové obrazovky: chyba + stav jádra');
  ok(!/Příruba|Díra|features|extrude/i.test(diag2), 'diagnostika neobsahuje data dokumentu');
  // Zkusit znovu bez WebGL → znovu chybová obrazovka, žádný pád
  await fb.getByRole('button', { name: 'Zkusit znovu' }).click(); await p.waitForTimeout(1200);
  ok(await p.locator('[data-viewport-fallback]').isVisible(), 'Zkusit znovu bez WebGL: opět chybová obrazovka, bez pádu');
  // sdílení, nastavení a výkres fungují
  await p.getByRole('button', { name: 'Sdílet odkazem', exact: true }).click();
  await p.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 20000 });
  ok(true, 'sdílení odkazem funguje bez 3D okna');
  await p.getByRole('button', { name: 'Zavřít', exact: true }).last().click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click(); await p.waitForTimeout(3000);
  ok(await p.locator('[data-drawing-workspace]').isVisible(), 'výkres (2D) se otevře bez WebGL');
  await p.screenshot({ path: S + 'webgl-drawing.png' });
  ok(errs.length === 0, 'žádná nezachycená JS chyba (aplikace nespadla): ' + errs.join(' | '));
  console.log('konzole (chyby):', consoleErrs.slice(0, 3).map((s) => s.slice(0, 120)).join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
