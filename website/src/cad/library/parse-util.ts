/** Tolerantní rozbor textového dotazu („M8x30“, „IPE 200 L=1500“, „ložisko 6205 2RS“). */

/** Normalizace: malá písmena, bez diakritiky, × * → x, desetinná čárka → tečka, sjednocené mezery. */
export function norm(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[×*]/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\bo\s*(\d)/g, "o$1")
    .replace(/[ø⌀]/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

/** Všechna čísla v pořadí výskytu. */
export function nums(q: string): number[] {
  return (q.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** První skupina rozměrů „a x b x c“ (např. „40x40x3“). */
export function dims(q: string): number[] {
  const m = q.match(/(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))+/);
  if (!m) return [];
  return (m[0].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Metrický závit „m8“, „m 10“, „m12x1.25“ (jemný se ignoruje) → „M8“. */
export function metric(q: string): string | null {
  const m = q.match(/(?:^|[^a-z0-9])m\s?(\d{1,2})(?!\d)/);
  return m ? `M${m[1]}` : null;
}

/** Délka: „l=1500“, „l 1500“, „délka 30“, nebo číslo za metrickým označením („m8x30“, „m8 30“). */
export function length(q: string): number | null {
  const m = q.match(/\b(?:l|delka|length|dl)\s*[=:]?\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  return null;
}

/** Hodnota za písmenem: „z24“ „z 24“, „n10“, „d1.6“, „b20“. */
export function tagged(q: string, tag: string): number | null {
  const m = q.match(new RegExp(`(?:^|[^a-z])${tag}\\s?=?\\s?(\\d+(?:\\.\\d+)?)(?!\\d)`));
  return m ? Number(m[1]) : null;
}

/** Je v dotazu některé z klíčových slov (prefixová shoda na začátku slova)? Vrací délku nejdelší shody. */
export function has(q: string, ...words: string[]): number {
  let best = 0;
  for (const w of words) {
    const re = new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (re.test(q)) best = Math.max(best, w.length);
  }
  return best;
}

/** Skóre: klíčové slovo (0–0.6) + rozpoznané parametry (0–0.4). */
export const score = (kw: number, params: number) => Math.min(1, (kw ? 0.6 : 0) + params);

export const roundTo = (v: number, step: number) => Math.round(v / step) * step;
