/** Text `vysunout` (EN extrude, DE extrudieren): šikmý směr, sklon, výška kolmo, úkos dovnitř / ven, břit, rohy, ukončení odkazem, stav. */
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, featureSummary, parseAgentText } from "./agent";
import { extrudeFieldValue, extrudeSummary, resolveRefNames, scanExtrude } from "./agent-extr";
import { applyEdit } from "./agent-edit";
import { setLang } from "./i18n";
import { emptyDoc, type Feature } from "./types";

afterEach(() => setLang("cs"));

type ExtrudeF = Extract<Feature, { type: "extrude" }>;
const ex = (line: string): ExtrudeF => {
  const p = parseAgentText(line);
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join("; "));
  const op = p.ops.find((o) => o.k === "feature");
  if (!op || op.k !== "feature" || op.feature.type !== "extrude") throw new Error("není vysunutí");
  return op.feature;
};
const err = (line: string) => parseAgentText(line).errors[0]?.message ?? "";

describe("šikmý směr a sklon", () => {
  it("CS: směr vektorem, osou, hranou, plochou, pomocnou osou názvem, dvěma body", () => {
    expect(ex("vysunout 20 směr 1 0 1")).toMatchObject({ distance: 20, dir: { kind: "vector", v: [1, 0, 1] } });
    expect(ex("vysunout 20 směr +X").dir).toEqual({ kind: "axis", axis: "X" });
    expect(ex("vysunout 20 směr -Y").dir).toEqual({ kind: "vector", v: [0, -1, 0] });
    expect(ex("vysunout 20 směr hrana E3").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 2 } });
    expect(ex("vysunout 20 podél hrany E3").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 2 } });
    expect(ex("vysunout 20 směr E3").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 2 } });
    expect(ex("vysunout 20 směr plocha F2").dir).toEqual({ kind: "faceNormal", ref: { kind: "face", index: 1 } });
    expect(ex('vysunout 20 směr osa "Osa 1"').dir).toEqual({ kind: "edge", ref: { kind: "datumAxis", featureId: "Osa 1" } });
    expect(ex("vysunout 20 směr osa Z").dir).toEqual({ kind: "axis", axis: "Z" });
    expect(ex("vysunout 20 směr body V1 V5").dir).toEqual({ kind: "twoPoints", a: { kind: "vertex", index: 0 }, b: { kind: "vertex", index: 4 } });
    expect(ex("vysunout 20 směr normála").dir).toBeUndefined();
  });
  it("CS: sklon 25 k +X / k vektoru / směr +X (jako díra); výška = kolmo na skicu", () => {
    const a = ex("vysunout výška 20 sklon 25 k +X");
    expect(a).toMatchObject({ distance: 20, normalHeight: true, dir: { kind: "angle", deg: 25, toward: [1, 0, 0] } });
    expect(ex("vysunout 20 sklon 25 k 1 1 0").dir).toEqual({ kind: "angle", deg: 25, toward: [1, 1, 0] });
    expect(ex("vysunout 20 sklon 25 směr -Y").dir).toEqual({ kind: "angle", deg: 25, toward: [0, -1, 0] });
    expect(ex("vysunout 20 k +X sklon 25").dir).toEqual({ kind: "angle", deg: 25, toward: [1, 0, 0] });
    const b = ex("vysunout 20 sklon 25");
    // bez „k“ = k ose X skici; keepSide = „obráceně“ zrcadlí přes rovinu skici stejně jako s „k +X“
    expect(b.dir).toEqual({ kind: "angle", deg: 25, keepSide: true });
    expect(b.normalHeight).toBeUndefined();
    // výška bez šikmého směru = obyčejná vzdálenost (dokument beze změny)
    expect(ex("vysunout výška 20").normalHeight).toBeUndefined();
  });
  it("EN / DE", () => {
    setLang("en");
    expect(ex("extrude height 20 tilt 25 toward +X")).toMatchObject({ distance: 20, normalHeight: true, dir: { kind: "angle", deg: 25, toward: [1, 0, 0] } });
    expect(ex("extrude 20 direction edge E3").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 2 } });
    expect(ex('extrude 20 direction axis "Axis 1"').dir).toEqual({ kind: "edge", ref: { kind: "datumAxis", featureId: "Axis 1" } });
    expect(ex("extrude 20 direction face F2").dir).toEqual({ kind: "faceNormal", ref: { kind: "face", index: 1 } });
    expect(ex("extrude 20 along edge E1").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 0 } });
    setLang("de");
    expect(ex("extrudieren höhe 20 neigung 25 nach +X")).toMatchObject({ normalHeight: true, dir: { kind: "angle", deg: 25, toward: [1, 0, 0] } });
    expect(ex("extrudieren 20 richtung kante E3").dir).toEqual({ kind: "edge", ref: { kind: "edge", index: 2 } });
    expect(ex('extrudieren 20 richtung achse "Achse 1"').dir).toEqual({ kind: "edge", ref: { kind: "datumAxis", featureId: "Achse 1" } });
    expect(ex("extrudieren 20 richtung fläche F2").dir).toEqual({ kind: "faceNormal", ref: { kind: "face", index: 1 } });
  });
  it("chyby místo tichého ignorování", () => {
    expect(err("vysunout 20 směr")).toMatch(/směr potřebuje hodnotu/);
    expect(err("vysunout 20 směr 1 0")).toMatch(/tři čísla/);
    expect(err("vysunout 20 směr 0 0 0")).toMatch(/nulový vektor/);
    expect(err("vysunout 20 směr hrana F2")).toMatch(/číslo hrany/);
    expect(err("vysunout 20 směr nikam")).toMatch(/neznámý směr „nikam“/);
    expect(err("vysunout 20 k +X")).toMatch(/patří za sklon/);
    expect(err("vysunout 20 sklon 25 směr hrana E3")).toMatch(/vektorem nebo osou/);
    expect(err("vysunout 20 sklon")).toMatch(/sklon potřebuje úhel/);
    expect(err("vysunout 20 sklon 95")).toMatch(/menší než 89/);
    expect(err("vysunout 20 nesmysl")).toMatch(/neznámé slovo „nesmysl“/);
    expect(err("vysunout 20 směr 1 0 1 směr 0 1 1")).toMatch(/dvakrát/);
  });
});

