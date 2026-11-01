import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { featureLabel, newExtFeature } from "../defaults";
import { emptyDoc } from "../types";
import { allExt, getExt, registerExt } from "./index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  registerExt({
    ext: "test.box",
    label: "Testovací kvádr",
    tab: "create",
    group: "Test",
    make: () => ({ size: 10, mode: "add" }),
    params: [{ key: "size", label: "Hrana", kind: "number", min: 0.1 }],
    build: (data, ctx) => {
      const s = Number(data.size);
      if (!(s > 0)) throw new Error("Hrana musí být kladná.");
      const box = r.makeBox([0, 0, 0], [s, s, s]) as r.Shape3D;
      return ctx.body ? (ctx.body.fuse(box) as r.Shape3D) : box;
    },
  });
}, 60_000);

describe("registr prvků rozšíření", () => {
  it("prvek z modulu se postaví přes build.ts a má popisek", async () => {
    const doc = emptyDoc("Test");
    const f = newExtFeature(doc, "test.box");
    expect(featureLabel(f)).toBe("Testovací kvádr");
    expect(f.name).toBe("Testovací kvádr 1");
    const res = await buildDoc({ ...doc, features: [f] });
    expect(res.status[0].ok).toBe(true);
    expect(res.metrics?.volume).toBeCloseTo(1000, 3);
  });
  it("chyba modulu je česká a neshodí stavbu", async () => {
    const doc = emptyDoc("Test");
    const f = newExtFeature(doc, "test.box");
    f.type === "ext" && (f.data.size = -1);
    const res = await buildDoc({ ...doc, features: [f] });
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toContain("kladná");
  });
  it("neznámý prvek rozšíření hlásí chybějící modul", async () => {
    const res = await buildDoc({ ...emptyDoc("T"), features: [{ id: "x", name: "x", type: "ext", ext: "nic.takoveho", data: {} }] });
    expect(res.status[0].error).toMatch(/modul/i);
    expect(getExt("nic.takoveho")).toBeUndefined();
    expect(allExt().some((d) => d.ext === "test.box")).toBe(true);
  });
});
