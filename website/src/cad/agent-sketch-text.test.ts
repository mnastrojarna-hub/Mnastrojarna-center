/**
 * Vazby, kóty a roviny skici textem (agent-sketch.ts + parser v agent.ts): rozbor všech druhů vazeb a kót česky, anglicky
 * a německy, ověření počtu a druhu odkazů, krátká id entit (e1, e2…), vyřešení obdélníku ze čtyř úseček do „Plně určeno“,
 * řídicí kóta mění geometrii, počátek skici, konflikt řešiče, konec bloku skici, textový stav, skica na ploše a pomocné rovině.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, docStatusText, parseAgentText, selectFaces } from "./agent";
import { applySketchOp, parseConstraints, parseDims, sketchOnPlane, sketchStatusLines, withTextIds, type SketchKernel, type SketchOnOp } from "./agent-sketch";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type SketchPlane } from "./types";

afterEach(() => setLang("cs"));
type SketchF = Extract<Feature, { type: "sketch" }>;

/** Provede skici, entity, vazby a kóty programu nad dokumentem stejně jako smyčka operací v cad-app.tsx (bez jádra). */
function run(text: string, doc: CadDoc = emptyDoc("Test")) {
  const p = parseAgentText(text);
  const log: string[] = p.errors.map((e) => `✗ řádek ${e.line}: ${e.message}`);
  for (const op of p.ops) {
    try {
      if (op.k === "feature") doc.features.push(op.feature);
      else if (op.k === "entities" || op.k === "constraints" || op.k === "dims") log.push(...applySketchOp(doc.features, op).map((x) => `${op.line}: ${x}`));
      else throw new Error(`neočekávaná operace ${op.k}`);
    } catch (e) {
      log.push(`✗ řádek ${op.line}: ${(e as Error).message}`);
    }
  }
  const sketches = doc.features.filter((f): f is SketchF => f.type === "sketch");
  return { doc, log, text: log.join("\n"), sk: sketches[sketches.length - 1] };
}
const ent = (sk: SketchF, id: string) => sk.entities.find((e) => e.id === id) as SketchEntity & Record<string, unknown>;
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v, `${a} ≈ ${b}`).toBeCloseTo(b[i], 4));
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

const RECT = `skica XY
úsečka 0 0 60 0
úsečka 60 0 60 40
úsečka 60 40 0 40
úsečka 0 40 0 0
vazba shodně e1.b e2.a; shodně e2.b e3.a; shodně e3.b e4.a; shodně e4.b e1.a
vazba vodorovně e1; vodorovně e3; svisle e2; svisle e4
vazba shodně e1.a počátek
kóta délka e1 80
kóta délka e2 50`;

describe("rozbor vazeb: všechny druhy česky, anglicky a německy", () => {
  const cases: [string, string, string, string, number][] = [
    // [česky, anglicky, německy, typ, počet odkazů]
    ["vodorovně e1", "horizontal e1", "waagerecht e1", "horizontal", 1],
    ["svisle e1.a e2.b", "vertical e1.a e2.b", "senkrecht e1.a e2.b", "vertical", 2],
    ["shodně e1.b e2.a", "coincident e1.b e2.a", "deckungsgleich e1.b e2.a", "coincident", 2],
    ["totožně e1.b e2.a", "coincident e1.b e2.a", "koinzident e1.b e2.a", "coincident", 2],
    ["rovnoběžně e1 e3", "parallel e1 e3", "parallel e1 e3", "parallel", 2],
    ["kolmo e1 e2", "perpendicular e1 e2", "rechtwinklig e1 e2", "perpendicular", 2],
    ["tečně e1 e5", "tangent e1 e5", "tangential e1 e5", "tangent", 2],
    ["stejně e1 e3", "equal e1 e3", "gleich e1 e3", "equal", 2],
    ["pevně e1.a", "fixed e1.a", "fest e1.a", "fixed", 1],
    ["soustředně e5 e6", "concentric e5 e6", "konzentrisch e5 e6", "concentric", 2],
    ["středem e5.střed e1", "midpoint e5.center e1", "mittelpunkt e5.mitte e1", "midpoint", 2],
    ["na křivce e1.b e5", "onCurve e1.b e5", "aufKurve e1.b e5", "pointOnCurve", 2],
    ["bod na křivce e1.b e5", "pointOnCurve e1.b e5", "auf Kurve e1.b e5", "pointOnCurve", 2],
    ["symetricky e1.a e2.b e3", "symmetric e1.a e2.b e3", "symmetrisch e1.a e2.b e3", "symmetric", 3],
    ["kolineárně e1 e4", "collinear e1 e4", "kollinear e1 e4", "collinear", 2],
  ];
  it("každý druh ve třech jazycích (s příkazem vazba / constraint / bedingung)", () => {
    for (const [cs, en, de, type, n] of cases) {
      for (const [cmd, body] of [["vazba", cs], ["constraint", en], ["bedingung", de]] as const) {
        const p = parseAgentText(`${cmd} ${body}`);
        expect(p.errors, `${cmd} ${body}`).toEqual([]);
        expect(p.ops[0], `${cmd} ${body}`).toMatchObject({ k: "constraints", items: [{ type }] });
        expect((p.ops[0] as { items: { refs: unknown[] }[] }).items[0].refs).toHaveLength(n);
      }
    }
  });
  it("více vazeb na řádku (středník, slovo vazba lze opakovat), odkazy a souřadnice pevného bodu", () => {
    const items = parseConstraints("vazba kolmo e1 e2; vodorovně e1; vazba pevně e3.a 10 -5,5; shodně e4.střed počátek; svisle e2.p0 e2.p3");
    expect(items.map((x) => x.type)).toEqual(["perpendicular", "horizontal", "fixed", "coincident", "vertical"]);
    expect(items[0].refs).toEqual([{ e: "e1" }, { e: "e2" }]);
    expect(items[2]).toMatchObject({ refs: [{ e: "e3", k: "a" }], at: [10, -5.5] });
    expect(items[3].refs).toEqual([{ e: "e4", k: "střed" }, { origin: true }]);
    expect(parseConstraints("fixed e1.a at 0 0")[0].at).toEqual([0, 0]);
    expect(parseConstraints("coincident e1.a origin")[0].refs[1]).toEqual({ origin: true });
    expect(parseConstraints("deckungsgleich e1.a ursprung")[0].refs[1]).toEqual({ origin: true });
  });
  it("chyby rozboru s očekávaným zápisem", () => {
    expect(err("vazba kolmo e1")).toMatch(/^vazba kolmo: špatný počet odkazů \(1\) – zápis: vazba kolmo e1 e2 \(dvě úsečky\)/);
    expect(err("vazba symetricky e1.a e2.b")).toMatch(/špatný počet odkazů \(2\) – zápis: vazba symetricky e1.a e2.b e3/);
    expect(err("vazba nesmysl e1")).toMatch(/^neznámý druh vazby „nesmysl“ – druhy: vodorovně, svisle, shodně, rovnoběžně, kolmo/);
    expect(err("vazba")).toMatch(/^vazba potřebuje druh a odkazy/);
    expect(err("vazba kolmo e1 e#2")).toMatch(/„e#2“ není odkaz na entitu skici/);
    expect(err("vazba vodorovně e1 5")).toMatch(/čísla „5“ navíc/);
    expect(err("vazba pevně e1.a 5")).toMatch(/čísla „5“ navíc/);
    // chyba je na správném řádku
    const p = parseAgentText("skica XY\núsečka 0 0 10 0\nvazba kolmo e1");
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].line).toBe(3);
  });
});

