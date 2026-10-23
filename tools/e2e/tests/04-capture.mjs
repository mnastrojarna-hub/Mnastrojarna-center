// E2E: „📷 Vyfotit doklad“ — AI čtení dokladu (fixture objednavka-strojmetal.json),
// kontrolní formulář, uložení do Knihy zakázek, spuštění z karty zakázky, ?capture=1,
// obchodník bez AI (ruční vyplnění), zrušení (úklid nahraných stránek), mobil 390 px,
// a ochrany API (cizí cesta, cizí relace, cizí původ).
// Vlastní data mají prefix „E2E-capture-<běh>“ / čísla „E2E-CAP-…“; demo data se jen čtou.
import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS, BASE, USERS, launch, newContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import {
  captureDialog, clientBuildLacksSupabaseEnv, deleteJobDeep, insertItem, insertJob, installEnvShim,
  noHorizontalOverflow, overflowingInDialog, pdfFile, pngFile, q, removeStorage, sqlJson, storageObjects, userId,
} from "../lib-capture.mjs";

fs.mkdirSync(path.join(ARTIFACTS, "capture"), { recursive: true });

const RUN = Date.now().toString(36);
const TAG = `E2E-capture-${RUN}`;
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";
const ADMIN_ID = userId(USERS.admin.email);
const OBCHOD_ID = userId(USERS.obchod.email);

const browser = await launch();
const errors = [];
/** Úklid na konci (i když test spadne): zakázky, zákazníci, korekce, soubory. */
const cleanup = { jobs: new Set(), customers: new Set(), storagePaths: new Set(), restore: [] };

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
  if (needShim) {
    console.log(
      "  ⚠ PROSTŘEDÍ: běžící build nemá v prohlížečovém JS NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY\n" +
      "    (build bez načteného .local-supabase/env) — nahrání stránek by skončilo chybou @supabase/ssr.\n" +
      "    Testy dosazují hodnoty přes window.process (init script). Na správném buildu nemá vliv.",
    );
  }
}

/** Každý test v čistém kontextu (+ případná náhrada env). */
async function inContext(fn, opts = {}) {
  const { context, errors: ctxErrors } = await newContext(browser, opts);
  if (needShim) await installEnvShim(context);
  try {
    await fn(context);
  } finally {
    errors.push(...ctxErrors);
    await context.close();
  }
}
const T = (name, fn, opts) => test(name, () => inContext(fn, opts));

// ── Pomocníci toku ─────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

async function uploadPages(page, files) {
  await page.getByTestId("capture-files-input").setInputFiles(files);
  await waitEnabled(page.getByTestId("capture-read"));
}

/** Přečíst → kontrolní formulář. Vrací odpověď /analyze (model). */
async function readDoc(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/analyze"), { timeout: 90_000 }),
    page.getByTestId("capture-read").click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body.ok, `analyze ok (${JSON.stringify(body).slice(0, 300)})`);
  await page.getByTestId("capture-save").waitFor({ timeout: 30_000 });
  return { body, request: resp.request().postDataJSON() };
}

/** Vybrat cílovou zakázku podle čísla (karta, nebo „Jiná zakázka…“). */
async function pickTarget(page, number) {
  const re = new RegExp(esc(number));
  const card = page.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio", { name: re });
  let how = "card";
  if (await card.count()) {
    await card.first().click();
  } else {
    how = "combobox";
    const cb = page.getByRole("combobox", { name: "Vybrat jinou zakázku" });
    await cb.click();
    await cb.fill(number);
    await page.getByRole("option", { name: re }).first().click();
  }
  await page.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio", { name: re, checked: true }).waitFor({ timeout: 15_000 });
  return how;
}

/** Uložit do knihy → obrazovka Hotovo. Vrací odpověď /apply. */
async function saveDoc(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/jobs/capture/apply"), { timeout: 60_000 }),
    page.getByTestId("capture-save").click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  expect(body.ok, `apply ok (${JSON.stringify(body).slice(0, 300)})`);
  await page.getByTestId("capture-result-headline").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400); // doběhnou přechody (krokovník, křížek)
  return body;
}

const val = (page, id) => page.locator(`#${id}`).inputValue();

function myJob(letter, { stage = "nabidka", customerId = STROJMETAL, ownerId = ADMIN_ID, items = [] } = {}) {
  const number = `E2E-CAP-${letter}-${RUN}`;
  const id = insertJob({ number, title: `${TAG} ${letter}`, customerId, stage, ownerId });
  cleanup.jobs.add(id);
  items.forEach((it, i) => insertItem(id, { position: i, ...it }));
  return { id, number };
}

/** Smazat zakázku testu hned po testu (méně cizích dat pro paralelní běh). */
async function dropJob(id) {
  if (!id) return;
  await deleteJobDeep(id);
  cleanup.jobs.delete(id);
}

function dropCustomer(id) {
  if (!id) return;
  sql(`delete from customer_contacts where customer_id = ${q(id)}`);
  sql(`delete from customers where id = ${q(id)} and name like ${q(`${TAG}%`)}`);
  cleanup.customers.delete(id);
}

function jobRow(id) {
  return sqlJson(`select row_to_json(o) from (select * from orders where id = ${q(id)}) o`);
}

console.log("04 · Vyfotit doklad (AI čtení, kontrola, uložení, bez AI, zrušení, mobil)");

