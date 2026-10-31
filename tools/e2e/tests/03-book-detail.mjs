// E2E 03 · Kniha zakázek (/orders) a karta zakázky (/orders/<id>).
// Segmenty, chipy stavů, hledání, filtry, řazení, KPI, Tabule, URL parametry,
// „+ Nová zakázka" (validace, zákazník, termíny, lidé, položky, DB), detail
// (hlavička, časová osa, posun stavu s atribucí, inline úpravy, štítky,
// položky, záložky, komentář, dokumenty s verzemi), mazání (jen super admin),
// role (nákupní ceny) a mobil 390 px.
// Vlastní data mají prefix „E2E-book-" a na konci se uklidí.
import { BASE, USERS, launch, withContext, login, shot, sql, test, expect, summary } from "../lib.mjs";
import {
  PREFIX, TAG, STAGE_LABELS, LABEL_TO_STAGE, SEGMENTS, SEGMENT_ROWS, STAGE_SOLID, STAGE_DOT, lit, userIds, eventually, bookIdle,
  readRows, rowStages, shownCount, dbCount, dbSegmentCount, dbRunningValue, segmentWhere, expectNoOverflow, expectInViewport,
  createCustomer, createJob, cleanupOwnData, waitHydrated,
} from "../lib-book-detail.mjs";

const browser = await launch();
const errors = [];
/** ONLY=regex spustí jen vybrané testy (ladění). */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const T = (name, fn, opts) => (ONLY && !ONLY.test(name) ? Promise.resolve() : test(name, () => withContext(browser, errors, fn, opts)));
const S = (name) => `book-detail/${name}`;
const collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" });
const tagLc = TAG.toLowerCase();

console.log(`03 · Kniha zakázek a karta zakázky (značka ${TAG})`);

// ── Vlastní data ─────────────────────────────────────────────
const leftovers = await cleanupOwnData();
if (leftovers.jobs || leftovers.customers) console.log(`  (úklid po minulém běhu: ${leftovers.jobs} zakázek, ${leftovers.customers} zákazníků)`);
const ID = userIds();
const HRUBY = "d4000000-0000-0000-0000-000000000001";
const CUST = createCustomer(`${PREFIX}Kovo ${TAG} s.r.o.`, ID.obchod);

const F1 = createJob({
  title: `${PREFIX}F1 frézování ${TAG}`, status: "ve_vyrobe", customerId: CUST.id, ownerId: ID.obchod, assigneeId: ID.dilna,
  cpo: `E2EB-PO-${TAG}`, dueDays: -2, value: 3000, purchaseCost: 1555.54, priority: "vysoka",
  items: [{ drawing: `E2EB-DWG-${TAG}`, rev: "C", name: "Deska F1", material: "1.2379", qty: 2, price: 1500, purchase: 777.77 }],
});
sql(`insert into job_operations (job_id, position, kind, supplier_id, status, created_by) values (${lit(F1.id)}, 0, 'frezovani', ${lit(HRUBY)}, 'probiha', ${lit(ID.obchod)})`);
const F2 = createJob({
  title: `${PREFIX}F2 faktura ${TAG}`, status: "fakturovano", customerId: CUST.id, ownerId: ID.admin,
  invoiceNumber: `E2EB-FA-${TAG}`, invoiceDays: -20, invoiceDueDays: -5, value: 12000, dueDays: -25,
});
const F3 = createJob({ title: `${PREFIX}F3 poptávka ${TAG}`, status: "poptavka", customerId: CUST.id, ownerId: ID.obchod, cinq: `E2EB-RFQ-${TAG}` });
const item = (n) => ({ drawing: `E2EB-${n}-DWG-${TAG}`, rev: "A", name: `Deska ${n}`, material: "1.2379", qty: 2, price: 1500, purchase: 777.77 });
const D1 = createJob({ title: `${PREFIX}D1 stav ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, cpo: `E2EB-D1-PO-${TAG}`, dueDays: 20, reqDays: 18, value: 3000, items: [item("D1")] });
const D2 = createJob({ title: `${PREFIX}D2 úpravy ${TAG}`, status: "potvrzeno", customerId: CUST.id, ownerId: ID.obchod, cpo: `E2EB-D2-PO-${TAG}`, dueDays: 15, value: 3000 });
const D3 = createJob({ title: `${PREFIX}D3 položky ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod, value: 3000, purchaseCost: 1555.54, items: [item("D3")] });
const D4 = createJob({ title: `${PREFIX}D4 dokumenty ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod });
const D5 = createJob({ title: `${PREFIX}D5 role ${TAG}`, status: "potvrzeno", customerId: CUST.id, ownerId: ID.obchod, value: 3000, purchaseCost: 4321.09, dueDays: 10, items: [item("D5")] });
const DELA = createJob({ title: `${PREFIX}DEL-A ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod });
const DELB = createJob({ title: `${PREFIX}DEL-B ${TAG}`, status: "objednavka", customerId: CUST.id, ownerId: ID.obchod });
// 31. 10.: dodáno vše (DL na vše), stav se neposunul (Montáž) → Dokončené; dílčí dodávka → zůstává v Objednávkách
const L1 = createJob({ title: `${PREFIX}L1 dodáno vše ${TAG}`, status: "montaz", customerId: CUST.id, ownerId: ID.obchod, value: 3000, items: [{ ...item("L1"), delivered: 2 }] });
const L2 = createJob({
  title: `${PREFIX}L2 dílčí dodávka ${TAG}`, status: "ve_vyrobe", customerId: CUST.id, ownerId: ID.obchod, value: 6000,
  items: [{ ...item("L2A"), delivered: 2 }, item("L2B")],
});

/** Zachycená server akce deleteJob (super admin) — pro pokus zaměstnance. */
let deleteAction = null;

async function openBook(page, user, query = "") {
  await login(page, user);
  await page.goto(`${BASE}/orders${query}`);
  await bookIdle(page);
}

// CSS lokátory jen v <main>: při plném načtení drží React streaming chvíli skrytou kopii obsahu (div#S:0[hidden])
const segLink = (page, label) => page.locator('main nav[aria-label="Části knihy"] a').filter({ hasText: label });
const chip = (page, label) => page.locator('main [role=group][aria-label="Filtr podle stavu"] a').filter({ hasText: new RegExp(`^\\s*${label}\\s*\\d+\\s*$`) });
const trailingNumber = (t) => Number(/(\d+)\s*$/.exec(t.trim())?.[1] ?? NaN);
const main = (page) => page.locator("main").innerText();
const numbersOf = (rows) => rows.map((r) => r.number);
const search = (page) => page.locator('main input[aria-label="Hledat v knize zakázek"]');

/** Počkej na URL knihy s danými parametry (a dokončení přechodu). */
async function waitParams(page, check, what) {
  await page.waitForURL((u) => u.pathname === "/orders" && check(u.searchParams), { timeout: 10_000 }).catch(() => {
    throw new Error(`URL po „${what}" neodpovídá: ${page.url()}`);
  });
  await bookIdle(page);
}

/** Počty v UI vs. DB — při souběžné změně jiným testem stránku obnov a zkus znovu. */
async function expectCountsMatchDb(page, check) {
  await eventually(async () => {
    try {
      await check();
    } catch (err) {
      await page.reload();
      await bookIdle(page);
      throw err;
    }
  }, { timeout: 15_000, interval: 500 });
}

// ═════════════════════════ KNIHA ZAKÁZEK ═════════════════════════

await T("kniha: výchozí segment Objednávky — jen objednávkové stavy, počet sedí s DB", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  expect((await segLink(page, "Objednávky").getAttribute("aria-current")) === "page", "záložka Objednávky je aktivní");
  await expectCountsMatchDb(page, async () => {
    const rows = await readRows(page);
    const stages = rowStages(rows);
    const bad = stages.filter((s) => !SEGMENTS.objednavky.includes(s));
    expect(bad.length === 0, `jen objednávkové stavy (bez Dodáno zákazníkovi / Vyfakturováno), navíc: ${bad.join(", ")}`);
    const db = dbSegmentCount("objednavky");
    expect(rows.length === db, `řádků ${rows.length} = DB ${db}`);
    expect((await shownCount(page)) === db, `počítadlo nad seznamem = DB ${db}`);
    expect(trailingNumber(await segLink(page, "Objednávky").innerText()) === db, "počet v záložce Objednávky = DB");
  });
  const nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number), "vlastní objednávka F1 (ve výrobě) je v knize");
  expect(!nums.includes(F2.number), "31. 10.: vyfakturovaná F2 (DL vystaven) v Objednávkách není — je v Dokončených");
  expect(!nums.includes(L1.number), "31. 10.: L1 (dodáno vše, stav Montáž) v Objednávkách není — je v Dokončených");
  expect(nums.includes(L2.number), "31. 10.: L2 (dílčí dodávka) zůstává v Objednávkách");
  expect(!nums.includes(F3.number), "poptávka F3 v Objednávkách není");
  expect((await main(page)).includes("Objednané zakázky bez dodacího listu — v běhu."), "popisek záložky Objednávky");
  await shot(page, S("01-orders-default"));
});

await T("kniha: segmenty Poptávky & nabídky, Dokončené, Nerealizované, Vše (URL, stavy, počty)", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  const segs = [
    ["poptavky", "Poptávky"],
    ["dokoncene", "Dokončené"],
    ["nerealizovane", "Nerealizované"],
    ["vse", "Vše"],
  ];
  for (const [key, label] of segs) {
    await segLink(page, label).click();
    await waitParams(page, (sp) => sp.get("segment") === key, `záložka ${label}`);
    expect((await segLink(page, label).getAttribute("aria-current")) === "page", `${label}: záložka aktivní`);
    await expectCountsMatchDb(page, async () => {
      const rows = await readRows(page);
      const bad = rowStages(rows).filter((s) => !SEGMENT_ROWS[key].includes(s));
      expect(bad.length === 0, `${label}: jen stavy segmentu, navíc ${bad.join(", ")}`);
      const db = dbSegmentCount(key);
      expect(rows.length === db, `${label}: řádků ${rows.length} = DB ${db}`);
      expect(trailingNumber(await segLink(page, label).innerText()) === db, `${label}: počet v záložce = DB ${db}`);
    });
    const nums = numbersOf(await readRows(page));
    if (key === "poptavky") {
      expect(nums.includes(F3.number) && !nums.includes(F1.number), "Poptávky: F3 ano, F1 ne");
      await shot(page, S("02-segment-poptavky"));
    }
    if (key === "dokoncene") {
      // 31. 10.: vystavený DL na vše = Dokončené (i vyfakturovaná nezaplacená, i stav, který se neposunul)
      expect(nums.includes(F2.number) && nums.includes(L1.number), `Dokončené: F2 (vyfakturováno) a L1 (dodáno vše) ano (${nums.join(",")})`);
      expect(!nums.includes(F1.number) && !nums.includes(L2.number), "Dokončené: F1 (ve výrobě) a L2 (dílčí dodávka) ne");
      expect((await main(page)).includes("Dodané zákazníkovi (vystavený DL), vyfakturované a zaplacené."), "popisek záložky Dokončené");
      // chipy stavů Dokončených
      for (const st of SEGMENTS.dokoncene) {
        expect(trailingNumber(await chip(page, STAGE_LABELS[st]).innerText()) === dbSegmentCount("dokoncene", st), `Dokončené: chip ${STAGE_LABELS[st]} = DB`);
      }
      await shot(page, S("02-segment-dokoncene"));
    }
    if (key === "vse") expect([F1, F2, F3].every((f) => nums.includes(f.number)), "Vše: F1, F2, F3");
  }
  // chipy ve „Vše" = všech 16 stavů
  const chips = await page.locator('main [role=group][aria-label="Filtr podle stavu"] a').allInnerTexts();
  expect(chips.length === 17, `Vše: chip „Vše" + 16 stavů, je ${chips.length}`);
});

