/**
 * 15. vlna, balík „hole“ – regresní testy nálezů revize (reprodukce z konzole /cad převedené na vitest s OpenCascade):
 * 1. DE „senkung“ v `prvek … head=` = válcové zahloubení (jako v textu `bohrung … senkung 20 7 gewinde M8`), ne kuželové;
 * 2. `upravit … kind=tapped thread=M8` u zahloubené díry zahloubení ponechá (dřív ho tiše zahodilo, cb rozměry visely);
 * 3. starší závitová díra bez `head` s uloženým zahloubením: geometrie beze změny, ale ⚠ ve stavbě a poznámka ve stavu;
 * 4. stav ukáže skutečný směr vrtání (vrtání nahoru `směr 0 0 1`, šikmá díra) – dřív vše „osa Z“;
 * 5. stav vypíše všechny polohy (dřív jen 12 a „… +N“);
 * 6. řádek „Tabulka děr“ ve `výkres stav` v angličtině s desetinnou tečkou;
 * 7. hřídel podél X s pohledem shora: tabulka děr z pohledu, který díry vidí, stav jmenuje pohled a díry s jinou osou;
 * 8. průchozí závitová díra s `hloubka-závitu`: výkres „M8 ↧12“ + „Ø6,8 skrz“, stav „délka závitu 12“;
 * 9. tabulka děr: závitová díra se zahloubením = jeden řádek (vrták + ⌴ + závit), ne dva nesouvisející;
 * 10. ⚠ jen při zahloubení MENŠÍM než závit (Ø8 u M8 se nehlásí).
 */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { featureSummary, parseAgentText } from "./agent";
import { applyEdit } from "./agent-edit";
import { buildDoc } from "./build";
import { drawingStatus } from "./drawing-agent";
import { holeCallout } from "./drawing-dims";
import { computeDrawing, runText } from "./drawing-dims-harness";
import { headBelowThread, holeHeadKindOf } from "./hole-spec";
import { setLang } from "./i18n";
import { measureCylinders } from "./measure";
import type { CadDoc, Feature } from "./types";
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
const PI = Math.PI;
const firstFeature = (t: string): { f: HoleF; note: string; err: string } => {
  const p = parseAgentText(t);
  if (p.errors.length) return { f: null as unknown as HoleF, note: "", err: p.errors[0].message };
  const op = p.ops.find((o) => o.k === "feature") as unknown as { feature: HoleF; note?: string };
  return { f: op.feature, note: op.note ?? "", err: "" };
};
const holeOf = (t: string) => {
  const x = firstFeature(t);
  expect(x.err, t).toBe("");
  return { ...x.f, id: "h", name: "Díra 1" } as HoleF;
};
/** dokument z textových příkazů (bez výkresu) – díry „v x y“ dostanou povrch jako v konzoli */
const docOf = async (text: string) => (await runText(text)).doc;
const edit = async (d: CadDoc, cmd: string) => {
  const e = parseAgentText(cmd);
  expect(e.errors, cmd).toEqual([]);
  const op = e.ops[0];
  if (op.k !== "edit") throw new Error(op.k);
  return applyEdit(d, op.cmd, {});
};
const hole = (d: CadDoc) => d.features.find((f): f is HoleF => f.type === "hole")!;

describe("1: DE „senkung“ v head= = válcové zahloubení (jako v textu)", () => {
  it("prvek hole … head=senkung cbDiameter=20 cbDepth=7 = counterbore (nález: ✗ head=countersink potřebuje csDiameter)", () => {
    const a = firstFeature("prvek hole kind=tapped thread=M8 head=senkung cbDiameter=20 cbDepth=7 position=20;-20;30 depth=0");
    expect(a.err).toBe("");
    expect(a.f).toMatchObject({ kind: "tapped", head: "counterbore", cbDiameter: 20, cbDepth: 7 });
    // text a head= se shodnou: senkung = zahloubení, kegelsenkung / zapuštění = kuželové
    expect(firstFeature("bohrung durch bei 50 -80 senkung 20 7 gewinde M8").f).toMatchObject({ head: "counterbore" });
    expect(holeHeadKindOf("Senkung")).toBe("counterbore");
    expect(holeHeadKindOf("Flachsenkung")).toBe("counterbore");
    expect(holeHeadKindOf("Kegelsenkung")).toBe("countersink");
    expect(holeHeadKindOf("zapuštění")).toBe("countersink");
  });
});