// ═════════════════════════════════════════════════════════════
await T("admin: Vyfotit doklad → AI předvyplní → oprava → uložení do vlastní zakázky", async (context) => {
  const job = myJob("A", { stage: "nabidka", items: [{ drawingNumber: "VK-2291", revision: "B", name: "Upínka frézovaná", material: "1.2379", quantity: 50 }] });
  const fileName = `e2e-cap-a-${RUN}.png`;
  const fixedNo = `4795-2026-${RUN}`;
  const page = await context.newPage();
  await login(page, USERS.admin);
  const dlg = await openFromBook(page);
  expect((await dlg.innerText()).includes("Vyfoť doklad"), "krok 1 Vyfotit");
  await uploadPages(page, [pngFile(fileName, 1)]);
  expect((await dlg.innerText()).includes("1 stránka dokladu"), "náhled nahrané stránky");
  const before = storageObjects(fileName);
  expect(before.length === 1 && before[0].startsWith(`capture/${ADMIN_ID}/`), `stránka je v dočasné složce capture/<admin> (${before.join(", ")})`);

  const { body } = await readDoc(page);
  const model = body.model;
  expect(model.aiUsed === true, "AI četla (fixture)");
  const text = await dlg.innerText();
  expect(text.includes("AI přečetla doklad") && text.includes("93 %"), "banner AI + jistota 93 %");
  expect(text.includes("Objednávka 4795-2026 od Strojmetal"), "shrnutí z dokladu");
  expect(await page.getByRole("button", { name: "Objednávka zákazníka" }).getAttribute("aria-pressed") === "true", "druh dokladu = Objednávka zákazníka");
  expect(await page.locator("#cap-doc-note").inputValue() === "Ručně připsáno: prosíme atest 3.1 k materiálu.", "poznámka z dokladu");
  expect(await page.locator("#cap-file-kind").inputValue() === "objednavka", "druh dokumentu = objednávka");
  await shot(page, "capture/a-review-default");

  // cílová zakázka = naše vlastní (demo zakázky neměníme)
  await pickTarget(page, job.number);
  const t2 = await dlg.innerText();
  expect(t2.includes("Strojmetal a.s."), "zákazník zakázky Strojmetal (zamčený)");
  expect(await val(page, "cap-field-customerOrderNumber") === "4795-2026", "číslo objednávky z dokladu");
  expect(await val(page, "cap-field-orderDate") === "2026-10-21", "datum objednávky z dokladu");
  expect(await val(page, "cap-field-customerRequiredDate") === "2026-11-27", "požadovaný termín z dokladu");
  expect(await val(page, "cap-field-customerContact") === "Ing. Jan Dvořák", "kontaktní osoba z dokladu");
  expect(await page.locator('input[id$="-drawingNumber"]').count() === 1 && (await page.locator('input[id$="-drawingNumber"]').first().inputValue()) === "VK-2292", "nová položka VK-2292 (VK-2291 už zakázka má)");
  expect(t2.includes("Doplnit k položce VK-2291"), "doplnění ceny k existující položce VK-2291");
  expect(t2.includes("Podle dokladu navrhuji: Objednávka"), "návrh posunu stavu na Objednávku");
  expect(await page.locator("#cap-field-title").getAttribute("readonly") !== null, "název zakázky zamčený (už vyplněný)");

  // oprava jednoho pole
  await page.locator("#cap-field-customerOrderNumber").fill(fixedNo);
  await shot(page, "capture/a-review-own-job");
  const res = await saveDoc(page);
  const headline = await page.getByTestId("capture-result-headline").innerText();
  expect(headline === `Uloženo do zakázky ${job.number} · Objednávka zákazníka · stav Objednávka`, `headline: ${headline}`);
  expect(res.created === false && res.jobId === job.id, "uloženo do existující (vlastní) zakázky");
  const done = await dlg.innerText();
  expect(done.includes("Doklad přiložen k zakázce v Dokumentech"), "hláška o přiloženém dokladu");
  expect(await page.getByRole("link", { name: /Otevřít zakázku/ }).isVisible(), "odkaz Otevřít zakázku");
  await shot(page, "capture/a-done");

  // DB: zakázka
  const o = jobRow(job.id);
  expect(o.status === "objednavka", `stav posunut nabidka → objednavka (je ${o.status})`);
  expect(o.customer_order_number === fixedNo, `opravené číslo objednávky uloženo (${o.customer_order_number})`);
  expect(o.order_date === "2026-10-21" && o.customer_required_date === "2026-11-27", `termíny z dokladu (${o.order_date}, ${o.customer_required_date})`);
  expect(o.customer_contact === "Ing. Jan Dvořák" && o.customer_contact_email === "dvorak@strojmetal.cz", "kontakt z dokladu");
  expect(Number(o.value) === 107000, `hodnota 107 000 (je ${o.value})`);
  expect(o.ai_filled === true && Number(o.ai_confidence) === 0.93, `ai_filled + jistota (${o.ai_filled}, ${o.ai_confidence})`);
  expect(o.title === `${TAG} A` && o.customer_id === STROJMETAL, "název a zákazník beze změny");
  // položky
  const items = sqlJson(`select json_agg(i order by position) from (select drawing_number, quantity, unit_price, position from order_items where order_id = ${q(job.id)}) i`);
  expect(items.length === 2, `2 položky (${JSON.stringify(items)})`);
  expect(items[0].drawing_number === "VK-2291" && Number(items[0].unit_price) === 1180, "VK-2291 doplněna cena 1180");
  expect(items[1].drawing_number === "VK-2292" && Number(items[1].quantity) === 50 && Number(items[1].unit_price) === 960, "VK-2292 přidána 50 ks á 960");
  // dokument zakázky
  const files = sqlJson(`select json_agg(f) from (select kind, title, filename, storage_path, uploaded_by, note, ai_confidence, ai_extracted is not null as has_ai from job_files where job_id = ${q(job.id)}) f`);
  expect(files?.length === 1, `1 dokument zakázky (${JSON.stringify(files)})`);
  const f = files[0];
  f.storage_path && cleanup.storagePaths.add(f.storage_path);
  expect(f.kind === "objednavka" && f.filename === fileName, `druh objednávka, název souboru (${f.kind}, ${f.filename})`);
  expect(f.title === `Objednávka zákazníka ${fixedNo}`, `název dokumentu s číslem dokladu (${f.title})`);
  expect(f.uploaded_by === ADMIN_ID && f.has_ai && Number(f.ai_confidence) === 0.93, "nahrál admin, data z AI u dokumentu");
  expect(f.note === "Ručně připsáno: prosíme atest 3.1 k materiálu.", "poznámka k dokladu");
  expect(f.storage_path.startsWith(`zakazky/${job.id}/`), `soubor přesunut k zakázce (${f.storage_path})`);
  expect(storageObjects(fileName).every((n) => !n.startsWith("capture/")), "v dočasné složce capture/ nic nezůstalo");
  expect(storageObjects(`${model.captureId}.json`).length === 0, "relace dokladu (<captureId>.json) smazána");
  // historie
  const ev = sqlJson(`select json_agg(e order by created_at) from (select type, message, actor_id, data, created_at from job_events where job_id = ${q(job.id)}) e`) ?? [];
  const aiEv = ev.find((e) => e.type === "ai");
  expect(aiEv && aiEv.actor_id === ADMIN_ID, `událost AI s autorem admin (${JSON.stringify(ev.map((e) => [e.type, e.message.slice(0, 60)]))})`);
  expect(aiEv.message.startsWith(`AI přečetla objednávku zákazníka ${fixedNo}`), `text události: ${aiEv.message}`);
  const stEv = ev.find((e) => e.type === "stage");
  expect(stEv && stEv.actor_id === ADMIN_ID && stEv.data.from === "nabidka" && stEv.data.to === "objednavka", "událost změny stavu nabidka → objednavka (admin)");
  // učení AI
  const tr = sqlJson(`select json_agg(t) from (select source, doc_kind, created_by, job_file_id, extracted is not null as has_extracted, final from ai_training_examples where job_id = ${q(job.id)}) t`);
  expect(tr?.length === 1 && tr[0].source === "corrected" && tr[0].doc_kind === "objednavka" && tr[0].created_by === ADMIN_ID && tr[0].has_extracted,
    `ai_training_examples: corrected / objednavka / admin (${JSON.stringify(tr)?.slice(0, 300)})`);
  expect(JSON.stringify(tr[0].final).includes(fixedNo), "finální data obsahují opravené číslo");
  const corr = sqlJson(`select json_agg(c) from (select field, ai_value, corrected_value from ai_corrections where agent_key = 'capture' and context like ${q(`%${RUN}%`)}) c`);
  expect(corr?.some((c) => c.field === "Číslo objednávky zákazníka" && c.ai_value === "4795-2026" && c.corrected_value === fixedNo),
    `korekce čísla objednávky zapsána (${JSON.stringify(corr)})`);

  // historie v kartě zakázky se jménem účtu
  await page.goto(`${BASE}/orders/${job.id}?tab=historie`);
  const hist = page.getByRole("tabpanel");
  await hist.getByText(/AI přečetla objednávku zákazníka/).first().waitFor({ timeout: 15_000 });
  const histText = await hist.innerText();
  expect(histText.includes(USERS.admin.name), `historie ukazuje jméno účtu „${USERS.admin.name}“`);
  await shot(page, "capture/a-history");
  await page.goto(`${BASE}/orders/${job.id}?tab=dokumenty`);
  await page.getByRole("tabpanel").getByText(`Objednávka zákazníka ${fixedNo}`).first().waitFor({ timeout: 15_000 });
  await shot(page, "capture/a-documents");
  await page.close();
});