await T("kniha: čipy stavů — barvy, vícenásobný výběr, počty, „Vše“ ruší výběr", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  // počty a barvy neaktivních chipů
  await expectCountsMatchDb(page, async () => {
    for (const st of SEGMENTS.objednavky) {
      const c = chip(page, STAGE_LABELS[st]);
      expect((await c.count()) === 1, `chip ${STAGE_LABELS[st]} existuje`);
      const n = trailingNumber(await c.innerText());
      // 31. 10.: v Objednávkách bez zakázek s dodaným vším (ty jsou v Dokončených)
      const db = dbSegmentCount("objednavky", st);
      expect(n === db, `chip ${STAGE_LABELS[st]}: ${n} = DB ${db}`);
      const dot = await c.locator("span").first().getAttribute("class");
      expect(dot.includes(STAGE_DOT[st]), `chip ${STAGE_LABELS[st]}: barevná tečka ${STAGE_DOT[st]} (${dot})`);
    }
  });
  // klik = filtr na stav, plná barva
  await chip(page, "Ve výrobě").click();
  await waitParams(page, (sp) => sp.get("stages") === "ve_vyrobe", "chip Ve výrobě");
  const vv = chip(page, "Ve výrobě");
  expect((await vv.getAttribute("aria-current")) === "true", "chip Ve výrobě aktivní");
  expect((await vv.getAttribute("class")).includes(STAGE_SOLID.ve_vyrobe), "aktivní chip má plnou barvu stavu");
  let rows = await readRows(page);
  expect(rows.length > 0 && rowStages(rows).every((s) => s === "ve_vyrobe"), `jen Ve výrobě (${rowStages(rows).join(",")})`);
  expect(numbersOf(rows).includes(F1.number), "F1 (ve výrobě) je vidět");
  await shot(page, S("03-chip-ve-vyrobe"));
  // druhý chip = vícenásobný výběr (pořadí knihy)
  await chip(page, "Reklamace").click();
  await waitParams(page, (sp) => sp.get("stages") === "ve_vyrobe,reklamace", "chip Reklamace");
  rows = await readRows(page);
  expect(rowStages(rows).every((s) => s === "ve_vyrobe" || s === "reklamace"), "jen Ve výrobě + Reklamace");
  expect(rowStages(rows).includes("reklamace"), "Reklamace (Z-2026-114) přibyla");
  // opětovný klik vybraný chip vypne
  await chip(page, "Ve výrobě").click();
  await waitParams(page, (sp) => sp.get("stages") === "reklamace", "vypnutí chipu Ve výrobě");
  // „Vše" ruší výběr
  await page.locator('main [role=group][aria-label="Filtr podle stavu"] a').filter({ hasText: /^\s*Vše\s*$/ }).click();
  await waitParams(page, (sp) => !sp.has("stages"), "chip Vše");
  expect(rowStages(await readRows(page)).length === dbSegmentCount("objednavky"), "po „Vše“ celý segment");
  // vybraný stav v Objednávkách = jen bez DL na vše: chip Montáž bez L1
  await chip(page, "Montáž").click();
  await waitParams(page, (sp) => sp.get("stages") === "montaz", "chip Montáž");
  expect(!numbersOf(await readRows(page)).includes(L1.number), "chip Montáž: L1 (dodáno vše) v Objednávkách není");
});

/** Čísla zakázek zákazníka CUST v segmentu Objednávky (podle DB, seřazená). */
const custOrderNumbers = () => sql(
  `select coalesce(string_agg(number, ',' order by number), '') from orders where customer_id = ${lit(CUST.id)} and ${segmentWhere("objednavky")}`,
).split(",").filter(Boolean);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

await T("kniha: hledání — číslo Z-…, zákazník, číslo obj. zákazníka, výkres, bez diakritiky", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  // zákazník má v Objednávkách F1, L2 i zakázky D1–D5, DEL-A/B; poptávka F3 ani dodaná F2 / L1 (Dokončené) do segmentu nepatří
  const byCustomer = (n) => n.includes(F1.number) && n.includes(L2.number) && !n.includes(F2.number) && !n.includes(L1.number)
    && !n.includes(F3.number) && sameSet(n, custOrderNumbers());
  const cases = [
    [F1.number, (n) => n.length === 1 && n[0] === F1.number, "číslo zakázky"],
    [`${PREFIX}kovo ${tagLc}`, byCustomer, "název zákazníka (malými)"],
    [CUST.number, (n) => n.includes(F1.number) && !n.includes(F2.number), "naše číslo zákazníka"],
    [`E2EB-PO-${TAG}`, (n) => n.length === 1 && n[0] === F1.number, "číslo objednávky zákazníka"],
    [`e2eb-dwg-${tagLc}`, (n) => n.length === 1 && n[0] === F1.number, "číslo výkresu"],
    ["PO-4500021877", (n) => n.length === 1 && n[0] === "Z-2026-104", "obj. zákazníka demo (AeroParts)"],
    ["priruby al 7075", (n) => n.length === 1 && n[0] === "Z-2026-104", "bez diakritiky, víc slov"],
  ];
  for (const [q, ok, what] of cases) {
    await search(page).fill(q);
    await waitParams(page, (sp) => sp.get("q") === q, `hledání ${what}`);
    await eventually(async () => {
      const n = numbersOf(await readRows(page));
      expect(ok(n), `hledání „${q}" (${what}) → ${n.join(", ") || "nic"}`);
    });
  }
  await shot(page, S("04-search"));
  // nic nenalezeno
  await search(page).fill(`neexistuje-${tagLc}`);
  await waitParams(page, (sp) => sp.get("q") === `neexistuje-${tagLc}`, "hledání bez výsledku");
  expect((await readRows(page)).length === 0, "žádné řádky");
  expect((await page.locator("main").innerText()).length > 0, "prázdný stav");
  await shot(page, S("04-search-empty"));
  // Esc vymaže
  await search(page).press("Escape");
  await waitParams(page, (sp) => !sp.has("q"), "Esc v hledání");
  expect((await search(page).inputValue()) === "", "pole hledání prázdné");
  // hledání v jiné záložce: poptávka zákazníka F3
  await page.goto(`${BASE}/orders?segment=poptavky&q=${encodeURIComponent(`E2EB-RFQ-${TAG}`)}`);
  await bookIdle(page);
  const n = numbersOf(await readRows(page));
  expect(n.length === 1 && n[0] === F3.number, `č. poptávky zákazníka v Poptávkách → F3 (${n.join(",")})`);
});

await T("kniha: filtry obchodník, zpracovává, zákazník, termín, výroba, kde, platba + Zrušit filtry", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  const ownerOf = (nums) => (nums.length ? sql(`select string_agg(distinct coalesce(owner_id::text,'-'), ',') from orders where number in (${nums.map(lit).join(",")})`) : "");
  const assigneeOf = (nums) => (nums.length ? sql(`select string_agg(distinct coalesce(assignee_id::text,'-'), ',') from orders where number in (${nums.map(lit).join(",")})`) : "");
  const reset = async () => {
    await page.getByRole("button", { name: "Zrušit filtry" }).click();
    await waitParams(page, (sp) => !["owner", "assignee", "customer", "deadline", "payment", "step", "location", "q"].some((k) => sp.has(k)), "Zrušit filtry");
  };

  // obchodník
  await page.getByLabel("Obchodník", { exact: true }).selectOption({ label: "Petr Obchodník" });
  await waitParams(page, (sp) => sp.get("owner") === ID.obchod, "filtr Obchodník");
  let nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number) && !nums.includes(F2.number), "obchodník Petr: F1 ano, F2 (admin) ne");
  expect(ownerOf(nums) === ID.obchod, `všechny řádky mají obchodníka Petra (${ownerOf(nums)})`);
  await shot(page, S("05-filter-owner"));
  await reset();

  // zpracovává
  await page.getByLabel("Zpracovává", { exact: true }).selectOption({ label: "Jana Zaměstnanec" });
  await waitParams(page, (sp) => sp.get("assignee") === ID.dilna, "filtr Zpracovává");
  nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number), "zpracovává Jana: F1");
  expect(assigneeOf(nums) === ID.dilna, `všechny řádky zpracovává Jana (${assigneeOf(nums)})`);
  expect(nums.length === Number(sql(`select count(*) from orders where assignee_id = ${lit(ID.dilna)} and ${segmentWhere("objednavky")}`)), "počet = DB");
  await reset();

  // zákazník (combobox s hledáním)
  const cust = page.getByRole("combobox", { name: "Zákazník" });
  await cust.click();
  await cust.fill(tagLc);
  await page.getByRole("option", { name: new RegExp(CUST.name) }).click();
  await waitParams(page, (sp) => sp.get("customer") === CUST.id, "filtr Zákazník");
  nums = numbersOf(await readRows(page));
  expect(
    nums.includes(F1.number) && !nums.includes(F2.number) && !nums.includes(F3.number) && sameSet(nums, custOrderNumbers()),
    `zákazník: F1 (ne vyfakturovaná F2) a jen jeho objednávky v běhu podle DB (${nums.join(",")})`,
  );
  await reset();

  // termín
  await page.getByLabel("Termín", { exact: true }).selectOption("overdue");
  await waitParams(page, (sp) => sp.get("deadline") === "overdue", "filtr Termín po termínu");
  nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number) && nums.includes("Z-2026-106"), `po termínu: F1 a Z-2026-106 (${nums.join(",")})`);
  expect(!nums.includes(F2.number) && !nums.includes("Z-2026-104"), "fakturovaná F2 a Z-2026-104 bez termínu nejsou po termínu");
  await page.getByLabel("Termín", { exact: true }).selectOption("no_date");
  await waitParams(page, (sp) => sp.get("deadline") === "no_date", "filtr Bez termínu");
  nums = numbersOf(await readRows(page));
  expect(!nums.includes(F1.number), "bez termínu: F1 (má termín) ne");
  await reset();

  // výroba: aktuální operace + kde
  const step = page.getByLabel("Výroba: operace");
  expect(await step.isVisible(), "filtr Výroba je vidět (existuje operace)");
  const stepOpts = await step.locator("option").allInnerTexts();
  expect(stepOpts.some((t) => /^Frézování \(\d+\)$/.test(t)), `volba Frézování (n): ${stepOpts.join(" | ")}`);
  await step.selectOption("frezovani");
  await waitParams(page, (sp) => sp.get("step") === "frezovani", "filtr Výroba");
  nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number), "výroba frézování: F1");
  expect(sql(`select count(*) from orders where number in (${nums.map(lit).join(",")}) and production_step is distinct from 'frezovani'`) === "0", "všechny řádky mají aktuální operaci frézování");
  await reset();
  const loc = page.getByLabel("Kde: firma");
  await loc.selectOption("Kovoobrábění Hrubý s.r.o.");
  await waitParams(page, (sp) => sp.get("location") === "Kovoobrábění Hrubý s.r.o.", "filtr Kde");
  nums = numbersOf(await readRows(page));
  expect(nums.includes(F1.number), "kde = Hrubý: F1");
  await reset();

  // platba — vyfakturovaná F2 je v Dokončených (DL vystaven); Dodání v Dokončených = jen Dodáno / DL potvrzen
  await segLink(page, "Dokončené").click();
  await waitParams(page, (sp) => sp.get("segment") === "dokoncene", "záložka Dokončené");
  const deliveryOpts = await page.getByLabel("Dodání", { exact: true }).locator("option").allInnerTexts();
  expect(JSON.stringify(deliveryOpts) === JSON.stringify(["Dodání: vše", "Dodáno", "DL potvrzen"]), `Dokončené: volby Dodání (${deliveryOpts.join(" | ")})`);
  await page.getByLabel("Platba", { exact: true }).selectOption("po_splatnosti");
  await waitParams(page, (sp) => sp.get("payment") === "po_splatnosti", "filtr Platba po splatnosti");
  nums = numbersOf(await readRows(page));
  expect(nums.includes(F2.number) && !nums.includes(F1.number), `po splatnosti: F2 ano, F1 ne (${nums.join(",")})`);
  await shot(page, S("05-filter-payment"));
  await reset();
  await segLink(page, "Objednávky").click();
  await waitParams(page, (sp) => !sp.has("segment"), "záložka Objednávky");
  const runOpts = await page.getByLabel("Dodání", { exact: true }).locator("option").allInnerTexts();
  expect(JSON.stringify(runOpts) === JSON.stringify(["Dodání: vše", "K expedici", "Částečně dodáno"]), `Objednávky: volby Dodání (${runOpts.join(" | ")})`);
});

