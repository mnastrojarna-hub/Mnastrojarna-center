// E2E (vlna 22, balík A, etapa A3 – body 12, 22e, 22f, 22h zprávy majitele) na produkčním sestavení:
//  12) běhy mají id a stav, řadí se do fronty (nikdy souběžně), jdou zrušit; pozdní odpověď nepřepíše novější výsledek;
//      konzole ukazuje stav a id běhu, předchozí protokol jen jako „Předchozí běh“; uložit / export / sdílet počkají na
//      dokončený stav a soubor nese revizi modelu
//  22e) rozepsaná hodnota pole (helixSweep hloubka 0,8 → 0,82) a hned název – obojí v dokumentu; EN tečka / DE čárka;
//      Esc vrátí hodnotu; opuštění pole bez změny = žádný krok Zpět; přepnutí záložky < 450 ms – hodnota ve SVÉM dokumentu
//  22f) formát A2 → A3 a přepnutí na jiný dokument do 500 ms – A3 v Desce A, druhý dokument bez cizího výkresu; Ctrl+Z
//      vrátí jen změnu listu; zaškrtnutí pohledu se uloží
//  22h) export jako úloha: fáze, seznam Exporty (data-*), kontrola zpětným načtením i z menu, zrušení bez prázdného souboru
//      po dialogu „Uložit jako“ (File System Access API – náhrada `showSaveFilePicker` se zaznamenaným `remove()`)
// Průchody: WebGL (cs), bez WebGL (cs – majitel testoval bez WebGL), EN a DE (desetinná tečka / čárka).
// Spuštění: E2E_BASE=http://localhost:3531 node e2e/cad-w22-a3.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w22-a3').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3531').replace(/\/$/, '');

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};
const setVal = `(el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }`;
// závit 60° po šroubovici na válci – dost těžký na to, aby běh trval (zrušení, fronta)
const THREAD = (name, turns = 12) => [`nový díl "${name}"`, 'válec 20 30', `prvek surf.helixSweep profile=thread60 radius=9 depth=0.8 pitch=1.5 turns=${turns} mode=cut`].join('\n');