describe("rozbor kót: všechny druhy, hodnoty, referenční", () => {
  const cases: [string, string, string, string][] = [
    ["délka e1 50", "length e1 50", "Länge e1 50", "length"],
    ["vzdálenost e1.a e3.b 40", "distance e1.a e3.b 40", "Abstand e1.a e3.b 40", "distance"],
    ["vodorovně e1.a e2.b 30", "horizontal e1.a e2.b 30", "waagerecht e1.a e2.b 30", "horizontal"],
    ["svisle počátek e1.a 20", "vertical origin e1.a 20", "senkrecht ursprung e1.a 20", "vertical"],
    ["poloměr e5 10", "radius e5 10", "Radius e5 10", "radius"],
    ["průměr e5 20", "diameter e5 20", "Durchmesser e5 20", "diameter"],
    ["úhel e1 e2 45", "angle e1 e2 45", "Winkel e1 e2 45", "angle"],
    ["délka oblouku e5 30", "arcLength e5 30", "Bogenlänge e5 30", "arcLength"],
  ];
  it("každý druh ve třech jazycích (kóta / dim / bemaßung / maß; „dimension“ je kótování výkresu)", () => {
    for (const [cs, en, de, type] of cases) {
      for (const [cmd, body] of [["kóta", cs], ["dim", en], ["dims", en], ["bemaßung", de], ["maß", de]] as const) {
        const p = parseAgentText(`${cmd} ${body}`);
        expect(p.errors, `${cmd} ${body}`).toEqual([]);
        expect(p.ops[0], `${cmd} ${body}`).toMatchObject({ k: "dims", items: [{ type, driving: true }] });
      }
    }
  });
  it("hodnoty: desetinná čárka, Ø a R, mm a °, referenční", () => {
    const d = parseDims("kóta délka e1 12,5; poloměr e5 Ø20; průměr e6 R4; úhel e1 e2 30°; délka e3 40mm; vzdálenost e1.a e2.b 7 referenční; průměr e7 reference");
    expect(d.map((x) => [x.type, x.value, x.driving])).toEqual([
      ["length", 12.5, true],
      ["diameter", 20, true], // „Ø20“ u poloměru = průměr 20
      ["radius", 4, true], // „R4“ u průměru = poloměr 4
      ["angle", 30, true],
      ["length", 40, true],
      ["distance", 7, false],
      ["diameter", undefined, false],
    ]);
    expect(parseDims("Länge e1 10 Referenz")[0].driving).toBe(false);
  });
  it("chyby rozboru kót", () => {
    expect(err("kóta délka e1")).toMatch(/^kóta délka potřebuje hodnotu \(nebo „referenční“\) – zápis: kóta délka e1 50/);
    expect(err("kóta úhel e1 e2 200")).toMatch(/mezi 0° a 180°/);
    expect(err("kóta délka e1 -5")).toMatch(/musí být kladná/);
    expect(err("kóta vodorovně e1.a e2.b -5")).toMatch(/nesmí být záporná/);
    expect(err("kóta délka e1 e2 50")).toMatch(/^kóta délka: špatný počet odkazů \(2\)/);
    expect(err("kóta délka e1 5 6")).toMatch(/jen jedna hodnota/);
    expect(err("kóta šířka e1 5")).toMatch(/^neznámý druh kóty „šířka“ – druhy: délka, vzdálenost, vodorovně, svisle, poloměr, průměr, úhel, délka oblouku/);
  });
  it("vazba a kóta jsou v tabulce příkazů (nápověda, hláška o neznámém příkazu) ve všech jazycích", () => {
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("vazba") && c.en === "constraint" && c.de === "bedingung")).toBe(true);
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("kóta") && /dim/.test(c.en) && /bemaßung/.test(c.de))).toBe(true);
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("skica plocha") && /sketch face/.test(c.en) && /skizze fläche/.test(c.de))).toBe(true);
    expect(err("nesmysl")).toMatch(/příkazy: .*vazba, kóta/);
    setLang("en");
    expect(err("nonsense")).toMatch(/commands: .*sketch face, sketch plane, constraint, dim/);
    setLang("de");
    expect(err("unsinn")).toMatch(/skizze fläche, skizze ebene, bedingung, bemaßung, maß/);
  });
});

