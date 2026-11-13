/** Textové příkazy výkresu: výkres …, kótovat …, výkres tolerance / poznámka / nepředepsané / hrany / drsnost / stav (cs, en, de). */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { parseDimension, parseDrawing, VOLBY } from "./agent-drawing";
import { setLang } from "./i18n";

const cmd = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  return op.k === "drawingCmd" ? op.cmd : op;
};
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

afterEach(() => setLang("cs"));

describe("výkres – volby listu (tabulka voleb)", () => {
  it("česky: formát, orientace, měřítko, pohledy, řez, skryté, osy, tabulka děr, promítání", () => {
    const c = cmd("výkres A3 na šířku měřítko 1:2 pohledy přední,horní,iso řez XZ odsazení 5 skryté ne osy ano tabulka děr ano promítání A");
    expect(c).toMatchObject({
      k: "set",
      opts: { sheet: "A3", orientation: "landscape", scale: 0.5, views: { front: true, top: true, iso: true, left: false, right: false, back: false, bottom: false }, section: { plane: "XZ", offset: 5 }, hidden: false, centerLines: true, holeTable: true, projection: "A" },
    });
  });
  it("anglicky a německy", () => {
    expect(cmd("drawing A2 portrait scale 2:1 views front,left section YZ hidden no")).toMatchObject({ k: "set", opts: { sheet: "A2", orientation: "portrait", scale: 2, views: { front: true, left: true, top: false }, section: { plane: "YZ", offset: 0 }, hidden: false } });
    expect(cmd("zeichnung A4 hoch maßstab auto ansichten vorne,oben,iso schnitt nein verdeckt ja")).toMatchObject({ k: "set", opts: { sheet: "A4", orientation: "portrait", scale: "auto", views: { front: true, top: true, iso: true }, section: null, hidden: true } });
  });
  it("pohledy i mezerami, „na výšku“, měřítko 1:1", () => {
    expect(cmd("výkres pohledy přední levý iso na výšku měřítko 1:1")).toMatchObject({ k: "set", opts: { views: { front: true, left: true, iso: true, top: false }, orientation: "portrait", scale: 1 } });
  });
  it("samotné „výkres“ jen otevře výkres", () => {
    expect(parseAgentText("výkres").ops[0]).toMatchObject({ k: "drawing" });
    expect(parseDrawing([])).toBeNull();
  });
  it("chyby: neznámá volba s výčtem, neznámý pohled, špatné měřítko", () => {
    expect(err("výkres A3 barevně")).toMatch(/neznámá volba výkresu „barevně“ – volby: .*měřítko 1:2\|2:1\|1:1\|auto.*podpříkazy: tolerance/);
    expect(err("výkres pohledy přední,šikmý")).toMatch(/neznámý pohled „šikmý“/);
    expect(err("výkres měřítko dvě")).toMatch(/měřítko: 1:2/);
    expect(err("výkres řez ZZ")).toMatch(/řez: rovina XZ, YZ nebo XY/);
  });
  it("tabulka voleb: každá volba má slova a nápovědu", () => {
    for (const r of VOLBY) {
      expect(r.words.length).toBeGreaterThan(1);
      expect(r.help().length).toBeGreaterThan(3);
    }
  });
});

describe("kótovat – Chytré kóty", () => {
  it("výchozí chytře, řetězově / od základny, celkově, nic (cs, en, de)", () => {
    expect(cmd("kótovat")).toEqual({ k: "dim", mode: "smart" });
    expect(cmd("kótovat chytře od základny")).toEqual({ k: "dim", mode: "smart", style: "baseline" });
    expect(cmd("kotovat retezove")).toEqual({ k: "dim", mode: "smart", style: "chain" });
    expect(cmd("kótovat celkově")).toEqual({ k: "dim", mode: "overall" });
    expect(cmd("kótovat nic")).toEqual({ k: "dim", mode: "none" });
    expect(cmd("dimension smart baseline")).toEqual({ k: "dim", mode: "smart", style: "baseline" });
    expect(cmd("dimension none")).toEqual({ k: "dim", mode: "none" });
    expect(cmd("bemaßen intelligent kette")).toEqual({ k: "dim", mode: "smart", style: "chain" });
    expect(cmd("bemassen gesamt")).toEqual({ k: "dim", mode: "overall" });
    expect(err("kótovat šikmo")).toMatch(/kótovat \[chytře\|celkově\|základní\|nic\]/);
    expect(parseDimension(["od", "základny"])).toEqual({ k: "dim", mode: "smart", style: "baseline" });
  });
});

