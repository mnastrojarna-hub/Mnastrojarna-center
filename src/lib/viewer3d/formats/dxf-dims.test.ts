/**
 * Kóty v DXF: číslo kóty musí být vidět i tam, kde ho výkres nenese jako text (kóta bez bloku,
 * prázdný text v bloku, „<>", výška 0, formátovací kódy MTEXT, styl kót z DIMSTYLE / XDATA).
 */
import { describe, expect, it } from "vitest";
import { parseDxf, scanDimInfo } from "./dxf";
import { drawingToModel } from "../drawing-model";
import type { DrawEntity } from "../drawing2d";
import {
  detectDecimalSeparator, dimFallbackGeometry, dimTextFrame, dimValueText, formatDimNumber, measureDim, readableAngle, resolveDimText,
} from "../dimension";

type Pair = [number, string | number];
const g = (...pairs: Pair[]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n");

interface DimOpts {
  handle: string;
  type: number;
  block?: string;
  style?: string;
  p10?: [number, number];
  p11?: [number, number];
  p13?: [number, number];
  p14?: [number, number];
  p15?: [number, number];
  p16?: [number, number];
  m?: number;
  text?: string;
  angle?: number;
  textRot?: number;
  xdata?: Pair[];
}

function dim(o: DimOpts): string {
  const pts: Pair[] = [];
  for (const [code, p] of [[10, o.p10], [11, o.p11], [13, o.p13], [14, o.p14], [15, o.p15], [16, o.p16]] as const) {
    if (p) pts.push([code, p[0]], [code + 10, p[1]], [code + 20, 0]);
  }
  return g(
    [0, "DIMENSION"], [5, o.handle], [8, "KOTY"],
    ...(o.block ? [[2, o.block] as Pair] : []),
    ...pts,
    [70, o.type],
    ...(o.text !== undefined ? [[1, o.text] as Pair] : []),
    ...(o.m !== undefined ? [[42, o.m] as Pair] : []),
    ...(o.style ? [[3, o.style] as Pair] : []),
    ...(o.angle !== undefined ? [[50, o.angle] as Pair] : []),
    ...(o.textRot !== undefined ? [[53, o.textRot] as Pair] : []),
    ...(o.xdata ?? []),
  );
}

function dxf(opts: { header?: Pair[]; styles?: string; blocks?: string; entities: string[] }): string {
  return [
    g([0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1015"], [9, "$INSUNITS"], [70, 4], ...(opts.header ?? []), [0, "ENDSEC"]),
    g([0, "SECTION"], [2, "TABLES"], [0, "TABLE"], [2, "LAYER"], [70, 1], [0, "LAYER"], [2, "KOTY"], [70, 0], [62, 3], [6, "CONTINUOUS"], [0, "ENDTAB"]),
    opts.styles ?? "",
    g([0, "ENDSEC"]),
    g([0, "SECTION"], [2, "BLOCKS"]),
    opts.blocks ?? "",
    g([0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"]),
    ...opts.entities,
    g([0, "ENDSEC"], [0, "EOF"]),
  ].filter(Boolean).join("\n");
}

const enc = (s: string) => new TextEncoder().encode(s);
const textsOf = (ents: DrawEntity[]) => ents.filter((e): e is Extract<DrawEntity, { kind: "text" }> => e.kind === "text");

/** Tabulka DIMSTYLE: ISO-25 (2 desetinná místa) a VELKE (DIMSCALE 10). */
const STYLES = g(
  [0, "TABLE"], [2, "DIMSTYLE"], [70, 2],
  [0, "DIMSTYLE"], [105, "1A"], [2, "ISO-25"], [70, 0], [40, 1], [140, 2.5], [271, 2], [41, 2.5],
  [0, "DIMSTYLE"], [105, "1B"], [2, "VELKE"], [70, 0], [40, 10], [140, 2.5], [271, 1],
  [0, "ENDTAB"],
);

/** Blok kóty se šipkou a čarami, ale bez čísla (prázdné MTEXT jen s formátováním). */
function dimBlock(name: string, text: string | null, extra: Pair[] = []): string {
  return g(
    [0, "BLOCK"], [8, "0"], [2, name], [70, 1], [10, 0], [20, 0], [30, 0], [3, name],
    [0, "LINE"], [8, "0"], [62, 0], [10, 0], [20, 20], [30, 0], [11, 50], [21, 20], [31, 0],
    [0, "SOLID"], [8, "0"], [62, 0], [10, 0], [20, 20], [30, 0], [11, 2.5], [21, 20.4], [31, 0], [12, 2.5], [22, 19.6], [32, 0], [13, 2.5], [23, 19.6], [33, 0],
    ...(text !== null ? [[0, "MTEXT"], [8, "0"], [62, 0], [10, 25], [20, 21], [30, 0], [40, 0], [71, 8], [1, text], ...extra] as Pair[] : []),
    [0, "POINT"], [8, "DEFPOINTS"], [10, 0], [20, 0], [30, 0],
    [0, "ENDBLK"], [8, "0"],
  );
}

describe("kóty v DXF — číslo vždy vidět", () => {
  it("kóta bez bloku: kresba kóty + délka z bodů 13/14 ve směru kóty, uprostřed textu (11)", () => {
    const d = parseDxf(enc(dxf({
      styles: STYLES,
      entities: [dim({ handle: "A1", type: 32, style: "ISO-25", p10: [50, 20], p11: [25, 22], p13: [0, 0], p14: [50, 0], angle: 0 })],
    })));
    const [t] = textsOf(d.entities);
    expect(t).toMatchObject({ text: "50", hAlign: "center", vAlign: "middle", layer: "KOTY" });
    expect(t.p).toEqual([25, 22]);
    expect(t.height).toBeCloseTo(2.5);
    expect(t.rotation).toBeCloseTo(0);
    // vynášecí čáry, kótovací čára, 2 šipky
    expect(d.entities.filter((e) => e.kind === "line")).toHaveLength(3);
    expect(d.entities.filter((e) => e.kind === "polyline" && e.closed)).toHaveLength(2);
  });

  it("svislá a šikmá kóta bez bloku: text ve směru kóty, čitelný (ne vzhůru nohama)", () => {
    const d = parseDxf(enc(dxf({
      entities: [
        dim({ handle: "B1", type: 0, p10: [-10, 30], p11: [-11, 15], p13: [0, 0], p14: [0, 30], angle: 90 }),
        dim({ handle: "B2", type: 1, p10: [40, 0], p11: [15, 18], p13: [30, 30], p14: [0, 0], m: 42.42640687 }),
      ],
    })));
    const ts = textsOf(d.entities);
    expect(ts.map((t) => t.text)).toEqual(["30", "42,43"]);
    expect(ts[0].rotation).toBeCloseTo(Math.PI / 2);
    // 30,30 → 0,0 = 225° → čitelně 45°
    expect(ts[1].rotation).toBeCloseTo(Math.PI / 4);
  });

  it("blok kóty bez čísla (MTEXT jen formátování) → hodnota z kódu 42; výška 0 = DIMTXT × DIMSCALE", () => {
    const d = parseDxf(enc(dxf({
      styles: STYLES,
      blocks: dimBlock("*D1", "{\\fArial|b0|i0|c238|p34;}") + "\n" + dimBlock("*D2", "\\A1;<>"),
      entities: [
        dim({ handle: "C1", type: 32, block: "*D1", style: "VELKE", p10: [50, 20], p11: [25, 23], p13: [0, 0], p14: [50, 0], m: 50.04 }),
        dim({ handle: "C2", type: 32, block: "*D2", style: "ISO-25", p10: [50, 20], p11: [25, 23], p13: [0, 0], p14: [50, 0], m: 12.345 }),
      ],
    })));
    const ts = textsOf(d.entities);
    const t1 = ts.find((t) => t.text === "50")!;
    expect(t1).toBeDefined(); // DIMDEC 1 → 50,0 → bez nul „50"
    expect(t1.height).toBeCloseTo(25);
    // „<>" v textu bloku → hodnota, výška 0 → z DIMSTYLE
    const t2 = ts.find((t) => t.text === "12,35")!;
    expect(t2).toBeDefined();
    expect(t2.height).toBeCloseTo(2.5);
    expect(t2.p).toEqual([25, 21]); // poloha z bloku, ne náhradní
    // geometrie z bloku (čára + šipka), ne náhradní kresba
    expect(d.entities.filter((e) => e.kind === "line")).toHaveLength(2);
  });

  it("text bloku s formátovacími kódy MTEXT a tolerancí zůstane (nic se nedoplňuje)", () => {
    const d = parseDxf(enc(dxf({
      blocks: dimBlock("*D3", "\\A1;{\\fArial|b0;%%c25}{\\H0.7x;\\S+0,1^-0,2;}", [[40, 2.5]]),
      entities: [dim({ handle: "D1", type: 35, block: "*D3", p10: [0, 0], p15: [25, 0], m: 25 })],
    })));
    expect(textsOf(d.entities).map((t) => t.text)).toEqual(["Ø25+0,1/-0,2"]);
  });

  it("uživatelský text s <> (4x Ø), potlačený text (mezera), tolerance v kódu 1", () => {
    const d = parseDxf(enc(dxf({
      entities: [
        dim({ handle: "E1", type: 3, p10: [-5, 0], p11: [12, 6], p15: [5, 0], m: 10, text: "4x <>" }),
        dim({ handle: "E2", type: 0, p10: [50, 20], p11: [25, 22], p13: [0, 0], p14: [50, 0], text: " " }),
        dim({ handle: "E3", type: 0, p10: [50, 40], p11: [25, 42], p13: [0, 0], p14: [50, 0], text: "<>\\S+0.1^-0.1;" }),
        dim({ handle: "E4", type: 0, p10: [50, 60], p11: [25, 62], p13: [0, 0], p14: [50, 0], text: "%%c<> H7" }),
      ],
    })));
    expect(textsOf(d.entities).map((t) => t.text)).toEqual(["4x Ø10", "50+0.1/-0.1", "Ø50 H7"]);
  });

  it("poloměr, úhel (3 body i 2 přímky), kóta souřadnic — bez bloku", () => {
    const d = parseDxf(enc(dxf({
      entities: [
        dim({ handle: "F1", type: 4, p10: [100, 100], p11: [106, 103], p15: [110, 100] }),
        dim({ handle: "F2", type: 5, p10: [7, 7], p11: [8, 8], p13: [10, 0], p14: [0, 10], p15: [0, 0] }),
        dim({ handle: "F3", type: 2, p10: [0, 20], p11: [10, 10], p13: [0, 0], p14: [20, 0], p15: [0, 0], p16: [10, 10] }),
        dim({ handle: "F4", type: 6 | 64, p10: [0, 0], p11: [40, 33], p13: [40, 5], p14: [40, 30] }),
        dim({ handle: "F5", type: 6, p10: [0, 0], p11: [55, 12.5], p13: [40, 12.5], p14: [50, 12.5] }),
      ],
    })));
    expect(textsOf(d.entities).map((t) => t.text)).toEqual(["R10", "90°", "90°", "40", "12,5"]);
    // úhlová kóta bez bloku: oblouk
    expect(d.entities.some((e) => e.kind === "curve")).toBe(true);
  });

  it("styl kót: přepis DIMDEC v XDATA kóty (DSTYLE), DIMLFAC, DIMPOST, desetinná tečka podle výkresu", () => {
    const xdata: Pair[] = [[1001, "ACAD"], [1000, "DSTYLE"], [1002, "{"], [1070, 271], [1070, 1], [1070, 144], [1040, 2], [1070, 3], [1000, "<> mm"], [1002, "}"]];
    const d = parseDxf(enc(dxf({
      styles: STYLES,
      blocks: dimBlock("*D9", "12.5", [[40, 2.5]]),
      entities: [
        dim({ handle: "G1", type: 0, style: "ISO-25", p10: [50, 20], p11: [25, 22], p13: [0, 0], p14: [6.17, 0], m: 6.1725, xdata }),
        dim({ handle: "G2", type: 32, block: "*D9", p10: [50, 20], p11: [25, 22], p13: [0, 0], p14: [12.5, 0], m: 12.5 }),
        dim({ handle: "G3", type: 1, p10: [0, 0], p11: [5, 5], p13: [0, 0], p14: [3, 4] }),
      ],
    })));
    // 6,1725 × 2 = 12,345 → 1 desetinné místo → 12.3 (tečka jako ve zbytku výkresu) + „ mm"
    expect(textsOf(d.entities).map((t) => t.text)).toEqual(["12.5", "12.3 mm", "5"]);
  });

  it("kóta ve vloženém bloku (INSERT) → text transformovaný s blokem; natočení textu (53)", () => {
    const block = g(
      [0, "BLOCK"], [8, "0"], [2, "POHLED"], [70, 0], [10, 0], [20, 0], [30, 0], [3, "POHLED"],
      [0, "DIMENSION"], [5, "H1"], [8, "0"], [10, 50], [20, 20], [30, 0], [11, 25], [21, 22], [31, 0], [70, 0], [13, 0], [23, 0], [33, 0], [14, 50], [24, 0], [34, 0], [50, 0], [53, 30],
      [0, "ENDBLK"], [8, "0"],
    );
    const d = parseDxf(enc(dxf({ blocks: block, entities: [g([0, "INSERT"], [8, "KOTY"], [2, "POHLED"], [10, 100], [20, 0], [30, 0], [41, 2], [42, 2])] })));
    const [t] = textsOf(d.entities);
    expect(t.text).toBe("50"); // hodnota v jednotkách výkresu (bez měřítka bloku)
    expect(t.p).toEqual([150, 44]);
    expect(t.height).toBeCloseTo(5);
    expect(t.rotation).toBeCloseTo(Math.PI / 6);
  });

  it("model prohlížeče obsahuje texty kót (hodnoty) na hladině kóty", () => {
    const m = drawingToModel(parseDxf(enc(dxf({
      entities: [
        dim({ handle: "J1", type: 0, p10: [50, 20], p11: [25, 22], p13: [0, 0], p14: [50, 0] }),
        dim({ handle: "J2", type: 4, p10: [0, 0], p11: [6, 3], p15: [10, 0] }),
      ],
    }))));
    const texts = m.model.drawing!.texts;
    expect(texts.map((t) => t.text)).toEqual(["50", "R10"]);
    expect(m.model.parts[texts[0].part].name).toBe("KOTY");
  });

  it("surové čtení stylů: hlavička $DIM…, DIMSTYLE, kóta (styl, 53, DSTYLE)", () => {
    const text = dxf({
      header: [[9, "$DIMTXT"], [40, 3.5], [9, "$DIMDEC"], [70, 3], [9, "$TEXTSIZE"], [40, 5]],
      styles: STYLES,
      entities: [dim({ handle: "K1", type: 0, style: "VELKE", textRot: 45, xdata: [[1001, "ACAD"], [1000, "DSTYLE"], [1002, "{"], [1070, 140], [1040, 1.8], [1002, "}"]] })],
    });
    const info = scanDimInfo(text);
    expect(info.header).toMatchObject({ txt: 3.5, dec: 3 });
    expect(info.textSize).toBe(5);
    expect(info.styles.get("VELKE")).toMatchObject({ scale: 10, txt: 2.5, dec: 1 });
    expect(info.dims.get("K1")).toEqual({ style: "VELKE", textRot: 45, ov: { txt: 1.8 } });
  });
});

describe("dimension — pomocné funkce", () => {
  it("formát čísla: bez nul na konci, -0 → 0, oddělovač", () => {
    expect(formatDimNumber(50, 2, ",")).toBe("50");
    expect(formatDimNumber(12.345, 2, ",")).toBe("12,35");
    expect(formatDimNumber(0.5, 4, ".")).toBe("0.5");
    expect(formatDimNumber(-0.0001, 2, ",")).toBe("0");
    expect(formatDimNumber(1504.6794, 2, ",")).toBe("1504,68");
  });

  it("hodnota a text: <>, mezera, tolerance ze stylu, DIMLFAC", () => {
    const lin = { type: 0, p10: [20, 10] as [number, number], p13: [0, 0] as [number, number], p14: [20, 0] as [number, number] };
    expect(measureDim(lin)).toBeCloseTo(20);
    expect(dimValueText(lin, { tol: true, tp: 0.1, tm: 0.1 }, ",")).toBe("20 ±0,1");
    expect(dimValueText(lin, { tol: true, tp: 0.2, tm: 0.1 }, ",")).toBe("20 +0,2/−0,1");
    expect(dimValueText(lin, { lfac: 0.5 }, ",")).toBe("10");
    expect(resolveDimText(" ", "20")).toBeNull();
    expect(resolveDimText("", "20")).toBe("20");
    expect(resolveDimText("2x <>", "20")).toBe("2x 20");
    expect(resolveDimText("<>", null)).toBeNull();
    expect(resolveDimText("PEVNÝ TEXT", "20")).toBe("PEVNÝ TEXT");
    expect(detectDecimalSeparator(["12,5", "3.25", "4,75"])).toBe(",");
    expect(detectDecimalSeparator(["100", "R5"])).toBeNull();
    expect(readableAngle(Math.PI)).toBeCloseTo(0);
    expect(readableAngle(-Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("otočená kóta bez kódu 50: směr kolmo na 14 → 10", () => {
    const d = { type: 0, p10: [-10, 30] as [number, number], p13: [0, 0] as [number, number], p14: [0, 30] as [number, number], p11: null };
    expect(measureDim(d)).toBeCloseTo(30);
    expect(dimTextFrame(d)!.rotation).toBeCloseTo(Math.PI / 2);
    expect(dimFallbackGeometry(d, {}).filter((x) => x.kind === "line")).toHaveLength(3);
  });
});
