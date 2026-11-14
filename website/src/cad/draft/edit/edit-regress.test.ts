/**
 * BALÍK 1 (edit) – regresní testy nálezů revize: absolutní tolerance (OŘÍZNOUT / ODSTRANIT-DUPLICITY / SPOJIT na
 * souřadnicích S-JTSK ~1e6), EKVIDISTANTA úzké drážky, spline se zlomem, výkon SPOJIT, PEDIT Vyrovnat po Proložit /
 * Spline, zamčené hladiny, volby po výkresech, Zpět uvnitř příkazu, zaoblení křivky, výzvy bez zdvojených voleb.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../../i18n";
import "../index";
import { CmdRun, findCommand, promptText, runScript } from "../commands";
import { newDraftModel } from "../doc";
import { dist } from "../geom";
import type { DLine, DPolyline, DSpline, DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, setSelection, type DraftSession } from "../session";
import { EDIT_STATE, editStateOf, MOD, PRESET } from "./shared";

const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(dist(p, q), `${p} vs ${q}`).toBeLessThan(eps);
let m: DraftModel;
let s: DraftSession;
const run = (text: string) => {
  const r = runScript(m, s, text);
  m = r.model;
  return r.results;
};
const ok = (text: string) => {
  const r = run(text);
  for (const x of r) expect(x.error, `${x.input}`).toBeUndefined();
  return r;
};
const ent = <T extends DraftEntity>(id: string) => m.entities.find((e) => e.id === id) as T;
const ids = () => m.entities.map((e) => e.id);
const reset = () => {
  m = newDraftModel();
  s = sessionFor(m);
};
/** úsečky výkresu jako [x0, x1] (vodorovné) seřazené */
const spans = () =>
  m.entities
    .filter((e): e is DLine => e.type === "line" && Math.abs(e.a[1] - e.b[1]) < 1e-9)
    .map((l) => [Math.min(l.a[0], l.b[0]), Math.max(l.a[0], l.b[0])])
    .sort((a, b) => a[0] - b[0]);

beforeEach(() => {
  setLang("cs");
  reset();
  MOD.shift = false;
  Object.assign(EDIT_STATE, { filletRad: 0, trimMode: true, quick: true, edgeExtend: false, offsetDist: 1, offsetThrough: false, offsetErase: false, offsetLayerCurrent: false });
});

