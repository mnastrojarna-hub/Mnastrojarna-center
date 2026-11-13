import { describe, expect, it } from "vitest";
import { docStatusText, featureSummary, parseAgentText } from "./agent";
import { parseSheetLine, sheetTokens } from "./agent-sheet";
import "./ext/index";
import { emptyDoc, type Feature } from "./types";

const one = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors).toEqual([]);
  expect(p.ops).toHaveLength(1);
  return p.ops[0] as { k: string; feature: Extract<Feature, { type: "ext" }>; rule?: string[]; into?: { path: string; kind: string } };
};
const err = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors.length).toBeGreaterThan(0);
  return p.errors[0].message;
};

describe("plech – textové příkazy tvářecích nástrojů", () => {
  it("žaluzie s natočením (příklad ze zadání) a více body", () => {
    const op = one("plech tvarování žaluzie 40 8 4 v 50 30 natočení 90");
    expect(op.k).toBe("feature");
    expect(op.feature.type).toBe("ext");
    expect(op.feature.ext).toBe("sheet.louvre");
    expect(op.feature.data).toMatchObject({ length: 40, width: 8, height: 4, points: [[50, 30]], rotation: 90, direction: "up", face: [] });
    expect(op.feature.name).toBe("Žaluzie 1");
    const op2 = one("plech žaluzie 30 6 3 v -30 0 v 0 0 v 30 0 vpravo dolů");
    expect(op2.feature.data).toMatchObject({ points: [[-30, 0], [0, 0], [30, 0]], open: "right", direction: "down" });
    const op3 = one("plech žaluzie 30 6 3 v -30 0; 0 0; 30 0 2");
    expect(op3.feature.data.points).toEqual([[-30, 0], [0, 0], [30, 0, 2]]);
  });

  it("prolis, žebro, výstřih, můstek, lem díry, vodítko", () => {
    expect(one("plech prolis 12 2 v 10 20").feature.data).toMatchObject({ diameter: 12, height: 2, points: [[10, 20]] });
    expect(one("plech prolis 12 2 úhel 45 v 10 20 ostrý").feature.data).toMatchObject({ wallAngle: 45, rounded: false });
    expect(one("plech prolis 12 2 v 10 20 30 40").feature.data.points).toEqual([[10, 20], [30, 40]]);
    const bead = one('plech žebro 8 2 skica "Dráha 1"');
    expect(bead.feature.ext).toBe("sheet.bead");
    expect(bead.feature.data).toMatchObject({ width: 8, height: 2, sketchId: "Dráha 1" });
    expect(one("plech žebro 8 2").feature.data.sketchId).toBe("$last");
    expect(one("plech výstřih 20 10 3 úhel 45 v 0 0").feature).toMatchObject({ ext: "sheet.lance", data: { length: 20, width: 10, height: 3, wallAngle: 45 } });
    expect(one("plech můstek 30 8 3 v 0 0 natočení 45").feature).toMatchObject({ ext: "sheet.bridge", data: { rotation: 45 } });
    expect(one("plech lem díry 10 3 v 40 -20").feature).toMatchObject({ ext: "sheet.collar", data: { diameter: 10, height: 3, points: [[40, -20]] } });
    expect(one("plech vodítko 25 6 mezera 1,6 v 0 0").feature).toMatchObject({ ext: "sheet.cardguide", data: { length: 25, width: 6, slot: 1.6 } });
    expect(one("plech vodítko desky 25 6 1,6 v 0 0").feature.data).toMatchObject({ slot: 1.6 });
    // pojmenované rozměry, poloměr, plocha číslem
    expect(one("plech prolis průměr 16 hloubka 3 v 0 0 poloměr 0,5 plocha F7").feature.data).toMatchObject({ diameter: 16, height: 3, radius: 0.5, face: [6] });
  });

  it("křížový zlom (příklad ze zadání)", () => {
    const op = one("plech křížový zlom F3 úhel 1,5 dolů");
    expect(op.feature.ext).toBe("sheet.crossbreak");
    expect(op.feature.data).toMatchObject({ face: [2], angle: 1.5, direction: "down" });
    expect(one("plech křížový zlom").feature.data).toMatchObject({ face: [], angle: 1.5, direction: "up" });
    expect(one("plech křížový zlom 2").feature.data).toMatchObject({ angle: 2 });
  });

  it("anglicky a německy", () => {
    expect(one("sheet forming louvre 40 8 4 at 50 30 rotation 90").feature).toMatchObject({ ext: "sheet.louvre", data: { rotation: 90, points: [[50, 30]] } });
    expect(one("sheet dimple 12 2 at 0 0 down").feature).toMatchObject({ ext: "sheet.dimple", data: { direction: "down" } });
    expect(one('sheet bead 8 2 sketch "Path"').feature.data.sketchId).toBe("Path");
    expect(one("sheet cross break F3 angle 1.5 down").feature.data).toMatchObject({ face: [2], angle: 1.5, direction: "down" });
    expect(one("sheet card guide 25 6 slot 1.6 at 0 0").feature.ext).toBe("sheet.cardguide");
    expect(one("sheet collar 8 4 at 10 10").feature.ext).toBe("sheet.collar");
    expect(one("blech umformen kieme 40 8 4 bei 50 30 drehung 90").feature).toMatchObject({ ext: "sheet.louvre", data: { rotation: 90 } });
    expect(one("blech napf 12 2 bei 0 0 unten").feature.data).toMatchObject({ direction: "down" });
    expect(one("blech kreuzbruch F3 winkel 1,5 unten").feature.data).toMatchObject({ face: [2], angle: 1.5, direction: "down" });
    expect(one("blech durchzug 8 4 bei 0 0").feature.ext).toBe("sheet.collar");
    expect(one("blech brücke 30 8 3 bei 0 0").feature.ext).toBe("sheet.bridge");
    expect(one('blech sicke 8 2 skizze "Pfad"').feature.ext).toBe("sheet.bead");
  });

  it("plocha pravidlem → výběr ploch aplikací; název", () => {
    const op = one('plech prolis 12 2 v 0 0 plocha +Y název "Důlek A"');
    expect(op.k).toBe("select");
    expect(op.rule).toEqual(["+y"]);
    expect(op.into).toEqual({ path: "data.face", kind: "faces" });
    expect(op.feature.name).toBe("Důlek A");
  });

  it("chyby s nápovědou", () => {
    expect(err("plech")).toMatch(/neznámý nástroj/);
    expect(err("plech žaluzie 40 8 4")).toMatch(/zadejte bod umístění/);
    expect(err("plech žaluzie 40 8 4 v 1")).toMatch(/dvě nebo tři souřadnice/);
    expect(err("plech prolis 12 2 v 0 0 nesmysl")).toMatch(/neznámé slovo „nesmysl“/);
    expect(err("plech lem díry 1 2 3 v 0 0")).toMatch(/příliš mnoho čísel/);
    expect(err("plech křížový zlom v 0 0")).toMatch(/nemá body/);
    expect(parseSheetLine("kvádr 10 10 10", 1, (l) => l)).toBeNull();
  });

  it("tokenizace a obecný příkaz prvek", () => {
    expect(sheetTokens('plech žebro 8 2 skica „Dráha 2“; x').map((t) => t.t)).toEqual(["plech", "žebro", "8", "2", "skica", "Dráha 2", ";", "x"]);
    const p = parseAgentText("prvek sheet.louvre points=[[10,20],[40,20]] length=30 open=right");
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "feature", feature: { ext: "sheet.louvre", data: { points: [[10, 20], [40, 20]], length: 30, open: "right" } } });
    const q = parseAgentText('prvek "Křížový zlom" angle=2 direction=down');
    expect(q.errors).toEqual([]);
    expect(q.ops[0]).toMatchObject({ feature: { ext: "sheet.crossbreak", data: { angle: 2, direction: "down" } } });
    const r = parseAgentText("prvek sheet.dimple points=5;6 diameter=10");
    expect((r.ops[0] as { feature: Extract<Feature, { type: "ext" }> }).feature.data.points).toEqual([5, 6]);
  });

  it("stav: shrnutí nástroje a zlomu", () => {
    const f = one("plech žaluzie 40 8 4 v 50 30 v 80 30 natočení 90 dolů plocha F6").feature;
    const s = featureSummary(f);
    expect(s).toContain("žaluzie 40 × 8 × 4 mm, otevřená vlevo");
    expect(s).toContain("dolů");
    expect(s).toContain("plocha F6");
    expect(s).toContain("2 b.: [50; 30] [80; 30]");
    expect(s).toContain("natočení 90°");
    const cb = one("plech křížový zlom").feature;
    expect(featureSummary(cb)).toBe("křížový zlom 1,5° nahoru · horní plocha základu");
    const doc = emptyDoc("Plech");
    doc.features.push(f);
    expect(docStatusText(doc, null)).toContain("žaluzie 40 × 8 × 4 mm");
  });
});
