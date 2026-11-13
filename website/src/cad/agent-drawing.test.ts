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
    expect(err("kótovat šikmo")).toMatch(/kótovat \[chytře\|celkově\|nic\]/);
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
