/**
 * Úpravy existujícího modelu textem (agent-edit.ts + háček v parseru agent.ts): rozbor příkazů upravit / potlačit / zapnout /
 * smazat / přejmenovat / přesunout / duplikovat / zpět / znovu / proměnná / konfigurace česky, anglicky i německy; provedení nad
 * dokumentem (změna parametru, JSON záplata, vazba na proměnnou `==`, plochy a hrany pravidlem nad tělesem před prvkem, závislé
 * prvky, kontrola pořadí skica → vysunutí), historie zpět / znovu, proměnné, konfigurace a jejich řádky ve stavu.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docStatusText, parseAgentText, selectEdges, selectFaces, type EdgeLite } from "./agent";
import { applyEdit, dependentsOf, findFeature, freeName, histStep, historyText, OPTIONAL_KEYS, orderProblem, paramStatusLines, parseEditLine, takeFeatures, type EditCmd, type EditKernel } from "./agent-edit";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";
import "./ext/index";

afterEach(() => setLang("cs"));

/** příruba: skica, vysunutí, díra, pole díry, zaoblení se dvěma hranami (s otisky) */
const flange = (): CadDoc => ({
  ...emptyDoc("Příruba"),
  features: [
    { id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "circle", cx: 0, cy: 0, r: 80 }] },
    { id: "x1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 18, symmetric: false, reverse: false, mode: "new" },
    { id: "h1", name: "Díra 1", type: "hole", position: [60, 0, 18], axis: "Z", flip: false, diameter: 8.5, depth: 0, cbDiameter: 0, cbDepth: 0 },
    { id: "p1", name: "Pole 1", type: "pattern", featureId: "h1", kind: "circular", count: 4, angle: 360, axis: "Z", center: [0, 0, 0] },
    { id: "f1", name: "Zaoblení 1", type: "fillet", radius: 2, edges: [1, 2], edgeSigs: { "1": { t: "line", c: [0, 0, 0], s: 1, n: 9 }, "2": { t: "line", c: [1, 0, 0], s: 1, n: 9 } } } as unknown as Feature,
  ],
});
/** jeden příkaz z textu → provedení nad dokumentem */
const cmdOf = (text: string): EditCmd => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const op = p.ops[0];
  if (op?.k !== "edit") throw new Error(`${text}: ${op?.k}`);
  return op.cmd;
};
const run = (doc: CadDoc, text: string, kernel?: EditKernel) => applyEdit(doc, cmdOf(text), { kernel });
const feat = (d: CadDoc, name: string) => d.features.find((f) => f.name === name) as Feature & Record<string, unknown>;
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

describe("rozbor: upravit (klíč=hodnota, JSON záplata, vazba ==, pravidlo hran) česky, anglicky, německy", () => {
  it("klíč=hodnota, prvek v uvozovkách, bez uvozovek, $last a @N; všechna slova příkazu", () => {
    for (const w of ["upravit", "změnit", "edit", "modify", "bearbeiten", "ändern"]) expect(cmdOf(`${w} "Díra 1" diameter=10 depth=12`)).toEqual({ kind: "edit", target: "Díra 1", pairs: [["diameter", "10"], ["depth", "12"]] });
    expect(cmdOf("upravit Díra 1 diameter=10")).toMatchObject({ target: "Díra 1", pairs: [["diameter", "10"]] });
    expect(cmdOf("upravit $last edges=svislé")).toMatchObject({ target: "$last", pairs: [["edges", "svislé"]] });
    expect(cmdOf("upravit @3 size.0=120")).toMatchObject({ target: "@3", pairs: [["size.0", "120"]] });
    expect(cmdOf('upravit "Vysunutí 1" extent={"kind":"toNext"}')).toMatchObject({ pairs: [["extent", '{"kind":"toNext"}']] });
    expect(cmdOf('upravit "Pole 1" {"count": 6, "angle": 180}')).toMatchObject({ kind: "edit", target: "Pole 1", pairs: [], patch: { count: 6, angle: 180 } });
    // vazba na proměnnou: hodnota začíná „=“
    expect(cmdOf('upravit "Vysunutí 1" distance==h*2')).toMatchObject({ pairs: [["distance", "=h*2"]] });
    expect(cmdOf('upravit "Zaoblení 1" edges=horní;kruhové')).toMatchObject({ pairs: [["edges", "horní;kruhové"]] });
    expect(cmdOf('upravit "Díra 1"')).toMatchObject({ target: "Díra 1", pairs: [] });
  });
  it("chyby rozboru: bez prvku, nečitelný JSON, text mimo klíč=hodnota", () => {
    expect(err("upravit")).toMatch(/^upravit potřebuje prvek a změny: upravit "Díra 1" diameter=10 depth=12/);
    expect(err('upravit "Pole 1" {count: 6}')).toMatch(/^JSON záplatu nelze přečíst/);
    expect(err('upravit "Díra 1" diameter=10 nesmysl')).toBe("„nesmysl“ není ve tvaru klíč=hodnota");
  });
});

