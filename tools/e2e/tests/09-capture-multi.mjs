// E2E: dávkové focení — více dokladů v jednom kole (AI roztřídí, vzájemně doplní, uloží každý správně).
// Testovací AI = AI_FAKE_CAPTURE: druh dokladu podle značky v názvu souboru („…__<typ>[+flag][-s<n>][-g<id>][-dup]“),
// PDF s více doklady „…__sada-<jméno>.pdf“, data dokladů z fixtures src/lib/jobs/__fixtures__/capture/batch/.
// Vlastní data mají prefix „E2E-multi-<běh>“; demo data se jen čtou. Desktop 1440 i mobil 390 px.
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS, BASE, USERS, launch, newContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import {
  captureDialog, clientBuildLacksSupabaseEnv, deleteJobDeep, insertJob, installEnvShim, multiPagePdf,
  noHorizontalOverflow, overflowingInDialog, pngFile, q, removeStorage, sqlJson, stepFile, storageObjects, storagePdfPages, userId, zipFile,
} from "../lib-capture.mjs";

fs.mkdirSync(path.join(ARTIFACTS, "capture-multi"), { recursive: true });

const RUN = Date.now().toString(36);
const TAG = `E2E-multi-${RUN}`;
const STARTED = new Date().toISOString();
const ADMIN_ID = userId(USERS.admin.email);
const DILNA_ID = userId(USERS.dilna.email);
const OBCHOD_ID = userId(USERS.obchod.email);
const TEST_USERS = [ADMIN_ID, DILNA_ID, OBCHOD_ID].map(q).join(", ");
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";

const browser = await launch();
const errors = [];
/** Úklid na konci (i když test spadne). */
const cleanup = { jobs: new Set(), captures: new Set(), customers: new Set(), restore: [] };

/** Zakázka testu se vším, co k ní uložení dávky vytvořilo (nabídky dodavatelů, OV, výkresy, soubory). */
async function cleanJob(id) {
  if (!id) return;
  sql(`delete from supplier_quotes where job_id = ${q(id)}`);
  sql(`delete from purchase_orders where job_id = ${q(id)}`);
  sql(`delete from drawings where job_id = ${q(id)}`);
  await deleteJobDeep(id);
}

/** Úklid po každém testu — další test nesmí navázat na zakázku předchozího (stejná čísla dokladů z fixtures). */
async function cleanAfterTest() {
  for (const id of cleanup.jobs) {
    try {
      await cleanJob(id);
    } catch (e) {
      console.log(`  ! úklid zakázky ${id}: ${e.message}`);
    }
  }
  cleanup.jobs.clear();
  for (const id of cleanup.customers) {
    sql(`delete from customer_contacts where customer_id = ${q(id)} and not exists (select 1 from orders where customer_id = ${q(id)})`);
    sql(`delete from customers where id = ${q(id)} and created_at >= ${q(STARTED)} and not exists (select 1 from orders where customer_id = ${q(id)})`);
  }
  cleanup.customers.clear();
}

/** Náhledy roztřídění (capture/<uživatel>/<uuid>.sort.jpg) testovacích účtů vzniklé od `since`. */
function sortPreviews(since) {
  return sqlJson(`select json_agg(name) from storage.objects where bucket_id = 'job-files' and name like '%.sort.jpg' and created_at >= ${q(since)}
    and split_part(name, '/', 2) in (${TEST_USERS})`) ?? [];
}

// ── Prostředí: klientský build bez NEXT_PUBLIC_SUPABASE_* → náhrada v prohlížeči ──
let needShim = false;
{
  const { context } = await newContext(browser);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders`);
  await page.waitForLoadState("networkidle");
  needShim = await clientBuildLacksSupabaseEnv(page);
  await context.close();
}

async function inContext(fn, opts = {}) {
  const { context, errors: ctxErrors } = await newContext(browser, opts);
  if (needShim) await installEnvShim(context);
  try {
    await fn(context);
  } finally {
    errors.push(...ctxErrors);
    await context.close();
    await cleanAfterTest();
  }
}
const T = (name, fn, opts) => test(name, () => inContext(fn, opts));

// ── Pomocníci toku ─────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fname = (label, tag, ext = "png") => `${TAG}-${label}__${tag}.${ext}`;

async function waitEnabled(locator, timeout = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await locator.isVisible().catch(() => false) && await locator.isEnabled().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Prvek nebyl povolen do ${timeout} ms`);
}

async function openFromBook(page) {
  await page.goto(`${BASE}/orders`);
  await page.getByRole("button", { name: "Vyfotit doklad", exact: true }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor({ timeout: 15_000 });
  return dlg;
}

async function upload(page, files) {
  await page.getByTestId("capture-files-input").setInputFiles(files);
  await waitEnabled(page.getByTestId("capture-read"));
}

/** Přečíst a roztřídit → krok Roztřídění (nebo rovnou Kontrola u 1 dokladu). Vrací odpověď /analyze. */
async function readBatch(page, { expectSort = true } = {}) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/analyze"), { timeout: 120_000 }),
    page.getByTestId("capture-read").click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body.ok, `analyze ok (${JSON.stringify(body).slice(0, 300)})`);
  if (body.batch) cleanup.captures.add(body.batch.captureId);
  if (body.model) cleanup.captures.add(body.model.captureId);
  if (expectSort) await page.getByTestId("capture-sort").waitFor({ timeout: 60_000 });
  return body;
}

