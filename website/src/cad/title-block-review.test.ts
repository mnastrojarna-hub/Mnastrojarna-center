/**
 * Razítko – regresní testy nálezů nezávislé kontroly (w15 titleblock): Chytré kóty respektují skutečnou výšku razítka
 * (nástrojářská 180 × 64), stav razítka hlásí i materiál z dokumentu, revize z tabulky revizí v protokolu a ⚠ u revize
 * mimo tabulku, režim nepředepsaných tolerancí v panelu se nepřenáší mezi listy, tabulka podle desetinných míst v zápisu
 * „X. ±0,1 · X.X ±0,1 …“ (i ozvěna CADu „… / …“ a dokumenty 959), prokládané PNG (Adam7) v logu bez prohlížeče i přes
 * canvas a nejednoznačný název připojeného souboru.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import type { DrawingCmd } from "./agent-drawing";
import { titleRevisionCheck } from "./agent-title";
import { attachedFiles } from "./attached-files";
import { annotationGeometry, type DrawingMeta } from "./drawing";
import { activeSheet, applyDrawingCmd, sheetMeta, sheetOptions } from "./drawing-agent";
import { computeDrawing, runText } from "./drawing-dims-harness";
import { titleBlockBox } from "./drawing-dims-layout";
import { fixtureCompute, plateDoc } from "./drawing-fixture";
import { boxesOverlap, textBox, type Box } from "./drawing-symbols";
import { setLang } from "./i18n";
import { drawTitleBlock, generalTolOf, generalTolText, parseGeneralTol } from "./title-block";
import { decodePng, encodePng, pngInterlaced, prepareLogo, toDataUrl, type Raster } from "./title-logo";
import { panelTolMode } from "../components/cad/drawing-title-panel";
import type { CadDoc } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

beforeEach(() => {
  activeSheet.set(null, false);
  attachedFiles.clear();
  setLang("cs");
});

const P = (text: string): DrawingCmd => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`není příkaz výkresu: ${text}`);
  return op.cmd;
};
async function run(doc: CadDoc, text: string) {
  let d = doc;
  const log: string[] = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const res = await applyDrawingCmd(d, P(line), fixtureCompute);
    d = res.doc;
    log.push(...res.log);
  }
  return { doc: d, log: log.join("\n") };
}
const meta = (d: CadDoc, i = 0) => d.drawings![i].meta as Partial<DrawingMeta>;

// ---------------------------------------------------------------- 1. Chytré kóty a výška razítka

describe("Chytré kóty se vyhnou celému razítku podle šablony (dřív jen 180 × 38)", () => {
  const MODEL = "nový díl Deska Q1\nkvádr 200 120 20 střed\ndíra 8 skrz v -80 -45 20 v 80 -45 20 v -80 45 20 v 80 45 20\ndíra 25 skrz v 0 0 20\n";
  const inside = (b: Box, tb: Box) => b.x1 > tb.x0 + 0.1 && b.x0 < tb.x1 - 0.1 && b.y1 > tb.y0 + 0.1 && b.y0 < tb.y1 - 0.1;
  for (const [tpl, sheet, h] of [
    ["nástrojářská", "výkres A4", 64],
    ["nástrojářská", "výkres A4 měřítko 1:2", 64],
    ["kompaktní", "výkres A4", 27],
    ["iso7200", "výkres A4", 38],
  ] as const) {
    it(`${tpl}, ${sheet}: žádná čára ani text kóty v razítku`, async () => {
      const { doc, log } = await runText(MODEL + `${sheet}\nvýkres razítko šablona=${tpl}\nkótovat\nvýkres stav`);
      const s = doc.drawings![0];
      const d = await computeDrawing(doc, sheetMeta(doc, s, 0), sheetOptions(s));
      expect(d.titleBlock?.h).toBe(h);
      const tb = titleBlockBox(d.titleBlock, d.sheet.w, d.sheet.h);
      const g = annotationGeometry(d, s.annotations);
      const dims = s.annotations.filter((a) => a.type === "dim");
      expect(dims.length).toBeGreaterThanOrEqual(5);
      // reprodukce na d253af2: celková kóta 200 s čarou y = 140 uvnitř razítka x 107–287, y 136–200
      const segBoxes = g.polys.flatMap((p) => p.pts.slice(1).map((q, i): Box => ({ x0: Math.min(p.pts[i][0], q[0]), y0: Math.min(p.pts[i][1], q[1]), x1: Math.max(p.pts[i][0], q[0]), y1: Math.max(p.pts[i][1], q[1]) })));
      expect(segBoxes.filter((b) => inside(b, tb))).toEqual([]);
      expect(g.texts.map((t) => textBox(t)).filter((b) => boxesOverlap(b, tb, -0.1))).toEqual([]);
      expect(log.join("\n")).toMatch(/Kontrola kót: všech 5 očekávaných rozměrů je na listu/);
    }, 120_000);
  }
  it("překážka = razítko + tabulky nad ním; bez údaje výchozí 180 × 38", () => {
    expect(titleBlockBox(undefined, 297, 210)).toEqual({ x0: 107, y0: 162, x1: 287, y1: 200 });
    expect(titleBlockBox({ template: "toolmaker", x: 107, y: 136, w: 180, h: 64, projection: "E", generalTol: "", fields: [], footer: [], above: 20 }, 297, 210)).toEqual({ x0: 107, y0: 116, x1: 287, y1: 200 });
    const info = drawTitleBlock({ W: 297, H: 210, margin: 10, ctx: { sheet: "A4", scaleLabel: "1:2", projection: "E" }, meta: { name: "D", material: "" }, polys: [], texts: [], above: 12.5 });
    expect(info.above).toBe(12.5);
  });
});

// ---------------------------------------------------------------- 2. materiál ve stavu razítka

describe("Razítko bez zkracování textu – i materiál z dokumentu", () => {
  const LONG = "1.2379 (X153CrMoV12) kalené a popuštěné na 58–60 HRC, nitridováno 0,1 mm";
  it("ISO 7200: materiál zalomený a zmenšený se ohlásí (dřív „všechna pole v nominální velikosti“)", async () => {
    const { doc, log } = await run(plateDoc(), `výkres A3\nvýkres razítko šablona=iso7200 materiál="${LONG}"\nvýkres razítko`);
    expect(doc.materialName).toBe(LONG);
    expect(log).toMatch(/Razítko bez zkracování textu: .*Materiál 3 řádky 2,2 mm/);
    expect(log).not.toMatch(/všechna pole v nominální velikosti/);
    // stejný výpočet jako list: pole materiálu 2,15 mm ve 3 řádcích
    const info = drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:1", projection: "E" }, meta: { name: "Deska", material: LONG }, polys: [], texts: [], above: 0 });
    expect(info.fields.find((f) => f.key === "material")).toMatchObject({ lines: 3, shrunk: true, size: 2.15 });
  });
  it("kompaktní šablona: materiál se ohlásí; extrémně dlouhý materiál dá ⚠ pod 2 mm", async () => {
    let { doc, log } = await run(plateDoc(), `výkres razítko šablona=kompaktní materiál="${LONG}"\nvýkres stav`);
    expect(log).toMatch(/Razítko bez zkracování textu: .*Materiál \d řádky 2,4 mm/);
    ({ doc, log } = await run(doc, `výkres razítko materiál="${LONG} ${LONG} ${LONG}"\nvýkres razítko`));
    expect(log).toMatch(/⚠ pole „Materiál“ má písmo jen \d,\d mm/);
  });
});

// ---------------------------------------------------------------- 3. revize a tabulka revizí

describe("Revize v razítku = poslední z tabulky; revize mimo tabulku = ⚠", () => {
  it("prázdné pole revize: protokol uvádí revizi z tabulky (dřív „revize —“), list kreslí totéž", async () => {
    const { doc, log } = await run(plateDoc(), 'výkres revize A "první vydání"\nvýkres revize B "změna díry"\nvýkres razítko revize=""\nvýkres razítko');
    expect(meta(doc).revision).toBe("");
    expect(log).toMatch(/Razítko: .* revize B \(z tabulky revizí\) /);
    expect(log).not.toMatch(/revize — /);
    const info = drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:1", projection: "E" }, meta: { name: "D", material: "", ...meta(doc) } as DrawingMeta, polys: [], texts: [], above: 0 });
    expect(info.fields.find((f) => f.key === "revision")?.value).toBe("B");
  });
  it("revize C mimo tabulku A: ! při zadání a ⚠ ve stavu; revize z tabulky bez upozornění", async () => {
    let { doc, log } = await run(plateDoc(), 'výkres revize A "první vydání"\nvýkres razítko revize=C');
    expect(log).toMatch(/! revize v razítku „C“ není v tabulce revizí \(A\) – doplňte ji \(výkres revize C "…"\)/);
    ({ log } = await run(doc, "výkres stav"));
    expect(log).toMatch(/Razítko: .* revize C · /);
    expect(log).toMatch(/⚠ revize v razítku „C“ není v tabulce revizí \(A\)/);
    ({ doc, log } = await run(doc, "výkres razítko revize=a"));
    expect(log).not.toMatch(/není v tabulce revizí/);
    // bez tabulky revizí se nic nehlásí (revize jen v poli)
    expect(titleRevisionCheck({ revision: "D", revisions: [] })).toEqual({ shown: "D", value: "D" });
    expect(titleRevisionCheck({})).toEqual({ shown: "—", value: "" });
  });
});

// ---------------------------------------------------------------- 4. panel Razítko: režim tolerancí podle listu

describe("panel Razítko: režim nepředepsaných tolerancí se nepřenáší na jiný list", () => {
  it("bez tolerancí = nezadané, „Vlastní text“ bez textu jen na listu, kde se zvolil", () => {
    expect(panelTolMode({ kind: "iso2768", lin: "f", geo: "K" }, null, "s1")).toBe("iso2768");
    // list 2 bez tolerancí po volbě ISO na listu 1 (dřív zůstalo „iso2768“ + třída m / K)
    expect(panelTolMode(null, null, "s2")).toBe("none");
    expect(panelTolMode(null, "s1", "s1")).toBe("text");
    expect(panelTolMode(null, "s1", "s2")).toBe("none");
    expect(panelTolMode({ kind: "decimals", rows: ["±0,1", "±0,1", "±0,01", "±0,005"] }, "s1", "s1")).toBe("decimals");
  });
});

// ---------------------------------------------------------------- 5. tabulka podle desetinných míst

describe("nepředepsané tolerance – tabulka v zápisu s popisky a oddělovači", () => {
  const ROWS = ["±0,1", "±0,1", "±0,01", "±0,005"];
  it("„X. ±0,1 · X.X ±0,1 …“, ozvěna CADu „… / …“ a „desetinná ±0,1 / ±0,1 …“ = tabulka (dřív text / ✗)", () => {
    for (const t of ["X. ±0,1 · X.X ±0,1 · X.XX ±0,01 · X.XXX ±0,005", "X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005", "desetinná ±0,1 / ±0,1 / ±0,01 / ±0,005", "x. +/-0.1; x.x ± 0.1; x.xx +-0.01; x.xxx 0.005", "decimals X.XX = ±0,02"])
      expect(parseGeneralTol(t), t).toEqual({ kind: "decimals", rows: t.startsWith("decimals") ? ["±0,1", "±0,1", "±0,02", "±0,005"] : ROWS });
    // ozvěna se vrací beze změny
    const echo = generalTolText(parseGeneralTol("desetinná"));
    expect(parseGeneralTol(echo)).toEqual({ kind: "decimals", rows: ROWS });
    // nesouměrná úchylka zůstane jedním údajem
    expect(parseGeneralTol("X.XX +0,02/-0,01")).toEqual({ kind: "decimals", rows: ["±0,1", "±0,1", "+0,02/-0,01", "±0,005"] });
    expect(() => parseGeneralTol("X. ±0,1 X.XX")).toThrow(/u X\.XX chybí tolerance/);
    expect(() => parseGeneralTol("X.XXXX ±0,001")).toThrow(/nejvýš 3 desetinná místa/);
    // volný text dál jako text
    expect(parseGeneralTol("DIN ISO 2768-mK nebo dle dohody")).toEqual({ kind: "text", text: "DIN ISO 2768-mK nebo dle dohody" });
  });
  it("uložené dokumenty s textem „X. ±0,1 · …“ se čtou jako tabulka (nástrojářská šablona kreslí 2 × 2)", async () => {
    const m = { tolerance: "X. ±0,1 · X.X ±0,1 · X.XX ±0,01 · X.XXX ±0,005" };
    expect(generalTolOf(m)).toEqual({ kind: "decimals", rows: ROWS });
    const info = drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:1", projection: "E" }, meta: { name: "D", material: "", template: "toolmaker", ...m }, polys: [], texts: [], above: 0 });
    expect(info.fields.find((f) => f.key === "tolerance")).toMatchObject({ lines: 2, shrunk: false, value: "X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005" });
    const { doc, log } = await run(plateDoc(), "výkres nepředepsané X. ±0,1 · X.X ±0,1 · X.XX ±0,01 · X.XXX ±0,005\nvýkres razítko");
    expect(meta(doc).tolTable).toEqual(ROWS);
    expect(log).toMatch(/Nepředepsané tolerance: tabulka podle desetinných míst: X\. ±0,1 \/ X\.X ±0,1 \/ X\.XX ±0,01 \/ X\.XXX ±0,005/);
  });
  const REAL = "/home/user/Mnastrojarna-center/website/.local/fixtures/959-dokument.json";
  it.skipIf(!fs.existsSync(REAL))("skutečný dokument 959 (jen když je soubor na disku): tolerance všech výkresů dílů jsou tabulka", () => {
    const d = JSON.parse(fs.readFileSync(REAL, "utf8"));
    const tol: string[] = [];
    const walk = (o: unknown) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      const m = (o as { meta?: { tolerance?: unknown } }).meta;
      if (m && typeof m === "object" && typeof m.tolerance === "string" && m.tolerance.trim()) tol.push(m.tolerance);
      Object.values(o).forEach(walk);
    };
    walk(d);
    expect(tol.length).toBeGreaterThan(0);
    for (const t of tol) expect(generalTolOf({ tolerance: t })?.kind, t).toBe("decimals");
  });
});

// ---------------------------------------------------------------- 6. prokládané PNG (Adam7)

/** PNG s prokládáním Adam7 (testovací kodér): RGBA 8 bitů, nebo šedá 1 bit; filtry se střídají po průchodech */
function encodeAdam7(ras: Raster, gray1 = false): Uint8Array {
  const { w, h, rgba } = ras;
  const passes: [number, number, number, number][] = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const chunks: number[] = [];
  passes.forEach(([x0, y0, dx, dy], pi) => {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = gray1 ? Math.ceil(pw / 8) : pw * 4;
    const bpp = gray1 ? 1 : 4;
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const row = new Uint8Array(stride);
      for (let x = 0; x < pw; x++) {
        const q = ((y0 + y * dy) * w + x0 + x * dx) * 4;
        if (gray1) row[x >> 3] |= (rgba[q] > 127 ? 1 : 0) << (7 - (x & 7));
        else row.set(rgba.subarray(q, q + 4), x * 4);
      }
      const f = (pi + y) % 5;
      chunks.push(f);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const up = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let pr = 0;
        if (f === 1) pr = a;
        else if (f === 2) pr = up;
        else if (f === 3) pr = (a + up) >> 1;
        else if (f === 4) {
          const p = a + up - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          pr = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        }
        chunks.push((row[i] - pr) & 0xff);
      }
      prev = row;
    }
  });
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc(new Uint8Array(out.subarray(4, 8 + data.length))), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set(gray1 ? [1, 0, 0, 0, 1] : [8, 6, 0, 0, 1], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from(chunks))), chunk("IEND", new Uint8Array(0))]));
}
/** logo 241 × 83 px (liché rozměry – neúplné bloky 8 × 8 v posledních průchodech) */
function sample(): Raster {
  const w = 241;
  const h = 83;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ink = x > 20 && x < 220 && y > 15 && y < 65 && (x + y) % 7 !== 0;
      rgba.set(ink ? [224, 57, 48, 255] : [255, 255, (x * 3 + y) & 0xff, (x * y) % 256 < 8 ? 0 : 255], (y * w + x) * 4);
    }
  return { w, h, rgba };
}
const dataUrl = (b: Uint8Array) => toDataUrl("image/png", b);

