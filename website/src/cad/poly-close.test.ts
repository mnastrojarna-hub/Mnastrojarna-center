/**
 * Lomená čára z textu – kdy je uzavřená (poly-close.ts + parser v agent.ts + applySketchOp v agent-sketch.ts):
 * výslovné „uzavřít“ / „otevřená“ (CS/EN/DE) vždy platí, první = poslední bod → uzavřená, jinak rozhodne celá skica
 * (navázaná čára je otevřená, osamocená se uzavře a protokol to ohlásí), přehodnocení po dalších řádcích, obě cesty
 * (obyčejná čára i čára se zaoblenými rohy) se řídí stejnými pravidly. Případ z hlášení: profil z několika čar a oblouku.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText, parseEntities, parseEntity } from "./agent";
import { applySketchOp, sketchStatusLines } from "./agent-sketch";
import { applyEdit } from "./agent-edit";
import { setLang } from "./i18n";
import { addWithAutoClose, closeWordOf, closingCross, pathEntities, polylineClose, resolveAutoClose, takeCloseWords } from "./poly-close";
import { partingPolyline, partingProfile } from "./feat/draft-parting";
import { findLoops, loopPolygon, nestLoops, polygonArea } from "./sketch";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity } from "./types";

afterEach(() => setLang("cs"));
type SketchF = Extract<Feature, { type: "sketch" }>;
type Poly = Extract<SketchEntity, { type: "polyline" }>;

/** skici, entity, vazby a kóty programu nad dokumentem jako smyčka operací v cad-app.tsx (bez jádra) */
function run(text: string, doc: CadDoc = emptyDoc("Test")) {
  const p = parseAgentText(text);
  const log: string[] = p.errors.map((e) => `✗ řádek ${e.line}: ${e.message}`);
  for (const op of p.ops) {
    try {
      if (op.k === "feature") doc.features.push(op.feature);
      else if (op.k === "entities" || op.k === "constraints" || op.k === "dims") log.push(...applySketchOp(doc.features, op).map((x) => `${op.line}: ${x}`));
    } catch (e) {
      log.push(`✗ řádek ${op.line}: ${(e as Error).message}`);
    }
  }
  const sketches = doc.features.filter((f): f is SketchF => f.type === "sketch");
  return { doc, log, text: log.join("\n"), sk: sketches[sketches.length - 1] };
}
const poly = (sk: SketchF, id: string) => sk.entities.find((e) => e.id === id) as Poly;
/** plocha profilu (vnější obrysy − otvory) */
const area = (ents: SketchEntity[]) => nestLoops(findLoops(ents).loops).reduce((s, l) => s + (l.depth % 2 ? -1 : 1) * Math.abs(polygonArea(loopPolygon(l.loop))), 0);
/** L-profil s vnitřním zaoblením R10 (hlášení agenta): plocha 80·10 + 10·50 + (100 − 25π) = 1321,46 mm² */
const L_AREA = 800 + 500 + (100 - 25 * Math.PI);
const ARC = "oblouk 20 10 12,928932 12,928932 10 20";

describe("slova uzavřít / otevřená", () => {
  it("CS / EN / DE a kdekoli v zápisu", () => {
    for (const w of ["otevřená", "otevrena", "otevřený", "open", "offen", "OFFEN"]) expect(closeWordOf(w)).toBe("open");
    for (const w of ["uzavřít", "uzavrit", "uzavřená", "close", "closed", "schließen", "schliessen", "geschlossen"]) expect(closeWordOf(w)).toBe("closed");
    expect(closeWordOf("50")).toBeNull();
    expect(takeCloseWords(["čára", "otevřená", "0", "0", "10", "0", "10", "10"])).toEqual({ rest: ["čára", "0", "0", "10", "0", "10", "10"], close: "open" });
    expect(() => takeCloseWords(["0", "0", "uzavřít", "otevřená"])).toThrow(/zároveň/);
  });
  it("pravidla 1–2 na samotných bodech", () => {
    const P: [number, number][] = [[0, 0], [50, 0], [50, 30]];
    expect(polylineClose(P, null)).toEqual({ points: P, closed: true, autoClose: true }); // prozatím – rozhodne skica
    expect(polylineClose(P, "closed")).toEqual({ points: P, closed: true });
    expect(polylineClose(P, "open")).toEqual({ points: P, closed: false });
    expect(polylineClose([...P, [0, 0]], null)).toEqual({ points: P, closed: true }); // první = poslední bod
    expect(polylineClose([...P, [0, 0]], "open")).toEqual({ points: [...P, [0, 0]], closed: false });
    expect(polylineClose([[0, 0], [10, 0]], null)).toEqual({ points: [[0, 0], [10, 0]], closed: false });
  });
});

