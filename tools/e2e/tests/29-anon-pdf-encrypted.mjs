// „anonymizace stále nefunguje píše to: PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový
// soubor. to je blbost" (majitel 30. 10.). Obchodník nahraje do zakázky výkresy, jak chodí z CAD / ERP:
// PDF s heslem VLASTNÍKA (zákaz úprav / kopírování) v RC4-40, RC4-128, AES-128, AES-256 a s anotací →
// každé skončí hotovo (nic ke kontrole), výstup je čisté NEšifrované PDF bez úniku. PDF s heslem k OTEVŘENÍ →
// poctivé „zaheslované". Simulovaná porucha prostředí („Path2D is not defined", jako na Vercelu) při prvním
// pokusu → soubor se zpracuje znovu sám, nikdy „poškozené".
//   E2E_BASE_URL=http://localhost:3500 ANON_FAKE_DIR=<AI_FAKE_ANON serveru> node tools/e2e/tests/29-anon-pdf-encrypted.mjs
// Server: AI_FAKE_ANON=<adresář> (neutrální testovací AI; stejný adresář jako ANON_FAKE_DIR).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SHOTS = process.env.ANON_SHOTS || path.join(os.tmpdir(), "anon-enc-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const FAKE = process.env.ANON_FAKE_DIR || "";
const STAMP = Date.now().toString(36).toUpperCase();
const NUMBER = `Z-E2E-ANONENC29-${STAMP}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "anon-enc-"));
const LEAK = /strojmetal|dvo[rř][aá]k|jdvorak|777 ?123 ?456/i;
const PASSWORD_TEXT = "PDF je zaheslované — bez hesla k otevření ho nejde přečíst. Požádej o soubor bez hesla.";
const LIE = /poškozené nebo zaheslované|Požádej o nový soubor/;

// vzorky: src/lib/anonymize/__fixtures__/encrypted-pdf.ts (base64, pypdf)
const fixtures = fs.readFileSync(path.join(ROOT, "src/lib/anonymize/__fixtures__/encrypted-pdf.ts"), "utf8");
const fixture = (name) => new Uint8Array(Buffer.from(new RegExp(`export const ${name} = "([A-Za-z0-9+/=]+)"`).exec(fixtures)[1], "base64"));

/** Vektorový výkres s jedinečným obsahem (vlastní sha → vlastní porucha). */
async function plainPdf() {
  const doc = await PDFDocument.create();
  doc.setAuthor("Ing. Jan Dvořák");
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
  t("Material:", tbx + 265, tby + 92, 7); t("1.4301", tbx + 305, tby + 92);
  t("Cislo vykresu:", tbx + 5, tby + 30, 7); t(`D-${STAMP}`, tbx + 135, tby + 28, 14, bold);
  p.drawRectangle({ x: 200, y: 360, width: 420, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
  t("420 ±0,1", 390, 334, 9);
  return new Uint8Array(await doc.save());
}

// plná automatika (majitel 31. 10.): každý výkres skončí hotovo — nic „ke kontrole" (ani s anotací)
const FILES = [
  { name: `vlastnik-rc4-40-${STAMP}.pdf`, data: fixture("OWNER_RC4_40"), expect: /^done$/ },
  { name: `vlastnik-rc4-128-${STAMP}.pdf`, data: fixture("OWNER_RC4_128"), expect: /^done$/ },
  { name: `vlastnik-aes-128-${STAMP}.pdf`, data: fixture("OWNER_AES_128"), expect: /^done$/ },
  { name: `vlastnik-aes-256-${STAMP}.pdf`, data: fixture("OWNER_AES_256"), expect: /^done$/ },
  { name: `vlastnik-aes-128-anotace-${STAMP}.pdf`, data: fixture("OWNER_AES_128_ANNOT"), expect: /^done$/ },
  { name: `heslo-k-otevreni-${STAMP}.pdf`, data: fixture("USER_AES_128"), expect: /^unsupported$/ },
  { name: `porucha-${STAMP}.pdf`, data: await plainPdf(), expect: /^done$/, fault: true },
];

function cleanup() {
  const jobs = `select id from orders where number like 'Z-E2E-ANONENC29-%'`;
  sql(`delete from anon_send_queue where job_id in (${jobs})`);
  sql(`delete from drawing_anon_usage_log where subject_id in (select f.id from job_files f where f.job_id in (${jobs}))`);
  sql(`delete from job_files where job_id in (${jobs})`);
  sql(`delete from orders where number like 'Z-E2E-ANONENC29-%'`);
  sql(`delete from customers where name like 'E2E-ANONENC29 %'`);
}
cleanup();

const salesId = sql(`select id from profiles where email='${USERS.obchod.email}'`);
const customerId = sql(`insert into customers (name, email, contact_person, owner_id) values ('E2E-ANONENC29 ${STAMP} Strojmetal a.s.', 'jan.dvorak@strojmetal.cz', 'Ing. Jan Dvořák', '${salesId}') returning id`).split("\n")[0];
const jobId = sql(`insert into orders (number, title, source, status, owner_id, customer_id) values ('${NUMBER}', 'Poptávka — šifrovaná PDF (E2E)', 'manual', 'poptavka', '${salesId}', '${customerId}') returning id`).split("\n")[0];
for (const f of FILES) { f.fp = path.join(DIR, f.name); fs.writeFileSync(f.fp, f.data); }
const faulty = FILES.find((f) => f.fault);
const faultFile = FAKE ? path.join(FAKE, `${createHash("sha256").update(faulty.data).digest("hex")}.fault.json`) : "";

const env = localEnv();
async function storage(pathInBucket) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${pathInBucket}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`úložiště ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
function grepText(b) {
  const buf = Buffer.from(b);
  const raw = buf.toString("latin1");
  let s = raw;
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const a = m.index + m[0].length, e = raw.indexOf("endstream", a);
    try { s += inflateSync(buf.subarray(a, e)).toString("latin1"); } catch { /* obrázek */ }
  }
  return s;
}

