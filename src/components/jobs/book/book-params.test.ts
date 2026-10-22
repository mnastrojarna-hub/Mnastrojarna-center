import { describe, it, expect } from "vitest";
import {
  parseBookParams, bookQuery, bookHref, applyBookPatch, toggleStagePatch, bookParamsToFilters,
  isPatchActive, activeFilterCount, isFiltered, segmentCounts, bookKpis, boardStages, groupByStage,
  moveJobStage, todayInPrague, dateFromIso, shortDate, initials, avatarTone, AVATAR_TONES, countLabel,
  normalizeStages, segmentOfStage, defaultStageFor, firstParam, sumValue, DEFAULT_PARAMS, RESET_FILTERS,
  KPI_PATCHES, ORDER_STAGES, INQUIRY_STAGES, BOOK_SEGMENTS, PAYMENT_FILTERS, isProductionStepKey, type BookParams,
} from "./book-params";
import { STAGE_ORDER } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";

const UUID = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";

describe("parseBookParams", () => {
  it("výchozí = Objednávky, řádky, nejnovější", () => {
    expect(parseBookParams({})).toEqual(DEFAULT_PARAMS);
    expect(DEFAULT_PARAMS.segment).toBe("objednavky");
    expect(DEFAULT_PARAMS.view).toBe("radky");
    expect(DEFAULT_PARAMS.sort).toBe("created");
    expect(DEFAULT_PARAMS.dir).toBe("desc");
  });

  it("čte všechny parametry a ignoruje neplatné", () => {
    const p = parseBookParams({
      segment: "poptavky", stages: "nabidka,poptavka,ve_vyrobe,xxx", q: "  hřídel  ", owner: UUID.toUpperCase(),
      assignee: "nope", customer: UUID, deadline: "week", sort: "deadline", view: "tabule",
    });
    expect(p.segment).toBe("poptavky");
    // ve_vyrobe nepatří do segmentu, pořadí podle knihy
    expect(p.stages).toEqual(["poptavka", "nabidka"]);
    expect(p.q).toBe("hřídel");
    expect(p.owner).toBe(UUID);
    expect(p.assignee).toBe("");
    expect(p.customer).toBe(UUID);
    expect(p.deadline).toBe("week");
    expect(p.sort).toBe("deadline");
    expect(p.dir).toBe("asc"); // výchozí směr pro termín
    expect(p.view).toBe("tabule");
  });

  it("neznámý segment / řazení / termín → výchozí", () => {
    const p = parseBookParams({ segment: "hack", sort: "drop table", deadline: "zitra", dir: "sideways" });
    expect(p.segment).toBe("objednavky");
    expect(p.sort).toBe("created");
    expect(p.deadline).toBeNull();
    expect(p.dir).toBe("desc");
  });

  it("pole hodnot a URLSearchParams", () => {
    expect(parseBookParams({ segment: ["dokoncene", "vse"] }).segment).toBe("dokoncene");
    expect(parseBookParams(new URLSearchParams("segment=vse&stages=zruseno")).stages).toEqual(["zruseno"]);
    expect(firstParam(new URLSearchParams("a=1"), "b")).toBeUndefined();
  });

  it("dlouhý dotaz se ořízne", () => {
    expect(parseBookParams({ q: "x".repeat(500) }).q).toHaveLength(200);
  });
});

describe("bookQuery / bookHref", () => {
  it("výchozí parametry = čistá adresa", () => {
    expect(bookHref(DEFAULT_PARAMS)).toBe("/orders");
  });

  it("vynechává výchozí hodnoty a nikdy nepřenáší capture / pristup", () => {
    const p = parseBookParams({ segment: "objednavky", sort: "created", dir: "desc", capture: "1", pristup: "knowledge" });
    expect(bookQuery(p)).toBe("");
    const q = bookQuery({ ...DEFAULT_PARAMS, sort: "deadline", dir: "asc", view: "tabule", q: "PO-45" });
    expect(q).toBe("q=PO-45&sort=deadline&view=tabule");
  });

  it("je idempotentní (parse ∘ query)", () => {
    const samples: BookParams[] = [
      DEFAULT_PARAMS,
      { ...DEFAULT_PARAMS, segment: "vse", stages: ["zruseno", "poptavka"], q: "Ø40 hřídel", owner: UUID, deadline: "overdue", sort: "value", dir: "asc", view: "tabule" },
      { ...DEFAULT_PARAMS, segment: "poptavky", stages: ["ve_vyrobe"], customer: UUID, sort: "number" },
    ];
    for (const s of samples) {
      const once = bookQuery(s);
      expect(bookQuery(parseBookParams(new URLSearchParams(once)))).toBe(once);
    }
  });
});

