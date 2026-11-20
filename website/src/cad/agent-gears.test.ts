/**
 * Kola a ozubení textem (vlna 19, balík text): gramatika z tabulky druhu ve třech jazycích, složené zápisy, chyby, soukolí
 * na existující příkazy, tabulka ozubení bez UI, nápověda a zápis dokument → skript (`kolo …`) tam a zpět.
 */
import { describe, expect, it } from "vitest";
import { AGENT_COMMANDS, parseAgentText, type AgentOp } from "./agent";
import { gearHelp, gearScriptLines, gearTableReport, grammarOf, kindByWord } from "./agent-gears";
import "./ext/index";
import { getExt } from "./ext/registry";
import { GEAR_KINDS, KINDS, PAIR_ROWS } from "./gears";
import type { GearData, Lang, PairKind } from "./gears/types";
import { setLang } from "./i18n";
import { emptyDoc, type Feature } from "./types";

type FeatOp = { k: "feature"; feature: { ext: string; name: string; data: GearData }; note?: string };
const one = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  expect(p.ops, text).toHaveLength(1);
  return p.ops[0] as unknown as FeatOp;
};
const err = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors.length, text).toBe(1);
  return p.errors[0].message;
};
const dataOf = (text: string) => one(text).feature.data;

describe("kolo <druh> … – řádky ze zadání (CS)", () => {
  it("čelní kolo s dírou, perem, nábojem a polotovarem; data = výchozí hodnoty + zadané", () => {
    const op = one("kolo čelní m 2 z 24 b 20 x 0,2 úhel 20 díra 20 pero náboj 40 15 polotovar");
    expect(op.k).toBe("feature");
    expect(op.feature.ext).toBe("gear.spur");
    expect(op.feature.name).toBe("Ozubené kolo m2 z24");
    expect(op.feature.data).toEqual({ ...KINDS.spur.defaults(), m: 2, z: 24, b: 20, x: 0.2, alpha: 20, bore: 20, keyway: true, hubD: 40, hubL: 15, out: "blank" });
    expect(op.note).toBeUndefined();
  });
  it("kolo ≡ prvek gear.* (stejná data)", () => {
    const a = dataOf("kolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15 obě strany");
    const b = dataOf("prvek gear.spur m=2 z=24 b=20 bore=20 keyway=ano hubD=40 hubL=15 hubSide=both");
    expect(a).toEqual(b);
  });
  it("šikmé, hřeben, řetězové, cykloidní, hypoidní", () => {
    expect(dataOf("kolo šikmé m 2 z 30 b 20 beta 15 pravé")).toMatchObject({ m: 2, z: 30, b: 20, beta: 15, hand: "right" });
    expect(dataOf("kolo šikmé m 2 z 30 beta 12,5 levé")).toMatchObject({ beta: 12.5, hand: "left" });
    expect(one("kolo hřeben m 2 z 40 b 20 h 20").feature).toMatchObject({ ext: "gear.rack", data: { m: 2, z: 40, b: 20, h: 20 } });
    expect(one("kolo řetězové 08B z 19 řady 2").feature).toMatchObject({ ext: "gear.sprocket", data: { chain: "08B", z: 19, rows: 2 } });
    expect(one("kolo cykloidní m 1 z 60 protikolo 8").feature).toMatchObject({ ext: "gear.cycloid", data: { m: 1, z: 60, zMate: 8 } });
    expect(one("kolo hypoidní z1 11 z2 41 de2 200 e 25 talíř").feature).toMatchObject({ ext: "gear.hypoid", data: { z1: 11, z2: 41, de2: 200, E: 25, member: "wheel" } });
    expect(one("kolo cyklodisk n 10 dp 60 čep 6 e 1,5").feature).toMatchObject({ ext: "gear.cyclodisc", data: { N: 10, pinCircle: 60, pinD: 6, e: 1.5 } });
    expect(one("kolo šípové m 3 z 40 beta 25 drážka 6").feature).toMatchObject({ ext: "gear.herringbone", data: { m: 3, z: 40, beta: 25, gap: 6 } });
    expect(one("kolo vnitřní m 2 z 72 věnec 170").feature).toMatchObject({ ext: "gear.internal", data: { z: 72, rimD: 170 } });
    expect(one("kolo kuželové m 3 z 20 protikolo 40").feature).toMatchObject({ ext: "gear.bevel", data: { m: 3, z: 20, zMate: 40 } });
    expect(one("kolo šnek m 2 q 10 z1 2 l 40").feature).toMatchObject({ ext: "gear.worm", data: { m: 2, q: 10, z1: 2, L: 40 } });
    expect(one("kolo šnekové m 2 z 30 q 10").feature).toMatchObject({ ext: "gear.wormwheel", data: { m: 2, z: 30, q: 10 } });
    expect(one("kolo řemenice 8M z 32 w 20 bočnice ne").feature).toMatchObject({ ext: "gear.pulley", data: { profile: "8M", z: 32, w: 20, flanges: false } });
    expect(one("kolo rohatka z 24 da 60 protisměru").feature).toMatchObject({ ext: "gear.ratchet", data: { z: 24, da: 60, dir: "ccw" } });
  });
  it("řetěz ANSI číslem (hned za druhem, nebo se slovem ansi / řetěz)", () => {
    expect(dataOf("kolo řetězové 40 z 17")).toMatchObject({ chain: "40", z: 17 });
    expect(dataOf("kolo řetězové z 17 ansi 40")).toMatchObject({ chain: "40" });
    expect(dataOf("kolo řetězové z 17 řetěz 60")).toMatchObject({ chain: "60" });
  });
  it("zkrácené zápisy, klíč=hodnota, °/mm, desetinná tečka, název, poloha a osa", () => {
    expect(dataOf("kolo čelní m2 z24 b20 x0,25")).toMatchObject({ m: 2, z: 24, b: 20, x: 0.25 });
    expect(dataOf("kolo čelní m=2.5 z=31 alpha=20°")).toMatchObject({ m: 2.5, z: 31, alpha: 20 });
    expect(dataOf("kolo čelní m 2 z 24 b 20mm")).toMatchObject({ b: 20 });
    const op = one('kolo čelní m 2 z 24 název "Pastorek A" v 10 20 5 osa X natočení 7,5');
    expect(op.feature.name).toBe("Pastorek A");
    expect(op.feature.data).toMatchObject({ position: [10, 20, 5], axis: { kind: "axis", axis: "X" }, turn: 7.5 });
    expect(one('kolo čelní m 2 z 24 "Kolo B"').feature.name).toBe("Kolo B");
    expect(dataOf("kolo čelní m 2 z 24 osa -Z")).toMatchObject({ axis: { kind: "vector", v: [0, 0, -1] } });
    expect(dataOf("kolo čelní m 2 z 24 osa 1 1 0")).toMatchObject({ axis: { kind: "vector", v: [1, 1, 0] } });
  });
  it("výstup a operace: zuby do tělesa = Odebrat, přidat, nové", () => {
    expect(dataOf("kolo čelní m 2 z 24 zuby")).toMatchObject({ out: "teeth", mode: "cut" });
    expect(dataOf("kolo čelní m 2 z 24 přidat")).toMatchObject({ out: "wheel", mode: "add" });
    expect(dataOf("kolo čelní m 2 z 24 výstup polotovar operace odebrat")).toMatchObject({ out: "blank", mode: "cut" });
    expect(dataOf("kolo čelní m 2 z 24 díry 6 12 80 stojina 6 sražení 0,5 šroub M5 náboj 40 20")).toMatchObject({ holesN: 6, holesD: 12, holesPcd: 80, webT: 6, chamfer: 0.5, setScrew: "M5", hubD: 40, hubL: 20 });
    expect(dataOf("kolo čelní m 2 z 24 profil B vůle 0,04 kulička 3,5")).toMatchObject({ rack: "B", jn: 0.04, ballD: 3.5 });
  });
  it("nezadané povinné řádky: výchozí hodnota a poznámka do protokolu", () => {
    const op = one("kolo čelní z 30");
    expect(op.feature.data).toMatchObject({ m: 2, z: 30 });
    expect(op.note).toMatch(/m 2/);
  });
  it("chyby lidsky: neznámé slovo, číslo bez slova, hodnota výčtu, druh, celé číslo", () => {
    expect(err("kolo čelní m 2 z 24 modrá")).toMatch(/kolo čelní: neznámé slovo „modrá“ – řádky: .*m.*z.*popis: kolo nápověda čelní/);
    expect(err("kolo čelní m 2 24")).toMatch(/číslo 24 bez slova řádku/);
    expect(err("kolo šikmé m 2 z 24 smysl nahoru")).toMatch(/„smysl“ má hodnoty right \| left/);
    expect(err("kolo planetové m 2")).toMatch(/neznámý druh „planetové“ – druhy: čelní, šikmé/);
    expect(err("kolo čelní m 2 z 24,5")).toMatch(/celé číslo/);
    expect(err("kolo čelní m")).toMatch(/za „m“ chybí číslo/);
    expect(err("kolo")).toMatch(/kolo potřebuje druh/);
    expect(err("soukolí planetové m 2")).toMatch(/soukolí: neznámý druh/);
  });
});

