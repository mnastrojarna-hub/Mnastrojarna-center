// Smoke nového UI anonymizace výkresů (ne plné E2E 12): Poptávky (tlačítko „Anonymizovat výkres",
// odznak, sekce „Ke kontrole anonymizace"), samostatný nástroj před/po, editor na PDF (ťuknutí na řádek,
// Uložit) a na fotce (obdélník), menu Dokumentů (Stáhnout anonymizovaný / Upravit / ZIP pro dodavatele),
// karta Nastavení. Screenshoty desktop 1280 + mobil 390, světlý + tmavý režim → ANON_SHOTS.
//   E2E_BASE_URL=http://localhost:3500 CRON_SECRET=… ANON_SHOTS=<adresář> node tools/e2e/tests/16-drawing-anon-smoke.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test } from "../lib.mjs";

const SHOTS = process.env.ANON_SHOTS || path.join(os.tmpdir(), "anon-ui-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const SECRET = process.env.CRON_SECRET || "e2e-cron-secret";
const env = localEnv();
const STAMP = Date.now().toString(36).toUpperCase();
const NUMBER = `Z-E2E-ANONUI-${STAMP}`;

async function vectorPdf() {
  const doc = await PDFDocument.create();
  doc.setAuthor("Jan Novák");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 1190.55, H = 841.89;
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  const tbx = W - 540, tby = 20;
  p.drawRectangle({ x: tbx, y: tby, width: 520, height: 170, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  for (const yy of [50, 80, 110, 140]) p.drawLine({ start: { x: tbx, y: tby + yy }, end: { x: tbx + 520, y: tby + yy }, thickness: 0.5 });
  const t = (s, x, y, size = 8, f = helv) => p.drawText(s, { x, y, size, font: f, color: rgb(0, 0, 0) });
  t("STROJMETAL a.s.", tbx + 50, tby + 150, 12, bold);
  t("Tel.: +420 312 456 789", tbx + 200, tby + 148, 7);
  t("Kreslil:", tbx + 5, tby + 122, 7); t("J. Novák", tbx + 50, tby + 122);
  t("Schvalil:", tbx + 265, tby + 122, 7); t("Ing. P. Dvorak", tbx + 310, tby + 122);
  t("Nazev:", tbx + 5, tby + 92, 7); t("Hridel vstupni", tbx + 40, tby + 92, 9, bold);
  t("Material:", tbx + 265, tby + 92, 7); t("1.4301 CSN EN 10088-2", tbx + 305, tby + 92);
  t("Meritko: 1:2", tbx + 5, tby + 62); t("ISO 2768-mK", tbx + 265, tby + 62);
  t("Cislo vykresu:", tbx + 5, tby + 30, 7); t("D-1234-01", tbx + 135, tby + 28, 14, bold); t("Revize: B", tbx + 395, tby + 30, 9);
  t("C:\\Projekty\\Strojmetal\\D-1234.dwg  23.10.2026 14:05  novak", 30, 26, 6);
  p.drawRectangle({ x: 200, y: 360, width: 420, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
  t("420 ±0,1", 390, 334, 9); t("Ø25 h7", 640, 415, 9); t("Ra 1,6", 300, 490);
  t("Poznamky: Nekotovane hrany srazit 0,5x45°", 60, 300); t("Kalit na 58±2 HRC", 60, 288);
  return new Uint8Array(await doc.save());
}

async function photoJpeg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1700">
    <rect width="2400" height="1700" fill="#efeee8"/>
    <rect x="60" y="60" width="2280" height="1580" fill="#fff" stroke="#111" stroke-width="5"/>
    <rect x="1300" y="1220" width="1000" height="380" fill="none" stroke="#111" stroke-width="4"/>
    <text x="1340" y="1300" font-family="DejaVu Sans, Arial" font-size="56" font-weight="bold">ACME Forge GmbH</text>
    <text x="1340" y="1390" font-family="DejaVu Sans, Arial" font-size="40">Kreslil: K. Svoboda</text>
    <text x="1340" y="1470" font-family="DejaVu Sans, Arial" font-size="40">Materiál: S235JR</text>
    <text x="1340" y="1560" font-family="DejaVu Sans, Arial" font-size="52" font-weight="bold">Č. výkresu: 77-100</text>
    <rect x="400" y="400" width="900" height="400" fill="none" stroke="#111" stroke-width="4"/>
    <text x="760" y="860" font-family="DejaVu Sans, Arial" font-size="44">900 ±0,2</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer());
}

async function storagePut(p, bytes, type) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${p}`, {
    method: "POST", headers: { authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, apikey: env.SUPABASE_SECRET_KEY, "content-type": type, "x-upsert": "true" }, body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${p}: ${r.status} ${await r.text()}`);
}

async function runAnon(id) {
  const r = await fetch(`${BASE}/api/cron/drawing-anonymize/run`, {
    method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ table: "job_files", ids: [id] }),
  });
  return r.json();
}

