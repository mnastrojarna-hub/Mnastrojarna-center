// E2E výstupů textem (balík B3 outputs, CAD-HEADLESS-NAVRH.md kap. 3.1, 3.4, 3.5) – v Node (SESTAVENÉ CLI mncad v izolované
// složce) i v prohlížeči (window.mncad.run, stažení bez dialogu):
//  A) CLI: sestava se 2 díly s výkresy → `uložit`, `export step` (F … check=ok), `výkres export pdf dokument` (jedno PDF,
//     stránek = listů = 3: sestava + každý díl jednou), `export step base64` (= … file, data v JSON), `sdílet úložiště`
//     proti php -S (index.php) → O … mode=self, krátký odkaz; --formats auto = STEP + .mncad + PDF všech listů (3 stránky);
//     STEP se stejnými bajty mezi dvěma běhy (SHA-256); stručný protokol ≤ 2048 B a gramatika; úložiště vypnuté +
//     `sdílet úložiště` → ✗ share.store-unavailable (exit 1); úložiště odmítne (403) → ✗ share.rejected + ⚠ share.fallback-link
//  B) prohlížeč (E2E_BASE): tytéž příkazy textem → stažení Ulozeni.mncad / Ulozeni.step / Ulozeni_vykresy.pdf (3 stránky),
//     řádek BASE64 = bajty staženého STEP, `sdílet úložiště` bez úložiště = ✗ (žádný tichý dlouhý odkaz), `sdílet úložiště
//     nebo odkaz` = ⚠ + odkaz, který v nové kartě otevře sestavu se 3 komponentami; konzole: „listů 3“, žádný dialog
//
// Spuštění:  node e2e/cad-outputs.e2e.cjs [pracovní složka]                 (jen CLI)
//            E2E_BASE=http://localhost:3373 node e2e/cad-outputs.e2e.cjs      (CLI + prohlížeč)
//            E2E_SKIP_CLI=1 E2E_BASE=… node e2e/cad-outputs.e2e.cjs           (jen prohlížeč)
//   MNCAD_NODE=/opt/node24/bin/node … (CLI na jiné verzi Node) · MNCAD_DIST=public/cad/cli/<verze> (hotový svazek)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const WEB = path.resolve(__dirname, '..');
const WORK = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mncad-out-e2e-')));
const NODE = process.env.MNCAD_NODE || process.execPath;
fs.mkdirSync(WORK, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pdfPages = (b) => (Buffer.from(b).toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
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
const bytes = (s) => Buffer.byteLength(s, 'utf8') + 1;

const SCRIPT = [
  // nepředepsané tolerance v razítku dílů – bez nich export listu dílu hlásí ⚠ drawing.warning (vlna 15, razítko); číslo výkresu
  // vyráběného dílu PŘED vložením do sestavy – bez něj výstup sestavy hlásí ⚠ bom.make-incomplete (vlna 22, bod 19), po vložení
  // ⚠ asm.stale-copy (bod 22g). Stejný počet řádků jako dřív (čísla řádků L18 / L20 níže)
  'nový díl Deska', 'kvádr 80 60 10', 'díra 10,5 skrz v 40 30', 'výkres A4', 'výkres razítko číslo="D-1" nepředepsané="ISO 2768-mK"',
  'nový díl Čep', 'válec 10 30', 'výkres A4', 'výkres razítko číslo="D-2" nepředepsané="ISO 2768-mK"',
  'nová sestava Uložení', 'vložit "Deska" ukotvit', 'vložit "Čep" v 100 0 0', 'vložit "Čep" v 150 0 0', 'výkres A3 na šířku',
].join('\n');
const OUTS = ['uložit', 'export step', 'výkres export pdf dokument', 'export step base64'];

function cli(bin, args, o = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(NODE, ['--max-old-space-size=2048', bin, ...args], { cwd: o.cwd || WORK, env: { ...process.env, MNCAD_LANG: '', MNCAD_WASM: '' } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.stdin.end();
    const guard = setTimeout(() => p.kill('SIGKILL'), o.limit || 300000);
    p.on('exit', (code) => { clearTimeout(guard); resolve({ code, out, err, ms: Date.now() - t0 }); });
  });
}
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const freePort = () => new Promise((res) => { const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function cliPart() {
  let DIST = process.env.MNCAD_DIST && path.resolve(WEB, process.env.MNCAD_DIST);
  if (!DIST) {
    execFileSync(process.execPath, [path.join(WEB, 'scripts/cad-cli-build.mjs'), '--out', path.join(WORK, 'dist'), '--quiet'], { stdio: 'inherit' });
    const latest = JSON.parse(fs.readFileSync(path.join(WORK, 'dist', 'latest.json'), 'utf8'));
    DIST = path.join(WORK, 'dist', latest.version);
  }
  const ISO = path.join(WORK, 'iso');
  fs.rmSync(ISO, { recursive: true, force: true });
  fs.mkdirSync(path.join(ISO, 'fonts'), { recursive: true });
  for (const f of ['mncad.mjs', 'replicad_single.wasm', 'package.json', 'fonts/Roboto-Regular.ttf', 'fonts/Roboto-Bold.ttf']) fs.copyFileSync(path.join(DIST, f), path.join(ISO, f));
  const BIN = path.join(ISO, 'mncad.mjs');
  console.log(`# CLI: ${execFileSync(NODE, ['--version']).toString().trim()} · ${DIST}`);
  const IN = path.join(WORK, 'in');
  fs.mkdirSync(IN, { recursive: true });
  fs.writeFileSync(path.join(IN, 'out.txt'), [SCRIPT, ...OUTS, 'sdílet úložiště', 'export step odkaz'].join('\n') + '\n');
  fs.writeFileSync(path.join(IN, 'nostore.txt'), 'nový díl Deska\nkvádr 80 60 10\nsdílet úložiště\n');

  // ── php -S s public/cad/share/index.php ──
  let php = true;
  try { execFileSync('php', ['--version'], { stdio: 'ignore' }); } catch { php = false; }
  let ps = null;
  let store = null;
  if (php) {
    const www = path.join(WORK, 'www', 'cad', 'share');
    fs.mkdirSync(www, { recursive: true });
    for (const f of ['index.php', 'store.php', '.htaccess', '.user.ini']) if (fs.existsSync(path.join(WEB, 'public/cad/share', f))) fs.copyFileSync(path.join(WEB, 'public/cad/share', f), path.join(www, f));
    // stránka odkazu na soubor (… odkaz) vedle úložiště – jako na webu
    fs.mkdirSync(path.join(WORK, 'www', 'cad', 'soubor'), { recursive: true });
    fs.copyFileSync(path.join(WEB, 'public/cad/soubor/index.html'), path.join(WORK, 'www', 'cad', 'soubor', 'index.html'));
    const port = await freePort();
    ps = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', path.join(WORK, 'www')], { stdio: 'ignore' });
    store = `http://127.0.0.1:${port}/cad/share/`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(store + '?ping')).ok) break; } catch { /* ještě ne */ } await new Promise((r) => setTimeout(r, 100)); }
  } else console.log('# php chybí – sdílení do úložiště přeskočeno (sdílet úložiště → ✗)');

  // ── A1: výstupy textem + --formats auto + --share ──
  const o1 = path.join(WORK, 'o1');
  let r = await cli(BIN, ['run', path.join(IN, 'out.txt'), '--out', o1, '--json', '--share', ...(store ? ['--share-store', store] : ['--share-store', 'off'])]);
  const j = json(r);
  console.log(`# běh 1: ${r.ms} ms, kód ${r.code}`);
  if (!j) console.log(r.out.slice(0, 2000), r.err.slice(-2000));
  const P = j?.protocol || '';
  ok(r.code === (store ? 0 : 1) && j, `CLI výstupy textem → kód ${r.code}`);
  ok(bytes(P) <= 2048 && grammarOk(P), `stručný protokol ${bytes(P)} B ≤ 2048, gramatika OK`);
  const files = Object.fromEntries((j?.files || []).map((f) => [f.name, f]));
  const names = Object.keys(files).sort();
  ok(['Ulozeni.mncad', 'Ulozeni.step', 'Ulozeni_vykresy.pdf', 'Uložení.mncad', 'Uložení.step', 'Uložení výkres.pdf'].every((n) => names.includes(n)), `soubory: ${names.join(', ')}`);
  const pdfText = fs.existsSync(path.join(o1, 'Ulozeni_vykresy.pdf')) ? fs.readFileSync(path.join(o1, 'Ulozeni_vykresy.pdf')) : Buffer.alloc(0);
  const pdfAuto = fs.existsSync(path.join(o1, 'Uložení výkres.pdf')) ? fs.readFileSync(path.join(o1, 'Uložení výkres.pdf')) : Buffer.alloc(0);
  ok(pdfPages(pdfText) === 3 && files['Ulozeni_vykresy.pdf']?.sheets === 3, `výkres export pdf dokument: stránek ${pdfPages(pdfText)} = listů ${files['Ulozeni_vykresy.pdf']?.sheets} (sestava + Deska + Čep jednou)`);
  ok(pdfPages(pdfAuto) === 3 && files['Uložení výkres.pdf']?.sheets === 3, `--formats auto: jedno PDF všech listů, stránek ${pdfPages(pdfAuto)}`);
  ok(/^F pdf "Ulozeni_vykresy\.pdf" \d+B sheets=3/m.test(P) || /^F \S+ "\*" \d+B files=\d+/m.test(P), 'řádek F PDF se sheets=3 (nebo souhrnný řádek F)');
  ok(files['Ulozeni.step']?.check?.ok === true && files['Uložení.step']?.check?.ok === true, `STEP s kontrolou znovunačtením: ${files['Ulozeni.step']?.check?.text}`);
  ok(files['Ulozeni.step'] && files['Ulozeni.step'].sha256 === files['Uložení.step']?.sha256, 'STEP z textu a z --formats: stejné bajty (SHA-256)');
  const b64 = (j?.entries || []).find((e) => e.code === 'file');
  ok(b64 && b64.data?.name === 'Ulozeni.step' && sha(Buffer.from(b64.data.base64, 'base64')) === files['Ulozeni.step']?.sha256 && new RegExp(`^= L18 file "Uložení" name="Ulozeni\\.step" format=step bytes=\\d+ sha256=${files['Ulozeni.step']?.sha256}`, 'm').test(P), `export step base64: = L18 file …, data v JSON (${b64?.data?.bytes} B), base64 není ve stručném protokolu: ${!P.includes(String(b64?.data?.base64 || 'x').slice(0, 60))}`);
  if (store) {
    ok(j?.share?.mode === 'self' && j.share.url.length <= 200 && /^O http:\/\/127\.0\.0\.1:\d+\/(s#[1-9A-HJ-NP-Za-km-z]{10}|cad#q=\S+) exp=\d{4}-\d{2}-\d{2} mode=self$/m.test(P), `--share + sdílet úložiště: O … mode=self (${j?.share?.url?.length} znaků)`);
    const bins = fs.readdirSync(path.join(WORK, 'cad-share-data')).filter((f) => f.endsWith('.bin'));
    ok(bins.length >= 2, `v úložišti ${bins.length} šifrované obsahy (text sdílet + --share)`);
    ok(!(j?.entries || []).some((e) => e.level === 'error' || e.level === 'warn'), `bez ⚠/✗: ${(j?.entries || []).filter((e) => e.level === 'error' || e.level === 'warn').map((e) => e.code).join(', ')}`);
    // export step odkaz: soubor zašifrovaný v úložišti, odkaz na stránku ke stažení; stránka v Chromiu soubor dešifruje
    const fl = (j?.entries || []).find((e) => e.code === 'file' && e.data?.url);
    ok(fl && new RegExp(`^= L20 file "Uložení" name="Ulozeni\\.step" format=step bytes=\\d+ sha256=[0-9a-f]{64} url=http://127\\.0\\.0\\.1:\\d+/cad/soubor/index\\.html#f=[0-9A-Za-z]{10}\\.[A-Za-z0-9_-]{22} exp=\\d{4}-\\d{2}-\\d{2}`, 'm').test(P), `export step odkaz → = L20 file … url=… (${fl?.data?.url?.length} znaků)`);
    if (fl) {
      const { chromium } = require('playwright');
      const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
      const ctx = await b.newContext({ acceptDownloads: true });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(fl.data.url, { waitUntil: 'load', timeout: 60000 });
      await pg.waitForFunction(() => document.body.dataset.state === 'ready' || document.body.dataset.state === 'error', null, { timeout: 60000 });
      const state = await pg.evaluate(() => ({ s: document.body.dataset.state, t: document.getElementById('st').textContent, f: window.mncadFile }));
      const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('#dl')]);
      const fp = path.join(WORK, 'page-' + d.suggestedFilename());
      await d.saveAs(fp);
      ok(state.s === 'ready' && d.suggestedFilename() === 'Ulozeni.step' && sha(fs.readFileSync(fp)) === fl.data.sha256 && state.f?.sha256 === fl.data.sha256 && errs.length === 0, `stránka odkazu na soubor: dešifrováno a staženo ${d.suggestedFilename()} (${state.t}) – SHA-256 souhlasí`);
      const pg2 = await ctx.newPage(); // jiná část za # = táž stránka bez nového načtení → nová karta
      await pg2.goto(fl.data.url.replace(/\.[A-Za-z0-9_-]{22}$/, '.' + 'A'.repeat(22)), { waitUntil: 'load' });
      await pg2.waitForFunction(() => !!document.body.dataset.state, null, { timeout: 60000 });
      const bad = await pg2.evaluate(() => ({ s: document.body.dataset.state, t: document.getElementById('st').textContent, dl: !document.getElementById('dl').hidden }));
      ok(bad.s === 'error' && !bad.dl && /dešifrovat/.test(bad.t), `stránka s jiným klíčem: srozumitelná chyba, nic ke stažení (${bad.t})`);
      await b.close();
    }
  }
  // ── A2: druhý běh → stejné bajty STEP ──
  const o2 = path.join(WORK, 'o2');
  r = await cli(BIN, ['run', path.join(IN, 'out.txt'), '--out', o2, '--json', '--formats', 'step', '--share-store', 'off']);
  const j2 = json(r);
  const f2 = Object.fromEntries((j2?.files || []).map((f) => [f.name, f]));
  ok(f2['Uložení.step'] && f2['Uložení.step'].sha256 === files['Uložení.step']?.sha256, `STEP mezi běhy: stejné bajty (${String(f2['Uložení.step']?.sha256).slice(0, 12)}…)`);
  ok(r.code === 1 && /^✗ L19,L20 ×2 share\.store-unavailable "Uložení": úložiště krátkých odkazů není nastavené$/m.test(j2?.protocol || ''), 'úložiště vypnuté + sdílet úložiště a export step odkaz → ✗ share.store-unavailable (sloučené L17,L18 ×2), kód 1, žádný dlouhý odkaz');
  ok(!j2?.share, 'bez odkazu (žádný řádek O)');
  // ── A3: úložiště odmítne zápis (403) → ✗ share.rejected + ⚠ share.fallback-link, O mode=link ──
  const fake = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('?ping')) return res.end(JSON.stringify({ ok: true, v: 1, max_bytes: 26214400, chunk_bytes: 8388608, max_days: 90 }));
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'origin' }));
  });
  await new Promise((res) => fake.listen(0, '127.0.0.1', res));
  r = await cli(BIN, ['run', path.join(IN, 'nostore.txt'), '--out', path.join(WORK, 'o3'), '--json', '--formats', 'none', '--share', '--share-store', `http://127.0.0.1:${fake.address().port}/cad/share/`]);
  fake.close();
  const j3 = json(r);
  const P3 = j3?.protocol || '';
  ok(r.code === 1 && /^✗ L- share\.rejected "Deska": úložiště odkazů odmítlo zápis: .*403 origin/m.test(P3) && /^⚠ L- share\.fallback-link "Deska": krátký odkaz se nepodařil – použit dlouhý odkaz \(\d+ znaků\)/m.test(P3) && j3?.share?.mode === 'link' && /^O \S+#s=1d\.\S+ exp=\S+ mode=link$/m.test(P3), `--share, úložiště 403 → ✗ share.rejected + ⚠ share.fallback-link + O mode=link (kód ${r.code})`);
  ok(/^✗ L3 share\.rejected "Deska"/m.test(P3), 'text sdílet úložiště při 403 → ✗ share.rejected na řádku 3, bez náhradního odkazu');
  if (ps) ps.kill();
}

