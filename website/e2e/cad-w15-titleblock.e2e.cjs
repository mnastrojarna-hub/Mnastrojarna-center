// E2E – razítko výkresu (w15, zpráva 959 kap. 5.4) přes TEXTOVOU KONZOLI (bez window.mncad) a v GUI:
//  - konzole: Připojit soubor… (logo), výkres razítko pole=… (cs / en / de), šablona nástrojářská / kompaktní, logo,
//    výkres nepředepsané desetinná / ISO 2768, výkres razítko (stav), export SVG / DXF / PDF / DWG z konzole;
//    ⚠ při exportu dílu bez nepředepsaných tolerancí; dlouhý „Kreslil“ celý (dřív „Claude dle Vojtě“); značka promítání
//    místo textu „ISO E“;
//  - GUI: panel Razítko ve výkresovém prostředí (šablona, pole, nahrání loga, ISO 2768 třída), náhled listu s logem,
//    Nastavení → Výkres → šablona nových listů;
//  - nálezy kontroly: prokládané PNG z konzole, nejednoznačný název souboru, revize z tabulky revizí, materiál ve stavu
//    razítka, tabulka „X. ±0,1 · X.X …“, režim tolerancí v panelu po přepnutí listu, Chytré kóty mimo vysoké razítko.
// Spuštění: E2E_BASE=http://localhost:3424 node e2e/cad-w15-titleblock.e2e.cjs <složka>
const { chromium } = require('playwright');
const fs = require('fs');
const zlib = require('zlib');
const S = (process.argv[2] || '/tmp/e2e-w15-titleblock').replace(/\/?$/, '/');
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) { fails++; process.exitCode = 1; } };
const BASE = (process.env.E2E_BASE || 'http://localhost:3100').replace(/\/$/, '');
const first = (log, re) => (re.exec(log) || [])[0] || '';

/** PNG RGBA (filtr 0) – logo pro test */
function png(w, h, paint) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = paint(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** PNG RGBA s prokládáním Adam7 (logo uložené „interlaced“, jako convert -interlace PNG) */
function pngAdam7(w, h, paint) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;
  const raw = [];
  for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
    const pw = Math.ceil((w - x0) / dx); const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    for (let y = 0; y < ph; y++) { raw.push(0); for (let x = 0; x < pw; x++) raw.push(...paint(x0 + x * dx, y0 + y * dy)); }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}
