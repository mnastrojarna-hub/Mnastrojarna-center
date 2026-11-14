/**
 * Funkční rozměry výkresu (vlna 15, B7/B8, 5.3) – čisté funkce bez jádra:
 * - `sameSize`: zadaná hodnota = rozměr modelu (±1e-6 skutečné hodnoty, ne zaokrouhleného popisku);
 * - `chooseReference`: který článek uzavřeného řetězu bude pomocná kóta „(…)“ – nikdy funkční rozměr
 *   (`kótovat … funkční 26,5 74,175`); jsou-li funkční všechny články, pomocná je celková délka; jsou-li funkční i ta,
 *   řetěz se rozbít nedá (hlášení);
 * - `toleranceCheck`: `výkres kontrola tolerancí` – funkční rozměry (a tolerované rozměry předlohy) bez tolerance na listu.
 */
import { tr } from "./i18n";

/**
 * Zadaná hodnota odpovídá rozměru modelu: ±1e-6 skutečné hodnoty (74,175 = 74,175 – ne zaokrouhlený popisek „74,18“),
 * nebo zápis na tisíciny u rozměru s více desetinnými místy (6,647 = 6,6472…).
 */
export const sameSize = (user: number, model: number) => Number.isFinite(user) && Number.isFinite(model) && (Math.abs(model - user) <= 1e-6 || Math.abs(Math.round(model * 1000) / 1000 - user) <= 1e-9);

/** rozměr `l` je mezi funkčními */
export const isFunctional = (l: number, functional: readonly number[]) => functional.some((v) => sameSize(v, l));

/**
 * Pomocná kóta uzavřeného řetězu (řetěz článků + celková délka, ISO 129-1): nejdelší článek, který není funkční;
 * jsou-li funkční všechny články, celková délka („overall“); jsou-li funkční i ta, nejdelší článek a `note` (řetěz zůstává
 * přeurčený funkčními rozměry – jeden je pomocný).
 */
export function chooseReference(links: readonly number[], overall: number, functional: readonly number[]): { ref: number | "overall"; note?: string } {
  const free = links.map((l, i) => ({ l, i })).filter((x) => !isFunctional(x.l, functional));
  if (free.length) return { ref: free.reduce((m, x) => (x.l > m.l ? x : m)).i };
  if (!isFunctional(overall, functional)) return { ref: "overall" };
  const i = links.reduce((m, l, k) => (l > links[m] ? k : m), 0);
  return { ref: i, note: tr("uzavřený řetěz: všechny články i celková délka jsou funkční – pomocnou kótou zůstává nejdelší článek; zrušte funkčnost jednoho z nich (kótovat … funkční …)") };
}

/** kóta na listu pro kontrolu tolerancí; `dia` = průměr / závit (Ø, M, popis díry) – funkční délky se s ním nepárují */
export type TolDim = { id: string; label: string; value: number; view: string; tolerance: string; reference: boolean; dia?: boolean };
/** tolerovaný rozměr předlohy (balík předlohy – výtah kót): hodnota a tolerance, `dia` = průměr; popisek a pohled jen pro hlášení */
export type RefTolDim = { value: number; tolerance: string; label?: string; view?: string; dia?: boolean };
export type TolCheckRow = { value: number; kind: "functional" | "reference"; status: "ok" | "missing-tol" | "missing-dim" | "reference"; dims: TolDim[]; expect?: string };

/**
 * Kontrola tolerancí (5.3): každý funkční rozměr a každý tolerovaný rozměr předlohy musí být na listu kótou s tolerancí.
 * `status`: ok · missing-tol (kóta bez tolerance) · missing-dim (rozměr na listu není) · reference (jen pomocná kóta „(…)“).
 */
export function toleranceCheck(dims: readonly TolDim[], functional: readonly number[], reference: readonly RefTolDim[] = []): TolCheckRow[] {
  const rows: TolCheckRow[] = [];
  const row = (value: number, kind: TolCheckRow["kind"], expect?: string, dia?: boolean) => {
    const hits = dims.filter((d) => sameSize(value, d.value) && (dia === undefined || !!d.dia === dia));
    const real = hits.filter((d) => !d.reference);
    const status: TolCheckRow["status"] = !hits.length ? "missing-dim" : !real.length ? "reference" : real.some((d) => d.tolerance.trim()) ? "ok" : "missing-tol";
    rows.push({ value, kind, status, dims: hits, ...(expect ? { expect } : {}) });
  };
  // funkční rozměry (kótovat … funkční) jsou délky – ne průměry
  for (const v of functional) row(v, "functional", undefined, false);
  for (const r of reference) if (r.tolerance.trim() && !(functional.some((v) => sameSize(v, r.value)) && !r.dia)) row(r.value, "reference", r.tolerance, r.dia ?? (r.label ? /^[ØM⌀]/.test(r.label) : undefined));
  return rows;
}

/** rozměr uzavřeného řetězu na listu (článek nebo celková délka): hodnota a zda nese toleranci */
export type ChainMember = { value: number; tol: boolean };

/**
 * Přeurčený řetěz (B8): funkční má být i `value` (tolerance na pomocné kótě) – jsou-li pak funkční všechny rozměry řetězu
 * (články i celková délka), jeden musí zůstat pomocný. Pomocným se stane nejdelší funkční rozměr BEZ tolerance (`drop` = jeho
 * hodnota se z funkčních vyřadí); nemá-li toleranci žádný jiný rozměr, řetěz rozbít nejde (`stuck`). null = řetěz přeurčený
 * nebude (stačí přidat `value` mezi funkční).
 */
export function overdeterminedChain(members: readonly ChainMember[], value: number, functional: readonly number[]): { drop: number } | { stuck: true } | null {
  const fun = [...functional, value];
  if (!members.length || !members.every((m) => isFunctional(m.value, fun))) return null;
  const free = members.filter((m) => !sameSize(m.value, value) && !m.tol);
  if (!free.length) return { stuck: true };
  return { drop: free.reduce((a, b) => (b.value > a.value ? b : a)).value };
}