describe("2: upravit kind=tapped thread=M8 u zahloubené díry zahloubení ponechá", () => {
  it("zahloubení Ø11×6,8 zůstane v tělese (nález: kind counterbore → tapped tiše bez zahloubení), protokol to oznámí", { timeout: 180_000 }, async () => {
    const d0 = await docOf("kvádr 60 60 20\ndíra 6,6 skrz v 20 20 zahloubení 11 6,8");
    const r1 = await edit(d0, 'upravit "Díra 1" kind=tapped thread=M8');
    const h = hole(r1.doc);
    expect(h).toMatchObject({ kind: "tapped", head: "counterbore", thread: "M8", cbDiameter: 11, cbDepth: 6.8 });
    expect(r1.log.join("\n")).toMatch(/zahloubení \+ závit M8 = závitová díra se zahloubením \(zahloubení \+ vrták \+ závit\) – bez zahloubení: head=none/);
    expect(featureSummary(h)).toMatch(/^M8 skrz \(vrták Ø6,8\) zahl\. Ø11×6,8 v \[20; 20; 20\], osa Z$/);
    const res = await buildDoc(r1.doc);
    expect(res.status.every((s) => s.ok && !s.warning), JSON.stringify(res.status)).toBe(true);
    expect(60 * 60 * 20 - res.metrics!.volume).toBeCloseTo(PI * (5.5 * 5.5 * 6.8 + 3.4 * 3.4 * (20 - 6.8)), 2);
    const cyl = measureCylinders(res.body!, true).map((c) => c.diameter).sort((a, b) => a - b);
    expect(cyl).toEqual([6.8, 11]);
    // stejná díra přes thread=M8 dává totéž
    const r2 = await edit(d0, 'upravit "Díra 1" thread=M8');
    expect(hole(r2.doc)).toMatchObject({ kind: "tapped", head: "counterbore", cbDiameter: 11, cbDepth: 6.8 });
  });
  it("výslovné head=none: závitová díra bez zahloubení a bez visících rozměrů (žádné ⚠ nevrtaného zahloubení)", { timeout: 120_000 }, async () => {
    const d0 = await docOf("kvádr 60 60 20\ndíra 6,6 skrz v 20 20 zahloubení 11 6,8");
    const r1 = await edit(d0, 'upravit "Díra 1" kind=tapped thread=M8 head=none');
    const h = hole(r1.doc);
    expect(h.kind).toBe("tapped");
    expect(h.head).toBeUndefined();
    expect(h.cbDiameter).toBe(0);
    expect(h.cbDepth).toBe(0);
    const r2 = await edit(d0, 'upravit "Díra 1" thread=M8 head=none');
    expect(hole(r2.doc)).toMatchObject({ kind: "tapped", cbDiameter: 0 });
    expect(r2.log.join("\n")).toMatch(/závit M8 \+ head=none = závitová díra bez zahloubení/);
    const res = await buildDoc(r1.doc);
    expect(res.status.every((s) => s.ok && !s.warning), JSON.stringify(res.status)).toBe(true);
  });
});

describe("3: starší závitová díra bez head s uloženým zahloubením – ne potichu", () => {
  const OLD: HoleF = { id: "old", type: "hole", name: "Stara", position: [50, -50, 30], axis: "Z", flip: false, diameter: 6.8, depth: 0, kind: "tapped", thread: "M8", cbDiameter: 20, cbDepth: 7 };
  /** dokument jako po načtení JSON z dřívějšího parseru (`díra … zahloubení 20 7 závit M8` uložila kind tapped + cb bez head) */
  const oldDoc = async () => {
    const d = await docOf("kvádr 100 100 30 v 0 -100 0");
    d.features.push(structuredClone(OLD));
    return d;
  };
  it("JSON z dřívějšího parseru: objem beze změny, ⚠ s opravou, stav s poznámkou; upravit head=counterbore zahloubí", { timeout: 180_000 }, async () => {
    const d0 = await oldDoc();
    const res = await buildDoc(d0);
    const h = hole(d0);
    const st = res.status.find((x) => x.id === h.id)!;
    expect(st.ok).toBe(true);
    expect(st.warning).toMatch(/Uložené zahloubení Ø20×7 se nevrtá/);
    expect(st.warning).toMatch(/upravit "Stara" head=counterbore/);
    expect(100 * 100 * 30 - res.metrics!.volume).toBeCloseTo(PI * 3.4 * 3.4 * 30, 2);
    expect(featureSummary(h)).toMatch(/M8 skrz \(vrták Ø6,8\) \(uložené zahl\. Ø20×7 se nevrtá – chybí head\)/);
    const fixed = await edit(d0, 'upravit "Stara" head=counterbore');
    const res2 = await buildDoc(fixed.doc);
    expect(res2.status.every((s) => s.ok && !s.warning), JSON.stringify(res2.status)).toBe(true);
    expect(100 * 100 * 30 - res2.metrics!.volume).toBeCloseTo(PI * (10 * 10 * 7 + 3.4 * 3.4 * 23), 2);
    const gone = await edit(d0, 'upravit "Stara" head=none');
    expect((await buildDoc(gone.doc)).status.every((s) => !s.warning)).toBe(true);
    expect(featureSummary(hole(gone.doc))).not.toMatch(/uložené/);
  });
  it("EN / DE text of the warning", { timeout: 120_000 }, async () => {
    const d0 = await oldDoc();
    setLang("en");
    const en = (await buildDoc(d0)).status.find((x) => x.warning)!.warning!;
    expect(en).toMatch(/The stored counterbore Ø20×7 is not machined – the tapped hole has no head \(older notation\)\. Counterbore it: edit "Stara" head=counterbore/);
  });
});

describe("4: stav ukáže skutečný směr vrtání", () => {
  it("vrtání nahoru (směr 0 0 1) vs. dolů (směr 0 0 -1 = výchozí) – dřív obojí „osa Z“", () => {
    expect(featureSummary(holeOf("díra 6 skrz v 20 20 0 směr 0 0 1"))).toBe("Ø6 skrz v [20; 20; 0], osa Z, vrtá +Z");
    expect(featureSummary(holeOf("díra 6 skrz v 40 40 20 směr 0 0 -1"))).toBe("Ø6 skrz v [40; 40; 20], osa Z");
    expect(featureSummary(holeOf("díra 6 skrz v 40 40 20"))).toBe("Ø6 skrz v [40; 40; 20], osa Z");
    expect(featureSummary(holeOf("díra 6 skrz v 40 40 0 obráceně"))).toBe("Ø6 skrz v [40; 40; 0], osa Z, vrtá +Z");
    expect(featureSummary(holeOf("díra 6 hloubka 15 v 0 0 osa X"))).toMatch(/osa X$/);
  });
  it("šikmá díra se zahloubením a závitem: směr vrtání vektorem", () => {
    expect(featureSummary(holeOf("díra závit M6 hloubka 15 zahloubení 11 4 v 70 30 20 směr 1 0 -1"))).toBe("M6 hl. 15 (vrták Ø5) zahl. Ø11×4 v [70; 30; 20], osa Z, směr vrtání [0,707; 0; -0,707]");
    setLang("en");
    expect(featureSummary(holeOf("hole 6 through at 20 20 0 direction 0 0 1"))).toBe("Ø6 through at [20; 20; 0], axis Z, drills +Z");
  });
});

describe("5: stav vypíše všechny polohy", () => {
  it("14 poloh: všechny, žádné „… +2“ (nález: polohy 13 a 14 nešly ze stavu přečíst)", () => {
    const xs = Array.from({ length: 14 }, (_, i) => 10 + 20 * i);
    const s = featureSummary(holeOf(`díra 5 skrz ${xs.map((x) => `v ${x} 10 20`).join(" ")}`));
    expect(s).toMatch(/· polohy \(14\): /);
    expect(s).toContain("[250; 10; 20] [270; 10; 20]");
    expect(s).not.toMatch(/…|\+2/);
  });
});

describe("6 + 9: tabulka děr – jedna díra = jeden řádek, EN s desetinnou tečkou", () => {
  const TEXT = "kvádr 100 100 30 v 0 -100 0\ndíra 6,8 skrz v 20 -20 v 20 -80 zahloubení 20 7 závit M8\ndíra závit M8 skrz zahloubení 7,5 3 v 80 -20 30\nvýkres A3 pohledy přední,horní tabulka děr ano";
  it("3 závitové díry se zahloubením = 3 řádky s M8 a ⌴ (nález: 6 řádků, Ø20 jako samostatné díry)", { timeout: 240_000 }, async () => {
    const { doc } = await runText(TEXT);
    const st = (await drawingStatus(doc, computeDrawing)).text;
    expect(st).toMatch(/Tabulka děr \(pohled horní, 3\): A1 M8 Ø6,8 ⌴Ø7,5 \[80; 80\] · B1 M8 Ø6,8 ⌴Ø20 \[20; 80\] · B2 M8 Ø6,8 ⌴Ø20 \[20; 20\]/);
    expect(st).not.toMatch(/C1 Ø20/);
    setLang("en");
    const en = (await drawingStatus(doc, computeDrawing)).text;
    // (názvy pohledů ve stavu výkresu zůstávají v EN česky v celém stavu – „views: přední, horní“ – mimo tento balík)
    expect(en).toMatch(/Hole table \(view \S+, 3\): A1 M8 Ø6\.8 ⌴Ø7\.5 \[80; 80\] · B1 M8 Ø6\.8 ⌴Ø20 \[20; 80\]/);
    // řádek tabulky děr v jazyce protokolu (uložené Chytré kóty listu – vygenerované česky – zůstávají v zápisu listu)
    expect(en.split("\n").find((l) => l.startsWith("Hole table")) ?? "").not.toMatch(/Ø6,8|Ø7,5/);
  });
});

