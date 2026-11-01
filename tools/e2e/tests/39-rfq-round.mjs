// E2E 39 · Poptávky dodavatelům — poptávkové kolo (majitel 31. 10.): „když mám poptávku od zákazníka, vytvořit poptávku
// pro naše dodavatele … pošlu 2, 3, 5 poptávek … všechno anonymizované, aby mi nevyfoukli zákazníka … To bude dělat
// hlavně Šponer." + „Měl by z toho vyjít i doporučený dodavatel, především na základě ceny, termínu a kvality."
//  1. Zaměstnanec se „Smí poptávat dodavatele" (jako Šponer) si připojí schránku; /inquiries má u poptávky „Poptat".
//  2. Karta poptávky (2 položky) → „Poptat dodavatele" → 3 doporučení dodavatelé předvybraní → náhled → Odeslat.
//  3. Testovací SMTP: 3 SAMOSTATNÉ e-maily (jeden adresát), každý s PDF poptávky + anonymizovaným výkresem (neutrální
//     názvy), nikde jméno / IČO / číslo objednávky zákazníka ani název zakázky (předmět, text, PDF, názvy souborů).
//  4. Dodavatel odpoví (IMAP, naše PD-… v předmětu) → Přijmout a odeslat → přiřazeno ke kolu „Odpověděl" → Zapsat nabídku
//     (předvyplněno z odpovědi) + druhá nabídka ručně → porovnání „Doporučujeme: …" s důvodem → Vybrat (doporučený)
//     a u druhé položky jiný s důvodem → nákupní cena položek pro Nacenění; Technologie „Poptáno: 3 · odpověděli …".
//  5. Urgovat (třetí dodavatel) → připomenutí na SMTP; 390 px bez přetékání (panel, dialog).
// Spuštění (aplikace musí znát testovací poštovní server — MAIL_TEST_PROVIDERS, NODE_EXTRA_CA_CERTS):
//   node tools/e2e/mail-test-server.mjs --dir <dir> --base 35000 &
//   MAIL_TEST_DIR=<dir> E2E_BASE_URL=http://localhost:3500 [RFQ_SHOTS=<adresář>] node tools/e2e/tests/39-rfq-round.mjs
// Vlastní data „E2E39-" (zákazník, dodavatelé, zakázky, schránka), na konci se uklidí.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BASE, USERS, launch, withContext, login, sql, localEnv, test, expect, summary } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SRV_DIR = process.env.MAIL_TEST_DIR ?? path.join(ROOT, ".local-supabase/mail-test");
const SRV = JSON.parse(fs.readFileSync(path.join(SRV_DIR, "server.json"), "utf8"));
const CTL = `http://127.0.0.1:${SRV.ports.control}`;
const SHOTS = process.env.RFQ_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// mailparser je závislost nástrojů lokálního Supabase (v pracovní kopii se node_modules sdílí odkazem z hlavního repa)
function loadMailparser() {
  const roots = [ROOT];
  try { roots.push(path.dirname(fs.realpathSync(path.join(ROOT, "node_modules")))); } catch { /* bez odkazu */ }
  for (const r of roots) {
    try { return createRequire(path.join(r, "tools/local-supabase/package.json"))("mailparser"); } catch { /* další */ }
  }
  throw new Error("Chybí mailparser (tools/local-supabase: npm ci)");
}
const { simpleParser } = loadMailparser();

const BOX = "poptavky39@nastrojarstvi.test";
const BOX_PASS = "Poptavky39-Heslo-1";
const P = "E2E39-";
const TAG = Date.now().toString(36).toUpperCase();
const DIGITS = String(Date.now() % 1_000_000);
const CUSTOMER = `Strojmetal Brněnská ${DIGITS} a.s.`;
const ICO = String(20_000_000 + (Date.now() % 70_000_000));
const PO = `PO-${DIGITS}-77`;
const INQ = `RFQ-ZAK-${DIGITS}`;
const ID = userIds();
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const browser = await launch();
const errors = [];

console.log(`39 · Poptávky dodavatelům (značka ${TAG}, SMTP ${SRV.ports.smtps}, ovládání ${SRV.ports.control})`);

