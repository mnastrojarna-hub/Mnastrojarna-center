/**
 * Vlna 22, bod 20 + 22i (`sestava hotovo`): po změně historie dílu v kontextu sestavy se reference vazeb ověří podle geometrie
 * – text `sestava hotovo` i GUI „Zpět do sestavy“ (obojí cad/asm-agent.ts `finishContextEdit`). Ztracená plocha = ✗ mate.lost,
 * vazba mimo řešení, komponenta stojí, žádné „✓ … vazby 1/1 ok“. Náhradní jádro: plochy dílu „Deska A“ podle varianty
 * (se schodem / bez schodu / schod rozdělený drážkou) – čísla a geometrie jako ve skutečném dílu (repro/20).
 */
import { describe, expect, it } from "vitest";
import { applyAsmCmd, contextEditLines, finishContextEdit, geoProvider, sameFace, type AsmEnv } from "./asm-agent";
import { mateLines, type AsmCmd } from "./agent-asm";
import { parseAgentText } from "./agent";
import { emptyAssembly, partComponent } from "./assembly";
import { matesCount } from "./engine/kv";
import { docKv } from "./engine/protocol";
import { setLang } from "./i18n";
import type { PartFace } from "./mates";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type MeshData, type Vec3 } from "./types";

setLang("cs");
const P = (o: Vec3, n: Vec3): PartFace => ({ kind: "plane", origin: o, normal: n });
/** plochy podle varianty dílu (název posledního prvku): F1… = index 0… */
const FACES: Record<string, PartFace[]> = {
  stepped: [P([0, 20, 2.5], [-1, 0, 0]), P([34, 0, 4.5], [0, -1, 0]), P([10, 20, 5], [0, 0, 1]), P([34, 40, 4.5], [0, 1, 0]), P([30, 20, 0], [0, 0, -1]), P([60, 20, 5], [1, 0, 0]), P([40, 20, 10], [0, 0, 1]), P([20, 20, 7.5], [-1, 0, 0])],
  flat: [P([0, 20, 5], [-1, 0, 0]), P([60, 20, 5], [1, 0, 0]), P([30, 0, 5], [0, -1, 0]), P([30, 40, 5], [0, 1, 0]), P([30, 20, 0], [0, 0, -1]), P([30, 20, 10], [0, 0, 1])],
  split: [P([0, 20, 2.5], [-1, 0, 0]), P([34, 0, 4.5], [0, -1, 0]), P([10, 10, 5], [0, 0, 1]), P([34, 40, 4.5], [0, 1, 0]), P([30, 20, 0], [0, 0, -1]), P([60, 20, 5], [1, 0, 0]), P([40, 20, 10], [0, 0, 1]), P([10, 30, 5], [0, 0, 1])],
  holder: [P([0, 5, 5], [-1, 0, 0]), P([10, 5, 5], [1, 0, 0]), P([5, 0, 5], [0, -1, 0]), P([5, 10, 5], [0, 1, 0]), P([5, 5, 0], [0, 0, -1]), P([5, 5, 10], [0, 0, 1])],
};
/**
 * obálky ploch podle varianty (min, max) – síť náhradního jádra (vlna 22 kolo 6: „táž plocha, změnila velikost“ smí být jen
 * s překryvem s původní plochou, který se počítá z obálek ploch sítě stavby; dřív mock síť neměl a stačila táž rovina)
 */
