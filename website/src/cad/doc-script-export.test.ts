/**
 * Převodník dokument → skript, vlna E (bez jádra): nové textové příkazy (`výkres vygenerované …`, `sestava pružina … vedená`),
 * zápis voleb listu a poznámky / komentáře u toho, co skript nepřenese. Tam a zpět se skutečným jádrem:
 * doc-script-export.roundtrip.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { docToScript, scriptQuote } from "./doc-script";
import { aliasScript } from "./doc-script-asm";
import { sheetUnwritable } from "./doc-script-sheet";
import type { CadDoc } from "./types";

const op = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return p.ops[0] as unknown as { k: string; cmd: Record<string, unknown> };
};
const part = (drawing: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): CadDoc =>
  ({
    app: "mnastrojarna-cad",
    version: 2,
    name: "Deska",
    kind: "part",
    material: "ocel",
    features: [{ id: "b", name: "Kvádr 1", type: "box", size: [100, 60, 10], position: [0, 0, 0], centered: false, mode: "new" }],
    drawings: [{ id: "s1", name: "List 1", options: { sheet: "A3", orientation: "landscape", scale: "auto", projection: "E", views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: true }, hidden: false, section: null, centerLines: true, dimensions: "smart", balloons: true, holeTable: false, details: [], rotation: 0, models: [], ...drawing }, meta, annotations: [] }],
  }) as unknown as CadDoc;

/** sestava bez komponent se stejným listem (pozice a kóty celkových rozměrů jsou u sestavy) */
const asm = (drawing: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): CadDoc => ({ ...part(drawing, meta), name: "Sestava", kind: "assembly", features: [], components: [] }) as unknown as CadDoc;
/** řádky skriptu od řádku `from` (regulární výraz) do konce, bez komentářů */
const linesOf = (text: string) => text.split("\n").filter((l) => l && !l.startsWith("#"));