async function snap(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
const ctl = async (p, opts) => (await fetch(`${CTL}${p}`, opts)).json();
// obálka SMTP („RCPT TO:<a@b>") → čisté adresy
const sentRaw = async () => (await ctl("/sent?full=1")).map((m) => ({ ...m, to: (m.to ?? []).map((t) => (/<([^>]+)>/.exec(t)?.[1] ?? String(t)).trim().toLowerCase()) }));

// ── data ─────────────────────────────────────────────────────
const storagePaths = [];
async function upload(p, buf) {
  const env = localEnv();
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${p}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/pdf", "x-upsert": "true" },
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
    sql(`delete from rfq_rounds where job_id in (${inList})`);
    sql(`delete from supplier_quotes where job_id in (${inList})`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`delete from email_job_suggestions where job_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList}) and direction = 'out'`);
    sql(`update emails set order_id = null where order_id in (${inList})`);
    sql(`update job_files set replaced_by = null where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
    sql(`delete from audit_log where diff->>'jobId' in (${inList})`);
  }
  sql(`delete from mail_outbox where created_by = ${lit(ID.dilna)} and payload->>'subject' like 'Poptávka PD-%'`);
  sql(`delete from email_shares where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = ${lit(BOX)}))`);
  sql(`delete from email_job_suggestions where thread_id in (select thread_id from emails where mailbox_id in (select id from mailboxes where email = ${lit(BOX)}))`);
  sql(`delete from emails where mailbox_id in (select id from mailboxes where email = ${lit(BOX)})`);
  sql(`delete from mailboxes where email = ${lit(BOX)}`);
  sql(`delete from party_role_emails where supplier_id in (select id from suppliers where name like ${lit(`${P}%`)})`);
  sql(`delete from suppliers where name like ${lit(`${P}%`)}`);
  sql(`delete from customers where name like 'Strojmetal Brněnská %'`);
  return jobs.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);
await removeStorageFiles(storagePaths);

const rfqBefore = sql(`select can_rfq from profiles where id = ${lit(ID.dilna)}`);
sql(`update profiles set can_rfq = true where id = ${lit(ID.dilna)}`);
// jiné vlastní schránky zaměstnance (demo SMTP do mail catcheru) po dobu testu vypnout — poptávka má odejít
// z připojené schránky přes testovací SMTP server (a odpověď přijít přes jeho IMAP)
const OTHER_BOXES = sql(`select coalesce(string_agg(id::text, ','), '') from mailboxes where owner_id = ${lit(ID.dilna)} and email <> ${lit(BOX)} and active`).split(",").filter(Boolean);
if (OTHER_BOXES.length) sql(`update mailboxes set active = false where id in (${OTHER_BOXES.map(lit).join(",")})`);
const restoreBoxes = () => { if (OTHER_BOXES.length) sql(`update mailboxes set active = true where id in (${OTHER_BOXES.map(lit).join(",")})`); };
process.on("exit", () => { try { restoreBoxes(); } catch { /* úklid */ } });
sql(`insert into automation_settings (module, mode, enabled) values ('mail_job_link', 'full', true) on conflict (module) do update set mode = 'full', enabled = true`);

const CUST = sql(`insert into customers (name, ico, dic, country, owner_id, email, contact_person, city)
  values (${lit(CUSTOMER)}, ${lit(ICO)}, ${lit(`CZ${ICO}`)}, 'CZ', ${lit(ID.obchod)}, ${lit(`nakup@strojmetal-${DIGITS}.test`)}, 'Ing. Petra Svobodová', 'Brno') returning id`).split("\n")[0];
const JOB_NUMBER = `Z-E2E39-${TAG}`;
const JOB = sql(`insert into orders (number, title, status, source, owner_id, created_by, assignee_id, customer_id, inquiry_date, inquiry_status, priority, due_date,
    customer_order_number, customer_inquiry_number, customer_contact, customer_contact_email)
  values (${lit(JOB_NUMBER)}, ${lit(`${P}${CUSTOMER} — hřídele a pouzdra`)}, 'poptavka', 'manual', ${lit(ID.obchod)}, ${lit(ID.dilna)}, ${lit(ID.dilna)}, ${lit(CUST)},
    app_today() - 1, 'v_reseni', 'stredni', app_today() + 30, ${lit(PO)}, ${lit(INQ)}, 'Ing. Petra Svobodová', ${lit(`svobodova@strojmetal-${DIGITS}.test`)}) returning id`).split("\n")[0];
const DN1 = `HR-${TAG}-10`;
const DN2 = `PZ-${TAG}-20`;
const ITEM1 = sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
  values (${lit(JOB)}, 0, ${lit(DN1)}, 'A', ${lit(`Hřídel pro ${CUSTOMER}`)}, '42CrMo4', 50, 'ks') returning id`).split("\n")[0];
