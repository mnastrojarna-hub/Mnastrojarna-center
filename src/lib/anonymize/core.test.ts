import { describe, it, expect } from "vitest";
import { fitForClaude, CLAUDE_MAX_PIXELS, CLAUDE_MAX_SIDE, cropFor, toSource, toSent, boxInsideSent } from "./claude-image";
import { buildLines, lineRangeToItems, substringQuad } from "./lines";
import { textQuality } from "./text-quality";
import { applyManual, areaCapWarning, describeSummary, mergeRegions, normalizeRegion, padQuad, padRegion, protectKeep, summarize, type RawRegion } from "./regions";
import { anonFilename, dedupeNames, cleanNamePart } from "./filename";
import { decideAnonStatus, type DecideInput } from "./decide";
import { pickShareFile, verifyShareBytes, type FileRowWithAnon } from "./share";
import { checkTranscript, keepPresent, lineHasToken } from "./verify";
import { isAnonCandidate, isUnsupportedExt, sourceFormat } from "./candidate";
import { DEFAULT_REDACT, makeTerms, rulePage, findTermRanges, makeTerm, type RuleContext } from "./rules";
import { levenshtein, normalizeWithMap, mapRangeBack } from "./text";
import { settingsFromRow, settingsToRow, configHash, termsHash, DEFAULT_ANON_SETTINGS } from "./settings";
import type { AnonRegion, TextItem } from "./types";

const ctx = (terms: string[] = []): RuleContext => ({ terms: makeTerms(terms, "crm"), keepTerms: ["Mnástrojárna"], redact: { ...DEFAULT_REDACT } });

describe("fitForClaude", () => {
  const cases: [number, number][] = [[4032, 3024], [4961, 3508], [2576, 1932], [4032, 240], [300, 200], [20000, 100], [100, 20000], [2576, 2576]];
  it.each(cases)("%i×%i — meze po zaokrouhlení", (w, h) => {
    const f = fitForClaude(w, h);
    expect(f.w).toBeLessThanOrEqual(CLAUDE_MAX_SIDE);
    expect(f.h).toBeLessThanOrEqual(CLAUDE_MAX_SIDE);
    expect(f.w * f.h).toBeLessThanOrEqual(CLAUDE_MAX_PIXELS);
    expect(f.s).toBeLessThanOrEqual(1);
  });
  it("malý výřez se nezvětší (maxUpscale 1)", () => {
    expect(fitForClaude(300, 200)).toEqual({ s: 1, w: 300, h: 200 });
  });
  it("2576×1932 se zmenší pod 3,75 MPx", () => {
    const f = fitForClaude(2576, 1932);
    expect(f.s).toBeLessThan(1);
  });
  it("přepočet souřadnic tam a zpět", () => {
    const c = cropFor(1000, 500, 3000, 2000);
    const [sx, sy] = toSent(c, 1500, 900);
    const [x, y] = toSource(c, sx, sy);
    expect(x).toBeCloseTo(1500, 6);
    expect(y).toBeCloseTo(900, 6);
  });
  it("box mimo obrázek (> 1 %) se odmítne", () => {
    expect(boxInsideSent({ outW: 1000, outH: 800 }, 990, 10, 15, 10)).toBe(true);
    expect(boxInsideSent({ outW: 1000, outH: 800 }, 1000, 10, 20, 10)).toBe(false);
    expect(boxInsideSent({ outW: 1000, outH: 800 }, 10, 10, -5, 10)).toBe(false);
  });
});

const item = (id: string, str: string, x: number, y: number, size = 10, rot = 0): TextItem => ({
  id, page: 1, str, x, y: y - size, w: str.length * size * 0.5, h: size, fontSize: size, rot, source: "text", ox: x, oy: y, adv: str.length * size * 0.5,
});