describe("výkres vygenerované – rozbor cs / en / de", () => {
  it("přehled, skrýt, zobrazit, posun, obnovit", () => {
    expect(op("výkres vygenerované").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "list", keys: [] } });
    expect(op("výkres vygenerované skrýt dim:front:t pos:3").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "hide", keys: ["dim:front:t", "pos:3"] } });
    expect(op("drawing generated show POS:3").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "show", keys: ["pos:3"] } });
    expect(op("zeichnung generiert verschieben pos:1 5 -3,5").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "move", keys: ["pos:1"], d: [5, -3.5] } });
    expect(op("výkres vygenerované obnovit").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "restore", keys: [] } });
    expect(op("drawing generated restore dim:top:l").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "restore", keys: ["dim:top:l"] } });
    // kóta pohledu dalšího modelu na listu (klíč s id modelu – vypíše ho výkres vygenerované)
    expect(op("výkres vygenerované skrýt dim:m:xfijbpd:t").cmd).toEqual({ k: "views", cmd: { op: "gen", act: "hide", keys: ["dim:m:xfijbpd:t"] } });
  });
  it("převodník: skryté / posunuté kóty listu textem; kóty pohledu dalšího modelu (id modelu se po přečtení změní) jen poznámkou", () => {
    const d = asm({ dimensions: "overall", genEdit: { off: ["dim:front:t", "dim:top:l", "dim:m:x1:t"], move: { "pos:2": [1.5, -2], "dim:m:x1:l": [3, 0] } } });
    // klíče listu ověřené jádrem (volba genKeys – doc-script-fresh.ts): skryté jedním řádkem
    const r = docToScript(d, { genKeys: { s1: ["dim:front:t", "dim:front:l", "dim:top:l", "pos:1", "pos:2"] } });
    expect(r.text).toMatch(/^výkres vygenerované skrýt dim:front:t dim:top:l$/m);
    expect(r.text).toMatch(/^výkres vygenerované posun pos:2 1.5 2$/m);
    expect(r.text).not.toMatch(/^výkres vygenerované.*dim:m:/m);
    expect(r.notes.join(" ")).toContain("úprava vygenerovaných kót a pozic (dim:m:x1:t, dim:m:x1:l) listu „List 1“ nejde zapsat textem");
    expect(r.notes.join(" ")).not.toMatch(/už na listu nejsou|nejsou ověřené jádrem/);
  });
  it("kontrola: úprava vygenerovaného objektu, který už na listu není, se nezapíše (✗ při čtení) – poznámka; platné klíče zůstanou", () => {
    const edit = { off: ["dim:front:t", "dim:left:t"], move: { "pos:3": [4, -4], "pos:1": [2, 0] } };
    // jádro: na listu je jen dim:front:t a pos:1 (levý pohled vypnutý, komponenta 3 odebraná)
    const r = docToScript(asm({ dimensions: "overall", genEdit: edit }), { genKeys: { s1: ["dim:front:t", "dim:front:l", "dim:top:l", "pos:1", "pos:2"] } });
    expect(r.text.split("\n").filter((l) => l.startsWith("výkres vygenerované"))).toEqual(["výkres vygenerované skrýt dim:front:t", "výkres vygenerované posun pos:1 2 0"]);
    expect(r.notes).toContain("úpravy vygenerovaných kót a pozic listu „List 1“, které už na listu nejsou (dim:left:t, pos:3), skript vynechá");
    // bez jádra: co na listu podle voleb být nemůže, se vynechá (vypnutý pohled; Chytré kóty dílu; pozice mimo sestavu / bez balónků),
    // zbytek po jednom řádku (odmítnutý řádek nevezme s sebou platné klíče) a poznámka, že klíče ověřuje jádro
    const pure = docToScript(asm({ dimensions: "overall", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: true }, genEdit: edit }));
    expect(pure.text.split("\n").filter((l) => l.startsWith("výkres vygenerované"))).toEqual(["výkres vygenerované skrýt dim:front:t", "výkres vygenerované posun pos:3 4 4", "výkres vygenerované posun pos:1 2 0"]);
    expect(pure.notes.join(" | ")).toContain("které už na listu nejsou (dim:left:t), skript vynechá");
    expect(pure.notes.join(" | ")).toContain("úpravy vygenerovaných kót a pozic listu „List 1“ nejsou ověřené jádrem");
    // díl s Chytrými kótami (kótovat celkově → skrýt → kótovat chytře): kóty celkových rozměrů na listu nejsou, pozice také ne
    const smart = docToScript(part({ genEdit: { off: ["dim:front:t"], move: { "dim:front:l": [-6, 0], "pos:2": [1, 1] } } }));
    expect(smart.text).not.toContain("výkres vygenerované");
    expect(smart.notes).toContain("úpravy vygenerovaných kót a pozic listu „List 1“, které už na listu nejsou (dim:front:t, dim:front:l, pos:2), skript vynechá");
    expect(docToScript(asm({ dimensions: "overall", balloons: false, genEdit: { off: ["pos:1"] } })).text).not.toContain("výkres vygenerované");
    expect(docToScript(asm({ dimensions: "none", genEdit: { off: ["dim:front:t"] } })).text).not.toContain("výkres vygenerované");
  });
  it("chyby: neznámé slovo, klíč, posun bez dvou čísel", () => {
    expect(parseAgentText("výkres vygenerované smazat pos:1").errors[0]?.message).toMatch(/výkres vygenerované: neznámé „smazat“/);
    expect(parseAgentText("výkres vygenerované skrýt a3").errors[0]?.message).toMatch(/„a3“ není klíč vygenerovaného objektu/);
    expect(parseAgentText("výkres vygenerované posun pos:1 5").errors[0]?.message).toMatch(/jeden klíč a posun/);
    expect(parseAgentText("výkres vygenerované skrýt").errors[0]?.message).toMatch(/výkres vygenerované skrýt\|zobrazit/);
  });
});

