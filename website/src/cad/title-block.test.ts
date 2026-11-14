/**
 * Razítko výkresu (w15, zpráva 959 kap. 5.4) bez jádra: šablony, pole bez zkracování (zmenšení / zalomení), značka
 * promítání ISO 5456-2, nepředepsané tolerance ISO 2768 / tabulka podle desetinných míst, logo jako obrázek a obrys.
 * Regrese: „Claude dle Vojtě“ (kreslil uříznut na 16 znaků), zrcadlová značka ISO E, text „ISO E“ místo značky.
 */
import { describe, expect, it } from "vitest";
import type { DText, DrawingMeta, Poly } from "./drawing";
import { drawTitleBlock, fitText, generalTolDescribe, generalTolFields, generalTolOf, imageRects, inheritTitle, iso2768Linear, nearestAci, parseGeneralTol, parseTemplate, projectionSymbol, textWidth, titleBlockSize, titleRevision, TITLE_TEMPLATES, wrapText, type TitleTemplate } from "./title-block";

const LONG = {
  name: "NASTROJ-A 100-01-00_01 – deska základová s dlouhým názvem pro kontrolu",
  material: "1.2379 (X153CrMoV12) kalené 58-60 HRC",
  number: "100-01-00_01-01-PRIKLADNA-DESKA",
  author: "Claude dle Vojtěchova zadání",
};
const draw = (meta: Partial<DrawingMeta>, projection: "E" | "A" = "E") => {
  const polys: Poly[] = [];
  const texts: DText[] = [];
  const info = drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:2", projection }, meta: { name: "Deska", material: "Ocel", ...meta } as DrawingMeta, polys, texts, above: 0 });
  return { info, polys, texts, all: texts.map((t) => t.s).join("\n") };
};
/** text pole složený z řádků (zalomení = mezera) */
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("pole razítka se nezkracují (regrese „Claude dle Vojtě“)", () => {
  it("ISO 7200: dlouhý název, číslo, materiál a kreslil jsou na listu celé – zmenšené nebo zalomené uvnitř buňky", () => {
    const { info, texts, all } = draw(LONG);
    for (const v of Object.values(LONG)) for (const w of words(v)) expect(all, v).toContain(w);
    expect(all).not.toContain("Claude dle Vojtě\n");
    const author = info.fields.find((f) => f.key === "author")!;
    expect(author).toMatchObject({ value: "Claude dle Vojtěchova zadání", shrunk: true, small: false });
    expect(author.lines).toBeGreaterThanOrEqual(2);
    // každý řádek pole leží uvnitř své buňky (odhad šířky podle metrik Roboto) a řádky dají dohromady celý text
    for (const f of info.fields.filter((x) => x.where === "cell" && x.cell)) {
      expect(f.rows!.join(" ").replace(/- /g, "-").replace(/_ /g, "_"), f.key).toBe(f.value);
      for (const row of f.rows!) {
        const t = texts.find((x) => x.s === row && x.x >= f.cell!.x && x.x <= f.cell!.x + f.cell!.w)!;
        expect(t, `${f.key}: ${row}`).toBeTruthy();
        expect(t.x + textWidth(t.s, t.size, t.bold), `${f.key}: ${row}`).toBeLessThanOrEqual(f.cell!.x + f.cell!.w - 1.5 + 1e-6);
        expect(t.y, row).toBeGreaterThan(f.cell!.y + 3.2);
        expect(t.y, row).toBeLessThanOrEqual(f.cell!.y + f.cell!.h);
      }
    }
    for (const t of texts) expect(t.x + textWidth(t.s, t.size, t.bold) <= info.x + info.w + 0.01, t.s).toBe(true);
  });
  it("fitText: zmenšení do 2 mm, pak zalomení, nikdy zkrácení; extrémní text označí small", () => {
    expect(fitText("Novák", 25, 7.3, 3.2)).toMatchObject({ lines: ["Novák"], size: 3.2, shrunk: false });
    const a = fitText("Claude dle Vojtěchova zadání", 25, 7.3, 3.2);
    expect(a.lines.join(" ")).toBe("Claude dle Vojtěchova zadání");
    expect(a.size).toBeGreaterThanOrEqual(2);
    expect(Math.max(...a.lines.map((l) => textWidth(l, a.size)))).toBeLessThanOrEqual(25 + 1e-6);
    const b = fitText("x".repeat(400), 20, 7, 3.2);
    expect(b.lines.join("")).toBe("x".repeat(400));
    expect(b.small).toBe(true);
    // slovo delší než řádek se rozdělí za pomlčkou
    expect(wrapText("100-01-00_01-01-PRIKLADNA-DESKA", 2, 1)).toEqual(["100-01-00_01-01-", "PRIKLADNA-DESKA"]);
  });
});