describe("skládání řádků", () => {
  it("po znacích rozsypaný řádek se složí a termín se najde", () => {
    const letters = "STROJMETAL".split("").map((c, i) => item(`i${i}`, c, 100 + i * 5.2, 200));
    const lines = buildLines([...letters, item("x", "Kreslil:", 100, 260)], 1, () => "title_block");
    const l = lines.find((x) => x.text.startsWith("STROJ"))!;
    expect(l.text).toBe("STROJMETAL");
    expect(l.spans).toHaveLength(10);
    const t = makeTerm("Strojmetal", "crm")!;
    expect(findTermRanges(l.text, t)).toEqual([{ start: 0, end: 10 }]);
    const parts = lineRangeToItems(l, 2, 5);
    expect(parts.map((p) => p.itemId)).toEqual(["i2", "i3", "i4"]);
  });
  it("mezera mezi slovy (≥ 0,15 em) = mezera v textu; velká mezera = nový řádek", () => {
    const lines = buildLines([item("a", "Kreslil:", 100, 200), item("b", "J. Novák", 142.5, 200), item("c", "12.3.2024", 300, 200)], 1, () => "body");
    expect(lines.map((l) => l.text)).toEqual(["Kreslil: J. Novák", "12.3.2024"]);
  });
  it("podřetězec natočené položky dává natočený čtyřúhelník", () => {
    const q = substringQuad(item("r", "STROJMETAL", 100, 200, 10, 90), 0, 5, 0);
    expect(Math.abs(q[2] - q[0])).toBeLessThan(1e-6); // směr textu svisle
  });
});

describe("kvalita textové vrstvy", () => {
  it("PUA / řídicí znaky → nedůvěryhodné", () => {
    expect(textQuality({ strings: ["", "\u0001\u0002"], hasTitleAnchors: true }).trustworthy).toBe(false);
  });
  it("razítko bez kotev s inkoustem → nedůvěryhodné", () => {
    expect(textQuality({ strings: ["abc", "def"], hasTitleAnchors: false, titleBlockInk: true }).trustworthy).toBe(false);
  });
  it("běžný text → důvěryhodné", () => {
    expect(textQuality({ strings: ["Kreslil:", "J. Novák", "Materiál 1.4301"], hasTitleAnchors: true }).trustworthy).toBe(true);
  });
  it("bez ToUnicode → nižší skóre", () => {
    expect(textQuality({ strings: ["a", "b", "c", "d"], noToUnicodeItems: 4, hasTitleAnchors: true }).trustworthy).toBe(false);
  });
});

const raw = (x: number, y: number, w: number, h: number, over: Partial<RawRegion> = {}): RawRegion => ({ page: 1, box: { x, y, w, h }, category: "company", source: "rule", zone: "title_block", textHeight: 10, ...over });