describe("id entit zadaných textem", () => {
  it("e1, e2… v pořadí vzniku, za nejvyšším eN, bez kolize", () => {
    const mk = (id: string): SketchEntity => ({ id, type: "point", p: [0, 0] });
    expect(withTextIds([], [mk("x"), mk("y")]).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(withTextIds([mk("k3j9x2a"), mk("e2"), mk("e1_1")], [mk("x"), mk("y")]).map((e) => e.id)).toEqual(["e3", "e4"]);
    expect(withTextIds([mk("e7"), mk("e8")], [mk("x")]).map((e) => e.id)).toEqual(["e9"]);
  });
  it("entity ze skici i dalších řádků; protokol vypíše jejich id", () => {
    const r = run("skica XY: kružnice 10; obdélník 20 10\núsečka 0 0 5 5\nčára 0 0 10 0 r 2 10 10 0 10 uzavřít");
    // čára se zaobleným rohem = 4 úsečky + 1 oblouk
    expect(r.sk.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]);
    expect(r.log[0]).toMatch(/^1: ✓ 2 entity do skici „Skica 1“ \(e1, e2\)$/);
    expect(r.log[1]).toMatch(/\(e3\)$/);
    expect(r.log[2]).toMatch(/^3: ✓ 5 entit do skici „Skica 1“ \(e4–e8\)$/);
  });
  it("entity bloku, jehož skica nevznikla, se nepřidají do předchozí skici", () => {
    const r = run("skica XY: kružnice 10\nskica normála 0 1: kružnice 5\nkružnice 3");
    expect(r.doc.features).toHaveLength(1);
    expect(r.sk.entities).toHaveLength(1);
    expect(r.text).toMatch(/✗ řádek 3: skica z řádku 2 nevznikla/);
  });
});

