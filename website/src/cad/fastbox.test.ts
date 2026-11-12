import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildShape } from "./build";
import { fastBounds } from "./fastbox";
import type { CadDoc } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

/** přesný kvádr přímo z jádra (pomalá cesta, kterou rychlá varianta nahrazuje) */
function slow(shape: r.Shape3D): number[] {
  const oc: any = r.getOC();
  const b = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape.wrapped, b, false, false);
  const a = b.CornerMin();
  const c = b.CornerMax();
  const out = [a.X(), a.Y(), a.Z(), c.X(), c.Y(), c.Z()];
  a.delete();
  c.delete();
  b.delete();
  return out;
}
const fast = (shape: r.Shape3D) => fastBounds(shape).flat();
const same = (shape: r.Shape3D, tol = 1e-5) => {
  const s = slow(shape);
  const f = fast(shape);
  for (let i = 0; i < 6; i++) expect(Math.abs(f[i] - s[i]), `souřadnice ${i}: rychle ${f[i]} × přesně ${s[i]}`).toBeLessThan(tol);
};
const torus = (R: number, rr: number, angle = 360) => r.drawCircle(rr).translate(R, 0).sketchOnPlane("XZ").revolve([0, 0, 1], { angle }) as r.Shape3D;

describe("rychlý obalový kvádr = přesný kvádr jádra", () => {
  it("celý torus, natočený torus, výseč toru", () => {
    same(torus(40, 8));
    same(torus(40, 8).rotate(33, [0, 0, 0], [1, 0, 0]).rotate(17, [0, 0, 0], [0, 1, 0]).translate([5, -7, 11]) as r.Shape3D);
    same(torus(40, 8, 90));
    same(torus(40, 8, 200).rotate(41, [1, 2, 3], [1, 1, 0]) as r.Shape3D);
  });
  it("kvádr se zaoblenými hranami a válec se zaoblením (toroidní rohy)", () => {
    same(r.makeBaseBox(60, 40, 20).fillet(5) as r.Shape3D);
    same((r.makeCylinder(20, 30).fillet(4) as r.Shape3D).rotate(27, [0, 0, 0], [1, 1, 0]) as r.Shape3D);
  });
  it("torus ořezaný kvádrem (krajní bod leží mimo plochu → nesmí se započítat)", () => {
    const cutBox = r.makeBaseBox(200, 200, 40).translate([0, 0, 2]) as r.Shape3D; // odřízne vršek trubky
    same(torus(40, 8).cut(cutBox) as r.Shape3D, 1e-4);
    const side = r.makeBaseBox(200, 200, 100).translate([130, 0, -50]) as r.Shape3D; // odřízne bok
    same(torus(40, 8).cut(side) as r.Shape3D, 1e-4);
  });
  it("torus s dírou vyvrtanou přesně v krajním bodě (bod v rozsahu parametrů, ale mimo plochu)", () => {
    const drill = r.makeCylinder(3, 40, [30, 0, 0], [1, 0, 0]) as r.Shape3D; // radiální díra v místě největšího X
    same(torus(40, 8).cut(drill) as r.Shape3D, 1e-4);
    const top = r.makeCylinder(3, 40, [40, 0, 0], [0, 0, 1]) as r.Shape3D; // díra shora
    same(torus(40, 8).rotate(90, [0, 0, 0], [0, 0, 1]).cut(top) as r.Shape3D, 1e-4);
  });
  it("těleso bez toroidních ploch jde původní cestou", () => {
    same(r.makeBaseBox(10, 20, 30).translate([1, 2, 3]) as r.Shape3D);
    same(r.makeSphere(12) as r.Shape3D);
  });
  it("oběžné kolo (285 toroidních ploch): stejný výsledek, výpočet pod 1,5 s místo ~7 s; opakované volání je z paměti", async () => {
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/impeller-A.mncad.json"), "utf8")) as CadDoc;
    const base = (await buildShape({ ...d, features: d.features.slice(0, 2) })).body!;
    const t0 = performance.now();
    const f = fast(base);
    const dt = performance.now() - t0;
    expect(f.map((v) => Math.round(v * 1000) / 1000)).toEqual([-215, -215, -55.592, 215, 215, 113]);
    expect(dt).toBeLessThan(1500);
    const t1 = performance.now();
    expect(base.boundingBox.bounds.flat().map((v) => Math.round(v * 1000) / 1000)).toEqual([-215, -215, -55.592, 215, 215, 113]);
    expect(performance.now() - t1).toBeLessThan(20);
  }, 120_000);
});
