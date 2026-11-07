import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { drawingToPdf } from "./drawing-pdf";
import { parseDxf } from "./formats/dxf";
import { parseDwg } from "./formats/dwg";
const S = "/tmp/claude-0/-home-user/510db78b-5987-5582-b95f-0b87abd43394/scratchpad/";
it("dump", async () => {
  const font = new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf"));
  const a = await drawingToPdf(parseDxf(new Uint8Array(readFileSync("src/lib/viewer3d/__fixtures__/priruba-cp1250.dxf"))), { font, sourceName: "PRIRUBA.dxf" });
  writeFileSync(S + "priruba.pdf", a.bytes);
  const b = await drawingToPdf(await parseDwg(new Uint8Array(readFileSync("src/lib/viewer3d/formats/__fixtures__/dwg-example-r2018.dwg")), "node_modules/@mlightcad/libredwg-web/wasm"), { font, sourceName: "example.dwg" });
  writeFileSync(S + "example.pdf", b.bytes);
  const c = await drawingToPdf(await parseDwg(new Uint8Array(readFileSync("src/lib/viewer3d/formats/__fixtures__/dwg-dims-r2013.dwg")), "node_modules/@mlightcad/libredwg-web/wasm"), { font, sourceName: "dims.dwg" });
  writeFileSync(S + "dims.pdf", c.bytes);
  console.log(a.sheet, a.scale, b.sheet, b.scale, c.sheet, c.scale, a.bytes.length, b.bytes.length);
}, 60000);