describe("EN / DE", () => {
  it("EN gear spur … a DE rad stirnrad … dají stejná data jako CS", () => {
    const cs = dataOf("kolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15 obě strany polotovar");
    expect(dataOf("gear spur m 2 z 24 b 20 bore 20 keyway hub 40 15 both sides blank")).toEqual(cs);
    expect(dataOf("rad stirnrad m 2 z 24 b 20 bohrung 20 nut nabe 40 15 beide seiten rohling")).toEqual(cs);
    expect(dataOf("wheel helical m 2 z 30 beta 15 left")).toMatchObject({ beta: 15, hand: "left" });
    expect(dataOf("zahnrad schräg m 2 z 30 beta 15 links")).toMatchObject({ beta: 15, hand: "left" });
    expect(one("gear sprocket 08B z 19 strands 2").feature).toMatchObject({ ext: "gear.sprocket", data: { rows: 2 } });
    expect(one("rad kettenrad 10B z 23 reihen 3").feature).toMatchObject({ data: { chain: "10B", rows: 3 } });
    expect(one("gear rack m 2 z 40 b 20 h 20").feature.ext).toBe("gear.rack");
    expect(one("rad zahnstange m 2 z 40 b 20 h 20").feature.ext).toBe("gear.rack");
  });
  it("v rozhraní EN / DE platí česká slova dál (skripty z návodu)", () => {
    for (const l of ["en", "de"] as const) {
      setLang(l);
      try {
        expect(dataOf("kolo čelní m 2 z 24 díra 20 pero")).toMatchObject({ m: 2, z: 24, bore: 20, keyway: true });
        expect(dataOf("gear spur m 2 z 24 bore 20 keyway")).toMatchObject({ bore: 20, keyway: true });
      } finally {
        setLang("cs");
      }
    }
  });
});

