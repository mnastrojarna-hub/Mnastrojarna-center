// E2E: data importů (STEP…) v šifrovaném úložišti prohlížeče a v souborech .mncad této verze (data v mapě `blobs`).
//  1. šifrované úložiště zapnuté → import STEP → automatické uložení → obnovení stránky: dokument i záložky se postaví (✓, ne
//     „Data souboru … nejsou v paměti“); dokument zavřený do Nedávných souborů se z úvodní obrazovky otevře i s daty;
//  2. window.mncad.setDocument(.mncad s mapou blobs) v nové kartě: ✓ hned i po 6 s (selhaný import se nezapamatuje);
//  3. výkres → Další modely na listu → Vložit model ze souboru (.mncad této verze): pohled modelu na listu bez varování;
//  4. (je-li E2E_BIG_DIR/mn-big-10.step) import ~10 MB: data se uloží jednou, další automatická uložení jen odkazy (měří čas).
// Spuštění: E2E_BASE=http://localhost:3303 [E2E_BIG_DIR=…] node e2e/cad-import-persist.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = (process.argv[2] || '/tmp/e2e').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const FIX = path.join(__dirname, '..', 'src', 'lib', '__fixtures__', 'rounded-cube.step');
const BIG = process.env.E2E_BIG_DIR ? path.join(process.env.E2E_BIG_DIR, 'mn-big-10.step') : '';