describe("applyBookPatch", () => {
  it("změna záložky ruší výběr stavů", () => {
    const p = { ...DEFAULT_PARAMS, stages: ["ve_vyrobe"] as JobStage[] };
    expect(applyBookPatch(p, { segment: "poptavky" }).stages).toEqual([]);
    expect(applyBookPatch(p, { segment: "poptavky", stages: ["nabidka"] }).stages).toEqual(["nabidka"]);
    // stejná záložka výběr nechá
    expect(applyBookPatch(p, { segment: "objednavky" }).stages).toEqual(["ve_vyrobe"]);
  });

  it("nové řazení bere svůj výchozí směr", () => {
    expect(applyBookPatch(DEFAULT_PARAMS, { sort: "customer" }).dir).toBe("asc");
    expect(applyBookPatch(DEFAULT_PARAMS, { sort: "customer", dir: "desc" }).dir).toBe("desc");
    expect(applyBookPatch({ ...DEFAULT_PARAMS, sort: "value", dir: "asc" }, { q: "x" }).dir).toBe("asc");
  });

  it("stavy mimo segment zahodí", () => {
    expect(applyBookPatch(DEFAULT_PARAMS, { stages: ["poptavka", "montaz"] }).stages).toEqual(["montaz"]);
  });

  it("toggle stavu a reset filtrů", () => {
    const a = applyBookPatch(DEFAULT_PARAMS, toggleStagePatch(DEFAULT_PARAMS, "montaz"));
    expect(a.stages).toEqual(["montaz"]);
    const b = applyBookPatch(a, toggleStagePatch(a, "objednavka"));
    expect(b.stages).toEqual(["objednavka", "montaz"]);
    const c = applyBookPatch(b, toggleStagePatch(b, "montaz"));
    expect(c.stages).toEqual(["objednavka"]);
    const filtered = { ...c, q: "x", owner: UUID, deadline: "week" as const, sort: "value" as const, view: "tabule" as const };
    expect(activeFilterCount(filtered)).toBe(4);
    const reset = applyBookPatch(filtered, RESET_FILTERS);
    expect(isFiltered(reset)).toBe(false);
    expect(reset.sort).toBe("value");
    expect(reset.view).toBe("tabule");
  });
});

describe("isPatchActive", () => {
  it("dlaždice / záložka je aktivní jen při shodě", () => {
    expect(isPatchActive(DEFAULT_PARAMS, KPI_PATCHES.ordersRunning)).toBe(true);
    expect(isPatchActive(DEFAULT_PARAMS, KPI_PATCHES.overdue)).toBe(false);
    const overdue = applyBookPatch(DEFAULT_PARAMS, KPI_PATCHES.overdue);
    expect(isPatchActive(overdue, KPI_PATCHES.overdue)).toBe(true);
    const problems = applyBookPatch(DEFAULT_PARAMS, KPI_PATCHES.problems);
    expect(problems.stages).toEqual(["pozastaveno", "reklamace"]);
    expect(isPatchActive(problems, KPI_PATCHES.problems)).toBe(true);
    expect(isPatchActive(problems, KPI_PATCHES.ordersRunning)).toBe(false);
  });
});

describe("bookParamsToFilters", () => {
  it("segment bez výběru = stavy segmentu", () => {
    const f = bookParamsToFilters(DEFAULT_PARAMS);
    expect(f.stages).toEqual(ORDER_STAGES);
    expect(f.sort).toBe("created");
    expect(f.q).toBeUndefined();
  });

  it("Vše = bez omezení stavů", () => {
    const f = bookParamsToFilters({ ...DEFAULT_PARAMS, segment: "vse" });
    expect(f.stages).toBeUndefined();
    expect(f.group).toBe("vse");
  });

  it("výběr stavů a ostatní filtry", () => {
    const f = bookParamsToFilters({
      ...DEFAULT_PARAMS, segment: "poptavky", stages: ["nabidka"], q: " PO ", owner: UUID, assignee: UUID, customer: UUID, deadline: "no_date",
    });
    expect(f).toMatchObject({ stages: ["nabidka"], q: "PO", ownerId: UUID, assigneeId: UUID, customerId: UUID, deadline: "no_date" });
  });
});

