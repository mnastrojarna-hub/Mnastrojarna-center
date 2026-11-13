import { afterEach, describe, expect, it } from "vitest";
import { docStatusText, parseAgentText } from "./agent";
import { mateText, type AsmCmd } from "./agent-asm";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { motionTable, motionRun } from "./asm-agent-kin";
import { emptyAssembly, partComponent } from "./assembly";
import { setLang } from "./i18n";
import type { PartFace } from "./mates";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

const op = (line: string): AsmCmd => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  expect(p.ops[0]?.k, line).toBe("asm");
  return (p.ops[0] as { cmd: AsmCmd }).cmd;
};
const err = (line: string) => parseAgentText(line).errors[0]?.message ?? "";

describe("rozbor: pokročilé a mechanické vazby textem (CS / EN / DE)", () => {
  it("ozubení, šroub, hřeben, vačka, kardan – poměr, zuby, stoupání, modul, levý / vnitřní", () => {
    expect(op('sestava vazba ozubení "Kolo1" "Kolo2" poměr 2')).toMatchObject({ k: "mate", kind: "gear", a: "Kolo1", b: "Kolo2", value: 2, flip: false });
    expect(op('assembly mate gear "G1" "G2" teeth 20 40 internal')).toMatchObject({ kind: "gear", value: 2, flip: true });
    expect(op('baugruppe verknüpfung zahnrad "R1" "R2" übersetzung 3')).toMatchObject({ kind: "gear", value: 3 });
    expect(op('sestava vazba šroub "Matice" "Šroub" stoupání 1,5')).toMatchObject({ kind: "screw", a: "Matice", b: "Šroub", value: 1.5 });
    expect(op('sestava vazba šroub "Matice" válcová Ø8 "Šroub" Ø8 stoupání 1,25 levý')).toMatchObject({ kind: "screw", value: 1.25, flip: true, faceA: { rule: ["valcova"], diameter: 8 }, faceB: { diameter: 8 } });
    expect(op('sestava vazba hřeben a pastorek "Pastorek" "Hřeben" +Y modul 2 zuby 12')).toMatchObject({ kind: "rack", value: Math.PI * 24, faceB: { rule: ["+y"] } });
    expect(op('assembly mate rack "Pinion" F2 "Rack" F1 travel 75')).toMatchObject({ kind: "rack", value: 75, faceA: { index: 1 }, faceB: { index: 0 } });
    expect(op('sestava vazba vačka "Zdvihátko" -Y "Vačka" F7')).toMatchObject({ kind: "cam", faceA: { rule: ["-y"] }, faceB: { index: 6 } });
    expect(op('bewegung')).toEqual({ k: "motion", cmd: { op: "status" } });
    expect(op('sestava vazba kardan "Hřídel1" "Hřídel2"')).toMatchObject({ kind: "universal" });
    expect(op('assembly mate universal joint "S1" "S2"')).toMatchObject({ kind: "universal", a: "S1", b: "S2" });
  });
  it("pokročilé: kolmo, tečně, shodně (E/V), symetricky s rovinou, šířka a drážka se dvěma plochami, závěs, zámek, meze", () => {
    expect(op('sestava vazba kolmo "A" F1 "B" +Z')).toMatchObject({ kind: "perpendicular", faceA: { index: 0 }, faceB: { rule: ["+z"] } });
    expect(op('assembly mate tangent "Roller" cylinder "Plate" top flip')).toMatchObject({ kind: "tangent", flip: true });
    expect(op('sestava vazba shodně "A" V3 "B" E5')).toMatchObject({ kind: "coincident", faceA: { index: 2, ent: "vertex" }, faceB: { index: 4, ent: "edge" } });
    expect(op('sestava vazba symetricky "A" +X "B" -X rovina "Rám" F3')).toMatchObject({ kind: "symmetric", c: "Rám", faceC: { index: 2 } });
    expect(op('sestava vazba šířka "Jazýček" F1 F2 "Drážka" F5 F6')).toMatchObject({ kind: "width", faceA: { index: 0 }, faceA2: { index: 1 }, faceB: { index: 4 }, faceB2: { index: 5 } });
    expect(op('sestava vazba šířka "Jazýček" +X -X "Drážka" +X -X')).toMatchObject({ faceA: { rule: ["+x"] }, faceA2: { rule: ["-x"] }, faceB: { rule: ["+x"] }, faceB2: { rule: ["-x"] } });
    expect(op('sestava vazba drážka "Čep" válcová "Deska" F7 F8 poloha 12')).toMatchObject({ kind: "slot", value: 12, faceB: { index: 6 }, faceB2: { index: 7 } });
    expect(op('baugruppe verknüpfung scharnier "Tür" F2 F5 "Rahmen" F1 F9')).toMatchObject({ kind: "hinge", faceA2: { index: 4 }, faceB2: { index: 8 } });
    expect(op('sestava vazba závěs "Klika" Ø10 -Z "Rám" Ø10 +Z největší')).toMatchObject({ kind: "hinge", faceA: { diameter: 10, rule: [] }, faceA2: { rule: ["-z"] }, faceB: { diameter: 10 }, faceB2: { rule: ["+z", "nejvetsi"] } });
    expect(op('sestava vazba šroub "M" válcová Ø8 +Z "S" Ø8')).toMatchObject({ faceA: { diameter: 8, rule: ["valcova", "+z"] } });
    expect(op('sestava vazba zámek "A" "B" název "Celek"')).toMatchObject({ kind: "lock", a: "A", b: "B", name: "Celek" });
    expect(op('sestava vazba mez vzdálenosti "A" -Z "B" +Z min 0 max 30')).toMatchObject({ kind: "limitDistance", min: 0, max: 30, faceA: { rule: ["-z"] } });
    expect(op('assembly mate limit angle "A" F1 "B" F2 from 10 to 80')).toMatchObject({ kind: "limitAngle", min: 10, max: 80 });
    expect(op('baugruppe verknüpfung winkelgrenze "A" F1 "B" F2 5..45')).toMatchObject({ kind: "limitAngle", min: 5, max: 45 });
    expect(op('sestava vazba dráha "Kulička" V1 "Kolej" E3')).toMatchObject({ kind: "path", faceA: { ent: "vertex" }, faceB: { ent: "edge", index: 2 } });
    expect(op("sestava vazba 3 min 5 max 25")).toEqual({ k: "mateEdit", ref: "3", min: 5, max: 25 });
    expect(op("sestava vazba 2 poměr 3")).toEqual({ k: "mateEdit", ref: "2", value: 3 });
  });
  it("chyby: meze bez hodnot, min > max, záporné stoupání, neznámá volba", () => {
    expect(err('sestava vazba mez vzdálenosti "A" "B"')).toMatch(/zadejte meze/);
    expect(err('sestava vazba mez úhlu "A" F1 "B" F2 min 50 max 10')).toMatch(/min 50 je větší než max 10/);
    expect(err('sestava vazba šroub "A" "B" stoupání -1')).toMatch(/hodnota musí být kladná/);
    expect(err('sestava vazba ozubení "A" "B" kolem')).toMatch(/neznámá volba „kolem“/);
  });
});

