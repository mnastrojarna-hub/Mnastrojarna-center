// E2E: CLI `mncad` a `mncad serve` (CAD-HEADLESS-NAVRH.md kap. 3.1, 3.2, 3.6) na SESTAVENÉM svazku v izolované složce
// (jen mncad.mjs + replicad_single.wasm + fonts/ + package.json, žádné node_modules): verze, nápověda, chyby použití (3),
// selftest se smoke testem příkladů (Worker/document/window nedefinované), běh s výstupy, výstupy při ✗ (run=fail),
// --no-output-on-error, přísný STOP (2), hlídač: časový limit uprostřed volání OCCT (5 do 1 s), pád (4), paměť (6),
// SIGINT (130), relace --resume, únik cesty z --out, rozpočet a protocol-full.txt, --share (odkaz; php -S = vlastní úložiště),
// serve: 401/403/415/400/429/504, vstupy jen z body.files, relace
// připnuté k vláknu a obnovené po nečinnosti.
//
// Spuštění:  node e2e/cad-cli.e2e.cjs [pracovní složka]
//   MNCAD_NODE=/opt/node24/bin/node node e2e/cad-cli.e2e.cjs   (CLI na jiné verzi Node; e2e na Node 22 i 24)
//   MNCAD_DIST=public/cad/cli/<verze>                          (hotová distribuce; jinak se sestaví do pracovní složky)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const WEB = path.resolve(__dirname, '..');
const WORK = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mncad-e2e-')));
const NODE = process.env.MNCAD_NODE || process.execPath;
fs.mkdirSync(WORK, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };

// gramatika stručného protokolu (kap. 4.2)
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

// ── svazek do izolované složky ──
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

// ── testovací dokumenty (.mncad) ──
const plate = (name = 'Deska 1') => ({ app: 'mnastrojarna-cad', version: 2, name, material: 'ocel', features: [
  { id: 'b1', name: 'Kvádr 1', type: 'box', size: [100, 50, 10], position: [0, 0, 0], centered: false, mode: 'new' },
  { id: 'h1', name: 'Díra 1', type: 'hole', position: [20, 20, 10], axis: 'Z', flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 }] });
const heavy = (n = 1600) => {
  const pts = Array.from({ length: n }, (_, i) => ({ kind: 'xyz', p: [(i % 40) * 5 + 2.5, Math.floor(i / 40) * 5 + 2.5, 30] }));
  return { app: 'mnastrojarna-cad', version: 2, name: 'Těžký díl', features: [
    { id: 'b1', name: 'Kvádr 1', type: 'box', size: [200, Math.ceil(n / 40) * 5, 30], position: [0, 0, 0], centered: false, mode: 'new' },
    { id: 'h1', name: 'Díra 1', type: 'hole', position: pts[0].p, axis: 'Z', flip: false, diameter: 2.4, depth: 0, cbDiameter: 0, cbDepth: 0, points: pts }] };
};
const IN = path.join(WORK, 'in');
fs.mkdirSync(IN, { recursive: true });
fs.writeFileSync(path.join(IN, 'plate.mncad'), JSON.stringify(plate()));
fs.writeFileSync(path.join(IN, 'evil.mncad'), JSON.stringify(plate('../../evil')));
fs.writeFileSync(path.join(IN, 'heavy.mncad'), JSON.stringify(heavy()));
fs.writeFileSync(path.join(IN, 'bad.txt'), 'nový díl "A"\nkvádr 10 10 10\nblbost 5\n');
// díra mimo kvádr (⚠ feature.warning v závěrečné stavbě), zaoblení R větší než kvádr (✗ feature.failed), prázdný díl a sestava
const box10 = { id: 'b1', name: 'Kvádr 1', type: 'box', size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: 'new' };
fs.writeFileSync(path.join(IN, 'warn.mncad'), JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Díl s varováním', material: 'ocel', features: [box10, { id: 'h1', name: 'Díra 1', type: 'hole', position: [100, 100, 10], axis: 'Z', flip: false, diameter: 3, depth: 0, cbDiameter: 0, cbDepth: 0 }] }));
const badFillet = (n) => ({ app: 'mnastrojarna-cad', version: 2, name: `Zlý díl ${n}`, features: [box10, { id: 'f1', name: 'Zaoblení 1', type: 'fillet', radius: n, edges: 'all' }] });
fs.writeFileSync(path.join(IN, 'badfeat.mncad'), JSON.stringify(badFillet(50)));
fs.writeFileSync(path.join(IN, 'emptydoc.mncad'), JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Prázdný', features: [] }));
fs.writeFileSync(path.join(IN, 'emptyasm.mncad'), JSON.stringify({ app: 'mnastrojarna-cad', version: 2, name: 'Prázdná sestava', kind: 'assembly', features: [], components: [] }));
fs.writeFileSync(path.join(IN, 'empty.txt'), '');

/** spustí CLI; `kill` = { after: ms | 'ready', signal } */
function cli(args, o = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(NODE, ['--max-old-space-size=2048', BIN, ...args], { cwd: o.cwd || WORK, env: { ...process.env, MNCAD_LANG: '', ...(o.env || {}) } });
    let out = '';
    let err = '';
    let killedAt = 0;
    let scheduled = false;
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => {
      err += d;
      if (o.kill && o.kill.after === 'ready' && !scheduled && /jádro připraveno|core ready/.test(err)) {
        scheduled = true; // jeden signál (druhý Ctrl+C po výpisu protokolu = výchozí chování Node)
        setTimeout(() => { killedAt = Date.now(); p.kill(o.kill.signal); }, o.kill.delay || 0);
      }
    });
    if (o.kill && typeof o.kill.after === 'number') setTimeout(() => { killedAt = Date.now(); p.kill(o.kill.signal); }, o.kill.after);
    if (o.input !== undefined) p.stdin.end(o.input); else p.stdin.end();
    // pojistka: žádný běh e2e nesmí viset (SIGKILL po 120 s; kód null → kontrola selže)
    const guard = setTimeout(() => p.kill('SIGKILL'), o.limit || 120000);
    p.on('exit', (code, signal) => { clearTimeout(guard); resolve({ code, signal, out, err, ms: Date.now() - t0, afterKill: killedAt ? Date.now() - killedAt : null }); });
  });
}
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

