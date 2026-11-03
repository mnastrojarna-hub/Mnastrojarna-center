import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildForeignCompanyPdf } from "./__fixtures__/foreign-company-pdf.mjs";
import { anonymizePdf, textCompanyLeaks, type PdfAnonInput } from "./pdf-pipeline";
import { openPdf } from "./pdf-node";
import { contrastInkFraction, renderPageRaster, type Raster } from "./pdf-raster";
import { companyLeaks, companyNameFromHit, discoverCompanyNames, mergeNames, withCompanyNames } from "./company-names";
import { isCompanyLeak } from "./company-check";
import { fakeAnonCalls, resetFakeAnonCalls, setFakeAnonHandler, type FakeAnonRequest } from "./detect-ai";
import { COMPANY_LEAK_TEXT, accToDecide, decideAnonStatus, mergeBatch } from "./decide";
import { anonymizeDxf } from "./dxf";
import { DEFAULT_REDACT, isStandaloneCompanyLine, makeTerms, makeWordTerms, ownerNameEnd, rulePage, type RuleContext } from "./rules";
import { DETECTOR_VERSION } from "./settings";
import type { Box, TextItem, TextLine } from "./types";

/**
 * Majitel 2. 11.: „To anonymizování furt nefunguje — výkresy, které jsou vedeny jako anonymizované, mají furt
 * v hlavičce název firmy." Příčiny (ověřeno na korpusu __fixtures__/foreign-company-pdf.mjs):
 *  a) v razítku je JINÁ firma než zákazník zakázky v CRM (koncový zákazník / OEM / konstrukce) → nebyla termínem,
 *  a2) buňka s firmou nad popisky razítka ležela mimo zónu razítka („tělo") → právní forma jen kandidát pro AI,
 *  b) název jako křivky / font Type3 bez Unicode → žádná textová vrstva,
 *  c) holé jméno na druhém listu, rozsypané po znacích, doložka („© …" — jméno vlastníka vypnuté volbou),
 *  d) výstup vektorového PDF se na název firmy vůbec nekontroloval.
 * Tady: jen pipeline (bez DB) — bez AI, s testovací AI (názvy jako křivky) a výstupní kontrola obrazem.
 */

vi.setConfig({ testTimeout: 180_000 });

const KEEP = ["Mnástrojárna", "Mnastrojarna"];
/** Zakázka je pro Strojmetal (CRM) — v razítku je ale BRISK / KOVOTEX / HYDROTEK / ALFAPLAST. */
const CRM = ["Strojmetal a.s."];
const ctx = (): RuleContext => ({ terms: [...makeTerms(CRM, "crm", KEEP), ...makeWordTerms(CRM, "crm", KEEP)], keepTerms: KEEP, redact: { ...DEFAULT_REDACT } });
const AI = { apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 20 * 60_000, sha: "c".repeat(64) };

function input(bytes: Uint8Array, over: Partial<PdfAnonInput> = {}): PdfAnonInput {
  // číslo výkresu z vytěžení (service: ai_extracted) — keep pole
  return {
    bytes, ctx: ctx(), ai: null, verifyPhotos: true, fillPdf: "white", fillPhoto: "background", maxDpi: 150, maxMpx: 40, pageFrom: 1, deadline: Date.now() + 600_000,
    keepValues: { drawingNumber: fx.drawingNumber }, ...over,
  };
}

async function renderAll(pdf: Uint8Array, s = 2): Promise<Raster[]> {
  const doc = await openPdf(pdf, { requireFonts: false });
  const out: Raster[] = [];
  for (let p = 1; p <= doc.numPages; p++) out.push(await renderPageRaster(await doc.getPage(p), s, false));
  await doc.destroy();
  return out;
}
const ink = (r: Raster, b: Box, s = 2) => contrastInkFraction(r, { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s });

type Fixture = Awaited<ReturnType<typeof buildForeignCompanyPdf>>;
let fx: Fixture;
let fakeDir = "";
let prevFake: string | undefined;
beforeAll(async () => {
  fx = await buildForeignCompanyPdf({ stamp: "T1" });
  prevFake = process.env.AI_FAKE_ANON;
  fakeDir = mkdtempSync(path.join(os.tmpdir(), "anon-cizi-"));
  process.env.AI_FAKE_ANON = fakeDir;
});
afterAll(() => {
  if (prevFake === undefined) delete process.env.AI_FAKE_ANON;
  else process.env.AI_FAKE_ANON = prevFake;
});
afterEach(() => {
  setFakeAnonHandler(null);
  resetFakeAnonCalls();
});

