import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import { buildDoc, buildShape, cachedSteps, clearBuildCache } from "./build";
import { faceOwner } from "./face-owner";
import { emptyDoc, type CadDoc, type Feature } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

function partOf(text: string): CadDoc {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  const features = p.ops.map((op) => (op.k === "feature" ? op.feature : null)).filter((f): f is Feature => !!f);
  features.forEach((f, i) => {
    const g = f as Feature & { mode?: string };
    if (g.mode === "$auto" || (i === 0 && g.mode === "add")) g.mode = i === 0 ? "new" : "add";
  });
  return { ...emptyDoc("Prvek"), features };
}

// deska 100 × 60 × 20 (Z 0…20), díra Ø8 skrz v (20; 30), válec Ø30 výšky 15 nahoře v (50; 30), zaoblení svislých hran nemá
const PLATE = `kvádr 100 60 20
díra 8 skrz v 20 30 20
válec 30 15 v 50 30 20`;

describe("filtr výběru Prvek – prvek, který vytvořil plochu (face-owner.ts)", () => {
  it("stěna díry → Díra, horní plocha desky → Kvádr, plášť válce → Válec; plochy prvku se najdou všechny", async () => {
    clearBuildCache();
    const doc = partOf(PLATE);
    const res = await buildDoc(doc);
    const body = res.body!;
    expect(body).toBeTruthy();
    const steps = cachedSteps(doc);
    expect(steps.map((s) => s.n).sort()).toEqual([1, 2, 3]);
    const faces = body.faces;
    const at = (pred: (f: r.Face) => boolean) => faces.findIndex(pred);
    const hole = at((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 20) < 1e-6);
    const top = at((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 20) < 1e-6 && f.normalAt(f.center).z > 0.99);
    const boss = at((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 50) < 1e-6);
    const bossTop = at((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 35) < 1e-6);
    expect(Math.min(hole, top, boss, bossTop)).toBeGreaterThanOrEqual(0);
    const [box, drill, cyl] = doc.features;

    const h = faceOwner(body, hole, undefined, steps, doc.features)!;
    expect(h.featureId).toBe(drill.id);
    expect(h.exact).toBe(true);
    expect(h.faces).toEqual([hole]); // díra skrz má jedinou plochu (válcovou stěnu)

    // klik na horní plochu desky (mimo díru a válec) – plocha s dírou i otiskem válce pořád patří kvádru
    const t = faceOwner(body, top, [90, 50, 20], steps, doc.features)!;
    expect(t.featureId).toBe(box.id);
    expect(t.faces).toContain(top);
    expect(t.faces).not.toContain(hole);
    expect(t.faces).not.toContain(boss);
    expect(t.faces.length).toBe(6); // šest stěn desky

    const c = faceOwner(body, boss, undefined, steps, doc.features)!;
    expect(c.featureId).toBe(cyl.id);
    expect(c.faces.sort()).toEqual([boss, bossTop].sort()); // plášť a horní podstava válce (spodní podstava splynula s deskou)
  }, 60_000);

  it("jediný prvek: všechny plochy tělesa patří jemu (bez měření)", async () => {
    clearBuildCache();
    const doc = partOf("kvádr 10 20 30");
    const res = await buildDoc(doc);
    const o = faceOwner(res.body!, 2, undefined, cachedSteps(doc), doc.features)!;
    expect(o.featureId).toBe(doc.features[0].id);
    expect(o.faces.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  }, 60_000);

  it("chybějící stav v mezipaměti: vybere poslední prvek v mezeře, který mohl plochu vytvořit (exact = false jen při víc kandidátech)", async () => {
    clearBuildCache();
    const doc = partOf(PLATE);
    const res = await buildDoc(doc);
    await buildShape(doc); // řetěz mezipaměti zůstává pro tentýž dokument
    const steps = cachedSteps(doc).filter((s) => s.n !== 2); // stav po díře „vypadl“
    const body = res.body!;
    const hole = body.faces.findIndex((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 20) < 1e-6);
    const h = faceOwner(body, hole, undefined, steps, doc.features)!;
    // mezi stavem 1 (bez díry) a 3 (s dírou) jsou dva kandidáti (díra, válec) → poslední z nich, nepřesně
    expect(h.exact).toBe(false);
    expect([doc.features[1].id, doc.features[2].id]).toContain(h.featureId);
  }, 60_000);
});
