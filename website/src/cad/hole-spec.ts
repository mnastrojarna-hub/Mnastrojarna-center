/**
 * Díra: skutečný průměr vrtání (u závitové díry podle volby vrtáku) a tvar dna – jedno místo pro jádro (build.ts),
 * výkres (drawing-dims.ts, drawing-doc.ts), kontrolu kót (dim-check.ts), textové příkazy (agent-hole.ts) i formulář.
 *
 * Závitová díra (`kind: "tapped"`):
 * - `tapDrill` chybí / "table" = vrták z tabulky závitů (M8 → Ø6,8; jemné M18×1,5 → Ø16,5) – chování starších dokumentů;
 * - "minor" = malý průměr vnitřního závitu D1 podle ISO 965-1: D1 = D − 1,082532·P (M8 → 6,647, M12 → 10,106);
 * - "custom" = vrtá se zadaný `diameter` (ruční hodnota z výkresu).
 *
 * Dno slepé díry: `tipAngle` = vrcholový úhel hrotu vrtáku (výchozí 118°, 60–170°); `tipAngle` 180 = ploché dno
 * (rovný konec – sedlo pružiny, frézované dno, vrták s plochým čelem).
 */
import { threadByName, type MetricThread } from "./defaults";
import { cadLocale } from "./i18n";
import type { Feature } from "./types";

type HoleF = Extract<Feature, { type: "hole" }>;
export type TapDrill = NonNullable<HoleF["tapDrill"]>;

/** vrcholový úhel, který znamená ploché dno */
export const FLAT_TIP = 180;
/** výchozí vrcholový úhel hrotu vrtáku */
export const DEFAULT_TIP = 118;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** průměr do hlášky: na tisíciny, desetinná čárka podle jazyka (6,647 / 6.647) */
export const fmtDrill = (n: number): string => r3(n).toLocaleString(cadLocale(), { useGrouping: false, maximumFractionDigits: 3 });

/** Malý průměr vnitřního metrického závitu D1 = D − 1,082532·P (ISO 965-1, zaokrouhleno na 0,001 mm). */
export const threadMinorD = (t: Pick<MetricThread, "d" | "pitch">): number => r3(t.d - 1.082532 * t.pitch);

/** Průměr vrtáku pro závit podle volby (tabulkový / jádro D1 / zadaný). */
export function tapDrillD(t: MetricThread, mode: TapDrill | undefined, custom: number): number {
  if (mode === "minor") return threadMinorD(t);
  if (mode === "custom" && custom > 0) return custom;
  return t.tap;
}

/** Skutečný průměr vrtání díry (u závitové podle `tapDrill`; neznámý závit → zadaný průměr). */
export function holeDrillD(f: Pick<HoleF, "kind" | "thread" | "diameter" | "tapDrill">): number {
  if (f.kind !== "tapped") return f.diameter;
  const t = threadByName(f.thread);
  return t ? tapDrillD(t, f.tapDrill, f.diameter) : f.diameter;
}

/** Má slepá díra ploché dno (bez kužele hrotu)? */
export const isFlatBottom = (f: Pick<HoleF, "tipAngle">): boolean => (f.tipAngle ?? DEFAULT_TIP) >= FLAT_TIP - 1e-9;

/** Vrcholový úhel hrotu pro jádro (60–170°); ploché dno → null. Stav, výkres i formulář ukazují tutéž (oříznutou) hodnotu. */
export function holeTip(f: Pick<HoleF, "tipAngle">): number | null {
  if (isFlatBottom(f)) return null;
  return Math.min(170, Math.max(60, f.tipAngle ?? DEFAULT_TIP));
}

/** Platný zadaný úhel hrotu: 60–170°, nebo 180 = ploché dno (text, upravit i `prvek` odmítnou jiný; jádro jiný ořízne). */
export const tipAngleOk = (v: number): boolean => Math.abs(v - FLAT_TIP) < 1e-9 || (v >= 60 && v <= 170);

/** Vlastní vrták `d` se hodí k závitu: od D1 − P (pod tím je to zástupné číslo starších zápisů) do jmenovitého průměru (bez něj). */
export const drillFitsThread = (d: number, t: Pick<MetricThread, "d" | "pitch">): boolean => d >= threadMinorD(t) - t.pitch - 5e-4 && d < t.d - 5e-4;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Volba vrtáku ze slova (upravit tapDrill=…, prvek hole tapDrill=…): table | minor | custom i česky / německy; jinak null. */
export function tapDrillOf(v: unknown): TapDrill | null {
  const w = fold(String(v ?? "")).trim();
  if (["table", "tabulkovy", "tabulka", "vrtak", "drill", "tap", "tabelle", "bohrer"].includes(w)) return "table";
  if (["minor", "jadro", "core", "d1", "kern", "kerndurchmesser"].includes(w)) return "minor";
  if (["custom", "vlastni", "zadany", "rucni", "manual", "eigen", "eigener", "benutzerdefiniert"].includes(w)) return "custom";
  return null;
}

/** Je díra slepá (ukončení „hloubka“ – jen tam má smysl hrot / ploché dno)? */
export const isBlindHole = (f: Pick<HoleF, "end" | "depth">): boolean => (f.end ? f.end.kind === "blind" : f.depth > 0);

/**
 * Změna závitu díry (formulář): průměr vrtání podle volby vrtáku. Vlastní vrták zůstane, jen když se k novému závitu hodí
 * (D1 − P ≤ d < D – stejně jako text `díra 6,647 závit M10` a `upravit … thread=M10`), jinak tabulkový vrták nového závitu.
 */
export function threadChangePatch(f: Pick<HoleF, "tapDrill" | "diameter">, name: string): Record<string, unknown> {
  const t = threadByName(name);
  if (!t) return { thread: name };
  if (f.tapDrill === "custom") return drillFitsThread(f.diameter, t) ? { thread: name } : { thread: name, tapDrill: undefined, diameter: t.tap };
  return { thread: name, diameter: tapDrillD(t, f.tapDrill, f.diameter) };
}