describe("rozbor: potlačit / zapnout, smazat, přejmenovat, přesunout, duplikovat, zpět / znovu", () => {
  it("potlačit / zapnout (suppress / unsuppress, unterdrücken / aktivieren), více prvků", () => {
    expect(cmdOf('potlačit "Díra 1" "Pole 1"')).toEqual({ kind: "suppress", targets: ["Díra 1", "Pole 1"], on: true });
    expect(cmdOf('suppress "Hole 1"')).toEqual({ kind: "suppress", targets: ["Hole 1"], on: true });
    expect(cmdOf("unterdrücken Bohrung 1")).toEqual({ kind: "suppress", targets: ["Bohrung", "1"], on: true });
    for (const w of ["zapnout", "unsuppress", "aktivieren"]) expect(cmdOf(`${w} "Díra 1";"Pole 1"`)).toEqual({ kind: "suppress", targets: ["Díra 1", "Pole 1"], on: false });
    expect(err("potlačit")).toMatch(/^potlačit potřebuje prvek/);
  });
  it("smazat <prvek> vs. smazat poslední (dosavadní pop); EN delete / remove, DE löschen / entfernen", () => {
    for (const t of ["smazat", "smazat poslední", "delete last", "löschen letzte", "odstranit", "remove last", "entfernen letzte"]) expect(parseAgentText(t).ops.map((o) => o.k), t).toEqual(["pop"]);
    for (const w of ["smazat", "odstranit", "delete", "remove", "löschen", "entfernen"]) expect(cmdOf(`${w} "Díra 1" "Pole 1"`)).toEqual({ kind: "delete", targets: ["Díra 1", "Pole 1"] });
  });
  it("přejmenovat … na … (rename … to …, umbenennen … zu / in …)", () => {
    expect(cmdOf('přejmenovat "Díra 1" na "Díra M8"')).toEqual({ kind: "rename", target: "Díra 1", name: "Díra M8" });
    expect(cmdOf("přejmenovat Díra 1 na Díra M8")).toEqual({ kind: "rename", target: "Díra 1", name: "Díra M8" });
    expect(cmdOf('rename "Hole 1" to "M8 hole"')).toEqual({ kind: "rename", target: "Hole 1", name: "M8 hole" });
    expect(cmdOf('umbenennen "Bohrung 1" zu "M8"')).toEqual({ kind: "rename", target: "Bohrung 1", name: "M8" });
    expect(cmdOf('umbenennen "Bohrung 1" in "M8"')).toEqual({ kind: "rename", target: "Bohrung 1", name: "M8" });
    expect(err('přejmenovat "Díra 1"')).toMatch(/^přejmenovat potřebuje prvek a nový název/);
  });
  it("přesunout před / za / nahoru / dolů N / na začátek (move, verschieben)", () => {
    expect(cmdOf('přesunout "Díra 1" před "Vysunutí 1"')).toEqual({ kind: "move", target: "Díra 1", where: { kind: "before", ref: "Vysunutí 1" } });
    expect(cmdOf('přesunout "Díra 1" za "Pole 1"')).toEqual({ kind: "move", target: "Díra 1", where: { kind: "after", ref: "Pole 1" } });
    expect(cmdOf('přesunout "Díra 1" nahoru')).toEqual({ kind: "move", target: "Díra 1", where: { kind: "up", n: 1 } });
    expect(cmdOf('přesunout "Díra 1" dolů 2')).toEqual({ kind: "move", target: "Díra 1", where: { kind: "down", n: 2 } });
    expect(cmdOf('přesunout "Díra 1" na začátek')).toEqual({ kind: "move", target: "Díra 1", where: { kind: "start" } });
    expect(cmdOf('move "Hole 1" after "Pattern 1"')).toEqual({ kind: "move", target: "Hole 1", where: { kind: "after", ref: "Pattern 1" } });
    expect(cmdOf('move "Hole 1" up 3')).toEqual({ kind: "move", target: "Hole 1", where: { kind: "up", n: 3 } });
    expect(cmdOf('verschieben "Bohrung 1" vor "Extrusion 1"')).toEqual({ kind: "move", target: "Bohrung 1", where: { kind: "before", ref: "Extrusion 1" } });
    expect(cmdOf('verschieben "Bohrung 1" nach oben')).toEqual({ kind: "move", target: "Bohrung 1", where: { kind: "up", n: 1 } });
    expect(cmdOf('verschieben "Bohrung 1" runter 2')).toEqual({ kind: "move", target: "Bohrung 1", where: { kind: "down", n: 2 } });
    expect(err('přesunout "Díra 1"')).toMatch(/^přesunout potřebuje prvek a místo/);
  });
  it("duplikovat [jako …] (duplicate as, duplizieren als)", () => {
    expect(cmdOf('duplikovat "Díra 1"')).toEqual({ kind: "duplicate", target: "Díra 1" });
    expect(cmdOf('duplikovat "Díra 1" jako "Díra 2"')).toEqual({ kind: "duplicate", target: "Díra 1", name: "Díra 2" });
    expect(cmdOf('duplicate "Hole 1" as "Hole 2"')).toEqual({ kind: "duplicate", target: "Hole 1", name: "Hole 2" });
    expect(cmdOf('duplizieren "Bohrung 1" als "Bohrung 2"')).toEqual({ kind: "duplicate", target: "Bohrung 1", name: "Bohrung 2" });
  });
  it("zpět / znovu [N] = kroky historie (undo / redo, rückgängig / wiederherstellen); „wiederholen“ s volbami zůstává pole", () => {
    for (const w of ["zpět", "undo", "rückgängig", "zurück"]) expect(cmdOf(`${w} 3`)).toEqual({ kind: "undo", n: 3 });
    expect(cmdOf("zpět")).toEqual({ kind: "undo", n: 1 });
    for (const w of ["znovu", "redo", "wiederherstellen", "wiederholen"]) expect(cmdOf(`${w} 2`)).toEqual({ kind: "redo", n: 2 });
    expect(parseAgentText("wiederholen 4 abstand 25 richtung X").ops[0]).toMatchObject({ k: "feature", feature: { type: "pattern", count: 4, spacing: 25 } });
    expect(err("zpět poslední")).toMatch(/^zpět \[N\] – N = počet kroků historie/);
  });
});