const ITEM2 = sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
  values (${lit(JOB)}, 1, ${lit(DN2)}, 'B', 'Pouzdro', 'C45', 20, 'ks') returning id`).split("\n")[0];
// výkresy: původní názvy nesou jméno zákazníka, anonymizované kopie hotové (sha)
for (const [item, dn, rev] of [[ITEM1, DN1, "A"], [ITEM2, DN2, "B"]]) {
  const u = randomUUID();
  const orig = `zakazky/${JOB}/${u}-Strojmetal_${dn}.pdf`;
  const anon = `zakazky/${JOB}/anon/${u}.pdf`;
  const anonBuf = tinyPdf(`VYKRES ${dn}`);
  await upload(orig, tinyPdf(`STROJMETAL ${dn}`));
  await upload(anon, anonBuf);
  sql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, anon_status, anon_path, anon_filename, anon_mime, anon_sha256, uploaded_by)
    values (${lit(JOB)}, 'vykres', ${lit(`Výkres ${dn}`)}, ${lit(`${CUSTOMER} ${dn}.pdf`)}, 'application/pdf', ${lit(orig)}, ${lit(item)}, 'done', ${lit(anon)}, ${lit(`${dn}_${rev}.pdf`)},
      'application/pdf', ${lit(createHash("sha256").update(anonBuf).digest("hex"))}, ${lit(ID.dilna)})`);
}
// dodavatelé: 3 obráběči (s historií stejného výkresu → doporučení), kalírna (jiná technologie)
const SUP = {};
for (const [key, name, tech, price] of [["hruby", "Hrubý CNC", "frezovani_3osy", 455], ["novak", "Novák soustružení", "soustruzeni", 430], ["kovo", "Kovo Lipník", "frezovani", 470], ["kal", "Kalírna Brno", "tepelne_zpracovani", null]]) {
  const email = `${key}39-${TAG.toLowerCase()}@dodavatel.test`;
  const id = sql(`insert into suppliers (name, email, technologies, materials, certifications, lead_days, rating)
    values (${lit(`${P}${name} ${TAG}`)}, ${lit(email)}, array[${lit(tech)}], array['42CrMo4','C45'], array['ISO 9001'], 10, 4.6) returning id`).split("\n")[0];
  SUP[key] = { id, name: `${P}${name} ${TAG}`, email, price };
}
// historie: dřívější objednávky stejného výkresu u obráběčů (jiná zakázka)
const HIST = sql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id) values (${lit(`Z-E2E39H-${TAG}`)}, ${lit(`${P}historie`)}, 'dokonceno', 'manual', ${lit(ID.obchod)}, ${lit(ID.obchod)}, ${lit(CUST)}) returning id`).split("\n")[0];
let po = 0;
for (const k of ["hruby", "novak", "kovo"]) {
  po += 1;
  const poId = sql(`insert into purchase_orders (job_id, supplier_id, number, status, total) values (${lit(HIST)}, ${lit(SUP[k].id)}, ${lit(`OV-E2E39-${TAG}-${po}`)}, 'vystavena', ${SUP[k].price * 50}) returning id`).split("\n")[0];
  sql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(poId)}, 0, ${lit(DN1)}, 'Hřídel', 50, 'ks', ${SUP[k].price})`);
}
// Novák: e-mail pro poptávky (účel „Poptávky (RFQ)") jiný než e-mail firmy
const NOVAK_RFQ = `poptavky39-${TAG.toLowerCase()}@dodavatel.test`;
sql(`insert into party_role_emails (supplier_id, role, email, is_default, source) values (${lit(SUP.novak.id)}, 'nabidky', ${lit(NOVAK_RFQ)}, true, 'manual')`);

const FORBIDDEN = [CUSTOMER, "Strojmetal", "Brněnská", ICO, PO, INQ, "Svobodová", "hřídele a pouzdra", `strojmetal-${DIGITS}`];
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

const open = async (page, q = "") => {
  await page.goto(`${BASE}/orders/${JOB}${q}`);
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
  await page.waitForLoadState("networkidle").catch(() => {});
};
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

let NUMBER = "";
let sentBefore = 0;

