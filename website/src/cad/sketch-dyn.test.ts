/** Pole číselného zadání u kurzoru podle nástroje a kroku (data pro skicář). */
import { describe, expect, it } from "vitest";
import { defaultOpts, dynSpec } from "./sketch-tools";

describe("pole číselného zadání u kurzoru", () => {
  const S = (tool: string, n: number, picks = 0, phase = 0, o = defaultOpts) => dynSpec(tool, n, picks, phase, o).map((f) => f.key);
  it("první bod = X;Y, úsečka = délka + úhel, obdélník = šířka × výška", () => {
    expect(S("line", 0)).toEqual(["x", "y"]);
    expect(S("line", 1)).toEqual(["len", "ang"]);
    expect(S("polyline", 3)).toEqual(["len", "ang"]);
    expect(S("rect", 1)).toEqual(["w", "h"]);
    expect(S("rectCenter", 1)).toEqual(["w", "h"]);
    expect(S("rect3", 1)).toEqual(["w", "ang"]);
    expect(S("rect3", 2)).toEqual(["h"]);
    expect(S("point", 0)).toEqual(["x", "y"]);
  });
  it("kružnice přepíná poloměr/průměr, mnohoúhelník má počet stran, oblouky poloměr/úhel", () => {
    expect(dynSpec("circle", 1, 0, 0, { ...defaultOpts, diameter: true })[0].label).toBe("Průměr");
    expect(dynSpec("circle", 1, 0, 0, { ...defaultOpts, diameter: false })[0].label).toBe("Poloměr");
    expect(S("circle2", 1)).toEqual(["d"]);
    expect(S("polygon", 1)).toEqual(["r", "sides"]);
    expect(dynSpec("polygon", 1, 0, 0, { ...defaultOpts, circumscribed: true })[0].label).toContain("vepsané");
    expect(dynSpec("polygon", 1, 0, 0, { ...defaultOpts, circumscribed: false })[0].label).toContain("opsané");
    expect(S("arc", 1)).toEqual(["len", "ang"]);
    expect(S("arc", 2)).toEqual(["r"]);
    expect(S("arcCenter", 1)).toEqual(["r"]);
    expect(S("arcCenter", 2)).toEqual(["sweep"]);
    expect(S("arcTangent", 1)).toEqual(["r"]);
    expect(S("slotArc", 1)).toEqual(["r"]);
    expect(S("slotArc", 2)).toEqual(["sweep"]);
    expect(S("slotArc", 3)).toEqual(["w"]);
    expect(S("slot", 1)).toEqual(["len", "ang"]);
    expect(S("slot", 2)).toEqual(["w"]);
    expect(S("ellipse", 1)).toEqual(["rx", "ang"]);
    expect(S("ellipse", 2)).toEqual(["ry"]);
  });
  it("editační nástroje: odsazení až po výběru, posun/otočení/měřítko ve fázi 1, ostatní bez polí", () => {
    expect(S("offset", 0, 0)).toEqual([]);
    expect(S("offset", 0, 1)).toEqual(["d"]);
    expect(S("move", 1, 0, 1)).toEqual(["len", "ang"]);
    expect(S("copy", 1, 0, 1)).toEqual(["len", "ang"]);
    expect(S("move", 1, 0, 0)).toEqual([]);
    expect(S("rotate", 2, 0, 1)).toEqual(["ang"]);
    expect(S("scale", 2, 0, 1)).toEqual(["k"]);
    expect(S("patternLinear", 1, 0, 1)).toEqual(["len", "ang"]);
    for (const t of ["select", "trim", "extend", "split", "project", "dimension", "measure", "con-horizontal", "fillet", "chamfer"]) expect(S(t, 1, 1, 1)).toEqual([]);
  });
  it("každé pole má popisek a jednotku (mm, ° nebo bez)", () => {
    for (const [t, n] of [["line", 1], ["rect", 1], ["circle", 1], ["polygon", 1], ["arcCenter", 2], ["ellipse", 1]] as [string, number][])
      for (const f of dynSpec(t, n, 0, 0, defaultOpts)) {
        expect(f.label.length).toBeGreaterThan(0);
        expect(["mm", "°", "", "×"]).toContain(f.suffix ?? "");
      }
  });
});
