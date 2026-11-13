// E2E: automatizační API pro AI agenty – soubory, obraz, výstupy a analýzy (agent-api.ts, agent-api-host.ts).
//  - textem: řez, styl zobrazení, barva plochy, analýzy úkosů / tloušťky / křivosti, dělicí rovina, vyhazovače, chlazení,
//    smrštění, akce rozšíření (tabulka ohybů), „prvek sheet.dxf“ → chyba s odkazem na „akce“
//  - window.mncad: screenshot (PNG, rozměr, řez, styl a pohled se vrátí, skica), select / selection / clearSelection,
//    importFile (STEP z exportu, DXF do skici), exportFile("dxf"), compare (stejný STEP → 0 oblastí, upravený díl → oblast
//    a CSV), share (odkaz se otevře v jiném prohlížeči), settings / setSettings, action("sheet.dxf")
//  - bez WebGL (softwarový náhled): screenshot vrátí PNG
// Spuštění: E2E_BASE=http://localhost:3323 node e2e/cad-agent-api.e2e.cjs <složka pro výstupy>   (výchozí server :3100)
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const CAD = BASE + '/cad';
const start = async (p) => {
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};
/** PNG z base64: signatura a rozměr z hlavičky IHDR */
const png = (b64) => {
  const b = Buffer.from(b64 || '', 'base64');
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  return { sig, w: sig ? b.readUInt32BE(16) : 0, h: sig ? b.readUInt32BE(20) : 0, bytes: b.length, buf: b };
};
const evalErr = (p, fn, arg) => p.evaluate(fn, arg).then(() => '', (e) => String(e.message || e));