describe("rozbor: proměnná, konfigurace", () => {
  it("proměnná = výraz [poznámka], smazat, výpis (variable / var / variables, DE variable / variablen)", () => {
    expect(cmdOf("proměnná d = 20")).toEqual({ kind: "var", name: "d", expr: "20" });
    expect(cmdOf("proměnná h=d*1,5")).toEqual({ kind: "var", name: "h", expr: "d*1,5" });
    expect(cmdOf('var h = d * 2 poznámka "výška náboje"')).toEqual({ kind: "var", name: "h", expr: "d * 2", note: "výška náboje" });
    expect(cmdOf('variable t = 18 notiz "Dicke"')).toEqual({ kind: "var", name: "t", expr: "18", note: "Dicke" });
    expect(cmdOf("variable t = 18 note thickness")).toEqual({ kind: "var", name: "t", expr: "18", note: "thickness" });
    for (const t of ["proměnná smazat d", "variable delete d", "variable löschen d", "var remove d"]) expect(cmdOf(t)).toEqual({ kind: "varDelete", name: "d" });
    for (const t of ["proměnné", "variables", "variablen"]) expect(cmdOf(t)).toEqual({ kind: "vars" });
    expect(err("proměnná d")).toMatch(/^proměnná <název> = <výraz>/);
  });
  it("konfigurace: založit s hodnotami a potlačením, aktivní / žádná, smazat, výpis (config, konfiguration, varianta)", () => {
    expect(cmdOf('konfigurace "Krátká" t=10 h=d*2 potlačit "Díra 1";"Pole 1"')).toEqual({ kind: "config", name: "Krátká", values: [["t", "10"], ["h", "d*2"]], suppress: ["Díra 1", "Pole 1"] });
    expect(cmdOf('config "Short" t=10 suppress "Hole 1"')).toEqual({ kind: "config", name: "Short", values: [["t", "10"]], suppress: ["Hole 1"] });
    expect(cmdOf('konfiguration "Kurz" t=10 unterdrücken keine')).toEqual({ kind: "config", name: "Kurz", values: [["t", "10"]], suppress: [] });
    expect(cmdOf("varianta Dlouhá t=30")).toEqual({ kind: "config", name: "Dlouhá", values: [["t", "30"]] });
    expect(cmdOf('konfigurace aktivní "Krátká"')).toEqual({ kind: "configActive", name: "Krátká" });
    for (const t of ["konfigurace aktivní žádná", "config active none", "konfiguration aktiv keine"]) expect(cmdOf(t)).toEqual({ kind: "configActive", name: null });
    for (const t of ['konfigurace smazat "Krátká"', 'config delete "Krátká"', 'konfiguration löschen "Krátká"']) expect(cmdOf(t)).toEqual({ kind: "configDelete", name: "Krátká" });
    for (const t of ["konfigurace", "config", "konfiguration"]) expect(cmdOf(t)).toEqual({ kind: "configs" });
    expect(err('konfigurace "X" t=1 u')).toMatch(/^konfigurace: „u“ není ve tvaru proměnná=hodnota/);
  });
  it("parseEditLine nečte běžné příkazy (vrací null) – kvádr, skica XY, kóta délka, vazba", () => {
    for (const t of ["kvádr 10 10 10", "skica XY: kružnice 10", "kóta délka e1 50", "vazba kolmo e1 e2", "skica plocha horní", "pole 4 rozteč 20"]) expect(parseEditLine(t), t).toBeNull();
  });
});