describe("absolutní tolerance na velkých souřadnicích (S-JTSK ~1e6)", () => {
  it("OŘÍZNOUT: řezy 0,08 od sebe a 0,05 od konce se neslijí (stejně jako u počátku)", () => {
    for (const [X, Y] of [[0, 0], [1e6, 1e6]]) {
      reset();
      ok(`čára ${X},${Y} ${X + 10},${Y}; čára ${X + 3},${Y - 1} ${X + 3},${Y + 1}; čára ${X + 3.08},${Y - 1} ${X + 3.08},${Y + 1}`);
      ok(`oříznout e1@${X + 3.04},${Y}`);
      const sp = spans().map(([a, b]) => [a - X, b - X]);
      expect(sp.length, `X=${X}`).toBe(2);
      expect(sp[0][0]).toBeCloseTo(0, 9);
      expect(sp[0][1]).toBeCloseTo(3, 9);
      expect(sp[1][0]).toBeCloseTo(3.08, 9);
      expect(sp[1][1]).toBeCloseTo(10, 9);
      reset();
      ok(`čára ${X},${Y} ${X + 10},${Y}; čára ${X + 0.05},${Y - 1} ${X + 0.05},${Y + 1}; čára ${X + 5},${Y - 1} ${X + 5},${Y + 1}`);
      ok(`oříznout e1@${X + 2},${Y}`);
      const sp2 = spans().map(([a, b]) => [a - X, b - X]);
      expect(sp2.length, `X=${X}`).toBe(2);
      expect(sp2[0][1]).toBeCloseTo(0.05, 9);
      expect(sp2[1][0]).toBeCloseTo(5, 9);
    }
  });
  it("ODSTRANIT-DUPLICITY: rovnoběžky 0,5 od sebe zůstanou, skutečná duplicita (1e-8) zmizí", () => {
    ok("čára 1000000,1000000 1000100,1000000; čára 1000000,1000000.5 1000100,1000000.5");
    const r = ok("odstranit-duplicity vše");
    expect(r[0].deleted).toEqual([]);
    expect(m.entities.length).toBe(2);
    ok("čára 1000000,1000000.00000001 1000100,1000000");
    const r2 = ok("odstranit-duplicity vše");
    expect(r2[0].deleted).toEqual(["e3"]);
    // tolerance je absolutní: 0,6 při toleranci 1 = duplicita
    ok("čára 1000000,1000000.6 1000100,1000000.6");
    const r3 = ok("odstranit-duplicity vše tolerance 1");
    expect(r3[0].deleted.length).toBeGreaterThan(0);
  });
  it("SPOJIT: nedotýkající se úsečky se nespojí (ani šikmo, ani přes mezeru 0,8)", () => {
    ok("čára 1000000,1000000 1000100,1000000; čára 1000100.8,1000000.4 1000200,1000000.4");
    let r = ok("spojit e1 e2");
    expect(r[0].deleted).toEqual([]);
    expect(r[0].log.join(" ")).toMatch(/nic nespojeno/);
    closeP(ent<DLine>("e1").b, [1000100, 1000000], 1e-9);
    reset();
    ok("čára 1000000,1000000 1000100,1000000; čára 1000100.8,1000000 1000100.8,1000050");
    r = ok("spojit e1 e2");
    expect(ent<DLine>("e1").type).toBe("line");
    expect(r[0].deleted).toEqual([]);
    // dotýkající se úsečky na 1e6 se spojí do křivky
    reset();
    ok("čára 1000000,1000000 1000100,1000000; čára 1000100,1000000 1000100,1000050");
    ok("spojit e1 e2");
    expect(ent<DPolyline>("e1").pts.length).toBe(3);
  });
  it("SPOJIT 20 000 úseček v náhodném pořadí: lineárně (dřív 16 s)", () => {
    const N = 20000;
    const pts: Vec2[] = Array.from({ length: N + 1 }, (_, i) => [i, i % 2 ? 1 : 0]);
    const order = Array.from({ length: N }, (_, i) => i);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    m = { ...m, entities: order.map((i, k) => ({ id: `e${k + 1}`, layer: "0", type: "line", a: pts[i], b: pts[i + 1] })) as DraftEntity[], seq: N };
    s = sessionFor(m);
    const t = performance.now();
    ok("spojit vše");
    expect(performance.now() - t).toBeLessThan(4000);
    expect(m.entities.length).toBe(1);
    const P = (m.entities[0] as DPolyline).pts;
    expect(P.length).toBe(N + 1);
    // řetěz začíná zdrojem (první vybraný = e1) a prochází body po sobě
    for (let i = 1; i < P.length; i++) expect(Math.abs(P[i][0] - P[i - 1][0])).toBe(1);
  });
});

describe("EKVIDISTANTA úzké drážky „U“ (vzdálenost ≥ polovina šířky)", () => {
  it("d = 3 > 2: svislý úsek na x = 97 (ne na zdrojové hraně x = 100); d = 2: jedna čára bez zdvojení; d = 1,9 beze změny", () => {
    ok("křivka 0,0 100,0 100,4 0,4");
    ok("ekvidistanta 3 e1 50,2");
    expect(ent<DPolyline>("e2").pts).toEqual([[0, 3], [97, 3], [97, 1], [0, 1]]);
    reset();
    ok("křivka 0,0 100,0 100,4 0,4");
    ok("ekvidistanta 2 e1 50,2");
    expect(ent<DPolyline>("e2").pts).toEqual([[0, 2], [98, 2]]);
    reset();
    ok("křivka 0,0 100,0 100,4 0,4");
    ok("ekvidistanta 1.9 e1 50,2");
    const P = ent<DPolyline>("e2").pts;
    expect(P.length).toBe(4);
    closeP(P[1], [98.1, 1.9]);
    closeP(P[2], [98.1, 2.1]);
    // uzavřený úzký obdélník dovnitř o víc než polovinu šířky zanikne (beze změny)
    reset();
    ok("křivka 0,0 100,0 100,4 0,4 uzavřít");
    const r = ok("ekvidistanta 3 e1 50,2");
    expect(r[0].created).toEqual([]);
  });
});