const LOGO = png(120, 40, (x, y) => (x >= 10 && x < 110 && y >= 8 && y < 32 ? [224, 57, 48, 255] : [255, 255, 255, 0]));
const LOGO2 = png(80, 80, (x, y) => ((x - 40) ** 2 + (y - 40) ** 2 < 900 ? [20, 20, 20, 255] : [255, 255, 255, 255]));
const INTER = pngAdam7(241, 83, (x, y) => (x > 20 && x < 220 && y > 15 && y < 65 ? [224, 57, 48, 255] : [255, 255, 255, 255]));

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  const dl = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  p.on('download', (d) => dl.push(d));
  const nextDownload = async (n, ms = 180000) => {
    const t0 = Date.now();
    while (dl.length < n && Date.now() - t0 < ms) await p.waitForTimeout(200);
    const d = dl[n - 1];
    if (!d) return null;
    const path = S + d.suggestedFilename();
    await d.saveAs(path);
    return { name: d.suggestedFilename(), path, data: fs.readFileSync(path) };
  };
  await p.goto(BASE + '/cad', { waitUntil: 'networkidle', timeout: 300000 });
  const c = p.getByText('Pokračovat v práci');
  if (await c.isVisible({ timeout: 6000 }).catch(() => false)) await c.click();
  await p.waitForFunction(() => !document.body.innerText.includes('Načítám jádro') && !document.body.innerText.includes('Načítám CAD jádro') && document.body.innerText.includes('OCCT'), null, { timeout: 300000 });
  await p.waitForTimeout(1000);

  // ── konzole (Ctrl+Shift+K) ──
  const openConsole = async () => {
    const input = p.getByLabel('Textové příkazy nebo JSON');
    if (!(await input.isVisible({ timeout: 1500 }).catch(() => false))) {
      // zkratky se v textovém poli neberou (psaní) – nejdřív opustit pole jako uživatel
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await p.keyboard.press('Control+Shift+K');
    }
    await input.waitFor({ timeout: 20000 });
    return input;
  };
  const out = p.locator('[data-agent-output]');
  const run = async (text, ms = 300000) => {
    const input = await openConsole();
    const before = await out.innerText().catch(() => '');
    await input.fill(text);
    await p.getByRole('button', { name: 'Provést', exact: true }).click();
    await p.waitForFunction((prev) => { const o = document.querySelector('[data-agent-output]'); const busy = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Provádím…'); return !busy && !!o && o.textContent !== prev; }, before, { timeout: ms });
    return out.innerText();
  };
  // zavření konzole tlačítkem „Zavřít“ v jejím okně (Escape by mohl zavřít i výkresové prostředí pod ní)
  const closeConsole = async () => {
    if (!(await p.locator('#agent-input').isVisible().catch(() => false))) return;
    await p.evaluate(() => {
      let el = document.getElementById('agent-input');
      while (el && !(el.classList && el.classList.contains('fixed'))) el = el.parentElement;
      const btn = el && [...el.querySelectorAll('button')].reverse().find((x) => x.textContent.trim() === 'Zavřít' || x.getAttribute('aria-label') === 'Zavřít');
      if (btn) btn.click();
    });
    await p.locator('#agent-input').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(300);
  };

  // 1. díl a výkres
  let log = await run('nový díl Deska 959\nkvádr 120 80 20 střed\ndíra 20 skrz v 0 0 20\nvýkres A3\nkótovat');
  fs.writeFileSync(S + 'log1.txt', log);
  ok(!/^✗/m.test(log), 'díl + výkres A3 + kótovat bez ✗' + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));

  // 2. logo jako připojený soubor (konzole → Připojit soubor…)
  await openConsole();
  await p.locator('[data-agent-attach-input]').setInputFiles({ name: 'firma.png', mimeType: 'image/png', buffer: LOGO });
  await p.waitForSelector('[data-attached="firma.png"]', { timeout: 10000 }).catch(() => {});
  ok(await p.locator('[data-attached="firma.png"]').isVisible().catch(() => false), 'konzole: Připojit soubor… → firma.png v seznamu připojených');

  // 3. razítko: šablona nástrojářská, logo, všechna pole (dlouhý Kreslil)
  log = await run([
    'výkres razítko šablona=nástrojářská logo="firma.png" firma="Mnástrojárna s.r.o." kreslil="Claude dle Vojtěchova zadání" kontroloval="Ing. Kontrolor" schválil="Ing. Schvalovatel" zákazník="ACME a.s." projekt="100 NASTROJ-A" polotovar="plech 40×160×185" počet=4 tepelné="kalit 58–60 HRC" povrch="černit" úhly="±0°30′" sražení="±0,2"',
    'výkres razítko',
  ].join('\n'));
  fs.writeFileSync(S + 'log3.txt', log);
  ok(!/^✗/m.test(log), 'výkres razítko s novými poli bez ✗' + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));
  ok(/→ razítko: šablona nástrojářská \(všechna pole\) \(180×64 mm\), logo „firma\.png“ 120×40 px, obrys pro DXF\/DWG \d+ ploch, firma „Mnástrojárna s\.r\.o\.“, kreslil „Claude dle Vojtěchova zadání“, kontroloval „Ing\. Kontrolor“/.test(log), '✓ razítko: šablona, logo z připojeného souboru, firma, kreslil, kontroloval');
  ok(/Šablona razítka: nástrojářská \(všechna pole\) 180×64 mm · promítání ISO E – značka ISO 5456-2 \(1\. kvadrant, kružnice vpravo\) · logo „firma\.png“ 120×40 px/.test(log), 'stav: šablona, promítání značkou, logo');
  ok(/Další pole razítka: firma „Mnástrojárna s\.r\.o\.“ · zákazník „ACME a\.s\.“ · projekt „100 NASTROJ-A“ · kontroloval „Ing\. Kontrolor“ · schválil „Ing\. Schvalovatel“ · polotovar „plech 40×160×185“ · počet kusů „4“ · tepelné zpracování „kalit 58–60 HRC“ · povrchová úprava „černit“ · tolerance úhlů „±0°30′“ · tolerance sražení „±0,2“/.test(log), 'stav: všechna další pole razítka');
  ok(/Nepředepsané tolerance: nezadané – export výkresu dílu je ohlásí/.test(log), 'stav: nepředepsané tolerance nezadané');
  ok(/Razítko bez zkracování textu: /.test(log), 'stav: řádek „Razítko bez zkracování textu“ – ' + first(log, /Razítko bez zkracování textu: .*$/m));

  // 4. export SVG bez nepředepsaných tolerancí → ⚠ v protokolu; soubor: logo jako obrázek, pole celá, žádný text „ISO E“
  log = await run('výkres export svg');
  fs.writeFileSync(S + 'log4.txt', log);
  ok(/⚠ Výkres nemá nepředepsané tolerance – zadejte je: výkres nepředepsané ISO 2768-mK/.test(log), 'export dílu bez nepředepsaných tolerancí → ⚠ v protokolu');
  const fsvg = await nextDownload(1);
  const svg = fsvg ? fsvg.data.toString('utf8') : '';
  ok(/<image [^>]*href="data:image\/png;base64,/.test(svg), 'SVG: logo jako <image> (data URL PNG)');
  ok(['Ing. Kontrolor', 'Ing. Schvalovatel', 'ACME a.s.', '100 NASTROJ-A', 'plech 40×160×185', '4 ks', 'kalit 58–60 HRC', 'černit', '±0°30′', '±0,2', 'Polotovar', 'Kontroloval', 'Schválil'].every((s) => svg.includes(s)), 'SVG: všechna pole nástrojářské šablony');
  ok(/>Claude dle Vojtěchova zadání<|>Claude dle<[\s\S]*>Vojtěchova zadání<|>Claude dle Vojtěchova<[\s\S]*>zadání</.test(svg) && !/>Claude dle Vojtě</.test(svg), 'SVG: „Kreslil“ celý (zmenšený / zalomený), ne „Claude dle Vojtě“');
  ok(!/>ISO [EA]</.test(svg), 'SVG: promítání značkou ISO 5456-2, ne textem „ISO E“');

  // 5. nepředepsané tolerance tabulkou podle desetinných míst → export DXF bez ⚠ tolerancí; logo jako SOLID
  log = await run('výkres nepředepsané desetinná ±0,1 ±0,1 ±0,01 ±0,005\nvýkres export dxf');
  fs.writeFileSync(S + 'log5.txt', log);
  ok(/→ nepředepsané tolerance X\. ±0,1 \/ X\.X ±0,1 \/ X\.XX ±0,01 \/ X\.XXX ±0,005/.test(log), 'výkres nepředepsané desetinná → tabulka X. / X.X / X.XX / X.XXX');
  ok(!/nemá nepředepsané tolerance/.test(log), 'export s nepředepsanými tolerancemi bez ⚠');
  const fdxf = await nextDownload(2);
  const dxf = fdxf ? fdxf.data.toString('latin1') : '';
  const L = dxf.split('\n');
  let solids = 0;
  for (let i = 0; i + 1 < L.length; i += 2) if (L[i].trim() === '0' && L[i + 1].trim() === 'SOLID') { let j = i + 2; let col = ''; while (j + 1 < L.length && L[j].trim() !== '0') { if (L[j].trim() === '62') col = L[j + 1].trim(); j += 2; } if (col === '1') solids++; }
  ok(solids > 0, `DXF: logo jako plošky SOLID v červené ACI 1 (${solids})`);
  ok(dxf.includes('X.XXX \\U+00B10,005') && dxf.includes('Ing. Kontrolor'), 'DXF: tabulka nepředepsaných tolerancí a pole razítka');

  // 6. PDF a DWG z konzole
  log = await run('výkres export pdf\nvýkres export dwg');
  fs.writeFileSync(S + 'log6.txt', log);
  const fpdf = await nextDownload(3);
  const fdwg = await nextDownload(4);
  ok(!!fpdf && fpdf.data.subarray(0, 5).toString() === '%PDF-' && /\/Subtype \/Image/.test(fpdf.data.toString('latin1')), 'PDF: logo jako obrázek (/Subtype /Image)');
  ok(!!fdwg && /^AC10\d\d/.test(fdwg.data.subarray(0, 6).toString('latin1')) && fdwg.data.length > 10000, `DWG: ${fdwg && fdwg.name} ${fdwg && fdwg.data.length} B`);

  // 7. anglicky a německy; ISO 2768 třída; kompaktní šablona: pole mimo šablonu v patičce
  log = await run('drawing titleblock template=compact checked="EN check"\nzeichnung schriftfeld genehmigt="DE Freigabe" kunde="Kunde GmbH"\ndrawing general f H\nvýkres razítko');
  fs.writeFileSync(S + 'log7.txt', log);
  ok(/→ razítko: šablona kompaktní \(180×27 mm\), kontroloval „EN check“/.test(log) && /→ razítko: schválil „DE Freigabe“, zákazník „Kunde GmbH“/.test(log), 'EN / DE klíče razítka');
  ok(/→ nepředepsané tolerance ISO 2768-fH/.test(log) && /Nepředepsané tolerance: ISO 2768-fH \(délky, úhly a sražení třída f – jemná, geometrie H\)/.test(log), 'drawing general f H → ISO 2768-fH');
  ok(/zákazník „Kunde GmbH“ \(v patičce\)/.test(log), 'kompaktní šablona: zákazník v patičce');
  ok(/✗.*šablona razítka „obří“ neexistuje/.test(await run('výkres razítko šablona=obří')), 'neznámá šablona → ✗ s nabídkou šablon');
  ok(/✗.*logo „chybi\.png“: soubor není připojený.*připojené: firma\.png/.test(await run('výkres razítko logo="chybi.png"')), 'nepřipojený soubor loga → ✗ s nápovědou a seznamem připojených');

  // 7b. nálezy kontroly: prokládané PNG v konzoli, nejednoznačný název souboru, revize z tabulky, materiál ve stavu,
  //     tabulka desetinných míst v zápisu „X. ±0,1 · …“ (pak zpět ISO 2768-fH pro GUI)
  await openConsole();
  for (const [name, mime, buf] of [['inter.png', 'image/png', INTER], ['logo.png', 'image/png', LOGO], ['logo.jpg', 'image/jpeg', LOGO]]) {
    await p.locator('[data-agent-attach-input]').setInputFiles({ name, mimeType: mime, buffer: buf });
    await p.waitForSelector(`[data-attached="${name}"]`, { timeout: 10000 }).catch(() => {});
  }
  log = await run('výkres razítko logo="inter.png"\nvýkres razítko');
  fs.writeFileSync(S + 'log7b.txt', log);
  ok(/→ razítko: logo „inter\.png“ 241×83 px, obrys pro DXF\/DWG \d+ ploch/.test(log) && !/Adam7/.test(log), 'prokládané PNG (Adam7) z konzole → ✓ logo 241×83 px (dřív ✗ prokládané PNG)');
  log = await run('výkres razítko logo="LOGO"');
  ok(/✗.*logo „LOGO“: název odpovídá více připojeným souborům \(logo\.png, logo\.jpg\) – zadejte celý název s příponou/.test(log), 'nejednoznačný název loga → ✗ se seznamem (dřív „soubor není připojený“) – ' + first(log, /✗.*$/m).slice(0, 160));
  log = await run('výkres revize A "první vydání"\nvýkres revize B "změna díry"\nvýkres razítko revize=""\nvýkres razítko\nvýkres razítko revize=C');
  fs.writeFileSync(S + 'log7c.txt', log);
  ok(/Razítko: .* revize B \(z tabulky revizí\) · /.test(log), 'prázdné pole revize: protokol uvádí „revize B (z tabulky revizí)“ (dřív „revize —“)');
  // engine (fáze B): nález příkazu výkresu = řádek ⚠ s kódem drawing.warning („⚠ řádek N: list …: …“), dřív „! …“
  ok(/(! |⚠ (řádek \d+: )?(list [^:\n]+: )?)revize v razítku „C“ není v tabulce revizí \(A, B\)/.test(log), 'revize C mimo tabulku → ⚠ upozornění');
  log = await run('výkres razítko revize=""\nvýkres razítko materiál="1.2379 (X153CrMoV12) kalené a popuštěné na 58–60 HRC, nitridováno 0,1 mm"\nvýkres razítko');
  ok(/Razítko bez zkracování textu: .*Materiál \d řádky \d,\d mm/.test(log), 'stav razítka hlásí i zalomený materiál – ' + first(log, /Razítko bez zkracování textu: .*$/m));
  log = await run('výkres nepředepsané X. ±0,1 · X.X ±0,1 · X.XX ±0,01 · X.XXX ±0,005\nvýkres razítko');
  ok(/Nepředepsané tolerance: tabulka podle desetinných míst: X\. ±0,1 \/ X\.X ±0,1 \/ X\.XX ±0,01 \/ X\.XXX ±0,005/.test(log), 'výkres nepředepsané X. ±0,1 · X.X ±0,1 · … → tabulka (dřív text)');
  log = await run('výkres nepředepsané X. ±0,1 / X.X ±0,1 / X.XX ±0,02 / X.XXX ±0,005\nvýkres nepředepsané desetinná ±0,1 / ±0,1 / ±0,01 / ±0,005\ndrawing general f H\nvýkres razítko materiál=""');
  ok(!/^✗/m.test(log) && /→ nepředepsané tolerance X\. ±0,1 \/ X\.X ±0,1 \/ X\.XX ±0,02/.test(log), 'ozvěna CADu „X. … / …“ a „desetinná ±0,1 / ±0,1 …“ bez ✗' + (first(log, /^✗.*$/m) ? ' – ' + first(log, /^✗.*$/m) : ''));
  // druhý list bez nepředepsaných tolerancí (pro kontrolu panelu při přepnutí listu)
  log = await run('výkres list nový "Detail"\nvýkres nepředepsané ne\nvýkres list 1');
  ok(!/^✗/m.test(log), 'druhý list „Detail“ bez nepředepsaných tolerancí');

  // ── GUI: výkresové prostředí, panel Razítko ──
  log = await run('výkres razítko šablona=nástrojářská\nvýkres');
  await closeConsole();
  await p.waitForSelector('[data-drawing-workspace]', { timeout: 120000 });
  await p.waitForSelector('[data-title-panel]', { timeout: 60000 });
  await p.locator('[data-title-panel]').scrollIntoViewIfNeeded();
  ok((await p.locator('[data-title-template]').inputValue()) === 'toolmaker', 'GUI: šablona razítka „nástrojářská“ podle textového příkazu');
  ok((await p.locator('[data-title-field="checkedBy"]').inputValue()) === 'EN check' && (await p.locator('[data-title-field="customer"]').inputValue()) === 'Kunde GmbH', 'GUI: pole Kontroloval a Zákazník z textových příkazů');
  // vlna 22 kolo 6 (oponent): pole Materiál v razítku = totéž pravidlo jako příkaz `materiál …` a pole v Hmotnostních
  // vlastnostech – pod polem ℹ material.class / ⚠ material.density-assumed (dřív bez hlášky: „Hardox 400“ tiše předpokládal hustotu)
  {
    const mf = p.locator('[data-title-panel] [data-title-field="material"]');
    const mnote = () => p.locator('[data-title-panel] [data-material-note]').first().getAttribute('data-material-note', { timeout: 2000 }).catch(() => null);
    const prevMat = await mf.inputValue();
    const waitNote = (code) => p.waitForFunction((c) => { const e = document.querySelector('[data-title-panel] [data-material-note]'); return c === null ? !e : !!e && e.getAttribute('data-material-note') === c; }, code, { timeout: 15000 }).catch(() => {});
    await mf.fill('Hardox 400');
    await mf.press('Tab');
    await waitNote('material.density-assumed');
    const wtxt = await p.locator('[data-title-panel] [data-material-note]').first().textContent({ timeout: 2000 }).catch(() => '');
    ok((await mnote()) === 'material.density-assumed' && /^⚠/.test(wtxt || '') && !/✓/.test(wtxt || ''), `GUI razítko: Materiál „Hardox 400“ → ⚠ hustota předpokládaná pod polem (${wtxt})`);
    await mf.fill('ČSN 11 423');
    await mf.press('Tab');
    await waitNote('material.class');
    ok((await mnote()) === 'material.class' && /ČSN 11 423 \(hustota podle: Ocel\)/.test(await p.evaluate(() => window.mncad.status())), `GUI razítko: Materiál „ČSN 11 423“ → ℹ třída Ocel pod polem (${await mnote()})`);
    await mf.fill(prevMat);
    await mf.press('Tab');
    if (!prevMat.trim()) await waitNote(null);
    ok(prevMat.trim() ? true : (await p.locator('[data-title-panel] [data-material-note]').count()) === 0, 'GUI razítko: prázdné pole Materiál = bez označení, bez hlášky');
  }
  ok((await p.locator('[data-title-tol-mode]').inputValue()) === 'iso2768' && (await p.locator('[data-title-tol-lin]').inputValue()) === 'f' && (await p.locator('[data-title-tol-geo]').inputValue()) === 'H', 'GUI: nepředepsané tolerance ISO 2768 f / H');
  // přepnutí listu: režim tolerancí se nepřenáší (dřív na „Detail“ zůstalo ISO 2768 + třída a zároveň ⚠ bez tolerancí)
  const tab = (name) => p.locator('[data-drawing-workspace] button[title="Dvojklik = přejmenovat"]', { hasText: name }).first();
  await tab('Detail').click();
  await p.waitForFunction(() => { const s = document.querySelector('[data-title-tol-mode]'); return !!s && s.value === 'none'; }, null, { timeout: 20000 }).catch(() => {});
  ok((await p.locator('[data-title-tol-mode]').inputValue()) === 'none' && (await p.locator('[data-title-tol-lin]').count()) === 0 && (await p.locator('[data-title-tol-warning]').isVisible()), 'GUI: list „Detail“ bez tolerancí → „nezadané“ + ⚠, žádná třída ISO z listu 1');
  await tab('List 1').click();
  await p.waitForFunction(() => { const s = document.querySelector('[data-title-tol-mode]'); return !!s && s.value === 'iso2768'; }, null, { timeout: 20000 }).catch(() => {});
  ok((await p.locator('[data-title-tol-mode]').inputValue()) === 'iso2768' && (await p.locator('[data-title-tol-lin]').inputValue()) === 'f' && (await p.locator('[data-title-tol-warning]').count()) === 0, 'GUI: zpět na list 1 → ISO 2768 f, bez ⚠');
  // náhled listu: logo jako obrázek, pole v SVG
  await p.waitForFunction(() => !!document.querySelector('[data-sheet] svg image'), null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.querySelector('[data-sheet] svg image')), 'GUI: náhled listu obsahuje logo (<image>)');
  // změny v GUI: šablona kompaktní, třída m / K, schválil, nové logo
  await p.locator('[data-title-template]').selectOption('compact');
  await p.locator('[data-title-tol-lin]').selectOption('m');
  await p.locator('[data-title-tol-geo]').selectOption('K');
  await p.locator('[data-title-field="approvedBy"]').fill('GUI Schválil');
  await p.locator('[data-title-logo-input]').setInputFiles({ name: 'logo2.png', mimeType: 'image/png', buffer: LOGO2 });
  await p.waitForFunction(() => { const i = document.querySelector('[data-title-logo]'); return !!i && i.getAttribute('src').startsWith('data:image/png'); }, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500); // uložení do dokumentu (odložené 500 ms) + přepočet
  await p.screenshot({ path: S + 'gui-titleblock.png' });
  log = await run('výkres razítko');
  fs.writeFileSync(S + 'log8.txt', log);
  // vlna 23 (R1): vyplněné nepředepsané tolerance jsou v technickém pásu razítka (+10 mm) → kompaktní 180×27 + 10
  ok(/Šablona razítka: kompaktní 180×37 mm · .* · logo „logo2\.png“ 80×80 px/.test(log), 'GUI → text: šablona kompaktní a nové logo „logo2.png“');
  ok(/Nepředepsané tolerance: ISO 2768-mK/.test(log) && /schválil „GUI Schválil“/.test(log), 'GUI → text: ISO 2768-mK a Schválil');
  await closeConsole();

  // ── Nastavení → Výkres → šablona razítka nových listů ──
  const dws = p.locator('[data-drawing-workspace] header button', { hasText: /^Zavřít$/ });
  if (await dws.isVisible().catch(() => false)) { await dws.click(); await p.waitForTimeout(1200); }
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await p.keyboard.press('Control+,');
  await p.waitForTimeout(800);
  if (!(await p.evaluate(() => [...document.querySelectorAll('div.fixed.inset-0 button')].some((x) => x.textContent.trim() === 'Výkres')))) {
    // Nastavení z rychlého panelu (ozubené kolo), když zkratku zachytilo jiné okno
    const q = p.locator('button[title="Nastavení (Ctrl+,)"]').first();
    if (await q.isVisible().catch(() => false)) await q.click();
  }
  await p.screenshot({ path: S + 'settings.png' });
  // karta „Výkres“ v okně Nastavení (tlačítko s ikonou a textem)
  await p.evaluate(() => { const m = [...document.querySelectorAll('div.fixed.inset-0')].pop(); const t = m && [...m.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Výkres'); if (t) t.click(); });
  await p.waitForTimeout(500);
  const sel = p.getByLabel('Šablona razítka nových listů');
  ok(await sel.isVisible({ timeout: 10000 }).catch(() => false), 'Nastavení → Výkres: volba „Šablona razítka nových listů“');
  await sel.selectOption('toolmaker');
  await p.getByRole('button', { name: 'OK', exact: true }).click();
  await p.waitForTimeout(600);
  log = await run('nový díl Druhý\nkvádr 50 30 10\nvýkres razítko');
  fs.writeFileSync(S + 'log9.txt', log);
  ok(/Šablona razítka: nástrojářská \(všechna pole\) 180×64 mm/.test(log), 'nový výkres dostane šablonu z Nastavení (nástrojářská)');

  // Chytré kóty a vysoké razítko (nástrojářská 180×64): žádná kótovací čára v razítku (dřív kóta 200 na y 140 uvnitř)
  log = await run('nový díl Deska Q1\nkvádr 200 120 20 střed\ndíra 8 skrz v -80 -45 20 v 80 -45 20 v -80 45 20 v 80 45 20\ndíra 25 skrz v 0 0 20\nvýkres A4\nvýkres razítko šablona=nástrojářská\nkótovat\nvýkres stav\nvýkres export svg');
  fs.writeFileSync(S + 'log10.txt', log);
  ok(/Kontrola kót: velikosti (\d+)\/\1 · polohy (\d+)\/\2(?! –)/.test(log) && !/^!(?!.*nepředepsané tolerance)/m.test(log), 'nástrojářská šablona A4: kontrola kót 5/5, žádné „!“ (kromě chybějících nepředepsaných tolerancí)' + (first(log, /^!(?!.*nepředepsané tolerance).*$/m) ? ' – ' + first(log, /^!(?!.*nepředepsané tolerance).*$/m) : ''));
  const fq = await nextDownload(5);
  const sq = fq ? fq.data.toString('utf8') : '';
  const dimPolys = [...sq.matchAll(/<polyline fill="none" stroke="#111" stroke-width="0\.18" points="([^"]+)"\/>/g)].map((m) => m[1].trim().split(/\s+/).map((q) => q.split(',').map(Number)));
  const inTb = dimPolys.filter((pts) => pts.some(([x, y]) => x > 107.1 && x < 286.9 && y > 136.1 && y < 199.9));
  ok(dimPolys.length > 10 && inTb.length === 0, `SVG: ${dimPolys.length} čar kót, v razítku x 107–287, y 136–200: ${inTb.length}` + (inTb.length ? ' – ' + JSON.stringify(inTb.slice(0, 2)) : ''));
  await closeConsole();

  ok(errs.length === 0, 'žádné chyby stránky' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails ? `FAIL ${fails}` : 'ALL OK');
})().catch((e) => { console.error('FAIL: výjimka', e); process.exit(1); });
