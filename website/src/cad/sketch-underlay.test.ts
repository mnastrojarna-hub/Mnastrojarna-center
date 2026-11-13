import { describe, expect, it } from "vitest";
import { PT_MM, UNDERLAY_MAX_CHARS, UNDERLAY_MAX_SIDE, UNDERLAY_MIN_SIDE, applySketchPatch, calibrateUnderlay, fitBitmap, moveUnderlay, newUnderlay, normAngle, pdfPageUnderlay, pdfScaleLabel, pdfToSketch, replaceBitmap, rotateUnderlay, setUnderlayWidth, shrinkToFit, sketchToUnderlay, underlayContains, underlayCorners, underlayMatrix, underlayToSketch, underlayWidth, type BitmapEncode } from "./sketch-underlay";
import type { CadDoc, Feature, SketchUnderlay, Vec2 } from "./types";

const U = (o: Partial<SketchUnderlay> = {}): SketchUnderlay => ({ id: "u1", src: "data:image/png;base64,AAAA", w: 400, h: 200, x: 0, y: 0, mmPerPx: 0.5, angle: 0, opacity: 0.6, ...o });
const close = (a: Vec2, b: Vec2, d = 9) => {
  expect(a[0]).toBeCloseTo(b[0], d);
  expect(a[1]).toBeCloseTo(b[1], d);
};
const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe("podklad skici: pixel ↔ bod skici", () => {
  it("bez natočení: střed bitmapy = střed podkladu, osa Y bitmapy míří dolů, skici nahoru", () => {
    const u = U({ x: 10, y: 20 });
    close(underlayToSketch(u, [200, 100]), [10, 20]);
    close(underlayToSketch(u, [0, 0]), [-90, 70]); // levý horní roh: −200·0,5 vlevo, +100·0,5 nahoru
    close(underlayToSketch(u, [400, 200]), [110, -30]);
    expect(underlayCorners(u).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[-90, 70], [110, 70], [110, -30], [-90, -30]]);
  });
  it("natočení o 90° proti směru hodin: pravý okraj bitmapy míří nahoru", () => {
    const u = U({ angle: 90 });
    close(underlayToSketch(u, [400, 100]), [0, 100]);
    close(underlayToSketch(u, [200, 0]), [-50, 0]);
  });
  it("sketchToUnderlay je inverzí underlayToSketch (posun, měřítko i natočení)", () => {
    const u = U({ x: 37.5, y: -12.25, mmPerPx: 0.1834, angle: 33 });
    for (const px of [[0, 0], [400, 200], [123.4, 56.7], [-50, 320]] as Vec2[]) close(sketchToUnderlay(u, underlayToSketch(u, px)), px, 7);
    expect(underlayContains(u, underlayToSketch(u, [10, 10]))).toBe(true);
    expect(underlayContains(u, underlayToSketch(u, [-1, 10]))).toBe(false);
    expect(underlayContains(u, underlayToSketch(u, [10, 201]))).toBe(false);
  });
  it("matice pro SVG zobrazí pixel do stejného bodu jako underlayToSketch", () => {
    const u = U({ x: 12, y: 34, mmPerPx: 0.37, angle: -25 });
    const [a, b, c, d, e, f] = underlayMatrix(u);
    for (const [px, py] of [[0, 0], [400, 0], [400, 200], [0, 200], [57, 133]] as Vec2[]) close([a * px + c * py + e, b * px + d * py + f], underlayToSketch(u, [px, py]));
    // překlopení osy Y: determinant je záporný a jeho velikost = měřítko²
    expect(a * d - b * c).toBeCloseTo(-(0.37 ** 2), 12);
  });
});

