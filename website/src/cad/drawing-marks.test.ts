/** Příkazy výkresu nad dokumentem bez jádra: listy, razítko, revize, značky, ruční kóty, úpravy, mazání, detaily, modely, stav. */
import { beforeEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import type { DrawingCmd } from "./agent-drawing";
import { annotationGeometry, type DrawingMeta, type DrawingOptions } from "./drawing";
import { activeSheet, activeSheetIndex, applyDrawingCmd, drawingStatus, sheetMeta, type DrawingEnv } from "./drawing-agent";
import { fixtureCompute, plateDoc } from "./drawing-fixture";
import { annLabel, dimAnchor } from "./drawing-marks";
import type { CadDoc, DrawingAnnotation } from "./types";

const P = (text: string): DrawingCmd => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`není příkaz výkresu: ${text}`);
  return op.cmd;
};
/** provede řádky příkazů výkresu za sebou (jako konzole) */
async function run(doc: CadDoc, text: string, env: DrawingEnv = {}) {
  let d = doc;
  const log: string[] = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const r = await applyDrawingCmd(d, P(line), fixtureCompute, env);
    d = r.doc;
    log.push(...r.log);
  }
  return { doc: d, log: log.join("\n") };
}
const opts = (d: CadDoc, i = 0) => d.drawings![i].options as Partial<DrawingOptions>;
const meta = (d: CadDoc, i = 0) => d.drawings![i].meta as Partial<DrawingMeta>;
const anns = (d: CadDoc, i = 0) => d.drawings![i].annotations;
const views = async (d: CadDoc, i = 0) => (await fixtureCompute(d, sheetMeta(d, d.drawings![i], i), opts(d, i))).views;

beforeEach(() => activeSheet.set(null, false));

describe("listy: nový, přepnout, přejmenovat, smazat – příkazy pracují s aktivním listem", () => {
  it("příkazy nad 2. listem nemění 1. list; výkres list 1 vrátí práci na 1. list", async () => {
    const { doc, log } = await run(plateDoc(), 'výkres A3\nvýkres list nový "Detail"\nvýkres A4 na výšku\nvýkres poznámka "jen list 2"');
    expect(doc.drawings!.map((s) => s.name)).toEqual(["List 1", "Detail"]);
    expect(opts(doc, 0).sheet).toBe("A3");
    expect(opts(doc, 1)).toMatchObject({ sheet: "A4", orientation: "portrait" });
    expect(meta(doc, 1).note).toBe("jen list 2");
    expect(meta(doc, 0).note).toBeUndefined();
    expect(activeSheetIndex(doc)).toBe(1);
    expect(log).toMatch(/✓ nový list 2 „Detail“ \(Chytré kóty\) – další příkazy výkresu pracují s ním/);
    expect(log).toMatch(/✓ výkres: A4, na výšku · list 2 „Detail“/);
    const r2 = await run(doc, "výkres list 1\nvýkres měřítko 1:2");
    expect(opts(r2.doc, 0).scale).toBe(0.5);
    expect(opts(r2.doc, 1).scale).toBe("auto");
    expect(r2.log).toMatch(/✓ list 1 „List 1“ – další příkazy výkresu pracují s ním/);
  });
  it("list podle názvu, přejmenovat, smazat (aktivní přejde na souseda), chyby", async () => {
    let { doc } = await run(plateDoc(), 'výkres list nový "B"\nvýkres list nový "C"\nvýkres list "B"');
    expect(activeSheetIndex(doc)).toBe(1);
    ({ doc } = await run(doc, 'výkres list přejmenovat 3 "Řez"\nvýkres list přejmenovat "Pohledy"'));
    expect(doc.drawings!.map((s) => s.name)).toEqual(["List 1", "Pohledy", "Řez"]);
    const del = await run(doc, "výkres list smazat 2");
    expect(del.doc.drawings!.map((s) => s.name)).toEqual(["List 1", "Řez"]);
    expect(del.log).toMatch(/✓ list 2 „Pohledy“ smazán – aktivní list 2 „Řez“/);
    await expect(run(del.doc, "výkres list 5")).rejects.toThrow(/list 5 neexistuje – Listy \(2\): 1 „List 1“ auto · 2 „Řez“ auto \(aktivní\)/);
    await expect(run(del.doc, 'výkres list nový "Řez"')).rejects.toThrow(/list „Řez“ už existuje/);
    const one = await run(plateDoc(), "výkres A3");
    await expect(run(one.doc, "výkres list smazat 1")).rejects.toThrow(/jen jeden list/);
    expect((await run(del.doc, "výkres listy")).log).toBe("Listy (2): 1 „List 1“ auto · 2 „Řez“ auto (aktivní)");
  });
  it("výkres list 2 A3 – volby na stejném řádku platí pro vybraný list", async () => {
    const { doc } = await run(plateDoc(), "výkres list nový\nvýkres list 1 A2 měřítko 1:5");
    expect(opts(doc, 0)).toMatchObject({ sheet: "A2", scale: 0.2 });
    expect(opts(doc, 1).sheet).toBe("auto");
  });
});