/* ───────────────────────── 12: fronta, id, zrušení, konzole, uložit čeká ───────────────────────── */
async function runs(p, tag) {
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  // dva běhy bez čekání: druhý čeká ve frontě, nikdy neběží souběžně
  const both = await p.evaluate(async (t) => {
    const a = window.mncad.run(t + '\nstav', { protocol: 'json' });
    await new Promise((r) => setTimeout(r, 30));
    const snap = window.mncad.runs('script').slice(-2).map((r) => [r.id, r.state]);
    const b = window.mncad.run('nový díl "Fronta B"\nkvádr 10 10 10\nstav', { protocol: 'json' });
    const snap2 = window.mncad.runs('script').slice(-2).map((r) => [r.id, r.state]);
    return { snap, snap2, a: JSON.parse(await a), b: JSON.parse(await b), after: window.mncad.runs('script').slice(-2) };
  }, THREAD('Fronta A', 8));
  ok(both.snap2[0][1] === 'running' && both.snap2[1][1] === 'queued', `${tag}12: druhý run čeká ve frontě, první počítá (${JSON.stringify(both.snap2)})`);
  ok(both.a.run && both.b.run && both.a.run.id !== both.b.run.id && /@r·[0-9a-f]{6}$/.test(both.a.run.inputRev), `${tag}12: RunReport.run = { id, inputRev } (${JSON.stringify([both.a.run, both.b.run])})`);
  ok(both.after.every((r) => r.state === 'done') && Date.parse(both.after[1].startedAt) >= Date.parse(both.after[0].startedAt) + both.after[0].ms - 5, `${tag}12: druhý běh začal až po konci prvního`);
  const short = await run('stav', 'short');
  ok(/\nΣ .* run=r\d+$/.test(short) && /^MNCAD\/1 (OK|FAIL) lines=1 ops=\d+ err=\d+ warn=\d+ note=\d+ t=[\d.]+\n/.test(short), `${tag}12: Σ … run=r<n>, hlavička beze změny\n${short.split('\n').slice(-1)[0]}`);

  // zrušení běžícího běhu (cancelRun) a čekajícího (AbortSignal) – dokument beze změny
  const docBefore = await p.evaluate(() => JSON.stringify(window.mncad.getDocument()));
  const cancel = await p.evaluate(async (t) => {
    const ac = new AbortController();
    const a = window.mncad.run(t);
    const b = window.mncad.run('kvádr 5 5 5', { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 300));
    const [ra, rb] = window.mncad.runs('script').slice(-2);
    ac.abort();
    window.mncad.cancelRun(ra.id);
    return { a: await a, b: await b, states: window.mncad.runs('script').slice(-2).map((r) => r.state) };
  }, THREAD('Zrušit', 40));
  ok(/Výpočet zrušen – dokument zůstal beze změny/.test(cancel.a) && /zrušen dřív, než začal/.test(cancel.b) && cancel.states.join() === 'cancelled,cancelled', `${tag}12: zrušení běžícího (cancelRun) i čekajícího (signal) – stav „zrušeno“ (${cancel.states})`);
  ok((await p.evaluate(() => JSON.stringify(window.mncad.getDocument()))) === docBefore, `${tag}12: zrušené běhy dokument nezměnily`);

  // konzole: během běhu nikdy starý protokol; předchozí jen sbalený; zavřít a otevřít během běhu → výsledek běhu
  await p.evaluate(() => window.mncad.openConsole());
  const ta = p.locator('#agent-input');
  await ta.fill('nový díl "Konzole 1"\nkvádr 10 10 10\nstav');
  await p.keyboard.press('Control+Enter');
  await p.waitForFunction(() => document.querySelector('[data-agent-output]')?.getAttribute('data-run-state') === 'done', null, { timeout: 120000 });
  const first = await p.evaluate(() => ({ id: document.querySelector('[data-agent-output]').getAttribute('data-run-id'), text: document.querySelector('[data-agent-output]').textContent }));
  await ta.fill(THREAD('Konzole 2', 16) + '\nstav');
  await p.keyboard.press('Control+Enter');
  await p.waitForFunction(() => document.querySelector('[data-agent-output]')?.getAttribute('data-run-state') === 'running', null, { timeout: 20000 });
  const during = await p.evaluate(() => ({ id: document.querySelector('[data-agent-output]').getAttribute('data-run-id'), text: document.querySelector('[data-agent-output]').textContent, prev: document.querySelector('[data-run-prev]')?.getAttribute('data-run-prev'), cancel: !!document.querySelector('[data-run-cancel]') }));
  ok(during.id !== first.id && !during.text.includes('Konzole 1') && during.prev === first.id && during.cancel, `${tag}12: konzole během běhu: id ${during.id}, bez starého protokolu, předchozí běh ${during.prev} sbalený, tlačítko Zrušit běh`);
  await p.keyboard.press('Escape'); // zavřít konzoli během běhu
  await p.evaluate(() => window.mncad.idle());
  await p.evaluate(() => window.mncad.openConsole());
  await p.waitForTimeout(400);
  const reopened = await p.evaluate(() => ({ id: document.querySelector('[data-agent-output]').getAttribute('data-run-id'), state: document.querySelector('[data-agent-output]').getAttribute('data-run-state'), text: document.querySelector('[data-agent-output]').textContent }));
  ok(reopened.id === during.id && reopened.state === 'done' && /Konzole 2/.test(reopened.text), `${tag}12: znovu otevřená konzole ukáže výsledek běhu ${during.id} (${reopened.state})`);
  await p.keyboard.press('Escape');

  // uložit počká na běh: soubor nese revizi modelu PO běhu
  const saved = await p.evaluate(async (t) => {
    const r = window.mncad.run(t);
    const s = await window.mncad.save('po-behu');
    await r;
    const d = window.mncad.getDocument();
    return { saveRev: s.modelRev, names: d.features.map((f) => f.name), runs: window.mncad.runs('script').slice(-1)[0].state };
  }, 'nový díl "Uložit po běhu"\nkvádr 30 20 10\nválec 5 20 v 15 10 10');
  const exp = await p.evaluate(() => window.mncad.exportFile('mncad'));
  ok(saved.saveRev && saved.saveRev === exp.modelRev && saved.names.length === 2, `${tag}12: uložit počkalo na běh – revize souboru ${saved.saveRev} = revize dokumentu po běhu (${exp.modelRev})`);
}