describe("výroba a platba", () => {
  it("čte operaci, místo a platbu z URL, neplatné zahodí", () => {
    const p = parseBookParams({ step: "tepelne_zpracovani", location: "  TepKal s.r.o. ", payment: "po_splatnosti" });
    expect(p.step).toBe("tepelne_zpracovani");
    expect(p.location).toBe("TepKal s.r.o.");
    expect(p.payment).toBe("po_splatnosti");
    expect(parseBookParams({ step: "hotovo" }).step).toBe("hotovo");
    const bad = parseBookParams({ step: "drop", payment: "zitra", location: "x".repeat(400) });
    expect(bad.step).toBe("");
    expect(bad.payment).toBeNull();
    expect(bad.location).toHaveLength(300);
    expect(isProductionStepKey("frezovani")).toBe(true);
    expect(isProductionStepKey("")).toBe(false);
    expect(PAYMENT_FILTERS.map((f) => f.key)).toEqual(["po_splatnosti", "nezaplaceno", "zaplaceno"]);
  });

  it("adresa je idempotentní i s diakritikou a mezerami", () => {
    const s: BookParams = { ...DEFAULT_PARAMS, step: "brouseni", location: "Brusírna & syn, s.r.o.", payment: "nezaplaceno" };
    const once = bookQuery(s);
    expect(once).toContain("step=brouseni");
    expect(once).toContain("payment=nezaplaceno");
    expect(parseBookParams(new URLSearchParams(once)).location).toBe("Brusírna & syn, s.r.o.");
    expect(bookQuery(parseBookParams(new URLSearchParams(once)))).toBe(once);
  });

  it("filtry, počet aktivních a reset", () => {
    const p: BookParams = { ...DEFAULT_PARAMS, step: "soustruzeni", location: "U nás", payment: "zaplaceno" };
    expect(activeFilterCount(p)).toBe(3);
    expect(bookParamsToFilters(p)).toMatchObject({ step: "soustruzeni", location: "U nás", payment: "zaplaceno" });
    expect(bookParamsToFilters(DEFAULT_PARAMS).step).toBeUndefined();
    const reset = applyBookPatch(p, RESET_FILTERS);
    expect([reset.step, reset.location, reset.payment]).toEqual(["", "", null]);
  });

  it("dlaždice Po splatnosti = filtr platby přes celou knihu", () => {
    const next = applyBookPatch(DEFAULT_PARAMS, KPI_PATCHES.overdueInvoices);
    expect(next.segment).toBe("vse");
    expect(next.payment).toBe("po_splatnosti");
    expect(isPatchActive(next, KPI_PATCHES.overdueInvoices)).toBe(true);
    expect(isPatchActive(DEFAULT_PARAMS, KPI_PATCHES.overdueInvoices)).toBe(false);
  });
});

describe("počty", () => {
  const byStage = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i + 1])) as Record<JobStage, number>;

  it("segmenty sečtou své stavy", () => {
    const c = segmentCounts(byStage);
    expect(c.poptavky).toBe(1 + 2 + 3);
    expect(c.dokoncene).toBe(byStage.dokonceno);
    expect(c.nerealizovane).toBe(byStage.nerealizovano + byStage.zruseno);
    expect(c.vse).toBe(STAGE_ORDER.reduce((n, _s, i) => n + i + 1, 0));
    expect(c.objednavky).toBe(ORDER_STAGES.reduce((n, s) => n + byStage[s], 0));
  });

  it("každý stav patří do právě jednoho segmentu (kromě Vše)", () => {
    for (const s of STAGE_ORDER) {
      const owners = BOOK_SEGMENTS.filter((g) => g.key !== "vse" && g.stages.includes(s));
      expect(owners).toHaveLength(1);
      expect(segmentOfStage(s)).toBe(owners[0].key);
    }
  });

  it("KPI", () => {
    const k = bookKpis({ byStage, overdue: 4, dueThisWeek: 2 });
    expect(k.inquiries).toBe(6);
    expect(k.problems).toBe(byStage.pozastaveno + byStage.reklamace);
    expect(k.overdue).toBe(4);
    expect(k.dueSoon).toBe(2);
    expect(k.ordersRunning).toBe(segmentCounts(byStage).objednavky);
  });

  it("výchozí stav nové zakázky podle záložky", () => {
    expect(defaultStageFor("poptavky")).toBe("poptavka");
    expect(defaultStageFor("objednavky")).toBe("objednavka");
    expect(defaultStageFor("vse")).toBe("objednavka");
  });
});