await T("kniha: řazení — číslo, zákazník, hodnota, směr šipkou", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin, "?segment=vse");
  const sortSel = page.getByLabel("Řazení", { exact: true });

  await sortSel.selectOption("number");
  await waitParams(page, (sp) => sp.get("sort") === "number" && !sp.has("dir"), "řazení Číslo");
  let nums = numbersOf(await readRows(page));
  expect(nums.every((n, i) => i === 0 || collator.compare(nums[i - 1], n) >= 0), `číslo sestupně: ${nums.slice(0, 6).join(", ")}…`);
  await page.getByRole("button", { name: /^Směr řazení/ }).click();
  await waitParams(page, (sp) => sp.get("sort") === "number" && sp.get("dir") === "asc", "přepnutí směru");
  nums = numbersOf(await readRows(page));
  expect(nums.every((n, i) => i === 0 || collator.compare(nums[i - 1], n) <= 0), `číslo vzestupně: ${nums.slice(0, 6).join(", ")}…`);
  expect((await page.getByRole("button", { name: /^Směr řazení/ }).getAttribute("aria-label")).includes("vzestupně"), "popisek šipky = vzestupně");

  await sortSel.selectOption("customer");
  await waitParams(page, (sp) => sp.get("sort") === "customer" && !sp.has("dir"), "řazení Zákazník (výchozí vzestupně)");
  const rows = await readRows(page);
  const names = rows.map((r) => r.customer);
  const firstNull = names.indexOf(null);
  expect(firstNull === -1 || names.slice(firstNull).every((n) => n === null), "bez zákazníka až na konci");
  const named = names.filter(Boolean);
  expect(named.every((n, i) => i === 0 || collator.compare(named[i - 1], n) <= 0), `zákazník A→Z: ${[...new Set(named)].join(" < ")}`);

  await sortSel.selectOption("value");
  await waitParams(page, (sp) => sp.get("sort") === "value", "řazení Hodnota");
  nums = numbersOf(await readRows(page));
  const vals = Object.fromEntries(sql(`select number || '|' || coalesce(value::text, '') from orders where number in (${nums.map(lit).join(",")})`).split("\n").map((l) => l.split("|")));
  const seq = nums.map((n) => (vals[n] === "" ? null : Number(vals[n])));
  const fn = seq.indexOf(null);
  expect(fn === -1 || seq.slice(fn).every((v) => v === null), "bez hodnoty na konci");
  const vv = seq.filter((v) => v !== null);
  expect(vv.every((v, i) => i === 0 || vv[i - 1] >= v), `hodnota sestupně: ${vv.slice(0, 6).join(" ≥ ")}`);
  await shot(page, S("06-sort-value"));
});

await T("kniha: KPI dlaždice — počty a proklik = filtr", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  const tile = (label) => page.locator("main a").filter({ hasText: label }).filter({ has: page.locator(".text-xl") });
  await expectCountsMatchDb(page, async () => {
    const running = trailingNumber((await tile("Objednávky v běhu").innerText()).split("\n")[0]);
    expect(running === dbSegmentCount("objednavky"), `Objednávky v běhu ${running} = DB (bez DL na vše)`);
    const inq = trailingNumber((await tile("Poptávky & nabídky").innerText()).split("\n")[0]);
    expect(inq === dbCount(SEGMENTS.poptavky), `Poptávky & nabídky ${inq} = DB`);
    const prob = trailingNumber((await tile("Reklamace & pauza").innerText()).split("\n")[0]);
    expect(prob === dbCount(["pozastaveno", "reklamace"]), `Reklamace & pauza ${prob} = DB`);
    // 31. 10.: Hodnota v běhu = součet VŠECH objednávek bez DL na vše (ne jen zobrazených řádků); L1 (dodáno vše) a F2 ne, L2 (dílčí) ano
    const shown = Number((await tile("Hodnota v běhu").locator(".text-xl").innerText()).replace(/[^\d]/g, ""));
    const db = Math.round(dbRunningValue());
    expect(shown === db, `Hodnota v běhu ${shown} = DB ${db}`);
    const inRunning = sql(`select coalesce(string_agg(number, ','), '') from orders where id in (${[L1.id, L2.id, F2.id].map(lit).join(",")}) and ${segmentWhere("objednavky")}`);
    expect(inRunning === L2.number, `do Hodnoty v běhu se počítá L2, ne L1 ani F2 (${inRunning})`);
    // Po splatnosti = všechny nezaplacené faktury po splatnosti (F2 je v Dokončených, počítá se i tak)
    const overdueInv = trailingNumber((await tile("Po splatnosti").innerText()).split("\n")[0]);
    await page.goto(`${BASE}/orders?segment=vse&payment=po_splatnosti`);
    await bookIdle(page);
    const overdueRows = await readRows(page);
    expect(overdueInv === overdueRows.length && numbersOf(overdueRows).includes(F2.number), `Po splatnosti ${overdueInv} = řádků filtru ${overdueRows.length} (vč. F2)`);
    await page.goto(`${BASE}/orders`);
    await bookIdle(page);
  });
  expect(await tile("Hodnota v běhu").isVisible(), "super admin vidí Hodnota v běhu");

  await tile("Po termínu").click();
  await waitParams(page, (sp) => sp.get("segment") === "vse" && sp.get("deadline") === "overdue", "dlaždice Po termínu");
  expect((await tile("Po termínu").getAttribute("aria-current")) === "true", "dlaždice Po termínu zvýrazněná");
  expect((await page.getByLabel("Termín", { exact: true }).inputValue()) === "overdue", "select Termín = Po termínu");
  expect(numbersOf(await readRows(page)).includes(F1.number), "F1 po termínu");
  await shot(page, S("07-kpi-overdue"));

  await tile("Poptávky & nabídky").click();
  await waitParams(page, (sp) => sp.get("segment") === "poptavky" && !sp.has("deadline"), "dlaždice Poptávky");
  expect(rowStages(await readRows(page)).every((s) => SEGMENTS.poptavky.includes(s)), "jen poptávkové stavy");

  await tile("Reklamace & pauza").click();
  await waitParams(page, (sp) => !sp.has("segment") && sp.get("stages") === "pozastaveno,reklamace", "dlaždice Reklamace & pauza");
  expect(rowStages(await readRows(page)).every((s) => s === "pozastaveno" || s === "reklamace"), "jen pauza a reklamace");

  await tile("Po splatnosti").click();
  await waitParams(page, (sp) => sp.get("payment") === "po_splatnosti", "dlaždice Po splatnosti");
  expect(numbersOf(await readRows(page)).includes(F2.number), "F2 po splatnosti");

  await tile("Hodnota v běhu").click();
  await waitParams(page, (sp) => sp.get("sort") === "value" && !sp.has("payment"), "dlaždice Hodnota v běhu");
});

await T("kniha: Tabule — sloupce podle stavů segmentu, karty ve správném sloupci", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  await page.getByRole("button", { name: "Tabule" }).click();
  await waitParams(page, (sp) => sp.get("view") === "tabule", "přepnutí na Tabuli");
  expect((await page.getByRole("button", { name: "Tabule" }).getAttribute("aria-pressed")) === "true", "Tabule aktivní");
  const columns = async () => page.locator("main section[aria-label]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter((l) => /\(\d+\)$/.test(l)));
  await expectCountsMatchDb(page, async () => {
    const cols = await columns();
    const expected = SEGMENTS.objednavky.map((s) => `${STAGE_LABELS[s]} (${dbSegmentCount("objednavky", s)})`);
    expect(JSON.stringify(cols) === JSON.stringify(expected), `sloupce ${cols.join(" | ")} ≠ ${expected.join(" | ")}`);
  });
  const col = page.locator(`main section[aria-label^="Ve výrobě ("]`);
  expect((await col.getByRole("link", { name: `Otevřít zakázku ${F1.number}` }).count()) === 1, "F1 je ve sloupci Ve výrobě");
  expect((await col.getByRole("link", { name: `Otevřít zakázku ${L2.number}` }).count()) === 1, "L2 (dílčí dodávka) je ve sloupci Ve výrobě");
  expect((await page.locator("main").getByRole("link", { name: `Otevřít zakázku ${L1.number}` }).count()) === 0, "L1 (dodáno vše) na tabuli Objednávek není");
  await shot(page, S("08-board-objednavky"));
  // 31. 10.: Dokončené — sloupce Dodáno zákazníkovi / Vyfakturováno / Dokončeno + Montáž pro L1 (stav se neposunul)
  await page.goto(`${BASE}/orders?segment=dokoncene&view=tabule`);
  await bookIdle(page);
  await expectCountsMatchDb(page, async () => {
    const done = await columns();
    const lag = sql(`select coalesce(string_agg(distinct status::text, ','), '') from orders where ${segmentWhere("dokoncene")} and status::text not in ('dodano_zakaznikovi','fakturovano','dokonceno')`).split(",").filter(Boolean);
    const stages = Object.keys(STAGE_LABELS).filter((s) => SEGMENTS.dokoncene.includes(s) || lag.includes(s));
    const expected = stages.map((s) => `${STAGE_LABELS[s]} (${dbSegmentCount("dokoncene", s)})`);
    expect(JSON.stringify(done) === JSON.stringify(expected), `Dokončené: sloupce ${done.join(" | ")} ≠ ${expected.join(" | ")}`);
  });
  expect((await page.locator(`main section[aria-label^="Montáž ("]`).getByRole("link", { name: `Otevřít zakázku ${L1.number}` }).count()) === 1, "Dokončené: L1 ve sloupci Montáž");
  expect((await page.locator(`main section[aria-label^="Vyfakturováno ("]`).getByRole("link", { name: `Otevřít zakázku ${F2.number}` }).count()) === 1, "Dokončené: F2 ve sloupci Vyfakturováno");
  // jiný segment / vybraný stav
  await page.goto(`${BASE}/orders?segment=poptavky&view=tabule`);
  await bookIdle(page);
  let cols = await columns();
  expect(cols.length === 3 && cols[0].startsWith("Poptávka (") && cols[2].startsWith("Nabídka odeslaná ("), `Poptávky: 3 sloupce (${cols.join(" | ")})`);
  await page.goto(`${BASE}/orders?stages=ve_vyrobe&view=tabule`);
  await bookIdle(page);
  cols = await columns();
  expect(cols.length === 1 && cols[0].startsWith("Ve výrobě ("), `vybraný stav = 1 sloupec (${cols.join(" | ")})`);
});

