// Plné rozlišení a přímé nahrání (oprava „fotky z prohlížeče vždy Ke kontrole" a „archiv posílá soubor přes
// server action"):
//  1) obchodník nahraje do Dokumentů zakázky fotku z telefonu 4032 × 3024 → prohlížeč pošle zmenšenou kopii
//     (≤ 2400 px) A originál (master) přímo do úložiště; anonymizace doběhne sama, bez varování „Fotka v nízkém
//     rozlišení", kopie pro dodavatele má plných 4032 px; žádný požadavek na aplikaci nenese bajty souboru,
//  2) archiv Výkresy: 6 MB PDF → podepsaná URL → registerDrawing → anonymizace hned po nahrání,
//  3) DWG: obchodník „Poslat originál" nevidí (stažení zakázané s návodem), super admin s potvrzením ano (audit).
//   E2E_BASE_URL=http://localhost:3500 ANON_SHOTS=<adresář> node tools/e2e/tests/28-anon-hires-upload.mjs
// Server: AI_FAKE_ANON=<prázdný adresář> (neutrální testovací AI).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";

const SHOTS = process.env.ANON_SHOTS || path.join(os.tmpdir(), "anon-hires-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const STAMP = Date.now().toString(36).toUpperCase();
const NUMBER = `Z-E2E-ANONHIRES28-${STAMP}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "anon-hires-"));
const DRAWING_NO = `E2E28-${STAMP}`;
const MB = 1024 * 1024;

async function phoneJpg() {
  const w = 4032, h = 3024;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>
    <rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="#000" stroke-width="6"/>
    <circle cx="${w * 0.35}" cy="${h * 0.45}" r="${h * 0.2}" fill="none" stroke="#000" stroke-width="6"/>
    <rect x="${w * 0.55}" y="${h * 0.72}" width="${w * 0.42}" height="${h * 0.24}" fill="none" stroke="#000" stroke-width="4"/>
    <text x="${w * 0.57}" y="${h * 0.8}" font-family="DejaVu Sans" font-size="${h * 0.035}" font-weight="bold">Strojmetal a.s.</text>
    <text x="${w * 0.57}" y="${h * 0.9}" font-family="DejaVu Sans" font-size="${h * 0.03}">D-4711-02  1.4301</text></svg>`;
  // šum jako skutečná fotka z telefonu (několik MB)
  const base = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  const px = base.data;
  for (let i = 0; i < px.length; i += 1) px[i] = Math.max(0, Math.min(255, px[i] + ((Math.random() * 24) | 0) - 12));
  return sharp(px, { raw: base.info }).jpeg({ quality: 92 }).withExif({ IFD0: { Make: "Apple", Model: "iPhone 15 Pro", Artist: "Jan Dvorak" } }).toBuffer();
}

