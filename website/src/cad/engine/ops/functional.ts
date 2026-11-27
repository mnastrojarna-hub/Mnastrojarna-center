/**
 * `funkční …` / `základna …` (vlna 22, bod 18 – rozbor agent-functional.ts): funkční prvky a základny v modelu dílu.
 * Plocha (F7) se změří jádrem hostitele (stejně jako `měřit F7`) a do dokumentu se uloží její geometrie v době označení
 * (rovina: normála + bod; válec: osa, bod, poloměr); válcová plocha díry / odebraného válce se uloží jako ten prvek.
 * Kontrola kót (cad/dim-complete.ts) pak u funkčního prvku chce velikost, polohu (od základny) a toleranci.
 */
import { functionalUsage, pmiUsage, type FunctionalCmd } from "../../agent-functional";
import { classifyNote, isFreeAnn, LEADER_MAX_CHARS, NOTE_MAX_LEADERS, noteStyle, titleDataLabel, titleHint } from "../../drawing-notes-rules";
import { treatmentWord } from "../../pmi-marks";
import { CodedError } from "../codes";
import { acceptLine, sheetTail } from "../accept";
import { runMeasure } from "../../agent-measure-run";
import { markLabel } from "../../dim-complete";
import { tr } from "../../i18n";
import type { CadDoc, Feature, FunctionalMark, Vec3 } from "../../types";
import { modelRev } from "../result-key";
import { runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const fmtV = (v: Vec3) => v.map(fmt).join("; ");
/** prvky, jejichž rozměry kontrola kót zná (díra, kvádr, válec, kužel, trubka, vysunutí) */
const MARKABLE = new Set<Feature["type"]>(["hole", "box", "cylinder", "cone", "tube", "extrude", "revolve", "thread", "pattern"]);

/** popis geometrie značky pro výpis */
function geomText(m: FunctionalMark): string {
  const g = m.geom;
  if (!g) return "";
  if (g.t === "plane") return tr("rovina, normála {0}, bod {1}", fmtV(g.n), fmtV(g.c));
  if (g.t === "cyl") return tr("válec Ø{0}, osa {1}, bod {2}", fmt(2 * g.r), fmtV(g.axis), fmtV(g.c));
  return tr("plocha, střed {0}", fmtV(g.c));
}

/** výpis funkčních prvků a základen dokumentu */
export function functionalListText(d: CadDoc): string {
  const ms = d.functional ?? [];
  if (!ms.length) return tr("funkční prvky ani základny nejsou vyznačené – funkční F7 [H7] · funkční \"Díra 1\" · základna A F3 (kontrola kót pak ověří velikost, polohu a toleranci)");
  return [
    tr("Funkční prvky a základny ({0}):", ms.length),
    ...ms.map((m) =>
      m.kind === "note" || m.kind === "treatment"
        ? `  ${m.id} ${pmiText(m)}${m.geom ? ` · ${geomText(m)}` : ""}`
        : `  ${m.id} ${m.kind === "datum" ? "" : tr("funkční ")}${markLabel(d, m)}${m.tol ? tr(" · tolerance {0}", m.tol) : ""}${m.geom ? ` · ${geomText(m)}` : ""}`,
    ),
    tr("  (geometrie plochy je z doby označení – po změně modelu plochu označte znovu)"),
  ].join("\n");
}

/** popis / úprava modelu do výpisu: „popis F7 „Brousit““, „úprava tepelná F2 „58+2 HRC“ od 0 do 25“ */
function pmiText(m: FunctionalMark): string {
  const f = `F${(m.face?.index ?? 0) + 1}`;
  if (m.kind === "note") return tr("popis {0} „{1}“", f, m.text ?? "");
  const range = m.from !== undefined || m.to !== undefined ? tr(" od {0} do {1}", fmt(m.from ?? 0), m.to !== undefined ? fmt(m.to) : tr("konce")) : tr(" (celá plocha)");
  return tr("úprava {0} {1} „{2}“{3}", treatmentWord(m.what), f, m.text ?? "", range);
}

/** text popisu / předpisu úpravy z textové cesty (agent): krátký, heslovitý, žádný údaj razítka (R1 / R2 / R4) */
function checkPmiText(kind: "note" | "treatment", text: string): void {
  const why = noteStyle(text, LEADER_MAX_CHARS);
  if (why) throw new CodedError("drawing.note-style", [tr("model"), tr("„{0}“: {1} – popis u plochy krátce a heslovitě (nejvýš {2} znaků), např. „Brousit“, „Leštit Ra 0,4“", text, why, LEADER_MAX_CHARS)]);
  if (kind === "treatment") return;
  const cls = classifyNote(text);
  const bad = cls?.parts.filter((p) => p.key !== "edges" && p.key !== "roughness") ?? [];
  if (bad.length) {
    const heat = bad.some((p) => p.key === "heatTreatment" || p.key === "hardness" || p.key === "surfaceTreatment");
    throw new CodedError("drawing.note-title-data", [tr("model"), tr("„{0}“ obsahuje {1} – {2}", text, bad.map((p) => titleDataLabel(p.key)).join(", "), heat ? tr("úprava jen této plochy = oblastní úprava (úprava F… tepelná|povrchová \"…\" [od a do b]), úprava celého dílu do razítka ({0})", titleHint(bad)) : tr("patří do razítka: {0}", titleHint(bad)))]);
  }
}

/** R2: nejvýš NOTE_MAX_LEADERS místních popisů v dokumentu (model + odkazy na výkrese) – jinak ✗ s radou */
function checkLeaders(d: CadDoc, what: string): void {
  const n = (d.functional ?? []).filter((m) => m.kind === "note" && m.text).length + (d.drawings ?? []).reduce((k, s) => k + s.annotations.filter((a) => a.type === "note" && !isFreeAnn(a)).length, 0);
  if (n > NOTE_MAX_LEADERS) throw new CodedError("drawing.leaders-limit", [tr("model"), tr("{0} – dokument by měl {1} místních popisů (odkazů se šipkou), nejvýš {2}; slučte popisy stejné úpravy, úpravu celého dílu dejte do razítka, nadbytečné zrušte (poznámka zrušit F…)", what, n, NOTE_MAX_LEADERS)]);
}

const nextId = (ms: readonly FunctionalMark[]) => {
  for (let n = 1; ; n++) if (!ms.some((m) => m.id === `f${n}`)) return `f${n}`;
};

/** cíl `funkční …`: plocha F7, nebo název prvku (nejdelší shoda slov) a zbytek = tolerance */
function resolveTarget(d: CadDoc, words: string[]): { face?: number; feature?: Feature; tol: string } {
  if (/^F\d+$/i.test(words[0])) return { face: Number(words[0].slice(1)) - 1, tol: words.slice(1).join(" ") };
  for (let n = words.length; n >= 1; n--) {
    const name = fold(words.slice(0, n).join(" "));
    const f = d.features.find((x) => fold(x.name) === name);
    if (f) return { feature: f, tol: words.slice(n).join(" ") };
  }
  throw new Error(tr("funkční: „{0}“ není plocha (F7) ani prvek dílu – prvky: {1}", words.join(" "), d.features.filter((f) => MARKABLE.has(f.type)).map((f) => f.name).join(", ") || "—"));
}

/** změří plochu jádrem: geometrie pro kontrolu kót */
async function faceGeom(ctx: Parameters<OpHandler<"functional">>[1], d: CadDoc, index: number): Promise<FunctionalMark["geom"]> {
  const rep = await runMeasure(ctx.host.kernel, d, { kind: "entities", items: [{ ref: { kind: "face", index }, label: `F${index + 1}` }] });
  if (rep.kind !== "entity") throw new Error(tr("plochu F{0} se nepodařilo změřit", index + 1));
  const e = rep.entity;
  const t = (e.type ?? "").toUpperCase();
  if (t.startsWith("PLANE") && e.normal && e.center) return { t: "plane", n: e.normal, c: e.center };
  if (t.startsWith("CYLIN") && e.axis && e.radius !== undefined) return { t: "cyl", axis: e.axis.dir, c: e.axis.origin, r: e.radius };
  return { t: "other", c: e.center ?? [0, 0, 0] };
}

/** díra (prvek historie) se stejnou osou a poloměrem jako válcová plocha */
function holeOfCylinder(d: CadDoc, g: Extract<NonNullable<FunctionalMark["geom"]>, { t: "cyl" }>): Feature | undefined {
  const l = Math.hypot(...g.axis) || 1;
  const a: Vec3 = [g.axis[0] / l, g.axis[1] / l, g.axis[2] / l];
  return d.features.find((f) => {
    if (f.type !== "hole" || f.suppressed) return false;
    const ax: Vec3 = f.axis === "X" ? [1, 0, 0] : f.axis === "Y" ? [0, 1, 0] : [0, 0, 1];
    if (f.dirDef || Math.abs(Math.abs(ax[0] * a[0] + ax[1] * a[1] + ax[2] * a[2]) - 1) > 1e-3) return false;
    const r = (f.kind === "tapped" && f.thread ? 0 : f.diameter / 2) || g.r;
    if (Math.abs(r - g.r) > 0.01 && !(f.cbDiameter > 0 && Math.abs(f.cbDiameter / 2 - g.r) < 0.01)) return false;
    const pts = f.points?.length ? f.points.flatMap((p) => (p.kind === "xyz" ? [p.p as Vec3] : [])) : [f.position];
    return pts.some((p) => {
      const w: Vec3 = [p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]];
      const c: Vec3 = [w[1] * a[2] - w[2] * a[1], w[2] * a[0] - w[0] * a[2], w[0] * a[1] - w[1] * a[0]];
      return Math.hypot(...c) < 0.05;
    });
  });
}