describe("výkres – podpříkazy", () => {
  it("tolerance ke kótě, poznámka v uvozovkách, nepředepsané, hrany, drsnost, stav", () => {
    expect(cmd("výkres tolerance Ø40 h6")).toEqual({ k: "tol", target: "Ø40", tol: "h6" });
    expect(cmd("výkres tolerance 25 ±0,1")).toEqual({ k: "tol", target: "25", tol: "±0,1" });
    expect(cmd("výkres tolerance M8 6H")).toEqual({ k: "tol", target: "M8", tol: "6H" });
    expect(cmd('výkres poznámka "Nekótované rozměry dle 3D modelu"')).toEqual({ k: "meta", field: "note", value: "Nekótované rozměry dle 3D modelu" });
    expect(cmd("výkres nepředepsané ISO 2768-mK")).toEqual({ k: "meta", field: "tolerance", value: "ISO 2768-mK" });
    expect(cmd("výkres hrany ISO 13715 -0,3")).toEqual({ k: "meta", field: "edges", value: "ISO 13715 -0,3" });
    expect(cmd("výkres drsnost Ra 3,2")).toEqual({ k: "meta", field: "roughness", value: "Ra 3,2" });
    expect(cmd("výkres stav")).toEqual({ k: "status" });
  });
  it("anglicky a německy", () => {
    expect(cmd("drawing tolerance Ø40 h6")).toEqual({ k: "tol", target: "Ø40", tol: "h6" });
    expect(cmd("drawing general ISO 2768-mK")).toEqual({ k: "meta", field: "tolerance", value: "ISO 2768-mK" });
    expect(cmd("drawing roughness Ra 3.2")).toEqual({ k: "meta", field: "roughness", value: "Ra 3.2" });
    expect(cmd("drawing status")).toEqual({ k: "status" });
    expect(cmd("zeichnung toleranz 25 ±0,1")).toEqual({ k: "tol", target: "25", tol: "±0,1" });
    expect(cmd("zeichnung kanten ISO 13715")).toEqual({ k: "meta", field: "edges", value: "ISO 13715" });
    expect(cmd("zeichnung status")).toEqual({ k: "status" });
  });
  it("chybějící údaje → nápověda", () => {
    expect(err("výkres tolerance Ø40")).toMatch(/výkres tolerance <kóta> <tolerance>/);
    expect(err("výkres nepředepsané")).toMatch(/potřebuje text/);
  });
  it("anglické hlášky", () => {
    setLang("en");
    expect(err("drawing scale two")).toMatch(/scale/i);
  });
});

describe("díra: hloubka závitu", () => {
  it("hloubka-závitu = užitečná délka závitu (jiná než hloubka vrtání)", () => {
    const p = parseAgentText("díra 6,8 závit M8 hloubka 14 hloubka-závitu 10 v 15 15");
    expect(p.ops[0]).toMatchObject({ k: "feature", feature: { type: "hole", kind: "tapped", thread: "M8", depth: 14, threadDepth: 10 } });
    expect(parseAgentText("hole 6.8 thread M8 depth 14 thread-depth 10 at 15 15").ops[0]).toMatchObject({ feature: { threadDepth: 10 } });
  });
});

// ---------------------------------------------------------------- listy, razítko, značky, kóty, detaily (parser)

