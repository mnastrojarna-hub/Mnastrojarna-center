/**
 * Vlna 22, bod 6 (C2): text `pohyb vůle …` / `pohyb kolize spojitě|diskrétně` (CS / EN / DE), úprava studie a zápis do skriptu
 * dokumentu (a zpět stejným parserem).
 */
import { describe, expect, it } from "vitest";
import { asmTokens, AsmCursor } from "./agent-asm";
import { applyClearanceCmd, clearanceScript, parseClearanceText, type ClearanceCmd } from "./agent-clearance";
import { parseMotionText } from "./agent-motion";
import { setLang } from "./i18n";
import type { MotionResult } from "./motion";
import type { AsmComponent, CadDoc, MotionStudy } from "./types";
import { emptyDoc } from "./types";

setLang("cs");
const parse = (line: string): ClearanceCmd | null => parseClearanceText(new AsmCursor(asmTokens(line).slice(1)));
const comp = (id: string, name: string): AsmComponent => ({ id, name, source: { kind: "part", doc: emptyDoc(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [comp("v", "Vodítko"), comp("s", "Střižník"), comp("k", "Kolík")] } as CadDoc;

describe("pohyb vůle – parser (CS / EN / DE)", () => {
  it("dvojice, limit, zjemnění", () => {
    expect(parse('pohyb vůle "Střižník" "Vodítko" min 0,05')).toEqual({ k: "set", a: "Střižník", b: "Vodítko", limit: 0.05 });
    expect(parse('pohyb vůle "Střižník" "Vodítko" 0,05')).toEqual({ k: "set", a: "Střižník", b: "Vodítko", limit: 0.05 });
    expect(parse("pohyb vůle #2 #1 min 0.05 bez zjemnění")).toEqual({ k: "set", a: "#2", b: "#1", limit: 0.05, refine: false });
    expect(parse('motion clearance "Punch" "Guide" min 0.05 no-refine')).toEqual({ k: "set", a: "Punch", b: "Guide", limit: 0.05, refine: false });
    expect(parse('bewegung spiel "Stempel" "Führung" min 0,05 ohne verfeinerung')).toEqual({ k: "set", a: "Stempel", b: "Führung", limit: 0.05, refine: false });
    expect(parse("pohyb vůle zjemnit")).toEqual({ k: "set", refine: true });
  });
  it("pohyblivé, stav, seznam, smazat, dvojice smazat", () => {
    expect(parse("pohyb vůle pohyblivé min 0,1")).toEqual({ k: "set", moving: true, limit: 0.1 });
    expect(parse("motion clearance moving")).toEqual({ k: "set", moving: true });
    expect(parse("bewegung spiel bewegliche min 0,1")).toEqual({ k: "set", moving: true, limit: 0.1 });
    expect(parse("pohyb vůle")).toEqual({ k: "status" });
    expect(parse("pohyb vůle seznam")).toEqual({ k: "list" });
    expect(parse("pohyb vůle smazat")).toEqual({ k: "clear" });
    expect(parse('pohyb vůle "Střižník" "Vodítko" smazat')).toEqual({ k: "remove", a: "Střižník", b: "Vodítko" });
  });
  it("kolize spojitě / diskrétně; ostatní `pohyb kolize` zůstává studii", () => {
    expect(parse("pohyb kolize spojitě")).toEqual({ k: "mode", continuous: true });
    expect(parse("pohyb kolize diskrétně")).toEqual({ k: "mode", continuous: false });
    expect(parse("motion collisions discrete")).toEqual({ k: "mode", continuous: false });
    expect(parse("bewegung kollision stetig")).toEqual({ k: "mode", continuous: true });
    expect(parse("pohyb kolize")).toBeNull();
    expect(parseMotionText("pohyb kolize vyp")).toEqual({ op: "set", collisions: false });
    expect(parseMotionText("pohyb vůle pohyblivé")).toEqual({ op: "clearance", cmd: { k: "set", moving: true } });
  });
  it("chyby: jedna komponenta, dvojice i pohyblivé, nic k nastavení, neznámá volba", () => {
    expect(() => parse('pohyb vůle "Střižník"')).toThrow(/dvojici komponent/);
    expect(() => parse('pohyb vůle pohyblivé "A" "B"')).toThrow(/ne obojí/);
    expect(() => parse('pohyb vůle "A" "B" foo')).toThrow(/neznámá volba „foo“/);
    expect(() => parse("pohyb vůle min -1")).toThrow();
  });
});

describe("pohyb vůle – úprava studie a skript dokumentu", () => {
  const host = (log: string[] = []) => ({ runLog: async () => ({}) as MotionResult, lines: () => [], cached: () => null, log });
  const study = (): MotionStudy => ({ motors: [], duration: 2, steps: 10, collisions: true });

  it("přidá dvojici (komponenty podle názvu), limit; druhá dvojice se přidá, stejná se nezdvojí; smazání dvojice", async () => {
    const r1 = await applyClearanceCmd(doc, { k: "set", a: "Střižník", b: "Vodítko", limit: 0.05 }, study(), host());
    expect(r1.doc.motion!.clearance).toEqual({ pairs: [{ a: "s", b: "v" }], limit: 0.05 });
    const r2 = await applyClearanceCmd(r1.doc, { k: "set", a: "Vodítko", b: "Střižník" }, { ...r1.doc.motion! }, host());
    expect(r2.doc.motion!.clearance!.pairs).toEqual([{ a: "s", b: "v" }]);
    const r3 = await applyClearanceCmd(r2.doc, { k: "set", a: "Kolík", b: "Střižník" }, { ...r2.doc.motion! }, host());
    expect(r3.doc.motion!.clearance!.pairs).toEqual([{ a: "s", b: "v" }, { a: "k", b: "s" }]);
    const r4 = await applyClearanceCmd(r3.doc, { k: "remove", a: "Střižník", b: "Vodítko" }, { ...r3.doc.motion! }, host());
    expect(r4.doc.motion!.clearance!.pairs).toEqual([{ a: "k", b: "s" }]);
    await expect(applyClearanceCmd(r4.doc, { k: "set", a: "Kolík", b: "Kolík" }, { ...r4.doc.motion! }, host())).rejects.toThrow(/dvě různé komponenty/);
  });
  it("kolize diskrétně zapne kolize a vypne zjemnění; spojitě vrátí výchozí; smazat odebere jen sledovanou vůli", async () => {
    const d = await applyClearanceCmd(doc, { k: "mode", continuous: false }, { ...study(), collisions: undefined }, host());
    expect(d.doc.motion!.collisions).toBe(true);
    expect(d.doc.motion!.clearance).toEqual({ refine: false });
    const c = await applyClearanceCmd(d.doc, { k: "mode", continuous: true }, { ...d.doc.motion! }, host());
    expect(c.doc.motion!.clearance).toBeUndefined();
    const m = await applyClearanceCmd(doc, { k: "set", moving: true, limit: 0.1, refine: false }, study(), host());
    const cl = await applyClearanceCmd(m.doc, { k: "clear" }, { ...m.doc.motion! }, host());
    expect(cl.doc.motion!.clearance).toEqual({ refine: false });
  });
  it("bez motoru se nepočítá (věta), s motorem se spočítá (runLog)", async () => {
    const log: string[] = [];
    let ran = 0;
    await applyClearanceCmd(doc, { k: "set", moving: true }, study(), { ...host(log) });
    expect(log.join("\n")).toMatch(/studie zatím nemá motor/);
    await applyClearanceCmd(doc, { k: "set", moving: true }, { ...study(), motors: [{ id: "m", kind: "linear", mate: "x", from: 0, to: 1 }] }, { ...host(), runLog: async () => (ran++, {} as MotionResult) });
    expect(ran).toBe(1);
  });
  it("skript dokumentu: řádky v jazyce skriptu, komponenty pořadím, zpět týmž parserem", () => {
    const d: CadDoc = { ...doc, motion: { ...study(), clearance: { pairs: [{ a: "s", b: "v" }], limit: 0.05, refine: false } } };
    const idx = new Map([["v", 1], ["s", 2], ["k", 3]]);
    const ref = (id: string) => (idx.has(id) ? `#${idx.get(id)}` : null);
    const cs = clearanceScript(d, 0, ref);
    expect(cs.lines).toEqual(["pohyb vůle #2 #1 min 0.05", "pohyb vůle bez zjemnění"]);
    expect(clearanceScript(d, 1, ref).lines).toEqual(["motion clearance #2 #1 min 0.05", "motion clearance no-refine"]);
    expect(clearanceScript(d, 2, ref).lines).toEqual(["bewegung spiel #2 #1 min 0.05", "bewegung spiel ohne verfeinerung"]);
    expect(cs.lines.map(parse)).toEqual([{ k: "set", a: "#2", b: "#1", limit: 0.05 }, { k: "set", refine: false }]);
    const mv: CadDoc = { ...doc, motion: { ...study(), clearance: { pairs: "moving", limit: 0.1 } } };
    expect(clearanceScript(mv, 0, ref).lines).toEqual(["pohyb vůle pohyblivé min 0.1"]);
    expect(clearanceScript({ ...doc, motion: { ...study(), clearance: { pairs: [{ a: "s", b: "zz" }] } } }, 0, ref)).toEqual({ lines: [], skipped: 1 });
  });
});
