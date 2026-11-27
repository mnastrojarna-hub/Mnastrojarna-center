/**
 * Vlna 15 – balík asm (zkouška 959, bez jádra):
 * - B11: pohybová studie hlásila „natáčí se“ u komponent vložených s otočením 180 0 0, které se jen posouvají – Eulerovy úhly
 *   se mezi kroky přepínaly 180 ↔ −180 (táž poloha, rozdíl 360° po složkách). Nově úhel mezi maticemi vůči výchozímu stavu.
 * - B15 + P2-11: kusovník podle ZDROJE (přejmenovaná instance řádek nerozdělí), přezdívka instance `vložit … jako "K48"`
 *   (EN as, DE als) – odkaz ve vazbách místo #k, ve stromu, kusovník ji nepoužívá.
 * - pružina mezi komponentami: délka z dosedacích ploch při přepočtu i v pohybové studii, síla F = c·Δl, ✗ pod délkou na doraz.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { aliasProblem, componentLines, findComp, insertExtras, insertNote, asmStatusLines, type AsmCmd } from "./agent-asm";
import { computeBom, flattenAssembly, partComponent, sourceKey, transformPoint } from "./assembly";
import { springDocAt, springEffective, springGeom, springMeshMatrix } from "./asm-spring-geom";
import { springLine, springMotionLines, springState, springStatusLine, springVerdict, withSprings } from "./asm-spring";
import { setLang } from "./i18n";
import { compressionSpring } from "./library/pins";
import type { FaceGeo, GeoProvider } from "./mates";
import { motionCsv, motionSummary, poseDoc, rotationAngleDeg, runMotion, type MotionResult } from "./motion";
import { emptyDoc, type AsmComponent, type CadDoc, type Feature, type Mate, type MateRef, type Placement, type Vec3 } from "./types";
import { bomOf, flattenLeaves } from "@/components/cad/asm-flatten";

afterEach(() => setLang("cs"));

const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const part = (name: string, features: Partial<Feature>[] = []): CadDoc => ({ ...emptyDoc(name), features: features as Feature[] });
const comp = (id: string, placement: Placement, doc = part(id), extra: Partial<AsmComponent> = {}): AsmComponent => ({ id, name: id, source: { kind: "part", doc }, placement, ...extra });
const asm = (components: AsmComponent[], mates: Mate[] = []): CadDoc => ({ ...emptyDoc("Sestava"), kind: "assembly", components, mates });
const asmOp = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return (p.ops[0] as { cmd: AsmCmd }).cmd;
};

/* ───────────────────────── B11 ───────────────────────── */

describe("B11 – natočení v pohybové studii vůči výchozímu stavu", () => {
  const doc = asm([comp("S", P([0, 0, 10], [180, 0, 0])), comp("K", P())]);
  const step = (i: number, s: Vec3, k: Vec3): MotionResult["steps"][number] => ({ i, t: i, motors: [i], place: { S: P([0, 0, 10 + i], s), K: P([0, 0, 0], k) }, conflicts: [] });
  const res = (steps: MotionResult["steps"]): MotionResult => ({ steps, comps: [{ id: "S", name: "Šroub M6x20" }, { id: "K", name: "Klika" }], motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 });

  it("repro 959: Eulerovy úhly 180 ↔ −180 (dR 2,4e-16) – čistý posuv už není „natáčí se“", () => {
    // vlna 22, M3: řádky po dílech jsou detail (výchozí = tuhé skupiny) – kontrola „natáčí se“ v obou podobách
    const r1 = res([step(0, [180, 0, 0], [0, 0, 0]), step(1, [-180, 0, 0], [0, 0, 0]), step(2, [180, 1e-12, 0], [0, 0, 0])]);
    expect(motionSummary(r1, doc).join("\n")).not.toContain("natáčí se");
    const lines = motionSummary(r1, doc, { detail: true });
    const s = lines.find((l) => l.includes("Šroub M6"))!;
    expect(s).toContain("rozsah pohybu X 0 · Y 0 · Z 2 mm");
    expect(s).not.toContain("natáčí se");
  });
  it("skutečné natočení se hlásí i s úhlem; 0 180 180 = 180 0 0", () => {
    const r2 = res([step(0, [180, 0, 0], [0, 0, 0]), step(1, [0, 180, 180], [0, 0, 15]), step(2, [180, 0, 0], [0, 0, 30])]);
    // tuhé skupiny (názvy z dokumentu: „K“ = Klika, „S“ = šroub): skutečné natočení zůstává, čistý posuv bez „natáčí se“
    expect(motionSummary(r2, doc).find((l) => l.includes("„K“"))).toContain("natáčí se 30°");
    expect(motionSummary(r2, doc).find((l) => l.includes("„S“"))).not.toContain("natáčí se");
    const lines = motionSummary(r2, doc, { detail: true });
    expect(lines.find((l) => l.includes("Klika"))).toContain("natáčí se 30°");
    expect(lines.find((l) => l.includes("Šroub M6"))).not.toContain("natáčí se");
    expect(rotationAngleDeg([180, 0, 0], [-180, 0, 0])).toBeLessThan(1e-9);
    expect(rotationAngleDeg([180, 0, 0], [0, 180, 180])).toBeLessThan(1e-6);
    expect(rotationAngleDeg([0, 0, 0], [0, 0, 1e-3])).toBeCloseTo(1e-3, 9);
    expect(rotationAngleDeg([10, 20, 30], [10, 20, 31])).toBeGreaterThan(0.5);
  });
});

