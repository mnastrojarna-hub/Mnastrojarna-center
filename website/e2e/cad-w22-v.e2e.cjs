// E2E vlna 22 – balík V, etapa V1 (produkční build): body 13 a 14 zprávy majitele.
//  1. bod 13: studie 0,65 s / 112 kroků → `pohyb export webm` → WebM má délku 0,65 s ± 1 snímek (dřív 2,926 s), 20 bloků s časy
//     i·33,3 ms, snímky se liší (otisky dat bloků) – ve WebGL i bez WebGL (E2E_NOGL=1) i v řezu; 0,25× → 2,6 s; hláška uvádí délku
//     a poměr; zpráva exportu (data-video-*) = kontrola souboru a obrazu;
//  2. bod 14: lišta přehrávání ukotvená dole (▶, časová osa, čas a krok, rychlost), kompaktní režim skryje panel studie, panel
//     Řez modelem nepadne pod panel studie, „Uložit pohled“ uloží kameru a řez do studie (window.mncad.getDocument), výběr pohledu
//     ho použije, anotace v okně (data-motion-hud) a vypálené v PNG (tmavý podklad anotace v levém horním rohu snímku), dva pohledy
//     ve videu = dlaždice vedle sebe (šířka videa ≈ 2 × výška dlaždice).
// Spuštění: E2E_BASE=http://localhost:3536 node e2e/cad-w22-v.e2e.cjs [výstupní složka]   (E2E_NOGL=1 = průchod bez WebGL)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ok = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const BASE = (process.env.E2E_BASE || 'http://localhost:3536').replace(/\/$/, '');
const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const NOGL = process.env.E2E_NOGL === '1';
const OUT = (process.argv[2] || '/tmp/cad-w22-v').replace(/\/?$/, '/');
fs.mkdirSync(OUT, { recursive: true });
const tag = NOGL ? ' (bez WebGL)' : '';

/** minimální čtení WebM (EBML): délka, rozměr, časy a otisky bloků – nezávislé na aplikaci */
function readWebm(b) {
  const MASTER = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675, 0xa0, 0x1c53bb6b, 0x114d9b74, 0x1254c367]);
  const out = { scale: 1e6, duration: null, width: 0, height: 0, codec: '', blocks: [] };
  const id = (o) => { const x = b[o]; const n = x >= 0x80 ? 1 : x >= 0x40 ? 2 : x >= 0x20 ? 3 : 4; let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return [v, n]; };
  const size = (o) => { const x = b[o]; let n = 1; while (n <= 8 && !(x & (0x80 >> (n - 1)))) n++; let v = x & (0xff >> n); let ones = v === 0xff >> n; for (let i = 1; i < n; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xff) ones = false; } return [ones ? null : v, n]; };
  const uint = (o, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return v; };
  let ct = 0;
  const walk = (from, to) => {
    let o = from;
    while (o < to) {
      const [i, il] = id(o);
      const [s, sl] = size(o + il);
      const body = o + il + sl;
      const end = s === null ? to : Math.min(to, body + s);
      if (MASTER.has(i)) walk(body, end);
      else if (i === 0x2ad7b1) out.scale = uint(body, end - body);
      else if (i === 0x4489) out.duration = end - body === 8 ? b.readDoubleBE(body) : b.readFloatBE(body);
      else if (i === 0xb0) out.width = uint(body, end - body);
      else if (i === 0xba) out.height = uint(body, end - body);
      else if (i === 0x86) out.codec = b.slice(body, end).toString();
      else if (i === 0xe7) ct = uint(body, end - body);
      else if (i === 0xa3) {
        const rel = b.readInt16BE(body + 1);
        const data = b.slice(body + 4, end);
        out.blocks.push({ time: ((ct + rel) * out.scale) / 1e6, size: data.length, hash: require('crypto').createHash('md5').update(data).digest('hex') });
      }
      o = end;
    }
  };
  walk(0, b.length);
  if (out.duration !== null) out.duration = (out.duration * out.scale) / 1e9;
  return out;
}
/** PNG → RGBA (bez knihoven: zlib + filtry řádků) */
function readPng(buf) {
  let o = 8, w = 0, h = 0, ct = 6, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4), row = Buffer.alloc(w * bpp), prev = Buffer.alloc(w * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * bpp + 1)], src = raw.slice(y * (w * bpp + 1) + 1, (y + 1) * (w * bpp + 1));
    for (let x = 0; x < w * bpp; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      row[x] = (src[x] + (f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : 0)) & 255;
    }
    for (let x = 0; x < w; x++) { px[(y * w + x) * 4] = row[x * bpp]; px[(y * w + x) * 4 + 1] = row[x * bpp + 1]; px[(y * w + x) * 4 + 2] = row[x * bpp + 2]; px[(y * w + x) * 4 + 3] = bpp === 4 ? row[x * bpp + 3] : 255; }
    row.copy(prev);
  }
  return { w, h, px };
}
/** první soubor ZIP (bez komprese – writeZip ukládá) podle názvu */
function zipFile(buf, re) {
  for (let o = 0; o + 30 < buf.length; ) {
    if (buf.readUInt32LE(o) !== 0x04034b50) break;
    const comp = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28);
    const name = buf.toString('utf8', o + 30, o + 30 + nl), data = buf.slice(o + 30 + nl + el, o + 30 + nl + el + size);
    if (re.test(name)) return comp === 8 ? zlib.inflateRawSync(data) : data;
    o += 30 + nl + el + size;
  }
  return null;
}