describe("7: hřídel podél X – tabulka děr z pohledu, který díry vidí", () => {
  const SHAFT = "skica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít\nrotovat osa X\ndíra 6 hloubka 15 v 0 0 osa X\ndíra 5 skrz obousměrně v 60 0 0 osa Y";
  it("pohledy přední,levý,pravý,horní: pohled přední s Ø5, díra Ø6 (osa X) uvedena jako jiná osa (nález: „žádné díry … vnější válce“)", { timeout: 300_000 }, async () => {
    const { doc } = await runText(`${SHAFT}\nvýkres A3 pohledy přední,levý,pravý,horní tabulka děr ano`);
    const st = (await drawingStatus(doc, computeDrawing)).text;
    expect(st).toMatch(/Tabulka děr \(pohled přední, 1\): A1 Ø5 \[60; 20\] · díry s jinou osou nejsou v tabulce \(1\): Ø6 osa X/);
    expect(st).not.toMatch(/Tabulka děr: žádné díry/);
  });
  it("jen pohled shora: stav řekne, že díry mají jinou osu (ne „vnější válce“)", { timeout: 300_000 }, async () => {
    const { doc } = await runText(`${SHAFT}\nvýkres A3 pohledy horní tabulka děr ano`);
    const st = (await drawingStatus(doc, computeDrawing)).text;
    expect(st).toMatch(/Tabulka děr: v pohledu horní žádná díra s osou ve směru pohledu; díry s jinou osou \(2\): Ø5 osa Y, Ø6 osa X/);
  });
});

describe("8: průchozí závitová díra s hloubka-závitu", () => {
  it("výkres „M8 ↧12“ + „Ø6,8 skrz“ (+ ⌴), stav „délka závitu 12“ (nález: „M8 skrz“, délka závitu nikde)", () => {
    const cb = holeOf("díra 6,8 skrz v 20 20 30 zahloubení 20 7 závit M8 hloubka-závitu 12");
    expect(holeCallout(cb, 1)).toEqual(["M8 ↧12", "Ø6,8 skrz", "⌴ Ø20 ↧7"]);
    expect(featureSummary(cb)).toBe("M8 skrz (vrták Ø6,8) zahl. Ø20×7, délka závitu 12 v [20; 20; 30], osa Z");
    const plain = holeOf("díra 6,8 skrz v 60 20 30 závit M8 hloubka-závitu 12");
    expect(holeCallout(plain, 2)).toEqual(["2× M8 ↧12", "Ø6,8 skrz"]);
    expect(featureSummary(plain)).toBe("M8 skrz (vrták Ø6,8), délka závitu 12 v [60; 20; 30], osa Z");
    // bez hloubky závitu beze změny; slepá díra se závitem po celé hloubce bez poznámky
    expect(holeCallout(holeOf("díra 6,8 skrz v 60 20 30 závit M8"), 1)).toEqual(["M8 skrz"]);
    expect(featureSummary(holeOf("díra závit M8 hloubka 20 hloubka-závitu 20 v 0 0 30"))).toBe("M8 hl. 20 (vrták Ø6,8) v [0; 0; 30], osa Z");
  });
});

describe("10: ⚠ jen při zahloubení menším než závit", () => {
  it("Ø8 u M8 se nehlásí (nález: „Ø8 je menší než závit M8 (Ø8)“), Ø7,9 ano", { timeout: 120_000 }, async () => {
    expect(headBelowThread(holeOf("díra závit M8 skrz zahloubení 8 3 v 80 -20 30"))).toBeNull();
    expect(headBelowThread(holeOf("díra závit M8 skrz zahloubení 7,9 3 v 80 -20 30"))).toMatchObject({ d: 7.9 });
    const d = await docOf("kvádr 100 100 30 v 0 -100 0\ndíra závit M8 skrz zahloubení 8 3 v 80 -20");
    const res = await buildDoc(d);
    expect(res.status.every((s) => s.ok && !s.warning), JSON.stringify(res.status)).toBe(true);
  });
});
