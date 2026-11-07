import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { LibreDwg } from "@mlightcad/libredwg-web";
import { parseDwg } from "@/lib/viewer3d/formats/dwg";

const WASM_DIR = fileURLToPath(new URL("../../node_modules/@mlightcad/libredwg-web/wasm/", import.meta.url));
it("probe", async () => {
  const lib = await LibreDwg.create(WASM_DIR.replace(/\/$/, ""));
  for (const f of ["dwg-dims-r2013.dwg", "dwg-example-r2018.dwg", "dwg-entities2d-r2000.dwg", "dwg-sample.dwg"]) {
    const bytes = new Uint8Array(readFileSync(`src/lib/viewer3d/formats/__fixtures__/${f}`));
    const data = lib.dwg_read_data(bytes, 0)!;
    const db = lib.convert(data) as any;
    const blocks = new Map<string, any>((db.tables.BLOCK_RECORD.entries as any[]).map((b) => [b.name, b]));
    const dims = (db.entities as any[]).filter((e) => e.type === "DIMENSION");
    console.log(f, "dims", dims.length, "header DIMDEC", db.header?.DIMDEC, "DIMDSEP", db.header?.DIMDSEP, "DIMSCALE", db.header?.DIMSCALE, "DIMTXT", db.header?.DIMTXT, "styles", (db.tables.DIMSTYLE?.entries ?? []).map((s: any) => [s.name, s.DIMDEC, s.DIMDSEP, s.DIMTXT, s.DIMSCALE, s.DIMZIN]));
    for (const d of dims.slice(0, 6)) {
      const b = blocks.get(d.name);
      const ents = (b?.entities ?? []).map((e: any) => e.type + (e.text ? `(${JSON.stringify(typeof e.text === "string" ? e.text : e.text?.text)} h=${e.textHeight ?? e.rectHeight})` : ""));
      const { ...rest } = d;
      delete (rest as any).extendedData;
      console.log(JSON.stringify({ name: d.name, t: d.dimensionType, sub: d.subclassMarker, m: d.measurement, text: d.text, style: d.styleName, tp: d.textPoint, rot: d.textRotation, ra: d.rotationAngle, p1: d.subDefinitionPoint1, p2: d.subDefinitionPoint2, dp: d.definitionPoint, cp: d.centerPoint }), ents.join(","));
    }
    lib.dwg_free(data);
    const dr = await parseDwg(bytes, WASM_DIR);
    console.log("texts", dr.entities.filter((e) => e.kind === "text").slice(0, 30).map((e: any) => e.text + "@" + e.height.toFixed(2)).join(" | "));
  }
}, 60000);