describe("výkres list – odlišení listu od formátu", () => {
  it("formát zůstává formátem, číslo / název / nový / přejmenovat / smazat = list", () => {
    expect(cmd("výkres list A3")).toMatchObject({ k: "set", opts: { sheet: "A3" } });
    expect(cmd("výkres list auto")).toMatchObject({ k: "set", opts: { sheet: "auto" } });
    expect(cmd("výkres list 2")).toEqual({ k: "sheet", op: "select", ref: 2 });
    expect(cmd('výkres list "Detail"')).toEqual({ k: "sheet", op: "select", ref: "Detail" });
    expect(cmd('výkres list nový "Detail B"')).toEqual({ k: "sheet", op: "new", name: "Detail B" });
    expect(cmd("výkres list nový")).toEqual({ k: "sheet", op: "new" });
    expect(cmd("výkres list nový A4 na výšku")).toMatchObject({ k: "sheet", op: "new", then: { k: "set", opts: { sheet: "A4", orientation: "portrait" } } });
    expect(cmd("výkres list 2 A3 měřítko 1:2")).toMatchObject({ k: "sheet", op: "select", ref: 2, then: { k: "set", opts: { sheet: "A3", scale: 0.5 } } });
    expect(cmd('výkres list přejmenovat 2 "Řez A-A"')).toEqual({ k: "sheet", op: "rename", ref: 2, name: "Řez A-A" });
    expect(cmd('výkres list přejmenovat "Hlavní"')).toEqual({ k: "sheet", op: "rename", name: "Hlavní" });
    expect(cmd("výkres list smazat 2")).toEqual({ k: "sheet", op: "delete", ref: 2 });
    expect(cmd("výkres listy")).toEqual({ k: "sheet", op: "list" });
    expect(cmd("výkres list")).toEqual({ k: "sheet", op: "list" });
  });
  it("anglicky a německy", () => {
    expect(cmd("drawing sheet 2")).toEqual({ k: "sheet", op: "select", ref: 2 });
    expect(cmd('drawing sheet new "Detail"')).toEqual({ k: "sheet", op: "new", name: "Detail" });
    expect(cmd('drawing sheet rename 1 "Main"')).toEqual({ k: "sheet", op: "rename", ref: 1, name: "Main" });
    expect(cmd("drawing sheet delete 3")).toEqual({ k: "sheet", op: "delete", ref: 3 });
    expect(cmd("drawing sheet A2")).toMatchObject({ k: "set", opts: { sheet: "A2" } });
    expect(cmd('zeichnung blatt neu "Schnitt"')).toEqual({ k: "sheet", op: "new", name: "Schnitt" });
    expect(cmd("zeichnung blatt umbenennen 2 Ansicht")).toEqual({ k: "sheet", op: "rename", ref: 2, name: "Ansicht" });
    expect(cmd("zeichnung blatt löschen 2")).toEqual({ k: "sheet", op: "delete", ref: 2 });
    expect(cmd("zeichnung blatt 1")).toEqual({ k: "sheet", op: "select", ref: 1 });
  });
  it("výkres stav [list N|vše]", () => {
    expect(cmd("výkres stav list 2")).toEqual({ k: "status", sheet: 2 });
    expect(cmd("výkres stav vše")).toEqual({ k: "status", sheet: "all" });
    expect(cmd('výkres stav "Detail"')).toEqual({ k: "status", sheet: "Detail" });
    expect(cmd("drawing status sheet 2")).toEqual({ k: "status", sheet: 2 });
    expect(cmd("drawing status all")).toEqual({ k: "status", sheet: "all" });
    expect(cmd("zeichnung status blatt 1")).toEqual({ k: "status", sheet: 1 });
    expect(cmd("zeichnung status alle")).toEqual({ k: "status", sheet: "all" });
  });
});

