/**
 * Balík 4 (io) – vložení výkresu (IMPORT … sloučit / merge / einfügen): nová id, tabulky jen nové, jednotky měřítkem,
 * jeden krok historie, výběr vložených; UTF-8 ve starším DXF; příklad DWG / DXF z návodu pro AI proběhne celý.
 */
import { describe, expect, it } from "vitest";
import "../index";
import { setLang } from "../../i18n";
import { applyDraftText } from "../agent";
import { emptyDraftDoc } from "../doc";
import type { DraftEntity, DraftModel } from "../model";
import { allEntityLists } from "../model";
import { draftLine } from "../prefix";
import { sessionFor } from "../session";
import { DraftTx } from "../tx";
import type { CadDoc } from "../../types";
import { draftExport, draftImport } from "./index";
import { mergeDraftInto } from "./merge";
import { draftFromFile, isUtf8 } from "./files";

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");

async function docWith(text: string, name = "Zdroj", units = "mm"): Promise<CadDoc> {
  let doc: CadDoc = emptyDraftDoc(name, { units: units as "mm" });
  const r = await applyDraftText(doc, text);
  for (const x of r.results) expect(x.error, x.input).toBeUndefined();
  doc = r.doc;
  return doc;
}

describe("vložení výkresu (sloučit)", () => {
  it("2d import … sloučit: entity s novými id, hladiny doplněné, existující beze změny, výběr = vložené", async () => {
    setLang("cs");
    const src = await docWith("hladina nová RAM barva 3; hladina nová OBRYS barva 1; hladina aktuální RAM; obdélník 0,0 @210,297; hladina aktuální OBRYS; kružnice 50,50 10");
    const dwg = await draftExport(src.draft!, "dwg");
    // cíl: vlastní hladina OBRYS (barva 5 – musí zůstat), CECOLOR červená (nesmí se použít na vložené)
    let dst = await docWith("hladina nová OBRYS barva 5; hladina aktuální OBRYS; čára 0,0 10,10; proměnná cecolor 1", "Cíl");
    const before = dst.draft!;
    const r = await applyDraftText(dst, `import "ram.dwg" ${dwg.base64} sloučit`);
    expect(r.results[0].ok, r.results[0].error).toBe(true);
    expect(r.changed).toBe(true);
    dst = r.doc;
    const m = dst.draft!;
    expect(m.entities.length).toBe(before.entities.length + 2);
    const created = r.results[0].created;
    expect(created.length).toBe(2);
    const added = created.map((id) => m.entities.find((e) => e.id === id)!);
    expect(added.map((e) => e.type)).toEqual(["polyline", "circle"]);
    expect(added.map((e) => e.layer)).toEqual(["RAM", "OBRYS"]);
    // ByLayer zůstane (CECOLOR = 1 se na vložené nepoužije)
    for (const e of added) expect(e.color === undefined || e.color === "ByLayer").toBe(true);
    expect(m.layers.find((l) => l.name === "OBRYS")!.color).toBe(5);
    expect(m.layers.find((l) => l.name === "RAM")!.color).toBe(3);
    // id jedinečná ve všech prostorech, čítač navýšen
    const ids = allEntityLists(m).flatMap((s) => s.list.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.seq).toBeGreaterThanOrEqual(before.seq + 2);
    expect(sessionFor(m).sel).toEqual(created);
    const merge = r.results[0].data!.merge as { entities: number; layers: string[]; scale: number };
    expect(merge.entities).toBe(2);
    expect(merge.layers).toContain("RAM");
    expect(merge.scale).toBe(1);
    expect(r.log[0]).toMatch(/vloženo 2 entit/);
    // jeden příkaz = jedna transakce: původní model zůstal beze změny (krok zpět = předchozí model)
    expect(before.entities.length).toBe(1);
  }, 60000);

  it("jednotky: zdroj v cm do výkresu v mm = měřítko 10 (geometrie i délky typů čar)", async () => {
    const src = await docWith("čára 0,0 10,0; kružnice 5,5 2", "Cm", "cm");
    expect(src.draft!.vars.units).toBe("cm");
    const dst = emptyDraftDoc("Mm", { units: "mm" }).draft!;
    const tx = new DraftTx(dst);
    const rep = mergeDraftInto(tx, src.draft!);
    expect(rep.scale).toBe(10);
    const [l, c] = tx.model.entities as [Extract<DraftEntity, { type: "line" }>, Extract<DraftEntity, { type: "circle" }>];
    expect(l.b).toEqual([100, 0]);
    expect(c.c).toEqual([50, 50]);
    expect(c.r).toBe(20);
  });

  it("bloky: nový blok se doplní s novými id entit, existující název se ponechá", () => {
    const base = emptyDraftDoc("x").draft!;
    const blk = (name: string, r: number) => ({ name, base: [0, 0] as [number, number], entities: [{ id: "e1", layer: "0", type: "circle", c: [0, 0], r } as DraftEntity] });
    const dst: DraftModel = { ...base, seq: 5, blocks: [blk("SROUB", 3)], entities: [{ id: "e5", layer: "0", type: "line", a: [0, 0], b: [1, 1] } as DraftEntity] };
    const src: DraftModel = { ...base, seq: 2, blocks: [blk("SROUB", 99), blk("MATICE", 4)], entities: [{ id: "e2", layer: "0", type: "point", p: [1, 2] } as DraftEntity] };
    const tx = new DraftTx(dst);
    const rep = mergeDraftInto(tx, src);
    const m = tx.model;
    expect(rep.blocks).toEqual(["MATICE"]);
    expect(rep.keptBlocks).toEqual(["SROUB"]);
    expect((m.blocks!.find((b) => b.name === "SROUB")!.entities[0] as { r: number }).r).toBe(3);
    const ids = allEntityLists(m).flatMap((s) => s.list.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.entities.map((e) => e.type)).toEqual(["line", "point"]);
  });

  it("en / de: dxfin … merge, importieren … einfügen; bez souboru v textu = srozumitelná chyba", async () => {
    const src = await docWith("kružnice 0,0 5");
    const dxf = await draftExport(src.draft!, "dxf");
    const b = b64(dxf.data);
    let d = await docWith("čára 0,0 1,1", "C");
    let r = await applyDraftText(d, `dxfin "k.dxf" ${b} merge`);
    expect(r.results[0].ok, r.results[0].error).toBe(true);
    d = r.doc;
    r = await applyDraftText(d, `importieren "k.dxf" ${b} einfügen`);
    expect(r.results[0].ok, r.results[0].error).toBe(true);
    expect(r.doc.draft!.entities.filter((e) => e.type === "circle").length).toBe(2);
    r = await applyDraftText(d, "import sloučit");
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].error).toMatch(/base64/);
    r = await applyDraftText(d, `import "k.dxf" ${b} navíc`);
    expect(r.results[0].ok).toBe(false);
  }, 60000);
});