describe("provedení: upravit parametr, JSON záplata, vazba na proměnnou, plochy a hrany pravidlem", () => {
  it("změna parametru: protokol „✓ Díra 1: diameter 8,5 → 10“, závislé prvky do výsledku po stavbě", async () => {
    const r = await run(flange(), 'upravit "Díra 1" diameter=10 depth=12');
    expect(r.log).toEqual(["✓ Díra 1: diameter 8,5 → 10, depth 0 → 12"]);
    expect(feat(r.doc, "Díra 1")).toMatchObject({ diameter: 10, depth: 12 });
    expect(r.changed).toBe(true);
    expect(r.touched).toEqual(["h1", "p1"]); // pole odkazuje na díru (featureId)
    // vektor po složkách a celý, $last, #N
    expect(feat((await run(flange(), "upravit @3 position.2=20")).doc, "Díra 1").position).toEqual([60, 0, 20]);
    expect(feat((await run(flange(), "upravit @3 position=10;5;18")).doc, "Díra 1").position).toEqual([10, 5, 18]);
    expect((await run(flange(), "upravit $last radius=3")).log[0]).toBe("✓ Zaoblení 1: radius 2 → 3");
  });
  it("odkazy názvem, režim slovem, volitelné pole (extent JSON), název", async () => {
    const d = flange();
    d.features.splice(1, 0, { id: "s2", name: "Skica 2", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [] });
    let r = await run(d, 'upravit "Vysunutí 1" sketchId="Skica 2" mode=odebrat extent={"kind":"throughAll"} název="Kapsa"');
    expect(feat(r.doc, "Kapsa")).toMatchObject({ sketchId: "s2", mode: "cut", extent: { kind: "throughAll" } });
    expect(r.log[0]).toBe('✓ Vysunutí 1: sketchId „Skica 1“ → „Skica 2“, mode new → cut, extent – → {"kind":"throughAll"}, název Vysunutí 1 → Kapsa');
    // skica musí být PŘED upravovaným prvkem
    await expect(run(flange(), 'upravit "Vysunutí 1" sketchId="Pole 1"')).rejects.toThrow(/^„Pole 1“ před prvkem „Vysunutí 1“ není – skici: Skica 1$/);
    r = await run(flange(), 'upravit "Pole 1" {"count": 6, "skip": [1]}');
    expect(feat(r.doc, "Pole 1")).toMatchObject({ count: 6, skip: [1] });
    expect(r.log[0]).toBe("✓ Pole 1: count 4 → 6, skip – → [1]");
  });
  it("chyby: neznámý klíč s výčtem polí, číslo za text, id a typ nelze měnit, neznámý prvek", async () => {
    await expect(run(flange(), 'upravit "Díra 1" diametr=10')).rejects.toThrow(/^„diametr“ není parametr prvku „Díra 1“ \(hole\) – parametry: position, axis, flip, diameter, depth, cbDiameter, cbDepth$/);
    await expect(run(flange(), 'upravit "Díra 1" diameter=velký')).rejects.toThrow("„diameter“ čeká číslo (dosud 8,5), zadáno „velký“");
    await expect(run(flange(), 'upravit "Díra 1" position=1;2')).rejects.toThrow(/čeká 3 čísel oddělených středníkem/);
    await expect(run(flange(), 'upravit "Díra 1" type=box')).rejects.toThrow(/nelze měnit/);
    await expect(run(flange(), 'upravit "Díra 9" diameter=1')).rejects.toThrow(/^„Díra 9“ v historii není – k dispozici: Skica 1, Vysunutí 1, Díra 1, Pole 1, Zaoblení 1$/);
  });
  it("české a německé názvy polí (průměr, hloubka, hrany, Anzahl) i prvek rozšíření (klíč, popisek, režim, odkaz na skicu)", async () => {
    let r = await run(flange(), 'upravit "Díra 1" průměr=12 hloubka=5');
    expect(feat(r.doc, "Díra 1")).toMatchObject({ diameter: 12, depth: 5 });
    r = await run(flange(), 'bearbeiten "Pole 1" anzahl=8');
    expect(feat(r.doc, "Pole 1").count).toBe(8);
    const d = flange();
    d.features.push({ id: "z1", name: "Zkrut 1", type: "ext", ext: "adv.twist", data: { sketch: "s1", height: 30, angle: 45, mode: "add" } } as Feature);
    r = await run(d, 'upravit "Zkrut 1" angle=90 Výška=40 mode=odebrat');
    expect(feat(r.doc, "Zkrut 1").data).toMatchObject({ sketch: "s1", height: 40, angle: 90, mode: "cut" });
    expect(r.log[0]).toBe("✓ Zkrut 1: data.angle 45 → 90, data.height 30 → 40, data.mode add → cut");
    await expect(run(r.doc, 'upravit "Zkrut 1" angle==a*2')).rejects.toThrow(/Neznámá proměnná „a“/);
    r = await run({ ...r.doc, variables: [{ name: "a", expr: "30" }] }, 'upravit "Zkrut 1" úhel==a*2');
    expect(r.doc.bindings).toEqual({ "z1:data.angle": "a*2" });
    expect(feat(r.doc, "Zkrut 1").data).toMatchObject({ angle: 60 });
  });
  it("bez klíčů vypíše parametry prvku", async () => {
    const r = await run(flange(), 'upravit "Díra 1"');
    expect(r.changed).toBe(false);
    expect(r.log[0]).toBe("Parametry „Díra 1“ (hole): position=[60; 0; 18] · axis=Z · flip=ne · diameter=8,5 · depth=0 · cbDiameter=0 · cbDepth=0");
  });
  it("vazba na proměnné: distance==h*2 → bindings + hodnota; číslo vazbu zruší; výraz bez proměnné / neznámá proměnná = chyba", async () => {
    const d = { ...flange(), variables: [{ name: "h", expr: "20" }] };
    let r = await run(d, 'upravit "Vysunutí 1" distance==h*2');
    expect(r.doc.bindings).toEqual({ "x1:distance": "h*2" });
    expect(feat(r.doc, "Vysunutí 1").distance).toBe(40);
    expect(r.log[0]).toBe("✓ Vysunutí 1: distance = h*2 (= 40) – vazba na proměnné");
    expect(paramStatusLines(r.doc)).toEqual(["Vazby parametrů: Vysunutí 1.distance = h*2 (= 40)"]);
    r = await run(r.doc, 'upravit "Vysunutí 1" distance=15');
    expect(r.doc.bindings).toEqual({});
    expect(r.log[0]).toBe("✓ Vysunutí 1: distance 40 → 15, vazba distance = h*2 zrušena");
    await expect(run(d, 'upravit "Vysunutí 1" distance==2*3')).rejects.toThrow(/neobsahuje proměnnou/);
    await expect(run(d, 'upravit "Vysunutí 1" distance==x*2')).rejects.toThrow("distance: Neznámá proměnná „x“. – proměnné: h");
    await expect(run(d, 'upravit "Vysunutí 1" mode==h')).rejects.toThrow(/jen u číselného parametru/);
  });
  it("hrany pravidlem nad tělesem PŘED prvkem, otisky se smažou a spočtou znovu (stamp); popisky E3 = index 2", async () => {
    const edges: EdgeLite[] = [
      { index: 0, curve: "Úsečka", dir: [0, 0, 1], center: [0, 0, 9], length: 18 },
      { index: 1, curve: "Kružnice", radius: 80, center: [0, 0, 18], length: 502 },
      { index: 2, curve: "Kružnice", radius: 80, center: [0, 0, 0], length: 502 },
      { index: 3, curve: "Kružnice", radius: 4.25, center: [60, 0, 18], length: 26 },
    ];
    const bbox: [Vec3, Vec3] = [[-80, -80, 0], [80, 80, 18]];
    const seen: { topo?: string[]; stamp?: string[]; sigs?: unknown } = {};
    const kernel: EditKernel = {
      topology: async (doc) => ((seen.topo = doc.features.map((f) => f.id)), { faces: [], edges, bbox }),
      selectEdges,
      selectFaces,
      stamp: async (before, f) => ((seen.stamp = before.features.map((x) => x.id)), (seen.sigs = (f as { edgeSigs?: unknown }).edgeSigs), { ...f, edgeSigs: { stamped: true } } as unknown as Feature),
    };
    const r = await run(flange(), 'upravit "Zaoblení 1" edges=horní;kruhové', kernel);
    expect(seen.topo).toEqual(["s1", "x1", "h1", "p1"]); // těleso před zaoblením
    expect(seen.stamp).toEqual(["s1", "x1", "h1", "p1"]);
    expect(seen.sigs).toBeUndefined(); // staré otisky (jiných hran) pryč, než se spočtou nové
    expect(feat(r.doc, "Zaoblení 1")).toMatchObject({ edges: [1, 3], edgeSigs: { stamped: true } });
    expect(r.log[0]).toBe("✓ Zaoblení 1: edges [1; 2] → [1; 3] (2 podle pravidla „horni kruhove“)");
    const r2 = await run(flange(), 'upravit "Zaoblení 1" edges=E3;E4', kernel);
    expect(feat(r2.doc, "Zaoblení 1").edges).toEqual([2, 3]);
    const r3 = await run(flange(), 'upravit "Zaoblení 1" edges=vše', kernel);
    expect(feat(r3.doc, "Zaoblení 1").edges).toBe("all");
    await expect(run(flange(), 'upravit "Zaoblení 1" edges=svislé;spodní', kernel)).rejects.toThrow(/^žádná hrana neodpovídá pravidlu/);
    await expect(run(flange(), 'upravit "Zaoblení 1" edges=horní')).rejects.toThrow(/potřebuje jádro/);
  });
});

