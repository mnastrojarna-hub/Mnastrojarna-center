// E2E: nejkratší sdílený odkaz (vlna 16) na PRODUKČNÍ adrese – https://mnastrojarna.cz/s#<KÓD> (36 znaků).
// Prohlížeč (Chromium) jede proti místní napodobenině produkce: veškerý provoz jde přes místní proxy, která spojení na
// www.mnastrojarna.cz a mnastrojarna.cz (https i http) předá místnímu serveru (certifikát podepsaný sám sebou) a cokoli
// jiného odmítne – skutečný web se nikdy nekontaktuje. Místní server se chová jako Apache se statickým exportem: holá
// doména → 301 na www (zachová http/https), přesměrování z VYGENEROVANÉHO .htaccess (scripts/gen-htaccess.mjs nad kopií
// next.config.mjs: /s → /cad/?kod=1, /en/s → /en/cad/?kod=1, /de/s → /de/cad/?kod=1), chybějící lomítko → 301,
// /cad/share/ → skutečné PHP (public/cad/share/index.php přes `php -S`), vše ostatní → sestavená aplikace (E2E_BASE).
// Ověří: tvar a délku odkazu (36 znaků, EN/DE do 40), že část za # přežije celý řetěz přesměrování (holá doména → www →
// /s → /cad/), hlášení „Otevírám sdílený dokument…“ bez úvodní obrazovky, stejný model u příjemce (objem), heslo (samotný
// kód neotevře), starší odkaz #q= a starší skript úložiště. Změří odvození klíče (PBKDF2, 1 200 000 iterací) v Chromiu a Node.
// Po revizi navíc: překlep v kódu se na kartu nepřilepí (pole s kódem k opravě, F5 nic neopakuje), části za # s podobnými
// znaky / jinou délkou dostanou vysvětlení, znaky přilepené za odkaz (uvozovky, >, **, mezera, /) nevadí, pole přijme
// řádek z dialogu i odkaz uprostřed zprávy, …/s nabídne zadání kódu i v kartě s rozdělanou prací a s vypnutou úvodní
// obrazovkou (a nabídka Soubor má „Otevřít sdílený dokument…“), zneplatněný odkaz má vlastní hlášení a nejde oživit,
// http:// se samo přepne na https://, cizí stránka návštěvníkovi sdílení nezablokuje (skutečné <img> z jiného webu),
// a odkaz přes kratší doménu (přesměrovanou na CAD) se otevře. S E2E_SHORT=https://<krátká doména> (aplikace sestavená
// s NEXT_PUBLIC_CAD_SHARE_SHORT téže hodnoty) ověří jen vytvoření a otevření odkazu přes krátkou doménu.
// Spuštění: E2E_BASE=http://localhost:3431 node e2e/cad-w16-short.e2e.cjs <složka pro snímky>
//   E2E_ONLY=http,cross … jen vybrané části (viz ONLY níže)
//   (server = next start nad produkčním sestavením; potřebuje příkazy php ≥ 7.4 a openssl; starší skript úložiště bere z gitu)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3431').replace(/\/$/, '');
const WEB = path.join(__dirname, '..');
const SCRIPT = path.join(WEB, 'public', 'cad', 'share', 'index.php');
const WWW = 'https://www.mnastrojarna.cz';
const APEX = 'https://mnastrojarna.cz';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CODE = '[1-9A-HJ-NP-Za-km-z]{10}';
const codeOf = (url) => new RegExp('#(' + CODE + ')$').exec(url)?.[1];
const grouped = (code) => code.replace(/(.{4})(?=.)/g, '$1 ');
/** id v úložišti – nezávislý výpočet z kódu (PBKDF2-HMAC-SHA-256, sůl mncad-share-v2, 1 200 000 iterací, 32 B → HKDF „mncad-share-v2 id“ 16 B mod 58^11) */
const idOfCode = (code) => {
  const prk = crypto.pbkdf2Sync(code, 'mncad-share-v2', 1200000, 32, 'sha256');
  let n = BigInt('0x' + Buffer.from(crypto.hkdfSync('sha256', prk, Buffer.alloc(0), 'mncad-share-v2 id', 16)).toString('hex')) % (58n ** 11n);
  let id = '';
  for (let i = 0; i < 11; i++) { id = B58[Number(n % 58n)] + id; n /= 58n; }
  return id;
};
/** krátká doména (smyšlená, jen v této zkoušce): přesměruje vše na CAD; s E2E_SHORT ji nese i sestavená aplikace */
const SHORT = (process.env.E2E_SHORT || '').replace(/\/+$/, '');
const SHORT_HOST = SHORT ? new URL(SHORT).hostname : 'mncad.cz';
/** cizí web (útočník) – stránka s obrázky mířícími na úložiště */
const EVIL = 'http://evil.test';
/** překlep: první písmeno, které jde zapsat i v opačné velikosti, v opačné velikosti (výsledek zůstává v abecedě kódu) */
const mistype = (code) => {
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const sw = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
    if (sw !== c && B58.includes(sw)) return code.slice(0, i) + sw + code.slice(i + 1);
  }
  return (code[0] === '2' ? '3' : '2') + code.slice(1);
};

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const tmpDirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmpDirs.push(d); return d; };
const phps = [];
async function startPhp(script, env = {}) {
  const root = tmp('mn-short-e2e-');
  const docroot = path.join(root, 'www');
  fs.mkdirSync(path.join(docroot, 'cad', 'share'), { recursive: true });
  if (Buffer.isBuffer(script)) fs.writeFileSync(path.join(docroot, 'cad', 'share', 'index.php'), script);
  else fs.copyFileSync(script, path.join(docroot, 'cad', 'share', 'index.php'));
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, ...env }, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/cad/share/?ping')).ok) break; } catch { /* start */ } await sleep(50); }
  const srv = { origin, root, data: path.join(root, 'cad-share-data'), proc };
  phps.push(srv);
  return srv;
}

/** .htaccess statického exportu: scripts/gen-htaccess.mjs nad kopií next.config.mjs v pracovní složce (bez sestavení out/) */
function generateHtaccess() {
  const dir = tmp('mn-htaccess-');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'out'));
  fs.mkdirSync(path.join(dir, 'public', 'cad', 'share'), { recursive: true });
  fs.copyFileSync(path.join(WEB, 'next.config.mjs'), path.join(dir, 'next.config.mjs'));
  fs.copyFileSync(path.join(WEB, 'scripts', 'gen-htaccess.mjs'), path.join(dir, 'scripts', 'gen-htaccess.mjs'));
  for (const f of ['index.php', '.htaccess', '.user.ini']) if (fs.existsSync(path.join(WEB, 'public', 'cad', 'share', f))) fs.copyFileSync(path.join(WEB, 'public', 'cad', 'share', f), path.join(dir, 'public', 'cad', 'share', f));
  execFileSync(process.execPath, ['scripts/gen-htaccess.mjs'], { cwd: dir, stdio: 'ignore' });
  return { text: fs.readFileSync(path.join(dir, 'out', '.htaccess'), 'utf8'), dir };
}

/**
 * Napodobenina produkce (Apache se statickým exportem) na 127.0.0.1 (https i http) pro jména www.mnastrojarna.cz a
 * mnastrojarna.cz, krátké domény (vše → CAD) a cizího webu. `state.php` = úložiště, na které jde /cad/share/ (lze za
 * běhu vyměnit za starší skript); `state.share` = záznam požadavků na úložiště (cesta, Sec-Fetch-Site, stav).
 */
