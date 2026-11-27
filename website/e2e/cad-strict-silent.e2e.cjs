// E2E: žádné tiché změny a přísný režim v prohlížeči (balík B4 strict-silent, CAD-HEADLESS-NAVRH.md kap. 5) – konzole
// a window.mncad.run používají tentýž engine jako CLI, takže kódy ⚠/✗ a STOP přísného režimu platí i tady:
//  * řádek `přísně` + varování rozboru = nic se neprovede, konzole „■ přísný režim: zastaveno na řádku N (kód)“;
//  * přísný běh se zastaví na řádku prvku, který se nepostavil (stavba po každé operaci), další řádky se neprovedou;
//  * prvek dílu, ze kterého běh odešel (nový díl), se ohlásí až po stavbě – chybné zaoblení je ✗, ne ✓ (zkouška 959);
//  * tiché změny zápisu mají řádek ⚠ (díra bez hloubky, materiál jen označením, zahloubení u závitu);
//  * kolize šroub × závitová díra není ⚠ (ℹ clash.thread), skutečná kolize ano;
//  * 27× nový díl v jednom běhu = 27 záložek (B2), nová sestava + nový díl = obě záložky (B1).
// Opravy po recenzi (stejný výsledek jako CLI pro týž skript):
//  * ⚠ za `přísně vyp` nezastaví; překryv popisku opravený dalším příkazem bloku `výkres …` nezastaví;
//  * řez mimo těleso je ✗ i v normálním běhu (bez exportu, bez otevření výkresu);
//  * JSON dokument na 1. řádku, ze kterého běh odešel, se ověří (✗ chybného zaoblení);
//  * šroub v plném materiálu desky s několika závitovými dírami je skutečná kolize (⚠), ne šroub v závitu.
// Spuštění: E2E_BASE=http://localhost:3214 node e2e/cad-strict-silent.e2e.cjs
const { chromium } = require('playwright');

const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';

