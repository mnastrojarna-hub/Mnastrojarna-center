// E2E vlna E – balík help: hledání v nápovědě a tahák pro agenty.
//   1. /cad/dokumentace: pole Hledat nahoře (lepí se pod hlavičkou), `/` a Ctrl+K = do pole, výsledky = oddíly s úryvkem,
//      bez diakritiky i s překlepem, zvýraznění nalezených slov, ztlumený obsah, Enter skočí na oddíl (kotva v adrese),
//      „Jen nalezené kapitoly“ skryje ostatní, Esc vymaže, ?q= v adrese, mobil bez vodorovného posuvu.
//   2. /en/cad/documentation a /de/cad/dokumentation: totéž na přehledové stránce (oddíly s příkazy).
//   3. CAD v prohlížeči: `nápověda hledat …` / `help search …` / `nápověda tahák` přes window.mncad.run = tytéž řádky jako
//      CLI `mncad help search …` / `mncad run` (stručný protokol `= L1 help hits=N q="…"`); `nápověda díra` = pole prvku jako dřív.
//   4. Statické soubory: /cad/tahak.md (+ .en, .de) ≤ 5 kB, /llms.txt má tahák jako první odkaz, schema-pro-ai.md začíná tahákem.
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
const PARTS = (process.env.PARTS || '1,2,3,4').split(',');
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
    ok(/\/ nebo Ctrl\+K/.test(await p.locator('[data-docs-search]').innerText()), 'cs: nápověda kláves „/ nebo Ctrl+K“');
    // klávesy: „/“ mimo pole a Ctrl+K
    await p.mouse.click(1200, 820);
    await p.keyboard.press('/');
    ok((await state(p)).focused, 'cs: „/“ dá kurzor do pole hledání');
    await p.keyboard.press('Escape');
    await p.mouse.click(1200, 820);
    await p.keyboard.press('Control+k');
    ok((await state(p)).focused, 'cs: Ctrl+K dá kurzor do pole hledání');
    await p.mouse.move(5, 5); // ukazatel mimo seznam výsledků (najetí myší mění vybraný výsledek)
    // záložky: oddíl Záložky dokumentů, zvýraznění, obsah
    await p.keyboard.type('záložky');
    await p.waitForTimeout(450);
    let st = await state(p);
    ok(st.results.length >= 3 && st.results.length <= 8, `cs „záložky“: ${st.results.length} výsledků (3–8)`);
    ok(st.results.slice(0, 3).some((r) => /Záložky dokumentů/.test(r.text)), `cs „záložky“: Záložky dokumentů mezi prvními třemi (${st.results.slice(0, 3).map((r) => r.text.slice(0, 60)).join(' | ')})`);
    ok(st.marks > 0, `cs „záložky“: nalezená slova zvýrazněná (${st.marks} značek)`);
    ok(st.dimmed > 0, `cs „záložky“: obsah ztlumí kapitoly bez výsledku (${st.dimmed})`);
    ok(/oddíl/.test(st.count || ''), `cs: počet výsledků v poli (${st.count})`);
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
    await p.mouse.move(5, 5);
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