await T("zaměstnanec se „Smí poptávat“: vlastní schránka, /inquiries má „Poptat“, karta poptávky „Poptat dodavatele“ (bez marží)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await page.goto(`${BASE}/account#schranka`);
  await page.waitForLoadState("networkidle");
  const form = page.locator('[data-testid="my-mailbox-form"]:visible').first();
  if (!(await form.isVisible().catch(() => false))) await page.locator('[data-testid="my-mailbox-add"]:visible').first().click();
  await form.waitFor();
  await form.getByLabel("E-mail schránky").fill(BOX);
  await form.getByLabel("Heslo ke schránce").fill(BOX_PASS);
  await form.getByTestId("my-mailbox-connect").click();
  await page.getByTestId("my-mailbox-note").filter({ hasText: /Schránka připojena/ }).waitFor({ timeout: 120_000 });
  expect(sql(`select owner_id from mailboxes where email = ${lit(BOX)}`) === ID.dilna, "schránka patří zaměstnanci");

  await page.goto(`${BASE}/inquiries`);
  const row = page.locator("main li").filter({ hasText: JOB_NUMBER }).first();
  await row.waitFor({ timeout: 20_000 });
  const link = row.getByTestId("rfq-list-link");
  expect(await link.count() === 1, "u poptávky je „Poptat“");
  expect((await link.getAttribute("href")) === `/orders/${JOB}?tab=nakup&akce=rfq.create`, "odkaz otevře poptávkové kolo");

  await open(page);
  expect(await page.locator('[data-testid="rfq-header-open"]:visible').count() === 1, "hlavička: „Poptat dodavatele“");
  const tabs = norm(await page.locator('[role="tablist"]').first().innerText());
  expect(tabs.includes("Poptávky dodavatelům") && !tabs.includes("Nákup & marže"), `záložka Poptávky bez marží (${tabs})`);
  await page.close();
});