describe("sestava pružina … vedená ano|ne", () => {
  it("cs / en / de, bez slova ano = ano", () => {
    const sp = (l: string) => (op(l).cmd as { guided?: boolean }).guided;
    expect(sp('sestava pružina "P" mezi #1 F3 #2 F6 volná 41 vedená ano')).toBe(true);
    expect(sp('sestava pružina "P" vedená ne')).toBe(false);
    expect(sp('sestava pružina "P" vedená')).toBe(true);
    expect(sp('assembly spring "P" guided no')).toBe(false);
    expect(sp('baugruppe feder "P" geführt ja')).toBe(true);
    expect(sp('sestava pružina "P" volná 40')).toBeUndefined();
  });
});

describe("přezdívky komponent (kontrola)", () => {
  const ins = (l: string) => {
    const p = parseAgentText(l);
    return p.errors.length ? p.errors[0].message : (p.ops[0] as unknown as { tab: string; alias?: string; at: number[]; fixed: boolean; rotation: number[] });
  };
  it("vložit … jako \"H\": text v uvozovkách je doslovný – přezdívka ani název záložky se nečtou jako volba (D = průměr, H = výška, V = poloha)", () => {
    for (const a of ["D", "H", "L", "N", "R", "V", "na", "jako", "ukotvit", "otočení", "as", "als", "10", "K 48"])
      expect(ins(`vložit "Q" v 20 0 0 jako "${a}"`), a).toMatchObject({ tab: "Q", alias: a, at: [20, 0, 0], fixed: false });
    expect(ins('vložit "D" otočení 0 90 0 ukotvit jako „V“')).toMatchObject({ tab: "D", alias: "V", rotation: [0, 90, 0], fixed: true });
    expect(ins('insert "H" at 1 2 3 as "R"')).toMatchObject({ tab: "H", alias: "R", at: [1, 2, 3] });
    // bez uvozovek jako dřív
    expect(ins("vložit Základ v 1 2 3 jako Z1 ukotvit")).toMatchObject({ tab: "Základ", alias: "Z1", at: [1, 2, 3], fixed: true });
    expect(ins('vložit "Q" jako')).toMatch(/chybí přezdívka/);
    expect(ins('vložit "Q" jako ""')).toMatch(/chybí přezdívka/);
    expect(ins("vložit v 1 2 3")).toMatch(/vložit potřebuje název/);
  });
  it("převodník: vložit … jako \"…\", a když ho rozbor nepřečte, sestava komponenta #k přezdívka \"…\"; poznámka jen u přezdívky, kterou zapsat nejde", () => {
    const notes: string[] = [];
    const o = { li: 0 as const, line: () => undefined, note: (x: string) => void notes.push(x), n: String, q: scriptQuote };
    const cp = (alias: string) => ({ id: "c", name: "Q", alias }) as unknown as Parameters<typeof aliasScript>[1];
    expect(aliasScript(o, cp("H"), 'vložit "Q"', 2)).toEqual({ tail: ' jako "H"' });
    // rozbor, který přezdívku na řádku vložit nepřečte (stav před opravou): přezdívka řádkem sestava komponenta
    const noInsert = (l: string) => (/^(vložit|insert)/.test(l) ? null : (parseAgentText(l).ops[0] as unknown as { k: string }));
    expect(aliasScript(o, cp("H"), 'vložit "Q"', 2, noInsert)).toEqual({ tail: "", patch: 'přezdívka "H"' });
    expect(aliasScript({ ...o, li: 1 as const }, cp("H"), 'insert "Q"', 2, noInsert)).toEqual({ tail: "", patch: 'alias "H"' });
    expect(notes).toEqual([]);
    expect(aliasScript(o, cp("a\nb"), 'vložit "Q"', 2)).toEqual({ tail: "" });
    expect(notes).toEqual(["přezdívku „a\nb“ komponenty „Q“ nejde zapsat na řádek skriptu"]);
  });
});

