/**
 * Regresní testy oprav balíku annot po nezávislé kontrole: kótovací styl se všemi proměnnými (export DWG / DXF),
 * otočení souřadnicové kóty, natočení MTEXT u protilehlého rohu, anotativní kóty a odkazy ve výřezu (CANNOSCALE jako
 * v AutoCADu a balíku layout), místní hledání hranice šrafy (výkon), uložená poloha textu odkazu, zalomená kóta,
 * revizní obláček, výběr vynášecí čáry u základnicové / řetězové kóty, rovnoběžné úsečky, zaokrouhlení hodnot,
 * hranice šrafy na elipse, chybové hlášení DIMSTYLE, překlad „Odkaz“.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { setLang, tr } from "../../i18n";
import "../index";
import { runScript } from "../commands";
import { newDraftModel } from "../doc";
import { xfMirror, xfRotate } from "../geom";
import { entityBox, kindLabel, kindOf } from "../kinds";
import type { DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, type DraftSession } from "../session";
import { annoMultiplier, annoScaledList } from "./anno";
import { boundaryAt, objectLoops } from "./boundary";
import { ISO25, fmtDimLen, materializeDimStyles, resolveDimStyle, roundDec } from "./dimstyle";
import { dimGeom, leaderParts, leaderText } from "./kinds-annot";
import { mtextPlain } from "./mtext";
import { hatchArea } from "./patterns";
import type { DDimension, DHatch, DLeader, DMText, DTolerance } from "./types";
import { toleranceParts } from "./gdt";

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
const last = <T extends DraftEntity>() => m.entities[m.entities.length - 1] as T;
const ent = <T extends DraftEntity>(id: string) => m.entities.find((e) => e.id === id) as T;
const kc = () => ({ model: m });
const dimText = (e: DDimension) => mtextPlain(dimGeom(e, kc()).text).join(" ");
const textPart = (e: DDimension, model = m) => dimGeom(e, { model }).parts.find((p) => p.type === "mtext") as unknown as DMText;
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
});

describe("kótovací styl – uložené všechny proměnné (DWG / DXF nespoléhá na skryté ISO-25)", () => {
  it("první kóta zhmotní ISO-25 se všemi proměnnými a vars.dimstyle; text 100,5", () => {
    expect(m.dimStyles?.length ?? 0).toBe(0);
    const r = ok("kóta-lineární 0,0 100.5,0 50,-15");
    expect(r.length).toBe(1);
    const st = m.dimStyles!.find((x) => x.name === "ISO-25")!;
    for (const [k, v] of Object.entries(ISO25)) expect((st as unknown as Record<string, unknown>)[k], k).toEqual(v);
    expect(st.dimtxt).toBe(2.5);
    expect(st.dimasz).toBe(2.5);
    expect(st.dimdsep).toBe(",");
    expect(st.dimtofl).toBe(true);
    expect(st.dimcen).toBe(2.5);
    expect(m.vars.dimstyle).toBe("ISO-25");
    expect(dimText(last<DDimension>())).toBe("100,5");
  });
  it("neúplná tabulka (ISO-25 jen s názvem) se doplní; nový styl je úplná kopie; zpět vrátí obojí jedním krokem", () => {
    m = { ...m, dimStyles: [{ name: "ISO-25" }], vars: { ...m.vars } };
    s = sessionFor(m);
    ok("kóta-lineární 0,0 10,0 5,-5");
    expect(m.dimStyles![0].dimtxt).toBe(2.5);
    ok("kótovací-styl nový Strojní dimtxt 3.5");
    const st = m.dimStyles!.find((x) => x.name === "Strojní")!;
    expect(st.dimtxt).toBe(3.5);
    expect(st.dimasz).toBe(2.5);
    expect(st.dimdsep).toBe(",");
    const m2 = materializeDimStyles(m);
    expect(m2).toBe(m);
  });
});

describe("souřadnicová kóta – otočení zachová hodnotu", () => {
  it("Y-báze otočená o 90° měří dál 20 (dřív 50); X-báze 50", () => {
    ok("kóta-souřadnicová 50,20 90,20");
    const y = last<DDimension>();
    expect(y.xAxis).toBeUndefined();
    close(dimGeom(y, kc()).measured, 20);
    const y2 = kindOf(y)!.transform(y, xfRotate(Math.PI / 2), kc()) as DDimension;
    close(dimGeom(y2, kc()).measured, 20);
    expect(y2.xAxis).toBe(true);
    expect(y2.hdir).toBeUndefined();
    ok("kóta-souřadnicová 50,20 50,60");
    const x = last<DDimension>();
    const x2 = kindOf(x)!.transform(x, xfRotate(Math.PI / 2), kc()) as DDimension;
    close(dimGeom(x2, kc()).measured, 50);
    expect(x2.xAxis).toBeUndefined();
  });
  it("obecný úhel 30° a zrcadlení: hodnota stejná, natočení soustavy v hdir; zpět o −30° = bez hdir", () => {
    ok("kóta-souřadnicová počátek 10,10 50,20 50,60");
    const x = last<DDimension>();
    close(dimGeom(x, kc()).measured, 40);
    const r = kindOf(x)!.transform(x, xfRotate(Math.PI / 6, [3, 7]), kc()) as DDimension;
    close(dimGeom(r, kc()).measured, 40);
    close(r.hdir!, 30);
    const back = kindOf(r)!.transform(r, xfRotate(-Math.PI / 6, [3, 7]), kc()) as DDimension;
    expect(back.hdir).toBeUndefined();
    expect(back.xAxis).toBe(true);
    close(dimGeom(back, kc()).measured, 40);
    const mir = kindOf(x)!.transform(x, xfMirror([0, 0], [1, 1]), kc()) as DDimension;
    close(dimGeom(mir, kc()).measured, 40);
    // řetězová kóta v otočené soustavě měří podél stejné osy
    const r2 = kindOf(x)!.transform(x, xfRotate(Math.PI / 6), kc()) as DDimension;
    m = { ...m, entities: [...m.entities.slice(0, -1), r2] };
    s = sessionFor(m);
    const f2: Vec2 = [r2.p1![0] + 10 * Math.cos(Math.PI / 6), r2.p1![1] + 10 * Math.sin(Math.PI / 6)];
    ok(`kóta-řetězová ${f2[0]},${f2[1]} ""`);
    close(dimGeom(last<DDimension>(), kc()).measured, 50, 1e-9);
  });
});

describe("MTEXT – natočení zadané u protilehlého rohu", () => {
  it("stejný výsledek jako natočení u prvního rohu: p = (−20, 0), w = 50", () => {
    ok('mtext 0,0 natočení 90 -20,50 "abc"');
    const a = last<DMText>();
    ok('mtext natočení 90 0,0 -20,50 "abc"');
    const b = last<DMText>();
    for (const t of [a, b]) {
      close(t.p[0], -20);
      close(t.p[1], 0);
      close(t.w, 50);
      expect(t.rot).toBe(90);
    }
  });
});

describe("anotativní kóty a odkazy – měřítko výřezu (smlouva s balíkem layout)", () => {
  it("styl s DIMANNO: kóta i odkaz mají příznak a ve výřezu 1:50 / 1:10 se zvětší (125 / 25)", () => {
    ok('kótovací-styl nový ANNO dimanno 1; kóta-lineární 0,0 100,0 50,-15; odkaz 10,10 30,25 "L"');
    const d = m.entities.find((e) => e.type === "dimension") as DDimension;
    const l = m.entities.find((e) => e.type === "leader") as DLeader;
    expect(d.annotative).toBe(true);
    expect(l.annotative).toBe(true);
    for (const [k, h] of [[50, 125], [10, 25]] as const) {
      const list = annoScaledList(m.entities, k);
      const ds = list.find((e) => e.id === d.id) as DDimension;
      const ls = list.find((e) => e.id === l.id) as DLeader;
      close(textPart(ds).h, h, 1e-9);
      const lt = leaderParts(ls, kc()).find((p) => p.type === "mtext") as unknown as DMText;
      close(lt.h, h, 1e-9);
      // šipka odkazu = DIMASZ × k
      const arrow = leaderParts(ls, kc()).find((p) => p.type === "hatch") as unknown as DHatch;
      const b = arrow.loops[0].pts;
      close(Math.hypot(b[0][0] - (b[1][0] + b[2][0]) / 2, b[0][1] - (b[1][1] + b[2][1]) / 2), 2.5 * k, 1e-9);
    }
  });
  it("kóta stylu s DIMANNO bez příznaku (starší výkres) – annoScaledList s modelem; DIMSTYLE upravit dimanno synchronizuje", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    const d = last<DDimension>();
    expect(d.annotative).toBeUndefined();
    m = { ...m, dimStyles: m.dimStyles!.map((x) => ({ ...x, dimanno: true })) };
    const list = annoScaledList(m.entities, 20, m);
    close(textPart(list.find((e) => e.id === d.id) as DDimension).h, 50, 1e-9);
    s = sessionFor(m);
    ok("kótovací-styl upravit ISO-25 dimanno 0");
    expect(last<DDimension>().annotative).toBeUndefined();
    ok("kótovací-styl upravit ISO-25 dimanno 1");
    expect(last<DDimension>().annotative).toBe(true);
  });
  it("CANNOSCALE = papír : skutečnost (1:50 → 0,02) jako AutoCAD a balík layout; tolerance a drsnost bez dvojího měřítka", () => {
    ok("kótovací-styl upravit ISO-25 dimanno 1; kótovací-styl měřítko-poznámek 1:50");
    close(m.vars.cannoscale!, 0.02, 1e-15);
    close(annoMultiplier(m), 50, 1e-9);
    ok("kóta-lineární 0,0 1000,0 500,-300");
    close(textPart(last<DDimension>()).h, 125, 1e-9);
    // výkres s měřítkem nastaveným balíkem layout (cannoscale 0,1 = 1:10)
    m = { ...m, vars: { ...m.vars, cannoscale: 0.1 } };
    close(textPart(last<DDimension>(), m).h, 25, 1e-9);
    m = { ...m, vars: { ...m.vars, cannoscale: 0.02 } };
    s = sessionFor(m);
    ok("tolerance poloha 0.1 A 0,0; drsnost 50,0 0 \"Ra 1,6\"");
    const t = m.entities.find((e) => e.type === "tolerance") as DTolerance;
    expect(t.annotative).toBe(true);
    close(t.h, 2.5);
    const txt = toleranceParts(t, kc(), 50).parts.find((p) => p.type === "text") as unknown as { h: number };
    close(txt.h, 125, 1e-9);
    const sym = m.entities.find((e) => e.type === "surfsym") as unknown as { h: number; annotative?: boolean };
    expect(sym.annotative).toBe(true);
    close(sym.h, 2.5);
    const r = ok("kótovací-styl");
    expect(r[0].data?.annoScale).toBe(50);
  });
});

describe("šrafa vnitřním bodem – místní výpočet (výkon) a přesnost", () => {
  it("1500 kružnic se šrafou skriptem v jednom volání: čas roste lineárně (dřív kvadraticky)", () => {
    const t0 = performance.now();
    const lines: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = (i % 50) * 10;
      const y = Math.floor(i / 50) * 10;
      lines.push(`kružnice ${x},${y} 3; šrafa plná ${x},${y}`);
    }
    ok(lines.join("; "));
    const ms = performance.now() - t0;
    expect(m.entities.filter((e) => e.type === "hatch").length).toBe(1500);
    const h = last<DHatch>();
    close(hatchArea(h), Math.PI * 9, 1e-9);
    expect(ms).toBeLessThan(30000);
    // jedna šrafa ve velkém výkrese: místní okno
    const t1 = performance.now();
    const r = boundaryAt(m, m.entities, [250, 70]);
    expect(performance.now() - t1).toBeLessThan(50);
    expect(r?.loops.length).toBe(1);
  });
  it("oblast větší než první okno: velký obdélník s ostrovy daleko od bodu (okno se zvětšuje)", () => {
    ok("obdélník 0,0 1000,600; kružnice 900,500 20; kružnice 100,100 5; obdélník 2000,0 2010,10");
    const r = boundaryAt(m, m.entities, [3, 3])!;
    expect(r.loops.length).toBe(3);
    close(Math.abs(hatchArea({ id: "x", layer: "0", type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: r.loops } as DHatch)), 600000 - Math.PI * 425, 1e-6);
  });
  it("elipsa a uzavřený spline: hranice z oblouků, plocha elipsy π·a·b na 1e-6 (dřív −0,07 %)", () => {
    ok("elipsa 0,0 50,0 20");
    const ab = Math.PI * 25 * 20;
    ok("šrafa plná 25,0");
    const h1 = last<DHatch>();
    expect(Math.abs(hatchArea(h1) - ab) / ab).toBeLessThan(1e-6);
    const el = m.entities.find((e) => e.type === "ellipse")!;
    const o = objectLoops([el], kc());
    const h2 = { id: "x", layer: "0", type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: o.loops } as DHatch;
    expect(Math.abs(hatchArea(h2) - ab) / ab).toBeLessThan(1e-6);
  });
});

describe("odkaz – uložená poloha textu, překlad", () => {
  it("MLEADER uloží polohu textu (zalomení + mezera) – DWG / DXF ji zapíše beze ztráty", () => {
    ok('odkaz 10,10 30,25 "Sražení"');
    const l = last<DLeader>();
    expect(l.textPos).toBeDefined();
    close(l.textPos![0], 30 + 5 + 0.625);
    close(l.textPos![1], 25);
    const t = leaderText(l, kc())!;
    close(t.p[0], l.textPos![0]);
    expect(t.attach).toBe(4);
  });
  it("EN / DE: „Odkaz“ (odkazová čára) se nepřekládá jako Link", () => {
    setLang("en");
    expect(kindLabel("leader")).toBe("Leader");
    expect(tr("Multiodkaz")).toBe("Multileader");
    const r = ok('mleader 10,10 30,25 "T"');
    expect(String(r[0].log ?? "")).not.toMatch(/Link/);
    setLang("de");
    expect(kindLabel("leader")).not.toBe("Link");
    expect(tr("Multiodkaz")).not.toBe("Link");
    setLang("cs");
  });
});

describe("kóty – zalomená, rovnoběžné úsečky, výběr vynášecí čáry, zaokrouhlení", () => {
  it("zalomená kóta poloměru: kótovací čára jde monotónně k náhradnímu středu, příčka pod DIMJOGANG 45°", () => {
    ok("kružnice 0,-450 500; kóta-poloměr zalomená e1@0,50 0,-20 30,60 20,0");
    const d = last<DDimension>();
    const g = dimGeom(d, kc());
    const lines = g.parts.filter((p) => p.type === "line") as unknown as { a: Vec2; b: Vec2 }[];
    expect(lines.length).toBe(3);
    const c: Vec2 = [0, -450];
    const ch = d.chord!;
    const u: Vec2 = [(ch[0] - c[0]) / 500, (ch[1] - c[1]) / 500];
    const proj = (p: Vec2) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
    const pts = [lines[0].a, lines[0].b, lines[1].b, lines[2].b];
    for (let i = 1; i < pts.length; i++) expect(proj(pts[i])).toBeLessThan(proj(pts[i - 1]) + 1e-9);
    const v: Vec2 = [lines[1].b[0] - lines[1].a[0], lines[1].b[1] - lines[1].a[1]];
    const along = Math.abs(v[0] * u[0] + v[1] * u[1]);
    const across = Math.abs(v[0] * -u[1] + v[1] * u[0]);
    close(Math.atan2(across, along), Math.PI / 4, 1e-9);
    close(g.measured, 500);
  });
  it("úhlová kóta mezi rovnoběžkami = chyba, žádná neviditelná entita", () => {
    ok("čára 0,0 50,0; čára 0,10 50,10");
    const n = m.entities.length;
    const r = run("kóta-úhlová e1 e2 40,15");
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toMatch(/rovnoběžné/);
    expect(m.entities.length).toBe(n);
  });
  it("Vybrat u základnicové / řetězové kóty: výchozí je vynášecí čára nejblíž výběru (AutoCAD)", () => {
    ok("kóta-lineární 0,0 100,0 50,-15");
    ok('kóta-základnicová vybrat e1@100,-5 150,0 ""');
    let d = last<DDimension>();
    close(dimGeom(d, kc()).measured, 50);
    ok('kóta-řetězová vybrat e1@0,-5 -50,0 ""');
    d = last<DDimension>();
    close(dimGeom(d, kc()).measured, 50);
    // bez Vybrat: základnicová od p1, řetězová od p2 poslední kóty (beze změny)
    ok("kóta-lineární 0,50 100,50 50,65; kóta-základnicová 150,50 \"\"");
    close(dimGeom(last<DDimension>(), kc()).measured, 150);
  });
  it("zaokrouhlení podle desetinného zápisu: 1,005 → 1,01; 2,675 → 2,68; 0,125 → 0,13; −1,005 → −1,01", () => {
    const st = { ...resolveDimStyle(m, undefined), dimzin: 8 };
    expect(fmtDimLen(1.005, st)).toBe("1,01");
    expect(fmtDimLen(2.675, st)).toBe("2,68");
    expect(fmtDimLen(0.125, st)).toBe("0,13");
    expect(fmtDimLen(-1.005, st)).toBe("-1,01");
    expect(fmtDimLen(1.0049999999999999, st)).toBe("1,01");
    expect(roundDec(1234567.125, 2)).toBe(1234567.13);
    ok("kóta-lineární 0,0 1.005,0 0.5,-5; kóta-lineární 0,0 2.675,0 1,-5");
    const dims = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    expect(dims.map(dimText)).toEqual(["1,01", "2,68"]);
  });
  it("DIMSTYLE upravit s neznámou proměnnou hlásí její název; neexistující styl před proměnnými = chyba stylu", () => {
    let r = run("kótovací-styl upravit dimfoo 3");
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toMatch(/dimfoo/);
    r = run("kótovací-styl upravit Neni dimtxt 3");
    expect(r[0].error).toMatch(/Neni/);
    ok("kótovací-styl upravit dimtxt 3");
    expect(resolveDimStyle(m, undefined).dimtxt).toBe(3);
  });
});

describe("revizní obláček – oblouky ven, volba Obrátit", () => {
  it("obdélník: obálka větší než obdélník, středy oblouků vně; Obrátit = dovnitř", () => {
    ok("revizní-obláček 0,0 100,50");
    const b = entityBox(last(), kc())!;
    expect(b.x0).toBeLessThan(-1);
    expect(b.y0).toBeLessThan(-1);
    expect(b.x1).toBeGreaterThan(101);
    expect(b.y1).toBeGreaterThan(51);
    ok("revizní-obláček obrátit 0,0 100,50");
    const b2 = entityBox(last(), kc())!;
    close(b2.x0, 0, 1e-9);
    close(b2.x1, 100, 1e-9);
    ok("kružnice 300,0 50; revizní-obláček objekt e3");
    const b3 = entityBox(last(), kc())!;
    expect(b3.x1).toBeGreaterThan(350.5);
  });
});

describe("dvojitý kontrolní výpočet: původní testy hodnot beze změny", () => {
  it("lineární 100 a Ø40 / R20", () => {
    ok("kóta-lineární 0,0 100,0 50,-15; kružnice 0,0 20; kóta-průměr e2 30,30; kóta-poloměr e2 -30,30");
    const dims = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    expect(dims.map(dimText)).toEqual(["100", "%%c40".replace("%%c", "Ø"), "R20"]);
    expect(ent<DDimension>(dims[0].id).style).toBe("ISO-25");
  });
});
