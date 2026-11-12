import { describe, it, expect } from "vitest";
import { crossTextLeaks, textCompanyLeaks } from "./pdf-pipeline";
import { companyLeaks, crossTextTermHits, discoverCompanyNames, withCompanyNames } from "./company-names";
import { isCompanyLeak } from "./company-check";
import { COMPANY_LEAK_RETRY_TEXT, COMPANY_LEAK_TEXT, COMPANY_LEAK_WARNING, companyLeakRetry, decideAnonStatus, type DecideInput } from "./decide";
import { anonymizeDxf, DXF_COMPANY_LEAK } from "./dxf";
import { DEFAULT_REDACT, isStandaloneCompanyLine, isTableRowCell, makeTerms, makeWordTerms, ruleLine, rulePage, type RuleContext } from "./rules";
import type { TextItem, TextLine } from "./types";

/**
 * Anonymizace v2 (majitel 3. 11.: „oprav tu anonymizaci výkresů“ — v razítku anonymizované kopie zůstával
 * název firmy): pravidla pro firmu v hlavičce mimo zónu razítka, výstupní kontrola (bez diakritiky,
 * prostrkaně, přes řádky / položky / entity DXF) a rozhodnutí — kopie s názvem firmy nikdy „hotovo“.
 */

const KEEP = ["Mnástrojárna", "Mnastrojarna"];
const ctxFor = (crm: string[]): RuleContext => ({ terms: [...makeTerms(crm, "crm", KEEP), ...makeWordTerms(crm, "crm", KEEP)], keepTerms: KEEP, redact: { ...DEFAULT_REDACT } });
const C = ctxFor(["Strojmetal a.s."]);

/** Řádek z jedné položky (znaky rovnoměrně po šířce). */
function line(id: string, text: string, x: number, y: number, o: { size?: number; zone?: TextLine["zone"]; w?: number } = {}): { line: TextLine; item: TextItem } {
  const size = o.size ?? 10;
  const w = o.w ?? text.length * size * 0.6;
  const item: TextItem = { id: `i-${id}`, page: 1, str: text, x, y, w, h: size, fontSize: size, rot: 0, source: "text" };
  return {
    item,
    line: { id, page: 1, text, spans: [{ itemId: item.id, start: 0, end: text.length, offset: 0 }], box: { x, y, w, h: size }, fontSize: size, rot: 0, zone: o.zone ?? "title_block" },
  };
}
function leaksOf(parts: { line: TextLine; item: TextItem }[], ctx: RuleContext, burned: { x: number; y: number; w: number; h: number }[] = []) {
  return textCompanyLeaks(parts.map((p) => p.line), ctx, burned, [], new Map(parts.map((p) => [p.item.id, p.item])));
}

describe("pravidla: firma v hlavičce mimo zónu razítka", () => {
  it("samostatný řádek s firmou v těle (horní buňka razítka mimo zónu) → company; věta poznámky ne", () => {
    const head = line("h", "BRISK Tábor a.s.", 900, 700, { zone: "body" }).line;
    const note = line("n", "Povrch dle normy firmy ACME GmbH", 100, 100, { zone: "body" }).line;
    const r = rulePage([head, note], C);
    expect(r.hits.filter((h) => h.lineId === "h").map((h) => [h.category, h.rule])).toEqual([["company", "legal_form_line"]]);
    expect(r.hits.filter((h) => h.lineId === "n")).toEqual([]);
  });
  it("řádek kusovníku (pozice / počet kusů na stejném účaří) zůstává — odkazovaný výrobce", () => {
    const cells = [line("p", "3", 600, 500, { zone: "body" }), line("q", "4 ks", 650, 500, { zone: "body" }), line("m", "SKF GmbH", 760, 500, { zone: "body" })].map((x) => x.line);
    expect(isTableRowCell(cells, cells[2])).toBe(true);
    expect(rulePage(cells, C).hits.filter((h) => h.lineId === "m")).toEqual([]);
    expect(isStandaloneCompanyLine("Výrobce: Hasco GmbH")).toBe(false);
  });
  it("osamělá právní forma za smazaným názvem („HYDROTEK“ | „S.R.O.“) se smaže taky", () => {
    const c2 = withCompanyNames(C, ["HYDROTEK s.r.o."]);
    const a = line("a", "HYDROTEK", 700, 600, { zone: "body" }).line;
    const b = line("b", "S.R.O.", 700 + 8 * 6 + 6, 600, { zone: "body" }).line;
    const hits = rulePage([a, b], c2).hits;
    expect(hits.some((h) => h.lineId === "a")).toBe(true);
    expect(hits.find((h) => h.lineId === "b")?.rule).toBe("legal_form_tail");
  });
  it("jméno vlastníka v doložce se maže i s volbou „jen název firmy“ (rok a věta zůstanou)", () => {
    const t = "© KOVOTEX Brno s.r.o. 2023 — reprodukce zakázána";
    const hits = ruleLine(t, "title_block", C).hits;
    expect(hits.map((h) => t.slice(h.start, h.end))).toContain("KOVOTEX Brno s.r.o.");
    // jméno vlastníka = jen název (v razítku právní forma maže celou buňku — to je pravidlo legal_form)
    const owner = hits.find((h) => h.rule === "copyright_owner")!;
    expect(t.slice(owner.start, owner.end)).toBe("KOVOTEX Brno s.r.o.");
    // jméno z doložky je pak termín pro celý soubor
    expect(discoverCompanyNames([{ text: t, zone: "title_block" }], C)).toEqual(["KOVOTEX Brno s.r.o."]);
  });
});