async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 3000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && document.body.innerText.includes('OCCT') && !document.body.innerText.includes('Načítám jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}
const run = (p, text) => p.evaluate((t) => window.mncad.run(t), text);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // 1) přísně + varování rozboru: STOP před během
    {
      const { ctx, p, errs } = await fresh(browser);
      const out = await run(p, 'přísně\nnový díl A\nkvádr 40 40 10\ndíra 5 v 10 10 10');
      ok(/⚠ řádek 4: díra bez hloubky – vrtá se skrz/.test(out), 'přísně: ⚠ hole.depth-default na řádku 4');
      ok(/■ přísný režim: zastaveno na řádku 4 \(hole\.depth-default\)/.test(out), 'přísně: konzole hlásí STOP na řádku 4');
      const tabs = await p.evaluate(() => window.mncad.tabs().map((t) => t.title));
      ok(!tabs.includes('A'), `přísně: nic se neprovedlo (záložky ${JSON.stringify(tabs)})`);
      ok(!errs.length, `bez chyb stránky (${errs.join(' | ')})`);
      await ctx.close();
    }
    // 2) přísný běh se zastaví na řádku chybného prvku
    {
      const { ctx, p } = await fresh(browser);
      const out = await run(p, 'přísně\nnový díl B\nkvádr 10 10 10\nzaoblit 40\nválec 2 2');
      ok(/■ přísný režim: zastaveno na řádku 4 \(feature\.failed\)/.test(out), 'přísně za běhu: STOP na řádku 4 (feature.failed)');
      const types = await p.evaluate(() => window.mncad.getDocument().features.map((f) => f.type));
      ok(!types.includes('cylinder'), `přísně za běhu: válec (ř. 5) se neprovedl (${JSON.stringify(types)})`);
      await ctx.close();
    }
    // 3) prvky dílu, ze kterého běh odešel, se ověří stavbou; tiché změny ⚠; 27 záložek; B1
    {
      const { ctx, p, errs } = await fresh(browser);
      const out = await run(p, 'nový díl C\nkvádr 10 10 10\nzaoblit 40\nmateriál XY-123\nnový díl D\nkvádr 20 20 20\ndíra skrz v 10 10 20 zahloubení 16 5 závit M8');
      ok(/✗ Zaoblení 1 \(fillet\)/.test(out) && !/✓ Zaoblení 1/.test(out), 'díl, ze kterého běh odešel: chybné zaoblení je ✗, ne ✓');
      ok(/⚠ řádek 4: materiál „XY-123“ zadán jen označením/.test(out), 'materiál jen označením: ⚠ material.density-assumed');
      // rozhodnutí 15.3 (vlna 15): zahloubení + vrták + závit se postaví – žádné ⚠ hole.cbore-dropped, díra ✓
      ok(!/zahloubení Ø16 se u díry se závitem M8 nepostaví/.test(out) && /✓ Díra 1 \(hole\)/.test(out), 'zahloubení u závitové díry se postaví (rozhodnutí 15.3), bez ⚠ hole.cbore-dropped');
      const many = await run(p, Array.from({ length: 27 }, (_, i) => `nový díl P${i + 1}\nkvádr 1 1 ${i + 1}`).join('\n'));
      await p.waitForTimeout(800);
      const tabs = await p.evaluate(() => window.mncad.tabs().filter((t) => /^P\d+$/.test(t.title)).length);
      ok(tabs === 27, `27× nový díl = 27 záložek (${tabs})`);
      ok(!/^✗/m.test(many), '27× nový díl bez řádku ✗');
      await run(p, 'nová sestava S\nnový díl E\nkvádr 1 1 1');
      await p.waitForTimeout(500);
      const t2 = await p.evaluate(() => window.mncad.tabs().map((t) => t.title));
      ok(t2.includes('S') && t2.includes('E'), 'nová sestava + nový díl: obě záložky (B1)');
      ok(!errs.length, `bez chyb stránky (${errs.join(' | ')})`);
      await ctx.close();
    }
    // 4) kolize: šroub v závitové díře ℹ (bez ⚠), skutečná kolize ⚠
    {
      const { ctx, p } = await fresh(browser);
      const out = await run(p, [
        'nový díl Deska', 'kvádr 40 40 20', 'díra závit M8 hloubka 20 hloubka-závitu 16 v 20 20 20',
        'nový díl Šroub M8x20', 'válec 8 20', 'nový díl Kostka', 'kvádr 5 5 5',
        'nová sestava S', 'vložit "Deska" ukotvit', 'vložit "Šroub M8x20" v 20 20 2', 'vložit "Kostka" v 35 35 18', 'kolize',
      ].join('\n'));
      ok(/kolize: 2 – šroub v závitu 1, skutečné 1/.test(out), `kolize podle tříd (${(out.match(/kolize: .*/) || [''])[0]})`);
      ok(/⚠ řádek 12: kolize „Deska“ × „Kostka“/.test(out), 'skutečná kolize ⚠ clash.real');
      ok(!/⚠ řádek 12: kolize „Deska“ × „Šroub/.test(out), 'šroub v závitu bez ⚠');
      await ctx.close();
    }
    // 5) recenze B4: úseky přísného režimu, blok výkresu, list v normálním běhu, načtený JSON, šroub mimo díry
    {
      const { ctx, p, errs } = await fresh(browser);
      const off = await run(p, 'přísně\nnový díl F\nkvádr 40 40 20\npřísně vyp\ndíra 5 v 10 10');
      ok(/⚠ řádek 5: díra bez hloubky/.test(off) && !/■ přísný režim/.test(off), 'přísně vyp: ⚠ za vypnutím nezastaví');
      // list kvádru bez úplných kót hlásí i kontrolu kót (vlna 22, bod 18 – ⚠ drawing.dims-incomplete); případ zkoumá překryv,
      // proto přísný režim s výjimkou pro neúplné kóty (ta se ohlásí jako ⚠, nezastaví)
      const block = await run(p, 'přísně kromě drawing.dims-incomplete\nnový díl G\nkvádr 20 20 10\nvýkres A4\nvýkres značka text "ODMASTIT KONZERVOVAT" v 240 20 výška 5\nvýkres upravit a4 posun="-150 120"\nválec 2 2');
      ok(!/■ přísný režim/.test(block) && !/překryv na listu/.test(block) && /kóty neúplné/.test(block), 'výkres: překryv opravený v témže bloku nezastaví ani nehlásí ⚠');
      const miss = await run(p, 'nový díl H\nkvádr 20 20 10\nvýkres A4 řez XZ odsazení 500\nvýkres měřítko 1:1\nválec 2 2');
      ok(/✗ řádek 4: rovina řezu neprotíná těleso/.test(miss), `řez mimo těleso = ✗ v normálním běhu (${(miss.match(/.*neprotíná.*/) || ['—'])[0]})`);
      const json = JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'J', material: 'ocel', features: [{ id: 'k1', name: 'Kvádr 1', type: 'box', size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: 'new' }, { id: 'z1', name: 'Zaoblení 1', type: 'fillet', radius: 40, edges: 'all' }] });
      const loaded = await run(p, json + '\nnový díl K\nkvádr 1 1 1');
      ok(/✗ Zaoblení 1 \(fillet\)/.test(loaded), 'JSON na 1. řádku, ze kterého běh odešel: chybné zaoblení je ✗');
      const holes = [10, 20, 30, 40, 50].map((x) => `díra závit M8 hloubka 20 hloubka-závitu 16 v ${x} 20 20`);
      const clash = await run(p, ['nový díl Deska2', 'kvádr 100 40 20', ...holes, 'nový díl Šroub M8x20', 'válec 8 20', 'nová sestava S2', 'vložit "Deska2" ukotvit', 'vložit "Šroub M8x20" v 80 20 0', 'kolize'].join('\n'));
      ok(/⚠ řádek 13: kolize „Deska2“ × „Šroub M8x20“/.test(clash), 'šroub v plném materiálu vedle závitových děr = ⚠ skutečná kolize – ' + (clash.match(/^.*(kolize|řádek 1[0-3]).*$/gm) || ['—']).join(' | ').slice(0, 400));
      ok(!errs.length, `bez chyb stránky (${errs.join(' | ')})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