describe("oblasti", () => {
  it("odsazení vektoru 0,6/0,25 em, fotky min 6 px", () => {
    const v = padRegion(raw(100, 100, 50, 10), "vector", 1000, 1000);
    expect(v.box).toEqual({ x: 94, y: 97.5, w: 62, h: 15 });
    const p = padRegion(raw(100, 100, 50, 10, { textHeight: 4 }), "photo", 1000, 1000);
    expect(p.box.x).toBe(94);
  });
  it("čtyřúhelník se odsadí kolmo k hranám", () => {
    const q = padQuad([0, 0, 10, 0, 10, 5, 0, 5], 1, 2);
    expect(q).toEqual([-2, -1, 12, -1, 12, 6, -2, 6]);
  });
  it("sjednocení při překryvu (priorita kategorií), grafika zvlášť", () => {
    const m = mergeRegions([raw(0, 0, 10, 10, { category: "person" }), raw(5, 0, 10, 10, { category: "custom" }), raw(8, 0, 4, 4, { category: "logo", textHeight: 0 })]);
    expect(m).toHaveLength(2);
    expect(m.find((r) => r.textHeight > 0)?.category).toBe("custom");
  });
  it("nesjednocuje přes keep pole", () => {
    const keep = [{ page: 1, box: { x: 11, y: 0, w: 2, h: 10 }, field: "drawingNumber" as const }];
    expect(mergeRegions([raw(0, 0, 11, 10), raw(13, 0, 10, 10)], keep)).toHaveLength(2);
  });
  it("ochrana keep pole: ořez o hranu", () => {
    const keep = [{ page: 1, box: { x: 50, y: 0, w: 40, h: 10 }, field: "drawingNumber" as const }];
    const r = protectKeep([raw(0, 0, 55, 10)], keep, "vector");
    expect(r.regions[0].box.w).toBe(50);
  });
  it("strop plochy → review", () => {
    expect(areaCapWarning([raw(0, 0, 500, 500)], 1000, 1000, null, 1)?.code).toBe("area_cap");
    expect(areaCapWarning([raw(0, 0, 10, 10)], 1000, 1000, null, 1)).toBeNull();
  });
  it("ruční přednost: removed ruší i pravidlo, added zůstává", () => {
    const a = normalizeRegion(raw(100, 100, 50, 10), 1000, 1000, "r1")!;
    const b = normalizeRegion(raw(300, 300, 50, 10), 1000, 1000, "r2")!;
    const removed: AnonRegion = { ...a, id: "other", manual: "removed" };
    const added: AnonRegion = { ...b, id: "m1", x: 0.5, y: 0.5, manual: "added", source: "manual" };
    const out = applyManual([a, b], [removed, added]);
    expect(out.map((r) => r.id)).toEqual(["r2", "m1"]);
  });
  it("normalizace: ořez 0..1, zaokrouhlení 1e-5", () => {
    const n = normalizeRegion(raw(-10, 0.123456789, 30, 10), 100, 100, "x")!;
    expect(n.x).toBe(0);
    expect(n.y).toBe(0.00123);
  });
  it("souhrn a popis", () => {
    const s = summarize([{ id: "1", page: 1, x: 0, y: 0, w: 1, h: 1, category: "company", source: "rule", zone: "title_block" }, { id: "2", page: 1, x: 0, y: 0, w: 1, h: 1, category: "person", source: "rule", zone: "title_block" }, { id: "3", page: 1, x: 0, y: 0, w: 1, h: 1, category: "person", source: "ai", zone: "title_block" }]);
    expect(describeSummary(s)).toBe("firma, 2 jména (3 oblasti)");
  });
});

describe("anonymní názvy", () => {
  it("číslo, revize, list", () => {
    expect(anonFilename({ drawingNumber: "12-345", revision: "B", sheet: 1, ext: "pdf" }).filename).toBe("12-345_B_l1.pdf");
  });
  it("zakázané znaky a délka", () => {
    expect(cleanNamePart('a/b\\c:d*e?"f<g>h|i')).toBe("abcdefghi");
    expect(anonFilename({ drawingNumber: "x".repeat(200), ext: "pdf" }).filename.length).toBeLessThanOrEqual(84);
  });
  it("termín v čísle → review a náhradní název", () => {
    const r = anonFilename({ drawingNumber: "STM-1234", ext: "pdf", jobNumber: "Z-2026-012", index: 2, terms: makeTerms(["STM"], "custom") });
    expect(r.review).toBeTruthy();
    expect(r.filename).toBe("Z-2026-012-V2.pdf");
  });
  it("bez čísla → <zakázka>-V<n>, nikdy původní název", () => {
    expect(anonFilename({ ext: "jpg", jobNumber: "Z-1", index: 3 }).filename).toBe("Z-1-V3.jpg");
  });
  it("kolize → -2", () => {
    expect(dedupeNames(["a.pdf", "A.pdf", "a.pdf"])).toEqual(["a.pdf", "A-2.pdf", "a-3.pdf"]);
  });
});

const base: DecideInput = {
  mode: "full", method: "raster_pdf", aiUsed: true, modelFallback: false, confidence: 0.95, ruleHitsCovered: true, outputChecksPassed: true,
  verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false, warnings: [], customerStandard: false,
  termInKeep: false, titleBlockFound: true,
};