/** Karty roztřídění: [{ docId, type, group, status }]. */
async function sortCards(page) {
  return page.getByTestId("capture-sort-doc").evaluateAll((els) => els.map((e) => ({
    docId: e.getAttribute("data-doc-id"), type: e.getAttribute("data-type"),
    group: e.getAttribute("data-group"), status: e.getAttribute("data-status"),
  })));
}

/** Pokračovat ke kontrole → hlavičky skupin a „Uložit vše". */
async function toReview(page) {
  const btn = page.getByTestId("capture-sort-continue");
  await waitEnabled(btn, 60_000);
  await btn.click();
  await page.getByTestId("capture-group").first().waitFor({ timeout: 120_000 });
  await page.getByTestId("capture-batch-summary").waitFor({ timeout: 30_000 });
}

/** Uložit vše → Hotovo. Vrací BatchResult. */
async function saveAll(page) {
  const save = page.getByTestId("capture-save");
  await waitEnabled(save, 30_000);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/batch/apply"), { timeout: 120_000 }),
    save.click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body.ok, `batch/apply ok (${JSON.stringify(body).slice(0, 400)})`);
  for (const g of body.groups ?? []) if (g.created && g.jobId) cleanup.jobs.add(g.jobId);
  await page.getByTestId("capture-result-headline").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  return body;
}

/** Vybrat cíl skupiny (karta zakázky v radiogroup „Zakázka" dané skupiny). */
async function pickGroupTarget(group, label) {
  const re = label instanceof RegExp ? label : new RegExp(esc(label));
  await group.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio", { name: re }).first().click();
}

async function changeType(page, card, label) {
  await card.getByRole("button", { name: "Změnit druh dokladu" }).click();
  const sheet = page.getByTestId("capture-type-sheet");
  await sheet.waitFor();
  await sheet.getByRole("button", { name: label, exact: true }).click();
  await sheet.waitFor({ state: "detached" });
}

function jobFiles(jobId) {
  return sqlJson(`select json_agg(f order by created_at) from (select id, kind, title, filename, storage_path, version, archived, uploaded_by, order_item_id, capture_id, ai_extracted, created_at from job_files where job_id = ${q(jobId)}) f`) ?? [];
}

function myJob(letter, { stage = "objednavka", customerId = STROJMETAL } = {}) {
  const number = `E2E-MULTI-${letter}-${RUN}`;
  const id = insertJob({ number, title: `${TAG} ${letter}`, customerId, stage, ownerId: ADMIN_ID });
  cleanup.jobs.add(id);
  return { id, number };
}

console.log("09 · Dávkové focení (roztřídění, kontrola po zakázkách, uložení, bez AI, bez marží, mobil, ochrany)");

