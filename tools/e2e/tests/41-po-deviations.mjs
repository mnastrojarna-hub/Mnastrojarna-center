// E2E 41 · Objednávka dodavateli — odchylky od výkresu a výkresy v příloze (majitel 2. 11.): „Pokud vystavím objednávku
// [dodavateli] a jsou tam nějaké opravy oproti výkresu, musí se to zanést do textu objednávky i mailu. Musí to k objednávce
// přikládat všechny výkresy dotyčné položky … stejně tak modely, pokud máme." + „To přikládání myslím do mailu."
//  1. Obchodník (vlastní schránka na testovacím poštovním serveru) → Nákup → Vystavit objednávku jen na položku A:
//     sekce „Odchylky od výkresu" předvyplněná (pokyn zákazníka z e-mailu — materiál, nová revize C), doplní vlastní.
//  2. Poslat dodavateli e-mailem: přílohy = výkres A (anonymizovaný, neutrální název) + 3D model A zaškrtnuté, stará
//     revize nabídnutá nezaškrtnutá, výkres položky B ani poptávka zákazníka v seznamu nejsou.
//  3. Testovací SMTP: e-mail s PDF objednávky + A_C.pdf (anonymizovaná kopie) + A_C.step (originál modelu); text a PDF
//     („Odchylka od výkresu — platí místo výkresu") s odchylkami; nikde zákazník (jméno, IČO, číslo objednávky).
//  4. Nová revize výkresu A (D) → banner „Poslat dodavateli novou revizi" → změna objednávky: příloha A_D.pdf,
//     v textu „revize C je nahrazena a neplatí"; 390 px bez přetékání.
// Spuštění (aplikace musí znát testovací poštovní server — MAIL_TEST_PROVIDERS, NODE_EXTRA_CA_CERTS):
//   node tools/e2e/mail-test-server.mjs --dir <dir> --base 35000 &
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3500 [PODEV_SHOTS=<adresář>] node tools/e2e/tests/41-po-deviations.mjs
// Vlastní data „E2E41-" (uživatel, zákazník, dodavatel, zakázka, schránka), na konci se uklidí.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BASE, launch, withContext, sql, localEnv, test, expect, summary } from "../lib.mjs";
import { lit, eventually, waitHydrated, expectNoOverflow, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const CTL = `http://127.0.0.1:${SRV.ports.control}`;
const SHOTS = process.env.PODEV_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
function loadMailparser() {
  const roots = [ROOT];
  try { roots.push(path.dirname(fs.realpathSync(path.join(ROOT, "node_modules")))); } catch { /* bez odkazu */ }
  for (const r of roots) {
    try { return createRequire(path.join(r, "tools/local-supabase/package.json"))("mailparser"); } catch { /* další */ }
  }
  throw new Error("Chybí mailparser (tools/local-supabase: npm ci)");
}
const { simpleParser } = loadMailparser();

const BOX = "objednavky41@nastrojarstvi.test";
const BOX_PASS = "Objednavky41-Heslo-1";
const P = "E2E41-";
const TAG = Date.now().toString(36).toUpperCase();
const DIGITS = String(Date.now() % 1_000_000);
const CUSTOMER = `Kovolis Hranice ${DIGITS} s.r.o.`;
const ICO = String(30_000_000 + (Date.now() % 60_000_000));
const CPO = `PO-${DIGITS}-41`;
const USER = { email: `e2e41-${TAG.toLowerCase()}@local.test`, password: "Objednavky41-Prihlaseni-1!", name: `Olga Objednávková ${TAG}` };
const DN_A = `PR-${TAG}-1`;
const DN_B = `PZ-${TAG}-2`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const browser = await launch();
const errors = [];

console.log(`41 · Objednávka dodavateli: odchylky od výkresu a přílohy (značka ${TAG}, SMTP ${SRV.ports.smtps}, ovládání ${SRV.ports.control})`);

async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
const sentRaw = async () => (await ctl("/sent?full=1")).map((m) => ({ ...m, to: (m.to ?? []).map((t) => (/<([^>]+)>/.exec(t)?.[1] ?? String(t)).trim().toLowerCase()) }));

async function adminApi(method, p, body) {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/${p}`, {
    method,
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GoTrue ${method} ${p}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ── data ─────────────────────────────────────────────────────
const storagePaths = [];
async function upload(p, buf, type = "application/pdf") {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${p}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": type, "x-upsert": "true" },
    body: buf,
  });
  if (!r.ok) throw new Error(`upload ${p}: ${r.status} ${await r.text()}`);
  storagePaths.push(p);
}
function tinyPdf(text) {
  const body = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj`,
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  for (const o of objs) { offs.push(out.length); out += `${o}\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function cleanup() {
  const jobs = sql(`select id from orders where title like ${lit(`${P}%`)}`).split("\n").filter(Boolean);
  if (jobs.length) {
    const inList = jobs.map(lit).join(",");
    const paths = sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null union all select anon_path from job_files where job_id in (${inList}) and anon_path is not null`).split("\n").filter(Boolean);
    await removeStorageFiles(paths);
    sql(`delete from anon_send_queue where job_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where diff->>'jobId' in (${inList})`);
  }
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = ${lit(BOX)})`);
  sql(`delete from mailboxes where email = ${lit(BOX)}`);
  sql(`delete from suppliers where name like ${lit(`${P}%`)}`);
  sql(`delete from customers where name like 'Kovolis Hranice %'`);
  const users = sql(`select id from profiles where email like 'e2e41-%@local.test'`).split("\n").filter(Boolean);
  for (const id of users) {
    try { sql(`delete from commission_rules where owner_id = ${lit(id)}`); } catch { /* bez pravidel */ }
    try { await adminApi("DELETE", `users/${id}`); } catch { sql(`update profiles set active = false where id = ${lit(id)}`); }
  }
  return jobs.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

const u = await adminApi("POST", "users", { email: USER.email, password: USER.password, email_confirm: true, user_metadata: { full_name: USER.name } });
const UID = u.id ?? u.user?.id;
sql(`update profiles set role = 'obchodnik', full_name = ${lit(USER.name)}, active = true, password_change_required = false where id = ${lit(UID)}`);

const CUST = sql(`insert into customers (name, ico, dic, country, owner_id, email, contact_person, city)
  values (${lit(CUSTOMER)}, ${lit(ICO)}, ${lit(`CZ${ICO}`)}, 'CZ', ${lit(UID)}, ${lit(`nakup@kovolis-${DIGITS}.test`)}, 'Ing. Hana Kovolisová', 'Hranice') returning id`).split("\n")[0];
const SUP_MAIL = `kooperant41-${TAG.toLowerCase()}@dodavatel.test`;
const SUP = sql(`insert into suppliers (name, email, technologies) values (${lit(`${P}Kooperant ${TAG}`)}, ${lit(SUP_MAIL)}, array['frezovani']) returning id`).split("\n")[0];
const JOB_NUMBER = `Z-E2E41-${TAG}`;
const JOB = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, supplier_id, priority, due_date, customer_order_number, order_status)
  values (${lit(JOB_NUMBER)}, ${lit(`${P}příruby a pouzdra`)}, 'potvrzeno', 'manual', ${lit(UID)}, ${lit(UID)}, ${lit(CUST)}, ${lit(SUP)}, 'stredni', app_today() + 30, ${lit(CPO)}, 'potvrzena') returning id`).split("\n")[0];