await T("učení AI: korekce z dokladu nese autora (ai_corrections.created_by)", async () => {
  const rows = sqlJson(`select json_agg(c) from (select field, created_by from ai_corrections where agent_key = 'capture' and context like ${q(`%${RUN}%`)}) c`) ?? [];
  expect(rows.length > 0, "korekce z předchozího testu existují");
  expect(rows.every((r) => r.created_by === ADMIN_ID), `created_by = admin (je ${JSON.stringify(rows)})`);
});

await T("historie: zápis dokladu = jedna událost (bez duplicitního „Nahrán dokument“)", async () => {
  const id = [...cleanup.jobs][0];
  const ev = sqlJson(`select json_agg(e) from (select type, message from job_events where job_id = ${q(id)} and type in ('ai','file')) e`) ?? [];
  try {
    expect(ev.length === 1, `jedna událost dokladu v historii (je ${ev.length}: ${ev.map((e) => e.message.slice(0, 50)).join(" | ")})`);
  } finally {
    await dropJob(id);
  }
});

// ═════════════════════════════════════════════════════════════
await T("admin: nová zakázka + nový zákazník z dokladu (oprava názvu a firmy)", async (context) => {
  const fileName = `e2e-cap-b-${RUN}.png`;
  const custName = `${TAG} Zákazník s.r.o.`;
  const title = `${TAG} B nová`;
  const customersBefore = Number(sql("select count(*) from customers"));
  const page = await context.newPage();
  await login(page, USERS.admin);
  const dlg = await openFromBook(page);
  await uploadPages(page, [pngFile(fileName, 2)]);
  await readDoc(page);
  await page.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio", { name: /Založit novou zakázku/ }).click();
  await page.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio", { name: /Založit novou zakázku/, checked: true }).waitFor();
  // nová zakázka: zákazník spárovaný AI (Strojmetal) — opravíme na nového
  const t = await dlg.innerText();
  expect(t.includes("našla AI"), "zákazníka našla AI (Strojmetal podle IČO)");
  await page.getByRole("radio", { name: "Nový zákazník" }).click();
  await page.locator("#cap-customer-name").fill(custName);
  await page.locator("#cap-customer-ico").fill("");
  await page.locator("#cap-customer-dic").fill("");
  await page.locator("#cap-customer-email").fill("");
  await page.locator("#cap-field-title").fill(title);
  expect(await page.locator('input[id$="-drawingNumber"]').count() === 2, "obě položky z dokladu (VK-2291, VK-2292)");
  // jiný druh dokladu → sekce Dodavatel; zpět → zmizí
  await page.getByRole("button", { name: "Faktura — od dodavatele" }).click();
  await dlg.getByRole("heading", { name: "Dodavatel" }).or(dlg.getByText("Kdo doklad vystavil (kooperant")).first().waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "Objednávka zákazníka" }).click();
  expect(await dlg.getByText("Kdo doklad vystavil (kooperant").count() === 0, "sekce Dodavatel zmizela");
  // neplatné množství → česká chyba, zůstane v kontrole
  const qty = page.locator('input[id$="-quantity"]').first();
  await qty.fill("-5");
  await page.getByTestId("capture-save").click();
  const alert = dlg.getByRole("alert");
  await alert.waitFor({ timeout: 15_000 });
  expect(/množství musí být kladné číslo/.test(await alert.innerText()), `chyba množství: ${await alert.innerText()}`);
  expect(await page.getByTestId("capture-save").isVisible(), "zůstává v kontrole");
  await qty.fill("50");
  expect(await dlg.getByRole("alert").count() === 0, "úprava formuláře schová hlášku");
  expect(t.includes("Nová zakázka") && t.includes("Podle dokladu navrhuji: Objednávka"), "nová zakázka ve stavu Objednávka");
  await shot(page, "capture/b-review-new");
  const res = await saveDoc(page);
  if (res.jobId) cleanup.jobs.add(res.jobId);
  if (res.customerId && res.customerCreated) cleanup.customers.add(res.customerId);
  const headline = await page.getByTestId("capture-result-headline").innerText();
  expect(/^Založena zakázka Z-\d{4}-\d+ · Objednávka zákazníka · stav Objednávka$/.test(headline), `headline: ${headline}`);
  const doneText = await dlg.innerText();
  expect(new RegExp(`Založen nový zákazník\\s*${esc(custName)}`).test(doneText), `hláška o novém zákazníkovi (customerCreated=${res.customerCreated}, ${res.customerName}): ${doneText.slice(-600)}`);
  await shot(page, "capture/b-done");

  const o = jobRow(res.jobId);
  expect(o.number === res.jobNumber && o.source === "foto" && o.status === "objednavka", `zakázka ${o.number}, zdroj foto, stav objednávka (${o.source}, ${o.status})`);
  expect(o.title === title, `opravený název (${o.title})`);
  expect(o.created_by === ADMIN_ID && o.owner_id === ADMIN_ID, `založil admin, vlastník = vlastník nového zákazníka (admin) (${o.created_by}, ${o.owner_id})`);
  expect(o.ai_filled === true, "ai_filled");
  const cust = sqlJson(`select row_to_json(c) from (select id, name, ico, owner_id from customers where id = ${q(o.customer_id)}) c`);
  expect(cust && cust.name === custName && cust.owner_id === ADMIN_ID && !cust.ico, `nový zákazník ${JSON.stringify(cust)}`);
  expect(Number(sql("select count(*) from customers")) >= customersBefore + 1, "zákazník přibyl");
  expect(Number(sql(`select count(*) from order_items where order_id = ${q(res.jobId)}`)) === 2, "2 položky");
  const f = sqlJson(`select json_agg(f) from (select kind, storage_path from job_files where job_id = ${q(res.jobId)}) f`) ?? [];
  f.forEach((x) => cleanup.storagePaths.add(x.storage_path));
  expect(f.length === 1 && f[0].kind === "objednavka", "doklad jako dokument zakázky");
  const tr = sqlJson(`select json_agg(t) from (select source from ai_training_examples where job_id = ${q(res.jobId)}) t`) ?? [];
  expect(tr.length === 1 && tr[0].source === "corrected", `učení: corrected (${JSON.stringify(tr)})`);
  const corr = sqlJson(`select json_agg(c) from (select field from ai_corrections where agent_key = 'capture' and context like ${q(`%${custName}%`)}) c`) ?? [];
  expect(corr.some((c) => c.field === "Název zakázky") && corr.some((c) => c.field === "Zákazník"), `korekce názvu a zákazníka (${JSON.stringify(corr)})`);
  // „Otevřít zakázku“ z obrazovky Hotovo
  await dlg.getByRole("link", { name: /Otevřít zakázku/ }).click();
  await page.waitForURL(new RegExp(`/orders/${res.jobId}`), { timeout: 15_000 });
  await dlg.waitFor({ state: "detached", timeout: 10_000 });
  await page.getByText(title).first().waitFor({ timeout: 15_000 });
  await page.close();
  await dropJob(res.jobId);
  dropCustomer(res.customerId);
});