describe("šablony razítka", () => {
  const full: Partial<DrawingMeta> = {
    ...LONG,
    company: "Mnástrojárna s.r.o.",
    customer: "Zákazník a.s.",
    project: "123 PŘÍPRAVEK",
    checkedBy: "Ing. Kontrolor",
    approvedBy: "Ing. Schvalovatel",
    quantity: "4",
    stock: "plech 40×160×185",
    heatTreatment: "kalit 58–60 HRC",
    surfaceTreatment: "černit",
    angleTol: "±0°30′",
    chamferTol: "±0,2",
    edges: "ISO 13715 -0,3",
    tolerance: "ISO 2768-mK",
    revision: "B",
    date: "14.11.2026",
    sheetIndex: 1,
    sheetCount: 2,
    massKg: 2.5,
  };
  it("rozměry: ISO 7200 180×38, kompaktní 180×27, nástrojářská 180×64; slova cs/en/de", () => {
    expect(TITLE_TEMPLATES.map((t) => titleBlockSize({ template: t }))).toEqual([{ w: 180, h: 38 }, { w: 180, h: 27 }, { w: 180, h: 64 }]);
    expect(titleBlockSize({})).toEqual({ w: 180, h: 38 });
    expect(["iso7200", "výchozí", "kompaktní", "compact", "kompakt", "nástrojářská", "toolmaker", "Werkzeugbau", "nesmysl"].map(parseTemplate)).toEqual(["iso7200", "iso7200", "compact", "compact", "compact", "toolmaker", "toolmaker", "toolmaker", null]);
  });
  for (const t of TITLE_TEMPLATES) {
    it(`${t}: všechna vyplněná pole jsou na listu (v buňce nebo v patičce) a žádné se nezkracuje`, () => {
      const { info, all, texts } = draw({ ...full, template: t as TitleTemplate });
      for (const f of info.fields.filter((x) => x.cell))
        for (const row of f.rows!) {
          const tx = texts.find((x) => x.s === row && x.x >= f.cell!.x && x.x <= f.cell!.x + f.cell!.w)!;
          expect(tx.x + textWidth(tx.s, tx.size, tx.bold), `${t} ${f.key}: ${row}`).toBeLessThanOrEqual(f.cell!.x + f.cell!.w - 1.5 + 1e-6);
          expect(tx.y, `${t} ${f.key}: ${row}`).toBeLessThanOrEqual(f.cell!.y + f.cell!.h);
        }
      for (const k of ["customer", "project", "checkedBy", "approvedBy", "stock", "heatTreatment", "surfaceTreatment", "angleTol", "chamferTol", "author", "number", "name"] as const) {
        for (const w of words(String(full[k]))) expect(all, `${t} ${k}`).toContain(w);
      }
      expect(all).toMatch(/4 ks/);
      expect(all).toContain("ISO 2768-mK");
      expect(info.fields.every((f) => !f.small)).toBe(true);
      expect(info.h).toBe(titleBlockSize({ template: t }).h);
      // nástrojářská má vše v buňkách – patička jen „Rozměry v mm“
      if (t === "toolmaker") expect(info.fields.filter((f) => f.where === "footer")).toEqual([]);
      else expect(info.fields.filter((f) => f.where === "footer").map((f) => f.key)).toEqual(expect.arrayContaining(["customer", "project", "stock", "quantity"]));
    });
  }
  it("ISO 7200: patička jako dřív – „Rozměry v mm · Nepředepsané tolerance … · Hrany: …“ a „List i/n“; nástrojářská má list v buňce", () => {
    const iso = draw({ tolerance: "ISO 2768-mK", edges: "srazit 0,5×45°", sheetIndex: 2, sheetCount: 3 });
    expect(iso.info.footer[0]).toBe("Rozměry v mm · Nepředepsané tolerance ISO 2768-mK · Hrany: srazit 0,5×45°");
    expect(iso.info.footer[1]).toBe("List 2/3");
    const tm = draw({ tolerance: "ISO 2768-mK", sheetIndex: 2, sheetCount: 3, template: "toolmaker" });
    expect(tm.info.footer).toEqual(["Rozměry v mm"]);
    expect(tm.all).toContain("2/3");
  });
  it("revize v razítku = poslední z tabulky revizí, když pole revize není vyplněné", () => {
    const revisions = [{ rev: "A", date: "1.1.2026", note: "první" }, { rev: "B", date: "2.2.2026", note: "díra" }];
    expect(titleRevision({ revisions })).toBe("B");
    expect(titleRevision({ revision: "A", revisions })).toBe("A");
    expect(draw({ revisions }).info.fields.find((f) => f.key === "revision")!.value).toBe("B");
  });
  it("nový list převezme šablonu, logo, firmu a další pole", () => {
    const logo = { src: "data:image/png;base64,AAAA", w: 10, h: 5 };
    expect(inheritTitle({ template: "toolmaker", logo, customer: "X", note: "jen tento list", massKg: 3 })).toEqual({ template: "toolmaker", logo, customer: "X" });
  });
});