const ITEM_A = sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
  values (${lit(JOB)}, 0, ${lit(DN_A)}, 'B', 'Příruba DN50', '1.4301', 20, 'ks') returning id`).split("\n")[0];
const ITEM_B = sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
  values (${lit(JOB)}, 1, ${lit(DN_B)}, 'A', 'Pouzdro', 'C45', 10, 'ks') returning id`).split("\n")[0];

/** Výkres s hotovou anonymizovanou kopií (původní název nese jméno zákazníka). */
async function drawing(item, dn, rev, archived = false) {
  const id = randomUUID();
  const orig = `zakazky/${JOB}/${id}-Kovolis_${dn}_${rev}.pdf`;
  const anon = `zakazky/${JOB}/anon/${id}.pdf`;
  const anonBuf = tinyPdf(`VYKRES ${dn} REV ${rev}`);
  await upload(orig, tinyPdf(`KOVOLIS ${dn} ${rev}`));
  await upload(anon, anonBuf);
  const fid = sql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, anon_status, anon_path, anon_filename, anon_mime, anon_sha256, anon_size, size_bytes, uploaded_by, archived)
    values (${lit(JOB)}, 'vykres', ${lit(`Výkres ${dn}`)}, ${lit(`${CUSTOMER} ${dn} rev ${rev}.pdf`)}, 'application/pdf', ${lit(orig)}, ${lit(item)}, 'done', ${lit(anon)}, ${lit(`${dn}_${rev}.pdf`)},
      'application/pdf', ${lit(createHash("sha256").update(anonBuf).digest("hex"))}, ${anonBuf.length}, ${anonBuf.length}, ${lit(UID)}, ${archived}) returning id`).split("\n")[0];
  return { id: fid, anon: anonBuf };
}
const OLD_A = await drawing(ITEM_A, DN_A, "B", true);
const CUR_A = await drawing(ITEM_A, DN_A, "C");
sql(`update job_files set replaced_by = ${lit(CUR_A.id)} where id = ${lit(OLD_A.id)}`);
const DRAW_B = await drawing(ITEM_B, DN_B, "A");
const STEP = Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('${CUSTOMER}');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);
const stepPath = `zakazky/${JOB}/${randomUUID()}-Kovolis_${DN_A}.step`;
await upload(stepPath, STEP, "application/octet-stream");
const MODEL_A = sql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, size_bytes, uploaded_by)
  values (${lit(JOB)}, 'model_3d', '3D model', ${lit(`${CUSTOMER} ${DN_A}.step`)}, 'application/octet-stream', ${lit(stepPath)}, ${lit(ITEM_A)}, ${STEP.length}, ${lit(UID)}) returning id`).split("\n")[0];