type B = [Vec3, Vec3];
const BOXES: Record<string, B[]> = {
  stepped: [[[0, 0, 0], [0, 40, 5]], [[0, 0, 0], [60, 0, 10]], [[0, 0, 5], [20, 40, 5]], [[0, 40, 0], [60, 40, 10]], [[0, 0, 0], [60, 40, 0]], [[60, 0, 0], [60, 40, 10]], [[20, 0, 10], [60, 40, 10]], [[20, 0, 5], [20, 40, 10]]],
  flat: [[[0, 0, 0], [0, 40, 10]], [[60, 0, 0], [60, 40, 10]], [[0, 0, 0], [60, 0, 10]], [[0, 40, 0], [60, 40, 10]], [[0, 0, 0], [60, 40, 0]], [[0, 0, 10], [60, 40, 10]]],
  split: [[[0, 0, 0], [0, 40, 5]], [[0, 0, 0], [60, 0, 10]], [[0, 0, 5], [20, 18, 5]], [[0, 40, 0], [60, 40, 10]], [[0, 0, 0], [60, 40, 0]], [[60, 0, 0], [60, 40, 10]], [[20, 0, 10], [60, 40, 10]], [[0, 22, 5], [20, 40, 5]]],
  holder: [[[0, 0, 0], [0, 10, 10]], [[10, 0, 0], [10, 10, 10]], [[0, 0, 0], [10, 0, 10]], [[0, 10, 0], [10, 10, 10]], [[0, 0, 0], [10, 10, 0]], [[0, 0, 10], [10, 10, 10]]],
};
/** síť z obdélníků v obálkách ploch (dva trojúhelníky na plochu) – plocha i obálka jako u skutečné stavby */
function boxMesh(boxes: B[]): MeshData {
  const v: number[] = [];
  const t: number[] = [];
  const g: number[] = [];
  boxes.forEach(([a, b], face) => {
    const flat = [0, 1, 2].find((d) => a[d] === b[d]) ?? 2;
    const [u, w] = [0, 1, 2].filter((d) => d !== flat);
    const corner = (cu: number, cw: number): number[] => { const p = [...a]; p[u] = cu; p[w] = cw; return p; };
    const base = v.length / 3;
    v.push(...corner(a[u], a[w]), ...corner(b[u], a[w]), ...corner(b[u], b[w]), ...corner(a[u], b[w]));
    g.push(t.length, 6, face);
    t.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { vertices: new Float32Array(v), normals: new Float32Array(v.length), triangles: new Uint32Array(t), faceGroups: new Int32Array(g), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
}
const variantOf = (s: ComponentSource | undefined): string => {
  if (!s || s.kind === "file") return "";
  const d = s.kind === "part" ? s.doc : s.doc;
  if (d.name === "Přidržovač") return "holder";
  const names = d.features.map((f) => f.name);
  return names.includes("Drážka") ? "split" : names.includes("Schod") ? "stepped" : "flat";
};
function mockEnv(): AsmEnv {
  const src = new Map<string, ComponentSource>();
  return {
    parts: async (list) =>
      list.map((p) => {
        src.set(p.key, p.source);
        const v = variantOf(p.source);
        const faces = FACES[v]?.length ?? 0;
        const result: BuildResult = { status: [], mesh: BOXES[v] ? boxMesh(BOXES[v]) : null, metrics: { volume: 1000, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces, edges: 0 }, ms: 0 };
        return { key: p.key, result };
      }),
    mateFace: async (key, i) => FACES[variantOf(src.get(key))]?.[i] ?? null,
    cylFace: async () => -1,
    geo: new Map(),
    faceLists: new Map(),
    stack: [],
  };
}
const box = (name: string): CadDoc["features"][number] => ({ id: name, name, type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" });
const plate = (...extra: string[]): CadDoc => ({ ...emptyDoc("Deska A"), kind: "part", features: [box("Kvádr 1"), ...extra.map(box)] });
function asm(): CadDoc {
  const deska = partComponent(plate("Schod"), {}, {} as never);
  const holder = partComponent({ ...emptyDoc("Přidržovač"), kind: "part", features: [box("Kvádr 3")] }, { position: [40, 10, 30] }, {} as never);
  return { ...emptyAssembly("Sestava A"), components: [{ ...deska, id: "deska", fixed: true }, { ...holder, id: "prid" }] };
}
const run = async (d: CadDoc, line: string, env: AsmEnv) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, env);
};
const pos = (d: CadDoc) => d.components!.find((c) => c.id === "prid")!.placement.position;
/** sestava s vazbou Kontakt Přidržovač F5 (−Z) → Deska A F3 (schod +Z, Z = 5) a úprava Desky A v kontextu */
async function mated(env: AsmEnv, faceB = "F3") {
  const m = await run(asm(), `sestava vazba kontakt "Přidržovač" F5 "Deska A" ${faceB}`, env);
  expect(m.mateStatus).toEqual({ [m.doc.mates![0].id]: "ok" });
  const e = await run(m.doc, 'sestava upravit "Deska A"', env);
  return { asmDoc: m.doc, part: e.doc };
}

describe("sestava hotovo: ztracená plocha vazby se hlásí, nikdy tiše nepřipojí jinam (repro/20)", () => {
  it("schod smazán → ✗ mate.lost, vazba mimo řešení, Přidržovač stojí, souhrn bez ✓ a bez „vazby 1/1 ok“", async () => {
    const env = mockEnv();
    const { asmDoc, part } = await mated(env);
    const before = pos(asmDoc);
    expect(before).toEqual([40, 10, 5]);
    const r = await run({ ...part, features: part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", env);
    const id = r.doc.mates![0].id;
    expect(r.doc.mates![0].b).toMatchObject({ compId: "deska", face: 2, lost: { kind: "plane", origin: [10, 20, 5], normal: [0, 0, 1], why: "none" } });
    expect(r.mateStatus).toEqual({ [id]: "lost" });
    expect(pos(r.doc)).toEqual(before); // dřív: poloha [40; 0; 5] · natočení [90; 0; 0] (F3 = boční plocha −Y)
    expect(r.log[0]).toMatch(/^→ „Deska A“ vrácen do sestavy „Sestava A“ .* · vazby 0\/1 ok · ztracené reference: 1 – stav vazeb níže$/);
    expect(r.log.join("\n")).not.toMatch(/✓|vazby 1\/1 ok|vazby pohnuly/);
    // (kolo 6: náhradní jádro má síť → otisk nese i plochu mm², jako skutečná stavba v greens-a 9)
    expect(r.codes).toEqual([{ code: "mate.lost", args: [expect.stringMatching(/^1 Kontakt „Přidržovač“ F5 → „Deska A“ F3$/), expect.stringMatching(/^B F3 dílu „Deska A“ \(rovinná \+Z · střed \[10; 20; 5\] · 800 mm²\) po úpravě dílu neexistuje$/), "vyberte plochu znovu (sestava vazba 1 plocha b …), nebo vazbu smažte (sestava vazba 1 smazat)"] }]);
    // geometrie ztraceného odkazu se nenačte – ani stará plocha se stejným číslem
    expect(geoProvider(r.doc, env)(r.doc.mates![0].b)).toBeNull();
  });

  it("výpis vazeb, stav a strojová část: „ztracená reference“, mates=0/1(lost=1) – nikdy „ok“", async () => {
    const env = mockEnv();
    const { part } = await mated(env);
    const r = await run({ ...part, features: part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", env);
    const list = mateLines(r.doc, r.mateStatus);
    expect(list[0]).toBe("Vazby sestavy „Sestava A“: 1 (1 ztracená reference)");
    expect(list[1]).toMatch(/^ 1\. Kontakt „Přidržovač“ F5 → „Deska A“ F3 – ztracená reference: B F3 .* – sestava vazba 1 plocha b <plocha> \| smazat$/);
    // stav bez výsledku řešiče (jiný běh, otevřený soubor) – ztráta je v dokumentu, počítá se i tak
    expect(matesCount(r.doc, {})).toEqual({ total: 1, ok: 0, conflict: 0, missing: 0, suppressed: 0, lost: 1 });
    expect(docKv({ ref: "Sestava A", name: "Sestava A", kind: "assembly", components: 2, mates: matesCount(r.doc, r.mateStatus) })).toMatch(/ mates=0\/1\(lost=1\)/);
    const listed = await run(r.doc, "sestava vazby", env);
    expect(listed.log.join("\n")).not.toMatch(/– ok$/m);
  });

  it("GUI „Zpět do sestavy“ = tatáž funkce: finishContextEdit dá stejný dokument, stav i hlášky jako text", async () => {
    const envA = mockEnv();
    const a = await mated(envA);
    const text = await run({ ...a.part, features: a.part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", envA);
    const envB = mockEnv();
    const b = await mated(envB);
    const top = envB.stack!.pop()!;
    const gui = await finishContextEdit(top, { ...b.part, features: b.part.features.filter((f) => f.name !== "Schod") }, envB);
    expect(gui.doc.mates![0].b.lost).toEqual(text.doc.mates![0].b.lost);
    expect(Object.values(gui.status)).toEqual(["lost"]);
    expect(gui.moved).toEqual([]);
    expect(pos(gui.doc)).toEqual([40, 10, 5]);
    const t = contextEditLines(gui, b.part, top.asm.name);
    expect(t.log[0].startsWith("→")).toBe(true);
    expect(t.codes.map((c) => c.code)).toEqual(["mate.lost"]);
  });

  it("schod rozdělený drážkou na dvě plochy ve stejné rovině → nejednoznačné = ztraceno (ne „nejbližší“)", async () => {
    const env = mockEnv();
    const { part } = await mated(env);
    const r = await run({ ...part, features: [...part.features, box("Drážka")] }, "sestava hotovo", env);
    expect(r.doc.mates![0].b.lost?.why).toBe("ambiguous");
    expect(Object.values(r.mateStatus!)).toEqual(["lost"]);
    expect(r.codes?.[0].args?.[1]).toMatch(/odpovídá více plochám – nejde jednoznačně určit/);
  });

  it("táž rovina jiné velikosti (horní plocha po smazání schodu) → přečíslováno F7 → F6, ℹ mate.renumbered, vazba ok", async () => {
    const env = mockEnv();
    const { part } = await mated(env, "F7");
    const r = await run({ ...part, features: part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", env);
    expect(r.doc.mates![0].b).toEqual({ compId: "deska", face: 5 });
    expect(Object.values(r.mateStatus!)).toEqual(["ok"]);
    expect(r.log[0]).toMatch(/^✓ „Deska A“ vrácen do sestavy „Sestava A“ .* · vazby 1\/1 ok$/);
    expect(r.codes).toEqual([{ code: "mate.renumbered", args: [1, "B F7 → F6", "táž rovina / osa, plocha změnila velikost"] }]);
  });

  it("vrácený schod (další úprava) ztracenou referenci obnoví – ℹ mate.restored, vazba se zase řeší", async () => {
    const env = mockEnv();
    const { part } = await mated(env);
    const lost = await run({ ...part, features: part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", env);
    const e = await run(lost.doc, 'sestava upravit "Deska A"', env);
    const back = await run({ ...e.doc, features: [...e.doc.features, box("Schod")] }, "sestava hotovo", env);
    expect(back.doc.mates![0].b).toEqual({ compId: "deska", face: 2 });
    expect(Object.values(back.mateStatus!)).toEqual(["ok"]);
    expect(back.codes?.map((c) => c.code)).toEqual(["mate.restored"]);
  });

  it("oprava textem: sestava vazba 1 plocha b F6 (EN assembly mate 1 face b, DE baugruppe verknüpfung 1 fläche b)", async () => {
    const env = mockEnv();
    const { part } = await mated(env);
    const lost = await run({ ...part, features: part.features.filter((f) => f.name !== "Schod") }, "sestava hotovo", env);
    for (const line of ["sestava vazba 1 plocha b F6", "assembly mate 1 face b F6", "baugruppe verknüpfung 1 fläche b F6", "sestava vazba 1 plocha F6"]) {
      const r = await run(lost.doc, line, env);
      expect(r.doc.mates![0].b, line).toEqual({ compId: "deska", face: 5 });
      expect(Object.values(r.mateStatus!), line).toEqual(["ok"]);
      expect(r.log[0], line).toMatch(/^✓ vazba 1 \(Kontakt „Přidržovač“ F5 → „Deska A“ F6\): plocha B F3 → F6 · ok$/);
      expect(pos(r.doc), line).toEqual([40, 10, 10]);
    }
    await expect(run(lost.doc, "sestava vazba 1 plocha a F9", env)).rejects.toThrow(/nemá plochu F9/);
    const del = await run(lost.doc, "sestava vazba 1 smazat", env);
    expect(del.doc.mates).toEqual([]);
  });
});

describe("sameFace (obal nad matchFace): dvě koplanární plochy už nejsou „nejbližší“, ale nejednoznačné", () => {
  it("jediná plocha v téže rovině → její číslo; dvě → null", () => {
    // vlna 22 kolo 6 (vědomá změna): s plochou (mm²), aby šel ověřit překryv s původní plochou; bez ní null
    expect(sameFace(P([10, 20, 5], [0, 0, 1]), [{ face: 3, info: P([12, 20, 5], [0, 0, 1]), area: 800 }], 1e-4, -1, 800)).toBe(3);
    expect(sameFace(P([10, 20, 5], [0, 0, 1]), [{ face: 3, info: P([12, 20, 5], [0, 0, 1]) }])).toBeNull();
    expect(sameFace(P([10, 20, 5], [0, 0, 1]), [{ face: 3, info: P([12, 20, 5], [0, 0, 1]) }, { face: 4, info: P([40, 20, 5], [0, 0, 1]) }])).toBeNull();
  });
});