// ═════════════════════════════════════════════════════════════
await T("desktop — plná dávka: objednávka, výkres PNG, STEP, nabídka dodavatele, PDF DL+faktura → roztřídění, opravy, 1 zakázka", async (context) => {
  const since = new Date().toISOString();
  const page = await context.newPage();
  await login(page, USERS.admin);
  const dlg = await openFromBook(page);
  const files = [
    pngFile(fname("po", "objednavka_zakaznik-s1"), 1),
    // 2. strana objednávky, kterou AI vzala jako samostatnou fotku → uživatel ji přesune
    pngFile(fname("po2", "foto"), 2),
    pngFile(fname("vkr", "vykres"), 3),
    stepFile(`${TAG}-4711-02_rev_B.step`, "4711-02"),
    // nabídka dodavatele, kterou AI omylem vzala jako naši → uživatel opraví druh
    pngFile(fname("nab", "nabidka_my"), 4),
    multiPagePdf(fname("sada", "sada-dl-faktura", "pdf"), ["Dodaci list DL-E2E-1", "Faktura FV-E2E-1"]),
  ];
  await upload(page, files);
  // nápověda patří k AI v prohlížeči (E2E build bez klíče ji nemá, server čte přes AI_FAKE_CAPTURE)
  const readLabel = await page.getByTestId("capture-read").innerText();
  if (!readLabel.includes("Pokračovat k vyplnění")) expect((await dlg.innerText()).includes("Klidně vše najednou"), "nápověda u více souborů");
  const analyzed = await readBatch(page);
  expect(analyzed.batch && !analyzed.batch.skipSort, "dávka → krok Roztřídění");
  let cards = await sortCards(page);
  const types0 = cards.map((c) => c.type).sort();
  expect(JSON.stringify(types0) === JSON.stringify(["dodaci_list_my", "faktura_my", "foto", "model_3d", "nabidka_my", "objednavka_zakaznik", "vykres"]),
    `7 karet podle AI (${JSON.stringify(cards)})`);
  const model0 = analyzed.batch.sort.docs.find((d) => d.type === "model_3d");
  expect(model0?.format === "STEP", `3D model s formátem STEP (${JSON.stringify(model0)})`);
  const sada = analyzed.batch.sort.docs.filter((d) => d.type === "dodaci_list_my" || d.type === "faktura_my");
  expect(sada.length === 2 && sada.every((d) => d.pageIds.length === 1) && sada[0].pageIds[0] !== sada[1].pageIds[0], "PDF rozdělené na 2 doklady po stranách");
  expect(analyzed.batch.sort.docs.find((d) => d.type === "dodaci_list_my")?.flags?.includes("signed"), "DL s podpisem (signed)");
  await shot(page, "capture-multi/1-sort-ai");

  // přesun stránky: „foto" patří k objednávce
  const foto = page.locator('[data-testid="capture-sort-doc"][data-type="foto"]');
  await foto.getByRole("button", { name: /akce stránky/ }).first().click();
  const sheet = page.getByTestId("capture-page-sheet");
  await sheet.waitFor();
  await sheet.getByRole("button", { name: /Objednávka zákazníka/ }).first().click();
  await sheet.waitFor({ state: "detached" });
  // oprava druhu: naše nabídka → nabídka dodavatele
  await changeType(page, page.locator('[data-testid="capture-sort-doc"][data-type="nabidka_my"]'), "Nabídka dodavatele");
  cards = await sortCards(page);
  const types = cards.filter((c) => c.status !== "excluded").map((c) => c.type).sort();
  expect(JSON.stringify(types) === JSON.stringify(["dodaci_list_my", "faktura_my", "model_3d", "nabidka_dodavatel", "objednavka_zakaznik", "vykres"]),
    `6 karet po opravě (${JSON.stringify(cards)})`);
  const groupOf = Object.fromEntries(cards.map((c) => [c.type, c.group]));
  expect(groupOf.objednavka_zakaznik === "zakaznik" && groupOf.nabidka_dodavatel === "dodavatel" && groupOf.faktura_my === "my" && groupOf.vykres === "ostatni",
    `pruh strany podle vystavitele (${JSON.stringify(groupOf)})`);
  const poPages = await page.locator('[data-testid="capture-sort-doc"][data-type="objednavka_zakaznik"]').getByRole("button", { name: /akce stránky/ }).count();
  expect(poPages === 2, `objednávka má 2 stránky (${poPages})`);
  await shot(page, "capture-multi/1-sort-fixed");

  await toReview(page);
  const groups = page.getByTestId("capture-group");
  expect(await groups.count() === 1, `1 skupina zakázky (${await groups.count()})`);
  const review = await captureDialog(page).innerText();
  expect(review.includes("Vyfakturováno"), "stav zakázky → Vyfakturováno");
  await shot(page, "capture-multi/1-review");
  const res = await saveAll(page);
  const docs = page.getByTestId("capture-batch-result-doc");
  expect(await docs.count() === 6, `6 řádků výsledku (${await docs.count()})`);
  expect(await page.locator('[data-testid="capture-batch-result-doc"][data-ok="false"]').count() === 0, "vše uloženo");
  await shot(page, "capture-multi/1-done");

  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  expect(jobId, "zakázka výsledku");
  const f = jobFiles(jobId);
  const kinds = f.map((x) => x.kind).sort();
  expect(JSON.stringify(kinds) === JSON.stringify(["dodaci_list", "faktura", "model_3d", "naceneni", "objednavka", "vykres"]), `dokumenty se správnými druhy (${kinds.join(", ")})`);
  const po = f.filter((x) => x.kind === "objednavka");
  expect(po.length === 1 && /\.pdf$/i.test(po[0].filename), `vícestránková objednávka = 1 PDF (${po.map((x) => x.filename)})`);
  const pdfPages = po[0] ? await storagePdfPages(po[0].storage_path) : -1;
  expect(pdfPages === 2, `PDF objednávky má 2 strany (${pdfPages})`);
  const split = await Promise.all(f.filter((x) => x.kind === "dodaci_list" || x.kind === "faktura").map((x) => storagePdfPages(x.storage_path)));
  expect(split.length === 2 && split.every((n) => n === 1), `DL a faktura = samostatná 1stránková PDF (${split})`);
  const model = f.find((x) => x.kind === "model_3d");
  expect(model?.ai_extracted?.format === "STEP" && /\.step$/i.test(model.filename), `model s formátem STEP (${JSON.stringify(model?.ai_extracted)})`);
  const drawing = f.find((x) => x.kind === "vykres");
  expect(model?.order_item_id && drawing?.order_item_id, "výkres i model navázané na položku");
  const item = sqlJson(`select row_to_json(i) from (select drawing_number, revision from order_items where id = ${q(drawing?.order_item_id)}) i`);
  expect(item?.drawing_number === "4711-02", `výkres → položka 4711-02 (${JSON.stringify(item)})`);
  expect(f.every((x) => x.uploaded_by === ADMIN_ID && x.capture_id === analyzed.batch.captureId), "nahrál admin, capture_id relace");
  const dr = sqlJson(`select row_to_json(d) from (select drawing_number, revision, storage_bucket, job_id from drawings where drawing_number = '4711-02' and job_id = ${q(jobId)}) d`);
  expect(dr?.revision === "B" && dr.storage_bucket === "job-files", `výkres v archivu s číslem (${JSON.stringify(dr)})`);
  const sq = sqlJson(`select json_agg(s) from (select id, source, file_id, capture_id, (select count(*) from supplier_quote_items i where i.supplier_quote_id = q.id) as items from supplier_quotes q where job_id = ${q(jobId)}) s`) ?? [];
  expect(sq.length === 1 && sq[0].source === "foto" && sq[0].file_id && sq[0].capture_id === analyzed.batch.captureId && Number(sq[0].items) === 2,
    `nabídka dodavatele v Nákupu se 2 položkami (${JSON.stringify(sq)})`);
  const o = sqlJson(`select row_to_json(o) from (select invoice_number, delivery_note_number, status from orders where id = ${q(jobId)}) o`);
  expect(o.invoice_number === "FV-E2E-1" && o.delivery_note_number === "DL-E2E-1", `faktura a DL zapsané (${JSON.stringify(o)})`);
  expect(o.status === "fakturovano", `stav posunut dopředu na Vyfakturováno (${o.status})`);
  const ev = sqlJson(`select json_agg(e) from (select actor_id from job_events where job_id = ${q(jobId)}) e`) ?? [];
  expect(ev.length > 0 && ev.every((e) => e.actor_id === ADMIN_ID), "všechny události s autorem admin");
  const tr = sqlJson(`select json_agg(t) from (select kind, source from ai_training_examples where job_id = ${q(jobId)} or created_at >= ${q(since)} and created_by = ${q(ADMIN_ID)}) t`) ?? [];
  expect(tr.some((t) => t.kind === "capture_drawing") && tr.some((t) => t.kind === "capture_sort" && t.source === "corrected"), `učení výkresu i opraveného roztřídění (${JSON.stringify(tr)})`);
  expect(sortPreviews(since).length === 0, `náhledy roztřídění uklizené (${sortPreviews(since).join(", ")})`);

  // historie zakázky se jménem účtu
  await page.goto(`${BASE}/orders/${jobId}`);
  await page.getByRole("tab", { name: /^Historie/ }).click();
  const hist = page.locator("main [role=tabpanel][data-state=active]");
  await hist.getByText(USERS.admin.name).first().waitFor({ timeout: 15_000 });
  expect((await hist.innerText()).includes(USERS.admin.name), "Historie ukazuje jméno účtu");
  await shot(page, "capture-multi/1-history");
  await page.close();
});