/* ───────────────────────── B15 ───────────────────────── */

describe("B15 – kusovník podle zdroje, přezdívka instance", () => {
  const plate = part("Upínací deska", [{ id: "b", name: "K", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" } as Partial<Feature>]);
  const screw = part("Šroub M6x20", [{ id: "c", name: "V", type: "cylinder", radius: 3, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" } as Partial<Feature>]);
  const info = () => ({ material: "ocel", massKg: 0.1 });
  const base = () => asm([partComponent(plate, P(), { id: "p" } as Partial<AsmComponent>), ...[1, 2, 3, 4].map((i) => partComponent(screw, P([i * 10, 0, 0], [180, 0, 0]), { id: `s${i}` } as Partial<AsmComponent>))]);

  it("repro: přejmenovaná instance („… -1“) dřív rozdělila řádek kusovníku – nyní jeden řádek, počet 4", () => {
    const d = base();
    d.components![2] = { ...d.components![2], name: "Šroub M6x20 -1" };
    const rows = computeBom(d, info);
    expect(rows.map((r) => [r.name, r.qty])).toEqual([
      ["Upínací deska", 1],
      ["Šroub M6x20", 4],
    ]);
    expect(rows[1].ids).toEqual(["s1", "s2", "s3", "s4"]);
    // strukturovaný i panel aplikace (asm-flatten bomOf) totéž
    expect(computeBom(d, info, { structured: true }).map((r) => r.qty)).toEqual([1, 4]);
    expect(bomOf(d, true, info).map((r) => r.qty)).toEqual([1, 4]);
    expect(bomOf(d, false, info).map((r) => r.qty)).toEqual([1, 4]);
  });
  it("jiné číslo výkresu = jiná položka; jiný zdroj = jiná položka", () => {
    const d = base();
    d.components![4] = { ...d.components![4], number: "ISO 4762 M6x20" };
    expect(computeBom(d, info).map((r) => r.qty)).toEqual([1, 3, 1]);
    const other = { ...screw, features: [{ ...screw.features[0], height: 25 } as Feature] };
    const e = base();
    e.components![1] = { ...e.components![1], source: { kind: "part", doc: other } };
    expect(computeBom(e, info).map((r) => r.qty)).toEqual([1, 1, 3]);
  });
  it("vložit … jako \"K48\" (CS/EN/DE) – přezdívka, kontrola jednoznačnosti, hláška", () => {
    for (const line of ['vložit "Šroub M6x20" v 0 0 5 otočení 180 0 0 jako "K48"', 'insert "Šroub M6x20" at 0 0 5 rotation 180 0 0 as "K48"', 'einfügen "Šroub M6x20" bei 0 0 5 drehung 180 0 0 als "K48" fest']) {
      const p = parseAgentText(line);
      expect(p.errors, line).toEqual([]);
      expect(p.ops[0], line).toMatchObject({ k: "insert", tab: "Šroub M6x20", at: [0, 0, 5], rotation: [180, 0, 0], alias: "K48" });
    }
    expect(parseAgentText('vložit "Díl" jako').errors[0].message).toMatch(/chybí přezdívka/);
    const d = base();
    d.components![1] = { ...d.components![1], alias: "K48" };
    expect(insertExtras(d, { fixed: true, alias: "K49" })).toEqual({ fixed: true, alias: "K49" });
    expect(() => insertExtras(d, { fixed: false, alias: "k48" })).toThrow(/už má komponenta/);
    expect(() => insertExtras(d, { fixed: false, alias: "upinaci deska" })).toThrow(/název jiné komponenty/);
    expect(aliasProblem(d, "#3")).toMatch(/nesmí začínat/);
    expect(insertNote({ fixed: true, alias: "K48" })).toBe(" (ukotvená) · přezdívka „K48“");
  });
  it("přezdívka ve vazbách místo #k, ve stromu [K48]; kusovník beze změny", () => {
    const d = base();
    d.components![3] = { ...d.components![3], alias: "K48" };
    expect(findComp(d, "K48").id).toBe("s3");
    expect(findComp(d, "k48").id).toBe("s3");
    expect(() => findComp(d, "Šroub M6x20")).toThrow(/#4 \(K48\)/);
    const m = asmOp('sestava vazba zámek "K48" "Upínací deska"');
    expect(m).toMatchObject({ k: "mate", kind: "lock", a: "K48" });
    expect(componentLines(d).join("\n")).toContain("#4 Šroub M6x20 [K48]");
    expect(asmStatusLines(d)[0]).toContain("Šroub M6x20 [K48]");
    expect(computeBom(d, info).map((r) => [r.name, r.qty])).toEqual([
      ["Upínací deska", 1],
      ["Šroub M6x20", 4],
    ]);
    // sestava komponenta … přezdívka / alias / Spitzname
    expect(asmOp('sestava komponenta #2 přezdívka "K1"')).toMatchObject({ k: "comp", comp: "#2", patch: { alias: "K1" } });
    expect(asmOp('assembly component #2 alias "K1"')).toMatchObject({ k: "comp", patch: { alias: "K1" } });
    expect(asmOp('baugruppe komponente #2 als "K1"')).toMatchObject({ k: "comp", patch: { alias: "K1" } });
  });
});

/* ───────────────────────── pružina ───────────────────────── */

const springPart = (d = 2, D = 20, L = 44, n = 8) => compressionSpring.make({ d, D, L, n }) as CadDoc;
type Geos = Record<string, Record<string, FaceGeo>>;
const provider = (G: Geos): GeoProvider => (r) => G[r.compId]?.[`f${r.face}`] ?? null;
const f = (compId: string, face: number): MateRef => ({ compId, face });

describe("pružina – geometrie (síť a přesný díl v aktuální délce)", () => {
  it("normálie DIN 2095 d2 D20 L44 n8: osa Z, začátek −d/2, délka 44, doraz (n+1)·d = 18", () => {
    const g = springGeom(springPart())!;
    expect(g.kind).toBe("spring");
    expect(g.axis).toEqual([0, 0, 1]);
    expect(g.base[2]).toBeCloseTo(-1, 9);
    expect(g.length).toBeCloseTo(44, 9);
    expect(g.solid).toBeCloseTo(18, 9);
    const at38 = springDocAt(springPart(), 38);
    const sp = at38.features.find((x) => x.type === "spring") as Feature & { pitch: number; turns: number; wire: number };
    expect(sp.pitch * sp.turns + sp.wire).toBeCloseTo(38, 9);
    // pod dorazem se závity neprotnou (stoupání ≥ drát)
    const at10 = springDocAt(springPart(), 10).features.find((x) => x.type === "spring") as Feature & { pitch: number; wire: number };
    expect(at10.pitch).toBeGreaterThan(at10.wire);
    expect(springGeom(part("Trubka", [{ id: "t", type: "tube", outer: 20, inner: 10, height: 38, position: [0, 0, 0], axis: "Z", mode: "new" } as Partial<Feature>]))).toMatchObject({ kind: "tube", length: 38 });
    expect(springGeom(part("Kvádr", [{ id: "b", type: "box", size: [1, 1, 1], position: [0, 0, 0], mode: "new" } as Partial<Feature>]))).toBeNull();
  });
  it("springEffective (jádro) a springMeshMatrix (síť) – začátek na dosedací ploše, délka L", () => {
    const c = comp("P", P([5, 0, 10], [180, 0, 0]), springPart(), { spring: { a: f("A", 0), b: f("B", 0), free: 44, length: 38, offset: 2 } });
    const e = springEffective(c);
    // osa po otočení 180 0 0 míří −Z: začátek se posune o 2 mm dolů
    expect(e.placement.position).toEqual([5, 0, 8]);
    expect(springGeom((e.source as { doc: CadDoc }).doc)!.length).toBeCloseTo(38, 9);
    expect(sourceKey(e.source)).not.toBe(sourceKey(c.source));
    // bez změny délky i polohy tatáž komponenta (stejný klíč – bez stavby)
    const same = { ...c, spring: { ...c.spring!, length: 44, offset: 0 } };
    expect(springEffective(same)).toBe(same);
    const m = springMeshMatrix(c)!;
    const ap = (p: Vec3): Vec3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    expect(ap([0, 0, -1])).toEqual([0, 0, 1]); // začátek (lokálně −1) + offset 2 po ose
    expect(ap([0, 0, 43])[2]).toBeCloseTo(1 + 38, 9); // konec volné pružiny → začátek + L
    expect(ap([9, 0, -1])[0]).toBeCloseTo(9, 12); // napříč beze změny
    // rozložení sestavy: aplikace (exaktní díl) vs. přehrávání studie (síť volné pružiny s měřítkem)
    const d = asm([comp("A", P()), comp("B", P()), c]);
    expect(flattenLeaves(d).find((l) => l.id === "P")!.key).toBe(sourceKey(e.source));
    expect(flattenLeaves(d, { springMesh: true }).find((l) => l.id === "P")!.key).toBe(sourceKey(c.source));
    expect(flattenAssembly(d).find((l) => l.comp.id === "P")!.placement.position).toEqual([5, 0, 8]);
  });
});

/** deska A (pevná, horní plocha z = 20), deska B nad ní (spodní plocha z = 0 v jejích souřadnicích), pružina na A */
function springRig(bz: number, def: Partial<NonNullable<AsmComponent["spring"]>> = {}) {
  const G: Geos = {
    A: { f0: { kind: "plane", origin: [50, 50, 20], normal: [0, 0, 1] }, f1: { kind: "cylinder", origin: [0, 0, 0], normal: [0, 0, 1], radius: 10 } },
    B: { f0: { kind: "plane", origin: [50, 50, 0], normal: [0, 0, -1] }, f1: { kind: "cylinder", origin: [0, 0, 0], normal: [0, 0, 1], radius: 10 } },
  };
  const S = comp("S", P([30, 30, 21]), springPart(), { spring: { a: f("A", 0), b: f("B", 0), free: 44, solid: 18, rate: 25, ...def } });
  return { doc: asm([comp("A", P(), part("A"), { fixed: true }), comp("B", P([0, 0, bz]), part("B")), S]), geo: provider(G) };
}

describe("pružina – délka z dosedacích ploch (přepočet), síla, doraz", () => {
  it("vzdálenost ploch 38 mm: délka 38, začátek posunut na plochu A, F = 25·6 = 150 N ✓", () => {
    const { doc, geo } = springRig(58);
    const s = springState(doc, doc.components![2], geo)!;
    expect(s).toMatchObject({ seat: 38, length: 38, offset: 0, level: "ok" });
    expect(s.force).toBeCloseTo(150, 9);
    expect(springLine(s)).toBe("✓ pružina „S“: délka 38 mm · L0 44 · Ln 18 · stlačení 6 mm · síla 150 N (c 25 N/mm)");
    const d2 = withSprings(doc, geo);
    expect(d2.components![2].spring).toMatchObject({ length: 38, offset: 0, seat: 38 });
    expect(springStatusLine(d2)).toBe("Pružiny: „S“ 38 mm (L0 44 · Ln 18) · F 150 N ✓");
    expect(asmStatusLines(d2).join("\n")).toContain("Pružiny: „S“ 38 mm");
  });
  it("pod délkou na doraz ✗, nad volnou délkou ⚠ (tvar volný, mezera), obrácené plochy ✗", () => {
    const low = springRig(35);
    const s = springState(low.doc, low.doc.components![2], low.geo)!;
    expect(s.level).toBe("error");
    expect(s.note).toMatch(/pod délku na doraz Ln 18 mm \(vzdálenost ploch 15 mm, chybí 3 mm\)/);
    expect(springLine(s)).toMatch(/^✗ pružina „S“/);
    const high = springRig(70);
    const h = springState(high.doc, high.doc.components![2], high.geo)!;
    expect(h).toMatchObject({ seat: 50, length: 44, level: "warn", force: 0 });
    expect(h.note).toMatch(/mezera 6 mm/);
    // stav dokumentu pamatuje vzdálenost ploch: nedosedající pružina je ve „stav“ ⚠, ne ✓
    expect(springStatusLine(withSprings(high.doc, high.geo))).toBe("Pružiny: „S“ 44 mm (L0 44 · Ln 18) · F 0 N ⚠");
    expect(springVerdict(-2, 44, 18).level).toBe("error");
    // začátek pružiny 1 mm nad plochou A → offset −1 (dosedne)
    const off = springRig(58);
    off.doc.components![2] = { ...off.doc.components![2], placement: P([30, 30, 22]) };
    expect(springState(off.doc, off.doc.components![2], off.geo)).toMatchObject({ offset: -1, seat: 38 });
  });
  // vlna 22, body 2 a 8 (VĚDOMÁ změna): délka pružiny na doraz Ln je tvrdý doraz – motor, který by pružinu stlačil pod Ln, se na
  // dorazu zastaví (⚠ motion.motor-limit, krok „stopped“); dřív deska prošla pod doraz a jen řádek pružiny byl ✗
  it("pohybová studie: deska B sjíždí 58 → 36 (motor na Vzdálenosti) – délka sleduje plochy, síla roste, na dorazu Ln motor stojí", async () => {
    const { doc, geo } = springRig(58);
    const mates: Mate[] = [
      { id: "c", type: "concentric", a: f("B", 1), b: f("A", 1) },
      { id: "d", type: "distance", a: f("B", 0), b: f("A", 0), value: 38 },
      { id: "l", type: "lock", a: f("S", -1), b: f("A", -1) },
    ];
    const d = { ...doc, mates };
    const res = await runMotion(d, geo, { motors: [{ id: "m", kind: "linear", mate: "d", from: 38, to: 16 }], duration: 1, steps: 11 });
    const L = res.steps.map((s) => s.springs!.S.length);
    expect(L[0]).toBeCloseTo(38, 6);
    // 18 mm (krok 10) = přesně na dorazu ✓; krok 11 (žádáno 16 mm) – motor stojí na dorazu 18 mm, pružina pod Ln nikdy
    expect(L[11]).toBeCloseTo(18, 4);
    expect(res.steps[11]).toMatchObject({ status: "stopped", cause: "motor" });
    expect(res.steps[11].reached![0]).toBeCloseTo(18, 4);
    // vlna 22, kolo 6 (vědomá změna): motion.conflict / s.conflicts nesou jen skutečně porušené vazby a pohony – meze, které motor zastavily a v poloze kroku jsou splněné, jsou jen „brání“ v motion.motor-limit: doraz Ln pružiny motor zastavil, ale je splněný → jen v odchylkách kroku
    expect(res.steps[11].conflicts).toEqual(["d"]);
    expect(res.steps[11].devs!.map((x) => x.id)).toEqual(expect.arrayContaining(["spring:S"]));
    expect(res.steps.map((s) => s.springs!.S.level)).toEqual(Array(12).fill("ok"));
    expect(res.steps[5].springs!.S.force).toBeCloseTo(25 * (44 - 28), 6);
    const sum = motionSummary(res, d);
    expect(sum.find((l) => l.includes("pružina „S“"))).toBe(" ✓ pružina „S“: délka 38 → 18 mm (min 18 · L0 44 · Ln 18) · síla 150 → 650 N (max 650 N)");
    expect(sum.find((l) => l.includes("motion.motor-limit"))).toMatch(/motor 1 stojí na mezi v krocích 11 \(t = 1 s\): žádáno 16 mm, dosaženo 18 mm – brání: pružina „S“ 18 mm – na délce na doraz Ln 18 mm/);
    // krok jako dokument: délka pružiny z kroku (zobrazení / export / „pohyb krok“)
    expect(poseDoc(d, res.steps[5].place, res.steps[5].springs).components![2].spring).toMatchObject({ length: 28 });
    // CSV: sloupce délky a síly na konci řádku
    const csv = motionCsv(res, d).split("\r\n");
    expect(csv[0].endsWith("S L [mm];S F [N]")).toBe(true);
    expect(csv[6].endsWith(";28;400")).toBe(true);
    // bez pružin se protokol nemění (žádný řádek pružin)
    const plain = await runMotion({ ...d, components: d.components!.map((c) => ({ ...c, spring: undefined })) }, geo, { motors: [{ id: "m", kind: "linear", mate: "d", from: 38, to: 30 }], duration: 1, steps: 2 });
    expect(plain.steps[0].springs).toBeUndefined();
    expect(motionSummary(plain, d).some((l) => l.includes("pružina"))).toBe(false);
  });
  it("souhrn pružin: ✓ celý zdvih nad dorazem, ⚠ nedosedá; řádek bez geometrie", () => {
    const { doc } = springRig(58);
    const st = (i: number, length: number, seat: number, level: "ok" | "warn" | "error") => ({ i, t: i, springs: { S: { length, seat, offset: 0, level, force: 25 * (44 - length) } } });
    expect(springMotionLines(doc, [st(0, 40, 40, "ok"), st(1, 30, 30, "ok")])[0]).toBe("✓ pružina „S“: délka 40 → 30 mm (min 30 · L0 44 · Ln 18) · síla 100 → 350 N (max 350 N)");
    expect(springMotionLines(doc, [st(0, 44, 46, "warn"), st(1, 40, 40, "ok")])[0]).toMatch(/^⚠ .* nedosedá v krocích 0 \(mezera max 2 mm\)$/);
    expect(springMotionLines(doc, [{ i: 0, t: 0 }])[0]).toMatch(/délku nešlo určit/);
    // 6 stejných pružin ve stejném stavu = jeden řádek s počtem (protokol 959 bez šesti stejných řádků)
    const six = { ...doc, components: [...doc.components!, ...[2, 3, 4, 5, 6].map((k) => ({ ...doc.components![2], id: `S${k}` }))] };
    const stp = [0, 1].map((i) => ({ i, t: i, springs: Object.fromEntries(["S", "S2", "S3", "S4", "S5", "S6"].map((id) => [id, { length: 40 - 10 * i, seat: 40 - 10 * i, offset: 0, level: "ok" as const, force: 25 * (4 + 10 * i) }])) }));
    expect(springMotionLines(six, stp)).toEqual(["✓ pružina „S“: délka 40 → 30 mm (min 30 · L0 44 · Ln 18) · síla 100 → 350 N (max 350 N) (6×)"]);
  });
});

describe("pružina – příkaz sestava pružina (CS/EN/DE)", () => {
  it("rozbor: mezi A [F] B [F], volná, blok, tuhost, odebrat, pružiny", () => {
    expect(asmOp('sestava pružina "Pružina R20" mezi "Vodicí deska" "Kotevní deska" volná 44 blok 20 tuhost 25')).toEqual({ k: "spring", comp: "Pružina R20", a: "Vodicí deska", b: "Kotevní deska", free: 44, solid: 20, rate: 25 });
    expect(asmOp('sestava pružina #40 mezi "A" F3 a "B" F7')).toMatchObject({ k: "spring", comp: "#40", a: "A", faceA: { index: 2 }, b: "B", faceB: { index: 6 } });
    expect(asmOp('assembly spring "P" between "A" +Z and "B" -Z free 44 solid 18 rate 2.5')).toMatchObject({ a: "A", faceA: { rule: ["+z"] }, b: "B", faceB: { rule: ["-z"] }, free: 44, solid: 18, rate: 2.5 });
    expect(asmOp('baugruppe feder "P" zwischen "A" und "B" frei 44 block 18 steifigkeit 25')).toMatchObject({ a: "A", b: "B", free: 44, solid: 18, rate: 25 });
    expect(asmOp('sestava pružina "P" odebrat')).toMatchObject({ k: "spring", comp: "P", remove: true });
    expect(asmOp("sestava pružiny")).toEqual({ k: "springs" });
    expect(asmOp("assembly springs")).toEqual({ k: "springs" });
    expect(parseAgentText('sestava pružina "P" volná 10 blok 20').errors[0].message).toMatch(/musí být menší než volná délka/);
    expect(parseAgentText('sestava pružina "P" volná 0').errors[0].message).toMatch(/musí být kladná/);
    // revize: tuhost 0 / blok 0 = zrušit dřív zadanou hodnotu (pole panelu „0 = neuvádět / z modelu“), záporná = ✗
    expect(asmOp('sestava pružina "P" tuhost 0 blok 0')).toMatchObject({ k: "spring", rate: 0, solid: 0 });
    expect(asmOp('sestava pružina "P" volná 10 blok 0')).toMatchObject({ free: 10, solid: 0 });
    expect(parseAgentText('sestava pružina "P" tuhost -1').errors[0].message).toMatch(/nesmí být záporná/);
    expect(parseAgentText('sestava pružina "P" mezi').errors[0].message).toMatch(/chybí komponenta A/);
  });
  it("transformPoint – začátek pružiny ve světě (kontrola předpokladu osy)", () => {
    const g = springGeom(springPart())!;
    expect(transformPoint(P([30, 30, 21]), g.base)).toEqual([30, 30, 20]);
  });
});
