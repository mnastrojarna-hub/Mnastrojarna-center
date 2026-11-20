// E2E vlna E – balík help: hledání v nápovědě a tahák pro agenty.
//   1. /cad/dokumentace: pole Hledat nahoře (lepí se pod hlavičkou), `/` a Ctrl+K = do pole, výsledky = oddíly s úryvkem,
//      bez diakritiky i s překlepem, zvýraznění nalezených slov, ztlumený obsah, Enter skočí na oddíl (kotva v adrese),
//      „Jen nalezené kapitoly“ skryje ostatní, Esc vymaže, ?q= v adrese, mobil bez vodorovného posuvu.
//   2. /en/cad/documentation a /de/cad/dokumentation: totéž na přehledové stránce (oddíly s příkazy).
//   3. CAD v prohlížeči: `nápověda hledat …` / `help search …` / `nápověda tahák` přes window.mncad.run = tytéž řádky jako
//      CLI `mncad help search …` / `mncad run` (stručný protokol `= L1 help hits=N q="…"`); `nápověda díra` = pole prvku jako dřív.
//   4. Statické soubory: /cad/tahak.md (+ .en, .de) ≤ 5 kB, /llms.txt má tahák jako první odkaz, schema-pro-ai.md začíná tahákem.
//   5. Opravy po recenzi (regrese): pole hledání je v první obrazovce a lepí se po celé stránce; filtr, ztlumení obsahu
//      a zvýraznění podle VŠECH shod; myš, která jen stojí, nepřebírá výběr; klik v obsahu a odkaz #kotva nezajedou pod
//      pole; `/` úplně dole pole ukáže; „Jen nalezené kapitoly“ hluboko na stránce, klik na skrytou kapitolu, Esc;
//      CLI: víc hledání v běhu, dlouhý dotaz, překlep „sestva“, anglický tahák (`fixed`), `mncad help search` bez slov.
// Spuštění (produkční server): E2E_BASE=http://localhost:3521 node e2e/cad-e-help.e2e.cjs <složka pro výstupy>
//   MNCAD_BUNDLE=public/cad/cli/<verze>/mncad.mjs (jinak podle public/cad/cli/latest.json)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const S = (process.argv[2] || '/tmp/e2e-help').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const WEB = path.resolve(__dirname, '..');
/** PARTS=2,3 = jen vybrané části (1 česká dokumentace + mobil, 2 EN/DE, 3 CAD = CLI, 4 statické soubory) */
const PARTS = (process.env.PARTS || '1,2,3,4,5').split(',');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };

function bundle() {
  if (process.env.MNCAD_BUNDLE) return path.resolve(WEB, process.env.MNCAD_BUNDLE);
  const latest = JSON.parse(fs.readFileSync(path.join(WEB, 'public/cad/cli/latest.json'), 'utf8'));
  return path.join(WEB, 'public/cad/cli', latest.bundle);
}
const cli = (args, input, lang = 'cs') => execFileSync(process.execPath, [bundle(), ...args], { input, encoding: 'utf8', env: { ...process.env, MNCAD_LANG: lang }, timeout: 120000 });

