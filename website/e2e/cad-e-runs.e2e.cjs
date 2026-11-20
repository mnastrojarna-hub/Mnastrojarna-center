// E2E (vlna E, balík runs) na produkčním sestavení – opakovatelné běhy a protokol v prohlížeči:
//  1) window.mncad.run(skript 3 dokumentů) dvakrát → stejné záložky (Deska, Čep, S), stejné řádky D / objemy, ✓ „znovu použitá
//     záložka“ a ℹ doc.reused; `nový` = nová záložka; konzole (Provést) dvakrát = stejné záložky
//  2) každý dokument vícedokumentového běhu má řádek D s čísly (protocol "full"): díl i sestava
//  3) window.mncad.run(text, { protocol: "short" }) = stručný protokol CLI (mncad run - --formats none) kromě t= / slow= / mem=,
//     ≤ 2 kB, gramatika; "json" / "full"; neznámý protokol = chyba; přepínač konzole „Stručný protokol“ (pamatuje si ho)
//  4) ověření: stav v témže běhu, který sestavu založil (natočená komponenta) = přesná obálka jako samostatné status();
//     B1 prázdná sestava běhu = vlastní záložka + řádek D; B2 27× nový díl = 27 záložek
//  5) anglické rozhraní: `new part "Plate"` dvakrát = jedna záložka, anglická hláška
//  6) recenze: `zpět` / `znovu` a hned záložka / nový díl / zavřít záložku (bez ✗ tab.settle-timeout); normálie a JSON dokument
//     dvakrát = stejné záložky; `nový díl` nepřepíše dokument z setDocument (ℹ doc.name-taken); řádky F souborů skriptu ve
//     stručném protokolu = CLI; převzetí záložky vidět ve stručném protokolu bez notes (jeden řádek ℹ ×N + Σ reused=); volby run kontrolované
// Spuštění: E2E_BASE=http://localhost:3522 node e2e/cad-e-runs.e2e.cjs <složka pro výstupy>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const S = (process.argv[2] || '/tmp/e2e-e-runs').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const WEB = path.resolve(__dirname, '..');
const G = [
  /^MNCAD\/1 (OK|FAIL|STOP) lines=\d+ ops=\d+ err=\d+ warn=\d+ note=\d+ t=\d+(\.\d+)?$/,
  /^(✗|⚠|ℹ) (L-|L\d+-L\d+|L\d+(?:,L\d+)*)(?: ×(\d+))? ([a-z0-9]+(?:[.-][a-z0-9]+)*)(?: (.*))?$/,
  /^= (L-|L\d+) ([a-z0-9]+(?:[.-][a-z0-9]+)*) (.*)$/, /^ {2}\S/,
  /^D "((?:[^"\\]|\\.)*)" (part|asm|draft) (.*)$/,
  /^F ([a-z0-9]+) "((?:[^"\\]|\\.)*)" (\d+)B(?: (.*))?$/,
  /^O (\S+) exp=(\d{4}-\d{2}-\d{2}|none) mode=(store|self|link)$/,
  /^… \d+ entries \d+B in protocol-full\.txt$/, /^Σ (.*)$/,
];
const grammarOk = (text) => text.trim().split('\n').every((l) => G.some((re) => re.test(l)));
// vlna 22 (bod 12): Σ nese id běhu (prohlížeč r<n>, CLI r1) – liší se jako čas, proto se porovnává bez něj
const strip = (s) => s.replace(/ t=[\d.]+/g, '').replace(/ slow=\S+/g, '').replace(/ mem=\d+MB/g, '').replace(/ run=[a-z]+\d+/g, '').trim();
const dLines = (full) => full.split('\n').filter((l) => l.startsWith('D '));

// CLI ze svazku sestaveného s tímto buildem (prebuild → public/cad/cli/<verze>/mncad.mjs)
const latest = JSON.parse(fs.readFileSync(path.join(WEB, 'public/cad/cli/latest.json'), 'utf8'));
const BIN = path.join(WEB, 'public/cad/cli', latest.bundle);
const cliShort = (script, extra = []) => {
  const out = fs.mkdtempSync(path.join(S, 'cli-'));
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', BIN, 'run', '-', '--out', out, '--formats', 'none', ...extra], { input: script, encoding: 'utf8', env: { ...process.env, MNCAD_LANG: '' } });
  return { code: r.status, text: (r.stdout || '').trim(), err: r.stderr };
};

