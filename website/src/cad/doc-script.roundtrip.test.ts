/**
 * Kontrola tam a zpět: dokument → docToScript → text → STEJNÁ cesta jako konzole (parseAgentText + smyčka operací
 * zkušebního stroje scripts/cad-harness/loopback.ts nad nezměněným cad.worker.ts) → dokument′. Porovnává se geometrie
 * každého dílu (objem a obálka 1e-6 relativně), počet a typy prvků, komponenty a polohy, splněné vazby, kusovník a listy.
 *
 * Skutečný nástroj 959 je zákaznický (NDA) – test se přeskočí, když soubor website/.local/fixtures/959-dokument.json chybí.
 * DOC2TEXT_REPORT=<soubor> zapíše změřené pokrytí a časy (pro zprávu), jinak test nic nezapisuje.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Session, init, kernel } from "../../scripts/cad-harness/loopback";
import { computeBom, sourceKey } from "./assembly";
import { docToScript, type DocScript } from "./doc-script";
import { freshScriptDoc } from "./doc-script-fresh";
import type { AsmComponent, BuildResult, CadDoc, Feature } from "./types";

const WEB = path.resolve(__dirname, "../..");
// soubor zákazníka: website/.local/fixtures (mimo git); CAD_FIXTURES_DIR = jiná složka (pracovní strom bez .local)
const REAL = path.join(process.env.CAD_FIXTURES_DIR ?? path.join(WEB, ".local", "fixtures"), "959-dokument.json");
const SYNTH = path.join(WEB, "scripts", "cad-harness", "synth-tool.txt");
const REPORT = process.env.DOC2TEXT_REPORT;
const report: Record<string, unknown> = {};

beforeAll(async () => {
  await init(WEB);
}, 120_000);

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
/** dokument připravený jádrem jako v aplikaci (čísla vybraných hran / ploch podle otisků, smazané vygenerované kóty) a jeho skript */
async function freshScript(doc: CadDoc, drawing = false) {
  const fresh = await freshScriptDoc(doc, { pickSigs: kernel.pickSigs, ...(drawing ? { drawing: (d, meta, o) => kernel.drawing(d, meta, o) } : {}) });
  const r = docToScript(fresh.doc, { deletedDims: fresh.deletedDims });
  return { fresh, script: { ...r, notes: [...r.notes, ...fresh.notes] } };
}
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as CadDoc;

type PartCheck = { name: string; features: number; types: string; volume: number; volumeRel: number; bboxRel: number; valid?: boolean };
async function metrics(doc: CadDoc): Promise<BuildResult["metrics"]> {
  const [r] = await kernel.asmParts([{ key: sourceKey({ kind: "part", doc }), source: { kind: "part", doc } }]);
  return r.result.metrics;
}
/** díl a díl′: počet a typy prvků, objem a obálka z jádra */
async function comparePart(a: CadDoc, b: CadDoc): Promise<PartCheck> {
  const types = (d: CadDoc) => d.features.map((f: Feature) => f.type).join(",");
  expect(b.features.length, `${a.features.length} features`).toBe(a.features.length);
  expect(types(b)).toBe(types(a));
  expect(b.features.map((f) => f.name)).toEqual(a.features.map((f) => f.name));
  expect(b.material).toBe(a.material);
  expect(b.materialName ?? "").toBe(a.materialName ?? "");
  const ma = await metrics(a);
  const mb = await metrics(b);
  expect(!!mb).toBe(!!ma);
  const volumeRel = ma && mb ? rel(ma.volume, mb.volume) : 0;
  const bboxRel = ma && mb ? Math.max(...[0, 1].flatMap((k) => [0, 1, 2].map((i) => rel(ma.bbox[k][i], mb.bbox[k][i])))) : 0;
  expect(volumeRel).toBeLessThan(1e-6);
  expect(bboxRel).toBeLessThan(1e-6);
  if (ma && mb) expect(mb.faces).toBe(ma.faces);
  return { name: "", features: a.features.length, types: types(a), volume: ma?.volume ?? 0, volumeRel, bboxRel, valid: mb?.valid };
}
const sheets = (d: CadDoc) => (d.drawings ?? []).map((s) => `${s.name}|${String((s.options as { sheet?: string }).sheet ?? "auto")}|${JSON.stringify((s.options as { views?: unknown }).views ?? null)}|${String((s.options as { dimensions?: string }).dimensions)}`);
const okMates = (st: Record<string, unknown> | undefined) => Object.values(st ?? {}).filter((x) => x === "ok").length;

/** spustí skript v novém sezení (stejná cesta jako konzole) a vrátí sezení + chyby */
async function replay(text: string, opts: { skipMotion?: boolean } = {}) {
  const s = new Session();
  const t0 = Date.now();
  const res = await s.run(text, opts);
  const errors = res.log.filter((l) => l.text.startsWith("✗")).map((l) => `L${l.line} ${l.text.slice(0, 160)}`);
  return { s, errors, ms: Date.now() - t0 };
}

/** celá kontrola tam a zpět sestavy; vrací čísla pro zprávu */
async function roundTripAssembly(orig: CadDoc, script: DocScript) {
  const { s, errors, ms } = await replay(script.text);
  expect(errors, "script replays without ✗").toEqual([]);
  const rt = s.assembly()!;
  expect(rt, "assembly document").toBeTruthy();
  expect(rt.name).toBe(orig.name);
  const ca = orig.components ?? [];
  const cb = rt.components ?? [];
  expect(cb.length).toBe(ca.length);
  let placeMax = 0;
  for (let i = 0; i < ca.length; i++) {
    expect(cb[i].name).toBe(ca[i].name);
    expect(!!cb[i].fixed).toBe(!!ca[i].fixed);
    expect(cb[i].group ?? "").toBe(ca[i].group ?? "");
    // číslo do kusovníku: z komponenty, jinak z popisových údajů dílu (díl bez výkresu nese číslo ve skriptu na komponentě)
    const num = (c: AsmComponent) => c.number?.trim() || (c.source.kind === "part" ? c.source.doc.props?.number?.trim() : "") || "";
    expect(num(cb[i])).toBe(num(ca[i]));
    for (const k of ["position", "rotation"] as const) for (let j = 0; j < 3; j++) placeMax = Math.max(placeMax, Math.abs(ca[i].placement[k][j] - cb[i].placement[k][j]));
  }
  expect(placeMax).toBeLessThan(1e-6);
  // díly: každý jedinečný díl jednou, objem a obálka
  const seen = new Map<string, PartCheck>();
  let sum = 0;
  let sumRt = 0;
  for (let i = 0; i < ca.length; i++) {
    const a = ca[i].source;
    const b = cb[i].source;
    if (a.kind !== "part" || b.kind !== "part") throw new Error("part components only");
    const key = sourceKey(a);
    if (!seen.has(key)) seen.set(key, await comparePart(a.doc, b.doc));
    expect(sheets(b.doc), `sheets of component ${i + 1}`).toEqual(sheets(a.doc));
    sum += seen.get(key)!.volume;
    sumRt += (await metrics(b.doc))?.volume ?? 0;
  }
  expect(rel(sum, sumRt)).toBeLessThan(1e-6);
  // vazby: počet, typy, splněné
  const ma = orig.mates ?? [];
  const mb = rt.mates ?? [];
  expect(mb.map((m) => m.type)).toEqual(ma.map((m) => m.type));
  expect(mb.map((m) => m.name ?? "")).toEqual(ma.map((m) => m.name ?? ""));
  const idx = (d: CadDoc, id: string) => (d.components ?? []).findIndex((c: AsmComponent) => c.id === id);
  for (let i = 0; i < ma.length; i++) {
    expect([idx(rt, mb[i].a.compId), mb[i].a.face, idx(rt, mb[i].b.compId), mb[i].b.face], `mate ${i + 1} refs`).toEqual([idx(orig, ma[i].a.compId), ma[i].a.face, idx(orig, ma[i].b.compId), ma[i].b.face]);
    expect(mb[i].value ?? null).toBe(ma[i].value ?? null);
    expect(!!mb[i].flip, `mate ${i + 1} flip`).toBe(!!ma[i].flip);
    expect([mb[i].min ?? null, mb[i].max ?? null]).toEqual([ma[i].min ?? null, ma[i].max ?? null]);
    if (ma[i].rel) {
      for (const k of ["position", "rotation"] as const) for (let j = 0; j < 3; j++) expect(Math.abs((mb[i].rel?.[k][j] ?? NaN) - ma[i].rel![k][j]), `mate ${i + 1} rel`).toBeLessThan(1e-6);
    }
  }
  // splněné vazby: původní dokument a dokument′ stejným příkazem
  const so = new Session();
  so.tabs.push({ id: "o", doc: orig });
  so.active = "o";
  await so.run("sestava vazby");
  await s.run("sestava vazby");
  const okA = okMates(so.mateStatus.get(orig.name));
  const okB = okMates(s.mateStatus.get(rt.name));
  expect(okB).toBe(okA);
  // kusovník
  const bom = (d: CadDoc) => computeBom(d, () => ({})).map((r) => `${r.name}|${r.number ?? ""}|${r.qty}|${r.group ?? ""}`);
  expect(bom(rt)).toEqual(bom(orig));
  // pohybová studie
  const mo = (d: CadDoc) => (d.motion ? { motors: d.motion.motors.map((m) => [m.kind, (d.mates ?? []).findIndex((x) => x.id === m.mate), m.from, m.to, m.speed ?? null]), steps: d.motion.steps, duration: d.motion.duration, collisions: !!d.motion.collisions } : null);
  expect(mo(rt)).toEqual(mo(orig));
  expect(sheets(rt)).toEqual(sheets(orig));
  return { components: cb.length, parts: seen.size, features: [...seen.values()].reduce((a, p) => a + p.features, 0), mates: mb.length, matesOk: okB, matesOkOrig: okA, sumCm3: sum / 1000, sumRtCm3: sumRt / 1000, placeMax, volumeRelMax: Math.max(...[...seen.values()].map((p) => p.volumeRel)), bboxRelMax: Math.max(...[...seen.values()].map((p) => p.bboxRel)), invalidParts: [...seen.values()].filter((p) => p.valid === false).length, replayMs: ms, sheets: (rt.drawings ?? []).length + [...new Map(cb.map((c) => [sourceKey(c.source), c.source])).values()].reduce((a, src) => a + (src.kind === "part" ? (src.doc.drawings?.length ?? 0) : 0), 0) };
}