await T("Poptat dodavatele: 2 položky, 3 doporučení předvybraní, náhled bez zákazníka → 3 samostatné e-maily (PDF + anonymizovaný výkres)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  sentBefore = (await sentRaw()).length;
  await open(page, "?tab=nakup&akce=rfq.create");
  const dlg = page.getByTestId("rfq-dialog");
  await dlg.waitFor({ timeout: 20_000 });
  await dlg.getByTestId("rfq-items").waitFor({ timeout: 20_000 });
  const items = dlg.getByTestId("rfq-items").locator("li");
  expect(await items.count() === 2, "obě položky");
  expect(await dlg.locator('input[type="checkbox"]:checked').count() === 2, "výchozí všechny položky");
  expect((await dlg.getByLabel(`Množství ${DN1}`, { exact: true }).inputValue()) === "50", "množství zákazníka");
  await dlg.getByLabel(`Varianty množství ${DN1}`, { exact: true }).fill("100");
  const req = await dlg.getByLabel("Požadovaný termín dodání").inputValue();
  expect(/^\d{4}-\d{2}-\d{2}$/.test(req) && req < sql("select (app_today() + 30)::text"), `termín před termínem zákazníka (${req})`);
  await snap(page, "01-dialog-co-poptat");
  await dlg.getByTestId("rfq-next").click();
  await dlg.getByTestId("rfq-suppliers").waitFor();
  await dlg.getByLabel("Hledat dodavatele").fill(TAG);
  const rows = dlg.getByTestId("rfq-supplier");
  await eventually(async () => expect(await rows.count() === 4, `4 dodavatelé značky (${await rows.count()})`));
  for (const k of ["hruby", "novak", "kovo"]) {
    const r = dlg.locator(`[data-testid="rfq-supplier"][data-supplier="${SUP[k].name}"]`);
    expect(norm(await r.innerText()).includes("Doporučeno"), `${k}: doporučený`);
    expect(await r.locator('input[type="checkbox"]').isChecked(), `${k}: předvybraný`);
  }
  const kal = dlg.locator(`[data-testid="rfq-supplier"][data-supplier="${SUP.kal.name}"]`);
  expect(!(await kal.locator('input[type="checkbox"]').isChecked()) && !norm(await kal.innerText()).includes("Doporučeno"), "kalírna (jiná technologie) nevybraná");
  expect(norm(await dlg.locator(`[data-testid="rfq-supplier"][data-supplier="${SUP.hruby.name}"]`).innerText()).includes("dělal tento výkres"), "důvod doporučení z historie");
  expect((await dlg.getByLabel(`E-mail ${SUP.novak.name}`).inputValue()) === NOVAK_RFQ, "Novák: e-mail pro poptávky (účel)");
  expect(norm(await dlg.getByTestId("rfq-picked-count").innerText()) === "Vybráno 3", "vybráno 3");
  await snap(page, "02-dialog-dodavatele");
  await dlg.getByTestId("rfq-preview-btn").click();
  await dlg.getByTestId("rfq-preview").waitFor({ timeout: 30_000 });
  const previews = dlg.getByTestId("rfq-preview-mail");
  expect(await previews.count() === 3, "náhled: 3 e-maily");
  for (let i = 0; i < 3; i++) {
    const t = await previews.nth(i).innerText();
    noCustomer(t, `náhled ${i + 1}`);
    expect(t.includes("samostatný e-mail"), "každý zvlášť");
    expect(t.includes(`${DN1}_A.pdf`) && t.includes(`${DN2}_B.pdf`), `přílohy s neutrálními názvy (${norm(t).slice(-200)})`);
  }
  await snap(page, "03-dialog-nahled");
  await dlg.getByTestId("rfq-send").click();
  await dlg.getByTestId("rfq-done").waitFor({ timeout: 60_000 });
  expect(norm(await dlg.getByTestId("rfq-done").innerText()).includes("odeslána 3 dodavatelům"), "odesláno 3");
  NUMBER = sql(`select number from rfq_rounds where job_id = ${lit(JOB)}`);
  expect(/^PD-20\d{2}-\d{3,}$/.test(NUMBER), `číslo poptávky ${NUMBER}`);
  await snap(page, "04-dialog-odeslano");

  // testovací SMTP: 3 zprávy, každá jednomu dodavateli, s PDF + anonymizovanými výkresy, bez zákazníka
  const all = await sentRaw();
  const mine = all.slice(sentBefore).filter((m) => m.raw.includes(NUMBER));
  expect(mine.length === 3, `3 e-maily na SMTP (${mine.length})`);
  const want = [SUP.hruby.email, NOVAK_RFQ, SUP.kovo.email].sort();
  expect(JSON.stringify(mine.map((m) => m.to.join(",")).sort()) === JSON.stringify(want), `každý jen jednomu (${mine.map((m) => m.to.join("+"))})`);
  for (const m of mine) {
    const p = await simpleParser(m.raw);
    expect((p.cc?.value ?? []).length === 0 && (p.to?.value ?? []).length === 1, "žádná kopie, jeden adresát");
    expect(p.subject === `Poptávka ${NUMBER}`, `předmět (${p.subject})`);
    noCustomer(`${p.subject}\n${p.text}`, `e-mail ${m.to}`);
    expect(p.text.includes(`${NUMBER}/1: ${DN1} rev. A`) && p.text.includes("50 ks / 100 ks"), "položky s naším číslem a variantou");
    const files = p.attachments.filter((a) => !(a.contentType === "image/png" && a.filename === "mnastrojarna-logo.png"));
    const names = files.map((a) => a.filename).sort();
    expect(JSON.stringify(names) === JSON.stringify([`${DN1}_A.pdf`, `Poptavka-${NUMBER}.pdf`, `${DN2}_B.pdf`].sort()), `přílohy (${names})`);
    noCustomer(names.join(" "), "názvy příloh");
    const pdf = files.find((a) => a.filename.startsWith("Poptavka-"));
    const text = await pdfText(pdf.content);
    expect(text.includes(NUMBER) && text.includes(DN1) && text.includes(DN2), "PDF: naše číslo a výkresy");
    noCustomer(text, "PDF poptávky");
    const drawing = files.find((a) => a.filename === `${DN1}_A.pdf`);
    expect(!drawing.content.toString("latin1").includes("STROJMETAL"), "výkres = anonymizovaná kopie");
  }
  expect(sql(`select count(*) from rfq_recipients r join rfq_rounds k on k.id = r.round_id where k.job_id = ${lit(JOB)} and r.status = 'odeslano' and r.sent_by = ${lit(ID.dilna)}`) === "3", "stav odesláno, autor zaměstnanec");
  await page.close();
});