describe("rozbor: pohyb …", () => {
  it("motor rotační / lineární, rozsah, krok, kolize, stopa; přehrát, krok, export, smazat (CS / EN / DE)", () => {
    expect(op('pohyb motor rotační "Klika" 0..360 krok 5 kolize')).toEqual({ k: "motion", cmd: { op: "motor", kind: "rotary", comp: "Klika", from: 0, to: 360, step: 5, collisions: true } });
    expect(op('motion motor linear mate 3 from 10 to 40 steps 30 time 3')).toEqual({ k: "motion", cmd: { op: "motor", kind: "linear", mate: "3", from: 10, to: 40, steps: 30, duration: 3 } });
    expect(op('bewegung antrieb dreh "Kurbel" 0 720 u/min 60 spur "Pleuel" punkt 10 0 0')).toEqual({ k: "motion", cmd: { op: "motor", kind: "rotary", comp: "Kurbel", from: 0, to: 720, speed: 60, trace: { comp: "Pleuel", point: [10, 0, 0] } } });
    expect(op("pohyb přehrát smyčka")).toEqual({ k: "motion", cmd: { op: "play", loop: true } });
    expect(op("pohyb stav")).toEqual({ k: "motion", cmd: { op: "status" } });
    expect(op("motion export csv")).toEqual({ k: "motion", cmd: { op: "export", format: "csv" } });
    expect(op("pohyb export video")).toEqual({ k: "motion", cmd: { op: "export", format: "webm" } });
    expect(op("pohyb krok 12")).toEqual({ k: "motion", cmd: { op: "step", n: 12 } });
    expect(op("pohyb kroky 48 čas 2 kolize vyp stopa vyp")).toEqual({ k: "motion", cmd: { op: "set", steps: 48, duration: 2, collisions: false, trace: null } });
    expect(op("pohyb motor smazat 1")).toEqual({ k: "motion", cmd: { op: "removeMotor", n: 1 } });
    expect(op("pohyb smazat")).toEqual({ k: "motion", cmd: { op: "clear" } });
    expect(err('pohyb motor rotační "X" 5..5')).toMatch(/rozsah od–do je nulový/);
    expect(err("pohyb tancuj")).toMatch(/neznámý podpříkaz „tancuj“/);
  });
});