// poptávka zákazníka (doklad zákazníka — nikdy k dodavateli)
const inqPath = `zakazky/${JOB}/${randomUUID()}-poptavka.pdf`;
await upload(inqPath, tinyPdf(`POPTAVKA ${CUSTOMER} ${DN_A}`));
sql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, uploaded_by, anon_status) values (${lit(JOB)}, 'poptavka', 'Poptávka', ${lit(`Poptavka ${DN_A}.pdf`)}, 'application/pdf', ${lit(inqPath)}, ${lit(UID)}, 'skipped')`);
// nová revize A (B → C) a pokyn zákazníka z e-mailu nadřazený výkresu (propsaný)
sql(`update order_items set revision = 'C' where id = ${lit(ITEM_A)}`);
sql(`update job_drawing_changes set file_id = ${lit(CUR_A.id)}, old_file_id = ${lit(OLD_A.id)}, acknowledged_at = now() where order_item_id = ${lit(ITEM_A)}`);
sql(`insert into job_mail_changes (job_id, order_item_id, kind, field, summary, value_new, value_prev, drawing_value, status, party)
  values (${lit(JOB)}, ${lit(ITEM_A)}, 'change', 'material', 'Materiál: 1.4404', '1.4404', '1.4301', '1.4301', 'applied', 'customer')`);
sql(`update order_items set material = '1.4404', material_designation = '1.4404' where id = ${lit(ITEM_A)}`);

const FORBIDDEN = [CUSTOMER, "Kovolis", ICO, CPO, "Kovolisová", `kovolis-${DIGITS}`];
function noCustomer(text, what) {
  const low = String(text ?? "").toLowerCase();
  for (const f of FORBIDDEN) expect(!low.includes(f.toLowerCase()), `${what}: bez „${f}“`);
}
async function pdfText(buf) {
  const pdfjs = await import(path.join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += `${c.items.map((x) => x.str).join(" ")}\n`;
  }
  return out;
}
/** PDF → PNG (1. strana) do snímků. */
function pdfShot(buf, name) {
  if (!SHOTS) return;
  const tmp = path.join(os.tmpdir(), `e2e41-${randomUUID()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", tmp, path.join(SHOTS, name)]);
  } catch (err) {
    console.log(`    (náhled PDF: ${String(err.message ?? err).split("\n")[0]})`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function loginAs(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(USER.email);
  await page.locator("#password").fill(USER.password);
  await Promise.all([
    page.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: /^přihlásit se$/i }).click(),
  ]);
}
const open = async (page, q = "") => {
  await page.goto(`${BASE}/orders/${JOB}${q}`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.waitForLoadState("networkidle").catch(() => {});
};
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

let PO_ID = "";
let PO_NUMBER = "";

await T("obchodník si připojí vlastní schránku (testovací poštovní server)", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle");
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  if (!(await form.isVisible().catch(() => false))) await page.locator('[data-testid="my-mailbox-add"]:visible').first().click();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(BOX_PASS);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = ${lit(BOX)}`) === UID, "schránka patří obchodníkovi");
  await page.close();
});

await T("Vystavit objednávku jen na položku A: odchylky od výkresu předvyplněné (e-mail zákazníka, nová revize) + vlastní", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  await open(page, "?tab=nakup");
  await page.getByRole("button", { name: /^Vystavit objednávku/ }).first().click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Vystavit objednávku dodavateli" });
  await dlg.waitFor({ timeout: 20_000 });
  const dev = dlg.getByTestId("po-deviations");
  await dev.waitFor({ timeout: 30_000 });
  // položka B pryč (objednávka jen na A)
  const rows = dlg.locator("table tbody tr");
  await eventually(async () => expect(await rows.count() === 2, `2 položky ze zakázky (${await rows.count()})`));
  await rows.nth(1).getByRole("button", { name: "Odebrat položku" }).click();
  await eventually(async () => expect(await dlg.getByTestId("po-deviation-item").count() === 1, "odchylky jen u položky A"));
  const t = norm(await dev.innerText());
  expect(t.includes(DN_A) && t.includes("Materiál") && t.includes("na výkresu: 1.4301") && t.includes("z e-mailu zákazníka"), `materiál z e-mailu (${t})`);
  expect(t.includes("Revize výkresu") && t.includes("dříve: B"), `nová revize (${t})`);
  expect(!t.includes(DN_B), "položka B bez odchylek v seznamu");
  // vlastní odchylka (obchodník doplní)
  await dev.getByRole("button", { name: "Odchylka" }).click();
  await dev.getByLabel("Co se mění").last().fill("Sražení hran");
  await dev.getByLabel(`Platí místo výkresu — ${DN_A}`).last().fill("0,5×45° všude");
  await snap(page, "01-vystavit-odchylky");
  await dlg.getByRole("button", { name: "Vystavit objednávku" }).click();
  const done = page.getByRole("dialog").filter({ hasText: /Objednávka OV-.* vystavena/ });
  await done.waitFor({ timeout: 60_000 });
  PO_ID = sql(`select id from purchase_orders where job_id = ${lit(JOB)}`);
  PO_NUMBER = sql(`select number from purchase_orders where id = ${lit(PO_ID)}`);
  expect(/^OV-/.test(PO_NUMBER), `číslo ${PO_NUMBER}`);
  const stored = JSON.parse(sql(`select drawing_deviations::text from purchase_order_items where purchase_order_id = ${lit(PO_ID)}`));
  expect(stored.length === 3 && stored.some((d) => d.source === "rucne" && d.value === "0,5×45° všude"), `potvrzený seznam uložen (${JSON.stringify(stored)})`);
  expect(sql(`select order_item_id from purchase_order_items where purchase_order_id = ${lit(PO_ID)}`) === ITEM_A, "vazba na díl A");
  await page.close();
});

await T("Poslat dodavateli: přílohy jen položky A (výkres anonymizovaně + 3D model), stará revize nezaškrtnutá → testovací SMTP", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  const before = (await sentRaw()).length;
  await open(page, "?tab=nakup");
  await page.getByRole("button", { name: /^Poslat e-mailem$/ }).first().click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Poslat objednávku ${PO_NUMBER} dodavateli` });
  await dlg.waitFor({ timeout: 20_000 });
  const att = dlg.getByTestId("po-mail-attachments");
  await att.waitFor({ timeout: 30_000 });
  const t = norm(await att.innerText());
  expect(t.includes(`${DN_A}_C.pdf`) && t.includes(`${DN_A}_C.step`) && t.includes(`${DN_A}_B-neplatna.pdf`), `seznam příloh (${t})`);
  expect(!t.includes(DN_B) && !/poptavk/i.test(t), "bez výkresu B a poptávky zákazníka");
  noCustomer(t, "seznam příloh");
  expect(await dlg.getByLabel(`Přiložit ${DN_A}_C.pdf`).isChecked(), "aktuální výkres zaškrtnutý");
  expect(await dlg.getByLabel(`Přiložit ${DN_A}_C.step`).isChecked(), "3D model zaškrtnutý");
  expect(!(await dlg.getByLabel(`Přiložit ${DN_A}_B-neplatna.pdf`).isChecked()), "stará revize nezaškrtnutá");
  const devBox = norm(await dlg.getByTestId("po-mail-deviations").innerText());
  expect(devBox.includes("Materiál: 1.4404 (na výkresu: 1.4301)") && devBox.includes("Sražení hran: 0,5×45° všude"), `odchylky v dialogu (${devBox})`);
  const body = await dlg.locator("textarea").first().inputValue();
  expect(body.includes(`– ${DN_A}: Platí revize výkresu C (nahrazuje rev. B); Materiál: 1.4404 (na výkresu: 1.4301); Sražení hran: 0,5×45° všude`), `text e-mailu s odchylkami (${body.slice(0, 600)})`);
  expect(body.includes("V příloze dále zasíláme výkresy a 3D modely"), "text: výkresy a modely v příloze");
  await snap(page, "02-poslat-prilohy");
  await dlg.getByRole("button", { name: "Odeslat dodavateli" }).click();
  await eventually(() => expect(sql(`select status from purchase_orders where id = ${lit(PO_ID)}`) === "odeslana", "objednávka Odeslána"), { timeout: 60_000 });

  const mine = (await sentRaw()).slice(before).filter((m) => m.raw.includes(PO_NUMBER));
  expect(mine.length === 1, `1 e-mail na SMTP (${mine.length})`);
  expect(mine[0].to.includes(SUP_MAIL), `adresát dodavatel (${mine[0].to})`);
  const p = await simpleParser(mine[0].raw);
  noCustomer(`${p.subject}\n${p.text}`, "e-mail");
  expect(p.text.includes("Pozor — u těchto položek platí odchylky od výkresu"), "text: odchylky");
  const files = p.attachments.filter((a) => !(a.contentType === "image/png" && a.filename === "mnastrojarna-logo.png"));
  const names = files.map((a) => a.filename).sort();
  expect(JSON.stringify(names) === JSON.stringify([`${DN_A}_C.pdf`, `${DN_A}_C.step`, `Objednavka_${PO_NUMBER}.pdf`].sort()), `přílohy (${names})`);
  noCustomer(names.join(" "), "názvy příloh");
  expect(files.find((a) => a.filename === `${DN_A}_C.pdf`).content.equals(CUR_A.anon), "výkres = anonymizovaná kopie aktuální revize");
  expect(files.find((a) => a.filename === `${DN_A}_C.step`).content.equals(STEP), "3D model = originál");
  const pdf = files.find((a) => a.filename.startsWith("Objednavka_"));
  const text = norm(await pdfText(pdf.content));
  expect(text.includes("Odchylka od výkresu — platí místo výkresu"), "PDF: blok odchylek");
  expect(text.includes("Materiál: 1.4404 (na výkresu: 1.4301)") && text.includes("Platí revize výkresu C (nahrazuje rev. B)") && text.includes("Sražení hran: 0,5×45° všude"), `PDF: odchylky (${text.slice(0, 900)})`);
  // (poznámka objednávky vyjmenovává výkresy zakázky — položka B ale v tabulce není)
  expect(!text.includes("Pouzdro"), "PDF: jen položka A");
  noCustomer(text, "PDF objednávky");
  pdfShot(pdf.content, "03-pdf-objednavky");
  await page.close();
});

