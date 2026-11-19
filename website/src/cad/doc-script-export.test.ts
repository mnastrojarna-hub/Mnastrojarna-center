/**
 * Převodník dokument → skript, vlna E (bez jádra): nové textové příkazy (`výkres vygenerované …`, `sestava pružina … vedená`),
 * zápis voleb listu a poznámky / komentáře u toho, co skript nepřenese. Tam a zpět se skutečným jádrem:
 * doc-script-export.roundtrip.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { docToScript } from "./doc-script";
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
    const r = docToScript(part({ genEdit: { off: ["dim:front:t", "dim:m:x1:t"], move: { "pos:2": [1.5, -2], "dim:m:x1:l": [3, 0] } } }));
    expect(r.text).toMatch(/^výkres vygenerované skrýt dim:front:t$/m);
    expect(r.text).toMatch(/^výkres vygenerované posun pos:2 1.5 2$/m);
    expect(r.text).not.toMatch(/^výkres vygenerované.*dim:m:/m);
    expect(r.notes.join(" ")).toContain("úprava vygenerovaných kót a pozic (dim:m:x1:t, dim:m:x1:l) listu „List 1“ nejde zapsat textem");
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
  it("detail v pomocném pohledu: odkaz na písmeno po přečtení; umístění na pevném listu bez jádra", () => {
    const r = docToScript(part({ aux: [{ id: "x", label: "B", dir: [1, 0, 1], at: [300, 100] }], details: [{ id: "d", label: "A", view: "aux:B", cx: 5, cy: -4, r: 3, scale: 2, at: [100, 50] }] }));
    // A3 na šířku: výška 297 → umístit x = 300, y = 297 − 100; detail: střed = levý horní roh + r·měřítko
    expect(r.text).toMatch(/^výkres pohled pomocný směr 1 0 1 umístit 300 197$/m);
    expect(r.text).toMatch(/^výkres detail pomocný B v 5 4 poloměr 3 měřítko 2:1 umístit 106 241$/m);
    expect(r.notes.filter((n) => /umístění|písmena/.test(n))).toEqual([]);
  });
  it("razítko: revize z tabulky se v razítku nepíše znovu, jiná / prázdná ano", () => {
    const revs = [{ rev: "A", date: "1.11.2026", note: "první", author: "JN" }];
    expect(docToScript(part({}, { revision: "A", revisions: revs })).text).not.toContain("razítko");
    expect(docToScript(part({}, { revision: "", revisions: revs })).text).toMatch(/^výkres razítko revize=""$/m);
    expect(docToScript(part({}, { revisions: [{ rev: "a1", date: "1.11.2026", note: "x" }] })).notes.join(" ")).toContain("revizi „a1“ listu „List 1“ nejde zapsat");
  });
});
