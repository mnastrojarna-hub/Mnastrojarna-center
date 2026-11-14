/**
 * Textový odkaz na komponentu sestavy (výběr `vyber` / `window.mncad.select` / `selection()` a `měřit`), který vede
 * vždy na tutéž instanci – i když sestava obsahuje víc stejně pojmenovaných komponent (dvakrát vložený díl):
 *
 *   Čep        název, je-li v sestavě jedinečný
 *   Rám/Čep    cesta podsestavou, je-li jedinečná
 *   #2 · #2/Čep  pořadí komponenty nejvyšší úrovně (jako `sestava … #2`), u dílu v podsestavě s cestou uvnitř
 *
 * Víceznačný název je chyba s výčtem odkazů – nikdy se tiše nevybere první instance.
 */
import { tr } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";
import type { Leaf } from "./asm-flatten";

const low = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Odkaz na list sestavy (díl), který `leafByRef` přečte zpět na tentýž list. */
export function leafRef(doc: CadDoc, leaves: Leaf[], l: Leaf): string {
  const n = low(l.comp.name);
  if (leaves.filter((x) => low(x.comp.name) === n).length === 1) return l.comp.name;
  const path = l.path.join("/");
  if (l.path.length > 1 && leaves.filter((x) => low(x.path.join("/")) === low(path)).length === 1) return path;
  const k = (doc.components ?? []).findIndex((c) => c.id === l.topId);
  return `#${k + 1}${l.path.length > 1 ? `/${l.path.slice(1).join("/")}` : ""}`;
}

/** Odkaz na komponentu podle id (list i podsestava nejvyšší úrovně); neznámé id vrátí beze změny. */
export function compRef(doc: CadDoc, leaves: Leaf[], id: string): string {
  const l = leaves.find((x) => x.id === id);
  if (l) return leafRef(doc, leaves, l);
  const comps = doc.components ?? [];
  const k = comps.findIndex((c) => c.id === id);
  if (k < 0) return id;
  const n = low(comps[k].name);
  return comps.filter((c) => low(c.name) === n).length > 1 ? `#${k + 1}` : comps[k].name;
}

/** List sestavy podle odkazu (`leafRef`, název, cesta, `#2`, `#2/Díl`); víceznačný název → chyba s výčtem odkazů. */
export function leafByRef(doc: CadDoc, leaves: Leaf[], ref: string): Leaf {
  const r = ref.trim();
  const all = () => leaves.map((l) => leafRef(doc, leaves, l)).join(", ") || "—";
  const m = /^#(\d+)(?:\/(.+))?$/.exec(r);
  if (m) {
    const top = (doc.components ?? [])[Number(m[1]) - 1];
    const rest = m[2] ? low(m[2]) : "";
    const hit = top ? leaves.find((l) => l.topId === top.id && (rest ? low(l.path.slice(1).join("/")) === rest : l.id === top.id)) : undefined;
    if (!hit) throw new Error(tr("komponenta „{0}“ v sestavě není – komponenty: {1}", r, all()));
    return hit;
  }
  const q = low(r);
  for (const key of [(l: Leaf) => low(l.comp.name), (l: Leaf) => low(l.path.join("/"))]) {
    const hits = leaves.filter((l) => key(l) === q);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(tr("„{0}“ je v sestavě {1}× – zadejte pořadí: {2}", r, hits.length, hits.map((l) => leafRef(doc, leaves, l)).join(", ")));
  }
  throw new Error(tr("komponenta „{0}“ v sestavě není – komponenty: {1}", r, all()));
}