await T("kniha: URL parametry (segment, stages, q, sort, dir, deadline, view) a neplatné hodnoty", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin, `?segment=poptavky&stages=poptavka&q=${encodeURIComponent(F3.number)}&sort=number&dir=asc`);
  expect((await segLink(page, "Poptávky").getAttribute("aria-current")) === "page", "segment z URL");
  expect((await chip(page, "Poptávka").getAttribute("aria-current")) === "true", "chip z URL");
  expect((await search(page).inputValue()) === F3.number, "hledání z URL");
  expect((await page.getByLabel("Řazení", { exact: true }).inputValue()) === "number", "řazení z URL");
  expect((await page.getByRole("button", { name: /^Směr řazení/ }).getAttribute("aria-label")).includes("vzestupně"), "směr z URL");
  const n = numbersOf(await readRows(page));
  expect(n.length === 1 && n[0] === F3.number, `výsledek = F3 (${n.join(",")})`);
  // stav mimo segment se ignoruje, neplatné hodnoty = výchozí
  await page.goto(`${BASE}/orders?segment=nesmysl&stages=poptavka,xyz&sort=foo&dir=bar&deadline=zitra&view=mapa&owner=neni-uuid`);
  await bookIdle(page);
  expect((await segLink(page, "Objednávky").getAttribute("aria-current")) === "page", "neplatný segment → Objednávky");
  expect((await page.getByLabel("Řazení", { exact: true }).inputValue()) === "created", "neplatné řazení → Nejnovější");
  expect((await page.getByLabel("Termín", { exact: true }).inputValue()) === "", "neplatný termín → vše");
  expect((await page.getByRole("button", { name: "Řádky" }).getAttribute("aria-pressed")) === "true", "neplatný pohled → Řádky");
  await expectCountsMatchDb(page, async () => {
    expect((await readRows(page)).length === dbSegmentCount("objednavky"), "poptávka mimo segment nefiltruje — celý segment");
  });
  // deadline z URL
  await page.goto(`${BASE}/orders?segment=vse&deadline=overdue`);
  await bookIdle(page);
  expect((await page.getByLabel("Termín", { exact: true }).inputValue()) === "overdue", "deadline z URL");
  expect(numbersOf(await readRows(page)).includes(F1.number), "deadline=overdue → F1");
});

await T("kniha: ?new=1 otevře Novou zakázku a parametr zmizí z adresy", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin, "?new=1&segment=poptavky");
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10_000 });
  expect(await dlg.getByRole("heading", { name: "Nová zakázka" }).isVisible(), "dialog Nová zakázka otevřen");
  await page.waitForURL((u) => !u.searchParams.has("new"), { timeout: 10_000 });
  expect(new URL(page.url()).searchParams.get("segment") === "poptavky", "ostatní parametry zůstaly");
  expect((await dlg.getByRole("button", { name: /^Stav: / }).getAttribute("aria-label")) === "Stav: Poptávka — změnit", "výchozí stav podle záložky = Poptávka");
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "hidden", timeout: 5_000 });
});

// ═════════════════════════ NOVÁ ZAKÁZKA ═════════════════════════

async function openNewJob(page) {
  await page.getByRole("button", { name: "Nová zakázka", exact: true }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Nová zakázka" }).waitFor({ timeout: 10_000 });
  return dlg;
}

await T("nová zakázka: validace česky (název, zákazník, množství, cena, termíny), nic se neuloží", async (context) => {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await openBook(page, USERS.admin);
  const before = sql(`select count(*) from orders`);
  const dlg = await openNewJob(page);
  await dlg.getByRole("button", { name: "Založit zakázku" }).click();
  await dlg.getByText("Něco chybí nebo nesedí — zkontroluj červeně označená pole.").waitFor({ timeout: 5_000 });
  expect(await dlg.getByText("Napiš název zakázky (nebo vyplň aspoň jednu položku).").isVisible(), "chyba názvu");
  expect(await dlg.getByText("Vyber zákazníka, nebo založ nového.").isVisible(), "chyba zákazníka");
  expect((await dlg.getByLabel("Název zakázky").getAttribute("aria-invalid")) === "true", "pole Název zakázky označené");
  await shot(page, S("10-new-validation"));

  await dlg.getByLabel("Název zakázky").fill(`${PREFIX}validace ${TAG}`);
  await dlg.getByRole("button", { name: "Nový", exact: true }).click();
  await dlg.getByLabel("Název nového zákazníka").fill("X");
  await dlg.getByRole("button", { name: "Přidat položku" }).click();
  await dlg.getByLabel("Množství", { exact: true }).fill("abc");
  await dlg.getByLabel("Cena / MJ", { exact: true }).fill("-5");
  await dlg.getByLabel("Potvrzený termín zákazníkovi").fill("2026-12-10");
  await dlg.getByLabel("Max. tolerovaný termín").fill("2026-12-01");
  await dlg.getByRole("button", { name: "Založit zakázku" }).click();
  for (const msg of [
    "Název zákazníka je moc krátký.",
    "Množství musí být číslo větší než 0.",
    "Cena musí být kladné číslo (nebo nech prázdné).",
    "Max. tolerovaný termín nemůže být dřív než termín pro zákazníka.",
  ]) {
    await dlg.getByText(msg).waitFor({ timeout: 5_000 }).catch(() => { throw new Error(`chybí hláška „${msg}"`); });
  }
  expect(!(await dlg.getByText("Napiš název zakázky").isVisible()), "chyba názvu zmizela po vyplnění");
  await shot(page, S("10-new-validation-2"));
  expect(sql(`select count(*) from orders where title = ${lit(`${PREFIX}validace ${TAG}`)}`) === "0", "nic se neuložilo");
  // zavření rozepsaného formuláře se ptá (confirm přijat)
  await dlg.getByRole("button", { name: "Zrušit", exact: true }).click();
  await dlg.waitFor({ state: "hidden", timeout: 5_000 });
  expect(Number(sql(`select count(*) from orders`)) >= Number(before), "sanity");
});

let NEWJOB = null;
await T("nová zakázka: obchodník vyplní vše (zákazník, čísla, 7 termínů, lidé, položky s nákupem) → detail Z-RRRR-NNN, DB", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.obchod);
  const dlg = await openNewJob(page);
  const title = `${PREFIX}Nová ${TAG}`;
  await dlg.getByLabel("Název zakázky").fill(title);
  expect((await dlg.getByRole("button", { name: /^Stav: / }).getAttribute("aria-label")) === "Stav: Objednávka — změnit", "výchozí stav v Objednávkách = Objednávka");
  await dlg.getByRole("radiogroup", { name: "Priorita" }).getByRole("radio", { name: "Vysoká" }).click();
  // zákazník z adresáře hledáním
  const cust = dlg.getByRole("combobox", { name: /Zákazník/ });
  await cust.click();
  await cust.fill(`kovo ${tagLc}`);
  const opt = page.getByRole("option", { name: new RegExp(CUST.name) });
  expect((await opt.innerText()).includes(CUST.number), `nabídka zákazníka ukazuje naše číslo ${CUST.number}`);
  await opt.click();
  expect((await cust.inputValue()) === CUST.name, "zákazník vybrán");
  await dlg.getByLabel("Číslo objednávky zákazníka").fill(`E2EB-NEW-PO-${TAG}`);
  await dlg.getByLabel("Číslo poptávky zákazníka").fill(`E2EB-NEW-RFQ-${TAG}`);
  const dates = {
    "Datum poptávky": "2026-10-01", "Datum objednávky": "2026-10-10", "Požadovaný termín zákazníkem": "2026-12-01",
    "Potvrzený termín zákazníkovi": "2026-12-05", "Předpokládaný termín dodání": "2026-11-28",
    "Slíbený termín dodavatele": "2026-11-20", "Max. tolerovaný termín": "2026-12-12",
  };
  for (const [label, v] of Object.entries(dates)) await dlg.getByLabel(label, { exact: true }).fill(v);
  // lidé
  // #25: obchodníka zakázky volí jen super admin — obchodníkovi ho doplní server (obchodník zákazníka)
  const ownerRo = dlg.locator('[data-field="owner-readonly"]');
  expect((await dlg.getByLabel("Obchodník", { exact: true }).count()) === 0, "obchodník nemá výběr Obchodníka");
  const ownerRoText = (await ownerRo.innerText()).replace(/\s+/g, " ");
  // vybraný zákazník má obchodníka → pole ho jmenuje (server ho dosadí sám)
  const custOwnerName = sql(`select coalesce(nullif(trim(full_name), ''), email) from profiles where id = ${lit(ID.obchod)}`).trim();
  expect(ownerRoText.includes(`${custOwnerName} (obchodník zákazníka)`) && ownerRoText.includes("Obchodníka zakázky mění jen super admin."), `Obchodník jen pro čtení (${ownerRoText})`);
  await dlg.getByLabel("Zpracovává", { exact: true }).selectOption(ID.dilna);
  // položky (2)
  await dlg.getByRole("button", { name: /Přidat první položku/ }).click();
  const fillItem = async (i, v) => {
    await dlg.getByLabel("Č. výkresu", { exact: true }).nth(i).fill(v.drawing);
    await dlg.getByLabel("Rev.", { exact: true }).nth(i).fill(v.rev);
    await dlg.getByLabel("Název", { exact: true }).nth(i).fill(v.name);
    await dlg.getByLabel("Materiál", { exact: true }).nth(i).fill(v.material);
    await dlg.getByLabel("Množství", { exact: true }).nth(i).fill(v.qty);
    await dlg.getByLabel("MJ", { exact: true }).nth(i).fill(v.unit);
    await dlg.getByLabel("Cena / MJ", { exact: true }).nth(i).fill(v.price);
    await dlg.getByLabel("Nákup / MJ", { exact: true }).nth(i).fill(v.purchase);
  };
  await fillItem(0, { drawing: `E2EB-NEW1-${TAG}`, rev: "B", name: "Příruba E2E", material: "AL 7075", qty: "10", unit: "ks", price: "1 250,50", purchase: "800" });
  await dlg.getByRole("button", { name: "Další položka" }).click();
  await fillItem(1, { drawing: `E2EB-NEW2-${TAG}`, rev: "A", name: "Čep E2E", material: "1.7225", qty: "2,5", unit: "kg", price: "100", purchase: "40" });
  const footer = await dlg.locator("form > div").last().innerText();
  // 10 × 1250,50 + 2,5 × 100 = 12 755; nákup 8 000 + 100 = 8 100; marže 36 %
  expect(/12\s755/.test(footer) && /8\s100/.test(footer) && /36\s%/.test(footer), `součty v patičce: ${footer.replace(/\n/g, " ")}`);
  await shot(page, S("11-new-filled"));
  await dlg.getByRole("button", { name: "Založit zakázku" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const id = new URL(page.url()).pathname.split("/").pop();
  const header = page.locator('main section[aria-label="Zakázka"]');
  await header.waitFor();
  const num = (await header.locator("span.font-mono").first().innerText()).trim();
  expect(/^Z-2026-\d{3,}$/.test(num), `číslo zakázky Z-RRRR-NNN, je „${num}"`);
  NEWJOB = { id, number: num };
  await shot(page, S("11-new-detail"));

  const row = sql(`select number, title, status, priority, customer_id, customer_order_number, customer_inquiry_number,
    inquiry_date, order_date, customer_required_date, due_date, expected_delivery_date, supplier_promised_date, max_tolerated_date,
    owner_id, assignee_id, created_by, value, purchase_cost, source from orders where id = ${lit(id)}`).split("|");
  const exp = [num, title, "objednavka", "vysoka", CUST.id, `E2EB-NEW-PO-${TAG}`, `E2EB-NEW-RFQ-${TAG}`,
    "2026-10-01", "2026-10-10", "2026-12-01", "2026-12-05", "2026-11-28", "2026-11-20", "2026-12-12",
    ID.obchod, ID.dilna, ID.obchod, "12755.00", "8100.00", "manual"];
  const names = ["number", "title", "status", "priority", "customer_id", "cpo", "cinq", "inquiry", "order", "required", "due", "expected", "supplier", "max", "owner", "assignee", "created_by", "value", "purchase_cost", "source"];
  const diff = names.filter((n, i) => String(row[i]).replace(/\.0+$/, "") !== String(exp[i]).replace(/\.0+$/, "")).map((n) => `${n}: ${row[names.indexOf(n)]} ≠ ${exp[names.indexOf(n)]}`);
  expect(diff.length === 0, `řádek v DB: ${diff.join("; ")}`);
  const items = sql(`select position || ':' || drawing_number || ':' || revision || ':' || name || ':' || material || ':' || quantity || ':' || unit || ':' || unit_price || ':' || purchase_unit_price from order_items where order_id = ${lit(id)} order by position`).split("\n");
  expect(items.length === 2, `2 položky, je ${items.length}`);
  expect(/^0:E2EB-NEW1-.*:B:Příruba E2E:AL 7075:10(\.0+)?:ks:1250\.5\d*:800(\.0+)?$/.test(items[0]), `položka 1: ${items[0]}`);
  expect(/^1:E2EB-NEW2-.*:A:Čep E2E:1\.7225:2\.50*:kg:100(\.0+)?:40(\.0+)?$/.test(items[1]), `položka 2: ${items[1]}`);
  const ev = sql(`select type || ':' || coalesce(actor_id::text,'-') from job_events where job_id = ${lit(id)} order by created_at`);
  expect(ev === `created:${ID.obchod}`, `historie: založil obchodník (${ev})`);
});

await T("nová zakázka: nový zákazník z hledání se založí (s naším číslem), nápověda u existujícího názvu", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.admin);
  const dlg = await openNewJob(page);
  await dlg.getByLabel("Název zakázky").fill(`${PREFIX}Nový zákazník ${TAG}`);
  // existující název v režimu „Nový" → nápověda Použít
  await dlg.getByRole("button", { name: "Nový", exact: true }).click();
  await dlg.getByLabel("Název nového zákazníka").fill("strojmetal A.S.");
  await dlg.getByText("Tohoto zákazníka už máme:").waitFor({ timeout: 5_000 });
  expect(await dlg.getByRole("button", { name: "Použít" }).isVisible(), "tlačítko Použít");
  // zpět do adresáře a „+ Nový zákazník …" z hledání
  await dlg.getByRole("button", { name: "Z adresáře" }).click();
  const newName = `${PREFIX}Zákazník ${TAG} a.s.`;
  const cust = dlg.getByRole("combobox", { name: /Zákazník/ });
  await cust.click();
  await cust.fill(newName);
  await page.getByRole("option", { name: `Nový zákazník „${newName}"` }).click();
  expect((await dlg.getByLabel("Název nového zákazníka").inputValue()) === newName, "přepnuto na nového zákazníka s názvem");
  await dlg.getByRole("button", { name: "Založit zakázku" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const id = new URL(page.url()).pathname.split("/").pop();
  const c = sql(`select c.name || '|' || coalesce(c.customer_number,'') || '|' || coalesce(c.owner_id::text,'') from orders o join customers c on c.id = o.customer_id where o.id = ${lit(id)}`).split("|");
  expect(c[0] === newName, `zákazník založen: ${c[0]}`);
  expect(/^ZK\d+$/.test(c[1]), `zákazník dostal naše číslo (${c[1]})`);
  expect(c[2] === ID.admin, "vlastník zákazníka = obchodník zakázky (admin)");
  expect((await page.locator('main section[aria-label="Zakázka"]').innerText()).includes(`zák. č. ${c[1]}`), "hlavička ukazuje číslo nového zákazníka");
  expect(sql(`select (data->>'customerCreated') from job_events where job_id = ${lit(id)} and type = 'created'`) === "true", "historie: zákazník založen");
});

await T("nová zakázka: zaměstnanec nevidí pole nákupní ceny", async (context) => {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await openBook(page, USERS.dilna);
  const dlg = await openNewJob(page);
  await dlg.getByRole("button", { name: /Přidat první položku/ }).click();
  expect((await dlg.getByLabel("Cena / MJ", { exact: true }).count()) === 1, "pole Cena / MJ je");
  expect((await dlg.getByLabel("Nákup / MJ", { exact: true }).count()) === 0, "pole Nákup / MJ chybí");
  expect(await dlg.getByText("Díly / výkresy a počty kusů.").isVisible(), "nápověda bez cen");
  await shot(page, S("12-new-dilna"));
  await dlg.getByRole("button", { name: "Zrušit", exact: true }).click();
  await dlg.waitFor({ state: "hidden", timeout: 5_000 });
});

// ═════════════════════════ KARTA ZAKÁZKY ═════════════════════════

async function openJob(page, user, job, query = "") {
  await login(page, user);
  await page.goto(`${BASE}/orders/${job.id}${query}`);
  await detailReady(page);
}
async function detailReady(page) {
  await page.locator('main section[aria-label="Zakázka"]').waitFor({ timeout: 15_000 });
  await waitHydrated(page, 'main section[aria-label="Zakázka"] button[aria-label^="Stav zakázky:"]');
}
const header = (page) => page.locator('main section[aria-label="Zakázka"]');
const tabSel = async (page) => (await page.getByRole("tab", { selected: true }).innerText()).split("\n")[0].trim();
async function openTab(page, name) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await eventually(async () => expect((await tabSel(page)) === name, `záložka ${name} vybraná`));
}
/** Položka historie s textem (nejnovější nahoře). */
const historyItem = (page, text) => page.locator('main [role=tabpanel][data-state=active] ol > li').filter({ hasText: text }).first();

