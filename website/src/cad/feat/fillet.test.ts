import path from "node:path";
import { beforeAll, describe, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

describe("průzkum 3", () => {
  it("orientace normál po booleovské operaci", () => {
    const b = r.makeBox([0, 0, 0], [60, 40, 20]) as r.Shape3D;
    const c = r.makeBox([10, 10, 10], [30, 30, 25]) as r.Shape3D; // kapsa shora
    const s = b.cut(c);
    console.log(s.faces.map((f) => `${f.center.x},${f.center.y},${f.center.z} -> ${f.normalAt().x.toFixed(0)},${f.normalAt().y.toFixed(0)},${f.normalAt().z.toFixed(0)} ${f.orientation}`).join("\n"));
    // plný rádius na kapse? ne. Zkouška plného rádiusu na tělese po cut: M = plocha x=60
    const M = s.faces.find((f) => Math.abs(f.center.x - 60) < 1e-6)!;
    console.log("M normal", M.normalAt().x, "edges", M.edges.length, M.edges.map((e) => e.geomType).join(","));
    // zaoblení po tečném řetězci: válec – horní kruh je uzavřená hrana
    const cyl = r.makeCylinder(10, 20, [0, 0, 0], [0, 0, 1]) as r.Shape3D;
    console.log("cyl edges", cyl.edges.map((e) => `${e.geomType} closed=${e.isClosed} s=${e.startPoint.x.toFixed(1)},${e.startPoint.y.toFixed(1)},${e.startPoint.z.toFixed(1)} e=${e.endPoint.x.toFixed(1)},${e.endPoint.y.toFixed(1)},${e.endPoint.z.toFixed(1)}`).join("\n"));
  });
});