describe("provedení: potlačit / zapnout, smazat, přejmenovat, přesunout, duplikovat", () => {
  it("potlačit a zapnout; už potlačený; závislé prvky do výsledku", async () => {
    let r = await run(flange(), 'potlačit "Díra 1"');
    expect(feat(r.doc, "Díra 1").suppressed).toBe(true);
    expect(r.log).toEqual(["✓ potlačeno: Díra 1"]);
    expect(r.touched).toEqual(["p1"]);
    r = await run(r.doc, 'potlačit "Díra 1" "Pole 1"');
    expect(r.log).toEqual(["✓ potlačeno: Pole 1", "✓ už potlačeno: Díra 1"]);
    r = await run(r.doc, "zapnout Díra 1 Pole 1");
    expect(feat(r.doc, "Díra 1").suppressed).toBeUndefined();
    expect(r.log).toEqual(["✓ zapnuto: Díra 1, Pole 1"]);
  });
  it("smazat konkrétní prvek: závislé prvky v protokolu, vazby a potlačení v konfiguracích uklizené", async () => {
    const d = { ...flange(), bindings: { "h1:diameter": "d", "x1:distance": "d" }, variables: [{ name: "d", expr: "9" }], configs: [{ id: "c1", name: "A", values: {}, suppressed: ["h1", "f1"] }] };
    const r = await run(d, 'smazat "Díra 1"');
    expect(r.doc.features.map((f) => f.id)).toEqual(["s1", "x1", "p1", "f1"]);
    expect(r.removed).toEqual(["h1"]);
    expect(r.touched).toEqual(["p1"]);
    expect(r.log).toEqual(["✓ smazáno: Díra 1", "⚠ na smazané odkazují: Pole 1 (featureId) – po výpočtu nejspíš ✗; smažte je také, nebo je upravte (upravit …)"]);
    expect(r.doc.bindings).toEqual({ "x1:distance": "d" });
    expect(r.doc.configs?.[0].suppressed).toEqual(["f1"]);
    const r2 = await run(flange(), "smazat Díra 1 Pole 1");
    expect(r2.doc.features.map((f) => f.name)).toEqual(["Skica 1", "Vysunutí 1", "Zaoblení 1"]);
    expect(r2.log).toEqual(["✓ smazáno: Díra 1, Pole 1"]);
    await expect(run(flange(), 'smazat "Díra 7"')).rejects.toThrow(/v historii není – k dispozici/);
  });
  it("přejmenovat, duplicita názvu ⚠, duplikovat za originál", async () => {
    let r = await run(flange(), 'přejmenovat "Díra 1" na "Díra M8"');
    expect(feat(r.doc, "Díra M8").id).toBe("h1");
    expect(r.log).toEqual(["✓ přejmenováno: Díra 1 → Díra M8"]);
    r = await run(flange(), 'přejmenovat "Díra 1" na "Pole 1"');
    expect(r.log[1]).toMatch(/^⚠ název „Pole 1“ má i jiný prvek/);
    r = await run(flange(), 'duplikovat "Díra 1"');
    expect(r.doc.features.map((f) => f.name)).toEqual(["Skica 1", "Vysunutí 1", "Díra 1", "Díra 1 (kopie)", "Pole 1", "Zaoblení 1"]);
    expect(r.doc.features[3].id).not.toBe("h1");
    expect(r.log).toEqual(["✓ Díra 1 duplikován jako „Díra 1 (kopie)“ (pozice 4)"]);
    expect((await run(flange(), 'duplikovat "Díra 1" jako "Díra 2"')).doc.features[3].name).toBe("Díra 2");
  });
  it("přesunout před / za / nahoru / dolů / na konec; kontrola pořadí skica → vysunutí (✗ s důvodem)", async () => {
    const names = (d: CadDoc) => d.features.map((f) => f.name);
    let r = await run(flange(), 'přesunout "Zaoblení 1" před "Díra 1"');
    expect(names(r.doc)).toEqual(["Skica 1", "Vysunutí 1", "Zaoblení 1", "Díra 1", "Pole 1"]);
    expect(r.log).toEqual(["✓ „Zaoblení 1“ přesunut před „Díra 1“ (pozice 5 → 3)"]);
    r = await run(flange(), 'přesunout "Zaoblení 1" nahoru 2');
    expect(names(r.doc)).toEqual(["Skica 1", "Vysunutí 1", "Zaoblení 1", "Díra 1", "Pole 1"]);
    r = await run(flange(), 'přesunout "Pole 1" na konec');
    expect(names(r.doc)).toEqual(["Skica 1", "Vysunutí 1", "Díra 1", "Zaoblení 1", "Pole 1"]);
    r = await run(flange(), 'přesunout "Zaoblení 1" na začátek');
    expect(names(r.doc)[0]).toBe("Zaoblení 1");
    await expect(run(flange(), 'přesunout "Skica 1" za "Vysunutí 1"')).rejects.toThrow("přesunout „Skica 1“ na pozici 2 nelze: „Vysunutí 1“ používá „Skica 1“ (sketchId) – použitý prvek musí zůstat v historii před prvkem, který ho používá");
    await expect(run(flange(), 'přesunout "Díra 1" za "Pole 1"')).rejects.toThrow(/„Pole 1“ používá „Díra 1“ \(featureId\)/);
    expect((await run(flange(), 'přesunout "Díra 1" dolů 0')).log[0]).toBe("✓ „Díra 1“ už je na pozici 3");
  });
  it("závislosti a pořadí (čisté funkce): featureRefs v datech rozšíření, orderProblem", () => {
    const d = flange();
    d.features.push({ id: "z1", name: "Zkrut 1", type: "ext", ext: "adv.twist", data: { sketch: "s1", height: 30 } } as Feature);
    expect(dependentsOf(d, "s1").map((x) => `${x.f.name}:${x.path}`)).toEqual(["Vysunutí 1:sketchId", "Zkrut 1:data.sketch"]);
    expect(orderProblem(d.features)).toBeNull();
    expect(orderProblem([d.features[1], d.features[0]])).toMatchObject({ user: { id: "x1" }, used: { id: "s1" }, path: "sketchId" });
    expect(takeFeatures(d, ["Díra", "1", "Pole 1", "$last"]).map((f) => f.id)).toEqual(["h1", "p1", "z1"]);
    expect(findFeature(d, "@2")?.id).toBe("x1");
    expect(findFeature(d, "dira 1")?.id).toBe("h1"); // bez diakritiky
  });
  it("freeName: výchozí název z dřívějšího běhu (Skica 1 už v dílu je) dostane další volné číslo; vlastní a jiný typ zůstanou", () => {
    const d = flange();
    const sk = { id: "n", name: "Skica 1", type: "sketch" } as Feature;
    expect(freeName(d.features, sk)).toBe("Skica 2");
    expect(freeName(d.features, { ...sk, name: "Díra 1" })).toBe("Díra 1"); // jiný typ
    expect(freeName(d.features, { ...sk, name: "Víko" })).toBe("Víko");
    expect(freeName([...d.features, { ...sk, id: "m", name: "Skica 2" }], sk)).toBe("Skica 3");
  });
});