(async () => {
  // ════════════ A) WebGL (SwiftShader) ════════════
  {
    const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let dialogs = 0; p.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });
    await start(p);
    const run = (t) => p.evaluate((t) => window.mncad.run(t), t);
    const idle = () => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });

    // ── textové příkazy: řez, styl, barva plochy ──
    let log = await run('nový díl API kvádr\nkvádr 100 60 20');
    await idle(); await p.waitForTimeout(800);
    log = await run('řez X 25 obráceně\nzobraz drátový\nbarva plochy F1 F2 #e03930');
    ok(/✓ řez kolmo na X v 25 mm, obráceně \(model X 0…100 mm\)/.test(log), 'řez X 25 obráceně → jeden řádek s rozsahem modelu');
    ok(/✓ styl zobrazení: Drátový/.test(log), 'zobraz drátový → styl zobrazení');
    ok(/✓ barva ploch F1, F2 = #e03930 \(2 ploch\)/.test(log), 'barva plochy F1 F2 #e03930 → protokol');
    let doc = await p.evaluate(() => window.mncad.getDocument());
    ok(doc.faceColors && doc.faceColors[0] === '#e03930' && doc.faceColors[1] === '#e03930', 'barva ploch je v dokumentu (faceColors)');
    ok((await p.evaluate(() => window.mncad.settings().display)) === 'wireframe', 'styl je trvale v nastavení (display = wireframe)');
    ok(await p.getByText('Řez modelem').first().isVisible().catch(() => false), 'panel Řez modelem je otevřený');
    log = await run('řez vyp\nzobraz hrany\nbarva plochy F2 výchozí');
    ok(/✓ řez vypnut/.test(log) && /✓ styl zobrazení: Stínovaný s hranami/.test(log) && /✓ barva ploch F2 – výchozí/.test(log), 'řez vyp, zobraz hrany, barva výchozí');
    ok(/plocha F99 v tělese není – plochy F1 až F6/.test(await run('barva plochy F99 #00ff00')), 'barva plochy F99 → chyba s rozsahem ploch');
    ok(/neznámé slovo „nahoru“/.test(await run('řez X 10 nahoru')), 'řez s neznámým slovem → česká chyba');

    // ── screenshot ──
    const s1 = await p.evaluate(() => window.mncad.screenshot({ view: 'iso', width: 640 }));
    const i1 = png(s1.base64);
    ok(s1.mime === 'image/png' && i1.sig && i1.w === 640 && s1.width === 640 && i1.h === s1.height, `screenshot → PNG 640 × ${i1.h} (${i1.bytes} B)`);
    fs.writeFileSync(S + 'api-shot-iso.png', i1.buf);
    const s2 = await p.evaluate(() => window.mncad.screenshot({ view: 'iso', width: 640, section: { axis: 'X', offset: 50 }, display: 'wireframe', hints: true, background: 'current' }));
    const i2 = png(s2.base64);
    fs.writeFileSync(S + 'api-shot-section.png', i2.buf);
    ok(i2.sig && i2.w === 640 && s2.base64 !== s1.base64, 'screenshot se řezem, drátově, s popisky a pozadím → jiný obraz');
    await p.waitForTimeout(500);
    ok(!(await p.getByText('Řez modelem').first().isVisible().catch(() => false)), 'po snímku je řez zase vypnutý (dočasný)');
    ok((await p.evaluate(() => window.mncad.settings().display)) === 'shadedEdges', 'po snímku je styl zpět (shadedEdges)');
    const s3 = await p.evaluate(() => window.mncad.screenshot({ view: 'top', width: 300, height: 300, fit: true }));
    ok(png(s3.base64).w === 300 && png(s3.base64).h === 300, 'screenshot 300 × 300 (pohled shora)');
    ok(/view je iso/.test(await evalErr(p, () => window.mncad.screenshot({ view: 'shora' }))), 'screenshot se špatnou volbou → česká chyba');

    // ── výběr ──
    ok((await p.evaluate(() => window.mncad.select(['F1']))) === 1, 'select(["F1"]) → 1');
    let sel = await p.evaluate(() => window.mncad.selection());
    ok(sel.length === 1 && sel[0].id === 'F1' && sel[0].kind === 'face' && sel[0].index === 0, 'selection() → plocha F1 (index 0)');
    ok((await p.evaluate(() => window.mncad.select(['E2', 'V3'], { additive: true }))) === 3, 'select additive E2, V3 → 3 entity');
    sel = await p.evaluate(() => window.mncad.selection());
    ok(sel.map((x) => x.id).join(',') === 'F1,E2,V3' && /^\[/.test(sel[2].title || ''), 'selection() → F1, E2, V3 (vrchol se souřadnicemi)');
    await p.evaluate(() => window.mncad.clearSelection());
    ok((await p.evaluate(() => window.mncad.selection())).length === 0, 'clearSelection() → prázdný výběr');
    ok(/F99 v tělese není/.test(await evalErr(p, () => window.mncad.select(['F99']))), 'select(["F99"]) → chyba s rozsahem');
    ok((await p.evaluate(() => window.mncad.select(['feature:Kvádr 1']))) === 1 && (await p.evaluate(() => window.mncad.selection()))[0].id === 'feature:Kvádr 1', 'select(["feature:Kvádr 1"]) → prvek historie');
    await p.evaluate(() => window.mncad.clearSelection());

    // ── analýzy a formařské nástroje ──
    log = await run('analýza úkosů');
    ok(/✓ Úkosy \(směr vyhození \+Z, min\. 1°\): Dostatečný [\d,]+ % · Malý 0,0 % · Svislá stěna [\d,]+ % · Podkos 0,0 % – bez podkosů/.test(log), 'analýza úkosů → procenta tříd a závěr');
    log = await run('analýza tloušťky limit 30 zobrazit');
    ok(/✓ Tloušťka stěn: nejtenčí 20 mm u \[/.test(log) && /pod limitem 30 mm: [\d,]+ % vzorků/.test(log), 'analýza tloušťky → nejtenčí 20 mm a místo');
    log = await run('analýza křivosti');
    ok(/✓ Křivost: min /.test(log), 'analýza křivosti → rozsah');
    const s4 = await p.evaluate(() => window.mncad.screenshot({ width: 400 }));
    fs.writeFileSync(S + 'api-shot-thickness.png', png(s4.base64).buf);
    ok(png(s4.base64).sig, 'screenshot s barevnou mapou tloušťky');
    log = await run('analýza vyp');
    ok(/✓ barevné analýzy vypnuty/.test(log), 'analýza vyp');
    log = await run('dělicí rovina');
    ok(/✓ Dělicí rovina: Z = [\d,]+ mm \(největší obvod průřezu 320 mm\)/.test(log), 'dělicí rovina → Z a obvod 320 mm');
    ok(await p.getByText('Řez modelem').first().isVisible().catch(() => false), 'dělicí rovina nastaví řez');
    await run('řez vyp');
    log = await run('vyhazovače Ø 5 rozteč 40');
    ok(/✓ Vyhazovače: \d+× Ø5 ve směru \+Z – polohy \(X; Y v půdorysu\): \[/.test(log), 'vyhazovače → seznam poloh');
    log = await run('chlazení Ø8 hloubka 15 větve 3 přesah 10');
    ok(/✓ Chladicí okruh: 3 větví Ø8 mm, hloubka osy 15 mm/.test(log), 'chlazení → popis okruhu');
    const nBefore = (await p.evaluate(() => window.mncad.getDocument())).features.length;
    log = await run('vyhazovače Ø 5 díry\nsmrštění 0,5');
    await idle();
    doc = await p.evaluate(() => window.mncad.getDocument());
    ok(/děr pro vyhazovače přidáno/.test(log) && doc.features.some((f) => f.name === 'Vyhazovač 1' && f.type === 'hole'), 'vyhazovače díry → díry v historii');
    ok(/✓ Smrštění \+0[.,]5 % \(transform\)/.test(log) && doc.features.some((f) => f.type === 'transform' && Math.abs(f.scale - 1.005) < 1e-9), 'smrštění 0,5 → prvek Přesun s měřítkem 1,005 (ověřen stavbou)');
    ok(doc.features.length > nBefore + 1, 'historie dílu narostla o díry a smrštění');
    log = await run('chlazení Ø6 větve 2 sestava');
    ok(/✓ sestava „Sestava – API kvádr“: díl \+ chladicí okruh – nová záložka/.test(log), 'chlazení … sestava → nová sestava');
    await p.waitForTimeout(1500);
    doc = await p.evaluate(() => window.mncad.getDocument());
    ok(doc.kind === 'assembly' && (doc.components || []).length === 2, 'nová sestava má díl a chladicí okruh');

    // ── export STEP → importFile STEP; compare ──
    await run('nový díl Reference\nkvádr 80 50 30');
    await idle();
    const step = await p.evaluate(() => window.mncad.exportFile('step'));
    ok(step.bytes > 1000, `exportFile("step") → ${step.bytes} B`);
    let r = await p.evaluate((s) => window.mncad.importFile({ name: 'kvadr80.step', base64: s }), step.base64);
    ok(/✓ model kvadr80\.step otevřen \(prvek Import\)/.test(r) && /Rozměry: 80 × 50 × 30 mm/.test(r), 'importFile STEP → otevřeno, stav s rozměry 80 × 50 × 30');
    doc = await p.evaluate(() => window.mncad.getDocument());
    ok(doc.features.length === 1 && doc.features[0].type === 'import', 'importovaný díl má prvek Import');
    let cmp = await p.evaluate((s) => window.mncad.compare({ name: 'kvadr80.step', base64: s }, { tolerance: 0.1 }), step.base64);
    ok(cmp.ok === true && cmp.regions.length === 0 && /Žádné rozdílové oblasti/.test(cmp.text), 'compare se stejným STEP → ok, 0 oblastí');
    await run('díra 10 skrz v 40 25');
    await idle();
    cmp = await p.evaluate((s) => window.mncad.compare({ name: 'kvadr80.step', base64: s }, { tolerance: 0.1, show: true }), step.base64);
    ok(cmp.ok === false && cmp.regions.length >= 1 && cmp.regions[0].side === 'missing' && cmp.regions[0].volume > 2000, `compare s dírou → ${cmp.regions.length} oblast, chybí ${Math.round(cmp.regions[0]?.volume || 0)} mm³`);
    ok(cmp.csv.split('\n').length > 3 && cmp.csv.includes(';'), 'compare → CSV report');
    const s5 = await p.evaluate(() => window.mncad.screenshot({ width: 500 }));
    fs.writeFileSync(S + 'api-shot-compare.png', png(s5.base64).buf);
    ok(png(s5.base64).sig, 'screenshot s mapou odchylek (compare show)');
    await run('analýza vyp');

    // ── sestava: importFile jako komponenta (STEP, .mncad), výběr komponenty a plochy komponenty, snímek rozloženě ──
    const deska = await p.evaluate(() => { const d = window.mncad.getDocument(); d.name = 'Deska'; return JSON.stringify(d); });
    await run('nová sestava Sestava API');
    r = await p.evaluate((s) => window.mncad.importFile({ name: 'kvadr80.step', base64: s }), step.base64);
    ok(/✓ model kvadr80\.step vložen do sestavy jako komponenta · Sestava kvadr80\.step zobrazena/.test(r) && /Komponenty: kvadr80/.test(r), 'importFile STEP v otevřené sestavě → komponenta, stav sestavy');
    r = await p.evaluate((t) => window.mncad.importFile({ name: 'deska.mncad', text: t }), deska);
    ok(/✓ díl „Deska“ vložen do sestavy jako komponenta/.test(r) && /Komponenty: kvadr80\b[^\n]*\bDeska\b/.test(r), 'importFile .mncad v sestavě → díl jako komponenta');
    const sel2 = await p.evaluate(() => { const n = window.mncad.select(['comp:kvadr80', 'Deska:F2']); return { n, s: window.mncad.selection() }; });
    ok(sel2.n === 2 && sel2.s.map((x) => x.id).join(',') === 'comp:kvadr80,Deska:F2', 'sestava: select(comp:…, Komponenta:F2) a selection() hned po něm (' + sel2.s.map((x) => x.id).join(',') + ')');
    const s7 = await p.evaluate(() => window.mncad.screenshot({ width: 500, explode: 1 }));
    fs.writeFileSync(S + 'api-shot-assembly.png', png(s7.base64).buf);
    ok(png(s7.base64).sig, 'sestava: screenshot rozloženě s výběrem');
    await p.evaluate(() => window.mncad.clearSelection());
    ok(/otevřený dokument je sestava/.test(await run('analýza úkosů')), 'analýza v sestavě → srozumitelná chyba');
    ok(/nepodařilo otevřít|nepodporovaný|není podporovaný|neobsahuje/i.test(await evalErr(p, () => window.mncad.importFile({ name: 'x.step', text: 'nesmysl' }))), 'importFile poškozeného STEP → výjimka s důvodem');

    // ── skica: export DXF, import DXF do skici, snímek skicáře ──
    await run('nový díl Skica API\nskica XY: obdélník 40 20; kružnice 10 v 0 0');
    const dxf = await p.evaluate(() => window.mncad.exportFile('dxf'));
    const dxfText = Buffer.from(dxf.base64, 'base64').toString('utf8');
    ok(dxf.name.endsWith('.dxf') && dxfText.includes('SECTION') && dxfText.includes('CIRCLE'), `exportFile("dxf") → skica jako DXF (${dxf.bytes} B)`);
    r = await p.evaluate((t) => window.mncad.importFile({ name: 'obrys.dxf', text: t }, { as: 'sketch' }), dxfText);
    ok(/✓ DXF obrys\.dxf: nová skica „obrys“ \(\d+ entit, rovina XY\)/.test(r), 'importFile DXF as sketch → nová skica v dílu');
    doc = await p.evaluate(() => window.mncad.getDocument());
    ok(doc.features.filter((f) => f.type === 'sketch').length === 2, 'díl má dvě skici (původní + DXF)');
    await p.waitForTimeout(1200);
    ok(await p.locator('svg[data-sketch-canvas]').isVisible().catch(() => false), 'importovaná skica je otevřená ve skicáři');
    const s6 = await p.evaluate(() => window.mncad.screenshot({ width: 600 }));
    const i6 = png(s6.base64);
    fs.writeFileSync(S + 'api-shot-sketch.png', i6.buf);
    ok(i6.sig && i6.w === 600, 'screenshot při otevřené skice → snímek skicáře (PNG 600 px)');
    r = await p.evaluate((t) => window.mncad.importFile({ name: 'obrys2.dxf', text: t }, { as: 'sketch' }), dxfText);
    ok(/✓ DXF obrys2\.dxf: \d+ entit vloženo do otevřené skice/.test(r), 'importFile DXF as sketch při otevřené skice → entity do ní');
    ok(/lze jen do otevřené sestavy/.test(await evalErr(p, (t) => window.mncad.importFile({ name: 'x.mncad', text: t }, { as: 'component' }), JSON.stringify(doc))), 'importFile as component bez sestavy → chyba');

    // ── plech: akce tabulka ohybů, action("sheet.dxf"), prvek sheet.dxf → chyba ──
    log = await run('nový díl Plech API\nskica XY: obdélník 100 60 roh 0 0\nprvek sheet.base sketchId=$last t=2');
    await idle();
    ok(!log.split('\n').some((l) => l.startsWith('✗')) && /✓ Základní plech \(ext\)/.test(log), 'plechový díl (Základní plech) bez chyby');
    log = await run('akce tabulka ohybů');
    ok(/✓ akce Tabulka ohybů/.test(log) && /Rozvin: 100 × 60 mm · tloušťka 2 mm/.test(log), 'akce tabulka ohybů → text tabulky v protokolu');
    const act = await p.evaluate(() => window.mncad.action('sheet.dxf'));
    const flatDxf = Buffer.from(act.files[0]?.base64 || '', 'base64').toString('utf8');
    ok(act.files.length === 1 && act.files[0].name.endsWith('.dxf') && flatDxf.includes('SECTION') && flatDxf.includes('ENTITIES'), `action("sheet.dxf") → DXF rozvinu (${act.files[0]?.bytes} B)`);
    log = await run('akce rozvin svg');
    ok(/✓ akce Rozvin → SVG/.test(log) && /soubor .*\.svg \(\d+ B, image\/svg\+xml\)/.test(log), 'akce rozvin svg → soubor zachycen v protokolu');
    log = await run('prvek sheet.dxf');
    ok(/není prvek, ale akce .*akce sheet\.dxf/.test(log), 'prvek sheet.dxf → chyba s odkazem na příkaz akce');
    ok(/neznámá akce/.test(await evalErr(p, () => window.mncad.action('blbost'))), 'action("blbost") → chyba se seznamem akcí');

    // ── nastavení ──
    const st0 = await p.evaluate(() => window.mncad.settings());
    ok(st0.askWhereToSave === true, 'settings() → výchozí askWhereToSave = true');
    const st1 = await p.evaluate(() => window.mncad.setSettings({ askWhereToSave: false, decimals: 3 }));
    await p.waitForTimeout(300);
    const st2 = await p.evaluate(() => window.mncad.settings());
    ok(st1.askWhereToSave === false && st2.askWhereToSave === false && st2.decimals === 3, 'setSettings({ askWhereToSave: false }) se projeví v settings()');
    ok(/nelze měnit přes API/.test(await evalErr(p, () => window.mncad.setSettings({ shortcuts: {} }))), 'setSettings s neznámým klíčem → chyba');

    // ── sdílení ──
    await run('nový díl Sdílený API\nkvádr 30 20 10');
    await idle();
    const sh = await p.evaluate(() => window.mncad.share({ days: 1, from: 'Agent' }));
    ok(sh.mode === 'link' && sh.url.startsWith(CAD + '#s=1d.') && sh.exp > Date.now() && sh.message.includes(sh.url), `share() → odkaz (${sh.url.length} znaků) a zpráva`);
    const ctx2 = await b.newContext({ viewport: { width: 1300, height: 820 } });
    const r2 = await ctx2.newPage();
    await r2.goto(sh.url, { waitUntil: 'networkidle', timeout: 300000 });
    await r2.waitForFunction(() => !!window.mncad && window.mncad.getDocument().name === 'Sdílený API', null, { timeout: 120000 }).catch(() => {});
    const rd = await r2.evaluate(() => window.mncad.getDocument()).catch(() => null);
    ok(rd && rd.name === 'Sdílený API' && rd.features.length === 1, 'sdílený odkaz se otevře v jiném prohlížeči s dílem');
    await ctx2.close();

    ok(dialogs === 0, `žádné nativní dialogy (${dialogs})`);
    ok(errs.length === 0, 'bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await b.close();
  }

  // ════════════ B) bez WebGL – softwarový náhled ════════════
  {
    const b = await chromium.launch({ args: ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
    const ctx = await b.newContext({ viewport: { width: 1300, height: 820 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await start(p);
    await p.evaluate(() => window.mncad.run('nový díl Bez WebGL\nkvádr 50 40 30\nválec 20 40 v 25 20 0 odebrat'));
    await p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 120000 });
    await p.waitForTimeout(2000);
    const s = await p.evaluate(() => window.mncad.screenshot({ view: 'iso', width: 500 }));
    const i = png(s.base64);
    fs.writeFileSync(S + 'api-shot-nowebgl.png', i.buf);
    ok(i.sig && i.w === 500, 'bez WebGL: screenshot → PNG 500 px (softwarový náhled)');
    const s2 = await p.evaluate(() => window.mncad.screenshot({ view: 'front', width: 500, section: { axis: 'Y', offset: 20 } }));
    ok(png(s2.base64).sig && s2.base64 !== s.base64, 'bez WebGL: screenshot se řezem a jiným pohledem → jiný obraz');
    const log = await p.evaluate(() => window.mncad.run('analýza úkosů'));
    ok(/Podkos 0,0 %/.test(log), 'bez WebGL: analýza úkosů jako text');
    ok(errs.length === 0, 'bez WebGL: bez chyb stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await b.close();
  }
})().catch((e) => {
  console.log('FAIL: výjimka ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
