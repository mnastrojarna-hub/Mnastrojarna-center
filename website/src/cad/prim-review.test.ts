/**
 * Oprava po kontrole 12. vlny (primitiva textem): regresní testy ke každému nálezu – rozbor CS / EN / DE, jádro (objemy, tělesa,
 * chyby) a Chytré kóty výkresu (popisy děr a závitů z primitiv).
 */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { AGENT_GUIDE } from "./agent-guide";
import { featureSummary, parseAgentText } from "./agent";
import { buildDoc } from "./build";
import { dimCheck } from "./dim-check";
import { runText, smartDrawing } from "./drawing-dims-harness";
import { withAnnotations } from "./drawing";
import { annLabel } from "./drawing-agent";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

afterEach(() => setLang("cs"));

type Any = Feature & { dirDef?: unknown; positionRef?: unknown; body?: string; centered?: boolean; mode?: string };
const ops = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  return p.ops as { k: string; feature: Any }[];
};
const feat = (text: string): Any => ops(text).filter((o) => o.k === "feature" || o.k === "select").pop()!.feature;
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

describe("rozbor – nálezy kontroly", () => {
  it("CS „osa body V1 V7“ / „směr body V1 V2“ = dva body, ne volba těleso (EN body); těleso dál funguje", () => {
    for (const t of ["válec 6 30 v 20 20 20 osa body V1 V7 odebrat", "kužel 10 0 8 v 20 20 20 osa body V7 V1 odebrat", "kvádr 5 5 5 osa body V1 V2", "pružina 10 stoupání 2 závity 3 drát 1 směr body V1 V2"]) {
      const f = feat(t);
      expect(f.body, t).toBeUndefined();
      expect(f.dirDef, t).toMatchObject({ kind: "twoPoints" });
    }
    expect(feat("díra 4 hloubka 5 v 5 5\npole 3 rozteč 12 směr body V1 V2")).toMatchObject({ type: "pattern", dirDef: { kind: "twoPoints" } });
    expect(feat("díra 4 hloubka 5 v 5 5\npole 3 rozteč 12 směr body V1 V2").body).toBeUndefined();
    expect(feat("rotovat 90 osa body V1 V3")).toMatchObject({ type: "revolve", axisDef: { kind: "twoPoints" } });
    expect(feat("rotovat 90 osa body V1 V3").body).toBeUndefined();
    expect(feat('válec 6 30 osa body V1 V7 těleso "Těleso 2"').body).toBe("Těleso 2");
    expect(feat("válec 6 30 osa body V1 V7 těleso 2").body).toBe("Těleso 2");
    expect(feat("válec 6 30 osa body V1 V7 nové")).toMatchObject({ mode: "new", body: "$new" });
    expect(feat('pružina 11 stoupání 4 závity 5 drát 1,5 na střed plochy F8 nové těleso "Pružina"')).toMatchObject({ mode: "new", body: "Pružina" });
    expect(feat('rotovat 90 osa body V1 V3 nové těleso "Kroužek"')).toMatchObject({ mode: "new", body: "Kroužek" });
    // EN: „body“ je těleso, body = „points“; DE „punkte“
    expect(feat("cylinder 6 30 at 20 20 20 axis points V1 V7 cut body 2")).toMatchObject({ body: "Těleso 2", mode: "cut", dirDef: { kind: "twoPoints" } });
    expect(feat("zylinder 6 30 bei 20 20 20 achse punkte V1 V7 abziehen").body).toBeUndefined();
  });

  it("kvádr: „střed F1“ / „střed V3“ = vystředit v odkazu; „na střed plochy F1“ = roh", () => {
    expect(feat("kvádr 10 10 10 střed F1 odebrat")).toMatchObject({ centered: true, positionRef: { kind: "face", index: 0 }, mode: "cut" });
    expect(feat("kvádr 10 10 10 střed V3 odebrat")).toMatchObject({ centered: true, positionRef: { kind: "vertex", index: 2 } });
    expect(feat("kvádr 10 10 10 střed hrany E2")).toMatchObject({ centered: true, positionRef: { kind: "edge", index: 1, at: "mid" } });
    expect(feat("kvádr 10 10 10 střed mezi V1 V5")).toMatchObject({ centered: true, positionRef: { kind: "derived", op: "mid" } });
    expect(feat("kvádr 10 10 10 střed na V3")).toMatchObject({ centered: true, positionRef: { kind: "vertex", index: 2 } });
    expect(feat("kvádr 10 10 10 na střed plochy F1")).toMatchObject({ centered: false, positionRef: { kind: "face", index: 0 } });
    expect(feat("kvádr 20 20 20 střed v 50 50 50")).toMatchObject({ centered: true, position: [50, 50, 50] });
    expect(feat("box 10 10 10 center F1")).toMatchObject({ centered: true, positionRef: { kind: "face", index: 0 } });
    expect(err("kvádr 10 10 10 střed V3 na V5")).toMatch(/poloha je zadaná dvakrát/);
    // u válce „střed F1“ dál = poloha ve středu plochy (válec volbu „vystředit“ nemá)
    expect(feat("válec 10 10 střed F1")).toMatchObject({ positionRef: { kind: "face", index: 0 } });
  });

  it("dvě různé operace = chyba (dřív vyhrála první v pořadí odebrat > průnik > nové)", () => {
    expect(err("kvádr 40 40 20\nválec 10 20 přidat odebrat")).toMatch(/válec: operace „přidat“ a „odebrat“ se vylučují/);
    expect(err("válec 10 20 odebrat průnik")).toMatch(/operace „odebrat“ a „průnik“ se vylučují/);
    expect(err("kvádr 1 1 1 nové odebrat")).toMatch(/se vylučují/);
    expect(err("rotovat 90 osa hrana E3 odebrat přidat")).toMatch(/rotovat: operace „přidat“ a „odebrat“ se vylučují/);
    expect(err("cylinder 10 20 add cut")).toMatch(/“add” and “cut” exclude each other|„add“ a „cut“/);
    expect(feat("válec 10 20 odebrat")).toMatchObject({ mode: "cut" });
  });

  it("číslo za osou vektorem: hláška míří na osu, ne na polohu", () => {
    expect(err("kužel 20 0 15 v 20 20 20 osa 0 0,5 -0,866 0 odebrat")).toMatch(/osa vektorem má tři složky – číslo „0“ za „osa 0 0,5 -0,866“ je navíc/);
    expect(feat("kužel 20 0 15 v 20 20 20 osa 0 0,5 -0,866 odebrat")).toMatchObject({ position: [20, 20, 20], dirDef: { kind: "vector", v: [0, 0.5, -0.866] } });
  });

  it("stav: průměry a polohy na tisíciny, osa vektorem na 6 míst", () => {
    expect(featureSummary(feat("válec 6,647 16 v 45 20 20 osa -Z odebrat"))).toBe("Ø6,647 × 16 mm, cut, podstava [45; 20; 20], osa [0; 0; -1]");
    expect(featureSummary(feat("válec 12 50 v 45,7738 40 29,0631 osa 0,422618 0 -0,906308 odebrat"))).toBe("Ø12 × 50 mm, cut, podstava [45,774; 40; 29,063], osa [0,422618; 0; -0,906308]");
    expect(featureSummary(feat("kvádr 10,25 20 30"))).toMatch(/^10,25 × 20 × 30 mm/);
  });

  it("prvek datum jen s planeDef: doplní normal / origin / xDir (dřív „f.normal is not iterable“)", () => {
    expect(feat('prvek datum planeDef={"kind":"base","name":"YZ","offset":50} název="Rovina 1"')).toMatchObject({ type: "datum", normal: [0, 0, 1], origin: [0, 0, 0], xDir: [1, 0, 0], planeDef: { kind: "base", name: "YZ", offset: 50 } });
  });

  it("nápověda: referenční plocha sražení / dělení = odkaz na plochu; hrot díry s rozsahem", () => {
    const ch = ops("nápověda srazit") as unknown as { k: string; lines: string[] }[];
    const line = ch[0].lines.find((l) => l.startsWith(" • faceRef"))!;
    expect(line).toMatch(/odkaz na plochu \(JSON Ref; F3 = index 2\), např\. faceRef=\{"kind":"face","index":2\}/);
    expect(line).not.toMatch(/vertex/);
    const sp = (ops("prvek nápověda split") as unknown as { lines: string[] }[])[0].lines.find((l) => l.startsWith(" • faceRef"))!;
    expect(sp).toMatch(/odkaz na plochu/);
    const hole = (ops("nápověda díra") as unknown as { lines: string[] }[])[0].lines;
    expect(hole.find((l) => l.startsWith(" • tipAngle"))).toMatch(/60–170°.*180 = ploché dno/);
    expect(hole.find((l) => l.startsWith("příklad:"))).toMatch(/tipAngle=180/); // po sloučení s w12-hole: ploché dno
  });
});

