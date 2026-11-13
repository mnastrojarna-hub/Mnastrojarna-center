// E2E: porovnání s referenčním modelem (úkol P2-11) – deska 100 × 60 × 20 jako model, varianta se dvěma dírami Ø10 a Ø6
// skrz jako „reference“ (export STEP přes window.mncad.exportFile), dialog Nástroje → Porovnat s referencí: rozdíl objemů,
// seznam oblastí, barevná mapa na modelu (pixely plátna), klik na oblast, ruční posun reference, export CSV, změna modelu.
// Spuštění: E2E_BASE=http://localhost:3204 node e2e/cad-compare.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 180000 });

const V10 = Math.PI * 25 * 20; // díra Ø10 × 20
const V6 = Math.PI * 9 * 20; // díra Ø6 × 20

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1430, height: 880 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept(d.defaultValue()).catch(() => {}));
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(p); await p.waitForTimeout(800);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  const canvas = p.locator('main canvas').first();
  /** podíl pixelů plátna podle barvy: zelená mapy (v toleranci), červená/oranžová (odchylka) */
  const pixels = async (name) => {
    const png = await canvas.screenshot({ path: S + name });
    return p.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let green = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], bb = d[i + 2];
        if (gg > r + 50 && gg > bb + 30) green++;
        if (r > 150 && r > gg + 70 && r > bb + 70) red++;
      }
      const n = d.length / 4;
      return { green: green / n, red: red / n, hash: d.length + ':' + Array.from(d.filter((_, i) => i % 997 === 0)).join(',').length + ':' + d.reduce((a, v, i) => (i % 13 === 0 ? (a * 31 + v) % 1000000007 : a), 7) };
    }, png.toString('base64'));
  };

  // ── reference: deska se dvěma dírami skrz → STEP ──
  let log = await run('nový díl Reference\nkvádr 100 60 20\ndíra 10 skrz v 30 30\ndíra 6 skrz v 70 30\nstav');
  await idle();
  ok(!log.split('\n').some((l) => l.startsWith('✗')), 'reference (deska s dírami Ø10 a Ø6) vytvořena bez chyb');
  const exp = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(exp.bytes > 3000 && /\.step$/.test(exp.name), `reference exportována do STEP (${exp.name}, ${exp.bytes} B)`);
  const stepBuf = Buffer.from(exp.base64, 'base64');
  ok(/ISO-10303-21/.test(stepBuf.subarray(0, 200).toString()), 'STEP má hlavičku ISO-10303-21');

  // ── model: deska bez děr ──
  log = await run('nový díl Deska model\nkvádr 100 60 20\nstav');
  await idle(); await p.waitForTimeout(1500);
  ok(!log.split('\n').some((l) => l.startsWith('✗')), 'model (deska 100 × 60 × 20 bez děr) vytvořen bez chyb');
  const before = await pixels('compare-0-model.png');
  ok(before.green < 0.01, `před porovnáním model není zelený (zelené pixely ${(before.green * 100).toFixed(2)} %)`);

  // ── dialog ──
  await p.getByRole('button', { name: 'Nástroje', exact: true }).click();
  await p.getByRole('button', { name: /Porovnat s referencí/ }).first().click();
  const dlg = p.locator('[data-compare-dialog]');
  await dlg.waitFor({ timeout: 10000 });
  ok(await dlg.isVisible(), 'Nástroje → Porovnat s referencí otevře dialog');
  ok(await dlg.getByRole('button', { name: /Vybrat referenci/ }).isVisible(), 'dialog: výběr souboru reference');
  await p.locator('[data-compare-file]').setInputFiles({ name: 'reference.step', mimeType: 'application/step', buffer: stepBuf });
  const t0 = Date.now();
  await p.waitForSelector('[data-compare-result]', { timeout: 240000 });
  await idle();
  const ms = Date.now() - t0;
  const res = await p.evaluate(() => { const e = document.querySelector('[data-compare-result]'); return { diff: +e.dataset.volumeDiff, extra: +e.dataset.extra, missing: +e.dataset.missing, regions: +e.dataset.regions }; });
  ok(Math.abs(res.diff - (V10 + V6)) < 0.5, `rozdíl objemů model − reference = ${res.diff.toFixed(2)} mm³ (očekáváno ${(V10 + V6).toFixed(2)} = díry Ø10 + Ø6), za ${ms} ms`);
  const diffText = await dlg.locator('[data-compare-diff]').innerText();
  ok(/2,136\s?cm³/.test(diffText), `dialog ukazuje rozdíl v cm³: „${diffText}“`);
  ok(Math.abs(res.extra - (V10 + V6)) < 0.5 && res.missing < 0.01, `navíc v modelu ${res.extra.toFixed(2)} mm³, chybí ${res.missing.toFixed(4)} mm³`);
  ok(res.regions === 2, `dvě rozdílové oblasti (${res.regions})`);
  const rows = await dlg.locator('[data-compare-region]').allInnerTexts();
  ok(rows.length === 2 && /Ø10,00/.test(rows[0]) && /1,571\s?cm³/.test(rows[0]) && /Ø6,00/.test(rows[1]) && /0,565\s?cm³/.test(rows[1]), 'oblasti seřazené podle objemu: díra Ø10 (1,571 cm³), díra Ø6 (0,565 cm³)\n   ' + rows.map((r) => r.replace(/\n/g, ' ')).join('\n   '));
  ok(/střed 30,0 \/ 30,0 \/ 10,0/.test(rows[0]), 'oblast 1: střed 30 / 30 / 10');
  ok(await dlg.locator('[data-compare-legend]').isVisible(), 'legenda barevné mapy je vidět');
  const legend = await dlg.locator('[data-compare-legend]').innerText();
  ok(/±0,100/.test(legend) && /Přesnost mapy ±/.test(legend), 'legenda: tolerance ±0,100 a přesnost mapy: ' + legend.replace(/\n/g, ' '));
  const within = await dlg.locator('[data-compare-stat="within"]').innerText();
  ok(/V toleranci/.test(within), 'statistika: podíl plochy v toleranci – ' + within.replace(/\n/g, ' '));
  await p.waitForTimeout(1200);
  const mapPx = await pixels('compare-1-map.png');
  ok(mapPx.green > 0.03 && mapPx.green > before.green * 5, `barevná mapa na modelu: zelené pixely ${(before.green * 100).toFixed(2)} % → ${(mapPx.green * 100).toFixed(2)} %`);
  ok(mapPx.red > before.red + 0.0005, `odchylka u děr je červená: ${(before.red * 100).toFixed(3)} % → ${(mapPx.red * 100).toFixed(3)} %`);

  // ── klik na oblast: zvýraznění a přiblížení, souřadnice ──
  await dlg.locator('[data-compare-region="1"]').click();
  await p.waitForTimeout(1200);
  const selTxt = await dlg.locator('[data-compare-selected]').innerText();
  ok(/Oblast 1/.test(selTxt) && /30,00 \/ 30,00 \/ 10,00/.test(selTxt) && /25,00 \/ 25,00 \/ 0,00/.test(selTxt), 'klik na oblast 1: souřadnice (střed 30/30/10, od 25/25/0): ' + selTxt.replace(/\n/g, ' '));
  const focusPx = await pixels('compare-2-region.png');
  ok(focusPx.hash !== mapPx.hash, 'klik na oblast změní pohled (přiblížení + zvýraznění)');
  await dlg.locator('[data-compare-region="1"]').click(); // druhý klik: zpět na celý model
  await p.waitForTimeout(1000);
  ok(!(await dlg.locator('[data-compare-selected]').isVisible().catch(() => false)), 'druhý klik na oblast zvýraznění zruší');
  const backPx = await pixels('compare-2b-fit.png');
  ok(backPx.green > 0.03, `a ukáže zase celý model s mapou (zelené ${(backPx.green * 100).toFixed(2)} %)`);

  // ── průhledná reference ──
  await dlg.getByText('Reference průhledně', { exact: true }).click();
  await p.waitForTimeout(800);
  await pixels('compare-3-ghost.png');
  ok(errs.length === 0, 'průhledná reference bez chyb');

  // ── vypnutí mapy ──
  await dlg.getByText('Barevná mapa odchylek', { exact: true }).click();
  await p.waitForTimeout(1000);
  const offPx = await pixels('compare-4-nomap.png');
  ok(offPx.green < mapPx.green / 3, `po vypnutí mapy zelená zmizí (${(offPx.green * 100).toFixed(2)} %)`);
  await dlg.getByText('Barevná mapa odchylek', { exact: true }).click();
  await dlg.getByText('Reference průhledně', { exact: true }).click();

  // ── ruční posun reference o 0,5 mm v X ──
  const offX = dlg.getByLabel('Posun X (mm)');
  await offX.fill('0,5'); await offX.press('Enter');
  await dlg.getByRole('button', { name: /Porovnat znovu/ }).click();
  await p.waitForFunction(() => +document.querySelector('[data-compare-result]')?.dataset.missing > 1, null, { timeout: 240000 });
  await idle();
  const shifted = await p.evaluate(() => { const e = document.querySelector('[data-compare-result]'); return { diff: +e.dataset.volumeDiff, extra: +e.dataset.extra, missing: +e.dataset.missing, regions: +e.dataset.regions }; });
  ok(Math.abs(shifted.missing - 600) < 1 && Math.abs(shifted.extra - (600 + V10 + V6)) < 1, `posun X 0,5 mm: chybí ${shifted.missing.toFixed(2)} mm³ (slupka 0,5 × 60 × 20 = 600), navíc ${shifted.extra.toFixed(2)} mm³`);
  ok(Math.abs(shifted.diff - (V10 + V6)) < 0.5, 'rozdíl objemů na poloze nezávisí');
  const align = await dlg.getByText(/Zarovnání:/).first().innerText();
  ok(/posun 0,500/.test(align), 'zarovnání v reportu: ' + align);

  // ── středy obalových kvádrů (bez posunu) → zase jen díry ──
  await offX.fill('0'); await offX.press('Enter');
  await dlg.getByRole('button', { name: 'Středy', exact: true }).click();
  await dlg.getByRole('button', { name: /Porovnat znovu/ }).click();
  await p.waitForFunction(() => +document.querySelector('[data-compare-result]')?.dataset.missing < 1, null, { timeout: 240000 });
  await idle();
  const centered = await p.evaluate(() => +document.querySelector('[data-compare-result]').dataset.extra);
  ok(Math.abs(centered - (V10 + V6)) < 0.5, `zarovnání středů: navíc ${centered.toFixed(2)} mm³`);

  // ── průběh výpočtu (ukazatel jádra) a zrušení ──
  const labels = await p.evaluate(async () => {
    const seen = new Set();
    document.querySelector('[data-compare-run]').closest('button').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const pr = window.mncad.progress();
      if (pr) seen.add(pr.op + ' | ' + pr.label);
      else if (seen.size) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    return [...seen];
  });
  ok(labels.length > 0 && labels.every((l) => l.startsWith('compare | ')) && labels.some((l) => /Porovnání \d\/\d: |Porovnávám s referenčním modelem/.test(l)), 'průběh porovnání v ukazateli jádra: ' + labels.slice(0, 6).join(' · '));
  await idle();
  const cancelled = await p.evaluate(async () => {
    document.querySelector('[data-compare-run]').closest('button').click();
    await new Promise((r) => setTimeout(r, 30));
    return window.mncad.cancel();
  });
  await dlg.locator('[data-compare-error]').waitFor({ timeout: 30000 }).catch(() => {});
  const cErr = await dlg.locator('[data-compare-error]').innerText().catch(() => '');
  ok(cancelled && /Porovnání bylo zrušeno/.test(cErr), 'Zrušit ukončí porovnání: ' + cErr);
  await p.waitForTimeout(1500); await idle();
  const st = await p.evaluate(() => window.mncad.status());
  ok(/objem 120/.test(st), 'po zrušení jádro znovu běží (stav modelu: objem 120 cm³)');
  await dlg.getByRole('button', { name: /Porovnat znovu/ }).click();
  await p.waitForFunction(() => !document.querySelector('[data-compare-error]') && !!document.querySelector('[data-compare-result]'), null, { timeout: 240000 });
  await idle();
  const again = await p.evaluate(() => +document.querySelector('[data-compare-result]').dataset.extra);
  ok(Math.abs(again - (V10 + V6)) < 0.5, `po zrušení jde porovnat znovu (navíc ${again.toFixed(2)} mm³)`);

  // ── export CSV ──
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), dlg.getByRole('button', { name: /CSV/ }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  fs.writeFileSync(S + 'compare-report.csv', csv);
  ok(/porovnani\.csv$/.test(dl.suggestedFilename()), 'CSV stažen: ' + dl.suggestedFilename());
  ok(/Rozdíl objemů model − reference \[cm³\];2,136/.test(csv) && /^1;navíc v modelu;1,571;/m.test(csv) && /^2;navíc v modelu;0,565;/m.test(csv), 'CSV: rozdíl objemů a tabulka oblastí');

  // ── změna modelu → mapa se skryje, výzva k novému porovnání ──
  await run('díra 4 skrz v 50 50');
  await idle(); await p.waitForTimeout(1500);
  ok(await dlg.getByText(/Model se od porovnání změnil/).isVisible(), 'po změně modelu dialog hlásí zastaralé porovnání');
  const stalePx = await pixels('compare-5-stale.png');
  ok(stalePx.green < mapPx.green / 3, 'zastaralá mapa se na modelu neukazuje');

  // ── zavření ──
  await p.locator('div.absolute.z-20').filter({ hasText: 'Porovnat s referenčním modelem' }).getByRole('button', { name: 'Zavřít' }).click();
  await p.waitForTimeout(500);
  ok(!(await dlg.isVisible().catch(() => false)), 'dialog zavřen');

  // ── angličtina: dialog bez češtiny, žádné chybějící překlady; úzké okno (telefon): panel se vejde ──
  const e = await ctx.newPage();
  await e.addInitScript(() => { window.showSaveFilePicker = undefined; });
  e.on('pageerror', (er) => errs.push('EN: ' + er.message));
  await e.goto(BASE + '/en/cad', { waitUntil: 'networkidle', timeout: 240000 });
  const ce = e.getByText('Continue working');
  if (await ce.isVisible({ timeout: 6000 }).catch(() => false)) await ce.click();
  await e.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Loading the OpenCascade/.test(document.body.innerText), null, { timeout: 180000 });
  await e.evaluate(() => window.mncad.run('new part Plate\nbox 100 60 20'));
  await e.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 }); await e.waitForTimeout(1500);
  await e.getByRole('button', { name: 'Tools', exact: true }).first().click();
  await e.getByRole('button', { name: /Compare with reference/ }).first().click();
  await e.locator('[data-compare-file]').setInputFiles({ name: 'reference.step', mimeType: 'application/step', buffer: stepBuf });
  await e.waitForSelector('[data-compare-result]', { timeout: 240000 });
  await e.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
  await e.locator('[data-compare-region="1"]').click(); await e.waitForTimeout(600);
  const enTxt = await e.locator('[data-compare-dialog]').innerText();
  ok(!/[ěščřžůĚŠČŘŽŮ]|Porovn|navíc|chybí|Oblast/.test(enTxt), 'EN: dialog bez češtiny' + ((enTxt.match(/.*([ěščřžůĚŠČŘŽŮ]|Porovn|navíc|chybí).*/) || [''])[0] ? ' ← ' + enTxt.match(/.*([ěščřžůĚŠČŘŽŮ]|Porovn|navíc|chybí).*/)[0] : ''));
  ok(/model lacks a hole \/ recess Ø10\.00/.test(enTxt) && /2\.136 cm³/.test(enTxt) && /Region 1: extra in model/.test(enTxt), 'EN: oblast a rozdíl objemů anglicky s desetinnou tečkou');
  const miss = await e.evaluate(() => window.mncad.missing().filter((k) => /\p{L}{3,}/u.test(k.replace(/\{\d+\}/g, ' '))));
  ok(miss.length === 0, 'EN: žádné chybějící překlady (' + miss.length + ') ' + miss.slice(0, 6).join(' | '));
  await e.screenshot({ path: S + 'compare-en.png' });
  await e.setViewportSize({ width: 390, height: 844 }); await e.waitForTimeout(800);
  await e.locator('div.absolute.z-20').filter({ hasText: 'Compare with reference model' }).getByRole('button', { name: 'Close' }).click();
  await e.waitForTimeout(400);
  const toolsBtn = e.getByRole('button', { name: 'Tools', exact: true }).first();
  if (await toolsBtn.isVisible().catch(() => false)) await toolsBtn.click();
  const cmpBtn = e.getByRole('button', { name: /Compare with reference/ }).first();
  const reachable = await cmpBtn.isVisible().catch(() => false);
  ok(reachable, 'telefon (390 px): tlačítko „Compare with reference“ je v kartě Tools dostupné');
  if (reachable) {
    await cmpBtn.click(); await e.waitForTimeout(600);
    const box = await e.locator('[data-compare-dialog]').boundingBox();
    ok(!!box && box.x >= 0 && box.x + box.width <= 390 + 1, `telefon: panel se vejde na šířku (x ${box && box.x.toFixed(0)}, šířka ${box && box.width.toFixed(0)} px)`);
    await e.screenshot({ path: S + 'compare-mobile.png' });
  }

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