describe("decideAnonStatus", () => {
  it("vše splněno → done", () => expect(decideAnonStatus(base).status).toBe("done"));
  it.each<[string, Partial<DecideInput>]>([
    ["approval", { mode: "approval" }],
    ["bez AI", { aiUsed: false }],
    ["fallback modelu", { modelFallback: true }],
    ["nízká jistota", { confidence: 0.6 }],
    ["zbytky", { ruleHitsCovered: false }],
    ["kontrola výstupu", { outputChecksPassed: false }],
    ["podniková norma", { customerStandard: true }],
    ["termín v keep", { termInKeep: true }],
    ["bez razítka", { titleBlockFound: false, confidence: 0.86 }],
    ["DXF v1", { method: "dxf" }],
    ["fotka bez masteru", { isPhoto: true, hasMaster: false, verifyClean: true, verifyKeepPresent: true, pxPerMm: 9 }],
    ["fotka: únik", { isPhoto: true, hasMaster: true, verifyClean: false, verifyKeepPresent: true, pxPerMm: 9 }],
    ["fotka: chybí keep", { isPhoto: true, hasMaster: true, verifyClean: true, verifyKeepPresent: false, pxPerMm: 9 }],
    ["fotka: px/mm < 6", { isPhoto: true, hasMaster: true, verifyClean: true, verifyKeepPresent: true, pxPerMm: 4.8 }],
    ["fotka neověřená", { isPhoto: true, hasMaster: true, verifyClean: null, pxPerMm: 9 }],
    ["souřadnice mimo", { warnings: [{ code: "coords_out_of_image", message: "x" }] }],
  ])("%s → review", (_n, over) => expect(decideAnonStatus({ ...base, ...over }).status).toBe("review"));
  it("bez razítka s jistotou ≥ 0,9 → done", () => expect(decideAnonStatus({ ...base, titleBlockFound: false, confidence: 0.92 }).status).toBe("done"));
  it("fotka v pořádku → done", () => expect(decideAnonStatus({ ...base, method: "image", isPhoto: true, hasMaster: true, verifyClean: true, verifyKeepPresent: true, pxPerMm: 8 }).status).toBe("done"));
  it("unsupported / failed / limit / není výkres", () => {
    expect(decideAnonStatus({ ...base, unsupported: "DWG" }).status).toBe("unsupported");
    expect(decideAnonStatus({ ...base, failure: "x" }).status).toBe("failed");
    expect(decideAnonStatus({ ...base, budgetExceeded: true }).status).toBe("pending");
    expect(decideAnonStatus({ ...base, notDrawing: true }).status).toBe("skipped");
  });
});

const row = (over: Partial<FileRowWithAnon> = {}): FileRowWithAnon => ({
  id: "f1", job_id: "11111111-1111-1111-1111-111111111111", kind: "vykres", filename: "12-345.pdf", mime_type: "application/pdf", storage_path: "zakazky/11111111-1111-1111-1111-111111111111/x-12-345.pdf",
  origin: "upload", issuer: null, anon_status: "done", anon_path: "zakazky/11111111-1111-1111-1111-111111111111/anon/y-12-345.pdf", anon_filename: "12-345.pdf", anon_mime: "application/pdf", anon_sha256: "a".repeat(64), ...over,
});