describe("jádro – nálezy kontroly", () => {
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
    r.setOC(oc as never);
  }, 60_000);
  /** text → dokument (jako konzole: „$new“ = další volný název tělesa) → stavba */
  const doc = (text: string): CadDoc => {
    const fs = ops(text)
      .filter((o) => o.k === "feature")
      .map((o, i) => ({ ...o.feature, id: `f${i}` }) as Feature & { body?: string; featureId?: string; sketchId?: string });
    let n = 1;
    fs.forEach((f, i) => {
      if (f.body === "$new") f.body = `Těleso ${++n}`;
      if (f.featureId === "$last") f.featureId = fs[i - 1].id;
      if (f.sketchId === "$last") f.sketchId = [...fs.slice(0, i)].reverse().find((x) => x.type === "sketch")!.id;
    });
    return { ...emptyDoc("t"), features: fs };
  };
  const build = (text: string) => buildDoc(doc(text));

  it("„osa body V1 V7“ v CS staví (dřív ✗ těleso „V1 V7“ v dílu není)", async () => {
    const res = await build("kvádr 40 40 20\nválec 6 30 v 20 20 20 osa body V1 V7 odebrat");
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeLessThan(40 * 40 * 20 - 300);
  }, 60_000);

  it("„nové“ s polohou odkazem: odkaz se řeší na tělese, ze kterého se nové zakládá (pružina do sedla)", async () => {
    const res = await build('kvádr 60 40 30\nválec 12,5 15 v 30 20 30 osa -Z odebrat\npružina 11 stoupání 4 závity 5 drát 1,5 na střed plochy F8 nové těleso "Pružina"');
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.bodies?.map((b) => b.name).sort()).toEqual(["Pružina", "Těleso 1"]);
    const spring = res.bodies!.find((b) => b.name === "Pružina")!;
    const helix = 5 * Math.hypot(Math.PI * 11, 4);
    expect(Math.abs(spring.volume - Math.PI * 0.75 * 0.75 * helix) / (Math.PI * 0.75 * 0.75 * helix)).toBeLessThan(0.02);
    // válec na středu horní plochy jako nové těleso (F6 je horní plocha kvádru), na V3 jako nové těleso
    for (const t of ["kvádr 100 100 60 v -50 -50 0\nválec 20 10 na střed plochy F6 nové", "kvádr 100 100 60 v -50 -50 0\nválec 20 10 na V3 nové"]) {
      const b = await build(t);
      expect(b.status.every((s) => s.ok), t + JSON.stringify(b.status)).toBe(true);
      expect(b.bodies?.length, t).toBe(2);
      expect(b.bodies!.find((x) => x.name === "Těleso 2")!.volume).toBeCloseTo(Math.PI * 100 * 10, 0);
    }
  }, 120_000);

  it("pole kruhové s osou kruhovou hranou: osa kružnice jejím středem (dřív bod na obvodu → 5 děr)", async () => {
    const res = await build("válec 80 20\nválec 6 20 v 35 0 0 odebrat\npole kruhové 36 osa hrana E1");
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(Math.PI * 1600 * 20 - 36 * Math.PI * 9 * 20, 0);
  }, 60_000);

  it("pole kruhové s osou rovinnou plochou = chyba; válcová plocha (vrtání náboje) dál přesně", async () => {
    const bad = await build("válec 80 20\nválec 20 20 odebrat\nválec 6 20 v 30 0 0 odebrat\npole kruhové 6 osa plocha F2");
    expect(bad.status[3]).toMatchObject({ ok: false });
    expect(bad.status[3].error).toMatch(/Plocha F2 není válcová ani kuželová/);
    const good = await build("válec 80 20\nválec 20 20 odebrat\nválec 6 20 v 30 0 0 odebrat\npole kruhové 6 osa plocha F4");
    expect(good.status.every((s) => s.ok), JSON.stringify(good.status)).toBe(true);
    expect(good.metrics!.volume).toBeCloseTo(Math.PI * (1600 - 100) * 20 - 6 * Math.PI * 9 * 20, 0);
  }, 60_000);

  it("kosmetický závit: chybný odkaz = chyba prvku (dřív ✓)", async () => {
    const res = await build("válec 20 50\nzávit M8 délka 12 na střed kružnice E999 osa -Z vnitřní");
    expect(res.status[1].ok).toBe(false);
    const ok = await build("válec 20 50\nzávit M8 délka 12 na střed kružnice E1 osa -Z vnitřní");
    expect(ok.status.every((s) => s.ok), JSON.stringify(ok.status)).toBe(true);
  }, 60_000);

  it("prvek datum jen s planeDef staví a zrcadlí", async () => {
    const res = await build('kvádr 40 40 20\nprvek datum planeDef={"kind":"base","name":"YZ","offset":50} název="Rovina 1"');
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
  }, 60_000);

  it("příklad z návodu (Primitiva – poloha a osa odkazem) projde celý; výkres má popis závitové díry", async () => {
    const i = AGENT_GUIDE.indexOf("### Primitiva – poloha a osa odkazem");
    const a = AGENT_GUIDE.indexOf("```", i) + 3;
    const block = AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
    const d = doc(block);
    const res = await buildDoc(d);
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status.filter((s) => !s.ok))).toBe(true);
    expect(res.bodies?.map((b) => b.name).sort()).toEqual(["Pružina", "Těleso 1"]);
  }, 180_000);
});