describe("výstupní kontrola textu: varianty zápisu", () => {
  it("bez diakritiky / jinou velikostí písmen / prostrkaně", () => {
    const c = ctxFor(["Škoda Transportation a.s."]);
    expect(companyLeaks("SKODA TRANSPORTATION", "body", c).length).toBeGreaterThan(0);
    expect(companyLeaks("š k o d a", "body", c).length).toBeGreaterThan(0);
    expect(companyLeaks("S-T-R-O-J-M-E-T-A-L", "body", C).length).toBeGreaterThan(0);
    expect(companyLeaks("Mnástrojárna s.r.o.", "title_block", c)).toEqual([]);
  });
  it("název rozdělený do více textů (pořadí souboru / účaří)", () => {
    const c = withCompanyNames(C, ["BRISK Tábor a.s."]);
    const hits = crossTextTermHits(["Odběratel", "STROJ", "METAL a.s.", "výkres"], c.terms);
    expect([...new Set(hits.map((h) => h.index))].sort()).toEqual([1, 2]);
    expect(hits).toHaveLength(2); // bez duplicit (celý název i slovo dávají stejný termín)
    expect(crossTextTermHits(["B", "R", "I", "S", "K"], c.terms).map((h) => h.index)).toEqual([0, 1, 2, 3, 4]);
    // hranice slova: „OBRISKA“ není BRISK
    expect(crossTextTermHits(["OBR", "ISKA"], c.terms)).toEqual([]);
    expect(crossTextTermHits(["STROJMETAL"], c.terms)).toEqual([]); // celé v jednom textu řeší ruleLine
  });
  it("PDF: zbytek rozdělený na dva řádky pod sebou („STROJ-“ / „METAL“) → únik v obou", () => {
    const a = line("a", "STROJ-", 800, 700);
    const b = line("b", "METAL", 800, 711);
    expect(leaksOf([a, b], C)).toHaveLength(2);
    expect(crossTextLeaks([a.line, b.line], C).map((x) => x.lineId).sort()).toEqual(["a", "b"]);
    // vypálené → nic
    expect(leaksOf([a, b], C, [{ x: 790, y: 690, w: 100, h: 40 }])).toEqual([]);
  });
  it("PDF: prostrkaná písmena jako samostatné položky na jednom účaří → únik; vzdálené buňky ne", () => {
    const c = withCompanyNames(C, ["BRISK Tábor a.s."]);
    const letters = "BRISK".split("").map((ch, i) => line(`l${i}`, ch, 900 + i * 12, 700));
    expect(leaksOf(letters, c)).toHaveLength(5);
    const far = ["BRI", "SK"].map((t, i) => line(`f${i}`, t, 100 + i * 400, 300));
    expect(leaksOf(far, c)).toEqual([]);
  });
  it("PDF: znak bez dohledatelné položky → box celého řádku (únik se nepřehlédne)", () => {
    const a = line("a", "STROJMETAL", 500, 500);
    const orphan = { ...a.line, spans: [] };
    const out = textCompanyLeaks([orphan], C, [], [], new Map());
    expect(out).toHaveLength(1);
    expect(out[0].box).toEqual(orphan.box);
  });
  it("AI přepis se známým termínem je únik i s rolí výrobce; naše firma nikdy", () => {
    expect(isCompanyLeak({ role: "referenced_maker", text: "STROJMETAL", form: "text" }, KEEP, false, C.terms)).toBe(true);
    expect(isCompanyLeak({ role: "referenced_maker", text: "SKF", form: "text" }, KEEP, false, C.terms)).toBe(false);
    expect(isCompanyLeak({ role: "ours", text: "Mnástrojárna", form: "text" }, KEEP, false, C.terms)).toBe(false);
  });
});

