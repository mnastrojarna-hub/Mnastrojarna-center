import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, docStatusText, featureSummary, parseAgentText } from "./agent";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature } from "./types";

afterEach(() => setLang("cs"));

const opOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  expect(p.ops).toHaveLength(1);
  return p.ops[0];
};
const errOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.ops).toHaveLength(0);
  return p.errors[0]?.message ?? "";
};

describe("zaoblení se setbackem – text", () => {
  it("česky / anglicky / německy, pravidlo hran, výchozí setback = poloměr", () => {
    const a = opOf("zaoblit 3 hrany svislé setback 5");
    expect(a).toMatchObject({ k: "select", rule: ["svisle"], feature: { type: "fillet", kind: "setback", radius: 3, setback: 5 } });
    expect(opOf("fillet 2 edges +Z setback 4")).toMatchObject({ k: "select", rule: ["+z"], feature: { kind: "setback", radius: 2, setback: 4 } });
    expect(opOf("verrunden 2 kanten oben rückversatz 4")).toMatchObject({ k: "select", rule: ["oben"], feature: { kind: "setback", setback: 4 } });
    // bez pravidla = všechny hrany, setback bez hodnoty = poloměr
    const all = opOf("zaoblit 2 setback");
    expect(all).toMatchObject({ k: "feature", feature: { kind: "setback", radius: 2, edges: "all" } });
    expect((all as { feature: Feature }).feature).not.toHaveProperty("setback");
  });
  it("setback pro vrchol (číslo V nebo souřadnice), pravidla s čísly, název", () => {
    const op = opOf("zaoblit 3 hrany svislé delší 10 setback 5 vrchol V3 8 vrchol 0 0 20 6 název Roh");
    expect(op).toMatchObject({
      k: "select",
      rule: ["svisle", "len>10"],
      feature: { name: "Roh", kind: "setback", setbacks: [{ at: { kind: "vertex", index: 2 }, d: 8 }, { at: { kind: "xyz", p: [0, 0, 20] }, d: 6 }] },
    });
  });
  it("chyby: bez poloměru, záporný setback, vrchol bez hodnoty", () => {
    expect(errOf("zaoblit hrany svislé setback 5")).toMatch(/potřebuje poloměr/);
    expect(errOf("zaoblit 3 setback -2")).toMatch(/kladný/);
    expect(errOf("zaoblit 3 setback 5 vrchol V3")).toMatch(/vrchol V3 8/);
  });
});

describe("eliptické / kuželosečkové zaoblení – text", () => {
  it("D1 D2, rho, jazyky", () => {
    expect(opOf("zaoblit eliptické 4 2 hrany horní")).toMatchObject({ k: "select", rule: ["horni"], feature: { kind: "conic", radius: 4, r2: 2 } });
    expect(opOf("fillet elliptical 4 2 edges top rho 0.5")).toMatchObject({ feature: { kind: "conic", radius: 4, r2: 2, rho: 0.5 } });
    expect(opOf("verrunden elliptisch 3 kanten oben")).toMatchObject({ feature: { kind: "conic", radius: 3, r2: 3 } });
    expect(opOf("zaoblit kuželosečka 4 2 rho 0,4")).toMatchObject({ k: "feature", feature: { kind: "conic", rho: 0.4, edges: "all" } });
  });
  it("chyby: bez vzdáleností, rho mimo (0, 1)", () => {
    expect(errOf("zaoblit eliptické hrany horní")).toMatch(/D1 D2/);
    expect(errOf("zaoblit eliptické 4 2 rho 1,5")).toMatch(/mezi 0 a 1/);
  });
  it("běžné zaoblení se nezměnilo", () => {
    expect(opOf("zaoblit 2 hrany svislé")).toMatchObject({ k: "select", feature: { type: "fillet", radius: 2 } });
    expect((opOf("zaoblit 2 hrany svislé") as { feature: Feature & { kind?: string } }).feature.kind).toBeUndefined();
  });
});