describe("výkres razítko a revize", () => {
  it("razítko klíč=\"hodnota s mezerami\" (cs, en, de)", () => {
    expect(cmd('výkres razítko název="Příruba DN50" číslo="MN-1" kreslil="AI agent" revize=B datum="13.11.2026" materiál="ČSN 11 523"')).toEqual({
      k: "title",
      fields: { name: "Příruba DN50", number: "MN-1", author: "AI agent", revision: "B", date: "13.11.2026", material: "ČSN 11 523" },
    });
    expect(cmd('drawing titleblock name="Flange" number=MN-2 author=AI revision=C date=2026-11-13 material="1.0503"')).toEqual({ k: "title", fields: { name: "Flange", number: "MN-2", author: "AI", revision: "C", date: "2026-11-13", material: "1.0503" } });
    expect(cmd('zeichnung schriftfeld benennung="Flansch" nummer=MN-3 ersteller=AI werkstoff="1.4301"')).toEqual({ k: "title", fields: { name: "Flansch", number: "MN-3", author: "AI", material: "1.4301" } });
    expect(cmd("výkres razítko")).toEqual({ k: "title", fields: {} });
    expect(err("výkres razítko barva=červená")).toMatch(/výkres razítko název=.*neznámé „barva=“/);
  });
  it("revize: přidat (popis, datum, kreslil), smazat", () => {
    expect(cmd('výkres revize B "Přidána díra Ø8" datum 13.11.2026 kreslil AI')).toEqual({ k: "rev", op: "set", rev: "B", note: "Přidána díra Ø8", date: "13.11.2026", author: "AI" });
    expect(cmd('výkres revize a "první vydání"')).toEqual({ k: "rev", op: "set", rev: "A", note: "první vydání" });
    expect(cmd("výkres revize smazat B")).toEqual({ k: "rev", op: "delete", rev: "B" });
    expect(cmd('drawing revision C "new hole" date 2026-11-13')).toEqual({ k: "rev", op: "set", rev: "C", note: "new hole", date: "2026-11-13" });
    expect(cmd("drawing revision delete C")).toEqual({ k: "rev", op: "delete", rev: "C" });
    expect(cmd('zeichnung änderung D "Bohrung" datum 13.11.2026')).toEqual({ k: "rev", op: "set", rev: "D", note: "Bohrung", date: "13.11.2026" });
    expect(cmd("zeichnung änderung löschen D")).toEqual({ k: "rev", op: "delete", rev: "D" });
    expect(err("výkres revize")).toMatch(/výkres revize <znak>/);
  });
});

describe("výkres – další volby listu (otočení, poloviční řez, kusovník, balónky) a kótovat základní", () => {
  it("otočení, řez poloviční / celý, kusovník, balónky (cs, en, de)", () => {
    expect(cmd("výkres otočení 90 řez XZ odsazení 5 poloviční kusovník ne balónky ano")).toMatchObject({ k: "set", opts: { rotation: 90, section: { plane: "XZ", offset: 5, kind: "half" }, bomTable: false, balloons: true } });
    expect(cmd("výkres řez YZ celý")).toMatchObject({ k: "set", opts: { section: { plane: "YZ", offset: 0, kind: "full" } } });
    expect(cmd("drawing rotation 270 section XZ half bom yes balloons no")).toMatchObject({ k: "set", opts: { rotation: 270, section: { plane: "XZ", kind: "half" }, bomTable: true, balloons: false } });
    expect(cmd("zeichnung drehung 180 schnitt XY halb stückliste nein positionsnummern ja")).toMatchObject({ k: "set", opts: { rotation: 180, section: { plane: "XY", kind: "half" }, bomTable: false, balloons: true } });
    expect(cmd("výkres řez XZ")).toMatchObject({ k: "set", opts: { section: { plane: "XZ", offset: 0 } } });
    expect((cmd("výkres řez XZ") as { opts: { section: object } }).opts.section).not.toHaveProperty("kind");
    expect(err("výkres otočení 45")).toMatch(/otočení hlavního pohledu: 0, 90, 180 nebo 270/);
    expect(err("výkres kusovník možná")).toMatch(/kusovník: čekám ano \/ ne/);
  });
  it("kótovat základní = Auto + Ø (cs, en, de)", () => {
    expect(cmd("kótovat základní")).toEqual({ k: "dim", mode: "auto" });
    expect(cmd("dimension basic")).toEqual({ k: "dim", mode: "auto" });
    expect(cmd("bemaßen einfach")).toEqual({ k: "dim", mode: "auto" });
  });
});