// ═════════════════════════════════════════════════════════════
await T("karta zakázky: Přidat doklad (foto) → doklad patří k té zakázce, zákazník spárován", async (context) => {
  const job = myJob("C", { stage: "poptavka", customerId: null });
  const fileName = `e2e-cap-c-${RUN}.png`;
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job.id}`);
  await page.getByRole("button", { name: "Přidat doklad (foto)" }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  expect((await dlg.innerText()).includes("Doklad k zakázce"), "podtitul: doklad k zakázce");
  await uploadPages(page, [pngFile(fileName, 3)]);
  const { request } = await readDoc(page);
  expect(request.jobId === job.id, `analyze dostal jobId zakázky (${request.jobId})`);
  const t = await dlg.innerText();
  expect(t.includes(`Doklad k zakázce ${job.number}`), "podtitul s číslem zakázky");
  expect(t.includes("Doklad nahráváš přímo u zakázky."), "cíl je pevný");
  const radios = page.getByRole("radiogroup", { name: "Zakázka" }).getByRole("radio");
  expect(await radios.count() === 1 && await radios.first().isDisabled(), "jediná (pevná) zakázka");
  expect(await page.getByRole("combobox", { name: "Vybrat jinou zakázku" }).count() === 0, "bez výběru jiné zakázky");
  expect(t.includes("Nalezen") && t.includes("Strojmetal a.s."), "zákazník Strojmetal nalezen AI");
  await shot(page, "capture/c-review-fixed");
  const res = await saveDoc(page);
  expect(res.jobId === job.id && res.created === false, "uloženo k zakázce z karty");
  const headline = await page.getByTestId("capture-result-headline").innerText();
  expect(headline === `Uloženo do zakázky ${job.number} · Objednávka zákazníka · stav Objednávka`, `headline: ${headline}`);
  expect(await page.getByRole("link", { name: /Otevřít zakázku/ }).count() === 0, "v kartě zakázky bez odkazu Otevřít");
  await page.getByRole("button", { name: "Hotovo" }).click();
  await dlg.waitFor({ state: "detached", timeout: 10_000 });
  const o = jobRow(job.id);
  expect(o.customer_id === STROJMETAL, `zákazník doplněn do zakázky (${o.customer_id})`);
  expect(o.status === "objednavka", `stav poptavka → objednavka (${o.status})`);
  expect(o.customer_order_number === "4795-2026", "číslo objednávky");
  expect(Number(sql(`select count(*) from order_items where order_id = ${q(job.id)}`)) === 2, "2 položky z dokladu");
  const f = sqlJson(`select json_agg(f) from (select storage_path from job_files where job_id = ${q(job.id)}) f`) ?? [];
  f.forEach((x) => cleanup.storagePaths.add(x.storage_path));
  expect(f.length === 1, "1 dokument");
  const tr = sqlJson(`select json_agg(t) from (select source from ai_training_examples where job_id = ${q(job.id)}) t`) ?? [];
  expect(tr.length === 1 && tr[0].source === "ai", `učení: ai (bez oprav) (${JSON.stringify(tr)})`);
  // karta se po uložení obnoví (stav Objednávka, dokument v záložce)
  await page.getByRole("tab", { name: /Dokumenty/ }).click();
  await page.getByRole("tabpanel").getByText(/Objednávka zákazníka 4795-2026/).first().waitFor({ timeout: 15_000 });
  await shot(page, "capture/c-detail-after");
  await page.close();
  await dropJob(job.id);
});

// ═════════════════════════════════════════════════════════════
await T("řádek knihy: ikona foťáku otevře doklad k zakázce, klik nepřejde do detailu", async (context) => {
  const job = myJob("R", { stage: "poptavka" });
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders?segment=vse&q=${encodeURIComponent(job.number)}`);
  const row = page.locator("li").filter({ has: page.getByRole("link", { name: new RegExp(`Otevřít zakázku ${esc(job.number)}`) }) });
  await row.first().waitFor({ timeout: 15_000 });
  await row.first().getByRole("button", { name: "Vyfotit doklad k zakázce" }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  expect(new URL(page.url()).pathname === "/orders", `zůstává v knize (${page.url()})`);
  await dlg.getByText("Vyfoť doklad").click(); // klik do dialogu neprobublá do řádku
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname === "/orders", `klik v dialogu nepřešel do detailu (${page.url()})`);
  expect((await dlg.innerText()).includes("Doklad k zakázce"), "podtitul doklad k zakázce");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.close();
  await dropJob(job.id);
});