describe("kalibrace měřítka, posun, natočení", () => {
  it("dva body 300 px od sebe mají být 150 mm: 1 px = 0,5 mm, první bod zůstává na místě", () => {
    const u = U({ mmPerPx: 0.2, x: 5, y: 7, angle: 20 });
    const a = underlayToSketch(u, [50, 100]);
    const b = underlayToSketch(u, [350, 100]);
    expect(dist(a, b)).toBeCloseTo(60, 9);
    const c = calibrateUnderlay(u, a, b, 150)!;
    expect(c.mmPerPx).toBeCloseTo(0.5, 12);
    expect(c.angle).toBe(20);
    close(underlayToSketch(c, [50, 100]), a); // bod a se nepohnul
    expect(dist(underlayToSketch(c, [50, 100]), underlayToSketch(c, [350, 100]))).toBeCloseTo(150, 9);
    // směr spojnice se nemění
    const b2 = underlayToSketch(c, [350, 100]);
    expect(Math.atan2(b2[1] - a[1], b2[0] - a[0])).toBeCloseTo(Math.atan2(b[1] - a[1], b[0] - a[0]), 12);
  });
  it("kalibrace opakovaně: druhá kalibrace vychází z aktuálního měřítka", () => {
    let u = U();
    u = calibrateUnderlay(u, underlayToSketch(u, [0, 0]), underlayToSketch(u, [400, 0]), 1000)!;
    expect(underlayWidth(u)).toBeCloseTo(1000, 9);
    u = calibrateUnderlay(u, underlayToSketch(u, [0, 0]), underlayToSketch(u, [0, 200]), 50)!;
    expect(underlayWidth(u)).toBeCloseTo(100, 9);
  });
  it("neplatné zadání kalibrace vrací null", () => {
    const u = U();
    expect(calibrateUnderlay(u, [1, 1], [1, 1], 10)).toBeNull();
    expect(calibrateUnderlay(u, [0, 0], [10, 0], 0)).toBeNull();
    expect(calibrateUnderlay(u, [0, 0], [10, 0], -5)).toBeNull();
    expect(calibrateUnderlay(u, [0, 0], [10, 0], NaN)).toBeNull();
  });
  it("posun a šířka", () => {
    const u = moveUnderlay(U({ x: 1, y: 2 }), [10, -5]);
    expect([u.x, u.y]).toEqual([11, -3]);
    expect(underlayWidth(U())).toBe(200);
    const w = setUnderlayWidth(U({ x: 3, y: 4 }), 297);
    expect(w.mmPerPx).toBeCloseTo(297 / 400, 12);
    expect([w.x, w.y]).toEqual([3, 4]);
    expect(setUnderlayWidth(U(), 0).mmPerPx).toBe(0.5);
    expect(setUnderlayWidth(U(), NaN).mmPerPx).toBe(0.5);
  });
  it("natočení kolem středu a kolem zvoleného bodu; úhel se normalizuje do (−180; 180]", () => {
    expect(rotateUnderlay(U(), 30).angle).toBe(30);
    expect(rotateUnderlay(U(), 270).angle).toBe(-90);
    expect(rotateUnderlay(U(), 540).angle).toBe(180);
    expect(normAngle(-190)).toBe(170);
    expect(rotateUnderlay(U({ angle: 15 }), NaN).angle).toBe(15);
    const u = U({ x: 10, y: 0 });
    const r = rotateUnderlay(u, 90, [0, 0]);
    close([r.x, r.y], [0, 10]);
    // bod podkladu, který ležel v ose otáčení, zůstává na místě
    const px = sketchToUnderlay(u, [0, 0]);
    close(underlayToSketch(r, px), [0, 0]);
  });
});

describe("velikost bitmapy a nový podklad", () => {
  it("fitBitmap zmenšuje jen větší obrázky a drží poměr stran", () => {
    expect(fitBitmap(800, 600)).toEqual({ w: 800, h: 600, k: 1 });
    const big = fitBitmap(6000, 4000);
    expect(big.w).toBe(UNDERLAY_MAX_SIDE);
    expect(big.h).toBe(Math.round((4000 * UNDERLAY_MAX_SIDE) / 6000));
    expect(big.k).toBeCloseTo(UNDERLAY_MAX_SIDE / 6000, 12);
    expect(fitBitmap(100, 5000, 1000)).toEqual({ w: 20, h: 1000, k: 0.2 });
  });
  it("obrázek bez známého měřítka se vejde do 80 % okna; stránka PDF má měřítko 1:1", () => {
    const img = newUnderlay({ src: "x", w: 1000, h: 500, center: [5, 6], fit: [200, 150], name: "foto.jpg" });
    expect(img).toMatchObject({ x: 5, y: 6, angle: 0, name: "foto.jpg", w: 1000, h: 500 });
    expect(underlayWidth(img)).toBeCloseTo(160, 9);
    const tall = newUnderlay({ src: "x", w: 500, h: 1000, center: [0, 0], fit: [200, 150] });
    expect(tall.mmPerPx * 1000).toBeCloseTo(120, 9);
    // A4 na šířku (841,89 × 595,28 bodu) vykreslená na 2000 px: 297 mm
    const k = 2000 / 841.89;
    const pdf = newUnderlay({ src: "x", w: 2000, h: Math.round(595.28 * k), center: [0, 0], mmPerPx: PT_MM / k, page: 1, pages: 3 });
    expect(underlayWidth(pdf)).toBeCloseTo(297, 1);
    expect(pdf).toMatchObject({ page: 1, pages: 3 });
    expect(pdf.id).not.toBe(img.id);
  });
});