describe("značka promítání ISO 5456-2 (regrese: ISO E kreslená zrcadlově)", () => {
  const sym = (p: "E" | "A") => {
    const polys: Poly[] = [];
    projectionSymbol(polys, 0, 0, p, 7);
    const trap = polys.find((q) => q.width === 0.35 && q.pts.length === 5)!;
    const circ = polys.filter((q) => q.width === 0.35 && q.pts.length > 30);
    const xs = trap.pts.map((q) => q[0]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const span = (x: number) => {
      const ys = trap.pts.filter((q) => Math.abs(q[0] - x) < 1e-9).map((q) => q[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    const cx = circ[0].pts.reduce((a, q) => a + q[0], 0) / circ[0].pts.length;
    return { narrowLeft: span(left) < span(right), circlesRight: cx > right, circlesLeft: cx < left, n: circ.length };
  };
  it("ISO E (1. kvadrant): užší konec kužele vlevo, kružnice vpravo; ISO A (3. kvadrant): kružnice vlevo", () => {
    expect(sym("E")).toEqual({ narrowLeft: true, circlesRight: true, circlesLeft: false, n: 2 });
    expect(sym("A")).toEqual({ narrowLeft: true, circlesRight: false, circlesLeft: true, n: 2 });
  });
  it("v razítku je značka, ne text „ISO E“", () => {
    for (const t of TITLE_TEMPLATES) {
      const d = draw({ template: t as TitleTemplate });
      expect(d.all).not.toMatch(/ISO [EA]/);
      expect(d.polys.filter((q) => q.width === 0.35 && q.pts.length > 30)).toHaveLength(2);
      expect(d.info.projection).toBe("E");
    }
  });
});

describe("nepředepsané tolerance", () => {
  it("ISO 2768: třída f/m/c/v + H/K/L v různých zápisech", () => {
    expect(parseGeneralTol("ISO 2768-mK")).toEqual({ kind: "iso2768", lin: "m", geo: "K" });
    expect(parseGeneralTol("mK")).toEqual({ kind: "iso2768", lin: "m", geo: "K" });
    expect(parseGeneralTol("f H")).toEqual({ kind: "iso2768", lin: "f", geo: "H" });
    expect(parseGeneralTol("2768-c")).toEqual({ kind: "iso2768", lin: "c" });
    expect(parseGeneralTol("DIN ISO 2768-1 v")).toEqual({ kind: "iso2768", lin: "v" });
    expect(parseGeneralTol("třída m")).toEqual({ kind: "iso2768", lin: "m" });
    expect(generalTolFields(parseGeneralTol("fH"))).toEqual({ tolerance: "ISO 2768-fH" });
    expect(generalTolDescribe(parseGeneralTol("mK"))).toBe("ISO 2768-mK (délky, úhly a sražení třída m – střední, geometrie K)");
    expect(iso2768Linear("m", 25)).toBe(0.2);
    expect(iso2768Linear("f", 100)).toBe(0.15);
    expect(iso2768Linear("v", 2)).toBeNull();
  });
  it("tabulka podle desetinných míst (X. / X.X / X.XX / X.XXX), výchozí ±0,1 / ±0,1 / ±0,01 / ±0,005", () => {
    expect(parseGeneralTol("desetinná")).toEqual({ kind: "decimals", rows: ["±0,1", "±0,1", "±0,01", "±0,005"] });
    expect(parseGeneralTol("decimals ±0.2 ±0.1 ±0.05 ±0.01")).toEqual({ kind: "decimals", rows: ["±0,2", "±0,1", "±0,05", "±0,01"] });
    expect(parseGeneralTol("X.XX=±0,02")).toEqual({ kind: "decimals", rows: ["±0,1", "±0,1", "±0,02", "±0,005"] });
    expect(parseGeneralTol("dezimal 0=0,2 3=0,002")).toEqual({ kind: "decimals", rows: ["±0,2", "±0,1", "±0,01", "±0,002"] });
    expect(() => parseGeneralTol("desetinná abc")).toThrow(/čekám tolerance/);
    const f = generalTolFields(parseGeneralTol("desetinná"));
    expect(f).toEqual({ tolerance: "X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005", tolTable: ["±0,1", "±0,1", "±0,01", "±0,005"] });
    expect(generalTolOf(f)).toEqual({ kind: "decimals", rows: f.tolTable });
    // razítko: v ISO 7200 v patičce, v nástrojářské tabulka v buňce
    expect(draw(f).info.footer[0]).toBe("Rozměry v mm · Nepředepsané tolerance X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005");
    const tm = draw({ ...f, template: "toolmaker" });
    for (const s of ["X. ±0,1", "X.X ±0,1", "X.XX ±0,01", "X.XXX ±0,005"]) expect(tm.texts.map((t) => t.s)).toContain(s);
  });
  it("ne / none / keine = zrušit; jiný text zůstane textem; úhly a sražení podle třídy ISO 2768", () => {
    expect(parseGeneralTol("ne")).toBeNull();
    expect(parseGeneralTol("keine")).toBeNull();
    expect(parseGeneralTol("")).toBeNull();
    expect(parseGeneralTol("DIN 7168 mittel")).toEqual({ kind: "text", text: "DIN 7168 mittel" });
    const tm = draw({ tolerance: "ISO 2768-fH", template: "toolmaker" });
    expect(tm.info.fields.find((f) => f.key === "angleTol")!.value).toBe("ISO 2768-f");
    expect(tm.info.fields.find((f) => f.key === "chamferTol")!.value).toBe("ISO 2768-f");
  });
});

describe("logo v razítku", () => {
  const logo = { src: "data:image/png;base64,iVBORw0KGgo=", w: 200, h: 100, name: "firma.png", trace: { cols: 4, rows: 2, color: "#e03930", rects: [0, 0, 2, 1, 2, 1, 4, 2] } };
  it("obrázek v buňce firmy se zachovaným poměrem stran; obrys v mm listu; barva ACI", () => {
    const { info, polys, all } = draw({ logo });
    const img = polys.find((p) => p.img)!;
    expect(img.img).toMatchObject({ src: logo.src });
    expect(img.img!.w / img.img!.h).toBeCloseTo(2, 6);
    // buňka firmy ISO 7200: x 230…285, y 249…270 (list A3 420 × 297, okraj 10)
    expect(img.img!.x).toBeGreaterThanOrEqual(230);
    expect(img.img!.x + img.img!.w).toBeLessThanOrEqual(285);
    expect(img.img!.y).toBeGreaterThanOrEqual(249);
    expect(img.img!.y + img.img!.h).toBeLessThanOrEqual(270);
    expect(info.logo).toMatchObject({ name: "firma.png" });
    expect(all).not.toContain("Mnástrojárna s.r.o.");
    const rs = imageRects(img.img!);
    expect(rs).toHaveLength(2);
    expect(rs[0].x0).toBeCloseTo(img.img!.x, 6);
    expect(rs[1].x1).toBeCloseTo(img.img!.x + img.img!.w, 6);
    expect(nearestAci("#e03930")).toBe(1);
    expect(nearestAci("#111111")).toBe(7);
  });
  it("firma bez loga = název firmy místo výchozí Mnástrojárny; s logem pod logem", () => {
    expect(draw({ company: "ACME Tools s.r.o." }).all).toContain("ACME Tools s.r.o.");
    const both = draw({ company: "ACME", logo });
    expect(both.all).toContain("ACME");
    expect(both.polys.some((p) => p.img)).toBe(true);
    expect(draw({}).all).toContain("Mnástrojárna s.r.o.");
  });
});
