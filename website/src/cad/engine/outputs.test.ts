/**
 * Výstupy textem bez jádra (balík B3): zápis nových voleb (`výkres export … dokument`, `… base64`, `sdílet úložiště nebo
 * odkaz`), pevný čas v hlavičce STEP, listy dokumentu včetně výkresů dílů z komponent (každý díl jednou), kontrola
 * exportu s pamětí, sdílení – úložiště nedostupné / odmítnuté / dlouhý odkaz – a stručný protokol (řádek O vždy,
 * souhrnný řádek F místo mnoha souborů).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgentText } from "../agent";
import type { OutCmd } from "../agent-out";
import { setLang } from "../i18n";
import { emptyDraftDoc } from "../draft/doc";
import { resetShareProbe, setUploadTimeoutBase } from "../share";
import { emptyDoc, type AsmComponent, type CadDoc, type DrawingDoc } from "../types";
import { assertDrawable, documentSheetJobs, hasDrawings, isEmptyDoc, OUT_BASE64_MAX, projectFile, resetExportChecks, sheetScope, stableStep, STEP_STABLE_TIME, verifyExport } from "./files";
import { filesSummaryLine, formatShort, GRAMMAR, ReportBuilder, shortProtocol } from "./protocol";
import type { OutFile } from "./protocol-types";
import { LINK_BROWSER_MAX, shareWithPolicy, type ShareNote } from "./share-out";

afterEach(() => {
  setLang("cs");
  vi.unstubAllGlobals();
  resetShareProbe();
  setUploadTimeoutBase(20_000);
});

const cmdOf = (text: string): OutCmd => {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  expect(p.ops).toHaveLength(1);
  const op = p.ops[0];
  if (op.k !== "out") throw new Error(`není výstup: ${op.k}`);
  return op.cmd;
};

describe("zápis výstupů (B3)", () => {
  it("výkres export … dokument (CS/EN/DE) = všechny listy dokumentu; vše a list beze změny", () => {
    expect(cmdOf("výkres export pdf dokument")).toEqual({ kind: "drawing", format: "pdf", sheet: "doc" });
    expect(cmdOf("drawing export pdf document")).toEqual({ kind: "drawing", format: "pdf", sheet: "doc" });
    expect(cmdOf("zeichnung export pdf dokument")).toEqual({ kind: "drawing", format: "pdf", sheet: "doc" });
    expect(cmdOf('výkres export dxf dokument "Sada"')).toEqual({ kind: "drawing", format: "dxf", sheet: "doc", name: "Sada" });
    expect(cmdOf("výkres export pdf vše")).toEqual({ kind: "drawing", format: "pdf", sheet: "all" });
    expect(cmdOf("výkres export pdf jako dokument")).toEqual({ kind: "drawing", format: "pdf", name: "dokument" });
  });

  it("… base64 na konci (uložit, export, výkres export, skica export); „jako base64“ je název souboru", () => {
    expect(cmdOf("uložit base64")).toEqual({ kind: "save", deliver: "base64" });
    expect(cmdOf('uložit "Deska A" base64')).toEqual({ kind: "save", name: "Deska A", deliver: "base64" });
    expect(cmdOf("uložit jako base64")).toEqual({ kind: "save", name: "base64" });
    expect(cmdOf("export step base64")).toEqual({ kind: "export", format: "step", deliver: "base64" });
    expect(cmdOf("export step bez kontroly base64")).toEqual({ kind: "export", format: "step", check: false, deliver: "base64" });
    expect(cmdOf("export step base64 bez kontroly")).toEqual({ kind: "export", format: "step", check: false, deliver: "base64" });
    expect(cmdOf("výkres export pdf vše base64")).toEqual({ kind: "drawing", format: "pdf", sheet: "all", deliver: "base64" });
    expect(cmdOf('skica export dxf "Skica 1" base64')).toEqual({ kind: "sketch", sketch: "Skica 1", deliver: "base64" });
  });

  it("… odkaz na konci (EN/DE link) = soubor v úložišti odkazů; „jako odkaz“ je název souboru", () => {
    expect(cmdOf("export step odkaz")).toEqual({ kind: "export", format: "step", deliver: "link" });
    expect(cmdOf("exportieren step link")).toEqual({ kind: "export", format: "step", deliver: "link" });
    expect(cmdOf("uložit odkaz")).toEqual({ kind: "save", deliver: "link" });
    expect(cmdOf("uložit jako odkaz")).toEqual({ kind: "save", name: "odkaz" });
    expect(cmdOf("výkres export pdf dokument odkaz")).toEqual({ kind: "drawing", format: "pdf", sheet: "doc", deliver: "link" });
    expect(cmdOf("odkaz")).toEqual({ kind: "link" }); // samotný příkaz beze změny
  });

  it("regrese: název v uvozovkách je vždy název souboru – „base64“ / „odkaz“ / „link“ v uvozovkách není doručení", () => {
    expect(cmdOf('uložit "base64"')).toEqual({ kind: "save", name: "base64" });
    expect(cmdOf("uložit „odkaz“")).toEqual({ kind: "save", name: "odkaz" });
    expect(cmdOf('save "link"')).toEqual({ kind: "save", name: "link" });
    expect(cmdOf('export step "odkaz"')).toEqual({ kind: "export", format: "step", name: "odkaz" });
    expect(cmdOf('export step jako "base64"')).toEqual({ kind: "export", format: "step", name: "base64" });
    expect(cmdOf('export step "bez kontroly"')).toEqual({ kind: "export", format: "step", name: "bez kontroly" });
    expect(cmdOf('export step "odkaz" bez kontroly')).toEqual({ kind: "export", format: "step", name: "odkaz", check: false });
    expect(cmdOf('výkres export pdf "odkaz"')).toEqual({ kind: "drawing", format: "pdf", name: "odkaz" });
    expect(cmdOf('výkres export pdf "dokument"')).toEqual({ kind: "drawing", format: "pdf", name: "dokument" });
    expect(cmdOf('skica export dxf "Skica 1" jako "base64"')).toEqual({ kind: "sketch", sketch: "Skica 1", name: "base64" });
    // bez uvozovek dál doručení, i za názvem v uvozovkách
    expect(cmdOf('export step "Deska A" base64')).toEqual({ kind: "export", format: "step", name: "Deska A", deliver: "base64" });
    expect(cmdOf('uložit "Deska" odkaz')).toEqual({ kind: "save", name: "Deska", deliver: "link" });
  });

  it("sdílet úložiště [nebo odkaz] (CS/EN/DE)", () => {
    expect(cmdOf("sdílet úložiště")).toEqual({ kind: "share", mode: "store" });
    expect(cmdOf("sdílet úložiště nebo odkaz")).toEqual({ kind: "share", mode: "store", orLink: true });
    expect(cmdOf("share store or link")).toEqual({ kind: "share", mode: "store", orLink: true });
    expect(cmdOf("freigeben speicher oder link 7 tage")).toEqual({ kind: "share", mode: "store", orLink: true, days: 7 });
    expect(cmdOf("sdílet odkazem nebo odkaz")).toEqual({ kind: "share", mode: "link" });
  });
});

describe("STEP se stejnými bajty (pevný čas v hlavičce)", () => {
  const step = (t: string, n = 1) => new TextEncoder().encode(`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\nFILE_NAME('Open CASCADE Shape Model','${t}',('Author'),(\n    'Open CASCADE'),'Open CASCADE STEP processor 7.8','Open CASCADE 7.8'\n  ,'Unknown');\nENDSEC;\nDATA;\n#7 = PRODUCT('Open CASCADE STEP translator 8.0 ${n}',\n  'Open CASCADE STEP translator 8.0 ${n}','',(#8));\nENDSEC;\nEND-ISO-10303-21;\n`);
  const dec = (u: Uint8Array) => new TextDecoder().decode(u);
  it("čas exportu → STEP_STABLE_TIME, pořadí exportu v názvu produktu → 1; dva exporty = stejné bajty; zbytek beze změny", () => {
    const a = stableStep(step("2026-11-14T10:22:33"));
    const b = stableStep(step("2026-11-15T23:59:01+01:00", 7)); // 7. export v témže procesu
    expect(dec(b)).toContain("PRODUCT('Open CASCADE STEP translator 8.0 1',\n  'Open CASCADE STEP translator 8.0 1'");
    expect(dec(a)).toContain(`FILE_NAME('Open CASCADE Shape Model','${STEP_STABLE_TIME}',`);
    expect(a).toEqual(b);
    expect(dec(a).replace(STEP_STABLE_TIME, "X")).toBe(dec(step("X")));
    expect(stableStep(a)).toBe(a); // už stabilní → stejný objekt
    const other = new TextEncoder().encode("solid x\nendsolid x\n");
    expect(stableStep(other)).toBe(other);
  });
});

const sheet = (name: string, drawing?: string): DrawingDoc => ({ id: `s-${name}-${drawing ?? ""}`, name, options: {}, meta: {}, annotations: [], ...(drawing ? { drawing } : {}) }) as unknown as DrawingDoc;
const part = (name: string, x: number, drawings: DrawingDoc[] = []): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [x, 10, 10], origin: [0, 0, 0] } as never], ...(drawings.length ? { drawings } : {}) });
const comp = (id: string, doc: CadDoc): AsmComponent => ({ id, name: doc.name, source: { kind: "part", doc }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;

describe("listy dokumentu (`výkres export pdf dokument`, `--formats auto`)", () => {
  it("vlastní listy všech výkresů + výkresy dílů z komponent, každý zdrojový díl jednou, i v podsestavě", () => {
    const deska = part("Deska", 80, [sheet("List 1")]);
    const cep = part("Čep", 10, [sheet("List 1"), sheet("Detail")]);
    const bez = part("Podložka", 5);
    const sub: CadDoc = { ...emptyDoc("Pod"), kind: "assembly", features: [], components: [comp("p1", deska), comp("p2", part("Kolík", 3, [sheet("List 1")]))] };
    const asm: CadDoc = {
      ...emptyDoc("Sestava"),
      kind: "assembly",
      features: [],
      drawings: [sheet("List 1"), sheet("List 1", "Montáž")],
      components: [comp("c1", deska), comp("c2", JSON.parse(JSON.stringify(deska))), comp("c3", cep), comp("c4", bez), comp("c5", JSON.parse(JSON.stringify(cep))), { id: "c6", name: "Pod", source: { kind: "asm", doc: sub }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } } as AsmComponent],
    };
    const jobs = documentSheetJobs(asm);
    expect(jobs.map((j) => `${j.doc.name}#${j.index}:${j.label}`)).toEqual(["Sestava#0:Sestava: List 1", "Sestava#1:Sestava: List 1", "Deska#0:Deska", "Čep#0:Čep: List 1", "Čep#1:Čep: Detail", "Kolík#0:Kolík"]);
    expect(hasDrawings(asm)).toBe(true);
    expect(hasDrawings({ ...asm, drawings: [], components: [comp("c4", bez)] })).toBe(false);
    expect(hasDrawings({ ...asm, drawings: [], components: [comp("c1", deska)] })).toBe(true);
    expect(documentSheetJobs(deska).map((j) => j.label)).toEqual(["Deska"]);
  });

  it("projekt .mncad: zpětné čtení a počet prvků / komponent", () => {
    const p = projectFile(part("Deska", 80), "Deska.mncad");
    expect(p).toMatchObject({ name: "Deska.mncad", format: "mncad", count: 1, asm: false, docName: "Deska", lost: [] });
    expect(JSON.parse(new TextDecoder().decode(p.data)).features).toHaveLength(1);
  });
});

describe("regrese: 2D výkres a rozsah „vše“", () => {
  it("2D výkres s entitami není prázdný (sdílet jako --share a tlačítko Sdílet); výkres export → důvod, ne „model je prázdný“", () => {
    const draft = emptyDraftDoc("Plech");
    expect(isEmptyDoc(draft)).toBe(true);
    const line = { id: "e1", kind: "line", layer: "0", a: [0, 0], b: [100, 0] };
    const withLine: CadDoc = { ...draft, draft: { ...draft.draft!, entities: [line as never] } };
    expect(isEmptyDoc(withLine)).toBe(false);
    expect(() => assertDrawable(withLine)).toThrow(/„Plech“ je 2D výkres – exportuje se příkazem „2d export dxf“/);
    expect(() => assertDrawable(emptyDoc("Nic"))).toThrow(/model je prázdný/);
    expect(() => assertDrawable(part("Deska", 80))).not.toThrow();
  });

  it("„vše“ u sestavy s výkresy dílů v komponentách = všechny listy dokumentu; u dílu a sestavy bez výkresů dílů beze změny", () => {
    const deska = part("Deska", 80, [sheet("List 1")]);
    const asm: CadDoc = { ...emptyDoc("Uložení"), kind: "assembly", features: [], drawings: [sheet("List 1")], components: [comp("c1", deska), comp("c2", part("Čep", 10, [sheet("List 1")]))] };
    expect(sheetScope(asm, "all")).toBe("doc");
    expect(sheetScope(asm, 1)).toBe(1);
    expect(sheetScope(asm, undefined)).toBeUndefined();
    expect(sheetScope(deska, "all")).toBe("all");
    expect(sheetScope({ ...asm, components: [comp("c3", part("Podložka", 5))] }, "all")).toBe("all");
  });
});

describe("kontrola exportu (kernel.exportStats)", () => {
  const box = { solids: 1, volume: 6000, bbox: [[0, 0, 0], [30, 20, 10]] as [[number, number, number], [number, number, number]] };
  beforeEach(() => resetExportChecks());
  it("věrná kopie; opakovaný export nezměněného modelu z paměti; změna modelu / jiný formát = nová kontrola; neúspěch se nepamatuje", async () => {
    const exportStats = vi.fn(async () => ({ model: box, file: { ...box, volume: 6000.000001 } }));
    const k = { exportStats };
    const d = part("Deska", 30);
    const a = await verifyExport(k as never, d, new Uint8Array(1), "step");
    expect(a.ok).toBe(true);
    expect(a.line).toMatch(/^✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 6[\s ]000 mm³/);
    const b = await verifyExport(k as never, { ...d, name: "Jiný název" }, new Uint8Array(2), "step");
    expect(b.line).toMatch(/\(model od minulé kontroly beze změny\)$/);
    expect(exportStats).toHaveBeenCalledTimes(1);
    // záznam exportu v dokumentu (vlna 22 D2 – `outputs` se mění po každém exportu) model nemění → stále z paměti
    const rec = await verifyExport(k as never, { ...d, outputs: [{ format: "step", file: "Deska.step", modelRev: "r·000000", sig: "x", at: "2026-11-20T10:00:00Z" }] } as never, new Uint8Array(3), "step");
    expect(rec.line).toMatch(/\(model od minulé kontroly beze změny\)$/);
    expect(exportStats).toHaveBeenCalledTimes(1);
    await verifyExport(k as never, part("Deska", 31), new Uint8Array(1), "step");
    await verifyExport(k as never, d, new Uint8Array(1), "brep");
    expect(exportStats).toHaveBeenCalledTimes(3);
    const bad = vi.fn(async () => ({ model: box, file: { ...box, volume: 5000 } }));
    const c = await verifyExport({ exportStats: bad } as never, part("Jiná", 40), new Uint8Array(1), "step");
    expect(c.ok).toBe(false);
    expect(c.line).toMatch(/^⚠ kontrola STEP: soubor se od modelu liší – objem/);
    await verifyExport({ exportStats: bad } as never, part("Jiná", 40), new Uint8Array(1), "step");
    expect(bad).toHaveBeenCalledTimes(2);
    const thrown = await verifyExport({ exportStats: async () => Promise.reject(new Error("Failed to load STEP file")) } as never, part("X", 41), new Uint8Array(1), "step");
    expect(thrown.ok).toBe(false);
    expect(Number.isNaN(thrown.volumeDiffPct)).toBe(true);
    expect(thrown.line).toMatch(/^✗ kontrola STEP: soubor se nepodařilo znovu načíst – Failed to load STEP file/);
  });
});

/* ───────────────────────── sdílení bez sítě (fetch zastoupený) ───────────────────────── */

