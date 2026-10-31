import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { A3, makeInvoicePdf, makeVectorDrawing } from "./__fixtures__/samples";
import { anonymizePdf, type PdfAnonInput } from "./pdf-pipeline";
import { openPdf } from "./pdf-node";
import { inkFraction, renderPageRaster, type Raster } from "./pdf-raster";
import { buildLines } from "./lines";
import {
  ALL_REDACT, DEFAULT_REDACT, crossLineTermHits, findTermRanges, isCompanyOnly, makeTerms, makeWordTerms, ruleLine, rulePage,
  trailingLegalForm, type RuleContext,
} from "./rules";
import { gatherTerms } from "./terms";
import { DEFAULT_ANON_SETTINGS } from "./settings";
import { decideAnonStatus } from "./decide";
import { isAnonCandidate, isAnonDrawingPath, isModel3d, needsDrawingCheck } from "./candidate";
import type { TextItem } from "./types";

/**
 * Majitel 31. 10.: „Anonymizovat to má výkresy… s jistotou. Vlastně stačí, když to smaže název firmy.
 * Nic víc." + „3D modely… Jde jen o výkresy." + „Žádný nic ke kontrole nepůjde."
 * Kandidáti jen 2D výkresy, výchozí jen název firmy (všechny varianty z CRM, i rozdělený do více
 * textových položek, přes zalomení řádku, bez diakritiky, s právní formou), osoby / kontakty / cesty
 * zůstanou, výsledek hotový bez kontroly.
 */

const COMPANY = ["Strojmetal Aluminium Forging s.r.o.", "Kovárna Hoštice s.r.o."];
const KEEP = ["Mnástrojárna", "Mnastrojarna"];
const ctx = (redact = DEFAULT_REDACT): RuleContext => ({
  terms: [...makeTerms(COMPANY, "crm", KEEP), ...makeWordTerms(COMPANY, "crm", KEEP)], keepTerms: KEEP, redact: { ...redact },
});
const hits = (text: string, zone: "title_block" | "body" = "body", c = ctx()) => ruleLine(text, zone, c).hits.map((h) => text.slice(h.start, h.end));

describe("výchozí nastavení: jen název firmy", () => {
  it("DEFAULT_REDACT = jen firma, ALL_REDACT = dřívější všechno", () => {
    expect(isCompanyOnly(DEFAULT_REDACT)).toBe(true);
    expect(Object.entries(DEFAULT_REDACT).filter(([, v]) => v).map(([k]) => k)).toEqual(["company"]);
    expect(isCompanyOnly(ALL_REDACT)).toBe(false);
    expect(DEFAULT_ANON_SETTINGS.redact).toEqual(DEFAULT_REDACT);
  });
  it("osoby, kontakty, cesty, doložka zůstávají; firma pryč", () => {
    expect(hits("Kreslil: J. Novák", "title_block")).toEqual([]);
    expect(hits("Schválil: Ing. Petr Svoboda", "title_block")).toEqual([]);
    expect(hits("Tel.: +420 312 456 789", "title_block")).toEqual([]);
    expect(hits("jan.novak@seznam.cz", "title_block")).toEqual([]);
    // název firmy v doméně je pořád název firmy → smaže se jen on
    expect(hits("info@kovarna-hostice.cz", "title_block")).toEqual(expect.arrayContaining(["kovarna-hostice"]));
    expect(hits("C:\\Projekty\\Hridel\\D-1234.dwg", "body")).toEqual([]);
    expect(hits("IČO: 12345678", "title_block")).toEqual([]);
    // název firmy (i s právní formou) kdekoli
    expect(hits("STROJMETAL ALUMINIUM FORGING s.r.o.")).toContain("STROJMETAL ALUMINIUM FORGING s.r.o.");
    expect(hits("Zákazník: ACME Forge GmbH", "title_block")).toEqual(["ACME Forge GmbH"]);
    // se zapnutými osobami (volitelně v Nastavení) se jméno maže dál
    expect(hits("Kreslil: J. Novák", "title_block", ctx(ALL_REDACT))).toContain("J. Novák");
  });
  it("© doložka: s vypnutou kategorií se maže jen název firmy zákazníka (termín), zbytek doložky zůstane", () => {
    expect(hits("© Strojmetal 2024 — rozmnožování zakázáno", "title_block")).toEqual(["Strojmetal"]);
  });
});

