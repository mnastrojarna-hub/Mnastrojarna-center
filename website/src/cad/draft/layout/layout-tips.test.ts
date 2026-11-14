import { describe, expect, it } from "vitest";
import "../index";
import { findCommand, tokenize } from "../commands";
import { draftLine } from "../prefix";
import cs from "../../help/tips/draft-layout.cs";
import en from "../../help/tips/draft-layout.en";
import de from "../../help/tips/draft-layout.de";

// limity jako TIP_LIMITS v help/tips.ts (čeština; angličtina a němčina + 35 %, cmd bez rezervy)
const LIM = { what: 120, when: 120, select: 140, step: 90, cmd: 60, note: 130, steps: 3 };
type Tip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

describe("mikronávody balíku layout", () => {
  it("stejné klíče ve třech jazycích, délky v limitech, příkaz je 2D příkaz balíku", () => {
    const keys = Object.keys(cs).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(de).sort()).toEqual(keys);
    for (const [lang, map, k] of [["cs", cs, 1], ["en", en, 1.35], ["de", de, 1.35]] as const) {
      for (const [key, t0] of Object.entries(map)) {
        const t = t0 as Tip;
        const at = `${lang} ${key}`;
        expect(t.what.length, at).toBeLessThanOrEqual(LIM.what * k);
        expect(t.when.length, at).toBeLessThanOrEqual(LIM.when * k);
        if (t.select) expect(t.select.length, at).toBeLessThanOrEqual(LIM.select * k);
        if (t.note) expect(t.note.length, at).toBeLessThanOrEqual(LIM.note * k);
        expect(t.steps.length, at).toBeLessThanOrEqual(LIM.steps);
        for (const s of t.steps) expect(s.length, `${at}: ${s}`).toBeLessThanOrEqual(LIM.step * k);
        if (t.cmd) {
          expect(t.cmd.length, at).toBeLessThanOrEqual(LIM.cmd);
          const rest = draftLine(t.cmd);
          expect(rest, at).not.toBeNull();
          expect(findCommand(tokenize(rest!)[0])?.id, `${at}: ${t.cmd}`).toBeTruthy();
        }
      }
    }
    // každé tlačítko pásu balíku má návod
    for (const id of ["lo-block", "lo-insert", "lo-blocks", "lo-bedit", "lo-bclose", "lo-wblock", "lo-attdef", "lo-attedit", "lo-attext", "lo-purge", "lo-new", "lo-pagesetup", "lo-mview", "lo-vpscale", "lo-vplock", "lo-vplayer", "lo-mspace", "lo-pspace", "lo-plot", "lo-exportpdf", "lo-png", "lo-svg"]) expect(keys, id).toContain(`draft/${id}`);
  });
});
