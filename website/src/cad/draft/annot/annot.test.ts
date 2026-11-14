import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../../i18n";
import "../index";
import { findCommand, runScript } from "../commands";
import { newDraftModel } from "../doc";
import { xfMirror, xfRotate, xfScale } from "../geom";
import { entityBox, entityCurves, entityPrims, kindOf } from "../kinds";
import type { DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, type DraftSession } from "../session";
import { annoScaledList } from "./anno";
import { dimValueText, fmtDimLen, resolveDimStyle } from "./dimstyle";
import { dimGeom } from "./kinds-annot";
import { codesToEditor, editorToCodes, escapeMText, layoutMText, mtextPlain, parseMText } from "./mtext";
import { hatchArea, hatchLines, hatchSegments, parsePat } from "./patterns";
import { buildTolerance, tolerancePlain } from "./gdt";
import type { DDimension, DHatch, DLeader, DMText, DTolerance } from "./types";

let m: DraftModel;
let s: DraftSession;
const run = (text: string) => {
  const r = runScript(m, s, text);
  m = r.model;
  return r.results;
};
const ok = (text: string) => {
  const r = run(text);
  for (const x of r) expect(x.error, x.input).toBeUndefined();
  return r;
};
const ent = <T extends DraftEntity>(id: string) => m.entities.find((e) => e.id === id) as T;
const last = <T extends DraftEntity>() => m.entities[m.entities.length - 1] as T;
const kc = () => ({ model: m });
const dimText = (e: DDimension) => mtextPlain(dimGeom(e, kc()).text).join(" ");
const textPart = (e: DDimension) => dimGeom(e, kc()).parts.find((p) => p.type === "mtext") as unknown as DMText;
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(eps);

beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
});

describe("příkazy balíku annot – názvy CS / EN / DE a zkratky", () => {
  it("všechny příkazy smlouvy jsou registrované", () => {
    const names: [string, string[]][] = [
      ["MTEXT", ["mtext", "MT", "T", "absatztext"]],
      ["STYLE", ["styl-textu", "style", "stil", "ST"]],
      ["TEXTEDIT", ["upravit-text", "textedit", "ED"]],
      ["DIM", ["kóta", "kota", "dim", "bem"]],
      ["DIMLINEAR", ["kóta-lineární", "dimlinear", "bemlinear", "DLI"]],
      ["DIMALIGNED", ["kóta-zarovnaná", "dimaligned", "bemausg", "DAL"]],
      ["DIMANGULAR", ["kóta-úhlová", "dimangular", "bemwinkel", "DAN"]],
      ["DIMRADIUS", ["kóta-poloměr", "dimradius", "bemradius", "DRA"]],
      ["DIMDIAMETER", ["kóta-průměr", "dimdiameter", "bemdurchm", "DDI"]],
      ["DIMARC", ["kóta-oblouku", "dimarc", "bembogen", "DAR"]],
      ["DIMORDINATE", ["kóta-souřadnicová", "dimordinate", "bemordinate", "DOR"]],
      ["DIMBASELINE", ["kóta-základnicová", "dimbaseline", "bembasisl", "DBA"]],
      ["DIMCONTINUE", ["kóta-řetězová", "dimcontinue", "bemweiter", "DCO"]],
      ["DIMSTYLE", ["kótovací-styl", "dimstyle", "bemstil", "D", "DST"]],
      ["MLEADER", ["odkaz", "mleader", "mführung", "MLD", "LE"]],
      ["HATCH", ["šrafa", "hatch", "schraff", "H", "BH"]],
      ["HATCHEDIT", ["upravit-šrafu", "hatchedit", "schraffedit", "HE"]],
      ["TOLERANCE", ["tolerance", "toleranz", "TOL"]],
      ["CENTERMARK", ["značka-středu", "centermark", "zentrumsmarke", "CM"]],
      ["REVCLOUD", ["revizní-obláček", "revcloud", "revwolke"]],
      ["SURFSYM", ["drsnost", "surfsym", "rauheit"]],
    ];
    for (const [id, ns] of names) for (const n of ns) expect(findCommand(n)?.id, n).toBe(id);
  });
});