describe("razítko a revize", () => {
  it("razítko: údaje listu, číslo / kreslil / revize i do dokumentu, materiál do označení materiálu", async () => {
    const { doc, log } = await run(plateDoc(), 'výkres razítko název="Příruba" číslo="MN-1" kreslil="AI" revize=A datum="13.11.2026" materiál="ČSN 11 523" nepředepsané="ISO 2768-mK"');
    expect(meta(doc)).toMatchObject({ name: "Příruba", number: "MN-1", author: "AI", revision: "A", date: "13.11.2026", tolerance: "ISO 2768-mK" });
    expect(doc.props).toEqual({ number: "MN-1", author: "AI", revision: "A" });
    expect(doc.materialName).toBe("ČSN 11 523");
    expect(sheetMeta(doc, doc.drawings![0]).material).toBe("ČSN 11 523");
    expect(log).toMatch(/✓ razítko: název „Příruba“, číslo „MN-1“, kreslil „AI“/);
    expect((await run(doc, "výkres razítko")).log).toMatch(/Razítko: název Příruba · číslo MN-1 · kreslil AI · revize A · datum 13\.11\.2026 · materiál ČSN 11 523/);
  });
  it("revize: přidat, upravit, smazat; revize v razítku = poslední", async () => {
    let { doc } = await run(plateDoc(), 'výkres razítko kreslil="Novák"\nvýkres revize A "první vydání" datum 1.1.2026\nvýkres revize B "díra Ø8"');
    expect(meta(doc).revisions).toEqual([
      { rev: "A", date: "1.1.2026", note: "první vydání", author: "Novák" },
      expect.objectContaining({ rev: "B", note: "díra Ø8", author: "Novák" }),
    ]);
    expect(meta(doc).revision).toBe("B");
    ({ doc } = await run(doc, 'výkres revize A "opraveno" kreslil AI\nvýkres revize smazat B'));
    expect(meta(doc).revisions).toEqual([{ rev: "A", date: "1.1.2026", note: "opraveno", author: "AI" }]);
    expect(meta(doc).revision).toBe("A");
    await expect(run(doc, "výkres revize smazat X")).rejects.toThrow(/revize X v tabulce není – revize: A/);
  });
});

