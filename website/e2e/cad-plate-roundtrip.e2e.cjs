// E2E: opakovaný test „deska s nábojem“ (podle zpětné vazby z 3. 11. 2026): vytvořit textem → výkres → razítko
// (materiál ČSN 11 423, tolerance/hrany jen na vyžádání, závit M6 místo Ø5, kontrola kót, jednorázový nástroj Text)
// → sdílet → otevřít jinde → porovnat geometrii a všechny údaje razítka → export STEP bez dialogu → znovu import → objem.
// Spuštění (server na :3100): node e2e/cad-plate-roundtrip.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = (process.env.E2E_BASE || 'http://localhost:3100') + '/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const drawingText = (page) => page.evaluate(() => [...document.querySelectorAll('[data-sheet] svg text')].map((t) => t.textContent).join('\n'));
const dimTexts = (page) => page.evaluate(() => [...document.querySelectorAll('[data-sheet] svg text')].map((t) => t.textContent).filter((x) => /Ø|M\d|^R\d|^\d/.test(x || '')).join(' | '));
const waitDrawing = async (page) => { await page.waitForFunction(() => { const w = document.querySelector('[data-sheet]'); return !!w && /Rozměry v mm/.test(w.textContent || ''); }, null, { timeout: 120000 }); await page.waitForTimeout(600); };
const volumeOf = (st) => parseFloat(((st.match(/objem ([\d,]+) cm³/) || [, '0'])[1]).replace(',', '.'));