describe("výkres – popisy děr a závitů z primitiv", () => {
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
    r.setOC(oc as never);
  }, 60_000);
  const V = (k: string[]) => ({ front: k.includes("front"), top: k.includes("top"), left: false, right: false, back: false, bottom: false, iso: false });
  const draw = async (text: string, views: string[]) => {
    const { doc } = await runText(text);
    const d = await smartDrawing(doc, { sheet: "A3", views: V(views) });
    const out = withAnnotations(d.drawing, d.smart.annotations);
    const labels = d.smart.annotations.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(d.drawing.views, a));
    return { d, missing: dimCheck(doc, d.bbox, out.texts).filter((x) => !x.present).map((x) => x.label), calls: labels };
  };

  it("vnější závit odkazem i po ose -X dostane popis M20 a délku (dřív chyběl)", async () => {
    for (const t of ["válec 20 50 v 30 0 0\nzávit M20 délka 30 na střed kružnice E3 osa Z", "válec 20 50 osa X\nzávit M20 délka 30 v 50 0 0 osa -X"]) {
      const { missing, calls } = await draw(t, ["front", "top"]);
      expect(calls, t).toContain("M20");
      expect(calls, t).toContain("30");
      expect(missing.filter((m) => m.startsWith("M20")), t).toEqual([]);
    }
  }, 180_000);

  it("válec odebraný = díra (Ø6,8 ↧16, skrz), vnitřní závit = závitová díra, kužel v ústí = zahloubení", async () => {
    let r1 = await draw("kvádr 60 40 20\nválec 6,8 16 v 15 20 4 odebrat", ["top", "front"]);
    expect(r1.calls).toContain("Ø6,8 ↧16");
    expect(r1.missing).toEqual([]);
    r1 = await draw("kvádr 60 40 20\nválec 10 30 v 30 20 -5 odebrat", ["top", "front"]);
    expect(r1.calls).toContain("Ø10 skrz");
    expect(r1.missing).toEqual([]);
    r1 = await draw("kvádr 60 40 20\nválec 6,8 16 v 15 20 20 osa -Z odebrat\nzávit M8 délka 12 na střed kružnice E10 osa -Z vnitřní", ["top", "front"]);
    expect(r1.calls).toContain("M8 ↧12 / Ø6,8 ↧16");
    expect(r1.missing).toEqual([]);
    r1 = await draw("kvádr 60 40 20\nválec 6,8 16 v 15 20 20 osa -Z odebrat\nkužel 12 0 6 v 15 20 20 osa -Z odebrat", ["top", "front"]);
    expect(r1.calls).toContain("Ø6,8 ↧16 / ⌵ Ø12 × 90°");
    expect(r1.missing).toEqual([]);
  }, 240_000);
});