describe("kóty – hodnoty a text podle stylu", () => {
  it("lineární 100 (ISO-25: bez koncových nul, desetinná čárka) a 100,000 se stylem DIMDEC 3 DIMZIN 0", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    const d = last<DDimension>();
    expect(d.kind).toBe("linear");
    close(dimGeom(d, kc()).measured, 100);
    expect(dimText(d)).toBe("100");
    ok("kótovací-styl nový Přesný z ISO-25 dimdec 3 dimzin 0");
    ok("kóta-lineární 0,0 100,0 50,-30");
    expect(dimText(last<DDimension>())).toBe("100,000");
    expect(fmtDimLen(33.3333333, resolveDimStyle(m, "Přesný"))).toBe("33,333");
    // DIMLFAC a DIMPOST, přepis textu <>
    ok("kótovací-styl upravit Přesný dimlfac 0.5 dimpost \" mm\" dimdec 1");
    expect(dimText(last<DDimension>())).toBe("50,0 mm");
    ok(`upravit-text ${last().id} "<> H7"`);
    expect(dimText(last<DDimension>())).toBe("50,0 mm H7");
  });
  it("poloha textu: nad kótovací čárou o DIMGAP + polovinu výšky, čitelně (svislá kóta čte zdola)", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    const t = textPart(last<DDimension>());
    closeP(t.p, [50, -15 + 0.625 + 1.25]);
    expect(t.rot ?? 0).toBe(0);
    ok("kóta-lineární 0,0 0,60 -20,30");
    const d = last<DDimension>();
    expect(d.rot).toBe(90);
    close(dimGeom(d, kc()).measured, 60);
    const tv = textPart(d);
    close(tv.rot!, 90);
    closeP(tv.p, [-20 - 0.625 - 1.25, 30]);
  });
  it("úhlová 45° (dvě úsečky, kvadrant podle polohy oblouku), 3 body přes 180°", () => {
    ok("čára 0,0 100,0; čára 0,0 70.71067811865476,70.71067811865476");
    const [l1, l2] = m.entities.map((e) => e.id);
    ok(`kóta-úhlová ${l1}@50,0 ${l2}@35,35 40,15`);
    const d = last<DDimension>();
    expect(d.kind).toBe("angular");
    close(dimGeom(d, kc()).measured, 45, 1e-9);
    expect(dimText(d)).toBe("45°");
    // vedlejší úhel (oblouk na druhé straně) = 135°
    ok(`kóta-úhlová ${l1}@50,0 ${l2}@35,35 -30,20`);
    close(dimGeom(last<DDimension>(), kc()).measured, 135, 1e-9);
    ok('kóta-úhlová "" 0,0 50,0 0,50 -30,-30');
    close(dimGeom(last<DDimension>(), kc()).measured, 270, 1e-9);
  });
  it("průměr Ø40 a poloměr R20 (kružnice, oblouk), zalomená kóta", () => {
    ok("kružnice 50,50 20; oblouk 120,30 140,50 120,70");
    const [c1, a1] = m.entities.map((e) => e.id);
    ok(`kóta-průměr ${c1} 80,70`);
    const d = last<DDimension>();
    close(dimGeom(d, kc()).measured, 40);
    expect(dimText(d)).toBe("Ø40");
    ok(`kóta-poloměr ${a1} 150,60`);
    const r = last<DDimension>();
    close(dimGeom(r, kc()).measured, 20);
    expect(dimText(r)).toBe("R20");
    ok(`kóta-poloměr zalomená ${c1} 50,0 60,60 55,30`);
    const j = last<DDimension>();
    expect(j.jog).toBeDefined();
    close(dimGeom(j, kc()).measured, 20);
  });
  it("délka oblouku, souřadnicová, zarovnaná", () => {
    ok("oblouk střed 0,0 50,0 0,50");
    ok(`kóta-oblouku ${last().id} 50,50`);
    close(dimGeom(last<DDimension>(), kc()).measured, (Math.PI / 2) * 50, 1e-9);
    ok("kóta-souřadnicová 50,20 50,60");
    let d = last<DDimension>();
    expect(d.xAxis).toBe(true);
    expect(dimText(d)).toBe("50");
    ok("kóta-souřadnicová 50,20 90,20");
    d = last<DDimension>();
    expect(dimText(d)).toBe("20");
    ok("kóta-zarovnaná 0,0 30,40 -10,50");
    close(dimGeom(last<DDimension>(), kc()).measured, 50);
  });
  it("základnicové a řetězové kóty, rozestup DIMDLI", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    ok("kóta-základnicová 150,0 200,0");
    const b = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    expect(b.length).toBe(3);
    close(dimGeom(b[1], kc()).measured, 150);
    close(dimGeom(b[2], kc()).measured, 200);
    close(b[1].line![1], -15 - 3.75);
    close(b[2].line![1], -15 - 7.5);
    ok("kóta-lineární 0,100 40,100 20,120");
    ok("kóta-řetězová 70,100 100,100");
    const c = m.entities.filter((e) => e.type === "dimension").slice(-3) as DDimension[];
    expect(c.map((x) => Math.round(dimGeom(x, kc()).measured))).toEqual([40, 30, 30]);
    expect(c.every((x) => Math.abs(x.line![1] - 120) < 1e-9)).toBe(true);
  });
  it("tolerance ±, úchylky a meze (stoh MTEXT)", () => {
    ok("kótovací-styl nový Tol z ISO-25 dimtol 1 dimtp 0.1 dimtm 0.1");
    ok("kóta-lineární 0,0 40,0 20,-10");
    expect(dimText(last<DDimension>())).toBe("40±0,10");
    ok("kótovací-styl upravit Tol dimtm 0.2");
    expect(dimGeom(last<DDimension>(), kc()).text).toContain("\\S+0,10^-0,20;");
    ok("kótovací-styl upravit Tol dimtol 0 dimlim 1");
    expect(mtextPlain(dimGeom(last<DDimension>(), kc()).text).join("")).toBe("40,10 39,80");
  });
  it("chytrá kóta DIM podle objektu (úsečka, kružnice, oblouk)", () => {
    ok("čára 0,0 100,0; kružnice 200,0 15; oblouk 300,0 320,20 340,0");
    const [l, c1, a] = m.entities.map((e) => e.id);
    ok(`kóta ${l} 50,-10; kóta ${c1} 230,20; kóta ${a} 350,30`);
    const ds = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    expect(ds.map((d) => d.kind)).toEqual(["linear", "diameter", "radius"]);
    expect(ds.map((d) => dimText(d))).toEqual(["100", "Ø30", "R20"]);
  });
  it("kóta je asociativní na definiční body (úchop / nastavit = nová hodnota)", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    const id = last().id;
    ok(`nastavit ${id} p2 120,0`);
    expect(dimText(ent<DDimension>(id))).toBe("120");
    const k = kindOf("dimension")!;
    const moved = k.moveGrip!(ent(id), 0, [20, 0], kc()) as DDimension;
    close(dimGeom(moved, kc()).measured, 100);
  });
});