// ═════════════════════════════════════════════════════════════
await T("Vyfotit / Vybrat soubory otevřou výběr: fotoaparát jen obrázky (capture), soubory i PDF", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  const dlg = await openFromBook(page);
  const cam = page.getByTestId("capture-camera-input");
  const files = page.getByTestId("capture-files-input");
  expect(await files.getAttribute("multiple") !== null && /application\/pdf/.test(await files.getAttribute("accept") ?? ""), "Vybrat soubory: více souborů, i PDF");
  // klik na „Vybrat soubory“ → výběr souborů s PDF
  let [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), dlg.getByRole("button", { name: "Vybrat soubory", exact: true }).click()]);
  expect(chooser.isMultiple(), "výběr souborů povoluje více souborů");
  // klik na „Vyfotit“ → pole fotoaparátu
  [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), dlg.getByRole("button", { name: "Vyfotit", exact: true }).click()]);
  expect(await chooser.element().getAttribute("data-testid") === "capture-camera-input", "Vyfotit otevře pole fotoaparátu");
  const fn = `e2e-cap-cam-${RUN}.png`;
  await chooser.setFiles([pngFile(fn, 12)]);
  await waitEnabled(page.getByTestId("capture-read"));
  expect((await dlg.innerText()).includes("1 stránka dokladu"), "fotka přidána jako stránka");
  expect(await cam.getAttribute("capture") === "environment", "fotoaparát: capture=environment (zadní kamera)");
  const accept = await cam.getAttribute("accept");
  // s PDF v accept Android místo fotoaparátu otevře výběr souboru
  const camIssue = accept === "image/*" ? null : `pole fotoaparátu má accept="${accept}" (má být jen image/*)`;
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForTimeout(2000);
  expect(storageObjects(fn).length === 0, "zrušená fotka smazána");
  expect(!camIssue, camIssue);
  await page.close();
});