describe("pickShareFile (matice)", () => {
  it("náš doklad → originál", () => {
    expect(pickShareFile(row({ origin: "generated", anon_status: null }))).toMatchObject({ ok: true, source: "original" });
    expect(pickShareFile(row({ issuer: "my", anon_status: null }))).toMatchObject({ ok: true, source: "original" });
  });
  it("done → anon", () => expect(pickShareFile(row())).toMatchObject({ ok: true, source: "anon", filename: "12-345.pdf" }));
  it("review jen s potvrzením", () => {
    expect(pickShareFile(row({ anon_status: "review" }))).toMatchObject({ ok: false, reason: "review" });
    expect(pickShareFile(row({ anon_status: "review" }), { reviewedByCaller: true })).toMatchObject({ ok: true, source: "anon" });
  });
  it.each(["pending", "processing", null] as const)("%s → pending (fronta)", (st) => {
    expect(pickShareFile(row({ anon_status: st }))).toMatchObject({ ok: false, reason: "pending" });
  });
  it("failed / unsupported", () => {
    expect(pickShareFile(row({ anon_status: "failed" }))).toMatchObject({ ok: false, reason: "failed" });
    expect(pickShareFile(row({ anon_status: "unsupported" }))).toMatchObject({ ok: false, reason: "excluded" });
  });
  it("skipped: poptávka nikdy originál, jinak s potvrzením", () => {
    expect(pickShareFile(row({ kind: "poptavka", anon_status: "skipped" }), { confirmNotCustomerMaterial: true })).toMatchObject({ ok: false, reason: "excluded" });
    expect(pickShareFile(row({ anon_status: "skipped" }))).toMatchObject({ ok: false, reason: "needs_confirm" });
    expect(pickShareFile(row({ anon_status: "skipped" }), { confirmNotCustomerMaterial: true })).toMatchObject({ ok: true, source: "original" });
  });
  it("original:true → audit; poptávka zákazníka jen super admin", () => {
    expect(pickShareFile(row(), { original: true })).toMatchObject({ ok: true, source: "original", audit: true });
    expect(pickShareFile(row({ kind: "objednavka" }), { original: true })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(pickShareFile(row({ kind: "objednavka" }), { original: true, isSuperAdmin: true })).toMatchObject({ ok: true, audit: true });
  });
  it("externí ne-kandidát bez stavu (faktura, ZIP z e-mailu) → jen po potvrzení a s auditem", () => {
    expect(pickShareFile(row({ kind: "faktura", anon_status: null }))).toMatchObject({ ok: false, reason: "needs_confirm" });
    expect(pickShareFile(row({ kind: "ostatni", filename: "podklady.zip", mime_type: "application/zip", anon_status: null }))).toMatchObject({ ok: false, reason: "needs_confirm" });
    expect(pickShareFile(row({ kind: "faktura", anon_status: null }), { confirmNotCustomerMaterial: true })).toMatchObject({ ok: true, source: "original", audit: true });
    // skipped + potvrzení → originál s auditem
    expect(pickShareFile(row({ kind: "vykres", anon_status: "skipped" }), { confirmNotCustomerMaterial: true })).toMatchObject({ ok: true, source: "original", audit: true });
    // náš doklad (generated) dál bez potvrzení a bez auditu
    expect(pickShareFile(row({ kind: "faktura", origin: "generated", anon_status: null }))).toMatchObject({ ok: true, source: "original" });
    expect(pickShareFile(row({ kind: "faktura", origin: "generated", anon_status: null }))).not.toHaveProperty("audit");
  });
  it("ne-kandidát bez stavu s potvrzením → originál", () => {
    expect(pickShareFile(row({ kind: "faktura", anon_status: null }), { confirmNotCustomerMaterial: true })).toMatchObject({ ok: true, source: "original" });
  });
  it("verifyShareBytes: prefix a sha", async () => {
    const bytes = new TextEncoder().encode("abc");
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const db = { storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) } };
    const r = row({ anon_sha256: sha });
    await expect(verifyShareBytes(db, pickShareFile(r), r)).resolves.toEqual(bytes);
    const tampered = row({ anon_sha256: "b".repeat(64) });
    await expect(verifyShareBytes(db, pickShareFile(tampered), tampered)).rejects.toThrow(/změněna/);
    const wrongPrefix = row({ anon_sha256: sha, anon_path: "zakazky/11111111-1111-1111-1111-111111111111/x-12-345.pdf" });
    await expect(verifyShareBytes(db, pickShareFile(wrongPrefix), wrongPrefix)).rejects.toThrow(/nečekaném místě/);
  });
});

describe("ověření přepisem", () => {
  it("Levenshtein ≤ 1 na tokenech ≥ 4", () => {
    expect(levenshtein("strojmetal", "strojmetai")).toBe(1);
    expect(lineHasToken("STR0JMETAL a.s.", ["strojmetal"])).toBe("strojmetal");
    expect(lineHasToken("Hřídel vstupní", ["strojmetal"])).toBeNull();
  });
  it("keep hodnoty přítomné (i s drobnou chybou přepisu)", () => {
    expect(keepPresent(["Číslo výkresu D-1234-01"], "D-1234-01")).toBe(true);
    expect(keepPresent(["D-l234-01"], "D-1234-01")).toBe(true);
    expect(keepPresent(["nic"], "D-1234-01")).toBe(false);
  });
  it("únik citlivého řetězce, termínu, zásahu pravidla a loga v razítku", () => {
    const o = checkTranscript({
      tiles: [{ img: 0, zone: "title_block", lines: ["Kreslil:", "Novak", "info@x.cz", "ACME GmbH"], graphics: [{ quad: [0, 0, 1, 0, 1, 1, 0, 1], description: "logo firmy" }, { quad: [0, 0, 1, 0, 1, 1, 0, 1], description: "symbol promítání" }] }],
      sensitive: ["J. Novák"], ctx: ctx(["ACME"]), keepValues: ["D-1"],
    });
    expect(o.clean).toBe(false);
    // slovo termínu („ACME") je citlivý token vždy (i když by bylo v ponechaném řádku)
    expect(o.leaks.map((l) => l.kind).sort()).toEqual(["graphic", "rule", "sensitive", "sensitive"]);
    expect(o.leaks.some((l) => l.token === "acme")).toBe(true);
    expect(o.missingKeep).toEqual(["D-1"]);
  });
});