describe("varianty názvu firmy (deterministicky)", () => {
  it.each<[string, string]>([
    ["velká písmena", "STROJMETAL"],
    ["malá písmena", "strojmetal"],
    ["bez diakritiky (CAD písmo)", "KOVARNA HOSTICE"],
    ["s diakritikou", "Kovárna Hoštice"],
    ["rozepsané po znacích", "S T R O J M E T A L"],
    ["spojovník", "STROJ-METAL"],
    ["s právní formou", "Kovarna Hostice, s.r.o."],
    ["a.s. za výrazným slovem", "STROJMETAL a.s."],
  ])("%s: „%s“ celé pryč", (_n, text) => {
    const h = ruleLine(`Výrobce ${text} 2024`, "body", ctx()).hits;
    const cut = h.map((x) => `Výrobce ${text} 2024`.slice(x.start, x.end)).join("|");
    expect(cut, cut).toMatch(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "\\s"), "i"));
  });
  it("právní forma za názvem patří k názvu", () => {
    expect(trailingLegalForm(" s.r.o., Kladno")).toBe(" s.r.o.".length);
    expect(trailingLegalForm(" GmbH")).toBe(5);
    expect(trailingLegalForm(" 2,5 kg")).toBe(0);
    expect(trailingLegalForm(" KG")).toBe(3);
  });
  it("naše firma se nikdy nemaže", () => {
    expect(hits("Výroba: Mnástrojárna s.r.o.", "title_block")).toEqual([]);
  });
  it("technické údaje zůstávají (číslo výkresu, materiál, kóty)", () => {
    expect(hits("Material: 1.4301 CSN EN 10088-2", "title_block")).toEqual([]);
    expect(hits("Ø25 h7  Ra 1,6  ISO 2768-mK")).toEqual([]);
  });
});

const item = (id: string, str: string, x: number, y: number, size = 10): TextItem => ({
  id, page: 1, str, x, y: y - size, w: str.length * size * 0.5, h: size, fontSize: size, rot: 0, source: "text", ox: x, oy: y, adv: str.length * size * 0.5,
});

describe("název rozdělený do textových položek a přes zalomení řádku", () => {
  it("dvě položky „STROJ“ + „METAL“ těsně za sebou → jeden řádek, termín celý", () => {
    const lines = buildLines([item("a", "STROJ", 100, 200), item("b", "METAL", 125, 200), item("c", "Kreslil:", 100, 260)], 1, () => "title_block");
    const pr = rulePage(lines, ctx());
    const l = lines.find((x) => x.text.startsWith("STROJ"))!;
    const h = pr.hits.filter((x) => x.lineId === l.id);
    expect(h.length).toBeGreaterThan(0);
    expect(Math.min(...h.map((x) => x.start))).toBe(0);
    expect(Math.max(...h.map((x) => x.end))).toBe(l.text.length);
  });
  it("„STROJ-“ / „METAL“ na dvou řádcích buňky razítka → zásah v obou řádcích", () => {
    const lines = buildLines([item("a", "STROJ-", 100, 200), item("b", "METAL", 100, 212), item("c", "Kreslil: J. Novak", 100, 300)], 1, () => "title_block");
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(["STROJ-", "METAL"]));
    const pr = rulePage(lines, ctx());
    const top = lines.find((l) => l.text === "STROJ-")!, bottom = lines.find((l) => l.text === "METAL")!;
    expect(pr.hits.some((h) => h.lineId === top.id && h.rule === "term_xline")).toBe(true);
    expect(pr.hits.some((h) => h.lineId === bottom.id && h.rule === "term_xline")).toBe(true);
    // jméno (osoby vypnuté) zůstává
    const name = lines.find((l) => l.text.startsWith("Kreslil"))!;
    expect(pr.hits.some((h) => h.lineId === name.id)).toBe(false);
  });
  it("celý název přes dva řádky („Kovarna“ / „Hostice s.r.o.“) i bez výrazných slov", () => {
    const terms = makeTerms(["Kovárna Hoštice s.r.o."], "crm", KEEP); // jen celý název, ne slova
    const lines = buildLines([item("a", "Kovarna", 100, 200), item("b", "Hostice s.r.o.", 100, 212)], 1, () => "body");
    const x = crossLineTermHits(lines, terms);
    expect(x).toHaveLength(2);
    const bottom = lines.find((l) => l.text.startsWith("Hostice"))!;
    expect(x.find((h) => h.lineId === bottom.id)!.end).toBe(bottom.text.length); // i s právní formou
  });
  it("slovo, které jen začíná stejně, se nezasáhne (hranice slova)", () => {
    const lines = buildLines([item("a", "Nastroj", 100, 200), item("b", "METALL", 100, 212)], 1, () => "body");
    expect(crossLineTermHits(lines, makeWordTerms(["Strojmetal a.s."], "crm", KEEP))).toEqual([]);
    expect(findTermRanges("STROJMETALLURGIE", makeWordTerms(["Strojmetal a.s."], "crm", KEEP)[0])).toEqual([]);
  });
});