// ═════════════════════════════════════════════════════════════
await T("/orders?capture=1 otevře dialog a parametr zmizí z adresy", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders?capture=1`);
  const dlg = captureDialog(page);
  await dlg.waitFor({ timeout: 15_000 });
  await page.waitForURL((u) => !u.searchParams.has("capture"), { timeout: 10_000 });
  expect(new URL(page.url()).pathname === "/orders", `adresa /orders bez ?capture (${page.url()})`);
  await page.waitForTimeout(800);
  expect(await dlg.isVisible(), "dialog zůstal otevřený i po odebrání parametru");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.reload();
  await page.waitForTimeout(1200);
  expect(await captureDialog(page).count() === 0, "po obnovení stránky se dialog znovu neotevře");
  await page.close();
});

// ═════════════════════════════════════════════════════════════
await T("obchodník bez AI: ruční vyplnění vedle náhledu → nová zakázka, učení „manual“", async (context) => {
  const prof = sql(`select ai_access from profiles where id = ${q(OBCHOD_ID)}`);
  const forAll = sql("select value from integration_settings where key = 'ai_capture_for_all'");
  if (prof === "t") {
    sql(`update profiles set ai_access = false where id = ${q(OBCHOD_ID)}`);
    cleanup.restore.push(`update profiles set ai_access = true where id = ${q(OBCHOD_ID)}`);
  }
  expect(forAll !== "true", `ai_capture_for_all je vypnuté (${forAll}) — neměníme sdílené nastavení`);
  const fileName = `e2e-cap-d-${RUN}.png`;
  const title = `${TAG} D ručně`;
  const rfq = `RFQ-${RUN}`;
  const page = await context.newPage();
  await login(page, USERS.obchod);
  const dlg = await openFromBook(page);
  const pick = await dlg.innerText();
  expect(pick.includes("Vyfoť, doplň pár údajů a ulož do knihy.") && pick.includes("Vedle fotky pak vyplníš"), "texty bez AI");
  await uploadPages(page, [pngFile(fileName, 4)]);
  expect((await page.getByTestId("capture-read").innerText()).includes("Pokračovat k vyplnění"), "tlačítko Pokračovat k vyplnění");
  const { body } = await readDoc(page);
  expect(body.model.aiUsed === false, "AI nečetla");
  const t = await dlg.innerText();
  expect(t.includes("Vyplň, co vidíš na fotce") && t.includes("Nemáš povolené AI čtení dokladů"), "banner ručního režimu + důvod");
  expect(t.includes("Bez AI"), "krok „Bez AI“");
  // náhled vedle formuláře
  const img = page.getByRole("img", { name: new RegExp(`Stránka 1: ${esc(fileName)}`) });
  await img.waitFor();
  const imgBox = await img.boundingBox();
  const formBox = await page.locator("#cap-field-title").boundingBox();
  expect(imgBox && formBox && imgBox.x + imgBox.width <= formBox.x + 1, `náhled je vlevo vedle formuláře (${JSON.stringify(imgBox)} / ${JSON.stringify(formBox)})`);
  expect(await page.evaluate((el) => el.complete && el.naturalWidth > 0, await img.elementHandle()), "náhled fotky se načetl");
  expect(await page.getByRole("button", { name: "Jiné" }).getAttribute("aria-pressed") === "true", "výchozí druh = Jiné");
  expect(t.includes("Vyber druh dokladu"), "výzva vybrat druh dokladu");
  await shot(page, "capture/d-manual-empty");

  await page.getByRole("button", { name: "Poptávka zákazníka" }).click();
  await page.locator("#cap-field-title").fill(title);
  await page.getByRole("radio", { name: "Existující" }).click();
  const cb = page.getByRole("combobox", { name: "Vybrat zákazníka" });
  await cb.click();
  await cb.fill("Strojmetal");
  await page.getByRole("option", { name: /Strojmetal a\.s\./ }).first().click();
  await page.locator("#cap-field-customerInquiryNumber").fill(rfq);
  await page.getByRole("button", { name: /Žádné položky — přidat položku/ }).click();
  await page.locator('input[id$="-drawingNumber"]').first().fill(`E2E-${RUN}-1`);
  await page.locator('input[id$="-quantity"]').first().fill("3");
  await shot(page, "capture/d-manual-filled");
  const res = await saveDoc(page);
  if (res.jobId) cleanup.jobs.add(res.jobId);
  const headline = await page.getByTestId("capture-result-headline").innerText();
  expect(/^Založena zakázka Z-\d{4}-\d+ · Poptávka zákazníka · stav Poptávka$/.test(headline), `headline: ${headline}`);
  await shot(page, "capture/d-done");

  const o = jobRow(res.jobId);
  expect(o.title === title && o.status === "poptavka" && o.source === "foto" && o.ai_filled === false, `zakázka ${JSON.stringify({ t: o.title, s: o.status, src: o.source, ai: o.ai_filled })}`);
  expect(o.customer_id === STROJMETAL && o.customer_inquiry_number === rfq, "zákazník + číslo poptávky");
  expect(o.created_by === OBCHOD_ID && o.owner_id === OBCHOD_ID, "založil a vlastní obchodník");
  const it = sqlJson(`select json_agg(i) from (select drawing_number, quantity from order_items where order_id = ${q(res.jobId)}) i`) ?? [];
  expect(it.length === 1 && it[0].drawing_number === `E2E-${RUN}-1` && Number(it[0].quantity) === 3, `položka ${JSON.stringify(it)}`);
  const f = sqlJson(`select json_agg(f) from (select kind, uploaded_by, ai_extracted, storage_path from job_files where job_id = ${q(res.jobId)}) f`) ?? [];
  f.forEach((x) => cleanup.storagePaths.add(x.storage_path));
  expect(f.length === 1 && f[0].kind === "poptavka" && f[0].uploaded_by === OBCHOD_ID && f[0].ai_extracted === null, `dokument ${JSON.stringify(f)}`);
  const ev = sqlJson(`select json_agg(e) from (select type, message, actor_id from job_events where job_id = ${q(res.jobId)} and message like 'Doklad zapsán ručně%') e`) ?? [];
  expect(ev.length === 1 && ev[0].actor_id === OBCHOD_ID && ev[0].type === "file", `historie „Doklad zapsán ručně…“ (${JSON.stringify(ev)})`);
  const tr = sqlJson(`select json_agg(t) from (select source, created_by, extracted, final from ai_training_examples where job_id = ${q(res.jobId)}) t`) ?? [];
  expect(tr.length === 1 && tr[0].source === "manual" && tr[0].created_by === OBCHOD_ID && tr[0].extracted === null, `učení manual (${JSON.stringify(tr).slice(0, 200)})`);
  expect(JSON.stringify(tr[0].final).includes(rfq), "finální data obsahují ručně vyplněné číslo poptávky");
  // historie se jménem obchodníka
  await page.goto(`${BASE}/orders/${res.jobId}?tab=historie`);
  await page.getByRole("tabpanel").getByText(/Doklad zapsán ručně/).first().waitFor({ timeout: 15_000 });
  expect((await page.getByRole("tabpanel").innerText()).includes(USERS.obchod.name), "historie se jménem obchodníka");
  await page.close();
  await dropJob(res.jobId);
});

// ═════════════════════════════════════════════════════════════
await T("více stránek: pořadí podle uživatele, každá stránka jako dokument zakázky", async (context) => {
  const job = myJob("P", { stage: "objednavka" });
  const p1 = `e2e-cap-p1-${RUN}.png`;
  const p2 = `e2e-cap-p2-${RUN}.png`;
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job.id}`);
  await page.getByRole("button", { name: "Přidat doklad (foto)" }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  await uploadPages(page, [pngFile(p1, 10), pngFile(p2, 11)]);
  expect((await dlg.innerText()).includes("2 stránky dokladu"), "2 stránky");
  // stránku 2 posunout dopředu
  await dlg.getByRole("listitem").filter({ has: page.getByRole("img", { name: "Stránka 2" }) }).getByRole("button", { name: "Posunout dopředu" }).click();
  const alts = await dlg.locator("ol img").evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
  expect(alts.length === 2, `náhledy obou stránek (${alts})`);
  await shot(page, "capture/p-two-pages");
  const { request } = await readDoc(page);
  expect(request.files.map((f) => f.filename).join(",") === `${p2},${p1}`, `čtení ve zvoleném pořadí (${request.files.map((f) => f.filename)})`);
  // náhled v kontrole má 2 stránky
  expect(await dlg.getByRole("button", { name: "Stránka 2" }).count() >= 1, "přepínání stránek v náhledu");
  // stav zakázky (objednávka) doklad neposouvá
  expect((await dlg.innerText()).includes("beze změny") || (await dlg.innerText()).includes("neposouvá"), "objednávka zůstává ve stavu");
  const res = await saveDoc(page);
  expect((await dlg.innerText()).includes("2 stránky dokladu přiloženy k zakázce v Dokumentech"), "hláška o 2 stránkách");
  expect(res.stageFrom === "objednavka" && (!res.stageTo || res.stageTo === "objednavka"), `stav beze změny (${res.stageFrom} → ${res.stageTo})`);
  const files = sqlJson(`select json_agg(f order by title) from (select filename, title, archived, ai_extracted is not null as has_ai, storage_path from job_files where job_id = ${q(job.id)}) f`) ?? [];
  files.forEach((x) => cleanup.storagePaths.add(x.storage_path));
  expect(files.length === 2 && files.every((f) => !f.archived), `2 aktivní dokumenty (${JSON.stringify(files.map((f) => [f.filename, f.title, f.archived]))})`);
  expect(files[0].title.endsWith("· str. 1/2") && files[0].filename === p2 && files[0].has_ai, "str. 1/2 = posunutá stránka 2 (s daty AI)");
  expect(files[1].title.endsWith("· str. 2/2") && files[1].filename === p1 && !files[1].has_ai, "str. 2/2 = stránka 1");
  await page.close();
  await dropJob(job.id);
});

