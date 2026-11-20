/**
 * Pozice (balónky) výkresu sestavy textem (vlna 22, bod 17) – čistý parser bez jádra:
 * - `výkres pozice` – přehled pozic po pohledech (ručně / auto, posunuté, zamčené), překryvy a křížení odkazů,
 * - `výkres pozice pohled horní 1-12,15` – přiřazení pozic pohledu; `výkres pozice pohled auto [1-12]` = zpět automaticky,
 * - `výkres pozice zamknout 7 8` / `odemknout 7` (= `výkres vygenerované zamknout pos:7` – táž rodina úprav vlny E),
 * - `výkres kusovník list` – kusovník na samostatný list (nový list jen s kusovníkem, tento list ho nekreslí).
 * `výkres pozice ano|ne` zůstává volbou listu (balónky zapnout / vypnout). Česky, anglicky (`drawing balloons|positions …
 * view top …`, `lock`, `unlock`, `drawing bom sheet`) i německy (`zeichnung positionen ansicht oben …`, `sperren`,
 * `entsperren`, `zeichnung stückliste blatt`). Provedení: cad/drawing-pos-agent.ts.
 */
import type { RawTok } from "./agent-drawing";
import { parsePositions } from "./drawing-balloons";
import { tr } from "./i18n";

export type PosCmd =
  | { op: "pos"; act: "list" }
  | { op: "pos"; act: "view"; view: string; positions: number[] | "all" }
  | { op: "pos"; act: "lock" | "unlock"; positions: number[] | "all" }
  | { op: "bomsheet" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w);
export const POS_W = W("pozice", "pozici", "balonky", "balonek", "positions", "position", "balloons", "balloon", "positionen", "positionsnummern", "positionsnummer");
const VIEW_W = W("pohled", "pohledu", "view", "ansicht");
const LOCK_W = W("zamknout", "zamkni", "zamcit", "lock", "pin", "sperren", "fixieren", "festsetzen");
const UNLOCK_W = W("odemknout", "odemkni", "unlock", "unpin", "entsperren", "losen", "loesen");
const ALL_W = W("vse", "vsechny", "all", "alle");
const AUTO_W = W("auto", "automaticky", "automatic", "automatisch");
const YESNO = W("ano", "yes", "ja", "on", "true", "zapnout", "zap", "ne", "no", "nein", "off", "false", "vypnout", "vyp", "zadne", "none", "keine", "kein", "aus");
const BOM_W = W("kusovnik", "bom", "stuckliste", "partslist");
const SHEET_W = W("list", "sheet", "blatt", "samostatny", "separate", "eigenes");
/** pohledy pro pozice (cs / en / de) */
export const POS_VIEW_WORDS: Record<string, string> = {
  predni: "front", front: "front", vorne: "front", vorderansicht: "front", hlavni: "front",
  zadni: "back", back: "back", hinten: "back", rueckansicht: "back", ruckansicht: "back",
  horni: "top", top: "top", shora: "top", oben: "top", draufsicht: "top",
  spodni: "bottom", bottom: "bottom", zdola: "bottom", unten: "bottom", untersicht: "bottom",
  levy: "left", left: "left", zleva: "left", links: "left",
  pravy: "right", right: "right", zprava: "right", rechts: "right",
  iso: "iso", izometrie: "iso", isometrie: "iso", isometric: "iso", isometrisch: "iso", izo: "iso",
};

export const POS_USE = () => tr("výkres pozice · výkres pozice pohled přední|horní|levý|pravý|zadní|spodní|izometrie|auto <pozice: 1-12,15 | vše> · výkres pozice zamknout|odemknout <pozice> · výkres kusovník list");

function positionsOf(rt: RawTok[]): number[] | "all" {
  if (!rt.length) throw new Error(POS_USE());
  if (rt.length === 1 && !rt[0].q && ALL_W.has(fold(rt[0].s))) return "all";
  try {
    const ps = parsePositions(rt.map((t) => t.s).join(" "));
    if (!ps.length) throw new Error("");
    return ps;
  } catch {
    throw new Error(tr("výkres pozice: „{0}“ nejsou čísla pozic – např. 1-12,15 nebo vše; {1}", rt.map((t) => t.s).join(" "), POS_USE()));
  }
}

/** `výkres pozice …` / `výkres kusovník list` (tokeny za slovem výkres) → povel; null = jiný podpříkaz (i `výkres pozice ano|ne`) */
export function parsePosText(rt: RawTok[]): PosCmd | null {
  const h = rt[0];
  if (!h || h.q || h.key) return null;
  const f = fold(h.s);
  if (BOM_W.has(f)) return rt.length === 2 && !rt[1].q && SHEET_W.has(fold(rt[1].s)) ? { op: "bomsheet" } : null;
  if (!POS_W.has(f)) return null;
  const a = rt[1];
  if (!a) return { op: "pos", act: "list" };
  const w = a.q ? "" : fold(a.s);
  if (YESNO.has(w)) return null; // volba listu výkres pozice ano|ne
  if (VIEW_W.has(w)) {
    const v = rt[2];
    const vw = v && !v.q ? fold(v.s) : "";
    const view = AUTO_W.has(vw) ? "auto" : POS_VIEW_WORDS[vw];
    if (!view) throw new Error(tr("výkres pozice pohled: „{0}“ není pohled – přední, horní, levý, pravý, zadní, spodní, izometrie nebo auto", v?.s ?? ""));
    if (view === "auto" && rt.length === 3) return { op: "pos", act: "view", view, positions: "all" };
    return { op: "pos", act: "view", view, positions: positionsOf(rt.slice(3)) };
  }
  if (LOCK_W.has(w)) return { op: "pos", act: "lock", positions: positionsOf(rt.slice(2)) };
  if (UNLOCK_W.has(w)) return { op: "pos", act: "unlock", positions: positionsOf(rt.slice(2)) };
  throw new Error(tr("výkres pozice: neznámé „{0}“ – {1}", a.s, POS_USE()));
}