/** Počkat, až se v editoru načte serverový náhled (render PDF / fotky může trvat). */
async function waitImg(page) {
  await page.waitForFunction(() => {
    const i = [...document.querySelectorAll("[data-testid=anon-surface] img")].find((x) => x.offsetParent !== null);
    return i && i.complete && i.naturalWidth > 0;
  }, null, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Viditelný prvek (při streamování RSC je kopie chvíli i ve skrytém <div hidden>). */
const vis = (page, id) => page.getByTestId(id).locator("visible=true").first();
const q = (s) => s.replace(/'/g, "''");
function cleanup() {
  sql(`delete from anon_send_queue where job_id in (select id from orders where number like 'Z-E2E-ANONUI-%')`);
  sql(`delete from job_files where job_id in (select id from orders where number like 'Z-E2E-ANONUI-%')`);
  sql(`delete from orders where number like 'Z-E2E-ANONUI-%'`);
}
cleanup();
let jobId = "", pdfId = "", photoId = "";
const pdfBytes = await vectorPdf();
const tmpPdf = path.join(os.tmpdir(), `D-1234-${STAMP}.pdf`);
fs.writeFileSync(tmpPdf, pdfBytes);

await test("příprava: zakázka v poptávce s PDF výkresem (e-mail) a fotkou výkresu", async () => {
  const adminId = sql(`select id from profiles where email='${USERS.admin.email}'`);
  jobId = sql(`insert into orders (number, title, source, status, owner_id) values ('${NUMBER}', 'Hřídel — anonymizace (smoke)', 'manual', 'poptavka', '${adminId}') returning id`).split("\n")[0];
  const pp = `zakazky/${jobId}/${randomUUID()}-D-1234-01.pdf`;
  const fp = `zakazky/${jobId}/${randomUUID()}-foto-vykresu.jpg`;
  await storagePut(pp, pdfBytes, "application/pdf");
  await storagePut(fp, await photoJpeg(), "image/jpeg");
  pdfId = sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, origin, issuer, uploaded_by) values ('${jobId}', 'ostatni', 'D-1234-01.pdf', 'application/pdf', ${pdfBytes.length}, '${q(pp)}', 'email', 'zakaznik', '${adminId}') returning id`).split("\n")[0];
  photoId = sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, origin, issuer, uploaded_by) values ('${jobId}', 'foto', 'foto-vykresu.jpg', 'image/jpeg', 1000, '${q(fp)}', 'capture', 'zakaznik', '${adminId}') returning id`).split("\n")[0];
  expect(sql(`select anon_status from job_files where id='${pdfId}'`) === "pending", "trigger zařadil PDF (pending)");
  const a = await runAnon(pdfId);
  const b = await runAnon(photoId);
  // běh po svém souboru sám pokračuje frontou (fotku mohl převzít dřív než druhé volání) → počkat na výsledek
  for (let i = 0; i < 60 && /pending|processing/.test(sql(`select string_agg(anon_status, ',') from job_files where job_id='${jobId}'`)); i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  const st = sql(`select string_agg(anon_status, ',' order by filename) from job_files where job_id='${jobId}'`);
  console.log(`    stavy: ${st} · ${JSON.stringify(a.results?.[0]?.status)} ${JSON.stringify(b.results?.[0]?.status)}`);
  expect(/done|review/.test(sql(`select anon_status from job_files where id='${pdfId}'`)), "PDF hotové / ke kontrole");
  expect(sql(`select anon_status from job_files where id='${photoId}'`) === "review", "fotka bez masteru → ke kontrole");
});

const CONFIGS = [
  { tag: "desktop-light", mobile: false, dark: false },
  { tag: "mobile-light", mobile: true, dark: false },
  { tag: "desktop-dark", mobile: false, dark: true },
  { tag: "mobile-dark", mobile: true, dark: true },
];
const browser = await launch();
const errors = [];

async function ctxFor(c) {
  const context = await browser.newContext(c.mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" }
    : { viewport: { width: 1280, height: 860 }, locale: "cs-CZ", colorScheme: c.dark ? "dark" : "light" });
  await context.addInitScript((dark) => { try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* */ } }, c.dark);
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
    p.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  return context;
}

const shotPath = (name, c) => path.join(SHOTS, `${name}-${c.tag}.png`);

for (const c of CONFIGS) {
  const first = c.tag === "desktop-light";
  await test(`${c.tag}: Poptávky — tlačítko, odznak, Ke kontrole; nástroj před/po; editor; dokumenty; nastavení`, async () => {
    const context = await ctxFor(c);
    const page = await context.newPage();
    try {
      await login(page, USERS.admin);
      await page.goto(`${BASE}/inquiries`);
      const btn = vis(page, "anon-tool-open");
      await btn.waitFor({ timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await page.getByTestId("anon-tool-open").locator("visible=true").count() === 1, "jediné viditelné tlačítko v hlavičce");
      // řádek poptávky (ne položka sekce „Ke kontrole", která je teď nad seznamem)
      const row = page.locator("li:not([data-testid=anon-review-item])", { hasText: NUMBER }).filter({ has: page.locator("[data-anon-badge]") }).first();
      await row.waitFor({ timeout: 20_000 });
      const badge = row.locator("[data-anon-badge]");
      expect(await badge.count() === 1, "odznak anonymizace u poptávky");
      const badgeText = await badge.innerText();
      expect(/ke kontrole/.test(badgeText) && (/Výkresy \d\/2/.test(badgeText) || /\+\d/.test(badgeText)), `text odznaku: ${badgeText}`);
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: shotPath("01-poptavky-tlacitko-odznak", c) });
      await page.locator("h1").first().scrollIntoViewIfNeeded();
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector("main")?.scrollTo?.(0, 0); });
      await page.screenshot({ path: shotPath("01b-poptavky-hlavicka", c) });

      const review = vis(page, "anon-review");
      await review.waitFor({ timeout: 10_000 });
      const photoItem = review.locator("[data-testid=anon-review-item]", { hasText: "foto-vykresu.jpg" }).first();
      expect(await photoItem.count() === 1, "fotka v sekci Ke kontrole (pod původním názvem)");
      // fotka / nic nesmazáno → „Schválit" otevře editor (žádné tiché schválení)
      expect(await photoItem.getByTestId("anon-review-approve").getAttribute("data-approve") === "editor", "fotka se schvaluje přes editor");
      // sekce je nad seznamem poptávek + čip v hlavičce
      const order = await page.evaluate(() => {
        const s = [...document.querySelectorAll("#anonymizace")].find((e) => e.offsetParent !== null);
        const list = [...document.querySelectorAll("li")].find((e) => e.offsetParent !== null && /Z-E2E-ANONUI-/.test(e.textContent ?? ""));
        return s && list ? s.getBoundingClientRect().top < list.getBoundingClientRect().top : null;
      });
      expect(order === true, "Ke kontrole anonymizace je nad seznamem poptávek");
      expect(await vis(page, "anon-review-chip").count() === 1, "čip „ke kontrole anonymizace“ v hlavičce");
      await review.scrollIntoViewIfNeeded();
      await page.screenshot({ path: shotPath("02-ke-kontrole", c) });

      // samostatný nástroj
      await page.evaluate(() => window.scrollTo(0, 0));
      await btn.click();
      const tool = vis(page, "anon-tool");
      await tool.waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: shotPath("03-nastroj-pred", c) });
      if (first) {
        await tool.getByTestId("anon-tool-input").setInputFiles(tmpPdf);
      }
      const item = tool.locator("[data-testid=anon-tool-item]").first();
      await item.waitFor({ timeout: 20_000 });
      await page.waitForFunction(() => {
        const el = document.querySelector("[data-testid=anon-tool-item]");
        return el && ["done", "review", "failed"].includes(el.getAttribute("data-status") ?? "");
      }, null, { timeout: 120_000 });
      const st = await item.getAttribute("data-status");
      expect(st === "done" || st === "review", `nástroj: výsledek ${st}`);
      // náhledy Před / Po (výřez razítka) dorazí ze serveru
      await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll("[data-testid=anon-tool-item] [data-testid^=anon-tool-thumb] img")].slice(0, 2);
        return imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      }, null, { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.screenshot({ path: shotPath("04-nastroj-po", c) });
      if (first && st === "done") {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), item.getByTestId("anon-tool-download").click()]);
        const name = dl.suggestedFilename();
        const fp = path.join(os.tmpdir(), `anon-dl-${STAMP}.pdf`);
        await dl.saveAs(fp);
        const txt = fs.readFileSync(fp).toString("latin1");
        expect(!/STROJMETAL|Nov.k|Projekty/.test(txt), "stažený soubor bez firmy, jména a cesty (bez textové vrstvy)");
        expect(!/^tmp|D-1234-STAMP/i.test(name), `anonymní název: ${name}`);
      }
      await page.keyboard.press("Escape");

      // editor na fotce (z Ke kontrole)
      await review.locator("[data-testid=anon-review-item]", { hasText: NUMBER }).first().getByTestId("anon-review-open").click();
      const editor = vis(page, "anon-editor");
      await editor.waitFor();
      await waitImg(page);
      if (first) {
        await vis(page, "anon-mode-rect").click();
        const surf = vis(page, "anon-surface");
        const bb = await surf.boundingBox();
        // celá stránka je při 100 % vidět → razítko vpravo dole (firma „ACME Forge GmbH")
        await page.mouse.move(bb.x + bb.width * 0.54, bb.y + bb.height * 0.72);
        await page.mouse.down();
        await page.mouse.move(bb.x + bb.width * 0.80, bb.y + bb.height * 0.78, { steps: 6 });
        await page.mouse.up();
        const save = await vis(page, "anon-save").innerText();
        expect(/\+1/.test(save), `obdélník přidán: ${save}`);
      }
      await waitImg(page);
      await page.screenshot({ path: shotPath("05-editor-fotka", c) });
      if (c.mobile) {
        // mobil: nástroje v jedné řadě, spodní lišta jedna řada, náhled na celou šířku
        const tb = await page.locator("[role=toolbar]").locator("visible=true").first().boundingBox();
        const ft = await vis(page, "anon-save").evaluate((el) => el.parentElement.getBoundingClientRect().height);
        const w = await vis(page, "anon-surface").evaluate((el) => el.getBoundingClientRect().width);
        expect(tb && tb.height <= 60, `lišta nástrojů v jedné řadě (${tb?.height} px)`);
        expect(ft <= 80, `spodní lišta v jedné řadě (${Math.round(ft)} px)`);
        expect(w >= 340, `náhled na celou šířku (${Math.round(w)} px)`);
      }
      await page.keyboard.press("Escape");

      // dokumenty zakázky: menu + editor PDF
      await page.goto(`${BASE}/orders/${jobId}?tab=dokumenty`);
      const fileRow = page.locator("li", { hasText: "D-1234-01.pdf" }).locator("visible=true").first();
      await fileRow.waitFor({ timeout: 30_000 });
      expect(await fileRow.locator("[data-anon-status]").count() === 1, "odznak u dokumentu");
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await vis(page, "supplier-pack").waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow <= 1, `dokumenty bez vodorovného posunu stránky (${overflow} px)`);
      // viditelná akce „Pro dodavatele" u anonymizovaného dokumentu; ikona stažení = originál (interně)
      expect(await fileRow.getByTestId("anon-for-supplier").count() === 1, "řádek má akci „Pro dodavatele“");
      expect(await fileRow.getByRole("link", { name: "Stáhnout originál (interně)" }).count() === 1, "ikona stažení je označená jako originál");
      await page.evaluate(() => window.scrollTo(0, 0));
      await fileRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: shotPath("06a-dokumenty-radek", c) });
      // fotka ke kontrole: stažení pro dodavatele s náhledem „Po"
      const photoRow = page.locator("li", { hasText: "foto-vykresu.jpg" }).locator("visible=true").first();
      await photoRow.getByTestId("anon-for-supplier").click();
      await vis(page, "anon-review-preview").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: shotPath("10-stazeni-ke-kontrole", c) });
      await page.keyboard.press("Escape");
      await fileRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await fileRow.getByRole("button", { name: "Další akce dokumentu" }).click();
      await vis(page, "anon-edit").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("06-dokumenty-menu", c) });
      await vis(page, "anon-edit").click();
      await editor.waitFor();
      await waitImg(page);
      if (first) {
        // ťuknutí na řádek „Tel.: …" už smazaný → nechat → Uložit (+0, −n)
        const surf = vis(page, "anon-surface");
        const bb = await surf.boundingBox();
        await page.mouse.click(bb.x + bb.width * ((1190.55 - 540 + 30) / 1190.55), bb.y + bb.height * ((841.89 - 20 - 92 - 4) / 841.89));
        await page.waitForTimeout(300);
        const label = await vis(page, "anon-save").innerText();
        console.log(`    editor PDF po ťuknutí: ${label}`);
        // ťuknutí na název dílu (chráněné pole) → potvrzení, ne tiché smazání
        await page.mouse.click(bb.x + bb.width * ((1190.55 - 540 + 60) / 1190.55), bb.y + bb.height * ((841.89 - 20 - 92 - 4) / 841.89));
        await page.waitForTimeout(300);
        expect(await vis(page, "anon-confirm-keep").count() === 1, "název dílu chce potvrzení smazání");
        await page.screenshot({ path: shotPath("07c-editor-pdf-chranene", c) });
        await page.getByRole("button", { name: "Nechat" }).locator("visible=true").first().click();
      }
      await page.screenshot({ path: shotPath("07-editor-pdf", c) });
      // Razítko: celé razítko vidět (zoom podle skutečného okna)
      await vis(page, "anon-zoom-stamp").click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: shotPath("07b-editor-pdf-razitko", c) });
      await page.keyboard.press("Escape");

      // ZIP pro dodavatele (dialog)
      await vis(page, "supplier-pack").click();
      await vis(page, "supplier-pack-build").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("08-zip-dodavatel", c) });
      await page.keyboard.press("Escape");

      // nastavení
      await page.goto(`${BASE}/settings`);
      const card = vis(page, "anon-settings");
      await card.waitFor({ timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      const dup = await page.evaluate(() => [...document.querySelectorAll("#anonymizace")].map((e) => { const c = []; let x = e.parentElement; while (x && c.length < 8) { c.push(x.tagName + (x.id ? "#" + x.id : "") + (x.hidden ? "[hidden]" : "")); x = x.parentElement; } return c.join("<"); }));
      if (dup.length > 1) console.log(`    pozor: #anonymizace ${dup.length}×: ${dup.join(" | ")}`);
      await page.evaluate(() => document.querySelector("main #anonymizace")?.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("09-nastaveni", c) });
      await page.evaluate(() => document.querySelector("main [data-testid=anon-settings-save]")?.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotPath("09b-nastaveni-dole", c) });
    } finally {
      await context.close();
    }
  });
}

await browser.close();
try { fs.unlinkSync(tmpPdf); } catch { /* */ }
if (!process.env.ANON_KEEP) cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