await T("odpověď dodavatele (IMAP, PD-…) → Přijmout a odeslat → přiřazeno ke kolu → Zapsat nabídku (předvyplněno) + ruční → porovnání a „Doporučujeme“ → Vybrat → nákupní cena", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  const ours = (await sentRaw()).find((m) => m.raw.includes(NUMBER) && m.to.includes(NOVAK_RFQ));
  const mid = /^Message-ID:\s*(<[^>]+>)/im.exec(ours?.raw ?? "")?.[1] ?? null;
  const reply = await ctl(`/message?user=${encodeURIComponent(BOX)}`, {
    method: "POST",
    body: JSON.stringify({
      from: `Novák <${NOVAK_RFQ}>`, subject: `Re: Poptávka ${NUMBER}`, inReplyTo: mid, references: mid ? [mid] : undefined,
      body: `Dobrý den,\nposíláme nabídku č. N-${TAG} k poptávce ${NUMBER}:\n${DN1}: 410 Kč / 380 Kč\n${DN2}: 150 Kč\nDodací lhůta 10 dní.\nPlatnost nabídky do 30. 12. 2026\n\nS pozdravem Novák`,
    }),
  });
  expect(reply.uid, "odpověď v testovací schránce");
  await page.goto(`${BASE}/inbox`);
  await page.getByTestId("mail-folders").first().waitFor();
  await page.getByRole("button", { name: /Přijmout a odeslat/ }).first().click();
  await eventually(() => expect(sql(`select status from rfq_recipients where supplier_id = ${lit(SUP.novak.id)} and round_id = (select id from rfq_rounds where job_id = ${lit(JOB)})`) === "odpovedel", "Novák: Odpověděl"), { timeout: 90_000, interval: 1500 });
  expect(sql(`select count(*) from emails where order_id = ${lit(JOB)} and direction = 'in' and subject = ${lit(`Re: Poptávka ${NUMBER}`)}`) === "1", "odpověď přiřazena k zakázce");

  await open(page, "?tab=nakup");
  const round = page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"]`);
  await round.waitFor({ timeout: 20_000 });
  expect(norm(await round.getByTestId("rfq-summary").innerText()) === "Poptáno: 3 · odpověděli 1", "souhrn kola");
  const novak = round.locator(`[data-testid="rfq-recipient"][data-supplier="${SUP.novak.name}"]`);
  expect(norm(await novak.innerText()).includes("Odpověď: „Re: Poptávka"), "odpověď u dodavatele");
  await snap(page, "05-panel-odpovedel");
  await novak.getByTestId("rfq-offer").click();
  const od = page.getByTestId("rfq-offer-dialog");
  await od.waitFor();
  await od.getByTestId("rfq-prefilled").waitFor({ timeout: 15_000 });
  expect((await od.getByLabel(`Cena za kus ${DN1} 50 ks`).inputValue()) === "410", "předvyplněná cena 50 ks");
  expect((await od.getByLabel(`Cena za kus ${DN1} 100 ks`).inputValue()) === "380", "předvyplněná varianta 100 ks");
  expect((await od.getByLabel(`Cena za kus ${DN2} 20 ks`).inputValue()) === "150", "předvyplněná cena položky 2");
  expect((await od.getByLabel("Dodací lhůta (dny)").inputValue()) === "10", "lhůta z odpovědi");
  await snap(page, "06-zapsat-nabidku-predvyplneno");
  await od.getByTestId("rfq-offer-save").click();
  await waitToast(page, /Nabídka .* zapsána/);
  // Hrubý: nabídka telefonem / ručně
  const hruby = round.locator(`[data-testid="rfq-recipient"][data-supplier="${SUP.hruby.name}"]`);
  await hruby.getByTestId("rfq-offer").click();
  const od2 = page.getByTestId("rfq-offer-dialog");
  await od2.waitFor();
  await od2.getByLabel(`Cena za kus ${DN1} 50 ks`).fill("455");
  await od2.getByLabel(`Cena za kus ${DN1} 100 ks`).fill("420");
  await od2.getByLabel(`Cena za kus ${DN2} 20 ks`).fill("139");
  await od2.getByLabel("Dodací lhůta (dny)").fill("8");
  await od2.getByTestId("rfq-offer-save").click();
  await waitToast(page, /Nabídka .* zapsána/);

  const cmp = round.getByTestId("rfq-compare");
  await cmp.waitFor({ timeout: 20_000 });
  const row1 = cmp.locator(`[data-testid="rfq-compare-row"][data-drawing="${DN1}"]`);
  const row2 = cmp.locator(`[data-testid="rfq-compare-row"][data-drawing="${DN2}"]`);
  // po uložení druhé nabídky se stránka obnoví — porovnání má obě nabídky
  await eventually(async () => expect(await row1.getByTestId("rfq-cell").count() === 2 && await row2.getByTestId("rfq-cell").count() === 2, "porovnání: 2 nabídky u obou položek"), { timeout: 20_000 });
  const rec1 = norm(await row1.getByTestId("rfq-recommend").innerText());
  expect(rec1.startsWith(`Doporučujeme: ${SUP.novak.name}`) && /nejlevnější o \d+ %/.test(rec1) && /před naším termínem/.test(rec1) && /kvalita|bez historie/.test(rec1), `doporučení položky 1 s důvodem (${rec1})`);
  expect(norm(await row1.locator(`[data-testid="rfq-cell"][data-supplier="${SUP.novak.name}"]`).innerText()).includes("410"), "zaměstnanec vidí cenu dodavatele");
  expect(norm(await row1.innerText()).includes("nejlevnější") && norm(await row1.innerText()).includes("nejrychlejší"), "nejlevnější / nejrychlejší zvýrazněné");
  const rec2 = norm(await row2.getByTestId("rfq-recommend").innerText());
  const recName2 = [SUP.novak.name, SUP.hruby.name].find((n) => rec2.startsWith(`Doporučujeme: ${n}`));
  expect(Boolean(recName2), `doporučení položky 2 (${rec2})`);
  // celá poptávka jedním dodavatelem: z celkové ceny, termínu a kvality (Novák je celkem levnější)
  const all = norm(await cmp.getByTestId("rfq-recommend-all").innerText());
  expect(all.includes(`Doporučujeme celou poptávku: ${SUP.novak.name}`) && /celkem nejlevnější o \d+ %/.test(all), `doporučení celé poptávky (${all})`);
  await cmp.scrollIntoViewIfNeeded();
  await snap(page, "07-porovnani-doporuceni");
  // položka 1: doporučený
  await row1.locator(`[data-testid="rfq-cell"][data-supplier="${SUP.novak.name}"]`).getByTestId("rfq-choose").click();
  await waitToast(page, /Vybrán .*Nacenění/);
  await eventually(() => expect(sql(`select purchase_unit_price from order_items where id = ${lit(ITEM1)}`) === "410.00", "nákupní cena položky 1 = 410"));
  // položka 2: jiný než doporučený → důvod
  const other = recName2 === SUP.novak.name ? SUP.hruby : SUP.novak;
  await row2.locator(`[data-testid="rfq-cell"][data-supplier="${other.name}"]`).getByTestId("rfq-choose").click();
  const ov = page.getByTestId("rfq-override");
  await ov.waitFor();
  await ov.getByLabel("Proč jiný dodavatel").fill("jistější termín u kalení");
  await snap(page, "08-vybrat-jiny-duvod");
  await ov.getByRole("button", { name: "Vybrat" }).click();
  await waitToast(page, /místo doporučeného/);
  const p2 = other === SUP.hruby ? "139.00" : "150.00";
  await eventually(() => expect(sql(`select purchase_unit_price from order_items where id = ${lit(ITEM2)}`) === p2, `nákupní cena položky 2 = ${p2}`));
  expect(sql(`select overridden || '|' || override_reason || '|' || selected_by from rfq_selections where order_item_id = ${lit(ITEM2)}`) === `true|jistější termín u kalení|${ID.dilna}`, "kdo a proč přebil doporučení");
  expect(sql(`select status from rfq_rounds where job_id = ${lit(JOB)}`) === "vybrano", "kolo vybráno");
  await page.reload();
  await page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"]`).getByTestId("rfq-compare").waitFor({ timeout: 20_000 });
  const after2 = norm(await page.locator(`[data-testid="rfq-compare-row"][data-drawing="${DN2}"]`).innerText());
  expect(after2.includes(`Vybráno: ${other.name}`) && after2.includes("místo doporučeného: jistější termín u kalení"), `výběr s důvodem vidět (${after2.slice(0, 200)})`);
  await snap(page, "09-vybrano");
  await page.close();
});

