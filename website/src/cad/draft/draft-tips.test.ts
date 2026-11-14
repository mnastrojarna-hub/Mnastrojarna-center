/**
 * Mikronávody 2D výkresu: každé tlačítko pásu karet (jádro + balíky edit, annot, layout, io) má návod `draft/<id>`
 * v češtině a stejné klíče v angličtině a němčině; návody jádra (help/tips/draft-core.*) mají délky v limitech
 * a jejich textový příkaz (`cmd`) opravdu proběhne.
 */
import { describe, expect, it } from "vitest";
import "./index";
import { setLang, type CadLang } from "../i18n";
import { findCommand, runScript, tokenize } from "./commands";
import { newDraftModel, emptyDraftDoc } from "./doc";
import { draftLine } from "./prefix";
import { sessionFor } from "./session";
import type { DraftModel } from "./model";
import { draftCoreRibbon, ribbonItemIds } from "@/components/cad/draft/draft-ribbon";
import { UI_EXTS } from "@/components/cad/draft/ui-exts";
import type { DraftUiApi } from "@/components/cad/draft/ui-ext";
import coreCs from "../help/tips/draft-core.cs";
import coreEn from "../help/tips/draft-core.en";
import coreDe from "../help/tips/draft-core.de";
import editCs from "../help/tips/draft-edit.cs";
import editEn from "../help/tips/draft-edit.en";
import editDe from "../help/tips/draft-edit.de";
import annotCs from "../help/tips/draft-annot.cs";
import annotEn from "../help/tips/draft-annot.en";
import annotDe from "../help/tips/draft-annot.de";
import layoutCs from "../help/tips/draft-layout.cs";
import layoutEn from "../help/tips/draft-layout.en";
import layoutDe from "../help/tips/draft-layout.de";
import ioCs from "../help/tips/draft-io.cs";
import ioEn from "../help/tips/draft-io.en";
import ioDe from "../help/tips/draft-io.de";

type Tip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };
type Map3 = { cs: Record<string, Tip>; en: Record<string, Tip>; de: Record<string, Tip> };
const PKGS: Record<string, Map3> = {
  core: { cs: coreCs, en: coreEn, de: coreDe },
  edit: { cs: editCs, en: editEn, de: editDe },
  annot: { cs: annotCs, en: annotEn, de: annotDe },
  layout: { cs: layoutCs, en: layoutEn, de: layoutDe },
  io: { cs: ioCs, en: ioEn, de: ioDe },
};
// limity jako TIP_LIMITS v help/tips.ts (čeština; angličtina a němčina + 35 %, cmd bez rezervy)
const LIM = { what: 120, when: 120, select: 140, step: 90, cmd: 60, note: 130, steps: 3 };

const noop = () => undefined;
/** všechna id tlačítek pásu 2D výkresu v daném prostoru (jádro + rozšíření) */
function allRibbonIds(model: DraftModel, space: string): string[] {
  const core = draftCoreRibbon({ model, panel: null, activeCmd: null, command: noop, selectAll: noop, selectNone: noop, setPanel: noop, commit: noop, layerOfSel: noop, currentFromSel: noop, save: noop, share: noop });
  const session = sessionFor(model);
  session.space = space as typeof session.space;
  const doc = { ...emptyDraftDoc("Test"), draft: model };
  const api = { doc, model, session, command: noop, run: async () => [], commit: noop, select: noop, flash: noop, view: () => null, setView: noop, zoomExtents: noop, space, setSpace: noop, openPanel: noop, download: noop, openDoc: noop, redraw: noop } as unknown as DraftUiApi;
  const ids = ribbonItemIds(core);
  for (const ext of UI_EXTS) ids.push(...ribbonItemIds(ext.ribbon?.(api) ?? {}));
  return ids;
}

describe("mikronávody 2D výkresu", () => {
  it("každé tlačítko pásu (jádro i balíky, model i rozvržení) má návod draft/<id> v CS, EN a DE", () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const withLayout = runScript(m0, sessionFor(m0), "rozvržení nové A A3").model;
    const lay = withLayout.layouts?.[0];
    expect(lay).toBeTruthy();
    const ids = new Set([...allRibbonIds(m0, "model"), ...allRibbonIds(withLayout, `layout:${lay!.id}`)]);
    expect(ids.size).toBeGreaterThan(100);
    const cs = Object.assign({}, ...Object.values(PKGS).map((p) => p.cs)) as Record<string, Tip>;
    const en = Object.assign({}, ...Object.values(PKGS).map((p) => p.en)) as Record<string, Tip>;
    const de = Object.assign({}, ...Object.values(PKGS).map((p) => p.de)) as Record<string, Tip>;
    const missing = [...ids].filter((id) => !cs[`draft/${id}`]);
    expect(missing, "tlačítka bez návodu").toEqual([]);
    for (const id of ids) {
      expect(en[`draft/${id}`], `en draft/${id}`).toBeTruthy();
      expect(de[`draft/${id}`], `de draft/${id}`).toBeTruthy();
    }
  });

  it("každý balík návodů má v EN a DE stejné klíče jako v CS a žádný klíč není ve dvou balících", () => {
    const seen = new Map<string, string>();
    for (const [pkg, m] of Object.entries(PKGS)) {
      const keys = Object.keys(m.cs).sort();
      expect(Object.keys(m.en).sort(), `${pkg} en`).toEqual(keys);
      expect(Object.keys(m.de).sort(), `${pkg} de`).toEqual(keys);
      for (const k of keys) {
        expect(seen.get(k), `${k} v ${pkg} i ${seen.get(k)}`).toBeUndefined();
        seen.set(k, pkg);
      }
    }
  });

  it("návody jádra: délky v limitech, příkaz je 2D příkaz a proběhne bez chyby (CS, EN, DE)", () => {
    for (const [lang, map, k] of [["cs", coreCs, 1], ["en", coreEn, 1.35], ["de", coreDe, 1.35]] as const) {
      setLang(lang as CadLang);
      for (const [key, t] of Object.entries(map as Record<string, Tip>)) {
        const at = `${lang} ${key}`;
        expect(t.what.length, at).toBeLessThanOrEqual(LIM.what * k);
        expect(t.when.length, at).toBeLessThanOrEqual(LIM.when * k);
        if (t.select) expect(t.select.length, at).toBeLessThanOrEqual(LIM.select * k);
        if (t.note) expect(t.note.length, at).toBeLessThanOrEqual(LIM.note * k);
        expect(t.steps.length, at).toBeGreaterThan(0);
        expect(t.steps.length, at).toBeLessThanOrEqual(LIM.steps);
        for (const s of t.steps) expect(s.length, `${at}: ${s}`).toBeLessThanOrEqual(LIM.step * k);
        if (!t.cmd) continue;
        expect(t.cmd.length, at).toBeLessThanOrEqual(LIM.cmd);
        const rest = draftLine(t.cmd);
        expect(rest, at).not.toBeNull();
        expect(findCommand(tokenize(rest!)[0])?.id, `${at}: ${t.cmd}`).toBeTruthy();
        // připravený výkres: úsečky e1–e3, kružnice e4, hladina OSY (ne aktuální)
        const m0 = newDraftModel({ units: "mm" });
        const prep = runScript(m0, sessionFor(m0), "čára 0,0 100,0 100,50 0,50; kružnice 50,25 10; hladina nová OSY barva 1").model;
        const r = runScript(prep, sessionFor(prep), rest!);
        for (const x of r.results) expect(x.error, `${at}: ${t.cmd}`).toBeUndefined();
      }
    }
    setLang("cs");
  });
});