describe("řešení skice po vazbách a kótách", () => {
  it("obdélník ze čtyř úseček: vazby + kóty → Plně určeno, rozměry 80 × 50 od počátku", () => {
    const r = run(RECT);
    expect(r.log.filter((l) => /^\d+: ✗|^✗/.test(l))).toEqual([]);
    expect(r.log[4]).toMatch(/^6: ✓ vazby ve skice „Skica 1“: shodně e1.b e2.a, shodně e2.b e3.a, shodně e3.b e4.a, shodně e4.b e1.a → Nedourčeno \(8 st. volnosti\)$/);
    expect(r.log[5]).toMatch(/^7: ✓ vazby ve skice „Skica 1“: vodorovně e1, vodorovně e3, svisle e2, svisle e4 → Nedourčeno \(4 st. volnosti\)$/);
    expect(r.log[6]).toMatch(/^8: ✓ vazby ve skice „Skica 1“: pevně e1.a 0 0 → Nedourčeno \(2 st. volnosti\)$/);
    expect(r.log[7]).toMatch(/^9: ✓ kóty ve skice „Skica 1“: délka e1 80 → Nedourčeno \(1 st. volnosti\)$/);
    expect(r.log[8]).toMatch(/^10: ✓ kóty ve skice „Skica 1“: délka e2 50 → Plně určeno$/);
    near(ent(r.sk, "e1").a as number[], [0, 0]);
    near(ent(r.sk, "e1").b as number[], [80, 0]);
    near(ent(r.sk, "e2").b as number[], [80, 50]);
    near(ent(r.sk, "e3").a as number[], [80, 50]);
    near(ent(r.sk, "e3").b as number[], [0, 50]);
    near(ent(r.sk, "e4").a as number[], [0, 50]);
    near(ent(r.sk, "e4").b as number[], [0, 0]);
    // „shodně … počátek“ = pevný bod v [0; 0] (žádná pomocná entita), vazby a kóty zůstaly ve skice
    expect(r.sk.entities).toHaveLength(4);
    expect(r.sk.constraints).toHaveLength(9);
    expect(r.sk.constraints?.find((c) => c.type === "fixed")).toMatchObject({ refs: [{ e: "e1", k: "a" }], value: [0, 0] });
    expect(r.sk.dims?.map((d) => [d.type, d.value, d.driving])).toEqual([["length", 80, true], ["length", 50, true]]);
    // textový stav: entity s id a stav určenosti
    const st = docStatusText(r.doc, null);
    expect(st).toMatch(/entity: e1 úsečka \[0; 0\]→\[80; 0\] · e2 úsečka \[80; 0\]→\[80; 50\] · e3 úsečka \[80; 50\]→\[0; 50\] · e4 úsečka \[0; 50\]→\[0; 0\]/);
    expect(st).toMatch(/vazby 9, kóty 2 · Plně určeno/);
  });
  it("totéž anglicky a německy: protokol v jazyce rozhraní, popisy vazeb jsou platné příkazy daného jazyka", () => {
    setLang("en");
    const en = run(`sketch XY
line 0 0 60 0
line 60 0 60 40
line 60 40 0 40
line 0 40 0 0
constraint coincident e1.b e2.a; coincident e2.b e3.a; coincident e3.b e4.a; coincident e4.b e1.a
constraint horizontal e1; horizontal e3; vertical e2; vertical e4
constraint coincident e1.a origin
dim length e1 80
dim length e2 50`);
    expect(en.log[6]).toBe("8: ✓ constraints in sketch “Sketch 1”: fixed e1.a 0 0 → Under-defined (2 degrees of freedom)");
    expect(en.log[8]).toBe("10: ✓ dimensions in sketch “Sketch 1”: length e2 50 → Fully defined");
    near(ent(en.sk, "e2").b as number[], [80, 50]);
    setLang("de");
    const de = run(`skizze XY
linie 0 0 60 0
linie 60 0 60 40
linie 60 40 0 40
linie 0 40 0 0
bedingung deckungsgleich e1.b e2.a; deckungsgleich e2.b e3.a; deckungsgleich e3.b e4.a; deckungsgleich e4.b e1.a
bedingung waagerecht e1; waagerecht e3; senkrecht e2; senkrecht e4
bedingung deckungsgleich e1.a ursprung
bemaßung länge e1 80
maß Länge e2 50,5`);
    expect(de.log[8]).toBe("10: ✓ Bemaßungen in Skizze „Skizze 1“: Länge e2 50,5 → Vollständig bestimmt");
    near(ent(de.sk, "e2").b as number[], [80, 50.5]);
    expect(run("skizze XY\nlinie 0 0 10 0\nbedingung rechtwinklig e1").text).toMatch(/Bedingung rechtwinklig: falsche Anzahl von Referenzen \(1\) – Schreibweise: bedingung rechtwinklig e1 e2 \(zwei Linien\)/);
  });
  it("řídicí kóta délka změní úsečku; referenční kóta jen měří", () => {
    const free = run("skica XY\núsečka 0 0 30 0\nkóta délka e1 45");
    const l = ent(free.sk, "e1") as unknown as { a: number[]; b: number[] };
    expect(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])).toBeCloseTo(45, 5);
    expect(free.log[1]).toMatch(/délka e1 45 → Nedourčeno \(3 st. volnosti\)/);
    const r = run("skica XY\núsečka 0 0 30 0\nvazba pevně e1.a\nkóta délka e1 45\nkóta vzdálenost e1.a e1.b 99 referenční");
    near(ent(r.sk, "e1").b as number[], [45, 0]);
    expect(r.sk.dims?.[1]).toMatchObject({ type: "distance", driving: false, value: 45 });
    expect(r.log[3]).toMatch(/vzdálenost e1.a e1.b 45 referenční → Nedourčeno \(1 st. volnosti\)/);
    // vzdálenost s jedním odkazem = délka; průměr kružnice
    const c = run("skica XY\nkružnice 10 v 5 5\nkóta průměr e1 Ø24\nkóta vzdálenost e1 x 3");
    expect((ent(c.sk, "e1") as unknown as { r: number }).r).toBeCloseTo(12, 5);
    expect(c.text).toMatch(/✗ řádek 4: entita „x“ ve skice „Skica 1“ není – entity: e1/);
  });
  it("počátek: kóta od počátku přidá pomocný pevný bod O, soustředně s počátkem = pevný střed", () => {
    const r = run("skica XY\nkružnice 10 v 7 3\nkóta vodorovně počátek e1.střed 30; svisle počátek e1 20\nkružnice 4 v 1 1\nvazba soustředně e2 počátek");
    const o = ent(r.sk, "O");
    expect(o).toMatchObject({ type: "point", p: [0, 0], construction: true });
    near([ent(r.sk, "e1").cx as number, ent(r.sk, "e1").cy as number], [30, 20]);
    near([ent(r.sk, "e2").cx as number, ent(r.sk, "e2").cy as number], [0, 0]);
    expect(r.log[1]).toMatch(/kóty ve skice „Skica 1“: vodorovně počátek e1.center 30, svisle počátek e1.center 20/);
    expect(r.sk.constraints?.filter((c) => c.type === "fixed")).toHaveLength(2);
    // druhá kóta od počátku pomocný bod nezdvojí
    expect(r.sk.entities.filter((e) => e.type === "point")).toHaveLength(1);
    // soustředně kružnice + bod oblouku (ne střed) = shodně střed kružnice – bod; drážka a mnohoúhelník: poloměr ano, tečnost ne
    const q = run("skica XY\nkružnice 4 v 0 0\noblouk 10 0 15 5 20 0\ndrážka 30 10 v 0 30\nvazba soustředně e1 e2.a\nkóta poloměr e3 6\nvazba tečně e3 e1");
    expect(q.sk.constraints?.[0]).toMatchObject({ type: "coincident", refs: [{ e: "e1", k: "center" }, { e: "e2", k: "a" }] });
    near([ent(q.sk, "e1").cx as number, ent(q.sk, "e1").cy as number], ent(q.sk, "e2").a as number[]);
    expect((ent(q.sk, "e3") as unknown as { width: number }).width).toBeCloseTo(12, 5);
    expect(q.text).toMatch(/✗ řádek 7: vazba tečně: „e3“ je entita, čeká se úsečka nebo kružnice \/ oblouk/);
  });
  it("druh a body odkazů se ověřují proti entitám skici (chyba na správném řádku)", () => {
    const base = "skica XY\núsečka 0 0 10 0\núsečka 10 0 10 10\nkružnice 6 v 20 0\n";
    const r = run(base + "vazba kolmo e1 e3\nvazba shodně e1.x e2.a\nvazba tečně e1 e2\nvazba stejně e1 e3\nkóta poloměr e1 5\nvazba kolmo e1 e9\nvazba pevně počátek\nkóta délka oblouku e3 4");
    expect(r.text).toMatch(/✗ řádek 5: vazba kolmo: „e3“ je kružnice \/ oblouk, čeká se úsečka – zápis: vazba kolmo e1 e2 \(dvě úsečky\)/);
    expect(r.text).toMatch(/✗ řádek 6: entita e1 \(úsečka\) nemá bod ani stranu „x“ – lze: a, b, mid/);
    expect(r.text).toMatch(/✗ řádek 7: vazba tečně: aspoň jeden odkaz musí být kružnice nebo oblouk/);
    expect(r.text).toMatch(/✗ řádek 8: vazba stejně: obě entity musí být stejného druhu/);
    expect(r.text).toMatch(/✗ řádek 9: kóta poloměr: „e1“ je úsečka, čeká se kružnice \/ oblouk/);
    expect(r.text).toMatch(/✗ řádek 10: entita „e9“ ve skice „Skica 1“ není – entity: e1, e2, e3/);
    expect(r.text).toMatch(/✗ řádek 11: vazba pevně: počátek je pevný sám o sobě/);
    expect(r.text).toMatch(/✗ řádek 12: kóta délka oblouku: „e3“ není oblouk/);
    // chybný řádek nic nepřidá
    expect(r.sk.constraints ?? []).toEqual([]);
    expect(r.sk.dims ?? []).toEqual([]);
  });
  it("body a strany: konce, střed úsečky, střed kružnice, strana obdélníku, segment lomené čáry, bod", () => {
    const r = run("skica XY\nobdélník 40 20\nčára 0 0 10 0 10 10\nbod 3 4\noblouk 0 0 5 5 10 0\nkóta délka e1.s0 50\nkóta vodorovně e2.g1 0\nvazba shodně e3 e4.konec; středem e3 e2.g0; na křivce e4.střed e1.s2");
    expect(r.text).not.toMatch(/✗/);
    const rect = ent(r.sk, "e1") as unknown as { w: number };
    expect(rect.w).toBeCloseTo(50, 4);
    expect(r.sk.constraints?.map((c) => c.refs.map((x) => `${x.e}.${x.k}`).join(" "))).toEqual(["e3.p e4.c", "e3.p e2.g0", "e4.center e1.s2"]);
  });
  it("konflikt: kóta v rozporu se nepřidá (✗), geometrie i dosavadní kóty beze změny", () => {
    const r = run("skica XY\núsečka 0 0 10 0\nkóta délka e1 10\nkóta délka e1 20");
    expect(r.log[2]).toMatch(/^4: ✗ kóta délka e1 20 ve skice „Skica 1“ nepřidána – v rozporu s dosavadními vazbami a kótami$/);
    expect(r.sk.dims).toHaveLength(1);
    near(ent(r.sk, "e1").b as number[], [10, 0]);
    // referenční (měřící) kóta skicu nepřeurčí – přidá se
    const ref = run("kóta délka e1 referenční", r.doc);
    expect(ref.log[0]).toMatch(/^1: ✓ kóty ve skice „Skica 1“: délka e1 10 referenční/);
    expect(ref.sk.dims).toHaveLength(2);
    // nadbytečná (ale splnitelná) vazba se také nepřidá – skica nezůstane přeurčená
    const red = run("skica XY\núsečka 0 0 10 0\nvazba vodorovně e1; vodorovně e1");
    expect(red.log[1]).toMatch(/^3: ✓ vazby ve skice „Skica 1“: vodorovně e1 → Nedourčeno/);
    expect(red.log[2]).toMatch(/^3: ✗ vazba vodorovně e1 ve skice „Skica 1“ nepřidána – nadbytečná/);
    expect(red.sk.constraints).toHaveLength(1);
    // skica přeurčená už předem (JSON, starší verze): nová nezávislá vazba se přidá, stav ⚠ zůstane
    const pre = run("skica XY\núsečka 0 0 10 0\núsečka 0 0 0 10");
    pre.sk.constraints = [{ id: "h1", type: "horizontal", refs: [{ e: "e1", k: "self" }] }, { id: "h2", type: "horizontal", refs: [{ e: "e1", k: "self" }] }];
    const again = run("vazba svisle e2", pre.doc);
    expect(again.log[0]).toMatch(/^1: ⚠ vazby ve skice „Skica 1“: svisle e2 → Přeurčeno – nadbytečné vazby \(1\): vodorovně e1$/);
  });
  it("konec bloku skici: skica s vazbami se po dalších entitách vyřeší a ohlásí stav, bez vazeb mlčí", () => {
    const p = parseAgentText("skica XY\núsečka 0 0 10 0\nvazba vodorovně e1\núsečka 0 0 0 10\nvysunout 5");
    const ents = p.ops.filter((o) => o.k === "entities") as { end?: boolean }[];
    expect(ents.map((o) => !!o.end)).toEqual([false, true]);
    const r = run("skica XY\núsečka 0 0 10 0\nvazba vodorovně e1\núsečka 0 0 0 10");
    expect(r.log[r.log.length - 1]).toMatch(/^4: ✓ skica „Skica 1“: Nedourčeno \(7 st. volnosti\)$/);
    const plain = run("skica XY: kružnice 10\núsečka 0 0 5 0");
    expect(plain.log).toHaveLength(2);
    // blok skončený vazbou se znovu neřeší
    expect((parseAgentText("skica XY: kružnice 5\nvazba pevně e1").ops[1] as { end?: boolean }).end).toBeUndefined();
  });
  it("vazby bez skici v tomto vstupu jdou do poslední skice dokumentu", () => {
    const first = run("skica XY: úsečka 0 0 10 0");
    const r = run("kóta délka e1 25", first.doc);
    expect(r.log[0]).toMatch(/kóty ve skice „Skica 1“: délka e1 25/);
    expect(run("vazba vodorovně e1").text).toMatch(/není žádná skica/);
  });
  it("textový stav: u velké skici jen počet, pomocné entity označené", () => {
    const many = run(`skica XY: ${Array.from({ length: 41 }, (_, i) => `bod ${i} 0`).join("; ")}`);
    expect(sketchStatusLines(many.sk).join("\n")).toMatch(/entit 41 – jednotlivě s id se vypisují jen skici do 40 entit/);
    const small = run("skica XY: pomocná úsečka 0 0 0 10; kružnice 8 v 1 2; oblouk 0 0 5 5 10 0");
    expect(sketchStatusLines(small.sk)[0]).toBe("    entity: e1 úsečka [0; 0]→[0; 10] (pomocná) · e2 kružnice Ø8 [1; 2] · e3 oblouk [0; 0]→[10; 0] přes [5; 5]");
  });
});