describe("výkres značka – poznámka, drsnost, GD&T, základna, text", () => {
  it("cíl na kótu i bod pohledu, posun popisku", () => {
    expect(cmd("výkres značka drsnost Ra 1,6 na Ø40")).toEqual({ k: "mark", mark: { type: "roughness", ra: "Ra 1,6" }, target: { on: "Ø40" } });
    expect(cmd("výkres značka drsnost 0,8 pohled přední v 0 20")).toEqual({ k: "mark", mark: { type: "roughness", ra: "Ra 0,8" }, target: { view: "front", at: [0, 20] } });
    expect(cmd("výkres značka tolerance kolmost 0,02 A na Ø40")).toEqual({ k: "mark", mark: { type: "gdt", symbol: "perp", value: "0,02", datum: "A" }, target: { on: "Ø40" } });
    expect(cmd("výkres značka tolerance poloha Ø0,1 A-B na a3 posun 10 -5")).toEqual({ k: "mark", mark: { type: "gdt", symbol: "pos", value: "Ø0,1", datum: "A-B" }, target: { on: "a3" }, shift: [10, -5] });
    expect(cmd("výkres značka základna A pohled horní v -50 0")).toEqual({ k: "mark", mark: { type: "datum", label: "A" }, target: { view: "top", at: [-50, 0] } });
    expect(cmd("výkres značka základna na 100")).toEqual({ k: "mark", mark: { type: "datum" }, target: { on: "100" } });
    expect(cmd('výkres značka poznámka "Kalit 58 HRC" na Ø40')).toEqual({ k: "mark", mark: { type: "note", text: "Kalit 58 HRC" }, target: { on: "Ø40" } });
    expect(cmd("výkres značka poznámka Srazit na 0,5 na Ø40")).toEqual({ k: "mark", mark: { type: "note", text: "Srazit na 0,5" }, target: { on: "Ø40" } });
    expect(cmd('výkres značka text "Kalit 58 ± 2 HRC" v 20 30 výška 5')).toEqual({ k: "mark", mark: { type: "text", text: "Kalit 58 ± 2 HRC", size: 5 }, target: { sheet: [20, 30] } });
    expect(cmd("výkres značka drsnost Ra 3,2 pohled řez v 10 5")).toMatchObject({ target: { view: "section", at: [10, 5] } });
    expect(cmd("výkres značka drsnost Ra 3,2 pohled detail A v 10 5")).toMatchObject({ target: { view: "detail:A", at: [10, 5] } });
    expect(cmd('výkres značka poznámka "x" pohled "Hřídel" v 1 2')).toMatchObject({ target: { view: "model:Hřídel", at: [1, 2] } });
  });
  it("anglicky a německy", () => {
    expect(cmd("drawing mark roughness Ra 1.6 on Ø40")).toEqual({ k: "mark", mark: { type: "roughness", ra: "Ra 1.6" }, target: { on: "Ø40" } });
    expect(cmd("drawing mark gdt flatness 0.05 view front at 0 20 shift 5 5")).toEqual({ k: "mark", mark: { type: "gdt", symbol: "flat", value: "0.05" }, target: { view: "front", at: [0, 20] }, shift: [5, 5] });
    expect(cmd('drawing mark note "Harden" on 100')).toMatchObject({ mark: { type: "note", text: "Harden" }, target: { on: "100" } });
    expect(cmd("drawing mark datum B view top at 0 30")).toMatchObject({ mark: { type: "datum", label: "B" }, target: { view: "top", at: [0, 30] } });
    expect(cmd('drawing mark text "Note" at 10 10 height 3,5')).toMatchObject({ mark: { type: "text", size: 3.5 }, target: { sheet: [10, 10] } });
    expect(cmd("zeichnung symbol rauheit Ra 1,6 an Ø40")).toMatchObject({ mark: { type: "roughness", ra: "Ra 1,6" }, target: { on: "Ø40" } });
    expect(cmd("zeichnung symbol form rechtwinkligkeit 0,02 A an Ø40")).toMatchObject({ mark: { type: "gdt", symbol: "perp" } });
    expect(cmd("zeichnung symbol bezug A ansicht vorne bei 0 0")).toMatchObject({ mark: { type: "datum", label: "A" }, target: { view: "front", at: [0, 0] } });
    expect(cmd('zeichnung symbol hinweis "Härten" an 100')).toMatchObject({ mark: { type: "note", text: "Härten" } });
    expect(cmd('zeichnung symbol text "Text" bei 5 5')).toMatchObject({ mark: { type: "text" }, target: { sheet: [5, 5] } });
  });
  it("všech 12 charakteristik ISO 1101 česky, anglicky i německy", () => {
    const sets: [string[], string][] = [
      [["přímost", "straightness", "geradheit"], "straight"],
      [["rovinnost", "flatness", "ebenheit"], "flat"],
      [["kruhovitost", "circularity", "rundheit"], "circ"],
      [["válcovitost", "cylindricity", "zylindrizität"], "cyl"],
      [["profil", "profile", "profil"], "prof"],
      [["rovnoběžnost", "parallelism", "parallelität"], "par"],
      [["kolmost", "perpendicularity", "rechtwinkligkeit"], "perp"],
      [["sklon", "angularity", "neigung"], "angle"],
      [["poloha", "position", "position"], "pos"],
      [["souosost", "concentricity", "koaxialität"], "conc"],
      [["souměrnost", "symmetry", "symmetrie"], "sym"],
      [["házení", "runout", "lauf"], "runout"],
    ];
    for (const [words, sym] of sets) {
      expect(cmd(`výkres značka tolerance ${words[0]} 0,1 na 100`)).toMatchObject({ mark: { symbol: sym } });
      expect(cmd(`drawing mark gdt ${words[1]} 0.1 on 100`)).toMatchObject({ mark: { symbol: sym } });
      expect(cmd(`zeichnung symbol form ${words[2]} 0,1 an 100`)).toMatchObject({ mark: { symbol: sym } });
    }
  });
  it("chyby: chybí cíl, neznámá charakteristika, text mimo list", () => {
    expect(err("výkres značka drsnost Ra 1,6")).toMatch(/značka: chybí cíl/);
    expect(err("výkres značka tolerance šikmost 0,1 na 100")).toMatch(/geometrická tolerance: charakteristika .* neznámé „šikmost“/);
    expect(err("výkres značka tolerance kolmost na 100")).toMatch(/za charakteristikou zadejte hodnotu/);
    expect(err('výkres značka text "x" na 100')).toMatch(/text se umisťuje na list/);
    expect(err("výkres značka razítko A na 100")).toMatch(/výkres značka poznámka/);
    expect(err("výkres značka drsnost Ra 1 pohled přední 0 0")).toMatch(/za pohledem zadejte bod/);
  });
});