describe("kódování", () => {
  it("DXF R2000 v UTF-8 (text od agenta) se přečte jako UTF-8, cp1250 dál jako cp1250", async () => {
    const src = await docWith('text 0,0 5 0 "Žluťoučký kůň Ø20"');
    const f = await draftExport(src.draft!, "dxf", { version: "R2000" });
    // stejný obsah předaný jako řetězec → UTF-8
    const asText = new TextDecoder("windows-1250").decode(f.data);
    const utf = new TextEncoder().encode(asText);
    expect(isUtf8(utf)).toBe(true);
    expect(isUtf8(f.data)).toBe(false);
    for (const bytes of [utf, f.data]) {
      const r = draftFromFile("t.dxf", bytes);
      expect((r.model.entities[0] as { s: string }).s).toBe("Žluťoučký kůň Ø20");
    }
  });
});

describe("návod pro AI – příklad DWG / DXF", () => {
  it("příklad z návodu proběhne: DWG R2013 + DXF R12, zpět jako nová záložka, vložení do jiného výkresu", async () => {
    setLang("cs");
    const { AGENT_GUIDE } = await import("../../agent-guide");
    const block = /Příklad – výkres pro dodavatele jako DWG a pro CAM jako DXF R12[^\n]*\n```\n([\s\S]*?)```/.exec(AGENT_GUIDE)?.[1] ?? "";
    const lines = block.trim().split("\n");
    expect(lines.length).toBe(5);
    let doc = { app: "mnastrojarna-cad" as const, version: 2 as const, name: "x", material: "ocel", features: [] } as CadDoc;
    const files: { name: string; version: string; base64?: string; text?: string }[] = [];
    for (const l of lines) {
      const rest = draftLine(l);
      expect(rest, l).not.toBeNull();
      const r = await applyDraftText(doc, rest!);
      for (const x of r.results) {
        expect(x.error, x.input).toBeUndefined();
        if (x.data?.file) files.push(x.data.file as (typeof files)[number]);
      }
      doc = r.newDoc ?? r.doc;
    }
    expect(files.map((f) => [f.name, f.version])).toEqual([
      ["Priruba.dwg", "R2013"],
      ["Priruba-CAM.dxf", "R12"],
    ]);
    expect(Buffer.from(files[0].base64!, "base64").subarray(0, 6).toString()).toBe("AC1027");
    expect(files[1].text).toContain("AC1009");
    // zpět (jako importFile … { as: "draft" } / import "…" base64)
    const back = await applyDraftText(doc, `import "${files[0].name}" ${files[0].base64}`);
    const m = back.newDoc!.draft!;
    expect(m.entities.map((e) => [e.type, e.layer, (e as { r?: number }).r])).toEqual([
      ["circle", "OBRYS", 60],
      ["circle", "OBRYS", 30],
      ["circle", "OBRYS", 5.5],
    ]);
    expect(m.layers.find((l) => l.name === "OBRYS")?.lineweight).toBe(0.5);
    // DXF R12 pro CAM: tytéž kružnice
    const cam = (await draftImport("cam.dxf", new TextEncoder().encode(files[1].text!))).model;
    expect(cam.entities.filter((e) => e.type === "circle").length).toBe(3);
    // vložení do jiného výkresu
    const other = await docWith("čára -100,-100 100,100", "Sestava");
    const merged = await applyDraftText(other, `import "${files[0].name}" ${files[0].base64} sloučit`);
    expect(merged.results[0].created.length).toBe(3);
    expect(merged.doc.draft!.entities.length).toBe(4);
  }, 60000);
});