describe("provedení: proměnné a konfigurace, řádky stavu", () => {
  it("proměnná: přidat, změnit (dřívější hodnota), chyba výrazu se nezapíše, smazat s upozorněním, výpis", async () => {
    let r = await run(flange(), "proměnná d = 20");
    expect(r.doc.variables).toEqual([{ name: "d", expr: "20" }]);
    expect(r.log).toEqual(["✓ proměnná d = 20 → 20"]);
    r = await run(r.doc, 'proměnná h = d*1,5 poznámka "výška"');
    expect(r.log).toEqual(["✓ proměnná h = d*1,5 → 30"]);
    r = await run({ ...r.doc, bindings: { "x1:distance": "h" } }, "proměnná h = d*2");
    expect(r.log).toEqual(["✓ proměnná h = d*2 → 40 (bylo d*1,5 → 30); vazby: Vysunutí 1.distance"]);
    expect(r.doc.variables?.[1]).toEqual({ name: "h", expr: "d*2", note: "výška" });
    expect(r.touched).toEqual(["x1"]);
    await expect(run(r.doc, "proměnná x = y+1")).rejects.toThrow("proměnná x = y+1: Neznámá proměnná „y“. – proměnné: d, h");
    await expect(run(r.doc, "proměnná d = h")).rejects.toThrow(/Cyklická závislost/);
    await expect(run(r.doc, "proměnná 2x = 1")).rejects.toThrow(/neplatný název proměnné „2x“/);
    const list = await run(r.doc, "proměnné");
    expect(list.log).toEqual(["Proměnné (2): d = 20 → 20 · h = d*2 → 40 („výška“)", "Vazby parametrů: Vysunutí 1.distance = h (= 40)"]);
    r = await run(r.doc, "proměnná smazat d");
    expect(r.doc.variables?.map((v) => v.name)).toEqual(["h"]);
    expect(r.log).toEqual(["✓ proměnná d smazána", "⚠ na d odkazují: h – teď skončí chybou proměnných; upravte je (proměnná …, upravit … klíč=číslo)"]);
  });
  it("konfigurace: založit, aktivovat, upravit, výpis, smazat; řádky stavu „Konfigurace:“ a vazby s hodnotou podle aktivní konfigurace", async () => {
    let d: CadDoc = { ...flange(), variables: [{ name: "t", expr: "18" }], bindings: { "x1:distance": "t" } };
    let r = await run(d, 'konfigurace "Nízká" t=10 potlačit "Díra 1"');
    const c = r.doc.configs![0];
    expect(c).toMatchObject({ name: "Nízká", values: { t: 10 }, suppressed: ["h1"] });
    expect(r.log).toEqual(['✓ konfigurace „Nízká“ založena: t = 10; potlačeno: Díra 1 – aktivujete: konfigurace aktivní "Nízká"']);
    r = await run(r.doc, 'konfigurace "Vysoká" t=t*2');
    expect(r.doc.configs![1].values).toEqual({ t: 36 });
    r = await run(r.doc, 'konfigurace aktivní "nízká"');
    expect(r.doc.activeConfig).toBe(c.id);
    expect(r.log).toEqual(["✓ aktivní konfigurace „Nízká“: t = 10; potlačeno: Díra 1"]);
    d = r.doc;
    expect(paramStatusLines(d)).toEqual(["Vazby parametrů: Vysunutí 1.distance = t (= 10)", "Konfigurace: Nízká (aktivní), Vysoká"]);
    const st = docStatusText(d, null);
    expect(st).toMatch(/\nVazby parametrů: Vysunutí 1\.distance = t \(= 10\)\nKonfigurace: Nízká \(aktivní\), Vysoká$/);
    r = await run(d, 'konfigurace "Nízká" potlačit žádné');
    expect(r.doc.configs![0].suppressed).toEqual([]);
    expect(r.log[0]).toBe("✓ konfigurace „Nízká“ upravena: t = 10 (aktivní)");
    expect((await run(d, "konfigurace")).log).toEqual(["Konfigurace (2): Nízká (aktivní): t = 10; potlačeno: Díra 1 · Vysoká: t = 36"]);
    r = await run(d, "konfigurace aktivní žádná");
    expect(r.doc.activeConfig).toBeNull();
    r = await run(d, 'konfigurace smazat "Nízká"');
    expect(r.doc.configs!.map((x) => x.name)).toEqual(["Vysoká"]);
    expect(r.doc.activeConfig).toBeNull();
    await expect(run(d, 'konfigurace "X" q=1')).rejects.toThrow(/^konfigurace: proměnná „q“ není – proměnné: t/);
    await expect(run(d, 'konfigurace aktivní "Neznámá"')).rejects.toThrow("konfigurace „Neznámá“ není – konfigurace: Nízká, Vysoká");
  });
});