describe("úkos s dělicí křivkou / stupňovitý – text", () => {
  it("plochy pravidlem, dělicí skica názvem, stupňovitý, směr tahu", () => {
    const op = opOf('úkos 3 plochy boční dělicí "Skica 2" stupňovitý');
    expect(op).toMatchObject({ k: "select", rule: ["bocni"], into: { path: "faces", kind: "faces" }, feature: { type: "draft", angle: 3, partingSketchId: "Skica 2", step: true, pull: { kind: "axis", axis: "Z" } } });
    expect(opOf('draft 2 faces side parting "Sketch 2" stepped direction -Z')).toMatchObject({ feature: { angle: 2, partingSketchId: "Sketch 2", step: true, pull: { kind: "vector", v: [0, 0, -1] } } });
    expect(opOf('schräge 2 flächen seite trennlinie "Skizze 2" gestuft')).toMatchObject({ feature: { partingSketchId: "Skizze 2", step: true } });
    // bez názvu skici = poslední skica
    expect(opOf("úkos 3 plochy boční dělicí")).toMatchObject({ feature: { partingSketchId: "$last" } });
  });
  it("plochy čísly F (bez pravidla), úkos bez dělicí křivky kolem roviny", () => {
    expect(opOf("úkos 2,5 plochy F3 F5 dělicí Skica")).toMatchObject({ k: "feature", feature: { faces: [2, 4], angle: 2.5, partingSketchId: "Skica" } });
    const plain = opOf("úkos 3 plochy boční rovina XY odsazení 10 směr +Z");
    expect(plain).toMatchObject({ feature: { plane: "XY", offset: 10, pull: { kind: "axis", axis: "Z" } } });
    expect((plain as { feature: Feature & { partingSketchId?: string } }).feature.partingSketchId).toBeUndefined();
  });
  it("chyby: bez úhlu, bez ploch, stupňovitý bez dělicí křivky", () => {
    expect(errOf("úkos plochy boční")).toMatch(/úhel/);
    expect(errOf("úkos 3")).toMatch(/plochy/);
    expect(errOf("úkos 3 plochy boční stupňovitý")).toMatch(/dělicí křivku/);
  });
  it("obecný příkaz „prvek“ s novými poli", () => {
    expect(opOf('prvek fillet kind=setback radius=3 setback=6 edges=svislé')).toMatchObject({ k: "select", feature: { kind: "setback", setback: 6 } });
    expect(opOf("prvek fillet kind=conic radius=4 r2=2 rho=0,5 edges=horní")).toMatchObject({ feature: { kind: "conic", r2: 2, rho: 0.5 } });
    expect(opOf('prvek fillet kind=setback radius=3 setbacks=[{"at":{"kind":"vertex","index":2},"d":8}]')).toMatchObject({ feature: { setbacks: [{ at: { kind: "vertex", index: 2 }, d: 8 }] } });
    expect(opOf('prvek draft angle=3 faces=boční partingSketchId="Skica 2" step=ano')).toMatchObject({ into: { path: "faces" }, feature: { partingSketchId: "Skica 2", step: true } });
  });
});

describe("stav a nápověda", () => {
  it("souhrn prvků v `stav`", () => {
    const sk: Feature = { id: "s2", name: "Dělicí", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [] };
    const sb: Feature = { id: "f1", name: "Zaoblení 1", type: "fillet", kind: "setback", radius: 3, setback: 6, edges: [1, 2, 3] };
    const co: Feature = { id: "f2", name: "Zaoblení 2", type: "fillet", kind: "conic", radius: 4, r2: 2, rho: 0.5, edges: [4] };
    const dr: Feature = { id: "d1", name: "Úkos 1", type: "draft", angle: 3, faces: [1, 2, 3, 4], plane: "XY", offset: 0, partingSketchId: "s2", step: true };
    const doc: CadDoc = { ...emptyDoc("t"), features: [sk, sb, co, dr] };
    expect(featureSummary(sb)).toBe("R3, setback 6, hrany 3");
    expect(featureSummary(co)).toBe("eliptické D1 4 × D2 2, kuželosečka rho 0,5, hrany 1");
    expect(featureSummary(dr, doc)).toBe("3°, ploch 4, dělicí křivka „Dělicí“, stupňovitý");
    const text = docStatusText(doc, null);
    expect(text).toMatch(/Úkos 1 \[draft, id d1\] .* dělicí křivka „Dělicí“, stupňovitý/);
    setLang("en");
    expect(featureSummary(sb)).toMatch(/setback 6/);
  });
  it("řádky nápovědy CS / EN / DE", () => {
    const rows = AGENT_COMMANDS.filter((c) => /setback S|eliptické D1|dělicí \\"Skica/.test(c.cmd) || /dělicí "Skica/.test(c.cmd));
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.en).join(" ")).toMatch(/parting/);
    expect(rows.map((r) => r.de).join(" ")).toMatch(/trennlinie/);
  });
});
