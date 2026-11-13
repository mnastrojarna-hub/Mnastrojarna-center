/**
 * Textové příkazy doplněné po analýze nástrojů a testu na výkresu 604200.001: oblouk, spline a zaoblení rohu ve skice,
 * skica v obecné rovině, šikmá díra, více děr, tělesa, obecný příkaz „prvek“ pro všechny typy a rozšíření, normálie, sestava.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, featureSummary, parseAgentText, parseEntities } from "./agent";
import { setLang } from "./i18n";
import type { Feature, SketchEntity } from "./types";
import "./ext/index";

afterEach(() => setLang("cs"));
const feat = (text: string, i = 0) => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const op = p.ops[i];
  if (op.k !== "feature" && op.k !== "select") throw new Error(`op ${i} není prvek: ${op.k}`);
  return op.feature as Feature & Record<string, unknown>;
};
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

describe("skica: oblouk, spline, zaoblení rohu, obecná rovina", () => {
  it("oblouk třemi body a spline", () => {
    const p = parseAgentText("skica XZ: oblouk 0 0 5 5 10 0; spline 0 0 10 5 20 0 30 8; spline 0 0 10 0 10 10 uzavřít");
    expect(p.errors).toEqual([]);
    const ents = (p.ops[1] as { entities: SketchEntity[] }).entities;
    expect(ents[0]).toMatchObject({ type: "arc", a: [0, 0], b: [5, 5], c: [10, 0] });
    expect(ents[1]).toMatchObject({ type: "spline", points: [[0, 0], [10, 5], [20, 0], [30, 8]], closed: false });
    expect(ents[2]).toMatchObject({ type: "spline", closed: true });
    expect(err("skica XY: oblouk 0 0 5 0 10 0")).toMatch(/leží v přímce/);
    expect(err("skica XY: oblouk 0 0 5 5")).toMatch(/oblouk potřebuje tři body/);
    // anglicky a německy
    expect(parseEntities(["arc", "0", "0", "5", "5", "10", "0"])[0].type).toBe("arc");
    expect(parseEntities(["bogen", "0", "0", "5", "5", "10", "0"])[0].type).toBe("arc");
  });
  it("čára se zaobleným rohem → úsečky a oblouky tečně navazující", () => {
    const ents = parseEntities("čára 0 0 50 0 r 5 50 30 0 30 uzavřít".split(" "));
    expect(ents.map((e) => e.type)).toEqual(["line", "arc", "line", "line", "line"]);
    expect(ents[0]).toMatchObject({ type: "line", a: [0, 0], b: [45, 0] });
    const arc = ents[1] as Extract<SketchEntity, { type: "arc" }>;
    expect(arc.a).toEqual([45, 0]);
    expect(arc.c).toEqual([50, 5]);
    // střed oblouku [45; 5], bod na oblouku ve vzdálenosti 5 od středu
    expect(Math.hypot(arc.b[0] - 45, arc.b[1] - 5)).toBeCloseTo(5, 5);
    expect(ents[2]).toMatchObject({ type: "line", a: [50, 5], b: [50, 30] });
    // bez „r“ zůstává jedna lomená čára
    expect(parseEntities("čára 0 0 50 0 50 30 uzavřít".split(" ")).map((e) => e.type)).toEqual(["polyline"]);
    // všechny rohy
    const all = parseEntities("čára 0 0 r 2 40 0 r 2 40 20 r 2 0 20 r 2 uzavřít".split(" "));
    expect(all.filter((e) => e.type === "arc")).toHaveLength(4);
    expect(all.filter((e) => e.type === "line")).toHaveLength(4);
    expect(() => parseEntities("čára 0 0 10 0 r 20 10 10 0 10 uzavřít".split(" "))).toThrow(/zaoblení se nevejde/);
    expect(() => parseEntities("čára 0 0 r 2 10 0 10 10".split(" "))).toThrow(/krajní bod/);
  });
  it("skica v obecné rovině: počátek + normála (+ osa X)", () => {
    const f = feat("skica počátek 10 0 5 normála 0 1 1: kružnice 20");
    expect(f.plane).toMatchObject({ kind: "custom", origin: [10, 0, 5], xDir: [1, 0, 0] });
    const n = (f.plane as { normal: number[] }).normal;
    expect(n[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(n[2]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(feat("skica počátek 0 0 0 normála 1 0 0 osax 0 0 1: kružnice 5").plane).toMatchObject({ kind: "custom", normal: [1, 0, 0], xDir: [0, 0, 1] });
    expect(err("skica normála 0 1: kružnice 5")).toMatch(/normálu třemi čísly/);
  });
});

describe("díra: více poloh, směr, sklon; rotace odebrat", () => {
  it("více děr jedním příkazem", () => {
    const f = feat("díra 8 skrz v 10 0 5 v 20 0 5 v 30 0 5");
    expect(f.points).toEqual([{ kind: "xyz", p: [10, 0, 5] }, { kind: "xyz", p: [20, 0, 5] }, { kind: "xyz", p: [30, 0, 5] }]);
    expect(err("díra 8 skrz v 10 0 5 v 20 0")).toMatch(/tři souřadnice/);
  });
  it("šikmá díra směrem a sklonem", () => {
    const d = feat("díra 6 hloubka 20 v 0 0 10 směr 1 0 -1");
    expect(d.dirDef).toMatchObject({ kind: "vector" });
    const v = (d.dirDef as { v: number[] }).v;
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v[2]).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(d.flip).toBe(true); // vrtá se ve směru vektoru
    const t = feat("díra 6 skrz v 0 0 10 sklon 30");
    const tv = (t.dirDef as { v: number[] }).v;
    // výchozí vrtání dolů (−Z), odklon 30° k +X
    expect(tv[0]).toBeCloseTo(0.5, 5);
    expect(tv[2]).toBeCloseTo(-Math.cos(Math.PI / 6), 5);
    const ty = feat("díra 6 skrz v 0 0 10 sklon 45 směr +Y");
    expect((ty.dirDef as { v: number[] }).v[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("rotovat … odebrat / přidat / průnik / nové", () => {
    expect(feat("rotovat odebrat")).toMatchObject({ type: "revolve", angle: 360, mode: "cut" });
    expect(feat("rotovat 180 osa X přidat")).toMatchObject({ type: "revolve", angle: 180, mode: "add", axis: "x" });
    expect(feat("rotovat průnik")).toMatchObject({ mode: "intersect" });
    expect(feat("rotovat nové")).toMatchObject({ mode: "new", body: "$new" });
    expect(feat("rotieren abziehen")).toMatchObject({ type: "revolve", mode: "cut" });
  });
});

describe("více těles textem", () => {
  it("těleso, rozdělit, kopie, sloučit", () => {
    const p = parseAgentText(`těleso 2
rozdělit XZ odsazení 5 jako Víko
kopie těleso 2 posun 10 0 0 jako Kopie
sloučit 1 2 odebrat ponechat
sloučit "Základna" "Víko"
spojit 1 3 průnik`);
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "body", name: "Těleso 2" });
    expect((p.ops[1] as { feature: Feature }).feature).toMatchObject({ type: "splitBodies", plane: "XZ", offset: 5, nameB: "Víko" });
    expect((p.ops[2] as { feature: Feature }).feature).toMatchObject({ type: "copyBody", source: "Těleso 2", translate: [10, 0, 0], newName: "Kopie" });
    expect((p.ops[3] as { feature: Feature }).feature).toMatchObject({ type: "combine", target: "Těleso 1", tool: "Těleso 2", op: "cut", keepTool: true });
    expect((p.ops[4] as { feature: Feature }).feature).toMatchObject({ type: "combine", target: "Základna", tool: "Víko", op: "add", keepTool: false });
    expect((p.ops[5] as { feature: Feature }).feature).toMatchObject({ type: "combine", target: "Těleso 1", tool: "Těleso 3", op: "intersect" });
    expect(err("sloučit 1")).toMatch(/dvě tělesa/);
    expect(err("těleso")).toMatch(/název nebo číslo/);
  });
  it("cílové těleso a nové těleso u prvků", () => {
    expect(feat("kvádr 10 10 10 nové")).toMatchObject({ mode: "new", body: "$new" });
    expect(feat("kvádr 10 10 10 nové těleso Víko")).toMatchObject({ mode: "new", body: "Víko" });
    expect(feat("díra 5 skrz v 0 0 10 těleso 2")).toMatchObject({ type: "hole", body: "Těleso 2" });
    expect(feat("zaoblit 2 hrany svislé těleso 2")).toMatchObject({ type: "fillet", body: "Těleso 2" });
    expect(feat("kvádr 10 10 10").body).toBeUndefined();
  });
  it("souhrn prvků těles ve stavu", () => {
    expect(featureSummary({ id: "a", name: "R", type: "splitBodies", plane: "XY", offset: 5, nameB: "Víko" } as Feature)).toBe("rovina XY +5 → nové těleso „Víko“");
    expect(featureSummary({ id: "a", name: "S", type: "combine", target: "Těleso 1", tool: "Těleso 2", op: "cut", keepTool: true } as Feature)).toBe("odebrat od „Těleso 1“ − „Těleso 2“, nástroj ponechán");
    expect(featureSummary({ id: "a", name: "K", type: "copyBody", source: "", translate: [10, 0, 0] } as Feature)).toBe("kopie tělesa (aktivní), posun [10; 0; 0]");
  });
});

describe("obecný příkaz prvek", () => {
  it("základní typy: klíč=hodnota, vektory, ano/ne, název, cesty", () => {
    expect(feat(`prvek sweep profileId="Skica 1" pathId=$last název="Trubka"`)).toMatchObject({ type: "sweep", name: "Trubka", profileId: "Skica 1", pathId: "$last" });
    expect(feat("prvek transform translate=10;0;5 rotateAngle=45 rotateAxis=Z scale=1")).toMatchObject({ type: "transform", translate: [10, 0, 5], rotateAngle: 45, rotateAxis: "Z" });
    expect(feat("prvek datum planeDef={\"kind\":\"base\",\"name\":\"XY\",\"offset\":12}")).toMatchObject({ type: "datum", planeDef: { kind: "base", name: "XY", offset: 12 } });
    expect(feat("prvek box size=10;20;30,5 centered=ano")).toMatchObject({ type: "box", size: [10, 20, 30.5], centered: true });
    // český název typu
    expect(feat("prvek Úkos angle=3").type).toBe("draft");
  });
  it("plochy a hrany čísly nebo pravidlem", () => {
    const p = parseAgentText("prvek draft angle=3 faces=boční");
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "select", rule: ["bocni"], into: { path: "faces", kind: "faces" }, feature: { type: "draft", angle: 3 } });
    expect(feat("prvek draft angle=3 faces=1;4;5")).toMatchObject({ type: "draft", faces: [1, 4, 5] });
    expect(feat("prvek fillet radius=2 edges=all")).toMatchObject({ type: "fillet", edges: "all" });
  });
  it("prvek rozšíření: id, popisek, parametry klíčem i popiskem", () => {
    const f = feat("prvek adv.twist sketch=$last height=62,5 angle=-45 mode=odebrat");
    expect(f).toMatchObject({ type: "ext", ext: "adv.twist" });
    expect(f.data).toMatchObject({ sketch: "$last", height: 62.5, angle: -45, mode: "cut" });
    // parametry českým popiskem, typ popiskem v uvozovkách
    const g = feat(`prvek "Zkrut" výška=30 "úhel zkrutu"=120`.replace('"úhel zkrutu"=120', "úhel=120").replace("úhel=120", "angle=120"));
    expect(g.data).toMatchObject({ height: 30, angle: 120 });
    expect(feat("prvek adv.twist Výška=12").data).toMatchObject({ height: 12 });
    expect(err("prvek adv.twist nesmysl=1")).toMatch(/neznámý parametr „nesmysl“ – parametry: sketch, height, angle/);
    expect(err("prvek nesmysl a=1")).toMatch(/neznámý typ prvku „nesmysl“/);
    expect(err("prvek box size")).toMatch(/není ve tvaru klíč=hodnota/);
  });
});

describe("normálie, sestava, výkres", () => {
  it("normálie, vložit, výkres", () => {
    const p = parseAgentText(`normálie M8x30 v 10 0 0
vložit "Hřídel" v 0 0 10 otočení 0 90 0 ukotvit
výkres`);
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "library", query: "M8x30", at: [10, 0, 0] });
    expect(p.ops[1]).toMatchObject({ k: "insert", tab: "Hřídel", at: [0, 0, 10], rotation: [0, 90, 0], fixed: true });
    expect(p.ops[2]).toMatchObject({ k: "drawing" });
    expect(err("normálie")).toMatch(/označení/);
    expect(err("vložit")).toMatch(/název otevřené záložky/);
  });
});

describe("tabulka příkazů a hláška o neznámém příkazu", () => {
  it("každé slovo ze seznamu v hlášce je platný příkaz ve všech jazycích", () => {
    for (const lang of ["cs", "en", "de"] as const) {
      setLang(lang);
      const msg = err("nesmyslnýpříkaz 1 2");
      const list = msg.slice(msg.indexOf(": ") + 2).split(", ");
      expect(list.length).toBeGreaterThan(30);
      for (const w of list) {
        const m = err(`${w}`);
        expect(m, `${lang}: „${w}“ → ${m}`).not.toMatch(/neznámý příkaz|unknown command|unbekannter Befehl/);
      }
    }
  });
  it("tabulka má pro každý řádek anglický i německý název", () => {
    for (const c of AGENT_COMMANDS) {
      expect(c.en.length, c.cmd).toBeGreaterThan(0);
      expect(c.de.length, c.cmd).toBeGreaterThan(0);
    }
  });
});