describe("úkos dovnitř / ven, břit, rohy", () => {
  it("CS: znaménko slovem, záporné číslo = ven, nový úkos má ostré rohy", () => {
    expect(ex("vysunout 10 úkos 2")).toMatchObject({ draftAngle: 2, draftCorners: "sharp" });
    expect(ex("vysunout 10 úkos 2 dovnitř").draftAngle).toBe(2);
    expect(ex("vysunout 10 úkos 2 ven").draftAngle).toBe(-2);
    expect(ex("vysunout 10 úkos -2").draftAngle).toBe(-2);
    expect(ex("vysunout 10 úkos -2 dovnitř").draftAngle).toBe(2);
    expect(ex("vysunout 10 úkos 2 ven zaoblené rohy").draftCorners).toBe("round");
    expect(ex("vysunout 10 úkos 2 ven rohy ostré").draftCorners).toBe("sharp");
    expect(ex("vysunout 10")).not.toHaveProperty("draftCorners");
  });
  it("střižnice jedním příkazem: skrz, odebrat, obráceně, úkos 2 ven, břit 3", () => {
    expect(ex("vysunout skrz odebrat obráceně úkos 2 ven břit 3")).toMatchObject({ extent: { kind: "throughAll" }, mode: "cut", reverse: true, draftAngle: -2, draftLand: 3, draftCorners: "sharp" });
    setLang("en");
    expect(ex("extrude through cut reverse draft 2 out land 3 round corners")).toMatchObject({ extent: { kind: "throughAll" }, mode: "cut", reverse: true, draftAngle: -2, draftLand: 3, draftCorners: "round" });
    expect(ex("extrude 10 draft 2 in sharp corners")).toMatchObject({ draftAngle: 2, draftCorners: "sharp" });
    setLang("de");
    expect(ex("extrudieren durch abziehen umkehren schräge 2 nach außen steg 3 scharfe ecken")).toMatchObject({ extent: { kind: "throughAll" }, mode: "cut", reverse: true, draftAngle: -2, draftLand: 3, draftCorners: "sharp" });
    expect(ex("extrudieren 10 schräge 2 innen").draftAngle).toBe(2);
    expect(ex("extrudieren 10 schräge 2 aussen").draftAngle).toBe(-2);
  });
  it("chyby: slovo bez úkosu, břit bez úkosu, úhel 45°, obě strany", () => {
    expect(err("vysunout 10 ven")).toMatch(/patří k úkosu/);
    expect(err("vysunout 10 břit 3")).toMatch(/patří k úkosu/);
    expect(err("vysunout 10 úkos 2 břit")).toMatch(/břit potřebuje délku/);
    expect(err("vysunout 10 úkos 45")).toMatch(/menší než 45°/);
    expect(err("vysunout 10 úkos 2 dovnitř ven")).toMatch(/zároveň dovnitř i ven/);
    expect(err("vysunout 10 úkos")).toMatch(/úkos potřebuje úhel/);
  });
});