/** Testovací AI vektorové stránky: názvy, které nemají textovou vrstvu (křivky, Type3) — v bodech stránky. */
function vectorWithCompanies(f: Fixture, labels: RegExp) {
  return {
    pages: [1, 2].map((p) => ({
      index: p, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [],
      companies: f.gone.filter((g) => g.page === p && labels.test(g.label)).map((g) => ({
        pt: g.box, role: "designer", form: /křivky|bez Unicode/.test(g.label) ? "curves" : "text",
        text: /křivky/.test(g.label) ? "KOVOTEX" : /bez Unicode/.test(g.label) ? "ALFAPLAST" : "HYDROTEK S.R.O.",
      })),
    })),
    confidence: 0.95,
  };
}

describe("pravidla: firma z výkresu (ne z CRM)", () => {
  const C = ctx();
  it("samostatný řádek s firmou × kusovník / výrobce / věta", () => {
    for (const t of ["BRISK Tábor a.s.", "Robert Bosch GmbH, Stuttgart", "Firma: ACME Engineering s.r.o.", "Müller & Söhne GmbH & Co. KG"]) expect(isStandaloneCompanyLine(t), t).toBe(true);
    for (const t of ["Výrobce: SKF GmbH", "2 ks Lozisko SKF GmbH", "Povrch dle normy firmy ACME GmbH", "pozink Wiegel GmbH", "s.r.o.", "Netolerovane rozmery ISO 2768-mK"]) {
      expect(isStandaloneCompanyLine(t), t).toBe(false);
    }
  });
  it("jméno vlastníka v doložce: jen název (bez roku a věty)", () => {
    const t = "© Strojmetal 2024 — rozmnožování zakázáno";
    expect(t.slice(2, ownerNameEnd(t, 2, t.length))).toBe("Strojmetal");
    const u = "© BRISK Tabor a.s. - Vykres je dusevnim vlastnictvim.";
    expect(u.slice(2, ownerNameEnd(u, 2, u.length))).toBe("BRISK Tabor a.s.");
  });
  it("jméno z úseku: do konce právní formy; hodnota pole bez právní formy není jisté jméno", () => {
    expect(companyNameFromHit("BRISK Tábor a.s., Vožická 2068, 390 02 Tábor", "legal_form")).toBe("BRISK Tábor a.s.");
    expect(companyNameFromHit("© BRISK Tabor a.s. - Vykres je…", "legal_form")).toBe("BRISK Tabor a.s.");
    expect(companyNameFromHit("Hydraulický lis HL-200", "company_label")).toBeNull();
    expect(companyNameFromHit("Bosch", "copyright_owner")).toBe("Bosch");
    expect(companyNameFromHit("1.4301", "legal_form")).toBeNull();
  });
  it("DXF / holé texty: firma z razítka i doložky; naše firma ne", () => {
    const names = discoverCompanyNames([
      { text: "BRISK Tábor a.s.", zone: "title_block" }, { text: "© Robert Bosch GmbH 2024", zone: "title_block" },
      { text: "Výroba: Mnastrojarna s.r.o.", zone: "title_block" }, { text: "Projekt: Hydraulický lis", zone: "title_block" },
    ], C);
    expect(names).toEqual(expect.arrayContaining(["BRISK Tábor a.s.", "Robert Bosch GmbH"]));
    expect(names.join("|")).not.toMatch(/Mnastrojarna|Hydraulick/);
    expect(mergeNames(["BRISK Tábor a.s."], ["BRISK TABOR", "Bosch"])).toEqual(["BRISK Tábor a.s.", "Bosch"]);
  });
  it("jména z výkresu → termíny kdekoli (holé „BRISK“ na 2. listu); bez volby firma nic", () => {
    const c2 = withCompanyNames(C, ["BRISK Tábor a.s."]);
    expect(companyLeaks("BRISK", "body", c2)).toHaveLength(1);
    expect(companyLeaks("B R I S K", "body", c2)).toHaveLength(1);
    expect(companyLeaks("Kooperace: Mnastrojarna s.r.o.", "title_block", c2)).toEqual([]);
    expect(withCompanyNames({ ...C, redact: { ...C.redact, company: false } }, ["BRISK"]).terms).toHaveLength(C.terms.length);
  });
  it("výstupní kontrola textu: co po vypálení zbylo, je pořád firma → boxy znaků; vypálené / keep → nic", () => {
    const it0: TextItem = { id: "i1", page: 1, str: "BRISK Tábor a.s.", x: 100, y: 100, w: 120, h: 12, fontSize: 12, rot: 0, source: "text" };
    const line: TextLine = { id: "p1:L1", page: 1, text: it0.str, spans: [{ itemId: "i1", start: 0, end: it0.str.length, offset: 0 }], box: { x: 100, y: 100, w: 120, h: 12 }, fontSize: 12, rot: 0, zone: "title_block" };
    const byId = new Map([["i1", it0]]);
    const leaks = textCompanyLeaks([line], C, [], [], byId);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].box.x).toBeGreaterThanOrEqual(99);
    expect(textCompanyLeaks([line], C, [{ x: 95, y: 95, w: 130, h: 22 }], [], byId)).toEqual([]);
    expect(textCompanyLeaks([line], C, [], [{ x: 95, y: 95, w: 130, h: 22 }], byId)).toEqual([]);
    // vypálená jen polovina → zbytek „Tábor a.s." je pořád firma
    expect(textCompanyLeaks([line], C, [{ x: 95, y: 95, w: 40, h: 22 }], [], byId)).toHaveLength(1);
  });
  it("kusovník nad razítkem: výrobce zůstává (pravidla stránky)", () => {
    const mk = (id: string, text: string, x: number, y: number): TextLine => ({ id, page: 1, text, spans: [], box: { x, y, w: 60, h: 7 }, fontSize: 7, rot: 0, zone: "body" });
    const r = rulePage([mk("a", "1", 600, 500), mk("b", "Lozisko 6205-2RS", 630, 500), mk("c", "2 ks", 800, 500), mk("d", "SKF GmbH", 900, 500), mk("e", "BRISK Tábor a.s.", 600, 560)], C);
    expect(r.hits.filter((h) => h.lineId === "d")).toEqual([]);
    expect(r.hits.some((h) => h.lineId === "e" && h.category === "company")).toBe(true);
  });
  it("nález AI ve výstupu: únik jen firma k smazání (ne naše, ne norma, logo bez textu jen s volbou)", () => {
    expect(isCompanyLeak({ role: "owner", text: "BRISK Tábor a.s.", form: "text" }, KEEP, false)).toBe(true);
    expect(isCompanyLeak({ role: "ours", text: "Mnástrojárna", form: "text" }, KEEP, false)).toBe(false);
    expect(isCompanyLeak({ role: "other_company", text: "Mnastrojarna s.r.o.", form: "text" }, KEEP, false)).toBe(false);
    expect(isCompanyLeak({ role: "referenced_maker", text: "SKF", form: "text" }, KEEP, false)).toBe(false);
    expect(isCompanyLeak({ role: "other_company", text: "ISO 2768-mK", form: "text" }, KEEP, false)).toBe(false);
    expect(isCompanyLeak({ role: "owner", text: "", form: "logo" }, KEEP, false)).toBe(false);
    expect(isCompanyLeak({ role: "owner", text: "", form: "logo" }, KEEP, true)).toBe(true);
    expect(isCompanyLeak({ role: "designer", text: "", form: "curves" }, KEEP, false)).toBe(true);
  });
  it("nová verze detektoru → staré kopie se přepočítají (config hash)", () => {
    expect(DETECTOR_VERSION).toBe("anon-v2.0");
  });
});