/** stav hledání na stránce: výsledky, značky, skryté oddíly */
const state = (p) =>
  p.evaluate(() => ({
    results: [...document.querySelectorAll('[data-docs-search-result]')].map((li) => ({ id: li.getAttribute('data-docs-search-result'), text: li.innerText.replace(/\s+/g, ' ') })),
    marks: document.querySelectorAll('mark[data-doc-hit]').length,
    count: document.querySelector('[data-docs-search-count]')?.textContent ?? null,
    hidden: [...document.querySelectorAll('[data-search-hit="0"]')].filter((s) => s.style.display === 'none').length,
    dimmed: [...document.querySelectorAll('[data-docs-toc] a')].filter((a) => a.style.opacity === '0.3').length,
    focused: document.activeElement?.getAttribute('role') === 'combobox',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

async function typeQuery(p, q) {
  const input = p.getByRole('combobox');
  await input.fill('');
  await input.fill(q);
  await p.waitForTimeout(450);
}

let b;
(async () => {
  b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------- 1. česká dokumentace ----------
  if (PARTS.includes('1')) {
    const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/cad/dokumentace', { waitUntil: 'networkidle', timeout: 120000 });
    const input = p.getByRole('combobox', { name: 'Hledat v dokumentaci' });
    ok(await input.isVisible(), 'cs: pole Hledat v dokumentaci je vidět');
    const box = await input.boundingBox();
    const art = await p.locator('article.doc').boundingBox();
    ok(box && art && box.y < art.y, `cs: pole je nad textem dokumentace (pole y=${Math.round(box?.y)}, článek y=${Math.round(art?.y)})`);
    ok(box && box.y >= 70 && box.y + box.height <= 860, `cs: pole je v první obrazovce hned pod hlavičkou (y=${Math.round(box?.y)}…${Math.round(box?.y + box?.height)})`);
    ok(/\/ nebo Ctrl\+K/.test(await p.locator('[data-docs-search]').innerText()), 'cs: nápověda kláves „/ nebo Ctrl+K“');
    // klávesy: „/“ mimo pole a Ctrl+K
    await p.mouse.click(1200, 820);
    await p.keyboard.press('/');
    ok((await state(p)).focused, 'cs: „/“ dá kurzor do pole hledání');
    await p.keyboard.press('Escape');
    await p.mouse.click(1200, 820);
    await p.keyboard.press('Control+k');
    ok((await state(p)).focused, 'cs: Ctrl+K dá kurzor do pole hledání');
    // ukazatel zůstává tam, kde se kliklo (nad místem seznamu výsledků) – výběr mění jen skutečný pohyb myši
    // záložky: oddíl Záložky dokumentů, zvýraznění, obsah
    await p.keyboard.type('záložky');
    await p.waitForTimeout(450);
    let st = await state(p);
    ok(st.results.length >= 3 && st.results.length <= 8, `cs „záložky“: ${st.results.length} výsledků (3–8)`);
    ok(st.results.slice(0, 3).some((r) => /Záložky dokumentů/.test(r.text)), `cs „záložky“: Záložky dokumentů mezi prvními třemi (${st.results.slice(0, 3).map((r) => r.text.slice(0, 60)).join(' | ')})`);
    ok(st.marks > 0, `cs „záložky“: nalezená slova zvýrazněná (${st.marks} značek)`);
    ok(st.dimmed > 0, `cs „záložky“: obsah ztlumí kapitoly bez výsledku (${st.dimmed})`);
    ok(/oddíl/.test(st.count || ''), `cs: počet oddílů se shodou v poli (${st.count})`);
    const lb = await p.locator('#docs-search-results').boundingBox();
    ok(lb && lb.y > 0 && lb.y + 60 < 860, `cs: po Ctrl+K se pole posune nahoru a seznam výsledků je vidět (y=${lb && Math.round(lb.y)})`);
    await p.screenshot({ path: S + 'docs-cs-zalozky.png' });
    // Enter = skok na první výsledek
    const first = st.results[0] || { id: '?' };
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1500);
    const jumped = await p.evaluate(() => {
      const el = document.querySelector('[data-search-jump]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, h: window.innerHeight, hash: location.hash };
    });
    ok(jumped && jumped.top > 60 && jumped.top < jumped.h - 40, `cs: Enter skočí na výsledek (top=${jumped && Math.round(jumped.top)})`);
    ok(jumped && jumped.hash === '#' + first.id, `cs: kotva v adrese = oddíl výsledku (${jumped?.hash} / #${first.id})`);
    const searchBox = await p.locator('[data-docs-search]').boundingBox();
    ok(searchBox && searchBox.y >= 0 && searchBox.y < 140, `cs: pole se po skoku lepí nahoře (y=${Math.round(searchBox?.y)})`);
    await p.screenshot({ path: S + 'docs-cs-jump.png' });
    // bez diakritiky a s překlepem
    await typeQuery(p, 'zalozky');
    st = await state(p);
    ok(st.results.slice(0, 3).some((r) => /Záložky dokumentů/.test(r.text)), 'cs „zalozky“ (bez diakritiky): Záložky dokumentů mezi prvními třemi');
    await typeQuery(p, 'kolise');
    st = await state(p);
    ok(st.results.some((r) => /[Kk]oliz/.test(r.text)), `cs „kolise“ (překlep): výsledek s kolizí (${st.results.slice(0, 3).map((r) => r.text.slice(0, 50)).join(' | ')})`);
    await typeQuery(p, 'pružina mezi díly');
    st = await state(p);
    ok(st.results.slice(0, 3).some((r) => /[Pp]ružin/.test(r.text)), 'cs „pružina mezi díly“: výsledek o pružinách mezi prvními třemi');
    // jen nalezené kapitoly
    await p.locator('[data-docs-search-only]').check();
    await p.waitForTimeout(300);
    st = await state(p);
    const total = await p.locator('article.doc section.doc-section').count();
    ok(st.hidden > 0 && st.hidden < total, `cs: „Jen nalezené kapitoly“ skryje ${st.hidden} z ${total} kapitol`);
    // Esc = vymazat
    await p.getByRole('combobox').focus();
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    st = await state(p);
    const visible = await p.locator('article.doc section.doc-section:visible').count();
    ok(st.results.length === 0 && st.marks === 0 && visible === total && st.dimmed === 0, `cs: Esc vymaže hledání, značky i filtr (značek ${st.marks}, vidět ${visible}/${total})`);
    // nic nenalezeno
    await typeQuery(p, 'qqqxxyzz');
    ok(/Nic nenalezeno/.test(await p.locator('#docs-search-results').innerText().catch(() => '')), 'cs: nic nenalezeno = rada');
    // ?q= v adrese
    await p.goto(BASE + '/cad/dokumentace?q=kusovn%C3%ADk', { waitUntil: 'networkidle', timeout: 120000 });
    await p.waitForTimeout(600);
    st = await state(p);
    ok(st.results.some((r) => /[Kk]usovník/.test(r.text)) && st.marks > 0, `cs ?q=kusovník: výsledky hned po načtení (${st.results.length})`);
    ok(errs.length === 0, 'cs: bez JS chyb ' + errs.join(' | '));
    await p.close();
  }

  // ---------- mobil ----------
  if (PARTS.includes('1')) {
    const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.goto(BASE + '/cad/dokumentace', { waitUntil: 'networkidle', timeout: 120000 });
    // posun stránky jako prstem (scrollIntoView s isMobile posouvá jen vizuální výřez – ťuknutí pak trefí úvod stránky)
    await m.evaluate(() => window.scrollTo(0, document.querySelector('[data-docs-search]').getBoundingClientRect().top + window.scrollY - 300));
    await m.waitForTimeout(400);
    await m.getByRole('combobox').tap();
    await m.keyboard.type('export step');
    await m.waitForTimeout(500);
    const st = await state(m);
    const list = await m.locator('#docs-search-results').boundingBox();
    ok(st.results.length > 0, `mobil: výsledky (${st.results.length})`);
    ok(!st.overflow && list && list.x >= 0 && list.x + list.width <= 391, `mobil: bez vodorovného posuvu, seznam v okně (${list && Math.round(list.x + list.width)})`);
    await m.screenshot({ path: S + 'docs-mobile.png' });
    await m.close();
  }

  // ---------- 2. EN / DE přehled ----------
  if (PARTS.includes('2')) for (const [loc, url, q, want, name] of [
    ['en', '/en/cad/documentation', 'strict', /[Ss]trict|CLI|browser/, 'Search the documentation'],
    ['en', '/en/cad/documentation', 'shortcuts', /[Ss]hortcut/, 'Search the documentation'],
    ['de', '/de/cad/dokumentation', 'tastenkürzel', /Tastenk/, 'Dokumentation durchsuchen'],
  ]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 120000 });
    const input = p.getByRole('combobox', { name });
    ok(await input.isVisible(), `${loc}: pole hledání na ${url}`);
    await p.mouse.click(1200, 780);
    await p.keyboard.press('/');
    ok((await state(p)).focused, `${loc}: „/“ dá kurzor do pole`);
    await p.keyboard.type(q);
    await p.waitForTimeout(450);
    const st = await state(p);
    ok(st.results.length > 0 && want.test(st.results[0].text + ' ' + (st.results[1]?.text ?? '')), `${loc} „${q}“: ${st.results.length} výsledků, první: ${st.results[0]?.text.slice(0, 80)}`);
    ok(st.marks > 0, `${loc} „${q}“: zvýraznění (${st.marks})`);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1200);
    ok(/^#\w+/.test(await p.evaluate(() => location.hash)), `${loc}: Enter skočí na oddíl (${await p.evaluate(() => location.hash)})`);
    await p.screenshot({ path: S + `docs-${loc}-${q}.png` });
    ok(errs.length === 0, `${loc}: bez JS chyb ` + errs.join(' | '));
    await p.close();
  }

  // ---------- 3. CAD v prohlížeči = CLI ----------
  const cases = [
    { lang: 'cs', app: '/cad', run: 'nápověda hledat záložky', cliArgs: ['help', 'search', 'záložky'] },
    { lang: 'cs', app: '/cad', run: 'nápověda pružina mezi díly', cliArgs: ['help', 'pružina', 'mezi', 'díly'] },
    { lang: 'cs', app: '/cad', run: 'nápověda hledat prisny rezim', cliArgs: ['help', 'search', 'prisny', 'rezim'] },
    { lang: 'en', app: '/en/cad', run: 'help search tabs', cliArgs: ['help', 'search', 'tabs'] },
    { lang: 'de', app: '/de/cad', run: 'hilfe suchen stückliste', cliArgs: ['help', 'search', 'stückliste'] },
  ];
  if (PARTS.includes('3')) for (const lang of ['cs', 'en', 'de']) {
    const my = cases.filter((c) => c.lang === lang);
    const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + my[0].app, { waitUntil: 'networkidle', timeout: 240000 });
    const cont = p.getByText(/Pokračovat v práci|Continue working|Weiterarbeiten/).first();
    if (await cont.isVisible({ timeout: 3000 }).catch(() => false)) await cont.click();
    await p.waitForFunction(() => !!window.mncad && document.body.innerText.includes('OCCT'), null, { timeout: 240000 });
    await p.waitForTimeout(800);
    for (const c of my) {
      const out = await p.evaluate((t) => window.mncad.run(t), c.run);
      const cliOut = cli(c.cliArgs, '', c.lang).trim();
      const rows = cliOut.split('\n');
      ok(rows.length >= 6 && rows.length <= 9 && /^1\. /.test(rows[1]), `${lang} CLI mncad ${c.cliArgs.join(' ')}: záhlaví + ${rows.length - 1} výsledků`);
      const missing = rows.filter((r) => !out.includes(r));
      ok(missing.length === 0, `${lang} prohlížeč „${c.run}“ = CLI (chybí ${missing.length} řádků: ${missing.slice(0, 2).join(' | ').slice(0, 200)})`);
      // recenze: i výstup v prohlížeči začíná strojovým řádkem jako stručný protokol CLI
      ok(new RegExp(`^= L1 help hits=${rows.length - 1} q="`).test(out.split('\n')[0]), `${lang} prohlížeč: první řádek = strojový řádek (${out.split('\n')[0].slice(0, 70)})`);
      const short = cli(['run', '-', '--formats', 'none', '--out', path.join(S, `cli-out-${lang}`)], c.run, c.lang);
      const m = /^= L1 help hits=(\d) q="([^"]*)"$/m.exec(short);
      ok(m && Number(m[1]) === rows.length - 1, `${lang} CLI mncad run: ${m ? m[0] : short.split('\n').slice(0, 3).join(' / ')}`);
      const cont2 = short.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.slice(2));
      ok(cont2.length === rows.length && cont2.every((l, i) => l === rows[i]), `${lang} CLI mncad run: výsledky jako pokračovací řádky = mncad help search (${cont2.length}/${rows.length})`);
      ok(Buffer.byteLength(short) <= 2048, `${lang} CLI mncad run: stručný protokol ≤ 2 kB (${Buffer.byteLength(short)} B)`);
      fs.writeFileSync(S + `run-${lang}-${c.cliArgs.slice(1).join('-')}.txt`, `# prohlížeč\n${out}\n# CLI help\n${cliOut}\n# CLI run\n${short}`);
    }
    if (lang === 'cs') {
      const cheat = await p.evaluate(() => window.mncad.run('nápověda tahák'));
      ok(/# Tahák pro AI agenty/.test(cheat) && /nová sestava/.test(cheat) && /nápověda hledat/.test(cheat), 'cs prohlížeč: nápověda tahák vypíše tahák');
      const hole = await p.evaluate(() => window.mncad.run('nápověda díra'));
      ok(/Díra \(hole\)/.test(hole) && /nápověda hledat díra/.test(hole), 'cs prohlížeč: nápověda díra = pole prvku jako dřív + rada na hledání');
      const bad = await p.evaluate(() => window.mncad.run('prvek nápověda xyzqq'));
      ok(/neznámý typ prvku/.test(bad), 'cs prohlížeč: prvek nápověda <neznámé> zůstává chybou');
      await p.screenshot({ path: S + 'cad-help-search.png' });
    }
    if (lang === 'en') {
      const cheat = await p.evaluate(() => window.mncad.run('help cheatsheet'));
      ok(/# Cheat sheet for AI agents/.test(cheat), 'en prohlížeč: help cheatsheet = anglický tahák');
    }
    if (lang === 'de') {
      const cheat = await p.evaluate(() => window.mncad.run('hilfe spickzettel'));
      ok(/# Spickzettel für KI-Agenten/.test(cheat), 'de prohlížeč: hilfe spickzettel = německý tahák');
    }
    ok(errs.length === 0, `${lang} CAD: bez JS chyb ` + errs.join(' | '));
    await ctx.close();
  }
  // CLI: tahák na příkazové řádce
  if (PARTS.includes('3')) {
  const cheatCli = cli(['help', 'cheat'], '');
  ok(/^# Tahák pro AI agenty/.test(cheatCli) && Buffer.byteLength(cheatCli) <= 5120, `CLI mncad help cheat (${Buffer.byteLength(cheatCli)} B)`);
  ok(/^# Cheat sheet for AI agents/.test(cli(['help', 'cheat'], '', 'en')), 'CLI MNCAD_LANG=en mncad help cheat = anglicky');
  const cheatRun = cli(['run', '-', '--formats', 'none', '--out', path.join(S, 'cli-out-cheat')], 'nápověda tahák');
  ok(/^= L1 help cheat=cs bytes=\d+$/m.test(cheatRun) && /zavřít záložku/.test(cheatRun) && /… celý tahák \(\d+ B\): mncad help cheat/.test(cheatRun) && Buffer.byteLength(cheatRun) <= 2048 && !/protocol-full/.test(cheatRun), `CLI mncad run „nápověda tahák“: začátek taháku + odkaz ve stručném protokolu (${Buffer.byteLength(cheatRun)} B)`);
  fs.writeFileSync(S + 'run-cs-cheat.txt', cheatRun);
  }

  // ---------- 5. opravy po recenzi ----------
  if (PARTS.includes('5')) {
    /** kapitoly: obsahuje slovo (innerText bez diakritiky), ztlumená v obsahu, skrytá filtrem */
    const chapters = (p, word) => p.evaluate((w) => {
      const f = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return [...document.querySelectorAll('article.doc section.doc-section')].map((s) => ({ id: s.id, has: f(s.innerText || s.textContent).includes(w), hidden: s.style.display === 'none', dim: document.querySelector(`[data-docs-toc] a[href="#${s.id}"]`)?.style.opacity === '0.3', marks: s.querySelectorAll('mark[data-doc-hit]').length }));
    }, word);
    const field = (p) => p.evaluate(() => { const r = document.querySelector('[data-docs-search] input[type=search]').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
    const settle = async (p) => { let last = -1; for (let i = 0; i < 30; i++) { await p.waitForTimeout(300); const y = await p.evaluate(() => Math.round(scrollY)); if (y === last && i > 2) break; last = y; } };

    // 5a. pole v první obrazovce (stolní i mobil, cs / en / de)
    for (const [url, w, h] of [['/cad/dokumentace', 1366, 768], ['/cad/dokumentace', 390, 844], ['/en/cad/documentation', 1280, 800], ['/de/cad/dokumentation', 390, 844]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 120000 });
      const r = await field(p);
      const crumb = await p.evaluate(() => { const n = document.querySelector('[data-docs-page] nav[aria-label] a, [data-docs-search-scope] nav[aria-label] a'); return n ? Math.round(n.getBoundingClientRect().top) : null; });
      ok(r.top >= 60 && r.bottom <= r.vh && r.top < 200, `5a ${url} ${w}×${h}: pole hledání v první obrazovce (y=${r.top}…${r.bottom})`);
      ok(crumb === null || crumb >= r.bottom, `5a ${url} ${w}×${h}: pole nezakrývá drobečkovou navigaci (drobečky y=${crumb}, pole do ${r.bottom})`);
      ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `5a ${url} ${w}×${h}: bez vodorovného posuvu`);
      await p.close();
    }

    const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/cad/dokumentace', { waitUntil: 'networkidle', timeout: 120000 });
    await p.mouse.move(5, 5);

    // 5b. filtr, ztlumení a zvýraznění podle všech shod (seznam zůstává nejlepších 8)
    for (const word of ['vykres', 'sestava', 'pruzina']) {
      await p.keyboard.press('Control+k');
      await p.keyboard.press('Control+a');
      await p.keyboard.type(word, { delay: 10 });
      await p.waitForTimeout(700);
      let ch = await chapters(p, word);
      const withWord = ch.filter((c) => c.has);
      const st = await state(p);
      ok(st.results.length <= 8 && withWord.length > 3, `5b „${word}“: seznam ${st.results.length} výsledků, slovo je v ${withWord.length} z ${ch.length} kapitol`);
      ok(withWord.every((c) => !c.dim), `5b „${word}“: žádná kapitola se slovem není v obsahu ztlumená (ztlumené se slovem: ${withWord.filter((c) => c.dim).map((c) => c.id).join(', ') || '—'})`);
      ok(withWord.every((c) => c.marks > 0), `5b „${word}“: každá kapitola se slovem má zvýraznění (bez: ${withWord.filter((c) => !c.marks).map((c) => c.id).join(', ') || '—'})`);
      const total = Number(await p.locator('[data-docs-search-count]').getAttribute('data-docs-search-total'));
      ok(total >= st.results.length && (total <= 8 || /\d+ z \d+ oddílů/.test(st.count || '')), `5b „${word}“: počet říká pravdu (${st.count}, oddílů se shodou ${total})`);
      await p.locator('[data-docs-search-only]').check();
      await p.waitForTimeout(500);
      ch = await chapters(p, word);
      ok(ch.filter((c) => c.has).every((c) => !c.hidden) && ch.some((c) => c.hidden), `5b „${word}“ + Jen nalezené kapitoly: skryté jsou jen kapitoly bez slova (skryto ${ch.filter((c) => c.hidden).length}, z toho se slovem ${ch.filter((c) => c.hidden && c.has).length})`);
      await p.locator('[data-docs-search-only]').uncheck();
      await p.waitForTimeout(300);
    }
    await p.keyboard.press('Control+k');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);

    // 5c. myš, která jen stojí nad místem seznamu, nepřebírá výběr: Enter po psaní = první výsledek
    for (const y of [300, 400]) {
      await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await p.waitForTimeout(200);
      await p.mouse.move(683, y); // ukazatel zůstane stát tam, kde se za chvíli otevře seznam výsledků
      await p.keyboard.press('/');
      await p.keyboard.type('kusovnik', { delay: 15 });
      await p.waitForTimeout(600);
      const s0 = await p.evaluate(() => ({ active: document.querySelector('[role=combobox]').getAttribute('aria-activedescendant'), first: document.querySelector('[data-docs-search-result]')?.getAttribute('data-docs-search-result'), list: (() => { const r = document.querySelector('#docs-search-results').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })() }));
      ok(s0.list[0] < y && s0.list[1] > y, `5c ukazatel [683;${y}] stojí nad seznamem výsledků (seznam y ${s0.list.join('…')})`);
      ok(s0.active === 'docs-search-opt-0', `5c ukazatel stojí na [683;${y}]: vybraný je první výsledek (${s0.active})`);
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1200);
      ok((await p.evaluate(() => location.hash)) === '#' + s0.first, `5c Enter skočil na první výsledek #${s0.first} (${await p.evaluate(() => location.hash)})`);
      // skutečný pohyb myši výběr změní
      await p.keyboard.press('Control+k');
      await p.waitForTimeout(400);
      const li = await p.locator('#docs-search-opt-2').boundingBox();
      if (li) { await p.mouse.move(li.x + 40, li.y + 10); await p.mouse.move(li.x + 60, li.y + 14); }
      await p.waitForTimeout(150);
      ok((await p.evaluate(() => document.querySelector('[role=combobox]').getAttribute('aria-activedescendant'))) === 'docs-search-opt-2', '5c pohyb myši nad třetí výsledek ho vybere');
      await p.keyboard.press('Escape');
      await p.mouse.move(5, 5);
    }

    // 5d. klik v obsahu: nadpis kapitoly je pod polem hledání (ne pod ním schovaný); přímý odkaz #kotva také
    const heading = (p2, id) => p2.evaluate((i) => { const h = document.querySelector(`#${i} h2`); const r = h.getBoundingClientRect(); const sb = document.querySelector('[data-docs-search]').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 30, Math.max(1, r.top + r.height / 2)); return { top: Math.round(r.top), bar: Math.round(sb.bottom), inView: r.top > 0 && r.bottom < innerHeight, covered: !(h.contains(e) || (e && e.contains(h))) }; }, id);
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    let hd;
    for (let k = 0; k < 4; k++) { // obrázky se načítají líně – první klik může dojet o kus výš, další dojede přesně
      await p.evaluate(() => document.querySelector('[data-docs-toc] a[href="#sestavy"]').click());
      await settle(p);
      hd = await heading(p, 'sestavy');
      if (hd.inView && hd.top < 300) break;
    }
    ok(hd.inView && !hd.covered && hd.top >= hd.bar, `5d klik v obsahu na „11. Sestavy“: nadpis vidět pod polem hledání (nadpis y=${hd.top}, pole do ${hd.bar}, zakrytý ${hd.covered})`);
    const d = await b.newPage({ viewport: { width: 1366, height: 860 } });
    await d.goto(BASE + '/cad/dokumentace#vykresy', { waitUntil: 'networkidle', timeout: 120000 });
    await settle(d);
    for (let k = 0; k < 3; k++) { hd = await heading(d, 'vykresy'); if (hd.inView) break; await d.evaluate(() => document.getElementById('vykresy').scrollIntoView({ behavior: 'instant' })); await settle(d); }
    ok(hd.inView && !hd.covered && hd.top >= hd.bar, `5d přímý odkaz /cad/dokumentace#vykresy: nadpis vidět pod polem hledání (nadpis y=${hd.top}, pole do ${hd.bar}, zakrytý ${hd.covered})`);
    await d.close();

    // 5e. „/“ a Ctrl+K úplně dole (výzva a patička pod dokumentací): pole se vrátí do okna
    for (const [url, key] of [['/cad/dokumentace', '/'], ['/en/cad/documentation', 'Control+k']]) {
      const q = await b.newPage({ viewport: { width: 1366, height: 860 } });
      await q.goto(BASE + url, { waitUntil: 'networkidle', timeout: 120000 });
      await q.mouse.move(5, 5);
      for (let i = 0; i < 6; i++) { await q.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await q.waitForTimeout(350); }
      const before = await field(q);
      await q.keyboard.press(key);
      await q.waitForTimeout(500);
      await q.keyboard.type('kusovnik');
      await q.waitForTimeout(700);
      const r = await field(q);
      const val = await q.evaluate(() => document.querySelector('[data-docs-search] input[type=search]').value);
      ok(before.top < 0 && r.top >= 60 && r.bottom < r.vh && val === 'kusovnik', `5e ${url} úplně dole, „${key}“: pole je vidět (před y=${before.top}, po y=${r.top}, hodnota „${val}“)`);
      await q.close();
    }

    // 5f. „Jen nalezené kapitoly“ hluboko na stránce: pohled zůstane v dokumentaci u pole hledání
    for (const frac of [0.6, 0.85]) {
      const q = await b.newPage({ viewport: { width: 1366, height: 860 } });
      await q.goto(BASE + '/cad/dokumentace', { waitUntil: 'networkidle', timeout: 120000 });
      await q.mouse.move(5, 5);
      for (let i = 0; i < 5; i++) { await q.evaluate((f) => window.scrollTo({ top: document.documentElement.scrollHeight * f, behavior: 'instant' }), frac); await q.waitForTimeout(350); }
      await q.keyboard.press('Control+k');
      await q.waitForTimeout(300);
      await q.keyboard.type('pružina', { delay: 20 });
      await q.waitForTimeout(700);
      await q.keyboard.press('Tab');
      await q.keyboard.press('Tab');
      await q.keyboard.press('Space');
      await q.waitForTimeout(900);
      const s1 = await q.evaluate(() => { const e = document.elementFromPoint(900, 500); const sec = e?.closest('article.doc section.doc-section'); return { checked: document.querySelector('[data-docs-search-only]').checked, top: Math.round(document.querySelector('[data-docs-search] input[type=search]').getBoundingClientRect().top), where: e?.closest('footer') ? 'patička' : sec ? 'dokumentace #' + sec.id : (e?.tagName || '?'), hit: sec?.dataset.searchHit }; });
      ok(s1.checked && s1.top >= 60 && s1.top < 200 && /dokumentace/.test(s1.where) && s1.hit === '1', `5f stránka na ${Math.round(frac * 100)} %, filtr zapnutý klávesnicí: pole y=${s1.top}, uprostřed okna ${s1.where} (kapitola se shodou: ${s1.hit})`);
      await q.close();
    }

    // 5g. filtr zapnutý: klik v obsahu na skrytou kapitolu ji ukáže; Esc filtr vypne i pro další hledání
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await p.keyboard.press('Control+k');
    await p.keyboard.press('Control+a');
    await p.keyboard.type('kusovník', { delay: 15 });
    await p.waitForTimeout(700);
    await p.locator('[data-docs-search-only]').check();
    await p.waitForTimeout(600);
    const hid = await p.evaluate(() => document.querySelector('#rychly-start').style.display);
    await p.evaluate(() => document.querySelector('[data-docs-toc] a[href="#rychly-start"]').click());
    await settle(p);
    const shown = await p.evaluate(() => { const s = document.querySelector('#rychly-start'); const r = s.getBoundingClientRect(); return { disp: getComputedStyle(s).display, top: Math.round(r.top), vh: innerHeight, only: document.querySelector('[data-docs-search-only]')?.checked }; });
    ok(hid === 'none' && shown.disp !== 'none' && shown.top > 0 && shown.top < shown.vh, `5g filtr zapnutý, klik v obsahu na skrytou „2. Rychlý start“: kapitola se ukáže (před ${hid}, po ${JSON.stringify(shown)})`);
    await p.keyboard.press('Control+k');
    await p.keyboard.press('Control+a');
    await p.keyboard.type('kusovník', { delay: 15 });
    await p.waitForTimeout(600);
    await p.locator('[data-docs-search-only]').check();
    await p.waitForTimeout(400);
    await p.getByRole('combobox').focus();
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    await p.keyboard.type('pružina', { delay: 15 });
    await p.waitForTimeout(700);
    const s3 = await p.evaluate(() => ({ checked: document.querySelector('[data-docs-search-only]')?.checked ?? null, hidden: [...document.querySelectorAll('article.doc section.doc-section')].filter((s) => s.style.display === 'none').length }));
    ok(s3.checked === false && s3.hidden === 0, `5g po Esc a novém hledání je filtr vypnutý (${JSON.stringify(s3)})`);
    ok(errs.length === 0, '5 dokumentace: bez JS chyb ' + errs.join(' | '));
    await p.close();

    // 5i. Zpět po klientské navigaci přes domovskou stránku (celý web): připnutá sekce úvodu (GSAP pin-spacer) nesmí shodit
    //     React při odchodu ze stránky – ani po kliknutí na odkaz, ani po Zpět na dokumentaci s hledáním v adrese
    {
      const q = await b.newPage({ viewport: { width: 1366, height: 860 } });
      const e2 = [];
      q.on('pageerror', (e) => e2.push(e.message));
      const crashed = () => q.evaluate(() => /Application error/.test(document.body.innerText));
      const pinned = () => q.waitForFunction(() => document.querySelector('[data-hscroll]')?.closest('.pin-spacer'), null, { timeout: 15000 }).then(() => true, () => false);
      await q.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120000 });
      ok(await pinned(), '5i úvodní stránka: sekce Archiv zakázek je připnutá (pin-spacer) – stav, ve kterém web dřív padal');
      await q.evaluate(() => [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/sluzby')?.click());
      await q.waitForTimeout(2500);
      ok(!(await crashed()) && /\/sluzby$/.test(q.url()), `5i úvod → odkaz Služby: stránka se otevře bez pádu (${q.url().replace(BASE, '')})`);
      await q.goto(BASE + '/cad/dokumentace?q=kusovn%C3%ADk', { waitUntil: 'networkidle', timeout: 120000 });
      await q.waitForTimeout(800);
      await q.evaluate(() => [...document.querySelectorAll('header a')].find((x) => x.getAttribute('href') === '/')?.click());
      await q.waitForTimeout(1500);
      await pinned();
      await q.goBack();
      await q.waitForTimeout(3000);
      const back = await q.evaluate(() => ({ url: location.pathname + location.search, results: document.querySelectorAll('[data-docs-search-result]').length, value: document.querySelector('[data-docs-search] input[type=search]')?.value ?? null }));
      ok(!(await crashed()) && /^\/cad\/dokumentace\?q=/.test(back.url) && back.value === 'kusovník', `5i dokumentace?q=kusovník → úvod → Zpět: bez pádu, hledání zpět (${JSON.stringify(back)})`);
      ok(e2.length === 0, '5i bez JS chyb ' + [...new Set(e2)].join(' | ').slice(0, 200));
      await q.close();
    }

    // 5h. CLI: víc hledání v jednom běhu, dlouhý dotaz, překlep, anglický tahák, mncad help search bez slov
    const multi = cli(['run', '-', '--formats', 'none', '--out', path.join(S, 'cli-out-multi')], 'nápověda hledat záložky\nnápověda hledat pružina mezi díly\nnápověda hledat kusovník\n');
    const heads = multi.split('\n').filter((l) => /^= L\d help hits=\d+( of=\d+)? q="/.test(l));
    ok(heads.length === 3 && Buffer.byteLength(multi) <= 2048 && !/protocol-full/.test(multi), `5h tři hledání v jednom běhu: ${heads.length} řádky = L<n> help, ${Buffer.byteLength(multi)} B, bez přetečení (${heads.join(' / ')})`);
    ok(/`záložky`/.test(multi) && /sestava pružina/.test(multi) && /`kusovník/.test(multi), '5h tři hledání: každé má své výsledky ve stručném protokolu');
    fs.writeFileSync(S + 'run-cs-multi.txt', multi);
    const longQ = 'jak mám v sestavě nástroje vložit sedmdesát dílů z otevřených záložek tak aby každý měl svou přezdívku a vazby '.repeat(4).trim();
    const long = cli(['run', '-', '--formats', 'none', '--out', path.join(S, 'cli-out-long')], `nápověda hledat ${longQ}\n`);
    ok(/^= L1 help hits=[5-8] q="jak mám v sestavě[^"]*…"$/m.test(long) && /^ {2}1\. /m.test(long) && !/protocol-full/.test(long) && Buffer.byteLength(long) <= 2048, `5h dotaz ${Buffer.byteLength(longQ)} B: řádek = L1 help se zkráceným dotazem a výsledky (${Buffer.byteLength(long)} B)`);
    const typo = cli(['help', 'search', 'sestva'], '');
    ok(/– [5-8] nejlepších výsledků/.test(typo) && /sestav/i.test(typo.split('\n')[1] || ''), `5h překlep „sestva“: ${typo.split('\n')[0].slice(0, 60)} / ${(typo.split('\n')[1] || '').slice(0, 70)}`);
    ok(/díra|Díra/.test(cli(['help', 'search', 'dyra'], '')), '5h překlep „dyra“ najde díry');
    const en = cli(['run', '-', '--formats', 'none', '--out', path.join(S, 'cli-out-en'), '--lang', 'en'], 'new part "Plate"\nbox 100 60 12\nnew assembly "Tool"\ninsert "Plate" at 0 0 0 fixed as "D1"\nassembly\n');
    ok(/^MNCAD\/1 OK /.test(en) && /Plate \[D1\]/.test(en) && !/^✗/m.test(en), `5h anglický tahák: insert … fixed as "D1" vloží ukotvenou komponentu (${en.split('\n')[0]})`);
    ok(/insert "Plate" at 0 0 0 fixed as "D1"/.test(cli(['help', 'cheat', '--lang', 'en'], '')), '5h mncad help cheat --lang en: „fixed as“');
    const enCheat = cli(['run', '-', '--formats', 'none', '--out', path.join(S, 'cli-out-en2'), '--lang', 'en'], 'help cheatsheet\n');
    ok(/mncad help cheat --lang en · /.test(enCheat), '5h anglický běh: odkaz na celý tahák říká mncad help cheat --lang en');
    let noWords = '';
    try { cli(['help', 'search'], ''); noWords = 'exit 0'; } catch (e) { noWords = `exit ${e.status}: ${String(e.stderr || e.stdout).trim()}`; }
    ok(/^exit 3: .*chybí slova/.test(noWords) && !/neznámé téma/.test(noWords), `5h mncad help search bez slov: ${noWords.slice(0, 120)}`);
  }

  // ---------- 4. statické soubory ----------
  if (PARTS.includes('4')) {
  const get = async (u) => {
    const r = await fetch(BASE + u);
    return { status: r.status, text: await r.text() };
  };
  for (const [f, head] of [['/cad/tahak.md', '# Tahák pro AI agenty'], ['/cad/tahak.en.md', '# Cheat sheet for AI agents'], ['/cad/tahak.de.md', '# Spickzettel für KI-Agenten']]) {
    const r = await get(f);
    ok(r.status === 200 && r.text.startsWith(head) && Buffer.byteLength(r.text) <= 5120, `${f}: 200, ${Buffer.byteLength(r.text)} B ≤ 5 kB`);
  }
  const llms = await get('/llms.txt');
  const firstLink = /\[[^\]]+\]\(([^)]+)\)/.exec(llms.text);
  ok(firstLink && /\/cad\/tahak\.md$/.test(firstLink[1]), `llms.txt: první odkaz = tahák (${firstLink && firstLink[1]})`);
  const schema = await get('/cad/schema-pro-ai.md');
  ok(/tahak\.md/.test(schema.text.slice(0, 800)) && /nápověda hledat/.test(schema.text.slice(0, 800)), 'schema-pro-ai.md: tahák a hledání hned na začátku');
  ok(/## Tahák pro AI agenty/.test(schema.text.slice(0, 2500)), 'schema-pro-ai.md: tahák je vložený za úvodem');
  }

  await b.close();
})().catch(async (e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
  if (b) await b.close().catch(() => undefined);
});