await T("objednávka + náš DL + naše faktura se stejnými položkami → položky jen z objednávky", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [
    pngFile(fname("po2", "objednavka_zakaznik"), 11),
    pngFile(fname("dl2", "dodaci_list_my"), 12),
    pngFile(fname("fv2", "faktura_my"), 13),
  ]);
  await readBatch(page);
  await toReview(page);
  const res = await saveAll(page);
  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  const n = Number(sql(`select count(*) from order_items where order_id = ${q(jobId)}`));
  expect(n === 2, `2 položky (žádné zdvojení) — je ${n}`);
  await page.close();
});

await T("dvě objednávky různých zákazníků → 2 skupiny, 2 zakázky, nový zákazník", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(fname("poa", "objednavka_zakaznik"), 21), pngFile(fname("pob", "objednavka_zakaznik-g2"), 22)]);
  await readBatch(page);
  await toReview(page);
  expect(await page.getByTestId("capture-group").count() === 2, "2 hlavičky skupin");
  expect(await page.getByRole("region", { name: "Zakázka 2" }).count() === 1, "region Zakázka 2");
  const res = await saveAll(page);
  const jobs = res.groups.filter((g) => g.ok && g.jobId);
  expect(jobs.length === 2 && jobs[0].jobId !== jobs[1].jobId, `2 různé zakázky (${JSON.stringify(jobs)})`);
  const created = jobs.find((g) => g.customerCreated);
  expect(created?.customerName?.includes("Kovo Plus"), `založen zákazník Kovo Plus (${JSON.stringify(jobs)})`);
  const cid = sql(`select customer_id from orders where id = ${q(created.jobId)}`);
  if (cid) cleanup.customers.add(cid);
  await page.close();
});

await T("DL dodavatele se silnou shodou na jinou zakázku (naše OV) → vlastní skupina s předvyplněným cílem", async (context) => {
  const b = myJob("B", { stage: "ve_vyrobe" });
  sql(`insert into purchase_orders (job_id, number, status, created_by) values (${q(b.id)}, 'OV-E2E-MULTI-1', 'odeslana', ${q(ADMIN_ID)})`);
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(fname("po4", "objednavka_zakaznik"), 31), pngFile(fname("dld", "dodaci_list_dodavatel-g3"), 32)]);
  await readBatch(page);
  await toReview(page);
  const own = page.locator(`[data-testid="capture-group"][data-target="${b.id}"]`);
  expect(await own.count() === 1, "skupina s cílem B");
  expect((await own.innerText()).includes("podle naší objednávky"), "důvod samostatné skupiny");
  const res = await saveAll(page);
  expect(res.groups.some((g) => g.jobId === b.id && g.ok), "DL dodavatele uložen k B");
  const stB = sql(`select status from orders where id = ${q(b.id)}`);
  expect(["ve_vyrobe", "dodano_k_nam"].includes(stB), `stav B jen dopředu (${stB})`);
  sql(`delete from purchase_orders where job_id = ${q(b.id)}`);
  await page.close();
});

