/**
 * Dokument → textový skript: regresní testy nálezů kontroly (vlna 17). Každý test staví malý vlastní dokument (žádná data
 * zákazníka) a hlídá jednu třídu chyby: odkazy na pomocnou geometrii uvnitř prvku, otisky výběru a zastaralá čísla hran,
 * výchozí název dílu, jazyk rozhraní, pořadí proměnných, „#“ a „//“ v textech, vazby s dalšími odkazy, smazané vygenerované
 * kóty, výrazy s mezerami, stejné názvy prvků, čitelnost. Bez jádra – skript se čte rozborem konzole a prvky / úpravy se
 * doplňují funkcemi aplikace (`resolveDatumNames`, `applyEdit`, `freeName`); geometrii tam a zpět hlídá
 * doc-script.roundtrip.test.ts a e2e/cad-doc2text.e2e.cjs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText, type AgentOp } from "./agent";
import { stripLineComment } from "./agent-comment";
import { applyEdit, freeName } from "./agent-edit";
import { resolveDatumNames } from "./agent-prim";
import { docToScript, scriptJson, scriptQuote } from "./doc-script";
import { freshScriptDoc, type ScriptKernel } from "./doc-script-fresh";
import { getLang, setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature, type Mate } from "./types";
import "./ext/index";
import "./feat/index";

type Rec = Record<string, unknown>;
const part = (name: string, features: unknown[], extra: Partial<CadDoc> = {}): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", kind: "part", features: features as Feature[], ...extra });
const body = (text: string) => text.split("\n").filter((l) => l && !l.startsWith("#"));
const box = (id: string, name: string, size = [60, 40, 20], extra: Rec = {}) => ({ id, name, type: "box", size, position: [0, 0, 0], centered: false, mode: "new", ...extra });
const hole = (id: string, name: string, x: number, extra: Rec = {}) => ({ id, name, type: "hole", position: [x, 10, 10], axis: "Z", flip: false, diameter: 5, depth: 0, cbDiameter: 0, cbDepth: 0, ...extra });

/**
 * Přečte skript rozborem konzole a provede řádky dílů bez jádra: prvek dostane NOVÉ id a volný název (jako `prepare`
 * v aplikaci), pomocná geometrie názvem → id (`resolveDatumNames`), úpravy (`upravit`, `potlačit`, `přejmenovat`,
 * `proměnná`, `konfigurace`) skutečným `applyEdit`. Vrací dokumenty v pořadí `nový díl` a chyby (✗) jednotlivých řádků.
 */