describe("výkres kóta / upravit / smazat / detail / model (parser)", () => {
  it("ruční kóty (cs, en, de)", () => {
    expect(cmd("výkres kóta vodorovně pohled přední -50 20 50 20 odsazení 8")).toEqual({ k: "mdim", dim: { kind: "horizontal", view: "front", p1: [-50, 20], p2: [50, 20] }, offset: 8 });
    expect(cmd('výkres kóta svisle pohled přední 50 0 50 20 text "(20)"')).toEqual({ k: "mdim", dim: { kind: "vertical", view: "front", p1: [50, 0], p2: [50, 20] }, text: "(20)" });
    expect(cmd("výkres kóta šikmo pohled horní 0 0 30 40")).toMatchObject({ dim: { kind: "aligned", view: "top" } });
    expect(cmd("výkres kóta průměr pohled horní střed 0 0 r 20 úhel 30")).toEqual({ k: "mdim", dim: { kind: "diameter", view: "top", c: [0, 0], r: 20, ang: 30 } });
    expect(cmd("výkres kóta poloměr pohled horní střed 0 0")).toEqual({ k: "mdim", dim: { kind: "radius", view: "top", c: [0, 0] } });
    expect(cmd("výkres kóta úhel pohled přední -50 20 50 20 50 20 50 0 odsazení 12")).toEqual({ k: "mdim", dim: { kind: "angle", view: "front", l1: [[-50, 20], [50, 20]], l2: [[50, 20], [50, 0]] }, offset: 12 });
    expect(cmd("drawing dim horizontal view front -50 20 50 20 offset 8")).toMatchObject({ dim: { kind: "horizontal", view: "front" }, offset: 8 });
    expect(cmd("drawing dim diameter view top center 0 0 radius 20")).toMatchObject({ dim: { kind: "diameter", c: [0, 0], r: 20 } });
    expect(cmd("zeichnung maß senkrecht ansicht vorne 50 0 50 20 versatz 8")).toMatchObject({ dim: { kind: "vertical", view: "front" }, offset: 8 });
    expect(cmd("zeichnung maß winkel ansicht vorne -50 20 50 20 50 20 50 0")).toMatchObject({ dim: { kind: "angle" } });
    expect(err("výkres kóta vodorovně pohled přední 1 2 3")).toMatch(/dva body čtyřmi čísly/);
    expect(err("výkres kóta šikmě pohled přední 1 2 3 4")).toMatch(/výkres kóta vodorovně\|svisle\|šikmo/);
  });
  it("upravit a smazat (cs, en, de)", () => {
    expect(cmd('výkres upravit a3 odsazení=8 text="(20)" přípona="H7"')).toEqual({ k: "edit", target: "a3", patch: { offset: 8, text: "(20)", suffix: "H7" } });
    expect(cmd("výkres upravit Ø40 přípona=H7")).toEqual({ k: "edit", target: "Ø40", patch: { suffix: "H7" } });
    expect(cmd("drawing edit a1 offset=12 suffix=±0,1")).toEqual({ k: "edit", target: "a1", patch: { offset: 12, suffix: "±0,1" } });
    expect(cmd("zeichnung bearbeiten a2 versatz=5")).toEqual({ k: "edit", target: "a2", patch: { offset: 5 } });
    expect(cmd('výkres upravit a4 posun="5 -3"')).toEqual({ k: "edit", target: "a4", patch: { shift: [5, -3] } });
    expect(cmd("drawing edit a4 shift=2;1,5")).toEqual({ k: "edit", target: "a4", patch: { shift: [2, 1.5] } });
    expect(err("výkres upravit a4 posun=5")).toMatch(/posun="dx dy"/);
    expect(cmd("výkres smazat a3 a5")).toEqual({ k: "del", targets: ["a3", "a5"] });
    expect(cmd('výkres smazat "Ra 1,6"')).toEqual({ k: "del", targets: ["Ra 1,6"] });
    expect(cmd("výkres smazat vlastní")).toEqual({ k: "del", targets: "custom" });
    expect(cmd("výkres smazat vše")).toEqual({ k: "del", targets: "all" });
    expect(cmd("drawing delete all")).toEqual({ k: "del", targets: "all" });
    expect(cmd("drawing delete custom")).toEqual({ k: "del", targets: "custom" });
    expect(cmd("zeichnung löschen eigene")).toEqual({ k: "del", targets: "custom" });
    expect(cmd("zeichnung löschen alle")).toEqual({ k: "del", targets: "all" });
    expect(err("výkres upravit a3 barva=1")).toMatch(/neznámé „barva=“/);
    expect(err("výkres upravit a3")).toMatch(/výkres upravit <id\|popisek>/);
  });
  it("detail a další modely (cs, en, de)", () => {
    expect(cmd("výkres detail přední v 40 10 poloměr 5 měřítko 5:1 umístit 300 200")).toEqual({ k: "detail", op: "add", view: "front", at: [40, 10], r: 5, scale: 5, place: [300, 200] });
    expect(cmd("výkres detail horní v 0 0 poloměr 8")).toEqual({ k: "detail", op: "add", view: "top", at: [0, 0], r: 8 });
    expect(cmd("výkres detail A měřítko 10:1")).toEqual({ k: "detail", op: "edit", label: "A", scale: 10 });
    expect(cmd("výkres detail smazat A")).toEqual({ k: "detail", op: "delete", label: "A" });
    expect(cmd("drawing detail front at 40 10 radius 5 scale 2:1 place 300 200")).toEqual({ k: "detail", op: "add", view: "front", at: [40, 10], r: 5, scale: 2, place: [300, 200] });
    expect(cmd("drawing detail delete B")).toEqual({ k: "detail", op: "delete", label: "B" });
    expect(cmd("zeichnung einzelheit vorne bei 40 10 radius 5 maßstab 2:1 platzieren 300 200")).toEqual({ k: "detail", op: "add", view: "front", at: [40, 10], r: 5, scale: 2, place: [300, 200] });
    expect(cmd("zeichnung einzelheit löschen A")).toEqual({ k: "detail", op: "delete", label: "A" });
    expect(cmd('výkres model "Hřídel" pohled horní měřítko 1:2')).toEqual({ k: "model", op: "add", name: "Hřídel", view: "top", scale: 0.5 });
    expect(cmd('výkres model "Hřídel 2"')).toEqual({ k: "model", op: "add", name: "Hřídel 2" });
    expect(cmd('výkres model smazat "Hřídel"')).toEqual({ k: "model", op: "delete", name: "Hřídel" });
    expect(cmd('drawing model "Shaft" view iso scale auto')).toEqual({ k: "model", op: "add", name: "Shaft", view: "iso", scale: "auto" });
    expect(cmd('zeichnung modell "Welle" ansicht oben maßstab 2:1')).toEqual({ k: "model", op: "add", name: "Welle", view: "top", scale: 2 });
    expect(err("výkres detail přední v 1 2")).toMatch(/poloměr kruhu detailu/);
  });
});