describe("tabulka slov druhu", () => {
  it("žádné slovo jednoho jazyka nemíří po složení diakritiky na dva různé řádky", () => {
    const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
    const owners = (def: (typeof KINDS)["spur"], l: Lang) => {
      const m = new Map<string, Set<string>>();
      const add = (w: string, o: string) => m.set(fold(w), new Set([...(m.get(fold(w)) ?? []), o]));
      for (const ph of def.phrases) for (const w of ph.words[l]) add(w, `row:${ph.keys[0]}`);
      for (const r of def.rows) {
        for (const w of r.words[l]) add(w, `row:${r.key}`);
        for (const [v, ws] of Object.entries(r.enumWords ?? {})) for (const w of ws[l]) add(w, `enum:${r.key}=${v}`);
      }
      return [...m].filter(([, s]) => s.size > 1);
    };
    for (const k of GEAR_KINDS) for (const l of ["cs", "en", "de"] as const) expect(owners(KINDS[k], l), `${k}/${l}`).toEqual([]);
  });
  it("každý řádek (kromě odkazu na bod) má v každém jazyce slovo bez mezery a slovo vede na svůj řádek", () => {
    for (const k of GEAR_KINDS) {
      const def = KINDS[k];
      for (const l of ["cs", "en", "de"] as const) {
        const g = grammarOf(def.rows, def.phrases, def.positional ?? [], l);
        for (const r of def.rows) {
          if (r.kind === "point") continue;
          const w = r.words[l][0];
          expect(/\s/.test(w), `${k}/${l}/${r.key}`).toBe(false);
          const t = g.index.get(w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss"));
          const key = t?.t === "row" || t?.t === "enum" ? t.row.key : t?.t === "phrase" ? t.ph.keys[0] : undefined;
          expect(key, `${k}/${l}/${w}`).toBe(r.key);
        }
      }
      expect(kindByWord(def.words.cs[0])?.kind).toBe(k);
      expect(kindByWord(def.ext)?.kind).toBe(k);
    }
  });
});

describe("soukolí → existující příkazy", () => {
  it("soukolí čelní m 2 z1 20 z2 60 a 81: dva díly, sestava, vložení, vazba ozubení a souhrn", () => {
    const p = parseAgentText("soukolí čelní m 2 z1 20 z2 60 a 81");
    expect(p.errors).toEqual([]);
    expect(p.ops.map((o) => o.k)).toEqual(["new", "feature", "new", "feature", "new", "insert", "insert", "asm", "info"]);
    expect(p.ops.every((o) => o.line === 1)).toBe(true);
    const f = p.ops.filter((o) => o.k === "feature") as unknown as FeatOp[];
    expect(f[0].feature.data.x as number).toBeCloseTo(0.3668, 3);
    expect(f[1].feature.data.x as number).toBeCloseTo(0.1558, 3);
    expect(f[0].feature.data).toMatchObject({ m: 2, z: 20, mateZ: 60, aw: 81 });
    const asm = p.ops.find((o) => o.k === "asm") as unknown as { cmd: { kind: string } };
    expect(JSON.stringify(asm.cmd)).toMatch(/gear/);
    const info = (p.ops[8] as unknown as { lines: string[] }).lines.join("\n");
    expect(info).toMatch(/Soukolí „Soukolí m2 z20\/z60“/);
    expect(info).toMatch(/81/);
    expect((p.ops[4] as unknown as { assembly: boolean; name: string })).toMatchObject({ assembly: true, name: "Soukolí m2 z20/z60" });
  });
  it("název sestavy, EN / DE hlavy, rozbor všech druhů soukolí z výchozích hodnot", () => {
    const p = parseAgentText('soukolí čelní m 2 z1 20 z2 60 název "Převod A"');
    expect((p.ops[4] as unknown as { name: string }).name).toBe("Převod A");
    expect(parseAgentText("gear pair spur m 2 z1 20 z2 60").errors).toEqual([]);
    expect(parseAgentText("gearpair helical m 2 z1 20 z2 40 beta 15").errors).toEqual([]);
    expect(parseAgentText("radpaar stirnrad m 2 z1 20 z2 60 a 81").errors).toEqual([]);
    expect(parseAgentText("soukolí řetězové 08B z1 19 z2 38 řady 2").errors).toEqual([]);
    expect(parseAgentText("soukolí hřeben m 2 z1 20 z2 40").errors).toEqual([]);
    for (const k of Object.keys(PAIR_ROWS) as PairKind[]) {
      const w = KINDS[k].words.cs[0];
      const q = parseAgentText(`soukolí ${w}`);
      expect(q.errors, k).toEqual([]);
      expect(q.ops.filter((o) => o.k === "feature"), k).toHaveLength(2);
    }
  });
  it("neplatné soukolí = ✗ řádku s hláškou kontroly", () => {
    expect(err("soukolí čelní m 2 z1 20 z2 60 a 70")).toMatch(/soukolí čelní:/);
    expect(err("soukolí čelní m 2 z1 20 z2 60 barva")).toMatch(/neznámé slovo „barva“/);
  });
});

describe("kolo tabulka, nápověda, AGENT_COMMANDS", () => {
  it("kolo tabulka = akce gear.table (poslední / vše / název) a výpis bez UI", () => {
    expect(parseAgentText("kolo tabulka").ops[0]).toMatchObject({ k: "api", cmd: { kind: "action", id: "gear.table", arg: "" } });
    expect(parseAgentText("kolo tabulka vše").ops[0]).toMatchObject({ cmd: { arg: "*" } });
    expect(parseAgentText('gear table "Kolo 2"').ops[0]).toMatchObject({ cmd: { arg: "Kolo 2" } });
    expect(parseAgentText("rad tabelle alle").ops[0]).toMatchObject({ cmd: { arg: "*" } });
    const feat = (id: string, name: string, ext: string, data: GearData) => ({ id, name, type: "ext", ext, data: { ...KINDS[ext.slice(5) as "spur"].defaults(), ...data } }) as unknown as Feature;
    const doc = { ...emptyDoc("Kola"), features: [feat("a", "Kolo 1", "gear.spur", { m: 2, z: 24 }), feat("b", "Kolo 2", "gear.sprocket", { chain: "08B", z: 19 })] };
    const last = gearTableReport(doc, "").join("\n");
    expect(last).toMatch(/Tabulka ozubení – Kolo 2/);
    expect(last).toMatch(/77,159/);
    expect(last).toMatch(/kolo tabulka vše/);
    const named = gearTableReport(doc, "kolo 1").join("\n");
    expect(named).toMatch(/15,433/);
    expect(named).toMatch(/52,951/);
    expect(gearTableReport(doc, "*").filter((l) => l.startsWith("Tabulka ozubení"))).toHaveLength(2);
    expect(() => gearTableReport(doc, "Kolo 9")).toThrow(/kolo „Kolo 9“ v dílu není – kola: „Kolo 1“, „Kolo 2“/);
    expect(() => gearTableReport(emptyDoc("Prázdný"), "")).toThrow(/není žádné kolo/);
    expect(() => gearTableReport({ ...emptyDoc("S"), kind: "assembly" }, "")).toThrow(/není díl/);
    // akce v registru má výpis bez UI (engine/ops/api.ts) – `akce gear.table` = všechna kola
    expect(getExt("gear.table")?.report?.(doc).filter((l) => l.startsWith("Tabulka ozubení"))).toHaveLength(2);
  });
  it("kolo nápověda [druh] = řádky tabulky se slovy, jednotkami a příkladem", () => {
    const all = gearHelp();
    expect(all.join("\n")).toMatch(/kolo čelní – Čelní kolo s přímými zuby/);
    expect(all).toHaveLength(GEAR_KINDS.length + 3);
    const sp = gearHelp("čelní").join("\n");
    expect(sp).toMatch(/m <číslo> \(modul\) – Modul mₙ \[mm\], povinné, výchozí 2, rozsah 0,1 až 50\. /);
    expect(sp).toMatch(/díra bore \[pero\]/);
    expect(sp).toMatch(/Příklad: kolo čelní m 2 z 24$/m);
    const ex = /Příklad: (.*)$/m.exec(sp)![1];
    expect(parseAgentText(ex).errors).toEqual([]);
    const p = parseAgentText("kolo nápověda řetězové\nsoukolí nápověda čelní\ngear help\nrad hilfe stirnrad");
    expect(p.errors).toEqual([]);
    expect(p.ops.every((o) => o.k === "info")).toBe(true);
    for (const k of GEAR_KINDS) {
      const e = /Příklad: (.*)$/m.exec(gearHelp(KINDS[k].words.cs[0]).join("\n"))![1];
      expect(parseAgentText(e).errors, `${k}: ${e}`).toEqual([]);
    }
    for (const k of Object.keys(PAIR_ROWS) as PairKind[]) {
      const e = /Příklad: (.*)$/m.exec(gearHelp(KINDS[k].words.cs[0], true).join("\n"))![1];
      expect(parseAgentText(e).errors, `${k}: ${e}`).toEqual([]);
    }
  });
  it("AGENT_COMMANDS má řádky kolo / soukolí s EN a DE a ukázky v nich jdou přečíst", () => {
    const rows = AGENT_COMMANDS.filter((c) => /^(kolo|soukolí)/.test(c.cmd));
    expect(rows.length).toBe(4);
    for (const r of rows) expect(r.en && r.de && r.desc).toBeTruthy();
    for (const line of ["kolo šikmé m 2 z 30 beta 15 pravé", "kolo hřeben m 2 z 40 b 20 h 20", "kolo řetězové 08B z 19", "kolo cykloidní m 1 z 60 protikolo 8", "kolo hypoidní z1 11 z2 41 de2 200 e 25"]) expect(parseAgentText(line).errors, line).toEqual([]);
  });
});

describe("dokument → skript: kolo … tam a zpět", () => {
  const n = (v: number) => String(v);
  const cases: [string, GearData][] = [
    ["gear.spur", { m: 2.5, z: 31, b: 18, x: 0.25, bore: 20, keyway: true, hubD: 40, hubL: 12, hubSide: "both", setScrew: "M6", out: "wheel" }],
    ["gear.spur", { m: 2, z: 24, holesN: 6, holesD: 10, webT: 8, chamfer: 0.5, jn: 0.04, mateZ: 60, aw: 81, rack: "custom", ha: 1.1, hf: 1.3, rho: 0.3 }],
    ["gear.spur", { out: "teeth", mode: "cut" }],
    ["gear.spur", { out: "teeth", mode: "add" }],
    ["gear.spur", { mode: "add", keyway: false, position: [10, 0, 5], axis: { kind: "axis", axis: "X" }, turn: 4 }],
    ["gear.spur", { axis: { kind: "vector", v: [1, 1, 0] } }],
    ["gear.helical", { z: 41, beta: 12.5, hand: "left", position: [10, 0, 5], axis: { kind: "axis", axis: "Y" }, turn: 4 }],
    ["gear.herringbone", { m: 3, z: 40, beta: 25, gap: 6, hubSide: "bottom", hubD: 60, hubL: 10 }],
    ["gear.internal", { z: 72, rimD: 170, beta: 10 }],
    ["gear.rack", { m: 1.5, z: 60, h: 18, beta: 20, hand: "left" }],
    ["gear.sprocket", { chain: "10B", z: 23, rows: 3, form: "max", bore: 25 }],
    ["gear.sprocket", { chain: "40", z: 17 }],
    ["gear.hypoid", { member: "wheel", z1: 9, z2: 37, E: 30 }],
    ["gear.bevel", { m: 3, z: 20, zMate: 40, betaM: 35, hand: "left" }],
    ["gear.worm", { m: 2, q: 12.5, z1: 2, L: 50, shaftD: 12, shaftL: 20, bore: 0 }],
    ["gear.wormwheel", { m: 2, z: 30, q: 10, z1: 2, x: 0.2 }],
    ["gear.cycloid", { m: 1, z: 60, zMate: 8, type: "pinion", tip: "round" }],
    ["gear.cyclodisc", { N: 12, pinCircle: 80, pinD: 8, e: 2, part: "ring", pins: "holes" }],
    ["gear.pulley", { profile: "T10", z: 32, w: 25, flanges: false }],
    ["gear.ratchet", { z: 30, da: 80, dir: "ccw", rake: 8 }],
  ];
  for (const lang of ["cs", "en", "de"] as Lang[]) {
    it(`${lang}: každé kolo se zapíše vlastním příkazem a rozbor dá přesně stejná data`, () => {
      setLang(lang);
      try {
        for (const [ext, d] of cases) {
          const def = KINDS[ext.slice(5) as "spur"];
          const f = { id: "g", name: "Kolo", type: "ext", ext, data: { ...def.defaults(), ...d } } as unknown as Feature;
          const lines = gearScriptLines(f, lang, n);
          expect(lines, `${ext} ${JSON.stringify(d)}`).toHaveLength(1);
          const p = parseAgentText(lines[0]);
          expect(p.errors, lines[0]).toEqual([]);
          const op = p.ops[0] as AgentOp & { feature: { data: GearData; ext: string } };
          expect(op.feature.ext).toBe(ext);
          expect(op.feature.data, lines[0]).toEqual((f as unknown as { data: GearData }).data);
        }
      } finally {
        setLang("cs");
      }
    });
  }
  it("co vlastní příkaz nevyjádří (odkaz na bod, klíč mimo tabulku, chybějící klíč), vrátí prázdné pole", () => {
    const d = KINDS.spur.defaults();
    const f = (data: GearData) => ({ id: "g", name: "K", type: "ext", ext: "gear.spur", data }) as unknown as Feature;
    expect(gearScriptLines(f({ ...d, positionRef: { kind: "vertex", index: 3 } }), "cs", n)).toEqual([]);
    expect(gearScriptLines(f({ ...d, foo: 1 }), "cs", n)).toEqual([]);
    const { m: _m, ...noM } = d;
    void _m;
    expect(gearScriptLines(f(noM), "cs", n)).toEqual([]);
    expect(gearScriptLines(f({ ...d, axis: { kind: "edge", ref: { kind: "edge", index: 1 } } }), "cs", n)).toEqual([]);
    expect(gearScriptLines(f({ ...d, m: 2 }), "cs", n)).toEqual(["kolo čelní m 2 z 24"]);
  });
});

describe("dokument → skript (docToScript) s koly", () => {
  it("kola se zapíšou `kolo …` (bez názvu, když je automatický), díl s kvádrem → kolo v novém tělese; rozbor dá stejné prvky", async () => {
    const { docToScript } = await import("./doc-script");
    const p0 = parseAgentText('nový díl Kola\nkvádr 50 50 10\nkolo čelní m 2 z 24 b 20 díra 20 pero náboj 40 15\nkolo šikmé m 2 z 30 beta 15 levé v 80 0 0 přidat\nkolo řetězové 08B z 19 řady 2 název "Řetězka"\nkolo čelní m 1,5 z 40 zuby');
    expect(p0.errors).toEqual([]);
    const feats = p0.ops.filter((o) => o.k === "feature").map((o) => (o as unknown as { feature: Feature }).feature);
    // jako engine `prepare`: „$new“ = nové těleso, když díl těleso už má
    let bodies = 1;
    feats.forEach((f, i) => {
      if ((f as { body?: string }).body === "$new") (f as { body?: string }).body = i > 0 ? `Těleso ${++bodies}` : undefined;
    });
    feats.forEach((f, i) => (f.id = `f${i}`));
    const doc = { ...emptyDoc("Kola"), features: feats };
    const sc = docToScript(doc);
    expect(sc.notes.filter((x) => !/^#/.test(x)), sc.text).toEqual([]);
    expect(sc.stats.byType.ext, sc.text).toEqual({ dedicated: 4, generic: 0, json: 0 });
    expect(sc.text).toMatch(/^kolo čelní m 2 z 24 díra 20 pero náboj 40 15$/m);
    expect(sc.text).toMatch(/^kolo šikmé m 2 z 30 beta 15 levé v 80 0 0 přidat$/m);
    expect(sc.text).toMatch(/^kolo řetězové 08B z 19 řady 2 název "Řetězka"$/m);
    expect(sc.text).toMatch(/^kolo čelní m 1.5 z 40 zuby$/m);
    expect(sc.text).not.toMatch(/název "Ozubené kolo/);
    const p = parseAgentText(sc.text);
    expect(p.errors).toEqual([]);
    const back = p.ops.filter((o) => o.k === "feature").map((o) => (o as unknown as { feature: Feature }).feature);
    expect(back.map((f) => f.name)).toEqual(feats.map((f) => f.name));
    back.forEach((f, i) => expect((f as unknown as { data: GearData }).data ?? null).toEqual((feats[i] as unknown as { data: GearData }).data ?? null));
    for (const lang of ["en", "de"] as const) {
      const s2 = docToScript(doc, { lang });
      expect(s2.stats.byType.ext, `${lang}\n${s2.text}`).toEqual({ dedicated: 4, generic: 0, json: 0 });
      expect(s2.text).toMatch(lang === "en" ? /^gear spur /m : /^rad stirnrad /m);
    }
  });
});

describe("návod pro AI – kapitola Kola a ozubení", () => {
  it("tři příklady z návodu jdou přečíst bez chyb a dají očekávané operace", async () => {
    const { AGENT_GUIDE } = await import("./agent-guide");
    const at = AGENT_GUIDE.indexOf("### Kola a ozubení");
    expect(at).toBeGreaterThan(0);
    const chapter = AGENT_GUIDE.slice(at, AGENT_GUIDE.indexOf("\n### ", at + 10));
    const blocks = [...chapter.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(3);
    const kinds = blocks.map((b) => {
      const p = parseAgentText(b);
      expect(p.errors, b).toEqual([]);
      return p.ops.map((o) => o.k);
    });
    expect(kinds[0]).toEqual(["new", "feature", "api", "drawingCmd", "drawingCmd", "out"]);
    expect(kinds[1].filter((k) => k === "feature")).toHaveLength(5); // kvádr, 2 díry, 2 kola
    expect(kinds[1].filter((k) => k === "asm").length).toBeGreaterThanOrEqual(3); // vazba ozubení + 2 závěsy
    expect(kinds[1]).toContain("insert");
    expect(kinds[2].filter((k) => k === "feature")).toHaveLength(3);
    // EN / DE ukázky z odrážek
    for (const line of ["gear spur m 2 z 24 b 20 bore 20 keyway hub 40 15 both sides", "gear helical m 2 z 30 beta 15 left", "gear sprocket 08B z 19 strands 2", "gear table all", "gear help spur", "gearpair spur m 2 z1 20 z2 60 a 81", "rad stirnrad m 2 z 24 bohrung 20 nut nabe 40 15 beide seiten", "rad kettenrad 08B z 19 reihen 2", "rad tabelle alle", "radpaar stirnrad m 2 z1 20 z2 60 a 81", "prvek gear.spur m=2 z=24 b=20 bore=20 keyway=ano hubD=40 hubL=15", "výkres tabulka ozubení ano", "drawing gear table yes", "zeichnung verzahnungstabelle ja"])
      expect(parseAgentText(line).errors, line).toEqual([]);
  });
});

describe("dokument → skript: list s tabulkou ozubení", () => {
  it("volba listu gearTable se zapíše „tabulka ozubení ano“ a přečte zpět", async () => {
    const { docToScript, SCRIPT_SHEET_DEFAULTS } = await import("./doc-script");
    const f = { id: "g", name: "Ozubené kolo m2 z24", type: "ext", ext: "gear.spur", data: KINDS.spur.defaults() } as unknown as Feature;
    const doc = { ...emptyDoc("Kolo"), features: [f], drawings: [{ id: "s1", name: "List 1", options: { ...SCRIPT_SHEET_DEFAULTS, sheet: "A3", gearTable: true }, meta: {}, annotations: [] }] };
    for (const lang of ["cs", "en", "de"] as const) {
      const sc = docToScript(doc, { lang });
      expect(sc.text, lang).toMatch(lang === "cs" ? /^výkres A3 tabulka ozubení ano$/m : lang === "en" ? /^drawing A3 geartable yes$/m : /^zeichnung A3 verzahnungstabelle ja$/m);
      expect(sc.notes.filter((x) => /volby listu/.test(x)), lang).toEqual([]);
    }
  });
});