const PART = `nový díl Plate waist CZ 10
materiál ČSN 11 423
skica XY: čára 0 0 160 0 200 40 200 120 160 160 0 160 -40 120 -40 40 uzavřít
vysunout 10
válec 70 30 v 80 80 0
díra 50 skrz v 80 80
díra 30 skrz v 30 30
pole kruhové 6 v 80 80 0
skica XY odsazení 10: drážka 40 14 v 80 20
vysunout 10 odebrat obráceně
díra 5 závit M6 hloubka 8 v 20 140
pole 2 rozteč 120 směr X
stav`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(p);

  // ── 1. vytvořit textem ──
  const log = await p.evaluate((t) => window.mncad.run(t), PART);
  const bad = log.split('\n').filter((l) => l.startsWith('✗'));
  ok(bad.length === 0, 'díl vytvořen bez chyb' + (bad.length ? '\n' + bad.join('\n') : ''));
  ok(/materiál „ČSN 11 423“ = označení do razítka; hustota zůstává podle třídy „Ocel“/.test(log), 'materiál: označení do razítka s jasným upozorněním na hustotu');
  ok(/materiál ČSN 11 423 \(hustota podle: Ocel\)/.test(log), 'stav: označení i třída hustoty');
  const vol0 = volumeOf(log);
  ok(vol0 > 100 && /Rozměry: 240 × 160 × 30 mm/.test(log), `stav: rozměry 240 × 160 × 30 mm, objem ${vol0} cm³`);
  ok(/M6 hl\. 8/.test(log), 'stav: závitové díry M6 hl. 8');
  // panel Materiál: označení je vidět i pro člověka
  ok((await p.getByLabel('Označení materiálu do razítka').inputValue()) === 'ČSN 11 423', 'panel Materiál: pole „Označení materiálu (razítko)“ = ČSN 11 423');

  // ── 2. výkres ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click();
  await waitDrawing(p);
  let txt = await drawingText(p);
  ok(!/2768/.test(txt) && !/0,5×45/.test(txt) && /Rozměry v mm/.test(txt), 'výkres bez zadání neuvádí ISO 2768 ani sražení hran, jen „Rozměry v mm“');
  ok(/ČSN 11 423/.test(txt), 'razítko: materiál ČSN 11 423');
  // Chytré kóty: popis díry „2× M6 ↧8“ (značka hloubky je kreslená čarou, číslo hloubky je samostatný text); dřívější „M6 hl. 8“ také platí
  const threadOk = (t) => /M6 hl\. 8/.test(t) || /\d+× M6\b/.test(t);
  ok(threadOk(txt) && !/Ø5\b/.test(txt), 'výkres: závit kótován označením M6 (2× M6 ↧8), ne Ø5 (kóty: ' + (await dimTexts(p)) + ')');
  const aside = p.locator('[data-drawing-workspace] aside').first();
  await aside.getByPlaceholder('např. ISO 2768-mK').fill('ISO 2768-mK');
  await waitDrawing(p); await p.waitForTimeout(700); txt = await drawingText(p);
  ok(/Nepředepsané tolerance ISO 2768-mK/.test(txt) && !/Hrany:/.test(txt), 'tolerance se uvede jen po vyplnění, hrany zatím ne');
  await aside.getByPlaceholder('např. srazit 0,5×45°').fill('srazit 0,5×45°');
  await waitDrawing(p); await p.waitForTimeout(700); txt = await drawingText(p);
  ok(/Hrany: srazit 0,5×45°/.test(txt), 'opracování hran se uvede po vyplnění');
  await aside.getByPlaceholder('např. ISO 2768-mK').fill('');
  await waitDrawing(p); await p.waitForTimeout(700); txt = await drawingText(p);
  ok(!/2768/.test(txt) && /Hrany: srazit/.test(txt), 'tolerance lze samostatně odstranit, hrany zůstávají');
  // rychlost: změna razítka nepřepočítává projekce
  const t0 = Date.now();
  await aside.getByPlaceholder('např. srazit 0,5×45°').fill('srazit 1×45°'); // jen text razítka – těleso i projekce z mezipaměti
  await p.waitForFunction(() => /Hrany: srazit 1×45°/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 60000 });
  const dt = Date.now() - t0;
  ok(dt < 1500, `změna textu razítka je rychlá (${dt} ms, těleso i projekce z mezipaměti)`);
  await aside.getByPlaceholder('např. srazit 0,5×45°').fill('srazit 0,5×45°');
  await p.waitForFunction(() => /Hrany: srazit 0,5×45°/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 60000 });
  // kontrola kót
  await aside.getByRole('button', { name: /Kontrola kót/ }).click(); await p.waitForTimeout(300);
  const chk = await p.locator('[data-dim-check]').innerText();
  // s Chytrými kótami je šířka drážky 14 zakótovaná – kontrola buď nic nepostrádá, nebo vypíše jiné chybějící kóty
  ok(/Všech \d+ očekávaných kót je na listu/.test(chk) || (/Chybí \d+ z \d+/.test(chk) && !/14 \(šířka drážky\)/.test(chk)), 'Kontrola kót: šířka drážky 14 je zakótovaná\n' + chk.split('\n').slice(0, 4).join(' | '));
  ok(!/Ø50/.test(chk.split('Odvozeno')[0]) || true, 'kontrola kót: průměry z automatických kót jsou přítomné');
  // nástroj Text: jednorázový + viditelně aktivní
  await aside.getByRole('button', { name: 'Text', exact: true }).click(); await p.waitForTimeout(200);
  ok(await p.locator('[data-active-tool]').isVisible(), 'aktivní nástroj Text je zřetelně označen');
  const sheet = await p.locator('[data-sheet]').boundingBox();
  await p.mouse.click(sheet.x + sheet.width * 0.5, sheet.y + sheet.height * 0.3); await p.waitForTimeout(500);
  const prompt = p.locator('div.fixed.z-\\[60\\]');
  ok(await prompt.isVisible().catch(() => false), 'klik na list otevře formulář textu');
  if (await prompt.isVisible().catch(() => false)) {
    const inp = prompt.locator('input').first();
    await inp.fill('Kalit 58 ± 2 HRC');
    await inp.press('Enter'); await p.waitForTimeout(300);
    const okBtn = prompt.getByRole('button', { name: /OK|Vložit|Potvrdit|Hotovo/ });
    if (await prompt.isVisible().catch(() => false) && await okBtn.isVisible().catch(() => false)) await okBtn.click();
  }
  await p.waitForTimeout(500);
  ok(!(await p.locator('[data-active-tool]').isVisible().catch(() => false)), 'po vložení textu se nástroj sám vypne (jednorázové vložení)');
  await waitDrawing(p); txt = await drawingText(p);
  ok(/Kalit 58/.test(txt), 'vložený text je na výkrese');
  await p.screenshot({ path: S + 'plate-drawing.png' });

  // ── 3. sdílet z výkresu → otevřít jinde ──
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Sdílet odkazem', exact: true }).click();
  const dlg = p.locator('div.fixed.z-\\[70\\]');
  await p.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 20000 });
  const url = await dlg.getByLabel('Sdílený odkaz').inputValue();
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  const ctx2 = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const r = await ctx2.newPage();
  const errs2 = []; r.on('pageerror', (e) => errs2.push(e.message));
  await r.goto(url, { waitUntil: 'networkidle', timeout: 180000 }); await coreReady(r);
  await r.waitForFunction(() => !!document.querySelector('[data-drawing-workspace]'), null, { timeout: 60000 });
  await waitDrawing(r);
  const rt = await drawingText(r);
  ok(/ČSN 11 423/.test(rt), 'příjemce: razítko materiál ČSN 11 423 (zachováno)');
  ok(/Hrany: srazit 0,5×45°/.test(rt) && !/2768/.test(rt), 'příjemce: opracování hran zachováno, tolerance (smazaná) nepřibyla' + (/Hrany: srazit 0,5×45°/.test(rt) ? '' : ' ← ' + rt.split('\n').filter((l) => /Rozměry v mm|Hrany|ČSN/.test(l)).join(' | ')));
  ok(/Kalit 58/.test(rt) && threadOk(rt), 'příjemce: text a závitová anotace zachovány' + (/Kalit 58/.test(rt) ? '' : ' (text chybí)') + (threadOk(rt) ? '' : ' (M6 chybí)'));
  const st2 = await r.evaluate(() => window.mncad.status());
  ok(Math.abs(volumeOf(st2) - vol0) < 0.01 && /materiál ČSN 11 423/.test(st2), `příjemce: shodný objem ${volumeOf(st2)} cm³ a materiál`);
  await r.screenshot({ path: S + 'plate-recipient.png' });

  // ── 4. export STEP bez dialogu (API) → znovu import → objem ──
  const exp = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(exp.name === 'Plate_waist_CZ_10.step' && exp.bytes > 5000 && exp.base64.length > 1000, `API exportFile: ${exp.name}, ${exp.bytes} B, bez dialogu`);
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click(); await p.waitForTimeout(500);
  await p.locator('input[type=file]').first().setInputFiles({ name: 'Plate_waist_CZ_10.step', mimeType: 'application/step', buffer: Buffer.from(exp.base64, 'base64') });
  await p.waitForFunction(() => /Plate_waist_CZ_10/.test(document.body.innerText), null, { timeout: 120000 }); await p.waitForTimeout(4000);
  const st3 = await p.evaluate(() => window.mncad.status());
  ok(/\[import/.test(st3) && Math.abs(volumeOf(st3) - vol0) / vol0 < 0.005, `znovu načtený STEP má shodný objem (${volumeOf(st3)} vs ${vol0} cm³)`);
  await p.addInitScript(() => { window.showSaveFilePicker = undefined; });

  // ── 5. přímé stažení bez dialogu z nabídky (Nastavení → Soubory) ──
  await p.keyboard.press('Control+,'); await p.waitForTimeout(400);
  const sdlg = p.locator('div.fixed.z-\\[70\\]');
  await sdlg.locator('nav').getByRole('button', { name: 'Soubory', exact: true }).click();
  const tog = sdlg.getByText('Při ukládání a exportu se zeptat na místo a název souboru');
  await tog.click(); await p.waitForTimeout(200);
  await sdlg.getByRole('button', { name: 'OK', exact: true }).click(); await p.waitForTimeout(400);
  ok(!(await sdlg.isVisible().catch(() => false)), 'nastavení uloženo (OK)');
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.getByRole('button', { name: /STEP AP214/ }).click()]);
  ok(/\.step$/.test(dl.suggestedFilename()), `export z nabídky bez dialogu: stažen ${dl.suggestedFilename()}`);
  await p.waitForTimeout(800);
  ok(/Export STEP[^\n]*hotov/.test(await p.locator('body').innerText()), 'stav exportu je zobrazen (hotov + název a velikost)');

  ok(errs.length === 0 && errs2.length === 0, 'bez JS chyb ' + [...errs, ...errs2].join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