const browser = await launch();
const errors = [];
const watch = (context) => context.on("page", (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
});
const row = (name) => sql(`select id || '|' || coalesce(anon_status, '') || '|' || coalesce(anon_reason, '') || '|' || coalesce(anon_path, '') || '|' || anon_attempts from job_files where job_id='${jobId}' and filename='${name}' and not archived order by created_at desc limit 1`).split("|");

await test("výkresy s heslem vlastníka / k otevření / s poruchou prostředí → konečný stav s pravdivým důvodem", async () => {
  expect(FAKE && fs.existsSync(FAKE), `ANON_FAKE_DIR = adresář AI_FAKE_ANON serveru (${FAKE})`);
  // porucha pro první pokus (spotřebuje se) — simulace „Path2D is not defined" z funkce na Vercelu
  fs.writeFileSync(faultFile, JSON.stringify({ message: "Path2D is not defined" }));
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
    await input.setInputFiles(FILES.map((f) => f.fp));
    let st = "";
    let sawRetry = "";
    for (let i = 0; i < 150; i++) {
      st = sql(`select count(*) filter (where anon_status in ('pending','processing')) || '/' || count(*) from job_files where job_id='${jobId}'`);
      const [, fst, freason] = row(faulty.name);
      if (fst === "pending" && freason) sawRetry = freason;
      if (st === `0/${FILES.length}`) break;
      await page.waitForTimeout(2000);
    }
    console.log(`    hotovo za ${Math.round((Date.now() - t0) / 1000)} s (čeká/celkem ${st})`);
    expect(st === `0/${FILES.length}`, `nic nečeká (${st})`);
    for (const f of FILES) {
      const [, status, reason, , attempts] = row(f.name);
      console.log(`    ${f.name.replace(`-${STAMP}`, "")} → ${status} (pokusů ${attempts})${reason ? ` — ${reason.slice(0, 100)}` : ""}`);
      expect(f.expect.test(status), `${f.name}: stav ${status} (${reason})`);
      expect(!LIE.test(reason), `${f.name}: žádné „poškozené nebo zaheslované" (${reason})`);
    }
    const [, , preason] = row(FILES[5].name);
    expect(preason === PASSWORD_TEXT, `heslo k otevření → pravdivé „zaheslované" (${preason})`);
    // porucha: první pokus selhal, soubor se zpracoval znovu sám
    const [, , , , fattempts] = row(faulty.name);
    expect(!fs.existsSync(faultFile), "porucha se při prvním pokusu spotřebovala");
    expect(Number(fattempts) >= 2, `po poruše další pokus (pokusů ${fattempts})`);
    if (sawRetry) {
      console.log(`    mezistav po poruše: „${sawRetry}"`);
      expect(/zkusí se znovu automaticky/.test(sawRetry) && !LIE.test(sawRetry), `mezistav poruchy = „zkusí se znovu" (${sawRetry})`);
    }
    const ev = sql(`select count(*) from job_events where job_id='${jobId}' and message ~ 'poškozené'`);
    expect(ev === "0", `historie zakázky bez „poškozené" (${ev})`);
    // UI: štítky bez točení, u zaheslovaného pravdivý důvod
    await page.reload();
    await page.getByText(FILES[5].name).first().waitFor({ timeout: 30_000 });
    const busy = await page.locator('[data-anon-status="pending"], [data-anon-status="processing"]').count();
    expect(busy === 0, `žádný odznak se netočí (${busy})`);
    const pwLi = page.locator("li", { hasText: FILES[5].name }).locator("visible=true").first();
    await pwLi.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const pwHtml = await pwLi.evaluate((el) => el.innerText + " " + [...el.querySelectorAll("[title]")].map((x) => x.getAttribute("title")).join(" "));
    expect(!/poškozené/.test(pwHtml), `zaheslované PDF v UI bez „poškozené" (${pwHtml.slice(0, 200)})`);
    await page.screenshot({ path: path.join(SHOTS, "29-dokumenty.png"), fullPage: true });
  } finally {
    await context.close();
    if (faultFile && fs.existsSync(faultFile)) fs.rmSync(faultFile);
  }
});