await T("další kolo jen u jednoho dodavatele → Urgovat den před „odpověď do“ → připomenutí na SMTP; Technologie a hlavička „Poptáno: 1 · odpověděli 0“", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  // výběr uklidil čekající — pro urgenci nové kolo jen u Kovo (jen položka 1, odpověď do zítra)
  await open(page, "?tab=nakup");
  const before = (await sentRaw()).length;
  await page.getByTestId("rfq-open").first().click();
  const dlg = page.getByTestId("rfq-dialog");
  await dlg.getByTestId("rfq-items").waitFor({ timeout: 20_000 });
  await dlg.getByLabel(`Poptat ${DN2}`).uncheck();
  await dlg.getByLabel("Odpověď do").fill(sql("select (app_today() + 1)::text"));
  await dlg.getByTestId("rfq-next").click();
  await dlg.getByTestId("rfq-suppliers").waitFor();
  const checked = dlg.locator('[data-testid="rfq-supplier"] input[type="checkbox"]:checked');
  for (let i = 0; i < 10 && (await checked.count()); i++) await checked.first().uncheck();
  await dlg.getByLabel("Hledat dodavatele").fill(SUP.kovo.name);
  await dlg.getByLabel(`Poptat ${SUP.kovo.name}`).check();
  await dlg.getByTestId("rfq-preview-btn").click();
  await dlg.getByTestId("rfq-preview").waitFor({ timeout: 30_000 });
  await dlg.getByTestId("rfq-send").click();
  await dlg.getByTestId("rfq-done").waitFor({ timeout: 60_000 });
  await dlg.getByRole("button", { name: "Hotovo" }).click();
  const n2 = sql(`select number from rfq_rounds where job_id = ${lit(JOB)} and number <> ${lit(NUMBER)}`);
  await page.reload();
  const round = page.locator(`[data-testid="rfq-round"][data-number="${n2}"]`);
  await round.waitFor({ timeout: 20_000 });
  const kovo = round.locator(`[data-testid="rfq-recipient"][data-supplier="${SUP.kovo.name}"]`);
  const remind = kovo.getByTestId("rfq-remind");
  expect(/amber/.test((await remind.getAttribute("class")) ?? ""), "den před „odpověď do“ je Urgovat zvýrazněné");
  await snap(page, "10-urgovat");
  await remind.click();
  await waitToast(page, /Urgence odeslána/);
  await eventually(async () => {
    const s = (await sentRaw()).slice(before).filter((m) => m.to.includes(SUP.kovo.email));
    expect(s.some((m) => m.raw.includes(`Připomenutí: Poptávka ${n2}`) || m.raw.includes("=?UTF-8?")), `připomenutí na SMTP (${s.length})`);
  }, { timeout: 20_000 });
  const rem = (await sentRaw()).slice(before).filter((m) => m.to.includes(SUP.kovo.email));
  const subjects = await Promise.all(rem.map(async (m) => (await simpleParser(m.raw)).subject));
  expect(subjects.includes(`Poptávka ${n2}`) && subjects.includes(`Připomenutí: Poptávka ${n2}`), `poptávka + připomenutí (${subjects})`);
  expect(sql(`select reminder_count from rfq_recipients where supplier_id = ${lit(SUP.kovo.id)} and round_id = (select id from rfq_rounds where number = ${lit(n2)})`) === "1", "urgováno 1×");
  // Přehled → karta Technologie: shrnutí posledního otevřeného kola
  await open(page);
  const chip = page.locator('[data-testid="tech-rfq"]:visible').first();
  await chip.waitFor({ timeout: 15_000 });
  expect(norm(await chip.innerText()) === "Poptáno: 1 · odpověděli 0", `Technologie: shrnutí kola (${norm(await chip.innerText())})`);
  const head = norm(await page.locator('[data-testid="rfq-header-summary"]:visible').first().innerText());
  expect(head.includes(n2) && head.includes("Poptáno: 1"), `hlavička: shrnutí (${head})`);
  await page.close();
});