async function replay(text: string): Promise<{ docs: CadDoc[]; errors: string[]; ops: AgentOp[] }> {
  const p = parseAgentText(text);
  const errors = p.errors.map((e) => `${e.line}: ${e.message}`);
  const docs: CadDoc[] = [];
  let d: CadDoc | null = null;
  let seq = 0;
  const add = (f0: Feature) => {
    if (!d) d = docs[docs.push(emptyDoc("?")) - 1];
    const f = { ...f0, name: freeName(d.features, f0) } as Feature;
    const rec = f as unknown as Rec;
    const last = d.features[d.features.length - 1];
    const lastSketch = [...d.features].reverse().find((x) => x.type === "sketch");
    if (rec.sketchId === "$last") rec.sketchId = lastSketch?.id;
    if (rec.featureId === "$last") rec.featureId = last?.id;
    for (const k of ["sketchId", "pathId", "featureId"]) {
      const v = rec[k];
      if (typeof v === "string" && !d.features.some((x) => x.id === v)) rec[k] = [...d.features].reverse().find((x) => x.name.toLowerCase() === v.toLowerCase())?.id ?? v;
    }
    resolveDatumNames(f, d.features, true);
    if (d.features.some((x) => x.id === f.id)) f.id = `dup${++seq}`;
    d.features = [...d.features, f];
  };
  for (const op of p.ops as AgentOp[]) {
    try {
      if (op.k === "new") d = docs[docs.push(op.assembly ? { ...emptyDoc(op.name), kind: "assembly" } : emptyDoc(op.name)) - 1];
      else if (op.k === "doc") d = docs[docs.push(JSON.parse(JSON.stringify(op.doc)) as CadDoc) - 1];
      else if (op.k === "meta" && d) Object.assign(d, op.patch);
      else if (op.k === "feature" || op.k === "select" || op.k === "sketchOn") add({ ...op.feature, id: op.k === "feature" && /^[{[]/.test(text.split("\n")[op.line - 1].trim()) ? op.feature.id : `new${++seq}` } as Feature);
      else if (op.k === "features") op.features.forEach((f) => add(f));
      else if (op.k === "edit" && d && op.cmd.kind !== "undo" && op.cmd.kind !== "redo") {
        const r = await applyEdit(d, op.cmd, {}, op.sketch);
        Object.assign(d, r.doc);
      }
    } catch (e) {
      errors.push(`${op.line}: ${(e as Error).message}`);
    }
  }
  return { docs, errors, ops: p.ops as AgentOp[] };
}

describe("1 · odkazy na pomocnou geometrii uvnitř prvku (planeDef, axisDef, extent, positionRef)", () => {
  const sketch = (id: string, name: string, plane: string) => ({ id, name, type: "sketch", plane: { kind: "base", name: plane, offset: 0 }, entities: [{ id: "e1", type: "circle", cx: 10, cy: 10, r: 4 }] });
  const d = part("Pomocná geometrie", [
    box("b1", "Kvádr 1"),
    { id: "dp9", name: "Rovina A", type: "datum", origin: [30, 20, 30], normal: [0, 0, 1], xDir: [1, 0, 0], size: 80 },
    { id: "da9", name: "Osa 1", type: "datumAxis", def: { kind: "global", axis: "Z" }, length: 100 },
    { id: "dq9", name: "Bod A", type: "datumPoint", ref: { kind: "xyz", p: [30, 20, 40] } },
    { id: "c1", name: "Válec 1", type: "cylinder", radius: 5, height: 8, position: [50, 20, 20], axis: "Z", mode: "add" },
    { id: "m1", name: "Zrcadlení 1", type: "mirror", plane: "YZ", offset: 0, keepOriginal: true, planeDef: { kind: "datum", featureId: "dp9" } },
    sketch("s1", "Skica 1", "XZ"),
    { id: "r1", name: "Rotace 1", type: "revolve", sketchId: "s1", angle: 90, axis: "y", mode: "add", axisDef: { kind: "datumAxis", featureId: "da9" } },
    sketch("s2", "Skica 2", "XY"),
    { id: "x1", name: "Vysunutí 1", type: "extrude", sketchId: "s2", distance: 10, symmetric: false, reverse: false, mode: "add", extent: { kind: "toFace", ref: { kind: "datum", featureId: "dp9" } } },
    { id: "c2", name: "Válec 2", type: "cylinder", radius: 2, height: 12, position: [10, 30, 20], axis: "Z", mode: "add" },
    { id: "p1", name: "Pole 1", type: "pattern", featureId: "c2", kind: "circular", count: 3, angle: 360, axis: "Z", center: [30, 20, 0], axisDef: { kind: "datumAxis", featureId: "da9" } },
    { id: "k1", name: "Koule 1", type: "sphere", radius: 4, position: [0, 0, 0], positionRef: { kind: "datumPoint", featureId: "dq9" }, mode: "add" },
  ]);
  const r = docToScript(d);
  it("vlastní příkazy s názvem pomocné roviny / osy / bodu, žádné původní id ve skriptu", () => {
    const l = body(r.text);
    expect(l).toContain('zrcadlit rovina "Rovina A"');
    expect(l).toContain('rotovat 90 osa "Osa 1"');
    expect(l).toContain('vysunout k rovině "Rovina A"');
    expect(l).toContain('pole kruhové 3 osa "Osa 1" v 30 20 0');
    expect(l).toContain('koule 8 na bod "Bod A"');
    for (const id of ["dp9", "da9", "dq9"]) expect(r.text, id).not.toContain(id);
    expect(r.notes).toEqual([]);
    expect(r.stats.json).toBe(0);
  });
  it("prvek, na který se odkazuje názvem, má název výslovně i když je automatický (závisí na jazyce rozhraní)", () => {
    expect(body(r.text).find((x) => x.startsWith("prvek datumAxis"))).toContain('name="Osa 1"');
    // prvek bez odkazu má automatický název vynechaný
    expect(body(r.text)).toContain("kvádr 60 40 20");
  });
  it("po přečtení (nová id prvků) míří odkazy na nové prvky", async () => {
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    const f = docs[0].features;
    expect(f.map((x) => x.type)).toEqual(d.features.map((x) => x.type));
    expect(f.map((x) => x.name)).toEqual(d.features.map((x) => x.name));
    const id = (name: string) => f.find((x) => x.name === name)!.id;
    expect(id("Rovina A")).not.toBe("dp9");
    expect((f[5] as unknown as { planeDef: Rec }).planeDef).toEqual({ kind: "datum", featureId: id("Rovina A") });
    expect((f[7] as unknown as { axisDef: Rec }).axisDef).toEqual({ kind: "datumAxis", featureId: id("Osa 1") });
    expect((f[9] as unknown as { extent: Rec }).extent).toEqual({ kind: "toFace", ref: { kind: "datum", featureId: id("Rovina A") } });
    expect((f[11] as unknown as { axisDef: Rec }).axisDef).toEqual({ kind: "datumAxis", featureId: id("Osa 1") });
    expect((f[12] as unknown as { positionRef: Rec }).positionRef).toEqual({ kind: "datumPoint", featureId: id("Bod A") });
  });
  it("dvě pomocné roviny stejného názvu: odkazovaná si nechá id (JSON) a odkaz na ni platí", async () => {
    const dup = part("Stejné roviny", [
      box("b1", "Kvádr 1"),
      { id: "pa", name: "Rovina", type: "datum", origin: [0, 0, 5], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 },
      { id: "pb", name: "Rovina", type: "datum", origin: [0, 0, 9], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 },
      { id: "m1", name: "Zrcadlení 1", type: "mirror", plane: "YZ", offset: 0, keepOriginal: true, planeDef: { kind: "datum", featureId: "pa" } },
    ]);
    const x = docToScript(dup);
    const l = body(x.text);
    expect(l[2].startsWith('{"id":"pa"')).toBe(true);
    expect(l[l.length - 1]).toContain('"featureId":"pa"');
    const { docs, errors } = await replay(x.text);
    expect(errors).toEqual([]);
    expect((docs[0].features[3] as unknown as { planeDef: Rec }).planeDef.featureId).toBe(docs[0].features[1].id);
    expect(docs[0].features.map((f) => f.name)).toEqual(["Kvádr 1", "Rovina", "Rovina", "Zrcadlení 1"]);
  });
  it("poloha odkazem na bod skici: skica si nechá id (JSON), jinak by odkaz po přečtení mířil do prázdna", async () => {
    const sp = part("Bod skici", [
      box("b1", "Kvádr 1", [40, 30, 10]),
      { id: "sk1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 10 }, entities: [{ id: "e1", type: "circle", cx: 25, cy: 15, r: 3 }] },
      { id: "c1", name: "Válec 1", type: "cylinder", radius: 2, height: 12, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "sketchPt", sketchId: "sk1", entityId: "e1", k: "center" } },
    ]);
    const x = docToScript(sp);
    expect(body(x.text)[2].startsWith('{"id":"sk1"')).toBe(true);
    const { docs, errors } = await replay(x.text);
    expect(errors).toEqual([]);
    expect(docs[0].features[1].id).toBe("sk1");
    expect((docs[0].features[2] as unknown as { positionRef: Rec }).positionRef.sketchId).toBe("sk1");
  });
  it("dráha tažení jako poslední skica se píše názvem – `$last` aplikace u pathId nedoplní", () => {
    const sw = part("Tažení", [
      { id: "pr", name: "Průřez", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "circle", cx: 0, cy: 0, r: 3 }] },
      { id: "pa", name: "Skica 2", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "e1", type: "polyline", points: [[0, 0], [0, 30], [20, 50]], closed: false }] },
      { id: "sw", name: "Tažení 1", type: "sweep", profileId: "pr", pathId: "pa", mode: "new", frenet: false },
    ]);
    const l = body(docToScript(sw).text);
    expect(l[l.length - 1]).toBe('prvek sweep profileId=Průřez pathId="Skica 2" mode=nové frenet=ne');
    expect(l).toContain('skica XZ název "Skica 2"');
  });
});