describe("kóty – transformace", () => {
  it("zrcadlení: text zůstane čitelný, hodnota stejná; otočení a měřítko", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    const d = last<DDimension>();
    const k = kindOf(d)!;
    const mir = k.transform(d, xfMirror([0, 0], [0, 1]), kc()) as DDimension;
    close(dimGeom(mir, kc()).measured, 100);
    const t = textPart(mir);
    const r = ((t.rot ?? 0) + 360) % 360;
    expect(r < 90 + 1e-9 || r > 270 - 1e-9).toBe(true);
    closeP(t.p, [-50, -15 + 0.625 + 1.25]);
    // zrcadlení podle vodorovné osy: text nad čarou (ne vzhůru nohama)
    const mir2 = k.transform(d, xfMirror([0, 0], [1, 0]), kc()) as DDimension;
    const t2 = textPart(mir2);
    expect(((t2.rot ?? 0) + 360) % 360).toBeLessThan(1e-9);
    closeP(t2.p, [50, 15 + 0.625 + 1.25]);
    const rot = k.transform(d, xfRotate(Math.PI / 2), kc()) as DDimension;
    close(rot.rot!, 90);
    close(dimGeom(rot, kc()).measured, 100);
    const sc = k.transform(d, xfScale(2), kc()) as DDimension;
    close(dimGeom(sc, kc()).measured, 200);
  });
  it("MTEXT zrcadlený zůstane čitelný se zrcadleným středem rámečku", () => {
    ok('mtext 10,20 @40,-10 "Text"');
    const e = last<DMText>();
    const b0 = entityBox(e, kc())!;
    const mir = kindOf(e)!.transform(e, xfMirror([0, 0], [0, 1]), kc()) as DMText;
    expect(mir.rot ?? 0).toBe(0);
    const b1 = entityBox(mir, kc())!;
    close((b1.x0 + b1.x1) / 2, -(b0.x0 + b0.x1) / 2, 1e-6);
  });
});