describe("značky: na kótu i do bodu pohledu (přichycení), text na listu", () => {
  it("drsnost a GD&T na Ø40 (Chytré kóty se nejdřív vloží), id a popis v protokolu", async () => {
    const { doc, log } = await run(plateDoc(), "výkres značka drsnost Ra 1,6 na Ø40\nvýkres značka tolerance kolmost 0,02 A na Ø40");
    const list = anns(doc);
    expect(list.filter((a) => a.auto)).toHaveLength(4);
    const ra = list.find((a) => a.type === "roughness")!;
    const gdt = list.find((a) => a.type === "gdt")!;
    expect(ra).toMatchObject({ view: "top", ra: "Ra 1,6" });
    expect(gdt).toMatchObject({ view: "top", symbol: "perp", value: "0,02", datum: "A" });
    // hrot drsnosti = kotevní bod kóty Ø40 (konec police), GD&T s odkazem do téhož bodu
    const v = await views(doc);
    const dia = list.find((a) => a.auto === "hole:0")!;
    const anchor = dimAnchor(v, dia);
    const top = v.find((x) => x.key === "top")!;
    const toSheet = (q: [number, number]) => [top.px + (q[0] - top.x0) * top.s, top.py + (q[1] - top.y0) * top.s];
    // hrot drsnosti (nebo konec její odkazové čáry, když hrot u kóty překáží textu) = kotevní bod kóty
    const rr = ra as Extract<DrawingAnnotation, { type: "roughness" }>;
    expect(toSheet(rr.leader ?? rr.at)).toEqual([expect.closeTo(anchor[0], 6), expect.closeTo(anchor[1], 6)]);
    expect(toSheet((gdt as Extract<DrawingAnnotation, { type: "gdt" }>).leader!)).toEqual([expect.closeTo(anchor[0], 6), expect.closeTo(anchor[1], 6)]);
    expect(log).toMatch(/✓ značka drsnost Ra 1,6 → kóta Ø40 \(horní, a4\) · a5/);
    expect(log).toMatch(/✓ značka geometrická tolerance Kolmost 0,02 A → kóta Ø40 \(horní, a4\) · a6/);
    // značky na téže kótě se nepřekrývají (popisek se umístí na první volné místo)
    const box = (a: DrawingAnnotation) => {
      const g = annotationGeometry({ views: v, scaleValue: 1 }, [{ ...a, leader: undefined } as DrawingAnnotation]);
      const pts = [...g.polys.flatMap((p) => p.pts), ...g.texts.map((t) => [t.x, t.y] as [number, number])];
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    };
    const [b1, b2] = [box(ra), box(gdt)];
    expect(b1[0] < b2[2] && b2[0] < b1[2] && b1[1] < b2[3] && b2[1] < b1[3]).toBe(false);
    expect(log).not.toMatch(/překrývá/);
    // geometrie značek na listu
    const g = annotationGeometry({ views: v, scaleValue: 1 }, [ra, gdt]);
    expect(g.texts.map((t) => t.s)).toEqual(expect.arrayContaining(["Ra 1,6", "0,02", "A"]));
  });
  it("bod pohledu: přichytí se k hraně; mimo pohled = chyba s rozsahem; detail; text v mm listu (y nahoru)", async () => {
    const { doc, log } = await run(plateDoc(), 'výkres značka drsnost Ra 0,8 pohled přední v 10 19,4\nvýkres značka základna pohled horní v -50,6 0\nvýkres značka text "Kalit" v 20 30 výška 5\nvýkres značka poznámka "pozn." pohled přední v 0 10 posun 20 10');
    const [ra, datum, text, note] = anns(doc).filter((a) => !a.auto);
    expect(ra).toMatchObject({ view: "front", type: "roughness", at: [10, -20] });
    expect(datum).toMatchObject({ view: "top", type: "datum", label: "A", at: [-50, 0] });
    expect(text).toMatchObject({ view: "sheet", type: "text", text: "Kalit", size: 5, at: [20, 267] });
    expect(note).toMatchObject({ view: "front", type: "note", text: "pozn.", leader: [0, -10], at: [20, -20] });
    expect(log).toMatch(/drsnost Ra 0,8 → přední \[10; 19,4\] – hrana/);
    expect(log).toMatch(/základna A → horní \[−50,6; 0\] – hrana/);
    await expect(run(doc, "výkres značka drsnost Ra 1 pohled přední v 0 90")).rejects.toThrow(/bod \[0; 90\] je mimo pohled přední \(x −50…50, y 0…20 mm\)/);
    await expect(run(doc, "výkres značka drsnost Ra 1 pohled levý v 0 0")).rejects.toThrow(/pohled „levý“ na listu není – pohledy: přední, horní/);
    await expect(run(doc, "výkres značka drsnost Ra 1 na Ø99")).rejects.toThrow(/„Ø99“ na listu není – a1 100 \(přední\)/);
  });
  it("značka na id kóty (a2) a do detailu", async () => {
    const { doc } = await run(plateDoc(), "výkres detail přední v 45 10 poloměr 5 měřítko 2:1 umístit 330 200\nvýkres značka základna B na a2\nvýkres značka drsnost Ra 3,2 pohled detail A v 45 10");
    const v = await views(doc);
    const datum = anns(doc).find((a) => a.type === "datum")!;
    expect(datum).toMatchObject({ label: "B", view: "front" });
    const ra = anns(doc).find((a) => a.type === "roughness")!;
    expect(ra.view).toBe("sheet");
    expect((ra as Extract<DrawingAnnotation, { type: "roughness" }>).at).toEqual([330, 97]);
    void v;
  });
});

describe("ruční kóty, úpravy a mazání", () => {
  it("vodorovně po hraně (asociativní), svisle, průměr, úhel – hodnoty a strana mimo pohled", async () => {
    const { doc, log } = await run(plateDoc(), "kótovat nic\nvýkres kóta vodorovně pohled přední -50 20 50 20 odsazení 8\nvýkres kóta svisle pohled přední 50 0 50 20\nvýkres kóta průměr pohled horní střed 0 0\nvýkres kóta úhel pohled přední -50 20 50 20 50 20 50 0\nvýkres kóta šikmo pohled horní -50 -30 50 30 text \"úhlopříčka\"");
    const v = await views(doc);
    const [h, vv, dia, ang, al] = anns(doc);
    expect(h).toMatchObject({ type: "dim", kind: "horizontal", view: "front", a: [-50, -20], b: [50, -20], edge: true, offset: -8 });
    expect(annLabel(v, h)).toBe("100");
    expect(vv).toMatchObject({ kind: "vertical", offset: 10 });
    expect(annLabel(v, vv)).toBe("20");
    expect(dia).toMatchObject({ kind: "diameter", view: "top", c: [0, 0], r: 20, ang: -45, offset: 8 });
    expect(annLabel(v, dia)).toBe("Ø40");
    expect(annLabel(v, ang)).toBe("90°");
    expect(annLabel(v, al)).toBe("úhlopříčka");
    expect(log).toMatch(/✓ kóta 100 \(přední, vodorovně, hrana\) · a1/);
    expect(log).toMatch(/✓ kóta Ø40 \(horní, průměr\) · a3/);
    await expect(run(doc, "výkres kóta průměr pohled horní střed 10 10")).rejects.toThrow(/v pohledu horní není kružnice se středem \[10; 10\] – kružnice: střed \[0; 0\] R20/);
    await expect(run(doc, "výkres kóta úhel pohled přední -50 20 50 20 -50 0 50 0")).rejects.toThrow(/rovnoběžné/);
    await expect(run(doc, "výkres kóta vodorovně pohled přední 0 0 0 20")).rejects.toThrow(/stejné x/);
  });
  it("upravit podle id i popisku; smazat (vygenerované do smartOff), vlastní, vše", async () => {
    let { doc } = await run(plateDoc(), "výkres značka drsnost Ra 1,6 na Ø40");
    const r1 = await run(doc, 'výkres upravit a1 odsazení=20 přípona=" ±0,1"\nvýkres upravit Ø40 přípona=H7\nvýkres upravit "Ra 1,6" text="Ra 0,8"');
    doc = r1.doc;
    expect(anns(doc)[0]).toMatchObject({ auto: "ov:x", offset: 20, suffix: " ±0,1" });
    expect(anns(doc)[3]).toMatchObject({ auto: "hole:0", suffix: "H7" });
    expect(anns(doc)[4]).toMatchObject({ type: "roughness", ra: "Ra 0,8" });
    expect(r1.log).toMatch(/✓ upraveno a1: 100 → 100 ±0,1 \(odsazení 20\)/);
    expect(r1.log).toMatch(/✓ upraveno a4: Ø40 → Ø40H7/);
    await expect(run(doc, "výkres upravit a5 odsazení=3")).rejects.toThrow(/odsazení nelze u drsnosti upravit – lze: text, hodnota/);
    await expect(run(doc, "výkres upravit a9 text=x")).rejects.toThrow(/a9 na listu není – id jsou a1…a5/);
    const d1 = await run(doc, "výkres smazat a2 a5");
    expect(anns(d1.doc).map((a) => a.auto ?? a.type)).toEqual(["ov:x", "ov:y", "hole:0"]);
    expect(opts(d1.doc).smartOff).toEqual(["ov:z"]);
    expect(d1.log).toMatch(/✓ smazáno 2: a2 20, a5 Ra 0,8/);
    // smazaná vygenerovaná kóta se při dalším příkazu (sloučení Chytrých kót) nevrátí
    const d2 = await run(d1.doc, "výkres stav");
    expect(anns(d2.doc).some((a) => a.auto === "ov:z")).toBe(false);
    const d3 = await run(d1.doc, 'výkres značka poznámka "x" na 100\nvýkres smazat vlastní');
    expect(anns(d3.doc).every((a) => a.auto)).toBe(true);
    const d4 = await run(d3.doc, "výkres smazat vše");
    expect(anns(d4.doc)).toEqual([]);
    expect(opts(d4.doc).smartOff).toEqual(expect.arrayContaining(["ov:x", "ov:y", "hole:0", "ov:z"]));
  });
});