describe("2 · otisky výběru a zastaralá čísla hran / ploch", () => {
  const sig = (c: number[], n = 12) => ({ t: "LINE", c, s: 20, n });
  const d = part("Otisky hran", [
    box("b1", "Kvádr 1"),
    { id: "b2", name: "Kvádr 2", type: "box", size: [20, 20, 30], position: [-5, -5, -5], centered: false, mode: "cut" },
    { id: "f1", name: "Zaoblení 1", type: "fillet", radius: 4, edges: [0, 2, 4, 6], edgeSigs: { "0": sig([0, 0, 10]), "2": sig([0, 40, 10]), "4": sig([60, 0, 10]), "6": sig([60, 40, 10]) } },
    { id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "custom", origin: [30, 20, 20], normal: [0, 0, 1], xDir: [1, 0, 0] }, planeDef: { kind: "face", ref: { kind: "face", index: 5, sig: { t: "PLANE", c: [30, 20, 20], s: 2400 } } }, entities: [{ id: "e1", type: "circle", cx: 0, cy: 0, r: 5 }] },
  ]);
  it("výchozí zápis otisky zachová (čísla bez jádra ověřit nejde) a řekne to", () => {
    const r = docToScript(d);
    const l = body(r.text);
    expect(l[3].startsWith("prvek fillet radius=4 edges=0;2;4;6 edgeSigs=")).toBe(true);
    expect(l[4].startsWith('{"id":"s1"')).toBe(true);
    expect(l[4]).toContain('"sig":{"t":"PLANE"');
    expect(r.notes.join(" ")).toContain("otisky výběru hran / ploch (2)");
    const f = parseAgentText(l[3]).ops[0] as { feature: { edgeSigs: Rec } };
    expect(Object.keys(f.feature.edgeSigs)).toEqual(["0", "2", "4", "6"]);
  });
  it('sigs: "drop" píše uložená čísla vlastními příkazy a upozorní, že mohou být zastaralá', () => {
    const r = docToScript(d, { sigs: "drop" });
    expect(body(r.text)).toContain("zaoblit 4 hrany E1 E3 E5 E7");
    expect(body(r.text)).toContain("skica plocha F6");
    expect(r.notes.join(" ")).toContain("mohou být zastaralá");
  });
  it("freshScriptDoc: jádro najde entity podle otisků → aktuální čísla bez otisků, vlastní příkazy", async () => {
    // zkušební jádro: hrany se po odebrání rohu přečíslovaly o +2 (jedna se nenašla až v druhém běhu), plocha F6 → F9
    const calls: string[] = [];
    const kernel: ScriptKernel = {
      pickSigs: async (before, f) => {
        calls.push(`${f.type}:${before.features.length}`);
        const g = JSON.parse(JSON.stringify(f)) as Rec;
        if (f.type === "fillet") return { feature: { ...g, edges: (g.edges as number[]).map((i) => i + 2) } as unknown as Feature, changed: true, warnings: [] };
        return { feature: { ...g, faces: [8] } as unknown as Feature, changed: true, warnings: [] };
      },
    };
    const fresh = await freshScriptDoc(d, kernel);
    expect(calls).toEqual(["fillet:2", "shell:3"]);
    expect(fresh.stats).toMatchObject({ checked: 2, renumbered: 2, lost: 0 });
    expect(JSON.stringify(fresh.doc)).not.toContain("edgeSigs");
    expect(JSON.stringify(d)).toContain("edgeSigs"); // původní dokument se nemění
    const r = docToScript(fresh.doc);
    expect(body(r.text)).toContain("zaoblit 4 hrany E3 E5 E7 E9");
    expect(body(r.text)).toContain("skica plocha F9");
    expect(r.notes.join(" ")).not.toContain("otisky");
    expect(r.stats.generic + r.stats.json).toBe(0);
  });
  it("freshScriptDoc: entita, kterou jádro nenašlo, zůstane i s otisky (poznámka)", async () => {
    const kernel: ScriptKernel = { pickSigs: async (_b, f) => ({ feature: f, changed: false, warnings: f.type === "fillet" ? ["hrana E7 se nenašla"] : [] }) };
    const fresh = await freshScriptDoc(d, kernel);
    expect(fresh.stats).toMatchObject({ checked: 2, lost: 1 });
    expect(fresh.notes.join(" ")).toContain("Zaoblení 1");
    const l = body(docToScript(fresh.doc).text);
    expect(l[3].startsWith("prvek fillet radius=4 edges=0;2;4;6 edgeSigs=")).toBe(true);
    expect(l).toContain("skica plocha F6");
  });
  it("freshScriptDoc: stejný díl ve více komponentách sestavy se ověří jednou", async () => {
    let n = 0;
    const kernel: ScriptKernel = { pickSigs: async (_b, f) => (n++, { feature: f, changed: false, warnings: [] }) };
    const comp = (id: string) => ({ id, name: id, source: { kind: "part" as const, doc: d }, placement: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] } });
    const asm: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "S", material: "ocel", kind: "assembly", features: [], components: [comp("a"), comp("b"), comp("c")] };
    const fresh = await freshScriptDoc(asm, kernel);
    expect(n).toBe(2);
    expect(docToScript(fresh.doc).stats).toMatchObject({ parts: 1, components: 3, generic: 0, json: 0 });
  });
});

