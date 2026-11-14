import { describe, expect, it } from "vitest";
import { setLang, type CadLang } from "../../i18n";
import "../index";
import type { CadDoc } from "../../types";
import { applyDraftText } from "../agent";
import { runScript } from "../commands";
import { newDraftModel } from "../doc";
import type { DraftModel } from "../model";
import { draftLine } from "../prefix";
import { sessionFor } from "../session";
import { dimGeom } from "./kinds-annot";
import { mtextPlain } from "./mtext";
import { hatchArea } from "./patterns";
import type { DDimension, DHatch } from "./types";
import tipsCs from "../../help/tips/draft-annot.cs";
import tipsDe from "../../help/tips/draft-annot.de";
import tipsEn from "../../help/tips/draft-annot.en";

describe("návod pro AI – příklad poznámek 2D", () => {
  it("příklad z návodu proběhne: kóty se stylem, řetězová kóta, šrafa s ostrovy, odkaz, tolerance, drsnost", async () => {
    setLang("cs");
    const { AGENT_GUIDE } = await import("../../agent-guide");
    const block = /Příklad – okótovaná příruba[^\n]*\n```\n([\s\S]*?)```/.exec(AGENT_GUIDE)?.[1] ?? "";
    const lines = block.trim().split("\n");
    expect(lines.length).toBe(9);
    let doc = { app: "mnastrojarna-cad", version: 2, name: "x", material: "ocel", features: [] } as unknown as CadDoc;
    for (const l of lines) {
      const rest = draftLine(l);
      expect(rest, l).not.toBeNull();
      const r = await applyDraftText(doc, rest!);
      for (const x of r.results) expect(x.error, x.input).toBeUndefined();
      doc = r.newDoc ?? r.doc;
    }
    const m = doc.draft as DraftModel;
    const dims = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    const txt = dims.map((d) => mtextPlain(dimGeom(d, { model: m }).text).join(""));
    expect(txt).toEqual(["120", "80", "Ø30", "20", "80", "20"]);
    expect(dims.every((d) => d.layer === "KÓTY" && d.style === "Výrobní")).toBe(true);
    const h = m.entities.find((e) => e.type === "hatch") as DHatch;
    expect(h.loops.length).toBe(4);
    expect(hatchArea(h)).toBeCloseTo(120 * 80 - Math.PI * (225 + 16 + 16), 6);
    expect(m.entities.some((e) => e.type === "leader") && m.entities.some((e) => e.type === "tolerance") && m.entities.some((e) => e.type === "surfsym")).toBe(true);
  });
});

describe("mikronávody – textový příkaz `cmd` projde ve svém jazyce", () => {
  const setup = (lang: CadLang) => {
    setLang("cs");
    let m = newDraftModel();
    const s = sessionFor(m);
    const r = runScript(m, s, 'čára 0,0 100,0; čára 0,0 70.71067811865476,70.71067811865476; kružnice 50,25 10; oblouk střed 0,0 50,0 0,50; mtext 10,90 @40,-10 "x"; obdélník 0,0 100,50; šrafa 50,10; kóta-lineární 0,0 100,0 50,-15; styl-textu nový ISO; styl-textu aktuální Standard');
    for (const x of r.results) expect(x.error, x.input).toBeUndefined();
    m = r.model;
    setLang(lang);
    return { m, s };
  };
  for (const [lang, tips] of [["cs", tipsCs], ["en", tipsEn], ["de", tipsDe]] as [CadLang, Record<string, { cmd?: string }>][]) {
    it(`${lang}: všechny příkazy mikronávodů`, () => {
      const keys = Object.keys(tips);
      expect(keys.length).toBe(Object.keys(tipsCs).length);
      for (const k of keys) {
        const cmd = tips[k].cmd;
        if (!cmd) continue;
        const { m, s } = setup(lang);
        const rest = draftLine(cmd);
        expect(rest, `${k}: ${cmd}`).not.toBeNull();
        const r = runScript(m, s, rest!);
        for (const x of r.results) expect(x.error, `${lang} ${k}: ${cmd}`).toBeUndefined();
      }
      setLang("cs");
    });
  }
});
