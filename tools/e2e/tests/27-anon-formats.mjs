// „Vždycky tam musí být anonymizace" — nahrání reprezentativní sady formátů do zakázky přes Dokumenty
// (vektorové PDF, skenované PDF, fotka JPG s EXIF GPS a autorem, HEIC z iPhonu, TIFF, DXF, STEP, DWG, ZIP)
// a pro každý soubor konečný stav bez točícího se kolečka: hotovo (nic ke kontrole) / „Nelze anonymizovat
// automaticky" s návodem / 3D model bez anonymizace, ZIP rozbalený do souborů. Výstupy bez úniku
// (text, EXIF / GPS, PDF Info).
// DWG originál: obchodník ho dodavateli nepošle (ZIP pro dodavatele ani výslovný originál), super admin
// jen s výslovným potvrzením (audit).
//   E2E_BASE_URL=http://localhost:3500 ANON_SHOTS=<adresář> node tools/e2e/tests/27-anon-formats.mjs
// Server: AI_FAKE_ANON=<prázdný adresář> (neutrální testovací AI).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SHOTS = process.env.ANON_SHOTS || path.join(os.tmpdir(), "anon-formats-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase();
const NUMBER = `Z-E2E-ANONFMT27-${STAMP}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "anon-fmt-"));
// výchozí jen název firmy („Nic víc", majitel 31. 10.) — jméno a telefon smí v textu výkresu zůstat
const LEAK = /strojmetal/i;

// ── vzorky (zákazník „Strojmetal a.s.", „Ing. Jan Dvořák") ─────
async function vectorPdf() {
  const doc = await PDFDocument.create();
  doc.setAuthor("Ing. Jan Dvořák"); doc.setTitle("C:\\Users\\jdvorak\\Strojmetal\\D-4711-02.dwg"); doc.setSubject("Strojmetal a.s.");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 1190.55, H = 841.89;
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  const tbx = W - 540, tby = 20;
  p.drawRectangle({ x: tbx, y: tby, width: 520, height: 170, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const t = (s, x, y, size = 8, f = helv) => p.drawText(s, { x, y, size, font: f, color: rgb(0, 0, 0) });
  t("STROJMETAL a.s.", tbx + 50, tby + 150, 12, bold);
  t("Kreslil:", tbx + 5, tby + 122, 7); t("Ing. Jan Dvorak", tbx + 50, tby + 122);
  t("jan.dvorak@strojmetal.cz   Tel.: +420 777 123 456", tbx + 5, tby + 100, 7);
  t("Material:", tbx + 265, tby + 92, 7); t("1.4301", tbx + 305, tby + 92);
  t("Cislo vykresu:", tbx + 5, tby + 30, 7); t("D-4711-02", tbx + 135, tby + 28, 14, bold);
  t("C:\\Users\\jdvorak\\Strojmetal\\D-4711-02.dwg", 30, 26, 6);
  p.drawRectangle({ x: 200, y: 360, width: 420, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
  t("420 ±0,1", 390, 334, 9);
  return new Uint8Array(await doc.save());
}
const SVG = (w, h) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>
  <rect x="20" y="20" width="${w - 40}" height="${h - 40}" fill="none" stroke="#000" stroke-width="4"/><circle cx="${w * 0.35}" cy="${h * 0.45}" r="${h * 0.2}" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="${w * 0.55}" y="${h * 0.72}" width="${w * 0.42}" height="${h * 0.24}" fill="none" stroke="#000" stroke-width="3"/>
  <text x="${w * 0.57}" y="${h * 0.79}" font-family="DejaVu Sans" font-size="${h * 0.035}" font-weight="bold">Strojmetal a.s.</text>
  <text x="${w * 0.57}" y="${h * 0.85}" font-family="DejaVu Sans" font-size="${h * 0.025}">Kreslil: Ing. Jan Dvořák</text>
  <text x="${w * 0.57}" y="${h * 0.91}" font-family="DejaVu Sans" font-size="${h * 0.03}">D-4711-02  1.4301</text></svg>`);
