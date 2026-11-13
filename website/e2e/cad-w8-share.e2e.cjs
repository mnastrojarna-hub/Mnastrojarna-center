// E2E: krátký sdílený odkaz přes vlastní úložiště na webu (/cad/share/, PHP).
// Vedle Next serveru běží skutečné PHP (`php -S` se skriptem public/cad/share/index.php); požadavky prohlížeče na /cad/share/
// se přesměrují na něj (page.route → fetch, jako reverzní proxy). Ověří: odkaz na jeden řádek < 120 znaků (#q=<id>.<klíč>),
// otevření v jiném prohlížeči se stejným modelem (objem), heslo (odkaz stejně krátký), smazání nepoužitého odkazu při změně
// voleb, zneplatnění, vypršení, velký model (importovaný STEP, nahrání po částech), nad limit = srozumitelná chyba,
// bez úložiště = dlouhý odkaz s vysvětlením, window.mncad.share() → mode "self", mobil.
// Spuštění: E2E_BASE=http://localhost:3341 node e2e/cad-w8-share.e2e.cjs <složka pro snímky>
//   (výchozí server http://localhost:3341; potřebuje příkaz php ≥ 7.4)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3341').replace(/\/$/, '');
const CAD = BASE + '/cad';
const SCRIPT = path.join(__dirname, '..', 'public', 'cad', 'share', 'index.php');
const GEN = path.join(__dirname, '..', 'scripts', 'gen-big-step.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const phps = [];
async function startPhp(env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-share-e2e-'));
  const docroot = path.join(root, 'www');
  fs.mkdirSync(path.join(docroot, 'cad', 'share'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(docroot, 'cad', 'share', 'index.php'));
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, ...env }, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/cad/share/?ping')).ok) break; } catch { /* start */ } await sleep(50); }
  const srv = { origin, root, data: path.join(root, 'cad-share-data'), proc };
  phps.push(srv);
  return srv;
}
const isShare = (url) => new URL(url).pathname.startsWith('/cad/share/');
/** požadavky prohlížeče na /cad/share/ → PHP server (Origin přepíše na adresu PHP, jako reverzní proxy se stejným Host) */
const forward = (php) => async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const headers = { ...req.headers() };
  for (const h of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[h];
  if (headers.origin) headers.origin = php.origin;
  try {
    const res = await fetch(php.origin + u.pathname + u.search, { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() || undefined });
    const out = {};
    res.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
    await route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
  } catch (e) {
    await route.abort('failed').catch(() => {});
  }
};
const blobsOn = (php) => (fs.existsSync(php.data) ? fs.readdirSync(php.data).filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4)) : []);
const idOf = (url) => /#q=([0-9A-Za-z]+)\./.exec(url)?.[1];

function bigStep(mb) {
  const file = path.join(process.env.E2E_BIG_DIR || os.tmpdir(), `mn-big-${mb}.step`);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) execFileSync(process.execPath, [GEN, '--mb', String(mb), '--out', file], { stdio: 'ignore', timeout: 600000 });
  return file;
}