async function startProd(rules, state) {
  const dir = tmp('mn-cert-');
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'crt.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=www.mnastrojarna.cz', '-addext', `subjectAltName=DNS:www.mnastrojarna.cz,DNS:mnastrojarna.cz,DNS:${SHORT_HOST}`], { stdio: 'ignore' });
  const hops = [];
  state.share = [];
  const pipeTo = (origin, urlPath, req, res, extra = {}, log = null) => {
    const u = new URL(origin);
    const up = http.request({ hostname: u.hostname, port: u.port, method: req.method, path: urlPath, headers: { ...req.headers, host: u.host, ...extra } }, (r) => {
      if (process.env.E2E_DEBUG && !/^\/(_next|vendor)\//.test(urlPath)) console.log(`#   proxy ${req.method} ${req.headers.host}${req.url} → ${origin}${urlPath} ${r.statusCode}`);
      if (log) log.push({ method: req.method, url: req.url, site: req.headers['sec-fetch-site'] || '', status: r.statusCode });
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  };
  const handler = (scheme) => (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    const [p, q = ''] = req.url.split(/\?(.*)/s);
    const query = q ? '?' + q : '';
    const redirect = (to) => { hops.push(`301 ${scheme}://${host}${p} → ${to}`); res.writeHead(301, { Location: to, 'Content-Length': 0 }); res.end(); };
    // krátká doména (jiný web): cokoli → CAD se žádostí o kód (část za # si prohlížeč nese sám)
    if (host === SHORT_HOST) return redirect(WWW + '/cad/?kod=1');
    // .htaccess: mnastrojarna.cz → www.mnastrojarna.cz (zachová http/https)
    if (host === 'mnastrojarna.cz') return redirect(`${scheme}://www.mnastrojarna.cz` + req.url);
    // .htaccess: úložiště sdílených odkazů se nikdy nepřepisuje (RewriteRule ^cad/share/ - [L]); Host zůstává jako u Apache
    if (p.startsWith('/cad/share/')) return pipeTo(state.php.origin, req.url, req, res, { host: 'www.mnastrojarna.cz' }, state.share);
    // .htaccess: staré adresy → nové stránky (vygenerovaná pravidla včetně /s → /cad/?kod=1; cíl s parametry nahradí dotaz)
    for (const r of rules) if (r.re.test(p.slice(1))) return redirect(r.to.includes('?') ? r.to : r.to + query);
    // .htaccess: chybějící lomítko na konci (statický export = složka/index.html)
    if (/^\/((en|de)\/)?cad$/.test(p)) return redirect(p + '/' + query);
    // složka/index.html statického exportu ≈ stránka sestavené aplikace
    return pipeTo(BASE, /^\/((en|de)\/)?cad\/$/.test(p) ? p.slice(0, -1) + query : req.url, req, res);
  };
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler('https'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const plain = http.createServer(handler('http'));
  await new Promise((resolve) => plain.listen(0, '127.0.0.1', resolve));
  // proxy prohlížeče: CONNECT na produkční jména a krátkou doménu → místní HTTPS server; http:// těchže jmen → místní
  // HTTP server; http://evil.test → stránka útočníka; cokoli jiného 403 (nic neopustí tento stroj)
  const stats = { tunnels: 0, plain: 0, refused: [] };
  const NAMES = ['www.mnastrojarna.cz', 'mnastrojarna.cz', SHORT_HOST];
  const tunnel = http.createServer((req, res) => {
    let u = null;
    try { u = new URL(req.url); } catch { /* není absolutní adresa */ }
    if (u && u.protocol === 'http:' && NAMES.includes(u.hostname)) {
      stats.plain++;
      const up = http.request({ hostname: '127.0.0.1', port: plain.address().port, method: req.method, path: u.pathname + u.search, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); });
      return req.pipe(up);
    }
    if (u && u.origin === EVIL) {
      // cizí stránka: 125 obrázků s adresami úložiště (náhodná id) – prohlížeč je načte s Sec-Fetch-Site: cross-site
      const imgs = Array.from({ length: 125 }, (_, i) => `<img src="${WWW}/cad/share/?id=zzzzzzzz${100 + i}" width="1" height="1">`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><title>evil</title><body>${imgs}<script>window.addEventListener('load',()=>{document.title='done'})</script></body>`);
    }
    stats.refused.push(req.url); res.writeHead(403); res.end();
  });
  tunnel.on('connect', (req, sock, head) => {
    const host = String(req.url).toLowerCase();
    if (!NAMES.some((n) => host === n + ':443')) { stats.refused.push(req.url); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    stats.tunnels++;
    const up = net.connect(server.address().port, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  await new Promise((resolve) => tunnel.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, proxy: `http://127.0.0.1:${tunnel.address().port}`, stats, hops, server, plain, tunnel };
}

const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the kernel|Kern wird geladen/.test(document.body.innerText), null, { timeout: 240000 });
const ready = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(page);
  await page.waitForTimeout(800);
  if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click().catch(() => page.keyboard.press('Escape'));
};
const volumeOf = async (page) => {
  const st = await page.evaluate(() => window.mncad.status());
  return /(?:objem|volume|Volumen) (?:Σ )?([\d\s ,.]+) cm³/.exec(st)?.[1]?.trim() ?? null;
};
const loadFlange = async (page) => {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  await page.getByRole('button', { name: /Příruba DN50/ }).click();
  await page.waitForTimeout(3500);
};
const dlgOf = (page) => page.locator('div.fixed.z-\\[70\\]');
/** sdílený dokument otevřený (pruh „Sdílený dokument“) – čeká na odvození klíče, stažení a otevření */
const sharedOpen = (page, ms = 180000) => page.locator('[role=status]').first().waitFor({ timeout: ms }).then(() => true, () => false);
/** co stránka během načítání ukázala: hlášení o otevírání, úvodní obrazovku */
const WATCH = () => {
  window.__mn = { opening: false, start: false };
  const scan = (n) => {
    const t = n.textContent || '';
    if (/Otevírám sdílený dokument|Opening the shared document|Geteiltes Dokument wird geöffnet/.test(t)) window.__mn.opening = true;
    if (/Pokračovat v práci/.test(t)) window.__mn.start = true;
  };
  new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) scan(n); if (m.type === 'characterData') scan(m.target); } }).observe(document, { subtree: true, childList: true, characterData: true });
};
/** odpovědi 3xx hlavní navigace stránky */
const navHops = (page) => {
  const hops = [];
  page.on('response', (res) => { if (res.request().isNavigationRequest() && res.status() >= 300 && res.status() < 400) hops.push(`${res.status()} ${res.url()} → ${res.headers().location}`); });
  return hops;
};
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmtMs = (a) => `medián ${Math.round(median(a))} ms (min ${Math.round(Math.min(...a))}, max ${Math.round(Math.max(...a))}; ${a.map((x) => Math.round(x)).join(' ')})`;

/** E2E_ONLY=část[,část…] spustí jen vybrané části (společná příprava běží vždy): kdf, sender, recipient, manual, nearmiss, entry, revoke, http, cross, shortdomain, en, old */
const ONLY = (process.env.E2E_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);