describe("DXF: název přes více entit a výstupní kontrola", () => {
  const dxf = (pairs: [number, string][]) => pairs.map(([c, v]) => `${String(c).padStart(3, " ")}\n${v}`).join("\n") + "\n";
  const text = (v: string, x: number): [number, string][] => [[0, "TEXT"], [8, "0"], [10, String(x)], [20, "40.0"], [40, "3.5"], [1, v]];
  const wrap = (body: [number, string][]) => dxf([[0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"], [0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"], ...body, [0, "ENDSEC"], [0, "EOF"]]);

  it("„STROJ“ + „METAL“ ve dvou entitách a prostrkaná písmena jako entity → pryč; ověřeno", () => {
    const src = wrap([...text("STROJ", 10), ...text("METAL", 30), ...text("%%c25 h7", 100), ...["S", "T", "R", "O", "J", "M", "E", "T", "A", "L"].flatMap((ch, i) => text(ch, 200 + i * 4))]);
    const r = anonymizeDxf(new TextEncoder().encode(src), C);
    const out = new TextDecoder().decode(r.bytes!);
    expect(out).not.toMatch(/\n(STROJ|METAL|S|T|R|O|J|M|E|A|L)\n/);
    expect(out).toContain("%%c25 h7");
    expect(r.verified, r.problems.join(",")).toBe(true);
  });
  it("název v hodnotě, kterou nejde vyprázdnit (název rozvržení) → problém „zůstal název firmy“ → selhalo", () => {
    const src = wrap([[0, "TEXT"], [8, "0"], [410, "STROJMETAL"], [10, "1"], [20, "1"], [40, "2"], [1, "X1"]]);
    const r = anonymizeDxf(new TextEncoder().encode(src), C);
    expect(r.verified).toBe(false);
    expect(r.problems.some((p) => p.startsWith(DXF_COMPANY_LEAK))).toBe(true);
  });
});

describe("rozhodnutí: kopie s názvem firmy nikdy hotovo", () => {
  const base: DecideInput = {
    mode: "full", method: "raster_pdf", aiUsed: true, modelFallback: false, confidence: 0.95, ruleHitsCovered: true, outputChecksPassed: true,
    verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false, warnings: [], customerStandard: false, termInKeep: false, titleBlockFound: true,
  };
  it("únik → failed s důvodem; jiný problém výstupu → obecný důvod; čisté → done", () => {
    const leak = decideAnonStatus({ ...base, outputChecksPassed: false, warnings: [{ code: "verify_leak", message: `${COMPANY_LEAK_WARNING} (strana 1).`, page: 1 }] });
    expect(leak).toMatchObject({ status: "failed", reason: COMPANY_LEAK_TEXT });
    const other = decideAnonStatus({ ...base, outputChecksPassed: false });
    expect(other.status).toBe("failed");
    expect(other.reason).not.toBe(COMPANY_LEAK_TEXT);
    // varování „doplněno a ověřeno znovu“ (uzdravený únik) samo o sobě kopii nezastaví
    expect(decideAnonStatus({ ...base, warnings: [{ code: "verify_leak", message: "Kontrola kopie našla zbylý název firmy — doplněno a ověřeno znovu." }] }).status).toBe("done");
  });
  it("automatické opakování: jen s AI, v rámci 3 rychlých pokusů (majitel 5. 11.: třetí pokus dělá systém, ne člověk), ne po ručním uložení", () => {
    const r = { status: "failed" as const, reason: COMPANY_LEAK_TEXT, aiUsed: true, manualSave: false, attempts: 1 };
    expect(companyLeakRetry(r)).toBe(true);
    expect(companyLeakRetry({ ...r, attempts: 2 })).toBe(true);
    expect(companyLeakRetry({ ...r, attempts: 3 })).toBe(false);
    expect(companyLeakRetry({ ...r, aiUsed: false })).toBe(false);
    expect(companyLeakRetry({ ...r, manualSave: true })).toBe(false);
    expect(companyLeakRetry({ ...r, reason: "Jiná chyba" })).toBe(false);
    expect(COMPANY_LEAK_RETRY_TEXT).toMatch(/zkusí se znovu/);
  });
});

describe("jména z výkresu bez úvodu doložky; název a právní forma ve dvou položkách", () => {
  it("„Property of BRISK Tabor a.s.“ → jméno „BRISK Tabor a.s.“ (ne „Property“ jako termín)", () => {
    const names = discoverCompanyNames([line("p", "Property of BRISK Tabor a.s.", 20, 400, { zone: "body" }).line], C);
    expect(names).toEqual(["BRISK Tabor a.s."]);
    expect(withCompanyNames(C, names).terms.some((t) => t.compact === "property")).toBe(false);
  });
  it("„HYDROTEK“ | „S.R.O.“ bez známého termínu → obě položky jsou firma a jméno se najde", () => {
    const a = line("a", "HYDROTEK", 700, 600, { zone: "body" }).line;
    const b = line("b", "S.R.O.", 700 + 8 * 6 + 6, 600, { zone: "body" }).line;
    const hits = rulePage([a, b], C).hits;
    expect(hits.find((h) => h.lineId === "a")?.rule).toBe("legal_form_line");
    expect(hits.find((h) => h.lineId === "b")?.rule).toBe("legal_form_tail");
    expect(discoverCompanyNames([a, b], C)).toEqual(["HYDROTEK"]);
    // kusovník: „3" | „Hasco" | „GmbH" na jednom účaří zůstává
    const row = [line("n", "3", 600, 500, { zone: "body" }), line("m", "Hasco", 640, 500, { zone: "body" }), line("g", "GmbH", 640 + 5 * 6 + 6, 500, { zone: "body" })].map((x) => x.line);
    expect(rulePage(row, C).hits).toEqual([]);
  });
});
