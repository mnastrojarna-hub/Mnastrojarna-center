// E2E – dříve neověřené body: uložené PDF výkresu (velikost listu, kóty, razítko – poppler), skutečné vypršení odkazu
// (posunutý čas), sdílení s heslem u příjemce, příliš velký model pro odkaz (srozumitelná chyba), STEP tam a zpět
// přes nezávislou importní knihovnu (occt-import-js) se shodou objemu, obnova po „pádu“ (obnovení stránky).
// Spuštění (server na :3100): node e2e/cad-verify.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const CAD = 'http://localhost:3100/cad';
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 120000 });
const start = async (page) => { const c = page.getByText('Pokračovat v práci'); if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click(); await coreReady(page); await page.waitForTimeout(800); };
const volumeOf = (st) => parseFloat(((st.match(/objem ([\d,]+) cm³/) || [, '0'])[1]).replace(',', '.'));
const has = (bin) => { try { execFileSync('which', [bin]); return true; } catch { return false; } };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  p.on('dialog', (d) => d.accept());
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 180000 }); await start(p);
  const log = await p.evaluate(() => window.mncad.run('nový díl Deska PDF\nmateriál ČSN 11 423\nkvádr 120 80 15\ndíra 10 skrz v 20 20\npole 2 rozteč 80 směr X 2 rozteč 40 směr Y\nzaoblit 5 hrany svislé\nstav'));
  const vol0 = volumeOf(log);
  ok(!/^✗/m.test(log) && vol0 > 100, `díl vytvořen, objem ${vol0} cm³`);

  // ── 1. uložené PDF výkresu: velikost listu, kóty, razítko ──
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /Výkres PDF/ }).click();
  await p.waitForFunction(() => /Rozměry v mm/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 120000 }); await p.waitForTimeout(800);
  const aside = p.locator('[data-drawing-workspace] aside').first();
  await aside.getByPlaceholder('např. ISO 2768-mK').fill('ISO 2768-mK');
  await p.waitForFunction(() => /2768/.test(document.querySelector('[data-sheet]')?.textContent || ''), null, { timeout: 60000 });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'PDF', exact: true }).click()]);
  const pdfPath = S + 'deska.pdf';
  await dl.saveAs(pdfPath);
  const size = fs.statSync(pdfPath).size;
  ok(size > 5000 && /\.pdf$/.test(dl.suggestedFilename()), `PDF uloženo: ${dl.suggestedFilename()} (${Math.round(size / 1024)} kB)`);
  if (has('pdfinfo') && has('pdftotext')) {
    const info = execFileSync('pdfinfo', [pdfPath]).toString();
    const pages = parseInt((info.match(/Pages:\s+(\d+)/) || [, '0'])[1]);
    const sz = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
    const wmm = sz ? Math.round((parseFloat(sz[1]) / 72) * 25.4) : 0;
    const hmm = sz ? Math.round((parseFloat(sz[2]) / 72) * 25.4) : 0;
    const sheet = (await p.locator('[data-sheet]').textContent()) || '';
    const expectA = /A3/.test(sheet) ? [420, 297] : /A4/.test(sheet) ? [297, 210] : /A2/.test(sheet) ? [594, 420] : null;
    ok(pages === 1 && (!expectA || (Math.abs(wmm - expectA[0]) <= 1 && Math.abs(hmm - expectA[1]) <= 1)), `PDF: 1 strana, rozměr listu ${wmm} × ${hmm} mm odpovídá formátu${expectA ? ` ${expectA.join('×')}` : ''}`);
    const text = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
    const dims = ['120', '80', '15', 'Ø10'];
    const missing = dims.filter((d) => !text.includes(d));
    ok(missing.length === 0, `PDF: kóty ${dims.join(', ')} jsou v textu (chybí: ${missing.join(', ') || 'nic'})`);
    ok(/Deska PDF/.test(text) && /ČSN 11 423/.test(text) && /ISO 2768-mK/.test(text) && /Rozměry v mm/.test(text), 'PDF: razítko (název, materiál ČSN 11 423, tolerance) je v textu');
    ok(!/0,5×45/.test(text), 'PDF: žádný nevyžádaný údaj o hranách');
  } else ok(true, 'pdfinfo/pdftotext nejsou k dispozici – rozměrová kontrola PDF přeskočena');
  if (has('pdftoppm')) {
    execFileSync('pdftoppm', ['-r', '60', '-png', '-singlefile', pdfPath, S + 'deska-pdf']);
    ok(fs.existsSync(S + 'deska-pdf.png') && fs.statSync(S + 'deska-pdf.png').size > 10000, 'PDF: vykreslený náhled uložen (deska-pdf.png) pro vizuální kontrolu');
  }
  await p.locator('[data-drawing-workspace] header').getByRole('button', { name: 'Zavřít', exact: true }).click(); await p.waitForTimeout(400);

  // ── 2. sdílení s heslem u příjemce + skutečné vypršení (posunutý čas) ──
  await p.getByRole('button', { name: 'Sdílet', exact: true }).click();
  const dlg = p.locator('div.fixed.z-\\[70\\]');
  await p.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 20000 });
  await dlg.getByRole('button', { name: '1 den', exact: true }).click();
  await dlg.getByLabel('Heslo k odkazu').fill('nda-2026');
  await p.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Sdílený odkaz"]'); return !!t && /#s=1dp\./.test(t.value); }, null, { timeout: 20000 });
  const urlPw = await dlg.getByLabel('Sdílený odkaz').inputValue();
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  const ctx2 = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const r = await ctx2.newPage();
  await r.goto(urlPw, { waitUntil: 'networkidle', timeout: 180000 }); await r.waitForTimeout(2500);
  const pw = r.getByLabel('Heslo sdíleného dokumentu');
  ok(await pw.isVisible(), 'příjemce: odkaz s heslem se bez hesla neotevře');
  await pw.fill('nda-2026'); await pw.press('Enter'); await coreReady(r); await r.waitForTimeout(3000);
  const stR = await r.evaluate(() => window.mncad.status());
  ok(Math.abs(volumeOf(stR) - vol0) < 0.01 && /ČSN 11 423/.test(stR), 'příjemce po heslu: shodný objem a materiál');
  // tentýž odkaz za 11 dní (čas posunutý v prohlížeči příjemce)
  const ctx3 = await b.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx3.addInitScript(() => { const real = Date.now; const shift = 11 * 86400000; Date.now = () => real() + shift; const OD = Date; window.Date = class extends OD { constructor(...a) { if (a.length) super(...a); else super(OD.now()); } static now() { return real() + shift; } }; });
  const x = await ctx3.newPage();
  await x.goto(urlPw, { waitUntil: 'networkidle', timeout: 180000 }); await x.waitForTimeout(2500);
  const pw2 = x.getByLabel('Heslo sdíleného dokumentu');
  if (await pw2.isVisible().catch(() => false)) { await pw2.fill('nda-2026'); await pw2.press('Enter'); await x.waitForTimeout(1500); }
  ok(/Platnost sdíleného odkazu vypršela/.test(await x.locator('body').innerText()), 'po vypršení (1 den, otevřeno za 11 dní) se odkaz neotevře a řekne proč');
  const stX = await x.evaluate(() => window.mncad.status());
  ok(!/Deska PDF/.test(stX), 'po vypršení není dokument načten');

  // ── 3. příliš velký model pro odkaz (bez úložiště) → srozumitelná chyba ──
  const big = await p.evaluate(() => {
    const u8 = new Uint8Array(300000); for (let i = 0; i < u8.length; i += 65536) crypto.getRandomValues(u8.subarray(i, Math.min(u8.length, i + 65536)));
    let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768));
    return window.mncad.run(JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Velký import', material: 'ocel', features: [{ type: 'box', size: [10, 10, 10] }, { type: 'import', fileName: 'velky.step', format: 'step', data: btoa(s) }] }));
  });
  ok(/dokument „Velký import“/.test(big), 'velký dokument (300 kB importu) otevřen v nové záložce');
  await p.getByRole('button', { name: 'Sdílet', exact: true }).click();
  await p.waitForFunction(() => /příliš velký/.test(document.querySelector('div.fixed.z-\\[70\\]')?.textContent || ''), null, { timeout: 30000 });
  ok(/příliš velký.*\.mncad/.test(await dlg.innerText()), 'příliš velký model: dialog vysvětlí, že se do odkazu nevejde, a poradí soubor / úložiště');
  await dlg.getByRole('button', { name: 'Zavřít', exact: true }).last().click();

  // ── 4. STEP tam a zpět přes nezávislou importní knihovnu (occt-import-js) ──
  await p.evaluate(() => window.mncad.run('nový díl Příruba\nskica XY: kružnice 165; kružnice 61\nvysunout 18\ntrubka 88 61 30 v 0 0 18\ndíra 18 skrz v 62,5 0\npole kruhové 4\nsrazit 1,5'));
  const stA = await p.evaluate(() => window.mncad.status());
  const exp = await p.evaluate(() => window.mncad.exportFile('step'));
  await p.locator('input[type=file]').first().setInputFiles({ name: 'priruba.step', mimeType: 'application/step', buffer: Buffer.from(exp.base64, 'base64') });
  await p.waitForFunction(() => /priruba/.test(document.body.innerText), null, { timeout: 120000 }); await p.waitForTimeout(4000);
  const stB = await p.evaluate(() => window.mncad.status());
  const vA = volumeOf(stA), vB = volumeOf(stB);
  ok(/\[import/.test(stB) && Math.abs(vA - vB) / vA < 0.002, `STEP export (OCCT/replicad) → import (occt-import-js): objem ${vA} → ${vB} cm³ (rozdíl ${(Math.abs(vA - vB) / vA * 100).toFixed(3)} %)`);
  const bboxA = (stA.match(/Rozměry: [^·]+/) || [''])[0], bboxB = (stB.match(/Rozměry: [^·]+/) || [''])[0];
  ok(bboxA.trim() === bboxB.trim(), `STEP: shodné rozměry obálky (${bboxA.trim()})`);

  // ── 5. obnova po „pádu“ – šifrované úložiště: obnovení stránky vrátí rozpracovaný díl ──
  await p.keyboard.press('Control+,'); await p.waitForTimeout(400);
  const sdlg = p.locator('div.fixed.z-\\[70\\]');
  await sdlg.locator('nav').getByRole('button', { name: 'Soubory', exact: true }).click();
  await sdlg.getByLabel('Nové heslo').fill('obnova123'); await sdlg.getByLabel('Heslo znovu').fill('obnova123');
  await sdlg.getByRole('button', { name: 'Zapnout šifrované úložiště' }).click(); await p.waitForTimeout(800);
  await sdlg.getByRole('button', { name: 'Storno' }).click(); await p.waitForTimeout(300);
  await p.evaluate(() => window.mncad.run('nový díl Před pádem\nkvádr 30 20 10\ndíra 6 skrz v 15 10'));
  await p.waitForTimeout(2500);
  await p.reload({ waitUntil: 'networkidle' });
  const c2 = p.getByText('Pokračovat v práci'); if (await c2.isVisible({ timeout: 6000 }).catch(() => false)) await c2.click();
  await coreReady(p); await p.waitForTimeout(3000);
  const stC = await p.evaluate(() => window.mncad.status());
  ok(/Před pádem/.test(stC) && /Díra 1/.test(stC), 'po obnovení stránky (pád prohlížeče) se rozpracovaný díl vrátil ze šifrovaného úložiště');

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
