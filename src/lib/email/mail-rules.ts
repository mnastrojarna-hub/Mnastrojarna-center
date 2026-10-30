import type { EmailCategory, PriorityLevel } from "@/lib/supabase/database.types";

/**
 * Třídění pošty BEZ AI (pravidla) — pro starší poštu při stažení celé schránky (AI jen pro nové,
 * viz ingest), a když AI není zapnutá. Kategorie, spam a priorita podle předmětu, textu a hlaviček.
 * AI se nad e-mailem může spustit později na požádání (emails.ai_pending). Testy v mail-rules.test.ts.
 */

export interface RuleInput {
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  body?: string | null;
  /** Hlavičky (malými písmeny): list-unsubscribe, precedence, auto-submitted, x-spam-flag, x-spam-status. */
  headers?: Record<string, string | undefined> | null;
}

export interface RuleResult {
  category: EmailCategory;
  isSpam: boolean;
  priority: PriorityLevel;
  /** Hromadná / automatická zpráva (newsletter, notifikace). */
  bulk: boolean;
}

function fold(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const RULES: { category: EmailCategory; subject: RegExp; body?: RegExp }[] = [
  { category: "reklamace", subject: /\b(reklamac|complaint|reklamation|nekvalit|vadn[ey]|zmetk)/ },
  { category: "upominka", subject: /\b(upominka|upominam|reminder|mahnung|po splatnosti|overdue|dluzn)/ },
  { category: "faktura", subject: /\b(faktur|invoice|rechnung|danovy doklad|dobropis|zalohov[aey] list)/ },
  { category: "potvrzeni_objednavky", subject: /\b(potvrzeni objednavky|order confirmation|auftragsbestatigung|bestatigung|potvrzujeme objednavku|confirmation of order)/ },
  { category: "objednavka", subject: /\b(objednavk|objednavame|order\b|purchase order|bestellung|\bpo[ -]?\d{4,})/, body: /\b(objednavame|zavazne objedn|purchase order)\b/ },
  { category: "poptavka", subject: /\b(poptavk|poptavam|rfq|request for (a )?quot|anfrage|inquiry|enquiry|cenov[aou] nabidk[auy] na|nacenen)/, body: /\b(poptavam|prosim o (cenovou )?nabidku|prosim o naceneni|request for quotation)\b/ },
  { category: "nabidka_dodavatele", subject: /\b(nabidka|nabidku|quotation|angebot|offer|cenik)\b/ },
  { category: "technicka_dokumentace", subject: /\b(vykres|drawing|zeichnung|step\b|\.stp|dxf|dokumentac|revize|revision)\b/ },
];

const SPAM_RE = /\b(viagra|cialis|casino|lottery|loterie|bitcoin investment|crypto profit|you have won|vyhral[ia]? jste|seo services|web design offer|dear friend|nigerian|wire transfer urgently|make money fast|unsubscribe now to stop)\b/;
const URGENT_RE = /\b(urgent|naleh|spech|asap\b|ihned|okamzit|dnes nutn|kritick|zastaven[aá] (linka|vyroba)|stoji linka|line stop)/;

export function ruleCategorize(input: RuleInput): RuleResult {
  const subject = fold(input.subject);
  const body = fold((input.body ?? "").slice(0, 4000));
  const h = input.headers ?? {};
  const spamHeader = /^\s*yes/i.test(h["x-spam-flag"] ?? "") || /^\s*yes/i.test(h["x-spam-status"] ?? "");
  const bulk = Boolean(h["list-unsubscribe"]) || /bulk|list|junk/i.test(h["precedence"] ?? "") || /auto-(generated|replied)/i.test(h["auto-submitted"] ?? "");
  const isSpam = spamHeader || SPAM_RE.test(subject) || SPAM_RE.test(body.slice(0, 1500));
  if (isSpam) return { category: "spam", isSpam: true, priority: "nizka", bulk };

  let category: EmailCategory = "ostatni";
  if (!bulk) {
    const hit = RULES.find((r) => r.subject.test(subject)) ?? RULES.find((r) => r.body?.test(body));
    if (hit) category = hit.category;
  }
  let priority: PriorityLevel = bulk ? "nizka" : "stredni";
  if (!bulk && (URGENT_RE.test(subject) || category === "reklamace" || category === "upominka")) priority = "vysoka";
  else if (!bulk && (category === "objednavka" || category === "poptavka") && URGENT_RE.test(body.slice(0, 1500))) priority = "vysoka";
  return { category, isSpam: false, priority, bulk };
}

/**
 * Kategorie ODESLANÉ zprávy bez AI (štítek v Odeslaných, filtr, oprava jedním ťuknutím):
 * odpověď převezme kategorii zprávy, na kterou odpovídá (`inherit`, kromě spamu / ostatní);
 * jinak podle předmětu (text odpovědi obsahuje citace — ten se nečte). Naše „nabídka" je obchodní
 * případ poptávky (ne „Nabídka dodavatele"); bez shody a se zakázkou „K zakázce".
 */
export function outgoingCategory(input: { subject?: string | null; jobId?: string | null; inherit?: EmailCategory | null }): EmailCategory {
  if (input.inherit && input.inherit !== "spam" && input.inherit !== "ostatni") return input.inherit;
  const subject = fold(input.subject);
  let category: EmailCategory = RULES.find((r) => r.subject.test(subject))?.category ?? "ostatni";
  if (category === "nabidka_dodavatele") category = "poptavka";
  if (category === "ostatni" && input.jobId) category = "k_zakazce";
  return category;
}