/* ───────────────────────── 22h: export jako úloha ───────────────────────── */
async function exports(p, tag) {
  await p.evaluate((t) => window.mncad.run(t), THREAD('Export A', 12));
  const r = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(r.job && r.job.state === 'done' && r.job.phases.map((x) => x.phase).join() === 'model,convert,verify,write' && r.check?.ok === true && /^r·[0-9a-f]{6}$/.test(r.modelRev), `${tag}22h: exportFile = úloha s fázemi, kontrola ✓, revize (${r.job?.phases.map((x) => `${x.phase}:${x.ms}`).join(' ')})`);
  // zrušení exportu přes API: model se nejdřív změní (30 závitů – export pak trvá sekundy), úloha exportu se počká ve frontě
  // a zruší se, až v seznamu Exporty skutečně je (fáze 2: dřív pevných 200 ms a „upravit“ na neexistující název prvku –
  // export nezměněného modelu doběhl dřív, než přišlo zrušení)
  const c = await p.evaluate(async () => {
    const helix = window.mncad.getDocument().features.find((f) => f.type === 'ext' && f.ext === 'surf.helixSweep') || window.mncad.getDocument().features.slice(-1)[0];
    const before = new Set(window.mncad.exports().map((x) => x.id));
    const edit = window.mncad.run(`upravit "${helix.name}" turns=30`);
    const pr = window.mncad.exportFile('step').then(() => 'done', (e) => String(e.message || e));
    let job = null;
    for (let t0 = Date.now(); Date.now() - t0 < 120000; ) {
      job = window.mncad.exports().find((x) => !before.has(x.id) && (x.state === 'queued' || x.state === 'running')) || null;
      const fin = window.mncad.exports().find((x) => !before.has(x.id) && x.state !== 'queued' && x.state !== 'running');
      if (job || fin) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const at = job ? job.state : 'none';
    const hit = job ? window.mncad.cancelRun(job.id) : false;
    const res = await pr;
    const editLog = await edit;
    const after = job ? window.mncad.exports().find((x) => x.id === job.id) : window.mncad.exports().slice(-1)[0];
    return { res, job: after, at, hit, edit: editLog.split('\n').filter((l) => /^[✗⚠]/.test(l)).join(' | ') };
  });
  // diagnostika (fáze 2): stav úlohy při zrušení a výsledek cancelRun
  ok(c.res !== 'done' && c.job && c.job.state === 'cancelled' && c.job.result?.written === false && c.hit, `${tag}22h: zrušený export (${c.job?.id}) – stav zrušeno, nic nezapsáno (stav při zrušení ${c.at}; cancelRun=${c.hit}; výsledek ${c.res}${c.edit ? '; úprava: ' + c.edit : ''})`);
  ok((await p.locator('[data-export-list] [data-export-job]').count()) >= 2 && (await p.locator('[data-export-state="cancelled"]').count()) >= 1, `${tag}22h: seznam Exporty drží dokončené i zrušené úlohy`);
}

/* ───────────────────────── 22e: rozepsaná hodnota a název ───────────────────────── */
async function fields(p, tag, lang) {
  const L = { cs: { depth: 'Hloubka závitu', dec: '0,82' }, en: { depth: 'Thread depth', dec: '0.82' }, de: { depth: 'Gewindetiefe', dec: '0,82' } }[lang];
  await p.evaluate((t) => window.mncad.run(t), THREAD('Formulář A', 6));
  const feat = await p.evaluate(() => window.mncad.getDocument().features.find((f) => f.type === 'ext'));
  await p.locator(`[data-feature-row="${feat.id}"]`).click();
  await p.waitForTimeout(600);
  const undo0 = await p.evaluate(() => window.mncad.history().undo);
  // opuštění pole bez změny → žádný krok Zpět
  const depth = p.getByLabel(L.depth).first();
  await depth.focus(); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => window.mncad.history().undo)) === undo0, `${tag}22e: opuštění pole bez změny nepřidalo krok Zpět`);
  // hloubka a hned název (< 450 ms, bez opuštění pole hloubky – automatizace)
  await p.evaluate(([fn, dec, name]) => {
    const setV = eval(fn);
    const d = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === name);
    const n = [...document.querySelectorAll('input')].find((i) => /^Tažení po šroubovici|^Helical sweep|^Austragung entlang Helix/.test(i.value));
    setV(d, dec);
    n.focus(); setV(n, 'Závit M20'); // ve stejném tiku: název
  }, [setVal, L.dec, L.depth]);
  await p.locator('button[title="OK (Enter)"]').first().click(); // hned (< 450 ms)
  await p.waitForTimeout(300);
  let f = await p.evaluate((id) => window.mncad.getDocument().features.find((x) => x.id === id), feat.id);
  ok(Math.abs(f.data.depth - 0.82) < 1e-9 && f.name === 'Závit M20', `${tag}22e: hloubka ${L.dec} i název uloženy (depth=${f.data.depth}, název „${f.name}“)`);
  // název po znacích = jeden krok Zpět
  await p.locator(`[data-feature-row="${feat.id}"]`).click(); await p.waitForTimeout(400);
  const u1 = await p.evaluate(() => window.mncad.history().undo);
  const nameInput = p.locator('input').filter({ hasText: '' }).and(p.locator(`input[value="Závit M20"]`)).first();
  await nameInput.click(); await nameInput.press('End'); await p.keyboard.type('x6');
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  ok((await p.evaluate(() => window.mncad.history().undo)) - u1 === 1, `${tag}22e: psaní názvu po znacích = jeden krok Zpět`);
  // Esc vrátí původní hodnotu, nic se nezapíše (ani po 450 ms)
  await depth.click(); await depth.fill('1,5'); await p.keyboard.press('Escape'); await p.waitForTimeout(700);
  f = await p.evaluate((id) => window.mncad.getDocument().features.find((x) => x.id === id), feat.id);
  ok(Math.abs(f.data.depth - 0.82) < 1e-9, `${tag}22e: Esc vrátil hodnotu (depth=${f.data.depth})`);
  // rozepsaná hodnota + přepnutí záložky < 450 ms → hodnota ve SVÉM dokumentu, druhý dokument beze změny
  await p.evaluate((t) => window.mncad.run(t), 'nový díl "Formulář B"\nkvádr 10 10 10');
  await p.evaluate(() => window.mncad.activateTab('Formulář A')); await p.waitForTimeout(500);
  await p.locator(`[data-feature-row="${feat.id}"]`).click(); await p.waitForTimeout(400);
  const bBefore = await p.evaluate(() => JSON.stringify(window.mncad.tabs()));
  await p.evaluate(([fn, name]) => { const setV = eval(fn); const d = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === name); setV(d, '0,9'); }, [setVal, L.depth]);
  await p.evaluate(() => window.mncad.activateTab('Formulář B'));
  await p.waitForTimeout(600);
  const docs = await p.evaluate(async () => { const b = window.mncad.getDocument(); window.mncad.activateTab('Formulář A'); await new Promise((r) => setTimeout(r, 500)); return { b, a: window.mncad.getDocument() }; });
  ok(Math.abs(docs.a.features.find((x) => x.id === feat.id).data.depth - 0.9) < 1e-9 && docs.b.features.length === 1 && !docs.b.features.some((x) => x.type === 'ext'), `${tag}22e: rozepsaná hodnota zapsána do Formulář A, Formulář B beze změny (${bBefore.length > 0})`);
}