await test("výstupy: čisté nešifrované PDF (pdf-lib bez ignoreEncryption), bez textu, Info a anotací zákazníka", async () => {
  for (const f of FILES.filter((x) => x.expect.source !== "^unsupported$")) {
    const [, status, , p] = row(f.name);
    expect(p, `${f.name}: má kopii pro dodavatele (${status})`);
    const b = await storage(p);
    const lat = Buffer.from(b).toString("latin1");
    expect(lat.startsWith("%PDF-"), `${f.name}: výstup je PDF`);
    expect(!lat.includes("/Encrypt"), `${f.name}: výstup není šifrovaný`);
    const doc = await PDFDocument.load(b);
    expect(!doc.isEncrypted && doc.getPageCount() === 1, `${f.name}: pdf-lib ho otevře (stran ${doc.getPageCount()})`);
    expect(!LEAK.test(grepText(b)), `${f.name}: žádný text zákazníka ve výstupu`);
    expect(!/\/Author|\/Title|\/Annots|\/Font/.test(lat), `${f.name}: bez Info, anotací a písem`);
  }
  // originál zůstal šifrovaný (do úložiště se nesahá)
  const orig = sql(`select storage_path from job_files where job_id='${jobId}' and filename='${FILES[0].name}'`);
  expect(Buffer.from(await storage(orig)).toString("latin1").includes("/Encrypt"), "originál beze změny");
});

await browser.close();
const ok = summary(errors);
cleanup();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(ok && !errors.length ? 0 : 1);