await T("detail: hlavička (číslo, zákazník + č. zákazníka, obj. zákazníka, stav, priorita, další krok) a časová osa", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D1);
  const h = header(page);
  const t = await h.innerText();
  for (const s of [D1.number, `${PREFIX}D1 stav ${TAG}`, CUST.name, `zák. č. ${CUST.number}`, `E2EB-D1-PO-${TAG}`, "Petr Obchodník"]) {
    expect(t.includes(s), `hlavička obsahuje „${s}"`);
  }
  expect((await h.getByRole("link", { name: CUST.name }).getAttribute("href")) === `/customers/${CUST.id}`, "zákazník je odkaz na kartu");
  expect(await h.getByRole("button", { name: "Stav zakázky: Objednávka — změnit" }).isVisible(), "stav Objednávka");
  // další krok je sloveso (nextAction), ne název stavu; „Posunout" už neexistuje
  expect(await h.getByRole("button", { name: "Potvrdit objednávku" }).isVisible(), "další krok = Potvrdit objednávku");
  expect(!(await h.innerText()).includes("Posunout"), "hlavička bez „Posunout“");
  expect((await h.getByRole("radio", { name: "Střední" }).getAttribute("aria-checked")) === "true", "priorita Střední");
  expect((await page.title()).includes(D1.number), `titulek stránky obsahuje číslo (${await page.title()})`);
  const tl = page.locator('main section[aria-label="Průběh zakázky"]');
  expect((await tl.locator("[aria-current=step]").innerText()).startsWith("Objednávka"), "aktuální krok osy = Objednávka");
  expect((await tl.innerText()).includes("hotovo 4 z 10 kroků"), `osa: hotovo 4 z 10 — dosažený krok se počítá (${(await tl.innerText()).split("\n")[1]})`);
  expect(await page.locator('main section[aria-label="Termíny"]').isVisible(), "panel Termíny");
  await shot(page, S("20-detail-header"));
});