describe("skica na ploše modelu a na pomocné rovině", () => {
  const resolvedPlane: SketchPlane = { kind: "custom", origin: [20, 15, 22], normal: [0, 0, -1], xDir: [0, 1, 0], label: "Plocha 6" };
  const kernel = (o: { faces?: number; planar?: boolean; body?: boolean } = {}) => {
    const calls: string[] = [];
    const k: SketchKernel = {
      build: async (doc) => {
        calls.push(`build ${doc.features.length}`);
        const planes: Record<string, SketchPlane> = {};
        for (const f of doc.features) if (f.type === "sketch" && f.planeDef) planes[f.id] = resolvedPlane;
        return { metrics: o.body === false ? null : { volume: 1, area: 1, bbox: [[0, 0, 0], [40, 30, 20]], faces: o.faces ?? 6, edges: 12 }, status: doc.features.map((f) => ({ id: f.id, ok: true })), resolved: { planes, datums: {} } };
      },
      face: async (i) => (calls.push(`face ${i}`), { planar: o.planar ?? true }),
      refInfo: async (_d, ref) => (calls.push(`refInfo ${JSON.stringify(ref)}`), { sig: { t: "PLANE", c: [20, 15, 20], s: 1200 } }),
      topology: async () => ({
        faces: [{ index: 0, planar: true, normal: [0, 0, -1], center: [20, 15, 0] }, { index: 1, planar: false, surface: "CYLINDER" }, { index: 3, planar: true, normal: [1, 0, 0], center: [40, 15, 10] }, { index: 5, planar: true, normal: [0, 0, 1], center: [20, 15, 20] }],
        bbox: [[0, 0, 0], [40, 30, 20]],
      }),
      selectFaces,
    };
    return { k, calls };
  };
  const box = (): CadDoc => ({ ...emptyDoc("Kvádr"), features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [40, 30, 20], position: [0, 0, 0], centered: false, mode: "new" }] });
  const sketchOn = (text: string) => {
    const p = parseAgentText(text);
    expect(p.errors, text).toEqual([]);
    expect(p.ops[0].k).toBe("sketchOn");
    return { op: p.ops[0] as SketchOnOp, p };
  };

  it("rozbor: plocha F číslem (1 = první), odsazení, obráceně; anglicky a německy; entity patří k této skice", () => {
    const { op, p } = sketchOn("skica plocha F6 odsazení 2 obráceně: kružnice 5");
    expect(op).toMatchObject({ on: { face: 6 }, offset: 2, flip: true, feature: { type: "sketch" } });
    expect(p.ops[1]).toMatchObject({ k: "entities", sketch: { id: op.feature.id, line: 1 } });
    expect(sketchOn("sketch face f3").op).toMatchObject({ on: { face: 3 }, offset: 0, flip: false });
    expect(sketchOn("skizze fläche F3 versatz 2,5 umkehren").op).toMatchObject({ on: { face: 3 }, offset: 2.5, flip: true });
    expect(sketchOn('skica rovina "Rovina 1" odsazení 5: kružnice 4').op).toMatchObject({ on: { datum: "Rovina 1" }, offset: 5 });
    expect(sketchOn("skica rovina Rovina 1").op.on).toEqual({ datum: "Rovina 1" });
    expect(sketchOn('sketch plane "Plane 1"').op.on).toEqual({ datum: "Plane 1" });
    expect(sketchOn("skizze ebene „Ebene 1“ versatz 3").op).toMatchObject({ on: { datum: "Ebene 1" }, offset: 3 });
    // „skica rovina XY“ = základní rovina, ne pomocná
    expect(parseAgentText("skica rovina XZ").ops[0]).toMatchObject({ k: "feature", feature: { plane: { kind: "base", name: "XZ" } } });
    // plocha pravidlem jako u skořepiny
    expect(sketchOn("skica plocha horní: kružnice 5").op).toMatchObject({ on: { faceRule: ["horni"] } });
    expect(sketchOn("sketch face +X offset 1").op).toMatchObject({ on: { faceRule: ["+x"] }, offset: 1 });
    expect(err("skica plocha")).toMatch(/^skica na ploše potřebuje číslo plochy nebo pravidlo: skica plocha F3 \| horní \| \+X/);
    expect(err("skica plocha F0")).toMatch(/potřebuje číslo plochy/);
    expect(err("skica rovina")).toMatch(/potřebuje její název/);
  });
  it("plocha: otisk (sig) jako při výběru myší, asociativní planeDef, rovina z výsledku stavby", async () => {
    const { op } = sketchOn("skica plocha F6 odsazení 2 obráceně");
    const { k, calls } = kernel();
    const doc = box();
    const r = await sketchOnPlane(op.feature, op, doc, k);
    expect(r.feature.planeDef).toEqual({ kind: "face", ref: { kind: "face", index: 5, sig: { t: "PLANE", c: [20, 15, 20], s: 1200 } }, offset: 2, flip: true });
    expect(r.feature.plane).toEqual(resolvedPlane);
    expect(r.log).toBe("✓ Skica 1 na ploše F6 +2 mm (obráceně) – rovina: počátek [20; 15; 22], normála −Z, osa X skici +Y");
    // nejdřív stavba dokumentu (těleso v jádře), pak plocha a otisk, nakonec stavba se skicou (vyřešená rovina)
    expect(calls).toEqual(["build 1", "face 5", 'refInfo {"kind":"face","index":5}', "build 2"]);
    expect(doc.features).toHaveLength(1); // dokument mění až aplikace
    // pravidlem: horní plocha = F6, +X = F4
    const top = sketchOn("skica plocha horní").op;
    const rt = await sketchOnPlane(top.feature, top, doc, kernel().k);
    expect(rt.feature.planeDef).toMatchObject({ kind: "face", ref: { index: 5 } });
    expect(rt.log).toMatch(/^✓ Skica 1 na ploše F6 \(horni\) – rovina:/);
    const px = sketchOn("skica plocha +X").op;
    expect((await sketchOnPlane(px.feature, px, doc, kernel().k)).feature.planeDef).toMatchObject({ ref: { index: 3 } });
    const many = sketchOn("skica plocha rovinné").op;
    await expect(sketchOnPlane(many.feature, many, doc, kernel().k)).rejects.toThrow(/^pravidlu „rovinne“ odpovídá 3 rovinných ploch – zadejte ho jednoznačně/);
    const bad = sketchOn("skica plocha modrá").op;
    await expect(sketchOnPlane(bad.feature, bad, doc, kernel().k)).rejects.toThrow(/neznámé pravidlo pro plochy „modra“/);
  });
  it("plocha: chyby s nápovědou rovinných ploch", async () => {
    const doc = box();
    const f = sketchOn("skica plocha F7").op;
    await expect(sketchOnPlane(f.feature, f, doc, kernel().k)).rejects.toThrow(/^plocha F7 v tělese není – těleso má 6 ploch \(F1 až F6\) – rovinné plochy: F1 \(normála −Z, střed \[20; 15; 0\]\), F4 \(normála \+X, střed \[40; 15; 10\]\), F6 \(normála \+Z, střed \[20; 15; 20\]\)$/);
    const g = sketchOn("skica plocha F2").op;
    await expect(sketchOnPlane(g.feature, g, doc, kernel({ planar: false }).k)).rejects.toThrow(/^plocha F2 není rovinná – skicu lze založit jen na rovinné ploše – rovinné plochy: F1/);
    await expect(sketchOnPlane(g.feature, g, emptyDoc("x"), kernel({ body: false }).k)).rejects.toThrow(/dokument nemá těleso/);
  });
  it("pomocná rovina podle názvu (i $last), odsazení", async () => {
    const doc = box();
    doc.features.push({ id: "d1", name: "Rovina 1", type: "datum", origin: [0, 0, 5], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 });
    const a = sketchOn('skica rovina "rovina 1" odsazení 5').op;
    const r = await sketchOnPlane(a.feature, a, doc, kernel().k);
    expect(r.feature.planeDef).toEqual({ kind: "datum", featureId: "d1", offset: 5 });
    expect(r.log).toMatch(/^✓ Skica 1 na pomocné rovině „Rovina 1“ \+5 mm – rovina: počátek/);
    const b = sketchOn("skica rovina $last").op;
    expect((await sketchOnPlane(b.feature, b, doc, kernel().k)).feature.planeDef).toEqual({ kind: "datum", featureId: "d1" });
    const c = sketchOn("skica rovina Nic").op;
    await expect(sketchOnPlane(c.feature, c, doc, kernel().k)).rejects.toThrow(/^pomocná rovina „Nic“ v dílu není – pomocné roviny: Rovina 1$/);
  });
});

