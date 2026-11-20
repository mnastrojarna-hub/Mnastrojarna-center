/**
 * Provedení `výkres pozice …` (parser cad/agent-drawing-pos.ts) nad aktivním listem sestavy (vlna 22, bod 17) a řádky stavu
 * pozic, kusovníku a překryvů pro `výkres stav` / `výkres pozice` (stejný text v konzoli, CLI i `window.mncad`):
 * - přiřazení pozic pohledům = volba listu `balloonViews` (pos → pohled), `auto` přiřazení zruší;
 * - zámek = `genEdit.lock` (absolutní střed balónku z přepočtu listu; klíče `pos:<n>` vlny E) – přežije přepočet modelu;
 * - každý příkaz list přepočítá a vypíše výsledek kontroly překryvů (nikdy „překryvy 0“ bez kontroly).
 */
import type { PosCmd } from "./agent-drawing-pos";
import { VIEW_CS } from "./agent-drawing";
import { rangesText } from "./drawing-balloons";
import { lockGenerated } from "./drawing-boxsel";
import { withAnnotations, type DrawingOptions, type DrawingResult, type GenEdit } from "./drawing";
import { overlapAdvice, overlapSummary, sheetOverlaps, type SheetOverlaps } from "./drawing-overlaps";
import { tr } from "./i18n";
import type { DrawingDoc, Vec2 } from "./types";

type Ctx = { sheet: () => DrawingDoc; put: (s: DrawingDoc) => void; compute: () => Promise<DrawingResult> };
const viewName = (k: string) => tr(VIEW_CS[k as keyof typeof VIEW_CS] ?? k);

/** řádky stavu: pozice po pohledech, kusovník, překryvy (`ov` = výsledek kontroly překryvů hotového listu) */
export function positionLines(res: DrawingResult, o: Partial<DrawingOptions>, ov: SheetOverlaps | null): string[] {
  const L: string[] = [];
  const bs = res.balloons ?? [];
  if (bs.length || o.balloonViews || o.genEdit?.lock) {
    const byView = new Map<string, number[]>();
    for (const b of bs) byView.set(b.view ?? "front", [...(byView.get(b.view ?? "front") ?? []), b.pos]);
    const views = [...byView.entries()].map(([k, ps]) => `${viewName(k)} ${ps.length}`).join(", ");
    const info = res.balloonInfo;
    L.push(
      tr("Pozice: {0} ({1}) · přiřazené ručně {2} · posunuté {3} · zamčené {4} · nevešlo se {5} · křížení odkazů {6}", bs.length, views || "—", bs.filter((b) => b.assigned === "user").length, bs.filter((b) => b.mode === "moved").length, bs.filter((b) => b.mode === "locked").length, info?.lost ?? 0, info?.crossings ?? 0),
    );
    for (const [k, ps] of byView) L.push(`  ${viewName(k)}: ${rangesText(ps)}`);
    if (info?.missingView.length) L.push(tr("⚠ pozice {0}: přiřazený pohled na listu není – leží u jiného pohledu (zapněte pohled: výkres pohledy … nebo výkres pozice pohled auto {0})", rangesText(info.missingView)));
  }
  const bl = res.bomLayout;
  if (bl) {
    const where = bl.mode === "only" ? tr("list jen s kusovníkem ({0} sloupců)", bl.cols) : bl.mode === "sheet" ? tr("na samostatném listu (výkres kusovník list)") : bl.mode === "columns" ? tr("ve {0} sloupcích – první nad razítkem, další vlevo od razítka", bl.cols) : tr("nad razítkem");
    L.push(tr("Kusovník: {0} řádků · {1}{2}", bl.rows, where, bl.hidden ? tr(" · ⚠ {0} řádků se nevešlo", bl.hidden) : ""));
  }
  if (ov) L.push(ov.total ? tr("Překryvy na listu: {0} – {1}", overlapSummary(ov), overlapAdvice(ov)) : tr("Překryvy na listu: 0 (zkontrolováno: balónky, odkazové čáry, texty, kóty, geometrie pohledů, tabulky, rám) · křížení odkazů {0}", ov.crossings));
  else L.push(tr("Překryvy na listu: nezkontrolováno"));
  return L;
}