describe("MTEXT – kódy a sazba", () => {
  it("formátovací kódy: odstavce, barva, výška, stoh, zvláštní znaky; prostý text a editor", () => {
    const base = { h: 2.5, fontName: "Arial", wf: 1, oblique: 0 };
    const p = parseMText("{\\fArial|b1;Tučně}\\P{\\C1;červená} %%c20 \\S1/2;\\P\\H5;Velký \\\\ \\{x\\}", base);
    expect(p.length).toBe(3);
    expect(p[0][0]).toMatchObject({ k: "t", s: "Tučně", st: { bold: true } });
    expect(p[1].find((x) => x.k === "t" && x.s === "červená")?.st.color).toBe(1);
    expect(p[1].some((x) => x.k === "stack" && x.a === "1" && x.b === "2" && x.t === "/")).toBe(true);
    expect(mtextPlain("A\\PØ%%c\\P\\U+00B0")).toEqual(["A", "ØØ", "°"]);
    expect(p[2][0].st.h).toBe(5);
    expect(escapeMText("a\\b{c}\nd")).toBe("a\\\\b\\{c\\}\\Pd");
    expect(editorToCodes(codesToEditor("x\\Py\\\\P"))).toBe("x\\Py\\\\P");
  });
  it("zalomení do šířky a řádkování 5/3 × výška", () => {
    const base = { h: 1, fontName: "Arial", wf: 1, oblique: 0 };
    const lay = layoutMText(parseMText("aaaa bbbb cccc", base), { width: 6, baseH: 1 });
    // šířka znaku 0,62 (odhad bez prohlížeče): „aaaa bbbb“ = 5,58 < 6, „cccc“ se zalomí
    // slova téhož stylu na řádku = jeden úsek textu (i s mezerou) – méně volání fillText, EXPLODE = text na úsek
    expect(lay.glyphs.map((g) => g.s)).toEqual(["aaaa bbbb", "cccc"]);
    close(lay.glyphs[1].y, -1 - 5 / 3);
    close(lay.glyphs[0].w, 9 * 0.62, 1e-9);
    close(lay.h, 1 + 5 / 3);
  });
  it("příkaz MTEXT: rámeček, připojení, výška, rozložení na texty", () => {
    ok('mtext výška 5 zarovnání mc 10,10 @60,-20 "První\\PDruhý"');
    const e = last<DMText>();
    expect(e.attach).toBe(5);
    expect(e.h).toBe(5);
    close(e.w, 60);
    closeP(e.p, [40, 0]);
    const parts = kindOf(e)!.explode!(e, kc())!;
    expect(parts.filter((p) => p.type === "text").map((p) => (p as { s: string }).s)).toEqual(["První", "Druhý"]);
  });
});

describe("šrafy – hranice, ostrovy, plocha", () => {
  it("vnitřní bod v obdélníku s kruhovým ostrovem: plocha = 5000 − π·100; ignorovat ostrovy = 5000", () => {
    ok("obdélník 0,0 100,50; kružnice 50,25 10");
    ok("šrafa 5,5");
    const h = last<DHatch>();
    expect(h.type).toBe("hatch");
    expect(h.loops.length).toBe(2);
    close(hatchArea(h), 5000 - Math.PI * 100, 1e-6);
    ok("šrafa ostrovy ignorovat 5,5");
    close(hatchArea(last<DHatch>()), 5000, 1e-6);
    // bod uvnitř kružnice = jen kruh
    ok("šrafa plná 50,25");
    close(hatchArea(last<DHatch>()), Math.PI * 100, 1e-6);
  });
  it("oblast ze 4 samostatných úseček a oblouku, asociativní hranice", () => {
    ok("čára 0,0 60,0; čára 60,0 60,40; oblouk 60,40 30,55 0,40; čára 0,40 0,0");
    ok("šrafa vzor ANSI37 měřítko 0.5 20,20");
    const h = last<DHatch>();
    expect(h.loops.length).toBe(1);
    expect(h.boundary?.length).toBe(4);
    expect(h.pattern).toBe("ANSI37");
    // segment kruhu nad tětivou 60 se vzepětím 15
    const R = (30 * 30 + 15 * 15) / 30;
    const th = 2 * Math.asin(30 / R);
    close(hatchArea(h), 60 * 40 + (R * R * (th - Math.sin(th))) / 2, 1e-6);
  });
  it("výběr objektů, vnořené ostrovy (normální styl), uzavřenost", () => {
    ok("obdélník 0,0 100,100; obdélník 20,20 80,80; kružnice 50,50 10");
    const ids = m.entities.map((e) => e.id).join(" ");
    ok(`šrafa objekty ${ids}`);
    const h = last<DHatch>();
    close(hatchArea(h), 10000 - 3600 + Math.PI * 100, 1e-6);
    expect(run("šrafa 500,500")[0].error).toMatch(/uzavřené oblasti/);
  });
  it("vzor ANSI31: úsečky v rozteči 3,175 mm (acadiso) pod 45°, uvnitř hranice", () => {
    ok("obdélník 0,0 100,50");
    ok("šrafa 10,10");
    const h = last<DHatch>();
    const lines = hatchLines(h, true)!;
    expect(lines.length).toBe(1);
    close(Math.hypot(...lines[0].offset), 3.175, 1e-9);
    const { segs } = hatchSegments(h, lines);
    expect(segs.length).toBeGreaterThan(30);
    for (const [a, b] of segs) {
      for (const p of [a, b]) expect(p[0] >= -1e-9 && p[0] <= 100 + 1e-9 && p[1] >= -1e-9 && p[1] <= 50 + 1e-9).toBe(true);
      close(Math.atan2(b[1] - a[1], b[0] - a[0]), Math.PI / 4, 1e-9);
    }
    expect(entityPrims(h, kc()).length).toBe(segs.length);
    ok(`upravit-šrafu ${h.id} vzor ANSI37 úhel 30 měřítko 2`);
    expect(ent<DHatch>(h.id)).toMatchObject({ pattern: "ANSI37", angle: 30, scale: 2 });
  });
  it("vlastní vzor .pat, přechod, transformace šrafy", () => {
    const defs = parsePat("*MOJE, test\n0, 0,0, 0,2, 1,-1\n90, 0,0, 0,2\n");
    expect(defs[0].rows.length).toBe(2);
    ok("obdélník 0,0 10,10");
    ok("šrafa přechod lineární 1 5 5,5");
    const g = last<DHatch>();
    expect(g.gradient).toMatchObject({ name: "LINEAR", color1: 1, color2: 5 });
    expect(entityPrims(g, kc())[0].k).toBe("sub");
    const mv = kindOf(g)!.transform(g, xfMirror([0, 0], [0, 1]), kc()) as DHatch;
    close(hatchArea(mv), 100, 1e-9);
  });
});