describe("uložení podkladu na úrovni dokumentu (applySketchPatch)", () => {
  const sk = (id: string): Feature => ({ id, name: id, type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [] });
  const doc: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "d", material: "ocel", features: [sk("s1"), sk("s2"), { id: "x1", name: "x", type: "extrude", sketchId: "s1", distance: 5, symmetric: false, reverse: false, mode: "new" }] };
  it("podklad jde do doc.underlays, ne do prvku skici – klíč mezipaměti stavby (JSON prvku) se nemění", () => {
    const before = doc.features.map((f) => JSON.stringify(f));
    const next = applySketchPatch(doc, "s1", { underlay: U() });
    expect(next.underlays).toEqual({ s1: U() });
    expect(next.features).toBe(doc.features); // tytéž objekty → model se nepřestavuje
    expect(next.features.map((f) => JSON.stringify(f))).toEqual(before);
    expect(JSON.stringify(next.features)).not.toContain("data:image");
    expect(doc.underlays).toBeUndefined(); // původní dokument se nemění
  });
  it("entity a podklad v jedné změně; změna bez podkladu podklady nechá být", () => {
    const d1 = applySketchPatch(doc, "s1", { underlay: U() });
    const d2 = applySketchPatch(d1, "s1", { entities: [{ id: "p", type: "point", p: [1, 2] }], underlay: U({ opacity: 0.3 }) });
    expect((d2.features[0] as { entities: unknown[] }).entities).toHaveLength(1);
    expect(d2.features[1]).toBe(d1.features[1]);
    expect(d2.underlays!.s1.opacity).toBe(0.3);
    const d3 = applySketchPatch(d2, "s1", { entities: [] });
    expect(d3.underlays).toBe(d2.underlays);
    expect("underlay" in d3.features[0]).toBe(false);
  });
  it("null podklad odebere; poslední odebraný podklad odstraní i klíč underlays", () => {
    const d1 = applySketchPatch(applySketchPatch(doc, "s1", { underlay: U() }), "s2", { underlay: U({ id: "u2" }) });
    expect(Object.keys(d1.underlays!)).toEqual(["s1", "s2"]);
    const d2 = applySketchPatch(d1, "s1", { underlay: null });
    expect(d2.underlays).toEqual({ s2: U({ id: "u2" }) });
    const d3 = applySketchPatch(d2, "s2", { underlay: null });
    expect("underlays" in d3).toBe(false);
  });
  it("podklady smazaných skic se při změně podkladu zahodí", () => {
    const d1 = applySketchPatch(applySketchPatch(doc, "s1", { underlay: U() }), "s2", { underlay: U({ id: "u2" }) });
    const gone: CadDoc = { ...d1, features: d1.features.filter((f) => f.id !== "s1" && f.id !== "x1") };
    const d2 = applySketchPatch(gone, "s2", { underlay: U({ id: "u2", angle: 10 }) });
    expect(Object.keys(d2.underlays!)).toEqual(["s2"]);
    // podklad neexistující skice se neuloží
    expect("underlays" in applySketchPatch(doc, "nic", { underlay: U() })).toBe(false);
  });
});

describe("uložení bitmapy do limitu (shrinkToFit)", () => {
  /** falešný kodér: délka data URL úměrná ploše × „kvalitě“ (PNG = 1,2 – výkres s plochami jedné barvy, JPEG = kvalita) */
  const fake = (perPx: number, log: string[] = []): BitmapEncode => (w, h, type, q) => {
    log.push(`${w}x${h} ${type}${q ? " " + q : ""}`);
    return "x".repeat(Math.round(w * h * perPx * (type === "image/png" ? 1.2 : (q ?? 1))));
  };
  it("malý obrázek: PNG v původní velikosti", async () => {
    const r = await shrinkToFit(800, 600, fake(0.5));
    expect(r).toMatchObject({ w: 800, h: 600, type: "image/png", fits: true });
  });
  it("velký obrázek se zmenší na delší stranu UNDERLAY_MAX_SIDE; když PNG nestačí, zkusí JPEG", async () => {
    const log: string[] = [];
    const r = await shrinkToFit(6000, 3000, fake(0.3, log));
    expect(r.w).toBe(UNDERLAY_MAX_SIDE);
    expect(r.h).toBe(1000);
    expect(r.type).toBe("image/jpeg");
    expect(r.src.length).toBeLessThanOrEqual(UNDERLAY_MAX_CHARS);
    expect(log[0]).toBe("2000x1000 image/png");
  });
  it("nevejde-li se ani JPEG nejnižší kvality, bitmapa se zmenšuje po 3/4, ne pod UNDERLAY_MIN_SIDE", async () => {
    const log: string[] = [];
    const r = await shrinkToFit(4000, 4000, fake(2, log));
    expect(r.fits).toBe(false);
    expect(Math.max(r.w, r.h)).toBe(UNDERLAY_MIN_SIDE);
    expect(r.type).toBe("image/jpeg");
    expect(r.quality).toBe(0.55);
    expect(log.some((l) => l.startsWith("1500x1500"))).toBe(true);
    // vejde se po prvním zmenšení
    const r2 = await shrinkToFit(4000, 4000, fake(0.5));
    expect(r2).toMatchObject({ w: 1500, h: 1500, fits: true });
  });
});

