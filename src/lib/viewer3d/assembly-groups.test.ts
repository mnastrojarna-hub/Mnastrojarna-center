import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildAssemblyGroups } from "./assembly-groups";
import { occtToModel, type OcctResult } from "./occt";
import type { ModelNode } from "./types";

const require = createRequire(import.meta.url);

describe("skupiny výběru v sestavě", () => {
  // jako STEP z OpenCascade: díly přímo v uzlu podsestavy
  const root: ModelNode = {
    name: "as1",
    parts: [],
    children: [
      { name: "rod-assembly", parts: [0, 1, 2], children: [] },
      { name: "l-bracket-assembly", parts: [3, 4], children: [] },
      { name: "plate", parts: [5], children: [] },
      // vícetělesový díl: sítě nesou jméno dílu
      { name: "Hřídel", parts: [6, 7], children: [] },
    ],
  };
  const names = ["nut", "rod", "nut", "bracket", "bolt", "plate", "Hřídel", "Hřídel"];
  const g = buildAssemblyGroups(root, names);

  it("klik na díl v podsestavě vybere jen ten díl, ne celou podsestavu", () => {
    expect(g.partGroup(0)).toEqual([0]);
    expect(g.partGroup(1)).toEqual([1]);
    expect(g.partGroup(4)).toEqual([4]);
    expect(g.partGroup(5)).toEqual([5]);
  });

  it("vícetělesový díl drží pohromadě", () => {
    expect(g.partGroup(6)).toEqual([6, 7]);
  });

  it("filtr Sestava: nejbližší podsestava (ne celá horní sestava)", () => {
    expect(g.assemblyGroup(0)).toEqual([0, 1, 2]);
    expect(g.assemblyGroup(3)).toEqual([3, 4]);
    // samostatný díl na nejvyšší úrovni → celá sestava
    expect(g.assemblyGroup(5)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("skutečný STEP (kostka): jediný díl", async () => {
    const occt = await (require("occt-import-js") as () => Promise<{ ReadStepFile: (b: Uint8Array, p: unknown) => OcctResult }>)();
    const m = occtToModel(occt.ReadStepFile(new Uint8Array(fs.readFileSync(path.join(__dirname, "__fixtures__", "cube.stp"))), null), "STEP");
    const gg = buildAssemblyGroups(m.root, m.parts.map((p) => p.name));
    expect(gg.partGroup(0)).toEqual([0]);
  });
});
