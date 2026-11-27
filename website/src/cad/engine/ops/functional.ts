/**
 * `funkční …` / `základna …` (vlna 22, bod 18 – rozbor agent-functional.ts): funkční prvky a základny v modelu dílu.
 * Plocha (F7) se změří jádrem hostitele (stejně jako `měřit F7`) a do dokumentu se uloží její geometrie v době označení
 * (rovina: normála + bod; válec: osa, bod, poloměr); válcová plocha díry / odebraného válce se uloží jako ten prvek.
 * Kontrola kót (cad/dim-complete.ts) pak u funkčního prvku chce velikost, polohu (od základny) a toleranci.
 */
import { functionalUsage, type FunctionalCmd } from "../../agent-functional";
import { runMeasure } from "../../agent-measure-run";
import { markLabel } from "../../dim-complete";
import { tr } from "../../i18n";
import type { CadDoc, Feature, FunctionalMark, Vec3 } from "../../types";
import { modelRev } from "../result-key";
import { runOf } from "../run-doc";
import { asmHooks, coded, say, type OpCtx, type OpHandler } from "./util";
import { makeAsmEnv } from "../asm-env";
import { partFaces } from "../../asm-agent";
import { sourceKey } from "../../assembly";
import { facePrint, matchFace, type FaceCand, type RefPrint } from "../../mate-remap";

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
    ...ms.map((m) => `  ${m.id} ${m.kind === "datum" ? "" : tr("funkční ")}${markLabel(d, m)}${m.tol ? tr(" · tolerance {0}", m.tol) : ""}${m.geom ? ` · ${geomText(m)}` : ""}`),
    tr("  (geometrie plochy je z doby označení – po změně modelu plochu označte znovu)"),
  ].join("\n");
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

/** plochy dílu (číslo, geometrie, plocha mm², obálka) – stejný seznam jako u vazeb sestavy (asm-agent.ts `partFaces`) */
async function faceCands(ctx: OpCtx, d: CadDoc): Promise<FaceCand[]> {
  const env = makeAsmEnv(ctx.ws, ctx.host.kernel, asmHooks(ctx));
  const source = { kind: "part" as const, doc: { ...d, kind: "part" as const } };
  const key = sourceKey(source);
  const [r] = await env.parts([{ key, source }]);
  return (await partFaces(env, key, r?.result)).faces;
}
/** otisk plochy `index` dílu pro pozdější dohledání (null = plocha není v seznamu – volné plochy, nad 400 ploch) */
async function printOf(ctx: OpCtx, d: CadDoc, index: number): Promise<RefPrint | null> {
  const row = (await faceCands(ctx, d).catch(() => [])).find((f) => f.face === index);
  return row ? facePrint(row.info, row.area, row.box) : null;
}

/**
 * Dohledání označených ploch a základen po změně modelu (vlna 22, bod 18 – kolo 7b): plocha označená na starší revizi
 * (`rev` ≠ nynější) se najde znovu podle otisku jen při geometrické shodě (cad/mate-remap.ts `matchFace` – přesná shoda, nebo
 * jediná plocha na téže rovině / ose, která se s původní překrývá); pak se uloží nové číslo, geometrie a revize (ℹ
 * functional.refound). Žádná nebo víc možností → zůstává „nezkontrolováno“ (⚠ functional.lost) – nikdy „nejbližší“ jiná plocha.
 * Vrací dokument s obnovenými značkami (beze změny, když nebylo co dohledat).
 */
