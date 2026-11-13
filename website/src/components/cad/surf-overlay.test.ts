import { describe, expect, it } from "vitest";
import { cvGizmoProps, setCvGizmo, setSurfOverlay, setSurfPanel, surfState } from "./surf-overlay";
import type { Vec3 } from "@/cad/types";

describe("plochy třídy A – sdílený stav 3D okna", () => {
  it("gizmo řídicího bodu: poloha bodu a posun z matice tažení (jen na konci tažení)", () => {
    const moves: Vec3[] = [];
    setCvGizmo({ at: [10, 20, 30], onMove: (d) => moves.push(d) });
    const g = cvGizmoProps(surfState())!;
    expect(g.gizmo).toMatchObject({ id: "__cv__", mode: "translate", targets: [] });
    expect(g.gizmo!.matrix.slice(12, 15)).toEqual([10, 20, 30]);
    const delta = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.12345, 0, 1.5, 1];
    g.onGizmo(delta, false);
    expect(moves).toEqual([]);
    g.onGizmo(delta, true);
    expect(moves).toEqual([[0.123, 0, 1.5]]);
    setCvGizmo(null);
    expect(cvGizmoProps(surfState())).toBeNull();
  });
  it("zavření panelu smaže překryv", () => {
    setSurfPanel(true);
    setSurfOverlay({ lines: [{ pts: [[0, 0, 0], [1, 0, 0]], color: "#16a34a" }], points: [] });
    expect(surfState().overlay?.lines.length).toBe(1);
    setSurfPanel(false);
    expect(surfState().overlay).toBeNull();
    expect(surfState().panel).toBe(false);
  });
});