describe("parser – obě cesty se řídí stejnými pravidly", () => {
  it("čára bez zaoblení", () => {
    expect(parseEntity("čára 0 0 50 0 50 30".split(" "))).toMatchObject({ type: "polyline", closed: true, autoClose: true });
    expect(parseEntity("čára 0 0 50 0 50 30 uzavřít".split(" "))).not.toHaveProperty("autoClose");
    expect(parseEntity("čára 0 0 50 0 50 30 otevřená".split(" "))).toMatchObject({ closed: false });
    expect(parseEntity("čára otevřená 0 0 50 0 50 30".split(" "))).toMatchObject({ closed: false, points: [[0, 0], [50, 0], [50, 30]] });
    expect(parseEntity("polyline 0 0 50 0 50 30 open".split(" "))).toMatchObject({ closed: false });
    expect(parseEntity("polylinie 0 0 50 0 50 30 offen".split(" "))).toMatchObject({ closed: false });
    expect(parseEntity("linienzug 0 0 50 0 50 30 geschlossen".split(" "))).toMatchObject({ closed: true });
    const loop = parseEntity("čára 0 0 50 0 50 30 0 0".split(" ")) as Poly;
    expect(loop).toMatchObject({ closed: true, points: [[0, 0], [50, 0], [50, 30]] });
    expect(loop).not.toHaveProperty("autoClose");
    expect(parseEntity("čára 0 0 50 0".split(" "))).toMatchObject({ closed: false });
  });
  it("čára se zaoblenými rohy: bez slova prozatímní uzavírací úsečka, „otevřená“ / „uzavřít“ / první = poslední", () => {
    const auto = parseEntities("čára 0 0 50 0 r 5 50 30 0 30".split(" "));
    expect(auto.map((e) => e.type)).toEqual(["line", "arc", "line", "line", "line"]);
    expect(auto[4]).toMatchObject({ type: "line", a: [0, 30], b: [0, 0], autoClose: true });
    const open = parseEntities("čára 0 0 50 0 r 5 50 30 0 30 otevřená".split(" "));
    expect(open.map((e) => e.type)).toEqual(["line", "arc", "line", "line"]);
    expect(open.some((e) => e.autoClose)).toBe(false);
    const closed = parseEntities("čára 0 0 50 0 r 5 50 30 0 30 uzavřít".split(" "));
    expect(closed).toHaveLength(5);
    expect(closed.some((e) => e.autoClose)).toBe(false);
    expect(parseEntities("čára 0 0 50 0 r 5 50 30 0 30 0 0".split(" ")).some((e) => e.autoClose)).toBe(false);
    expect(parseEntities("polyline 0 0 50 0 r 5 50 30 0 30 open".split(" "))).toHaveLength(4);
    // krajní bod neuzavřené čáry zaoblit nelze (beze změny)
    expect(() => parseEntities("čára 0 0 r 2 10 0 10 10".split(" "))).toThrow(/krajní bod/);
  });
});