describe("ukončení odkazem", () => {
  it("CS / EN / DE: k tělesu, k dalšímu, k ploše F3 [odsazení], k rovině, k vrcholu", () => {
    expect(ex("vysunout odebrat k tělesu")).toMatchObject({ extent: { kind: "toBody" }, mode: "cut" });
    expect(ex("vysunout 5 k dalšímu").extent).toEqual({ kind: "toNext" });
    expect(ex("vysunout k ploše F3 odsazení 2").extent).toEqual({ kind: "toFace", ref: { kind: "face", index: 2 }, offset: 2 });
    expect(ex('vysunout k rovině "Rovina 1"').extent).toEqual({ kind: "toFace", ref: { kind: "datum", featureId: "Rovina 1" } });
    expect(ex("vysunout k vrcholu V3 sklon 20 k +Y")).toMatchObject({ extent: { kind: "toVertex", ref: { kind: "vertex", index: 2 } }, dir: { kind: "angle", deg: 20, toward: [0, 1, 0] } });
    setLang("en");
    expect(ex("extrude 10 cut to body").extent).toEqual({ kind: "toBody" });
    expect(ex("extrude to face F3 offset 2").extent).toEqual({ kind: "toFace", ref: { kind: "face", index: 2 }, offset: 2 });
    expect(ex("extrude to next").extent).toEqual({ kind: "toNext" });
    setLang("de");
    expect(ex("extrudieren abziehen bis körper").extent).toEqual({ kind: "toBody" });
    expect(ex("extrudieren bis fläche F3 versatz 2").extent).toEqual({ kind: "toFace", ref: { kind: "face", index: 2 }, offset: 2 });
    expect(ex("extrudieren bis punkt V1").extent).toEqual({ kind: "toVertex", ref: { kind: "vertex", index: 0 } });
  });
  it("chyby", () => {
    expect(err("vysunout skrz k tělesu")).toMatch(/nelze kombinovat/);
    expect(err("vysunout k ploše")).toMatch(/potřebuje odkaz/);
    expect(err("vysunout k ploše E3")).toMatch(/číslo plochy/);
    expect(err("vysunout k vrcholu F1")).toMatch(/číslo vrcholu/);
    expect(err("vysunout 5 k tělesu k dalšímu")).toMatch(/dvakrát/);
    expect(err("vysunout")).toMatch(/vysunout potřebuje výšku/);
  });
});