async function open(b, p0) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + p0, { waitUntil: 'networkidle', timeout: 300000 });
  for (const t of ['Pokračovat v práci', 'Continue working', 'Weiterarbeiten']) {
    const c0 = p.getByText(t);
    if (await c0.isVisible({ timeout: 1500 }).catch(() => false)) await c0.click();
  }
  await p.waitForFunction(() => !!(window.mncad && window.mncad.run), null, { timeout: 240000 });
  await p.waitForFunction(() => !/Načítám (CAD )?jádro|Loading the (CAD )?kernel|Kern wird geladen/.test(document.body.innerText), null, { timeout: 240000 }).catch(() => {});
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ args: NOGL ? NO_GL : GL });
  const { p } = await open(b, '/cad');
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const run = async (text) => String(await p.evaluate((t) => window.mncad.run(t), text));
  const doc = () => p.evaluate(() => window.mncad.getDocument());
  const player = p.locator('[data-motion-player]');
  const panel = p.locator('[data-motion-panel]');
  const report = p.locator('[data-video-report]');
  /** spustí export a počká na stažený soubor a zprávu exportu */
  const exportVia = async (cmd, name) => {
    const dl = p.waitForEvent('download', { timeout: 240000 }).catch(() => null);
    const log = await run(cmd);
    const f = await dl;
    const file = f ? path.join(OUT, `${name}${NOGL ? '-nogl' : ''}${path.extname(f.suggestedFilename())}`) : null;
    if (f) await f.saveAs(file);
    await p.waitForFunction(() => !!document.querySelector('[data-video-report]'), null, { timeout: 30000 }).catch(() => {});
    const rep = await report.evaluate((el) => ({ ...el.dataset, text: el.textContent })).catch(() => null);
    return { log, file, rep };
  };

  // ── model: studie 0,65 s / 112 kroků (repro bodu 13, neutrální názvy) ──
  let log = await run(['nový díl "Deska A"', 'kvádr 200 100 10', 'nový díl "Přidržovač"', 'kvádr 200 100 10'].join('\n'));
  log += await run(['nová sestava "Studie V"', 'vložit "Deska A" ukotvit', 'vložit "Přidržovač" v 0 0 67,5', 'sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 57,5 název "ZDVIH"', 'sestava vazba rovnoběžně "Přidržovač" +X "Deska A" +X', 'sestava vazba rovnoběžně "Přidržovač" +Y "Deska A" +Y', 'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 112 čas 0,65', 'pohyb spustit'].join('\n'));
  ok(!/^✗/m.test(log), `model a studie 0,65 s / 112 kroků${tag}`);
  await player.waitFor({ timeout: 30000 });
  await p.waitForFunction(() => document.querySelector('[data-motion-player]')?.getAttribute('data-player-state') === 'ok', null, { timeout: 60000 }).catch(() => {});
  ok((await player.getAttribute('data-player-state')) === 'ok', 'lišta přehrávání dole ve 3D okně, výsledek platí');
  const pb = await player.boundingBox();
  const vb = await p.locator('main').boundingBox();
  ok(pb && vb && pb.y + pb.height > vb.y + vb.height - 40, `lišta ukotvená u dolního okraje 3D okna (${pb && Math.round(pb.y)} / ${vb && Math.round(vb.y + vb.height)})`);
  ok(await p.locator('[data-motion-hud]').isVisible(), 'anotace polohy v okně: ' + (await p.locator('[data-motion-hud]').innerText().catch(() => '')).replace(/\n/g, ' | '));

  // ── bod 13: WebM s pevným časováním, 1× ──
  let r = await exportVia('pohyb export webm', 'video-1x');
  ok(/video 0,667 s = 1,03 × délka studie 0,65 s/.test(r.log), 'protokol: plán délky a poměr ke studii – ' + (r.log.split('\n').find((l) => /video 0,667/.test(l)) || '').trim());
  ok(!!r.file, 'soubor WebM stažen');
  if (r.file) {
    const w = readWebm(fs.readFileSync(r.file));
    ok(w.duration !== null && Math.abs(w.duration - 0.65) <= 1 / 30 + 1e-6, `délka WebM ${w.duration} s = 0,65 s ± 1/30 s (dřív 2,926 s)`);
    ok(w.blocks.length === 20, `20 snímků (${w.blocks.length})`);
    ok(w.blocks.every((x, i) => Math.abs(x.time - (i * 1000) / 30) <= 1), 'časové značky bloků i·33,3 ms');
    const distinct = new Set(w.blocks.map((x) => x.hash)).size;
    ok(distinct >= 15, `snímky se liší: ${distinct} různých z ${w.blocks.length} (žádné mrtvé plátno)`);
  }
  ok(r.rep && r.rep.videoLevel === 'ok' && r.rep.videoVerdict === 'ok', `zpráva exportu: ${r.rep && r.rep.text}`);
  ok(r.rep && Math.abs(Number(r.rep.videoFileSeconds) - 0.65) <= 1 / 30 + 1e-6, `zpráva: délka přečtená ze souboru ${r.rep && r.rep.videoFileSeconds} s`);

  // ── 0,25× ──
  r = await exportVia('pohyb export webm rychlost 0,25', 'video-025x');
  if (r.file) {
    const w = readWebm(fs.readFileSync(r.file));
    ok(Math.abs(w.duration - 2.6) <= 1 / 30 + 1e-6 && w.blocks.length === 78, `0,25×: ${w.duration} s, ${w.blocks.length} snímků (2,6 s, 78)`);
  } else ok(false, '0,25×: soubor nestažen');

  // ── bod 14: kompaktní lišta a panel řezu ──
  await p.locator('[data-player-compact]').click();
  await p.waitForTimeout(300);
  ok(!(await panel.isVisible().catch(() => false)), 'Lišta ▾: panel studie skrytý, lišta zůstává');
  await p.locator('[data-player-compact]').click();
  await panel.waitFor({ timeout: 5000 });
  ok(await panel.isVisible(), 'Panel ▴: plný panel studie zpět');
  await p.keyboard.press('x');
  await p.waitForTimeout(500);
  const sec = p.locator('div.absolute', { hasText: 'Řez modelem' }).last();
  const sb = await sec.boundingBox().catch(() => null);
  const mb = await p.locator('[data-motion-panel]').locator('xpath=..').boundingBox().catch(() => null);
  const overlap = sb && mb && !(sb.x >= mb.x + mb.width || mb.x >= sb.x + sb.width || sb.y >= mb.y + mb.height || mb.y >= sb.y + sb.height);
  ok(!!sb && !overlap, `panel Řez modelem není pod panelem studie (řez x ${sb && Math.round(sb.x)}, studie x ${mb && Math.round(mb.x)}–${mb && Math.round(mb.x + mb.width)})`);

  // ── uložit pohled z okna (kamera + řez) a použít ho ──
  await p.locator('[data-player-save-view]').click();
  await p.locator('[data-player-view-name]').fill('Řez A');
  await p.locator('[data-player-view-ok]').click();
  await p.waitForTimeout(500);
  let d = await doc();
  const v1 = (d.motion.views || []).find((x) => x.name === 'Řez A');
  ok(!!v1 && !!v1.section && !!v1.camera && v1.camera.height > 0, `pohled „Řez A“ ve studii: ${JSON.stringify(v1 && { camera: v1.camera, section: v1.section })}`);
  log = await run('pohyb pohled uložit "Shora" kamera horní bez řezu');
  ok(/✓ pohled studie „Shora“ uložen/.test(log), 'textem: pohled „Shora“ uložen');
  await p.keyboard.press('x'); // řez okna vypnout – pohled „Řez A“ ho musí vrátit
  await p.waitForTimeout(300);
  await p.locator('[data-player-views]').selectOption({ label: 'Řez A' });
  await p.waitForTimeout(800);
  ok(await p.locator('div.absolute', { hasText: 'Řez modelem' }).last().isVisible().catch(() => false), 'výběr pohledu „Řez A“ zapne jeho řez v okně');
  d = await doc();
  ok(d.motion.view === v1?.id, 'aktivní pohled uložen ve studii');

  // ── video v řezu (aktivní pohled) – snímky se liší ──
  r = await exportVia('pohyb export webm', 'video-rez');
  if (r.file) {
    const w = readWebm(fs.readFileSync(r.file));
    const distinct = new Set(w.blocks.map((x) => x.hash)).size;
    ok(Math.abs(w.duration - 0.65) <= 1 / 30 + 1e-6 && distinct >= 15, `video v řezu: ${w.duration} s, ${distinct} různých snímků`);
  } else ok(false, 'video v řezu: soubor nestažen');

  // ── dva pohledy = synchronní dlaždice ──
  log = await run('pohyb video pohled "Řez A" "Shora"');
  ok(/synchronně vedle sebe/.test(log), 'pohyb video se dvěma pohledy');
  r = await exportVia('pohyb export webm', 'video-2-pohledy');
  if (r.file) {
    const w = readWebm(fs.readFileSync(r.file));
    ok(w.width > w.height * 1.2 && w.blocks.length === 20, `dvě dlaždice vedle sebe: ${w.width}×${w.height}, ${w.blocks.length} snímků`);
  } else ok(false, 'dva pohledy: soubor nestažen');
  await run('pohyb video pohledy vyp');

  // ── PNG s anotací (vypálená do obrazu) ──
  r = await exportVia('pohyb export png', 'snimky');
  if (r.file) {
    const z = fs.readFileSync(r.file);
    const png = zipFile(z, /krok-0005\.png$/);
    ok(!!png && !!zipFile(z, /casovani\.txt$/), 'ZIP: snímky PNG a časový plán casovani.txt');
    if (png) {
      const im = readPng(png);
      let lum = 0, n = 0;
      for (let y = 14; y < 30; y++) for (let x = 14; x < 120; x++) { const o = (y * im.w + x) * 4; lum += 0.3 * im.px[o] + 0.59 * im.px[o + 1] + 0.11 * im.px[o + 2]; n++; }
      ok(lum / n < 110, `anotace vypálená v PNG (tmavý podklad vlevo nahoře, jas ${Math.round(lum / n)})`);
    }
  } else ok(false, 'PNG: soubor nestažen');

  // ── API: plán videa ──
  const api = await p.evaluate(() => window.mncad.motion().then((m) => m.video));
  ok(api && Math.abs(api.seconds - 0.6667) < 0.001 && api.frames === 20, `window.mncad.motion().video = ${JSON.stringify(api)}`);
  ok(errs.length === 0, `bez chyb stránky ${errs.slice(0, 3).join(' | ')}`);
  await b.close();
})().catch((e) => {
  console.log('FAIL: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