describe("spline se zlomem (SPOJIT úseček a CV splajnu)", () => {
  const build = () => {
    ok("čára 300,0 310,0; čára 310,0 310,10");
    ok('spline metoda řídicí 310,10 315,15 320,5 325,10 ""');
    ok("spojit e1 e2 e3");
  };
  it("OŘÍZNOUT u zlomu najde průsečík (dřív smazal celý spline)", () => {
    build();
    ok("čára 309.9,-5 309.9,5");
    const r = ok("oříznout e1@301,0");
    expect(r[0].deleted).toEqual([]);
    const sp = ent<DSpline>("e1");
    closeP(sp.ctrl[0], [309.9, 0], 1e-9);
    closeP(sp.ctrl[sp.ctrl.length - 1], [325, 10], 1e-12);
  });
  it("PŘERUŠIT-V-BODĚ 0,1 před zlomem rozdělí přesně v bodě, ne ve zlomu", () => {
    build();
    const r = ok("přerušit-v-bodě e1 309.9,0");
    const a = ent<DSpline>("e1");
    const b = ent<DSpline>(r[0].created[0]);
    closeP(a.ctrl[a.ctrl.length - 1], [309.9, 0], 1e-9);
    closeP(b.ctrl[0], [309.9, 0], 1e-9);
  });
});

describe("PEDIT: Vyrovnat vrátí vrcholy (i po posunu / otočení / zrcadlení), Spline zůstane upravitelný", () => {
  const frame: Vec2[] = [[0, 0], [10, 0], [20, 10], [30, 0]];
  it("Proložit → Vyrovnat = původní 4 vrcholy; po posunu a otočení přepočtené", () => {
    ok("křivka 0,0 10,0 20,10 30,0");
    ok("upravit-křivku e1 proložit");
    expect(ent<DPolyline>("e1").pts.length).toBe(7);
    ok("upravit-křivku e1 vyrovnat");
    expect(ent<DPolyline>("e1").pts).toEqual(frame);
    expect(ent<DPolyline>("e1").bulges).toBeUndefined();
    ok("upravit-křivku e1 proložit; posun e1 0,0 5,5; otočit e1 0,0 90; upravit-křivku e1 vyrovnat");
    const P = ent<DPolyline>("e1").pts;
    expect(P.length).toBe(4);
    // (x, y) + (5, 5) otočeno o 90° = (−y − 5, x + 5)
    frame.forEach((q, i) => closeP(P[i], [-(q[1] + 5), q[0] + 5], 1e-9));
  });
  it("Spline zůstane pro PEDIT: Vyrovnat vrátí rám i po zrcadlení; uzavřený spline Otevřít + Vyrovnat", () => {
    ok("křivka 0,0 10,0 20,10 30,0");
    ok("upravit-křivku e1 spline");
    expect(ent<DSpline>("e1").type).toBe("spline");
    ok("zrcadlit e1 0,0 0,10 ano");
    ok("upravit-křivku e1 vyrovnat");
    const P = ent<DPolyline>("e1").pts;
    expect(ent<DPolyline>("e1").type).toBe("polyline");
    frame.forEach((q, i) => closeP(P[i], [-q[0], q[1]], 1e-9));
    expect(ent<DPolyline>("e1").ext?.pedit).toBeUndefined();
    reset();
    ok("křivka 0,0 10,0 20,10 30,0");
    ok("upravit-křivku e1 spline uzavřít");
    expect(ent<DSpline>("e1").closed).toBe(true);
    ok("otočit e1 0,0 90; upravit-křivku e1 otevřít vyrovnat");
    const Q = ent<DPolyline>("e1");
    expect(Q.closed).toBeUndefined();
    frame.forEach((q, i) => closeP(Q.pts[i], [-q[1], q[0]], 1e-9));
  });
  it("spline bez rámu PEDIT nabídne převod na křivku; Více s úsečkami: ano = převést", () => {
    ok('spline metoda řídicí 0,0 5,5 10,0 15,5 ""');
    ok("upravit-křivku e1 ano");
    expect(ent<DPolyline>("e1").type).toBe("polyline");
    closeP(ent<DPolyline>("e1").pts[0], [0, 0], 1e-12);
    reset();
    ok("čára 0,0 10,0; čára 10,0 20,5");
    ok("upravit-křivku více e1 e2 ano spojit 0 proložit");
    expect(m.entities.length).toBe(1);
    ok("upravit-křivku e1 vyrovnat");
    expect(ent<DPolyline>("e1").pts).toEqual([[0, 0], [10, 0], [20, 5]]);
  });
});