/* ───────────────────────── 22f: výkres – formát, přepnutí záložky, Ctrl+Z, pohled ───────────────────────── */
async function drawing(p, tag, lang) {
  const fmt = { cs: 'Formát listu', en: 'Sheet size', de: 'Blattformat' }[lang];
  await p.evaluate((t) => window.mncad.run(t), 'nový díl "Deska A"\nkvádr 60 40 10\nnový díl "Plech"\nkvádr 100 50 1');
  await p.evaluate(() => window.mncad.activateTab('Deska A')); await p.waitForTimeout(600);
  await p.evaluate((t) => window.mncad.run(t), 'výkres'); // otevře výkres Desky A
  await p.waitForSelector('[data-sheet]', { timeout: 120000 }); await p.waitForTimeout(800);
  const sel = p.getByLabel(fmt);
  const before = await sel.inputValue();
  const target = before === 'A3' ? 'A2' : 'A3';
  await sel.selectOption(target);
  await p.evaluate(() => window.mncad.activateTab('Plech')); // < 500 ms po změně
  await p.waitForTimeout(150);
  const r = await p.evaluate(async () => { const pl = window.mncad.getDocument(); window.mncad.activateTab('Deska A'); await new Promise((r) => setTimeout(r, 600)); return { plech: pl, deska: window.mncad.getDocument() }; });
  ok(r.deska.drawings?.[0]?.options?.sheet === target && !(r.plech.drawings?.length), `${tag}22f: ${before} → ${target} a přepnutí do 500 ms – formát v Desce A, Plech bez cizího výkresu (${r.deska.drawings?.[0]?.options?.sheet}, plech ${r.plech.drawings?.length ?? 0})`);
  // Ctrl+Z vrátí jen změnu listu
  const undo = await p.evaluate(() => window.mncad.undo(1).then(() => window.mncad.getDocument()));
  ok(undo.drawings?.[0]?.options?.sheet === before && undo.features.length === 1, `${tag}22f: Ctrl+Z vrátil jen změnu listu (${undo.drawings?.[0]?.options?.sheet}, prvků ${undo.features.length})`);
  // zaškrtnutí pohledu se uloží (dřív bez markDirty)
  await p.evaluate((t) => window.mncad.run(t), 'výkres');
  await p.waitForSelector('[data-sheet]', { timeout: 120000 }); await p.waitForTimeout(500);
  const iso = p.locator('[data-view-toggle="iso"], input[data-view="iso"]').first();
  if (await iso.count()) {
    const was = await iso.isChecked();
    await iso.click();
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    const d = await p.evaluate(() => window.mncad.getDocument());
    ok(!!d.drawings?.[0]?.options?.views && d.drawings[0].options.views.iso === !was, `${tag}22f: zaškrtnutí izometrie uloženo (${was} → ${d.drawings?.[0]?.options?.views?.iso})`);
  } else ok(false, `${tag}22f: přepínač pohledu iso nenalezen (selektor data-view-toggle)`);
}