await T("opravy roztřídění: oddělit a sloučit stránku, změna druhu, prohození vystavitele, vyřazení", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [
    pngFile(fname("po5", "objednavka_zakaznik-s1"), 41),
    pngFile(fname("po5", "objednavka_zakaznik-s2"), 42),
    pngFile(fname("foto5", "foto"), 43),
    pngFile(fname("nab5", "nabidka_dodavatel"), 44),
    pngFile(fname("x5", "ostatni"), 45),
  ]);
  await readBatch(page);
  let cards = await sortCards(page);
  const po = page.locator('[data-testid="capture-sort-doc"][data-type="objednavka_zakaznik"]');
  // oddělit 2. stránku objednávky → nový doklad → sloučit zpět
  await po.getByRole("button", { name: /Stránka \d+ .* akce stránky/ }).nth(1).click();
  await page.getByTestId("capture-page-sheet").getByRole("button", { name: "Oddělit jako nový doklad" }).click();
  await page.getByTestId("capture-type-sheet").getByRole("button", { name: "Objednávka zákazníka", exact: true }).click();
  expect((await sortCards(page)).length === cards.length + 1, "oddělená stránka = nový doklad");
  const split = page.getByTestId("capture-sort-doc").nth(1);
  await split.getByRole("button", { name: "Akce dokladu" }).click();
  await page.getByRole("menuitem", { name: "Sloučit s předchozím" }).click();
  expect((await sortCards(page)).length === cards.length, "sloučeno zpět");
  // fotka → výkres
  await changeType(page, page.locator('[data-testid="capture-sort-doc"][data-type="foto"]'), "Výkres");
  // nabídka dodavatele → naše nabídka (prohodit vystavitele)
  await page.locator('[data-testid="capture-sort-doc"][data-type="nabidka_dodavatel"]').getByRole("button", { name: "Prohodit vystavitele" }).click();
  // vyřadit „Jiné"
  const other = page.locator('[data-testid="capture-sort-doc"][data-type="ostatni"]');
  await other.getByRole("button", { name: "Akce dokladu" }).click();
  await page.getByRole("menuitem", { name: "Vyřadit doklad" }).click();
  cards = await sortCards(page);
  expect(cards.some((c) => c.type === "vykres") && cards.some((c) => c.type === "nabidka_my") && cards.some((c) => c.status === "excluded"),
    `opravy se projevily (${JSON.stringify(cards)})`);
  await shot(page, "capture-multi/5-sort-edited");
  await toReview(page);
  const res = await saveAll(page);
  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  const kinds = jobFiles(jobId).map((x) => x.kind);
  expect(kinds.includes("nabidka") && !kinds.includes("naceneni"), `naše nabídka uložena jako nabidka (${kinds.join(", ")})`);
  expect(!kinds.includes("ostatni"), "vyřazený doklad se nepřiložil");
  const mn = Number(sql(`select count(*) from customers where name ilike '%Mnástrojárna%' and created_at >= ${q(STARTED)}`));
  expect(mn === 0, "náš název se nezaložil jako zákazník");
  const sortTr = sqlJson(`select json_agg(t) from (select source from ai_training_examples where kind = 'capture_sort' and created_by = ${q(ADMIN_ID)} and created_at >= ${q(STARTED)}) t`) ?? [];
  expect(sortTr.some((t) => t.source === "corrected"), `učení roztřídění = corrected (${JSON.stringify(sortTr)})`);
  await page.close();
});

await T("duplicity: stejný soubor 2× → 1 stránka; přefocená stránka vyřazená s „Vrátit“", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const dlg = await openFromBook(page);
  const same = pngFile(fname("dup", "objednavka_zakaznik-s1"), 51);
  await page.getByTestId("capture-files-input").setInputFiles([same]);
  await waitEnabled(page.getByTestId("capture-read"));
  await page.getByTestId("capture-files-input").setInputFiles([{ ...same }]);
  await dlg.getByText(/Už je v dávce/).first().waitFor({ timeout: 15_000 });
  await upload(page, [pngFile(fname("dup", "objednavka_zakaznik-s1-dup"), 52), pngFile(fname("dup2", "faktura_my"), 53)]);
  await readBatch(page);
  const text = await page.getByTestId("capture-sort").innerText();
  expect(/Vyřazené stránky \(1\)/.test(text), "přefocená stránka mezi vyřazenými");
  expect(await page.getByTestId("capture-sort").getByRole("button", { name: "Vrátit" }).count() >= 1, "lze vrátit");
  // zahodit (potvrzení zavření)
  page.once("dialog", (d) => d.accept());
  await dlg.getByRole("button", { name: "Zavřít" }).click();
  await captureDialog(page).waitFor({ state: "detached" });
  await page.close();
});

await T("jeden doklad = beze změny (bez Roztřídění); jediná nabídka dodavatele → rovnou Kontrola a Nákup", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(`${TAG}-single.png`, 61)]);
  const one = await readBatch(page, { expectSort: false });
  expect(one.model && !one.batch, "1 fotka bez značky = dnešní odpověď model");
  page.once("dialog", (d) => d.accept());
  await captureDialog(page).getByRole("button", { name: "Zrušit" }).click();
  await captureDialog(page).waitFor({ state: "detached" });

  await openFromBook(page);
  await upload(page, [pngFile(fname("nab8", "nabidka_dodavatel"), 62)]);
  const b = await readBatch(page, { expectSort: false });
  expect(b.batch?.skipSort === true, "nabídka dodavatele = dávka s přeskočeným Roztříděním");
  const g8 = page.getByTestId("capture-group").first();
  await g8.waitFor({ timeout: 120_000 });
  expect(await page.getByTestId("capture-sort").count() === 0, "bez kroku Roztřídění");
  // nabídka dodavatele neurčí zakázku sama → uživatel vybere (tady nová)
  if ((await g8.getAttribute("data-target")) === "") await pickGroupTarget(g8, /Založit novou zakázku/);
  const res = await saveAll(page);
  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  expect(Number(sql(`select count(*) from supplier_quotes where job_id = ${q(jobId)}`)) === 1, "nabídka v supplier_quotes");
  await page.close();
});

