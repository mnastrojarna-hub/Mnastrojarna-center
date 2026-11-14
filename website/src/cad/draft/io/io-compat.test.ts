/**
 * Balík 4 (io) – kompatibilita s cizími programy a regresní testy nálezů kontroly:
 * DXF R12 (velké výkresy, jedinečné názvy, odchylka elips / splinů, rozsah, GD&T, %%c), přísné čtečky (VIEWPORT 110/120/130,
 * ATTRIB / ATTDEF s jednou podtřídou AcDbText, záložní ACI pravé barvy), čtení (vypnuté hladiny v DXF R2000+ ASCII i binárně,
 * blok R12 se jménem hladiny, SPLINE jen z bodů proložení), znaky mimo BMP, srozumitelné chyby, vložení výkresu
 * (anonymní bloky se stejným názvem, výběr bez zamčených hladin).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DxfReader, Viewport } from "@node-projects/acad-ts";
import "../index";
import { setLang } from "../../i18n";
import { nearestAci } from "../colors";
import { cClosest, type Curve } from "../curves";
import { newDraftModel } from "../doc";
import { entityCurves } from "../kinds";
import type { DraftEntity, DraftModel, Vec2 } from "../model";
import { DraftTx } from "../tx";
import { fullModel } from "./__fixtures__/full-model";
import { applyAcadPatches } from "./acad-patch";
import { draftExport, draftImport } from "./index";
import { mergeDraftInto } from "./merge";

const FIX = (name: string) => fileURLToPath(new URL(`../../../../../src/lib/viewer3d/formats/__fixtures__/${name}`, import.meta.url));
const OWN = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
const own = (name: string) => new Uint8Array(readFileSync(OWN(name)));
const ownB64 = (name: string) => new Uint8Array(Buffer.from(readFileSync(OWN(name), "utf8"), "base64"));

function model(ents: Record<string, unknown>[], extra: Partial<DraftModel> = {}): DraftModel {
  const m = newDraftModel({ units: "mm" });
  return { ...m, ...extra, entities: ents.map((e, i) => ({ id: `e${i + 1}`, layer: "0", ...e }) as unknown as DraftEntity), seq: ents.length };
}
/** největší vzdálenost lomené čáry (i uvnitř úseků) od křivky */
function maxDev(pts: Vec2[], c: Curve, closed: boolean): number {
  let mx = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let k = 0; k <= 8; k++) mx = Math.max(mx, cClosest(c, [a[0] + ((b[0] - a[0]) * k) / 8, a[1] + ((b[1] - a[1]) * k) / 8]).d);
  }
  return mx;
}
/** skupiny ASCII DXF jako dvojice [kód, hodnota] */
const tags = (text: string): [number, string][] => {
  const l = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([Number(l[i].trim()), l[i + 1]]);
  return out;
};
/** úsek skupin entity `type` (od 0/type po další 0) */
const entityTags = (all: [number, string][], type: string): [number, string][][] => {
  const res: [number, string][][] = [];
  for (let i = 0; i < all.length; i++)
    if (all[i][0] === 0 && all[i][1] === type) {
      let j = i + 1;
      while (j < all.length && all[j][0] !== 0) j++;
      res.push(all.slice(i, j));
    }
  return res;
};