describe("stránka PDF jako podklad", () => {
  // A4 na šířku 841,89 × 595,28 bodu vykreslená na 2000 px
  const k = 2000 / 841.89;
  const page = () => pdfPageUnderlay({ src: "x", w: 2000, h: Math.round(595.28 * k), pxPerPt: k, center: [0, 0], page: 2, pages: 3, name: "v.pdf" });
  it("stránka ve skutečné velikosti (1 bod = 25,4/72 mm), měřítko 1:1", () => {
    const u = page();
    expect(underlayWidth(u)).toBeCloseTo(297, 1);
    expect(u).toMatchObject({ page: 2, pages: 3, pxPerPt: k });
    expect(pdfScaleLabel(u)).toBe("1:1");
    expect(pdfScaleLabel(U())).toBeNull();
  });
  it("bod stránky → skica: levý horní roh stránky, 100 bodů doprava = 35,28 mm; po kalibraci i natočení", () => {
    const u = page();
    const f = pdfToSketch(u);
    const tl = f([0, 0]);
    close(tl, underlayCorners(u)[0]);
    expect(dist(f([0, 0]), f([100, 0]))).toBeCloseTo(100 * PT_MM, 9);
    expect(f([0, 100])[1]).toBeLessThan(tl[1]); // osa Y stránky míří dolů
    // výkres v měřítku 1:2: úsečka 50 mm na papíře je ve skutečnosti 100 mm
    const a = f([100, 100]);
    const b = f([100 + 50 / PT_MM, 100]);
    const cal = calibrateUnderlay(u, a, b, 100)!;
    expect(pdfScaleLabel(cal)).toBe("1:2");
    expect(dist(pdfToSketch(cal)([0, 0]), pdfToSketch(cal)([100, 0]))).toBeCloseTo(200 * PT_MM, 9);
    const rot = rotateUnderlay(cal, 90);
    const g = pdfToSketch(rot);
    const v = [g([100, 0])[0] - g([0, 0])[0], g([100, 0])[1] - g([0, 0])[1]];
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(200 * PT_MM, 9); // směr X stránky míří po natočení o 90° nahoru
    expect(pdfScaleLabel({ ...u, mmPerPx: u.mmPerPx / 5 })).toBe("5:1");
  });
  it("jiná stránka téhož PDF zachová polohu, natočení a kalibraci; obrázek zachová šířku v mm", () => {
    const u = { ...calibrateUnderlay(page(), [0, 0], [10, 0], 20)!, angle: 30, x: 7, y: 8, opacity: 0.4 };
    const n = replaceBitmap(u, { src: "y", w: 1000, h: 1414, pxPerPt: 1000 / 595.28, page: 3, pages: 3 });
    expect(n).toMatchObject({ id: u.id, x: 7, y: 8, angle: 30, opacity: 0.4, page: 3, src: "y", w: 1000, h: 1414 });
    expect(n.mmPerPx * n.pxPerPt!).toBeCloseTo(u.mmPerPx * u.pxPerPt!, 12);
    expect(pdfScaleLabel(n)).toBe(pdfScaleLabel(u));
    const img = replaceBitmap(U(), { src: "z", w: 800, h: 100, name: "b.png" });
    expect(underlayWidth(img)).toBeCloseTo(underlayWidth(U()), 9);
    expect(img.name).toBe("b.png");
    expect("page" in img || "pxPerPt" in img).toBe(false);
  });
});
