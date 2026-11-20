/**
 * Objemový export bez tělesa (vlna 22, bod 22c) – čistá pravidla bez jádra, stejná pro konzoli, CLI (`--formats`), HTTP
 * i export z menu aplikace:
 *  - objemový formát (STEP, BREP, STL, 3MF) z modelu nebo souboru bez jediného objemového tělesa = ✗ `out.no-solid`
 *    (soubor se zapíše, ale není to objemový model – objem a hmotnost z ploch se nepočítají);
 *  - volné skořepiny nebo plochy vedle tělesa = ⚠ `out.free-surfaces` s počty (a u sestavy s názvy komponent);
 *  - „věrná kopie modelu“ smí kontrola napsat jen tehdy, když soubor má ≥ 1 těleso, žádné volné plochy, při znovunačtení
 *    je platný a v počtu těles, objemu a obálce odpovídá modelu (agent-out.ts `exportCheck`).
 */
import { tr } from "./i18n";

/** formáty, které mají nést objemové těleso (síťové STL / 3MF = uzavřená síť; OBJ / glTF / VRML jsou pro zobrazení) */
export const VOLUME_FORMATS = ["step", "brep", "stl", "3mf"] as const;
export type VolumeFormat = (typeof VOLUME_FORMATS)[number];
export const isVolumeFormat = (f: string): f is VolumeFormat => (VOLUME_FORMATS as readonly string[]).includes(f);

/**
 * Složení modelu nebo souboru: `free` = plochy mimo objemová tělesa (jako řádek D `free=`), `freeShells` / `freeFaces` =
 * skořepiny mimo tělesa / plochy mimo skořepiny (jen když je jádro spočítalo), `closedShells` = uzavřené skořepiny
 * (i pláště těles), `closedFree` = uzavřené z volných skořepin (uzavřená skořepina bez „Uzavřít do tělesa“).
 */
export type SolidStats = { solids: number; free?: number; freeShells?: number; closedFree?: number; freeFaces?: number; shells?: number; closedShells?: number };

/** komponenty sestavy bez tělesa / s volnými plochami (jména pro hlášku) */
export type SolidParts = { noSolid: string[]; free: string[] };

/** `text` = „STEP: …“ (štítek formátu + `body`); `body` = věta bez štítku (do „kontrola STEP: …“) */
export type SolidVerdict = { level: "error" | "warn"; code: "out.no-solid" | "out.free-surfaces"; text: string; body: string };

/** kolik ploch je mimo tělesa (ze `free`, jinak z počtů skořepin / ploch) */
export function freeCount(s: SolidStats): number {
  if (s.free !== undefined) return s.free;
  return (s.freeShells ?? 0) + (s.freeFaces ?? 0);
}

/** „skořepin 1 (uzavřených 1), volných ploch 0“ – co místo tělesa v modelu / souboru je */
export function compositionText(s: SolidStats): string {
  const parts: string[] = [];
  if (s.freeShells !== undefined) parts.push(s.closedFree ? tr("volných skořepin {0} (uzavřených {1})", s.freeShells, s.closedFree) : tr("volných skořepin {0}", s.freeShells));
  if (s.freeFaces !== undefined) parts.push(tr("volných ploch {0}", s.freeFaces));
  if (!parts.length && s.free !== undefined) parts.push(tr("ploch mimo tělesa {0}", s.free));
  return parts.join(", ");
}

const listNames = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(", ")} … (+${names.length - 6})` : names.join(", "));

/** text o komponentách sestavy (prázdný, když nejsou) */
export function partsText(p?: SolidParts): string {
  if (!p) return "";
  const out: string[] = [];
  if (p.noSolid.length) out.push(tr("komponenty bez tělesa: {0}", listNames(p.noSolid)));
  if (p.free.length) out.push(tr("komponenty s volnými plochami: {0}", listNames(p.free)));
  return out.length ? ` – ${out.join("; ")}` : "";
}

/**
 * Verdikt o složení modelu nebo souboru pro objemový formát `label` (STEP, BREP, STL, 3MF): ✗ bez tělesa, ⚠ volné plochy
 * vedle tělesa, null = v pořádku (jen tělesa). `where` = „soubor“ (zpětné čtení) nebo „model“ (bez zpětného čtení – síť,
 * „bez kontroly“, export z menu).
 */
export function solidVerdict(s: SolidStats, label: string, where: "file" | "model", parts?: SolidParts): SolidVerdict | null {
  const comp = compositionText(s);
  const out = (level: SolidVerdict["level"], code: SolidVerdict["code"], body: string): SolidVerdict => ({ level, code, body: body + partsText(parts), text: `${label}: ${body}${partsText(parts)}` });
  if (s.solids === 0)
    return out(
      "error",
      "out.no-solid",
      where === "file"
        ? tr("soubor neobsahuje objemové těleso (těles 0{0}) – objem ani hmotnost z ploch nejsou; plochy uzavřete do tělesa (Plochy → Uzavřít do tělesa, prvek surf.close), nebo exportujte jako plochy vědomě", comp ? `, ${comp}` : "")
        : tr("model nemá objemové těleso (těles 0{0}) – soubor nebude objemový model; plochy uzavřete do tělesa (Plochy → Uzavřít do tělesa, prvek surf.close)", comp ? `, ${comp}` : ""),
    );
  const free = freeCount(s);
  if (free > 0 || (parts && (parts.free.length || parts.noSolid.length)))
    return out(
      "warn",
      "out.free-surfaces",
      where === "file"
        ? tr("soubor obsahuje vedle těles ({0}) i plochy mimo tělesa ({1}) – nejsou objemem, objem a hmotnost jsou jen z těles", s.solids, comp || tr("ploch mimo tělesa {0}", free))
        : tr("model má vedle těles ({0}) i plochy mimo tělesa ({1}) – nejsou objemem, objem a hmotnost jsou jen z těles", s.solids, comp || tr("ploch mimo tělesa {0}", free)),
    );
  return null;
}

/** list sestavy (asm-flatten `Leaf`) – jen pole potřebná pro složení */
type LeafLike = { key: string; hidden: boolean; id: string; path: string[]; comp: { name: string } };
/** metriky postaveného dílu (BuildResult.metrics) – jen složení */
type PartMetrics = { solids?: number; free?: number } | null | undefined;

/**
 * Složení sestavy z postavených listových dílů (skryté se neexportují): součet těles a ploch mimo tělesa a jména komponent
 * bez tělesa / s plochami mimo tělesa. Stejné pro engine (`ws.asm.cache`) i aplikaci (mezipaměť dílů v cad-app).
 * null = žádný list nemá známé složení (díly ještě nepostavené).
 */
export function solidsOfLeaves(leaves: readonly LeafLike[], metricsOf: (key: string) => PartMetrics): (SolidStats & { parts: SolidParts }) | null {
  let solids = 0;
  let free = 0;
  let known = 0;
  const noSolid = new Set<string>();
  const withFree = new Set<string>();
  for (const l of leaves) {
    if (l.hidden) continue;
    const m = metricsOf(l.key);
    if (!m || m.solids === undefined) continue;
    known++;
    solids += m.solids;
    free += m.free ?? 0;
    const name = l.comp.name || l.path[l.path.length - 1] || l.id;
    if (m.solids === 0) noSolid.add(name);
    else if (m.free) withFree.add(name);
  }
  return known ? { solids, free, parts: { noSolid: [...noSolid], free: [...withFree] } } : null;
}
