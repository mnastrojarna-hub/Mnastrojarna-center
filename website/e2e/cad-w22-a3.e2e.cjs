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
  // fáze 2, kolo 4 (vědomá úprava, balík g – 22a): model závitu šroubovicí je přesně platný, ale soubor STEP po zpětném načtení
  // výchozí čtečkou přesnou kontrolou NEPROJDE (čtečka spočte tolerance hran menší, než je skutečná odchylka; po přepočtu
  // tolerancí projde s tolerancí do meze = největší tolerance modelu, číslo v řádku – oponent kolo 4: bez meze by „geometrie
  // souboru odpovídá“ prošlo i se souborem, jehož křivky jsou 0,1 mm od ploch). Pravdivý výsledek kontroly je proto
  // ⚠ out.reload-invalid, ne ✓ – stejně jako cad-w22-g 7c a
  // w22/thread-g2-engine.test.ts. Dřív test čekal ✓ (napsán před přesnou kontrolou souboru z balíku g). Cesta ✓ „věrná kopie“
  // se ověřuje níže na modelu, jehož soubor přesnou kontrolou projde (válec s průchozí dírou).
  await p.evaluate((t) => window.mncad.run(t), 'nový díl "Export K"\nválec 30 20\ndíra 8 skrz v 0 0 20');
  const rk = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(rk.job && rk.job.state === 'done' && rk.check?.ok === true && /→ věrná kopie modelu$/.test(rk.check.text) && !rk.warning, `${tag}22h: exportFile modelu bez aproximovaných hran – kontrola ✓ věrná kopie (${(rk.check?.text || '').slice(0, 160)})`);
  await p.evaluate((t) => window.mncad.run(t), THREAD('Export A', 12));
  const r = await p.evaluate(() => window.mncad.exportFile('step'));
  ok(r.job && r.job.state === 'done' && r.job.phases.map((x) => x.phase).join() === 'model,convert,verify,write' && r.check?.ok === false && /NEPROJDE přesnou kontrolou platnosti/.test(r.check.text) && /model přesně platný/.test(r.check.text) && /po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou projde s tolerancí nejvýše [\d,]+e-\d mm \(mez [\d,]+e-\d mm = největší tolerance modelu\) → geometrie souboru odpovídá/.test(r.check.text) && !/věrná kopie/.test(r.check.text) && /out\.reload-invalid|NEPROJDE/.test(r.warning || '') && /^r·[0-9a-f]{6}$/.test(r.modelRev), `${tag}22h: exportFile závitu šroubovicí = úloha s fázemi, kontrola ⚠ (soubor po načtení přesně neplatný, model platný – ne ✓), revize (${r.job?.phases.map((x) => `${x.phase}:${x.ms}`).join(' ')}; ${(r.check?.text || '').slice(0, 220)})`);
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