describe("3 · výchozí název dílu a sestavy", () => {
  it("„Nový díl“ / „Nová sestava“ se zapíše ještě příkazem název – aplikace by ho jinak přečíslovala a vložit by minulo", () => {
    for (const [pn, an] of [["Nový díl", "Nová sestava"], ["New part", "New assembly"], ["Neues Teil", "Neue Baugruppe"]]) {
      const p = part(pn, [box("b", "Kvádr 1", [40, 30, 20])]);
      const asm: CadDoc = { app: "mnastrojarna-cad", version: 2, name: an, material: "ocel", kind: "assembly", features: [], components: [{ id: "k1", name: pn, source: { kind: "part", doc: p }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, fixed: true }] };
      const l = body(docToScript(asm).text);
      expect(l.slice(0, 2)).toEqual([`nový díl "${pn}"`, `název "${pn}"`]);
      expect(l).toContain(`nová sestava "${an}"`);
      expect(l[l.indexOf(`nová sestava "${an}"`) + 1]).toBe(`název "${an}"`);
      expect(l).toContain(`vložit "${pn}" ukotvit`);
      const ops = parseAgentText(l.join("\n")).ops as AgentOp[];
      expect(ops.slice(0, 2).map((o) => o.k)).toEqual(["new", "meta"]);
      expect((ops[1] as { patch: { name: string } }).patch.name).toBe(pn);
    }
    expect(body(docToScript(part("Deska", [box("b", "Kvádr 1")])).text)).not.toContain('název "Deska"');
  });
});

describe("4 · jazyk rozhraní: názvy a odkazy", () => {
  const ui = getLang();
  afterEach(() => setLang(ui));
  const d = part("Parametry", [
    box("b", "Kvádr 1", [100, 50, 12]),
    hole("h1", "Díra 1", 20),
    hole("h2", "Díra 2", 60, { suppressed: true }),
    { id: "f", name: "Zaoblení 1", type: "fillet", radius: 3, edges: "all" },
  ], { variables: [{ name: "t", expr: "12" }], bindings: { "b:size.2": "t" }, configs: [{ id: "c1", name: "Tenká", values: { t: 6 }, suppressed: ["f"] }], activeConfig: "c1" });
  it("potlačení a vazba parametru míří na poslední prvek, konfigurace na prvek s výslovným názvem", () => {
    const l = body(docToScript(d).text);
    expect(l).toEqual([
      'nový díl "Parametry"',
      "proměnná t = 12",
      "kvádr 100 50 12",
      "upravit poslední size.2==t",
      "díra 5 skrz v 20 10 10",
      "díra 5 skrz v 60 10 10",
      "potlačit poslední",
      'zaoblit 3 název "Zaoblení 1"',
      'konfigurace "Tenká" t=6 potlačit "Zaoblení 1"',
      'konfigurace aktivní "Tenká"',
    ]);
  });
  it("český skript přečtený v anglickém rozhraní: vazba, potlačení i konfigurace sedí (liší se jen automatické názvy)", async () => {
    const text = docToScript(d).text;
    setLang("en");
    const { docs, errors } = await replay(text);
    expect(errors).toEqual([]);
    const x = docs[0];
    expect(x.features.map((f) => f.name)).toEqual(["Box 1", "Hole 1", "Hole 2", "Zaoblení 1"]);
    expect(x.features.map((f) => !!f.suppressed)).toEqual([false, false, true, false]);
    expect(x.bindings).toEqual({ [`${x.features[0].id}:size.2`]: "t" });
    expect(x.configs?.[0].suppressed).toEqual([x.features[3].id]);
    expect(x.activeConfig).toBe(x.configs?.[0].id);
  });
  it("skript pro jiný jazyk (lang: en / de) nese názvy výslovně – po přečtení jsou názvy stejné", async () => {
    for (const lang of ["en", "de"] as const) {
      setLang("cs");
      const r = docToScript(d, { lang });
      expect(body(r.text)[2], lang).toBe(lang === "en" ? 'box 100 50 12 name "Kvádr 1"' : 'quader 100 50 12 name "Kvádr 1"');
      expect(body(r.text)[6], lang).toBe(lang === "en" ? "suppress last" : "unterdrücken letzte");
      setLang(lang);
      const { docs, errors } = await replay(r.text);
      expect(errors, lang).toEqual([]);
      expect(docs[0].features.map((f) => f.name), lang).toEqual(d.features.map((f) => f.name));
      expect(docs[0].features.map((f) => !!f.suppressed), lang).toEqual([false, false, true, false]);
    }
  });
  it("dokument s anglickými automatickými názvy zapsaný anglicky názvy vynechá", () => {
    const en = part("Plate", [box("b", "Box 1"), hole("h", "Hole 1", 20)]);
    expect(body(docToScript(en, { lang: "en" }).text)).toEqual(['new part "Plate"', "box 60 40 20", "hole 5 through at 20 10 10"]);
    expect(body(docToScript(en).text)).toContain('kvádr 60 40 20 název "Box 1"');
  });
  it("jazyk rozhraní se převodem nezmění", () => {
    setLang("de");
    docToScript(d, { lang: "en" });
    expect(getLang()).toBe("de");
  });
});