describe("logo: prokládané PNG (Adam7) v konzoli i bez prohlížeče", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("dekodér Adam7 = stejné pixely jako neprokládané PNG (RGBA 8 bitů i šedá 1 bit)", async () => {
    const ras = sample();
    const inter = encodeAdam7(ras);
    expect(pngInterlaced(inter)).toBe(true);
    const a = await decodePng(inter);
    expect([a.w, a.h]).toEqual([241, 83]);
    expect(Buffer.from(a.rgba).equals(Buffer.from(ras.rgba))).toBe(true);
    const g = await decodePng(encodeAdam7(ras, true));
    for (let i = 0; i < ras.w * ras.h; i++) expect(g.rgba[i * 4], `px ${i}`).toBe(ras.rgba[i * 4] > 127 ? 255 : 0);
    expect(pngInterlaced(await encodePng(ras))).toBe(false);
  });
  it("výkres razítko logo=\"inter.png\" z připojeného souboru (dřív ✗ prokládané PNG); uloží se neprokládané", async () => {
    attachedFiles.add({ name: "inter.png", mime: "image/png", dataUrl: dataUrl(encodeAdam7(sample())), bytes: 1500 });
    const { doc, log } = await run(plateDoc(), 'výkres razítko logo="inter.png"\nvýkres razítko');
    expect(log).toMatch(/✓ razítko: logo „inter\.png“ 241×83 px, obrys pro DXF\/DWG \d+ ploch/);
    expect(log).toMatch(/logo „inter\.png“ 241×83 px/);
    const src = meta(doc).logo!.src;
    const bytes = new Uint8Array(Buffer.from(src.slice(src.indexOf(",") + 1), "base64"));
    expect(pngInterlaced(bytes)).toBe(false);
    expect(Buffer.from((await decodePng(bytes)).rgba).equals(Buffer.from(sample().rgba))).toBe(true);
  });
  it("PNG, které vlastní dekodér nepřečte, jde v prohlížeči přes canvas (jako panel Razítko); bez prohlížeče ✗", async () => {
    const bad = encodeAdam7(sample());
    bad[28] = 2; // neznámá metoda prokládání
    await expect(prepareLogo(dataUrl(bad), "x.png")).rejects.toThrow(/nepodporované prokládání PNG 2/);
    // canvas prohlížeče (náhrada): obrázek 30 × 10 px, celý černý
    class FakeImage {
      decoding = "";
      src = "";
      naturalWidth = 30;
      naturalHeight = 10;
      width = 30;
      height = 10;
      decode() {
        return Promise.resolve();
      }
    }
    const ctx = { drawImage: () => undefined, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) }) };
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const res = await prepareLogo(dataUrl(bad), "x.png");
    expect(res.logo).toMatchObject({ w: 30, h: 10, name: "x.png" });
    expect(res.logo.trace?.rects.length).toBeGreaterThan(0);
    // canvas obrázek nenačte → původní chyba dekodéru
    vi.stubGlobal("Image", class extends FakeImage {
      decode() {
        return Promise.reject(new Error("EncodingError"));
      }
    });
    await expect(prepareLogo(dataUrl(bad), "x.png")).rejects.toThrow(/nepodporované prokládání PNG 2/);
  });
});