describe("rozhodnutí podle celé skici", () => {
  it("osamocená čára se uzavře (jako dřív) a protokol to ohlásí", () => {
    const r = run("skica XY: čára 0 0 50 0 50 30");
    expect(poly(r.sk, "e1")).toMatchObject({ closed: true, autoClose: true });
    expect(r.text).toContain("ℹ čára e1 uzavřena – konce nebyly napojené; „otevřená“ ji nechá otevřenou");
    expect(findLoops(r.sk.entities).loops).toHaveLength(1);
    expect(sketchStatusLines(r.sk).join("\n")).toMatch(/e1 čára 3 b\. .*↺ uzavřená automaticky/);
  });
  it("hlášení agenta: profil ze dvou čar a oblouku na jednom řádku → čáry otevřené, jeden obrys se správnou plochou", () => {
    const r = run(`skica XY: čára 0 0 80 0 80 10 20 10; ${ARC}; čára 10 20 10 60 0 60 0 0`);
    expect(poly(r.sk, "e1").closed).toBe(false);
    expect(poly(r.sk, "e3").closed).toBe(false);
    expect(r.sk.entities.some((e) => e.autoClose)).toBe(false);
    expect(r.text).toMatch(/ℹ čára e1 je otevřená – její konce navazují na e3, e2|ℹ čára e1 je otevřená – její konce navazují na e2, e3/);
    const { loops, openCount } = findLoops(r.sk.entities);
    expect(loops).toHaveLength(1);
    expect(openCount).toBe(0);
    expect(Math.abs(area(r.sk.entities) - L_AREA)).toBeLessThan(0.5); // oblouk jako mnohoúhelník (16 úseků)
    expect(sketchStatusLines(r.sk).join("\n")).toMatch(/profil: 1 uzavřený obrys \(e1–e3\) ✓/);
  });
  it("totéž po řádcích: první čára se nejdřív uzavře, obrys z dalších řádků ji znovu otevře (přehodnocení)", () => {
    const r = run(`skica XY\nčára 0 0 80 0 80 10 20 10\n${ARC}\nčára 10 20 10 60 0 60 0 0`);
    expect(r.text).toContain("2: ℹ čára e1 uzavřena – konce nebyly napojené");
    // oblouk navazuje jen na jeden konec – obrys zatím nevzniká, čára zůstane uzavřená (bez nového hlášení)
    expect(r.log.filter((l) => l.startsWith("3: ℹ"))).toEqual([]);
    expect(r.text).toContain("4: ℹ čára e1 otevřena – na její konce nově navazuje e3 (uzavřená byla jen automaticky)");
    expect(r.text).toMatch(/4: ℹ čára e3 je otevřená – její konce navazují na/);
    expect(poly(r.sk, "e1").closed).toBe(false);
    expect(poly(r.sk, "e3").closed).toBe(false);
    expect(findLoops(r.sk.entities).loops).toHaveLength(1);
    expect(Math.abs(area(r.sk.entities) - L_AREA)).toBeLessThan(0.5); // oblouk jako mnohoúhelník (16 úseků)
    // přehodnocení i z pozdějšího vstupu (další `run` nad týmž dokumentem → poslední skica)
    const r2 = run("skica XY: čára 0 0 40 0 40 20");
    expect(poly(r2.sk, "e1").closed).toBe(true);
    const r3 = run("úsečka 40 20 0 20\núsečka 0 20 0 0", r2.doc);
    expect(poly(r3.sk, "e1")).toMatchObject({ closed: false });
    expect(poly(r3.sk, "e1")).not.toHaveProperty("autoClose");
    expect(r3.text).toContain("2: ℹ čára e1 otevřena – na její konce nově navazuje e3");
    expect(findLoops(r3.sk.entities).loops).toHaveLength(1);
    expect(area(r3.sk.entities)).toBeCloseTo(800, 6);
  });
  it("výslovné slovo vždy vyhraje nad rozhodnutím skici", () => {
    const r = run("skica XY: čára 0 0 80 0 80 10 20 10 uzavřít; úsečka 20 10 0 0");
    expect(poly(r.sk, "e1")).toMatchObject({ closed: true });
    expect(poly(r.sk, "e1")).not.toHaveProperty("autoClose");
    const o = run("skica XY: čára 0 0 50 0 50 30 otevřená");
    expect(poly(o.sk, "e1").closed).toBe(false);
    expect(o.text).not.toContain("ℹ");
  });
  it("čára se zaoblenými rohy: osamocená se uzavře úsečkou, navázaná zůstane otevřená, pozdější napojení úsečku odebere", () => {
    const lone = run("skica XY: čára 0 0 60 0 r 8 60 40 r 8 0 40");
    expect(lone.sk.entities.filter((e) => e.autoClose)).toHaveLength(1);
    expect(lone.text).toMatch(/ℹ čára se zaoblenými rohy uzavřena úsečkou e6/);
    expect(sketchStatusLines(lone.sk).join("\n")).toContain("e6 úsečka [0; 40]→[0; 0] (uzavírá čáru se zaoblenými rohy – automaticky)");
    expect(findLoops(lone.sk.entities).loops).toHaveLength(1);
    const joined = run("skica XY: čára 0 0 60 0 r 8 60 40 r 8 0 40; úsečka 0 40 0 0");
    expect(joined.sk.entities.some((e) => e.autoClose)).toBe(false);
    expect(joined.sk.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e7"]);
    expect(joined.text).toMatch(/ℹ čára se zaoblenými rohy je otevřená – její konec \[0; 40\] navazuje na další entitu/);
    expect(findLoops(joined.sk.entities).loops).toHaveLength(1);
    // pozdější řádek: na konec automaticky uzavřené zaoblené čáry naváže úsečka → uzavírací úsečka e6 se odebere
    const later = run("úsečka 0 40 -20 40\núsečka -20 40 -20 0\núsečka -20 0 0 0", lone.doc);
    expect(later.log.filter((l) => /^[12]: ℹ/.test(l))).toEqual([]); // e7, e8 obrys ještě neuzavřou
    expect(later.text).toContain("3: ℹ uzavírací úsečka e6 čáry se zaoblenými rohy odebrána – na konec [0; 0] nově navazuje e9");
    expect(later.sk.entities.some((e) => e.id === "e6")).toBe(false);
    expect(findLoops(later.sk.entities).loops).toHaveLength(1);
    expect(Math.abs(area(later.sk.entities) - (60 * 40 - 2 * (64 - 16 * Math.PI) + 20 * 40))).toBeLessThan(0.5);
  });
  it("pomocné entity rozhodují jen mezi sebou; GUI entity bez značky se nemění", () => {
    const r = run("skica XY: čára 0 0 50 0 50 30; pomocná úsečka 50 30 0 0");
    expect(poly(r.sk, "e1").closed).toBe(true); // pomocná úsečka na konci profil neotevře
    const gui: SketchEntity[] = [
      { id: "p", type: "polyline", points: [[0, 0], [50, 0], [50, 30]], closed: true },
      { id: "l", type: "line", a: [50, 30], b: [0, 30] },
    ];
    expect(resolveAutoClose(gui).entities).toEqual(gui);
  });
  it("blízký konec (do 0,05 mm) je napojení – čára zůstane otevřená a mezeru ohlásí kontrola profilu", () => {
    const r = run("skica XY: čára 0 0 80 0 80 10 20 10; úsečka 20,02 10 0 0");
    expect(poly(r.sk, "e1").closed).toBe(false);
    expect(sketchStatusLines(r.sk).join("\n")).toMatch(/mezera 0,02 mm mezi e1 \[20; 10\] a e2 \[20,02; 10\]/);
  });
  it("otevření automaticky uzavřené čáry odebere vazby na její uzavírací úsek g2", () => {
    const sk = { entities: [{ id: "e1", type: "polyline", points: [[0, 0], [50, 0], [50, 30]], closed: true, autoClose: true }] as SketchEntity[], constraints: [{ id: "c1", type: "horizontal", refs: [{ e: "e1", k: "g0" }] }, { id: "c2", type: "vertical", refs: [{ e: "e1", k: "g2" }] }] as SketchF["constraints"] };
    const m = addWithAutoClose(sk, [{ id: "e2", type: "line", a: [50, 30], b: [0, 0] }]);
    expect(m.patch.constraints?.map((c) => c.id)).toEqual(["c1"]);
    expect(m.notes.join("\n")).toContain("odebráno vazeb 1 a kót 0");
  });
  it("„entita e1 uzavřená=ne“ rozhodne natrvalo (značka zmizí)", async () => {
    const r = run("skica XY: čára 0 0 50 0 50 30");
    const op = parseAgentText("entita e1 uzavřená=ne").ops[0];
    if (op?.k !== "edit") throw new Error(`entita: ${op?.k}`);
    const res = await applyEdit(r.doc, op.cmd, {});
    const sk = res.doc.features.find((f) => f.type === "sketch") as SketchF;
    expect(sk.entities[0]).toMatchObject({ closed: false });
    expect(sk.entities[0]).not.toHaveProperty("autoClose");
    // další navázaná entita už nic nemění
    const r2 = run("úsečka 0 0 -10 0", res.doc);
    expect(r2.text).not.toContain("ℹ");
  });
  it("anglicky a německy: zprávy protokolu", () => {
    setLang("en");
    const r = run("sketch XY: polyline 0 0 50 0 50 30");
    expect(r.text).toMatch(/ℹ polyline e1 closed – its ends were not joined; “open” keeps it open/);
    setLang("de");
    const d = run("skizze XY: polylinie 0 0 80 0 80 10 20 10; bogen 20 10 12,928932 12,928932 10 20; polylinie 10 20 10 60 0 60 0 0");
    expect(d.text).toMatch(/ℹ Polylinie e1 ist offen/);
    setLang("en");
    const e = run("sketch XY: polyline 0 10 30 10 30 20 60 20");
    expect(e.text).toMatch(/ℹ polyline e1 is open – the closing segment would cross or overlap it at \[30; 15\]/);
  });
});

describe("více automaticky uzavřených tvarů najednou", () => {
  it("dvě zaoblené čáry, které na sebe navazují, se obě otevřou a dají jeden obrys; seznam navázaných bez odebraných úseček", () => {
    const r = run("skica XY: čára 0 0 60 0 r 5 60 40; čára 60 40 0 40 r 5 0 0");
    expect(r.sk.entities.some((e) => e.autoClose)).toBe(false);
    expect(findLoops(r.sk.entities).loops).toHaveLength(1);
    expect(findLoops(r.sk.entities).openCount).toBe(0);
    const p = run("skica XY: čára 0 0 60 0 r 5 60 40; čára 60 40 0 40 0 0");
    const pl = p.sk.entities.find((e) => e.type === "polyline") as Poly;
    expect(pl.closed).toBe(false);
    expect(p.sk.entities.some((e) => e.id === "e4")).toBe(false); // uzavírací úsečka první čáry se odebrala
    const note = p.log.find((l) => /ℹ čára e5 je otevřená/.test(l)) ?? "";
    expect(note).toMatch(/navazují na (e1, e3|e3, e1)$/); // bez odebrané úsečky e4
    expect(findLoops(p.sk.entities).loops).toHaveLength(1);
  });
});

describe("oprava po revizi: obrys z více entit, dráhy, GUI, křížení uzavíracího úseku", () => {
  it("lopatky z jednoho bodu: čára navázaná jen jedním koncem se uzavře (jako dřív) – 3 obrysy", () => {
    const r = run("skica XY: čára 0 0 40 5 40 -5; čára 0 0 -40 5 -40 -5; čára 0 0 5 40 -5 40");
    for (const id of ["e1", "e2", "e3"]) expect(poly(r.sk, id)).toMatchObject({ closed: true, autoClose: true });
    expect(r.text).toContain("ℹ čára e1 uzavřena – navazuje na e2, e3, ale uzavřený obrys s nimi netvoří; „otevřená“ ji nechá otevřenou");
    expect(findLoops(r.sk.entities).loops).toHaveLength(3);
  });
  it("T: čára s úsečkami na obou koncích, které obrys neuzavírají, zůstane uzavřená; uzavřou-li ho, otevře se", () => {
    const t = run("skica XY: čára 0 0 50 0 50 30; úsečka 0 0 -20 0; úsečka 50 30 70 30");
    expect(poly(t.sk, "e1").closed).toBe(true);
    const c = run("úsečka -20 0 -20 30\núsečka -20 30 70 30", t.doc);
    expect(poly(c.sk, "e1").closed).toBe(false);
    expect(c.text).toContain("2: ℹ čára e1 otevřena – na její konce nově navazuje");
  });
  it("uzavírací úsek by čáru křížil nebo překrýval → čára zůstane otevřená (dělicí čára z návodu bez ⚠)", () => {
    expect(closingCross([[0, 10], [30, 10], [30, 20], [60, 20]])).toEqual([30, 15]);
    expect(closingCross([[0, 0], [50, 0], [100, 0]])).not.toBeNull(); // body na přímce – nulová plocha
    expect(closingCross([[0, 0], [50, 0], [50, 30]])).toBeNull();
    const r = run("skica XZ: čára 0 10 30 10 30 20 60 20");
    expect(poly(r.sk, "e1")).toMatchObject({ closed: false });
    expect(poly(r.sk, "e1")).not.toHaveProperty("autoClose");
    expect(r.text).toContain("ℹ čára e1 je otevřená – uzavírací úsek by ji křížil nebo překrýval v [30; 15] (neplatný obrys); „uzavřít“ ji uzavře");
    const st = sketchStatusLines(r.sk).join("\n");
    expect(st).toContain("profil: žádný uzavřený obrys – otevřená křivka e1");
    expect(st).not.toContain("⚠");
    // totéž u čáry se zaoblenými rohy: uzavírací úsečka se vynechá
    const f = run("skica XZ: čára 0 10 30 10 r 3 30 20 60 20");
    expect(f.sk.entities.some((e) => e.autoClose)).toBe(false);
    expect(f.text).toMatch(/ℹ čára se zaoblenými rohy je otevřená – uzavírací úsečka by ji křížila nebo překrývala v \[/);
  });
  it("osamocená čára jako DRÁHA: automatické uzavření se nepoužije (pathEntities; dělicí čára se zaoblením projde)", () => {
    const f = run("skica XZ: čára 0 0 0 50 r 10 50 50");
    expect(f.sk.entities.filter((e) => e.autoClose)).toHaveLength(1); // jako profil uzavřená úsečkou
    expect(pathEntities(f.sk.entities).map((e) => e.type)).toEqual(["line", "arc", "line"]);
    const p = run("skica XY: čára 0 0 0 50 50 50");
    expect(pathEntities(p.sk.entities)).toEqual([{ ...p.sk.entities[0], closed: false }]);
    expect(pathEntities(p.sk.entities)[0]).toHaveProperty("autoClose", true); // značka zůstane – jen pohled dráhy
    const plain: SketchEntity[] = [{ id: "x", type: "polyline", points: [[0, 0], [1, 0], [1, 1]], closed: true }];
    expect(pathEntities(plain)).toBe(plain);
    // dělicí čára se zaobleným rohem (uzavírací úsečka čáru nekříží → jako profil uzavřená); dřív „vrací se“
    const g = run("skica XZ: čára 0 10 30 10 r 5 60 30");
    expect(g.sk.entities.some((e) => e.autoClose)).toBe(true);
    const pl = partingPolyline(g.sk);
    expect(pl.pts[0]).toEqual([0, 10]);
    expect(pl.pts[pl.pts.length - 1]).toEqual([60, 30]);
    expect(() => partingProfile(pl.pts, -5, 65, 1e-3)).not.toThrow();
  });
  it("GUI: odškrtnutá „Uzavřená“ (closed=false se značkou) – pozdější textový řádek čáru znovu neuzavře", () => {
    const r = run("skica XY: čára 0 0 60 0 60 40");
    const sk = r.sk;
    sk.entities[0] = { ...sk.entities[0], closed: false } as SketchEntity; // jako props.tsx starší verze (značka zůstala)
    const r2 = run("kružnice 5 v 100 100", r.doc);
    expect(poly(r2.sk, "e1")).toMatchObject({ closed: false });
    expect(poly(r2.sk, "e1")).not.toHaveProperty("autoClose");
    expect(r2.text).not.toContain("ℹ");
    expect(sketchStatusLines(r2.sk).join("\n")).toMatch(/e1 čára 3 b\. .* otevřená/);
    // resolveAutoClose přímo: značka u otevřené čáry zmizí, nic se nehlásí
    const m = resolveAutoClose([{ id: "p", type: "polyline", points: [[0, 0], [5, 0], [5, 5]], closed: false, autoClose: true }], new Set(["p"]));
    expect(m.entities).toEqual([{ id: "p", type: "polyline", points: [[0, 0], [5, 0], [5, 5]], closed: false }]);
    expect(m.notes).toEqual([]);
  });
  it("hlášení s výslovně uzavřenou čárou: oprava „entita e1 uzavřená=ne“ znovu posoudí e3 → jeden obrys", async () => {
    const r = run(`skica XY\nčára 0 0 80 0 80 10 20 10 uzavřít\n${ARC}\nčára 10 20 10 60 0 60 0 0`);
    expect(poly(r.sk, "e3")).toMatchObject({ closed: true, autoClose: true }); // navazuje jen na oblouk – obrys z více entit nevzniká
    const op = parseAgentText("entita e1 uzavřená=ne").ops[0];
    if (op?.k !== "edit") throw new Error(`entita: ${op?.k}`);
    const res = await applyEdit(r.doc, op.cmd, {});
    const sk = res.doc.features.find((f) => f.type === "sketch") as SketchF;
    expect(poly(sk, "e1").closed).toBe(false);
    expect(poly(sk, "e3")).toMatchObject({ closed: false });
    expect(poly(sk, "e3")).not.toHaveProperty("autoClose");
    expect(res.log.join("\n")).toMatch(/ℹ čára e3 otevřena – na její konce nově navazuje (e2, e1|e1, e2)/);
    expect(findLoops(sk.entities).loops).toHaveLength(1);
    expect(Math.abs(area(sk.entities) - L_AREA)).toBeLessThan(0.5);
  });
  it("velká skica bez automaticky uzavřených čar se neprochází (stejné pole)", () => {
    const ents: SketchEntity[] = Array.from({ length: 5000 }, (_, i) => ({ id: `e${i + 1}`, type: "line", a: [i, 0], b: [i + 1, 0] }));
    expect(resolveAutoClose(ents).entities).toBe(ents);
  });
});
