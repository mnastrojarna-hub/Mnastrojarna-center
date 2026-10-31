// E2E 15 · Role a viditelnost (#25): obchodní tok jen „moje“ (super admin vše + „Jen moje“), Kniha všem,
// Nacenění jen super admin, Objednávky dodavatelům bez cen pro zaměstnance, zamčené nákupní doklady,
// neschválená nabídka (štítek, zamčené odeslání, vodoznak, DB pojistky), vrácení a schválení super
// adminem, odeslání autorem (obchodník i zaměstnanec), znovuschválení po změně, odznaky (i mobilní
// „Menu“), AI focení pro všechny, přepnutí vlastníka schránky, fronta bez anonymního čtení.
// Vlastní data „E2E15-<značka>“ (zakázky, nabídky, PO, soubory, e-maily) — úklid na konci i na začátku.
import { BASE, USERS, launch, withContext, login, shot, sql, clearMail, test, expect, summary, rest, restLogin, localEnv, recipients, fileAttachments } from "../lib.mjs";
import { lit, userIds, eventually, waitHydrated, expectNoOverflow, waitToast, waitMail, removeStorageFiles } from "../lib-quotes-docs-flow.mjs";
import { captureDialog, pngFile, removeStorage, storageObjects } from "../lib-capture.mjs";

const browser = await launch();
const errors = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `roles-visibility/${name}`;
const norm = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAG = Date.now().toString(36).toUpperCase();
const PREFIX = "E2E15-";
const ID = userIds();
const OBCHOD_BOX = "d5000000-0000-0000-0000-000000000001";
const DILNA_BOX = "d5000000-0000-0000-0000-000000000002";
const ADMIN_NAME = sql(`select full_name from profiles where id = ${lit(ID.admin)}`);
const OBCHOD_NAME = sql(`select full_name from profiles where id = ${lit(ID.obchod)}`);
const short = (n) => { const p = n.split(/\s+/); return p.length < 2 ? n : `${p[0][0]}. ${p.slice(1).join(" ")}`; };
const CUST_EMAIL = `e2e15-${TAG.toLowerCase()}@local.test`;
const restore = [];

console.log(`15 · Role a viditelnost (značka ${TAG})`);

// ── Úklid (i po minulém běhu) ────────────────────────────────
async function cleanup() {
  const ids = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  sql(`delete from emails where subject like ${lit(`${PREFIX}%`)}`);
  if (ids.length) {
    const inList = ids.map(lit).join(",");
    await removeStorageFiles(sql(`select storage_path from job_files where job_id in (${inList}) and storage_path is not null`).split("\n").filter(Boolean));
    sql(`delete from documents where order_id in (${inList})`);
    sql(`delete from emails where order_id in (${inList})`);
    sql(`delete from approval_queue where order_id in (${inList})`);
    sql(`update orders set quote_id = null, email_id = null where id in (${inList})`);
    sql(`delete from purchase_order_items where purchase_order_id in (select id from purchase_orders where job_id in (${inList}))`);
    sql(`delete from purchase_orders where job_id in (${inList})`);
    sql(`update job_files set quote_id = null where job_id in (${inList})`);
    sql(`delete from job_files where job_id in (${inList})`);
    sql(`delete from quote_items where quote_id in (select id from quotes where job_id in (${inList}))`);
    sql(`delete from quotes where job_id in (${inList})`);
    sql(`delete from orders where id in (${inList})`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)}`);
  return ids.length;
}
const left = await cleanup();
if (left) console.log(`  (úklid po minulém běhu: ${left} zakázek)`);

// ── Fixtury (vlastní čísla → čítače dokladů se nespotřebují) ──
const CUST = sql(`insert into customers (name, country, owner_id, email, contact_person, payment_terms_days)
  values (${lit(`${PREFIX}Kovo ${TAG}`)}, 'CZ', ${lit(ID.obchod)}, ${lit(CUST_EMAIL)}, 'Ing. Eva Testová', 14) returning id`).split("\n")[0];
let seq = 0;
function job({ key, owner = null, assignee = null, createdBy = owner, stage = "poptavka", inquiry = "prijata", order = null, price = 500 }) {
  seq += 1;
  const number = `Z-E2E15-${TAG}-${seq}`;
  const title = `${PREFIX}${TAG} ${key}`;
  const id = sql(`insert into orders (number, title, status, source, owner_id, assignee_id, created_by, customer_id, inquiry_date, customer_required_date, priority, inquiry_status, order_status, order_revision)
    values (${lit(number)}, ${lit(title)}, ${lit(stage)}::job_stage, 'manual', ${lit(owner)}, ${lit(assignee)}, ${lit(createdBy)}, ${lit(CUST)}, current_date - 2, current_date + 25, 'stredni',
      ${lit(inquiry)}, ${lit(order)}, ${order ? 1 : 0})
    returning id`).split("\n")[0];
  sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit, unit_price) values (${lit(id)}, 0, ${lit(`E15-${TAG}-${seq}`)}, 'Díl', 2, 'ks', ${price === null ? "null" : price})`);
  return { id, number, title };
}
function quote(j, { createdBy, number = `NAB-E2E15-${TAG}-${++seq}`, approvedBy = null, price = 700 }) {
  const id = sql(`insert into quotes (number, job_id, customer_id, status, total, currency, valid_until, revision, created_by, owner_id, approved_by, approved_at, lead_time_days, title)
    values (${lit(number)}, ${lit(j.id)}, ${lit(CUST)}, 'ke_schvaleni', ${price * 2}, 'CZK', current_date + 30, 1, ${lit(createdBy)}, ${lit(createdBy)}, ${lit(approvedBy)}, ${approvedBy ? "now()" : "null"}, 14, ${lit(j.title)})
    returning id`).split("\n")[0];
  sql(`insert into quote_items (quote_id, position, name, quantity, unit, unit_price) values (${lit(id)}, 0, 'Díl', 2, 'ks', ${price})`);
  return { id, number };
}
const quoteState = (id) => sql(`select state || '|' || admin_approval_required || '|' || coalesce(approved_by::text, '-') from quotes where id = ${lit(id)}`);