await T("Nová revize výkresu A (D) → „Poslat dodavateli novou revizi“ → změna objednávky s novým výkresem, stará revize nahrazena", async (context) => {
  const page = await context.newPage();
  await loginAs(page);
  const NEW_A = await drawing(ITEM_A, DN_A, "D");
  sql(`update job_files set archived = true, replaced_by = ${lit(NEW_A.id)} where id = ${lit(CUR_A.id)}`);
  sql(`update order_items set revision = 'D' where id = ${lit(ITEM_A)}`);
  sql(`update job_drawing_changes set file_id = ${lit(NEW_A.id)}, old_file_id = ${lit(CUR_A.id)} where order_item_id = ${lit(ITEM_A)} and rev_to = 'D'`);
  const before = (await sentRaw()).length;
  await open(page);
  const banner = page.locator('[data-testid="drawing-change-banner"]');
  await banner.waitFor({ timeout: 20_000 });
  await banner.getByRole("button", { name: "Poslat dodavateli novou revizi" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: `Nová revize výkresu — objednávka ${PO_NUMBER}` });
  await dlg.waitFor({ timeout: 20_000 });
  await dlg.getByTestId("po-mail-attachments").waitFor({ timeout: 30_000 });
  expect(await dlg.getByLabel(`Přiložit ${DN_A}_D.pdf`).isChecked(), "nová revize zaškrtnutá");
  expect(!(await dlg.getByLabel(`Přiložit ${DN_A}_C-neplatna.pdf`).isChecked()), "předchozí revize nezaškrtnutá");
  const body = await dlg.locator("textarea").first().inputValue();
  expect(body.includes(`Výkres ${DN_A}: platí nová revize D — revize C je nahrazena a neplatí.`), `text: nahrazená revize (${body.slice(0, 600)})`);
  expect((await dlg.getByLabel("Předmět").inputValue()).startsWith(`Změna objednávky ${PO_NUMBER}`), "předmět: změna objednávky");
  await snap(page, "04-nova-revize-dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverflow(page, "dialog nové revize 390 px");
  await snap(page, "05-nova-revize-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  await dlg.getByRole("button", { name: "Odeslat dodavateli" }).click();
  await eventually(async () => expect((await sentRaw()).slice(before).some((m) => m.raw.includes(PO_NUMBER)), "změna na SMTP"), { timeout: 60_000 });
  const mine = (await sentRaw()).slice(before).filter((m) => m.raw.includes(PO_NUMBER));
  const p = await simpleParser(mine[0].raw);
  expect(p.subject.startsWith(`Změna objednávky ${PO_NUMBER}`), `předmět (${p.subject})`);
  expect(p.text.includes("revize C je nahrazena a neplatí"), "text: stará revize neplatí");
  noCustomer(`${p.subject}\n${p.text}`, "e-mail změny");
  const files = p.attachments.filter((a) => !(a.contentType === "image/png" && a.filename === "mnastrojarna-logo.png"));
  const names = files.map((a) => a.filename).sort();
  expect(JSON.stringify(names) === JSON.stringify([`${DN_A}_D.pdf`, `${DN_A}_D.step`, `Objednavka_${PO_NUMBER}.pdf`].sort()), `přílohy změny (${names})`);
  expect(files.find((a) => a.filename === `${DN_A}_D.pdf`).content.equals(NEW_A.anon), "nová revize = anonymizovaná kopie");
  const text = norm(await pdfText(files.find((a) => a.filename.startsWith("Objednavka_")).content));
  expect(text.includes("Platí revize výkresu D (nahrazuje rev. C)"), "PDF změny: nová revize");
  expect(Number(sql(`select revision from purchase_orders where id = ${lit(PO_ID)}`)) === 2, "změna č. 2");
  await page.close();
});

await cleanup();
await removeStorageFiles(storagePaths);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