/* ───────── provedení s náhradním jádrem: ozubená kola v rámu ───────── */
const P = (origin: Vec3, normal: Vec3): PartFace => ({ kind: "plane", origin, normal });
const C = (origin: Vec3, normal: Vec3, radius: number): PartFace => ({ kind: "cylinder", origin, normal, radius, extent: [0, 10] });
const FACES: Record<string, PartFace[]> = {
  Rám: [C([0, 0, 0], [0, 0, 1], 5), C([30, 0, 0], [0, 0, 1], 5), P([0, 0, 0], [0, 0, 1])],
  Kolo1: [C([0, 0, 0], [0, 0, 1], 10), P([0, 0, 0], [0, 0, -1]), C([0, 0, 0], [0, 0, 1], 5)],
  Kolo2: [C([0, 0, 0], [0, 0, 1], 20), P([0, 0, 0], [0, 0, -1]), C([0, 0, 0], [0, 0, 1], 5)],
};
function mockEnv(): AsmEnv {
  const src = new Map<string, ComponentSource>();
  const nameOf = (key: string) => {
    const s = src.get(key);
    return s && s.kind !== "file" ? s.doc.name : "";
  };
  return {
    parts: async (list) =>
      list.map((p) => {
        src.set(p.key, p.source);
        const result: BuildResult = { status: [], mesh: null, metrics: { volume: 1000, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces: FACES[nameOf(p.key)]?.length ?? 0, edges: 0 }, ms: 0 };
        return { key: p.key, result };
      }),
    mateFace: async (key, i) => FACES[nameOf(key)]?.[i] ?? null,
    mateEnt: async () => null,
    cylFace: async () => -1,
    geo: new Map(),
    faceLists: new Map(),
    stack: [],
  };
}
const part = (name: string): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: `${name}-b`, name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" }] });
function gears(): CadDoc {
  const mk = (n: string, pos: Vec3, fixed = false) => ({ ...partComponent(part(n), { position: pos }, fixed ? { fixed: true } : {}), id: n.toLowerCase() });
  return { ...emptyAssembly("Převodovka"), components: [mk("Rám", [0, 0, 0], true), mk("Kolo1", [0, 0, 0]), mk("Kolo2", [30, 0, 0])] };
}
const run = async (d: CadDoc, line: string, env: AsmEnv) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, env);
};