/* ───────────── fáze 2, kolo 3 (body 12, 22h): výpočty s id, STEP s revizí, zrušení po `nový díl` ───────────── */
async function round3(p, tag) {
  // výpočty aplikace mají id a revizi vstupu (dřív jen vnitřní SeqGuard bez viditelného stavu)
  await p.evaluate((t) => window.mncad.run(t), 'nový díl "Kolo 3"\nkvádr 30 20 10');
  await p.evaluate(() => window.mncad.idle());
  await p.waitForFunction(() => (window.mncad.computes('build') || []).some((x) => x.state === 'done' && x.doc === 'Kolo 3'), null, { timeout: 120000 });
  const comp = await p.evaluate(() => {
    const b = window.mncad.computes('build').filter((x) => x.doc === 'Kolo 3').slice(-1)[0];
    const el = document.querySelector('[data-compute-run]');
    return { b, attr: el ? { id: el.getAttribute('data-compute-run'), state: el.getAttribute('data-compute-state'), rev: el.getAttribute('data-compute-rev'), kind: el.getAttribute('data-compute-kind') } : null, all: window.mncad.computes().map((x) => `${x.id}:${x.what}:${x.state}`).slice(-6) };
  });
  ok(comp.b && /^v\d+$/.test(comp.b.id) && /@r·[0-9a-f]{6}$/.test(comp.b.inputRev) && comp.b.state === 'done', `${tag}12: stavba modelu má id a revizi vstupu (${comp.b && comp.b.id} ${comp.b && comp.b.inputRev} ${comp.b && comp.b.state}; ${comp.all.join(' ')})`);
  ok(!!comp.attr && /^v\d+$/.test(comp.attr.id) && ['done', 'superseded', 'running', 'queued', 'error', 'cancelled'].includes(comp.attr.state) && /^r·[0-9a-f]{6}$/.test(comp.attr.rev), `${tag}12: stavový řádek ukazuje poslední výpočet (${JSON.stringify(comp.attr)})`);
  // soubor STEP nese revizi modelu v hlavičce = modelRev výsledku
  const st = await p.evaluate(async () => {
    const r = await window.mncad.exportFile('step');
    const head = atob(r.base64).slice(0, 3000);
    const m = /'MNCAD model revision (r\\X\\B7[0-9a-f]{6})'/.exec(head);
    return { rev: r.modelRev, inFile: m ? m[1].replace('\\X\\B7', '·') : null, check: r.check && r.check.ok };
  });
  ok(st.inFile && st.inFile === st.rev && st.check === true, `${tag}12: STEP nese revizi modelu v hlavičce (${st.inFile} = ${st.rev}), kontrola zpětným načtením ok`);
  // zrušení běhu po `nový díl` uprostřed skriptu: založená záložka zmizí, hláška nelže
  const c = await p.evaluate(async (t) => {
    const before = window.mncad.tabs().map((x) => x.title);
    const pr = window.mncad.run(t);
    for (let t0 = Date.now(); Date.now() - t0 < 60000 && !window.mncad.tabs().some((x) => x.title === 'Zrušit B'); ) await new Promise((r) => setTimeout(r, 20));
    const had = window.mncad.tabs().some((x) => x.title === 'Zrušit B');
    await new Promise((r) => setTimeout(r, 400));
    const hit = window.mncad.cancelRun();
    const log = await pr;
    await new Promise((r) => setTimeout(r, 500));
    return { before, after: window.mncad.tabs().map((x) => x.title), had, hit, log };
  }, 'nový díl "Zrušit B"\nkvádr 10 10 10\n' + THREAD('Zrušit C', 30));
  const line = (c.log.split('\n').find((l) => /Výpočet zrušen|Computation cancelled|Berechnung abgebrochen/.test(l)) || '').trim();
  ok(c.had && c.hit && !c.after.includes('Zrušit B') && !c.after.includes('Zrušit C') && c.after.join('|') === c.before.join('|'), `${tag}12: zrušený běh po \`nový díl\` – záložka, kterou založil, zmizela (před ${c.before.length}, po ${c.after.length}: ${c.after.slice(-3).join(', ')})`);
  ok(/Dokumenty založené během \(„Zrušit B“\) se zahodily/.test(line) && /beze změny/.test(line) && !/zůstaly v/.test(line), `${tag}12: hláška zrušení odpovídá stavu („${line}“)`);
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
      // zápis čeká na `__fs.gate` (je-li nastavená) – test tak deterministicky změní model, zatímco úloha exportu ještě běží
      return { name, kind: 'file', createWritable: async () => ({ write: async (blob) => { window.__fs.waiting = true; if (window.__fs.gate) await window.__fs.gate; window.__fs.writes.push([name, blob.size]); }, close: async () => undefined }), remove: async () => void window.__fs.removed.push(name) };
    };
    window.__fs.hold = () => { window.__fs.waiting = false; window.__fs.gate = new Promise((r) => (window.__fs.release = () => { window.__fs.gate = null; r(); })); };
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
  // kolo 4 (vědomá úprava, viz exports()): soubor závitu šroubovicí přesnou kontrolou po načtení neprojde → záznam úlohy „fail“
  // a v dokumentu ⚠ text kontroly s doloženou příčinou; nikdy „věrná kopie“ (dřív test čekal „ok“)
  const menuRec = await p.evaluate(() => ((window.mncad.getDocument().outputs || []).slice(-1)[0] || {}).job || null);
  ok((await done.getAttribute('data-export-check')) === 'fail' && !!menuRec && menuRec.check && menuRec.check.ok === false && /NEPROJDE přesnou kontrolou platnosti/.test(menuRec.check.text) && !/věrná kopie/.test(menuRec.check.text) && /^r·[0-9a-f]{6}$/.test(await done.getAttribute('data-export-rev')), `${tag}22h: export z menu – kontrola zpětným načtením provedena: ⚠ soubor po načtení přesně neplatný (ne ✓), revize modelu v záznamu (${((menuRec && menuRec.check && menuRec.check.text) || '').slice(0, 160)})`);
  await p.waitForTimeout(10000);
  ok(await done.isVisible(), `${tag}22h: záznam exportu zůstal i 10 s po konci`);
  // kolo 3 (falešná zelená): model změněný BĚHEM exportu z menu (Ctrl+Z, když převod běží) – záznam v dokumentu nese revizi
  // exportovaného modelu a je hned zastaralý, lišta ✓ kontroly se neukáže, hláška to řekne; úloha (stav, čas) je v dokumentu
  const nDone = await p.locator('[data-export-job][data-export-state="done"]').count();
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  // zápis souboru (poslední fáze úlohy) podrží brána – změna modelu tak nastane jistě uprostřed úlohy, ne až po jejím konci
  // (dřív Ctrl+Z ve fázi kontroly: krátká kontrola doběhla dřív, Zpět pak vrátilo i hotový záznam a test měřil něco jiného)
  await p.evaluate(() => window.__fs.hold());
  await p.getByRole('button', { name: /STEP/ }).first().click();
  await p.waitForSelector('[data-export-job][data-export-state="running"]', { timeout: 30000 });
  await p.waitForFunction(() => window.__fs.waiting === true, null, { timeout: 300000 });
  // Ctrl+Z z klávesnice (ne window.mncad.undo – to je textový běh a čekal by ve frontě za exportem)
  const n0 = await p.evaluate(() => window.mncad.getDocument().features.length);
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  const undone = { before: n0, after: await p.evaluate(() => window.mncad.getDocument().features.length), running: await p.locator('[data-export-job][data-export-state="running"]').count() };
  ok(undone.after !== undone.before && undone.running >= 1, `${tag}22h: model změněn (Ctrl+Z), zatímco úloha exportu běží (${JSON.stringify(undone)})`);
  await p.evaluate(() => window.__fs.release());
  await p.waitForFunction((n) => document.querySelectorAll('[data-export-job][data-export-state="done"]').length > n, nDone, { timeout: 300000 });
  await p.waitForTimeout(800);
  const chg = await p.evaluate(() => {
    const d = window.mncad.getDocument();
    const rec = (d.outputs || []).slice(-1)[0];
    return { rec, bar: !!document.querySelector('div[data-export-check][data-export-format]'), text: document.body.innerText };
  });
  const list = await p.evaluate(() => window.mncad.run('exporty'));
  const recLine = (list.split('\n').find((l) => l.includes(chg.rec && chg.rec.file)) || '').trim();
  ok(!!chg.rec && chg.rec.job && chg.rec.job.state === 'done' && typeof chg.rec.job.ms === 'number' && /ZASTARALÝ/.test(recLine) && !/odpovídá modelu/.test(recLine), `${tag}22h: model změněn během exportu → záznam zastaralý, ne „odpovídá modelu“ (${recLine}; undo ${JSON.stringify(undone)})`);
  ok(!chg.bar && /model se během exportu změnil/.test(chg.text), `${tag}22h: bez lišty ✓ kontroly nad změněným modelem, hláška o změně během exportu`);
  await p.screenshot({ path: S + 'a3-exports.png' });
  await undoAfterExport(p, tag);
  await ctx.close();
}