await T("bez AI (zaměstnanec, bez marží): ruční roztřídění, nabídka dodavatele čeká na Nákup, admin ji zapíše", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.dilna);
  await openFromBook(page);
  await upload(page, [pngFile(`${TAG}-nab-rucne.png`, 71), stepFile(`${TAG}-5500-01.step`, "5500-01")]);
  await readBatch(page);
  await page.getByRole("button", { name: "Každá fotka zvlášť" }).click();
  const photo = page.locator('[data-testid="capture-sort-doc"]:not([data-type="model_3d"])').first();
  await changeType(page, photo, "Nabídka dodavatele");
  await toReview(page);
  expect((await captureDialog(page).innerText()).includes("počká v Nákupu"), "bez marží: nabídka počká v Nákupu");
  // cíl: nová zakázka (skupina bez obchodní shody)
  const g = page.getByTestId("capture-group").first();
  if ((await g.getAttribute("data-target")) === "") await pickGroupTarget(g, /Založit novou zakázku/);
  const res = await saveAll(page);
  const jobId = res.groups.find((x) => x.ok && x.jobId)?.jobId;
  cleanup.jobs.add(jobId);
  expect(Number(sql(`select count(*) from supplier_quotes where job_id = ${q(jobId)}`)) === 0, "supplier_quotes nezaložena");
  const pend = jobFiles(jobId).find((x) => x.ai_extracted?.purchasingPending);
  expect(pend && pend.uploaded_by === DILNA_ID, "soubor s purchasingPending");
  const evText = sql(`select string_agg(message, ' | ') from job_events where job_id = ${q(jobId)}`);
  expect(!/\d+\s?(Kč|CZK)/.test(evText ?? ""), `historie bez částek (${evText})`);
  const tr = sqlJson(`select json_agg(t) from (select source from ai_training_examples where created_by = ${q(DILNA_ID)} and created_at >= ${q(STARTED)}) t`) ?? [];
  expect(tr.some((t) => t.source === "manual"), `učení manual (${JSON.stringify(tr)})`);
  await page.close();

  // admin v Nákupu zapíše čekající nabídku
  const { context: ac } = await newContext(browser);
  if (needShim) await installEnvShim(ac);
  const ap = await ac.newPage();
  await login(ap, USERS.admin);
  await ap.goto(`${BASE}/orders/${jobId}?tab=nakup`);
  const strip = ap.getByTestId("pending-captured-quotes").filter({ visible: true }).first();
  await strip.waitFor({ timeout: 20_000 });
  await strip.getByRole("button", { name: "Zapsat" }).first().click();
  await ap.waitForTimeout(1500);
  expect(Number(sql(`select count(*) from supplier_quotes where job_id = ${q(jobId)}`)) === 1, "po Zapsat vznikla nabídka dodavatele");
  await ac.close();
});

await T("obchodník bez AI: 2 fotky + STEP → ruční roztřídění „Každá fotka zvlášť“, ruční vyplnění, uložení, učení manual", async (context) => {
  const prof = sql(`select ai_access from profiles where id = ${q(OBCHOD_ID)}`);
  if (prof === "t") {
    sql(`update profiles set ai_access = false where id = ${q(OBCHOD_ID)}`);
    cleanup.restore.push(`update profiles set ai_access = true where id = ${q(OBCHOD_ID)}`);
  }
  expect(sql("select value from integration_settings where key = 'ai_capture_for_all'") !== "true", "ai_capture_for_all vypnuté — neměníme sdílené nastavení");
  const since = new Date().toISOString();
  const drawingNo = `OB-${RUN}`.toUpperCase();
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openFromBook(page);
  await upload(page, [pngFile(`${TAG}-ob-1.png`, 75), pngFile(`${TAG}-ob-2.png`, 76), stepFile(`${TAG}-ob-model.step`, drawingNo)]);
  expect((await page.getByTestId("capture-read").innerText()).includes("Pokračovat k vyplnění"), "bez AI: Pokračovat k vyplnění");
  const b = await readBatch(page);
  expect(b.batch?.aiUsed === false, "roztřídění bez AI");
  let cards = await sortCards(page);
  expect(cards.length === 2 && cards.some((c) => c.type === "model_3d"), `odhad: fotky = 1 doklad + model (${JSON.stringify(cards)})`);
  await page.getByRole("button", { name: "Každá fotka zvlášť" }).click();
  cards = await sortCards(page);
  expect(cards.length === 3, `každá fotka zvlášť → 3 doklady (${JSON.stringify(cards)})`);
  const photos = page.locator('[data-testid="capture-sort-doc"]:not([data-type="model_3d"])');
  await changeType(page, photos.nth(0), "Objednávka zákazníka");
  await changeType(page, page.locator('[data-testid="capture-sort-doc"]:not([data-type="model_3d"]):not([data-type="objednavka_zakaznik"])').first(), "Výkres");
  cards = await sortCards(page);
  expect(JSON.stringify(cards.map((c) => c.type).sort()) === JSON.stringify(["model_3d", "objednavka_zakaznik", "vykres"]), `ruční druhy (${JSON.stringify(cards)})`);
  await toReview(page);
  // ruční vyplnění vedle náhledu: číslo výkresu
  await dlg.getByLabel("Číslo výkresu").first().fill(drawingNo);
  await dlg.getByLabel("Revize").first().fill("A");
  const g = page.getByTestId("capture-group").first();
  if ((await g.getAttribute("data-target")) === "") await pickGroupTarget(g, /Založit novou zakázku/);
  await shot(page, "capture-multi/9-manual-review");
  const res = await saveAll(page);
  const jobId = res.groups.find((x) => x.ok && x.jobId)?.jobId;
  expect(jobId, "zakázka uložená");
  const f = jobFiles(jobId);
  expect(JSON.stringify(f.map((x) => x.kind).sort()) === JSON.stringify(["model_3d", "objednavka", "vykres"]), `druhy dokumentů (${f.map((x) => x.kind)})`);
  expect(f.every((x) => x.uploaded_by === OBCHOD_ID), "nahrál obchodník");
  expect(f.find((x) => x.kind === "vykres")?.ai_extracted?.drawingNumber === drawingNo, `ručně zadané číslo výkresu (${JSON.stringify(f.find((x) => x.kind === "vykres")?.ai_extracted)})`);
  expect(f.find((x) => x.kind === "model_3d")?.ai_extracted?.format === "STEP", "model s formátem STEP");
  const owner = sql(`select owner_id from orders where id = ${q(jobId)}`);
  expect(owner === OBCHOD_ID, `zakázka obchodníka (${owner})`);
  const ev = sqlJson(`select json_agg(e) from (select actor_id from job_events where job_id = ${q(jobId)}) e`) ?? [];
  expect(ev.length > 0 && ev.every((e) => e.actor_id === OBCHOD_ID), "historie: autor obchodník");
  const tr = sqlJson(`select json_agg(t) from (select kind, source from ai_training_examples where created_by = ${q(OBCHOD_ID)} and created_at >= ${q(since)}) t`) ?? [];
  expect(tr.length > 0 && tr.every((t) => t.source === "manual"), `učení manual (${JSON.stringify(tr)})`);
  await page.close();
});