describe("odkazy, tolerance, značky", () => {
  it("odkaz se zalomením a textem; explode = křivka, šipka, text", () => {
    ok('odkaz 10,10 30,25 "Sražení 1×45°"');
    const l = last<DLeader>();
    expect(l.pts).toEqual([[10, 10], [30, 25]]);
    expect(l.text).toBe("Sražení 1×45°");
    const parts = kindOf(l)!.explode!(l, kc())!;
    expect(parts.map((p) => p.type).sort()).toEqual(["hatch", "line", "mtext", "polyline"]);
    expect(entityCurves(l, kc()).length).toBeGreaterThan(0);
  });
  it("tolerance: strukturované zadání → řetězec DXF, rámeček", () => {
    expect(buildTolerance("j", "ø0.05M", ["A", "B", "C"])).toBe("{\\Fgdt;j}%%v{\\Fgdt;n}0.05{\\Fgdt;m}%%vA%%vB%%vC");
    ok("tolerance poloha ø0.05M A,B,C 120,40");
    const t = last<DTolerance>();
    expect(tolerancePlain(t.s)).toBe("[position] | Ø0.05(M) | A | B | C");
    const b = entityBox(t, kc())!;
    close(b.y1 - b.y0, 2 * 2.5, 1e-9);
    ok("tolerance rovinnost 0.01 - 10,10");
    expect(last<DTolerance>().s).toBe("{\\Fgdt;c}%%v0.01");
  });
  it("značka středu, revizní obláček, značka drsnosti", () => {
    ok("kružnice 0,0 20");
    ok(`značka-středu ${last().id}`);
    const lines = m.entities.filter((e) => e.type === "line");
    expect(lines.length).toBe(6);
    expect(lines.filter((e) => e.linetype === "CENTER").length).toBe(4);
    ok("revizní-obláček délka 10 0,0 100,50");
    const cl = last();
    expect(cl.type).toBe("polyline");
    ok('drsnost druh s-úběrem 50,0 0 "Ra 1,6"');
    expect(last()).toMatchObject({ type: "surfsym", kind: "removal", text: "Ra 1,6" });
    expect(kindOf(last())!.explode!(last(), kc())!.length).toBeGreaterThan(3);
  });
});