/**
 * Kolo 4 (fáze 2): Ctrl+Z HNED PO dokončeném exportu z menu nesmí smazat záznam exportu – soubor na disku existuje. Dřív se záznam
 * zapsal jen do současného stavu historie a Zpět vrátil stav bez něj: seznam Exporty / čip „Zastaralé výstupy“ zmizel (falešně
 * čisto). Teď: záznam zůstane, k vrácenému modelu je ZASTARALÝ (čip ⚠ 1); Ctrl+Y = zase „odpovídá modelu“ (cad/history-outputs.ts).
 */
async function undoAfterExport(p, tag) {
  await p.evaluate(() => window.mncad.run('nový díl "Deska U"\nkvádr 60 40 10'));
  await p.evaluate(() => window.mncad.run('upravit "Kvádr 1" size=50;40;10'));
  await p.evaluate(() => window.mncad.idle());
  const nDone = await p.locator('[data-export-job][data-export-state="done"]').count();
  await p.getByRole('button', { name: 'Soubor', exact: true }).click();
  await p.getByRole('button', { name: /STEP/ }).first().click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-export-job][data-export-state="done"]').length > n, nDone, { timeout: 300000 });
  await p.waitForFunction(() => (window.mncad.getDocument().outputs || []).some((r) => /Deska.U/.test(r.file)), null, { timeout: 30000 });
  const rec = await p.evaluate(() => (window.mncad.getDocument().outputs || []).filter((r) => /Deska.U/.test(r.file)).slice(-1)[0]);
  const size0 = await p.evaluate(() => JSON.stringify(window.mncad.getDocument().features[0].size));
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await p.keyboard.press('Control+z');
  await p.waitForFunction((s) => JSON.stringify(window.mncad.getDocument().features[0]?.size) !== s, size0, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(600);
  const u = await p.evaluate((id) => ({ size: JSON.stringify(window.mncad.getDocument().features[0]?.size), has: (window.mncad.getDocument().outputs || []).some((r) => r.id === id), chip: document.querySelector('[data-outputs-chip]')?.getAttribute('data-outputs-chip') ?? null }), rec.id);
  const list = await p.evaluate(() => window.mncad.run('exporty'));
  const line = (list.split('\n').find((l) => l.includes(rec.file)) || '').trim();
  ok(u.size !== size0 && u.has && /ZASTARALÝ/.test(line) && !/odpovídá modelu/.test(line), `${tag}kolo 4: Ctrl+Z hned po exportu – model vrácen (${size0} → ${u.size}), záznam „${rec.file}“ zůstal a je ZASTARALÝ (${line})`);
  ok(u.chip !== null && Number(u.chip) >= 1, `${tag}kolo 4: čip Zastaralé výstupy po Ctrl+Z ukazuje soubor (data-outputs-chip=${u.chip}), ne „čisto“`);
  await p.keyboard.press('Control+y');
  await p.waitForFunction((s) => JSON.stringify(window.mncad.getDocument().features[0]?.size) === s, size0, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(600);
  const list2 = await p.evaluate(() => window.mncad.run('exporty'));
  const line2 = (list2.split('\n').find((l) => l.includes(rec.file)) || '').trim();
  ok(/odpovídá modelu/.test(line2), `${tag}kolo 4: Ctrl+Y vrátí model exportu – záznam zase „odpovídá modelu“ (${line2})`);
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
    if (!tag) { await runs(p, tag); await exports(p, tag); await round3(p, tag); }
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
  await round3(p, '[bez WebGL] ');
  await fields(p, '[bez WebGL] ', 'cs');
  await drawing(p, '[bez WebGL] ', 'cs');
  await nogl.close();
})()
  .catch((e) => { console.log('FAIL: výjimka ' + (e && e.stack || e)); process.exitCode = 1; })
  // výjimka nesmí nechat prohlížeč běžet (proces by visel do časového limitu sady)
  .finally(() => Promise.all(browsers.map((x) => x.close().catch(() => {}))));
