// E2E: sdílení odkazem – tlačítko Sdílet, dialog (platnost, heslo, WhatsApp / e-mail / kopírovat), otevření odkazu
// v jiném prohlížeči (snímek + pruh „Sdílený dokument“, nic se neukládá, přežije F5), heslo, výkres, neplatný odkaz, mobil.
// Spuštění (server na E2E_BASE, výchozí :3100): node e2e/cad-share.e2e.cjs <složka pro výstupy>
// Režim „v odkazu“ (#s=): server bez úložiště /cad/share/ (next dev / next start); krátké odkazy testuje cad-w8-share.e2e.cjs.
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '') + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
const ready = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(page);
  await page.waitForTimeout(800);
};
const linkValue = async (dlg, page, notEqual) => {
  await page.waitForFunction((prev) => { const t = document.querySelector('[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http') && t.value !== prev; }, notEqual ?? null, { timeout: 20000 });
  return dlg.getByLabel('Sdílený odkaz').inputValue();
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await ready(p);

  // ── odesílatel ──
  const shareBtn = p.getByRole('button', { name: 'Sdílet odkazem', exact: true });
  ok(await shareBtn.isDisabled(), 'prázdný dokument: Sdílet je neaktivní');
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Příruba DN50/ }).click(); await p.waitForTimeout(3000);
  ok(await shareBtn.isEnabled(), 'po načtení dílu je Sdílet aktivní');
  await shareBtn.click();
  const dlg = p.locator('div.fixed.z-\\[70\\]');
  const url = await linkValue(dlg, p);
  ok(url.startsWith(CAD + '#s=1d.'), `odkaz vytvořen hned po otevření (${url.length} znaků)`);
  ok(url.length < 8000, 'parametrický díl se vejde do krátkého odkazu');
  const txt = await dlg.innerText();
  ok(/Platí do/.test(txt) && /na server se nic neposílá/.test(txt), 'dialog ukazuje platnost a režim „jen v odkazu“');
  ok(await dlg.getByRole('button', { name: 'WhatsApp' }).isEnabled() && await dlg.getByRole('button', { name: 'E-mail' }).isEnabled(), 'tlačítka WhatsApp a E-mail');
  await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await p.waitForTimeout(500);
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(clip === url, 'Kopírovat odkaz → odkaz je ve schránce');
  await dlg.getByRole('button', { name: 'Kopírovat zprávu' }).click(); await p.waitForTimeout(500);
  const msg = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(msg.includes('Příruba DN50') && msg.includes(url), 'Kopírovat zprávu → text s názvem a odkazem');
  await p.screenshot({ path: S + 'share-dialog.png' });
  // platnost 1 den + heslo
  await dlg.getByRole('button', { name: '1 den', exact: true }).click();
  const url1 = await linkValue(dlg, p, url);
  ok(url1 !== url, 'změna platnosti přegeneruje odkaz');
  await dlg.getByLabel('Heslo k odkazu').fill('tajne');
  const urlPw = await linkValue(dlg, p, url1);
  ok(urlPw.includes('#s=1dp.'), 'odkaz s heslem má jiný tvar (šifrováno)');
  ok(/chráněno heslem/.test(await dlg.innerText()), 'dialog ukazuje „chráněno heslem“');
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  ok(!(await dlg.isVisible().catch(() => false)), 'dialog zavřen');

  // ── příjemce: jiný prohlížeč (nový kontext) ──
  const ctx2 = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const r = await ctx2.newPage();
  const errs2 = []; r.on('pageerror', (e) => errs2.push(e.message));
  await r.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  ok(!r.url().includes('#'), 'část za # je z adresy hned odstraněna (historie, měření)');
  await coreReady(r); await r.waitForTimeout(3500);
  const banner = r.locator('[role=status]').first();
  ok(/Sdílený dokument/.test(await banner.innerText().catch(() => '')), 'příjemce vidí pruh „Sdílený dokument“');
  ok(/Díra 1/.test(await r.locator('aside').first().innerText()), 'příjemce má otevřený díl s historií prvků');
  ok(!(await r.getByText('Pokračovat v práci').isVisible().catch(() => false)), 'úvodní obrazovka sdílený díl nepřekrývá');
  ok((await r.locator('[role=tab][aria-selected="true"] input').inputValue()) === 'Příruba DN50', 'záložka příjemce nese název dílu');
  const stored = await r.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mn-cad-doc') || k === 'mn-cad-recent-v1'));
  ok(stored.length === 0, 'u příjemce se do localStorage nic neuložilo');
  await r.screenshot({ path: S + 'share-recipient.png' });
  await r.reload({ waitUntil: 'networkidle' }); await coreReady(r); await r.waitForTimeout(3500);
  ok(/Díra 1/.test(await r.locator('aside').first().innerText()), 'po F5 v téže kartě sdílený díl zůstává');
  await r.locator('[role=status]').getByRole('button', { name: 'Skrýt' }).click();
  ok(!(await r.locator('[role=status]').isVisible().catch(() => false)), 'pruh lze skrýt');

  // ── heslo ──
  const r2 = await ctx2.newPage();
  await r2.goto(urlPw, { waitUntil: 'networkidle', timeout: 180000 }); await r2.waitForTimeout(2500);
  const pw = r2.getByLabel('Heslo sdíleného dokumentu');
  ok(await pw.isVisible(), 'odkaz s heslem: dotaz na heslo');
  await pw.fill('spatne'); await r2.getByRole('button', { name: 'Otevřít', exact: true }).click(); await r2.waitForTimeout(2000);
  ok(/Nesprávné heslo/.test(await r2.locator('div.fixed.z-\\[70\\]').innerText()), 'špatné heslo odmítnuto');
  await pw.fill('tajne'); await pw.press('Enter');
  await coreReady(r2); await r2.waitForTimeout(3500);
  ok(/Díra 1/.test(await r2.locator('aside').first().innerText()), 'správné heslo otevře díl');
  ok(/platí do/.test(await r2.locator('[role=status]').first().innerText().catch(() => '')), 'pruh ukazuje platnost');

  // ── výkres: sdílení z výkresové záložky → příjemci se otevře výkres ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click(); await p.waitForTimeout(2500);
  ok(/Výkres/.test(await p.locator('[role=tab][aria-selected="true"]').innerText()), 'odesílatel: aktivní výkresová záložka');
  await p.locator('[data-drawing-workspace]').getByRole('button', { name: 'Sdílet odkazem', exact: true }).click();
  const urlDrw = await linkValue(dlg, p);
  ok(/příjemci se otevře rovnou výkres/.test(await dlg.innerText()), 'dialog: sdílí se včetně výkresu');
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  const r3 = await ctx2.newPage();
  await r3.goto(urlDrw, { waitUntil: 'networkidle', timeout: 180000 }); await coreReady(r3); await r3.waitForTimeout(5000);
  const tabs3 = await r3.locator('[role=tab]').allInnerTexts();
  ok(tabs3.some((t) => /Výkres/.test(t)), 'příjemce má i výkresovou záložku (' + tabs3.join(' | ') + ')');
  ok(/Výkres/.test(await r3.locator('[role=tab][aria-selected="true"]').innerText()), 'příjemci se otevřel rovnou výkres');
  await r3.screenshot({ path: S + 'share-drawing.png' });

  // ── neplatný odkaz ──
  const r4 = await ctx2.newPage();
  await r4.goto(CAD + '#s=1d.AAAAAAAA', { waitUntil: 'networkidle', timeout: 180000 }); await r4.waitForTimeout(2500);
  ok(/nelze otevřít/.test(await r4.locator('body').innerText()), 'neplatný odkaz: srozumitelné hlášení');

  // ── mobil: dialog použitelný na 390 px ──
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await m.locator('[role=status]').first().waitFor({ timeout: 120000 }); await m.waitForTimeout(2500); // stav jádra je na mobilu skrytý
  await m.getByRole('button', { name: 'Sdílet odkazem', exact: true }).click();
  const mdlg = m.locator('div.fixed.z-\\[70\\]');
  await linkValue(mdlg, m);
  ok(await mdlg.getByRole('button', { name: 'Kopírovat odkaz' }).isVisible(), 'mobil: dialog sdílení s tlačítky');
  const over = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!over, 'mobil: dialog nepřetéká');
  await m.screenshot({ path: S + 'share-mobile.png' });

  ok(errs.length === 0 && errs2.length === 0, 'bez JS chyb ' + [...errs, ...errs2].join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