describe("zpět / znovu (historie dokumentu)", () => {
  const h0 = { past: [1, 2, 3], present: 4, future: [5] };
  it("histStep: N kroků, víc než je v historii, nic", () => {
    expect(histStep(h0, "undo", 2)).toEqual({ hist: { past: [1], present: 2, future: [3, 4, 5] }, moved: 2 });
    expect(histStep(h0, "redo", 3)).toEqual({ hist: { past: [1, 2, 3, 4], present: 5, future: [] }, moved: 1 });
    const none = histStep({ past: [], present: 1, future: [] }, "undo", 1);
    expect(none.moved).toBe(0);
  });
  it("historyText česky a anglicky", () => {
    expect(historyText("undo", 2, 2, { past: [1], future: [4, 5] })).toBe("✓ zpět o 2 krok(ů) (zbývá zpět 1, znovu 2)");
    expect(historyText("redo", 3, 1, { past: [1, 2, 3, 4], future: [] })).toBe("✓ znovu 1 krok(ů) – víc kroků v historii není (zbývá zpět 4, znovu 0)");
    expect(historyText("undo", 1, 0, { past: [], future: [] })).toMatch(/^✗ zpět: historie je prázdná/);
    setLang("en");
    expect(historyText("undo", 2, 2, { past: [1], future: [4, 5] })).toBe("✓ undo 2 step(s) (left: undo 1, redo 2)");
  });
});

