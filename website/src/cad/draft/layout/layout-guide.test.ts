import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setLang } from "../../i18n";
import { AGENT_GUIDE } from "../../agent-guide";
import { applyDraftText, draftLine } from "../agent";
import type { CadDoc } from "../../types";
import type { DraftModel } from "../model";
import { pdfStreams, setPdfFont } from "./pdf";
import { findLayout, TITLE_BLOCK } from "./sheets";
import type { DInsert, DViewport } from "./types";

describe("návod pro AI – příklad bloku, rozvržení a tisku běží", () => {
  it("příklad z agent-guide.ts: blok, 3 vložení, rozvržení A3 s razítkem, výřez 1:1, PDF", async () => {
    setLang("cs");
    setPdfFont(new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf")));
    const at = AGENT_GUIDE.indexOf("Příklad – blok, rozvržení A3");
    expect(at).toBeGreaterThan(0);
    const block = AGENT_GUIDE.slice(AGENT_GUIDE.indexOf("```", at) + 3, AGENT_GUIDE.indexOf("```", AGENT_GUIDE.indexOf("```", at) + 3));
    const lines = block
      .split("\n")
      .map((l) => draftLine(l.trim()))
      .filter((l): l is string => !!l);
    expect(lines.length).toBe(7);
    let doc = { app: "mnastrojarna-cad", version: 2, name: "x", material: "ocel", features: [] } as unknown as CadDoc;
    const all = [];
    for (const l of lines) {
      const r = await applyDraftText(doc, l);
      all.push(...r.results);
      doc = r.newDoc ?? r.doc;
    }
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    const m = doc.draft as DraftModel;
    expect(m.entities.filter((e) => e.type === "insert")).toHaveLength(3);
    const lay = findLayout(m, "Výroba")!;
    expect(lay.paper).toMatchObject({ size: "A3", w: 420, h: 297 });
    const vp = lay.entities.find((e) => e.type === "viewport") as DViewport;
    expect(vp.scale).toBe(1);
    const tb = lay.entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert;
    expect(Object.fromEntries(tb.attribs!.map((a) => [a.tag, a.value]))).toMatchObject({ NAZEV: "Příruba", CISLO_VYKRESU: "P-001", MATERIAL: "S235", MERITKO: "1:1" });
    const plot = all[all.length - 1];
    const file = plot.data!.file as { name: string; base64: string };
    expect(file.name).toBe("Priruba.pdf");
    const pdf = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    expect(new TextDecoder("latin1").decode(pdf.subarray(0, 8))).toBe("%PDF-1.7");
    expect(pdfStreams(pdf).length).toBeGreaterThan(0);
  });
});