await T("idempotence: 2× batch/apply stejného stavu → žádné duplicity", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(fname("idem", "objednavka_zakaznik"), 81), pngFile(fname("idem2", "nabidka_dodavatel"), 82)]);
  const b = await readBatch(page);
  await toReview(page);
  let applyBody = null;
  page.on("request", (r) => {
    if (r.url().includes("/api/jobs/capture/batch/apply")) applyBody = r.postDataJSON();
  });
  const res = await saveAll(page);
  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  const count = () => ({
    files: sql(`select count(*) from job_files where capture_id = ${q(b.batch.captureId)}`),
    quotes: sql(`select count(*) from supplier_quotes where capture_id = ${q(b.batch.captureId)}`),
    items: sql(`select count(*) from order_items where order_id = ${q(jobId)}`),
    jobs: sql(`select count(*) from orders where capture_key like ${q(`${b.batch.captureId}:%`)}`),
  });
  const before = count();
  const again = await page.request.post(`${BASE}/api/jobs/capture/batch/apply`, { data: applyBody, headers: { origin: BASE } });
  expect(again.status() === 200 || again.status() === 400, `druhé uložení odpovědělo (${again.status()})`);
  expect(JSON.stringify(count()) === JSON.stringify(before), `beze změny počtů (${JSON.stringify(before)} → ${JSON.stringify(count())})`);
  await page.close();
});

await T("ZIP: STEP + PDF se značkou → 2 doklady, ZIP se nepřiloží", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  const zip = zipFile(`${TAG}-sada.zip`, [
    { name: "4711-02.step", buffer: stepFile("4711-02.step", "4711-02").buffer },
    { name: `${TAG}-zp__objednavka_zakaznik.pdf`, buffer: multiPagePdf("x.pdf", ["Objednavka"]).buffer },
  ]);
  await upload(page, [zip]);
  await readBatch(page);
  const cards = await sortCards(page);
  expect(cards.length === 2 && cards.some((c) => c.type === "model_3d") && cards.some((c) => c.type === "objednavka_zakaznik"), `2 doklady ze ZIPu (${JSON.stringify(cards)})`);
  await toReview(page);
  const res = await saveAll(page);
  const jobId = res.groups.find((g) => g.ok && g.jobId)?.jobId;
  expect(!jobFiles(jobId).some((f) => /\.zip$/i.test(f.filename)), "ZIP sám není přiložený");
  await page.close();
});

await T("zavření a obnova: Escape v Roztřídění se ptá; reload → banner → Pokračovat; Zahodit uklidí", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const STARTED_TEST = new Date().toISOString();
  const dlg = await openFromBook(page);
  const a = fname("res", "objednavka_zakaznik");
  await upload(page, [pngFile(a, 91), pngFile(fname("res2", "faktura_my"), 92)]);
  const b = await readBatch(page);
  const before = await sortCards(page);
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  expect(await dlg.isVisible(), "po zrušení potvrzení dialog zůstal");
  await page.reload();
  const dlg2 = await openFromBook(page);
  await dlg2.getByTestId("capture-resume").waitFor({ timeout: 20_000 });
  expect((await dlg2.getByTestId("capture-resume").innerText()).includes("rozpracované focení"), "banner obnovy");
  await dlg2.getByTestId("capture-resume").getByRole("button", { name: "Pokračovat" }).click();
  await page.getByTestId("capture-sort").waitFor({ timeout: 30_000 });
  const after = await sortCards(page);
  expect(JSON.stringify(after.map((c) => c.type).sort()) === JSON.stringify(before.map((c) => c.type).sort()), "stejné karty po obnově");
  page.once("dialog", (d) => d.accept());
  await dlg2.getByRole("button", { name: "Zavřít" }).click();
  await captureDialog(page).waitFor({ state: "detached" });
  await page.waitForTimeout(2500);
  expect(storageObjects(a).length === 0, "stránky smazané");
  expect(sql(`select count(*) from capture_sessions where id = ${q(b.batch.captureId)}`) === "0", "relace smazaná");
  expect(sortPreviews(STARTED_TEST).length === 0, `náhledy roztřídění smazané (${sortPreviews(STARTED_TEST).join(", ")})`);
  await page.close();
});