describe("zamčené hladiny a protokol chyby", () => {
  const lockedLine = () => ok("hladina nová L; čára 0,0 100,0; vlastnosti e1 hladina L; hladina L zamknout");
  it("EKVIDISTANTA, KOPIE, ZRCADLIT, POLE odmítnou zdroj na zamčené hladině; chyba řekne proč", () => {
    for (const cmd of ["ekvidistanta 5 e1 0,10", "kopie e1 0,0 10,0", "zrcadlit e1 0,0 0,10 ne", "pole-obdélníkové e1 2 2 10 10", "posun e1 0,0 10,0"]) {
      reset();
      lockedLine();
      const r = run(cmd);
      expect(r[0].ok, cmd).toBe(false);
      expect(r[0].error, cmd).toMatch(/zamčené hladině/);
      expect(m.entities.length, cmd).toBe(1);
    }
  });
});

describe("volby si pamatuje každý výkres zvlášť", () => {
  it("poloměr zaoblení z výkresu A neovlivní výkres B; Řezné-hrany přepnou na standardní jen jeden běh", () => {
    ok("čára 0,0 100,0; čára 0,0 0,100; zaoblit poloměr 25 e1@50,0 e2@0,50");
    expect(m.entities.some((e) => e.type === "arc" && Math.abs(e.r - 25) < 1e-12)).toBe(true);
    const sA = s;
    reset();
    ok("čára 0,0 100,0; čára 0,0 0,100; zaoblit e1@50,0 e2@0,50");
    expect(m.entities.some((e) => e.type === "arc")).toBe(false);
    expect(editStateOf(sA).filletRad).toBe(25);
    expect(editStateOf(s).filletRad).toBe(0);
    // TRIM: řezné hrany jen pro tento běh – další OŘÍZNOUT je zase rychlý (bez průsečíku smaže)
    reset();
    ok("čára 0,0 100,0; čára 50,-10 50,10; čára 200,0 300,0");
    ok('oříznout řezné-hrany e2 "" e1@90,0');
    expect(editStateOf(s).quick).toBe(true);
    const r = ok("oříznout e3@250,0");
    expect(r[0].deleted).toEqual(["e3"]);
  });
  it("EKVIDISTANTA: nastavení v protokolu přeložené (EN / DE)", () => {
    setLang("en");
    ok("line 0,0 100,0");
    let r = ok("offset T e1 50,7");
    expect(r[0].log[0]).toBe("Current settings: erase source = No, layer = source");
    setLang("de");
    r = ok("versetz 2 e1 50,7");
    expect(r[0].log[0]).toMatch(/= Nein,/);
    setLang("cs");
  });
});

describe("Zpět uvnitř příkazu, zaoblení křivky", () => {
  it("OŘÍZNOUT … zpět vrátí smazanou entitu na její místo se stejným id; výsledek ji nehlásí", () => {
    ok("čára 0,0 10,0; čára 20,20 30,20; kružnice 50,50 3");
    const r = ok("oříznout e1@5,0 zpět");
    expect(r[0].created).toEqual([]);
    expect(r[0].deleted).toEqual([]);
    expect(ids()).toEqual(["e1", "e2", "e3"]);
  });
  it("ZAOBLIT křivku poloměrem = polovina strany: bez nulových úseků", () => {
    ok("obdélník 0,0 @100,50");
    ok("zaoblit poloměr 25 křivka e1");
    const pl = ent<DPolyline>("e1");
    expect(pl.pts.length).toBe(6);
    const n = pl.pts.length;
    for (let i = 0; i < n; i++) expect(dist(pl.pts[i], pl.pts[(i + 1) % n])).toBeGreaterThan(1);
    expect(pl.bulges?.filter((b) => Math.abs(b) > 1e-12).length).toBe(4);
  });
});

