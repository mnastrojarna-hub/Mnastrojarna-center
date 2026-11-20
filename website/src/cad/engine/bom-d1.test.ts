/**
 * Vlna 22, etapa D1 – kusovník v enginu (stejný v prohlížeči i CLI), náhradní jádro (geometrie se nepočítá):
 *  * bod 22g: číslo / materiál dílu změněné PO vložení → ⚠ asm.stale-copy na řádku změny i u kusovníku (s příkazem
 *    `sestava obnovit`), obnova převezme údaje, přepis v sestavě (sestava komponenta / upravit) není „starší než díl“,
 *    EN / DE: třída přeložená, desetinný oddělovač CSV podle jazyka;
 *  * bod 19: druh dílu (`druh nakupovaný katalog …`) i komponenty (`sestava komponenta … druh …`), oddíly kusovníku,
 *    normálie z knihovny = pevnostní třída, kolík s m6, výkresy jen vyráběných dílů (CLI), ⚠ vyráběný bez výkresu / čísla,
 *    druh v .mncad a ve skriptu z dokumentu.
 * Skutečné jádro (výkresy, razítko) pokrývá korpus 75 / 76 (parity.test.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "../agent";
import { partComponent, screwISO4762 } from "../assembly";
import { docToScript } from "../doc-script";
import { setLang } from "../i18n";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource } from "../types";
import { asmDocNotes, documentSheetJobs } from "./files";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import type { KernelApi } from "./kernel";
import { MemoryWorkspace } from "./memory-workspace";
import { formatConsole } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 20000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
function fakeKernel(): KernelApi {
  return {
    generation: () => 1,
    build: async (d: CadDoc) => result(d),
    check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
    asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
    interference: async () => Object.assign([], { stats: { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 } }),
    clashDetail: async () => [],
    stepSplit: async () => null,
  } as unknown as KernelApi;
}
const host = (): EngineHost => ({ kernel: fakeKernel(), files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
const run = (ws: MemoryWorkspace, text: string) => runScript(ws, text, host());
const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const text = (r: RunReport) => formatConsole(r);

const PARTS = 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10';
const ASM = 'nová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20';

afterEach(() => setLang("cs"));

describe("bod 22g – metadata dílu po vložení do sestavy", () => {
  it("materiál zadaný na díl PŘED vložením jde do kusovníku (beze změny chování)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, `nový díl "Deska A"\nkvádr 100 60 20\nmateriál 1.2379\n${ASM.split("\n").slice(0, 2).join("\n")}\nkusovník`);
    expect(text(r)).toMatch(/1 \| Deska A \|  \| 1 \| 1\.2379 \|/);
    expect(codes(r, "asm.stale-copy")).toEqual([]);
  });

  it("materiál zadaný na díl PO vložení: ⚠ na řádku změny, ⚠ u kusovníku s příkazem obnovy, žádné tiché „Ocel“ (repro-b)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, PARTS);
    await run(ws, ASM);
    const r = await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"\nkusovník');
    const st = codes(r, "asm.stale-copy");
    expect(st.map((e) => [e.line, e.level])).toEqual([[2, "warn"], [4, "warn"]]);
    // díl vložený v dřívějším běhu (konzole, --resume): sestava jmenovaná, rada = jedna funkce obnovy
    expect(st[0].text).toBe('díl „Deska A“ je v sestavě „Nástroj“ jako kopie – změna (materiál) se do sestavy sama nepromítne; v sestavě: sestava obnovit "Deska A"');
    expect(st[1].text).toBe("komponenta „Deska A“ je starší než díl „Deska A“ v záložce (materiál) – kusovník a výkres ukazují údaje z vložení; obnovit: sestava obnovit #1");
    // kusovník ukazuje kopii z vložení – ale označeně (— (třída Ocel)) a s ⚠, ne tiché „Ocel“
    expect(text(r)).toMatch(/1 \| Deska A \|  \| 1 \| — \(třída Ocel\) \|/);
    expect(codes(r, "bom.make-incomplete").map((e) => e.text)).toContain("vyráběné díly bez označení materiálu (jen třída): Deska A, Přidržovač – materiál 1.2379 v dílu");
  });

  it("sestava obnovit: kusovník i CSV převezmou materiál dílu, ⚠ zastaralé kopie zmizí; podruhé „už odpovídá“", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, PARTS);
    await run(ws, ASM);
    await run(ws, 'záložka "Deska A"\nmateriál 1.2379\nzáložka "Nástroj"');
    const r = await run(ws, 'sestava obnovit "Deska A"\nkusovník csv');
    expect(text(r)).toMatch(/✓ komponenta „Deska A“ obnovena z dílu \(materiál\)/);
    expect(text(r)).toMatch(/\n1;Deska A;;1;1\.2379;0,157;0,157;vyráběný;/);
    expect(codes(r, "asm.stale-copy")).toEqual([]);
    const again = await run(ws, 'sestava obnovit vše');
    expect(text(again)).toMatch(/✓ komponenta „Deska A“ už odpovídá dílu v záložce/);
    expect(text(again)).toMatch(/✓ komponenta „Přidržovač“ už odpovídá dílu v záložce/);
  });

  it("přepis v sestavě (sestava komponenta … materiál C45) není „starší než díl“ – bez ⚠ asm.stale-copy", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, PARTS);
    await run(ws, ASM);
    const r = await run(ws, 'sestava komponenta "Přidržovač" materiál C45\nkusovník');
    expect(codes(r, "asm.stale-copy")).toEqual([]);
    expect(text(r)).toMatch(/2 \| Přidržovač \|  \| 1 \| C45 \|/);
  });

  it("sestava obnovit … údaje: jen vlastnosti; neznámá komponenta = ✗ s výčtem", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, PARTS);
    await run(ws, ASM);
    await run(ws, 'záložka "Přidržovač"\nmateriál C45\nkvádr 5 5 5\nzáložka "Nástroj"');
    const r = await run(ws, 'sestava obnovit "Přidržovač" údaje\nkusovník');
    expect(text(r)).toMatch(/obnovena z dílu \(materiál\)/);
    // geometrie (přidaný kvádr) se údaji neobnovila → dál ⚠ s polem geometrie
    expect(codes(r, "asm.stale-copy").map((e) => e.text)).toEqual(["komponenta „Přidržovač“ je starší než díl „Přidržovač“ v záložce (geometrie) – kusovník a výkres ukazují údaje z vložení; obnovit: sestava obnovit #2"]);
    const bad = await run(ws, 'sestava obnovit "Nic"');
    expect(text(bad)).toMatch(/komponenta „Nic“ v sestavě není/);
  });

  it("EN / DE: třída materiálu přeložená a desetinný oddělovač CSV podle jazyka (dřív „Ocel“ a „0,055“ i v angličtině)", async () => {
    setLang("en");
    const ws = new MemoryWorkspace();
    const r = await run(ws, 'new part "Plate A"\nbox 100 60 20\nnew assembly "Tool"\ninsert "Plate A" fixed\nbom csv');
    expect(text(r)).toMatch(/1 \| Plate A \|  \| 1 \| — \(class Steel\) \| 0\.157/);
    expect(text(r)).toMatch(/CSV \(separator ;, decimal point\):/);
    expect(text(r)).toMatch(/\n1;Plate A;;1;— \(class Steel\);0\.157;0\.157;manufactured;/);
    setLang("de");
    const ws2 = new MemoryWorkspace();
    const r2 = await run(ws2, 'neues teil "Platte A"\nquader 100 60 20\nneue baugruppe "Werkzeug"\neinfügen "Platte A" fixieren\nstückliste csv');
    expect(text(r2)).toMatch(/— \(Klasse Stahl\)/);
    expect(text(r2)).toMatch(/;0,157;0,157;Fertigungsteil;/);
  });
});

describe("bod 19 – vyráběný / normálie / nakupovaný", () => {
  it("druh dílu i komponenty, oddíly, normálie = třída 12.9, kolík m6, katalog a výrobce", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(
      ws,
      'nový díl "Deska A"\nkvádr 100 60 20\nmateriál 1.2379\nnový díl "Pouzdro"\nválec 10 20\ndruh nakupovaný katalog "SFJ8-30" výrobce "Katalog A"\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Pouzdro" v 80 40 20\nnormálie M12x40 v 50 30 20\nnormálie kolík 8x30 v 80 10 20\nkusovník csv',
    );
    const t = text(r);
    expect(t).toMatch(/✓ druh dílu „Pouzdro“: nakupovaný · katalog „SFJ8-30“ · výrobce „Katalog A“/);
    expect(t).toMatch(/— Vyráběné díly —\n1 \| Deska A \|  \| 1 \| 1\.2379 \|/);
    expect(t).toMatch(/— Normálie —\n2 \| Šroub M12×40 ISO 4762 \| ISO 4762 – M12×40 – 12\.9 \| 1 \| 12\.9 \|/);
    expect(t).toMatch(/3 \| Kolík Ø8×30 ISO 8734 \| ISO 8734 – 8×30 – m6 \| 1 \| dle normy \|/);
    expect(t).toMatch(/— Nakupované díly —\n4 \| Pouzdro \(Katalog A\) \| SFJ8-30 \| 1 \| Ocel \|/);
    expect(t).toMatch(/\n2;Šroub M12×40 ISO 4762;ISO 4762 – M12×40 – 12\.9;1;12\.9;0,157;0,157;normálie;ISO 4762;M12×40;12\.9;;;Normálie/);
    expect(t).toMatch(/\n4;Pouzdro;;1;Ocel;0,157;0,157;nakupovaný;;;;SFJ8-30;Katalog A;/);
    // vyráběný díl bez čísla = ⚠ (nikdy tichá prázdná buňka)
    expect(codes(r, "bom.make-incomplete").map((e) => e.text)).toEqual(["vyráběné díly bez čísla výkresu: Deska A – číslo: výkres razítko číslo=\"…\" v dílu, nebo sestava komponenta \"…\" číslo \"…\""]);
    const c = await run(ws, 'sestava komponenta "Deska A" druh nakupovaný katalog "DA-K"\nsestava');
    expect(text(c)).toMatch(/#1 Deska A · díl · poloha \[0; 0; 0\] · ukotvená ⚓ · druh nakupovaný · katalog DA-K/);
    const back = await run(ws, 'sestava komponenta "Deska A" druh auto katalog ""\nsestava');
    expect(text(back)).not.toMatch(/#1 Deska A[^\n]*druh/);
    const doc = ws.present();
    expect(doc.components![0].supply).toBeUndefined();
    expect(doc.components![1].source.kind === "part" && doc.components![1].source.doc.supply).toEqual({ kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" });
  });

  it("výkresy do PDF jen u vyráběných dílů (normálie s výkresem se nepřibalí); ⚠ vyráběný bez výkresu / čísla", () => {
    const sheet = { id: "s1", name: "List 1" } as never;
    const plate: CadDoc = { ...emptyDoc("Deska A"), kind: "part", props: { number: "DA-001" }, drawings: [sheet] };
    const holder: CadDoc = { ...emptyDoc("Přidržovač"), kind: "part" };
    const screw: CadDoc = { ...screwISO4762("M12", 40), drawings: [sheet] };
    const bought: CadDoc = { ...emptyDoc("Pouzdro"), kind: "part", supply: { kind: "buy" }, drawings: [sheet] };
    const asm: CadDoc = { ...emptyDoc("Nástroj"), kind: "assembly", components: [partComponent(plate), partComponent(holder), partComponent(screw), partComponent(bought)] };
    expect(documentSheetJobs(asm).map((j) => j.doc.name)).toEqual(["Deska A"]);
    expect(asmDocNotes(asm)).toEqual([
      { code: "bom.docs", args: ["vyráběné 2 (bez výkresu 1), normálie 1, nakupované 1"] },
      { code: "bom.make-incomplete", args: ["Přidržovač (bez výkresu, bez čísla)"] },
    ]);
    // jednoduchý díl zůstává na jednom listu – výkres dílu = jen jeho listy
    expect(documentSheetJobs(plate)).toHaveLength(1);
  });

  it("druh se uloží do dokumentu a skript z dokumentu ho zapíše (díl i komponenta) – rozbor ho přečte zpět", () => {
    const p: CadDoc = { ...emptyDoc("Pouzdro"), kind: "part", supply: { kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" }, features: [{ id: "c", name: "Válec 1", type: "cylinder", radius: 5, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" }] };
    const s = docToScript(p).text;
    expect(s).toMatch(/\ndruh nakupovaný katalog "SFJ8-30" výrobce "Katalog A"\n/);
    const op = parseAgentText('druh nakupovaný katalog "SFJ8-30" výrobce "Katalog A"').ops[0] as { k: string; patch: unknown };
    expect(op).toMatchObject({ k: "meta", patch: { supply: { kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" } } });
    const asm: CadDoc = { ...emptyDoc("Nástroj"), kind: "assembly", components: [partComponent(p, {}, { supply: { kind: "make", grade: "8.8" } })] };
    const a = docToScript(asm).text;
    expect(a).toMatch(/sestava komponenta #1 druh vyráběný třída "8\.8"/);
    expect(JSON.parse(JSON.stringify(asm)).components[0].supply).toEqual({ kind: "make", grade: "8.8" });
    setLang("en");
    expect(docToScript(asm, { lang: "en" } as never).text).toMatch(/assembly component #1 kind make class "8\.8"/);
  });
});