// ---------------------------------------------------------------- 7. nejednoznačný název připojeného souboru

describe("připojené soubory: nejednoznačný název = ✗ se seznamem (dřív „soubor není připojený“)", () => {
  it("logo=\"LOGO\" při logo.png, logo.jpg, logo.svg; celý název funguje; neznámý název = není připojený", async () => {
    const png = dataUrl(await encodePng(sample()));
    for (const n of ["logo.png", "inter.png", "logo.jpg", "logo.svg", "big.png"]) attachedFiles.add({ name: n, mime: "image/png", dataUrl: png, bytes: 1000 });
    expect(attachedFiles.matches("LOGO").map((f) => f.name)).toEqual(["logo.png", "logo.jpg", "logo.svg"]);
    expect(attachedFiles.get("LOGO")).toBeNull();
    expect(attachedFiles.get("Logo.PNG")?.name).toBe("logo.png");
    expect(attachedFiles.get("int")?.name).toBe("inter.png");
    await expect(run(plateDoc(), 'výkres razítko logo="LOGO"')).rejects.toThrow(/logo „LOGO“: název odpovídá více připojeným souborům \(logo\.png, logo\.jpg, logo\.svg\) – zadejte celý název s příponou, např\. logo="logo\.png"/);
    await expect(run(plateDoc(), 'výkres razítko logo="firma"')).rejects.toThrow(/logo „firma“: soubor není připojený/);
    expect((await run(plateDoc(), 'výkres razítko logo="logo.png"')).log).toMatch(/✓ razítko: logo „logo\.png“/);
  });
});