describe("tam a zpět: díly z fixtures", () => {
  for (const name of ["impeller-A", "impeller-B"]) {
    it(`${name}: skript → stejný díl`, async () => {
      const orig = read(path.join(WEB, "src", "cad", "fixtures", `${name}.mncad.json`));
      const script = docToScript(orig);
      expect(script.notes).toEqual([]);
      expect(script.stats.json, "no JSON fallback").toBe(0);
      const { s, errors, ms } = await replay(script.text);
      expect(errors).toEqual([]);
      const rt = s.tabs[s.tabs.length - 1].doc;
      expect(rt.name).toBe(orig.name);
      const p = await comparePart(orig, rt);
      report[name] = { stats: script.stats, volumeRel: p.volumeRel, bboxRel: p.bboxRel, replayMs: ms };
    }, 300_000);
  }

  it("prvky bez vlastního příkazu: obecný `prvek` a JSON dají stejný díl", async () => {
    const orig = {
      app: "mnastrojarna-cad", version: 2, name: "Zkouška prvků", material: "hlinik", kind: "part",
      features: [
        { id: "b", name: "Deska", type: "box", size: [80, 50, 12], position: [0, 0, 0], centered: false, mode: "new" },
        { id: "s", name: "Profil", type: "sketch", plane: { kind: "custom", origin: [40, 25, 12], normal: [0, 0, 1], xDir: [1, 0, 0], label: "Horní" }, entities: [{ id: "k9", type: "circle", cx: 0, cy: 0, r: 8 }] },
        { id: "x", name: "Čep", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "add" },
        { id: "t", name: "Posun", type: "transform", translate: [5, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1 },
        { id: "h", name: "Díra s hrotem", type: "hole", position: [10, 10, 12], axis: "Z", flip: false, diameter: 6, depth: 8, cbDiameter: 0, cbDepth: 0, tipAngle: 120 },
        { id: "sp", name: "Řez", type: "split", plane: "XY", offset: 20, keep: "negative" },
      ],
    } as unknown as CadDoc;
    const script = docToScript(orig);
    // skica s popsanou obecnou rovinou vlastním příkazem (popis roviny řádkem upravit), přesun / rozříznutí / hrot díry obecným příkazem
    expect(script.stats.byType.sketch).toEqual({ dedicated: 1, generic: 0, json: 0 });
    expect(script.stats.byType.transform.generic).toBe(1);
    expect(script.stats.byType.split.generic).toBe(1);
    expect(script.stats.byType.hole.generic).toBe(1);
    const { s, errors } = await replay(script.text);
    expect(errors).toEqual([]);
    const rt = s.tabs[s.tabs.length - 1].doc;
    await comparePart(orig, rt);
    report.fallbacks = script.stats;
  }, 300_000);
});

describe("tam a zpět: zkušební nástroj scripts/cad-harness (70 komponent, 53 vazeb)", () => {
  it("dokument sestavy → skript → stejná sestava", async () => {
    const built = await replay(fs.readFileSync(SYNTH, "utf8"), { skipMotion: true });
    // `kontrola sestava` (balík B5) smyčka zkušebního stroje neprovádí (není to engine – ✗ „loopback does not run op "check"“,
    // jako synth-tool.mjs); kontrolu sestavy ověřuje brána B6 přes sestavené CLI. Jiná chyba být nesmí
    expect(built.errors.filter((e) => !/kontrola|loopback does not run op "check"/.test(e))).toEqual([]);
    const orig = JSON.parse(JSON.stringify(built.s.assembly()!)) as CadDoc;
    expect(orig.components?.length).toBe(70);
    expect(orig.mates?.length).toBe(53);
    // malá pohybová studie na vazbě Vzdálenost (zkušební skript ji má, ale běh ji přeskakuje – trvá desítky sekund)
    const dist = orig.mates!.find((m) => m.type === "distance")!;
    orig.motion = { motors: [{ id: "m1", kind: "linear", mate: dist.id, from: dist.value ?? 0, to: (dist.value ?? 0) - 10 }], duration: 2, steps: 2 };
    const script = docToScript(orig);
    expect(script.stats.matesText).toBe(53);
    expect(script.stats.components).toBe(70);
    const r = await roundTripAssembly(orig, script);
    expect(r.matesOk).toBe(53);
    report.synth = { stats: script.stats, notes: script.notes.length, ...r };
  }, 900_000);
});

describe("tam a zpět: skutečný nástroj 959 (jen se souborem zákazníka)", () => {
  it.skipIf(!fs.existsSync(REAL))("27 dílů / 183 prvků, 70 komponent, 53/53 vazeb, Σ 5241,734 cm³", async () => {
    const orig = read(REAL);
    const t0 = Date.now();
    // jako v aplikaci: jádro ověří čísla vybraných hran / ploch podle otisků (dokument vznikl v aplikaci, výběry mají otisky)
    const { fresh, script } = await freshScript(orig);
    const emitMs = Date.now() - t0;
    expect(fresh.stats.lost).toBe(0);
    expect(script.stats.features).toBe(183);
    expect(script.stats.parts).toBe(27);
    expect(script.stats.components).toBe(70);
    expect(script.stats.matesText).toBe(53);
    // cíl: 100 % prvků vlastním příkazem
    expect(script.stats.dedicated).toBe(183);
    expect(docToScript(fresh.doc).text).toBe(script.text);
    // bez jádra se prvky s otisky zapíší i s nimi (obecný příkaz) – nic se nezahodí
    const pure = docToScript(orig);
    expect(pure.stats.features).toBe(183);
    expect(pure.stats.dedicated + pure.stats.generic + pure.stats.json).toBe(183);
    const r = await roundTripAssembly(orig, script);
    expect(r.parts).toBe(27);
    expect(r.features).toBe(183);
    expect(r.matesOk).toBe(53);
    expect(Math.abs(r.sumRtCm3 - 5241.734)).toBeLessThan(0.01);
    report.real = { emitMs, fresh: fresh.stats, stats: script.stats, pure: { dedicated: pure.stats.dedicated, generic: pure.stats.generic, json: pure.stats.json }, notes: script.notes.length, ...r };
  }, 1_800_000);
});

describe("tam a zpět: nálezy kontroly (vlastní malé díly, skutečné jádro)", () => {
  /** díl postavený textem ve zkušebním stroji (stejná cesta jako konzole) */
  async function build(text: string): Promise<CadDoc> {
    const b = await replay(text);
    expect(b.errors).toEqual([]);
    return JSON.parse(JSON.stringify(b.s.tabs[b.s.tabs.length - 1].doc)) as CadDoc;
  }
  it("odkazy na pomocnou rovinu / osu / bod uvnitř prvku: zrcadlení, rotace, vysunutí k rovině, kruhové pole, koule na bod", async () => {
    const orig = await build(`nový díl "Pomocné roviny a osy"
kvádr 60 40 20
prvek datum origin=30;20;30 normal=0;0;1 xDir=1;0;0 size=80 name="Rovina A"
prvek datumAxis def={"kind":"global","axis":"Z"} length=100 name="Osa A"
prvek datumPoint ref={"kind":"xyz","p":[30,20,40]} name="Bod A"
válec 10 8 v 50 20 20
zrcadlit rovina "Rovina A"
skica XZ
  obdélník 5 10 roh 40 20
rotovat 90 osa "Osa A"
skica XY odsazení 20
  kružnice 8 v 10 10
vysunout k rovině "Rovina A"
válec 4 12 v 10 30 20
pole kruhové 3 osa "Osa A" v 30 20 0
koule 8 na bod "Bod A"`);
    expect(orig.features.length).toBe(13);
    const script = docToScript(orig);
    // žádné původní id prvku ve skriptu – po přečtení mají prvky nová id
    for (const f of orig.features) expect(script.text, f.name).not.toContain(f.id);
    expect(script.notes).toEqual([]);
    expect(script.stats.json).toBe(0);
    const { s, errors } = await replay(script.text);
    expect(errors).toEqual([]);
    const rt = s.tabs[s.tabs.length - 1].doc;
    const p = await comparePart(orig, rt);
    expect(p.volume).toBeGreaterThan(60000);
    report.datumRefs = { stats: script.stats, volumeRel: p.volumeRel };
  }, 300_000);

  it("zastaralá čísla hran (prvek vložený před zaoblení): jádro čísla ověří, skript dá stejný objem", async () => {
    // zaoblení 4 svislých hran kvádru s otisky (jako v aplikaci), pak před něj vložený výřez – uložená čísla hran už neplatí
    const base = await build(`nový díl "Otisky hran"
kvádr 60 40 20
zaoblit 4 hrany svislé`);
    const stamped = await kernel.pickSigs({ ...base, features: base.features.slice(0, 1) }, base.features[1]);
    expect(Object.keys((stamped!.feature as unknown as { edgeSigs: object }).edgeSigs).length).toBe(4);
    const cutBox = (size: number[], position: number[]) => ({ id: "cut1", name: "Kvádr 2", type: "box", size, position, centered: false, mode: "cut" }) as unknown as Feature;
    const volumeOfScript = async (text: string) => {
      const r = await replay(text);
      expect(r.errors).toEqual([]);
      return { doc: r.s.tabs[r.s.tabs.length - 1].doc, volume: (await metrics(r.s.tabs[r.s.tabs.length - 1].doc))?.volume ?? 0 };
    };

    // A) kapsa uprostřed: všechny čtyři hrany existují dál, jen pod jinými čísly
    const moved: CadDoc = { ...base, features: [base.features[0], cutBox([10, 10, 30], [25, 15, -5]), stamped!.feature] };
    const m0 = (await metrics(moved))!.volume;
    const a = await freshScript(moved);
    expect(a.fresh.stats).toMatchObject({ checked: 1, renumbered: 1, lost: 0 });
    const line = /\nzaoblit 4 hrany((?: E\d+)+)\n/.exec(a.script.text);
    expect(line?.[1].trim()).not.toBe("E1 E3 E5 E7"); // uložená čísla
    expect(a.script.stats.generic + a.script.stats.json).toBe(0);
    await comparePart(moved, (await volumeOfScript(a.script.text)).doc);
    // bez jádra: otisky zůstanou (obecný příkaz) → také stejný díl
    const pure = docToScript(moved);
    expect(pure.stats.byType.fillet).toEqual({ dedicated: 0, generic: 1, json: 0 });
    await comparePart(moved, (await volumeOfScript(pure.text)).doc);
    // uložená čísla bez otisků (sigs: drop) dají jiný model – proto nejsou výchozí
    const dropped = docToScript(moved, { sigs: "drop" });
    expect(dropped.text).toContain("\nzaoblit 4 hrany E1 E3 E5 E7\n");
    expect(Math.abs((await volumeOfScript(dropped.text)).volume - m0)).toBeGreaterThan(1);
    expect(dropped.notes.join(" ")).toContain("mohou být zastaralá");

    // B) výřez rohu: jedna ze čtyř hran zanikla (aplikace u prvku hlásí ⚠) → prvek zůstane i s otisky, objem stejný
    const lost: CadDoc = { ...base, features: [base.features[0], cutBox([20, 20, 30], [-5, -5, -5]), stamped!.feature] };
    const b = await freshScript(lost);
    expect(b.fresh.stats).toMatchObject({ checked: 1, lost: 1 });
    expect(b.script.notes.join(" ")).toContain("Zaoblení 1");
    expect(b.script.stats.byType.fillet).toEqual({ dedicated: 0, generic: 1, json: 0 });
    await comparePart(lost, (await volumeOfScript(b.script.text)).doc);
    expect(Math.abs((await volumeOfScript(docToScript(lost, { sigs: "drop" }).text)).volume - (await metrics(lost))!.volume)).toBeGreaterThan(1);
    report.staleEdges = { movedVolume: m0, fresh: a.fresh.stats, lost: b.fresh.stats };
  }, 300_000);

  it("proměnné v obráceném pořadí, výraz s mezerami, potlačení, stejné názvy, konfigurace – úpravy míří na poslední prvek", async () => {
    const orig = await build(`nový díl "Parametry"
proměnná a = 10
proměnná b = 5
proměnná a = b*4
kvádr 100 50 12
upravit "Kvádr 1" size.2==a-8 size.1="=b + 45"
díra 6 skrz v 20 25 12
díra 8 skrz v 60 25 12
přejmenovat "Díra 2" na "Díra 1"
potlačit @3
díra 4 skrz v 80 25 12
konfigurace "Tenká" b=2 potlačit @4
konfigurace aktivní "Tenká"`);
    expect(orig.variables).toEqual([{ name: "a", expr: "b*4" }, { name: "b", expr: "5" }]);
    expect(orig.features.map((f) => f.name)).toEqual(["Kvádr 1", "Díra 1", "Díra 1", "Díra 3"]);
    const script = docToScript(orig);
    expect(script.notes).toEqual([]);
    const { s, errors } = await replay(script.text);
    expect(errors).toEqual([]);
    const rt = s.tabs[s.tabs.length - 1].doc;
    await comparePart(orig, rt);
    expect(rt.variables).toEqual(orig.variables);
    const pos = (d: CadDoc, id: string) => d.features.findIndex((f) => f.id === id);
    const binds = (d: CadDoc) => Object.entries(d.bindings ?? {}).map(([k, v]) => `${pos(d, k.slice(0, k.indexOf(":")))}:${k.slice(k.indexOf(":") + 1)}=${v}`).sort();
    expect(binds(rt)).toEqual(binds(orig));
    expect(binds(orig)).toEqual(["0:size.1=b + 45", "0:size.2=a-8"]);
    expect(rt.features.map((f) => !!f.suppressed)).toEqual(orig.features.map((f) => !!f.suppressed));
    const cfg = (d: CadDoc) => (d.configs ?? []).map((c) => [c.name, c.values, c.suppressed.map((id) => pos(d, id)), d.activeConfig === c.id]);
    expect(cfg(rt)).toEqual(cfg(orig));
    expect(cfg(orig)).toEqual([["Tenká", { b: 2 }, [3], true]]);
  }, 300_000);

  it("smazané vygenerované kóty: jádro určí jejich id, po přečtení na listu znovu chybí", async () => {
    const orig = await build(`nový díl "Kóty"
kvádr 120 80 20
díra 8 skrz v 20 20 20
díra 8 skrz v 100 60 20
výkres A3 pohledy přední,horní
kótovat chytře
výkres smazat a3 a8`);
    const sheet = orig.drawings![0];
    const off = (sheet.options as { smartOff?: string[] }).smartOff ?? [];
    expect(off.length).toBe(2);
    const { fresh, script } = await freshScript(orig, true);
    expect(fresh.deletedDims[sheet.id]).toEqual(["a3", "a8"]);
    expect(script.text).toContain("\nkótovat chytře\nvýkres smazat a3 a8\n");
    expect(script.notes.join(" ")).not.toContain("smazané vygenerované");
    const { s, errors } = await replay(script.text);
    expect(errors).toEqual([]);
    const rt = s.tabs[s.tabs.length - 1].doc;
    const key = (k: string) => k.replace(/^hole:.*/, "hole");
    expect(rt.drawings![0].annotations.map((a) => `${a.type}:${key(a.auto ?? "")}`)).toEqual(sheet.annotations.map((a) => `${a.type}:${key(a.auto ?? "")}`));
    expect(((rt.drawings![0].options as { smartOff?: string[] }).smartOff ?? []).map(key)).toEqual(off.map(key));
    // bez jádra: upozornění, že se smazané kóty vrátí
    expect(docToScript(orig).notes.join(" ")).toContain("smazané vygenerované kóty výkresů (2 na 1 listech)");
  }, 600_000);
});

describe("zpráva", () => {
  it("zapíše změřená čísla (jen s DOC2TEXT_REPORT)", () => {
    if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
    expect(true).toBe(true);
  });
});