describe("termíny zakázky podle kategorií (CRM)", () => {
  function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
    return {
      from(t: string) {
        return {
          select() {
            return {
              eq(col: string, v: string) {
                const rows = (tables[t] ?? []).filter((r) => r[col] === v);
                return Object.assign(Promise.resolve({ data: rows }), { maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }) });
              },
            };
          },
        };
      },
    };
  }
  const db = fakeDb({
    orders: [{ id: "j1", customer_id: "c1", customer_contact: "Petr Svoboda", customer_contact_email: "p.svoboda@strojmetal.cz" }],
    customers: [{ id: "c1", name: "Strojmetal Aluminium Forging s.r.o.", email: "info@strojmetal.cz", website: "www.strojmetal.cz", contact_person: "Jana Malá", ico: "12345678", dic: "CZ12345678" }],
    customer_contacts: [{ customer_id: "c1", name: "Karel Novák", email: "k.novak@strojmetal.cz" }],
  });

  it("výchozí (jen firma): název celý + výrazné slovo; ne osoby, ne doména, ne IČO", async () => {
    const g = await gatherTerms(db, { jobId: "j1", settings: DEFAULT_ANON_SETTINGS, extracted: { customerName: "STROJMETAL a.s." } });
    const raw = g.raw.map((r) => r.toLowerCase());
    expect(raw).toEqual(expect.arrayContaining(["strojmetal aluminium forging", "strojmetal"]));
    expect(raw.some((r) => /svoboda|mal[aá]|nov[aá]k/.test(r))).toBe(false);
    expect(raw.some((r) => /\.cz|12345678/.test(r))).toBe(false);
  });
  it("se zapnutými osobami a kontakty i kontaktní osoby, doména a IČO", async () => {
    const settings = { ...DEFAULT_ANON_SETTINGS, redact: { ...ALL_REDACT } };
    const raw = (await gatherTerms(db, { jobId: "j1", settings })).raw.map((r) => r.toLowerCase());
    expect(raw).toEqual(expect.arrayContaining(["petr svoboda", "karel novák", "strojmetal.cz", "12345678"]));
  });
  it("vlastní termíny z Nastavení vždy; naše firma nikdy", async () => {
    const settings = { ...DEFAULT_ANON_SETTINGS, extraTerms: ["SAF-Projekt", "Mnástrojárna s.r.o."] };
    const raw = (await gatherTerms(db, { jobId: null, settings })).raw.map((r) => r.toLowerCase());
    expect(raw).toContain("saf-projekt");
    expect(raw.some((r) => r.includes("strojarna"))).toBe(false);
  });
});

describe("kandidát podle druhu a formátu", () => {
  it("3D model nikdy, DWG / DXF vždy, neznámý druh přes klasifikaci", () => {
    expect(isModel3d("model_3d", "dil.step")).toBe(true);
    expect(isModel3d("ostatni", "dil.STL")).toBe(true);
    expect(isModel3d("vykres", "vykres.dxf")).toBe(false);
    expect(needsDrawingCheck("ostatni", "x.pdf")).toBe(true);
    expect(needsDrawingCheck("foto", "x.jpg")).toBe(true);
    expect(needsDrawingCheck("vykres", "x.pdf")).toBe(false);
    expect(needsDrawingCheck("ostatni", "x.dxf")).toBe(false);
    expect(isAnonDrawingPath("vykresy/a.pdf")).toBe(true);
    expect(isAnonDrawingPath("vykresy/a.dwg")).toBe(true);
    expect(isAnonDrawingPath("vykresy/a.step")).toBe(false);
    expect(isAnonDrawingPath("vykresy/a.stl")).toBe(false);
    expect(isAnonCandidate("objednavka", "Objednávka zákazníka PO-E2E-4471.pdf", "application/pdf", "capture", "zakaznik")).toBe(false);
  });
});

// ── Celé PDF: jen název firmy, osoby a kontakty zůstanou, výsledek hotový ──

async function render(pdf: Uint8Array, dpi = 150): Promise<Raster> {
  const doc = await openPdf(pdf);
  const r = await renderPageRaster(await doc.getPage(1), dpi / 72, false);
  await doc.destroy();
  return r;
}
function box(x: number, y: number, w: number, size: number, r: Raster, H = A3[1], W = A3[0]) {
  const k = r.width / W;
  return { x: x * k, y: (H - y - size) * k, w: w * k, h: size * 1.25 * k };
}
function input(bytes: Uint8Array, over: Partial<PdfAnonInput> = {}): PdfAnonInput {
  return {
    bytes, ctx: ctx(), ai: null, verifyPhotos: true, fillPdf: "white", fillPhoto: "white", maxDpi: 150, maxMpx: 40,
    pageFrom: 1, deadline: Date.now() + 240_000, ...over,
  };
}

