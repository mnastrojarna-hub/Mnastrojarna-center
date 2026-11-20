/**
 * Průvodce Kola a ozubení – čistý stav (reducer), plány vytvoření (prvek do dílu / skript existujících příkazů),
 * soukolí, knihovna → tabulka a 2D náhled.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "@/cad/agent";
import "@/cad/ext";
import { GEAR_KINDS, KINDS, PAIR_ROWS, type GearKind, type PairKind } from "@/cad/gears";
import { emptyDoc, type CadDoc } from "@/cad/types";
import { pairSketch, shapePath, toothFocus, wheelSketch } from "./sketch";
import { evaluate, galleryKinds, initState, libraryToGear, planCreate, planPair, protocolErrors, seedPair, storable, tableRows, wizardReducer } from "./wizard-state";

const part = (): CadDoc => emptyDoc("Díl 1");
const withBox = (): CadDoc => ({ ...part(), features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [60, 40, 20], position: [0, 0, 0], centered: false, mode: "new" } as CadDoc["features"][number]] });

describe("stav průvodce", () => {
  it("galerie obsahuje každý druh právě jednou", () => {
    expect([...galleryKinds()].sort()).toEqual([...GEAR_KINDS].sort());
  });
  it("výběr druhu → tabulka s výchozími hodnotami; změna řádku; vrácení výchozí hodnoty", () => {
    let s = initState();
    expect(s.view).toBe("gallery");
    s = wizardReducer(s, { t: "pick", kind: "spur" });
    expect(s.view).toBe("table");
    expect(s.values.spur).toEqual(KINDS.spur.defaults());
    s = wizardReducer(s, { t: "set", patch: { m: 3, z: 17 } });
    expect(s.values.spur?.m).toBe(3);
    expect(s.values.spur?.z).toBe(17);
    s = wizardReducer(s, { t: "set", patch: { m: undefined } });
    expect(s.values.spur?.m).toBe(KINDS.spur.defaults().m);
    // jiný druh a zpět: hodnoty prvního zůstanou
    s = wizardReducer(s, { t: "pick", kind: "sprocket" });
    s = wizardReducer(s, { t: "pick", kind: "spur" });
    expect(s.values.spur?.z).toBe(17);
    s = wizardReducer(s, { t: "reset" });
    expect(s.values.spur).toEqual(KINDS.spur.defaults());
  });
  it("předvyplnění (knihovna / naposledy použité) a soukolí převezme modul a zuby z kola", () => {
    let s = initState({ kind: "helical", data: { m: 3, z: 21, beta: 20 } });
    expect(s.view).toBe("table");
    expect(s.values.helical?.m).toBe(3);
    s = wizardReducer(s, { t: "pair" });
    expect(s.view).toBe("pair");
    expect(s.pairKind).toBe("helical");
    expect(s.pairValues.helical?.m).toBe(3);
    expect(s.pairValues.helical?.z1).toBe(21);
    expect(s.pairValues.helical?.beta).toBe(20);
    s = wizardReducer(s, { t: "pairSet", patch: { z2: 63 } });
    expect(s.pairValues.helical?.z2).toBe(63);
    expect(seedPair("worm", "wormwheel", { ...KINDS.wormwheel.defaults(), z: 40 }).z2).toBe(40);
  });
  it("tabulka: povinné řádky první, průvodce skryje výstup / operaci / odkaz, řádky `when` podle dat", () => {
    const g = tableRows(KINDS.spur.rows, KINDS.spur.defaults(), "wizard");
    expect(g[0].id).toBe("basic");
    expect(g[0].rows.slice(0, 2).map((r) => r.key)).toEqual(["m", "z"]);
    const keys = g.flatMap((x) => x.rows.map((r) => r.key));
    expect(keys).not.toContain("out");
    expect(keys).not.toContain("mode");
    expect(keys).not.toContain("positionRef");
    expect(keys).not.toContain("ha"); // jen u vlastního základního profilu
    const custom = tableRows(KINDS.spur.rows, { ...KINDS.spur.defaults(), rack: "custom" }, "edit").flatMap((x) => x.rows.map((r) => r.key));
    expect(custom).toEqual(expect.arrayContaining(["ha", "hf", "rho", "out", "mode", "positionRef"]));
  });
  it("kontrola a spočtené řádky: m 2 z 24 → dₐ 52, W₃ 15,433; z 3 → chyba u řádku z", () => {
    const ok = evaluate("spur", { ...KINDS.spur.defaults(), m: 2, z: 24 });
    expect(ok.ok).toBe(true);
    expect(ok.rows.find((r) => r.key === "da")?.value).toMatch(/^52[.,]000$/);
    expect(ok.rows.find((r) => r.key === "Wk")?.value).toMatch(/^15[.,]433$/);
    const bad = evaluate("spur", { ...KINDS.spur.defaults(), z: 3 });
    expect(bad.ok).toBe(false);
    expect(bad.issues.find((i) => i.level === "error")?.key).toBe("z");
    // neplatné číslo nesmí vyhodit výjimku
    expect(evaluate("spur", { ...KINDS.spur.defaults(), m: "x" }).ok).toBe(false);
  });
});

describe("plán vytvoření", () => {
  it("prázdný díl: prvek gear.spur s celou tabulkou, operace nové těleso, díl převezme název", () => {
    const p = planCreate(part(), { kind: "spur", data: { ...KINDS.spur.defaults(), m: 3, z: 30 }, out: "wheel", op: "add", target: "this" });
    expect(p.kind).toBe("commit");
    if (p.kind !== "commit") return;
    const f = p.feature as Extract<CadDoc["features"][number], { type: "ext" }>;
    expect(f.ext).toBe("gear.spur");
    expect(f.name).toBe("Ozubené kolo m3 z30");
    expect(f.data).toMatchObject({ m: 3, z: 30, out: "wheel", mode: "new" });
    for (const k of Object.keys(KINDS.spur.defaults())) expect(f.data).toHaveProperty(k);
    expect(p.doc.name).toBe("Ozubené kolo m3 z30");
    expect(f.body).toBeUndefined();
    // vlastní název dílu se nepřepíše
    const named = planCreate({ ...part(), name: "Převodovka" }, { kind: "spur", data: KINDS.spur.defaults(), out: "wheel", op: "new", target: "this" });
    expect(named.kind === "commit" && named.doc.name).toBe("Převodovka");
  });
  it("díl s tělesem: nové těleso dostane volný název, přidat / odebrat bez tělesa, zuby do tělesa vždy odebírají", () => {
    const d = withBox();
    const nb = planCreate(d, { kind: "spur", data: KINDS.spur.defaults(), out: "wheel", op: "new", target: "this" });
    expect(nb.kind === "commit" && nb.feature.body).toBe("Těleso 2");
    expect(nb.kind === "commit" && nb.doc.name).toBe("Díl 1");
    const add = planCreate(d, { kind: "spur", data: KINDS.spur.defaults(), out: "wheel", op: "add", target: "this" });
    expect(add.kind === "commit" && (add.feature as unknown as { data: { mode: string } }).data.mode).toBe("add");
    const teeth = planCreate(d, { kind: "spur", data: KINDS.spur.defaults(), out: "teeth", op: "add", target: "this" });
    expect(teeth.kind === "commit" && (teeth.feature as unknown as { data: { mode: string; out: string } }).data).toMatchObject({ mode: "cut", out: "teeth" });
    // druhé kolo stejného názvu
    if (add.kind === "commit") {
      const again = planCreate(add.doc, { kind: "spur", data: KINDS.spur.defaults(), out: "wheel", op: "add", target: "this" });
      expect(again.kind === "commit" && again.feature.name).toBe("Ozubené kolo m2 z24 (2)");
    }
  });
  it("zuby do prázdného dílu = chyba; chybná tabulka = chyba s textem řádku", () => {
    expect(planCreate(part(), { kind: "spur", data: KINDS.spur.defaults(), out: "teeth", op: "add", target: "this" }).kind).toBe("error");
    const e = planCreate(part(), { kind: "spur", data: { ...KINDS.spur.defaults(), z: 3 }, out: "wheel", op: "new", target: "this" });
    expect(e.kind === "error" && e.text).toMatch(/Počet zubů/);
  });
  it("sestava / nový díl: skript existujících příkazů, který parser zná – pro každý druh", () => {
    const asm: CadDoc = { ...emptyDoc("Sestava 1"), kind: "assembly", components: [] };
    for (const k of GEAR_KINDS) {
      const p = planCreate(asm, { kind: k, data: KINDS[k].defaults(), out: "wheel", op: "new", target: "this" });
      expect(p.kind, k).toBe("text");
      if (p.kind !== "text") continue;
      const lines = p.script.split("\n");
      expect(lines[0]).toMatch(/^nový díl "/);
      expect(lines[2]).toMatch(new RegExp(`^prvek gear\\.${k}\\b`));
      const r = parseAgentText(p.script);
      expect(r.errors.map((x) => x.message), k).toEqual([]);
      const f = r.ops.find((o) => o.k === "feature") as { feature: { ext: string; data: Record<string, unknown>; name: string } } | undefined;
      expect(f?.feature.ext).toBe(`gear.${k}`);
      expect(f?.feature.name).toBe(p.name);
    }
    const blank = planCreate(part(), { kind: "spur", data: { ...KINDS.spur.defaults(), z: 40 }, out: "blank", op: "new", target: "new" });
    expect(blank.kind === "text" && blank.script).toMatch(/out=blank/);
  });
  it("soukolí čelní m 2 z1 20 z2 60 a 81: posunutí podle DIN 3992 a skript s vazbou zuby 20 60", () => {
    const { res, script } = planPair("spur", { m: 2, z1: 20, z2: 60, a: 81 });
    expect(res.ok).toBe(true);
    expect(res.rows.find((r) => r.key === "sumX")?.value).toMatch(/^0[.,]52/);
    expect(script.filter((l) => l.startsWith("nový díl"))).toHaveLength(2);
    expect(script.some((l) => l.startsWith("nová sestava"))).toBe(true);
    expect(script[script.length - 1]).toMatch(/^sestava vazba ozubení .* zuby 20 60$/);
    expect(parseAgentText(script.join("\n")).errors).toEqual([]);
  });
  it("každý druh soukolí s výchozí tabulkou se vyřeší a jeho skript parser zná", () => {
    for (const k of Object.keys(PAIR_ROWS) as PairKind[]) {
      const { res, script } = planPair(k, {});
      expect(res.ok, k).toBe(true);
      expect(parseAgentText(script.join("\n")).errors.map((e) => e.message), k).toEqual([]);
    }
  });
  it("✗ řádky protokolu", () => {
    expect(protocolErrors("✓ 1 ok\n✗ 2 chyba\n  ✗ 3 další")).toEqual(["✗ 2 chyba", "✗ 3 další"]);
  });
});

describe("naposledy použité a knihovna", () => {
  it("ukládá jen hodnoty odlišné od výchozích, bez umístění", () => {
    expect(storable("spur", { ...KINDS.spur.defaults(), m: 3, position: [1, 2, 3], out: "blank" })).toEqual({ m: 3 });
  });
  it("rodiny staré knihovny → druh a tabulka", () => {
    expect(libraryToGear("gear", { m: "2.5", z: 30, b: 25, x: 0.1, alpha: "20", bore: 20, keyway: true, hub: 40, hubL: 10 })).toEqual({ kind: "spur", data: { m: 2.5, z: 30, b: 25, x: 0.1, alpha: 20, bore: 20, keyway: true, hubD: 40, hubL: 10 } });
    expect(libraryToGear("sprocket", { chain: "10B", z: 21, rows: "2" })?.data).toMatchObject({ chain: "10B", z: 21, rows: 2 });
    expect(libraryToGear("gearHelical", { mn: "3", z: 25, beta: 12, hand: "L", b: 30 })?.data).toMatchObject({ m: 3, z: 25, beta: 12, hand: "left" });
    expect(libraryToGear("gearBevel", { m: "2", z: 20, delta: 45, b: 12 })?.data.zMate).toBe(20);
    expect(libraryToGear("rack", { m: "2", n: 50, b: 20, h: 25 })).toEqual({ kind: "rack", data: { m: 2, z: 50, b: 20, h: 25 } });
    expect(libraryToGear("vpulley", {})).toBeNull();
    for (const id of ["gear", "gearInternal", "rack", "sprocket", "htd", "gearHelical", "gearBevel", "worm", "wormWheel"]) {
      const g = libraryToGear(id, {});
      expect(g, id).not.toBeNull();
      expect(evaluate(g!.kind, { ...KINDS[g!.kind].defaults(), ...g!.data }).ok, id).toBe(true);
    }
  });
});

describe("2D náhled", () => {
  it("každý druh s výchozí tabulkou má obrys a rozumný rámeček", () => {
    for (const k of GEAR_KINDS) {
      const sk = wheelSketch(k as GearKind, KINDS[k].defaults());
      expect(sk.shapes.length, k).toBeGreaterThan(0);
      expect(shapePath(sk.shapes[0]).length, k).toBeGreaterThan(20);
      const [a, b] = sk.box;
      expect(b[0] - a[0], k).toBeGreaterThan(1);
      expect(b[1] - a[1], k).toBeGreaterThan(1);
    }
  });
  it("čelní kolo: hlavová kružnice dₐ/2, díra jako otvor, detail kolem zubu 0", () => {
    const sk = wheelSketch("spur", { ...KINDS.spur.defaults(), bore: 20 });
    expect(sk.circles.find((c) => c.role === "tip")?.r).toBeCloseTo(26, 9);
    expect(sk.shapes[0].holes).toHaveLength(1);
    expect(Math.max(...sk.shapes[0].outer.map((p) => Math.hypot(p[0], p[1])))).toBeCloseTo(26, 2);
    const f = toothFocus("spur", KINDS.spur.defaults());
    expect(f && (f[0][0] + f[1][0]) / 2).toBeCloseTo(24, 6);
  });
  it("neplatná tabulka → prázdný náhled bez výjimky", () => {
    expect(wheelSketch("spur", { m: -1, z: 0 }).shapes.length).toBeGreaterThanOrEqual(0);
  });
  it("soukolí: obě kola v poloze sestavy, přímka záběru prochází valivým bodem", () => {
    const { res } = planPair("spur", { m: 2, z1: 20, z2: 60 });
    const sk = pairSketch("spur", res);
    expect(sk.shapes.filter((s) => s.wheel === 0).length).toBe(1);
    expect(sk.shapes.filter((s) => s.wheel === 1).length).toBe(1);
    const act = sk.lines.find((l) => l.role === "action")!;
    // valivý bod (r_w1 = 20, 0) leží na přímce záběru
    const [a, b] = [act.a, act.b];
    const t = (20 - a[0]) / (b[0] - a[0]);
    expect(a[1] + t * (b[1] - a[1])).toBeCloseTo(0, 6);
    expect(sk.box[1][0]).toBeGreaterThan(80 + 60 - 1); // kolo 2 v a = 80
    for (const k of Object.keys(PAIR_ROWS) as PairKind[]) {
      const p = pairSketch(k, planPair(k, {}).res);
      expect(p.shapes.length, k).toBeGreaterThanOrEqual(2);
    }
  });
});