const THREE = 'nový díl "Deska"\nkvádr 100 50 10\nnový díl "Čep"\nválec 5 30\nnová sestava "S"\nvložit "Deska" v 0 0 0\nvložit "Čep" v 20 20 10';

const start = async (p, url) => {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText(/Pokračovat v práci|Continue working/);
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro') && !document.body.innerText.includes('Loading'), null, { timeout: 240000 });
  await p.waitForTimeout(1200);
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await start(p, BASE + '/cad');
  const run = (t, o) => p.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
  const tabs = () => p.evaluate(() => window.mncad.tabs().map((t) => `${t.title}:${t.kind}`));

  // ════════════ 1) + 2) opakovaný běh, řádky D ════════════
  const f1 = await run(THREE, { protocol: 'full' });
  const t1 = await tabs();
  ok(JSON.stringify(t1) === JSON.stringify(['Deska:part', 'Čep:part', 'S:assembly']), `1: první běh → ${t1.join(', ')}`);
  const d1 = dLines(f1);
  ok(d1.length === 3 && d1[0] === 'D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10 solids=1 valid=1' && /^D "Čep" part feat=1\/0\/0 V=0\.59cm3 /.test(d1[1]) && /^D "S" asm comp=2 parts=2 V\.sum=50\.59cm3 /.test(d1[2]), `2: řádek D každého dokumentu s čísly (${d1.join(' | ')})`);
  const f2 = await run(THREE, { protocol: 'full' });
  const t2 = await tabs();
  ok(JSON.stringify(t2) === JSON.stringify(t1), `1: druhý běh → stejné záložky (${t2.join(', ')})`);
  ok(JSON.stringify(dLines(f2)) === JSON.stringify(d1), '1: druhý běh → stejné řádky D (objemy, obálky)');
  ok((f2.match(/^ℹ L\d+ doc\.reused /gm) || []).length === 3 && /✓ L1 nový díl „Deska“ – znovu použitá záložka z dřívějšího běhu/.test(f2), '1: každé převzetí záložky ohlášeno (✓ … znovu použitá záložka, ℹ doc.reused ×3)');
  const c2 = await run(THREE);
  ok(/✓ nový díl „Čep“ – znovu použitá záložka z dřívějšího běhu\nℹ řádek 3: záložka „Čep“ z dřívějšího běhu použita znovu/.test(c2), '1: výchozí protokol (konzole) ohlásí převzetí i ℹ řádkem');
  ok(JSON.stringify(await tabs()) === JSON.stringify(t1), '1: třetí běh (výchozí protokol) → pořád 3 záložky');
  const doc = await p.evaluate(() => window.mncad.getDocument());
  ok(doc.name === 'S' && doc.components.length === 2, `1: sestava má 2 komponenty, ne 4 (${doc.components.length})`);
  await run('nový díl "Deska" nový\nkvádr 1 1 1');
  ok((await tabs()).filter((t) => t === 'Deska:part').length === 2, '1: `nový díl "Deska" nový` = nová záložka (vědomě druhá „Deska“)');
  await p.evaluate(() => window.mncad.closeTab());
  await p.waitForTimeout(800);
  ok(JSON.stringify(await tabs()) === JSON.stringify(t1), '1: po zavření druhé „Deska“ zase 3 záložky');

  // konzole: Provést dvakrát
  await p.evaluate(() => window.mncad.openConsole());
  const input = p.getByLabel('Textové příkazy nebo JSON');
  await input.waitFor({ timeout: 20000 });
  const out = p.locator('[data-agent-output]');
  const consoleRun = async (text, ms = 240000) => {
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev && o.textContent.length > 0; }, before, { timeout: ms });
    return out.innerText();
  };
  const K = 'nový díl "Konzolový"\nkvádr 30 20 10\nnová sestava "Konzolová sestava"\nvložit "Konzolový" v 0 0 0';
  await consoleRun(K);
  const k1 = await tabs();
  const ko2 = await consoleRun(K.replace('kvádr 30 20 10', 'kvádr 30 20 11'));
  const k2 = await tabs();
  ok(JSON.stringify(k1) === JSON.stringify(k2) && k2.length === 5, `1: konzole Provést dvakrát → stejné záložky (${k2.join(', ')})`);
  ok(/znovu použitá záložka/.test(ko2) && !/^✗/m.test(ko2), '1: konzole ohlásí převzetí záložky, žádné ✗');
  // změněný obsah se do převzaté záložky opravdu zapíše, i když hned následuje další dokument (zápis před přepnutím záložky)
  const kst = await run('záložka "Konzolový"\nstav');
  ok(/Rozměry: 30 × 20 × 11 mm/.test(kst), `1: převzatá záložka „Konzolový“ má nový obsah 30 × 20 × 11 (${(/Rozměry: [^(]+/.exec(kst) || [''])[0]})`);
  await run('nový díl "R1"\nkvádr 10 10 10\nnový díl "R2"\nkvádr 5 5 5');
  const rr = await run('nový díl "R1"\nkvádr 20 20 20\nválec 3 30 v 10 10 0\nnový díl "R2"\nkvádr 6 6 6', { protocol: 'full' });
  const r1 = await run('záložka "R1"\nstav');
  ok(!/^✗/m.test(rr) && /prvků 2 /.test(r1) && /Rozměry: 20 × 20 × 30 mm/.test(r1), `1: opakovaný běh se změněným obsahem → R1 má 2 prvky 20 × 20 × 30 (${(/Rozměry: [^(]+/.exec(r1) || [''])[0]})`);
  const ab = await run('záložka "R1"\nválec 2 40 v 5 5 0\nzáložka "R2"');
  const r1b = await run('záložka "R1"\nstav');
  ok(!/^✗/m.test(ab) && /prvků 3 /.test(r1b), `1: úprava dílu a hned \`záložka\` jinam → úprava zůstane (${(/prvků \d+/.exec(r1b) || [''])[0]})`);
  await run('zavřít záložku "R1"\nzavřít záložku "R2"');

  // ════════════ 3) stručný protokol: přepínač konzole ════════════
  // vlna 22, bod 15 (vědomá změna): souhrn je VÝCHOZÍ (přepínač „Stručný souhrn“ zapnutý) a ukazuje se v [data-console-summary];
  // [data-agent-output] drží dál plný text konzole (detail na vyžádání – záložka Detail)
  const sw = p.locator('[data-agent-short]');
  ok(await sw.isVisible().catch(() => false) && (await sw.isChecked()), '3: konzole má přepínač „Stručný souhrn“ (výchozí zapnutý)');
  await sw.check();
  await consoleRun(K);
  const ks = await p.locator('[data-console-summary]').innerText();
  ok(/^MNCAD\/1 OK lines=4 /.test(ks) && grammarOk(ks) && /^D "Konzolová sestava" asm comp=1 /m.test(ks) && /^Σ docs=/m.test(ks), `3: konzole se stručným protokolem → MNCAD/1 (${ks.split('\n')[0]})`);
  await p.screenshot({ path: S + 'e-runs-console-short.png' });
  await p.reload({ waitUntil: 'networkidle' });
  await start(p, BASE + '/cad');
  await p.evaluate(() => window.mncad.openConsole());
  await p.getByLabel('Textové příkazy nebo JSON').waitFor({ timeout: 20000 });
  ok(await p.locator('[data-agent-short]').isChecked(), '3: přepínač „Stručný souhrn“ přežije obnovení stránky');
  await p.locator('[data-agent-short]').uncheck();
  await p.locator('[data-agent-short]').check(); // zpět na výchozí (souhrn)
  await p.keyboard.press('Escape').catch(() => {});
  await p.getByRole('button', { name: 'Zavřít', exact: true }).first().click().catch(() => {});

  // ════════════ 3) window.mncad.run protocol: short = CLI ════════════
  const scripts = [
    THREE,
    `${THREE}\nkolize\nstav`,
    'nový díl "Chybný"\nkvádr 10 10 10\nzaoblit 50 hrany svislé\nnový díl "Dobrý"\nválec 5 10',
    'nová sestava "Jen sestava"',
    'přísně\nnový díl "Přísný"\nkvádr 10 10 10\nblbost',
  ];
  for (const [i, sc] of scripts.entries()) {
    // čerstvá stránka = čerstvá relace jako jeden běh CLI
    const q = await ctx.newPage();
    await start(q, BASE + '/cad');
    const web = await q.evaluate((t) => window.mncad.run(t, { protocol: 'short' }), sc);
    await q.close();
    const cli = cliShort(sc);
    ok(cli.code !== null && cli.text.startsWith('MNCAD/1'), `3: CLI ${latest.version} proběhl (skript ${i + 1}, kód ${cli.code})`);
    ok(strip(web) === strip(cli.text), `3: skript ${i + 1}: stručný protokol prohlížeče = CLI kromě t=/slow=/mem=${strip(web) === strip(cli.text) ? '' : `\n--- web\n${web}\n--- cli\n${cli.text}`}`);
    if (i === 3) ok(/^D "Jen sestava" asm comp=0 parts=0 V\.sum=-$/m.test(web), '4b B1: prázdná sestava (čerstvá stránka) má řádek D i ve stručném protokolu');
    ok(grammarOk(web) && Buffer.byteLength(web, 'utf8') + 1 <= 2048, `3: skript ${i + 1}: gramatika MNCAD/1, ${Buffer.byteLength(web, 'utf8') + 1} B ≤ 2048`);
  }
  const js = JSON.parse(await run('nový díl "J"\nkvádr 10 10 10', { protocol: 'json' }));
  ok(js.v === 1 && js.docs.some((d) => d.name === 'J' && Math.abs(d.volume_mm3 - 1000) < 1e-6) && /^MNCAD\/1 OK/.test(js.protocol) && typeof js.full === 'string' && !('console' in js), '3: protocol "json" = RunReport (docs, protocol, full, bez console)');
  const err = await p.evaluate(() => window.mncad.run('stav', { protocol: 'brief' }).then(() => '', (e) => String(e.message || e)));
  ok(/neznámý protokol „brief“ – console, short, full, json/.test(err), `3: neznámý protokol = chyba (${err})`);
  const def = await run('stav');
  ok(/^Dokument: „J“/m.test(def) && !/^MNCAD\/1/.test(def), '3: bez volby = text konzole beze změny');

  // ════════════ 4) stav v témže běhu; B1; B2 ════════════
  const st = await run('nový díl "Hřídel"\nválec 20 100\nnová sestava "Natočená"\nvložit "Hřídel" v 0 0 0 otočení 45 0 0\nvložit "Hřídel" v 50 0 0\nstav\nzáložky', { protocol: 'full' });
  const sep = await p.evaluate(() => window.mncad.status());
  const env = (t) => (/obálka ([\d,  ×]+) mm/.exec(t) || [])[1];
  ok(!/se stavějí zvlášť/.test(st) && !!env(st) && env(st) === env(sep), `4a: stav uprostřed běhu, který sestavu založil = přesná obálka jako samostatné status() (${env(st)} / ${env(sep)})`);
  const st2 = await run('nový díl "Hřídel 2"\nválec 20 100\nnová sestava "Natočená 2"\nvložit "Hřídel 2" v 0 0 0 otočení 45 0 0\nstav');
  const sep2 = await p.evaluate(() => window.mncad.status());
  ok(!/se stavějí zvlášť/.test(st2) && !!env(st2) && env(st2) === env(sep2), `4a: stav jako poslední řádek téhož běhu = tatáž obálka jako samostatné status() (${env(st2)} / ${env(sep2)})`);
  const before = (await tabs()).length;
  // plný protokol: ve stručném je řádek D jen u hlavního dokumentu (zde je hlavní starší sestava s komponentami) a u ✗/⚠
  const e1 = await run('nová sestava "Prázdná"', { protocol: 'full' });
  const e2 = await run('nový díl "Po prázdné"\nkvádr 1 1 1');
  const tb = await tabs();
  ok(tb.includes('Prázdná:assembly') && tb.includes('Po prázdné:part') && tb.length === before + 2, `4b B1: prázdná sestava běhu zůstává vlastní záložkou (${tb.slice(-2).join(', ')})`);
  ok(/^D "Prázdná" asm comp=0 parts=0 V\.sum=-/m.test(e1) && !/^✗/m.test(e2), '4b B1: prázdná sestava běhu má řádek D');
  const b2before = (await tabs()).length;
  const f27 = await run(Array.from({ length: 27 }, (_, i) => `nový díl "B2-${i + 1}"\nkvádr 1 1 ${i + 1}`).join('\n'), { protocol: 'full' });
  const b2after = (await tabs()).length;
  const d27 = dLines(f27).filter((l) => /^D "B2-\d+" part feat=1\/0\/0 V=[\d.]+cm3 /.test(l));
  ok(b2after - b2before === 27 && d27.length === 27 && !/^✗/m.test(f27), `4b B2: 27× nový díl → +${b2after - b2before} záložek, ${d27.length} řádků D s čísly`);

  // ════════════ 6) recenze ════════════
  {
    const r = await ctx.newPage();
    r.on('pageerror', (e) => errs.push(e.message));
    await start(r, BASE + '/cad');
    const rr = (t, o) => r.evaluate(([t, o]) => window.mncad.run(t, o), [t, o]);
    const rtabs = () => r.evaluate(() => window.mncad.tabs().map((t) => `${t.title}:${t.kind}`));
    const feats = async (name) => { const o = await rr(`záložka "${name}"\nstav`); return Number((/prvků (\d+)/.exec(o) || [])[1]); };
    // 6a – zpět / znovu a hned přepnutí záložky, nová záložka, zavření (dřív ✗ tab.settle-timeout po 5 s)
    await rr('nový díl "W1"\nkvádr 10 10 10\nnový díl "W2"\nkvádr 5 5 5');
    let t0 = Date.now();
    const a1 = await rr('záložka "W1"\nválec 3 30\nzpět\nzáložka "W2"\nválec 2 10', { protocol: 'full' });
    const ms1 = Date.now() - t0;
    ok(!/^✗/m.test(a1) && !/settle-timeout/.test(a1) && ms1 < 4500, `6a: záložka W1, válec, zpět, záložka W2, válec → bez ✗ (${ms1} ms)${/^✗/m.test(a1) ? '\n' + a1 : ''}`);
    ok((await feats('W1')) === 1 && (await feats('W2')) === 2, '6a: válec ve W2, W1 jen kvádr (zpět platí)');
    t0 = Date.now();
    const a2 = await rr('záložka "W2"\nválec 5 20\nzpět\nnový díl "U2"\nkvádr 5 5 5', { protocol: 'full' });
    const ms2 = Date.now() - t0;
    ok(!/^✗/m.test(a2) && (await rtabs()).includes('U2:part') && ms2 < 4500, `6a: zpět a hned nový díl "U2" → záložka U2 existuje (${(await rtabs()).join(', ')}, ${ms2} ms)`);
    const a3 = await rr('záložka "W1"\nválec 3 30\nzpět\nznovu\nzpět\nzavřít záložku "W2"', { protocol: 'full' });
    ok(!/^✗/m.test(a3) && !(await rtabs()).includes('W2:part'), `6a: zpět / znovu a hned zavřít záložku "W2" → W2 zavřená (${(await rtabs()).join(', ')})`);
    // 6b – normálie dvakrát = stejné záložky
    const NORM = 'nový díl "Deska N"\nkvádr 100 60 20\nnormálie kolík 8x40 ISO 8734\nnormálie podložka M8 ISO 7089\nnová sestava "Sestava N"\nvložit "Deska N" ukotvit\nvložit "Kolík Ø8×40 ISO 8734" v 20 20 20\nvložit "Podložka 8 ISO 7089" v 50 20 20';
    const n0 = (await rtabs()).length;
    await rr(NORM);
    const n1 = (await rtabs()).length;
    const no2 = await rr(NORM);
    const n2 = (await rtabs()).length;
    ok(n1 - n0 === 4 && n2 === n1, `6b: normálie dvakrát → +${n1 - n0}, pak +${n2 - n1} záložek (dřív +2 při každém dalším běhu)`);
    ok(/✓ normálie „ISO 8734 – 8×40 – m6“ – znovu použitá záložka z dřívějšího běhu/.test(no2) && !/^✗/m.test(no2), '6b: druhý běh ohlásí převzetí záložky normálie');
    // 6c – JSON / setDocument: dvakrát = jedna záložka; `nový díl` téhož názvu ji nepřepíše
    const docA = { app: 'mnastrojarna-cad', version: 2, name: 'Agent JSON', material: 'ocel', features: [{ id: 'j1', name: 'Kvádr 1', type: 'box', size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: 'new' }] };
    await r.evaluate((d) => window.mncad.setDocument(d), docA);
    await r.evaluate((d) => window.mncad.setDocument(d), docA);
    ok((await rtabs()).filter((t) => t === 'Agent JSON:part').length === 1, '6c: setDocument téhož dokumentu dvakrát → jedna záložka');
    await r.evaluate((d) => window.mncad.setDocument({ ...d, name: 'Ručně', features: [] }), docA);
    const nt = await rr('nový díl "Ručně"\nkvádr 3 3 3');
    ok((await rtabs()).filter((t) => t === 'Ručně:part').length === 2 && /doc\.name-taken|nezaložil ji stejný druh příkazu/.test(nt) && /– nová záložka/.test(nt), '6c: `nový díl "Ručně"` po setDocument „Ručně“ → nová záložka + ℹ doc.name-taken (dokument z JSON zůstal)');
    // 6e – převzetí záložky ve stručném protokolu bez notes
    await rr(THREE.replace(/"S"/g, '"S6"'));
    const sh = await rr(THREE.replace(/"S"/g, '"S6"'), { protocol: 'short' });
    ok(/^ℹ L1,L3,L5 ×3 doc\.reused záložky z dřívějšího běhu použité znovu – obsah nahrazen \(volba „nový“ = nová záložka\): „Deska“, „Čep“, „S6“$/m.test(sh) && / reused=3 /.test(sh) && grammarOk(sh), `6e: stručný protokol bez notes ukáže převzetí jedním řádkem (ℹ ×3 s názvy, Σ reused=3)\n${sh}`);
    const shn = await rr(THREE.replace(/"S"/g, '"S6"'), { protocol: 'short', notes: true });
    ok((shn.match(/^ℹ L\d+ doc\.reused "/gm) || []).length === 3 && grammarOk(shn), '6e: s notes každé převzetí zvlášť (ℹ L1 / L3 / L5 doc.reused "…")');
    // 6f – volby run
    const rej = (o) => r.evaluate((o) => window.mncad.run('stav', o).then(() => 'OK', (e) => String(e.message || e)), o);
    ok(/^MNCAD\/1 /.test(await r.evaluate(() => window.mncad.run('stav', 'short'))), '6f: run(text, "short") = stručný protokol');
    ok(/neznámá volba „protocoll“/.test(await rej({ protocoll: 'short' })), '6f: překlep {protocoll} = chyba');
    ok(/budget musí být celé číslo 1–1048576/.test(await rej({ protocol: 'short', budget: -5 })) && /budget musí být celé číslo/.test(await rej({ protocol: 'short', budget: 'abc' })), '6f: budget -5 / "abc" = chyba');
    ok(/budget platí jen pro protokol short/.test(await rej({ budget: 500 })), '6f: budget bez short = chyba');
    await r.close();
  }
  // 6d – soubory skriptu: řádky F a Σ files= jako CLI (čerstvá stránka = čerstvá relace)
  for (const sc of ['nový díl "E"\nkvádr 10 10 10\nexport step', 'nový díl "E2"\nkvádr 10 10 10\nvýkres A4 pohledy přední\nkótovat\nvýkres export pdf']) {
    const q = await ctx.newPage();
    await start(q, BASE + '/cad');
    const web = await q.evaluate((t) => window.mncad.run(t, { protocol: 'short' }), sc);
    await q.close();
    const cli = cliShort(sc);
    const fl = (t) => (t.match(/^F .*$/m) || [''])[0];
    ok(/^F (step|pdf) "E2?(_vykres)?\.(step|pdf)" \d+B/m.test(web) && / files=1 /.test(web), `6d: ${sc.split('\n').pop()}: řádek F a files=1 v prohlížeči (${fl(web)})`);
    const norm = (t) => strip(t).replace(/^(F \S+ "[^"]+") \d+B/m, '$1 #B');
    ok(norm(web) === norm(cli.text), `6d: ${sc.split('\n').pop()}: stručný protokol prohlížeče = CLI (F: web ${fl(web)} / cli ${fl(cli.text)})${norm(web) === norm(cli.text) ? '' : `\n--- web\n${web}\n--- cli\n${cli.text}`}`);
    if (sc.endsWith('export step')) ok(/^F step "E\.step" \d+B check=ok rev=r·[0-9a-f]{6}$/m.test(web), '6d: STEP s kontrolou check=ok i v prohlížeči');
  }

  // ════════════ 5) anglické rozhraní ════════════
  const e = await ctx.newPage();
  await start(e, BASE + '/en/cad');
  const en = (t) => e.evaluate((t) => window.mncad.run(t), t);
  await en('new part "Plate"\nbox 10 10 10');
  const enOut = await en('new part "Plate"\nbox 10 10 10');
  const enTabs = await e.evaluate(() => window.mncad.tabs().map((t) => t.title));
  ok(enTabs.filter((t) => t === 'Plate').length === 1 && /reused the tab from an earlier run/.test(enOut), `5: EN: new part "Plate" dvakrát → jedna záložka, anglická hláška (${enTabs.join(', ')})`);
  const enShort = await e.evaluate(() => window.mncad.run('new part "Plate" again\nbox 20 20 20', { protocol: 'short', notes: true }));
  ok(/^ℹ L1 doc\.reused "Plate": the tab “Plate” from an earlier run was reused/m.test(enShort), '5: EN: `again` + notes → ℹ doc.reused anglicky ve stručném protokolu');
  await e.close();

  ok(!errs.length, `bez chyb stránky (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