await T("detail: další krok „Potvrdit objednávku“ (obchodník) → DB stav + dílčí stav + autor, Historie se jménem", async (context) => {
  const page = await context.newPage();
  const before = sql(`select stage_changed_at from orders where id = ${lit(D1.id)}`);
  await openJob(page, USERS.obchod, D1);
  await page.waitForTimeout(1100); // ať je nový čas změny jistě větší
  await header(page).getByRole("button", { name: "Potvrdit objednávku" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10_000 });
  const mail = dlg.getByRole("switch", { name: "Poslat potvrzení zákazníkovi e-mailem" });
  if ((await mail.getAttribute("aria-checked")) === "true") await mail.click();
  await dlg.getByRole("button", { name: "Potvrdit objednávku" }).click();
  await header(page).getByRole("button", { name: "Stav zakázky: Potvrzená objednávka — změnit" }).waitFor({ timeout: 20_000 });
  await eventually(async () => {
    const r = sql(`select status || '|' || (stage_changed_at > ${lit(before)}::timestamptz) || '|' || (confirmed_at is not null) || '|' || order_status || '|' || coalesce(order_status_changed_by::text, '-') || '|' || coalesce(stage_changed_by::text, '-') || '|' || coalesce(confirmation_sent_via, '-')
      from orders where id = ${lit(D1.id)}`);
    // bez e-mailu: potvrzeno, ale potvrzení NEODEŠLO (žádný falešný fakt „odesláno")
    expect(r === `potvrzeno|true|true|potvrzena|${ID.obchod}|${ID.obchod}|-`, `DB po potvrzení: ${r}`);
  });
  const ev = sql(`select message || '|' || actor_id || '|' || coalesce(actor_name, '') from job_events where job_id = ${lit(D1.id)} and type = 'stage' order by created_at desc limit 1`);
  expect(ev.startsWith("Stav: Objednávka → Potvrzená objednávka") && ev.endsWith(`|${ID.obchod}|Petr Obchodník`), `událost stavu s autorem: ${ev}`);
  const st = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(D1.id)} and type = 'status' and data->>'field' = 'order_status' order by created_at desc limit 1`);
  expect(st.startsWith("Objednávka: Doručená → Potvrzená") && st.endsWith(`|${ID.obchod}`), `událost dílčího stavu: ${st}`);
  // potvrzená, potvrzení ještě neodešlo → další krok Odeslat potvrzení (chip bez dokladu); autor stavu u hlavičky
  await eventually(async () => expect(await header(page).getByRole("button", { name: "Odeslat potvrzení" }).isVisible(), "další krok = Odeslat potvrzení"));
  expect(await header(page).getByRole("button", { name: /Petr Obchodník.* — podrobnosti$/ }).first().isVisible(), "hlavička: kdo stav změnil (razítko)");
  expect((await page.locator('main section[aria-label="Průběh zakázky"] [aria-current=step]').innerText()).startsWith("Potvrzeno"), "osa: Potvrzeno");
  await openTab(page, "Historie");
  const li = historyItem(page, "Potvrzená objednávka");
  await li.waitFor({ timeout: 10_000 });
  const lt = await li.innerText();
  expect(lt.includes("Petr Obchodník") && lt.includes("Objednávka"), `Historie: kdo a z/do (${lt.replace(/\n/g, " ")})`);
  await shot(page, S("21-detail-history-stage"));
});

await T("detail: StageSelect (zaměstnanec) → Ve výrobě = předání do výroby (kdo + termín), Historie ukáže jméno účtu", async (context) => {
  const page = await context.newPage();
  const before = sql(`select status || '|' || stage_changed_at from orders where id = ${lit(D1.id)}`).split("|");
  await openJob(page, USERS.dilna, D1);
  await page.waitForTimeout(1100);
  await header(page).getByRole("button", { name: /^Stav zakázky: / }).click();
  await page.getByRole("menuitem", { name: /^Ve výrobě/ }).click();
  // přesun do výroby = povinné předání: komu to zadávám a do kdy (WP3)
  const dlg = page.locator('[data-testid="handoff-dialog"]');
  await dlg.locator('[data-testid="handoff-submit"]').waitFor({ timeout: 20_000 });
  expect((await dlg.innerText()).includes("komu to zadáváš a do kdy"), "dialog předání do výroby");
  await dlg.getByRole("button", { name: "U nás" }).first().click();
  const due = sql(`select (current_date + 7)::text`);
  await dlg.locator('input[type="date"]').first().fill(due);
  await dlg.getByLabel("Poznámka k předání (nepovinné)").fill(`E2E korekce ${TAG}`);
  await dlg.locator('[data-testid="handoff-submit"]').click();
  // s upozorněním (např. zakázka bez cen) zůstane výsledek předání otevřený → [Hotovo]
  await eventually(async () => {
    if (await dlg.locator('[data-testid="handoff-result"]').count()) await dlg.getByRole("button", { name: "Hotovo" }).click();
    expect((await dlg.count()) === 0, "dialog předání zavřený");
  });
  await header(page).getByRole("button", { name: "Stav zakázky: Ve výrobě — změnit" }).waitFor({ timeout: 20_000 });
  await eventually(async () => {
    const r = sql(`select status || '|' || (stage_changed_at > ${lit(before[1])}::timestamptz) || '|' || stage_changed_by || '|' || stage_changed_via from orders where id = ${lit(D1.id)}`);
    expect(r === `ve_vyrobe|true|${ID.dilna}|rucne`, `DB po předání: ${r}`);
  });
  const ev = sql(`select message || '|' || actor_id || '|' || actor_name from job_events where job_id = ${lit(D1.id)} and type = 'stage' order by created_at desc limit 1`);
  // změna stavu nese poznámku předání; kdo + termín je v souhrnu předání („Předáno do výroby: 1) … U nás …")
  expect(ev.startsWith(`Stav: ${STAGE_LABELS[before[0]]} → Ve výrobě`) && ev.includes(`E2E korekce ${TAG}`) && ev.endsWith(`|${ID.dilna}|Jana Zaměstnanec`), `událost: ${ev}`);
  const ho = sql(`select message || '|' || actor_id from job_events where job_id = ${lit(D1.id)} and message like 'Předáno do výroby:%' order by created_at desc limit 1`);
  expect(ho.includes("U nás") && ho.endsWith(`|${ID.dilna}`), `souhrn předání (kdo + termín) se jménem: ${ho}`);
  await openTab(page, "Historie");
  // předání zapíše víc událostí (stav, souhrn předání, start kroku) — změna stavu je jedna z nich
  const li = page.locator('main [role=tabpanel][data-state=active] ol > li').filter({ hasText: "Jana Zaměstnanec" }).filter({ hasText: "Ve výrobě" }).first();
  await li.waitFor({ timeout: 10_000 });
  expect((await li.innerText()).includes("Ve výrobě"), "Historie: Jana → Ve výrobě");
});

await T("detail: inline úpravy (název, č. obj. zákazníka, termín, zpracovává, priorita) → DB, Historie kdo/co; Esc nic neuloží", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.admin, D2);
  const h = header(page);
  const newTitle = `${PREFIX}D2 přejmenováno ${TAG}`;
  // název — Esc zruší
  await h.getByRole("button", { name: /^Název zakázky: / }).click();
  await page.locator(":focus").fill("tohle se neuloží");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  expect(sql(`select title from orders where id = ${lit(D2.id)}`) === `${PREFIX}D2 úpravy ${TAG}`, "Esc: název beze změny");
  // název — Enter uloží
  await h.getByRole("button", { name: /^Název zakázky: / }).click();
  await page.locator(":focus").fill(newTitle);
  await page.keyboard.press("Enter");
  await eventually(async () => expect(sql(`select title from orders where id = ${lit(D2.id)}`) === newTitle, "DB: nový název"));
  // číslo objednávky zákazníka (Přehled)
  await page.getByRole("button", { name: /^Č\. objednávky zákazníka: / }).click();
  await page.locator(":focus").fill(`E2EB-D2-PO2-${TAG}`);
  await page.keyboard.press("Enter");
  await eventually(async () => expect(sql(`select customer_order_number from orders where id = ${lit(D2.id)}`) === `E2EB-D2-PO2-${TAG}`, "DB: č. obj. zákazníka"));
  // potvrzený termín (panel Termíny)
  await page.locator('main section[aria-label="Termíny"]').getByRole("button", { name: /^Potvrzený termín: / }).click();
  await page.locator(":focus").fill("2026-12-24");
  await page.keyboard.press("Enter");
  await eventually(async () => expect(sql(`select due_date from orders where id = ${lit(D2.id)}`) === "2026-12-24", "DB: potvrzený termín"));
  // zpracovává
  await page.getByLabel("Zpracovává", { exact: true }).selectOption(ID.dilna);
  await eventually(async () => expect(sql(`select assignee_id from orders where id = ${lit(D2.id)}`) === ID.dilna, "DB: zpracovává Jana"));
  // priorita
  await h.getByRole("radio", { name: "Vysoká" }).click();
  await eventually(async () => expect(sql(`select priority from orders where id = ${lit(D2.id)}`) === "vysoka", "DB: priorita vysoká"));
  await page.waitForTimeout(800);
  // všechny změny s autorem v DB
  const evs = sql(`select data->'changes'->0->>'field' || '|' || actor_id from job_events where job_id = ${lit(D2.id)} and type = 'field' order by created_at`).split("\n");
  for (const f of ["title", "customer_order_number", "due_date", "assignee_id", "priority"]) {
    expect(evs.includes(`${f}|${ID.admin}`), `událost změny ${f} od super admina (${evs.join(", ")})`);
  }
  await shot(page, S("22-detail-inline"));
  await openTab(page, "Historie");
  for (const [label, to] of [["Název zakázky", newTitle], ["Číslo objednávky zákazníka", `E2EB-D2-PO2-${TAG}`], ["Potvrzený termín zákazníkovi", "24"], ["Zpracovává", "Jana Zaměstnanec"], ["Priorita", "Vysoká"]]) {
    const li = historyItem(page, `${label}:`);
    await li.waitFor({ timeout: 10_000 }).catch(() => { throw new Error(`Historie: chybí změna „${label}"`); });
    const lt = await li.innerText();
    expect(lt.includes("Super Admin") && lt.includes(to), `Historie „${label}": kdo + nová hodnota (${lt.replace(/\n/g, " ")})`);
  }
  await shot(page, S("22-detail-history-fields"));
});

await T("detail: štítky — přidat Enterem i čárkou, odebrat ×, DB + Historie", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D2);
  const input = page.getByLabel("Nový štítek");
  await input.fill("expres");
  await input.press("Enter");
  await eventually(async () => expect(sql(`select array_to_string(tags, ',') from orders where id = ${lit(D2.id)}`) === "expres", "DB: štítek expres"));
  await input.fill("kalení");
  await input.press(",");
  await eventually(async () => expect(sql(`select array_to_string(tags, ',') from orders where id = ${lit(D2.id)}`) === "expres,kalení", "DB: expres,kalení"));
  // duplicitní štítek se nepřidá
  await input.fill("Expres");
  await input.press("Enter");
  await page.waitForTimeout(800);
  expect(sql(`select array_length(tags, 1) from orders where id = ${lit(D2.id)}`) === "2", "duplicitní štítek (jiná velikost písmen) se nepřidal");
  await shot(page, S("23-detail-tags"));
  await page.getByRole("button", { name: "Odebrat štítek expres" }).click();
  await eventually(async () => expect(sql(`select array_to_string(tags, ',') from orders where id = ${lit(D2.id)}`) === "kalení", "DB: zbyl kalení"));
  const ev = sql(`select count(*) from job_events where job_id = ${lit(D2.id)} and type = 'field' and data->'changes'->0->>'field' = 'tags' and actor_id = ${lit(ID.obchod)}`);
  expect(Number(ev) >= 3, `historie štítků od obchodníka (${ev})`);
});