describe("styly, zamčené hladiny, anotativní měřítko, jazyky", () => {
  it("STYLE: nový, aktuální, přejmenovat (přejmenuje i texty), smazat použitý = chyba", () => {
    ok("styl-textu nový ISO písmo isocp.shx šířka 0.8");
    expect(m.vars.textstyle).toBe("ISO");
    ok('mtext 0,0 @20,-5 "x"');
    expect(last<DMText>().style).toBe("ISO");
    ok("styl-textu přejmenovat ISO Normal");
    expect(last<DMText>().style).toBe("Normal");
    expect(run("styl-textu aktuální Standard; styl-textu smazat Normal")[1].error).toMatch(/používá/);
  });
  it("DIMSTYLE: přepsání u kóty, použít styl, smazat s přesunem", () => {
    ok("kóta-lineární 0,0 33.333333,0 10,-10");
    const id = last().id;
    expect(dimText(ent(id))).toBe("33,33");
    ok(`kótovací-styl přepsat ${id} dimdec 4`);
    expect(dimText(ent(id))).toBe("33,3333");
    ok("kótovací-styl nový B dimdec 1");
    ok(`kótovací-styl použít B ${id}`);
    expect(dimText(ent(id))).toBe("33,3");
    expect(ent<DDimension>(id).overrides).toBeUndefined();
    ok("kótovací-styl aktuální ISO-25; kótovací-styl smazat B přesunout-na ISO-25");
    expect(ent<DDimension>(id).style).toBe("ISO-25");
  });
  it("zamčená hladina: úprava textu i šrafy selže, nic se nezmění", () => {
    ok('hladina nová Z; hladina aktuální Z; mtext 0,0 @20,-5 "x"; hladina aktuální 0; hladina Z zamknout');
    const id = last().id;
    const r = run(`upravit-text ${id} "y"`);
    expect(r[0].ok).toBe(false);
    expect(ent<DMText>(id).s).toBe("x");
  });
  it("anotativní kóta: velikosti × měřítko poznámek; seznam pro výřez 1:50", () => {
    ok("kótovací-styl upravit ISO-25 dimanno 1");
    ok("kóta-lineární 0,0 1000,0 500,-300");
    const d = last<DDimension>();
    expect(textPart(d).h).toBeCloseTo(2.5);
    ok("kótovací-styl měřítko-poznámek 1:50");
    expect(textPart(last<DDimension>()).h).toBeCloseTo(125);
    ok("kótovací-styl měřítko-poznámek 1:1");
    ok(`nastavit ${d.id} annotative 1`);
    const scaled = annoScaledList(m.entities, 20);
    expect(scaled).toBe(annoScaledList(m.entities, 20));
    expect(textPart(scaled[scaled.length - 1] as DDimension).h).toBeCloseTo(50);
  });
  it("anglicky a německy: příkazy i volby", () => {
    setLang("en");
    ok("dimlinear 0,0 0,50 vertical 20,25");
    expect(last<DDimension>().rot).toBe(90);
    ok('rectang 0,0 10,10; mleader 0,0 10,10 "note"; hatch pattern ANSI31 scale 2 5,5');
    setLang("de");
    ok("bemlinear 0,0 100,0 horizontal 50,-10; schraff muster ANSI37 5,5");
    expect(dimText(m.entities.filter((e) => e.type === "dimension").pop() as DDimension)).toBe("100");
    setLang("cs");
  });
  it("DIMLUNIT: zlomky, stopy-palce, inženýrské, vědecké", () => {
    const st = { ...resolveDimStyle(m, undefined), dimdsep: "." };
    expect(fmtDimLen(2.5, { ...st, dimlunit: 5, dimdec: 3 })).toBe("2 1/2");
    expect(fmtDimLen(0.375, { ...st, dimlunit: 5, dimdec: 3 })).toBe("3/8");
    expect(fmtDimLen(14.5, { ...st, dimlunit: 4, dimdec: 2 })).toBe("1'-2 1/2\"");
    expect(fmtDimLen(14.5, { ...st, dimlunit: 3, dimdec: 2, dimzin: 0 })).toBe("1'-2.50\"");
    expect(fmtDimLen(1234.5, { ...st, dimlunit: 1, dimdec: 2 })).toBe("1.23e+3");
  });
  it("dimValueText: přepis, potlačení textu mezerou, předpony", () => {
    const st = resolveDimStyle(m, undefined);
    expect(dimValueText({ kind: "diameter", text: "" }, 40, st)).toBe("%%c40");
    expect(dimValueText({ kind: "radius", text: "2× <>" }, 5, st)).toBe("2× R5");
    expect(dimValueText({ kind: "linear", text: " " }, 5, st)).toBe("");
  });
});
