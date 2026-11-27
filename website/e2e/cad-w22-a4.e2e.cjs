// E2E (vlna 22, balík A, etapa A4 – body 15, 16, 21 zprávy majitele) na produkčním sestavení:
//  15) konzole: výchozí souhrn (stručný protokol v [data-console-summary]), detail na vyžádání (záložka Detail =
//      [data-agent-output] s plným textem), záznamy s filtrem (✗ / ⚠ / dokument / text), historie běhů (2× Provést →
//      2 položky, klik ukáže předchozí běh), Stáhnout JSON (parsovatelný, run.id, entries[].id), id záznamů v DOM
//      (`data-entry-id="r3:L2.…"`), `sestava pole` 19 kopií = souhrn; window.mncad.run výchozí dál text konzole
//  16) tři `sdílet` v jednom běhu → tři adresy v JSON (shares) i v protokolu; `odkaz ověřit` (✓ / ✗ useknutý); otevření
//      useknutého odkazu v adrese → hláška „Odkaz je useknutý“ (ne „neplatný“ / „nesprávné heslo“)
//  21) bez WebGL: lišta „Softwarové zobrazení – WebGL není dostupné“ neutrálně + stav jádra vedle; klik → seznam omezení
//      a alternativy výběru; EN / DE text; (kolo 6) poznámka v náhledu bez „nelze spustit“ a bez barev chyby, stavový řádek
//      s projekcí náhledu (pravoúhlá), ne „perspektiva“
// Průchody: WebGL (cs), bez WebGL (cs – majitel testoval bez WebGL), EN a DE (texty lišty a konzole).
// Spuštění: E2E_BASE=http://localhost:3531 node e2e/cad-w22-a4.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const S = (process.argv[2] || '/tmp/e2e-w22-a4').replace(/\/?$/, '/');
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
const consoleRun = async (p, text) => {
  const ta = p.locator('#agent-input');
  await ta.fill(text);
  const before = await p.evaluate(() => document.querySelector('[data-agent-output]')?.getAttribute('data-run-id') || '');
  await p.keyboard.press('Control+Enter');
  await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); return !!o && o.getAttribute('data-run-id') !== prev && o.getAttribute('data-run-state') === 'done'; }, before, { timeout: 180000 });
  return p.evaluate(() => document.querySelector('[data-agent-output]').getAttribute('data-run-id'));
};

/* ───────────────────────── 15: konzole ───────────────────────── */
async function consoleView(p, tag) {
  // výchozí API beze změny (skripty agentů): text konzole, ne MNCAD/1
  const api = await p.evaluate(() => window.mncad.run('nový díl "API"\nkvádr 10 10 10'));
  ok(!/^MNCAD\/1/.test(api) && /✓/.test(api), `${tag}15: window.mncad.run výchozí = text konzole (ne stručný protokol)`);
  await p.evaluate(() => { try { localStorage.removeItem('mn-cad-console-short'); } catch {} window.mncad.openConsole(); });
  await p.locator('#agent-input').waitFor({ timeout: 20000 });
  ok(await p.locator('[data-agent-short]').isChecked(), `${tag}15: přepínač „Stručný souhrn“ je výchozí zapnutý`);
  const r1 = await consoleRun(p, 'nový díl "Konzole A"\nkvádr 40 30 10\nneznámý příkaz\nstav');
  const sum = await p.locator('[data-console-summary]').innerText();
  ok(/^MNCAD\/1 FAIL /.test(sum) && /^✗ L3 /m.test(sum) && /^Σ /m.test(sum), `${tag}15: výchozí pohled = souhrn MNCAD/1 s ✗ L3 (${sum.split('\n')[0]})`);
  ok(!(await p.locator('[data-agent-output]').isVisible()), `${tag}15: plný text konzole je skrytý (detail na vyžádání)`);
  ok(/Dokument: „Konzole A“/.test(await p.locator('[data-agent-output]').textContent()), `${tag}15: detail je v DOM ([data-agent-output]) – dřívější skripty ho čtou dál`);
  await p.locator('[data-console-view="detail"]').click();
  ok(await p.locator('[data-agent-output]').isVisible(), `${tag}15: záložka Detail ukáže plný text konzole`);
  await p.locator('[data-console-view="entries"]').click();
  ok((await p.locator('[data-entry-id]').count()) >= 4, `${tag}15: záznamy běhu (${await p.locator('[data-entry-id]').count()})`);
  await p.locator('[data-console-filter-level]').selectOption('error');
  const errIds = await p.locator('[data-entry-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-entry-id')));
  ok(errIds.length === 1 && new RegExp(`^${r1}:L3\\.`).test(errIds[0]), `${tag}15: filtr ✗ → jen chyba L3, id záznamu ${errIds[0]} (z id běhu ${r1})`);
  await p.locator('[data-entry-id]').first().locator('summary').click();
  ok(/id: r\d+:L3\./.test(await p.locator('[data-entry-id]').first().innerText()), `${tag}15: rozbalení řádku ukáže úplné id a detail`);
  await p.locator('[data-console-filter-level]').selectOption('all');
  await p.locator('[data-console-filter-q]').fill('Kvádr');
  ok((await p.locator('[data-entry-id]').count()) >= 1, `${tag}15: textový filtr (díl / prvek)`);
  await p.locator('[data-console-filter-q]').fill('');
  // druhý běh: historie má oba, předchozí protokol se nepřepsal
  const r2 = await consoleRun(p, 'nový díl "Konzole B"\nválec 5 20\nstav');
  const hist = await p.locator('[data-run-history-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-run-history-item')));
  ok(hist.includes(r1) && hist.includes(r2) && hist.indexOf(r2) < hist.indexOf(r1), `${tag}15: historie běhů ${hist.join(', ')} (nejnovější první)`);
  await p.locator(`[data-run-history-item="${r1}"]`).click();
  await p.locator('[data-console-view="summary"]').click();
  ok(/✗ L3 /.test(await p.locator('[data-console-summary]').innerText()) && (await p.locator('[data-agent-output]').getAttribute('data-run-id')) === r1, `${tag}15: klik v historii ukáže předchozí běh ${r1}`);
  // stažení JSON
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.locator('[data-console-json]').click()]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(json.run?.id === r1 && json.entries.every((e) => typeof e.id === 'string') && /^MNCAD\/1/.test(json.full) && dl.suggestedFilename() === `mncad-run-${r1}.json`, `${tag}15: Stáhnout JSON – ${dl.suggestedFilename()}, run.id, entries[].id, full`);
  // sestava pole 19 kopií = souhrn
  await p.locator(`[data-run-history-item="${r2}"]`).click();
  await consoleRun(p, 'nový díl "Deska A"\nkvádr 200 40 10\nnový díl "Šroub"\nválec 6 20\nnová sestava "Pole A"\nvložit "Deska A" ukotvit\nvložit "Šroub" v 10 10 10\nsestava pole "Šroub" 19 rozteč 9 směr X');
  const det = await p.locator('[data-agent-output]').textContent();
  const line = det.split('\n').find((l) => /pole „Šroub“/.test(l)) || '';
  ok(/18 kopií: první .* … poslední .*\(polohy všech: sestava komponenty\)/.test(line) && line.length < 400, `${tag}15: sestava pole = souhrn (${line.length} znaků)`);
  await p.screenshot({ path: S + `${tag || 'cs'}-console.png` });
  await p.keyboard.press('Escape').catch(() => {});
}