describe("opravy po kontrole: název skici, otevřená skica, přeurčující vazby", () => {
  it("„plocha“ / „rovina“ v názvu skici není umístění na plochu / pomocnou rovinu", () => {
    const a = parseAgentText("skica XY název Plocha 3: kružnice 5 v 10 10");
    expect(a.errors).toEqual([]);
    expect(a.ops[0]).toMatchObject({ k: "feature", feature: { name: "Plocha 3", plane: { kind: "base", name: "XY" } } });
    const b = parseAgentText("skica XY název Horní plocha: obdélník 20 10");
    expect(b.errors).toEqual([]);
    expect(b.ops[0]).toMatchObject({ k: "feature", feature: { name: "Horní plocha" } });
    expect(parseAgentText("sketch XZ name Top face plane").ops[0]).toMatchObject({ k: "feature", feature: { name: "Top face plane", plane: { name: "XZ" } } });
    // umístění před názvem dál platí
    expect(parseAgentText("skica plocha F3 název Horní plocha").ops[0]).toMatchObject({ k: "sketchOn", on: { face: 3 }, feature: { name: "Horní plocha" } });
    expect(parseAgentText('skica rovina "Rovina 1" název Rovina víka').ops[0]).toMatchObject({ k: "sketchOn", on: { datum: "Rovina 1" }, feature: { name: "Rovina víka" } });
  });
  it("vazby a kóty bez bloku skici jdou do skici otevřené ve skicáři (ne do poslední)", () => {
    const { doc } = run("skica XY: úsečka 0 0 40 7\nskica XZ: úsečka 0 0 40 9");
    const [s1, s2] = doc.features as SketchF[];
    const op = parseAgentText("vazba vodorovně e1").ops[0] as Parameters<typeof applySketchOp>[1];
    const log = applySketchOp(doc.features, op, s1.id);
    expect(log[0]).toMatch(/^✓ vazby ve skice „Skica 1“: vodorovně e1/);
    expect((doc.features[0] as SketchF).constraints?.map((c) => c.type)).toEqual(["horizontal"]);
    expect((doc.features[1] as SketchF).constraints ?? []).toEqual([]);
    expect(ent(doc.features[1] as SketchF, "e1").b).toEqual([40, 9]);
    // blok skici (skica z tohoto vstupu) má přednost; neexistující otevřená skica = poslední skica
    const blk = parseAgentText("skica XY: úsečka 0 0 10 3\nvazba vodorovně e1").ops;
    doc.features.push((blk[0] as { feature: Feature }).feature);
    for (const o of blk.slice(1)) applySketchOp(doc.features, o as Parameters<typeof applySketchOp>[1], s1.id);
    expect((doc.features[2] as SketchF).constraints?.map((c) => c.type)).toEqual(["horizontal"]);
    expect((doc.features[0] as SketchF).constraints).toHaveLength(1);
    applySketchOp(doc.features, parseAgentText("kóta délka e1 30").ops[0] as Parameters<typeof applySketchOp>[1], "nic");
    expect((doc.features[2] as SketchF).dims?.map((d) => d.value)).toEqual([30]);
    expect(s2.dims ?? []).toEqual([]);
  });
  it("vazba nebo kóta, která by skicu přeurčila, se nepřidá (✗), ostatní z řádku ano", () => {
    const r = run("skica XY\núsečka 0 0 10 0\nvazba pevně e1.a 0 0\nkóta vodorovně počátek e1.a 10");
    expect(r.log[r.log.length - 1]).toMatch(/^4: ✗ kóta vodorovně počátek e1\.a 10 ve skice „Skica 1“ nepřidána – v rozporu s dosavadními vazbami a kótami/);
    expect(r.sk.dims ?? []).toEqual([]);
    // pomocný bod počátku pro odmítnutou kótu nezůstane
    expect(r.sk.entities.map((e) => e.id)).toEqual(["e1"]);
    const m = run("skica XY\núsečka 0 0 10 0\núsečka 0 0 0 10\nvazba vodorovně e1; svisle e2; vodorovně e1; kolmo e1 e2");
    expect(m.log.slice(-3)).toEqual([
      "4: ✓ vazby ve skice „Skica 1“: vodorovně e1, svisle e2 → Nedourčeno (6 st. volnosti)",
      "4: ✗ vazba vodorovně e1 ve skice „Skica 1“ nepřidána – nadbytečná: tutéž geometrii už určují dosavadní vazby a kóty",
      "4: ✗ vazba kolmo e1 e2 ve skice „Skica 1“ nepřidána – nadbytečná: tutéž geometrii už určují dosavadní vazby a kóty",
    ]);
    expect(m.sk.constraints?.map((c) => c.type)).toEqual(["horizontal", "vertical"]);
  });
});