// M1 obchod (poptávka v řešení, naceněno → „Vytvořit nabídku“), M2 admin + Zpracovává dílna, M3 admin z e-mailu do schránky obchodu,
// M4 jen admin, M5 objednávka obchodu, MZ pro REST pojistky, MV pro znovuschválení
const M1 = job({ key: "M1 obchod", owner: ID.obchod, assignee: ID.obchod, inquiry: "v_reseni" });
const M2 = job({ key: "M2 dílna řeší", owner: ID.admin, assignee: ID.dilna, inquiry: "v_reseni" });
const M3 = job({ key: "M3 z pošty", owner: ID.admin });
const M4 = job({ key: "M4 admin", owner: ID.admin });
const M5 = job({ key: "M5 objednávka", owner: ID.obchod, stage: "objednavka", inquiry: "zpracovana", order: "dorucena" });
const MZ = job({ key: "MZ pojistky", owner: ID.obchod, inquiry: "v_reseni" });
const MV = job({ key: "MV znovu schválit", owner: ID.obchod, inquiry: "v_reseni" });
const MS = job({ key: "MS schválit a odeslat", owner: ID.obchod, inquiry: "v_reseni" });
const E3 = sql(`insert into emails (mailbox_id, owner_id, direction, subject, from_email, received_at, category)
  values (${lit(OBCHOD_BOX)}, ${lit(ID.obchod)}, 'in', ${lit(`${PREFIX}${TAG} poptávka M3`)}, 'nakup@example.test', now(), 'poptavka') returning id`).split("\n")[0];
sql(`update orders set email_id = ${lit(E3)} where id = ${lit(M3.id)}`);
sql(`update emails set order_id = ${lit(M3.id)} where id = ${lit(E3)}`);
const SUP = sql("select id from suppliers order by name limit 1");
const PO_A = sql(`insert into purchase_orders (job_id, supplier_id, number, status, total, created_by, note)
  values (${lit(M2.id)}, ${lit(SUP)}, ${lit(`OV-E15-${TAG}-A`)}, 'vystavena', 12345, ${lit(ID.admin)}, 'tajná poznámka ceny') returning id`).split("\n")[0];
sql(`insert into purchase_order_items (purchase_order_id, position, name, quantity, unit, unit_price) values (${lit(PO_A)}, 0, 'Kalení', 1, 'ks', 12345)`);
const PO_B = sql(`insert into purchase_orders (job_id, supplier_id, number, status, total, created_by)
  values (${lit(M4.id)}, ${lit(SUP)}, ${lit(`OV-E15-${TAG}-B`)}, 'vystavena', 6789, ${lit(ID.obchod)}) returning id`).split("\n")[0];
const ADMIN_Q4 = quote(M4, { createdBy: ID.admin }); // nabídka super admina — schválení nepotřebuje
const QZ = quote(MZ, { createdBy: ID.obchod });
const QV = quote(MV, { createdBy: ID.obchod, approvedBy: ID.admin });
const QS = quote(MS, { createdBy: ID.obchod });

// soubory: F1 výkres nahraný dílnou na M4, SQ nabídka dodavatele (nákupní doklad) na M2 — skutečný objekt v úložišti
const env = localEnv();
const SQ_PATH = `e2e15/${TAG}/kalirna.pdf`;
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${SQ_PATH}`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/pdf", "x-upsert": "true" },
  body: pdfBytes,
});
const F1 = sql(`insert into job_files (job_id, kind, title, filename, mime_type, size_bytes, storage_path, uploaded_by, origin)
  values (${lit(M4.id)}, 'vykres', ${lit(`${PREFIX}${TAG} výkres F1`)}, 'f1.pdf', 'application/pdf', 100, ${lit(`e2e15/${TAG}/f1.pdf`)}, ${lit(ID.dilna)}, 'upload') returning id`).split("\n")[0];
const SQ = sql(`insert into job_files (job_id, kind, title, filename, mime_type, size_bytes, storage_path, uploaded_by, origin, issuer)
  values (${lit(M2.id)}, 'naceneni', ${lit(`${PREFIX}${TAG} nabídka kalírny`)}, 'kalirna.pdf', 'application/pdf', ${pdfBytes.length}, ${lit(SQ_PATH)}, ${lit(ID.admin)}, 'upload', 'dodavatel') returning id`).split("\n")[0];

const st = { q1: null };

async function flowPage(page, path, title) {
  await page.goto(`${BASE}${path}`);
  await page.locator("main h1").filter({ hasText: title }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, { timeout: 30_000 });
}
async function openJob(page, job, tab) {
  await page.goto(`${BASE}/orders/${job.id}${tab ? `?tab=${tab}` : ""}`);
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 30_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
const mainText = async (page) => norm(await page.locator("main").innerText());
const hasJob = async (page, j) => (await page.locator(`main a[href="/orders/${j.id}"]`).count()) > 0;
const activePanel = (page) => page.locator("main [role=tabpanel][data-state=active]");
const quoteCard = (page, number) => activePanel(page).locator("article").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${esc(number)}$`) }) });
async function navCount(page, href) {
  const a = page.locator(`aside nav a[href="${href}"]`).first();
  if (!(await a.count())) return null;
  const m = /(\d+)\s*$/.exec(norm(await a.innerText()));
  return m ? Number(m[1]) : 0;
}
const badge = (who) => {
  const r = sql(`select inquiries || '|' || quotes_pending || '|' || quotes_ready || '|' || quotes_returned || '|' || quotes_pending_manual from flow_badge_counts(${who ? lit(who) : "null"})`).split("|").map(Number);
  return { inquiries: r[0], pending: r[1], ready: r[2], returned: r[3], manual: r[4] };
};
async function asUser(user, fn, opts) {
  await withContext(browser, errors, async (c) => {
    const p = await c.newPage();
    await login(p, user);
    await fn(p, c);
  }, opts);
}

