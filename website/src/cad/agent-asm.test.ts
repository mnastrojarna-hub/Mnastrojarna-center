import { afterEach, describe, expect, it } from "vitest";
import { docStatusText, parseAgentText } from "./agent";
import { asmStatusLines, asmTokens, bomText, componentLines, findComp, findMate, mateLines, parseAsmText, pickFace, resolveTab, type AsmCmd, type CompFaceRow, type TabInfo } from "./agent-asm";
import { applyAsmCmd, bomData, compFaces, sameFace, solveAsm, type AsmEnv } from "./asm-agent";
import { bomCsv, defaultMoldBase, emptyAssembly, partComponent, sourceKey, type BomRow } from "./assembly";
import { setLang } from "./i18n";
import type { PartFace } from "./mates";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

/** rozbor jednoho řádku přes agent.ts (jako konzole) */
const op = (line: string): AsmCmd => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  expect(p.ops[0]?.k, line).toBe("asm");
  return (p.ops[0] as { cmd: AsmCmd }).cmd;
};
const err = (line: string) => parseAgentText(line).errors[0]?.message ?? "";

describe("rozbor: sestava … česky, anglicky, německy", () => {
  it("výpis, plochy, tokeny s uvozovkami a klíč=hodnota", () => {
    expect(op("sestava")).toEqual({ k: "list" });
    expect(op("assembly")).toEqual({ k: "list" });
    expect(op("baugruppe")).toEqual({ k: "list" });
    expect(op('sestava plochy "Čep" válcové')).toEqual({ k: "faces", comp: "Čep", kind: "cylinder" });
    expect(op('assembly faces "Pin" planar')).toEqual({ k: "faces", comp: "Pin", kind: "plane" });
    expect(op('baugruppe flächen „Stift 2“ zylindrisch')).toEqual({ k: "faces", comp: "Stift 2", kind: "cylinder" });
    expect(op("sestava plochy Deska")).toEqual({ k: "faces", comp: "Deska" });
    expect(asmTokens('a hodnota=5 název="Kryt A" "x y"')).toEqual([
      { t: "a", q: false },
      { t: "hodnota", q: false },
      { t: "5", q: false },
      { t: "název", q: false },
      { t: "Kryt A", q: true },
      { t: "x y", q: true },
    ]);
  });

  it("vazby: druhy, plochy číslem i pravidlem, hodnota, obráceně, střed, název", () => {
    expect(op('sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5')).toMatchObject({ k: "mate", kind: "concentric", a: "Čep", b: "Deska", faceA: { diameter: 10 }, faceB: { diameter: 10.5 } });
    expect(op('sestava vazba kontakt "Čep" F3 "Deska" +Z')).toMatchObject({ k: "mate", kind: "mate", faceA: { index: 2, raw: "F3" }, faceB: { rule: ["+z"] } });
    expect(op('sestava vazba kontakt "Čep" -Z největší "Deska" horní střed název "Hlava"')).toMatchObject({ kind: "center", faceA: { rule: ["-z", "nejvetsi"] }, faceB: { rule: ["horni"] }, center: true, name: "Hlava" });
    expect(op('sestava vazba vystředit "A" F1 "B" F2')).toMatchObject({ kind: "center", center: true });
    expect(op('sestava vazba vzdálenost "A" F1 "B" F2 hodnota 5 obráceně')).toMatchObject({ kind: "distance", value: 5, flip: true });
    expect(op('sestava vazba úhel "A" F1 "B" F2 hodnota=30°')).toMatchObject({ kind: "angle", value: 30 });
    expect(op('sestava vazba souosost "A" válcová Ø8 "B" válcová 9')).toMatchObject({ faceA: { rule: ["valcova"], diameter: 8 }, faceB: { rule: ["valcova"], diameter: 9 } });
    expect(op('sestava vazba souosost "A" F2@Čep "B" R4')).toMatchObject({ faceA: { index: 1, leaf: "Čep" }, faceB: { radius: 4 } });
    expect(op('sestava vazba ukotvit "Deska"')).toEqual({ k: "mate", kind: "fixed", a: "Deska", flip: false, center: false });
    expect(op('sestava vazba rovnoběžně A F1 B F2')).toMatchObject({ kind: "parallel", a: "A", b: "B" });
    // anglicky a německy
    expect(op('assembly mate distance "A" F1 "B" F2 value 5 flip')).toMatchObject({ kind: "distance", value: 5, flip: true });
    expect(op('assembly mate concentric "Pin" Ø10 "Plate" Ø10.5')).toMatchObject({ kind: "concentric", faceB: { diameter: 10.5 } });
    expect(op('assembly mate contact "A" top "B" bottom center')).toMatchObject({ kind: "center", faceA: { rule: ["top"] }, faceB: { rule: ["bottom"] } });
    expect(op('baugruppe verknüpfung abstand "A" F1 "B" F2 wert 5 umkehren')).toMatchObject({ kind: "distance", value: 5, flip: true });
    expect(op('baugruppe verknüpfung konzentrisch "A" Ø8 "B" Ø8')).toMatchObject({ kind: "concentric" });
    expect(op('baugruppe verknüpfung bündig "A" oben "B" oben')).toMatchObject({ kind: "flush" });
    expect(op('baugruppe verknüpfung fixiert "A"')).toMatchObject({ kind: "fixed" });
    // správa vazeb
    expect(op("sestava vazby")).toEqual({ k: "mates" });
    expect(op("assembly mates")).toEqual({ k: "mates" });
    expect(op("baugruppe verknüpfungen")).toEqual({ k: "mates" });
    expect(op("sestava vazba 2 hodnota=7")).toEqual({ k: "mateEdit", ref: "2", value: 7 });
    expect(op("sestava vazba 1 potlačit")).toEqual({ k: "mateEdit", ref: "1", suppress: true });
    expect(op("sestava vazba 1 zapnout obráceně")).toEqual({ k: "mateEdit", ref: "1", suppress: false, flip: true });
    expect(op('sestava vazba "Souosost M8" smazat')).toEqual({ k: "mateEdit", ref: "Souosost M8", del: true });
    expect(op("sestava vazba souosost smazat")).toEqual({ k: "mateEdit", ref: "souosost", del: true });
    expect(op("assembly mate 3 value=12 flip")).toEqual({ k: "mateEdit", ref: "3", value: 12, flip: true });
    expect(op("baugruppe verknüpfung 1 unterdrücken")).toEqual({ k: "mateEdit", ref: "1", suppress: true });
    expect(op("baugruppe verknüpfung 1 löschen")).toEqual({ k: "mateEdit", ref: "1", del: true });
  });

  it("komponenta: poloha, natočení, ukotvení, viditelnost, popis, materiál; krátké tvary", () => {
    expect(op('sestava komponenta "Čep" v 1 2 3 otočení 0 90 0 ukotvit skrýt barva #FF0000 název "Kolík" číslo "K-1" skupina "Vedení" materiál ocel')).toEqual({
      k: "comp",
      comp: "Čep",
      patch: { at: [1, 2, 3], rotation: [0, 90, 0], fixed: true, hidden: true, color: "#ff0000", name: "Kolík", number: "K-1", group: "Vedení", material: "ocel" },
    });
    expect(op('sestava komponenta "Čep" posun 0 0 -5 pootočit X 90 uvolnit zobrazit')).toMatchObject({ patch: { move: [0, 0, -5], turn: { axis: 0, deg: 90 }, fixed: false, hidden: false } });
    expect(op('assembly component "Pin" at 1 2 3 rotation 0 90 0 fixed hide color #00ff00 name "Dowel" number "K-1" group "Guides" material steel')).toMatchObject({ patch: { at: [1, 2, 3], rotation: [0, 90, 0], fixed: true, hidden: true, name: "Dowel", material: "steel" } });
    expect(op('baugruppe komponente "Stift" bei 1 2 3 drehung 0 90 0 fixieren ausblenden farbe #0000ff nummer "K" gruppe "G" werkstoff stahl')).toMatchObject({ patch: { at: [1, 2, 3], fixed: true, hidden: true, number: "K", group: "G", material: "stahl" } });
    expect(op('baugruppe komponente "Stift" lösen einblenden')).toMatchObject({ patch: { fixed: false, hidden: false } });
    expect(op('sestava komponenta "Čep"')).toEqual({ k: "comp", comp: "Čep", patch: {} });
    expect(op('sestava ukotvit "Deska"')).toEqual({ k: "comp", comp: "Deska", patch: { fixed: true } });
    expect(op('sestava skrýt "Deska"')).toEqual({ k: "comp", comp: "Deska", patch: { hidden: true } });
    expect(op('sestava odebrat "A" "B"')).toEqual({ k: "remove", comps: ["A", "B"] });
    expect(op('assembly remove "A"')).toEqual({ k: "remove", comps: ["A"] });
    expect(op('baugruppe entfernen "A"')).toEqual({ k: "remove", comps: ["A"] });
    expect(op('sestava duplikovat "A"')).toEqual({ k: "duplicate", comp: "A", offset: [50, 0, 0] });
    expect(op('assembly duplicate "A" offset 0 20 0')).toEqual({ k: "duplicate", comp: "A", offset: [0, 20, 0] });
    expect(op('baugruppe duplizieren "A" versatz 0 20 0')).toEqual({ k: "duplicate", comp: "A", offset: [0, 20, 0] });
    expect(op('sestava izolovat "A"')).toEqual({ k: "isolate", comp: "A" });
    expect(op('assembly isolate "A"')).toEqual({ k: "isolate", comp: "A" });
    expect(op("sestava zobrazit vše")).toEqual({ k: "showAll" });
    expect(op("assembly show all")).toEqual({ k: "showAll" });
    expect(op("baugruppe alle einblenden")).toEqual({ k: "showAll" });
    expect(op('sestava komponenta #2 v 0 0 5 # komentář')).toEqual({ k: "comp", comp: "#2", patch: { at: [0, 0, 5] } });
  });

  it("pole, zrcadlení, šroub, podsestavy, úprava v kontextu, otevřít", () => {
    expect(op('sestava pole "A" 3 rozteč 20 směr Y')).toEqual({ k: "pattern", comp: "A", pattern: { kind: "linear", count: 3, spacing: 20, direction: [0, 1, 0] } });
    expect(op('sestava pole "A" 3 rozteč 20 směr 1 1 0')).toMatchObject({ pattern: { direction: [1, 1, 0] } });
    expect(op('sestava pole "A" kruhové 6 úhel 180 osa X v 0 0 5')).toEqual({ k: "pattern", comp: "A", pattern: { kind: "circular", count: 6, angle: 180, axis: "X", center: [0, 0, 5] } });
    expect(op('assembly pattern "A" 3 spacing 20 direction -X')).toMatchObject({ pattern: { kind: "linear", direction: [-1, 0, 0] } });
    expect(op('assembly pattern "A" circular 4 angle 360 axis 0 0 1 at 10 0 0')).toMatchObject({ pattern: { kind: "circular", count: 4, axis: [0, 0, 1], center: [10, 0, 0] } });
    expect(op('baugruppe muster "A" kreisförmig 4 winkel 90 achse Z bei 0 0 0')).toMatchObject({ pattern: { kind: "circular", angle: 90, axis: "Z" } });
    expect(op('baugruppe muster "A" anzahl 3 abstand 15 richtung Y')).toMatchObject({ pattern: { kind: "linear", count: 3, spacing: 15 } });
    expect(op('sestava zrcadlit "A" XZ odsazení 10')).toEqual({ k: "mirror", comp: "A", plane: "XZ", offset: 10 });
    expect(op('assembly mirror "A" YZ offset 5')).toEqual({ k: "mirror", comp: "A", plane: "YZ", offset: 5 });
    expect(op('baugruppe spiegeln "A" XY versatz 2')).toEqual({ k: "mirror", comp: "A", plane: "XY", offset: 2 });
    expect(op('sestava šroub "Deska" Ø9 matice bez podložky obráceně')).toMatchObject({ k: "bolt", comp: "Deska", face: { diameter: 9 }, washer: false, nut: true, flip: true });
    expect(op('sestava šroub "Deska" F8')).toMatchObject({ face: { index: 7 }, washer: true, nut: false, flip: false });
    expect(op('assembly bolt "Plate" F5 nut no washer flip')).toMatchObject({ face: { index: 4 }, washer: false, nut: true, flip: true });
    expect(op('baugruppe schraube "Platte" F5 mutter ohne scheibe umkehren')).toMatchObject({ washer: false, nut: true, flip: true });
    expect(op('sestava podsestava "A" "B" jako "Vedení"')).toEqual({ k: "sub", comps: ["A", "B"], name: "Vedení" });
    expect(op('assembly subassembly "A" "B" as "G"')).toEqual({ k: "sub", comps: ["A", "B"], name: "G" });
    expect(op('baugruppe unterbaugruppe "A" als "G"')).toEqual({ k: "sub", comps: ["A"], name: "G" });
    expect(op('sestava rozpustit "P"')).toEqual({ k: "dissolve", comp: "P" });
    expect(op('assembly dissolve "P"')).toEqual({ k: "dissolve", comp: "P" });
    expect(op('baugruppe auflösen "P"')).toEqual({ k: "dissolve", comp: "P" });
    expect(op('sestava upravit "Čep"')).toEqual({ k: "edit", comp: "Čep" });
    expect(op('assembly edit "Pin"')).toEqual({ k: "edit", comp: "Pin" });
    expect(op('baugruppe bearbeiten "Stift"')).toEqual({ k: "edit", comp: "Stift" });
    expect(op("sestava hotovo")).toEqual({ k: "done" });
    expect(op("assembly done")).toEqual({ k: "done" });
    expect(op("baugruppe fertig")).toEqual({ k: "done" });
    expect(op('sestava otevřít "Čep"')).toEqual({ k: "open", comp: "Čep" });
    expect(op('assembly open "Pin"')).toEqual({ k: "open", comp: "Pin" });
    expect(op('baugruppe öffnen "Stift"')).toEqual({ k: "open", comp: "Stift" });
  });

  it("kusovník, rám formy, záložky", () => {
    expect(op("kusovník")).toEqual({ k: "bom", structured: false, csv: false });
    expect(op("kusovník strukturovaně csv")).toEqual({ k: "bom", structured: true, csv: true });
    expect(op("bom structured")).toEqual({ k: "bom", structured: true, csv: false });
    expect(op("stückliste strukturiert")).toEqual({ k: "bom", structured: true, csv: false });
    const def = op("rám formy");
    expect(def).toEqual({ k: "moldbase", params: defaultMoldBase });
    expect(op("rám formy 246 296 deska-a 46 deska-b 36 upínací 22 opěrná 26 rozpěrky 76 šířka-rozpěrek 46 vyhazovací 17 kotevní 12 sloupky 20 dutina 100 120 20 materiál 1.2311")).toEqual({
      k: "moldbase",
      params: { width: 246, length: 296, aPlate: 46, bPlate: 36, clamp: 22, support: 26, spacer: 76, spacerWidth: 46, ejector: 17, retainer: 12, pillar: 20, cavity: { w: 100, l: 120, depth: 20 }, material: "1.2311" },
    });
    expect(op("moldbase 246 296 aplate 46 cavity 100 120 20 material steel")).toMatchObject({ params: { width: 246, aPlate: 46, cavity: { w: 100 }, material: "ocel" } });
    expect(op("formaufbau 246 296 a-platte 46 nest 100 120 20 werkstoff 1.2311 säule 20")).toMatchObject({ params: { width: 246, aPlate: 46, pillar: 20, material: "1.2311" } });
    expect(op('rám formy 296 346 bez dutiny název "Forma A"')).toMatchObject({ params: { cavity: null }, name: "Forma A" });
    expect(op("moldbase no cavity")).toMatchObject({ params: { cavity: null } });
    expect(op("formaufbau ohne nest")).toMatchObject({ params: { cavity: null } });
    expect(op("záložky")).toEqual({ k: "tabs" });
    expect(op("tabs")).toEqual({ k: "tabs" });
    expect(op("registerkarten")).toEqual({ k: "tabs" });
    expect(op('záložka "Čep"')).toEqual({ k: "tab", target: "Čep" });
    expect(op("tab 2")).toEqual({ k: "tab", target: 2 });
    expect(op('registerkarte "Stift"')).toEqual({ k: "tab", target: "Stift" });
    expect(op("zavřít záložku")).toEqual({ k: "closeTab" });
    expect(op('zavřít záložku "Čep"')).toEqual({ k: "closeTab", target: "Čep" });
    expect(op('close tab "Pin"')).toEqual({ k: "closeTab", target: "Pin" });
    expect(op("registerkarte schließen 2")).toEqual({ k: "closeTab", target: 2 });
  });

  it("chyby: srozumitelná hláška s výčtem / použitím", () => {
    expect(err("sestava blabla")).toMatch(/neznámý podpříkaz sestavy „blabla“ – podpříkazy: plochy, vazba, vazby, komponenta/);
    expect(err('sestava vazba kontakt "A"')).toMatch(/chybí cílová komponenta B/);
    expect(err("sestava vazba")).toMatch(/sestava vazba kontakt\|zarovnat/);
    expect(err('sestava vazba kontakt "A" F1 "B" F2 hodnota 5')).toMatch(/hodnotu má jen vazba Vzdálenost a Úhel/);
    expect(err('sestava vazba kontakt "A" F1 "B" F2 blabla')).toMatch(/neznámá volba „blabla“/);
    expect(err("sestava vazba 2")).toMatch(/co s ní\?/);
    expect(err('sestava pole "A" 1 rozteč 5')).toMatch(/alespoň 2/);
    expect(err('sestava pole "A" 3')).toMatch(/potřebuje rozteč/);
    expect(err('sestava komponenta "A" nesmysl')).toMatch(/neznámá volba „nesmysl“ – volby: v x y z/);
    expect(err('sestava komponenta "A" barva červená')).toMatch(/#rrggbb/);
    expect(err("sestava plochy")).toMatch(/chybí název komponenty/);
    expect(err("rám formy 50 50")).toMatch(/alespoň 100 mm/);
    expect(err("rám formy 296")).toMatch(/šířku i délku/);
    expect(err("rám formy 296 346 dutina 400 100 10")).toMatch(/se nevejde do desky A/);
    expect(err("rám formy materiál žula")).toMatch(/neznámý materiál „žula“ – materiály: ocel, nerez/);
    expect(err("kusovník blabla")).toMatch(/kusovník \[strukturovaně\]/);
    expect(err("zavřít okno")).toMatch(/zavřít záložku/);
    // žádná z hlášek není „neznámý příkaz“ (test seznamu příkazů v agent-more.test.ts)
    for (const w of ["sestava", "kusovník", "rám", "záložky", "záložka", "zavřít", "assembly faces", "assembly mate", "close tab", "registerkarte schließen"]) expect(err(w)).not.toMatch(/neznámý příkaz/);
  });

  it("anglické hlášky", () => {
    setLang("en");
    expect(err("assembly nonsense")).toMatch(/unknown assembly subcommand „nonsense“/i);
  });
});

/* ───────────────────────── pravidla ploch ───────────────────────── */

const row = (face: number, kind: "plane" | "cylinder", origin: Vec3, normal: Vec3, extra: Partial<CompFaceRow> = {}): CompFaceRow => ({ face, kind, origin, normal, leafId: "c", ...extra });
const ROWS: CompFaceRow[] = [
  row(0, "plane", [0, 0, 0], [0, 0, -1], { area: 78.5 }),
  row(1, "cylinder", [0, 0, 15], [0, 0, 1], { radius: 5, length: 30 }),
  row(2, "plane", [0, 0, 30], [0, 0, -1], { area: 122.5 }),
  row(3, "cylinder", [0, 0, 32.5], [0, 0, 1], { radius: 8, length: 5 }),
  row(4, "plane", [0, 0, 35], [0, 0, 1], { area: 201 }),
  row(5, "plane", [8, 0, 0], [1, 0, 0], { area: 10 }),
  row(6, "cylinder", [0, 0, 1], [0, 0, 1], { radius: 2, length: 2, cone: true }),
];
const spec = (line: string) => (parseAsmText("assembly", `sestava vazba souosost "A" ${line} "B"`) as Extract<AsmCmd, { k: "mate" }>).faceA;

describe("výběr plochy podle čísla a pravidla (pickFace)", () => {
  it("číslo, strana, horní/spodní, největší/nejmenší, průměr, kužel", () => {
    expect(pickFace(spec("F3"), ROWS, "plane", "Čep").row.face).toBe(2);
    expect(pickFace(spec("+Z"), ROWS, "plane", "Čep").row.face).toBe(4);
    expect(pickFace(spec("−Z největší"), ROWS, "plane", "Čep").row.face).toBe(2); // „−Z“ zkopírované z výpisu ploch
    expect(pickFace(spec("horní"), ROWS, "plane", "Čep").row.face).toBe(4);
    // -Z: dvě plochy → krajní ve směru -Z (nejníž); „největší“ vybere podle velikosti
    const low = pickFace(spec("-Z"), ROWS, "plane", "Čep");
    expect(low.row.face).toBe(0);
    expect(low.note).toMatch(/F1 z 2 vyhovujících/);
    expect(pickFace(spec("spodní největší"), ROWS, "plane", "Čep").row.face).toBe(2);
    expect(pickFace(spec("-Z nejmenší"), ROWS, "plane", "Čep").row.face).toBe(0);
    expect(pickFace(spec("největší"), ROWS, "plane", "Čep").row.face).toBe(4);
    expect(pickFace(spec("Ø10"), ROWS, "cylinder", "Čep").row.face).toBe(1);
    expect(pickFace(spec("válcová Ø16"), ROWS, "cylinder", "Čep").row.face).toBe(3);
    expect(pickFace(spec("R5"), ROWS, "cylinder", "Čep").row.face).toBe(1);
    expect(pickFace(spec("válcová"), ROWS, "cylinder", "Čep").row.face).toBe(3); // největší průměr
    expect(pickFace(spec("kuželová"), ROWS, "cylinder", "Čep").row.face).toBe(6);
    expect(pickFace(spec("+X"), ROWS, "plane", "Čep").row.face).toBe(5);
  });
  it("chyby: plocha nevyhovuje druhu vazby, nic neodpovídá, chybí plocha – s výčtem ploch", () => {
    expect(() => pickFace(spec("F2"), ROWS, "plane", "Čep")).toThrow(/plocha F2 komponenty „Čep“ je válcová Ø10 – vazba potřebuje rovinnou plochu; rovinné plochy: F5 rovinná \+Z/);
    expect(() => pickFace(spec("F99"), ROWS, "plane", "Čep")).toThrow(/nemá plochu F99/);
    expect(() => pickFace(spec("Ø12"), ROWS, "cylinder", "Čep")).toThrow(/žádná válcová plocha neodpovídá „Ø12“ – válcové plochy: F4 válcová Ø16, F2 válcová Ø10/);
    expect(() => pickFace(spec("válcová"), ROWS, "plane", "Čep")).toThrow(/vazba potřebuje rovinnou plochu, ne válcovou/);
    expect(() => pickFace(spec("rovinná"), ROWS, "cylinder", "Čep")).toThrow(/vazba potřebuje válcovou plochu, ne rovinnou/);
    expect(() => pickFace(undefined, ROWS, "plane", "Čep")).toThrow(/chybí plocha komponenty „Čep“/);
    // jediná válcová plocha → bez zadání se vezme ona (šroub do díry)
    expect(pickFace(undefined, [ROWS[1]], "cylinder", "Deska").row.face).toBe(1);
  });
});

/* ───────────────────────── provedení s náhradním jádrem ───────────────────────── */

const P = (o: Vec3, n: Vec3): PartFace => ({ kind: "plane", origin: o, normal: n });
const C = (o: Vec3, n: Vec3, r: number, ext: [number, number]): PartFace => ({ kind: "cylinder", origin: o, normal: n, radius: r, extent: ext });
/** plochy dílů podle názvu dokumentu (souřadnice dílu) */
const FACES: Record<string, PartFace[]> = {
  Deska: [P([40, 30, 0], [0, 0, -1]), P([40, 30, 10], [0, 0, 1]), P([0, 30, 5], [-1, 0, 0]), P([80, 30, 5], [1, 0, 0]), P([40, 0, 5], [0, -1, 0]), P([40, 60, 5], [0, 1, 0]), C([40, 30, 0], [0, 0, 1], 5.25, [0, 10]), C([20, 15, 0], [0, 0, 1], 4.5, [0, 10])],
  Čep: [P([0, 0, 0], [0, 0, -1]), C([0, 0, 0], [0, 0, 1], 5, [0, 30]), P([0, 0, 30], [0, 0, -1]), C([0, 0, 30], [0, 0, 1], 8, [0, 5]), P([0, 0, 35], [0, 0, 1])],
  Šroub: [C([0, 0, -25], [0, 0, 1], 4, [0, 25]), P([0, 0, -25], [0, 0, -1])],
  Matice: [C([0, 0, 0], [0, 0, 1], 3.4, [0, 6.8])],
  Podložka: [P([0, 0, 0], [0, 0, -1])],
};
const VOL: Record<string, number> = { Deska: 46000, Čep: 3000 };
function mockEnv(extra: Partial<AsmEnv> = {}) {
  const src = new Map<string, ComponentSource>();
  const nameOf = (key: string) => {
    const s = src.get(key);
    const n = s && s.kind !== "file" ? s.doc.name : "";
    return Object.keys(FACES).find((k) => n.startsWith(k)) ?? n;
  };
  const calls = { parts: 0 };
  const env: AsmEnv = {
    parts: async (list) => {
      calls.parts++;
      return list.map((p) => {
        src.set(p.key, p.source);
        const n = nameOf(p.key);
        const faces = FACES[n]?.length ?? 0;
        const result: BuildResult = { status: [], mesh: null, metrics: { volume: VOL[n] ?? 1000, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces, edges: 0 }, ms: 0 };
        return { key: p.key, result };
      });
    },
    mateFace: async (key, i) => FACES[nameOf(key)]?.[i] ?? null,
    cylFace: async (key, r) => (FACES[nameOf(key)] ?? []).findIndex((f) => f.kind === "cylinder" && Math.abs((f.radius ?? 0) - r) < 0.05),
    geo: new Map(),
    faceLists: new Map(),
    stack: [],
    ...extra,
  };
  return { env, calls };
}
const part = (name: string, material = "ocel"): CadDoc => ({ ...emptyDoc(name), kind: "part", material, features: [{ id: `${name}-box`, name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" }] });
function asm(): CadDoc {
  const deska = partComponent(part("Deska"), {}, { id: "deska" } as never);
  const cep = partComponent(part("Čep"), { position: [100, 0, 0] }, { id: "cep" } as never);
  return { ...emptyAssembly("Sestava"), components: [{ ...deska, id: "deska" }, { ...cep, id: "cep" }] };
}
const run = async (d: CadDoc, line: string, env: AsmEnv) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, env);
};
const posOf = (d: CadDoc, name: string) => d.components!.find((c) => c.name === name)!.placement.position;

describe("provedení: plochy, vazby, komponenty (náhradní jádro)", () => {
  it("sestava plochy: F-čísla, druh, normála / osa, střed v souřadnicích sestavy", async () => {
    const { env } = mockEnv();
    const r = await run(asm(), 'sestava plochy "Čep" válcové', env);
    expect(r.changed).toBe(false);
    expect(r.log[0]).toMatch(/Plochy komponenty „Čep“ .* – rovinné: 3, válcové\/kuželové: 2 – vypsány válcové/);
    expect(r.log).toContain(" F4 · válcová Ø16 · osa Z · střed osy [100; 0; 32,5] · délka 5 mm");
    expect(r.log).toContain(" F2 · válcová Ø10 · osa Z · střed osy [100; 0; 15] · délka 30 mm");
    const all = await run(asm(), 'sestava plochy "Deska"', env);
    expect(all.log.some((l) => /^ F2 · rovinná · normála \+Z · střed \[40; 30; 10\]/.test(l))).toBe(true);
    await expect(run(asm(), 'sestava plochy "Nic"', env)).rejects.toThrow(/komponenta „Nic“ v sestavě není – komponenty: #1 Deska, #2 Čep/);
  });

  it("souosost + kontakt posunou čep do díry; výpis vazeb, stav, úprava a smazání vazby", async () => {
    const { env } = mockEnv();
    let d = asm();
    let r = await run(d, 'sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5', env);
    expect(r.log[0]).toMatch(/^✓ vazba Souosost „Čep“ F2 → „Deska“ F7: ok · „Čep“ poloha \[40; 30; 0\]/);
    d = r.doc;
    r = await run(d, 'sestava vazba kontakt "Čep" F3 "Deska" horní', env);
    expect(r.log[0]).toMatch(/^✓ vazba Kontakt „Čep“ F3 → „Deska“ F2: ok · „Čep“ poloha \[40; 30; -20\]/);
    d = r.doc;
    expect(posOf(d, "Čep")).toEqual([40, 30, -20]);
    expect(Object.values(r.mateStatus!)).toEqual(["ok", "ok"]);
    // výpis vazeb a stav dokumentu
    const ls = await run(d, "sestava vazby", env);
    expect(ls.log[0]).toBe("Vazby sestavy „Sestava“: 2 (2 ok)");
    expect(ls.log[1]).toBe(" 1. Souosost „Čep“ F2 → „Deska“ F7 – ok");
    const st = docStatusText(d, null, { components: 2, parts: 2, mates: ls.mateStatus });
    expect(st).toMatch(/Komponenty: Deska \[0; 0; 0\] · Čep \[40; 30; -20\]/);
    expect(st).toMatch(/Vazby: 2 \(2 ok\)/);
    // vzdálenost bez hodnoty = naměřená (čep zůstane), s hodnotou se posune
    r = await run(d, 'sestava vazba vzdálenost "Čep" F5 "Deska" F2', env);
    expect(r.log[0]).toMatch(/Vzdálenost „Čep“ F5 → „Deska“ F2 · 5 mm · obráceně: ok · poloha beze změny/);
    d = r.doc;
    r = await run(d, "sestava vazba 3 hodnota=8", env);
    // vzdálenost 8 mm odporuje kontaktu (hlava na desce) → vazba 3 splněna, kontakt v konfliktu
    expect(r.log[0]).toMatch(/^✓ vazba 3 \(Vzdálenost .* 8 mm .*\): hodnota 8 mm · ok/);
    expect(r.log).toContain("⚠ v sestavě je konflikt vazeb – sestava vazby");
    expect(Object.values(r.mateStatus!)).toEqual(["ok", "conflict", "ok"]);
    r = await run(r.doc, "sestava vazba 3 smazat", env);
    expect(r.log[0]).toMatch(/^✓ vazba 3 \(Vzdálenost\): smazána/);
    expect(r.doc.mates).toHaveLength(2);
    r = await run(r.doc, "sestava vazba 1 potlačit", env);
    expect(r.doc.mates![0].suppressed).toBe(true);
    expect(r.mateStatus![r.doc.mates![0].id]).toBe("suppressed");
    await expect(run(d, "sestava vazba 9 smazat", env)).rejects.toThrow(/vazba 9 v sestavě není – vazby: 1. Souosost, 2. Kontakt, 3. Vzdálenost/);
    await expect(run(d, "sestava vazba 1 hodnota=5", env)).rejects.toThrow(/nemá hodnotu – hodnotu má Vzdálenost, Úhel, Ozubení/);
    await expect(run(d, 'sestava vazba kontakt "Čep" F2 "Deska" F2', env)).rejects.toThrow(/A: plocha F2 komponenty „Čep“ je válcová Ø10 – vazba potřebuje rovinnou plochu/);
    await expect(run(d, 'sestava vazba kontakt "Čep" F1 "Čep" F3', env)).rejects.toThrow(/dvě různé komponenty/);
  });

  it("ukotvit, komponenta (přesun s přepočtem vazeb, popis, materiál), odebrat, duplikovat, izolovat", async () => {
    const { env } = mockEnv();
    let d = (await run(asm(), 'sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5', env)).doc;
    let r = await run(d, 'sestava vazba ukotvit "Deska"', env);
    expect(r.log[0]).toMatch(/vazba Ukotvit „Deska“/);
    expect(r.doc.components![0].fixed).toBe(true);
    d = r.doc;
    // přesun čepu: vazba souosost ho vrátí do osy díry (pohyblivá je přesunutá komponenta → vazba hýbe deskou? ne – deska je ukotvená)
    r = await run(d, 'sestava komponenta "Čep" v 0 0 50 název "Kolík" číslo "K-1" skupina "Vedení" materiál nerez barva #00ff00', env);
    expect(r.log[0]).toMatch(/^✓ komponenta „Čep“: poloha \[0; 0; 50\] · barva #00ff00 · název „Kolík“ · číslo „K-1“ · skupina „Vedení“ · materiál Nerez/);
    const k = r.doc.components!.find((c) => c.name === "Kolík")!;
    expect(k.number).toBe("K-1");
    expect(k.source.kind === "part" && k.source.doc.material).toBe("nerez");
    expect(r.mateStatus && Object.values(r.mateStatus).includes("conflict")).toBe(true); // ukotvená deska + přesunutý čep mimo osu
    d = r.doc;
    r = await run(d, 'sestava komponenta "Kolík" materiál "1.4301 X5CrNi18-10"', env);
    const k2 = r.doc.components!.find((c) => c.name === "Kolík")!;
    expect(k2.source.kind === "part" && k2.source.doc.materialName).toBe("1.4301 X5CrNi18-10");
    r = await run(d, 'sestava uvolnit "Deska"', env);
    expect(r.doc.components![0].fixed).toBe(false);
    expect(r.doc.mates!.some((m) => m.type === "fixed")).toBe(false);
    r = await run(d, 'sestava duplikovat "Kolík" posun 0 20 0', env);
    expect(r.doc.components!.map((c) => c.name)).toEqual(["Deska", "Kolík", "Kolík"]);
    expect(r.log[0]).toBe("✓ kopie „Kolík“ → #3 poloha [0; 20; 50]");
    expect(r.doc.components![2].placement.position).toEqual([0, 20, 50]);
    await expect(run(r.doc, 'sestava izolovat "Kolík"', env)).rejects.toThrow(/„Kolík“ je v sestavě 2× – zadejte pořadí: #2, #3/);
    r = await run(r.doc, "sestava izolovat #3", env);
    expect(r.doc.components!.map((c) => !!c.hidden)).toEqual([true, true, false]);
    r = await run(r.doc, "sestava zobrazit vše", env);
    expect(r.doc.components!.every((c) => !c.hidden)).toBe(true);
    r = await run(r.doc, "sestava odebrat #2", env);
    expect(r.log[0]).toMatch(/odebráno ze sestavy: „Kolík“ \(a jejich vazby: 1\) · zbývá komponent: 2/);
    expect(r.doc.mates!.every((m) => m.a.compId !== k.id && m.b.compId !== k.id)).toBe(true);
    const list = await run(r.doc, "sestava", env);
    expect(list.log[0]).toMatch(/Sestava „Sestava“: komponent 2/);
    expect(list.log[1]).toMatch(/^ #1 Deska · díl · poloha \[0; 0; 0\] · ukotvená ⚓/);
    expect(componentLines(r.doc)[2]).toMatch(/#2 Kolík · díl · poloha \[0; 20; 50\]/);
  });

  it("pole, zrcadlení, šroub do díry (podložka, matice, vazba Souosost)", async () => {
    const { env } = mockEnv();
    let r = await run(asm(), 'sestava pole "Čep" 3 rozteč 20 směr Y', env);
    expect(r.doc.components!.map((c) => c.name)).toEqual(["Deska", "Čep", "Čep (2)", "Čep (3)"]);
    expect(posOf(r.doc, "Čep (3)")).toEqual([100, 40, 0]);
    expect(r.log[0]).toMatch(/pole „Čep“: 3 ks \(lineární, rozteč 20 mm/);
    r = await run(asm(), 'sestava pole "Čep" kruhové 4 osa Z v 0 0 0', env);
    expect(posOf(r.doc, "Čep (3)")).toEqual([-100, 0, 0]);
    r = await run(asm(), 'sestava zrcadlit "Čep" YZ odsazení 10', env);
    expect(posOf(r.doc, "Čep (zrcadlo)")).toEqual([-80, 0, 0]);
    r = await run(asm(), 'sestava šroub "Deska" Ø9 matice', env);
    expect(r.log[0]).toMatch(/^✓ šroub „Šroub M8×\d+“ \(ISO 4762 – M8×\d+ – 12\.9\) do díry F8 komponenty „Deska“ \(Ø9, délka díry 10 mm\) \+ podložka \+ matice · vazba Souosost: ok · poloha \[20; 15; 11,6\]/);
    const names = r.doc.components!.map((c) => c.name);
    expect(names.filter((n) => n.startsWith("Podložka"))).toEqual(["Podložka M8", "Podložka M8"]); // jako v panelu – v kusovníku 2 ks
    expect(names.some((n) => n.startsWith("Matice M8"))).toBe(true);
    expect(r.doc.mates!.map((m) => m.type)).toEqual(["concentric", "concentric"]);
    expect(r.doc.mates![0].a.face).toBe(0); // poloměr → index válcové plochy šroubu
    expect(posOf(r.doc, "Matice M8")).toEqual([20, 15, -1.6]);
    const flip = await run(asm(), 'sestava šroub "Deska" F8 obráceně bez podložky', env);
    expect(posOf(flip.doc, flip.doc.components![2].name)).toEqual([20, 15, 0]);
    expect(flip.doc.components![2].placement.rotation.map((v) => Math.abs(v))).toContain(180);
    await expect(run(asm(), 'sestava šroub "Deska"', env)).rejects.toThrow(/chybí plocha komponenty „Deska“/);
    await expect(run(asm(), 'sestava šroub "Deska" F2', env)).rejects.toThrow(/je rovinná – vazba potřebuje válcovou plochu/);
  });
});

describe("provedení: podsestavy, úprava v kontextu, otevřít, kusovník, rám formy, záložky", () => {
  it("podsestava převezme vazby (cesta listu), rozpuštění je vrátí", async () => {
    const { env } = mockEnv();
    let d = (await run(asm(), 'sestava vazba souosost "Čep" Ø10 "Deska" Ø10,5', env)).doc;
    const cep = d.components![1];
    d = { ...d, components: [...d.components!, { ...partComponent(part("Čep"), { position: [0, 50, 0] }), id: "cep2", name: "Čep 2" }] };
    let r = await run(d, 'sestava podsestava "Čep" "Čep 2" jako "Kolíky"', env);
    expect(r.doc.components!.map((c) => c.name)).toEqual(["Deska", "Kolíky"]);
    const sub = r.doc.components![1];
    expect(r.doc.mates![0].a).toMatchObject({ compId: sub.id, leaf: `${sub.id}/${cep.id}`, face: 1 });
    expect(r.mateStatus![r.doc.mates![0].id]).toBe("ok");
    expect(r.log[0]).toMatch(/^✓ podsestava „Kolíky“: „Čep“, „Čep 2“$/);
    // plochy podsestavy: díl › F2@díl
    const faces = await compFaces(r.doc, sub.id, env);
    expect(faces.rows.some((x) => x.part === "Čep 2")).toBe(true);
    const r2 = await run(r.doc, 'sestava vazba kontakt "Kolíky" F3@Čep "Deska" horní', env);
    expect(r2.doc.mates![1].a).toMatchObject({ compId: sub.id, leaf: `${sub.id}/${cep.id}`, face: 2 });
    r = await run(r2.doc, 'sestava rozpustit "Kolíky"', env);
    expect(r.doc.components!.map((c) => c.name)).toEqual(["Deska", "Čep", "Čep 2"]);
    const back = r.doc.components![1].id;
    expect(r.doc.mates!.map((m) => m.a.compId)).toEqual([back, back]);
    expect(r.doc.mates![0].a.leaf).toBeUndefined();
    expect(Object.values(r.mateStatus!)).toEqual(["ok", "ok"]);
    expect(posOf(r.doc, "Čep")).toEqual([40, 30, -20]);
    await expect(run(r.doc, 'sestava rozpustit "Deska"', env)).rejects.toThrow(/není podsestava/);
  });

  it("úprava dílu v kontextu: upravit … hotovo propíše změnu do všech stejných komponent", async () => {
    const { env } = mockEnv();
    const d0 = (await run(asm(), 'sestava pole "Čep" 2 rozteč 30', env)).doc;
    const r = await run(d0, 'sestava upravit "Čep"', env);
    expect(r.stackChanged).toBe(true);
    expect(r.doc.kind).toBe("part");
    expect(env.stack).toHaveLength(1);
    expect(r.log[0]).toMatch(/úprava dílu „Čep“ v kontextu sestavy „Sestava“ \(změna platí pro všechny stejné komponenty: 2\)/);
    const edited: CadDoc = { ...r.doc, features: [...r.doc.features, { id: "h", name: "Díra 1", type: "hole", position: [0, 0, 35], axis: "Z", flip: false, diameter: 3, depth: 0, cbDiameter: 0, cbDepth: 0 }] };
    const back = await run(edited, "sestava hotovo", env);
    expect(back.doc.kind).toBe("assembly");
    expect(env.stack).toHaveLength(0);
    expect(back.log[0]).toMatch(/„Čep“ vrácen do sestavy „Sestava“ \(změnu převzalo komponent: 2\)/);
    for (const c of back.doc.components!.slice(1)) expect(c.source.kind === "part" && c.source.doc.features.map((f) => f.name)).toEqual(["Kvádr 1", "Díra 1"]);
    await expect(run(back.doc, "sestava hotovo", env)).rejects.toThrow(/žádná rozpracovaná úprava/);
    await expect(run(edited, 'sestava plochy "Čep"', env)).rejects.toThrow(/není sestava – .*sestava hotovo/);
    const open = await run(d0, 'sestava otevřít "Čep"', env);
    expect(open.newTab).toBe(true);
    expect(open.doc).toMatchObject({ kind: "part", name: "Čep" });
  });

  it("kusovník: plochý / strukturovaný, text a CSV; hmotnost z objemu a materiálu", async () => {
    const { env } = mockEnv();
    const d = (await run(asm(), 'sestava pole "Čep" 2 rozteč 30', env)).doc;
    const b = await bomData(d, env, false);
    expect(b.rows.map((x) => [x.name, x.qty, x.material])).toEqual([
      ["Deska", 1, "Ocel"],
      ["Čep", 1, "Ocel"],
      ["Čep (2)", 1, "Ocel"],
    ]);
    expect(b.rows[0].massKg).toBeCloseTo(0.3611, 4);
    expect(b.text.split("\n")[0]).toBe("Kusovník „Sestava“ (plochý): položek 3, kusů 3, hmotnost Σ 0,408 kg");
    expect(b.text.split("\n")[2]).toBe("1 | Deska |  | 1 | Ocel | 0,361");
    expect(b.csv).toBe(bomCsv(b.rows));
    expect(b.csv).toMatch(/^﻿Pozice;Název;Číslo výkresu \/ norma;Ks;Materiál/);
    const r = await run(d, "kusovník csv", env);
    expect(r.log[0]).toMatch(/^Kusovník „Sestava“ \(plochý\)/);
    expect(r.log[1]).toBe("CSV (oddělovač ;):");
    const sub = (await run(d, 'sestava podsestava "Čep" "Čep (2)" jako "Kolíky"', env)).doc;
    const s = await bomData(sub, env, true);
    expect(s.rows.map((x) => [x.name, x.qty, x.level ?? 0])).toEqual([
      ["Kolíky", 1, 0],
      ["Čep", 1, 1],
      ["Čep (2)", 1, 1],
      ["Deska", 1, 0],
    ]);
    expect(s.text).toMatch(/\(strukturovaný\)/);
    expect(s.text).toMatch(/\n {2}2 \| Čep \|/);
    const rows: BomRow[] = [{ pos: 1, name: "A", qty: 2, massKg: 1.5, ids: [] }];
    expect(bomText(rows, "X", false)).toBe("Kusovník „X“ (plochý): položek 1, kusů 2, hmotnost Σ 3 kg\nPoz. | Název | Číslo / norma | Ks | Materiál | kg/ks\n1 | A |  | 2 |  | 1,5");
  });

  it("rám formy: parametry → sestava v nové záložce", async () => {
    const { env } = mockEnv();
    const r = await run(emptyDoc("Díl"), "rám formy 246 296 dutina 100 120 20", env);
    expect(r.newTab).toBe(true);
    expect(r.doc.kind).toBe("assembly");
    expect(r.doc.name).toBe("Rám formy 246×296");
    expect(r.doc.components!.length).toBeGreaterThan(20);
    expect(r.log[0]).toMatch(/^✓ rám formy „Rám formy 246×296“ – nová záložka: komponent \d+, 246×296 mm, výška 308 mm \(se středicím kroužkem\), dutina 100×120×20, materiál 1\.2311/);
  });

  it("záložky: výpis, přepnutí podle názvu / čísla, zavření", async () => {
    let tabs: TabInfo[] = [
      { id: "t1", title: "Deska", kind: "part", active: false },
      { id: "t2", title: "Sestava", kind: "assembly", active: true },
      { id: "t3", title: "Výkres – Deska", kind: "drawing", active: false },
    ];
    const docs: Record<string, CadDoc> = { t1: part("Deska"), t2: asm(), t3: part("Deska") };
    const { env } = mockEnv({
      tabs: {
        list: () => tabs,
        activate: async (id) => {
          tabs = tabs.map((t) => ({ ...t, active: t.id === id }));
          return docs[id];
        },
        close: async (id) => {
          tabs = tabs.filter((t) => t.id !== id).map((t, i) => ({ ...t, active: i === 0 }));
          return docs[tabs[0].id];
        },
      },
    });
    let r = await run(asm(), "záložky", env);
    expect(r.log).toEqual(["Záložky (3):", " 1. Deska · díl", " 2. Sestava · sestava · aktivní", " 3. Výkres – Deska · výkres"]);
    r = await run(asm(), 'záložka "deska"', env);
    expect(r.switched).toBe(true);
    expect(r.doc.name).toBe("Deska");
    expect(r.log[0]).toBe("✓ záložka „Deska“ (díl) je aktivní – další příkazy pracují s ní");
    r = await run(asm(), "záložka 1", env);
    expect(r.log[0]).toMatch(/už je aktivní/);
    r = await run(asm(), "zavřít záložku 3", env);
    expect(r.log[0]).toBe("✓ záložka „Výkres – Deska“ zavřena – aktivní je „Deska“");
    await expect(run(asm(), 'záložka "Nic"', env)).rejects.toThrow(/záložka „Nic“ není otevřená – záložky: 1. Deska, 2. Sestava/);
    expect(resolveTab(tabs, "#2").id).toBe("t2");
    expect(() => resolveTab(tabs, 9)).toThrow(/záložka 9 není/);
    const noTabs = mockEnv().env;
    delete noTabs.tabs;
    await expect(run(asm(), "záložky", noTabs)).rejects.toThrow(/jen v aplikaci/);
  });
});

describe("čisté pomocné: komponenty, vazby, stav", () => {
  it("findComp / findMate s výčtem a pořadím; stav sestavy", () => {
    const d = asm();
    expect(findComp(d, "čep").id).toBe("cep");
    expect(findComp(d, "#1").id).toBe("deska");
    const dup = { ...d, components: [...d.components!, { ...d.components![1], id: "x" }] };
    expect(() => findComp(dup, "Čep")).toThrow(/„Čep“ je v sestavě 2× – zadejte pořadí: #2, #3/);
    expect(() => findComp(d, "#5")).toThrow(/komponenta #5 v sestavě není/);
    const withMates: CadDoc = { ...d, mates: [{ id: "m1", type: "concentric", a: { compId: "cep", face: 1 }, b: { compId: "deska", face: 6 } }, { id: "m2", type: "fixed", a: { compId: "deska", face: -1 }, b: { compId: "deska", face: -1 } }] };
    expect(findMate(withMates, "souosost").id).toBe("m1");
    expect(findMate(withMates, "2").id).toBe("m2");
    expect(mateLines(withMates, { m1: "ok", m2: "ok" })).toEqual(["Vazby sestavy „Sestava“: 2 (2 ok)", " 1. Souosost „Čep“ F2 → „Deska“ F7 – ok", " 2. Ukotvit „Deska“ – ok"]);
    expect(asmStatusLines(withMates, { m1: "conflict", m2: "ok" })).toEqual(["Komponenty: Deska [0; 0; 0] ⚓ · Čep [100; 0; 0]", "Vazby: 2 (1 konflikt, 1 ok)"]);
    expect(asmStatusLines(withMates)).toEqual(["Komponenty: Deska [0; 0; 0] ⚓ · Čep [100; 0; 0]", "Vazby: 2 (stav se přepočítá)"]);
    expect(docStatusText(withMates, null)).toMatch(/Komponenty: Deska \[0; 0; 0\] ⚓ · Čep \[100; 0; 0\]\nVazby: 2 \(stav se přepočítá\)/);
  });

  it("sameFace: táž plocha po přečíslování (rovina ve stejné rovině, válec na stejné ose)", () => {
    const faces = [
      { face: 0, info: P([10, 0, 10], [0, 0, 1]) },
      { face: 1, info: C([40, 30, -5], [0, 0, -1], 5.25, [0, 10]) },
      { face: 2, info: P([40, 30, 0], [0, 0, -1]) },
      { face: 3, info: P([70, 0, 10], [0, 0, 1]) },
    ];
    expect(sameFace(P([40, 30, 10], [0, 0, 1]), faces)).toBe(0); // horní plocha s kapsou: střed se posunul, rovina stejná
    expect(sameFace(C([40, 30, 0], [0, 0, 1], 5.25, [0, 10]), faces)).toBe(1);
    expect(sameFace(P([40, 30, 0], [0, 0, -1]), faces)).toBe(2);
    expect(sameFace(C([20, 15, 0], [0, 0, 1], 4.5, [0, 10]), faces)).toBeNull();
  });

  it("přepočet vazeb doplní index válcové plochy normálie podle poloměru", async () => {
    const { env } = mockEnv();
    const d: CadDoc = { ...asm(), mates: [{ id: "m", type: "concentric", a: { compId: "cep", face: -1, radius: 5 }, b: { compId: "deska", face: 6 } }] };
    const s = await solveAsm(d, env);
    expect(s.doc.mates![0].a.face).toBe(1);
    expect(s.status.m).toBe("ok");
    expect(posOf(s.doc, "Čep")).toEqual([40, 30, 0]);
    expect(sourceKey(s.doc.components![1].source)).toBe(sourceKey(d.components![1].source));
  });
});
