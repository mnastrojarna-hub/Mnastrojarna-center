/**
 * Vlna 22, balík D (etapa D1, body 22g a 19) – „žádné falešné zelené“: každý úspěšný / klidný text kusovníku se nesmí
 * vypsat, když kontrola neproběhla, proběhla nad jiným stavem nebo nevyšla. Náhradní jádro (geometrie nerozhoduje).
 *
 * Inventář a podmínka, za které smějí být vidět:
 *  1. `✓ komponenta „X“ už odpovídá dílu v záložce`  – jen když díl JE otevřený a kopie se od něj neliší
 *  2. `✓ komponenta „X“ obnovena z dílu (…)`          – jen když se kopie opravdu převzala z dílu záložky
 *  3. kusovník bez ⚠ asm.stale-copy                   – jen když žádná kopie není starší než díl v záložce
 *  4. kusovník bez ⚠ bom.make-incomplete             – jen když vyráběné díly mají číslo i označení materiálu
 *  5. ℹ `bom.docs` „vyráběné N“ bez „(bez výkresu …)“ – jen když všechny vyráběné díly mají výkres
 *  6. `✓ druh dílu …`                                  – jen po přečteném druhu (neznámé slovo = ✗, druh se nezmění)
 *  Etapa D2 (bod 20 – výkresy a výstupy):
 *  7. `✓ list „X“ vydán jako rev. A …`                 – jen když se vydání opravdu zapsalo (opakování beze změny = „→ … beze změny“)
 *  8. „Vydání: … – odpovídá modelu“ / „Výkres: … odpovídá modelu“ – jen pro revizi modelu, ze které byl list vydán
 *  9. „Zastaralé výstupy: žádné“                       – jen když žádný vydaný list ani export neodpovídá starší revizi
 *  Etapa D3 (bod 18 – kontrola kót pro výrobu, čisté funkce cad/dim-complete.ts):
 * 10. „Kontrola kót: všech N očekávaných rozměrů je na listu“ – už nikdy; ani úplná kontrola neříká „všech“ / „kompletní“
 * 11. bez ⚠ drawing.dims-incomplete jen když na listu nechybí ani POLOHA prvku (dřív stačily velikosti)
 * 12. „funkční prvky: tolerance n/n“ – jen s vyznačenými funkčními prvky a předepsanou tolerancí na kótě; jinak „neověřeny“
 * 13. poloha „✓“ nikdy u kót zapečených v pohledu (nezkontrolováno)
 *  Etapa D4 (body 17 a 22j – čitelný výkres sestavy, šablona hlavičky):
 * 14. „Překryvy na listu: 0 (zkontrolováno …)“ / řádek D `overlaps=0` – jen po kontrole nad tímto listem; bez ní
 *     „nezkontrolováno“ a v řádku D pole chybí; s překryvem nikdy 0
 * 15. „nevešlo se 0“ u pozic – jen když se všechny pozice vešly (lost = 0); `✓ pozice … zamčeny` jen s uloženým zámkem
 * 16. `✓ razítko podle šablony hlavičky` – jen když šablona existuje (jinak ✗ s přehledem); logo názvem souboru jen
 *     s nalezeným souborem (jinak ✗ „soubor není připojený“)
 *  (GUI: panel komponenty bez žlutého „Kopie je starší než díl“ a Kusovník bez upozornění – stejné funkce asm-refresh.ts /
 *  bom-model.ts, scénář e2e/cad-w22-d.e2e.cjs.)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { partComponent, screwISO4762 } from "../assembly";
import { asmDocNotes } from "../engine/files";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import type { RunReport } from "../engine/protocol-types";
import { runScript } from "../engine/run";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type DrawingAnnotation, type Feature, type FunctionalMark } from "../types";
import { checkSheet, dimCheckLine, type CheckView } from "../dim-complete";
import { dimCheckIssues } from "../drawing-dimcheck";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 20000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async () => Object.assign([], { stats: { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 } }),
  clashDetail: async () => [],
  stepSplit: async () => null,
} as unknown as KernelApi;
const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
const run = (ws: MemoryWorkspace, t: string) => runScript(ws, t, host());
const txt = (r: RunReport) => formatConsole(r);
const has = (r: RunReport, code: string) => r.entries.some((e) => e.code === code);

describe("greens D1 – kusovník a kopie dílu", () => {
  it("1+2: „už odpovídá dílu“ ani „obnovena“ se nevypíše, když díl není otevřený (zavřená záložka) – jen ℹ se důvodem", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws, 'zavřít záložku "Deska A"');
    const r = await run(ws, 'sestava obnovit "Deska A"');
    expect(txt(r)).not.toMatch(/už odpovídá dílu/);
    expect(txt(r)).not.toMatch(/obnovena z dílu/);
    expect(txt(r)).toMatch(/„Deska A“ se neobnovuje: díl „Deska A“ není otevřený v záložce/);
  });

  it("1: „už odpovídá dílu“ se nevypíše, když se díl od vložení změnil – místo toho obnova s výčtem polí", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"');
    const r = await run(ws, 'sestava obnovit "Deska A"');
    expect(txt(r)).not.toMatch(/už odpovídá dílu/);
    expect(txt(r)).toMatch(/✓ komponenta „Deska A“ obnovena z dílu \(materiál\)/);
  });

  it("3: kusovník nad zastaralou kopií nikdy bez ⚠ asm.stale-copy (dřív tiché prázdné číslo a „Ocel“)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit');
    const clean = await run(ws, "kusovník");
    expect(has(clean, "asm.stale-copy")).toBe(false); // díl se nezměnil → nic se nehlásí (a nic se netvrdí navíc)
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"');
    const r = await run(ws, "kusovník");
    expect(has(r, "asm.stale-copy")).toBe(true);
  });

  it("4: kusovník bez ⚠ bom.make-incomplete jen s číslem a označením materiálu vyráběného dílu", async () => {
    const ws = new MemoryWorkspace();
    const bad = await run(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nkusovník');
    expect(bad.entries.filter((e) => e.code === "bom.make-incomplete").length).toBe(2); // bez čísla, bez označení
    const ws2 = new MemoryWorkspace();
    // normálie a nakupovaný díl se nehodnotí – samotné nevyvolají ⚠
    const ok = await run(ws2, 'nový díl "Pouzdro"\nválec 10 20\ndruh nakupovaný katalog "K-1"\nnová sestava "Nástroj"\nvložit "Pouzdro"\nnormálie M8x20\nkusovník');
    expect(has(ok, "bom.make-incomplete")).toBe(false);
  });

  it("5: souhrn dokumentace neříká „vyráběné 1“ bez dovětku, když vyráběnému dílu výkres chybí", () => {
    const plate: CadDoc = { ...emptyDoc("Deska A"), kind: "part", props: { number: "DA-001" } };
    const asm: CadDoc = { ...emptyDoc("Nástroj"), kind: "assembly", components: [partComponent(plate), partComponent(screwISO4762("M8", 20))] };
    const n = asmDocNotes(asm);
    expect(n[0].args).toEqual(["vyráběné 1 (bez výkresu 1), normálie 1, nakupované 0"]);
    expect(n.some((x) => x.code === "bom.make-incomplete")).toBe(true);
    const withSheet: CadDoc = { ...asm, components: [partComponent({ ...plate, drawings: [{ id: "s", name: "List 1" } as never] }), partComponent(screwISO4762("M8", 20))] };
    expect(asmDocNotes(withSheet)).toEqual([{ code: "bom.docs", args: ["vyráběné 1, normálie 1, nakupované 0"] }]);
  });

  it("6: „✓ druh dílu“ jen po přečteném druhu – neznámé slovo = ✗ a dokument beze změny", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'nový díl "Pouzdro"\nválec 10 20\ndruh levný');
    expect(txt(r)).not.toMatch(/✓ druh dílu/);
    expect(txt(r)).toMatch(/druh: čekám vyráběný \| normálie \| nakupovaný \| auto, ne „levný“/);
    expect(ws.present().supply).toBeUndefined();
  });
});

describe("greens D2 – vydání listu a zastaralé výstupy (bod 20)", async () => {
  // Skutečné jádro: list se po příkazech výkresu vyhodnotí (vlna 22, 22i – „→ … výsledek po vyhodnocení listu níže“, pak ✓ / ✗
  // listu). Falešné jádro výkres neumí – běh by skončil ✗ a „greens“ by tvrdil úspěch nad nevyhodnoceným listem.
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const real = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await real.init();
  const run = (ws: MemoryWorkspace, t: string) => runScript(ws, t, { kernel: real as unknown as KernelApi, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const clean = (r: RunReport) => expect(r.entries.filter((e) => e.level === "error").map((e) => `L${e.line} ${e.code}: ${e.text}`)).toEqual([]);
  const PART = 'nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4';
  it("7: opakované vydání téhož listu z téhož modelu není nové vydání", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await run(ws, `${PART}\nvýkres vydat`);
    clean(r1);
    // vydání je příkaz výkresu: přijato (→), list se pak vyhodnotí (✓ listu) – 22i
    expect(txt(r1)).toMatch(/→ list „List 1“ vydán jako rev\. A z modelu r·[0-9a-f]{6} .* – výsledek po vyhodnocení listu níže/);
    expect(txt(r1)).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    const r2 = await run(ws, 'záložka "Deska A"\nvýkres vydat A');
    clean(r2);
    expect(txt(r2)).not.toMatch(/[✓→] list „List 1“ vydán/);
    expect(txt(r2)).toMatch(/list „List 1“ už je vydán jako rev\. A z modelu r·\w{6} – beze změny/);
  });

  it("8 + 9: po změně modelu ani stav, ani výstupy netvrdí „odpovídá modelu“ / „žádné“ – ⚠ drawing.stale", async () => {
    const ws = new MemoryWorkspace();
    clean(await run(ws, `${PART}\nvýkres vydat`));
    const r = await run(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10\nstav\nvýstupy zastaralé');
    clean(r);
    const t = txt(r);
    expect(t).not.toMatch(/– odpovídá modelu/);
    expect(t).not.toMatch(/Zastaralé výstupy: žádné/);
    expect(t).toMatch(/Zastaralé výstupy \(1\)/);
    expect(has(r, "drawing.stale")).toBe(true);
  });

  it("9: „Zastaralé výstupy: žádné“ jen bez změny modelu po vydání", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, `${PART}\nvýkres vydat\nvýstupy zastaralé`);
    clean(r);
    expect(txt(r)).toMatch(/Zastaralé výstupy: žádné/);
    expect(has(r, "drawing.stale")).toBe(false);
  });
});

// ───────────────────────── D3 (bod 18): kontrola kót – čisté funkce, ručně složené pohledy a kóty ─────────────────────────
describe("greens D3 – kontrola kót pro výrobu (bod 18)", () => {
  const TOP: CheckView = { key: "top", x0: 0, y0: -60, w: 100, h: 60, cam: { d: [0, 0, 1], x: [1, 0, 0] } };
  const FRONT: CheckView = { key: "front", x0: 0, y0: -20, w: 100, h: 20, cam: { d: [0, -1, 0], x: [1, 0, 0] } };
  let k = 0;
  const F = (f: Record<string, unknown>) => ({ id: `g${++k}`, ...f }) as unknown as Feature;
  const dim = (view: string, kind: "horizontal" | "vertical", a: [number, number], b: [number, number], suffix?: string): DrawingAnnotation => ({ id: `d${++k}`, view, type: "dim", kind, a, b, offset: 10, ...(suffix ? { suffix } : {}) });
  const plate = (): CadDoc => ({
    ...emptyDoc("Deska A"),
    features: [F({ name: "Kvádr 1", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" }), F({ name: "Díra 1", type: "hole", position: [15, 15, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 })],
  });
  const sizes = (): DrawingAnnotation[] => [dim("top", "horizontal", [0, 0], [100, 0]), dim("top", "vertical", [0, 0], [0, -60]), dim("front", "vertical", [0, 0], [0, -20]), { id: "c1", view: "top", type: "dim", kind: "diameter", c: [15, -15], r: 4, ang: 45, offset: 8 }];
  const positions = (sx?: string): DrawingAnnotation[] => [dim("top", "horizontal", [0, -5], [15, -5], sx), dim("top", "vertical", [-5, 0], [-5, -15], sx)];

  it("10: ani úplná kontrola neříká „všech“ ani „kompletní“ – jen co zkontrolovala", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckLine(r)).toMatch(/^Kontrola kót: velikosti 4\/4 · polohy 2\/2 · tolerance neověřeny \(funkční prvky nevyznačeny\)$/);
    expect(dimCheckLine(r)).not.toMatch(/všech|kompletní/);
  });
  it("11: všechny velikosti na listu, ale bez polohy díry → ⚠ drawing.dims-incomplete (dřív „všech … je na listu“)", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: sizes(), dimensions: "smart" });
    expect(r.size).toEqual({ ok: 4, total: 4 });
    expect(dimCheckIssues(r).map((i) => i.code)).toEqual(["drawing.dims-incomplete"]);
    const ok = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckIssues(ok)).toEqual([]);
  });
  it("12: tolerance funkčních prvků „n/n“ jen s tolerancí na kótě (velikost = předepsaná H7); bez vyznačení „neověřeny“", () => {
    const d = plate();
    const marks: FunctionalMark[] = [{ id: "f1", kind: "functional", feature: d.features[1].id, tol: "H7" }];
    const diaT = (sx: string): DrawingAnnotation => ({ id: "c2", view: "top", type: "dim", kind: "diameter", c: [15, -15], r: 4, ang: 45, offset: 8, suffix: sx });
    const none = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes(), ...positions()], dimensions: "smart" });
    expect(dimCheckLine(none)).toMatch(/funkční prvky: tolerance 0\/3/);
    // jiná tolerance průměru než předepsaná H7 → průměr nesplněný („liší se“), polohy s tolerancí ano
    const wrong = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H9"), ...positions("±0,02")], dimensions: "smart" });
    expect(dimCheckLine(wrong)).toMatch(/funkční prvky: tolerance 2\/3/);
    const right = checkSheet({ doc: { ...d, functional: marks }, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H7"), ...positions("±0,02")], dimensions: "smart" });
    expect(dimCheckLine(right)).toMatch(/funkční prvky: tolerance 3\/3/);
    expect(dimCheckLine(checkSheet({ doc: d, views: [FRONT, TOP], annotations: [...sizes().slice(0, 3), diaT("H7"), ...positions("±0,02")], dimensions: "smart" }))).toContain("tolerance neověřeny");
  });
  it("13: kóty zapečené v pohledu – poloha nikdy ✓, jen nezkontrolováno", () => {
    const r = checkSheet({ doc: plate(), views: [FRONT, TOP], annotations: [], dimensions: "overall", texts: [{ s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }] });
    expect(r.items.filter((q) => q.kind === "pos").map((q) => q.status)).toEqual(["unchecked", "unchecked"]);
    expect(dimCheckLine(r)).toContain("polohy nezkontrolovány");
  });
});

describe("greens D4 – čitelný výkres sestavy a šablony hlavičky (body 17, 22j)", async () => {
  const { positionLines } = await import("../drawing-pos-agent");
  const { overlapIssueText, sheetOverlaps } = await import("../drawing-overlaps");
  const { docLine } = await import("../engine/protocol");
  const { applyDrawingCmd } = await import("../drawing-agent");
  const { parseAgentText } = await import("../agent");
  const sheet = (extra: Partial<import("../drawing").DrawingResult> = {}) =>
    ({ sheet: { name: "A3", w: 420, h: 297 }, views: [], scale: "1:1", scaleValue: 1, polys: [], texts: [], svg: "", dxf: "", warnings: [], tables: [], frameRect: { x: 20, y: 10, w: 390, h: 277 }, ...extra }) as import("../drawing").DrawingResult;

  it("14: bez kontroly „nezkontrolováno“ (nikdy 0); s překryvem nikdy 0; řádek D overlaps jen se zjištěnou hodnotou", () => {
    expect(positionLines(sheet(), {}, null).join("\n")).toMatch(/Překryvy na listu: nezkontrolováno/);
    const clash = sheet({ balloons: [{ pos: 1, x: 50, y: 50, a: [60, 60], r: 4 }, { pos: 2, x: 52, y: 51, a: [70, 60], r: 4 }] });
    const ov = sheetOverlaps(clash);
    expect(ov.total).toBeGreaterThan(0);
    const txt = positionLines(clash, {}, ov).join("\n");
    expect(txt).not.toMatch(/Překryvy na listu: 0/);
    expect(overlapIssueText(ov)).toMatch(/překryvů/);
    expect(docLine({ ref: "a", name: "a", kind: "assembly", sheets: 1 })).not.toMatch(/overlaps=/);
  });

  it("15: „nevešlo se 0“ jen bez ztracených pozic; zámek jen s uloženou polohou", () => {
    const lost = sheet({ balloons: [{ pos: 1, x: 50, y: 50, a: [60, 60], r: 4, lost: true }], balloonInfo: { lost: 1, crossings: 0, missingView: [] } });
    expect(positionLines(lost, {}, sheetOverlaps(lost)).join("\n")).toMatch(/nevešlo se 1/);
  });

  it("16: šablona hlavičky, která neexistuje, = ✗ (ne ✓); logo neexistujícího souboru = ✗", async () => {
    const doc = { id: "d", name: "Deska", kind: "part", features: [], material: "ocel" } as unknown as CadDoc;
    const cmd = (l: string) => (parseAgentText(l).ops[0] as unknown as { cmd: never }).cmd;
    const no = async () => {
      throw new Error("bez výpočtu");
    };
    await expect(applyDrawingCmd(doc, cmd('výkres hlavička použít "Nikde"'), no)).rejects.toThrow(/neexistuje/);
    await expect(applyDrawingCmd(doc, cmd('výkres razítko logo="nikde.png"'), no, { input: async () => null })).rejects.toThrow(/není připojený/);
  });
});
