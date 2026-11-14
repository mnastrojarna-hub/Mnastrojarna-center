/**
 * Kontrola profilu skici (profile-check.ts): proč z entit nevznikl platný obrys – otevřený konec, mezera, křížení,
 * křížení sebe sama, překryv, duplicita, větvení, konec uprostřed jiné entity, automaticky uzavřená čára přes jiné entity;
 * řádky stavu a důvod pro prvek vysunutí / rotace.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { applySketchOp } from "./agent-sketch";
import { setLang } from "./i18n";
import { checkProfile, issueText, MAX_COUNT, profileNote, profileStatusLines, type ProfileIssue } from "./profile-check";
import { emptyDoc, type Feature, type SketchEntity } from "./types";

afterEach(() => setLang("cs"));
type SketchF = Extract<Feature, { type: "sketch" }>;

/** entity skici z textu (stejně jako konzole: id e1, e2…, uzavření lomených čar podle celé skici) */
function sketch(text: string): SketchF {
  const doc = emptyDoc("T");
  for (const op of parseAgentText(text).ops) {
    if (op.k === "feature") doc.features.push(op.feature);
    else if (op.k === "entities") applySketchOp(doc.features, op);
  }
  return doc.features.find((f) => f.type === "sketch") as SketchF;
}
const kinds = (ents: SketchEntity[]) => checkProfile(ents).issues.map((i) => i.kind);
const texts = (ents: SketchEntity[]) => checkProfile(ents).issues.map(issueText);
const find = <K extends ProfileIssue["kind"]>(ents: SketchEntity[], k: K) => checkProfile(ents).issues.find((i) => i.kind === k) as Extract<ProfileIssue, { kind: K }> | undefined;

const RECT_LINES = "skica XY\núsečka 0 0 60 0\núsečka 60 0 60 40\núsečka 60 40 0 40\núsečka 0 40 0 0";

describe("platné profily", () => {
  it("obdélník z úseček, kružnice v obdélníku, profil z čar a oblouku → bez problémů", () => {
    const a = sketch(RECT_LINES);
    expect(checkProfile(a.entities)).toMatchObject({ curves: 4, loops: [{ ids: ["e1", "e2", "e3", "e4"] }], openIds: [], issues: [] });
    expect(profileStatusLines(a.entities)).toEqual(["    profil: 1 uzavřený obrys (e1–e4) ✓"]);
    const b = sketch("skica XY: obdélník 60 40; kružnice 10");
    expect(checkProfile(b.entities).loops.map((l) => l.ids)).toEqual([["e1"], ["e2"]]);
    expect(profileStatusLines(b.entities)[0]).toMatch(/profil: 2 uzavřené obrysy \(e1; e2\) ✓/);
    const c = sketch("skica XY: čára 0 0 80 0 80 10 20 10; oblouk 20 10 12,928932 12,928932 10 20; čára 10 20 10 60 0 60 0 0");
    expect(kinds(c.entities)).toEqual([]);
  });
  it("otevřená křivka bez obrysů (dráha, dělicí čára) → informace, ne problém", () => {
    const s = sketch("skica XZ: čára 0 10 30 10 30 20 60 20 otevřená");
    expect(profileStatusLines(s.entities)).toEqual(["    profil: žádný uzavřený obrys – otevřená křivka e1 (konce [0; 10] a [60; 20]); k vysunutí ji uzavřete, jako dráha nebo dělicí čára je v pořádku"]);
    expect(profileStatusLines(sketch("skica XY: bod 3 4").entities)).toEqual([]);
  });
});