let browser = null;
let prod = null;
(async () => {
  // ── .htaccess statického exportu: pravidla /s ──
  const ht = generateHtaccess();
  const lines = ht.text.split('\n');
  const sRules = lines.filter((l) => /^RewriteRule \^(?:en\/|de\/)?s\/\?\$ /.test(l.trim())).map((l) => l.trim());
  console.log('# vygenerovaný .htaccess – pravidla krátkého odkazu:');
  for (const l of sRules) console.log('#   ' + l);
  ok(sRules.join('|') === 'RewriteRule ^s/?$ /cad/?kod=1 [R=301,L,NC]|RewriteRule ^en/s/?$ /en/cad/?kod=1 [R=301,L,NC]|RewriteRule ^de/s/?$ /de/cad/?kod=1 [R=301,L,NC]', 'gen-htaccess.mjs: /s → /cad/?kod=1, /en/s → /en/cad/?kod=1, /de/s → /de/cad/?kod=1 (301)');
  ok(lines.filter((l) => /^RewriteRule \S+ \S*\?\S* \[R=301,L,NC\]$/.test(l.trim())).length === 3, 'parametr v cíli mají jen tři pravidla krátkého odkazu (ostatní přesměrování beze změny)');
  const iShare = lines.findIndex((l) => /RewriteRule \^cad\/share\/ - \[L\]/.test(l));
  const iS = lines.findIndex((l) => /RewriteRule \^s\/\?\$ /.test(l));
  const iSlash = lines.findIndex((l) => /Chybějící lomítko/.test(l));
  const iApex = lines.findIndex((l) => /RewriteRule \^\(\.\*\)\$ https:\/\/www\.mnastrojarna\.cz\/\$1 \[R=301,L\]/.test(l));
  ok(iApex > 0 && iShare > iApex && iS > iShare && iSlash > iS, 'pořadí pravidel: holá doména → www, pak výjimka /cad/share/, pak /s, pak doplnění lomítka');
  const rules = lines.map((l) => /^\s*RewriteRule \^(\S+)\$ (\S+) \[R=301,L,NC\]$/.exec(l)).filter(Boolean).filter((m) => !m[1].includes('(')).map((m) => ({ re: new RegExp('^' + m[1] + '$', 'i'), to: m[2] }));
  ok(rules.length >= 20 && rules.filter((r) => r.re.test('s')).length === 1 && !rules.some((r) => r.re.test('cad') || r.re.test('sluzby') || r.re.test('cad/share/')), `pravidlo /s nezasahuje jiné stránky (${rules.length} přesměrování; „s“ odpovídá právě jednomu)`);

  // ── servery ──
  const php = await startPhp(SCRIPT, { MN_SHARE_RATE: '1000' });
  ok((await (await fetch(php.origin + '/cad/share/?ping')).json()).v === 2, `PHP úložiště běží (${php.origin}, ?ping v = 2)`);
  let oldScript = null;
  try { oldScript = execFileSync('git', ['show', 'bf91b0b:website/public/cad/share/index.php'], { cwd: WEB, maxBuffer: 1 << 22 }); } catch { /* bez gitu */ }
  const phpOld = oldScript ? await startPhp(oldScript, { MN_SHARE_RATE: '1000' }) : null;
  const state = { php };
  prod = await startProd(rules, state);
  // přímo proti sestavené aplikaci (Vercel / next start): přesměrování z next.config.mjs
  for (const [from, to] of [['/s', '/cad?kod=1'], ['/en/s', '/en/cad?kod=1'], ['/de/s', '/de/cad?kod=1']]) {
    const res = await fetch(BASE + from, { redirect: 'manual' });
    ok([301, 308].includes(res.status) && res.headers.get('location') === to, `next start: ${from} → ${res.status} ${res.headers.get('location')}`);
  }

  // (bez automatického přepisu http → https v prohlížeči: přepnutí na https má zařídit stránka sama)
  const b = (browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable'], proxy: { server: prod.proxy } }));
  const newCtx = async () => {
    const c = await b.newContext({ viewport: { width: 1400, height: 850 }, ignoreHTTPSErrors: true });
    await c.addInitScript(WATCH);
    return c;
  };
  const errs = [];
  const watchErrs = (page) => page.on('pageerror', (e) => errs.push(e.message));

  // ── odesílatel na https://www.mnastrojarna.cz/cad/ ──
  const ctx = await newCtx();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  watchErrs(p);
  await p.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await ready(p);
  ok(await p.evaluate(() => location.origin === 'https://www.mnastrojarna.cz' && isSecureContext && !!crypto.subtle), `odesílatel: stránka běží na ${await p.evaluate(() => location.href)} (zabezpečený kontext)`);

  const ping = await p.evaluate(() => fetch('/cad/share/?ping', { cache: 'no-store' }).then(async (res) => `${res.status} ${res.headers.get('content-type')} ${(await res.text()).slice(0, 120)}`, (e) => 'ERR ' + e.message));
  ok(/^200 application\/json.*"v":2/.test(ping) && prod.stats.tunnels > 0, `stránku i úložiště /cad/share/ obsluhuje místní napodobenina produkce (${prod.stats.tunnels} spojení přes místní proxy; ${ping})`);
  if (!/^200 /.test(ping) || !prod.stats.tunnels) throw new Error('prohlížeč nejede přes místní napodobeninu – dál nemá smysl pokračovat');

  if (SHORT) {
    // ── aplikace sestavená s NEXT_PUBLIC_CAD_SHARE_SHORT=<krátká doména>: odkaz míří na krátkou doménu ──
    await loadFlange(p);
    const a = await p.evaluate(() => window.mncad.share({ days: 1 }));
    const bare = a.url.replace(/^https:\/\//, '');
    ok(new RegExp('^' + SHORT.replace(/[.]/g, '\\.') + '#' + CODE + '$').test(a.url) && a.chars === SHORT.length + 11 && a.code === codeOf(a.url), `window.mncad.share() → ${a.url} (${a.chars} znaků, bez https:// ${bare.length})`);
    ok(bare.length <= 20, `bez https:// má odkaz ${bare.length} znaků (cíl ≤ 20)`);
    ok(fs.existsSync(path.join(php.data, idOfCode(a.code) + '.bin')), 'obsah je v úložišti hlavního webu pod id odvozeným z kódu');
    await p.getByRole('button', { name: 'Sdílet odkazem', exact: true }).first().click();
    await p.waitForFunction(() => { const t = document.querySelector('[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 120000 });
    const u = await p.locator('[aria-label="Sdílený odkaz"]').inputValue();
    const t = await dlgOf(p).innerText();
    ok(u.startsWith(SHORT + '#') && t.includes(`${u.length} znaků`) && t.includes(SHORT_HOST), `dialog: ${u} · „${u.length} znaků“ · kam zadat kód: ${SHORT_HOST}`);
    await p.screenshot({ path: S + 'w16-short-domain-dialog.png' });
    await dlgOf(p).getByRole('button', { name: 'Zavřít', exact: true }).last().click();
    const c2 = await newCtx();
    const r = await c2.newPage();
    watchErrs(r);
    const hops = navHops(r);
    await r.goto(a.url, { waitUntil: 'commit', timeout: 240000 });
    ok(await sharedOpen(r) && hops.length === 1 && /^https:\/\/www\.mnastrojarna\.cz\/cad\/?$/.test(r.url()) && (await r.evaluate(() => window.mncad.getDocument().name)) === 'Příruba DN50', `příjemce: ${hops.join(' | ')} → ${r.url()} – dokument otevřen`);
    await r.close();
    const t2 = await c2.newPage();
    await t2.goto(SHORT, { waitUntil: 'networkidle', timeout: 240000 });
    const f = t2.getByLabel('Kód sdíleného dokumentu');
    ok(await f.waitFor({ timeout: 60000 }).then(() => true, () => false), `${SHORT_HOST} bez kódu: dialog pro zadání kódu`);
    await f.fill(grouped(a.code));
    await f.press('Enter');
    ok(await sharedOpen(t2), 'kód zadaný po skupinách dokument otevře');
    await t2.close();
    ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
    await b.close();
    return;
  }

  // odvození klíče: PBKDF2-HMAC-SHA-256, 1 200 000 iterací, 32 B + HKDF (jako share.ts) – Chromium a Node
  if (want('kdf')) {
  const kdfPage = await p.evaluate(async () => {
    const enc = new TextEncoder();
    const out = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      const k = await crypto.subtle.importKey('raw', enc.encode('Ab3kZ9xQ2' + i), 'PBKDF2', false, ['deriveBits']);
      const prk = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('mncad-share-v2'), iterations: 1200000, hash: 'SHA-256' }, k, 256);
      const h = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('mncad-share-v2 id') }, h, 128);
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('mncad-share-v2 key') }, h, 256);
      out.push(performance.now() - t);
    }
    return { ms: out.slice(1), cores: navigator.hardwareConcurrency, ua: navigator.userAgent };
  });
  const kdfNode = [];
  for (let i = 0; i < 9; i++) {
    const enc = new TextEncoder();
    const t = performance.now();
    const k = await crypto.webcrypto.subtle.importKey('raw', enc.encode('Ab3kZ9xQ2' + i), 'PBKDF2', false, ['deriveBits']);
    await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('mncad-share-v2'), iterations: 1200000, hash: 'SHA-256' }, k, 256);
    if (i) kdfNode.push(performance.now() - t);
  }
  console.log(`# odvození klíče (PBKDF2 1 200 000 iterací, 32 B + HKDF) – Chromium ${/Chrome\/([\d.]+)/.exec(kdfPage.ua)?.[1]} (${kdfPage.cores} jader, zátěž ${os.loadavg()[0].toFixed(1)}): ${fmtMs(kdfPage.ms)}`);
  console.log(`# odvození klíče (PBKDF2 1 200 000 iterací, 32 B) – Node ${process.version}: ${fmtMs(kdfNode)}`);
  ok(median(kdfPage.ms) < 3000 && median(kdfNode) < 3000, `odvození klíče do 3 s (Chromium ${Math.round(median(kdfPage.ms))} ms, Node ${Math.round(median(kdfNode))} ms)`);
  }

  await loadFlange(p);
  const vol = await volumeOf(p);
  ok(!!vol, `odesílatel: objem příruby ${vol} cm³`);
  let t0 = Date.now();
  const api = await p.evaluate(() => window.mncad.share({ days: 1 }));
  const tShare = Date.now() - t0;
  ok(new RegExp('^https://mnastrojarna\\.cz/s#' + CODE + '$').test(api.url), `window.mncad.share() → ${api.url}`);
  ok(api.url.length === 36 && api.chars === 36 && api.url.replace('https://', '').length === 28 && api.url.split('mnastrojarna.cz')[1].length === 13, `délka odkazu ${api.url.length} znaků (bez https:// ${api.url.replace('https://', '').length}, za doménou ${api.url.split('mnastrojarna.cz')[1].length}); vytvoření ${tShare} ms`);
  ok(api.mode === 'self' && api.code === codeOf(api.url) && api.message.split('\n').includes(api.url), 'výsledek: mode "self", code = část za #, zpráva nese odkaz na vlastním řádku');
  const typo = mistype(api.code);
  const ctx3 = await newCtx(); // příjemce (další části)
  if (want('sender')) {
  const id = idOfCode(api.code);
  ok(fs.existsSync(path.join(php.data, id + '.bin')) && !api.url.includes(id), `na serveru je obsah pod id odvozeným z kódu (${id}), v odkazu id není`);
  const disk = fs.readdirSync(php.data).map((f) => { try { return f + '\n' + fs.readFileSync(path.join(php.data, f)).toString('latin1'); } catch { return f; } }).join('\n');
  ok(!disk.includes(api.code) && !disk.includes('Příruba'), 'kód ani čitelný obsah na serveru nejsou');
  // dialog: krátký odkaz, délka, kód po skupinách
  await p.getByRole('button', { name: 'Sdílet odkazem', exact: true }).first().click();
  await p.waitForFunction(() => { const t = document.querySelector('[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 120000 });
  const urlDlg = await p.locator('[aria-label="Sdílený odkaz"]').inputValue();
  const tDlg = await dlgOf(p).innerText();
  ok(new RegExp('^https://mnastrojarna\\.cz/s#' + CODE + '$').test(urlDlg) && /36 znaků/.test(tDlg), `dialog: ${urlDlg} · „36 znaků“`);
  ok(tDlg.includes('Kód:') && tDlg.includes(grouped(codeOf(urlDlg))) && tDlg.includes('mnastrojarna.cz/s'), `dialog: kód po skupinách „${grouped(codeOf(urlDlg))}“ a kam ho zadat (mnastrojarna.cz/s)`);
  await p.screenshot({ path: S + 'w16-short-dialog.png' });
  await dlgOf(p).getByRole('button', { name: 'Kopírovat odkaz' }).click();
  await p.waitForTimeout(400);
  ok((await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === urlDlg, 'Kopírovat odkaz → krátký odkaz ve schránce');
  await dlgOf(p).getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  }

  // ── příjemce: https://mnastrojarna.cz/s#KÓD → www → /s → /cad/ ──
  if (want('recipient')) {
  // heslo
  const apiPw = await p.evaluate(() => window.mncad.share({ days: 1, password: 'tajne' }));
  ok(apiPw.url.length === 36 && apiPw.code !== api.code, `odkaz s heslem stejně krátký (${apiPw.url.length} znaků)`);
  const ctx2 = await newCtx();
  const r = await ctx2.newPage();
  watchErrs(r);
  const hops = navHops(r);
  t0 = Date.now();
  await r.goto(api.url, { waitUntil: 'commit', timeout: 240000 });
  const opened = await sharedOpen(r);
  const tOpen = Date.now() - t0;
  ok(hops.length === 2 && hops[0] === `301 ${APEX}/s → ${WWW}/s` && hops[1] === `301 ${WWW}/s → /cad/?kod=1`, `řetěz přesměrování: ${hops.join('  |  ')}`);
  ok(/^https:\/\/www\.mnastrojarna\.cz\/cad\/?$/.test(r.url()), `příjemce skončí na ${r.url()} (část za # i parametr kod jsou z adresy odstraněny)`);
  ok((await r.evaluate(() => sessionStorage.getItem('mn-cad-share'))) === '#' + api.code, 'část za # přežila obě přesměrování (kód odložen do sessionStorage)');
  ok(opened, `sdílený dokument otevřen (pruh „Sdílený dokument“) za ${tOpen} ms od zadání adresy`);
  const seen = await r.evaluate(() => window.__mn);
  ok(seen.opening && !seen.start, `během otevírání hlášení „Otevírám sdílený dokument…“ (${seen.opening}) a žádná úvodní obrazovka (${!seen.start})`);
  await coreReady(r);
  await r.waitForTimeout(3000);
  const vol2 = await volumeOf(r);
  ok(vol2 === vol, `příjemce: stejný model (objem ${vol2} = ${vol} cm³)`);
  await r.screenshot({ path: S + 'w16-short-recipient.png' });
  await r.reload({ waitUntil: 'networkidle', timeout: 240000 });
  await coreReady(r);
  await r.waitForTimeout(3000);
  ok(/Díra 1/.test(await r.locator('aside').first().innerText()), 'po F5 sdílený díl zůstává');
  await r.close();

  // další tvary téhož odkazu: s lomítkem, přímo /cad#KÓD (doplnění lomítka), s interpunkcí přilepenou za odkaz
  for (const [what, url, want] of [
    ['/s/#KÓD', `${APEX}/s/#${api.code}`, 2],
    ['www …/cad#KÓD (bez /s)', `${WWW}/cad#${api.code}`, 1],
    ['odkaz ve větě: „…#KÓD).“', `${api.url}).`, 2],
    // revize: znaky, které za odkaz přilepí kopírování nebo zpráva (prohlížeč je v adrese zakóduje: " → %22, > → %3E…)
    ['uvozovka: …#KÓD"', `${api.url}"`, 2],
    ['české uvozovky: …#KÓD“', `${api.url}“`, 2],
    ['ostrá závorka: …#KÓD>', `${api.url}>`, 2],
    ['hvězdičky: …#KÓD**', `${api.url}**`, 2],
    ['mezera: …#KÓD%20', `${api.url}%20`, 2],
    ['lomítko: …#KÓD/', `${api.url}/`, 2],
    ['výpustka a podtržítko: …#KÓD…_', `${api.url}…_`, 2],
    ['kód po skupinách za adresou: …/s#Ab3k Z9xQ 2m', `${APEX}/s#${grouped(api.code)}`, 2],
  ]) {
    const q = await ctx2.newPage();
    const h = navHops(q);
    await q.goto(url, { waitUntil: 'commit', timeout: 240000 });
    const o = await sharedOpen(q);
    const name = o ? await q.evaluate(() => window.mncad.getDocument().name) : '';
    ok(o && name === 'Příruba DN50' && h.length === want && !q.url().includes('#') && !q.url().includes('kod='), `${what}: ${h.length} přesměrování, otevřeno „${name}“`);
    await q.close();
  }

  // heslo: samotný kód neotevře
  const r2 = await ctx2.newPage();
  await r2.goto(apiPw.url, { waitUntil: 'commit', timeout: 240000 });
  const pw = r2.getByLabel('Heslo sdíleného dokumentu');
  ok(await pw.waitFor({ timeout: 120000 }).then(() => true, () => false), 'odkaz s heslem: samotný kód dokument neotevře – dotaz na heslo');
  await pw.fill('spatne');
  await r2.getByRole('button', { name: 'Otevřít', exact: true }).click();
  await r2.waitForFunction(() => /Nesprávné heslo/.test(document.querySelector('div.fixed.z-\\[70\\]')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  ok(/Nesprávné heslo/.test(await dlgOf(r2).innerText()), 'špatné heslo odmítnuto');
  await pw.fill('tajne');
  await pw.press('Enter');
  ok(await sharedOpen(r2), 'správné heslo dokument otevře');
  await r2.close();

  // neznámý kód (správný tvar, v úložišti nic)
  const r3 = await ctx2.newPage();
  await r3.goto(`${APEX}/s#Zz99999999`, { waitUntil: 'commit', timeout: 240000 });
  const f3 = r3.getByLabel('Kód sdíleného dokumentu');
  await f3.waitFor({ timeout: 120000 }).catch(() => {});
  ok((await f3.inputValue().catch(() => '')) === 'Zz99999999' && /Dokument s tímto kódem v úložišti není\. Zkontrolujte kód – záleží na velikosti písmen/.test(await r3.locator('body').innerText()), 'neznámý kód: dialog s kódem k opravě a radou zkontrolovat kód a velikost písmen');
  await r3.close();
  await ctx2.close();
  }

  // ── ruční zadání kódu: …/s bez kódu → dialog; překlep se na kartu nepřilepí; kód dopsaný za adresu ──
  if (want('manual')) {
  const s = await ctx3.newPage();
  watchErrs(s);
  const sHops = navHops(s);
  await s.goto(APEX + '/s', { waitUntil: 'networkidle', timeout: 240000 });
  const field = s.getByLabel('Kód sdíleného dokumentu');
  ok(await field.waitFor({ timeout: 60000 }).then(() => true, () => false) && /Otevřít sdílený dokument/.test(await dlgOf(s).innerText()), 'mnastrojarna.cz/s bez kódu: dialog „Otevřít sdílený dokument“ s polem pro kód');
  ok(sHops[1] === `301 ${WWW}/s → /cad/?kod=1` && /\/cad\/?$/.test(s.url()), `…/s → ${sHops[1]?.split(' → ')[1]}, parametr kod z adresy hned zmizí (${s.url()})`);
  await s.screenshot({ path: S + 'w16-short-code-field.png' });
  await field.fill('nesmysl');
  await field.press('Enter');
  ok(await s.getByText(/Kód má 10 znaků/).isVisible({ timeout: 5000 }).catch(() => false) && (await field.getAttribute('aria-invalid')) === 'true', 'neplatné zadání: srozumitelná hláška, dialog zůstává');
  // revize (překlep se „přilepil“ na kartu): kód malými písmeny → chyba u pole, nic se neodloží, F5 nic neopakuje
  const typoIsOther = typo !== api.code && new RegExp('^' + CODE + '$').test(typo);
  const missesBefore = prod && state.share.filter((x) => x.status === 404).length;
  await field.fill(typo);
  await field.press('Enter');
  await s.locator('[data-share-code-error]').waitFor({ timeout: 120000 }).catch(() => {});
  const typoErr = await s.locator('[data-share-code-error]').innerText().catch(() => '');
  ok(typoIsOther && /Dokument s tímto kódem v úložišti není\. Zkontrolujte kód – záleží na velikosti písmen/.test(typoErr) && (await field.inputValue()) === typo, `překlep (jiná velikost písmene: „${typo}“ místo „${api.code}“): chyba přímo u pole, zadaný kód zůstává k opravě`);
  ok((await s.evaluate(() => sessionStorage.getItem('mn-cad-share'))) === null, 'překlep se neodloží do sessionStorage');
  await s.screenshot({ path: S + 'w16-short-typo.png' });
  await s.reload({ waitUntil: 'networkidle', timeout: 240000 });
  await ready(s);
  await s.waitForTimeout(2500);
  ok(!/nelze otevřít|v úložišti není/.test(await s.locator('body').innerText()) && state.share.filter((x) => x.status === 404).length === missesBefore + 1, 'po F5 se překlep znovu nezkouší (žádné hlášení, žádný další dotaz na úložiště)');
  // tatáž karta znovu na …/s: dialog je zpět (dřív úvodní obrazovka ani pole už nešly zobrazit)
  await s.goto(APEX + '/s', { waitUntil: 'networkidle', timeout: 240000 });
  ok(await field.waitFor({ timeout: 60000 }).then(() => true, () => false), 'tatáž karta znovu na …/s: dialog pro kód se zobrazí i v kartě, kde se už pracovalo');
  // revize: přirozená zadání, která pole odmítalo
  await field.fill('Kód: ' + grouped(api.code));
  await s.locator('[data-share-code-form]').getByRole('button', { name: 'Otevřít', exact: true }).click();
  ok(await sharedOpen(s), `řádek z dialogu sdílení („Kód: ${grouped(api.code)}“) otevře sdílený dokument`);
  await coreReady(s);
  await s.waitForTimeout(2500);
  ok((await volumeOf(s)) === vol && !(await field.isVisible().catch(() => false)), 'dialog se zavřel, model je stejný');
  await s.reload({ waitUntil: 'networkidle', timeout: 240000 });
  await coreReady(s);
  await s.waitForTimeout(3000);
  ok(/Díra 1/.test(await s.locator('aside').first().innerText()), 'po F5 dokument otevřený zadáním kódu zůstává');
  await s.close();
  for (const [what, text] of [
    ['odkaz s kódem po skupinách', `mnastrojarna.cz/s#${grouped(api.code)}`],
    ['odkaz, za kterým pokračuje text', `${api.url} – heslo pošlu zvlášť`],
    ['celá zpráva z „Kopírovat zprávu“', api.message],
  ]) {
    const q = await ctx3.newPage();
    await q.goto(WWW + '/s', { waitUntil: 'networkidle', timeout: 240000 });
    const f = q.getByLabel('Kód sdíleného dokumentu');
    await f.waitFor({ timeout: 60000 });
    await f.fill(text);
    await f.press('Enter');
    ok(await sharedOpen(q) && (await q.evaluate(() => window.mncad.getDocument().name)) === 'Příruba DN50', `pole přijme: ${what}`);
    await q.close();
  }
  }

  // revize: část za #, která vypadá jako kód s chybou → dialog s vysvětlením (dřív mlčky prázdný CAD a kód v adrese)
  if (want('nearmiss')) {
  for (const [what, hash, want, re] of [
    ['nula místo písmene', '#Ab3kZ9xQ0m', 'Ab3kZ9xQ0m', /znak „0“/],
    ['velké O', '#Ab3kZ9xQOm', 'Ab3kZ9xQOm', /znak „O“/],
    ['zkrácený kód (9 znaků)', '#Ab3kZ9xQ2', 'Ab3kZ9xQ2', /zadáno je 9/],
    ['o znak delší kód', '#Ab3kZ9xQ2mX', 'Ab3kZ9xQ2mX', /zadáno je 11/],
    ['zkrácený kód s uvozovkou', '#Ab3kZ9xQ2"', 'Ab3kZ9xQ2', /zadáno je 9/],
    ['kód VELKÝMI PÍSMENY s O', '#JYCWWOFHWW', 'JYCWWOFHWW', /znak „O“/],
  ]) {
    const q = await ctx3.newPage();
    await q.goto(APEX + '/s' + hash, { waitUntil: 'networkidle', timeout: 240000 });
    const f = q.getByLabel('Kód sdíleného dokumentu');
    await f.waitFor({ timeout: 60000 }).catch(() => {});
    const err = await q.locator('[data-share-code-error]').innerText().catch(() => '');
    ok((await f.inputValue().catch(() => '')) === want && re.test(err) && !q.url().includes('#') && (await q.evaluate(() => sessionStorage.getItem('mn-cad-share'))) === null, `část za # s chybou – ${what}: dialog s kódem „${want}“ a vysvětlením (${err.slice(0, 44)}…), z adresy zmizí`);
    await q.close();
  }
  // kód ve správné abecedě, jen s jinou velikostí písmene v ODKAZU: dialog s kódem k opravě (dřív zavádějící „už v úložišti není“)
  const wc = await ctx3.newPage();
  await wc.goto(APEX + '/s#' + typo, { waitUntil: 'commit', timeout: 240000 });
  await wc.locator('[data-share-code-error]').waitFor({ timeout: 120000 }).catch(() => {});
  ok(/Zkontrolujte kód – záleží na velikosti písmen/.test(await wc.locator('[data-share-code-error]').innerText().catch(() => '')) && (await wc.getByLabel('Kód sdíleného dokumentu').inputValue().catch(() => '')) === typo && (await wc.evaluate(() => sessionStorage.getItem('mn-cad-share'))) === null, 'odkaz s kódem v jiné velikosti písmen: dialog s kódem k opravě a radou; na kartu se nepřilepí');
  // oprava přímo v dialogu
  await wc.getByLabel('Kód sdíleného dokumentu').fill(api.code);
  await wc.getByLabel('Kód sdíleného dokumentu').press('Enter');
  ok(await sharedOpen(wc), 'po opravě kódu v dialogu se dokument otevře');
  await wc.close();
  }

  // revize: …/s nabídne zadání kódu i s vypnutou úvodní obrazovkou a v kartě s rozdělanou prací; nabídka Soubor
  if (want('entry')) {
  const ctx4 = await newCtx();
  const w = await ctx4.newPage();
  watchErrs(w);
  await w.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await ready(w);
  await w.evaluate(() => window.mncad.run('nový díl Rozdělaná práce\nskica XY: obdélník 30 20\nvysunout 5'));
  await w.waitForTimeout(1500);
  await w.goto(APEX + '/s', { waitUntil: 'networkidle', timeout: 240000 });
  ok(await w.getByLabel('Kód sdíleného dokumentu').waitFor({ timeout: 60000 }).then(() => true, () => false) && !(await w.getByText('Pokračovat v práci').isVisible().catch(() => false)), 'karta, kde se už v CADu pracovalo: …/s zobrazí dialog pro kód (úvodní obrazovka se neukazuje)');
  await w.keyboard.press('Escape');
  await w.waitForTimeout(400);
  ok(!(await w.getByLabel('Kód sdíleného dokumentu').isVisible().catch(() => false)), 'dialog jde zavřít (Esc) – zůstane běžný CAD');
  // nabídka Soubor → Otevřít sdílený dokument…
  await w.getByRole('button', { name: 'Soubor', exact: true }).click();
  await w.getByRole('button', { name: /Otevřít sdílený dokument…/ }).click();
  const wf = w.getByLabel('Kód sdíleného dokumentu');
  ok(await wf.waitFor({ timeout: 10000 }).then(() => true, () => false), 'nabídka Soubor → „Otevřít sdílený dokument…“ otevře dialog pro kód');
  await wf.fill(api.code);
  await wf.press('Enter');
  ok(await sharedOpen(w) && (await w.evaluate(() => window.mncad.getDocument().name)) === 'Příruba DN50', 'kód zadaný z nabídky Soubor dokument otevře');
  await w.close();
  // vypnutá úvodní obrazovka (Nastavení): nová karta na …/s
  const off = await ctx4.newPage();
  await off.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  const cb = off.getByLabel(/Nezobrazovat při spuštění/);
  if (await cb.isVisible({ timeout: 8000 }).catch(() => false)) await cb.check();
  await ready(off);
  await off.close();
  const off2 = await ctx4.newPage();
  await off2.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await coreReady(off2);
  const startOff = !(await off2.getByText('Pokračovat v práci').isVisible({ timeout: 3000 }).catch(() => false));
  await off2.goto(APEX + '/s', { waitUntil: 'networkidle', timeout: 240000 });
  ok(startOff && await off2.getByLabel('Kód sdíleného dokumentu').waitFor({ timeout: 60000 }).then(() => true, () => false), 'vypnutá úvodní obrazovka: …/s přesto zobrazí dialog pro kód');
  await off2.close();
  await ctx4.close();

  const h = await ctx3.newPage();
  await h.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await ready(h);
  await h.evaluate((c) => { location.hash = '#' + c; }, api.code);
  ok(await sharedOpen(h) && (await h.evaluate(() => location.hash)) === '', 'kód dopsaný za adresu otevřeného CADu (…/cad/#KÓD) dokument otevře a z adresy zmizí');
  await h.close();
  }

  // ── revize: zneplatněný odkaz – vlastní hlášení, na kartu se nepřilepí, nejde oživit ──
  if (want('revoke')) {
  await p.getByRole('button', { name: 'Sdílet odkazem', exact: true }).first().click();
  await p.waitForFunction(() => { const t = document.querySelector('[aria-label="Sdílený odkaz"]'); return !!t && t.value.startsWith('http'); }, null, { timeout: 120000 });
  const rvUrl = await p.locator('[aria-label="Sdílený odkaz"]').inputValue();
  const rvId = idOfCode(codeOf(rvUrl));
  await dlgOf(p).getByRole('button', { name: 'Kopírovat odkaz' }).click();
  await p.waitForTimeout(400);
  ok(fs.existsSync(path.join(php.data, rvId + '.bin')), 'odkaz ke zneplatnění je na serveru');
  await dlgOf(p).getByRole('button', { name: 'Zneplatnit odkaz' }).click();
  await p.waitForFunction(() => /zneplatněn/.test(document.querySelector('[aria-label="Sdílený odkaz"]')?.value || ''), null, { timeout: 30000 }).catch(() => {});
  const tomb = fs.existsSync(path.join(php.data, 'dead', rvId.slice(0, 2))) ? fs.readFileSync(path.join(php.data, 'dead', rvId.slice(0, 2)), 'utf8') : '';
  ok(!fs.existsSync(path.join(php.data, rvId + '.bin')) && !fs.existsSync(path.join(php.data, rvId + '.json')) && new RegExp('^' + rvId + ' r\\d+$', 'm').test(tomb), 'Zneplatnit odkaz → obsah smazán, na serveru zůstal jen náhrobek (id se už nepřidělí)');
  await dlgOf(p).getByRole('button', { name: 'Zavřít', exact: true }).last().click();
  const rr = await ctx3.newPage();
  await rr.goto(rvUrl, { waitUntil: 'commit', timeout: 240000 });
  await rr.waitForFunction(() => /nelze otevřít/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  ok(/Odesílatel tento sdílený odkaz zneplatnil/.test(await rr.locator('body').innerText()) && (await rr.evaluate(() => sessionStorage.getItem('mn-cad-share'))) === null, 'zneplatněný odkaz: „Odesílatel tento sdílený odkaz zneplatnil“ a na kartu se nepřilepí');
  await rr.close();
  const replant = await fetch(`${php.origin}/cad/share/?days=90&total=5&id=${rvId}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('PODVR') });
  ok(replant.status === 409, `zneplatněný odkaz nejde oživit: nahrání pod jeho id → ${replant.status} id_taken`);
  }

  // ── revize: http:// (prohlížeč tam nemá WebCrypto) – stránka se sdíleným odkazem sama přejde na https:// ──
  if (want('http')) {
  const ctxH = await newCtx();
  const hx = await ctxH.newPage();
  watchErrs(hx);
  const hxHops = navHops(hx);
  await hx.goto(api.url.replace('https://', 'http://'), { waitUntil: 'commit', timeout: 240000 });
  const hxOpen = await sharedOpen(hx);
  ok(hxOpen && /^https:\/\/www\.mnastrojarna\.cz\/cad\/?$/.test(hx.url()) && hxHops.some((x) => x.startsWith('301 http://mnastrojarna.cz/s')) && prod.stats.plain > 0, `http://mnastrojarna.cz/s#KÓD: ${hxHops.join('  |  ')} → stránka přejde na https a dokument otevře (${hx.url()})`);
  await hx.close();
  const hy = await ctxH.newPage();
  await hy.goto('http://www.mnastrojarna.cz/s', { waitUntil: 'networkidle', timeout: 240000 });
  const hyOk = await hy.getByLabel('Kód sdíleného dokumentu').waitFor({ timeout: 90000 }).then(() => true, (e) => String(e.message).split('\n')[0]);
  ok(hyOk === true && hy.url().startsWith('https://www.mnastrojarna.cz/cad'), `http://www.mnastrojarna.cz/s bez kódu: přechod na https a dialog pro kód (${hy.url()})`);
  if (hyOk !== true) { console.log('#   ' + hyOk); await hy.screenshot({ path: S + 'w16-short-http-fail.png' }).catch((e) => console.log('#   snímek: ' + e.message.split('\n')[0])); }
  await hy.close();
  // CAD otevřený na http:// (bez sdíleného odkazu zůstává na http): sdílení skončí srozumitelnou chybou, ne chybou JavaScriptu
  const hz = await ctxH.newPage();
  await hz.goto('http://www.mnastrojarna.cz/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await ready(hz);
  await hz.evaluate(() => window.mncad.run('nový díl Na http\nskica XY: obdélník 30 20\nvysunout 5'));
  await hz.waitForFunction(() => window.mncad.getDocument().features.length === 2, null, { timeout: 60000 }).catch(() => {});
  await hz.waitForTimeout(800);
  const insecure = await hz.evaluate(async () => ({ secure: isSecureContext, href: location.href, err: await window.mncad.share({ days: 1 }).then(() => '', (e) => String(e.message || e)) }));
  ok(insecure.secure === false && insecure.href.startsWith('http://') && /zabezpečené připojení.*https:\/\//.test(insecure.err) && !/undefined|importKey/.test(insecure.err), `CAD na http://: sdílení → „${insecure.err.slice(0, 70)}…“`);
  // kód zadaný na http stránce (dopsaný za adresu): stránka přejde na https a otevře
  await hz.evaluate((c) => { location.hash = '#' + c; }, api.code);
  ok(await sharedOpen(hz) && hz.url().startsWith('https://www.mnastrojarna.cz/cad'), `kód dopsaný za adresu CADu na http://: přechod na https a otevření (${hz.url()})`);
  await hz.close();
  await ctxH.close();
  }

  // ── revize: cizí stránka návštěvníkovi sdílení nezablokuje (skutečné <img> z jiného webu) ──
  if (want('cross')) {
  const ev = await ctx3.newPage();
  const before = state.share.length;
  await ev.goto(EVIL + '/', { waitUntil: 'load', timeout: 120000 });
  await ev.waitForFunction(() => document.title === 'done', null, { timeout: 120000 }).catch(() => {});
  await ev.waitForTimeout(1500);
  const flood = state.share.slice(before).filter((x) => /id=zzzzzzzz/.test(x.url));
  const by = {};
  for (const x of flood) by[`${x.site || '—'} ${x.status}`] = (by[`${x.site || '—'} ${x.status}`] || 0) + 1;
  ok(flood.length === 125 && flood.every((x) => x.site === 'cross-site' && x.status === 403), `cizí stránka se 125 obrázky mířícími na úložiště: ${Object.entries(by).map(([k, n]) => `${n}× ${k}`).join(', ')} (odmítnuto, nepočítá se)`);
  await ev.close();
  const vv = await ctx3.newPage();
  await vv.goto(api.url, { waitUntil: 'commit', timeout: 240000 });
  ok(await sharedOpen(vv), 'tentýž prohlížeč pak sdílený odkaz normálně otevře (limit neúspěšných dotazů zůstal nedotčený)');
  await vv.close();
  }

  // ── kratší doména (jiný web přesměrovaný na CAD): část za # přežije i přesměrování mezi doménami ──
  if (want('shortdomain')) {
  const sd = await ctx3.newPage();
  const sdHops = navHops(sd);
  const shortUrl = `https://${SHORT_HOST}#${api.code}`;
  await sd.goto(shortUrl, { waitUntil: 'commit', timeout: 240000 });
  ok(await sharedOpen(sd) && sdHops.length === 1 && /^https:\/\/www\.mnastrojarna\.cz\/cad\/?$/.test(sd.url()), `kratší doména: ${shortUrl} (${shortUrl.length} znaků, bez https:// ${shortUrl.length - 8}) → ${sdHops.join(' | ')} → dokument otevřen`);
  await sd.close();
  }

  // ── EN: https://mnastrojarna.cz/en/s#KÓD ──
  if (want('en')) {
  const e = await ctx.newPage();
  await e.goto(WWW + '/en/cad/', { waitUntil: 'networkidle', timeout: 240000 });
  await e.waitForFunction(() => !!window.mncad, null, { timeout: 240000 });
  const c1 = e.getByText(/Continue working|Pokračovat v práci/);
  if (await c1.isVisible({ timeout: 6000 }).catch(() => false)) await c1.click();
  await coreReady(e);
  await e.evaluate(() => window.mncad.run('nový díl Plate\nskica XY: obdélník 80 50\nvysunout 12'));
  const apiEn = await e.evaluate(() => window.mncad.share({ days: 1 }));
  ok(new RegExp('^https://mnastrojarna\\.cz/en/s#' + CODE + '$').test(apiEn.url) && apiEn.url.length === 39, `EN: ${apiEn.url} (${apiEn.url.length} znaků)`);
  await e.close();
  const er = await ctx3.newPage();
  const eh = navHops(er);
  await er.goto(apiEn.url, { waitUntil: 'commit', timeout: 240000 });
  const eo = await sharedOpen(er);
  ok(eo && eh.length === 2 && eh[1] === `301 ${WWW}/en/s → /en/cad/?kod=1` && /\/en\/cad\/?$/.test(er.url()), `EN: ${eh.join('  |  ')} → ${er.url()}`);
  ok(/Shared document/.test(await er.locator('[role=status]').first().innerText().catch(() => '')) && (await er.evaluate(() => window.mncad.getDocument().name)) === 'Plate', 'EN: příjemci se otevře anglické rozhraní se sdíleným dílem');
  await er.close();
  }

  // ── starší odkaz #q=<id>.<klíč>: obsah vytvořený původním kódem (bf91b0b), nahraný starším API bez id ──
  if (want('old')) {
  const OLD_KEY = 'Y3zVVDBJ_a0QdUpYKLUKMw';
  const OLD_BLOB = Buffer.from('TU5RAQaMcYjIzb7dlc+EExElws+GCge7HL2l9HmOqBUbgUaDvsVbjky4ZUwBaM4FZwbNHakxADfivBj+fXZznElCy8/01+Bdcrr9toc1f3pL2okH6wh/5eOqEhevkLARP175DP+3fsrJ78w2BSiikDoeoYvlr6x9wazbKv0/MdSElx786ailHkpmnv+WW7d9rlv44I0nDaTfPxRyNfkjSXwBqhj/YAfMieZdxB7Ua84PbH3iCon2GY132KWLPFHpqSQcw8koZdwKtygFSBU8sl3I2ad9+QhjEq+IFsNca3Aw3169deLDL3XzSKkFhGhwe6S3xn1kqk8KS7jsDvTz+HPBKJ0lxyrYoqmlrSnvZvF20Du8ZwYQmqE=', 'base64');
  const up = await (await fetch(`${php.origin}/cad/share/?days=30&total=${OLD_BLOB.length}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: OLD_BLOB })).json();
  const oldUrl = `${WWW}/cad#q=${up.id}.${OLD_KEY}`;
  const o1 = await ctx3.newPage();
  await o1.goto(oldUrl, { waitUntil: 'commit', timeout: 240000 });
  const oo = await sharedOpen(o1);
  ok(oo && /^[0-9A-Za-z]{10}$/.test(up.id) && (await o1.evaluate(() => window.mncad.getDocument().name)) === 'Příruba DN50' && !o1.url().includes('#'), `starší odkaz ${oldUrl.slice(0, 48)}… (${oldUrl.length} znaků) se otevře dál`);
  await o1.close();

  // ── starší skript úložiště na serveru (nasazená jen nová aplikace): odkaz #q= s vysvětlením, jde otevřít ──
  if (phpOld) {
    state.php = phpOld;
    ok((await (await fetch(phpOld.origin + '/cad/share/?ping')).json()).v === 1, 'starší skript úložiště (bf91b0b) běží: ?ping v = 1');
    const lp = await ctx.newPage();
    await lp.goto(WWW + '/cad/', { waitUntil: 'networkidle', timeout: 240000 });
    await ready(lp);
    await lp.evaluate(() => window.mncad.run('nový díl Stará deska\nskica XY: obdélník 60 40\nvysunout 8'));
    const old = await lp.evaluate(() => window.mncad.share({ days: 1 }));
    ok(old.mode === 'self' && /^https:\/\/www\.mnastrojarna\.cz\/cad\/?#q=[0-9A-Za-z]{10}\.[A-Za-z0-9_-]{22}$/.test(old.url) && /starší verze/.test(old.note || '') && !old.code, `proti staršímu skriptu vznikne starší tvar s vysvětlením: ${old.url.slice(0, 44)}… (${old.url.length} znaků)`);
    await lp.close();
    const lr = await ctx3.newPage();
    await lr.goto(old.url, { waitUntil: 'commit', timeout: 240000 });
    ok(await sharedOpen(lr) && (await lr.evaluate(() => window.mncad.getDocument().name)) === 'Stará deska', 'odkaz ze staršího úložiště jde otevřít');
    await lr.close();
    state.php = php;
  } else console.log('# git není k dispozici – zkouška proti staršímu skriptu úložiště přeskočena');
  }

  ok(errs.length === 0, 'bez JS chyb ' + errs.join(' | '));
  const refused = [...new Set(prod.stats.refused)];
  console.log(`# místní proxy: ${prod.stats.tunnels} spojení na napodobeninu produkce, odmítnuto ${refused.length} jiných cílů${refused.length ? ' (' + refused.slice(0, 6).join(', ') + ')' : ''}`);
  await b.close();
})()
  .catch((e) => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (prod) { prod.server.close(); prod.plain.close(); prod.tunnel.close(); }
    for (const s of phps) { try { s.proc.kill(); } catch { /* */ } }
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });
