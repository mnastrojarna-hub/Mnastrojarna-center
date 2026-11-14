/**
 * 15. vlna (test 959, balík „hole“) – regresní testy nálezů z pole:
 * - B3: `díra … v x y v x y` – polohy po skupinách (každé „v“ = jedna díra, 2 čísla = na povrchu tělesa, 3 = x y z), čísla
 *   se mezi skupinami nikdy nemíchají, skupina s 1 nebo ≥ 4 čísly = chyba řádku (dřív: ✗ „tři souřadnice“, nebo jedna díra
 *   s z z další polohy, nebo dvě díry s promíchanými souřadnicemi);
 * - B4: zahloubení / kuželové zahloubení + závit = zahloubení + vrták + závit (dřív se zahloubení tiše zahodilo – díl 4
 *   měl o 7 798 mm³ víc) – text CS / EN / DE, prvek, upravit, jádro (objemy), popis výkresu, měřit, kontrola kót, ⚠;
 * - B9: tabulka děr výkresu nevypisuje vnější válce (hřídel, osazení soustruženého dílu) – jen konkávní válcové plochy.
 */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { docStatusText, featureSummary, parseAgentText } from "./agent";
import { applyEdit } from "./agent-edit";
import { AGENT_GUIDE } from "./agent-guide";
import { fillHoleTops, holePositions } from "./agent-hole";
import { measureLines } from "./agent-measure";
import { buildDoc } from "./build";
import { dimCheck, expectedDims } from "./dim-check";
import { makeDrawing, withAnnotations } from "./drawing";
import { annLabel, drawingStatus } from "./drawing-agent";
import { holeCallout } from "./drawing-dims";
import { computeDrawing, runText, smartDrawing } from "./drawing-dims-harness";
import { holeHeadOf } from "./hole-spec";
import { setLang } from "./i18n";
import { measureCylinders } from "./measure";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);
afterEach(() => setLang("cs"));

type HoleF = Extract<Feature, { type: "hole" }>;
type FeatOp = { feature: HoleF; note?: string; fillTop?: boolean; fillPoints?: boolean[] };
const holeOp = (text: string): FeatOp => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  return p.ops.find((o) => o.k === "feature" && o.feature.type === "hole") as unknown as FeatOp;
};
const holeOf = (text: string) => holeOp(text).feature;
const errOf = (text: string) => parseAgentText(text).errors[0]?.message ?? "";
const pts = (f: HoleF) => f.points?.map((q) => (q.kind === "xyz" ? q.p : null));
const PI = Math.PI;

/* ───────────── B3: polohy po skupinách ───────────── */

describe("B3: díra … v x y v x y – polohy po skupinách (CS / EN / DE)", () => {
  it("dvě polohy po dvou číslech = dvě díry na povrchu tělesa, čísla se nemíchají (nález: ✗ „tři souřadnice“)", () => {
    for (const t of ["díra 6,8 skrz v 15,1 -30 v 15,1 -90 závit M8", "hole 6.8 through at 15.1 -30 at 15.1 -90 thread M8", "bohrung 6,8 durch bei 15,1 -30 bei 15,1 -90 gewinde M8"]) {
      const op = holeOp(t);
      expect(pts(op.feature), t).toEqual([[15.1, -30, 0], [15.1, -90, 0]]);
      expect(op.feature.position, t).toEqual([15.1, -30, 0]);
      expect(op.fillTop, t).toBe(true);
      expect(op.fillPoints, t).toEqual([true, true]);
      expect(op.feature).toMatchObject({ kind: "tapped", thread: "M8", diameter: 6.8 });
    }
  });
  it("tři polohy po dvou číslech (6 čísel) = tři díry, ne dvě s promíchanými souřadnicemi", () => {
    const f = holeOf("díra 6,8 skrz v 15,1 -30 v 15,1 -90 v 45 -30 závit M8");
    expect(pts(f)).toEqual([[15.1, -30, 0], [15.1, -90, 0], [45, -30, 0]]);
  });
  it("2 + 3 čísla: první na povrchu, druhá přesně (z = 5); 3 + 3 beze změny", () => {
    const op = holeOp("díra 8 skrz v 10 20 v 30 20 5");
    expect(pts(op.feature)).toEqual([[10, 20, 0], [30, 20, 5]]);
    expect(op.fillPoints).toEqual([true, false]);
    const b = holeOp("díra 8 skrz v 10 0 5 v 20 0 5");
    expect(b.fillTop).toBe(false);
    expect(b.fillPoints).toBeUndefined();
    expect(pts(b.feature)).toEqual([[10, 0, 5], [20, 0, 5]]);
  });
  it("jedna poloha beze změny: v x y = na povrchu, v x y z = přesně, bez v = počátek na povrchu", () => {
    const a = holeOp("díra 8 skrz v 10 20");
    expect(a.feature.position).toEqual([10, 20, 0]);
    expect(a.feature.points).toBeUndefined();
    expect(a.fillTop).toBe(true);
    expect(a.fillPoints).toBeUndefined();
    expect(holeOp("díra 8 skrz v 10 20 5").fillTop).toBe(false);
    expect(holeOp("díra 8 skrz").fillTop).toBe(true);
  });
  it("osa X / Y: dvě čísla jsou souřadnice napříč osou (y z / x z) – nic se tiše nezahodí (dřív x 10 přepsán povrchem)", () => {
    expect(holeOf("díra 8 skrz v 10 20 osa X").position).toEqual([0, 10, 20]);
    expect(holeOf("díra 8 skrz v 10 20 osa Y").position).toEqual([10, 0, 20]);
    expect(holePositions([[1, 2], [3, 4, 5]], "X")).toEqual({ position: [0, 1, 2], points: [[0, 1, 2], [3, 4, 5]], fill: [true, false] });
  });
  it("skupina s 1 nebo ≥ 4 čísly = chyba řádku s číslem polohy (nález: tichá díra se z z další polohy)", () => {
    expect(errOf("díra 6,8 skrz v 15,1 -30 v 15,1 závit M8")).toMatch(/díra: poloha 2 „v 15,1“ – počet čísel 1; každá poloha má dvě čísla/);
    expect(errOf("díra 8 skrz v 1 2 3 4")).toMatch(/díra: „v 1 2 3 4“ – počet čísel 4/);
    expect(errOf("díra 8 skrz v 1 2 v 3 4 5 6")).toMatch(/poloha 2 „v 3 4 5 6“ – počet čísel 4/);
    expect(errOf("díra 8 skrz v V3")).toMatch(/„v …“ – počet čísel 0/);
    // řádek s chybou nevytvoří žádnou díru
    expect(parseAgentText("díra 6,8 skrz v 15,1 -30 v 15,1 závit M8").ops).toEqual([]);
    setLang("en");
    expect(errOf("hole 6.8 through at 15.1 -30 at 15.1 thread M8")).toMatch(/hole: position 2 “at 15.1” – 1 number/);
    setLang("de");
    expect(errOf("bohrung 6,8 durch bei 15,1 -30 bei 15,1 gewinde M8")).toMatch(/Bohrung: Position 2 „bei 15,1“ – Anzahl der Zahlen 1/);
  });
  it("stav vypíše všechny polohy díry", () => {
    const f = { ...holeOf("díra 8 skrz v 10 0 5 v 20 0 5 v 30 0 5"), id: "h", name: "Díra 1" };
    expect(featureSummary(f)).toMatch(/· polohy \(3\): \[10; 0; 5\] \[20; 0; 5\] \[30; 0; 5\]$/);
  });
});

describe("B3: povrch tělesa v místě každé polohy (jádro)", () => {
  it("fillHoleTops: jen polohy se dvěma čísly; mimo těleso = obálka + „!“ s číslem řádku", () => {
    const f = holeOf("díra 5 skrz v 10 10 v 30 10 v 30 30 5 v 99 99");
    const top = (u: number, v: number) => (u > 50 || v > 50 ? null : u < 20 ? 40 : 30);
    const bbox: [Vec3, Vec3] = [[0, 0, 0], [40, 40, 40]];
    const notes = fillHoleTops(f, [true, true, false, true], top, bbox, 7);
    expect(pts(f)).toEqual([[10, 10, 40], [30, 10, 30], [30, 30, 5], [99, 99, 40]]);
    expect(f.position).toEqual([10, 10, 40]);
    expect(notes).toEqual(["! řádek 7: v místě [99; 99] není povrch tělesa – díra začíná na obálce tělesa (40)"]);
  });
  it("deska se stupněm: každá díra začíná na své ploše, objem = 2 průchozí + 1 od z = 5 (s nástupem)", { timeout: 120_000 }, async () => {
    const { doc } = await runText("kvádr 40 40 30\nkvádr 20 40 10 v 0 0 30\ndíra 5 skrz v 10 10 v 30 10 v 30 30 5");
    const h = doc.features.find((f): f is HoleF => f.type === "hole")!;
    expect(pts(h)).toEqual([[10, 10, 40], [30, 10, 30], [30, 30, 5]]);
    const res = await buildDoc(doc);
    expect(res.status.every((s) => s.ok && !s.warning), JSON.stringify(res.status)).toBe(true);
    const full = 40 * 40 * 30 + 20 * 40 * 10;
    // díra od z = 5 uvnitř materiálu má nad bodem krátký nástup = poloměr díry (jádro, build.ts holeToolAt) → 5 + 2,5
    expect(full - res.metrics!.volume).toBeCloseTo(PI * 2.5 * 2.5 * (40 + 30 + 5 + 2.5), 3);
  });
});

/* ───────────── B4: zahloubení + závit ───────────── */

const BOX = "kvádr 40 40 30 v -20 -20 0";
const BOXV = 40 * 40 * 30;
async function built(lines: string) {
  const p = parseAgentText(`${BOX}\n${lines}`);
  expect(p.errors, lines).toEqual([]);
  const doc: CadDoc = { ...emptyDoc("B4"), features: p.ops.flatMap((o) => (o.k === "feature" ? [{ ...o.feature, name: o.feature.type === "hole" ? "Díra 1" : o.feature.name }] : [])) };
  const res = await buildDoc(doc);
  return { doc, res, removed: BOXV - (res.metrics?.volume ?? BOXV) };
}
const cone = (d: number) => (PI * (d / 2) ** 2 * ((d / 2) / Math.tan((59 * PI) / 180))) / 3;

describe("B4: zahloubení + závit = zahloubení + vrták + závit (text CS / EN / DE)", () => {
  it("text → závitová díra se zahloubením (kind tapped + head), vrták tabulkový", () => {
    for (const t of ["díra 6,8 skrz v 0 0 30 zahloubení 20 7 závit M8", "hole 6.8 through at 0 0 30 counterbore 20 7 thread M8", "bohrung 6,8 durch bei 0 0 30 senkung 20 7 gewinde M8", "díra skrz v 0 0 30 zahloubení 20 7 M8"]) {
      const f = holeOf(t);
      expect(f, t).toMatchObject({ kind: "tapped", head: "counterbore", thread: "M8", diameter: 6.8, cbDiameter: 20, cbDepth: 7 });
      expect(holeHeadOf(f), t).toEqual({ kind: "counterbore", d: 20, depth: 7 });
    }
    for (const t of ["díra závit M8 skrz kuželové 10 v 0 0 30", "hole thread M8 through countersink 10 at 0 0 30", "bohrung gewinde M8 durch kegelsenkung 10 bei 0 0 30"]) {
      expect(holeOf(t), t).toMatchObject({ kind: "tapped", head: "countersink", thread: "M8", csDiameter: 10, csAngle: 90 });
    }
    // bez závitu beze změny
    expect(holeOf("díra 9 skrz v 0 0 30 zahloubení 15 9").head).toBeUndefined();
    expect(holeOf("díra 9 skrz v 0 0 30 zahloubení 15 9").kind).toBe("counterbore");
  });
  it("zahloubení i kuželové najednou = chyba (dřív kuželové tiše vyhrálo)", () => {
    expect(errOf("díra 8 skrz zahloubení 15 9 kuželové 16 v 0 0 30")).toMatch(/„zahloubení“ a „kuželové“ najednou nejde/);
    expect(errOf("díra závit M8 skrz zahloubení 15 9 kuželové 16 v 0 0 30")).toMatch(/najednou nejde/);
  });
  it("jádro: objem průchozí M8 se zahloubením Ø20×7 = Ø20×7 + Ø6,8×23 (nález: jen Ø6,8×30)", { timeout: 120_000 }, async () => {
    const a = await built("díra 6,8 skrz v 0 0 30 zahloubení 20 7 závit M8");
    expect(a.res.status.every((s) => s.ok && !s.warning), JSON.stringify(a.res.status)).toBe(true);
    expect(a.removed).toBeCloseTo(PI * (10 * 10 * 7 + 3.4 * 3.4 * 23), 3);
    // rozdíl proti nálezu (zahloubení zahozené) = prstenec zahloubení
    const plain = await built("díra 6,8 skrz v 0 0 30 závit M8");
    expect(a.removed - plain.removed).toBeCloseTo(PI * (10 * 10 - 3.4 * 3.4) * 7, 3);
  });
  it("jádro: slepá M8 hl. 20 se zahloubením 14×5 a kuželové zahloubení Ø10×90°", { timeout: 120_000 }, async () => {
    const b = await built("díra závit M8 hloubka 20 zahloubení 14 5 v 0 0 30");
    expect(b.res.status.every((s) => s.ok && !s.warning), JSON.stringify(b.res.status)).toBe(true);
    expect(b.removed).toBeCloseTo(PI * (7 * 7 * 5 + 3.4 * 3.4 * 15) + cone(6.8), 3);
    const c = await built("díra závit M8 skrz kuželové 10 v 0 0 30");
    expect(c.res.status.every((s) => s.ok && !s.warning), JSON.stringify(c.res.status)).toBe(true);
    const h = 5 - 3.4; // 90° → hloubka kužele = rozdíl poloměrů
    expect(c.removed).toBeCloseTo(PI * 3.4 * 3.4 * 30 + (PI * h * (25 + 5 * 3.4 + 3.4 * 3.4)) / 3 - PI * 3.4 * 3.4 * h, 3);
  });
  it("⚠ jen když je zahloubení menší než závit (Ø7,5 < M8); stavba proběhne se zahloubením", { timeout: 120_000 }, async () => {
    const w = await built("díra závit M8 skrz zahloubení 7,5 3 v 0 0 30");
    const s = w.res.status.find((x) => x.id === w.doc.features[1].id)!;
    expect(s.ok).toBe(true);
    expect(s.warning).toMatch(/Zahloubení Ø7,5 je menší než závit M8 \(Ø8\) – závit zasahuje do zahloubení/);
    expect(w.removed).toBeCloseTo(PI * (3.75 * 3.75 * 3 + 3.4 * 3.4 * 27), 3);
    const ok = await built("díra závit M8 skrz zahloubení 8,5 3 v 0 0 30");
    expect(ok.res.status.every((x) => !x.warning)).toBe(true);
  });
  it("starší závitová díra bez head se zbylým cbDiameter se staví beze změny (bez zahloubení), ale ne potichu: ⚠ + stav", { timeout: 120_000 }, async () => {
    const f: HoleF = { id: "h", name: "Stara", type: "hole", kind: "tapped", thread: "M8", position: [0, 0, 30], axis: "Z", flip: false, diameter: 6.8, depth: 0, cbDiameter: 20, cbDepth: 7 };
    expect(holeHeadOf(f)).toBeNull();
    const p = parseAgentText(BOX);
    const doc: CadDoc = { ...emptyDoc("old"), features: [...p.ops.flatMap((o) => (o.k === "feature" ? [o.feature] : [])), f] };
    const res = await buildDoc(doc);
    expect(BOXV - res.metrics!.volume).toBeCloseTo(PI * 3.4 * 3.4 * 30, 3);
    expect(holeCallout(f, 1)).toEqual(["M8 skrz"]);
    // revize: dřív ✓ bez ⚠ a stav bez stopy po zahloubení
    const st = res.status.find((x) => x.id === "h")!;
    expect(st.ok).toBe(true);
    expect(st.warning).toMatch(/Uložené zahloubení Ø20×7 se nevrtá – závitová díra nemá head \(starší zápis\)\. Zahloubit: upravit "Stara" head=counterbore; smazat: upravit "Stara" head=none/);
    expect(featureSummary(f)).toBe("M8 skrz (vrták Ø6,8) (uložené zahl. Ø20×7 se nevrtá – chybí head) v [0; 0; 30], osa Z");
  });
  it("stav: „M8 skrz (vrták Ø6,8) zahl. Ø20×7“ / „kuž. Ø10“", () => {
    expect(featureSummary(holeOf("díra 6,8 skrz v 0 0 30 zahloubení 20 7 závit M8"))).toBe("M8 skrz (vrták Ø6,8) zahl. Ø20×7 v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra závit M8 skrz kuželové 10 v 0 0 30"))).toBe("M8 skrz (vrták Ø6,8) kuž. Ø10 v [0; 0; 30], osa Z");
  });
});

describe("B4: prvek hole a upravit – stejná pravidla jako text", () => {
  const prvek = (t: string) => {
    const p = parseAgentText(t);
    if (p.errors.length) return { err: p.errors[0].message, f: null as unknown as HoleF, note: "" };
    const op = p.ops[0] as unknown as FeatOp;
    return { err: "", f: op.feature, note: op.note ?? "" };
  };
  it("prvek hole kind=tapped head=counterbore … / head=zahloubení / jen rozměry zahloubení u závitové díry", () => {
    expect(prvek("prvek hole kind=tapped thread=M8 head=counterbore cbDiameter=20 cbDepth=7 position=0;0;30").f).toMatchObject({ kind: "tapped", head: "counterbore", diameter: 6.8 });
    expect(prvek("prvek hole kind=tapped thread=M8 head=zahloubení cbDiameter=20 cbDepth=7 position=0;0;30").f.head).toBe("counterbore");
    expect(prvek("prvek hole kind=tapped thread=M8 head=kegelsenkung csDiameter=10 position=0;0;30").f.head).toBe("countersink");
    expect(prvek("prvek hole kind=tapped thread=M8 cbDiameter=20 cbDepth=7 position=0;0;30").f.head).toBe("counterbore");
  });
  it("prvek hole kind=counterbore thread=M8 → závitová díra se zahloubením + poznámka (ne tiché zahození závitu)", () => {
    const a = prvek("prvek hole kind=counterbore thread=M8 cbDiameter=20 cbDepth=7 position=0;0;30");
    expect(a.err).toBe("");
    expect(a.f).toMatchObject({ kind: "tapped", head: "counterbore", thread: "M8", diameter: 6.8 });
    expect(a.note).toMatch(/zahloubení \+ závit M8 = závitová díra se zahloubením/);
  });
  it("prvek nápověda hole vypíše pole head (CS / EN)", () => {
    const help = (t: string) => (parseAgentText(t).ops[0] as unknown as { lines: string[] }).lines.join("\n");
    expect(help("prvek nápověda hole")).toMatch(/head – .*counterbore\|countersink.*zahloubení \+ vrták \+ závit/);
    setLang("en");
    expect(help("feature help hole")).toMatch(/head – .*counterbore\|countersink.*counterbore \+ drill \+ thread/);
  });
  it("chyby: neznámé head, head bez závitu, head bez rozměrů", () => {
    expect(prvek("prvek hole kind=tapped thread=M8 head=foo cbDiameter=20 cbDepth=7 position=0;0;30").err).toMatch(/head „foo“ – zadejte counterbore/);
    expect(prvek("prvek hole kind=simple diameter=9 head=counterbore cbDiameter=20 cbDepth=7 position=0;0;30").err).toMatch(/head \(zahloubení závitové díry\) platí jen pro závitovou díru/);
    expect(prvek("prvek hole kind=tapped thread=M8 head=counterbore position=0;0;30").err).toMatch(/head=counterbore potřebuje průměr a hloubku zahloubení/);
    expect(prvek("prvek hole kind=tapped thread=M8 head=countersink position=0;0;30").err).toMatch(/head=countersink potřebuje průměr kuželového zahloubení/);
  });
  it("upravit: zahloubená díra + thread=M8 → závitová se zahloubením; kind=simple head smaže", async () => {
    const base = parseAgentText("díra 9 skrz v 0 0 30 zahloubení 20 7");
    const doc: CadDoc = { ...emptyDoc("E"), features: [{ ...(base.ops[0] as unknown as FeatOp).feature, id: "h1", name: "Díra 1" }] };
    const run = async (d: CadDoc, cmd: string) => {
      const e = parseAgentText(cmd);
      expect(e.errors, cmd).toEqual([]);
      const op = e.ops[0];
      if (op.k !== "edit") throw new Error(op.k);
      return applyEdit(d, op.cmd, {});
    };
    const r1 = await run(doc, 'upravit "Díra 1" thread=M8');
    const h1 = r1.doc.features[0] as HoleF;
    expect(h1).toMatchObject({ kind: "tapped", head: "counterbore", thread: "M8", diameter: 6.8, cbDiameter: 20, cbDepth: 7 });
    expect(r1.log.join("\n")).toMatch(/závitová díra se zahloubením/);
    const r2 = await run(r1.doc, 'upravit "Díra 1" kind=simple diameter=9');
    expect((r2.doc.features[0] as HoleF).head).toBeUndefined();
    // klíč, který díra zatím nemá: upravit … head=countersink csDiameter=10 na závitové díře bez zahloubení
    const t: CadDoc = { ...emptyDoc("T"), features: [{ ...holeOf("díra závit M8 skrz v 0 0 30"), id: "h2", name: "Díra 2" }] };
    const r3 = await run(t, 'upravit "Díra 2" head=countersink csDiameter=10');
    expect(r3.doc.features[0]).toMatchObject({ kind: "tapped", head: "countersink", csDiameter: 10 });
    await expect(run(t, 'upravit "Díra 2" head=counterbore')).rejects.toThrow(/head=counterbore potřebuje průměr a hloubku/);
  });
});

describe("B4: výkres, kontrola kót, měřit", () => {
  it("popis díry: M8 + vrták + ⌴ / ⌵ (s počtem, slepá s hloubkou závitu)", () => {
    const base = { kind: "tapped" as const, thread: "M8", diameter: 6.8, depth: 0, cbDiameter: 20, cbDepth: 7 };
    expect(holeCallout({ ...base, head: "counterbore" }, 4)).toEqual(["4× M8 skrz", "Ø6,8 skrz", "⌴ Ø20 ↧7"]);
    expect(holeCallout({ ...base, head: "counterbore", depth: 20, threadDepth: 16 }, 1)).toEqual(["M8 ↧16", "Ø6,8 ↧20", "⌴ Ø20 ↧7"]);
    expect(holeCallout({ ...base, head: "counterbore", depth: 20 }, 1)).toEqual(["M8 ↧20", "Ø6,8 ↧20", "⌴ Ø20 ↧7"]);
    expect(holeCallout({ ...base, head: "countersink", csDiameter: 10, csAngle: 90 }, 1)).toEqual(["M8 skrz", "Ø6,8 skrz", "⌵ Ø10 × 90°"]);
    // zahloubená díra bez závitu beze změny
    expect(holeCallout({ kind: "counterbore", diameter: 9, depth: 0, cbDiameter: 15, cbDepth: 9 }, 2)).toEqual(["2× Ø9 skrz", "⌴ Ø15 ↧9"]);
  });
  it("Chytré kóty: díra najde geometrii, popis „M8 skrz / Ø6,8 skrz / ⌴ Ø20 ↧7“; kontrola kót bez chybějících", { timeout: 180_000 }, async () => {
    const { doc } = await runText("kvádr 80 50 30\ndíra 6,8 skrz v 20 25 zahloubení 20 7 závit M8\ndíra závit M8 hloubka 20 hloubka-závitu 16 kuželové 10 v 60 25");
    const d = await smartDrawing(doc, { sheet: "A3", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false } });
    const L = d.smart.annotations.map((a) => annLabel(d.drawing.views, a));
    expect(L).toContain("M8 skrz / Ø6,8 skrz / ⌴ Ø20 ↧7");
    expect(L).toContain("M8 ↧16 / Ø6,8 ↧20 / ⌵ Ø10 × 90°");
    expect(d.smart.report.skipped.filter((s) => /nenalezena/.test(s))).toEqual([]);
    const exp = expectedDims(d.doc, d.bbox).map((x) => x.label);
    expect(exp).toEqual(expect.arrayContaining(["Ø20 (zahloubení)", "7 (hloubka zahloubení)", "Ø10 (kuželové zahloubení)", "Ø6,8 (vrták závitu M8)"]));
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(dimCheck(d.doc, d.bbox, out.texts).filter((x) => !x.present && /zahloubení|vrták|M8/.test(x.label))).toEqual([]);
  });
  it("měřit díry: zahloubení Ø20 slepé hl. 7 a vrták Ø6,8 skrz", { timeout: 120_000 }, async () => {
    const a = await built("díra 6,8 skrz v 0 0 30 zahloubení 20 7 závit M8");
    const holes = measureCylinders(a.res.body!, true);
    expect(holes.find((h) => Math.abs(h.diameter - 20) < 1e-6)).toMatchObject({ through: false, depth: 7, bottom: "flat" });
    expect(holes.find((h) => Math.abs(h.diameter - 6.8) < 1e-6)).toMatchObject({ through: true });
    const lines = measureLines({ kind: "holes", label: "díl", holes }).join("\n");
    expect(lines).toMatch(/Díry: 2 – Ø 6,8 mm × 1, Ø 20 mm × 1/);
    expect(lines).toMatch(/Ø 20 mm: .*slepá, hloubka 7 mm/);
    expect(docStatusText(a.doc, a.res)).toMatch(/M8 skrz \(vrták Ø6,8\) zahl\. Ø20×7/);
  });
});

/* ───────────── B9: tabulka děr bez vnějších válců ───────────── */

/** soustružený díl: Ø10 × 20 + osazení Ø8 × 10, vrtání Ø4 skrz (osa Z) */
const turned = () => {
  let s = r.makeCylinder(5, 20, [0, 0, 0], [0, 0, 1]) as r.Shape3D;
  s = s.fuse(r.makeCylinder(4, 10, [0, 0, 20], [0, 0, 1]));
  return s.cut(r.makeCylinder(2, 40, [0, 0, -5], [0, 0, 1]));
};
const VIEWS = { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false };
const META = (name: string) => ({ name, material: "Ocel S235" });

describe("B9: tabulka děr a měřit díry nevypisují vnější válce", () => {
  it("soustružený díl Ø10 / Ø8 s vrtáním Ø4: tabulka děr = jen A1 Ø4 (nález: A1 Ø4, B1 Ø8, C1 Ø10)", () => {
    const d = makeDrawing(turned(), META("Čep"), { holeTable: true, views: VIEWS });
    expect(d.holes?.map((h) => `${h.tag} Ø${h.d}`)).toEqual(["A1 Ø4"]);
    expect(measureCylinders(turned(), true).map((c) => c.diameter)).toEqual([4]);
    expect(measureCylinders(turned(), false).map((c) => c.diameter).sort()).toEqual([10, 8].sort());
  });
  it("soustružený díl z textu (válce + díra) a hřídel bez díry: žádný vnější válec v tabulce", { timeout: 120_000 }, async () => {
    const { doc } = await runText("válec 10 20\nválec 8 10 v 0 0 20\ndíra 4 skrz v 0 0 30");
    const res = await buildDoc(doc);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const d = makeDrawing(res.body as r.Shape3D, META("Čep"), { holeTable: true, views: VIEWS });
    expect(d.holes?.map((h) => h.d)).toEqual([4]);
    const shaft = makeDrawing(r.makeCylinder(5, 20, [0, 0, 0], [0, 0, 1]).fuse(r.makeCylinder(4, 10, [0, 0, 20], [0, 0, 1])) as r.Shape3D, META("Hřídel"), { holeTable: true, views: VIEWS });
    expect(shaft.holes ?? []).toEqual([]);
  });
  it("text: výkres … tabulka děr ano → výkres stav vypíše jen díru Ø4 (ověřitelné bez obrázku)", { timeout: 180_000 }, async () => {
    const { doc, log } = await runText("válec 10 20\nválec 8 10 v 0 0 20\ndíra 4 skrz v 0 0 30\nvýkres A4 pohledy přední,horní tabulka děr ano");
    expect(log.join("\n")).toMatch(/tabulka děr/);
    const st = (await drawingStatus(doc, computeDrawing)).text;
    expect(st).toMatch(/Tabulka děr \(pohled horní, 1\): A1 Ø4 \[5; 5\]/);
    expect(st).not.toMatch(/Ø8 \[|Ø10 \[/);
    const { doc: shaft } = await runText("válec 10 20\nválec 8 10 v 0 0 20\nvýkres A4 pohledy přední,horní tabulka děr ano");
    expect((await drawingStatus(shaft, computeDrawing)).text).toMatch(/Tabulka děr: žádné díry \(vnější válce – hřídel, osazení – se nevypisují\)/);
  });
  it("deska s dírami: díry i se zahloubením zůstávají v tabulce – zahloubená díra jedním řádkem (Ø6 ⌴Ø12)", () => {
    let s = r.makeBox([-40, -25, 0], [40, 25, 20]) as r.Shape3D;
    s = s.cut(r.makeCylinder(10, 40, [0, 0, -10], [0, 0, 1]));
    s = s.cut(r.makeCylinder(3, 40, [30, 15, -10], [0, 0, 1])).cut(r.makeCylinder(6, 5, [30, 15, 15], [0, 0, 1]));
    const d = makeDrawing(s, META("Deska"), { holeTable: true, views: VIEWS });
    expect(d.holes?.map((h) => [h.tag, h.d, h.steps ?? []])).toEqual([["A1", 6, [12]], ["B1", 20, []]]);
    expect(d.svg).toContain("Ø6 ⌴Ø12");
  });
});

describe("návod pro AI a tabulka příkazů", () => {
  it("návod popisuje polohy po skupinách a zahloubení se závitem", () => {
    expect(AGENT_GUIDE).toMatch(/díra 6,8 skrz v 15,1 -30 v 15,1 -90 zahloubení 20 7 závit M8/);
    expect(AGENT_GUIDE).toMatch(/každé `v` = jedna poloha/);
    expect(AGENT_GUIDE).toMatch(/"head": "counterbore"/);
  });
});