await T("390 px: panel poptávek s porovnáním a dialog (Co / Komu) bez přetékání", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await open(page, "?tab=nakup");
  await page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"]`).waitFor({ timeout: 20_000 });
  await page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"] > button`).click();
  await page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"]`).getByTestId("rfq-compare").waitFor({ timeout: 20_000 });
  await expectNoOverflow(page, "panel poptávek 390 px");
  await page.locator(`[data-testid="rfq-round"][data-number="${NUMBER}"]`).getByTestId("rfq-compare").scrollIntoViewIfNeeded();
  await snap(page, "11-mobil-porovnani");
  await page.getByTestId("rfq-open").first().click();
  const dlg = page.getByTestId("rfq-dialog");
  await dlg.getByTestId("rfq-items").waitFor({ timeout: 20_000 });
  await expectNoOverflow(page, "dialog 390 px");
  await snap(page, "12-mobil-dialog");
  await dlg.getByTestId("rfq-next").click();
  await dlg.getByTestId("rfq-suppliers").waitFor();
  await expectNoOverflow(page, "dialog dodavatelé 390 px");
  await snap(page, "13-mobil-dodavatele");
  await page.close();
}, { mobile: true });

await T("super admin: kola v Nákupu & marže, výběr propsal nákupní ceny (Nacenění)", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await open(page, "?tab=nakup");
  await page.getByTestId("rfq-section").waitFor({ timeout: 20_000 });
  const t = norm(await page.locator('[role="tablist"]').first().innerText());
  expect(t.includes("Nákup & marže"), "admin: Nákup & marže");
  expect(await page.locator('[data-testid="rfq-round"]').count() === 2, "obě kola");
  expect(sql(`select count(*) from order_items where order_id = ${lit(JOB)} and purchase_unit_price is not null`) === "2", "obě položky mají nákupní cenu pro Nacenění");
  await page.close();
});

sql(`update profiles set can_rfq = ${rfqBefore === "t"} where id = ${lit(ID.dilna)}`);
restoreBoxes();
await cleanup();
await removeStorageFiles(storagePaths);
await browser.close();
process.exit(summary(errors) ? 0 : 1);