await T("detail: položky — přidat, upravit, přesunout, smazat, součty, uložit (DB + hodnota zakázky)", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D3, "?tab=polozky");
  expect((await tabSel(page)) === "Položky", "?tab=polozky otevře Položky");
  const table = page.locator('main [role=tabpanel][data-state=active] table');
  await table.waitFor();
  const rowsLoc = table.locator("tbody tr");
  const cell = (i, label) => rowsLoc.nth(i).getByLabel(label, { exact: true });
  expect((await rowsLoc.count()) === 1, "1 položka");
  expect((await table.locator("thead").innerText()).includes("Nákup / MJ"), "obchodník vidí sloupec Nákup / MJ");
  // přidat 2. položku
  await page.locator("main [role=tabpanel][data-state=active]").getByRole("button", { name: "Přidat položku" }).click();
  await cell(1, "Číslo výkresu").fill(`E2EB-IT2-${TAG}`);
  await cell(1, "Název").fill("Druhá položka");
  await cell(1, "Množství").fill("3");
  await cell(1, "Cena za MJ").fill("100");
  await cell(1, "Nákupní cena za MJ").fill("60");
  const totals = async () => (await page.locator("main [role=tabpanel][data-state=active] dl").innerText()).replace(/\s+/g, " ");
  // 2 × 1500 + 3 × 100 = 3 300; nákup 2 × 777,77 + 3 × 60 = 1 735,54; marže 47,4 %
  await eventually(async () => {
    const t = await totals();
    expect(/Celkem bez DPH 3\s300/.test(t) && /Nákup celkem 1\s735,54/.test(t) && /Kusů celkem 5/.test(t), `součty: ${t}`);
  });
  // neplatné číslo zčervená
  await cell(1, "Množství").fill("x");
  expect((await cell(1, "Množství").getAttribute("class")).includes("border-red-400"), "neplatné množství zčervená");
  await cell(1, "Množství").fill("3");
  // přesun nahoru
  await rowsLoc.nth(1).getByRole("button", { name: "Posunout nahoru" }).click();
  expect((await cell(0, "Číslo výkresu").inputValue()) === `E2EB-IT2-${TAG}`, "položka 2 je nahoře");
  // 3. položka a její smazání
  await page.locator("main [role=tabpanel][data-state=active]").getByRole("button", { name: "Přidat položku" }).click();
  await cell(2, "Název").fill("Smazat mě");
  await rowsLoc.nth(2).getByRole("button", { name: "Odebrat položku" }).click();
  expect((await rowsLoc.count()) === 2, "3. položka odebrána");
  // tečka neuložených změn na záložce
  expect((await page.getByRole("tab", { name: /^Položky/ }).locator('[title="Neuložené změny"]').count()) === 1, "záložka ukazuje neuložené změny");
  await shot(page, S("24-detail-items-dirty"));
  await page.getByRole("button", { name: "Uložit položky" }).click();
  await page.getByText("Položky uloženy (2).").waitFor({ timeout: 10_000 });
  await eventually(async () => {
    const items = sql(`select position || ':' || coalesce(drawing_number,'') || ':' || quantity::float || ':' || coalesce(unit_price::float::text,'') || ':' || coalesce(purchase_unit_price::float::text,'') from order_items where order_id = ${lit(D3.id)} order by position`).split("\n");
    expect(items.length === 2 && items[0] === `0:E2EB-IT2-${TAG}:3:100:60` && items[1] === `1:E2EB-D3-DWG-${TAG}:2:1500:777.77`, `DB položky: ${items.join(" ; ")}`);
    const money = sql(`select value::float || '|' || purchase_cost::float from orders where id = ${lit(D3.id)}`);
    expect(money === "3300|1735.54", `DB hodnota|nákup = ${money}`);
  });
  // úprava množství a smazání položky
  await page.getByRole("button", { name: "Uložit položky" }).waitFor({ state: "hidden", timeout: 10_000 });
  await cell(1, "Množství").fill("4");
  await rowsLoc.nth(0).getByRole("button", { name: "Odebrat položku" }).click();
  await page.getByRole("button", { name: "Uložit položky" }).click();
  await page.getByText("Položky uloženy (1).").waitFor({ timeout: 10_000 });
  await eventually(async () => {
    const items = sql(`select drawing_number || ':' || quantity::float from order_items where order_id = ${lit(D3.id)}`);
    expect(items === `E2EB-D3-DWG-${TAG}:4`, `DB: 1 položka × 4 (${items})`);
    expect(sql(`select value::float from orders where id = ${lit(D3.id)}`) === "6000", "DB hodnota 4 × 1500 = 6000");
  });
  await page.waitForTimeout(800);
  const h = await header(page).innerText();
  expect(/6\s000/.test(h), "hlavička: hodnota 6 000 Kč");
  const ev = sql(`select count(*) from job_events where job_id = ${lit(D3.id)} and message like 'Položky upraveny%' and actor_id = ${lit(ID.obchod)}`);
  expect(ev === "2", `historie: 2× Položky upraveny od obchodníka (${ev})`);
  await shot(page, S("24-detail-items-saved"));
});

await T("detail: záložky a ?tab= (Nákup & marže jen s právem marží)", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D5, "?tab=nakup");
  let tabs = (await page.getByRole("tab").allInnerTexts()).map((t) => t.split("\n")[0]);
  // „Výroba" se jmenuje „Technologie" (majitel 29. 10.); „Komunikace" (Pošta B) jen když je nasazená
  const expectedTabs = ["Přehled", "Technologie", "Položky", "Nabídky", "Nákup & marže", "Dokumenty", ...(tabs.includes("Komunikace") ? ["Komunikace"] : []), "Historie"];
  expect(JSON.stringify(tabs) === JSON.stringify(expectedTabs), `záložky obchodníka: ${tabs.join(", ")}`);
  expect((await tabSel(page)) === "Nákup & marže", "?tab=nakup → Nákup & marže");
  await shot(page, S("25-detail-tab-nakup"));
  await page.goto(`${BASE}/orders/${D5.id}?tab=historie`);
  await detailReady(page);
  await eventually(async () => expect((await tabSel(page)) === "Historie", "?tab=historie → Historie"));
  await openTab(page, "Položky");
  expect(new URL(page.url()).searchParams.get("tab") === "polozky", "přepnutí záložky zapíše ?tab=polozky");
  await openTab(page, "Přehled");
  expect(!new URL(page.url()).searchParams.has("tab"), "Přehled = bez ?tab");
  await context.clearCookies();

  const p2 = await context.newPage();
  await openJob(p2, USERS.dilna, D5, "?tab=nakup");
  tabs = (await p2.getByRole("tab").allInnerTexts()).map((t) => t.split("\n")[0]);
  expect(!tabs.includes("Nákup & marže"), `zaměstnanec nemá Nákup & marže (${tabs.join(", ")})`);
  expect((await tabSel(p2)) === "Přehled", "?tab=nakup bez práva → Přehled");
  await p2.goto(`${BASE}/orders/${D5.id}?tab=vyroba`);
  await detailReady(p2);
  await eventually(async () => expect((await tabSel(p2)) === "Technologie", "?tab=vyroba → Technologie"));
  await p2.goto(`${BASE}/orders/${D5.id}?tab=nesmysl`);
  await detailReady(p2);
  await eventually(async () => expect((await tabSel(p2)) === "Přehled", "neplatná záložka → Přehled"));
});

await T("detail: komentář v Historii (jméno autora, DB), prázdný nejde odeslat", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.dilna, D4, "?tab=historie");
  const btn = page.getByRole("button", { name: "Přidat komentář" });
  expect(await btn.isDisabled(), "prázdný komentář nejde odeslat");
  const text = `E2E komentář ${TAG}: materiál dorazí ve čtvrtek.`;
  await page.locator("#job-comment").fill(text);
  await btn.click();
  const li = historyItem(page, text);
  await li.waitFor({ timeout: 10_000 });
  expect((await li.innerText()).includes("Jana Zaměstnanec"), "komentář s jménem autorky");
  expect((await page.locator("#job-comment").inputValue()) === "", "pole po odeslání prázdné");
  expect(sql(`select actor_id from job_events where job_id = ${lit(D4.id)} and type = 'comment' and message = ${lit(text)}`) === ID.dilna, "DB: komentář od Jany");
  await shot(page, S("26-detail-comment"));
});

const PDF = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

await T("detail: nahrání dokumentu → v1, stejný název = v2 a archivace v1; /api/jobs/files/<id> 302 → 200, bez přihlášení 401", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D4);
  const fname = `e2e-book-vykres-${tagLc}.pdf`;
  const fileInput = page.locator("main input[type=file][multiple]").first();
  await fileInput.setInputFiles({ name: fname, mimeType: "application/pdf", buffer: PDF("v1") });
  await eventually(async () => expect(sql(`select count(*) from job_files where job_id = ${lit(D4.id)}`) === "1", "DB: 1 soubor"), { timeout: 20_000 });
  const v1 = sql(`select id || '|' || version || '|' || (case when archived then 't' else 'f' end) || '|' || uploaded_by || '|' || kind from job_files where job_id = ${lit(D4.id)}`).split("|");
  expect(v1[1] === "1" && v1[2] === "f" && v1[3] === ID.obchod, `v1: verze 1, aktivní, nahrál obchodník (${v1.join(",")})`);
  // bez obnovení stránky: záložka a hlavička ukážou nový dokument
  await eventually(async () => {
    expect((await page.getByRole("tab", { name: /^Dokumenty/ }).innerText()).includes("1"), "záložka Dokumenty: 1 (bez reloadu)");
    expect(/DOKUMENTY\s*1/i.test(await header(page).innerText()), "hlavička: Dokumenty 1");
  });
  // nová verze se stejným názvem
  await page.locator("main input[type=file][multiple]").first().setInputFiles({ name: fname, mimeType: "application/pdf", buffer: PDF("v2") });
  await eventually(async () => expect(sql(`select count(*) from job_files where job_id = ${lit(D4.id)}`) === "2", "DB: 2 záznamy"), { timeout: 20_000 });
  const rows = sql(`select id || '|' || version || '|' || (case when archived then 't' else 'f' end) || '|' || coalesce(replaced_by::text,'') from job_files where job_id = ${lit(D4.id)} order by version`).split("\n").map((r) => r.split("|"));
  expect(rows[0][1] === "1" && rows[0][2] === "t", `v1 archivována (${rows[0].join(",")})`);
  expect(rows[1][1] === "2" && rows[1][2] === "f", `v2 aktivní (${rows[1].join(",")})`);
  expect(rows[0][3] === rows[1][0], "v1.replaced_by = v2");
  const v2id = rows[1][0];
  await page.reload();
  await detailReady(page);
  await openTab(page, "Dokumenty");
  const panel = page.locator("main [role=tabpanel][data-state=active]");
  await panel.getByText(fname).first().waitFor();
  expect((await panel.innerText()).includes("v2"), "Dokumenty ukazují v2");
  await panel.getByRole("button", { name: /Zobrazit archiv \(1\)/ }).click();
  await eventually(async () => expect((await panel.innerText()).includes("v1"), "v archivu je v1"));
  await shot(page, S("27-detail-documents"));
  // historie
  expect(sql(`select count(*) from job_events where job_id = ${lit(D4.id)} and type = 'file' and actor_id = ${lit(ID.obchod)} and message like ${lit(`%${fname} (v2)`)}`) === "1", "historie: nahrán dokument v2 obchodníkem");
  // náhled / stažení
  const r = await page.request.get(`${BASE}/api/jobs/files/${v2id}`, { maxRedirects: 0 });
  expect(r.status() === 302, `náhled = 302, je ${r.status()}`);
  const loc = r.headers()["location"] ?? "";
  expect(loc.includes("/storage/v1/object/sign/job-files/"), `přesměrování na podepsanou URL (${loc.slice(0, 80)})`);
  const f = await page.request.get(loc);
  expect(f.status() === 200, `soubor = 200, je ${f.status()}`);
  const body = (await f.body()).toString("utf8");
  expect(body.startsWith("%PDF") && body.includes("% v2"), "stažený obsah = v2");
  const d = await page.request.get(`${BASE}/api/jobs/files/${v2id}?download=1`, { maxRedirects: 0 });
  expect(d.status() === 302 && (d.headers()["location"] ?? "").includes("download="), `stažení = 302 s download (${d.status()})`);
  const old = await page.request.get(`${BASE}/api/jobs/files/${rows[0][0]}`, { maxRedirects: 0 });
  expect(old.status() === 302, "archivovaná v1 jde stále otevřít");
  const anon = await browser.newContext();
  const a = await anon.request.get(`${BASE}/api/jobs/files/${v2id}`, { maxRedirects: 0 });
  expect(a.status() === 401, `bez přihlášení 401, je ${a.status()}`);
  await anon.close();
});