describe("stav a tabulka příkazů", () => {
  it("starší zápis stavu beze změny, nové parametry se vypíšou", () => {
    const old = { id: "x", name: "V", type: "extrude", sketchId: "s", distance: 20, symmetric: true, reverse: false, mode: "cut" } as ExtrudeF;
    expect(featureSummary(old)).toBe("20 mm, symetricky, cut");
    expect(featureSummary(ex("vysunout skrz odebrat obráceně úkos 2 ven břit 3"))).toBe("skrz vše, cut, úkos 2° ven (obrys se rozšiřuje), břit 3 mm, ostré rohy");
    expect(featureSummary(ex("vysunout výška 20 sklon 25 k +X"))).toBe("20 mm, $auto, směr sklon 25° k +X, výška kolmo na skicu");
    expect(featureSummary(ex("vysunout 20 směr hrana E3 úkos 1 zaoblené rohy"))).toBe("20 mm, $auto, směr podél hrany E3, úkos 1° dovnitř (obrys se zužuje), zaoblené rohy");
    expect(featureSummary(ex("vysunout odebrat k ploše F3 odsazení 2"))).toBe("k ploše F3 (odsazení 2), cut");
    const doc = { features: [{ id: "a1", name: "Osa 1", type: "datumAxis" }] } as never;
    expect(featureSummary({ ...old, symmetric: false, dir: { kind: "edge", ref: { kind: "datumAxis", featureId: "a1" } } } as ExtrudeF, doc)).toBe("20 mm, cut, směr podél osy „Osa 1“");
    setLang("en");
    expect(extrudeSummary(ex("extrude through cut draft 2 out land 3"), (n) => String(n))).toBe("through all, cut, draft 2° out (outline widens), land 3 mm, sharp corners");
  });
  it("tabulka příkazů uvádí celý zápis ve třech jazycích", () => {
    const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith("vysunout"))!;
    for (const w of ["sklon", "k +X", "výška H", "hrana E3", "osa \"Osa 1\"", "plocha F2", "k tělesu", "k ploše F3", "dovnitř|ven", "břit N", "ostré rohy"]) expect(row.cmd).toContain(w);
    for (const w of ["tilt", "toward +X", "edge E3", "to body", "in|out", "land N", "sharp corners"]) expect(row.en).toContain(w);
    for (const w of ["neigung", "nach +X", "kante E3", "bis körper", "innen|außen", "steg N", "scharfe ecken"]) expect(row.de).toContain(w);
  });
  it("scanExtrude nechá obecné volby obecnému rozboru", () => {
    expect(scanExtrude(["20", "odebrat", "úkos", "2", "ven", "břit", "3"]).rest).toEqual(["20", "odebrat", "úkos", "2"]);
  });
  it("resolveRefNames: název → id, nestriktně nechá neznámý název", () => {
    const feats = [{ id: "d1", name: "Rovina 1", type: "datum" }] as Feature[];
    const f = ex('vysunout k rovině "rovina 1"');
    resolveRefNames(f, feats);
    expect(f.extent).toEqual({ kind: "toFace", ref: { kind: "datum", featureId: "d1" } });
    const g = ex('vysunout k rovině "Rovina 7"');
    expect(() => resolveRefNames(g, feats)).toThrow(/Rovina 7.*Rovina 1/);
    resolveRefNames(g, feats, false);
    expect(g.extent).toEqual({ kind: "toFace", ref: { kind: "datum", featureId: "Rovina 7" } });
  });
});