/* ───────────────────────── 16: sdílení textem ───────────────────────── */
async function shares(p, tag) {
  const j = JSON.parse(await p.evaluate(() => window.mncad.run('nový díl "Sdílení"\nkvádr 30 20 10\nsdílet odkazem\nsdílet odkazem dní 30\nsdílet odkazem dní 5', { protocol: 'json' })));
  ok(j.shares?.length === 3 && new Set(j.shares.map((s) => s.url)).size === 3, `${tag}16: tři sdílet → tři adresy v JSON shares (${j.shares?.length})`);
  const links = (j.protocol || '').split('\n').filter((l) => /^= L\d+ link /.test(l));
  ok(links.length === 3 && links.every((l) => / mode=link exp=\d{4}-\d{2}-\d{2} .* content=part /.test(l)), `${tag}16: stručný protokol: tři výpisy = … link s režimem, platností a obsahem`);
  const v = await p.evaluate(() => window.mncad.run('odkaz ověřit', { protocol: 'short' }));
  ok(/ ok=1 mode=link /.test(v) && /^MNCAD\/1 OK/.test(v), `${tag}16: odkaz ověřit (poslední odkaz) → ok=1`);
  const url = j.share.url;
  const cut = url.slice(0, Math.floor(url.length * 0.6));
  const v2 = await p.evaluate((u) => window.mncad.run(`odkaz ověřit ${u}`, { protocol: 'short' }), cut);
  ok(/✗ L1 share\.link-broken .*\(truncated\)/.test(v2) && / ok=0 reason=truncated /.test(v2), `${tag}16: useknutý odkaz → ✗ share.link-broken (truncated)`);
  // otevření useknutého odkazu v adrese – srozumitelná hláška s délkou
  const hash = cut.slice(cut.indexOf('#'));
  const q = await p.context().newPage();
  await q.goto(`${BASE}/cad${hash}`, { waitUntil: 'networkidle', timeout: 300000 });
  await q.waitForTimeout(4000);
  const body = await q.locator('body').innerText();
  ok(/Odkaz je useknutý/.test(body) && !/Nesprávné heslo/.test(body), `${tag}16: otevření useknutého odkazu → „Odkaz je useknutý“`);
  await q.close();
}