describe("kandidát (TS zrcadlo SQL)", () => {
  it.each<[string, string, string | null, string | null, string | null, boolean]>([
    ["ostatni", "12-345.pdf", "application/pdf", "upload", null, true],
    ["foto", "IMG_1.jpg", "image/jpeg", "capture", null, true],
    ["vykres", "x.dwg", null, "email", null, true],
    ["vykres", "x.dxf", null, "email", null, true],
    ["poptavka", "x.pdf", "application/pdf", "email", "zakaznik", true],
    ["nabidka", "x.pdf", "application/pdf", "generated", "my", false],
    ["vykres", "x.pdf", "application/pdf", "generated", null, false],
    ["faktura", "x.pdf", "application/pdf", "email", null, false],
    ["vykres", "x.docx", null, "upload", null, false],
  ])("%s %s %s %s %s → %s", (kind, fn, mime, origin, issuer, exp) => {
    expect(isAnonCandidate(kind, fn, mime, origin, issuer)).toBe(exp);
  });
  it("formát podle hlavičky", () => {
    expect(sourceFormat("x.bin", null, new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe("pdf");
    expect(sourceFormat("x.jpg", "image/jpeg")).toBe("image");
    expect(sourceFormat("x.step", null)).toBe("step");
    expect(isUnsupportedExt("Sestava.SLDASM")).toBe(true);
  });
});

describe("text: normalizace s mapou", () => {
  it("diakritika a mezery", () => {
    const n = normalizeWithMap("  Hřídel   NOVÁ ");
    expect(n.text).toBe("hridel nova");
    expect(mapRangeBack(n, "  Hřídel   NOVÁ ", 7, 11)).toEqual([11, 15]);
  });
});

describe("pravidla nad stránkou bez diakritiky (CAD písma)", () => {
  it("Cislo vykresu a Schvalil bez háčků", () => {
    const L = (id: string, text: string, x: number, y: number) => ({ id, page: 1, text, spans: [{ itemId: id, start: 0, end: text.length, offset: 0 }], box: { x, y, w: text.length * 4, h: 7 }, fontSize: 7, rot: 0, zone: "title_block" as const });
    const r = rulePage([L("a", "Cislo vykresu:", 10, 10), L("b", "D-1234-01", 80, 10), L("c", "Schvalil: Ing. P. Dvorak", 10, 40)], ctx());
    expect(r.keep.find((k) => k.field === "drawingNumber")?.value).toBe("D-1234-01");
    expect(r.hits.some((h) => h.lineId === "c" && h.category === "person")).toBe(true);
  });
});

describe("nastavení", () => {
  it("řádek ↔ nastavení, validace", async () => {
    const s = settingsFromRow({ enabled: false, redact: { company: false }, extra_terms: [" STM ", "x", "STM"], max_dpi: 5000, fill_photo: "nonsense" });
    expect(s.enabled).toBe(false);
    expect(s.redact.company).toBe(false);
    expect(s.redact.path).toBe(true);
    expect(s.extraTerms).toEqual(["STM"]);
    expect(s.maxDpi).toBe(600);
    expect(s.fillPhoto).toBe("background");
    const r = settingsToRow({ ...DEFAULT_ANON_SETTINGS, dailyUsd: 12.345 });
    expect(r.daily_usd).toBe(12.35);
    expect(await configHash(DEFAULT_ANON_SETTINGS)).toBe(await configHash(settingsFromRow(null)));
    expect(await termsHash(["A", "b"])).toBe(await termsHash(["B", "a"]));
  });
});