const coreReady = (p) => p.waitForFunction(() => document.body.innerText.includes('OCCT') && !/Načítám jádro|Loading the OpenCascade kernel/.test(document.body.innerText), null, { timeout: 240000 });
const ready = async (p) => {
  await p.waitForFunction(() => !!window.mncad, null, { timeout: 240000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 5000 }).catch(() => false)) await c.click();
  await coreReady(p);
  await p.waitForTimeout(800);
};
const idle = (p) => p.waitForFunction(() => !window.mncad.progress(), null, { timeout: 240000 }).catch(() => {});
const status = (p) => p.evaluate(() => window.mncad.status());
const autosaves = (p) => p.evaluate(() => window.mncad.perf().filter((e) => e.stage === 'ui.autosave'));
/** čeká na automatické uložení po čase `from` (ladění 600 ms + šifrování) */
const waitAutosave = async (p, from, pred = () => true, limit = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const l = (await autosaves(p)).filter((e) => e.at >= from && pred(e));
    if (l.length) return l;
    await p.waitForTimeout(400);
  }
  return [];
};
/** šifrované úložiště zapnuté a odemčené v této kartě (stejný formát jako vault.ts; klíč v sessionStorage) */
const enableVault = (p) => p.evaluate(async () => {
  const b64 = (a) => btoa(String.fromCharCode(...new Uint8Array(a)));
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode('mnastrojarna-cad'));
  localStorage.setItem('mn-cad-vault-salt-v1', b64(crypto.getRandomValues(new Uint8Array(16))));
  localStorage.setItem('mn-cad-vault-check-v1', `v1.${b64(iv)}.${b64(ct)}`);
  localStorage.setItem('mn-cad-persist-v1', 'encrypted');
  sessionStorage.setItem('mn-cad-vault-key', b64(await crypto.subtle.exportKey('raw', k)));
});
const NOT_IN_MEMORY = /nejsou v paměti/;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // ── 1. šifrované úložiště: automatické uložení, obnova záložek, nedávné soubory ──
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
    await enableVault(p);
    await p.reload({ waitUntil: 'networkidle' });
    await ready(p);
    let t = Date.now();
    await p.locator('input[type=file]').first().setInputFiles(FIX);
    await p.waitForFunction(() => window.mncad.getDocument().features.length > 0, null, { timeout: 120000 });
    await idle(p);
    let st = await status(p);
    ok(/prvků 1 \(1 ✓, 0 ✗\)/.test(st), 'import rounded-cube.step: ✓');
    const first = await waitAutosave(p, t, (e) => e.info && e.info.written >= 1);
    ok(first.length > 0, `automatické uložení zapsalo data importu (${first.length ? JSON.stringify(first[0].info) + ', ' + first[0].ms + ' ms' : 'nic'})`);
    const stored = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mn-cad-doc')).map((k) => localStorage.getItem(k).length));
    ok(stored.length >= 1 && Math.max(...stored) < 4000, `dokument v localStorage drží jen odkaz (${stored.join(', ')} znaků)`);
    // druhá záložka – dokument s importem zůstane v nedávných souborech, obnoví se jako záložka
    t = Date.now();
    await p.evaluate(() => window.mncad.run('nový díl Druhý\nkvádr 20 20 20'));
    await idle(p);
    await waitAutosave(p, t);
    await p.reload({ waitUntil: 'networkidle' });
    await ready(p);
    await idle(p);
    ok(!(await p.getByText('Data importovaných souborů chybí').isVisible().catch(() => false)), 'po obnovení stránky žádné hlášení o chybějících datech');
    await p.getByTitle('Přepnout na: rounded-cube').click();
    await p.waitForTimeout(1500);
    await idle(p);
    st = await status(p);
    ok(/„rounded-cube“/.test(st) && /prvků 1 \(1 ✓, 0 ✗\)/.test(st) && !NOT_IN_MEMORY.test(st), `obnovená záložka s importem se postavila: ${st.split('\n')[0]}`);
    // nedávné soubory: záložku zavřít, obnovit stránku (data už nejsou v paměti), otevřít z úvodní obrazovky
    await p.getByRole('button', { name: 'Zavřít rounded-cube' }).click();
    t = Date.now();
    await p.evaluate(() => window.mncad.run('název Druhý díl'));
    await waitAutosave(p, t);
    await p.reload({ waitUntil: 'networkidle' });
    await ready(p);
    ok(!(await p.evaluate(() => window.mncad.getDocument().name)).includes('rounded'), 'po obnovení je otevřený jen druhý díl');
    await p.evaluate(() => window.mncad.run('nová sestava Prázdná')); // aktivní dokument nezaplněný importem
    await idle(p);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+K'); // paleta příkazů → Úvodní obrazovka (nedávné soubory)
    await p.getByPlaceholder(/Hledat příkaz/).fill('Úvodní obrazovka');
    await p.locator('button[data-i]', { hasText: 'Úvodní obrazovka' }).first().click();
    const rec = p.locator('li button', { hasText: 'rounded-cube' }).first();
    // isVisible nečeká – úvodní obrazovka se vykreslí až po chvíli (pod zátěží i několik sekund)
    const recOk = await rec.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    if (!recOk) await p.screenshot({ path: S + 'import-persist-recent.png' });
    ok(recOk, `rounded-cube je v nedávných souborech (${recOk ? '' : (await p.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, ' | ')})`);
    if (recOk) {
      await rec.click();
      await p.waitForTimeout(1500);
      await idle(p);
      st = await status(p);
      ok(/„rounded-cube“/.test(st) && /prvků 1 \(1 ✓, 0 ✗\)/.test(st), `otevřeno z nedávných souborů i s daty importu: ${st.split('\n')[0]}`);
    }
    // uložený .mncad (data v mapě blobs) pro další kroky
    const ex = await p.evaluate(() => window.mncad.exportFile('mncad'));
    const saved = Buffer.from(ex.base64, 'base64').toString('utf8');
    const sj = JSON.parse(saved);
    ok(!ex.warning && Object.keys(sj.blobs || {}).length === 1 && /^mnblob:/.test(sj.features[0].data), '.mncad této verze: odkaz v prvku + data v mapě blobs, bez varování');
    fs.writeFileSync(S + 'import-persist.mncad', saved);
    ok(!errs.length, `bez chyb stránky (${errs.slice(0, 2).join(' | ')})`);

    // ── 2. setDocument (.mncad s mapou blobs) v nové kartě bez dat v paměti ──
    const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
    await ready(p2);
    const log = await p2.evaluate((j) => window.mncad.setDocument(j), saved);
    ok(!log.split('\n').some((l) => l.startsWith('✗')) && /prvků 1 \(1 ✓, 0 ✗\)/.test(log), `setDocument: protokol bez ✗ (${log.split('\n').filter(Boolean).slice(-4)[0]})`);
    await p2.waitForTimeout(6000);
    await idle(p2);
    st = await status(p2);
    ok(/prvků 1 \(1 ✓, 0 ✗\)/.test(st) && !NOT_IN_MEMORY.test(st), 'setDocument: stav po 6 s ✓ (selhání se nezapamatovalo)');

    // ── 3. výkres: vložit model ze souboru .mncad této verze ──
    await p2.evaluate(() => window.mncad.run('nový díl Deska\nkvádr 80 40 10'));
    await idle(p2);
    await p2.evaluate(() => window.mncad.run('výkres'));
    await p2.waitForTimeout(4000);
    await idle(p2);
    const inp = p2.locator('input[data-model-file]');
    ok((await inp.count()) > 0, 'výkres: pole „Vložit model ze souboru (.mncad)“');
    await inp.first().setInputFiles(S + 'import-persist.mncad');
    await p2.waitForTimeout(3000);
    await idle(p2);
    await p2.waitForTimeout(2000);
    const ds = await p2.evaluate(() => window.mncad.drawingStatus());
    // stav výkresu uvádí vložený model jménem (dřív interním klíčem m:…)
    ok(/pohledy:[^\n]*(m:|rounded-cube)/.test(ds) && !/se nepodařilo načíst/.test(ds), `výkres: pohled vloženého modelu na listu bez varování (${(ds.match(/pohledy:[^\n]*/) || [''])[0]})`);
    await p2.screenshot({ path: S + 'import-persist-drawing.png' });
    const d2 = await p2.evaluate(() => window.mncad.getDocument());
    const m = (d2.drawings || []).flatMap((x) => (x.options && x.options.models) || [])[0];
    ok(m && !m.source.doc.blobs && /^mnblob:/.test(m.source.doc.features[0].data), 'vložený model drží odkaz (data v úložišti), ne mapu blobs');
    const ex2 = await p2.evaluate(() => window.mncad.exportFile('mncad'));
    const sj2 = JSON.parse(Buffer.from(ex2.base64, 'base64').toString('utf8'));
    ok(Object.keys(sj2.blobs || {}).length === 1, 'uložení dokumentu s výkresem: data vloženého modelu jsou v souboru (mapa blobs)');
    await ctx2.close();

    // ── 4. ~10 MB import: data jednou, další automatická uložení jen odkazy ──
    if (BIG && fs.existsSync(BIG)) {
      const ctx3 = await b.newContext({ viewport: { width: 1400, height: 900 } });
      const p3 = await ctx3.newPage();
      await p3.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
      await enableVault(p3);
      await p3.reload({ waitUntil: 'networkidle' });
      await ready(p3);
      t = Date.now();
      await p3.locator('input[type=file]').first().setInputFiles(BIG);
      const w = await waitAutosave(p3, t, (e) => e.info && e.info.written >= 1, 240000);
      const mb = w.reduce((s, e) => s + (e.info.mb || 0), 0);
      ok(w.length > 0 && mb > 5, `10 MB: první automatické uložení zapsalo data importu jednou (${w.map((e) => `${e.info.written} souborů, ${e.info.mb} MB, ${e.ms} ms`).join('; ')})`);
      await idle(p3);
      const t2 = Date.now();
      for (let i = 1; i <= 4; i++) {
        await p3.evaluate((n) => window.mncad.run(`název Stroj ${n}`), i);
        await p3.waitForTimeout(1200);
      }
      await p3.waitForTimeout(1500);
      const later = (await autosaves(p3)).filter((e) => e.at >= t2);
      const maxMs = Math.max(...later.map((e) => e.ms));
      ok(later.length >= 2 && later.every((e) => e.info.written === 0) && maxMs < 50, `10 MB: další automatická uložení bez dat (${later.length}×, zapsáno ${later.map((e) => e.info.written).join('/')}, nejdéle ${maxMs} ms, dokument ${later[0] ? later[0].info.kb : '?'} kB)`);
      await p3.reload({ waitUntil: 'networkidle' });
      await ready(p3);
      const tr0 = Date.now();
      // všechny díly načtené = sestava zná objem Σ (díl bez dat by objem neměl)
      while (Date.now() - tr0 < 240000) {
        st = await status(p3);
        if (/objem Σ/.test(st) || NOT_IN_MEMORY.test(st)) break;
        await p3.waitForTimeout(2000);
      }
      const lostMsg = await p3.getByText('Data importovaných souborů chybí').isVisible().catch(() => false);
      ok(/objem Σ/.test(st) && !NOT_IN_MEMORY.test(st) && !lostMsg, `10 MB: po obnovení stránky jsou data všech dílů k dispozici (${(st.match(/Sestava: [^\n]*/) || [st.split('\n')[0]])[0]}, ${((Date.now() - tr0) / 1000).toFixed(0)} s)`);
      await ctx3.close();
    } else console.log('   (10 MB část vynechána – E2E_BIG_DIR/mn-big-10.step neexistuje)');
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.log('FAIL: ' + e.message);
  process.exitCode = 1;
});