describe("5 · pořadí proměnných", () => {
  it("proměnná odkazující na pozdější dostane nejdřív hodnotu číslem a výraz až po ní – pořadí i výrazy zůstanou", async () => {
    const d = part("Pořadí proměnných", [box("b1", "Kvádr 1", [20, 30, 10])], { variables: [{ name: "a", expr: "b*4" }, { name: "b", expr: "5", note: "základ" }, { name: "c", expr: "a + b" }], bindings: { "b1:size.0": "a", "b1:size.1": "b+25" } });
    const r = docToScript(d);
    expect(body(r.text).slice(1, 5)).toEqual(["proměnná a = 20", 'proměnná b = 5 poznámka "základ"', "proměnná c = a + b", "proměnná a = b*4"]);
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    expect(docs[0].variables).toEqual(d.variables);
    const id = docs[0].features[0].id;
    expect(docs[0].bindings).toEqual({ [`${id}:size.0`]: "a", [`${id}:size.1`]: "b+25" });
    expect((docs[0].features[0] as unknown as { size: number[] }).size).toEqual([20, 30, 10]);
    expect(r.notes).toEqual([]);
  });
  it("proměnná, kterou vyhodnotit nejde (kruh), se nezapíše a skript to řekne", () => {
    const d = part("Kruh", [box("b1", "Kvádr 1")], { variables: [{ name: "a", expr: "b" }, { name: "b", expr: "a" }] });
    const r = docToScript(d);
    expect(body(r.text).some((l) => l.startsWith("proměnná"))).toBe(false);
    expect(r.notes.join(" ")).toContain("proměnnou „a“");
  });
});

