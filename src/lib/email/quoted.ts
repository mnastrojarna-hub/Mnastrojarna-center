/**
 * Citovaná historie v textu e-mailu (odpověď nad původní zprávou) — čistá funkce pro detail vlákna:
 * nová část se ukáže celá, citovaná historie (předchozí zprávy vlákna, které už jsou nad ní) se sbalí
 * za tlačítko „Zobrazit citovanou historii".
 *
 * Začátek citace: „-----Original Message-----" / „Původní zpráva" / „Forwarded message" (Outlook, Gmail),
 * „Dne … napsal(a):" / „On … wrote:" (i rozdělené na dva řádky), hlavička Outlooku „Od: … / Odesláno: …"
 * (From/Sent/Date/Datum), nebo souvislý blok řádků „>" až do konce zprávy.
 */

export interface QuotedSplit {
  /** Nová část zprávy (bez citace, bez prázdných řádků na konci). */
  main: string;
  /** Citovaná historie od řádku, kde začíná ("" = žádná). */
  quoted: string;
  /** Počet řádků citace. */
  quotedLines: number;
}

const SEPARATOR_RE = /^\s*-{2,}\s*(original message|původní zpráva|puvodni zprava|forwarded message|přeposlaná zpráva|preposlana zprava|původní e-mail)\s*-{2,}\s*$/i;
const WROTE_RE = /^\s*(dne|on|am|le)\b.{3,200}(napsal\(a\)|napsal|napsala|wrote|schrieb|a écrit)\s*:\s*$/i;
const WROTE_START_RE = /^\s*(dne|on)\s.{3,200}$/i;
const WROTE_END_RE = /^.{0,200}(napsal\(a\)|napsal|napsala|wrote)\s*:\s*$/i;
const HEADER_FROM_RE = /^\s*\*?(from|od)\s*:\*?\s+\S/i;
const HEADER_NEXT_RE = /^\s*\*?(sent|odesláno|odeslano|date|datum|to|komu|subject|předmět|predmet)\s*:/i;

/** Rozdělí text e-mailu na novou část a citovanou historii. Bez citace → { main: text, quoted: "" }. */
export function splitQuoted(text: string): QuotedSplit {
  const src = (text ?? "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SEPARATOR_RE.test(l) || WROTE_RE.test(l)) { cut = i; break; }
    if (WROTE_START_RE.test(l) && i + 1 < lines.length && WROTE_END_RE.test(lines[i + 1]) && !WROTE_RE.test(l)) { cut = i; break; }
    if (HEADER_FROM_RE.test(l) && lines.slice(i + 1, i + 4).some((n) => HEADER_NEXT_RE.test(n))) {
      // hlavička Outlooku před citací — ne první řádek zprávy (to je přeposlání bez vlastního textu)
      cut = i;
      break;
    }
    // souvislý blok „>" až do konce (prázdné řádky smí)
    if (/^\s*>/.test(l) && lines.slice(i).every((n) => /^\s*>/.test(n) || !n.trim())) { cut = i; break; }
  }
  if (cut <= 0) return { main: src.replace(/\s+$/, ""), quoted: "", quotedLines: 0 };
  const main = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  // celá zpráva je jen citace (přeposlání bez textu) → nic nesbalovat
  if (!main.trim()) return { main: src.replace(/\s+$/, ""), quoted: "", quotedLines: 0 };
  const quotedArr = lines.slice(cut);
  while (quotedArr.length && !quotedArr[quotedArr.length - 1].trim()) quotedArr.pop();
  return { main, quoted: quotedArr.join("\n"), quotedLines: quotedArr.length };
}