async function sixMegPdf() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([1190.55, 841.89]);
  p.drawRectangle({ x: 20, y: 20, width: 1150, height: 800, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  p.drawText("STROJMETAL a.s.", { x: 700, y: 160, size: 12, font: helv });
  p.drawText("Kreslil: Ing. Jan Dvorak", { x: 700, y: 130, size: 8, font: helv });
  p.drawText(DRAWING_NO, { x: 760, y: 50, size: 14, font: helv });
  const noise = Buffer.alloc(1450 * 1450 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 256) | 0;
  const png = await sharp(noise, { raw: { width: 1450, height: 1450, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  p.drawImage(await doc.embedPng(png), { x: 60, y: 300, width: 200, height: 200 });
  return Buffer.from(await doc.save());
}

function cleanup() {
  const jobs = `select id from orders where number like 'Z-E2E-ANONHIRES28-%'`;
  sql(`delete from anon_send_queue where job_id in (${jobs})`);
  sql(`delete from drawing_anon_usage_log where subject_id in (select f.id from job_files f where f.job_id in (${jobs}))`);
  sql(`delete from job_files where job_id in (${jobs})`);
  sql(`delete from orders where number like 'Z-E2E-ANONHIRES28-%'`);
  sql(`delete from drawing_anon_usage_log where subject_id in (select id from drawings where drawing_number like 'E2E28-%')`);
  sql(`delete from documents where number like 'E2E28-%'`);
  sql(`delete from drawings where drawing_number like 'E2E28-%'`);
}
cleanup();

const salesId = sql(`select id from profiles where email='${USERS.obchod.email}'`);
const jobId = sql(`insert into orders (number, title, source, status, owner_id) values ('${NUMBER}', 'Fotka z telefonu (E2E)', 'manual', 'poptavka', '${salesId}') returning id`).split("\n")[0];
const PHOTO = path.join(DIR, `IMG_${STAMP}.jpg`);
fs.writeFileSync(PHOTO, await phoneJpg());
const PDF = path.join(DIR, `${DRAWING_NO}.pdf`);
fs.writeFileSync(PDF, await sixMegPdf());
const DWG = path.join(DIR, `sestava-${STAMP}.dwg`);
fs.writeFileSync(DWG, Buffer.from([...Buffer.from("AC1032"), 0, 0, 0, 0, ...Buffer.from("Strojmetal a.s.", "utf16le")]));
console.log(`    fotka ${(fs.statSync(PHOTO).size / MB).toFixed(1)} MB, PDF ${(fs.statSync(PDF).size / MB).toFixed(1)} MB`);

const env = localEnv();
async function storage(bucket, p) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${p}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`úložiště ${r.status} ${p}`);
  return Buffer.from(await r.arrayBuffer());
}

const browser = await launch();
const errors = [];
/** Žádný požadavek na aplikaci (server action / API) nesmí nést bajty souboru — limit Vercelu 4,5 MB, akce 1 MB. */
const bigBodies = [];
const watch = (context) => context.on("page", (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  p.on("request", (q) => {
    if (!q.url().startsWith(BASE)) return;
    const n = q.postDataBuffer()?.length ?? 0;
    if (n > 512 * 1024) bigBodies.push(`${q.method()} ${q.url()} ${(n / MB).toFixed(1)} MB`);
  });
});
const fileRow = (name) => sql(`select id || '|' || coalesce(anon_status, '') || '|' || storage_path || '|' || coalesce(anon_source_path, '') || '|' || coalesce(anon_path, '') || '|' || coalesce(anon_summary::text, '{}') from job_files where job_id='${jobId}' and filename like '${name}' and not archived order by created_at desc limit 1`).split("|");

await test("fotka 4032 px z Dokumentů: master v plném rozlišení, anonymizace sama, bez „nízkého rozlišení“", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ" });
  watch(context);
  const page = await context.newPage();
  try {
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    const input = page.getByText("Přetáhni sem soubory nebo je vyber").locator("visible=true").first()
      .locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]").locator("input[type=file]");
    await input.waitFor({ state: "attached", timeout: 30_000 });
    await input.setInputFiles(PHOTO);
    let r = [];
    for (let i = 0; i < 90; i++) {
      r = fileRow(`IMG_${STAMP}%`);
      if (r[1] && !/^(pending|processing)$/.test(r[1])) break;
      await page.waitForTimeout(2000);
    }
    const [, status, main, master, anonPath, summaryJson] = r;
    console.log(`    stav ${status}, hlavní ${main.split("/").pop()}, master ${master.replace(/^zakazky\/[^/]+\//, "")}`);
    expect(status === "done", `anonymizace doběhla — hotovo, nic ke kontrole (${status})`);
    expect(master === `zakazky/${jobId}/master/${main.split("/").pop().slice(0, 36)}`, `master u dokumentu (${master})`);
    const mainMeta = await sharp(await storage("job-files", main)).metadata();
    expect(Math.max(mainMeta.width, mainMeta.height) <= 2400, `hlavní kopie zmenšená (${mainMeta.width}×${mainMeta.height})`);
    const masterBytes = await storage("job-files", master);
    expect(masterBytes.length === fs.statSync(PHOTO).size, `master = originál z telefonu (${masterBytes.length} B)`);
    const codes = (JSON.parse(summaryJson).warnings ?? []).map((w) => w.code);
    expect(!codes.includes("no_master"), `bez varování „nízké rozlišení“ (${codes.join(", ")})`);
    const out = await storage("job-files", anonPath);
    const m = await sharp(out).metadata();
    console.log(`    kopie pro dodavatele ${m.width}×${m.height}, varování: ${codes.join(", ") || "—"}`);
    expect(Math.max(m.width, m.height) === 4032, `kopie pro dodavatele v plném rozlišení (${m.width}×${m.height})`);
    expect(!m.exif && !/iPhone|Dvorak/.test(out.toString("latin1")), "kopie bez EXIF");
    expect(!bigBodies.length, `žádné bajty souboru přes aplikaci (${bigBodies.join("; ")})`);
    await page.reload();
    await page.getByText(`IMG_${STAMP}.jpg`).first().waitFor({ timeout: 30_000 });
    expect(await page.getByText("Fotka v nízkém rozlišení").count() === 0, "UI bez „Fotka v nízkém rozlišení“");
    await page.screenshot({ path: path.join(SHOTS, "28-dokumenty-foto.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

await test("archiv Výkresy: 6 MB PDF přímo do úložiště → zapsáno a hned anonymizováno", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ" });
  watch(context);
  const page = await context.newPage();
  try {
    await login(page, USERS.admin);
    await page.goto(`${BASE}/drawings`);
    const input = page.getByTestId("drawing-upload-input");
    await input.waitFor({ state: "attached", timeout: 30_000 });
    bigBodies.length = 0;
    await input.setInputFiles(PDF);
    await page.getByText(/uložen do archivu/).first().waitFor({ timeout: 90_000 });
    let st = "";
    for (let i = 0; i < 90; i++) {
      st = sql(`select coalesce(anon_status, '') || '|' || storage_path || '|' || coalesce(anon_path, '') from drawings where drawing_number = '${DRAWING_NO}'`);
      if (st && !/^(pending|processing)\|/.test(st)) break;
      await page.waitForTimeout(2000);
    }
    const [status, stored, anonPath] = st.split("|");
    console.log(`    archiv: ${stored} → ${status}`);
    expect(/^vykresy\/E2E28-/.test(stored), `uložen v archivu (${stored})`);
    expect(status === "done", `anonymizace doběhla sama — hotovo (${status})`);
    expect((await storage("documents", stored)).length === fs.statSync(PDF).size, "originál v archivu celý");
    expect(/^vykresy\/anon\//.test(anonPath), `kopie pro dodavatele (${anonPath})`);
    const left = sql(`select count(*) from storage.objects where bucket_id = 'documents' and name like 'vykresy/upload/%' and created_at > now() - interval '10 minutes' and metadata->>'size' = '${fs.statSync(PDF).size}'`);
    expect(left === "0", `dočasný soubor po uložení pryč (${left})`);
    expect(!bigBodies.length, `žádné bajty souboru přes server action (${bigBodies.join("; ")})`);
    await page.reload();
    await page.getByText(DRAWING_NO).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "28-archiv.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

await test("DWG: obchodník „Poslat originál“ nemá (návod), super admin s potvrzením ano (audit, bez názvu)", async () => {
  const sales = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ" });
  watch(sales);
  const sp = await sales.newPage();
  let dwgId = "";
  try {
    await login(sp, USERS.obchod);
    await sp.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    const input = sp.getByText("Přetáhni sem soubory nebo je vyber").locator("visible=true").first()
      .locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]").locator("input[type=file]");
    await input.waitFor({ state: "attached", timeout: 30_000 });
    await input.setInputFiles(DWG);
    for (let i = 0; i < 30 && !dwgId; i++) {
      dwgId = sql(`select id from job_files where job_id='${jobId}' and filename='sestava-${STAMP}.dwg' and anon_status='unsupported'`);
      if (!dwgId) await sp.waitForTimeout(1000);
    }
    expect(dwgId, "DWG nahraný („nelze automaticky“)");
    await sp.reload();
    await sp.getByText(`sestava-${STAMP}.dwg`).first().waitFor({ timeout: 30_000 });
    expect(await sp.getByTestId("anon-send-original").count() === 0, "obchodník tlačítko nevidí");
    const r = await sp.request.get(`${BASE}/api/drawings/anonymize/${dwgId}/download?original=1`);
    const j = await r.json();
    expect(r.status() === 403 && /jen super admin/.test(j.error) && /DXF/.test(j.error), `obchodník: zakázáno s návodem (${r.status()} ${j.error})`);
  } finally {
    await sales.close();
  }
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ", acceptDownloads: true });
  watch(admin);
  const ap = await admin.newPage();
  try {
    await login(ap, USERS.admin);
    await ap.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
    const btn = ap.getByTestId("anon-send-original").locator("visible=true").first();
    await btn.waitFor({ timeout: 30_000 });
    await btn.click();
    const dl = ap.getByTestId("anon-send-original-confirm").locator("visible=true").first();
    await dl.waitFor({ timeout: 15_000 });
    await ap.screenshot({ path: path.join(SHOTS, "28-poslat-original.png") });
    await dl.locator("input[type=checkbox]").check();
    const [download] = await Promise.all([ap.waitForEvent("download", { timeout: 30_000 }), ap.getByTestId("anon-send-original-download").click()]);
    const name = download.suggestedFilename();
    console.log(`    super admin stáhl: ${name}`);
    expect(name === "original.dwg", `originál bez původního názvu (${name})`);
    const audit = sql(`select count(*) from audit_log where action = 'anon_original_download' and entity_id = '${dwgId}'`);
    expect(audit === "1", `audit (${audit})`);
  } finally {
    await admin.close();
  }
});

await browser.close();
const ok = summary(errors);
cleanup();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(ok && !errors.length ? 0 : 1);
