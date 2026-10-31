import type { ContactRole } from "@/lib/contacts/roles";

/**
 * „Faktury zasílejte na fakturace@firma.cz" → role fakturace. Rozpoznání účelu adres v textu e-mailu,
 * dokladu (poznámka, platební podmínky) nebo podpisu — čistá logika (testy v role-detect.test.ts).
 * Hledá se jen v okolí adresy (stejná věta / řádek před ní): klíčové slovo účelu + pokyn k zasílání
 * („zasílejte, posílejte, adresa, e-mail, kontakt, send…") nebo popisek „Fakturace:".
 */

export interface DetectedRoleEmail {
  role: ContactRole;
  email: string;
  /** Úryvek, ze kterého to plyne (pro audit / UI). */
  evidence: string;
}

const EMAIL_G = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const ROLE_WORDS: { role: ContactRole; re: RegExp }[] = [
  { role: "fakturace", re: /(faktur|fakturač|fakturac|účetn|ucetn|účtárn|uctarn|invoice|invoicing|billing|accounts? payable|rechnung|buchhaltung|daňov[ýé] doklad)/gi },
  { role: "nakup", re: /(objednáv|objednav|nákup|nakup|purchas|einkauf|bestellung|purchase order|\bPO\b)/gi },
  { role: "nabidky", re: /(poptáv|poptav|nabíd|nabid|\bRFQ\b|quotation|request for quot|angebot|anfrage|cenov[éá] nabídk)/gi },
  { role: "dodaci_listy", re: /(dodac[íi]\w* list|delivery notes?|lieferschein|p[řr][íi]jem zbo[žz][íi]|goods receipt)/gi },
];

const CUE = /(zas[ií]l|pos[ií]l|zasla|posla|po[sš]le|za[sš]le|adres|e-?mail|kontakt|send|sent to|schick|senden|richten|mailto|směr|smer)/i;
/** Popisek přímo před adresou: „Fakturace: x@y", „Invoices – x@y". */
const LABEL_END = /[:–—-]\s*$/;

/**
 * Najde adresy s jasným účelem. `exclude` = naše vlastní domény / adresy (ty se nikdy nepřiřazují).
 * Jedna adresa = jedna role (nejbližší klíčové slovo před ní).
 */
export function detectRoleEmails(text: string | null | undefined, opts: { exclude?: (email: string) => boolean } = {}): DetectedRoleEmail[] {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  if (!src.includes("@")) return [];
  const out: DetectedRoleEmail[] = [];
  for (const m of src.matchAll(EMAIL_G)) {
    const email = m[0].toLowerCase().replace(/[.'-]+$/, "");
    if (opts.exclude?.(email)) continue;
    if (out.some((o) => o.email === email)) continue;
    const at = m.index ?? 0;
    // okno: od začátku věty / předchozího řádku (max 120 znaků) po adresu
    const before = src.slice(Math.max(0, at - 120), at);
    const cut = Math.max(
      before.lastIndexOf(". "), before.lastIndexOf(".\n"), before.lastIndexOf("\n\n"), before.lastIndexOf("! "), before.lastIndexOf("? "),
    );
    const win = cut >= 0 ? before.slice(cut + 1) : before;
    let best: { role: ContactRole; pos: number } | null = null;
    for (const { role, re } of ROLE_WORDS) {
      re.lastIndex = 0;
      for (const w of win.matchAll(re)) {
        const pos = w.index ?? 0;
        if (!best || pos > best.pos) best = { role, pos };
      }
    }
    if (!best) continue;
    const tail = win.slice(best.pos);
    const after = src.slice(at + m[0].length, at + m[0].length + 24).split(/[.\n]/)[0];
    if (!CUE.test(win) && !CUE.test(after) && !LABEL_END.test(win) && !/[:–—]/.test(tail)) continue;
    out.push({ role: best.role, email, evidence: `${win.trim()} ${m[0]}`.replace(/\s+/g, " ").slice(-160) });
  }
  return out;
}