type Call = { url: string; method: string };
function fakeStore(o: { ping?: boolean; post?: number | "hang" }) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("?ping")) {
      if (!o.ping) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ ok: true, v: 1, max_bytes: 26_214_400, chunk_bytes: 8_388_608, max_days: 90 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // úložiště odpoví na ?ping, ale nahrávání nikdy nedokončí (zastaví jen signál časového limitu)
    if (method === "POST" && o.post === "hang") return new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
    if (method === "POST") {
      if (typeof o.post === "number" && o.post !== 200) return new Response(JSON.stringify({ error: "origin" }), { status: o.post, headers: { "content-type": "application/json" } });
      const total = Number(new URL(url).searchParams.get("total"));
      return new Response(JSON.stringify({ id: "Ab3kZ9xQ2m", del: "tok", exp: Math.round(Date.now() / 1000) + 864000, size: total }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", f);
  return calls;
}
const STORE = "http://127.0.0.1:9/cad/share/";
const BASE = "https://example.test/cad";

describe("sdílení – cesta podle volby (engine/share-out.ts)", () => {
  const notes: ShareNote[] = [];
  const note = (n: ShareNote) => notes.push(n);
  beforeEach(() => void (notes.length = 0));
  const d = part("Deska", 80);

  it("úložiště: krátký odkaz mode=self, bez hlášek", async () => {
    fakeStore({ ping: true });
    const r = await shareWithPolicy(d, { days: 10, view: "model", want: "store", base: BASE, store: STORE }, note);
    expect(r).toMatchObject({ mode: "self" });
    expect(r!.url).toMatch(/^https:\/\/example\.test\/cad#q=Ab3kZ9xQ2m\.[A-Za-z0-9_-]{22}$/);
    expect(r!.url.length).toBeLessThanOrEqual(200);
    expect(notes).toEqual([]);
  });

  it("„sdílet úložiště“ bez dostupného úložiště: ✗ share.store-unavailable, žádný dlouhý odkaz; „nebo odkaz“ → dlouhý odkaz + ⚠", async () => {
    const calls = fakeStore({ ping: false });
    expect(await shareWithPolicy(d, { days: 10, view: "model", want: "store", base: BASE, store: STORE }, note)).toBeNull();
    expect(notes.map((n) => n.code)).toEqual(["share.store-unavailable"]);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    notes.length = 0;
    resetShareProbe();
    const r = await shareWithPolicy(d, { days: 10, view: "model", want: "store", orLink: true, base: BASE, store: STORE }, note);
    expect(r?.mode).toBe("link");
    expect(r?.url).toMatch(/^https:\/\/example\.test\/cad#s=1[dr]\./);
    expect(notes.map((n) => n.code)).toEqual(["share.fallback-link"]);
    expect(notes[0].text).toMatch(new RegExp(`dlouhý odkaz \\(${r!.url.length} znaků\\): úložiště krátkých odkazů neodpovídá`));
  });

  it("úložiště vypnuté (store: null, --share-store off): výchozí sdílet = dlouhý odkaz bez ⚠ a bez sítě, ale s ℹ share.store-off (vlna 22, bod 16); sdílet úložiště = ✗", async () => {
    const calls = fakeStore({ ping: true });
    const r = await shareWithPolicy(d, { days: 10, view: "model", want: "auto", base: BASE, store: null }, note);
    expect(r?.mode).toBe("link");
    // vědomá změna (bod 16): vypnuté úložiště už není tiché – ℹ s délkou odkazu (dřív `notes` prázdné)
    expect(notes).toEqual([{ code: "share.store-off", args: [r!.url.length] }]);
    notes.length = 0;
    expect(await shareWithPolicy(d, { days: 10, view: "model", want: "store", base: BASE, store: null }, note)).toBeNull();
    expect(notes.map((n) => n.code)).toEqual(["share.store-unavailable"]);
    expect(calls).toEqual([]);
  });

  it("regrese: platnost nad limit úložiště → ⚠ share.days-clamped (odkaz platí 90 dní); úložiště bez omezení → ✗ bez dotazu na úložiště", async () => {
    let calls = fakeStore({ ping: true });
    const r = await shareWithPolicy(d, { days: 200, view: "model", want: "store", base: BASE, store: STORE }, note);
    expect(r).toMatchObject({ mode: "self" });
    expect(Math.round((r!.exp! - Date.now()) / 86_400_000)).toBe(90);
    expect(notes).toEqual([{ code: "share.days-clamped", args: [90, 200] }]);
    notes.length = 0;
    // výchozí sdílet 200 dní (krátký odkaz přes úložiště) – také ⚠
    await shareWithPolicy(d, { days: 200, view: "model", want: "auto", base: BASE, store: STORE }, note);
    expect(notes.map((n) => n.code)).toEqual(["share.days-clamped"]);
    notes.length = 0;
    resetShareProbe();
    calls = fakeStore({ ping: true });
    expect(await shareWithPolicy(d, { days: null, view: "model", want: "store", base: BASE, store: STORE }, note)).toBeNull();
    expect(notes).toEqual([{ code: "share.days-unlimited", args: [90] }]);
    expect(calls).toEqual([]); // rozhodnuto bez sítě – nejde o odmítnutí serverem
    notes.length = 0;
    const l = await shareWithPolicy(d, { days: null, view: "model", want: "store", orLink: true, base: BASE, store: STORE }, note);
    expect(l?.mode).toBe("link");
    expect(notes.map((n) => n.code)).toEqual(["share.fallback-link"]);
    expect(notes[0].text).toMatch(/bez omezení platnosti nemůže být odkaz v úložišti/);
  });

  it("regrese: text nedostupného úložiště uvádí adresu, na kterou se šlo (CLI --share-store), ne /cad/share/", async () => {
    fakeStore({ ping: false });
    const prev = process.env.NEXT_PUBLIC_CAD_SHARE_SELF;
    process.env.NEXT_PUBLIC_CAD_SHARE_SELF = "http://127.0.0.1:3399/cad/share/"; // jako CLI node-shims
    try {
      expect(await shareWithPolicy(d, { days: 10, view: "model", want: "store", base: BASE }, note)).toBeNull();
      expect(notes[0]).toMatchObject({ code: "share.store-unavailable" });
      expect(notes[0].text).toContain("(http://127.0.0.1:3399/cad/share/)");
      notes.length = 0;
      resetShareProbe();
      await shareWithPolicy(d, { days: 10, view: "model", want: "auto", base: BASE }, note);
      expect(notes.map((n) => n.code)).toEqual(["share.fallback-link"]);
      expect(notes[0].text).toContain("(http://127.0.0.1:3399/cad/share/)");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_CAD_SHARE_SELF;
      else process.env.NEXT_PUBLIC_CAD_SHARE_SELF = prev;
    }
  });

  it("regrese: úložiště odpoví na ?ping, ale nahrávání visí → časový limit, ✗ share.store-unavailable (ne odmítnutí), výchozí sdílet = dlouhý odkaz s ⚠", async () => {
    setUploadTimeoutBase(60);
    fakeStore({ ping: true, post: "hang" });
    const t0 = Date.now();
    expect(await shareWithPolicy(d, { days: 10, view: "model", want: "store", base: BASE, store: STORE }, note)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(notes.map((n) => n.code)).toEqual(["share.store-unavailable"]);
    expect(notes[0].text).toMatch(/nahrávání nedoběhlo do 0 s\. \(http:\/\/127\.0\.0\.1:9\/cad\/share\/\)$/);
    notes.length = 0;
    const r = await shareWithPolicy(d, { days: 10, view: "model", want: "auto", base: BASE, store: STORE }, note);
    expect(r?.mode).toBe("link");
    expect(notes.map((n) => n.code)).toEqual(["share.fallback-link"]); // jako nedostupné úložiště při ?ping
    expect(notes[0].text).toMatch(/nahrávání nedoběhlo do 0 s\. \(http:\/\/127\.0\.0\.1:9\/cad\/share\/\)$/);
    // soubor odkazem (… odkaz): stejný limit, chyba „nedostupné“
    const { shareFile, FileStoreError } = await import("../share-file");
    const err = await shareFile({ name: "a.step", mime: "model/step", data: new Uint8Array(100) }, { store: STORE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileStoreError);
    expect((err as InstanceType<typeof FileStoreError>).unavailable).toBe(true);
    expect((err as Error).message).toMatch(/nahrávání nedoběhlo/);
  });

  it("výchozí sdílet: úložiště odmítne (403) → ✗ share.rejected s důvodem serveru + ⚠ share.fallback-link a odkaz mode=link", async () => {
    fakeStore({ ping: true, post: 403 });
    const r = await shareWithPolicy(d, { days: 10, view: "model", want: "auto", base: BASE, store: STORE }, note);
    expect(r?.mode).toBe("link");
    expect(notes.map((n) => n.code)).toEqual(["share.rejected", "share.fallback-link"]);
    expect(String(notes[0].args?.[0])).toMatch(/403 origin/);
  });

  it("výchozí sdílet bez úložiště: dlouhý odkaz s ⚠ share.fallback-link; delší než 4096 znaků → zmínka o limitu prohlížeče", async () => {
    fakeStore({ ping: false });
    const big: CadDoc = { ...part("Velký", 80), features: Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, name: `Kvádr ${i} ${Math.random().toString(36)}`, type: "box", size: [i + 1, 10 + (i % 7), 10], origin: [i * 3.17, i * 1.91, 0] }) as never) };
    const r = await shareWithPolicy(big, { days: 10, view: "model", want: "auto", base: BASE, store: STORE }, note);
    expect(r!.url.length).toBeGreaterThan(LINK_BROWSER_MAX);
    expect(notes.map((n) => n.code)).toEqual(["share.fallback-link"]);
    expect(notes[0].text).toMatch(/prohlížeč agenta v cloudu přijme nejvýš 4096/);
    notes.length = 0;
    // výslovně v odkazu: ⚠ share.long-link s délkou
    const l = await shareWithPolicy(big, { days: 10, view: "model", want: "link", base: BASE, store: STORE }, note);
    expect(notes).toEqual([{ code: "share.long-link", args: [l!.url.length] }]);
  });
});

/* ───────────────────────── soubor odkazem (share-file.ts) ───────────────────────── */

describe("soubor ke stažení odkazem (… odkaz)", () => {
  it("zašifruje, nahraje (po částech), odkaz na stránku vedle úložiště; obsah v úložišti nečitelný; dešifrování = tytéž bajty", async () => {
    const { shareFile, parseFileHash, decryptSharedFile, filePageFor } = await import("../share-file");
    const saved = new Map<string, Uint8Array>();
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      if (u.search === "?ping") return new Response(JSON.stringify({ ok: true, v: 1, max_bytes: 26_214_400, chunk_bytes: 65_536, max_days: 90 }), { status: 200, headers: { "content-type": "application/json" } });
      if (init?.method === "POST") {
        const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
        const id = u.searchParams.get("id") ?? "Fi1e5h4re0";
        const prev = saved.get(id) ?? new Uint8Array(0);
        const next = new Uint8Array(prev.length + body.length);
        next.set(prev);
        next.set(body, prev.length);
        saved.set(id, next);
        return new Response(JSON.stringify({ id, del: "tok", exp: Math.round(Date.now() / 1000) + 864000, size: next.length }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const b = saved.get(u.searchParams.get("id") ?? "");
      return b ? new Response(b as BodyInit, { status: 200 }) : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", f);
    const data = new Uint8Array(200_000); // nestlačitelná data → nahrání po částech (65 536 B)
    for (let i = 0; i < data.length; i += 65_536) crypto.getRandomValues(data.subarray(i, i + 65_536));
    const r = await shareFile({ name: "Deska.step", mime: "model/step", data }, { store: STORE });
    expect(filePageFor(STORE)).toBe("http://127.0.0.1:9/cad/soubor/index.html");
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:9\/cad\/soubor\/index\.html#f=Fi1e5h4re0\.[A-Za-z0-9_-]{22}$/);
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length).toBeGreaterThan(1);
    const blob = saved.get("Fi1e5h4re0")!;
    expect(Buffer.from(blob).includes(Buffer.from("Deska.step"))).toBe(false); // název i data jen šifrovaně
    const h = parseFileHash(new URL(r.url).hash)!;
    const back = await decryptSharedFile(blob, h.key);
    expect(back.meta).toMatchObject({ name: "Deska.step", mime: "model/step", bytes: 200_000 });
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
    // jiný klíč / poškozená data = chyba
    await expect(decryptSharedFile(blob, "A".repeat(22))).rejects.toThrow();
    // úložiště neodpovídá → FileStoreError (unavailable)
    resetShareProbe();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(shareFile({ name: "x", mime: "a/b", data }, { store: STORE })).rejects.toMatchObject({ name: "FileStoreError", unavailable: true });
  });
});

/* ───────────────────────── stručný protokol: řádek O vždy, souhrnný řádek F ───────────────────────── */

describe("stručný protokol s výstupy", () => {
  const file = (i: number, o: Partial<OutFile> = {}): OutFile => ({ name: `Díl ${i}.step`, format: "step", bytes: 1000 + i, sha256: "0".repeat(64), doc: `Díl ${i}`, ...o });
  it("řádek O se nevynechá, ani když ⚠ zaplní rozpočet", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 60, now: () => 0 });
    for (let i = 1; i <= 60; i++) rb.code("feature.warning", { line: i, doc: `Díl ${i}`, args: [`Prvek ${i}`, "neplatná geometrie po operaci – zkontrolujte vstupy a pořadí prvků"] });
    rb.setShare({ url: "https://www.mnastrojarna.cz/cad#q=Ab3kZ9xQ2m.0f8KxZZZZZZZZZZZZZZZZZ", mode: "self", bytes: 900, exp: "2026-11-24" });
    const r = rb.finish({ ms: 1000 });
    const s = shortProtocol(r);
    expect(s.bytes).toBeLessThanOrEqual(2048);
    expect(s.text).toMatch(/^O https:\/\/www\.mnastrojarna\.cz\/cad#q=\S+ exp=2026-11-24 mode=self$/m);
    expect(s.overflow?.entries).toBeGreaterThan(0);
    const lines = s.text.split("\n");
    expect(lines.indexOf(lines.find((l) => l.startsWith("O "))!)).toBe(lines.length - 3); // … O, značka, Σ
    expect(r.share?.mode).toBe("self");
  });

  it("mnoho souborů, málo místa: jeden souhrnný řádek F (počet, formáty, kontrola, run=fail); jinak řádky F jednotlivě", () => {
    const files = Array.from({ length: 30 }, (_, i) => file(i, i === 3 ? { check: { ok: false, text: "x" } } : { check: { ok: true, text: "ok" } }));
    expect(filesSummaryLine(files)).toBe(`F step "*" ${files.reduce((s, f) => s + f.bytes, 0)}B files=30 formats=step check=fail`);
    const rb = new ReportBuilder({ lang: "cs", lines: 1, now: () => 0 });
    for (let i = 1; i <= 12; i++) rb.code("msg.warn", { line: i, text: `varování ${i} s delším textem, aby zabralo místo v rozpočtu protokolu` });
    const r = rb.finish({ files, ms: 1 });
    const text = formatShort(r);
    const F = text.split("\n").filter((l) => l.startsWith("F "));
    expect(F).toEqual([filesSummaryLine(files)]);
    for (const l of text.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    const few = formatShort(new ReportBuilder({ lang: "cs", lines: 1, now: () => 0 }).finish({ files: files.slice(0, 3), ms: 1 }));
    expect(few.split("\n").filter((l) => l.startsWith("F "))).toHaveLength(3);
    expect(filesSummaryLine([file(1), file(2, { format: "pdf", run: "fail" })])).toMatch(/^F mixed "\*" \d+B files=2 formats=step,pdf run=fail$/);
  });

  it("base64 do protokolu má strop OUT_BASE64_MAX (2 MB)", () => {
    expect(OUT_BASE64_MAX).toBe(2 * 1024 * 1024);
  });
});