describe("DXF R12 – vlastní zapisovač", () => {
  it("velký výkres (20 000 úseček) se zapíše bez přetečení zásobníku a přečte zpět", async () => {
    const m = model(Array.from({ length: 20000 }, (_, i) => ({ type: "line", a: [i, 0], b: [i, 10] })));
    const f = await draftExport(m, "dxf", { version: "R12" });
    expect(f.bytes).toBeGreaterThan(1_500_000);
    const back = await draftImport("velky.dxf", f.data);
    expect(back.model.entities.length).toBe(20000);
  });

  it("názvy se shodou po úpravě pro R12 jsou jedinečné (hladiny se neslučují, bloky nemají dvě definice) + varování", async () => {
    const L = (name: string, color: number) => ({ name, color, linetype: "Continuous", lineweight: "Default" as const, on: true, frozen: false, locked: false, plot: true });
    const base = newDraftModel({ units: "mm" });
    const layers = [...base.layers, L("Kóty", 1), L("KOTY", 3), L("Osa 1", 5), L("OSA_1", 6), L("A".repeat(31) + "x", 2), L("A".repeat(31) + "y", 4)];
    const m = model(
      [...layers.map((l, i) => ({ type: "line", layer: l.name, a: [0, i], b: [10, i] })), { type: "insert", block: "Šroub", p: [0, 0], sx: 1, sy: 1, rot: 0 }, { type: "insert", block: "SROUB", p: [20, 0], sx: 1, sy: 1, rot: 0 }],
      {
        layers,
        blocks: [
          { name: "Šroub", base: [0, 0], entities: [{ id: "b1", layer: "0", type: "circle", c: [0, 0], r: 3 } as DraftEntity] },
          { name: "SROUB", base: [0, 0], entities: [{ id: "b2", layer: "0", type: "line", a: [0, 0], b: [5, 0] } as DraftEntity] },
        ],
      },
    );
    setLang("cs");
    const f = await draftExport(m, "dxf", { version: "R12" });
    expect(f.warnings.join(" ")).toMatch(/přejmenováno: .*KOTY → KOTY_2.*OSA_1 → OSA_1_2.*SROUB → SROUB_2/);
    const back = (await draftImport("n.dxf", f.data)).model;
    const colors = Object.fromEntries(back.layers.map((l) => [l.name, l.color]));
    expect(colors).toMatchObject({ KOTY: 1, KOTY_2: 3, OSA_1: 5, OSA_1_2: 6 });
    expect(back.layers.filter((l) => l.name.startsWith("AAAA")).map((l) => l.color).sort()).toEqual([2, 4]);
    const blocks = Object.fromEntries((back.blocks ?? []).map((b) => [b.name, b.entities.map((e) => e.type).join("+")]));
    expect(blocks).toMatchObject({ SROUB: "circle", SROUB_2: "line" });
    const ins = back.entities.filter((e) => e.type === "insert") as unknown as { block: string }[];
    expect(ins.map((i) => i.block)).toEqual(["SROUB", "SROUB_2"]);
    // BLOCKS nemá dvě definice stejného názvu
    const names = entityTags(tags(f.text!), "BLOCK").map((t) => t.find(([c]) => c === 2)?.[1]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("elipsa a spline: odchylka lomené čáry ≤ 0,005 mm bez ohledu na velikost (CAM / laser)", async () => {
    const cases: Record<string, unknown>[] = [
      { type: "ellipse", c: [0, 0], major: [500, 0], ratio: 0.5 },
      { type: "ellipse", c: [0, 0], major: [2000, 0], ratio: 0.2 },
      { type: "ellipse", c: [10, 5], major: [30, 10], ratio: 0.5, t0: 20, t1: 250 },
      { type: "spline", degree: 3, ctrl: [[0, 0], [300, 200], [600, -150], [900, 250], [1200, -100], [1500, 0]], knots: [0, 0, 0, 0, 1, 2, 3, 3, 3, 3] },
    ];
    for (const e of cases) {
      const m = model([e]);
      const f = await draftExport(m, "dxf", { version: "R12" });
      const back = (await draftImport("e.dxf", f.data)).model;
      const pl = back.entities[0] as unknown as { type: string; pts: Vec2[]; closed?: boolean };
      expect(pl.type).toBe("polyline");
      const c = entityCurves(m.entities[0], { model: m })[0];
      const dev = maxDev(pl.pts, c, !!pl.closed);
      expect(dev, JSON.stringify(e).slice(0, 60)).toBeLessThanOrEqual(0.0051);
    }
  });

  it("rozsah v hlavičce zahrnuje vložení bloků, šrafy a kóty; tolerance s písmem gdt.shx; Ø ± ° jako %%c %%p %%d", async () => {
    const f = await draftExport(fullModel(), "dxf", { version: "R12" });
    const t = tags(f.text!);
    const at = (name: string) => t.findIndex(([c, v]) => c === 9 && v === name);
    const ext = (name: string) => [Number(t[at(name) + 1][1]), Number(t[at(name) + 2][1])];
    // RAZITKO (180 × 40) vložené v 300,100 s měřítkem 2 a otočením 30° sahá do x = 300 + 360·cos 30°
    expect(ext("$EXTMAX")[0]).toBeCloseTo(300 + 360 * Math.cos(Math.PI / 6), 6);
    expect(ext("$EXTMAX")[1]).toBeGreaterThan(300);
    const styles = entityTags(t, "STYLE").map((s) => [s.find(([c]) => c === 2)?.[1], s.find(([c]) => c === 3)?.[1]]);
    expect(styles).toContainEqual(["GDT", "gdt.shx"]);
    const texts = entityTags(t, "TEXT").map((s) => [s.find(([c]) => c === 1)?.[1], s.find(([c]) => c === 7)?.[1]]);
    expect(texts).toContainEqual(["j", "GDT"]);
    expect(texts).toContainEqual(["n0.05", "GDT"]);
    expect(texts.map((x) => x[0])).toContain("Žluťoučký kůň %%c20 %%p0,1 %%d");
    expect(f.text).not.toContain("\\U+00D8");
    // zpět: řídicí kódy → znaky
    const back = (await draftImport("t.dxf", f.data)).model;
    expect(back.entities.some((e) => e.type === "text" && (e as unknown as { s: string }).s === "Žluťoučký kůň Ø20 ±0,1 °")).toBe(true);
  });
});

describe("DXF R2000–R2018 pro přísné čtečky (ezdxf, AutoCAD)", () => {
  it("VIEWPORT: počátek a osy USS po složkách 110/120/130 …, ID 69; binárně bez NaN", async () => {
    for (const v of ["R2000", "R2018"] as const) {
      const f = await draftExport(fullModel(), "dxf", { version: v });
      const vps = entityTags(tags(f.text!), "VIEWPORT");
      expect(vps.length).toBeGreaterThanOrEqual(2);
      for (const vp of vps) {
        const codes = vp.map(([c]) => c);
        for (const c of [110, 120, 130, 111, 121, 131, 112, 122, 132, 68, 69]) expect(codes, `${v} kód ${c}`).toContain(c);
        const g = (c: number) => Number(vp.find(([x]) => x === c)![1]);
        expect([g(110), g(120), g(130), g(111), g(121), g(131), g(112), g(122), g(132)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      }
      const b = await draftExport(fullModel(), "dxf", { version: v, binary: true });
      applyAcadPatches();
      const doc = new DxfReader(b.data).read();
      const list: Viewport[] = [];
      for (const br of doc.blockRecords ?? []) for (const e of br.entities) if (e instanceof Viewport) list.push(e);
      expect(list.length).toBeGreaterThanOrEqual(2);
      for (const vp of list) {
        expect([vp.ucsOrigin.x, vp.ucsOrigin.y, vp.ucsXAxis.x, vp.ucsXAxis.y, vp.ucsYAxis.x, vp.ucsYAxis.y]).toEqual([0, 0, 1, 0, 0, 1]);
      }
    }
  });

  it("ATTRIB / ATTDEF: jedna podtřída AcDbText (jako AutoCAD), značka a výzva čitelné", async () => {
    for (const v of ["R2000", "R2018"] as const) {
      const t = tags((await draftExport(fullModel(), "dxf", { version: v })).text!);
      for (const type of ["ATTRIB", "ATTDEF"]) {
        const list = entityTags(t, type);
        expect(list.length).toBeGreaterThan(0);
        for (const a of list) {
          const subs = a.filter(([c]) => c === 100).map(([, s]) => s);
          expect(subs.filter((s) => s === "AcDbText").length, `${v} ${type}`).toBe(1);
          expect(subs).toContain(type === "ATTRIB" ? "AcDbAttribute" : "AcDbAttributeDefinition");
          const tagAfter = a.slice(a.findIndex(([c, s]) => c === 100 && s.startsWith("AcDbAttribute"))).find(([c]) => c === 2)?.[1];
          expect(["NAZEV", "SKRYTY"]).toContain(tagAfter);
        }
      }
      // TEXT si druhou podtřídu (před 73) ponechá
      const txt = entityTags(t, "TEXT")[0];
      expect(txt.filter(([c, s]) => c === 100 && s === "AcDbText").length).toBe(2);
    }
  });

  it("hladina s pravou barvou: záložní ACI 62 = nejbližší barva (ne žlutá 2)", async () => {
    for (const v of ["R2004", "R2018"] as const) {
      const t = tags((await draftExport(fullModel(), "dxf", { version: v })).text!);
      const lay = entityTags(t, "LAYER").find((l) => l.some(([c, s]) => c === 2 && s === "KÓTY"))!;
      expect(Number(lay.find(([c]) => c === 62)![1])).toBe(nearestAci([0x33, 0x66, 0x99]));
      expect(Number(lay.find(([c]) => c === 420)![1])).toBe(0x336699);
    }
  });
});

describe("čtení cizích DXF", () => {
  it("vypnutá hladina (záporná barva) z ezdxf R2018 ASCII i binárně: vypnutá a s barvou 6", async () => {
    for (const [name, bytes] of [
      ["ezdxf-r2018.dxf", own("ezdxf-r2018.dxf")],
      ["ezdxf-r2018-bin.dxf", ownB64("ezdxf-r2018-bin.dxf.b64")],
    ] as const) {
      const r = await draftImport(name, bytes);
      expect(r.model.layers.find((l) => l.name === "OFF"), name).toMatchObject({ on: false, color: 6 });
      expect(r.model.layers.find((l) => l.name === "Kóty"), name).toMatchObject({ on: true, color: 1 });
      // atributy ezdxf
      const ins = r.model.entities.find((e) => e.type === "insert") as unknown as { attribs: { tag: string; value: string }[] };
      expect(ins.attribs.map((a) => `${a.tag}=${a.value}`)).toEqual(["NAZEV=Deska 1"]);
    }
  });

  it("SPLINE jen z bodů proložení (ezdxf add_spline) → hladký splajn přes body, ne lomená čára", async () => {
    const ref: Vec2[] = JSON.parse(readFileSync(OWN("ezdxf-spline-samples.json"), "utf8"));
    for (const bytes of [own("ezdxf-r2018.dxf"), ownB64("ezdxf-r2018-bin.dxf.b64")]) {
      const r = await draftImport("s.dxf", bytes);
      const sp = r.model.entities.find((e) => e.type === "spline") as unknown as { fit: Vec2[]; degree: number };
      expect(sp).toBeTruthy();
      expect(sp.degree).toBe(3);
      expect(sp.fit).toEqual([[0, 0], [10, 20], [30, -10], [50, 10]]);
      const c = entityCurves(sp as unknown as DraftEntity, { model: r.model })[0];
      // prochází body proložení a tvarem odpovídá křivce, kterou z nich staví ezdxf
      for (const p of sp.fit) expect(cClosest(c, p).d).toBeLessThan(1e-9);
      expect(Math.max(...ref.map((p) => cClosest(c, p).d))).toBeLessThan(1e-6);
      // zpět do DXF: řídicí body + body proložení
      const back = (await draftImport("s2.dxf", (await draftExport(r.model, "dxf")).data)).model;
      expect(back.entities.find((e) => e.type === "spline")).toMatchObject({ fit: sp.fit });
    }
  });

  it("DXF R12: blok se stejným názvem jako hladina se načte (i bloky za ním a jejich vložení)", async () => {
    const r = await draftImport("names.dxf", own("ezdxf-r12-names.dxf"));
    expect((r.model.blocks ?? []).map((b) => b.name).sort()).toEqual(["BOLT", "PLAIN"]);
    expect(r.model.entities.filter((e) => e.type === "insert").map((e) => (e as unknown as { block: string }).block)).toEqual(["BOLT", "PLAIN"]);
    expect(r.note).not.toMatch(/bez bloku/);
    // vlastní R12 výkresu z AutoCADu (hladiny Symbol_Work / Symbol_Border = názvy bloků) zpět beze ztráty
    const dwg = await draftImport("b.dwg", new Uint8Array(readFileSync(FIX("dwg-blocks-meters-r2010.dwg"))));
    const back = await draftImport("b12.dxf", (await draftExport(dwg.model, "dxf", { version: "R12" })).data);
    expect(back.model.entities.filter((e) => e.type === "insert").length).toBe(dwg.model.entities.filter((e) => e.type === "insert").length);
    expect(back.report.entities).toBe(dwg.report.entities);
    expect(back.note).not.toMatch(/bez bloku/);
  });
});

describe("text a chyby", () => {
  it("znaky mimo BMP (emoji) přes \\U+ dvojicí náhradních kódů: DXF R2000, R12, binární R2000, DWG R2000", async () => {
    const s = "日本語 Ελληνικά Кириллица 😀 Ø";
    const m = model([{ type: "text", p: [0, 0], h: 2.5, s }]);
    for (const [fmt, version, binary] of [
      ["dxf", "R2000", false],
      ["dxf", "R12", false],
      ["dxf", "R2000", true],
      ["dwg", "R2000", false],
      ["dwg", "R2018", false],
    ] as const) {
      const f = await draftExport(m, fmt, { version, binary });
      if (f.text) expect(f.text).not.toMatch(/\\U\+[0-9A-F]{5}/);
      const back = await draftImport(`t.${fmt}`, f.data);
      expect((back.model.entities[0] as unknown as { s: string }).s, `${fmt} ${version} ${binary}`).toBe(s);
    }
  });

  it("poškozený nebo jiný soubor: srozumitelná chyba místo chyby knihovny", async () => {
    setLang("cs");
    const err = async (name: string, data: string | Uint8Array) => {
      try {
        await draftImport(name, typeof data === "string" ? new TextEncoder().encode(data) : data);
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await err("empty.dxf", "")).toBe("Soubor empty.dxf se nepodařilo přečíst: soubor je prázdný");
    expect(await err("bad.dwg", "AC1015 garbage garbage")).toMatch(/^Soubor bad\.dwg se nepodařilo přečíst: DWG je poškozený, neúplný nebo to není výkres DWG \(chyba čtení: /);
    expect(await err("text.dxf", "toto není výkres\nani DXF\n")).toMatch(/není to výkres DXF \(soubor nezačíná sekcí „0 \/ SECTION“\) ani DWG/);
    expect(await err("obr.dwg", "%PDF-1.4 něco")).toMatch(/není to výkres DWG \(chybí hlavička verze AC10xx\)/);
  });
});

describe("vložení výkresu (sloučit)", () => {
  it("anonymní blok se stejným názvem (*D3) se přejmenuje a kóta ukazuje na svou geometrii", async () => {
    const a = await draftImport("a.dwg", new Uint8Array(readFileSync(FIX("dwg-example-r2018.dwg"))));
    const b = await draftImport("b.dwg", new Uint8Array(readFileSync(FIX("dwg-entities2d-r2000.dwg"))));
    expect((a.model.blocks ?? []).some((x) => x.name === "*D3")).toBe(true);
    const srcDim = b.model.entities.find((e) => e.type === "dimension")!;
    const srcBlock = (b.model.blocks ?? []).find((x) => x.name === (srcDim.ext as { block: string }).block)!;
    const tx = new DraftTx(a.model);
    const rep = mergeDraftInto(tx, b.model);
    const m = tx.model;
    const dim = rep.ids.map((id) => m.entities.find((e) => e.id === id)!).find((e) => e.type === "dimension")!;
    const name = (dim.ext as { block: string }).block;
    expect(name).not.toBe("*D3");
    expect(name).toMatch(/^\*D\d+$/);
    expect(rep.blocks).toContain(name);
    const blk = (m.blocks ?? []).find((x) => x.name === name)!;
    expect(blk.entities.map((e) => e.type)).toEqual(srcBlock.entities.map((e) => e.type));
    // původní *D3 cíle beze změny
    expect((m.blocks ?? []).find((x) => x.name === "*D3")).toEqual((a.model.blocks ?? []).find((x) => x.name === "*D3"));
    // zápis: kóta odkazuje na blok se svou geometrií (úsečky u bodů kóty, ne o 10 m dál)
    const t = tags((await draftExport(m, "dxf")).text!);
    const num = (g: [number, string][], c: number) => Number(g.find(([x]) => x === c)?.[1]);
    // zdroj je v palcích, cíl v mm: kóta (balík annot ji umí transformovat) se převede měřítkem jako ostatní entity
    const k = rep.scale ?? 1;
    const d = entityTags(t, "DIMENSION").find((g) => Math.abs(num(g, 13) - 6 * k) < 1e-6 && Math.abs(num(g, 23) - 8 * k) < 1e-6 && Math.abs(num(g, 14) - 7 * k) < 1e-6)!;
    expect(d).toBeTruthy();
    const bname = d.find(([c]) => c === 2)![1];
    const start = t.findIndex(([c, v], i) => c === 2 && v === bname && t.slice(Math.max(0, i - 12), i).some(([cc, vv]) => cc === 0 && vv === "BLOCK"));
    expect(start).toBeGreaterThan(0);
    const li = t.findIndex(([c, v], i) => i > start && c === 0 && v === "LINE");
    const line = t.slice(li + 1, t.findIndex(([c], i) => i > li && c === 0));
    // geometrie u bodů kóty (6,8)–(7,7), ne u cizí kóty cíle (dřív −473, 10344)
    expect(Math.hypot(num(line, 10) - 6 * k, num(line, 20) - 8 * k)).toBeLessThan(2 * k);
  });

  it("vložené entity na zamčené hladině se nevyberou (Delete je nesmaže)", async () => {
    const L = (name: string, locked: boolean) => ({ name, color: 7, linetype: "Continuous", lineweight: "Default" as const, on: true, frozen: false, locked, plot: true });
    const base = newDraftModel({ units: "mm" });
    const src = model(
      [
        { type: "line", layer: "OBRYS", a: [0, 0], b: [10, 0] },
        { type: "circle", layer: "OBRYS", c: [0, 0], r: 5 },
        { type: "line", layer: "VOLNA", a: [0, 5], b: [10, 5] },
      ],
      { layers: [...base.layers, L("OBRYS", false), L("VOLNA", false)] },
    );
    const dst = model([{ type: "line", a: [0, 0], b: [1, 1] }], { layers: [...base.layers, L("OBRYS", true)] });
    const tx = new DraftTx(dst);
    const rep = mergeDraftInto(tx, src);
    expect(rep.entities).toBe(3);
    expect(rep.selectable).toEqual([rep.ids[2]]);
    const bytes = (await draftExport(src, "dxf")).data;
    // textem: výběr po IMPORT … sloučit = jen odemčené
    const { applyDraftText } = await import("../agent");
    const { emptyDraftDoc } = await import("../doc");
    const { sessionFor } = await import("../session");
    const doc = { ...emptyDraftDoc("Cíl"), draft: dst };
    const r = await applyDraftText(doc, `import "z.dxf" ${Buffer.from(bytes).toString("base64")} sloučit`);
    expect(r.results[0].ok, r.results[0].error).toBe(true);
    const created = r.results[0].created;
    expect(created.length).toBe(3);
    const sel = sessionFor(r.doc.draft!).sel;
    expect(sel.length).toBe(1);
    expect(r.doc.draft!.entities.find((e) => e.id === sel[0])!.layer).toBe("VOLNA");
    expect(r.log.join(" ")).toMatch(/zamčených, zmrazených nebo vypnutých hladinách: 2/);
  });
});