async function browserPart(BASE) {
  const { chromium } = require('playwright');
  const CAD = BASE.replace(/\/$/, '') + '/cad';
  const S = path.join(WORK, 'browser');
  fs.mkdirSync(S, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const dialogs = [];
  const errs = [];
  const dl = [];
  p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('download', (d) => dl.push(d));
  const ready = async (page, url) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
    const c = page.getByText('Pokračovat v práci');
    if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
    await page.waitForFunction(() => !!window.mncad && !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro'), null, { timeout: 240000 });
    await page.waitForTimeout(1000);
  };
  await ready(p, CAD);
  const run = (text) => p.evaluate((t) => window.mncad.run(t), text);
  let log = await run(SCRIPT);
  ok(!/^✗/m.test(log), 'prohlížeč: sestava se 2 díly a výkresy bez ✗');
  log = await run(OUTS.join('\n'));
  const t0 = Date.now();
  while (dl.length < 3 && Date.now() - t0 < 120000) await p.waitForTimeout(250);
  const got = {};
  for (const d of dl) { const f = path.join(S, d.suggestedFilename()); await d.saveAs(f); got[d.suggestedFilename()] = fs.readFileSync(f); }
  ok(['Ulozeni.mncad', 'Ulozeni.step', 'Ulozeni_vykresy.pdf'].every((n) => got[n]) && Object.keys(got).length === 3, `stažení bez dialogu: ${Object.keys(got).join(', ')} (base64 se nestahuje)`);
  ok(pdfPages(got['Ulozeni_vykresy.pdf'] || Buffer.alloc(0)) === 3 && /^✓ výkres PDF, listů 3: Ulozeni_vykresy\.pdf · /m.test(log), `výkres export pdf dokument: PDF ${pdfPages(got['Ulozeni_vykresy.pdf'] || Buffer.alloc(0))} stránky, konzole „listů 3“`);
  ok(/^ {2}✓ kontrola STEP: soubor znovu načten jádrem – těles: \d+, .* → věrná kopie modelu$/m.test(log), 'export step: kontrola znovunačtením v konzoli');
  const m = /^BASE64 "Ulozeni\.step" (\d+)B ([A-Za-z0-9+/=]+)$/m.exec(log);
  ok(m && got['Ulozeni.step'] && sha(Buffer.from(m[2], 'base64')) === sha(got['Ulozeni.step']) && Number(m[1]) === got['Ulozeni.step'].length, `řádek BASE64 = bajty staženého STEP (${m ? m[1] : '?'} B)`);
  // window.mncad.exportFile('step') = stejné bajty jako textový `export step` (stableStep), i při opakování (recenze B3)
  const api1 = await p.evaluate(() => window.mncad.exportFile('step'));
  const api2 = await p.evaluate(() => window.mncad.exportFile('step'));
  const apiSha = [api1, api2].map((x) => sha(Buffer.from(x.base64, 'base64')));
  ok(got['Ulozeni.step'] && apiSha[0] === apiSha[1] && apiSha[0] === sha(got['Ulozeni.step']) && /FILE_NAME\('[^']*','2000-01-01T00:00:00'/.test(Buffer.from(api1.base64, 'base64').toString('latin1')), `window.mncad.exportFile('step') 2× = SHA textového export step (${apiSha[0].slice(0, 12)}…)`);
  // text nedostupného úložiště uvádí adresu, na kterou se šlo (recenze B3)
  const storeRe = /^✗ úložiště krátkých odkazů neodpovídá \(https?:\/\/[^)\s]+\/cad\/share\/\)(?: – .+)?$/m; // od 19. 11. i s důvodem (HTTP 404: …)
  log = await run('export step odkaz');
  ok(storeRe.test(log) && !/URL: /.test(log), `export step odkaz bez úložiště → ✗ s adresou úložiště, nic se nestáhne (${(log.split('\n').find((l) => l.startsWith('✗')) || '').slice(0, 90)})`);
  log = await run('sdílet úložiště');
  ok(storeRe.test(log) && !/URL: /.test(log), 'sdílet úložiště bez úložiště → ✗, žádný dlouhý odkaz');
  log = await run('sdílet úložiště nebo odkaz');
  const url = (/^URL: (\S+)$/m.exec(log) || [])[1] || '';
  ok(/^⚠ krátký odkaz se nepodařil – použit dlouhý odkaz \(\d+ znaků/m.test(log) && /#s=1d\./.test(url) && /v odkazu$/m.test(log.split('\n').find((l) => l.startsWith('✓ sdílený odkaz')) || ''), `sdílet úložiště nebo odkaz → ⚠ + dlouhý odkaz (${url.length} znaků)`);
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await ready(p2, url);
  const st = await p2.evaluate(() => window.mncad.status());
  ok(/3 komponent/.test(st), `odkaz otevře sestavu: ${(st.split('\n').find((l) => /komponent/.test(l)) || '').slice(0, 100)}`);
  // konzole: nápověda neříká „nic neodesílá data“ vedle příkazů, které soubor nahrají do úložiště (recenze B3)
  await p.bringToFront();
  await p.keyboard.press('Control+Shift+K');
  const hint = await p.waitForFunction(() => document.body.innerText.includes('Data opouštějí prohlížeč jen u'), null, { timeout: 20000 }).then(() => true, () => false);
  const oldHint = await p.evaluate(() => document.body.innerText.includes('Nic z toho neodesílá data mimo tento prohlížeč'));
  ok(hint && !oldHint, 'konzole: nápověda „Data opouštějí prohlížeč jen u „sdílet“ a výstupů „… odkaz““ místo „nic neodesílá“');
  ok(dialogs.length === 0, `žádný dialog prohlížeče (${dialogs.join(' | ')})`);
  ok(errs.length === 0, `žádná chyba stránky (${errs.slice(0, 3).join(' | ')})`);
  await p.screenshot({ path: path.join(S, 'outputs.png') });
  await b.close();
}

(async () => {
  if (!process.env.E2E_SKIP_CLI) await cliPart();
  if (process.env.E2E_BASE) await browserPart(process.env.E2E_BASE);
  console.log(`# pracovní složka ${WORK}`);
})().catch((e) => { console.log('FAIL: ' + (e && e.stack || e)); process.exitCode = 1; });
