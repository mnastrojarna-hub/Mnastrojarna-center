/**
 * Komentář na konci řádku textových příkazů: „# …“ / „// …“ za mezerou. Komentářem NENÍ „#e03930“ (barva), „#2“ (pořadí
 * komponenty) ani znak „#“ / „//“ uvnitř textu v uvozovkách ("…" / „…“) – název dílu „Držák # levý“, poznámka výkresu
 * „4x M6 // viz detail A“ nebo text v řádku JSON se dřív na tomto místě tiše uřízly.
 *
 * Uvozovka bez párové uvozovky dál na řádku se za začátek textu nepovažuje (řádek se čte jako dřív). Na řádku JSON
 * (začíná „{“ / „[“) se respektuje zpětné lomítko před uvozovkou (`\"`). Čistá funkce; volá ji agent.ts a doc-script.ts
 * (rozhodnutí, zda jde text zapsat na řádek skriptu).
 */
const COMMENT = /\s+(#(?!(?:[0-9a-f]{3}|[0-9a-f]{6})\b|\d)|\/\/)/gi;

/** leží pozice `pos` uvnitř textu v uvozovkách, který na řádku i končí? */
function insideQuotes(raw: string, pos: number, json: boolean): boolean {
  let open: '"' | "„" | null = null;
  const escaped = (i: number) => {
    if (!json) return false;
    let n = 0;
    for (let k = i - 1; k >= 0 && raw[k] === "\\"; k--) n++;
    return n % 2 === 1;
  };
  for (let i = 0; i < pos; i++) {
    const ch = raw[i];
    if (open === null) {
      if (ch === '"') open = '"';
      else if (ch === "„" && !json) open = "„";
    } else if (open === '"' ? ch === '"' && !escaped(i) : ch === "“") open = null;
  }
  if (open === null) return false;
  for (let i = pos; i < raw.length; i++) if (open === '"' ? raw[i] === '"' && !escaped(i) : raw[i] === "“") return true;
  return false;
}

/** Řádek bez komentáře na konci (neořezává okraje). */
export function stripLineComment(raw: string): string {
  const json = /^\s*[[{]/.test(raw);
  COMMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT.exec(raw))) {
    if (!insideQuotes(raw, m.index, json)) return raw.slice(0, m.index);
    COMMENT.lastIndex = m.index + m[0].length;
  }
  return raw;
}