function req(port, method, p, o = {}) {
  return new Promise((resolve) => {
    const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
    const headers = { host: o.host || `127.0.0.1:${port}`, ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(body !== undefined ? { 'content-type': o.ct || 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...(o.headers || {}) };
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* text */ } resolve({ status: res.statusCode, headers: res.headers, text: d, json: j }); });
    });
    r.on('error', (e) => resolve({ status: 0, text: String(e) }));
    r.setTimeout(120000, () => r.destroy(new Error('timeout 120 s')));
    if (body !== undefined) r.write(body);
    r.end();
  });
}
function startServe(args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(NODE, ['--max-old-space-size=2048', BIN, 'serve', '--port', '0', ...args], { cwd: WORK, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n')[0];
      if (out.includes('\n')) try { resolve({ p, ...JSON.parse(line), err: () => err }); } catch (e) { reject(e); }
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => reject(new Error(`serve exited ${code}: ${err}`)));
  });
}
const stop = (s) => new Promise((res) => { s.p.removeAllListeners('exit'); s.p.on('exit', (code) => res(code)); s.p.kill('SIGINT'); });
const mem = () => { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : 99999; };

(async () => {
  console.log(`# Node pro CLI: ${execFileSync(NODE, ['--version']).toString().trim()} · svazek ${DIST} · volná paměť ${mem()} MB`);
  // ── základní příkazy ──
  let r = await cli(['version', '--json']);
  ok(r.code === 0 && /^0\.1\.0-[0-9a-f]{8}$/.test(json(r)?.version || '') && json(r)?.node === execFileSync(NODE, ['--version']).toString().trim(), `version --json → 0, ${r.out.trim()}`);
  r = await cli(['help']);
  ok(r.code === 0 && /mncad run <skript\.txt\|->/.test(r.out), 'help → 0 s použitím');
  r = await cli(['help', 'commands']);
  ok(r.code === 0 && r.out.split('\n').length > 100, `help commands → ${r.out.split('\n').length} řádků`);
  r = await cli(['run', 'neni.txt']);
  ok(r.code === 3 && /neni\.txt/.test(r.err), `chybějící skript → 3 (${r.err.trim().slice(0, 80)})`);
  r = await cli(['run', 'x.txt', '--formats', 'docx']);
  ok(r.code === 3 && /docx/.test(r.err), 'neznámý formát → 3');
  r = await cli(['frobnicate']);
  ok(r.code === 3, 'neznámý příkaz → 3');

  // ── selftest: jádro, STEP, PDF s písmy přes shim, písmo textu, odkaz, smoke test příkladů ──
  r = await cli(['selftest', '--json']);
  const st = json(r);
  ok(r.code === 0 && st?.ok === true, `selftest → 0 (${r.ms} ms, jádro ${st?.readyMs} ms)`);
  for (const c of st?.checks || []) ok(c.ok, `selftest ${c.name}: ${c.detail}`);
  ok((st?.examples || 0) > 150 && /Worker\/document\/window undefined/.test(st?.checks?.[0]?.detail || ''), `smoke test: ${st?.examples} příkladů z AGENT_COMMANDS + AGENT_GUIDE bez Worker/document/window, jen hlášky s kódem`);

  // ── běh: chyby skriptu s řádky, gramatika, rozpočet ──
  r = await cli(['run', path.join(IN, 'bad.txt'), '--out', path.join(WORK, 'o1')]);
  const lines = r.out.trim().split('\n');
  ok(r.code === 1 && /^MNCAD\/1 FAIL lines=3 ops=2 err=3/.test(lines[0]), `skript s ✗ → 1: ${lines[0]}`);
  ok(grammarOk(r.out) && bytes(r.out.trim()) <= 2048, `každý řádek projde gramatikou 4.2, ${bytes(r.out.trim())} B ≤ 2048`);
  ok(/✗ L3 parse\.error/.test(r.out) && /✗ L1 host\.app-only/.test(r.out), 'chyba rozboru L3 parse.error, příkazy bez obsluhy L1/L2 host.app-only');
  r = await cli(['run', '-', '--lang', 'en', '--out', path.join(WORK, 'o1')], { input: 'kvádr 1 1 1\n' });
  ok(r.code === 1 && /✗ L1 host\.app-only the command works only in the browser app: feature:box/.test(r.out), 'stdin + --lang en: anglický text za kódem');
  r = await cli(['run', path.join(IN, 'empty.txt'), '--out', path.join(WORK, 'o1')]);
  ok(r.code === 1 && /parse\.error/.test(r.out), 'prázdný skript → ✗ parse.error, 1');
  // tvrdý rozpočet: 300 různých ✗ → stručný protokol ≤ 2048 B, přebytek do <out>/protocol-full.txt a jeden řádek značky
  fs.writeFileSync(path.join(IN, 'many.txt'), Array.from({ length: 300 }, (_, i) => `neznamy${i + 1} ${i + 1}`).join('\n') + '\n');
  const oOv = path.join(WORK, 'o-ov');
  r = await cli(['run', path.join(IN, 'many.txt'), '--out', oOv]);
  const full = fs.existsSync(path.join(oOv, 'protocol-full.txt')) ? fs.readFileSync(path.join(oOv, 'protocol-full.txt'), 'utf8') : '';
  ok(r.code === 1 && bytes(r.out.trim()) <= 2048 && grammarOk(r.out) && /^… \d+ entries \d+B in protocol-full\.txt$/m.test(r.out) && (full.match(/^✗ /gm) || []).length === 300, `300 ✗: stručně ${bytes(r.out.trim())} B, plný protokol ${full.length} znaků s 300 ✗ v protocol-full.txt`);

  // ── výstupy: --open dokumentu, formáty, F řádky ──
  const o2 = path.join(WORK, 'o2');
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', o2, '--formats', 'step,mncad,pdf,dxf,stl', '--json']);
  let j = json(r);
  ok(r.code === 0 && j?.ok === true && j.files.length === 5, `--open + 5 formátů → 0, soubory ${j?.files?.map((f) => f.name).join(', ')}`);
  ok(fs.readFileSync(path.join(o2, 'Deska 1.step'), 'latin1').startsWith('ISO-10303-21;') && fs.readFileSync(path.join(o2, 'Deska 1 výkres.pdf'), 'latin1').startsWith('%PDF-'), 'STEP a PDF (písma Roboto ze složky fonts/ vedle svazku)');
  ok(j?.docs?.[0]?.main && j.docs[0].features?.ok === 2 && Math.abs(j.docs[0].volume_mm3 - 49497.34) < 1, `D hlavního dokumentu: V=${j?.docs?.[0]?.volume_mm3?.toFixed(2)} mm³`);
  ok(j?.files?.every((f) => f.path.startsWith(fs.realpathSync(o2) + path.sep) && /^[0-9a-f]{64}$/.test(f.sha256)), 'files[].path uvnitř --out, sha256');
  ok(fs.existsSync(path.join(o2, 'session.mncad-ws')), 'relace zapsána do <out>/session.mncad-ws');

  // ── výstupy při ✗ (run=fail) a --no-output-on-error ──
  const o3 = path.join(WORK, 'o3');
  r = await cli(['run', path.join(IN, 'bad.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', o3, '--formats', 'step']);
  ok(r.code === 1 && /^F step "Deska 1\.step" \d+B run=fail$/m.test(r.out) && fs.existsSync(path.join(o3, 'Deska 1.step')), 'nepřísný běh s ✗ zapíše postavený dokument, F … run=fail');
  const o4 = path.join(WORK, 'o4');
  r = await cli(['run', path.join(IN, 'bad.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', o4, '--formats', 'step', '--no-output-on-error']);
  ok(r.code === 1 && !/^F /m.test(r.out) && !fs.existsSync(path.join(o4, 'Deska 1.step')), '--no-output-on-error: nic se nezapíše');
  // ── přísný režim ──
  const o5 = path.join(WORK, 'o5');
  r = await cli(['run', path.join(IN, 'bad.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', o5, '--strict']);
  ok(r.code === 2 && /^MNCAD\/1 STOP /.test(r.out) && !fs.existsSync(path.join(o5, 'Deska 1.step')), `přísný běh → STOP, 2, bez výstupů --formats: ${r.out.split('\n')[0]}`);
  // přísně i mimo smyčku skriptu: ⚠/✗ z --open a ze závěrečné stavby = STOP, 2, žádný STEP (recenze A2, nález 1)
  const os1 = path.join(WORK, 'o-swarn');
  r = await cli(['run', '-', '--open', path.join(IN, 'warn.mncad'), '--strict', '--formats', 'step', '--out', os1], { input: '' });
  ok(r.code === 2 && /^MNCAD\/1 STOP .*warn=1/.test(r.out) && /^⚠ L- feature\.warning/m.test(r.out) && /stop=L-:feature\.warning/.test(r.out) && !/^F /m.test(r.out) && !fs.existsSync(path.join(os1, 'Díl s varováním.step')), `přísně: ⚠ feature.warning závěrečné stavby → STOP, 2, bez STEP (${r.out.split('\n')[0]})`);
  r = await cli(['run', '-', '--open', path.join(IN, 'warn.mncad'), '--formats', 'step', '--out', os1], { input: '' });
  ok(r.code === 0 && /^MNCAD\/1 OK .*warn=1/.test(r.out) && /^F step "Díl s varováním\.step"/m.test(r.out), 'nepřísně: ⚠ nezastaví, STEP se zapíše, 0');
  r = await cli(['run', '-', '--strict', '--open', 'nothere.mncad', '--open', path.join(IN, 'plate.mncad'), '--formats', 'step', '--out', path.join(WORK, 'o-sopen')], { input: '' });
  ok(r.code === 2 && /^MNCAD\/1 STOP /.test(r.out) && /✗ L- file\.missing soubor „nothere\.mncad“ není k dispozici – dostupné: plate\.mncad$/m.test(r.out) && !/^F /m.test(r.out), 'přísně: chybějící --open → STOP, 2; seznam dostupných bez chybějícího souboru');
  r = await cli(['run', '-', '--strict', '--open', path.join(IN, 'badfeat.mncad'), '--formats', 'step', '--out', path.join(WORK, 'o-sbad')], { input: '' });
  ok(r.code === 2 && /✗ L- feature\.failed/.test(r.out) && /stop=L-:feature\.failed/.test(r.out), 'přísně: ✗ feature.failed závěrečné stavby → STOP, 2');
  // prázdný dokument: vyžádané výstupy a odkaz nikdy tiše (nález 4)
  r = await cli(['run', '-', '--open', path.join(IN, 'emptydoc.mncad'), '--share', '--share-store', 'off', '--formats', 'step,pdf', '--out', path.join(WORK, 'o-e')], { input: '' });
  ok(r.code === 1 && /^✗ L- out\.empty "Prázdný": prázdný dokument – nezapsáno: STEP, PDF, odkaz$/m.test(r.out) && !/^O /m.test(r.out), 'prázdný díl + --formats step,pdf + --share → ✗ out.empty, 1');
  r = await cli(['run', '-', '--open', path.join(IN, 'emptyasm.mncad'), '--out', path.join(WORK, 'o-e')], { input: '' });
  ok(r.code === 0 && /^⚠ L- out\.empty "Prázdná sestava": prázdný dokument – nezapsáno: STEP, \.mncad$/m.test(r.out), 'prázdná sestava + --formats auto → ⚠ out.empty, 0');
  r = await cli(['run', '-', '--open', path.join(IN, 'emptyasm.mncad'), '--strict', '--out', path.join(WORK, 'o-e')], { input: '' });
  ok(r.code === 2 && /stop=L-:out\.empty/.test(r.out), 'prázdná sestava přísně → STOP, 2');
  // --open nepohltí skript za sebou (nález 11)
  r = await cli(['run', '--open', path.join(IN, 'plate.mncad'), path.join(IN, 'bad.txt'), '--formats', 'none', '--out', path.join(WORK, 'o-args')]);
  ok(r.code === 1 && /^MNCAD\/1 FAIL lines=3 /.test(r.out) && /✗ L3 parse\.error/.test(r.out), 'run --open a.mncad skript.txt: skript je skript (lines=3), ne další --open');
  // EPIPE: čtenář zavře rouru (nález 7)
  const pipeRes = await new Promise((resolve) => {
    const p = spawn(NODE, [BIN, 'help', 'guide'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.once('data', () => p.stdout.destroy());
    p.on('exit', (code) => resolve({ code, err }));
  });
  ok(pipeRes.code === 0 && !/EPIPE|Unhandled/.test(pipeRes.err), `help guide | head: kód ${pipeRes.code}, bez EPIPE na stderr`);

  // ── relace --resume ──
  r = await cli(['run', '-', '--resume', path.join(o2, 'session.mncad-ws'), '--out', path.join(WORK, 'o6'), '--formats', 'mncad', '--json'], { input: '' });
  j = json(r);
  ok(r.code === 0 && j?.docs?.some((d) => d.name === 'Deska 1') && j.counts.notes === 1 && j.entries.some((e) => e.code === 'session.history'), '--resume obnoví záložky relace, ℹ session.history');
  fs.writeFileSync(path.join(WORK, 'broken.mncad-ws'), '{nope');
  r = await cli(['run', '-', '--resume', path.join(WORK, 'broken.mncad-ws'), '--out', path.join(WORK, 'o6')], { input: '' });
  ok(r.code === 3 && /relaci nelze načíst/.test(r.err), 'neplatná relace → 3');

  // ── únik cesty z --out: dokument „../../evil“ ──
  const o7 = path.join(WORK, 'o7');
  r = await cli(['run', '-', '--open', path.join(IN, 'evil.mncad'), '--out', o7, '--formats', 'mncad', '--json'], { input: '' });
  j = json(r);
  ok(r.code === 0 && j?.files?.length === 1 && path.dirname(j.files[0].path) === fs.realpathSync(o7) && !fs.existsSync(path.join(WORK, 'evil.mncad.mncad')) && !fs.readdirSync(WORK).some((f) => /evil/.test(f)), `název „../../evil“ zůstal v --out: ${j?.files?.[0]?.name}`);

  // ── --share: odkaz z Node přes shim location (bez úložiště = dlouhý odkaz; s php -S = vlastní úložiště) ──
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', path.join(WORK, 'o9'), '--formats', 'none', '--share', '--share-store', 'off', '--json']);
  j = json(r);
  ok(r.code === 0 && j?.share?.mode === 'link' && j.share.url.startsWith('https://www.mnastrojarna.cz/cad#s=') && /^O \S+ exp=\d{4}-\d{2}-\d{2} mode=link$/m.test(j.protocol), `--share bez úložiště → O … mode=link (${j?.share?.url?.length} znaků)`);
  let php = null;
  try { execFileSync('php', ['--version'], { stdio: 'ignore' }); php = true; } catch { php = false; }
  if (php) {
    const www = path.join(WORK, 'www', 'cad', 'share');
    fs.mkdirSync(www, { recursive: true });
    for (const f of ['index.php', '.htaccess', '.user.ini']) fs.copyFileSync(path.join(WEB, 'public/cad/share', f), path.join(www, f));
    const port = 18000 + Math.floor(Math.random() * 2000);
    const ps = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', path.join(WORK, 'www')], { stdio: 'ignore' });
    await new Promise((res) => setTimeout(res, 700));
    r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'plate.mncad'), '--out', path.join(WORK, 'o9'), '--formats', 'none', '--share', '--share-store', `http://127.0.0.1:${port}/cad/share/`, '--json']);
    j = json(r);
    ps.kill();
    ok(r.code === 0 && j?.share?.mode === 'self' && /#[1-9A-HJ-NP-Za-km-z]{10}$/.test(j.share.url) && fs.readdirSync(path.join(WORK, 'cad-share-data')).some((f) => f.endsWith('.bin')), `--share proti php -S (index.php) → nejkratší odkaz mode=self ${j?.share?.url}`);
    // odkaz ukazuje na web úložiště (prohlížeč čte obsah z <origin>/cad/share/), ne na www.mnastrojarna.cz (nález 12);
    // tvar <web>/s#<KÓD> – /s na webu přesměruje na /cad (next.config.mjs / .htaccess)
    ok(new RegExp(`^http://127\\.0\\.0\\.1:${port}/s#[1-9A-HJ-NP-Za-km-z]{10}$`).test(j?.share?.url || ''), `odkaz mode=self míří na web úložiště: ${j?.share?.url}`);
  } else console.log('# php chybí – sdílení do vlastního úložiště přeskočeno');

  // ── hlídač: časový limit uprostřed dlouhého volání OCCT ──
  console.log(`# volná paměť ${mem()} MB`);
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'heavy.mncad'), '--out', path.join(WORK, 'o8'), '--formats', 'none', '--timeout', '3', '--json']);
  j = json(r);
  ok(r.code === 5 && j?.entries?.some((e) => e.code === 'run.timeout' && e.line === null && e.data?.op === 'build'), `--timeout 3 během stavby v jádře → 5, ✗ L- run.timeout (op build), zeď ${r.ms} ms`);
  // start procesu do spuštění hlídače (Node + načtení 4,5 MB svazku) změřený na `mncad version`, medián ze 3
  const boots = [];
  for (let i = 0; i < 3; i++) boots.push((await cli(['version'])).ms);
  const boot = boots.sort((a, b) => a - b)[1];
  ok(r.ms - 3000 - boot < 1000, `ukončeno do 1 s po limitu: ${r.ms - 3000 - boot} ms po limitu (zeď ${r.ms} ms − limit 3000 ms − start procesu ${boot} ms)`);
  r = await cli(['run', path.join(IN, 'bad.txt'), '--out', path.join(WORK, 'o8'), '--timeout', '2'], { env: { MNCAD_TEST_FAULT: 'busy:60000' } });
  ok(r.code === 5 && /^✗ L1 run\.timeout/m.test(r.out) && r.ms - 2000 < 1000, `limit na rozpracovaném řádku: ✗ L1 run.timeout, 5 (${r.ms} ms)`);
  // ── pád, paměť, SIGINT ──
  for (const f of ['throw', 'exit', 'fatal']) {
    r = await cli(['run', path.join(IN, 'bad.txt'), '--out', path.join(WORK, 'o8')], { env: { MNCAD_TEST_FAULT: f } });
    ok(r.code === 4 && /✗ L1 run\.crash/.test(r.out), `pád vlákna (${f}) → 4, ✗ L1 run.crash`);
  }
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'heavy.mncad'), '--out', path.join(WORK, 'o8'), '--formats', 'none', '--max-mem', '150']);
  ok(r.code === 6 && /run\.memory překročen limit paměti 150 MB/.test(r.out), `--max-mem 150 → 6, ✗ run.memory (${r.ms} ms)`);
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'heavy.mncad'), '--out', path.join(WORK, 'o8'), '--formats', 'none', '--progress'], { kill: { after: 'ready', delay: 1500, signal: 'SIGINT' } });
  ok(r.code === 130 && /✗ L- run\.interrupted/.test(r.out) && r.afterKill < 1000, `SIGINT během stavby → 130, ✗ run.interrupted (${r.afterKill} ms po signálu)`);
  r = await cli(['run', path.join(IN, 'empty.txt'), '--open', path.join(IN, 'heavy.mncad'), '--out', path.join(WORK, 'o8'), '--formats', 'none', '--progress'], { kill: { after: 'ready', delay: 800, signal: 'SIGTERM' } });
  ok(r.code === 130, `SIGTERM → 130 (${r.afterKill} ms)`);
  // selftest: stejné kódy zásahu jako run (nález 6)
  r = await cli(['selftest'], { kill: { after: 900, signal: 'SIGINT' } });
  ok(r.code === 130, `selftest + SIGINT → 130 (${r.code})`);
  r = await cli(['selftest', '--max-mem', '150']);
  ok(r.code === 6 && /run\.memory/.test(r.err), `selftest --max-mem 150 → 6 (${r.code}: ${r.err.trim().slice(0, 60)})`);

  // ── serve ──
  console.log(`# volná paměť ${mem()} MB`);
  const tokFile = path.join(WORK, 'token');
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokFile, token, { mode: 0o600 });
  fs.chmodSync(tokFile, 0o600);
  const sOut = path.join(WORK, 'serve-out');
  const s = await startServe(['--token-file', tokFile, '--out', sOut, '--jobs', '1', '--idle-timeout', '2']);
  const P = s.port;
  ok(P > 0 && s.url === `http://127.0.0.1:${P}`, `serve naslouchá ${s.url}`);
  let h = await req(P, 'GET', '/health');
  ok(h.status === 401 && /Bearer/.test(h.headers['www-authenticate'] || ''), 'bez tokenu → 401');
  h = await req(P, 'GET', '/health', { token: 'x'.repeat(48) });
  ok(h.status === 401, 'špatný token → 401');
  h = await req(P, 'GET', '/health', { token });
  ok(h.status === 200 && h.json?.ok && h.json.threads === 0, `GET /health → 200 ${h.text}`);
  const run1 = { script: '', open: ['plate.mncad'], files: { 'plate.mncad': Buffer.from(JSON.stringify(plate())).toString('base64') }, formats: ['step'] };
  h = await req(P, 'POST', '/run', { token, body: run1, headers: { origin: 'https://evil.example' } });
  ok(h.status === 403 && !h.headers['access-control-allow-origin'], 'Origin → 403, bez hlaviček CORS');
  h = await req(P, 'POST', '/run', { token, body: run1, headers: { 'sec-fetch-site': 'cross-site' } });
  ok(h.status === 403, 'Sec-Fetch-Site: cross-site → 403');
  h = await req(P, 'POST', '/run', { token, body: run1, host: `evil.example:${P}` });
  ok(h.status === 403, 'cizí Host (DNS rebinding) → 403');
  h = await req(P, 'OPTIONS', '/run', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  ok(h.status === 403 && !h.headers['access-control-allow-origin'], 'preflight OPTIONS z prohlížeče → 403');
  h = await req(P, 'POST', '/run', { token, body: 'kvádr 1 1 1', ct: 'text/plain' });
  ok(h.status === 415, 'text/plain → 415');
  h = await req(P, 'POST', '/run', { token, body: '{nope' });
  ok(h.status === 400, 'neplatný JSON → 400');
  h = await req(P, 'POST', '/run', { token, body: { script: '', files: { '../x.mncad': 'AA==' } } });
  ok(h.status === 400, 'název souboru s cestou v body.files → 400');
  h = await req(P, 'POST', '/run', { token, body: { script: 1 } });
  ok(h.status === 400, 'script není text → 400');
  h = await req(P, 'GET', '/run', { token });
  ok(h.status === 405, 'GET /run → 405');
  h = await req(P, 'POST', '/run', { token, body: run1 });
  ok(h.status === 200 && h.json?.ok === true && h.json.files.length === 1 && Buffer.from(h.json.files[0].base64, 'base64').toString('latin1').startsWith('ISO-10303-21;') && /^MNCAD\/1 OK/.test(h.json.protocol), 'POST /run → 200, STEP jako base64, stručný protokol');
  h = await req(P, 'POST', '/run', { token, body: { script: 'kvádr 1 1 1', open: ['../../../etc/passwd', '/etc/passwd'] } });
  ok(h.status === 200 && h.json?.ok === false && h.json.entries.filter((e) => e.code === 'file.missing').length === 2, 'vstupy jen z body.files: /etc/passwd → ✗ file.missing (disk se nečte), HTTP 200 ok:false');
  h = await req(P, 'POST', '/run', { token, body: { script: '', open: ['evil.mncad'], files: { 'evil.mncad': Buffer.from(JSON.stringify(plate('../../evil'))).toString('base64') }, formats: ['mncad'], return: 'paths' } });
  const ep = h.json?.files?.[0]?.path || '';
  ok(h.status === 200 && ep.startsWith(fs.realpathSync(sOut) + path.sep) && fs.existsSync(ep), `return paths: dokument „../../evil“ zapsán uvnitř --out (${path.relative(WORK, ep)})`);
  // relace připnutá k vláknu, obnova po nečinnosti
  h = await req(P, 'POST', '/run', { token, body: { ...run1, session: 's1', formats: 'none' } });
  ok(h.status === 200 && h.json?.docs?.some((d) => d.name === 'Deska 1'), 'relace s1: dokument otevřen');
  h = await req(P, 'POST', '/run', { token, body: { script: '', session: 's1', formats: 'none' } });
  ok(h.status === 200 && h.json?.docs?.some((d) => d.name === 'Deska 1'), 'relace s1, další požadavek ve stejném vlákně: dokument tam je');
  let hh = await req(P, 'GET', '/health', { token });
  ok(hh.json?.threads === 1 && hh.json.sessions === 1, `vlákno relace žije (threads=${hh.json?.threads})`);
  await new Promise((res) => setTimeout(res, 3500));
  hh = await req(P, 'GET', '/health', { token });
  ok(hh.json?.threads === 0, `po --idle-timeout 2 s vlákno skončilo (threads=${hh.json?.threads})`);
  h = await req(P, 'POST', '/run', { token, body: { script: '', session: 's1', formats: 'none' } });
  ok(h.status === 200 && h.json?.docs?.some((d) => d.name === 'Deska 1'), 'relace s1 obnovena v novém vlákně z uložené relace');
  h = await req(P, 'DELETE', '/session/s1', { token });
  ok(h.status === 204, 'DELETE /session/s1 → 204');
  h = await req(P, 'DELETE', '/session/s1', { token });
  ok(h.status === 404, 'podruhé → 404');
  // časový limit požadavku → 504
  h = await req(P, 'POST', '/run', { token, body: { script: '', open: ['heavy.mncad'], files: { 'heavy.mncad': Buffer.from(JSON.stringify(heavy())).toString('base64') }, formats: 'none', timeoutSec: 2 } });
  ok(h.status === 504 && h.json?.entries?.some((e) => e.code === 'run.timeout'), 'timeoutSec 2 během stavby → 504 s RunReport (✗ run.timeout)');
  h = await req(P, 'GET', '/help', { token });
  ok(h.status === 200 && /^# Mnástrojárna CAD/.test(h.text), 'GET /help → návod pro AI');
  h = await req(P, 'DELETE', '/session/%E0%A4%A', { token });
  ok(h.status === 400, `DELETE /session s chybným %-kódováním → 400 (${h.status})`);
  // přebytek protokolu: odkaz protocol-full.txt v <out>/session-x se nahradí, cíl zůstane (nález 10)
  fs.mkdirSync(path.join(sOut, 'session-x'), { recursive: true });
  const victim = path.join(WORK, 'victim.txt');
  fs.writeFileSync(victim, 'PUVODNI');
  fs.rmSync(path.join(sOut, 'session-x', 'protocol-full.txt'), { force: true });
  fs.symlinkSync(victim, path.join(sOut, 'session-x', 'protocol-full.txt'));
  h = await req(P, 'POST', '/run', { token, body: { script: fs.readFileSync(path.join(IN, 'many.txt'), 'utf8'), session: 'x', return: 'paths', formats: 'none' } });
  ok(h.status === 200 && fs.readFileSync(victim, 'utf8') === 'PUVODNI' && !fs.lstatSync(path.join(sOut, 'session-x', 'protocol-full.txt')).isSymbolicLink(), 'serve: protocol-full.txt přes odkaz nepřepíše cíl odkazu');
  // jazyk relace: požadavek v jiném jazyce nemíchá texty jádra z mezipaměti (nález 13)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  h = await req(P, 'POST', '/run', { token, body: { script: '', session: 'lg', lang: 'de', open: ['bf51.mncad'], files: { 'bf51.mncad': b64(badFillet(51)) }, formats: 'none' } });
  const de = h.json?.entries?.find((e) => e.code === 'feature.failed')?.text || '';
  h = await req(P, 'POST', '/run', { token, body: { script: '', session: 'lg', lang: 'cs', open: ['bf51.mncad', 'bf52.mncad'], files: { 'bf51.mncad': b64(badFillet(51)), 'bf52.mncad': b64(badFillet(52)) }, formats: 'none', allDocs: true } });
  const cs = (h.json?.entries || []).filter((e) => e.code === 'feature.failed').map((e) => e.text);
  ok(/Verrundung/.test(de) && cs.length >= 2 && cs.every((t) => /^prvek „Zaoblení 1“ se nepostavil: Zaoblení R5\d nelze/.test(t)), `relace de → cs: žádný německý text jádra v českém protokolu (${cs[0]?.slice(0, 70)})`);
  await req(P, 'DELETE', '/session/lg', { token });
  // SIGINT s rozpracovaným požadavkem: přeruší ho (500 ✗ run.interrupted) a skončí hned, ne až po skriptu (nález 2)
  const heavyBody = { script: '', open: ['heavy.mncad'], files: { 'heavy.mncad': b64(heavy()) }, formats: 'none', timeoutSec: 200 };
  const inflight = req(P, 'POST', '/run', { token, body: heavyBody });
  await new Promise((res) => setTimeout(res, 3000));
  const tSig = Date.now();
  const code = await stop(s);
  const sigMs = Date.now() - tSig;
  h = await inflight;
  ok(code === 130 && sigMs < 3000 && h.status === 500 && h.json?.entries?.some((e) => e.code === 'run.interrupted'), `serve: SIGINT během /run → 130 za ${sigMs} ms, klient 500 ✗ run.interrupted`);

  // fronta: --jobs 1, 10 souběžných požadavků → nejvýš 8 čeká, zbytek 429
  const s2 = await startServe(['--token-file', tokFile, '--jobs', '1'], { MNCAD_TEST_FAULT: 'busy:700' });
  const all = await Promise.all(Array.from({ length: 11 }, () => req(s2.port, 'POST', '/run', { token, body: { script: 'kvádr 1 1 1', formats: 'none' } })));
  const n429 = all.filter((x) => x.status === 429).length;
  const n200 = all.filter((x) => x.status === 200).length;
  ok(n429 === 2 && n200 === 9, `fronta: 1 běží + 8 čeká = 200 (${n200}), zbytek 429 (${n429})`);
  await stop(s2);
  // --max-mem v serve: halda WASM čtená během jednoho dlouhého volání jádra → 507 run.memory (nález 5)
  console.log(`# volná paměť ${mem()} MB`);
  const s3 = await startServe(['--token-file', tokFile, '--max-mem', '300']);
  const t3 = Date.now();
  h = await req(s3.port, 'POST', '/run', { token, body: { script: '', open: ['heavy.mncad'], files: { 'heavy.mncad': Buffer.from(JSON.stringify(heavy())).toString('base64') }, formats: 'none', timeoutSec: 60 } });
  ok(h.status === 507 && h.json?.entries?.some((e) => e.code === 'run.memory') && h.json.peakMB >= 300, `serve --max-mem 300: 507 ✗ run.memory za ${Date.now() - t3} ms (peakMB ${h.json?.peakMB})`);
  await stop(s3);
  // --host 127.0.0.2: ohlášená adresa přijímá požadavky (nález 8)
  const s4 = await startServe(['--token-file', tokFile, '--host', '127.0.0.2']);
  const h4 = await new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.2', port: s4.port, method: 'GET', path: '/health', headers: { authorization: `Bearer ${token}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    rq.on('error', (e) => resolve(String(e)));
    rq.end();
  });
  ok(s4.url === `http://127.0.0.2:${s4.port}` && h4 === 200, `serve --host 127.0.0.2: GET ${s4.url}/health → ${h4}`);
  await stop(s4);
  // jiná adresa než loopback bez --allow-remote → 3
  r = await cli(['serve', '--host', '0.0.0.0', '--port', '0']);
  ok(r.code === 3 && /--allow-remote/.test(r.err), 'serve --host 0.0.0.0 bez --allow-remote → 3');
  r = await cli(['serve', '--host', '0.0.0.0', '--port', '0', '--allow-remote']);
  ok(r.code === 3 && /--token-file/.test(r.err), '--allow-remote bez --token-file → 3');
  console.log(process.exitCode ? 'cad-cli e2e: SELHALO' : 'cad-cli e2e: vše ok');
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
});