describe("převodník: volby listu a poznámky", () => {
  it("volby jen z JSON a neznámé volby listu: poznámka i komentář za hlavičkou skriptu", () => {
    const r = docToScript(part({ dimRoom: 10, weldSymbols: false, budouci: 1 }));
    expect(sheetUnwritable({ dimRoom: 10, weldSymbols: false, budouci: 1, aux: [], smartGen: "x" })).toEqual(["dimRoom", "weldSymbols", "budouci"]);
    const note = "volby listu bez textového příkazu (dimRoom, weldSymbols, budouci) – nastavují se jen v JSON dokumentu, skript je nepřenese – list „List 1“ dokumentu „Deska“";
    expect(r.notes).toContain(note);
    const lines = r.text.split("\n");
    expect(lines.slice(0, 2).every((l) => l.startsWith("# ") && !l.startsWith("# ℹ"))).toBe(true);
    expect(lines[2]).toBe(`# ℹ co skript nepřenese (${r.notes.length}):`);
    expect(lines).toContain(`# ℹ ${note}`);
    // komentáře lze vypnout – poznámky zůstávají v protokolu
    expect(docToScript(part({ dimRoom: 10 }), { comments: false }).text).not.toContain("ℹ");
    // poznámky volajícího (co ověřilo jádro) také do komentáře
    expect(docToScript(part(), { notes: ["ověřeno jádrem"] }).text).toContain("# ℹ ověřeno jádrem");
  });
  it("písmena pohledů po smazání: pořadí, které písmena zopakovat nedokáže, se ohlásí s převodem písmen", () => {
    // pomocný pohled C bez B (B byl smazán) – po přečtení dostane B
    const r = docToScript(part({ aux: [{ id: "x", label: "C", dir: [1, 1, 0] }] }));
    expect(r.text).toMatch(/^výkres pohled pomocný směr 1 1 0$/m);
    expect(r.notes.join(" ")).toContain("se mohou lišit: C → B");
  });
  it("kontrola: nejdřív pohled, na který se odkazuje – pomocný pohled / detail z řezu až po řezu a s písmenem, které řez při čtení dostane", () => {
    // pomocný B, řez C, smazat B, nový pomocný z řezu C (dostal volné B): řez musí být první (dostane B), pohled z něj C
    const cut = { id: "c", label: "C", parent: "top", kind: "stepped", pts: [[-10, -20], [60, -20], [60, -60], [130, -60]] };
    const r = docToScript(part({ sheet: "A1", aux: [{ id: "x", label: "B", parent: "cut:C", dir: [0.5, 0, 0.87] }], cuts: [cut] }));
    const ls = linesOf(r.text);
    const iCut = ls.indexOf("výkres řez zalomený horní body -10 20 60 20 60 60 130 60");
    const iAux = ls.indexOf("výkres pohled pomocný řez B směr 0.5 0 0.87");
    expect(iCut).toBeGreaterThan(0);
    expect(iAux).toBe(iCut + 1);
    expect(r.notes.join(" ")).toMatch(/se mohou lišit: C → B, B → C/);
    // řez C s detailem, pomocný B smazán: řez dostane B a detail se na něj odkáže písmenem B
    const v2 = docToScript(part({ sheet: "A1", cuts: [cut], details: [{ id: "d", label: "A", view: "cut:C", cx: 60, cy: -20, r: 12, scale: 2 }] }));
    const l2 = linesOf(v2.text);
    expect(l2.indexOf("výkres detail řez B v 60 20 poloměr 12 měřítko 2:1")).toBe(l2.indexOf("výkres řez zalomený horní body -10 20 60 20 60 60 130 60") + 1);
    expect(v2.notes.join(" ")).toMatch(/se mohou lišit: C → B/);
    // řetěz: detail z pomocného pohledu z řezu – pořadí řez, pohled, detail (uložené pořadí je obrácené)
    const chain = docToScript(part({ sheet: "A1", aux: [{ id: "x", label: "C", parent: "cut:B", dir: [1, 0, 1] }], cuts: [{ ...cut, label: "B" }], details: [{ id: "d", label: "A", view: "aux:C", cx: 5, cy: -4, r: 3, scale: 2 }] }));
    expect(linesOf(chain.text).filter((l) => /pomocný|řez|detail/.test(l))).toEqual(["výkres řez zalomený horní body -10 20 60 20 60 60 130 60", "výkres pohled pomocný řez B směr 1 0 1", "výkres detail pomocný C v 5 4 poloměr 3 měřítko 2:1"]);
    expect(chain.notes.filter((n) => /písmena/.test(n))).toEqual([]);
  });
  it("kontrola: pořadí řádků po smazání pohledů a detailů – druhý export (dokument po přečtení, nová písmena) zapíše totéž", () => {
    // detaily A, C (B smazán), pomocné D, E (B smazán), řez B: po přečtení pomocné C, D a detaily A, B
    const cut = { id: "c", label: "B", parent: "top", kind: "stepped", pts: [[-10, -20], [60, -20], [60, -60], [130, -60]] };
    const aux = (label: string, dir: number[]) => ({ id: `a${label}`, label, parent: "front", dir });
    const det = (label: string, view: string, cx: number) => ({ id: `d${label}`, label, view, cx, cy: -10, r: 6, scale: 2 });
    const views = (o: Record<string, unknown>) => linesOf(docToScript(part({ sheet: "A1", ...o })).text).filter((l) => /pomocný|řez|detail/.test(l));
    const first = views({ aux: [aux("D", [0.5, 0, 0.87]), aux("E", [1, 0, 1])], cuts: [cut], details: [det("A", "front", 20), det("C", "top", 60)] });
    const again = views({ aux: [aux("C", [0.5, 0, 0.87]), aux("D", [1, 0, 1])], cuts: [cut], details: [det("A", "front", 20), det("B", "top", 60)] });
    expect(first).toEqual([
      "výkres řez zalomený horní body -10 20 60 20 60 60 130 60",
      "výkres pohled pomocný přední směr 0.5 0 0.87",
      "výkres pohled pomocný přední směr 1 0 1",
      "výkres detail přední v 20 10 poloměr 6 měřítko 2:1",
      "výkres detail horní v 60 10 poloměr 6 měřítko 2:1",
    ]);
    expect(again).toEqual(first);
  });
  it("kontrola: pohledy, řezy, detaily a přerušení na pohledu, který na listu není (vypnutý pohled, smazaný řez) – vynechat s poznámkou", () => {
    const stale = {
      sheet: "A2",
      views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false },
      aux: [{ id: "a", label: "B", parent: "left", dir: [0.5, 0, 0.87] }, { id: "a2", label: "D", parent: "cut:C", dir: [1, 0, 0] }, { id: "a3", label: "E", parent: "front", dir: [0, 1, 1] }],
      cuts: [{ id: "c", label: "C", parent: "top", kind: "stepped", pts: [[-10, -20], [100, -20], [100, -50], [210, -50]] }],
      details: [{ id: "d", label: "A", view: "left", cx: 30, cy: -20, r: 8, scale: 2 }, { id: "d2", label: "B", view: "section", cx: 1, cy: -1, r: 2, scale: 2 }],
      brokenOut: [{ id: "b", view: "left", pts: [[10, -5], [30, -5], [30, -35], [10, -35]], depth: 20 }],
      breaks: [{ id: "k", view: "left", axis: "y", from: 10, to: 30, gap: 4 }, { id: "k2", view: "front", axis: "x", from: 20, to: 60 }],
    };
    const r = docToScript(part(stale));
    // zůstane jen to, co má základní pohled na listu: pomocný pohled z předního (při čtení první → B) a přerušení předního
    expect(linesOf(r.text).filter((l) => /pomocný|řez|detail|přerušení/.test(l))).toEqual(["výkres pohled pomocný přední směr 0 1 1", "výkres přerušení přední x od 20 do 60"]);
    const gone = r.notes.filter((n) => n.includes("visí na pohledu, který na listu není"));
    expect(gone).toEqual([
      "pomocný pohled B listu „List 1“ visí na pohledu, který na listu není (levý) – na listu se nekreslí a skript ho vynechá",
      "pomocný pohled D listu „List 1“ visí na pohledu, který na listu není (řez C) – na listu se nekreslí a skript ho vynechá",
      "řez C–C listu „List 1“ visí na pohledu, který na listu není (horní) – na listu se nekreslí a skript ho vynechá",
      "detail A listu „List 1“ visí na pohledu, který na listu není (levý) – na listu se nekreslí a skript ho vynechá",
      "detail B listu „List 1“ visí na pohledu, který na listu není (řez) – na listu se nekreslí a skript ho vynechá",
      "částečný řez listu „List 1“ visí na pohledu, který na listu není (levý) – na listu se nekreslí a skript ho vynechá",
      "přerušení listu „List 1“ visí na pohledu, který na listu není (levý) – na listu se nekreslí a skript ho vynechá",
    ]);
    expect(r.notes.join(" ")).toMatch(/se mohou lišit: E → B/);
    expect(r.notes.filter((n) => /nepodařilo/.test(n))).toEqual([]);
  });
  it("kontrola: umístění na listu s automatickým formátem od levého horního rohu (odshora / from-top / von-oben) – i bez jádra a u sestavy", () => {
    const placed = { sheet: "auto", aux: [{ id: "x", label: "B", dir: [1, 0, 1], at: [300, 100] }], cuts: [{ id: "c", label: "C", parent: "top", kind: "stepped", pts: [[0, 0], [10, -10]], at: [150, 180] }], details: [{ id: "d", label: "A", view: "front", cx: 5, cy: -4, r: 3, scale: 2, at: [100, 50] }] };
    for (const d of [part(placed), asm(placed)]) {
      const r = docToScript(d);
      expect(r.text).toMatch(/^výkres pohled pomocný směr 1 0 1 umístit 300 100 odshora$/m);
      expect(r.text).toMatch(/^výkres řez zalomený horní body 0 0 10 10 umístit 150 180 odshora$/m);
      // detail: střed = levý horní roh + r·měřítko
      expect(r.text).toMatch(/^výkres detail přední v 5 4 poloměr 3 měřítko 2:1 umístit 106 56 odshora$/m);
      expect(r.notes.filter((n) => /umístění/.test(n))).toEqual([]);
    }
    expect(docToScript(part(placed), { lang: "en" }).text).toMatch(/^drawing section stepped top points 0 0 10 10 place 150 180 from-top$/m);
    expect(docToScript(part(placed), { lang: "de" }).text).toMatch(/^zeichnung detail vorne bei 5 4 radius 3 maßstab 2:1 platzieren 106 56 von-oben$/m);
    // rozbor: bod od levého horního rohu (placeTop), bez slova od levého dolního
    expect(op("výkres detail přední v 5 4 poloměr 3 umístit 106 56 odshora").cmd).toMatchObject({ k: "detail", place: [106, 56], placeTop: true });
    expect(op("drawing view auxiliary front direction 1 0 1 place 10 20 from-top").cmd).toMatchObject({ cmd: { op: "aux", parent: "front", place: [10, 20], placeTop: true } });
    expect(op("zeichnung schnitt abgesetzt oben punkte 0 0 10 10 platzieren 5 6 von-oben umkehren").cmd).toMatchObject({ cmd: { op: "cut", place: [5, 6], placeTop: true, flip: true } });
    expect((op("výkres řez zalomený horní body 0 0 10 10 umístit 5 6").cmd as { cmd: Record<string, unknown> }).cmd.placeTop).toBeUndefined();
    expect(op("výkres detail A umístit 5 6 odshora").cmd).toEqual({ k: "detail", op: "edit", label: "A", place: [5, 6], placeTop: true });
  });
  it("detail v pomocném pohledu: odkaz na písmeno po přečtení; umístění na pevném listu bez jádra", () => {
    const r = docToScript(part({ aux: [{ id: "x", label: "B", dir: [1, 0, 1], at: [300, 100] }], details: [{ id: "d", label: "A", view: "aux:B", cx: 5, cy: -4, r: 3, scale: 2, at: [100, 50] }] }));
    // A3 na šířku: výška 297 → umístit x = 300, y = 297 − 100; detail: střed = levý horní roh + r·měřítko
    expect(r.text).toMatch(/^výkres pohled pomocný směr 1 0 1 umístit 300 197$/m);
    expect(r.text).toMatch(/^výkres detail pomocný B v 5 4 poloměr 3 měřítko 2:1 umístit 106 241$/m);
    expect(r.notes.filter((n) => /umístění|písmena/.test(n))).toEqual([]);
  });
  const sheet2 = (d: CadDoc, name: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}): CadDoc => ({ ...d, drawings: [...d.drawings!, { ...d.drawings![0], id: `s${d.drawings!.length + 1}`, name, meta, ...extra }] }) as CadDoc;
  it("kontrola: razítko dalšího listu – nový list převezme údaje aktivního, skript zapíše rozdíl (i vyprázdnění, výchozí šablonu, logo ne)", () => {
    const logo = { src: "data:image/png;base64,AAAA", w: 4, h: 4 };
    const m1 = { template: "toolmaker", number: "D-7", customer: "Zákazník G", stock: "P 10×80×60", tolerance: "X. ±0,2 / X.X ±0,1 / X.XX ±0,02 / X.XXX ±0,01", tolTable: ["±0,2", "±0,1", "±0,02", "±0,01"], revision: "A", revisions: [{ rev: "A", date: "3.3.2026", note: "první vydání", author: "" }], logo };
    // list 2 má vlastní (prázdné / výchozí) razítko: bez zápisu by při čtení převzal šablonu, číslo, revizi, zákazníka, polotovar, tolerance i logo listu 1
    const d = sheet2(part({}, m1), "Detaily", { name: "Deska", number: "", author: "", revision: "", date: "", tolerance: "" });
    const r = docToScript({ ...d, props: { number: "D-7" } } as CadDoc);
    const ls = linesOf(r.text);
    const i2 = ls.indexOf('výkres list nový "Detaily"');
    expect(i2).toBeGreaterThan(0);
    expect(ls.slice(0, i2)).toContain('výkres razítko šablona=nástrojářská číslo="D-7" zákazník="Zákazník G" polotovar="P 10×80×60" nepředepsané="X. ±0,2 / X.X ±0,1 / X.XX ±0,02 / X.XXX ±0,01"');
    expect(ls.slice(i2)).toContain('výkres razítko šablona=iso7200 číslo="" revize="" zákazník="" polotovar="" nepředepsané=""');
    expect(ls.slice(i2)).toContain("výkres razítko logo=ne");
    // číslo dokumentu (doc.props) by po řádku listu 2 bylo prázdné → dorovná ho řádek razítka na listu 1 (pro list beze změny)
    expect(ls.slice(-3)).toEqual(["výkres list 1", 'výkres razítko číslo="D-7"', "výkres list 2"]);
    expect(r.notes.filter((n) => /razítk|popisové/.test(n))).toEqual([]);
    // anglicky a německy stejně (vyprázdnění, výchozí šablona, logo no / nein, přepnutí listu)
    const en = docToScript({ ...d, props: { number: "D-7" } } as CadDoc, { lang: "en" });
    expect(linesOf(en.text).slice(-5)).toEqual(['drawing titleblock template=iso7200 number="" revision="" customer="" stock="" general=""', "drawing titleblock logo=no", "drawing sheet 1", 'drawing titleblock number="D-7"', "drawing sheet 2"]);
    const de = docToScript({ ...d, props: { number: "D-7" } } as CadDoc, { lang: "de" });
    expect(linesOf(de.text).slice(-5)).toEqual(['zeichnung schriftfeld vorlage=iso7200 nummer="" revision="" kunde="" rohteil="" allgemeintoleranz=""', "zeichnung schriftfeld logo=nein", "zeichnung blatt 1", 'zeichnung schriftfeld nummer="D-7"', "zeichnung blatt 2"]);
    expect([...en.notes, ...de.notes].filter((n) => /razítk|popisové/.test(n))).toEqual([]);
    // list 2 se stejným razítkem jako list 1 (převzatým): žádný řádek razítka ani logo znovu; jiná hodnota jen ta
    const same = docToScript(sheet2(part({}, m1), "Detaily", { ...m1, name: "Deska", author: "", date: "", revisions: undefined, customer: "Jiný" }));
    const ss = linesOf(same.text);
    expect(ss.slice(ss.indexOf('výkres list nový "Detaily"')).filter((l) => l.includes("razítko"))).toEqual(['výkres razítko zákazník="Jiný"']);
    expect(ss.filter((l) => l.includes("logo="))).toHaveLength(1);
    // další VÝKRES (výkres nový) začíná z popisových údajů dokumentu, ne z předchozího listu
    const set2 = docToScript(sheet2(part({}, { number: "D-7", customer: "Z" }), "List 1", { number: "D-7" }, { drawing: "Výkres 2" }));
    const s2 = linesOf(set2.text);
    expect(s2.slice(s2.indexOf('výkres nový "Výkres 2"')).filter((l) => l.includes("razítko"))).toEqual([]);
    // řádek revize bez autora na listu se zděděným autorem: autora při čtení doplní aplikace – poznámka
    const rev = docToScript(sheet2(part({}, { author: "JN" }), "Detaily", { author: "JN", revision: "A", revisions: [{ rev: "A", date: "1.1.2026", note: "x", author: "" }] }));
    expect(rev.notes).toContain("revize „A“ listu „Detaily“ nemá autora – po přečtení skriptu dostane autora z razítka („JN“)");
  });
  it("kontrola: popisové údaje dokumentu (doc.props) – revize z tabulky revizí se do razítka zapíše, když ji nese i dokument", () => {
    const revs = [{ rev: "A", date: "1.11.2026", note: "první", author: "JN" }, { rev: "C", date: "19.11.2026", note: "sražení", author: "JN" }];
    const d = { ...part({}, { revision: "C", number: "N-1", revisions: revs }), props: { number: "N-1", revision: "C" } } as CadDoc;
    expect(docToScript(d).text).toMatch(/^výkres razítko číslo="N-1" revize="C"$/m);
    // údaj dokumentu, který nemá žádný list: nejde nastavit – poznámka
    const lost = docToScript({ ...part({}, { number: "N-1" }), props: { number: "N-1", author: "Kdosi" } } as CadDoc);
    expect(lost.notes).toContain("popisové údaje dokumentu „Deska“ (kreslil „Kdosi“) se liší od razítek listů – po přečtení skriptu je dokument ponese podle razítka („“)");
  });
  it("razítko: revize z tabulky se v razítku nepíše znovu, jiná / prázdná ano", () => {
    const revs = [{ rev: "A", date: "1.11.2026", note: "první", author: "JN" }];
    expect(docToScript(part({}, { revision: "A", revisions: revs })).text).not.toContain("razítko");
    expect(docToScript(part({}, { revision: "", revisions: revs })).text).toMatch(/^výkres razítko revize=""$/m);
    expect(docToScript(part({}, { revisions: [{ rev: "a1", date: "1.11.2026", note: "x" }] })).notes.join(" ")).toContain("revizi „a1“ listu „List 1“ nejde zapsat");
  });
});