describe("provedení: mechanické vazby a pohybová studie textem", () => {
  it("závěsy + ozubení (osa z vazby Závěs, poměr), pohyb motor, krok, CSV a stav", async () => {
    const env = mockEnv();
    let d = gears();
    let r = await run(d, 'sestava vazba závěs "Kolo1" F3 "Rám" F1', env);
    expect(r.log[0]).toMatch(/^✓ vazba Závěs „Kolo1“ F3 → „Rám“ F1: ok · poloha beze změny/);
    d = r.doc;
    r = await run(d, 'sestava vazba závěs "Kolo2" válcová Ø10 "Rám" F2', env);
    d = r.doc;
    r = await run(d, 'sestava vazba ozubení "Kolo1" "Kolo2"', env);
    d = r.doc;
    const g = d.mates!.find((m) => m.type === "gear")!;
    expect(g.a).toMatchObject({ compId: "kolo1", face: 2 }); // osa z vazby Závěs (F3), ne největší válec
    expect(g.value).toBe(1); // poloměry os 5 / 5
    expect(g.phase).toEqual([0, 0]);
    expect(r.log.join("\n")).toMatch(/hodnota z geometrie: 1 – změna: sestava vazba 3 hodnota=N/);
    r = await run(d, "sestava vazba 3 poměr 2", env);
    d = r.doc;
    expect(mateText(d, d.mates![2])).toBe("Ozubená kola „Kolo1“ F3 → „Kolo2“ F3 · poměr 2");
    r = await run(d, 'pohyb motor rotační "Kolo1" 0..360 krok 10', env);
    d = r.doc;
    expect(r.changed).toBe(true);
    expect(r.motion).toEqual({ open: true });
    expect(d.motion).toMatchObject({ steps: 36, duration: 2, motors: [{ kind: "rotary", mate: d.mates![0].id, from: 0, to: 360 }] });
    expect(r.log.join("\n")).toMatch(/Pohybová studie: 36 kroků · 2 s/);
    expect(r.log.join("\n")).toMatch(/Vazby splněny ve všech krocích/);
    r = await run(d, "pohyb krok 9", env);
    expect(r.motion).toEqual({ open: true, step: 9 });
    expect(r.log.join("\n")).toMatch(/Kolo2 \[30; 0; 0\] ∠\[0; 0; -45\]/); // A +90° → B −45°
    r = await run(d, "pohyb export csv", env);
    expect(r.log[1]).toMatch(/^Krok;Čas \[s\];Motor 1 \[°\];Rám X;/);
    expect(r.log.length).toBe(2 + 37);
    const res = await motionRun(d, env);
    const tab = motionTable(d, res);
    expect(tab[36].comps.Kolo2.rotation[2]).toBeCloseTo(-180, 6);
    expect(tab[18].comps.Kolo1.rotation[2]).toBeCloseTo(180, 6);
    expect(docStatusText(d, null)).toMatch(/Pohybová studie: motorů 1 · kroků 36 · 2 s – pohyb stav/);
    r = await run(d, "pohyb přehrát", env);
    expect(r.motion).toEqual({ open: true, play: true });
    r = await run(d, "pohyb smazat", env);
    expect(r.doc.motion).toBeUndefined();
  });
  it("chyby: motor bez osy, zámek a meze textem", async () => {
    const env = mockEnv();
    const d = gears();
    await expect(run(d, 'pohyb motor rotační "Kolo1" 0..90', env)).rejects.toThrow(/nemá vazbu Závěs, Souosost ani Šroub/);
    await expect(run(d, "pohyb spustit", env)).rejects.toThrow(/nemá žádný motor/);
    const r = await run(d, 'sestava vazba zámek "Kolo2" "Kolo1"', env);
    expect(r.doc.mates![0]).toMatchObject({ type: "lock", rel: { position: [30, 0, 0], rotation: [0, 0, 0] } });
    await expect(run(d, 'sestava vazba ozubení "Kolo1" F2 "Kolo2"', env)).rejects.toThrow(/F2 komponenty „Kolo1“ je rovinná – vazba potřebuje válcová \/ úsečka/);
  });
});
