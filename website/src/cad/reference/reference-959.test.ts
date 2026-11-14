/**
 * Skutečný výkres testu 959 (AutoCAD Mechanical, DWG R2004) – soubor zákazníka NENÍ v repozitáři (NDA); test se bez
 * něj přeskočí. Ověřuje jen počty a druhy (žádné hodnoty ani texty výkresu): import objektů AutoCAD Mechanical (dřív
 * 311 objektů tiše zahozeno), neviditelné entity mimo rozsah, výtah (listy, pohledy, kóty, normálie, kusovník,
 * pozice, značky, razítka) a rozpory. Cesta k souboru: proměnná MNCAD_959_DWG nebo .local/fixtures hlavního checkoutu.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import "../draft/index";
import { setLang } from "../i18n";
import { draftFromFile } from "../draft/io/files";
import { importNoteText } from "../draft/io/index";
import { extents } from "../draft/status";
import { buildShape } from "../build";
import { makeDrawing, type DrawingOptions } from "../drawing";
import type { CadDoc } from "../types";
import { extractReference, viewGeometry } from "./extract";
import { parseReferenceLine } from "./parse";
import { runReferenceCmd, type RefEnv } from "./run";

const F = process.env.MNCAD_959_DWG ?? "/home/user/Mnastrojarna-center/website/.local/fixtures/959-sestava_a_dily.dwg";
const D = process.env.MNCAD_959_DOC ?? "/home/user/Mnastrojarna-center/website/.local/fixtures/959-dokument.json";
const has = existsSync(F);
const hasDoc = has && existsSync(D);

describe.skipIf(!has)("předloha 959 (skutečný DWG AutoCAD Mechanical – bez souboru se přeskočí)", () => {
  const read = () => draftFromFile("959.dwg", new Uint8Array(readFileSync(F)));
  it("import: všech 311 objektů AutoCAD Mechanical převedeno a v poznámce, nic tiše nezahozeno; rozsah bez neviditelných entit", () => {
    const r = read();
    expect(r.note.converted).toMatchObject({ STDPART2D: 167, ACMSURFSYM: 46, ACMPARTREF: 35, ACMBALLOON: 26, AMDTSECTIONSYM: 11, AMDTSECTIONSYMLABEL: 11, ACMDATUMID: 7, ACMFCFRAME: 7, ACMPARTLIST: 1 });
    expect(r.note.skipped).toEqual({});
    expect(r.note.customObjects?.ACMDATAENTRYPART).toBe(35);
    expect(r.note.dimText).toHaveLength(1);
    expect(importNoteText(r.note)).toMatch(/STDPART2D 167/);
    const ex = extents(r.model, r.model.entities)!;
    // dřív i neviditelné body a popisky rámečků daleko mimo listy; teď jen listy
    expect(ex.x1 - ex.x0).toBeLessThan(2500);
    expect(ex.y1 - ex.y0).toBeLessThan(3000);
    const std = r.model.entities.filter((e) => e.ext?.acm?.cls === "STDPART2D");
    expect(std.every((e) => e.ext?.acm?.branch?.startsWith("/AMSTD/"))).toBe(true);
  }, 60_000);

  it("výtah: 15 listů (3× A2, 7× A3, 5× A4) s měřítky, ≥ 29 pohledů, 380 kót, normálie, kusovník, pozice, značky, razítka, rozpory", () => {
    const r = read();
    const ex = extractReference(r.model, { name: "959.dwg", format: "dwg" });
    expect(ex.ms).toBeLessThan(5000);
    const sizes: Record<string, number> = {};
    for (const s of ex.sheets) sizes[s.size] = (sizes[s.size] ?? 0) + 1;
    expect(sizes).toEqual({ A2: 3, A3: 7, A4: 5 });
    expect(ex.sheets.every((s) => s.source === "mechanical" && s.scale && s.scaleValue)).toBe(true);
    expect(ex.views.length).toBeGreaterThanOrEqual(29);
    const d = ex.dims;
    expect(d).toHaveLength(380);
    expect(d.filter((x) => x.tol)).toHaveLength(27);
    expect(d.filter((x) => x.fit)).toHaveLength(12);
    expect(d.filter((x) => x.reference)).toHaveLength(13);
    expect(d.filter((x) => x.dia)).toHaveLength(45);
    expect(d.filter((x) => x.thread)).toHaveLength(6);
    expect(d.filter((x) => x.chamfer)).toHaveLength(5);
    expect(d.filter((x) => x.count).length).toBeGreaterThan(20);
    // text kóty × geometrie: 1 rozpor; zaokrouhlené texty (bez úhlových kót – 1°15' = 1,25° přesně)
    expect(d.filter((x) => x.check === "mismatch")).toHaveLength(1);
    expect(d.filter((x) => x.check === "rounded")).toHaveLength(32);
    // normálie (instance i ve vložených blocích) s druhem a označením
    const std = ex.holes.filter((h) => h.kind !== "circle");
    expect(std.length).toBeGreaterThanOrEqual(167);
    expect(std.every((h) => h.branch)).toBe(true);
    expect(new Set(std.map((h) => h.kind))).toEqual(new Set(["thread", "bore", "counterbore", "screw", "pin"]));
    // kusovník: 35 pozic, 27 řádků s počtem, celkem 67 ks
    expect(ex.boms).toHaveLength(1);
    const rows = ex.boms[0].rows;
    expect(rows).toHaveLength(35);
    expect(rows.filter((x) => (x.qty ?? 0) > 0)).toHaveLength(27);
    expect(rows.reduce((s, x) => s + (x.qty ?? 0), 0)).toBe(67);
    // databáze kusovníku (ACMDATAENTRYPART, 35 objektů): atributy dílů z dat třídy u 27 obsazených pozic
    expect(ex.bomData.length).toBe(27);
    expect(ex.bomData.every((x) => x.attrs.NAME)).toBe(true);
    // pozice propojené se značkou dílu
    expect(ex.balloons).toHaveLength(26);
    expect(ex.balloons.every((b) => b.linked)).toBe(true);
    const sym = (k: string) => ex.symbols.filter((s) => s.kind === k).length;
    expect(sym("roughness")).toBeGreaterThanOrEqual(46);
    expect([sym("fcf"), sym("datum"), sym("section")]).toEqual([7, 7, 11]);
    expect(sym("label")).toBeGreaterThanOrEqual(11);
    // razítka: 12 výrobních výkresů dílů + 3 listy sestavy
    expect(ex.titles).toHaveLength(15);
    const blocks: Record<string, number> = {};
    for (const t of ex.titles) blocks[t.block ?? "?"] = (blocks[t.block ?? "?"] ?? 0) + 1;
    expect(Object.values(blocks).sort((a, b) => a - b)).toEqual([3, 12]);
    // rozpory: text × geometrie, 2× razítko × kusovník, Ø díry v půdorysu × kóta v řezu
    const kinds = ex.contradictions.map((c) => c.kind);
    expect(kinds.filter((k) => k === "dim-text")).toHaveLength(1);
    expect(kinds.filter((k) => k === "title-bom")).toHaveLength(2);
    expect(kinds.filter((k) => k === "hole-dim").length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("normálie: podřízené entity na svých hladinách (AM_0 / AM_4 / AM_7 / AM_9), díry bez značky středu Ø2, pohledy bez anotací", () => {
    const rd = read();
    const blocks = new Map((rd.model.blocks ?? []).map((b) => [b.name, b]));
    const std = rd.model.entities.filter((e) => e.ext?.acm?.cls === "STDPART2D");
    const sub = std.flatMap((e) => blocks.get((e as { block?: string }).block ?? "")?.entities ?? []);
    expect(sub.length).toBeGreaterThan(500);
    // dřív vše na hladině 0 (= obrys); teď hladina z tabulky výkresu podle indexu podřízené entity
    expect(sub.filter((e) => e.layer === "0").length).toBe(0);
    for (const l of ["AM_0", "AM_4", "AM_7", "AM_9"]) expect(sub.some((e) => e.layer === l)).toBe(true);
    const ex = extractReference(rd.model, { name: "959.dwg", format: "dwg" });
    // značka středu r = 1 (AM_9) u každé normálie – dřív Ø2 v 77 z 85 řádků výtahu děr
    const holes = ex.holes.filter((h) => h.kind !== "circle");
    expect(holes.filter((h) => h.dias.includes(2)).length).toBe(0);
    // geometrie pohledů bez tenkých a konstrukčních čar (osy, závit ¾, značky Ø2, kóty AM_5) – dřív zvětšovaly obálky pohledů
    for (const v of ex.views) expect(viewGeometry(rd.model, ex, v.id).filter((g) => /^AM_(4|5|7|8|9)N?$/i.test(g.layer)).length, v.id).toBe(0);
    // razítko sestavy (FAM-SEST): název z GEN-TITLE-DES2, ne jméno kreslícího z GEN-TITLE-NAME
    const asm = ex.titles.filter((t) => t.block === "FAM-SEST");
    expect(asm).toHaveLength(3);
    expect(asm.every((t) => t.name === t.fields["GEN-TITLE-DES2"] && t.author === t.fields["GEN-TITLE-NAME"])).toBe(true);
  }, 60_000);
});

describe.skipIf(!hasDoc)("předloha 959 × díly modelu 959 (bez souborů se přeskočí)", () => {
  it("desky 01 a 07: porovnání půdorysu ≥ 99 % předlohy, kontrola kót bez ✗ a bez „bez bodu“ jen s listem dílu", async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
      locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
      print: () => undefined,
      printErr: () => undefined,
    });
    r.setOC(oc as never);
    setLang("cs");
    const comps = (JSON.parse(readFileSync(D, "utf8")) as CadDoc).components ?? [];
    const part = (n: string) => (comps.find((c) => c.name.startsWith(n))!.source as unknown as { doc: CadDoc }).doc;
    const env: RefEnv = {
      drawing: async (doc, meta, opts) => makeDrawing((await buildShape(doc)).body as never, meta as never, opts as Partial<DrawingOptions>) as never,
      file: () => ({ name: "959.dwg", bytes: new Uint8Array(readFileSync(F)) }),
      load: { worker: false },
    };
    for (const n of ["01", "07"]) {
      let doc = part(n);
      const go = async (line: string) => {
        const res = await runReferenceCmd(parseReferenceLine(line)!, doc, env);
        if (res.doc) doc = res.doc;
        return res.log;
      };
      await go('předloha "959.dwg"');
      const c = (await go("porovnat předloha pohled horní"))[0];
      const cov = Number(/předloha pokryta modelem ([\d,]+) %/.exec(c)![1].replace(",", "."));
      // dřív 91,2 % (01): osy, značky Ø2 a úhlopříčky AM_5 se počítaly jako obrys
      expect(cov, `${n}: ${c}`).toBeGreaterThanOrEqual(99);
      const k = await go("kontrola kót");
      const tot = k.find((l) => /celkem:/.test(l)) ?? k[0];
      expect(tot, `${n}: ${k.join("\n")}`).toMatch(/ 0 ✗, 0 bez bodu v modelu/);
      expect(k.some((l) => /^✗/.test(l)), n).toBe(false);
    }
  }, 180_000);
});