try {
  // ═════════════════════ 1 · Menu a stránky podle role ═════════════════════
  await T("1 · menu podle role (desktop): Nacenění jen admin, Objednávky dodavatelům všem; /pricing → vysvětlení; dílna /purchasing 200", async (context) => {
    const page = await context.newPage();
    for (const [user, pricing] of [[USERS.admin, true], [USERS.obchod, false], [USERS.dilna, false]]) {
      await login(page, user);
      const hrefs = await page.locator("aside nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      expect(hrefs.includes("/pricing") === pricing, `${user.email}: Nacenění v menu = ${pricing} (${hrefs.join(", ")})`);
      expect(hrefs.includes("/purchasing"), `${user.email}: Objednávky dodavatelům v menu`);
      if (!pricing) {
        await page.goto(`${BASE}/pricing`);
        await page.waitForURL(/pristup=pricing/, { timeout: 15_000 });
        await page.locator("main").getByText("Nacenění zatím dělá jen super admin.", { exact: false }).first().waitFor({ timeout: 20_000 });
      }
      await context.clearCookies();
    }
    await login(page, USERS.dilna);
    const r = await page.goto(`${BASE}/purchasing`);
    expect(r?.status() === 200 && new URL(page.url()).pathname === "/purchasing", `dílna /purchasing = 200 (${r?.status()} ${page.url()})`);
  });

  await T("1b · mobil 390 px: rozbalené Menu — obchodník bez Nacenění, s Objednávkami dodavatelům; bez přetékání", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/orders`);
    await page.locator("nav button", { hasText: "Menu" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("heading", { name: "Menu" }).waitFor({ timeout: 10_000 });
    const hrefs = await sheet.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(!hrefs.includes("/pricing") && hrefs.includes("/purchasing"), `menu na mobilu (${hrefs.join(", ")})`);
    await expectNoOverflow(page, "mobil menu");
  }, { mobile: true });

  // ═════════════════════ 2–4 · Poptávky „moje“ ═════════════════════
  await T("2 · Poptávky obchodník: M1 a M3 (z jeho schránky), ne M2/M4; bez Nacenit; „Vytvořit nabídku“ → editor; poznámka se schránkou", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await flowPage(page, "/inquiries", "Poptávky");
    expect(await hasJob(page, M1) && await hasJob(page, M3), "obchodník vidí M1 a M3");
    expect(!(await hasJob(page, M2)) && !(await hasJob(page, M4)), "obchodník nevidí M2 a M4");
    const t = await mainText(page);
    expect(!t.includes("Nacenit") && (await page.locator('main a[href^="/pricing"]').count()) === 0, "žádné Nacenit / odkaz do Nacenění");
    expect(t.includes("Vidíš jen svoje:") && t.includes("obchod@mnastrojarna.test"), "poznámka „moje“ se schránkou");
    await shot(page, S("02-inquiries-obchod"));
    const row = page.locator("main li").filter({ has: page.locator(`a[href="/orders/${M1.id}"]`) }).first();
    const create = row.getByRole("link", { name: "Vytvořit nabídku" });
    expect((await create.getAttribute("href")) === `/orders/${M1.id}?tab=nabidky&nova=1`, `odkaz Vytvořit nabídku (${await create.getAttribute("href")})`);
    await create.click();
    await page.waitForURL(new RegExp(`/orders/${M1.id}`), { timeout: 20_000 });
    await page.getByRole("dialog").getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 20_000 });
  });

  await T("3 · Poptávky zaměstnanec: jen M2 (zpracovává ji)", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.dilna);
    await flowPage(page, "/inquiries", "Poptávky");
    expect(await hasJob(page, M2), "dílna vidí M2");
    for (const j of [M1, M3, M4]) expect(!(await hasJob(page, j)), `dílna nevidí ${j.title}`);
  });

  await T("4 · Poptávky super admin: vše; „Jen moje“ → kdo=moje, M2–M4 ano, M1 ne; volba platí i na /quotes", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.admin);
    await flowPage(page, "/inquiries", "Poptávky");
    // sdílená lokální DB: běží-li souběžně jiné sady s tisíci zakázek, seznam „všech“ je oříznutý (MAX_ROWS)
    const open = Number(sql("select count(*) from orders where status in ('poptavka','naceneni','pozastaveno','reklamace')"));
    if (open < 1500) for (const j of [M1, M2, M3, M4]) expect(await hasJob(page, j), `admin vidí ${j.title}`);
    else console.log(`    (přeskočeno „admin vidí vše“: ${open} otevřených poptávek v DB)`);
    const bar = page.getByRole("radiogroup", { name: "Koho zobrazit" });
    await waitHydrated(page, 'main [role="radiogroup"][aria-label="Koho zobrazit"] button');
    await shot(page, S("04-scope-bar-all"));
    await bar.getByRole("radio", { name: "Jen moje" }).click();
    await page.waitForURL(/kdo=moje/, { timeout: 15_000 });
    await eventually(async () => expect(!(await hasJob(page, M1)), "v „Jen moje“ není M1"));
    for (const j of [M2, M3, M4]) expect(await hasJob(page, j), `„Jen moje“: ${j.title}`);
    expect((await mainText(page)).includes("Zobrazuješ jen svoje — přepnout na Všichni"), "lišta: Zobrazuješ jen svoje");
    await shot(page, S("04-scope-bar-mine"));
    await flowPage(page, "/quotes", "Nabídky");
    expect((await mainText(page)).includes("Zobrazuješ jen svoje"), "cookie flow_kdo platí i na /quotes");
    await page.getByRole("button", { name: "Zobrazuješ jen svoje — přepnout na Všichni" }).click();
    await eventually(async () => expect(!(await mainText(page)).includes("Zobrazuješ jen svoje"), "zpět na Všichni"));
  });

  // ═════════════════════ 5 · Odznaky ═════════════════════
  await T("5 · odznak Poptávky = flow_badge_counts(uživatel) pro každou roli (admin null)", async (context) => {
    const page = await context.newPage();
    for (const [user, uid] of [[USERS.admin, null], [USERS.obchod, ID.obchod], [USERS.dilna, ID.dilna]]) {
      await login(page, user);
      // sdílená DB (souběžné sady) → porovnat v jednom okamžiku, případně znovu načíst
      await eventually(async () => {
        await page.reload();
        const shown = await navCount(page, "/inquiries");
        const db = badge(uid).inquiries;
        expect(shown === db, `${user.email}: Poptávky ${shown} = DB ${db}`);
      }, { timeout: 30_000, interval: 1000 });
      await context.clearCookies();
    }
  });

  // ═════════════════════ 6 · Kniha všem ═════════════════════
  await T("6 · Kniha: obchodník i zaměstnanec najdou M1–M4; obchodník nemění Obchodníka na M4", async (context) => {
    const page = await context.newPage();
    for (const user of [USERS.obchod, USERS.dilna]) {
      await login(page, user);
      await page.goto(`${BASE}/orders?segment=vse&q=${encodeURIComponent(`${PREFIX}${TAG}`)}`);
      await page.locator(`main a[href="/orders/${M1.id}"]`).first().waitFor({ timeout: 60_000 });
      for (const j of [M1, M2, M3, M4]) expect(await page.locator(`main a[href="/orders/${j.id}"]`).count() > 0, `${user.email}: Kniha ukazuje ${j.title}`);
      await context.clearCookies();
    }
    await login(page, USERS.obchod);
    await openJob(page, M4);
    const ro = page.locator('main [data-field="owner-readonly"]').first();
    await ro.waitFor({ timeout: 10_000 });
    expect(norm(await ro.innerText()).includes("Obchodníka zakázky mění jen super admin."), "Obchodník jen pro čtení");
  });

  // ═════════════════════ 7 · Objednávky dodavatelům ═════════════════════
  await T("7 · Objednávky dodavatelům: dílna PO-A bez cen, PDF a akcí, PO-B ne; obchodník PO-B s cenou", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.dilna);
    await page.goto(`${BASE}/purchasing`);
    await page.locator("main h1", { hasText: "Objednávky dodavatelům" }).waitFor({ timeout: 20_000 });
    const t = await mainText(page);
    expect(t.includes(`OV-E15-${TAG}-A`), "dílna vidí PO-A (její zakázka M2)");
    expect(!t.includes(`OV-E15-${TAG}-B`), "dílna nevidí PO-B");
    expect(t.includes("Ceny objednávek vidí obchodník a super admin."), "poznámka o cenách");
    const html = await page.content();
    expect(!/12\s?345/.test(html) && !html.includes("tajná poznámka"), "cena ani poznámka PO-A nejsou ani v HTML / datech stránky");
    expect(!t.includes("Poslat e-mailem") && (await page.locator('main a[href*="/api/pdf/purchase-order"]').count()) === 0, "bez PDF a odeslání");
    expect(await page.locator(`main a[href="/orders/${M2.id}?tab=vyroba"]`).count() > 0, "zakázka odkazuje do Výroby");
    await shot(page, S("07-purchasing-dilna"));
    await context.clearCookies();
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/purchasing`);
    await page.locator("main h1", { hasText: "Objednávky dodavatelům" }).waitFor({ timeout: 20_000 });
    const o = await mainText(page);
    expect(o.includes(`OV-E15-${TAG}-B`) && /6\s?789/.test(o), "obchodník vidí PO-B i s cenou");
  });

  // ═════════════════════ 8 · Dokumenty ═════════════════════
  await T("8 · Dokumenty: dílna vidí F1 a zamčený řádek SQ, GET SQ = 403; obchodník SQ otevře", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.dilna);
    await flowPage(page, "/documents", "Dokumenty");
    const t = await mainText(page);
    expect(t.includes(`${PREFIX}${TAG} výkres F1`), "dílna vidí F1 (nahrála ho)");
    const locked = page.locator('main li[data-locked="price"]').filter({ hasText: `${PREFIX}${TAG} nabídka kalírny` });
    await locked.waitFor({ timeout: 10_000 });
    expect(norm(await locked.innerText()).includes("Nákupní doklad — obsah vidí obchodník a super admin."), "zamčený řádek SQ s textem");
    expect(await page.locator(`main a[href^="/api/jobs/files/${SQ}"]`).count() === 0, "SQ bez odkazu na obsah");
    const r = await page.request.get(`${BASE}/api/jobs/files/${SQ}`);
    expect(r.status() === 403, `dílna GET SQ = 403 (${r.status()})`);
    await context.clearCookies();
    await login(page, USERS.obchod);
    const o = await page.request.get(`${BASE}/api/jobs/files/${SQ}`);
    expect(o.status() === 200, `obchodník GET SQ = 200 (${o.status()})`);
  });

  // ═════════════════════ 9 · ⌘K ═════════════════════
  await T("9 · ⌘K: obchodník nenajde cizí nabídku v „Nabídky“, ale zakázku M4 podle jejího čísla ano", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.obchod);
    const j = await (await page.request.get(`${BASE}/api/search`)).json();
    expect(!j.quotes.some((q) => q.label === ADMIN_Q4.number), "Nabídky: bez nabídky super admina na M4");
    const m4 = j.jobs.find((x) => x.id === M4.id);
    expect(m4 && (m4.keywords ?? "").includes(ADMIN_Q4.number.toLowerCase()) || (m4?.quoteNumbers ?? []).includes(ADMIN_Q4.number), "Zakázky: M4 podle čísla nabídky");
  });

  // ═════════════════════ 10 · Neschválená nabídka obchodníka ═════════════════════
  await T("10 · obchodník vytvoří nabídku na M1 → „Neschválená“ v hlavičce i kartě, zamčené odeslání, vodoznak; REST pojistky", async (context) => {
    sql("delete from audit_log where action = 'quote_approval_notice' and created_at > now() - interval '1 hour'");
    await clearMail(USERS.admin.email);
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/orders/${M1.id}?tab=nabidky&nova=1`);
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 30_000 });
    await dlg.locator('input[aria-label="Cena za MJ"]').first().fill("650");
    await dlg.getByRole("button", { name: "Vytvořit nabídku", exact: true }).click();
    await waitToast(page, /vytvořena — čeká na schválení super admina/);
    const row = await eventually(() => {
      const r = sql(`select id || '|' || number from quotes where job_id = ${lit(M1.id)}`);
      expect(r, "nabídka v DB");
      return r.split("|");
    });
    st.q1 = { id: row[0], number: row[1] };
    expect(quoteState(st.q1.id) === "ke_schvaleni|true|-", `DB: Neschválená (${quoteState(st.q1.id)})`);
    await page.reload();
    await page.locator('main section[aria-label="Zakázka"] [data-approval="pending"]').first().waitFor({ timeout: 20_000 });
    expect(norm(await page.locator('main section[aria-label="Zakázka"]').innerText()).includes("Neschválená — čeká na schválení super admina"), "hlavička: štítek");
    const card = quoteCard(page, st.q1.number);
    await card.waitFor({ timeout: 15_000 });
    const ct = norm(await card.innerText());
    expect(ct.includes("Neschválená — čeká na schválení super admina") && ct.includes("čeká na schválení super admina"), `karta: štítek + Schválil čeká (${ct.slice(0, 200)})`);
    const send = card.getByRole("button", { name: "Odeslat zákazníkovi" });
    expect(await send.isDisabled(), "Odeslat zákazníkovi zamčené");
    expect((await send.locator("xpath=..").getAttribute("title")) === "Odeslat půjde po schválení super adminem.", "vysvětlení u zamčeného odeslání");
    expect(ct.includes("Odeslat půjde po schválení super adminem."), "vysvětlení i jako text (dotyk)");
    await shot(page, S("10-job-unapproved-obchod"));
    await page.getByRole("button", { name: /^Doklady/ }).first().click();
    const nab = page.getByRole("menuitem").filter({ hasText: "Neschválená — vystavíš po schválení super adminem" });
    expect(await nab.count() === 1 && (await nab.getAttribute("aria-disabled")) === "true", "Doklady ▾ Nabídka zamčená");
    await page.keyboard.press("Escape");
    const pdf = await page.request.get(`${BASE}/api/pdf/job/${M1.id}?type=nabidka&quoteId=${st.q1.id}`);
    expect(pdf.status() === 200 && pdf.headers()["x-doc-watermark"] === "neschvaleno", `náhled s vodoznakem (${pdf.status()} ${pdf.headers()["x-doc-watermark"]})`);
    expect(/NESCHVALENO/.test(pdf.headers()["content-disposition"] ?? ""), `název souboru NESCHVALENO (${pdf.headers()["content-disposition"]})`);
    // REST: obchodník si nabídku neschválí, ani obejitím přes „zamítnuto → odesláno“
    const token = await restLogin(USERS.obchod);
    const a = await rest("PATCH", `quotes?id=eq.${QZ.id}`, { token, body: { approved_by: ID.obchod } });
    expect(a.status >= 400 && JSON.stringify(a.body).includes("Nabídku schvaluje jen super admin"), `REST approved_by → odmítnuto (${a.status} ${JSON.stringify(a.body).slice(0, 160)})`);
    await rest("PATCH", `quotes?id=eq.${QZ.id}`, { token, body: { status: "zamitnuto" } });
    const b = await rest("PATCH", `quotes?id=eq.${QZ.id}`, { token, body: { status: "odeslano" } });
    expect(b.status >= 400 && JSON.stringify(b.body).includes("čeká na schválení"), `REST zamítnuto → odesláno → odmítnuto (${b.status} ${JSON.stringify(b.body).slice(0, 160)})`);
    // Dokumenty → Vystavit doklad: nabídku nejde vystavit
    await flowPage(page, "/documents", "Dokumenty");
    const panel = page.locator("main #vystavit");
    await waitHydrated(page, "main #vystavit input[role=combobox]");
    await panel.getByRole("combobox").fill(M1.number);
    await panel.getByRole("option").filter({ hasText: M1.number }).first().click();
    await panel.getByRole("button", { name: /^Nabídka/ }).first().click();
    await panel.getByRole("button", { name: "Vystavit PDF" }).click();
    await panel.locator('[role="alert"]').filter({ hasText: "Nabídka čeká na schválení super admina — PDF k odeslání vystavíš až po schválení." }).waitFor({ timeout: 20_000 });
  });

  // ═════════════════════ 11 · Kniha řádek a mobil ═════════════════════
  await T("11 · Kniha: řádek M1 se štítkem; mobil 390 px karta „Neschválená“ bez přetékání", async (context) => {
    expect(st.q1, "nabídka z kroku 10");
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await page.goto(`${BASE}/orders?segment=vse&q=${encodeURIComponent(M1.number)}`);
    const row = page.locator("main li").filter({ has: page.locator(`a[href="/orders/${M1.id}"]`) }).first();
    await row.locator('[data-approval="pending"]').first().waitFor({ timeout: 20_000 });
    expect(norm(await row.innerText()).includes("Neschválená"), "řádek: Neschválená");
    await expectNoOverflow(page, "Kniha mobil");
    await shot(page, S("11-book-mobile"));
  }, { mobile: true });

  // ═════════════════════ 12 · Vrácení a schválení ═════════════════════
  await T("12 · super admin vrátí (důvod) → obchodník vidí důvod + odznak, upraví → zpět ve frontě; schválí z AI přehledu; razítko; jeden e-mail „Ke schválení:“", async () => {
    expect(st.q1, "nabídka z kroku 10");
    const reason = `Doplň dopravu ${TAG}`;
    await asUser(USERS.admin, async (ap) => {
      await flowPage(ap, "/quotes", "Nabídky");
      const sec = ap.locator("main #ke-schvaleni");
      const item = sec.locator(`[data-pending-quote="${st.q1.id}"]`);
      await item.waitFor({ timeout: 20_000 });
      await waitHydrated(ap, `main [data-pending-quote="${st.q1.id}"] button`);
      expect(norm(await item.innerText()).includes(`připravil(a) ${OBCHOD_NAME}`), "fronta: autor");
      await shot(ap, S("12-quotes-ke-schvaleni"));
      await item.getByRole("button", { name: "Vrátit…" }).click();
      const dlg = ap.getByRole("dialog");
      await dlg.getByLabel("Co má autor upravit?").fill(reason);
      await dlg.getByRole("button", { name: "Vrátit k přepracování" }).click();
      await waitToast(ap, new RegExp(`vrácena — ${esc(OBCHOD_NAME)} ji uvidí v Nabídkách`));
    });
    expect(sql(`select (approval_returned_at is not null) || '|' || approval_return_note from quotes where id = ${lit(st.q1.id)}`) === `true|${reason}`, "DB: vráceno s důvodem");
    await asUser(USERS.obchod, async (op) => {
      const b = badge(ID.obchod);
      expect((await navCount(op, "/quotes")) === b.ready + b.returned && b.returned >= 1, `odznak Nabídky = připravené + vrácené (${JSON.stringify(b)})`);
      await openJob(op, M1, "nabidky");
      const card = quoteCard(op, st.q1.number);
      await card.waitFor({ timeout: 15_000 });
      expect(norm(await card.innerText()).includes(`Vráceno k přepracování: ${reason}`), "karta: důvod vrácení");
      await card.getByRole("button", { name: "Další akce nabídky" }).click();
      await op.getByRole("menuitem", { name: "Upravit nabídku" }).click();
      const dlg = op.getByRole("dialog");
      await dlg.getByLabel(/Dodací lhůta/).fill("20");
      await dlg.getByRole("button", { name: /Uložit/ }).click();
      await waitToast(op, /uložena|znovu schválit/);
    });
    await eventually(() => expect(sql(`select approval_returned_at is null from quotes where id = ${lit(st.q1.id)}`) === "t", "úprava zrušila vrácení"));
    await asUser(USERS.admin, async (ap) => {
      await ap.goto(`${BASE}/dashboard`);
      const item = ap.locator(`main [data-pending-quote="${st.q1.id}"]`);
      await item.waitFor({ timeout: 30_000 });
      await waitHydrated(ap, `main [data-pending-quote="${st.q1.id}"] button`);
      await item.getByRole("button", { name: "Schválit", exact: true }).click();
      await waitToast(ap, new RegExp(`${esc(st.q1.number)} schválena — ${esc(OBCHOD_NAME)} ji teď může odeslat`));
    });
    expect(quoteState(st.q1.id) === `schvalena|true|${ID.admin}`, `DB: schválená super adminem (${quoteState(st.q1.id)})`);
    await asUser(USERS.obchod, async (op) => {
      await openJob(op, M1, "nabidky");
      const stamp = `Připravil(a) ${short(OBCHOD_NAME)} · Schválil ${short(ADMIN_NAME)}`;
      await eventually(async () => expect((await mainText(op)).includes(stamp), `razítko „${stamp} · datum“`));
      expect(await op.locator('main [data-approval="approved"]').count() >= 2, "razítko v hlavičce i v kartě");
    });
    const mails = await waitMail(USERS.admin.email, (m) => String(m.subject).startsWith("Ke schválení:") && String(m.subject).includes(st.q1.number), 15_000);
    expect(mails, "super admin dostal e-mail „Ke schválení: …“");
  });

  // ═════════════════════ 12b · Schválit a odeslat ═════════════════════
  await T("12b · super admin „Schválit a odeslat“ z /quotes: návrh e-mailu bez PDF, potvrzením schválí + vystaví + odešle; zavření nic neschválí", async (context) => {
    const INFO_BOX = "d5000000-0000-0000-0000-000000000003";
    const before = sql(`select coalesce(owner_id::text, 'null') || '|' || config::text from mailboxes where id = ${lit(INFO_BOX)}`).split("|");
    const back = `update mailboxes set owner_id = ${before[0] === "null" ? "null" : lit(before[0])}, config = ${lit(before.slice(1).join("|"))}::jsonb where id = ${lit(INFO_BOX)}`;
    restore.push(back);
    // super admin odesílá ze své schránky — na chvíli mu patří info@ (s SMTP do lokálního zachytávače), hned se vrátí
    sql(`update mailboxes set owner_id = ${lit(ID.admin)}, config = '{"smtp_host": "127.0.0.1", "smtp_port": 54325, "smtp_user": "info@mnastrojarna.test", "smtp_password": "test"}'::jsonb where id = ${lit(INFO_BOX)}`);
    try {
    await clearMail(CUST_EMAIL);
    const page = await context.newPage();
    await login(page, USERS.admin);
    await flowPage(page, "/quotes", "Nabídky");
    await waitHydrated(page, 'main input[aria-label="Hledat v nabídkách"]');
    await page.locator('main input[aria-label="Hledat v nabídkách"]').fill(QS.number);
    // řádek tabule (ne řádek sekce „Ke schválení“ nahoře)
    const row = page.locator("main ul > li:not([data-pending-quote])").filter({ hasText: QS.number }).first();
    await row.waitFor({ timeout: 15_000 });
    const openDialog = async () => {
      await row.getByRole("button", { name: `Další akce nabídky ${QS.number}` }).click();
      await page.getByRole("menuitem", { name: "Schválit a odeslat" }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("heading", { name: `Schválit a odeslat nabídku ${QS.number}` }).waitFor({ timeout: 15_000 });
      await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu předvyplněno"));
      return dlg;
    };
    let dlg = await openDialog();
    expect(norm(await dlg.innerText()).includes("vystaví se po schválení"), "PDF se vystaví až po schválení");
    await shot(page, S("12b-approve-send"));
    await dlg.getByRole("button", { name: "Zrušit" }).click();
    expect(quoteState(QS.id) === "ke_schvaleni|true|-", `zavření nic neschválilo (${quoteState(QS.id)})`);
    dlg = await openDialog();
    await dlg.getByRole("button", { name: "Schválit a odeslat" }).click();
    await waitToast(page, new RegExp(`${esc(QS.number)} schválena a odeslána na`), 40_000);
    await eventually(() => expect(sql(`select state || '|' || approved_by from quotes where id = ${lit(QS.id)}`) === `odeslana|${ID.admin}`, "DB: schválená super adminem a odeslaná"));
    const mail = await waitMail(CUST_EMAIL, (m) => String(m.subject).includes(QS.number));
    expect(mail && fileAttachments(mail).length === 1 && !/NESCHVALENO/.test(fileAttachments(mail)[0].filename ?? ""), `e-mail s PDF (${JSON.stringify(mail?.attachments)})`);
    } finally {
      sql(back);
    }
  });

  // ═════════════════════ 13 · Obchodník odešle ═════════════════════
  await T("13 · obchodník: odznak Nabídky = připravené k odeslání; Odeslat zákazníkovi → PDF bez NESCHVALENO; stav Odeslaná", async () => {
    expect(st.q1, "nabídka z kroku 10");
    await clearMail(CUST_EMAIL);
    await asUser(USERS.obchod, async (op) => {
      const b = badge(ID.obchod);
      expect((await navCount(op, "/quotes")) === b.ready + b.returned && b.ready >= 1, `odznak Nabídky (${JSON.stringify(b)})`);
      await openJob(op, M1, "nabidky");
      const card = quoteCard(op, st.q1.number);
      await card.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
      const dlg = op.getByRole("dialog");
      await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
      await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu předvyplněno"));
      await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
      await waitToast(op, new RegExp(`${esc(st.q1.number)} odeslána`), 30_000);
    });
    const mail = await waitMail(CUST_EMAIL, (m) => String(m.subject).includes(st.q1.number));
    expect(mail && fileAttachments(mail).length === 1 && !/NESCHVALENO/.test(fileAttachments(mail)[0].filename ?? ""), `e-mail s čistým PDF (${JSON.stringify(mail?.attachments)})`);
    await eventually(() => expect(sql(`select state from quotes where id = ${lit(st.q1.id)}`) === "odeslana", "DB: odeslaná"));
  });

  // ═════════════════════ 14 · Znovuschválení ═════════════════════
  await T("14 · schválená nabídka: obchodník změní platnost → zase Neschválená, událost „schválení zrušeno“", async (context) => {
    expect(quoteState(QV.id) === `schvalena|true|${ID.admin}`, `výchozí stav: schválená (${quoteState(QV.id)})`);
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await openJob(page, MV, "nabidky");
    const card = quoteCard(page, QV.number);
    await card.getByRole("button", { name: "Další akce nabídky" }).click();
    await page.getByRole("menuitem", { name: "Upravit nabídku" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('input[type="date"]').fill(sql("select to_char(current_date + 45, 'YYYY-MM-DD')"));
    await dlg.getByRole("button", { name: /Uložit/ }).click();
    await waitToast(page, /Nabídka upravena — změnu musí super admin znovu schválit/);
    await eventually(() => expect(quoteState(QV.id) === "ke_schvaleni|true|-", `DB: zase neschválená (${quoteState(QV.id)})`));
    const ev = sql(`select message from job_events where job_id = ${lit(MV.id)} and type = 'quote' order by created_at desc limit 1`);
    expect(ev.includes("schválení zrušeno"), `historie: ${ev}`);
    await eventually(async () => expect((await mainText(page)).includes("Neschválená"), "karta: Neschválená"));
  });

  // ═════════════════════ 15 · Nabídka super admina ═════════════════════
  await T("15 · nabídka super admina na M4: Rozpracovaná bez štítku; obchodník ji na /quotes nemá, v kartě M4 ano", async (context) => {
    expect(sql(`select state || '|' || admin_approval_required from quotes where id = ${lit(ADMIN_Q4.id)}`) === "rozpracovana|false", "DB: rozpracovaná, bez schválení");
    const page = await context.newPage();
    await login(page, USERS.obchod);
    await flowPage(page, "/quotes", "Nabídky");
    expect(!(await mainText(page)).includes(ADMIN_Q4.number), "obchodník na /quotes nabídku super admina nevidí");
    await openJob(page, M4, "nabidky");
    const card = quoteCard(page, ADMIN_Q4.number);
    await card.waitFor({ timeout: 15_000 });
    expect(norm(await card.innerText()).includes("Rozpracovaná"), "karta M4: Rozpracovaná");
    expect(await page.locator('main [data-approval]').count() === 0, "bez štítku schválení");
  });

  // ═════════════════════ 16 · Zaměstnanec autor ═════════════════════
  await T("16 · zaměstnanec vytvoří nabídku na M2, super admin schválí, zaměstnanec ji odešle ze své schránky", async () => {
    const cfg = sql(`select config::text from mailboxes where id = ${lit(DILNA_BOX)}`);
    restore.push(`update mailboxes set config = ${lit(cfg)}::jsonb where id = ${lit(DILNA_BOX)}`);
    sql(`update mailboxes set config = '{"smtp_host": "127.0.0.1", "smtp_port": 54325, "smtp_user": "dilna@mnastrojarna.test", "smtp_password": "test"}'::jsonb where id = ${lit(DILNA_BOX)}`);
    await clearMail(CUST_EMAIL);
    let q2 = null;
    await asUser(USERS.dilna, async (dp) => {
      await dp.goto(`${BASE}/orders/${M2.id}?tab=nabidky&nova=1`);
      const dlg = dp.getByRole("dialog");
      await dlg.getByRole("heading", { name: "Nová nabídka" }).waitFor({ timeout: 30_000 });
      await dlg.locator('input[aria-label="Cena za MJ"]').first().fill("480");
      await dlg.getByRole("button", { name: "Vytvořit nabídku", exact: true }).click();
      await waitToast(dp, /čeká na schválení super admina/);
    });
    q2 = sql(`select id || '|' || number from quotes where job_id = ${lit(M2.id)} and created_by = ${lit(ID.dilna)}`).split("|");
    expect(q2[0] && quoteState(q2[0]) === "ke_schvaleni|true|-", "DB: nabídka zaměstnance Neschválená");
    await asUser(USERS.admin, async (ap) => {
      await openJob(ap, M2, "nabidky");
      const card = quoteCard(ap, q2[1]);
      await card.getByRole("button", { name: "Schválit", exact: true }).click();
      await waitToast(ap, /schválena/);
    });
    await asUser(USERS.dilna, async (dp) => {
      await openJob(dp, M2, "nabidky");
      const card = quoteCard(dp, q2[1]);
      await card.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
      const dlg = dp.getByRole("dialog");
      await dlg.locator('a[href^="/api/jobs/files/"]').waitFor({ timeout: 30_000 });
      await eventually(async () => expect((await recipients(dlg, "Komu")) === CUST_EMAIL, "Komu předvyplněno"));
      await dlg.getByRole("button", { name: "Odeslat zákazníkovi" }).click();
      await waitToast(dp, new RegExp(`${esc(q2[1])} odeslána`), 30_000);
    });
    const mail = await waitMail(CUST_EMAIL, (m) => String(m.subject).includes(q2[1]));
    expect(mail && /dilna@mnastrojarna\.test/.test(JSON.stringify(mail.from ?? mail)), `doručeno ze schránky dílny (${JSON.stringify(mail?.from)})`);
    await eventually(() => expect(sql(`select state || '|' || sent_by from quotes where id = ${lit(q2[0])}`) === `odeslana|${ID.dilna}`, "DB: odeslal zaměstnanec"));
  });

  // ═════════════════════ 17 · AI focení pro všechny ═════════════════════
  await T("17 · AI focení pro všechny: výchozí zapnuto (DB + /users), zaměstnanec fotí s AI", async (context) => {
    expect(sql("select value from integration_settings where key = 'ai_capture_for_all'") === "true", "DB: ai_capture_for_all = true");
    const page = await context.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/users`);
    const sw = page.getByRole("switch", { name: /AI focení pro všechny uživatele/ });
    await sw.first().waitFor({ timeout: 20_000 });
    expect((await sw.first().getAttribute("aria-checked")) === "true" || (await sw.first().getAttribute("data-state")) === "checked", "přepínač zapnutý");
    await context.clearCookies();
    await login(page, USERS.dilna);
    await page.goto(`${BASE}/orders`);
    await page.getByRole("button", { name: "Vyfotit doklad", exact: true }).click();
    const dlg = captureDialog(page);
    await dlg.waitFor({ timeout: 15_000 });
    const fileName = `e2e15-cap-${TAG}.png`;
    await page.getByTestId("capture-files-input").setInputFiles([pngFile(fileName, 7)]);
    await eventually(async () => expect(await page.getByTestId("capture-read").isEnabled(), "Přečíst je povolené"));
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/jobs/capture/analyze"), { timeout: 90_000 }),
      page.getByTestId("capture-read").click(),
    ]);
    const body = await resp.json().catch(() => ({}));
    try {
      expect(body.ok && body.model?.aiUsed === true, `AI přečetla fotku zaměstnance (${JSON.stringify(body).slice(0, 200)})`);
      await page.getByTestId("capture-save").waitFor({ timeout: 30_000 });
      const t = norm(await dlg.innerText());
      expect(!t.includes("Nemáš povolené AI"), `bez „Nemáš povolené AI“ (${t.slice(0, 200)})`);
    } finally {
      await removeStorage(storageObjects(fileName));
    }
  });

  // ═════════════════════ 18 · Přepnutí vlastníka schránky ═════════════════════
  await T("18 · schránka obchodu → dílna: dílna vidí M3, obchodník už ne (vráceno na konci)", async (context) => {
    restore.push(`update mailboxes set owner_id = ${lit(ID.obchod)} where id = ${lit(OBCHOD_BOX)}`);
    restore.push(`update emails set owner_id = ${lit(ID.obchod)} where mailbox_id = ${lit(OBCHOD_BOX)} and direction = 'in'`);
    sql(`update mailboxes set owner_id = ${lit(ID.dilna)} where id = ${lit(OBCHOD_BOX)}`);
    sql(`update emails set owner_id = ${lit(ID.dilna)} where mailbox_id = ${lit(OBCHOD_BOX)} and direction = 'in'`);
    try {
      const page = await context.newPage();
      await login(page, USERS.dilna);
      await flowPage(page, "/inquiries", "Poptávky");
      expect(await hasJob(page, M3), "dílna teď vidí M3");
      await context.clearCookies();
      await login(page, USERS.obchod);
      await flowPage(page, "/inquiries", "Poptávky");
      expect(!(await hasJob(page, M3)), "obchodník M3 už nevidí");
    } finally {
      sql(`update mailboxes set owner_id = ${lit(ID.obchod)} where id = ${lit(OBCHOD_BOX)}`);
      sql(`update emails set owner_id = ${lit(ID.obchod)} where mailbox_id = ${lit(OBCHOD_BOX)} and direction = 'in'`);
    }
  });

  // ═════════════════════ 19 · Fronta bez anonymů ═════════════════════
  await T("19 · anonymní REST approval_queue → []", async () => {
    const r = await rest("GET", "approval_queue?select=id");
    expect(Array.isArray(r.body) && r.body.length === 0, `anon approval_queue = [] (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
  });

  // ═════════════════════ 20 · Zaměstnanec není obchodníkem zákazníka ═════════════════════
  await T("20 · zaměstnanec: Nový zákazník s Obchodníkem jen pro čtení „— bez obchodníka —“ → DB owner NULL; Nová zakázka bez výběru Obchodníka", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.dilna);
    await page.goto(`${BASE}/customers`);
    await page.locator("main h1").first().waitFor({ timeout: 20_000 });
    await waitHydrated(page, "main button");
    await page.getByRole("button", { name: "Nový zákazník", exact: true }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("heading", { name: "Nový zákazník" }).waitFor({ timeout: 10_000 });
    expect((await dlg.locator("#cust-ownerId").count()) === 0, "dílna nemá výběr Obchodníka zákazníka");
    const ro = norm(await dlg.locator('[data-field="owner-readonly"]').innerText());
    expect(ro.includes("— bez obchodníka —") && ro.includes("Obchodníka zákazníka mění jen super admin."), `Obchodník jen pro čtení (${ro})`);
    const name = `${PREFIX}${TAG} dílna zákazník s.r.o.`;
    await dlg.locator("#cust-name").fill(name);
    await dlg.getByRole("button", { name: "Založit zákazníka" }).click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const owner = sql(`select coalesce(owner_id::text, 'NULL') from customers where name = ${lit(name)}`);
    expect(owner === "NULL", `DB: zákazník založený zaměstnancem nemá obchodníka (${owner})`);
    await shot(page, S("20-customer-dilna"));

    await page.goto(`${BASE}/orders?new=1`);
    const job = page.getByRole("dialog");
    await job.getByRole("heading", { name: "Nová zakázka" }).waitFor({ timeout: 20_000 });
    expect((await job.getByLabel("Obchodník", { exact: true }).count()) === 0, "Nová zakázka: dílna nemá výběr Obchodníka");
    const jro = norm(await job.locator('[data-field="owner-readonly"]').innerText());
    expect(jro.includes("Obchodníka zakázky mění jen super admin."), `Nová zakázka: Obchodník jen pro čtení (${jro})`);
    await page.keyboard.press("Escape");
  });

  // ═════════════════════ mobil: odznak Menu super admina ═════════════════════
  await T("mobil 390 px: super admin má číslo na „Menu“ = AI přehled (fronta + nabídky kolegů)", async (context) => {
    const page = await context.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders`);
    const btn = page.locator("nav button", { hasText: "Menu" }).first();
    await btn.waitFor({ timeout: 15_000 });
    const queued = Number(sql("select count(*) from approval_queue where status = 'pending'"));
    const expected = queued + badge(null).manual;
    const label = await btn.getAttribute("aria-label");
    expect(expected === 0 ? label === "Menu" : label === `Menu — ${expected} čeká`, `Menu odznak (${label}, čekám ${expected})`);
    await btn.click();
    await page.getByRole("dialog").getByRole("heading", { name: "Menu" }).waitFor({ timeout: 10_000 });
    await shot(page, S("mobile-menu-admin"));
  }, { mobile: true });
} finally {
  for (const s of restore.reverse()) {
    try { sql(s); } catch (err) { console.log(`  (obnova selhala: ${err.message})`); }
  }
  await removeStorageFiles([SQ_PATH]);
  await cleanup();
}

await browser.close();
process.exit(summary(errors) ? 0 : 1);