describe("protokol v jazyce rozhraní", () => {
  it("anglicky a německy", async () => {
    setLang("en");
    expect((await run(flange(), 'edit "Díra 1" diameter=10')).log[0]).toBe("✓ Díra 1: diameter 8.5 → 10");
    expect((await run(flange(), 'suppress "Díra 1"')).log[0]).toBe("✓ suppressed: Díra 1");
    await expect(run(flange(), 'move "Skica 1" after "Vysunutí 1"')).rejects.toThrow(/^cannot move “Skica 1” to position 2/);
    setLang("de");
    expect((await run(flange(), 'löschen "Díra 1"')).log[0]).toBe("✓ gelöscht: Díra 1");
    expect((await run(flange(), "variable d = 2,5")).log[0]).toBe("✓ Variable d = 2,5 → 2,5");
  });
});

describe("volitelná pole prvků (OPTIONAL_KEYS) odpovídají typu Feature v types.ts", () => {
  it("každé `pole?:` z typu Feature je v seznamu", () => {
    const src = fs.readFileSync(path.join(__dirname, "types.ts"), "utf8");
    const a = src.indexOf("export type Feature = ");
    const b = src.indexOf("export type FeatureType");
    const body = src.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const keys = [...new Set([...body.matchAll(/(\w+)\?:/g)].map((m) => m[1]))];
    expect(keys.filter((k) => !OPTIONAL_KEYS.has(k))).toEqual([]);
  });
});