describe("výzvy příkazového řádku: volby jednou, výchozí volba v jazyce rozhraní, předvolba z pásu", () => {
  const firstPrompt = (cmd: string) => {
    const r = new CmdRun(findCommand(cmd)!, m, s, { interactive: true });
    r.start();
    return r;
  };
  it("žádná výzva nemá seznam voleb dvakrát", () => {
    ok("čára 0,0 100,0; čára 0,0 0,100");
    for (const cmd of ["FILLET", "CHAMFER", "LENGTHEN", "PEDIT", "MATCHPROP", "TRIM", "OFFSET"]) {
      const r = firstPrompt(cmd);
      let guard = 0;
      // OFFSET: nejdřív vzdálenost
      if (cmd === "OFFSET") {
        expect((promptText(r.prompt!).match(/\[/g) ?? []).length, promptText(r.prompt!)).toBe(1);
        r.feedText("5");
      }
      while (r.prompt?.k === "select" && guard++ < 3) r.feed({ k: "sel", ids: [] });
      const t = promptText(r.prompt!);
      expect((t.match(/\[/g) ?? []).length, `${cmd}: ${t}`).toBeLessThanOrEqual(1);
      r.cancel();
    }
    // OTOČIT reference: „Zadejte nový úhel nebo [Body]“
    setSelection(s, ["e1"]);
    const r = firstPrompt("ROTATE");
    r.feed({ k: "point", p: [0, 0] });
    r.feedText("_reference");
    r.feedText("0");
    const t = promptText(r.prompt!);
    expect(t).toMatch(/\[Body\]/);
    expect((t.match(/\[/g) ?? []).length).toBe(1);
    r.cancel();
  });
  it("výchozí volba ano / ne v jazyce rozhraní; Enter ji použije", () => {
    ok("čára 0,0 10,0");
    setSelection(s, ["e1"]);
    for (const [lang, lbl] of [["cs", "<Ne>"], ["en", "<No>"], ["de", "<Nein>"]] as const) {
      setLang(lang);
      const r = new CmdRun(findCommand("MIRROR")!, m, s, { interactive: true });
      r.start();
      r.feed({ k: "point", p: [0, 0] });
      r.feed({ k: "point", p: [0, 10] });
      expect(promptText(r.prompt!)).toContain(lbl);
      expect(r.feedText("")).toBeNull();
      expect(r.done).toBe(true);
      // zdroj zůstal, vznikla kopie
      expect(r.tx.created.length).toBe(1);
      expect(r.tx.deleted.length).toBe(0);
      setSelection(s, ["e1"]);
    }
    setLang("cs");
  });
  it("Pořadí ▾ → Dopředu bez výběru: volba se použije po výběru (dřív skončila ve výzvě výběru)", () => {
    ok("čára 0,0 10,0; čára 0,1 10,1; čára 0,2 10,2");
    PRESET.draworder = "front";
    const r = new CmdRun(findCommand("DRAWORDER")!, m, s, { interactive: true });
    r.start();
    expect(PRESET.draworder).toBeUndefined();
    expect(r.prompt?.k).toBe("select");
    r.feed({ k: "sel", ids: ["e1"] });
    expect(r.done).toBe(true);
    expect((r.tx.model.entities as DraftEntity[]).map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });
  it("zdokumentované tvary příkazů fungují (zaoblit oříznout neoříznout …)", () => {
    ok("čára 0,0 100,0; čára 0,0 0,100");
    ok("zaoblit oříznout neoříznout poloměr 5 e1@10,0 e2@0,10");
    expect(ent<DLine>("e1").a).toEqual([0, 0]);
    expect(m.entities.filter((e) => e.type === "arc").length).toBe(1);
  });
});