/* ───────────────────────── 22h: export z menu s dialogem „Uložit jako“ (FS Access) a zrušení ───────────────────────── */
async function menuExport(b, tag) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  // běžný uživatel (ne automatizace) s dialogem File System Access: náhrada zaznamená zápis a odstranění
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.__fs = { picked: [], writes: [], removed: [] };
    window.showSaveFilePicker = async (o) => {
      const name = o?.suggestedName || 'x';
      window.__fs.picked.push(name);
      return { name, kind: 'file', createWritable: async () => ({ write: async (blob) => window.__fs.writes.push([name, blob.size]), close: async () => undefined }), remove: async () => void window.__fs.removed.push(name) };
    };
  });
  const p = await ctx.newPage();
  await start(p, `${BASE}/cad?agent=0`);
  await p.evaluate((t) => window.mncad.run(t), THREAD('Menu export', 40));
  await p.evaluate(() => window.mncad.idle());
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /STEP/ }).first().click();
  await p.waitForSelector('[data-export-job][data-export-state="running"]', { timeout: 30000 });
  const phase = await p.locator('[data-export-job]').last().getAttribute('data-export-phase');
  await p.locator('[data-export-cancel]').last().click();
  await p.waitForSelector('[data-export-job][data-export-state="cancelled"]', { timeout: 60000 });
  const fsLog = await p.evaluate(() => window.__fs);
  ok(fsLog.picked.length === 1 && fsLog.writes.length === 0 && fsLog.removed.length === 1, `${tag}22h: zrušený export z menu po „Uložit jako“: nic nezapsáno, prázdný soubor odstraněn (fáze při zrušení: ${phase})`);
  // dokončený export z menu: kontrola zpětným načtením jako textové `export step`
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /STEP/ }).first().click();
  await p.waitForSelector('[data-export-job][data-export-state="done"]', { timeout: 300000 });
  const done = p.locator('[data-export-job][data-export-state="done"]').last();
  ok((await done.getAttribute('data-export-check')) === 'ok' && /^r·[0-9a-f]{6}$/.test(await done.getAttribute('data-export-rev')), `${tag}22h: export z menu – kontrola zpětným načtením ok, revize modelu v záznamu`);
  await p.waitForTimeout(10000);
  ok(await done.isVisible(), `${tag}22h: záznam exportu zůstal i 10 s po konci`);
  await p.screenshot({ path: S + 'a3-exports.png' });
  await ctx.close();
}

const browsers = [];
const launch = async (o) => { const x = await chromium.launch(o); browsers.push(x); return x; };
(async () => {
  const b = await launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [tag, url, lang, args] of [
    ['', `${BASE}/cad`, 'cs', null],
    ['[en] ', `${BASE}/en/cad`, 'en', null],
    ['[de] ', `${BASE}/de/cad`, 'de', null],
  ]) {
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await start(p, url);
    if (!tag) { await runs(p, tag); await exports(p, tag); }
    await fields(p, tag, lang);
    await drawing(p, tag, lang);
    ok(!errs.length, `${tag}bez chyb stránky (${errs.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  await menuExport(b, '');
  await b.close();
  // bez WebGL (majitel testoval bez WebGL): fronta a formuláře / výkres
  const nogl = await launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-3d-apis'] });
  const ctx = await nogl.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  await start(p, `${BASE}/cad`);
  await runs(p, '[bez WebGL] ');
  await fields(p, '[bez WebGL] ', 'cs');
  await drawing(p, '[bez WebGL] ', 'cs');
  await nogl.close();
})()
  .catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; })
  // výjimka nesmí nechat prohlížeč běžet (proces by visel do časového limitu sady)
  .finally(() => Promise.all(browsers.map((x) => x.close().catch(() => {}))));