await T("mazání: super admin smaže zakázku (potvrzení), DB + audit", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.admin, DELA);
  page.on("request", (req) => {
    const h = req.headers();
    if (req.method() === "POST" && h["next-action"] && (req.postData() ?? "").includes(DELA.id)) {
      deleteAction = { url: req.url(), headers: { ...h }, body: req.postData() };
    }
  });
  await page.getByRole("button", { name: "Další akce" }).click();
  await page.getByRole("menuitem", { name: "Smazat zakázku" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText(`Smazat zakázku ${DELA.number}?`).waitFor();
  await shot(page, S("28-delete-confirm"));
  await dlg.getByRole("button", { name: "Ano, smazat natrvalo" }).click();
  await page.waitForURL((u) => u.pathname === "/orders", { timeout: 15_000 });
  expect(sql(`select count(*) from orders where id = ${lit(DELA.id)}`) === "0", "DB: zakázka smazána");
  expect(sql(`select count(*) from audit_log where action = 'job_deleted' and entity_id = ${lit(DELA.id)}`) === "1", "audit: job_deleted");
  expect(deleteAction !== null, "zachycen požadavek server akce");
  const r = await page.request.get(`${BASE}/orders/${DELA.id}`);
  expect(r.status() === 404 || (await r.text()).includes("nenalezena"), `smazaná zakázka → nenalezena (${r.status()})`);
});

await T("mazání: zaměstnanec ani obchodník nemají tlačítko, server akce zaměstnance je odmítnuta", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.dilna, DELB);
  expect((await page.getByRole("button", { name: "Další akce" }).count()) === 0, "zaměstnanec: bez „Další akce“");
  expect((await page.getByText("Smazat zakázku").count()) === 0, "zaměstnanec: bez Smazat zakázku");
  expect(deleteAction, "předchozí test zachytil server akci deleteJob");
  const { url, headers, body } = deleteAction;
  const hdrs = Object.fromEntries(Object.entries(headers).filter(([k]) => !["cookie", "content-length", "host", "origin", "referer"].includes(k.toLowerCase())));
  const res = await page.request.post(url.replace(DELA.id, DELB.id), {
    headers: { ...hdrs, origin: BASE, referer: `${BASE}/orders/${DELB.id}` },
    data: body.replace(DELA.id, DELB.id),
  });
  const txt = await res.text();
  expect(sql(`select count(*) from orders where id = ${lit(DELB.id)}`) === "1", `DB: zakázka zaměstnanci NEsmazána (odpověď ${res.status()}: ${txt.slice(0, 160)})`);
  expect(/"ok":false/.test(txt), `server akce vrátila ok:false (${txt.slice(-200)})`);
  await context.clearCookies();
  const p2 = await context.newPage();
  await openJob(p2, USERS.obchod, DELB);
  // #24: obchodník má v „Další akce“ jen „Sloučit s jinou zakázkou…“ — mazání ne (jen super admin)
  const more = p2.getByRole("button", { name: "Další akce" });
  if (await more.count()) {
    await more.first().click();
    await p2.getByRole("menuitem", { name: /Sloučit s jinou zakázkou/ }).waitFor({ timeout: 10_000 });
    expect((await p2.getByRole("menuitem", { name: /Smazat zakázku/ }).count()) === 0, "obchodník: bez „Smazat zakázku“ (mazání jen super admin)");
  }
});

await T("role: obchodník vidí nákupní ceny a marži; zaměstnanec ne — ani v HTML odpovědi detailu", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D5);
  let main = await page.locator("main").innerText();
  expect(main.includes("Nákupní náklady") && /4\s321,09/.test(main), "obchodník: Nákupní náklady 4 321,09 Kč");
  expect(main.includes("Marže"), "obchodník: řádek Marže");
  await openTab(page, "Položky");
  const tbl = await page.locator("main [role=tabpanel][data-state=active] table").innerText();
  expect(tbl.includes("Nákup / MJ"), "obchodník: sloupec Nákup / MJ");
  expect((await page.locator("main [role=tabpanel][data-state=active] table").getByLabel("Nákupní cena za MJ", { exact: true }).first().inputValue()) === "777,77", "obchodník: nákup 777,77");
  await context.clearCookies();

  const p2 = await context.newPage();
  await openJob(p2, USERS.dilna, D5);
  main = await p2.locator("main").innerText();
  expect(!main.includes("Nákupní náklady"), "zaměstnanec: bez Nákupní náklady");
  expect(!/\bMarže\b/.test(main), "zaměstnanec: bez Marže");
  await openTab(p2, "Položky");
  const panel = await p2.locator("main [role=tabpanel][data-state=active]").first().innerText();
  expect(!panel.includes("Nákup / MJ"), "zaměstnanec: bez sloupce Nákup / MJ");
  expect(panel.includes("Nákupní ceny vidí jen obchodník a admin."), "zaměstnanec: vysvětlení");
  await shot(p2, S("29-detail-dilna-items"));
  const html = await (await p2.request.get(`${BASE}/orders/${D5.id}`)).text();
  const leaks = ["777.77", "777,77", "4321.09", "4321,09", "4 321,09", "1555.54"].filter((s) => html.includes(s));
  expect(leaks.length === 0, `HTML detailu pro zaměstnance neobsahuje nákupní ceny (nalezeno: ${leaks.join(", ")})`);
  expect(!/"purchaseUnitPrice":\d/.test(html) && !/"purchaseCost":\d/.test(html), "HTML: purchaseUnitPrice/purchaseCost jen null");
  for (const tab of ["polozky", "nakup", "historie"]) {
    const h2 = await (await p2.request.get(`${BASE}/orders/${D5.id}?tab=${tab}`)).text();
    expect(!h2.includes("777.77") && !h2.includes("4321.09"), `HTML ?tab=${tab} bez nákupních cen`);
  }
  const book = await (await p2.request.get(`${BASE}/orders?q=${encodeURIComponent(TAG)}`)).text();
  expect(!book.includes("4321.09") && !book.includes("1555.54"), "HTML knihy pro zaměstnance bez nákupních nákladů");
  await p2.goto(`${BASE}/orders`);
  await bookIdle(p2);
  expect((await p2.locator("main a").filter({ hasText: "Hodnota v běhu" }).count()) === 0, "zaměstnanec: bez dlaždice Hodnota v běhu");
});

// ═════════════════════════ MOBIL 390 px ═════════════════════════

await T("mobil 390 px: kniha (karty), Vyfotit doklad + Nová zakázka viditelné, filtry pod tlačítkem, Tabule — bez přetékání", async (context) => {
  const page = await context.newPage();
  await openBook(page, USERS.obchod);
  await expectNoOverflow(page, "/orders mobil");
  await expectInViewport(page, page.getByRole("button", { name: "Vyfotit doklad", exact: true }), "tlačítko Vyfotit doklad");
  await expectInViewport(page, page.getByRole("button", { name: "Nová zakázka", exact: true }), "tlačítko Nová zakázka");
  const rows = await readRows(page);
  expect(rows.length > 0, "karty zakázek");
  const card = page.locator("main ul[role=list] > li").first();
  const box = await card.boundingBox();
  expect(box && box.width <= 390 && box.x >= 0, `karta se vejde (${box?.x}, ${box?.width})`);
  await shot(page, S("30-mobile-orders"));
  // filtry pod tlačítkem
  const filters = page.locator('button[aria-controls="book-filters"]');
  expect((await filters.getAttribute("aria-expanded")) === "false", "filtry zavřené");
  expect(!(await page.getByLabel("Obchodník", { exact: true }).isVisible()), "select Obchodník skrytý");
  await filters.click();
  await page.getByLabel("Obchodník", { exact: true }).waitFor({ state: "visible" });
  await expectNoOverflow(page, "/orders mobil s filtry");
  await shot(page, S("30-mobile-orders-filters"));
  await page.goto(`${BASE}/orders?view=tabule`);
  await bookIdle(page);
  await expectNoOverflow(page, "/orders?view=tabule mobil");
  await shot(page, S("30-mobile-board"));
  for (const seg of ["poptavky", "vse"]) {
    await page.goto(`${BASE}/orders?segment=${seg}`);
    await bookIdle(page);
    await expectNoOverflow(page, `/orders?segment=${seg} mobil`);
  }
}, { mobile: true });

await T("mobil 390 px: karta zakázky — všechny záložky bez přetékání", async (context) => {
  const page = await context.newPage();
  await openJob(page, USERS.obchod, D5);
  await expectNoOverflow(page, "detail mobil");
  await shot(page, S("31-mobile-detail"));
  const present = (await page.getByRole("tab").allInnerTexts()).map((x) => x.split("\n")[0]);
  for (const t of ["Technologie", "Položky", "Nabídky", "Nákup & marže", "Dokumenty", ...(present.includes("Komunikace") ? ["Komunikace"] : []), "Historie"]) {
    await page.getByRole("tab", { name: new RegExp(`^${t.replace("&", "\\&")}`) }).click();
    await eventually(async () => expect((await tabSel(page)) === t, `záložka ${t}`));
    await page.waitForTimeout(300);
    await expectNoOverflow(page, `detail mobil — ${t}`);
    if (t === "Položky") await shot(page, S("31-mobile-detail-items"));
  }
}, { mobile: true });

await T("mobil 390 px: dialog Nová zakázka bez přetékání, Založit zakázku viditelné", async (context) => {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await openBook(page, USERS.obchod);
  const dlg = await openNewJob(page);
  await expectNoOverflow(page, "dialog Nová zakázka");
  const box = await dlg.boundingBox();
  expect(box && box.x >= -1 && box.x + box.width <= 391, `dialog se vejde (${box?.x}, ${box?.width})`);
  await dlg.getByRole("button", { name: /Přidat první položku/ }).click();
  await expectNoOverflow(page, "dialog s položkou");
  await expectInViewport(page, dlg.getByRole("button", { name: "Založit zakázku" }), "tlačítko Založit zakázku");
  const sw = await dlg.evaluate((el) => {
    const sc = el.querySelector(".overflow-y-auto");
    return sc ? { sw: sc.scrollWidth, cw: sc.clientWidth } : null;
  });
  expect(!sw || sw.sw <= sw.cw + 1, `obsah dialogu nepřetéká (${JSON.stringify(sw)})`);
  await shot(page, S("32-mobile-new-job"));
  await dlg.getByRole("button", { name: "Zrušit", exact: true }).click();
}, { mobile: true });

// ── Úklid ────────────────────────────────────────────────────
await test("úklid vlastních dat (zakázky, zákazníci, soubory)", async () => {
  const comm = sql(`select coalesce(string_agg(c.id::text, ','), '') from commission_entries c join orders o on o.id = c.order_id where o.title like ${lit(`${PREFIX}%`)}`);
  const r = await cleanupOwnData();
  const left = sql(`select (select count(*) from orders where title like ${lit(`${PREFIX}%`)}) || '|' || (select count(*) from customers where name like ${lit(`${PREFIX}%`)})`);
  expect(left === "0|0", `po úklidu nic nezůstalo (${left}; smazáno ${r.jobs} zakázek, ${r.customers} zákazníků)`);
  if (comm) {
    const still = sql(`select count(*) from commission_entries where id in (${comm.split(",").map(lit).join(",")})`);
    expect(still === "0", `provize smazaných zakázek uklizeny triggerem (zbývá ${still})`);
  }
});

await browser.close();
process.exit(summary(errors) ? 0 : 1);