describe("tabule", () => {
  const jobs = [
    { id: "a", stage: "poptavka" as JobStage, value: 100 },
    { id: "b", stage: "nabidka" as JobStage, value: null },
    { id: "c", stage: "poptavka" as JobStage, value: 50.5 },
    { id: "d", stage: "ve_vyrobe" as JobStage, value: 10 },
  ];

  it("sloupce = výběr, jinak segment", () => {
    expect(boardStages({ ...DEFAULT_PARAMS, segment: "poptavky" })).toEqual(INQUIRY_STAGES);
    expect(boardStages({ ...DEFAULT_PARAMS, segment: "poptavky", stages: ["nabidka"] })).toEqual(["nabidka"]);
    expect(boardStages({ ...DEFAULT_PARAMS, segment: "vse" })).toEqual(STAGE_ORDER);
  });

  it("seskupí zakázky a sečte hodnoty", () => {
    const cols = groupByStage(jobs, INQUIRY_STAGES);
    expect(cols.map((c) => c.stage)).toEqual(INQUIRY_STAGES);
    expect(cols[0].jobs.map((j) => j.id)).toEqual(["a", "c"]);
    expect(cols[0].value).toBe(150.5);
    expect(cols[1].jobs).toHaveLength(0);
    expect(cols[2].jobs.map((j) => j.id)).toEqual(["b"]);
    expect(cols[2].value).toBe(0);
    // zakázka mimo sloupce se nezobrazí
    expect(cols.flatMap((c) => c.jobs).some((j) => j.id === "d")).toBe(false);
  });

  it("optimistický přesun", () => {
    const moved = moveJobStage(jobs, "a", "naceneni");
    expect(moved.find((j) => j.id === "a")?.stage).toBe("naceneni");
    expect(moved[1]).toBe(jobs[1]);
    expect(jobs[0].stage).toBe("poptavka");
    expect(sumValue(jobs)).toBe(160.5);
  });
});

describe("datum a lidé", () => {
  it("dnešek v Praze", () => {
    // 23:30 UTC = 01:30 dalšího dne v Praze (letní čas)
    expect(todayInPrague(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(todayInPrague(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01-15");
  });

  it("dateFromIso dává místní den", () => {
    const d = dateFromIso("2026-10-22");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 22]);
  });

  it("krátké datum", () => {
    expect(shortDate("2026-11-05", "2026-10-22")).toBe("5. 11.");
    expect(shortDate("2027-01-09", "2026-10-22")).toBe("9. 1. 2027");
    expect(shortDate("2027-01-09T10:00:00Z")).toBe("9. 1. 2027");
    expect(shortDate(null)).toBe("—");
  });

  it("iniciály", () => {
    expect(initials("Jan Novák")).toBe("JN");
    expect(initials("Šárka Marie Ěřová")).toBe("ŠĚ");
    expect(initials("admin@local.test")).toBe("AD");
    expect(initials("petr.dvorak@firma.cz")).toBe("PD");
    expect(initials("Eva")).toBe("EV");
    expect(initials("")).toBe("?");
  });

  it("barva avatara je stálá", () => {
    expect(avatarTone(UUID)).toBe(avatarTone(UUID));
    expect(AVATAR_TONES).toContain(avatarTone(UUID));
    expect(AVATAR_TONES).toContain(avatarTone(null));
  });

  it("skloňování", () => {
    expect(countLabel(1, "zakázka", "zakázky", "zakázek")).toBe("1 zakázka");
    expect(countLabel(3, "zakázka", "zakázky", "zakázek")).toBe("3 zakázky");
    expect(countLabel(0, "zakázka", "zakázky", "zakázek")).toBe("0 zakázek");
  });

  it("normalizeStages", () => {
    expect(normalizeStages(["zruseno", "zruseno", "nerealizovano"], "nerealizovane")).toEqual(["nerealizovano", "zruseno"]);
  });
});