describe("vektorové PDF výkresu s výchozím nastavením (bez AI)", () => {
  it("smaže jen název firmy (i rozdělený a zalomený), jména, telefon, cesta a logo zůstanou; done", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false, company: "STROJMETAL a.s." });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    // poznámka v těle: název rozdělený do dvou textových položek a celý název zalomený na dva řádky
    page.drawText("Dodat pro: STROJ", { x: 60, y: 560, size: 9, font: helv, color: rgb(0, 0, 0) });
    page.drawText("METAL", { x: 60 + helv.widthOfTextAtSize("Dodat pro: STROJ", 9), y: 560, size: 9, font: helv, color: rgb(0, 0, 0) });
    page.drawText("Kovarna", { x: 60, y: 520, size: 9, font: helv });
    page.drawText("Hostice s.r.o.", { x: 60, y: 509, size: 9, font: helv });
    const pdf = await doc.save();

    const res = await anonymizePdf(input(pdf));
    expect(res.failure).toBeNull();
    expect(res.outputProblems).toEqual([]);
    const cats = new Set(res.pages[0].regions.map((r) => r.category));
    // jen firma / termín zákazníka — žádné osoby, kontakty, cesty, logo
    for (const c of cats) expect(["company", "custom"], [...cats].join(",")).toContain(c);
    const out = await render(res.partPdf!);
    const T = (k: string) => s.texts.find((t) => t.key === k)!;
    const ink = (t: { x: number; y: number; text: string; size: number }) => inkFraction(out, box(t.x, t.y, t.text.length * t.size * 0.5, t.size, out), 255);
    expect(ink(T("company"))).toBeLessThan(0.002);
    expect(ink(T("drawnBy"))).toBeGreaterThan(0.01);
    expect(ink(T("checkedBy"))).toBeGreaterThan(0.01);
    expect(ink(T("phone"))).toBeGreaterThan(0.01);
    expect(ink(T("path"))).toBeGreaterThan(0.005);
    expect(ink(T("drawingNumber"))).toBeGreaterThan(0.01);
    expect(ink(T("material"))).toBeGreaterThan(0.01);
    // logo (rastr) zůstává — kategorie logo je vypnutá
    expect(inkFraction(out, box(s.logo.x, s.logo.y, s.logo.w, s.logo.h / 1.25, out), 255)).toBeGreaterThan(0.05);
    // rozdělený název v poznámce pryč, popisek „Dodat pro:" zůstává
    const label = helv.widthOfTextAtSize("Dodat pro: ", 9);
    expect(inkFraction(out, box(60 + label + 2, 560, helv.widthOfTextAtSize("STROJMETAL", 9) - 4, 9, out), 255)).toBeLessThan(0.002);
    expect(inkFraction(out, box(60, 560, label - 6, 9, out), 255)).toBeGreaterThan(0.01);
    // zalomený název pryč na obou řádcích
    expect(inkFraction(out, box(60, 520, helv.widthOfTextAtSize("Kovarna", 9), 9, out), 255)).toBeLessThan(0.002);
    expect(inkFraction(out, box(60, 509, helv.widthOfTextAtSize("Hostice s.r.o.", 9), 9, out), 255)).toBeLessThan(0.002);
    const d = decideAnonStatus({
      mode: "approval", method: "raster_pdf", aiUsed: false, modelFallback: false, confidence: 1, ruleHitsCovered: !res.pages[0].residue,
      outputChecksPassed: true, verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false,
      warnings: res.warnings, customerStandard: res.customerStandard, termInKeep: res.termInKeep, titleBlockFound: res.pages[0].titleBlockFound,
    });
    expect(d.status).toBe("done");
  }, 120_000);

  it("neznámý druh (Ostatní): faktura / objednávka bez razítka a bez AI se NEanonymizuje, výkres ano", async () => {
    const inv = await anonymizePdf(input(await makeInvoicePdf(), { requireDrawing: true }));
    expect(inv.pages.every((p) => !p.included)).toBe(true);
    expect(inv.partPdf).toBeNull();
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const dr = await anonymizePdf(input(s.pdf, { requireDrawing: true }));
    expect(dr.pages[0].included).toBe(true);
    expect(dr.partPdf).toBeTruthy();
  }, 120_000);
});
