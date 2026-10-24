/**
 * Kvalita textové vrstvy PDF (spec §2.2 krok 4): podíl znaků z PUA, řídicích znaků a „�",
 * podíl jednoznakových položek, písma bez ToUnicode, kotvy razítka. Skóre < 0,8 = stránka jde
 * cestou vision nad renderem (text se nedá věřit — SHX křivky, rozbité kódování).
 */

export interface TextQualityInput {
  strings: readonly string[];
  /** Počet položek, jejichž písmo nemá ToUnicode (pokud je známo). */
  noToUnicodeItems?: number;
  /** Byly nalezeny kotvy razítka (Kreslil, Číslo výkresu…)? */
  hasTitleAnchors: boolean;
  /** Je v oblasti razítka inkoust (z renderu)? null = neznámo. */
  titleBlockInk?: boolean | null;
}

export interface TextQuality {
  score: number;
  trustworthy: boolean;
  badFraction: number;
  singleCharFraction: number;
  reasons: string[];
}

const PUA = /[-]/u;
// řídicí znaky kromě tabulátoru a konců řádku
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

export function textQuality(input: TextQualityInput): TextQuality {
  let chars = 0;
  let bad = 0;
  let single = 0;
  let items = 0;
  for (const s of input.strings) {
    if (!s) continue;
    const trimmed = s.trim();
    if (!trimmed) continue;
    items++;
    const cps = Array.from(trimmed);
    if (cps.length === 1) single++;
    for (const ch of cps) {
      chars++;
      if (PUA.test(ch) || CTRL.test(ch) || ch === "�") bad++;
    }
  }
  const reasons: string[] = [];
  const badFraction = chars ? bad / chars : 0;
  const singleCharFraction = items ? single / items : 0;
  let score = 1 - 4 * badFraction - 0.6 * Math.max(0, singleCharFraction - 0.5);
  if (badFraction > 0.02) reasons.push("neplatné znaky v textové vrstvě");
  if (singleCharFraction > 0.7) reasons.push("text rozsypaný po znacích");
  if (input.noToUnicodeItems && items) {
    const f = input.noToUnicodeItems / items;
    score -= 0.5 * f;
    if (f > 0.3) reasons.push("písma bez ToUnicode");
  }
  if (!input.hasTitleAnchors && input.titleBlockInk) {
    score = Math.min(score, 0.5);
    reasons.push("razítko bez textu (text jako křivky)");
  }
  if (!items && input.titleBlockInk) {
    score = 0;
    reasons.push("stránka bez textové vrstvy");
  }
  score = Math.max(0, Math.min(1, score));
  return { score, trustworthy: score >= 0.8, badFraction, singleCharFraction, reasons };
}