describe("překryv textů a posun značky", () => {
  it("kóta přes jinou kótu → varování s radou; značka posun=\"dx dy\" (mm listu, y nahoru)", async () => {
    const { doc, log } = await run(plateDoc(), "výkres kóta vodorovně pohled přední -50 0 50 0 odsazení 12\nvýkres značka drsnost Ra 1,6 na Ø40");
    expect(log).toMatch(/! text kóty se překrývá s „100“ – změňte odsazení: výkres upravit a5 odsazení=…/);
    const far = await run(doc, "výkres kóta vodorovně pohled přední -50 20 50 20 odsazení 40");
    expect(far.log).toMatch(/! kóta přesahuje rámeček listu – zmenšete odsazení: výkres upravit a7 odsazení=…/);
    const r = await run(doc, 'výkres upravit a6 posun="10 5"');
    const ra = anns(r.doc).find((a) => a.type === "roughness") as Extract<DrawingAnnotation, { type: "roughness" }>;
    const was = anns(doc).find((a) => a.type === "roughness") as Extract<DrawingAnnotation, { type: "roughness" }>;
    expect(ra.at).toEqual([was.at[0] + 10, was.at[1] - 5]);
    expect(ra.leader).toEqual(was.leader ?? was.at);
    expect(r.log).toMatch(/✓ upraveno a6: Ra 1,6 → Ra 1,6 \(posun 10 5\)/);
    await expect(run(doc, 'výkres upravit a1 posun="1 1"')).rejects.toThrow(/posun nelze u kóty upravit – lze: odsazení, text, přípona/);
  });
});

describe("detaily a další modely na listu", () => {
  it("detail: písmeno, výchozí měřítko 2:1, umístění, změna měřítka, smazání", async () => {
    let { doc, log } = await run(plateDoc(), "výkres detail přední v 45 10 poloměr 5 umístit 330 200");
    expect(opts(doc).details).toEqual([expect.objectContaining({ label: "A", view: "front", cx: 45, cy: -10, r: 5, scale: 2, at: [320, 87] })]);
    expect(log).toMatch(/✓ detail A \(pohled přední, střed \[45; 10\], r 5, 2:1\) – na listu x 320…340, y 190…210/);
    ({ doc, log } = await run(doc, "výkres detail A měřítko 5:1\nvýkres detail horní v 0 0 poloměr 8"));
    expect(opts(doc).details).toEqual([expect.objectContaining({ label: "A", scale: 5, at: undefined }), expect.objectContaining({ label: "B", view: "top", scale: 2 })]);
    ({ doc } = await run(doc, "výkres detail smazat A"));
    expect(opts(doc).details!.map((d) => d.label)).toEqual(["B"]);
    await expect(run(doc, "výkres detail přední v 400 10 poloměr 5")).rejects.toThrow(/mimo pohled přední/);
    await expect(run(doc, "výkres detail smazat Z")).rejects.toThrow(/detail Z na listu není – detaily: B/);
  });
  it("model: komponenta sestavy, otevřená záložka, změna pohledu, odebrání", async () => {
    const part = plateDoc("Hřídel");
    const asm: CadDoc = { ...plateDoc("Sestava"), kind: "assembly", features: [], components: [{ id: "c1", name: "Hřídel", doc: part } as never] };
    let { doc, log } = await run(asm, 'kótovat celkově\nvýkres model "hřídel" pohled horní měřítko 1:2');
    expect(opts(doc).models).toEqual([expect.objectContaining({ name: "Hřídel", source: { kind: "component", compId: "c1" }, view: "top", scale: 0.5 })]);
    expect(log).toMatch(/✓ model „Hřídel“ na listu: pohled horní, měřítko 0\.5/);
    ({ doc } = await run(doc, 'výkres model "Hřídel" pohled iso'));
    expect(opts(doc).models![0].view).toBe("iso");
    const env: DrawingEnv = { tabs: () => [{ title: "Víko", doc: { ...plateDoc("Víko"), drawings: [] } }] };
    ({ doc } = await run(doc, 'výkres model "Víko"', env));
    expect(opts(doc).models![1]).toMatchObject({ name: "Víko", source: { kind: "doc" } });
    expect((opts(doc).models![1].source as { doc: CadDoc }).doc).not.toHaveProperty("drawings");
    await expect(run(doc, 'výkres model "Nic"', env)).rejects.toThrow(/„Nic“ není komponenta sestavy ani otevřená záložka – k dispozici: Hřídel, Víko/);
    ({ doc } = await run(doc, 'výkres model smazat "Hřídel"'));
    expect(opts(doc).models!.map((m) => m.name)).toEqual(["Víko"]);
  });
});