await T("více stránek se stejným názvem (sken „scan.pdf“) — žádná stránka se nearchivuje jako stará verze", async (context) => {
  const job = myJob("S", { stage: "objednavka" });
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders/${job.id}`);
  await page.getByRole("button", { name: "Přidat doklad (foto)" }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  await uploadPages(page, [pdfFile("scan.pdf", `E2E ${RUN} strana 1`), pdfFile("scan.pdf", `E2E ${RUN} strana 2`)]);
  await readDoc(page);
  await shot(page, "capture/s-review-pdf");
  await saveDoc(page);
  const files = sqlJson(`select json_agg(f order by title) from (select filename, title, archived, version, storage_path from job_files where job_id = ${q(job.id)}) f`) ?? [];
  files.forEach((x) => cleanup.storagePaths.add(x.storage_path));
  await page.close();
  try {
    expect(files.length === 2, `2 dokumenty (${files.length})`);
    expect(files.every((f) => !f.archived && f.version === 1),
      `obě stránky aktivní, verze 1 (je ${JSON.stringify(files.map((f) => ({ t: f.title, archived: f.archived, v: f.version })))})`);
  } finally {
    await dropJob(job.id);
  }
});

// ═════════════════════════════════════════════════════════════
await T("zrušení dialogu: nahrané stránky i relace se smažou, nic se neuloží", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);

  // a) zrušení po nahrání (krok Vyfotit) — bez potvrzení
  const fa = `e2e-cap-cancel-a-${RUN}.png`;
  let dlg = await openFromBook(page);
  await uploadPages(page, [pngFile(fa, 5)]);
  expect(storageObjects(fa).length === 1, "stránka nahraná");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForTimeout(2500);
  expect(storageObjects(fa).length === 0, `nahraná stránka po zrušení smazána (${storageObjects(fa).join(", ")})`);

  // b) zrušení během nahrávání (pomalé úložiště)
  const fb = `e2e-cap-cancel-b-${RUN}.png`;
  await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  dlg = await openFromBook(page);
  await page.getByTestId("capture-files-input").setInputFiles([pngFile(fb, 6)]);
  await dlg.getByText("Nahrávám…").first().waitFor();
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForTimeout(5000);
  await page.unroute("**/storage/v1/object/upload/sign/**");
  expect(storageObjects(fb).length === 0, `stránka dohraná po zrušení se smaže (${storageObjects(fb).join(", ")})`);

  // c) zrušení v kontrole: Esc → potvrzení „Zahodit doklad?“ (Zpět = zůstane) → Zrušit → OK
  const fc = `e2e-cap-cancel-c-${RUN}.png`;
  dlg = await openFromBook(page);
  await uploadPages(page, [pngFile(fc, 7)]);
  const { body } = await readDoc(page);
  const captureId = body.model.captureId;
  expect(storageObjects(`${captureId}.json`).length === 1, "relace dokladu uložená");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  expect(asked.includes("Zahodit doklad?"), `potvrzení zahození (${asked})`);
  expect(await dlg.isVisible(), "po „Zrušit“ v potvrzení dialog zůstal");
  page.once("dialog", (d) => d.accept());
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForTimeout(2500);
  expect(storageObjects(fc).length === 0, "stránka smazána");
  expect(storageObjects(`${captureId}.json`).length === 0, "relace smazána");
  // uložení zahozeného dokladu už nejde
  const r = await page.request.post(`${BASE}/api/jobs/capture/apply`, { data: { captureId, state: {} }, headers: { origin: BASE } });
  const rb = await r.json();
  expect(r.status() === 400 && /už není k dispozici/.test(rb.error ?? ""), `apply zahozeného dokladu odmítnut (${r.status()} ${rb.error})`);
  expect(Number(sql(`select count(*) from job_files where filename in (${[fa, fb, fc].map(q).join(",")})`)) === 0, "žádný dokument ze zrušených dokladů");
  await page.close();
});

// ═════════════════════════════════════════════════════════════
await T("mobil 390 px: dialog přes celou obrazovku, bez přetékání, uložení funguje", async (context) => {
  const job = myJob("M", { stage: "nabidka", customerId: null });
  const fileName = `e2e-cap-m-${RUN}.png`;
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.goto(`${BASE}/orders`);
  await page.getByRole("button", { name: "Vyfotit doklad", exact: true }).click();
  const dlg = captureDialog(page);
  await dlg.waitFor();
  const box = await dlg.boundingBox();
  expect(box && box.x <= 1 && box.width >= 388 && box.height >= 800, `dialog přes celou obrazovku (${JSON.stringify(box)})`);
  let ov = await noHorizontalOverflow(page);
  expect(ov.ok, `krok 1 bez přetékání (${ov.scroll} > ${ov.inner}) ${await overflowingInDialog(page)}`);
  // měkké kontroly (sebrat vše, selhat až na konci, ať doběhne i zbytek toku)
  const issues = [];
  const soft = (cond, msg) => { if (!cond) issues.push(msg); };
  for (const name of ["Vyfotit", "Vybrat soubory"]) {
    const b = await dlg.getByRole("button", { name, exact: true }).boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 390, `tlačítko „${name}“ v okně (${JSON.stringify(b)})`);
    soft(b.height >= 44, `tlačítko „${name}“ má výšku ${Math.round(b.height)} px (< 44 px dotykový cíl; má h-12)`);
  }
  await shot(page, "capture/m-pick");
  await uploadPages(page, [pngFile(fileName, 8)]);
  await shot(page, "capture/m-uploaded");
  await readDoc(page);
  const how = await pickTarget(page, job.number);
  expect(how === "combobox", `zakázka vybraná přes „Jiná zakázka…“ (${how})`);
  ov = await noHorizontalOverflow(page);
  expect(ov.ok, `kontrola bez přetékání stránky (${ov.scroll} > ${ov.inner})`);
  const wide = await overflowingInDialog(page);
  expect(wide.length === 0, `žádný prvek dialogu nepřesahuje šířku: ${wide.join(" | ")}`);
  const saveBox = await page.getByTestId("capture-save").boundingBox();
  expect(saveBox && saveBox.y + saveBox.height <= 844 && saveBox.y > 600, `Uložit v patičce na obrazovce (${JSON.stringify(saveBox)})`);
  // fotka nahoře, „Skrýt fotku“ ji schová
  const img = dlg.getByRole("img", { name: new RegExp(`Stránka 1: ${esc(fileName)}`) });
  expect(await img.isVisible(), "náhled fotky nad formulářem");
  await dlg.getByRole("button", { name: "Skrýt fotku" }).click();
  expect(!(await img.isVisible()), "Skrýt fotku schová náhled");
  await dlg.getByRole("button", { name: "Ukázat fotku" }).click();
  expect(await img.isVisible(), "Ukázat fotku vrátí náhled");
  await shot(page, "capture/m-review");
  // projet formulář až dolů (pole se dají vyplnit)
  await page.locator("#cap-doc-note").scrollIntoViewIfNeeded();
  await page.locator("#cap-doc-note").fill("E2E mobil poznámka");
  await shot(page, "capture/m-review-bottom");
  const res = await saveDoc(page);
  expect(res.jobId === job.id, "uloženo do zakázky");
  ov = await noHorizontalOverflow(page);
  expect(ov.ok, `Hotovo bez přetékání (${ov.scroll} > ${ov.inner})`);
  const doneBtns = await dlg.getByRole("button", { name: /Vyfotit další doklad|Zavřít/ }).all();
  for (const b of doneBtns) {
    const bb = await b.boundingBox();
    expect(bb && bb.x >= 0 && bb.x + bb.width <= 391, `tlačítko na obrazovce Hotovo v okně (${JSON.stringify(bb)})`);
  }
  await shot(page, "capture/m-done");
  await dlg.getByRole("button", { name: "Vyfotit další doklad" }).click();
  await dlg.getByText("Vyfoť doklad").waitFor();
  expect(await page.getByTestId("capture-read").isDisabled(), "nový doklad začíná prázdný");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await dlg.waitFor({ state: "detached" });
  expect(jobRow(job.id).customer_id === STROJMETAL, "zákazník z dokladu doplněn do zakázky bez zákazníka");
  const f = sqlJson(`select json_agg(f) from (select storage_path, note from job_files where job_id = ${q(job.id)}) f`) ?? [];
  expect(f.length === 1 && f[0].note === "E2E mobil poznámka", `dokument s poznámkou z mobilu (${JSON.stringify(f)})`);
  await page.close();
  await dropJob(job.id);
  expect(!issues.length, issues.join(" · "));
}, { mobile: true });

// ═════════════════════════════════════════════════════════════
await T("API: cizí cesta, cizí relace, cizí původ a nepřihlášený jsou odmítnuty", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.obchod);
  // cizí (adminova) složka capture/
  const foreign = { path: `capture/${ADMIN_ID}/00000000-0000-4000-8000-000000000000-x.png`, filename: "x.png", mimeType: "image/png", size: 10 };
  let r = await page.request.post(`${BASE}/api/jobs/capture/analyze`, { data: { files: [foreign] }, headers: { origin: BASE } });
  let b = await r.json();
  expect(r.status() === 400 && b.error === "Neplatná cesta souboru.", `cizí cesta odmítnuta (${r.status()} ${b.error})`);
  // cizí relace (admin) — vytvoříme si ji přes analyze jako admin
  const { context: ac } = await newContext(browser);
  if (needShim) await installEnvShim(ac);
  const ap = await ac.newPage();
  await login(ap, USERS.admin);
  await openFromBook(ap);
  const fn = `e2e-cap-api-${RUN}.png`;
  await uploadPages(ap, [pngFile(fn, 9)]);
  const { body } = await readDoc(ap);
  const captureId = body.model.captureId;
  r = await page.request.post(`${BASE}/api/jobs/capture/apply`, { data: { captureId, state: body.model.initial }, headers: { origin: BASE } });
  b = await r.json();
  expect(r.status() === 400 && /už není k dispozici/.test(b.error ?? ""), `obchodník nemůže uložit adminův doklad (${r.status()} ${b.error})`);
  r = await page.request.post(`${BASE}/api/jobs/capture/target`, { data: { captureId, jobId: "d0000000-0000-0000-0000-000000000001" }, headers: { origin: BASE } });
  b = await r.json();
  expect(r.status() === 400 && /už není k dispozici/.test(b.error ?? ""), `ani načíst cíl k adminovu dokladu (${r.status()} ${b.error})`);
  // cizí původ
  r = await ap.request.post(`${BASE}/api/jobs/capture/apply`, { data: { captureId, state: body.model.initial }, headers: { origin: "https://evil.example" } });
  expect(r.status() === 403, `cizí Origin = 403 (${r.status()})`);
  // úklid adminovy relace (zavřít dialog)
  ap.once("dialog", (d) => d.accept());
  await captureDialog(ap).getByRole("button", { name: "Zrušit" }).click();
  await captureDialog(ap).waitFor({ state: "detached" });
  await ap.waitForTimeout(2000);
  expect(storageObjects(fn).length === 0 && storageObjects(`${captureId}.json`).length === 0, "adminova relace uklizena");
  await ac.close();
  // nepřihlášený
  const anon = await browser.newContext();
  r = await anon.request.post(`${BASE}/api/jobs/capture/analyze`, { data: { files: [] }, headers: { origin: BASE } });
  b = await r.json().catch(() => ({}));
  expect(r.status() === 401 && /přihlas/i.test(b.error ?? ""), `nepřihlášený = 401 (${r.status()} ${b.error})`);
  await anon.close();
  await page.close();
});

// ── Úklid ──────────────────────────────────────────────────
for (const id of cleanup.jobs) await deleteJobDeep(id).catch((e) => console.log(`  ! úklid zakázky ${id}: ${e.message}`));
sql(`delete from ai_corrections where agent_key = 'capture' and context like ${q(`%${RUN}%`)}`);
for (const id of cleanup.customers) {
  sql(`delete from customer_contacts where customer_id = ${q(id)}`);
  sql(`delete from customers where id = ${q(id)} and name like ${q(`${TAG}%`)}`);
}
for (const s of cleanup.restore) sql(s);
await removeStorage([...cleanup.storagePaths]);
const leftovers = storageObjects(RUN);
if (leftovers.length) {
  await removeStorage(leftovers);
  console.log(`  · úklid: smazáno ${leftovers.length} zbylých souborů v úložišti`);
}
const left = sql(`select count(*) from orders where number like ${q(`E2E-CAP-%-${RUN}`)} or title like ${q(`${TAG}%`)}`);
if (left !== "0") console.log(`  ! po úklidu zůstalo ${left} zakázek testu`);

await browser.close();
process.exit(summary(errors) ? 0 : 1);