/** kontrola překryvů hotového listu (výsledek jádra + poznámky listu) */
export const overlapsOf = (res: DrawingResult, s: DrawingDoc): SheetOverlaps => sheetOverlaps(withAnnotations(res, s.annotations));

/** Provede `výkres pozice …` nad aktivním listem. */
export async function applyPosCmd(ctx: Ctx, cmd: Exclude<PosCmd, { op: "bomsheet" }>): Promise<{ log: string[]; changed: boolean; open: boolean }> {
  const o = () => ctx.sheet().options as Partial<DrawingOptions>;
  const setOpts = (patch: Partial<DrawingOptions>) => {
    const next = { ...ctx.sheet().options, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    ctx.put({ ...ctx.sheet(), options: next });
  };
  let res = await ctx.compute();
  const all = [...new Set((res.balloons ?? []).map((b) => b.pos))];
  if (!all.length && !(cmd.act === "view" && cmd.view === "auto")) {
    if (cmd.act === "list") return { log: [tr("Pozice: — (list nemá pozice – jen výkres sestavy s balónky: výkres pozice ano)"), ...positionLines(res, o(), overlapsOf(res, ctx.sheet()))], changed: false, open: false };
    throw new Error(tr("list nemá pozice – jen výkres sestavy s balónky (výkres pozice ano)"));
  }
  const pick = (ps: number[] | "all") => {
    if (ps === "all") return all;
    const miss = ps.filter((p) => !all.includes(p));
    if (miss.length) throw new Error(tr("pozice {0} na listu nejsou – pozice listu: {1}", rangesText(miss), rangesText(all)));
    return ps;
  };
  const log: string[] = [];
  let changed = false;
  switch (cmd.act) {
    case "list":
      break;
    case "view": {
      const map: Record<string, string> = { ...(o().balloonViews ?? {}) };
      const ps = cmd.positions === "all" ? (cmd.view === "auto" ? Object.keys(map).map(Number) : all) : cmd.view === "auto" ? cmd.positions : pick(cmd.positions);
      if (cmd.view !== "auto" && !res.views.some((v) => v.key === cmd.view) && !(cmd.view === "iso" && o().views?.iso !== false)) throw new Error(tr("pohled {0} na listu není – zapněte ho (výkres pohledy …)", viewName(cmd.view)));
      for (const p of ps) {
        if (cmd.view === "auto") delete map[String(p)];
        else map[String(p)] = cmd.view;
      }
      // ruční posun pozice patří k původnímu pohledu – přiřazením jinam se zruší (zámek zůstává)
      const g = o().genEdit;
      const move = { ...(g?.move ?? {}) };
      for (const p of ps) delete move[`pos:${p}`];
      setOpts({ balloonViews: Object.keys(map).length ? map : undefined, genEdit: g ? ({ ...g, move } as GenEdit) : undefined });
      changed = true;
      log.push(cmd.view === "auto" ? tr("✓ pozice {0}: pohled automaticky", rangesText(ps)) : tr("✓ pozice {0} → pohled {1}", rangesText(ps), viewName(cmd.view)));
      break;
    }
    case "lock":
    case "unlock": {
      const ps = pick(cmd.positions);
      const at = (k: string): Vec2 | null => {
        if (cmd.act === "unlock") return null;
        const b = res.balloons?.find((x) => (x.id ?? `pos:${x.pos}`) === k);
        return b ? [b.x, b.y] : null;
      };
      setOpts({ genEdit: lockGenerated(o().genEdit, ps.map((p) => `pos:${p}`), at) });
      changed = true;
      log.push(cmd.act === "lock" ? tr("✓ pozice {0} zamčeny na místě – přepočet ani nové rozmístění ostatních je neposune (výkres pozice odemknout {0})", rangesText(ps)) : tr("✓ pozice {0} odemčeny – rozmístí se automaticky", rangesText(ps)));
      break;
    }
  }
  if (changed) res = await ctx.compute();
  log.push(...positionLines(res, o(), overlapsOf(res, ctx.sheet())));
  return { log, changed, open: changed };
}