/** ⚠ functional.lost jen jednou za běh a plochu (každý příkaz výkresu po změně modelu dohledání zkusí znovu) */
const lostSaid = new WeakMap<object, Set<string>>();
export async function refindMarks(ctx: OpCtx, d: CadDoc): Promise<{ doc: CadDoc; refound: number; lost: number }> {
  const ms = d.functional ?? [];
  const rev = modelRev(d);
  const stale = ms.filter((m) => !m.feature && !m.profile && m.face && m.rev && m.rev !== rev);
  if (!stale.length || d.kind === "assembly" || d.kind === "draft") return { doc: d, refound: 0, lost: 0 };
  let faces: FaceCand[] | null = null;
  try {
    faces = await faceCands(ctx, d);
  } catch {
    faces = null;
  }
  let refound = 0;
  let lost = 0;
  const next: FunctionalMark[] = [];
  for (const m of ms) {
    if (!stale.includes(m)) {
      next.push(m);
      continue;
    }
    const what = m.kind === "datum" ? tr("základna {0}", m.label ?? "?") : tr("funkční F{0}", m.face!.index + 1);
    // otisk z doby označení; starší značka bez otisku: jen nosná plocha ze snímku geometrie (bez velikosti a obálky – překryv
    // pak nejde ověřit a jediný kandidát na téže rovině se NEbere; přesná shoda středu ano)
    const print: RefPrint | null = m.print ?? (m.geom?.t === "plane" ? { kind: "plane", origin: m.geom.c, normal: m.geom.n } : m.geom?.t === "cyl" ? { kind: "cylinder", origin: m.geom.c, normal: m.geom.axis, radius: m.geom.r } : null);
    const hit = print && faces ? matchFace(print, faces, m.face!.index) : null;
    if (!hit || hit.state === "lost") {
      lost++;
      next.push(m);
      const said = lostSaid.get(ctx.report) ?? new Set<string>();
      lostSaid.set(ctx.report, said);
      if (said.has(`${m.id}|${rev}`)) continue;
      said.add(`${m.id}|${rev}`);
      coded(ctx, "functional.lost", { args: [what, `F${m.face!.index + 1}`, !faces ? tr("seznam ploch dílu se nepodařilo načíst") : !print ? tr("bez otisku plochy") : hit?.state === "lost" && hit.why === "ambiguous" ? tr("víc ploch na téže rovině / ose") : tr("na původní rovině / ose plocha není – posunula se nebo zmizela")] });
      continue;
    }
    const geom = await faceGeom(ctx, d, hit.face).catch(() => undefined);
    if (!geom || (m.kind === "datum" && geom.t !== "plane")) {
      lost++;
      next.push(m);
      coded(ctx, "functional.lost", { args: [what, `F${m.face!.index + 1}`, tr("plochu se nepodařilo změřit")] });
      continue;
    }
    const row = faces!.find((f) => f.face === hit.face);
    next.push({ ...m, face: { index: hit.face }, geom, rev, ...(row ? { print: facePrint(row.info, row.area, row.box) } : {}) });
    refound++;
    coded(ctx, "functional.refound", { args: [what, `F${m.face!.index + 1}`, `F${hit.face + 1}`, hit.how === "exact" ? tr("táž plocha") : tr("táž rovina / osa, jiná velikost")] });
  }
  return refound ? { doc: { ...d, functional: next }, refound, lost } : { doc: d, refound, lost };
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
  if (op.cmd.kind === "refind") {
    if (r.doc.kind === "assembly" || r.doc.kind === "draft") throw new Error(tr("funkční prvky a základny se značí v dílu – otevřete díl (záložka dílu)"));
    const res = await refindMarks(ctx, r.doc);
    if (res.refound) {
      r.doc = res.doc;
      r.changed = true;
    }
    say(ctx, res.refound || res.lost ? tr("→ dohledáno {0}, nedohledáno {1} (nedohledané se nekontrolují – označte je znovu)", res.refound, res.lost) : tr("→ nic k dohledání – žádná označená plocha není ze starší revize modelu"));
    return;
  }
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
    case "clear": {
      const keep = ms.filter((m) => {
        if (m.kind !== cmd.what) return true;
        if (cmd.target === "all") return false;
        const w = cmd.target.map(fold);
        const label = fold(m.kind === "datum" ? (m.label ?? "") : markLabel(d, m));
        return !(w.includes(fold(m.id)) || w.join(" ") === label || (m.face && w.includes(`f${m.face.index + 1}`)));
      });
      if (keep.length === ms.length) throw new Error(tr("nic ke zrušení: {0} – {1}", cmd.target === "all" ? tr("vše") : cmd.target.join(" "), functionalListText(d)));
      commit(keep, tr("✓ zrušeno {0} – zbývá {1}", ms.length - keep.length, keep.length));
      return;
    }
    case "datum": {
      const index = Number(cmd.target[0].slice(1)) - 1;
      const geom = await faceGeom(ctx, d, index);
      if (geom?.t !== "plane") throw new Error(tr("základna {0}: plocha F{1} není rovinná – základnou může být jen rovinná plocha", cmd.label, index + 1));
      const next = ms.filter((m) => !(m.kind === "datum" && m.label === cmd.label));
      const pr = await printOf(ctx, d, index);
      next.push({ id: nextId(next), kind: "datum", label: cmd.label, face: { index }, geom, rev: modelRev(d), ...(pr ? { print: pr } : {}) });
      commit(next, tr("✓ základna {0} = F{1} ({2}) – polohy funkčních prvků se kontrolují od ní", cmd.label, index + 1, geomText(next[next.length - 1])));
      return;
    }
    case "profile": {
      // profil jako celek: skica podle názvu, nebo prvek, který ze skici vzniká (vysunutí, rotace, odebrání) → jeho skica
      const words = cmd.target;
      let sk: Feature | undefined;
      let tol = "";
      for (let n = words.length; n >= 1 && !sk; n--) {
        const name = fold(words.slice(0, n).join(" "));
        const f = d.features.find((x) => fold(x.name) === name);
        if (!f) continue;
        const sid = f.type === "sketch" ? f.id : "sketchId" in f ? (f as { sketchId?: string }).sketchId : undefined;
        sk = sid ? d.features.find((x) => x.id === sid && x.type === "sketch") : undefined;
        if (!sk) throw new Error(tr("funkční profil: „{0}“ není skica ani prvek ze skici – skici: {1}", f.name, d.features.filter((x) => x.type === "sketch").map((x) => x.name).join(", ") || "—"));
        tol = words.slice(n).join(" ");
      }
      if (!sk) throw new Error(tr("funkční profil: „{0}“ není skica ani prvek dílu – skici: {1}", words.join(" "), d.features.filter((x) => x.type === "sketch").map((x) => x.name).join(", ") || "—"));
      const users = d.features.filter((f) => "sketchId" in f && (f as { sketchId?: string }).sketchId === sk!.id).map((f) => f.name);
      const next = ms.filter((m) => !(m.kind === "functional" && m.profile === sk!.id));
      const mark: FunctionalMark = { id: nextId(next), kind: "functional", profile: sk.id, ...(tol ? { tol } : {}) };
      next.push(mark);
      commit(next, tr("✓ funkční {0}{1}{2} – kontrola kót chce velikost, polohu{3} a toleranci všech rozměrů profilu", markLabel(d, mark), users.length ? ` (${users.join(", ")})` : "", tol ? tr(" · tolerance {0}", tol) : "", ms.some((m) => m.kind === "datum") ? tr(" od základny") : ""));
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
        if (!hole) {
          const pr = await printOf(ctx, d, t.face!);
          if (pr) mark.print = pr;
        }
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