describe("PDF: firma v razítku není zákazník z CRM", () => {
  it("bez AI: firma v razítku, doložka, natočený text, holé jméno na 2. listu a rozsypané znaky pryč; technika a naše firma zůstanou", async () => {
    const res = await anonymizePdf(input(fx.bytes));
    expect(res.failure).toBeNull();
    expect(res.outputProblems).toEqual([]);
    expect(res.companyNames.join("|")).toMatch(/BRISK T[aá]bor a\.s\./);
    const out = await renderAll(res.partPdf!);
    for (const g of fx.gone.filter((x) => !/křivky|Type3/.test(x.label))) expect(ink(out[g.page - 1], g.box), g.label).toBeLessThan(0.003);
    for (const k of fx.kept) expect(ink(out[k.page - 1], k.box), k.label).toBeGreaterThan(0.05);
  });

  it("s AI: název jako křivky a ve fontu Type3 (i bez Unicode) se vypálí podle boxu; výstup ověřen obrazem", async () => {
    const seen: FakeAnonRequest[] = [];
    setFakeAnonHandler((req) => {
      seen.push(req);
      return req.call === "vector" ? vectorWithCompanies(fx, /křivky|Type3/) : null;
    });
    const res = await anonymizePdf(input(fx.bytes, { ai: AI }));
    expect(res.failure).toBeNull();
    expect(res.outputProblems).toEqual([]);
    const out = await renderAll(res.partPdf!);
    for (const g of fx.gone) expect(ink(out[g.page - 1], g.box), g.label).toBeLessThan(0.003);
    for (const k of fx.kept) expect(ink(out[k.page - 1], k.box), k.label).toBeGreaterThan(0.05);
    // výstupní kontrola obrazem: jedna na stránku, s přehledem a výřezem razítka VÝSTUPU
    expect(fakeAnonCalls("company_check")).toBe(2);
    const chk = seen.find((r) => r.call === "company_check")!;
    expect(chk.images.map((i) => i.kind)).toEqual(["overview", "crop"]);
    expect(res.pages.every((p) => !p.companyLeak)).toBe(true);
  });

  it("kontrola obrazem najde zbylý název (AI ho v detekci přehlédla) → vypálí se a ověří znovu", async () => {
    const curves = fx.gone.find((g) => /křivky/.test(g.label))!;
    let checks = 0;
    setFakeAnonHandler((req) => {
      if (req.call === "vector") return vectorWithCompanies(fx, /Type3/);
      if (req.call !== "company_check" || !req.images.length) return null;
      checks++;
      const ov = req.images[0];
      // jen 1. kontrola strany 1: „KOVOTEX" (křivky) je pořád vidět
      if (checks !== 1) return { items: [] };
      const s = ov.s * (150 / 72);
      return { items: [{ img: 0, x: Math.round(curves.box.x * s), y: Math.round(curves.box.y * s), w: Math.round(curves.box.w * s), h: Math.round(curves.box.h * s), text: "KOVOTEX", role: "designer", form: "curves" }] };
    });
    const res = await anonymizePdf(input(fx.bytes, { ai: AI }));
    expect(res.outputProblems).toEqual([]);
    expect(res.warnings.some((w) => w.code === "verify_leak" && /doplněno/.test(w.message))).toBe(true);
    const out = await renderAll(res.partPdf!);
    expect(ink(out[0], curves.box)).toBeLessThan(0.003);
    expect(checks).toBe(3); // strana 1: kontrola + opakovaná kontrola, strana 2: kontrola
  });

  it("název ve výstupu zůstane (opakovaně, nebo přes číslo výkresu) → kopie neprošla, stav selhalo s důvodem", async () => {
    const dn = fx.kept.find((k) => k.label === "číslo výkresu")!;
    for (const variant of ["always", "keep"] as const) {
      resetFakeAnonCalls();
      setFakeAnonHandler((req) => {
        if (req.call === "vector") return vectorWithCompanies(fx, /křivky|Type3/);
        if (req.call !== "company_check") return null;
        const ov = req.images[0];
        const s = ov.s * (150 / 72);
        const b = variant === "keep" ? dn.box : { x: 900, y: 650, w: 80, h: 14 };
        return { items: [{ img: 0, x: Math.round(b.x * s), y: Math.round(b.y * s), w: Math.round(b.w * s), h: Math.round(b.h * s), text: "BRISK", role: "owner", form: "text" }] };
      });
      const res = await anonymizePdf(input(fx.bytes, { ai: AI }));
      expect(res.pages.some((p) => p.companyLeak), variant).toBe(true);
      expect(res.outputProblems.join("|"), variant).toMatch(/zůstal název firmy/);
      const acc = mergeBatch(null, {
        warnings: res.warnings, residue: false, outputOk: res.outputProblems.length === 0, customerStandard: false, termInKeep: false, confidence: 0.95,
        aiUsed: true, hasIncluded: true, fallback: false, titleBlockFound: true, verifyClean: null, verifyKeepMissing: false,
      });
      const d = decideAnonStatus({ ...accToDecide(acc, { method: "raster_pdf" }), mode: "full" });
      expect(d.status, variant).toBe("failed");
      expect(d.reason).toBe(COMPANY_LEAK_TEXT);
      // číslo výkresu se nikdy nevypálí
      if (variant === "keep") expect(ink((await renderAll(res.partPdf!))[0], dn.box)).toBeGreaterThan(0.05);
    }
  });
});

describe("DXF: firma z razítka (ne z CRM) i holé jméno v jiné entitě", () => {
  const dxf = (pairs: [number, string][]) => pairs.map(([c, v]) => `${String(c).padStart(3, " ")}\n${v}`).join("\n") + "\n";
  it("BRISK Tábor a.s. v razítku → i holé „BRISK“ v poznámce pryč; kóta zůstane; ověřeno", () => {
    const src = dxf([
      [0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"],
      [0, "TEXT"], [8, "0"], [10, "100.0"], [20, "40.0"], [40, "3.5"], [1, "BRISK Tábor a.s."],
      [0, "TEXT"], [8, "0"], [10, "10.0"], [20, "10.0"], [40, "2.5"], [1, "BRISK"],
      [0, "TEXT"], [8, "0"], [10, "200.0"], [20, "30.0"], [40, "2.5"], [1, "%%c25 h7"],
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    const r = anonymizeDxf(new TextEncoder().encode(src), ctx());
    const out = new TextDecoder().decode(r.bytes!);
    expect(out).not.toMatch(/BRISK|Tábor/);
    expect(out).toContain("%%c25 h7");
    expect(r.verified).toBe(true);
  });
});