async function scanPdf() {
  const png = await sharp(SVG(2480, 1754)).png().toBuffer();
  const doc = await PDFDocument.create();
  doc.setAuthor("Jan Dvořák");
  const img = await doc.embedPng(png);
  const p = doc.addPage([1190.55, 841.89]);
  p.drawImage(img, { x: 0, y: 0, width: 1190.55, height: 841.89 });
  return new Uint8Array(await doc.save());
}
async function photoJpg() {
  // telefon na výšku: obraz uložen otočený, EXIF orientace 6, GPS, autor, firma
  return new Uint8Array(await sharp(SVG(3000, 2120)).rotate(-90).jpeg({ quality: 88 })
    .withExif({
      IFD0: { Artist: "Jan Dvorak", Copyright: "Strojmetal a.s.", Make: "Apple", Model: "iPhone 15 Pro", ImageDescription: "Strojmetal D-4711-02" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "50/1 8/1 45/1", GPSLongitudeRef: "E", GPSLongitude: "14/1 6/1 33/1" },
    }).withMetadata({ orientation: 6 }).toBuffer());
}
async function tiff() {
  return new Uint8Array(await sharp(SVG(2480, 1754)).tiff({ compression: "lzw" }).withExif({ IFD0: { Artist: "Jan Dvorak", Copyright: "Strojmetal a.s." } }).toBuffer());
}
function heic() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/anonymize/__fixtures__/heic-sample.ts"), "utf8");
  return new Uint8Array(Buffer.from(/"([A-Za-z0-9+/=]{1000,})"/.exec(src)[1], "base64"));
}
function dxf() {
  const pairs = [[0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"], [9, "$LASTSAVEDBY"], [1, "jdvorak"], [0, "ENDSEC"],
    [0, "SECTION"], [2, "TABLES"], [0, "LAYER"], [2, "RAZITKO_STROJMETAL"], [70, "0"], [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"],
    [0, "TEXT"], [8, "RAZITKO_STROJMETAL"], [10, "100.0"], [20, "50.0"], [40, "5.0"], [1, "Strojmetal a.s."],
    [0, "TEXT"], [8, "0"], [10, "100.0"], [20, "40.0"], [40, "2.5"], [1, "Kreslil: Ing. Jan Dvořák"],
    [0, "TEXT"], [8, "0"], [10, "100.0"], [20, "30.0"], [40, "2.5"], [1, "Číslo výkresu: D-4711-02"],
    [0, "LINE"], [8, "0"], [10, "0.0"], [20, "0.0"], [11, "420.0"], [21, "0.0"], [0, "ENDSEC"], [0, "EOF"]];
  return strToU8(pairs.map(([c, v]) => `${String(c).padStart(3)}\n${v}`).join("\n") + "\n");
}
const step = () => strToU8(`ISO-10303-21;\nHEADER;\n/* jdvorak@strojmetal.cz */\nFILE_DESCRIPTION(('Strojmetal a.s.'),'2;1');\nFILE_NAME('C:\\\\Users\\\\jdvorak\\\\D-4711-02.stp','2026-10-29T10:12:00',('Ing. Jan Dvorak'),('Strojmetal a.s.'),'SwSTEP 2.0','SolidWorks 2024','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=PRODUCT('D-4711-02','Hridel Strojmetal','Strojmetal a.s. dil',(#2));\n#7=PERSON('jdvorak','Dvorak','Jan',(),(),());\n#8=ORGANIZATION('SM','Strojmetal a.s.','Kladno');\n#16=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n`);
const dwg = () => new Uint8Array([...strToU8("AC1032"), 0, 0, 0, 0, 0, 0, 0, ...Buffer.from("Strojmetal a.s. Jan Dvořák", "utf16le")]);

// plná automatika (majitel 31. 10.): žádné „ke kontrole"; 3D model (STEP) se neanonymizuje vůbec
const FILES = [
  { name: `vykres-vektor-${STAMP}.pdf`, make: vectorPdf, expect: /^done$/ },
  { name: `sken-${STAMP}.pdf`, make: scanPdf, expect: /^done$/ },
  { name: `foto-${STAMP}.jpg`, make: photoJpg, expect: /^done$/ },
  { name: `IMG_${STAMP}.HEIC`, make: heic, expect: /^done$/ },
  { name: `sken-${STAMP}.tif`, make: tiff, expect: /^done$/ },
  { name: `vykres-${STAMP}.dxf`, make: dxf, expect: /^done$/ },
  { name: `model-${STAMP}.step`, make: step, expect: /^$/ },
  { name: `sestava-${STAMP}.dwg`, make: dwg, expect: /^unsupported$/ },
];

function cleanup() {
  const jobs = `select id from orders where number like 'Z-E2E-ANONFMT27-%'`;
  sql(`delete from anon_send_queue where job_id in (${jobs})`);
  sql(`delete from drawing_anon_usage_log where subject_id in (select f.id from job_files f where f.job_id in (${jobs}))`);
  sql(`delete from job_files where job_id in (${jobs})`);
  sql(`delete from orders where number like 'Z-E2E-ANONFMT27-%'`);
  sql(`delete from customers where name like 'E2E-ANONFMT27 %'`);
}
cleanup();

const salesId = sql(`select id from profiles where email='${USERS.obchod.email}'`);
const customerId = sql(`insert into customers (name, email, contact_person, owner_id) values ('E2E-ANONFMT27 ${STAMP} Strojmetal a.s.', 'jan.dvorak@strojmetal.cz', 'Ing. Jan Dvořák', '${salesId}') returning id`).split("\n")[0];
const jobId = sql(`insert into orders (number, title, source, status, owner_id, customer_id) values ('${NUMBER}', 'Poptávka — všechny formáty (E2E)', 'manual', 'poptavka', '${salesId}', '${customerId}') returning id`).split("\n")[0];
for (const f of FILES) { f.fp = path.join(DIR, f.name); fs.writeFileSync(f.fp, await f.make()); }
const ZIP = { name: `vykresy-${STAMP}.zip`, fp: path.join(DIR, `vykresy-${STAMP}.zip`) };
fs.writeFileSync(ZIP.fp, zipSync({ "Strojmetal/D-4711-02.pdf": fs.readFileSync(FILES[0].fp), "Strojmetal/D-4711-02.dxf": fs.readFileSync(FILES[5].fp), "Strojmetal/D-4711-02.dwg": fs.readFileSync(FILES[7].fp) }));

const env = localEnv();
async function storage(pathInBucket) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${pathInBucket}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`úložiště ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
/** Text pro hledání úniku: bajty + rozbalené proudy PDF. */
function grepText(b) {
  const buf = Buffer.from(b);
  let s = buf.toString("latin1") + buf.toString("utf16le");
  if (buf.subarray(0, 4).toString() === "%PDF") {
    const raw = buf.toString("latin1");
    for (const m of raw.matchAll(/stream\r?\n/g)) {
      const a = m.index + m[0].length, e = raw.indexOf("endstream", a);
      try { s += inflateSync(buf.subarray(a, e)).toString("latin1"); } catch { /* obrázek */ }
    }
  }
  return s;
}

const browser = await launch();
const errors = [];
const watch = (context) => context.on("page", (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
});
const row = (name) => sql(`select id || '|' || coalesce(anon_status, '') || '|' || coalesce(anon_reason, '') || '|' || coalesce(anon_path, '') || '|' || coalesce(anon_mime, '') from job_files where job_id='${jobId}' and filename='${name}' and not archived order by created_at desc limit 1`).split("|");

await test("obchodník nahraje 9 formátů najednou → každý skončí v konečném stavu (žádné kolečko)", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ" });
  watch(context);
  const page = await context.newPage();
  try {
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    const input = page.getByText("Přetáhni sem soubory nebo je vyber").locator("visible=true").first()
      .locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]").locator("input[type=file]");
    await input.waitFor({ state: "attached", timeout: 30_000 });
    const t0 = Date.now();
    await input.setInputFiles([...FILES.map((f) => f.fp), ZIP.fp]);
    // všechno (i rozbalené soubory ze ZIPu) v konečném stavu
    let st = "";
    for (let i = 0; i < 120; i++) {
      st = sql(`select count(*) filter (where anon_status in ('pending','processing')) || '/' || count(*) from job_files where job_id='${jobId}'`);
      if (/^0\/(1[2-9]|[2-9]\d)$/.test(st)) break;
      await page.waitForTimeout(2000);
    }
    console.log(`    hotovo za ${Math.round((Date.now() - t0) / 1000)} s (čeká/celkem ${st})`);
    expect(/^0\//.test(st), `nic nečeká (${st})`);
    for (const f of FILES) {
      const [, status, reason] = row(f.name);
      console.log(`    ${f.name.replace(`-${STAMP}`, "").replace(`_${STAMP}`, "")} → ${status}${reason ? ` — ${reason.slice(0, 90)}` : ""}`);
      expect(f.expect.test(status), `${f.name}: stav ${status} (${reason})`);
    }
    const [, zst, zreason] = row(ZIP.name);
    expect(zst === "unsupported" && /^Rozbaleno do 3 souborů/.test(zreason), `ZIP rozbalený (${zst}: ${zreason})`);
    const kids = sql(`select filename || ':' || anon_status from job_files where job_id='${jobId}' and note like 'Z archivu ${ZIP.name}%' order by filename`);
    console.log(`    ZIP → ${kids.replace(/\n/g, ", ")}`);
    expect(/D-4711-02\.dwg:unsupported/.test(kids) && /D-4711-02\.dxf:done/.test(kids) && /D-4711-02\.pdf:done/.test(kids), `soubory ze ZIPu zpracované (${kids})`);
    expect(sql(`select count(*) from job_files where job_id='${jobId}' and anon_status='review'`) === "0", "nic „ke kontrole“");
    // UI: po obnovení žádné kolečko, DWG s návodem
    await page.reload();
    await page.getByText(FILES[7].name).first().waitFor({ timeout: 30_000 });
    const busy = await page.locator('[data-anon-status="pending"], [data-anon-status="processing"]').count();
    expect(busy === 0, `žádný odznak se netočí (${busy})`);
    const dwgLi = page.locator("li", { hasText: FILES[7].name }).locator("visible=true").first();
    const dwgText = await dwgLi.innerText();
    expect(/Nelze anonymizovat automaticky/.test(dwgText) && /DXF/.test(dwgText), `DWG: štítek a návod (${dwgText.slice(0, 160)})`);
    // 3D model: žádný odznak anonymizace (nemá razítko ani název firmy)
    const stepLi = page.locator("li", { hasText: FILES[6].name }).locator("visible=true").first();
    expect(await stepLi.locator("[data-anon-status]").count() === 0 && !/Nelze anonymizovat|Anonymiz/.test(await stepLi.innerText()), "STEP bez anonymizace");
    expect(!/Ke kontrole/.test(await page.locator("main").innerText()), "žádné „Ke kontrole“ v dokumentech");
    await dwgLi.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(SHOTS, "27-dokumenty.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

await test("výstupy bez úniku: text, EXIF / GPS, PDF Info, STEP hlavička, DXF $LASTSAVEDBY a názvy hladin", async () => {
  const outs = [...FILES.filter((f) => !/\.(dwg|step)$/.test(f.name)).map((f) => f.name),
    ...sql(`select filename from job_files where job_id='${jobId}' and note like 'Z archivu %' and anon_path is not null`).split("\n").filter(Boolean)];
  for (const name of outs) {
    const [, status, , p, mime] = row(name);
    expect(p, `${name}: má kopii pro dodavatele (${status})`);
    const b = await storage(p);
    const txt = grepText(b);
    if (!/^image\//.test(mime) && !/sken|foto|IMG_/.test(name)) expect(!LEAK.test(txt), `${name}: žádný text zákazníka ve výstupu`);
    if (/^image\//.test(mime)) {
      const m = await sharp(Buffer.from(b)).metadata();
      expect(!m.exif && !m.xmp && !m.iptc, `${name}: bez EXIF / XMP / IPTC`);
      expect(!/GPS|Dvorak|iPhone/.test(Buffer.from(b).toString("latin1")), `${name}: bez GPS a autora`);
      if (/foto-/.test(name)) expect(m.width > m.height, `${name}: orientace zapečená (na šířku ${m.width}×${m.height})`);
    }
    if (mime === "application/pdf") expect(!/\/Author|\/Title \(C:|Strojmetal/i.test(txt), `${name}: PDF Info bez autora / cesty`);
    if (/\.dxf$/.test(name)) expect(!/jdvorak|RAZITKO_STROJMETAL/i.test(txt) && /D-4711-02/.test(txt), `${name}: DXF bez autora a firmy v názvech, číslo výkresu zůstalo`);
  }
  console.log(`    zkontrolováno ${outs.length} výstupů`);
  // 3D model: žádná kopie, žádný stav
  const [, stStatus, , stPath] = row(FILES[6].name);
  expect(stStatus === "" && stPath === "", `STEP bez anonymizace (${stStatus}|${stPath})`);
});

await test("DWG originál: obchodník ho dodavateli nepošle, super admin jen s výslovným potvrzením", async () => {
  const [dwgId] = row(FILES[7].name);
  const [vecId, vecStatus] = row(FILES[0].name);
  const sales = await browser.newContext({ locale: "cs-CZ" });
  watch(sales);
  const sp = await sales.newPage();
  try {
    await login(sp, USERS.obchod);
    const r1 = await sp.request.get(`${BASE}/api/jobs/${jobId}/supplier-pack?files=${dwgId}`);
    const j1 = await r1.json();
    expect(r1.status() === 409 && /DWG/.test(JSON.stringify(j1.missing ?? [])), `ZIP pro dodavatele bez DWG (${r1.status()} ${JSON.stringify(j1).slice(0, 200)})`);
    const r2 = await sp.request.get(`${BASE}/api/jobs/${jobId}/supplier-pack?files=${dwgId}&original=${dwgId}`);
    expect(r2.status() === 403, `obchodník: originál zakázán (${r2.status()})`);
    const r3 = await sp.request.get(`${BASE}/api/drawings/anonymize/${dwgId}/download`);
    expect(r3.status() >= 400, `stažení „pro dodavatele" DWG zablokované (${r3.status()})`);
    // UI: v dialogu ZIP pro dodavatele obchodník volbu originálu nevidí
    await sp.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    await sp.getByTestId("supplier-pack").locator("visible=true").first().click();
    await sp.getByText("Balíček pro kooperanta (ZIP)").waitFor({ timeout: 15_000 });
    expect(await sp.getByTestId("supplier-pack-original").count() === 0, "obchodník nevidí „Poslat ORIGINÁL“");
    await sp.screenshot({ path: path.join(SHOTS, "27-zip-obchodnik.png") });
  } finally {
    await sales.close();
  }
  const admin = await browser.newContext({ locale: "cs-CZ" });
  watch(admin);
  const ap = await admin.newPage();
  try {
    await login(ap, USERS.admin);
    await ap.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    await ap.getByTestId("supplier-pack").locator("visible=true").first().click();
    const opt = ap.getByTestId("supplier-pack-original").locator("visible=true").first();
    await opt.waitFor({ timeout: 15_000 });
    await ap.screenshot({ path: path.join(SHOTS, "27-zip-admin.png") });
    expect(vecStatus === "done", `vektorový výkres hotový (${vecStatus})`);
    // 3D model jde dodavateli bez anonymizace i bez potvrzování (nemá razítko ani název firmy)
    const [stepId] = row(FILES[6].name);
    const r = await ap.request.get(`${BASE}/api/jobs/${jobId}/supplier-pack?files=${dwgId},${vecId},${stepId}&original=${dwgId}`);
    const j = await r.json();
    expect(r.ok() && j.url, `super admin: ZIP s originálem (${r.status()} ${JSON.stringify(j).slice(0, 160)})`);
    expect((j.missing ?? []).length === 0, `nic nechybí (${JSON.stringify(j.missing)})`);
    const zip = unzipSync(new Uint8Array(await (await fetch(j.url)).arrayBuffer()));
    const names = Object.keys(zip);
    console.log(`    ZIP super admina: ${names.join(", ")}`);
    expect(names.some((n) => /^original-\d+\.dwg$/.test(n)) && !names.some((n) => /sestava|strojmetal/i.test(n)), `originál DWG bez původního názvu (${names.join(", ")})`);
    expect(names.some((n) => /\.step$/.test(n)), `STEP v balíčku (${names.join(", ")})`);
    const audit = sql(`select count(*) from audit_log where action='supplier_pack' and entity_id='${jobId}' and diff->'originals' ? '${dwgId}'`);
    expect(audit === "1", `audit originálu (${audit})`);
  } finally {
    await admin.close();
  }
});

await browser.close();
const ok = summary(errors);
cleanup();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(ok && !errors.length ? 0 : 1);