describe("mikronávody DWG / DXF", () => {
  it("každé tlačítko skupiny DWG / DXF má návod ve třech jazycích a jeho příkaz proběhne", async () => {
    // tlačítka pásu ze zdroje ui-io.tsx (JSX vitest nepřekládá)
    const { readFileSync } = await import("node:fs");
    const ui = readFileSync(new URL("../../../components/cad/draft/ui-io.tsx", import.meta.url), "utf8");
    const ids = [...ui.slice(ui.indexOf("output: [")).matchAll(/\{ id: "(io-[a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["io-open", "io-insert", "io-export", "io-panel"]);
    const src = await docWith("kružnice 0,0 5");
    for (const lang of ["cs", "en", "de"] as const) {
      const tips = (await import(`../../help/tips/draft-io.${lang}.ts`)).default as Record<string, { cmd?: string; steps: string[] }>;
      for (const id of ids) expect(tips[`draft/${id}`], `${lang} ${id}`).toBeTruthy();
      setLang(lang);
      for (const [k, t] of Object.entries(tips)) {
        if (!t.cmd) continue;
        // bez souboru (import) GUI otevře výběr – v textu chybí obsah; ostatní se musí provést
        const r = await applyDraftText(src, t.cmd);
        if (/^(import|importieren)\b/.test(t.cmd)) expect(r.results[0].error, `${lang} ${k}`).toMatch(/base64/i);
        else expect(r.results[0].error, `${lang} ${k}: ${t.cmd}`).toBeUndefined();
      }
    }
    setLang("cs");
  }, 60000);
});