export const functionalOp: OpHandler<"functional"> = async (op, ctx) => {
  const r = runOf(ctx);
  const d = r.doc;
  if (d.kind === "assembly" || d.kind === "draft") throw new Error(tr("funkční prvky a základny se značí v dílu – otevřete díl (záložka dílu)"));
  const cmd: FunctionalCmd = op.cmd;
  const ms = [...(d.functional ?? [])];
  const commit = (next: FunctionalMark[], text: string) => {
    r.doc = { ...d, ...(next.length ? { functional: next } : { functional: undefined }) };
    if (!next.length) delete r.doc.functional;
    r.changed = true;
    say(ctx, text);
  };
  switch (cmd.kind) {
    case "list":
      say(ctx, functionalListText(d));
      return;
    case "note":
    case "treatment": {
      // popis plochy / oblastní úprava v modelu (vlna 23, R2 / R3): plocha se změří (snímek geometrie – výkres pozná změnu)
      const text = cmd.text.trim();
      checkPmiText(cmd.kind, text);
      const geom = await faceGeom(ctx, d, cmd.face);
      if (cmd.kind === "treatment" && geom?.t !== "plane") throw new Error(tr("úprava: plocha F{0} není rovinná – oblastní úprava se kreslí čerchovanou čárou podél rovinné plochy viděné z boku; u válce zvolte jeho rovinné čelo nebo úpravu celého dílu do razítka", cmd.face + 1));
      const same = (m: FunctionalMark) => m.kind === cmd.kind && m.face?.index === cmd.face && (cmd.kind === "note" || (m.from ?? null) === ((cmd as { from?: number }).from ?? null));
      const old = ms.find(same);
      const next = ms.filter((m) => !same(m));
      const mark: FunctionalMark = {
        id: old?.id ?? nextId(next),
        kind: cmd.kind,
        by: "agent", // textová cesta = agent (vlna 23, R6)
        face: { index: cmd.face },
        ...(geom ? { geom } : {}),
        rev: modelRev(d),
        text,
        ...(cmd.kind === "treatment" ? { what: cmd.what, ...(cmd.from !== undefined ? { from: cmd.from } : {}), ...(cmd.to !== undefined ? { to: cmd.to } : {}) } : {}),
      };
      next.push(mark);
      // vysvětlivka oblastní úpravy je řádek nad razítkem: limit 5 řádků (R4) – před zápisem do modelu, i když výkres ještě
      // není (vysvětlivky se pak objeví na každém výkresu dílu); místní popisy nejvýš NOTE_MAX_LEADERS (R2 – „ne 1000 poznámek“)
      const { checkDocNotesBudget } = await import("../../drawing-agent");
      if (cmd.kind === "treatment") checkDocNotesBudget({ ...d, functional: next }, tr("úprava {0}", pmiText(mark)));
      else checkLeaders({ ...d, functional: next }, pmiText(mark));
      // s výkresem je to jen přijetí – zda se popis / čára na list vešla, řekne vyhodnocení listu (ℹ → ✓ / ⚠, vlna 22 bod 22i)
      const msg = cmd.kind === "note" ? tr("✓ {0} v modelu{1} – výkres ho přebírá jako odkaz se šipkou na plochu", pmiText(mark), old ? tr(" (nahrazuje „{0}“)", old.text ?? "") : "") : tr("✓ {0} v modelu{1} – výkres ji přebírá jako tlustou čerchovanou čáru s kótou rozsahu a značkou; vysvětlivka se počítá do 5 řádků poznámek", pmiText(mark), old ? tr(" (nahrazuje „{0}“)", old.text ?? "") : "");
      commit(next, d.drawings?.length ? acceptLine(msg, sheetTail()) : msg);
      return;
    }
    case "clear": {
      const keep = ms.filter((m) => {
        if (m.kind !== cmd.what) return true;
        if (cmd.target === "all") return false;
        const w = cmd.target.map(fold);
        if (m.kind === "note" || m.kind === "treatment") return !(w.includes(fold(m.id)) || (m.face && w.includes(`f${m.face.index + 1}`)));
        const label = fold(m.kind === "datum" ? (m.label ?? "") : markLabel(d, m));
        return !(w.includes(fold(m.id)) || w.join(" ") === label || (m.face && w.includes(`f${m.face.index + 1}`)));
      });
      if (keep.length === ms.length) throw new Error(tr("nic ke zrušení: {0} – {1}", cmd.target === "all" ? tr("vše") : cmd.target.join(" "), cmd.what === "note" || cmd.what === "treatment" ? `${functionalListText(d)} · ${pmiUsage()}` : functionalListText(d)));
      commit(keep, tr("✓ zrušeno {0} – zbývá {1}", ms.length - keep.length, keep.length));
      return;
    }
    case "datum": {
      const index = Number(cmd.target[0].slice(1)) - 1;
      const geom = await faceGeom(ctx, d, index);
      if (geom?.t !== "plane") throw new Error(tr("základna {0}: plocha F{1} není rovinná – základnou může být jen rovinná plocha", cmd.label, index + 1));
      const next = ms.filter((m) => !(m.kind === "datum" && m.label === cmd.label));
      next.push({ id: nextId(next), kind: "datum", label: cmd.label, face: { index }, geom, rev: modelRev(d) });
      commit(next, tr("✓ základna {0} = F{1} ({2}) – polohy funkčních prvků se kontrolují od ní", cmd.label, index + 1, geomText(next[next.length - 1])));
      return;
    }
    case "mark": {
      if (!cmd.target.length) throw new Error(functionalUsage());
      const t = resolveTarget(d, cmd.target);
      let mark: FunctionalMark;
      if (t.feature) {
        if (!MARKABLE.has(t.feature.type)) throw new Error(tr("funkční „{0}“: kontrola kót rozměry prvku typu {1} nezná – označte jeho plochu (funkční F…)", t.feature.name, t.feature.type));
        mark = { id: "", kind: "functional", feature: t.feature.id, ...(t.tol ? { tol: t.tol } : {}) };
      } else {
        const geom = await faceGeom(ctx, d, t.face!);
        // válcová plocha díry = ta díra (prvek historie – poloha i velikost skupiny děr se kontrolují jako prvek)
        const hole = geom?.t === "cyl" ? holeOfCylinder(d, geom) : undefined;
        mark = hole
          ? { id: "", kind: "functional", feature: hole.id, ...(t.tol ? { tol: t.tol } : {}) }
          : { id: "", kind: "functional", face: { index: t.face! }, ...(geom ? { geom } : {}), ...(t.tol ? { tol: t.tol } : {}), rev: modelRev(d) };
      }
      const same = (m: FunctionalMark) => m.kind === "functional" && ((mark.feature && m.feature === mark.feature) || (mark.face && m.face?.index === mark.face.index));
      const next = ms.filter((m) => !same(m));
      mark.id = nextId(next);
      next.push(mark);
      commit(next, tr("✓ funkční {0}{1}{2} – kontrola kót chce velikost, polohu{3} a toleranci", markLabel(d, mark), mark.tol ? tr(" · tolerance {0}", mark.tol) : "", mark.geom ? ` (${geomText(mark)})` : "", ms.some((m) => m.kind === "datum") ? tr(" od základny") : ""));
      return;
    }
  }
};