describe("6 · „#“ a „//“ v názvech a textech", () => {
  it("komentář se hledá jen mimo uvozovky; „#2“ a barva komentář nejsou", () => {
    expect(stripLineComment('nový díl "Držák # levý"  # komentář')).toBe('nový díl "Držák # levý"');
    expect(stripLineComment("název „Deska // horní“ // pozn.")).toBe("název „Deska // horní“");
    expect(stripLineComment("sestava vazba kontakt #2 spodní #1 horní # pozn.")).toBe("sestava vazba kontakt #2 spodní #1 horní");
    expect(stripLineComment("barva #e03930 # červená")).toBe("barva #e03930");
    expect(stripLineComment('{"s":"4x M6 // viz \\" detail # A"} // konec')).toBe('{"s":"4x M6 // viz \\" detail # A"}');
    // uvozovka bez páru není začátek textu – řádek se čte jako dřív
    expect(stripLineComment('kvádr 10 10 10 název "Bez konce # komentář')).toBe('kvádr 10 10 10 název "Bez konce');
    expect((parseAgentText('nový díl "Držák # levý"').ops[0] as { name: string }).name).toBe("Držák # levý");
  });
  it("scriptQuote zapíše text s „#“ i „//“ do uvozovek; scriptJson je bezpečný i pro parser, který komentář hledal všude", () => {
    expect(scriptQuote("Deska #2 levá")).toBe('"Deska #2 levá"');
    expect(scriptQuote("Držák # levý")).toBe('"Držák # levý"');
    expect(scriptQuote("4x M6 // viz detail A")).toBe('"4x M6 // viz detail A"');
    expect(scriptQuote("řádek\ndruhý")).toBeNull();
    const v = { a: "x # y", b: ["4x M6 // viz", "#2"], c: "tab\t# z" };
    const s = scriptJson(v);
    expect(JSON.parse(s)).toEqual(v);
    expect(/\s(#|\/\/)/.test(s)).toBe(false);
  });
  it("díl s „#“ v názvu uvnitř sestavy: vložit jeho názvem (nikdy vložit null), vazby i pořadí komponent sedí", () => {
    const plate = part("Deska # levá", [box("b", "Kvádr 1", [40, 30, 20])]);
    const pin = part("Čep // dlouhý", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 5, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" }]);
    const asm: CadDoc = {
      app: "mnastrojarna-cad", version: 2, name: "Sestava # 1", material: "ocel", kind: "assembly", features: [],
      components: [
        { id: "k1", name: "Deska # levá", source: { kind: "part", doc: plate }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, fixed: true },
        { id: "k2", name: "Čep // dlouhý", source: { kind: "part", doc: pin }, placement: { position: [20, 15, 20], rotation: [0, 0, 0] } },
      ],
      mates: [{ id: "m1", type: "mate", a: { compId: "k2", face: 2 }, b: { compId: "k1", face: 5 } }],
    };
    const r = docToScript(asm);
    expect(r.text).not.toContain("null");
    expect(r.notes).toEqual([]);
    const ops = parseAgentText(r.text).ops as AgentOp[];
    expect(parseAgentText(r.text).errors).toEqual([]);
    expect(ops.filter((o) => o.k === "new").map((o) => (o as { name: string }).name)).toEqual(["Deska # levá", "Čep // dlouhý", "Sestava # 1"]);
    expect(ops.filter((o) => o.k === "insert").map((o) => (o as { tab: string }).tab)).toEqual(["Deska # levá", "Čep // dlouhý"]);
    expect(body(r.text)).toContain("sestava vazba kontakt #2 F3 #1 F6");
  });
  it("název, který na řádek nejde (konec řádku): samostatný díl jako JSON, který se přečte celý; v sestavě náhradní název s poznámkou", () => {
    const p = part("Držák\nlevý # 2", [box("b", "Kvádr 1", [20, 30, 10])]);
    const r = docToScript(p);
    const prog = parseAgentText(body(r.text).join("\n"));
    expect(prog.errors).toEqual([]);
    expect((prog.ops[0] as { doc: CadDoc }).doc.name).toBe("Držák\nlevý # 2");
    expect(r.notes.join(" ")).toContain("zapsán jako JSON");
    const asm: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "S", material: "ocel", kind: "assembly", features: [], components: [{ id: "k1", name: "Držák", source: { kind: "part", doc: p }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
    const x = docToScript(asm);
    expect(body(x.text)).toContain('nový díl "Držák levý # 2"');
    expect(body(x.text)).toContain('vložit "Držák levý # 2"');
    expect(x.notes.join(" ")).toContain("nejde zapsat na řádek skriptu");
    expect(parseAgentText(x.text).errors).toEqual([]);
  });
  it("2D výkres s textem „// …“ a poznámka proměnné s „#“ se přenesou celé", async () => {
    const draft = { app: "mnastrojarna-cad", version: 2, name: "Náčrt # 1", material: "ocel", kind: "draft", features: [], draft: { v: 1, id: "x", seq: 2, vars: {}, layers: [], linetypes: [], textStyles: [], entities: [{ id: "e1", type: "text", layer: "0", p: [10, 10], h: 5, s: "4x M6 // viz detail A # 2" }] } } as unknown as CadDoc;
    const r = docToScript(draft);
    const prog = parseAgentText(body(r.text).join("\n"));
    expect(prog.errors).toEqual([]);
    expect((prog.ops[0] as { doc: CadDoc }).doc).toEqual(draft);
    expect(r.notes.join(" ")).not.toContain("nepřečetl");
    const d = part("Poznámky", [box("b", "Kvádr 1")], { variables: [{ name: "L", expr: "b * 8 + 2", note: "délka # podle b // viz" }, { name: "b", expr: "5", note: "šířka #1" }] });
    const x = docToScript(d);
    const { docs, errors } = await replay(x.text);
    expect(errors).toEqual([]);
    expect(docs[0].variables).toEqual(d.variables);
    expect(x.notes).toEqual([]);
  });
});

describe("7 · vazby sestavy s dalšími odkazy (závěs, symetricky, šířka, drážka) a motor na nich", () => {
  const p1 = part("Deska", [box("b", "Kvádr 1", [100, 80, 20])]);
  const p2 = part("Kolo", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 20, height: 10, position: [0, 0, 0], axis: "Z", mode: "new" }]);
  const comp = (id: string, doc: CadDoc, x = 0, fixed = false) => ({ id, name: doc.name, source: { kind: "part" as const, doc }, placement: { position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, ...(fixed ? { fixed } : {}) });
  const mates: Mate[] = [
    { id: "m1", type: "hinge", a: { compId: "k2", face: 0 }, b: { compId: "k1", face: 6 }, c: { compId: "k2", face: 2 }, d: { compId: "k1", face: 2 }, name: "Otoč" },
    { id: "m2", type: "symmetric", a: { compId: "k3", face: 3 }, b: { compId: "k4", face: 2 }, c: { compId: "k1", face: 0 }, flip: true },
    { id: "m3", type: "width", a: { compId: "k3", face: 2 }, b: { compId: "k1", face: 1 }, c: { compId: "k3", face: 3 }, d: { compId: "k1", face: 3 } },
    { id: "m4", type: "slot", a: { compId: "k2", face: 0 }, b: { compId: "k1", face: 9 }, c: { compId: "k1", face: 10 }, value: 12.5 },
    { id: "m5", type: "width", a: { compId: "k2", face: 0 }, b: { compId: "k1", face: 1 }, d: { compId: "k1", face: 3 } },
  ];
  const asm: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "Závěs", material: "ocel", kind: "assembly", features: [], components: [comp("k1", p1, 0, true), comp("k2", p2, 20), comp("k3", p1, 200), comp("k4", p1, 400)], mates, motion: { motors: [{ id: "mo", kind: "rotary", mate: "m1", from: 0, to: 180, speed: 10 }], duration: 2, steps: 6 } };
  const r = docToScript(asm);
  it("každá vazba je ve skriptu i s druhými plochami a rovinou souměrnosti; motor na závěsu také", () => {
    const l = body(r.text);
    expect(l).toContain('sestava vazba závěs #2 F1 F3 #1 F7 F3 název "Otoč"');
    expect(l).toContain("sestava vazba symetricky #3 F4 #4 F3 rovina #1 F1 obráceně");
    expect(l).toContain("sestava vazba šířka #3 F3 F4 #1 F2 F4");
    expect(l).toContain("sestava vazba drážka #2 F1 #1 F10 F11 hodnota 12.5");
    expect(l).toContain("sestava vazba šířka #2 F1 #1 F2 F4");
    // vlna 22, bod 9: uložený motor s rychlostí bez `ranged` jede od začátku bez konce (konec 180 se nikdy nepoužil) – skript to říká
    // výslovně „od 0 ot/min 10“; zápis „0..180 ot/min 10“ dnes znamená rozsah × rychlost (dojet na 180° a stát)
    expect(l).toContain("pohyb motor rotační vazba 1 od 0 ot/min 10 kroky 6 čas 2");
    expect(r.stats).toMatchObject({ mates: 5, matesText: 5 });
    expect(r.notes).toEqual([]);
  });
  it("řádky přečtené konzolí dávají stejné plochy (česky, anglicky, německy)", () => {
    for (const lang of ["cs", "en", "de"] as const) {
      const prog = parseAgentText(docToScript(asm, { lang }).text);
      expect(prog.errors, lang).toEqual([]);
      const cmds = (prog.ops as AgentOp[]).filter((o) => o.k === "asm").map((o) => (o as { cmd: Rec }).cmd).filter((c) => c.k === "mate");
      const idx = (s: unknown) => (s as { index?: number } | undefined)?.index ?? null;
      expect(cmds.map((c) => [c.kind, c.a, idx(c.faceA), idx(c.faceA2), c.b, idx(c.faceB), idx(c.faceB2), c.c ?? null, idx(c.faceC)]), lang).toEqual([
        ["hinge", "#2", 0, 2, "#1", 6, 2, null, null],
        ["symmetric", "#3", 3, null, "#4", 2, null, "#1", 0],
        ["width", "#3", 2, 3, "#1", 1, 3, null, null],
        ["slot", "#2", 0, null, "#1", 9, 10, null, null],
        ["width", "#2", 0, null, "#1", 1, 3, null, null],
      ]);
    }
  });
});

describe("8 · smazané vygenerované kóty (smartOff)", () => {
  const sheet = { id: "d1", name: "List 1", options: { sheet: "A3", orientation: "landscape", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "smart", smartGen: "g", smartOff: ["pos:top:1:s-20.000", "ov:z"] }, meta: {}, annotations: [{ id: "a", view: "top", auto: "ov:x", type: "dim", kind: "horizontal", a: [0, 0], b: [20, 0], offset: 8 }] };
  const d = part("Kóty", [box("b", "Kvádr 1", [120, 80, 20])], { drawings: [sheet] as unknown as CadDoc["drawings"] });
  it("bez jádra skript řekne, že se smazané kóty vrátí", () => {
    const r = docToScript(d);
    expect(body(r.text).some((l) => l.startsWith("výkres smazat"))).toBe(false);
    expect(r.notes.join(" ")).toContain("smazané vygenerované kóty výkresů (2 na 1 listech)");
  });
  it("s id od jádra je smaže příkazem výkres smazat hned po kótovat chytře", async () => {
    const kernel: ScriptKernel = {
      pickSigs: async () => null,
      drawing: async (_doc, _meta, o) => {
        expect(o.dimensions).toBe("smart");
        return { smart: { annotations: [{ auto: "sym:top:0" }, { auto: "ov:x" }, { auto: "pos:top:1:s-20.000" }, { auto: "hole:b" }, { auto: "ov:y" }, { auto: "ov:z" }] } };
      },
    };
    const fresh = await freshScriptDoc(d, kernel);
    expect(fresh.deletedDims).toEqual({ d1: ["a3", "a6"] });
    const r = docToScript(fresh.doc, { deletedDims: fresh.deletedDims });
    const l = body(r.text);
    expect(l.slice(l.indexOf("kótovat chytře"))).toEqual(["kótovat chytře", "výkres smazat a3 a6"]);
    expect(r.notes.join(" ")).not.toContain("smazané vygenerované");
    const cmd = (parseAgentText("výkres smazat a3 a6").ops[0] as { cmd: Rec }).cmd;
    expect(cmd).toMatchObject({ k: "del", targets: ["a3", "a6"] });
  });
});

describe("9 · vazba parametru na výraz s mezerami", () => {
  it("výraz s mezerami jde do uvozovek (klíč=\"=výraz\") a po přečtení je stejný", async () => {
    const d = part("Výraz", [box("b1", "Kvádr 1", [40, 30, 10])], { variables: [{ name: "b", expr: "5" }], bindings: { "b1:size.1": "b + 25", "b1:size.0": "max(b, 3) * 8" } });
    const r = docToScript(d);
    expect(body(r.text)).toContain('upravit poslední size.1="=b + 25"');
    expect(body(r.text)).toContain('upravit poslední size.0="=max(b, 3) * 8"');
    expect(r.notes).toEqual([]);
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    const id = docs[0].features[0].id;
    expect(docs[0].bindings).toEqual({ [`${id}:size.1`]: "b + 25", [`${id}:size.0`]: "max(b, 3) * 8" });
  });
});

describe("10 · stejné názvy prvků a potlačení", () => {
  it("prvek se stejným názvem se po vzniku přejmenuje, potlačení míří na poslední prvek – potlačený je jen ten správný", async () => {
    const d = part("Stejné názvy", [box("b", "Kvádr 1", [60, 40, 10]), hole("h1", "Díra 1", 10), hole("h2", "Díra 1", 30, { suppressed: true }), hole("h3", "Díra 1", 50)]);
    const r = docToScript(d);
    expect(body(r.text).slice(2)).toEqual(["díra 5 skrz v 10 10 10", "díra 5 skrz v 30 10 10", 'přejmenovat poslední na "Díra 1"', "potlačit poslední", "díra 5 skrz v 50 10 10", 'přejmenovat poslední na "Díra 1"']);
    expect(r.notes).toEqual([]);
    expect(r.stats.dedicated).toBe(4);
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    expect(docs[0].features.map((f) => [f.name, !!f.suppressed])).toEqual([["Kvádr 1", false], ["Díra 1", false], ["Díra 1", true], ["Díra 1", false]]);
  });
});

describe("11 · čitelnost: skica založená klikem na plochu, úkos, poloha odkazem, potlačený prvek", () => {
  it("skica s popsanou obecnou rovinou vlastním příkazem, popis roviny řádkem upravit", async () => {
    const d = part("Klikaný díl", [
      box("b", "Kvádr 1"),
      { id: "p9x8c7", name: "Skica 1", type: "sketch", plane: { kind: "custom", origin: [30, 20, 20], normal: [0, 0, 1], xDir: [1, 0, 0], label: "Plocha 6" }, entities: [{ id: "k9", type: "circle", cx: 0, cy: 0, r: 8 }] },
      { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: "p9x8c7", distance: 12, symmetric: false, reverse: false, mode: "add" },
    ]);
    const r = docToScript(d);
    expect(body(r.text).slice(2)).toEqual(["skica počátek 30 20 20 normála 0 0 1 osax 1 0 0", "  kružnice 16", 'upravit poslední plane.label="Plocha 6"', "vysunout 12"]);
    expect(r.stats).toMatchObject({ dedicated: 3, generic: 0, json: 0 });
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    expect((docs[0].features[1] as unknown as { plane: Rec }).plane).toEqual({ kind: "custom", origin: [30, 20, 20], normal: [0, 0, 1], xDir: [1, 0, 0], label: "Plocha 6" });
    expect((docs[0].features[2] as unknown as { sketchId: string }).sketchId).toBe(docs[0].features[1].id);
  });
  it("úkos, válec na střed plochy, kužel s osou hranou a potlačená díra vlastními příkazy", async () => {
    const d = part("Vlastní příkazy", [
      box("b", "Kvádr 1"),
      { id: "dr", name: "Úkos 1", type: "draft", angle: 5, faces: [0, 1, 2, 3], plane: "XY", offset: 0 },
      { id: "c1", name: "Válec 1", type: "cylinder", radius: 5, height: 15, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "face", index: 5 } },
      { id: "c2", name: "Kužel 1", type: "cone", radius1: 4, radius2: 2, height: 10, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "edge", index: 4, at: "center" }, dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } } },
      { id: "c3", name: "Koule 1", type: "sphere", radius: 3, position: [0, 0, 0], mode: "add", positionRef: { kind: "derived", op: "mid", args: [{ kind: "vertex", index: 0 }, { kind: "vertex", index: 6 }] } },
      hole("h", "Díra 1", 20, { suppressed: true }),
      { id: "dr2", name: "Úkos 2", type: "draft", angle: 3, faces: [1], plane: "XZ", offset: 4, pull: { kind: "vector", v: [0, -1, 0] }, tangentChain: true },
    ]);
    const r = docToScript(d);
    expect(body(r.text).slice(2)).toEqual([
      "úkos 5 plochy F1 F2 F3 F4",
      "válec 10 15 na střed plochy F6",
      "kužel 8 4 10 na střed kružnice E5 osa hrana E3",
      "koule 6 na mezi V1 V7",
      "díra 5 skrz v 20 10 10",
      "potlačit poslední",
      "úkos 3 plochy F2 rovina XZ odsazení 4 směr -Y tečně",
    ]);
    expect(r.stats).toMatchObject({ dedicated: 7, generic: 0, json: 0 });
    const { docs, errors } = await replay(r.text);
    expect(errors).toEqual([]);
    const strip = (f: Feature) => ({ ...f, id: "", mode: undefined });
    expect(docs[0].features.map(strip)).toEqual(d.features.map(strip));
  });
});