describe("nálezy kontroly: nic se tiše nevynechá ani nezmění význam", () => {
  it("směr odkazem bez „směr“ = chyba s nápovědou (dřív „hrana E17 odebrat“ přidalo, „osa“ se ignorovala)", () => {
    expect(err("vysunout 10 hrana E17 odebrat obráceně")).toMatch(/„hrana E17“.*směr hrana E17/);
    expect(err('vysunout 20 osa "Osa 1"')).toMatch(/směr osa Osa 1|směr osa "Osa 1"/);
    expect(err("vysunout 20 osa Z")).toMatch(/směr osa Z/);
    expect(err("vysunout 10 nové body V1 V8")).toMatch(/směr body V1 V8/);
    expect(err("vysunout 10 plocha F2")).toMatch(/směr plocha F2/);
    setLang("en");
    expect(err("extrude 10 edge E3 cut")).toMatch(/direction edge E3/);
    setLang("cs");
    // název prvku „Osa“ / cílové těleso zůstávají
    expect(ex('vysunout 10 název "Osa 2"').name).toBe("Osa 2");
    expect(ex('vysunout 10 těleso "Těleso 2"').body).toBe("Těleso 2");
  });
  it("„směr body V1 V8“ a „to body“ se neberou jako cílové těleso", () => {
    const a = ex("vysunout 10 směr body V1 V8");
    expect(a.dir).toEqual({ kind: "twoPoints", a: { kind: "vertex", index: 0 }, b: { kind: "vertex", index: 7 } });
    expect(a.body).toBeUndefined();
    setLang("en");
    for (const line of ["extrude cut reverse to body land 3 draft 2 out", "extrude cut reverse to body sharp corners draft 2 out", "extrude cut reverse draft 2 out to body land 3"]) {
      const f = ex(line);
      expect(f.body, line).toBeUndefined();
      expect(f, line).toMatchObject({ extent: { kind: "toBody" }, mode: "cut", reverse: true, draftAngle: -2, draftCorners: "sharp" });
    }
    expect(ex("extrude cut reverse to body land 3 draft 2 out").draftLand).toBe(3);
    setLang("de");
    const d = ex("extrudieren abziehen umkehren bis körper steg 3 schräge 2 außen");
    expect(d.body).toBeUndefined();
    expect(d).toMatchObject({ extent: { kind: "toBody" }, draftAngle: -2, draftLand: 3 });
  });
  it("volby jiných příkazů, přebytečná a dvojí čísla = chyba (dřív ✓ s tichým vynecháním)", () => {
    expect(err("vysunout 20 úhel 25")).toMatch(/volba „úhel“ sem nepatří.*sklon 25/);
    expect(err("vysunout 20 odsazení 5")).toMatch(/volba „odsazení“.*k ploše F3 odsazení 2/);
    expect(err("vysunout 20 v 10 10")).toMatch(/volba „v“ sem nepatří/);
    expect(err("vysunout 20 poloměr 3")).toMatch(/volba „poloměr“ sem nepatří/);
    expect(err("vysunout 20 30")).toMatch(/přebytečné číslo „30“/);
    expect(err("vysunout 20 výška 15 sklon 25")).toMatch(/zadaná dvakrát \(20, výška 15\)/);
    expect(err("vysunout 20 úkos 2 3")).toMatch(/„úkos“ má jen jednu hodnotu/);
    expect(err("vysunout 20 obousměrně")).toMatch(/volba „obousměrně“ sem nepatří/);
    setLang("en");
    expect(err("extrude 20 angle 25")).toMatch(/option “angle” does not belong here.*tilt 25/);
  });
  it("„k vrcholu“ šikmo = výška kolmo (rovina rovnoběžná se skicou); bez směru beze změny", () => {
    expect(ex("vysunout směr 1 0 1 k vrcholu V3")).toMatchObject({ normalHeight: true, extent: { kind: "toVertex" } });
    expect(ex("vysunout k vrcholu V3").normalHeight).toBeUndefined();
  });
  it("chybný řádek nespotřebuje číslo názvu (dřív Vysunutí 3 po dvou chybách)", () => {
    const p = parseAgentText("vysunout\nvysunout 5 sklon\nvysunout 5");
    expect(p.errors).toHaveLength(2);
    const f = p.ops.find((o) => o.k === "feature");
    expect(f?.k === "feature" && f.feature.name).toBe("Vysunutí 1");
    setLang("en");
    const q = parseAgentText("extrude 5\nextrude 5 tilt\nextrude 5");
    expect(q.ops.filter((o) => o.k === "feature").map((o) => (o.k === "feature" ? o.feature.name : ""))).toEqual(["Extrude 1", "Extrude 2"]);
  });
  it("stav: k rovině; tabulka příkazů: směr vždy se slovem směr, zaoblené rohy ve třech jazycích", () => {
    expect(featureSummary(ex('vysunout odebrat k rovině "Rovina 1"'))).toBe("k rovině „Rovina 1“, cut");
    const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith("vysunout"))!;
    for (const w of ["směr hrana E3", 'směr osa "Osa 1"', "směr plocha F2", "směr body V1 V2", "ostré rohy|zaoblené rohy"]) expect(row.cmd).toContain(w);
    for (const w of ["direction edge E3", "direction points V1 V2", "sharp corners|round corners"]) expect(row.en).toContain(w);
    for (const w of ["richtung kante E3", "richtung punkte V1 V2", "scharfe ecken|runde ecken"]) expect(row.de).toContain(w);
  });
  it("upravit draftCorners / draftLand / normalHeight: jen platné hodnoty (dřív „ostré“ tiše = zaoblené)", async () => {
    expect(extrudeFieldValue("draftCorners", "ostré", "draftCorners")).toBe("sharp");
    expect(extrudeFieldValue("draftCorners", "zaoblené", "draftCorners")).toBe("round");
    expect(extrudeFieldValue("draftCorners", "Sharp", "draftCorners")).toBe("sharp");
    expect(() => extrudeFieldValue("draftCorners", "hranaté", "draftCorners")).toThrow(/sharp.*round/);
    expect(() => extrudeFieldValue("draftLand", -1, "draftLand")).toThrow(/délku břitu/);
    expect(() => extrudeFieldValue("draftLand", "x", "draftLand")).toThrow(/délku břitu/);
    expect(() => extrudeFieldValue("normalHeight", 3, "normalHeight")).toThrow(/ano \/ ne/);
    const doc = { ...emptyDoc("T"), features: [{ id: "s", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [] }, { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "cut", draftAngle: -2, draftCorners: "round" }] as Feature[] };
    const cmd = (line: string) => {
      const p = parseAgentText(line);
      const op = p.ops[0];
      if (op?.k !== "edit") throw new Error(line);
      return op.cmd;
    };
    const res = await applyEdit(doc, cmd('upravit "Vysunutí 1" draftCorners=ostré'));
    expect((res.doc.features[1] as ExtrudeF).draftCorners).toBe("sharp");
    await expect(applyEdit(doc, cmd('upravit "Vysunutí 1" draftCorners=hranaté'))).rejects.toThrow(/sharp.*round/);
  });
});