await T("mobil 390 px: dávka 3 dokladů bez vodorovného posunu, list stránky, Uložit vše ve viewportu, výsledek s odkazy", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(fname("m1", "objednavka_zakaznik"), 101), pngFile(fname("m2", "dodaci_list_my"), 102), pngFile(fname("m3", "vykres"), 103)]);
  await readBatch(page);
  let ov = await noHorizontalOverflow(page);
  expect(ov.ok, `roztřídění bez přetékání (${ov.scroll} > ${ov.inner}; ${JSON.stringify(await overflowingInDialog(page))})`);
  await page.getByTestId("capture-sort-doc").first().getByRole("button", { name: /akce stránky/ }).first().click();
  const sheet = page.getByTestId("capture-page-sheet");
  await sheet.waitFor();
  expect(await sheet.getByRole("button", { name: /Objednávka|Dodací list|Výkres/ }).count() >= 1, "list stránky s tlačítky dokladů");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  await shot(page, "capture-multi/10-mobile-sort");
  const cont = await page.getByTestId("capture-sort-continue").boundingBox();
  expect(cont && cont.y >= 844 / 2 && cont.y + cont.height <= 844 && cont.height >= 40, `Pokračovat dole na dosah palce (${JSON.stringify(cont)})`);
  await toReview(page);
  ov = await noHorizontalOverflow(page);
  expect(ov.ok, `kontrola bez přetékání (${ov.scroll} > ${ov.inner})`);
  const box = await page.getByTestId("capture-save").boundingBox();
  expect(box && box.y + box.height <= 844, `Uložit vše ve viewportu (${JSON.stringify(box)})`);
  // dosah palcem: hlavní tlačítko v dolní polovině displeje a aspoň 40 px vysoké
  expect(box && box.y >= 844 / 2 && box.height >= 40, `Uložit vše dole a dost velké pro palec (${JSON.stringify(box)})`);
  await shot(page, "capture-multi/10-mobile-review");
  await saveAll(page);
  expect(await page.getByTestId("capture-batch-result-doc").getByRole("link").count() >= 1, "výsledek s odkazy");
  await shot(page, "capture-multi/10-mobile-done");
  await page.close();
}, { mobile: true });

await T("ochrany API: cizí relace / stránka → 400, cizí Origin → 403, nepřihlášený → 401", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await openFromBook(page);
  await upload(page, [pngFile(fname("api1", "objednavka_zakaznik"), 111), pngFile(fname("api2", "faktura_my"), 112)]);
  const b = await readBatch(page);
  const captureId = b.batch.captureId;
  const docId = b.batch.sort.docs[0].id;
  // obchodník nesmí číst adminovu relaci
  const { context: oc } = await newContext(browser);
  const op = await oc.newPage();
  await login(op, USERS.obchod);
  let r = await op.request.post(`${BASE}/api/jobs/capture/batch/extract`, { data: { captureId, docId, type: "objednavka_zakaznik", pageIds: b.batch.sort.docs[0].pageIds }, headers: { origin: BASE } });
  expect(r.status() === 400, `cizí relace = 400 (${r.status()})`);
  await oc.close();
  r = await page.request.post(`${BASE}/api/jobs/capture/batch/extract`, { data: { captureId, docId, type: "objednavka_zakaznik", pageIds: ["p999"] }, headers: { origin: BASE } });
  expect(r.status() === 400, `stránka mimo relaci = 400 (${r.status()})`);
  r = await page.request.post(`${BASE}/api/jobs/capture/batch/session`, { data: { captureId }, headers: { origin: "https://evil.example" } });
  expect(r.status() === 403, `cizí Origin = 403 (${r.status()})`);
  const anon = await browser.newContext();
  r = await anon.request.post(`${BASE}/api/jobs/capture/batch/session`, { data: { captureId }, headers: { origin: BASE } });
  expect(r.status() === 401, `nepřihlášený = 401 (${r.status()})`);
  await anon.close();
  page.once("dialog", (d) => d.accept());
  await captureDialog(page).getByRole("button", { name: "Zavřít" }).click();
  await captureDialog(page).waitFor({ state: "detached" });
  await page.close();
});

// ── Úklid ──────────────────────────────────────────────────
await cleanAfterTest();
for (const st of cleanup.restore) sql(st);
for (const c of cleanup.captures) {
  try {
    sql(`delete from capture_sessions where id = ${q(c)}`);
  } catch {
    // relace mohla zaniknout
  }
}
// učení bez zakázky (roztřídění) a korekce druhu z tohoto běhu
sql(`delete from ai_training_examples where kind = 'capture_sort' and created_at >= ${q(STARTED)} and created_by in (${TEST_USERS})`);
sql(`delete from ai_corrections where agent_key = 'capture' and field = 'Druh dokladu' and created_at >= ${q(STARTED)} and created_by in (${TEST_USERS})`);
const leftovers = [...storageObjects(TAG), ...sortPreviews(STARTED)];
if (leftovers.length) {
  await removeStorage(leftovers);
  console.log(`  · úklid: smazáno ${leftovers.length} zbylých souborů v úložišti`);
}
const caps = [...cleanup.captures].map(q).join(", ");
const left = caps ? sql(`select count(*) from orders where split_part(capture_key, ':', 1) in (${caps}) or title like ${q(`${TAG}%`)}`) : "0";
if (left !== "0") console.log(`  ! po úklidu zůstalo ${left} zakázek testu`);

await browser.close();
process.exit(summary(errors) ? 0 : 1);