describe("vadné profily – důvod s id entit a souřadnicemi", () => {
  it("1. otevřený konec (U z úseček)", () => {
    const s = sketch("skica XY\núsečka 0 40 0 0\núsečka 0 0 60 0\núsečka 60 0 60 40");
    expect(kinds(s.entities)).toEqual(["open", "open"]);
    expect(texts(s.entities)).toEqual(expect.arrayContaining(["otevřený konec e1 v [0; 40]", "otevřený konec e3 v [60; 40]"]));
    expect(checkProfile(s.entities).openIds).toEqual(["e1", "e2", "e3"]);
  });
  it("2. mezera mezi konci (roh posunutý o 0,5 mm)", () => {
    const s = sketch("skica XY\núsečka 0 0 60 0\núsečka 60 0 60 40\núsečka 60 40 0 40\núsečka -0,3 40,4 0 0");
    const g = find(s.entities, "gap")!;
    expect(g).toMatchObject({ a: "e3", b: "e4" });
    expect(g.dist).toBeCloseTo(0.5, 9);
    expect(issueText(g)).toBe("mezera 0,5 mm mezi e3 [0; 40] a e4 [-0,3; 40,4]");
    expect(kinds(s.entities)).toEqual(["gap"]);
    // přetažený konec: e3 končí na e4 (dotyk) a zároveň mezera mezi konci
    const over = sketch("skica XY\núsečka 0 0 60 0\núsečka 60 0 60 40\núsečka 60 40 0 40\núsečka 0 40,5 0 0");
    expect(kinds(over.entities).sort()).toEqual(["gap", "touch"]);
  });
  it("3. překrývající se obrysy: dva obdélníky se kříží", () => {
    const s = sketch("skica XY: obdélník 40 20; obdélník 20 40");
    const x = checkProfile(s.entities).issues.filter((i) => i.kind === "cross");
    expect(x.length).toBe(1); // jednou za dvojici entit
    expect(issueText(x[0])).toMatch(/^e1 kříží e2 v \[-?10; -10\]|^e1 kříží e2 v \[/);
  });
  it("4. čára křížící sama sebe (motýlek)", () => {
    const s = sketch("skica XY: čára 0 0 40 40 40 0 0 40 uzavřít");
    expect(find(s.entities, "self")).toMatchObject({ id: "e1", at: [20, 20] });
    expect(texts(s.entities)).toContain("e1 kříží sama sebe v [20; 20]");
  });
  it("5. duplicitní entita (úsečka zadaná dvakrát, i obráceně)", () => {
    const s = sketch(`${RECT_LINES}\núsečka 60 0 0 0`);
    expect(find(s.entities, "duplicate")).toMatchObject({ a: "e1", b: "e5" });
    expect(kinds(s.entities)).not.toContain("overlap");
    expect(kinds(s.entities)).toContain("branch"); // v [0; 0] a [60; 0] se stýkají 3 konce
  });
  it("6. překryv: kolineární úsečky přes sebe", () => {
    const s = sketch(`${RECT_LINES}\núsečka 10 0 30 0`);
    const o = find(s.entities, "overlap")!;
    expect(o).toMatchObject({ a: "e1", b: "e5", from: [10, 0], to: [30, 0] });
    expect(issueText(o)).toBe("e1 a e5 se překrývají v úseku [10; 0]–[30; 0]");
  });
  it("7. větvení: tři konce v jednom bodě", () => {
    const s = sketch(`${RECT_LINES}\núsečka 0 0 -20 -20`);
    const b = find(s.entities, "branch")!;
    expect(b.ids.sort()).toEqual(["e1", "e4", "e5"]);
    expect(issueText(b)).toMatch(/v bodě \[0; 0\] se stýká 3 konců \(e\d, e\d, e\d\) – obrys je nejednoznačný/);
  });
  it("8. konec uprostřed jiné entity (T)", () => {
    const s = sketch(`${RECT_LINES}\núsečka 30 0 30 40`);
    const t = checkProfile(s.entities).issues.filter((i) => i.kind === "touch");
    expect(t.map((i) => (i as { a: string }).a)).toEqual(["e5", "e5"]);
    expect(issueText(t[0])).toMatch(/^e5 se dotýká e[13] v \[30; (0|40)\] – napojení musí být konec na konec$/);
  });
  it("9. automaticky uzavřená čára, jejíž uzavírací úsek kříží jinou entitu", () => {
    const s = sketch("skica XY: čára 0 0 50 0 50 30; úsečka 10 20 40 0");
    const a = find(s.entities, "autoClosed")!;
    expect(a).toMatchObject({ id: "e1", other: "e2" });
    expect(issueText(a)).toMatch(/^e1 byla uzavřena automaticky a její uzavírací úsek kříží e2 v \[[\d,]+; [\d,]+\] – napište „otevřená“ nebo napojte konce$/);
    // úsečka kříží i úsek g0? ne – [40; 0] leží na g0 = konec e2 uprostřed e1 → dotyk
    expect(kinds(s.entities)).toContain("touch");
  });
  it("10. hlášení agenta (stav před opravou): dvě automaticky uzavřené čáry + oblouk → otevřený oblouk", () => {
    // dřívější chování: čáry se 3+ body se uzavřely vždy
    const ents: SketchEntity[] = [
      { id: "e1", type: "polyline", points: [[0, 0], [80, 0], [80, 10], [20, 10]], closed: true },
      { id: "e2", type: "arc", a: [20, 10], b: [12.928932, 12.928932], c: [10, 20] },
      { id: "e3", type: "polyline", points: [[10, 20], [10, 60], [0, 60], [0, 0]], closed: true },
    ];
    const r = checkProfile(ents);
    expect(r.loops).toHaveLength(2);
    expect(r.openIds).toEqual(["e2"]);
    // konce oblouku leží v krajních bodech uzavřených čar → řekne se, že oblouk do obrysu nepatří a co s čarou udělat
    expect(texts(ents)).toEqual(
      expect.arrayContaining([
        "otevřený konec e2 v [20; 10] leží na obrysu e1 – e2 do žádného obrysu nepatří; e1 je uzavřená čára – má-li být částí obrysu s e2, napište u ní „otevřená“",
        "otevřený konec e2 v [10; 20] leží na obrysu e3 – e2 do žádného obrysu nepatří; e3 je uzavřená čára – má-li být částí obrysu s e2, napište u ní „otevřená“",
      ]),
    );
    // … a to i když vysunutí projde (dřív tichý úspěch se dvěma tělesy)
    const sk = { id: "s", name: "Skica 1", type: "sketch", plane: "XY", entities: ents } as unknown as SketchF;
    const ex = { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new" } as Feature;
    expect(profileNote(ex, new Map([["s", sk]]), false)).toMatch(/^Profil skici „Skica 1“: otevřený konec e2 v \[(20; 10|10; 20)\] leží na obrysu e[13]/);
  });
});

describe("stav a důvod u prvku", () => {
  it("řádky stavu: souhrn, každý problém zvlášť (nezačínají ✗ / ⚠)", () => {
    const s = sketch("skica XY\núsečka 0 0 60 0\núsečka 60 0 60 40\núsečka 60 40 0 40\núsečka -0,3 40,4 0 0");
    const lines = profileStatusLines(s.entities);
    expect(lines[0]).toBe("    profil: žádný uzavřený obrys · ⚠ problémů 1:");
    expect(lines[1]).toBe("      · mezera 0,5 mm mezi e3 [0; 40] a e4 [-0,3; 40,4]");
    expect(lines.every((l) => !/^(✗|⚠)/.test(l.trim()))).toBe(true);
  });
  it("vysunutí: při chybě i otevřené konce, při úspěchu jen vady; bez skici nic", () => {
    const open = sketch("skica XY\núsečka 0 40 0 0\núsečka 0 0 60 0\núsečka 60 0 60 40");
    const ex = { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: open.id, distance: 10, symmetric: false, reverse: false, mode: "new" } as Feature;
    const map = new Map([[open.id, open]]);
    expect(profileNote(ex, map, true)).toBe("Profil skici „Skica 1“: otevřený konec e1 v [0; 40]; otevřený konec e3 v [60; 40].");
    expect(profileNote(ex, map, false)).toBe("");
    expect(profileNote({ ...ex, thin: { side: "one", t1: 2 } } as Feature, map, true)).toBe("");
    const cross = sketch("skica XY: obdélník 40 20; obdélník 20 40");
    expect(profileNote({ ...ex, sketchId: cross.id } as Feature, new Map([[cross.id, cross]]), false)).toMatch(/^Profil skici „Skica 1“: e1 kříží e2 v \[/);
    expect(profileNote({ ...ex, sketchId: "jiná" } as Feature, map, true)).toBe("");
    // úsečka přes kružnici, která v žádném obrysu není: výsledek nemění → bez ⚠ (ve stavu se ale vypíše)
    const axis = sketch("skica XY: kružnice 40; úsečka -30 0 30 0");
    expect(profileNote({ ...ex, sketchId: axis.id } as Feature, new Map([[axis.id, axis]]), false)).toBe("");
    expect(profileStatusLines(axis.entities).join("\n")).toMatch(/· e2 kříží e1 v \[-?20; 0\]|· e1 kříží e2 v \[-?20; 0\]/);
    const rv = { id: "r", name: "Rotace 1", type: "revolve", sketchId: open.id, angle: 360, axis: "y", mode: "new" } as Feature;
    expect(profileNote(rv, map, true)).toMatch(/^Profil skici „Skica 1“: otevřený konec e1/);
  });
  it("velká skica: průsečíky se nekontrolují, souhrn ano", () => {
    const ents: SketchEntity[] = Array.from({ length: 4100 }, (_, i) => ({ id: `e${i + 1}`, type: "line", a: [i, 0], b: [i + 1, 0] }));
    const r = checkProfile(ents);
    expect(r.truncated).toBe(true);
    expect(profileStatusLines(ents)[0]).toMatch(/průsečíky nekontrolovány – víc než 4000 úseků/);
  });
  it("anglicky", () => {
    setLang("en");
    const s = sketch("sketch XY\nline 0 40 0 0\nline 0 0 60 0\nline 60 0 60 40");
    expect(texts(s.entities)).toContain("open end of e1 at [0; 40]");
  });
});

describe("oprava po revizi: tichý úspěch, velké skici, výkon, délka stavu", () => {
  it("hlášení agenta s výslovně uzavřenou čárou: vysunutí projde, ale ⚠ řekne, že e2 a e3 do obrysu nepatří", () => {
    const s = sketch("skica XY\nčára 0 0 80 0 80 10 20 10 uzavřít\noblouk 20 10 12,928932 12,928932 10 20\nčára 10 20 10 60 0 60 0 0");
    const r = checkProfile(s.entities);
    // e1 je uzavřená výslovně, e3 navazuje jen na oblouk (obrys z více entit nevzniká) → uzavře se automaticky: 2 obrysy
    expect(r.loops.map((l) => l.ids)).toEqual([["e1"], ["e3"]]);
    const ex = { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: s.id, distance: 10, symmetric: false, reverse: false, mode: "new" } as Feature;
    const n = profileNote(ex, new Map([[s.id, s]]), false);
    expect(n).toContain("leží na obrysu e1");
    expect(n).toContain("e1 je uzavřená čára – má-li být částí obrysu s e2, napište u ní „otevřená“");
  });
  it("osamocená úsečka mimo obrys (např. osa) ⚠ nedostane; úsečka s koncem na obrysu ano", () => {
    const far = sketch("skica XY: obdélník 40 20; úsečka -30 30 30 30");
    const ex = (sk: SketchF) => profileNote({ id: "x", name: "Vysunutí 1", type: "extrude", sketchId: sk.id, distance: 5, symmetric: false, reverse: false, mode: "new" } as Feature, new Map([[sk.id, sk]]), false);
    expect(ex(far)).toBe("");
    const on = sketch("skica XY: obdélník 40 20; úsečka 20 10 40 30");
    expect(ex(on)).toBe("Profil skici „Skica 1“: otevřený konec e2 v [20; 10] leží na obrysu e1 – e2 do žádného obrysu nepatří.");
  });
  it("automatický uzavírací úsek kříží samu čáru → hlášení o automatickém uzavření (ne obecné „kříží sama sebe“)", () => {
    const ents: SketchEntity[] = [{ id: "e1", type: "polyline", points: [[0, 10], [30, 10], [30, 20], [60, 20]], closed: true, autoClose: true }];
    expect(texts(ents)).toEqual(["e1 byla uzavřena automaticky a její uzavírací úsek kříží samu čáru v [30; 15] – jako profil neplatná; napište „otevřená“ (dráha, dělicí čára) nebo napojte konce"]);
    // bez značky (autor ji uzavřel) zůstane obecné hlášení
    expect(texts([{ ...ents[0], autoClose: undefined } as SketchEntity])).toEqual(["e1 kříží sama sebe v [30; 15]"]);
  });
  it("velká skica (70 000 bodů; štítek s 300 uzavřenými spliny) – žádné přetečení zásobníku; chyba kontroly nikdy neshodí stav ani stavbu", () => {
    const pts: [number, number][] = Array.from({ length: 70000 }, (_, i) => [Math.cos((i / 70000) * 2 * Math.PI) * 100, Math.sin((i / 70000) * 2 * Math.PI) * 100]);
    const big: SketchEntity[] = [{ id: "e1", type: "polyline", points: pts, closed: true }];
    expect(() => checkProfile(big)).not.toThrow();
    expect(profileStatusLines(big)[0]).toMatch(/profil: 1 uzavřený obrys \(e1\)/);
    // obdélník 1300 × 360 a 300 uzavřených splinů po 30 bodech (16 úseků na rozpětí → 144 000 úseků, 288 000 konců)
    const plate: SketchEntity[] = [{ id: "e1", type: "rect", cx: 600, cy: 150, w: 1300, h: 360, r: 0, angle: 0 }];
    for (let k = 0; k < 300; k++) {
      const cx = (k % 30) * 40;
      const cy = Math.floor(k / 30) * 30;
      plate.push({ id: `e${k + 2}`, type: "spline", closed: true, points: Array.from({ length: 30 }, (_, i): [number, number] => [cx + Math.cos((i / 30) * 2 * Math.PI) * 8, cy + Math.sin((i / 30) * 2 * Math.PI) * (10 + (i % 2))]) });
    }
    expect(profileStatusLines(plate)[0]).toMatch(/profil: 301 uzavřených obrysů .*\(průsečíky nekontrolovány/);
    // poškozená entita: kontrola selže uvnitř, ale stav i důvod u prvku vrátí prázdno místo výjimky
    const bad = [{ id: "e1", type: "polyline", points: null, closed: true }] as unknown as SketchEntity[];
    expect(() => checkProfile(bad)).toThrow();
    expect(profileStatusLines(bad)).toEqual([]);
    const sk = { id: "s", name: "Skica 1", type: "sketch", plane: "XY", entities: bad } as unknown as SketchF;
    const ex = { id: "x", name: "Vysunutí 1", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new" } as Feature;
    expect(profileNote(ex, new Map([["s", sk]]), true)).toBe("");
  });
  it("mřížka 1000 × 1000 křížících se čar: počítání se zastaví na MAX_COUNT (dřív ~2 s a milion průsečíků)", () => {
    const ents: SketchEntity[] = [];
    let id = 1;
    for (let i = 0; i < 1000; i++) ents.push({ id: `e${id++}`, type: "line", a: [0, i], b: [1000, i] });
    for (let i = 0; i < 1000; i++) ents.push({ id: `e${id++}`, type: "line", a: [i + 0.5, -1], b: [i + 0.5, 1000] });
    const t0 = performance.now();
    const r = checkProfile(ents);
    const ms = performance.now() - t0;
    expect(r.total).toBe(MAX_COUNT);
    expect(r.capped).toBe(true);
    expect(ms).toBeLessThan(1500);
    expect(profileStatusLines(ents)[0]).toContain(`⚠ problémů ${MAX_COUNT}+:`);
    // opakovaná kontrola téže skici (každý přepočet stavby) se bere z mezipaměti
    const t1 = performance.now();
    expect(checkProfile(ents.map((e) => ({ ...e })))).toBe(r);
    expect(performance.now() - t1).toBeLessThan(ms + 50);
  });
  it("řádek profil: ve stavu má omezenou délku (obdélník + 500 kružnic)", () => {
    const ents: SketchEntity[] = [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 2000, h: 2000, r: 0, angle: 0 }];
    for (let i = 0; i < 500; i++) ents.push({ id: `e${i + 2}`, type: "circle", cx: -900 + (i % 25) * 70, cy: -900 + Math.floor(i / 25) * 70, r: 10 });
    const line = profileStatusLines(ents)[0];
    expect(line).toMatch(/^ {4}profil: 501 uzavřených obrysů \(e1; e2; .*; … \+489\) ✓$/);
    expect(line.length).toBeLessThan(200);
  });
});