const coreReady = (page) => page.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro/.test(document.body.innerText), null, { timeout: 240000 });
/** jádro načtené a úvodní obrazovka zavřená (na pomalém stroji se může ukázat až po jádře) */
const ready = async (page) => {
  const c = page.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await coreReady(page);
  await page.waitForTimeout(800);
  if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click().catch(() => page.keyboard.press('Escape'));
};
const dlgOf = (page) => page.locator('div.fixed.z-\\[70\\]');
/** hotový odkaz v dialogu (input nebo textarea s aria-label „Sdílený odkaz“) */
const linkValue = async (page, notEqual) => {
  await page.waitForFunction((prev) => {
    const t = document.querySelector('[aria-label="Sdílený odkaz"]');
    return !!t && t.value.startsWith('http') && t.value !== prev;
  }, notEqual ?? null, { timeout: 120000 });
  return page.locator('[aria-label="Sdílený odkaz"]').inputValue();
};
const volumeOf = async (page) => {
  const st = await page.evaluate(() => window.mncad.status());
  return /objem (?:Σ )?([\d\s ,.]+) cm³/.exec(st)?.[1]?.trim() ?? null;
};
const loadFlange = async (page) => {
  await page.getByRole('button', { name: 'Soubor', exact: true }).click();
  await page.getByRole('button', { name: /Příruba DN50/ }).click();
  await page.waitForTimeout(3500);
};
const openShare = async (page) => {
  await page.getByRole('button', { name: 'Sdílet odkazem', exact: true }).first().click();
  return dlgOf(page);
};
const closeDlg = async (page) => { await dlgOf(page).getByRole('button', { name: 'Zavřít', exact: true }).last().click(); await page.waitForTimeout(300); };
/** hlášení „Sdílený odkaz nelze otevřít“ (čeká na stažení a vyhodnocení obsahu) */
const notice = async (page) => {
  await page.waitForFunction(() => /nelze otevřít/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  return page.locator('body').innerText();
};

let browser = null;
(async () => {
  const php = await startPhp({ MN_SHARE_CHUNK: '262144', MN_SHARE_RATE: '1000' });
  const phpSmall = await startPhp({ MN_SHARE_MAX_BYTES: '200000' });
  ok((await (await fetch(php.origin + '/cad/share/?ping')).json()).ok === true, `PHP úložiště běží (${php.origin}, data ${php.data})`);

  const b = (browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }));
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.route(isShare, forward(php));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await ready(p);

  // ── odesílatel: krátký odkaz z GUI ──
  await loadFlange(p);
  const vol = await volumeOf(p);
  ok(!!vol, `odesílatel: objem příruby ${vol} cm³`);
  let dlg = await openShare(p);
  const url1 = await linkValue(p);
  const field = p.locator('[aria-label="Sdílený odkaz"]');
  ok(/#q=[0-9A-Za-z]{10}\.[A-Za-z0-9_-]{22}$/.test(url1) && url1.startsWith(CAD + '#q='), `krátký odkaz: ${url1}`);
  ok(url1.length < 120 && !/\s/.test(url1), `odkaz na jeden řádek, ${url1.length} znaků (< 120)`);
  ok((await field.getAttribute('data-share-short')) === '1' && (await field.getAttribute('data-share-mode')) === 'self', 'dialog: krátký odkaz na výrazném jednořádkovém poli, režim self');
  const fits = await field.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1);
  ok(fits, 'odkaz je v poli vidět celý');
  const t1 = await dlg.innerText();
  ok(new RegExp(`${url1.length} znaků`).test(t1) && /zašifrováno v úložišti do/.test(t1) && /Platí do/.test(t1), 'dialog ukazuje délku odkazu, šifrování a platnost');
  ok(blobsOn(php).includes(idOf(url1)), 'na serveru je šifrovaný obsah s id z odkazu');
  const raw = fs.readFileSync(path.join(php.data, idOf(url1) + '.bin'));
  ok(raw.subarray(0, 3).toString() === 'MNQ' && !raw.includes(Buffer.from('Příruba')) && !raw.includes(Buffer.from('mnastrojarna-cad')), 'na serveru jen šifrovaná data (žádný název ani JSON)');
  await p.screenshot({ path: S + 'w8-share-dialog.png' });

  // změna platnosti bez zkopírování → nový odkaz, starý (nepoužitý) se ze serveru smaže
  await dlg.getByRole('button', { name: '1 den', exact: true }).click();
  const url2 = await linkValue(p, url1);
  await p.waitForTimeout(1500);
  ok(url2 !== url1 && blobsOn(php).includes(idOf(url2)) && !blobsOn(php).includes(idOf(url1)), 'změna voleb: nový odkaz, nepoužitý starý obsah smazán ze serveru');
  await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await p.waitForTimeout(500);
  ok((await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === url2, 'Kopírovat odkaz → krátký odkaz ve schránce');
  await dlg.getByRole('button', { name: 'Kopírovat zprávu' }).click(); await p.waitForTimeout(500);
  const msg = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(msg.includes(url2) && msg.includes('Příruba DN50') && msg.split('\n').includes(url2), 'zpráva (WhatsApp / e-mail / Teams) nese krátký odkaz na vlastním řádku');
  ok(await dlg.getByRole('button', { name: 'WhatsApp' }).isEnabled() && await dlg.getByRole('button', { name: 'E-mail' }).isEnabled(), 'tlačítka WhatsApp a E-mail aktivní');
  // heslo
  await dlg.getByLabel('Heslo k odkazu').fill('tajne');
  const urlPw = await linkValue(p, url2);
  ok(/#q=/.test(urlPw) && urlPw.length === url2.length, `odkaz s heslem stejně krátký (${urlPw.length} znaků)`);
  ok(/chráněno heslem/.test(await dlg.innerText()), 'dialog: chráněno heslem');
  await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await p.waitForTimeout(400);
  await closeDlg(p);
  ok(blobsOn(php).includes(idOf(url2)) && blobsOn(php).includes(idOf(urlPw)), 'zkopírované odkazy zůstávají na serveru');

  // ── příjemce: jiný prohlížeč ──
  const ctx2 = await b.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx2.route(isShare, forward(php));
  const r = await ctx2.newPage();
  const errs2 = []; r.on('pageerror', (e) => errs2.push(e.message));
  await r.goto(url2, { waitUntil: 'networkidle', timeout: 240000 });
  ok(!r.url().includes('#'), 'část za # je z adresy hned odstraněna');
  await coreReady(r); await r.waitForTimeout(4000);
  ok(/Sdílený dokument/.test(await r.locator('[role=status]').first().innerText().catch(() => '')), 'příjemce vidí pruh „Sdílený dokument“');
  ok(/Díra 1/.test(await r.locator('aside').first().innerText()), 'příjemce má díl s historií prvků');
  const vol2 = await volumeOf(r);
  ok(vol2 === vol, `příjemce: stejný model (objem ${vol2} = ${vol} cm³)`);
  await r.screenshot({ path: S + 'w8-share-recipient.png' });
  await r.reload({ waitUntil: 'networkidle' }); await coreReady(r); await r.waitForTimeout(3500);
  ok(/Díra 1/.test(await r.locator('aside').first().innerText()), 'po F5 sdílený díl zůstává');
  await r.close();

  // heslo
  const r2 = await ctx2.newPage();
  await r2.goto(urlPw, { waitUntil: 'networkidle', timeout: 240000 });
  const pw = r2.getByLabel('Heslo sdíleného dokumentu');
  ok(await pw.waitFor({ timeout: 60000 }).then(() => true, () => false), 'odkaz s heslem: dotaz na heslo (heslo není v odkazu, pozná se z obsahu)');
  await pw.fill('spatne'); await r2.getByRole('button', { name: 'Otevřít', exact: true }).click(); await r2.waitForTimeout(2500);
  ok(/Nesprávné heslo/.test(await dlgOf(r2).innerText()), 'špatné heslo odmítnuto');
  await pw.fill('tajne'); await pw.press('Enter');
  await coreReady(r2); await r2.waitForTimeout(4000);
  ok(/Díra 1/.test(await r2.locator('aside').first().innerText()) && (await volumeOf(r2)) === vol, 'správné heslo otevře stejný díl');
  await r2.close();

  // ── zneplatnění ──
  dlg = await openShare(p);
  const url3 = await linkValue(p);
  await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await p.waitForTimeout(300);
  await dlg.getByRole('button', { name: 'Zneplatnit odkaz' }).click(); await p.waitForTimeout(1500);
  ok(!blobsOn(php).includes(idOf(url3)) && /zneplatněn/.test(await field.inputValue()), 'Zneplatnit odkaz → obsah smazán ze serveru, dialog to ukazuje');
  ok(await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).isDisabled({ timeout: 5000 }).catch(() => false), 'zneplatněný odkaz nejde kopírovat');
  await closeDlg(p);
  const r3 = await ctx2.newPage();
  await r3.goto(url3, { waitUntil: 'networkidle', timeout: 240000 });
  ok(/nelze otevřít/.test(await notice(r3)) && /už v úložišti není/.test(await r3.locator('body').innerText()), 'zneplatněný odkaz: srozumitelné hlášení');
  await r3.close();

  // ── API pro agenty + vypršení ──
  const api = await p.evaluate(() => window.mncad.share({ days: 1 }));
  ok(api.mode === 'self' && api.chars === api.url.length && api.url.length < 120 && /#q=/.test(api.url) && api.message.includes(api.url), `window.mncad.share() → mode "self", ${api.chars} znaků`);
  const meta = path.join(php.data, idOf(api.url) + '.json');
  fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), exp: Math.floor(Date.now() / 1000) - 60 }));
  const r4 = await ctx2.newPage();
  await r4.goto(api.url, { waitUntil: 'networkidle', timeout: 240000 });
  const t4 = await notice(r4);
  ok(/Platnost sdíleného odkazu vypršela/.test(t4), 'vypršelý odkaz (server 410): hlášení o vypršení');
  if (!/vypršela/.test(t4)) { await r4.screenshot({ path: S + 'w8-share-expired-fail.png' }); console.log(t4.slice(0, 600)); }
  ok(!fs.existsSync(meta), 'vypršelý obsah server smazal');
  await r4.close();

  // ── velký model: importovaný STEP (mnblob), nahrání po částech ──
  const stepFile = bigStep(3);
  const b64 = fs.readFileSync(stepFile).toString('base64');
  const imp = await p.evaluate(async (base64) => { try { return await window.mncad.importFile({ name: 'deska-velka.step', base64 }, { as: 'tab' }); } catch (e) { return 'ERR ' + e.message; } }, b64);
  ok(!/^ERR/.test(imp), `import STEP ${(fs.statSync(stepFile).size / 1048576).toFixed(1)} MB do záložky`);
  await p.waitForTimeout(2000);
  const posts = [];
  const onReq = (q) => { if (isShare(q.url()) && q.method() === 'POST') posts.push((q.postDataBuffer() || Buffer.alloc(0)).length); };
  p.on('request', onReq);
  dlg = await openShare(p);
  const urlBig = await linkValue(p);
  p.off('request', onReq);
  ok(/#q=/.test(urlBig) && urlBig.length < 120, `velký model: krátký odkaz (${urlBig.length} znaků)`);
  const bigBytes = fs.statSync(path.join(php.data, idOf(urlBig) + '.bin')).size;
  ok(posts.length >= 2 && posts.every((n) => n <= 262144), `nahráno po částech: ${posts.length} × ≤ 256 kB, celkem ${(bigBytes / 1048576).toFixed(2)} MB (STEP ${(fs.statSync(stepFile).size / 1048576).toFixed(1)} MB)`);
  await dlg.getByRole('button', { name: 'Kopírovat odkaz' }).click(); await p.waitForTimeout(300);
  await closeDlg(p);
  const refsOf = (page) => page.evaluate(() => [...new Set((JSON.stringify(window.mncad.getDocument()).match(/mnblob:[0-9a-z]+/g) || []))].sort().join(','));
  const senderRefs = await refsOf(p);
  const senderAsm = /Sestava: [^\n]*/.exec(await p.evaluate(() => window.mncad.status()))?.[0] ?? '';
  const r5 = await ctx2.newPage();
  await r5.goto(urlBig, { waitUntil: 'networkidle', timeout: 240000 });
  await coreReady(r5); await r5.waitForTimeout(8000);
  const recvRefs = await refsOf(r5);
  ok(!!senderRefs && recvRefs === senderRefs, `příjemce: stejná data importu (${senderRefs.split(',').length} souborů, otisky shodné)`);
  // sestava se u příjemce dopočítává (objem Σ až po stavbě všech komponent) – počkat na stejný řádek, max. 3 min
  let recvAsm = '';
  for (let i = 0; i < 60; i++) {
    recvAsm = /Sestava: [^\n]*/.exec(await r5.evaluate(() => window.mncad.status()))?.[0] ?? '';
    if (recvAsm === senderAsm) break;
    await r5.waitForTimeout(3000);
  }
  ok(!!senderAsm && recvAsm === senderAsm, `příjemce: stejná sestava (${recvAsm.slice(0, 90)})`);
  ok(!/Data importovaných souborů chybí/.test(await r5.locator('body').innerText()), 'příjemci nechybí data importu');
  await r5.screenshot({ path: S + 'w8-share-big.png' });
  await r5.close();
  await ctx2.close(); // paměť: další kroky běží v nových stránkách
  await p.close();

  // ── nad limit úložiště: srozumitelná chyba ──
  await ctx.unroute(isShare);
  await ctx.route(isShare, forward(phpSmall));
  const pSmall = await ctx.newPage();
  await pSmall.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await ready(pSmall);
  await pSmall.evaluate(async (base64) => { try { await window.mncad.importFile({ name: 'deska-velka.step', base64 }, { as: 'tab' }); } catch { /* */ } }, b64);
  await pSmall.waitForTimeout(2000);
  const dlgS = await openShare(pSmall);
  await pSmall.waitForFunction(() => /příliš velký/.test(document.querySelector('div.fixed.z-\\[70\\]')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
  const tS = await dlgS.innerText();
  ok(/příliš velký/.test(tS) && /limit úložiště je 0,2 MB/.test(tS), 'nad limit úložiště: hlášení s velikostí a limitem');
  ok(await dlgS.getByRole('button', { name: 'Kopírovat odkaz' }).isDisabled(), 'nad limit: nic ke kopírování');
  ok(blobsOn(phpSmall).length === 0, 'nad limit: na server se nic nenahrálo');
  await pSmall.screenshot({ path: S + 'w8-share-too-big.png' });
  await pSmall.close();

  // ── bez úložiště (statický hosting bez PHP) → dlouhý odkaz s vysvětlením ──
  const ctx3 = await b.newContext({ viewport: { width: 1400, height: 850 } });
  const n = await ctx3.newPage();
  await n.goto(CAD, { waitUntil: 'networkidle', timeout: 240000 }); await ready(n);
  await loadFlange(n);
  const dlgN = await openShare(n);
  const urlN = await linkValue(n);
  ok(urlN.startsWith(CAD + '#s=1d.') && (await n.locator('[aria-label="Sdílený odkaz"]').getAttribute('data-share-mode')) === 'link', `bez úložiště: dokument v odkazu (${urlN.length} znaků)`);
  ok(/neodpovídá/.test(await dlgN.locator('[data-share-note]').innerText().catch(() => '')), 'dialog vysvětluje, proč je odkaz dlouhý');
  await dlgN.getByRole('button', { name: 'bez omezení', exact: true }).click();
  await n.waitForTimeout(1500);
  await ctx3.close();

  // ── mobil: krátký odkaz se vejde ──
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await ctx.unroute(isShare); await ctx.route(isShare, forward(php));
  await m.goto(url2, { waitUntil: 'networkidle', timeout: 240000 });
  await m.locator('[role=status]').first().waitFor({ timeout: 180000 }); await m.waitForTimeout(3000);
  await m.getByRole('button', { name: 'Sdílet odkazem', exact: true }).first().click();
  const urlM = await linkValue(m);
  const over = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const fitsM = await m.locator('[aria-label="Sdílený odkaz"]').evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1);
  ok(/#q=/.test(urlM) && !over && fitsM, 'mobil: krátký odkaz celý vidět (zalomený), dialog nepřetéká');
  await m.screenshot({ path: S + 'w8-share-mobile.png' });

  ok(errs.length === 0 && errs2.length === 0, 'bez JS chyb ' + [...errs, ...errs2].join(' | '));
  await b.close();
})()
  .catch((e) => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const s of phps) { try { s.proc.kill(); } catch { /* */ } fs.rmSync(s.root, { recursive: true, force: true }); }
  });