/* ───────────────────────── 21: softwarové zobrazení ───────────────────────── */
async function softView(p, tag, re) {
  const hdr = await p.locator('header').first().innerText();
  ok(re.test(hdr) && !/3D okno: nedostupné|3D view: unavailable/.test(hdr), `${tag}21: lišta – stav prostředí (${(hdr.match(re) || [''])[0]})`);
  const cls = (await p.locator('[data-env-status="soft"]').getAttribute('class')) || '';
  ok(!/text-brand/.test(cls), `${tag}21: stav prostředí neutrálně (ne barva chyby)`);
  ok(await p.locator('[data-core-status]').isVisible(), `${tag}21: stav jádra / přepočtu vedle (${await p.locator('[data-core-status]').getAttribute('data-core-status')})`);
  await p.evaluate(() => window.mncad.run('nový díl "Soft"\nkvádr 20 20 20'));
  await p.waitForTimeout(300);
  const busySeen = await p.evaluate(async () => {
    const r = window.mncad.run('válec 5 30 v 5 5 0');
    let seen = '';
    for (let i = 0; i < 40 && !seen; i++) { const s = document.querySelector('[data-core-status]')?.getAttribute('data-core-status'); if (s === 'busy') seen = s; await new Promise((x) => setTimeout(x, 25)); }
    await r;
    return seen || document.querySelector('[data-core-status]')?.getAttribute('data-core-status');
  });
  ok(/busy|ready/.test(busySeen || ''), `${tag}21: stav přepočtu se v softwarovém zobrazení ukazuje (${busySeen})`);
  // kolo 6: poznámka nad VYKRESLENÝM modelem není chyba – žádné „3D okno nelze spustit“ ani barvy chyby; stavový řádek
  // ukazuje skutečnou projekci náhledu (pravoúhle), ne nastavenou perspektivu
  const softNote = await p.locator('[data-soft-note]').evaluate((el) => ({ t: el.innerText, bg: getComputedStyle(el).backgroundColor, bd: getComputedStyle(el).borderTopColor }));
  ok(!/nelze spustit|cannot start|kann nicht/i.test(softNote.t) && re.test(softNote.t), `${tag}21: poznámka v náhledu bez „nelze spustit“ (${softNote.t.slice(0, 90).replace(/\s+/g, ' ')})`);
  ok(!/255, 247, 246|243, 198, 194/.test(softNote.bg + softNote.bd), `${tag}21: poznámka v náhledu neutrálně, ne barvou chyby (${softNote.bg} / ${softNote.bd})`);
  const proj = await p.locator('footer [data-projection]').evaluate((el) => ({ k: el.getAttribute('data-projection'), t: el.textContent }));
  ok(proj.k === 'ortho' && /pravoúhlá|orthographic|orthogonal/.test(proj.t) && !/^\S+ · (perspektiva|perspective|Perspektive)$/.test(proj.t.trim()), `${tag}21: stavový řádek – skutečná projekce náhledu (${proj.t})`);
  await p.locator('[data-env-status="soft"]').click();
  await p.locator('[data-viewport-help]').waitFor({ timeout: 5000 });
  const lim = await p.locator('[data-soft-limit]').evaluateAll((els) => els.map((e) => e.getAttribute('data-soft-limit')));
  ok(['surface', 'measure', 'ghosts', 'showGrid', 'gizmo', 'sketches', 'datums', 'ortho'].every((k) => lim.includes(k)), `${tag}21: seznam omezení (${lim.join(', ')})`);
  ok((await p.locator('[data-soft-pick-alternatives] li').count()) === 3, `${tag}21: alternativy výběru hran a ploch`);
  await p.screenshot({ path: S + `${tag || 'cs'}-soft-limits.png` });
  await p.locator('[data-viewport-help]').click({ position: { x: 5, y: 5 } }).catch(() => {});
}

(async () => {
  // WebGL (cs)
  let b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let p = await ctx.newPage();
  await start(p, `${BASE}/cad`);
  await consoleView(p, '');
  await shares(p, '');
  ok(!/Softwarové zobrazení/.test(await p.locator('header').first().innerText()), 'WebGL: lišta nehlásí softwarové zobrazení');
  await b.close();

  // bez WebGL (cs) – majitel testoval bez WebGL
  b = await chromium.launch({ args: ['--disable-gpu', '--disable-software-rasterizer', '--disable-webgl', '--disable-webgl2'] });
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  p = await ctx.newPage();
  await start(p, `${BASE}/cad`);
  await softView(p, 'soft ', /Softwarové zobrazení – WebGL není dostupné/);
  await consoleView(p, 'soft ');
  await b.close();

  // EN a DE bez WebGL – texty lišty
  for (const [lang, re] of [['en', /Software view – WebGL is not available/], ['de', /Software-Ansicht – WebGL ist nicht verfügbar/]]) {
    b = await chromium.launch({ args: ['--disable-gpu', '--disable-software-rasterizer', '--disable-webgl', '--disable-webgl2'] });
    ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    p = await ctx.newPage();
    await start(p, `${BASE}/${lang}/cad`);
    await softView(p, `${lang} `, re);
    await b.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