describe("výkres stav: listy, souřadnice pohledů, id, razítko; volby listu", () => {
  it("rozsahy pohledů v mm modelu (y nahoru), poloha na listu (od levého dolního rohu), id kót a značek", async () => {
    const { doc } = await run(plateDoc(), 'výkres A3\nvýkres značka drsnost Ra 1,6 na Ø40\nvýkres list nový "Detail"\nvýkres otočení 90 řez XZ poloviční');
    const st = await drawingStatus(doc, fixtureCompute, { sheet: 1 });
    expect(st.text).toMatch(/^Výkres „List 1“ \(list 1\/2\): list A3 na šířku · měřítko 1:1/);
    expect(st.text).toContain("Listy (2): 1 „List 1“ A3 · 2 „Detail“ auto (aktivní)");
    expect(st.text).toContain("přední (x = X, y = Z): x −50…50, y 0…20 mm · 1:1 · na listu x 40…140, y 237…257");
    expect(st.text).toContain("horní (x = X, y = Y): x −50…50, y −30…30 mm");
    expect(st.text).toContain("Id (výkres upravit / smazat / značka na <id>): a1 100 (přední) · a2 20 (přední) · a3 60 (horní) · a4 Ø40 (horní) · a5 Ra 1,6 (horní)");
    expect(st.text).toMatch(/Razítko: název Deska · číslo — · kreslil — · revize — · datum .+ · materiál Ocel/);
    expect(st.text).toContain("Revize: žádné");
    const all = await drawingStatus(doc, fixtureCompute, { sheet: "all" });
    expect(all.text.split("\n\n")).toHaveLength(2);
    expect(all.text).toContain("Výkres „Detail“ (list 2/2)");
    expect(all.text).toContain("Volby: otočení 90° · řez XZ poloviční");
    // výchozí = aktivní list
    expect((await drawingStatus(doc, fixtureCompute)).text).toMatch(/^Výkres „Detail“/);
    await expect(drawingStatus(doc, fixtureCompute, { sheet: 3 })).rejects.toThrow(/list 3 neexistuje/);
  });
  it("kusovník nad razítkem podle volby listu, materiál a číslo listu do razítka", async () => {
    const bom = [{ pos: 1, name: "Hřídel", qty: 2 }];
    const d0 = plateDoc();
    const { doc } = await run(d0, "výkres kusovník ne");
    expect(sheetMeta(doc, doc.drawings![0], 0, { bom }).bom).toBeUndefined();
    const { doc: d2 } = await run(d0, "výkres kusovník ano\nvýkres list nový");
    expect(sheetMeta(d2, d2.drawings![0], 0, { bom, massKg: 1.5 })).toMatchObject({ bom, massKg: 1.5, material: "Ocel", sheetIndex: 1, sheetCount: 2 });
    expect(sheetMeta(d2, d2.drawings![1], 1).sheetIndex).toBe(2);
  });
  it("kótovat základní = Auto + Ø (vygenerované kóty pryč)", async () => {
    const { doc } = await run(plateDoc(), "výkres stav");
    expect(anns(doc).length).toBe(4);
    const r = await run(doc, "kótovat základní");
    expect(opts(r.doc).dimensions).toBe("auto");
    expect(anns(r.doc)).toEqual([]);
    expect(r.log).toMatch(/✓ kóty: Auto \+ Ø – základní kóty zapečené do pohledů \(odstraněno vygenerovaných: 4\)/);
  });
});
