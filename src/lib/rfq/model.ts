/**
 * Poptávky dodavatelům (poptávkové kolo, RFQ) — čistá logika bez DB a Reactu (testy v model.test.ts).
 * Majitel 31. 10.: „pošlu 2, 3, 5 poptávek na základě své poptávky od zákazníka … dobrý den, poptávám s tímhle
 * termínem, samozřejmě všechno anonymizované, aby mi nevyfoukli zákazníka … stejné množství, stejné díly."
 * + „Měl by z toho vyjít i doporučený dodavatel, především na základě ceny, termínu a kvality."
 *
 *  • výchozí hodnoty kola (požadovaný termín = termín zákazníka − rezerva, „odpověď do"),
 *  • e-mail dodavateli (tykání / vykání, bez zákazníka), urgence, poděkování „tentokrát ne",
 *  • pojistka anonymizace (jméno / IČO zákazníka, jeho čísla dokladů, název zakázky) — redakce + kontrola,
 *  • doporučení dodavatelů před odesláním (technologie, materiál, certifikace, historie, kvalita, lhůta),
 *  • porovnání nabídek po položkách a „Doporučujeme: …" (cena / termín / kvalita, váhy z Nastavení).
 */
import { makeTerms, makeWordTerms, findTermRanges, type Term } from "@/lib/anonymize/rules";
import { OPERATION_KINDS, isOperationKind, type OperationKind } from "@/lib/jobs/operations";
import { kindsOfTechnologies, operationFamily, normalizeDrawingNumber } from "@/lib/jobs/production-suggest";

// ── Typy ────────────────────────────────────────────────────
export type RfqScope = "dil" | "operace";
export type RfqRoundStatus = "otevrene" | "vybrano" | "uzavrene" | "zrusene";
export type RfqRecipientStatus =
  | "k_odeslani" | "ceka_na_anonymizaci" | "odeslano" | "odpovedel" | "nabidka" | "odmitl" | "bez_odpovedi" | "chyba" | "zruseno";

export const RFQ_MIN_SUPPLIERS = 1;
export const RFQ_MAX_SUPPLIERS = 8;
export const RFQ_MAX_QTY_VARIANTS = 4;
/** Rezerva mezi termínem dodavatele a termínem zákazníka (pracovní dny: kontrola, doprava k zákazníkovi). */
export const RFQ_BUFFER_WORKDAYS = 5;

export const RECIPIENT_STATUS: Record<RfqRecipientStatus, { label: string; tone: "grey" | "amber" | "sky" | "green" | "red" | "violet" }> = {
  k_odeslani: { label: "K odeslání", tone: "grey" },
  ceka_na_anonymizaci: { label: "Čeká na anonymizaci", tone: "amber" },
  odeslano: { label: "Odesláno", tone: "sky" },
  odpovedel: { label: "Odpověděl", tone: "violet" },
  nabidka: { label: "Nabídka", tone: "green" },
  odmitl: { label: "Odmítl", tone: "grey" },
  bez_odpovedi: { label: "Bez odpovědi", tone: "grey" },
  chyba: { label: "Neodešlo", tone: "red" },
  zruseno: { label: "Zrušeno", tone: "grey" },
};

export function isRecipientStatus(v: unknown): v is RfqRecipientStatus {
  return typeof v === "string" && v in RECIPIENT_STATUS;
}

/** Položka kola (naše číslo položky, množství vč. variant). */
export interface RfqItem {
  orderItemId: string;
  /** Naše číslo položky v poptávce („PD-2026-004/1"). */
  ref: string;
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  material: string | null;
  unit: string;
  /** Poptávaná množství (první = množství zákazníka, další = varianty 10 / 50 / 100 ks). */
  quantities: number[];
  /** Množství zákazníka (pro porovnání cen). */
  customerQty: number;
}

export interface RfqRecipientView {
  id: string;
  supplierId: string | null;
  supplierName: string;
  emails: string[];
  status: RfqRecipientStatus;
  rank: number | null;
  recommendReason: string | null;
  sentAt: string | null;
  sentBy: string | null;
  error: string | null;
  remindedAt: string | null;
  reminderCount: number;
  repliedAt: string | null;
  replyEmailId: string | null;
  replySubject: string | null;
  supplierQuoteId: string | null;
  declinedAt: string | null;
  declineNote: string | null;
  thankedAt: string | null;
  queueId: string | null;
  outboxId: string | null;
}

export interface RfqOfferLine {
  orderItemId: string | null;
  drawingNumber: string | null;
  quantity: number;
  unitPrice: number | null;
}

/** Nabídka dodavatele z kola (supplier_quotes s rfq_recipient_id). */
export interface RfqOffer {
  recipientId: string;
  quoteId: string;
  number: string | null;
  quoteDate: string | null;
  total: number | null;
  currency: string;
  leadTimeDays: number | null;
  deliveryDate: string | null;
  validUntil: string | null;
  note: string | null;
  lines: RfqOfferLine[];
}

export interface RfqSelectionView {
  orderItemId: string | null;
  recipientId: string;
  supplierQuoteId: string | null;
  recommendedRecipientId: string | null;
  overridden: boolean;
  overrideReason: string | null;
  unitPrice: number | null;
  quantity: number | null;
  selectedBy: string | null;
  selectedAt: string;
}

export interface RfqRoundView {
  id: string;
  jobId: string;
  number: string;
  status: RfqRoundStatus;
  scope: RfqScope;
  operationKinds: OperationKind[];
  items: RfqItem[];
  requiredDate: string | null;
  replyBy: string | null;
  note: string | null;
  fileId: string | null;
  drawingFileIds: string[];
  createdAt: string;
  createdBy: string | null;
  closedAt: string | null;
  recipients: RfqRecipientView[];
  offers: RfqOffer[];
  selections: RfqSelectionView[];
}

/** Kvalita dodavatele: hodnocení z karty + historie (supplier_quality_stats). */
export interface SupplierQuality {
  supplierId: string;
  rating: number | null;
  certifications: string[];
  ordersDone: number;
  onTime: number;
  late: number;
  avgDelayDays: number | null;
  issues: number;
  jobs: number;
}

export interface RfqWeights {
  price: number;
  deadline: number;
  quality: number;
}

export const DEFAULT_RFQ_WEIGHTS: RfqWeights = { price: 50, deadline: 30, quality: 20 };
export const RFQ_WEIGHTS_SETTING = "rfq_recommend_weights";

/** Váhy v procentech (0–100, součet 100); chybné / prázdné = výchozí 50 / 30 / 20. */
export function normalizeWeights(raw: unknown): RfqWeights {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return { ...DEFAULT_RFQ_WEIGHTS }; }
  }
  if (!v || typeof v !== "object") return { ...DEFAULT_RFQ_WEIGHTS };
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => {
    const k = typeof x === "number" ? x : Number(x);
    return Number.isFinite(k) && k >= 0 ? Math.min(100, k) : NaN;
  };
  const p = n(o.price);
  const d = n(o.deadline);
  const q = n(o.quality);
  if ([p, d, q].some((x) => Number.isNaN(x)) || p + d + q <= 0) return { ...DEFAULT_RFQ_WEIGHTS };
  const sum = p + d + q;
  const price = Math.round((p / sum) * 100);
  const deadline = Math.round((d / sum) * 100);
  return { price, deadline, quality: Math.max(0, 100 - price - deadline) };
}

// ── Data a dny ──────────────────────────────────────────────
function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseIso(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}
export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}
function isWeekend(iso: string): boolean {
  const w = parseIso(iso).getUTCDay();
  return w === 0 || w === 6;
}
/** ±n pracovních dní (bez víkendů). */
export function addWorkdays(iso: string, n: number): string {
  let d = iso.slice(0, 10);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    if (!isWeekend(d)) left--;
  }
  return d;
}
function nextWorkday(iso: string): string {
  let d = iso.slice(0, 10);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export function czDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : "";
}

/**
 * Výchozí termíny kola: požadovaný termín od dodavatele = termín zákazníka − rezerva (5 pracovních dní),
 * nejdřív za 5 pracovních dní; bez termínu zákazníka za 3 týdny. „Odpověď do" = za 3 pracovní dny,
 * nejpozději týden před požadovaným termínem (nejdřív zítra).
 */
export function rfqDefaultDates(input: { today: string; customerDate: string | null | undefined }): { requiredDate: string; replyBy: string } {
  const today = input.today.slice(0, 10);
  const earliest = addWorkdays(today, 5);
  let required = input.customerDate ? addWorkdays(input.customerDate.slice(0, 10), -RFQ_BUFFER_WORKDAYS) : nextWorkday(addDays(today, 21));
  if (required < earliest) required = earliest;
  let reply = addWorkdays(today, 3);
  const latest = addDays(required, -7);
  if (reply > latest) reply = latest;
  const tomorrow = nextWorkday(addDays(today, 1));
  if (reply < tomorrow) reply = tomorrow;
  return { requiredDate: required, replyBy: reply };
}

/** Varianty množství z textu „10, 50, 100" (kladná čísla, bez duplicit, nejvýš 4; první = zákazník). */
export function parseQuantities(text: string, customerQty: number): number[] {
  const out: number[] = [];
  const push = (n: number) => {
    if (Number.isFinite(n) && n > 0 && n <= 1_000_000 && !out.some((x) => Math.abs(x - n) < 1e-9)) out.push(Math.round(n * 1000) / 1000);
  };
  push(customerQty);
  for (const part of String(text ?? "").split(/[;,/\s]+/)) {
    const n = Number(part.replace(/ks$/i, "").replace(",", "."));
    if (part.trim()) push(n);
  }
  return out.slice(0, RFQ_MAX_QTY_VARIANTS);
}

export function qtyText(n: number, unit = "ks"): string {
  return `${String(Math.round(n * 1000) / 1000).replace(".", ",")} ${unit}`;
}

// ── Souhrny ─────────────────────────────────────────────────
const ACTIVE: RfqRecipientStatus[] = ["ceka_na_anonymizaci", "odeslano", "odpovedel", "nabidka", "odmitl", "bez_odpovedi"];
const ANSWERED: RfqRecipientStatus[] = ["odpovedel", "nabidka", "odmitl"];

/** „Poptáno: 3 · odpověděli 1" (jen dodavatelé, kterým poptávka odešla nebo čeká na výkresy). */
export function rfqSummary(round: Pick<RfqRoundView, "recipients">): { asked: number; answered: number; offers: number; text: string } {
  const live = round.recipients.filter((r) => ACTIVE.includes(r.status));
  const answered = live.filter((r) => ANSWERED.includes(r.status)).length;
  const offers = live.filter((r) => r.status === "nabidka").length;
  return { asked: live.length, answered, offers, text: `Poptáno: ${live.length} · odpověděli ${answered}` };
}

/** Urgovat: odesláno, bez odpovědi, den před „odpověď do" (nebo později). */
export function needsReminder(r: Pick<RfqRecipientView, "status" | "remindedAt">, replyBy: string | null, today: string): boolean {
  if (r.status !== "odeslano" || !replyBy) return false;
  if (r.remindedAt && r.remindedAt.slice(0, 10) >= addDays(replyBy, -1)) return false;
  return today >= addDays(replyBy, -1);
}

/** Smí se ještě urgovat (odesláno / odpověděl bez nabídky). */
export function canRemind(r: Pick<RfqRecipientView, "status">): boolean {
  return r.status === "odeslano" || r.status === "bez_odpovedi";
}

// ── Anonymizace (pojistka) ──────────────────────────────────
export interface CustomerFacts {
  name?: string | null;
  ico?: string | null;
  dic?: string | null;
  /** Čísla dokladů zákazníka (objednávka, poptávka) a kontaktní osoba. */
  numbers?: (string | null | undefined)[];
  contact?: string | null;
  /** Název zakázky (často „Strojmetal — hřídele"). */
  jobTitle?: string | null;
  email?: string | null;
}

export interface LeakGuard {
  terms: Term[];
  /** Čísla a IČO (porovnání bez mezer / pomlček, bez ohledu na velikost). */
  tokens: string[];
}

/** Nikdy nemazat naši firmu. */
const KEEP = ["Mnástrojárna", "Mnastrojarna"];

function tokenNorm(s: string): string {
  return s.replace(/[\s.\-/_]/g, "").toUpperCase();
}

/** Co v poptávce dodavateli nesmí být: zákazník (jméno, výrazná slova názvu, IČO, DIČ, e-mail, kontakt), jeho čísla. */
export function customerLeakGuard(c: CustomerFacts): LeakGuard {
  const names = [c.name].filter(Boolean) as string[];
  const terms = [
    ...makeTerms([...names, c.contact ?? null], "crm", KEEP),
    ...makeWordTerms(names, "crm", KEEP),
  ];
  const domain = (c.email ?? "").split("@")[1]?.split(".")[0] ?? "";
  if (domain.length >= 4) terms.push(...makeTerms([domain], "crm", KEEP));
  const tokens = [c.ico, c.dic, ...(c.numbers ?? [])]
    .map((x) => tokenNorm(String(x ?? "")))
    .filter((x) => x.length >= 4);
  return { terms, tokens: [...new Set(tokens)] };
}

/** Odstraní zákazníka z textu (náhrada „…"); vrací text a co se našlo. */
export function redactCustomer(text: string | null | undefined, guard: LeakGuard): { text: string; hits: string[] } {
  let out = String(text ?? "");
  const hits: string[] = [];
  for (const t of guard.terms) {
    const ranges = findTermRanges(out, t);
    if (!ranges.length) continue;
    hits.push(t.raw);
    for (const r of [...ranges].sort((a, b) => b.start - a.start)) out = `${out.slice(0, r.start)}…${out.slice(r.end)}`;
  }
  for (const tok of guard.tokens) {
    // číslo může být zapsané s mezerami / pomlčkami: hledat po tokenech slova
    const re = /[A-Za-z0-9][A-Za-z0-9.\-/ ]{2,}[A-Za-z0-9]/g;
    out = out.replace(re, (m) => {
      if (tokenNorm(m).includes(tok)) {
        hits.push(tok);
        return tokenNorm(m) === tok ? "…" : m.replace(new RegExp(tok.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s.\\-/_]?"), "i"), "…");
      }
      return m;
    });
  }
  if (hits.length) {
    out = out
      // zbytek názvu firmy (právní forma za odstraněným jménem) a osiřelé „pro …"
      .replace(/…\s*,?\s*(?:spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|gmbh|ag|ltd\.?|inc\.?|s\.\s*p\.\s*a\.|sp\.\s*z\s*o\.\s*o\.)(?![\p{L}\p{N}])/giu, "…")
      .replace(/\s*\b(?:pro|for|für)\s+…/giu, "")
      .replace(/…(\s*…)+/g, "…")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return { text: out.replace(/…(\s*…)+/g, "…"), hits: [...new Set(hits)] };
}

/** Kontrola hotových textů (předmět, tělo, názvy souborů, texty PDF): co by prozradilo zákazníka. */
export function findLeaks(texts: (string | null | undefined)[], guard: LeakGuard): string[] {
  const out = new Set<string>();
  for (const s of texts) {
    if (!s) continue;
    for (const t of guard.terms) if (findTermRanges(s, t).length) out.add(t.raw);
    const flat = tokenNorm(s);
    for (const tok of guard.tokens) if (flat.includes(tok)) out.add(tok);
  }
  return [...out];
}

/** Bezpečný název souboru výkresu: „<č. výkresu>_<rev>.<ext>", jinak „<PD-…>-V<n>.<ext>" (nikdy původní název). */
export function neutralFileName(input: { drawingNumber?: string | null; revision?: string | null; ext: string; roundNumber: string; index: number }): string {
  const clean = (s: string | null | undefined) => String(s ?? "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 60);
  const ext = clean(input.ext).replace(/^\.+/, "").toLowerCase().slice(0, 8) || "pdf";
  const num = clean(input.drawingNumber);
  if (num) return `${num}${clean(input.revision) ? `_${clean(input.revision).slice(0, 12)}` : ""}.${ext}`;
  return `${clean(input.roundNumber) || "poptavka"}-V${Math.max(1, input.index)}.${ext}`;
}

export function rfqPdfFileName(number: string): string {
  return `Poptavka-${number.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

// ── E-maily ─────────────────────────────────────────────────
export interface RfqMailInput {
  number: string;
  scope: RfqScope;
  operationKinds: OperationKind[];
  items: Pick<RfqItem, "ref" | "drawingNumber" | "revision" | "name" | "material" | "unit" | "quantities">[];
  requiredDate: string | null;
  replyBy: string | null;
  note?: string | null;
  /** Hotový první řádek („Dobrý den, pane Nováku," / „Ahoj Pavle,"). */
  salutation: string;
  address: "ty" | "vy";
  /** Podpis odesílatele (text, „-- " oddělovač doplní e-mail). */
  signature: string;
  drawingCount: number;
}

export function whatText(scope: RfqScope, kinds: OperationKind[]): string {
  if (scope === "dil" || !kinds.length) return "výrobu dílů";
  const names = kinds.map((k) => OPERATION_KINDS[k]?.label.toLowerCase() ?? k);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`;
}

function itemLine(it: RfqMailInput["items"][number]): string {
  const dn = [it.drawingNumber, it.revision ? `rev. ${it.revision}` : null].filter(Boolean).join(" ");
  const qty = it.quantities.map((q) => qtyText(q, it.unit)).join(" / ");
  return `• ${it.ref}: ${[dn, it.name].filter(Boolean).join(" — ") || "díl dle výkresu"}${it.material ? `, materiál ${it.material}` : ""} — ${qty}`;
}

function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  return sig ? `${body}\n\n-- \n${sig}` : body;
}

/** Poptávka dodavateli: bez zákazníka, s naším číslem v předmětu (párování odpovědi). */
export function rfqMail(m: RfqMailInput): { subject: string; body: string } {
  const ty = m.address === "ty";
  const what = whatText(m.scope, m.operationKinds);
  const subject = `Poptávka ${m.number}${m.scope === "operace" && m.operationKinds.length ? ` — ${what}` : ""}`;
  const variants = m.items.some((i) => i.quantities.length > 1);
  const lines = [
    m.salutation,
    "",
    `${ty ? "poptávám u tebe" : "poptáváme u Vás"} ${what} dle přiložených výkresů a poptávky ${m.number} v příloze:`,
    "",
    ...m.items.map(itemLine),
    "",
    m.requiredDate ? `Požadovaný termín dodání: ${czDay(m.requiredDate)}.` : null,
    variants ? `${ty ? "Pošli" : "Pošlete"} prosím cenu pro každé uvedené množství.` : null,
    m.replyBy
      ? `${ty ? "Prosím o nabídku" : "Prosíme o nabídku"} (cena za kus, dodací lhůta, platnost) do ${czDay(m.replyBy)}${ty ? "" : ""}.`
      : `${ty ? "Prosím o nabídku" : "Prosíme o nabídku"} (cena za kus, dodací lhůta, platnost).`,
    m.drawingCount ? null : `${ty ? "Výkresy pošlu" : "Výkresy zašleme"} na vyžádání.`,
    m.note?.trim() ? `\n${m.note.trim()}` : null,
    "",
    `Do odpovědi ${ty ? "prosím ponech" : "prosíme uveďte"} číslo poptávky ${m.number}.`,
    "",
    ty ? "Díky," : "Děkujeme a přejeme hezký den,",
  ].filter((l): l is string => l !== null);
  return { subject, body: withSignature(lines.join("\n"), m.signature) };
}

/** Urgence („odpověď do" se blíží / minula). */
export function rfqReminderMail(m: Pick<RfqMailInput, "number" | "replyBy" | "salutation" | "address" | "signature">, today: string): { subject: string; body: string } {
  const ty = m.address === "ty";
  const when = m.replyBy ? (today > m.replyBy ? `termín pro nabídku byl ${czDay(m.replyBy)}` : `nabídku potřebujeme do ${czDay(m.replyBy)}`) : null;
  const body = [
    m.salutation,
    "",
    `${ty ? "připomínám" : "dovolujeme si připomenout"} naši poptávku ${m.number}${when ? ` — ${when}` : ""}.`,
    `${ty ? "Pošleš" : "Pošlete"} ${ty ? "mi" : "nám"} prosím nabídku, nebo ${ty ? "dej" : "dejte"} vědět, že ${ty ? "nestíháš / nenabídneš" : "nabídku nepošlete"}?`,
    "",
    ty ? "Díky," : "Děkujeme,",
  ].join("\n");
  return { subject: `Připomenutí: Poptávka ${m.number}`, body: withSignature(body, m.signature) };
}

/** Poděkování nevybraným („děkujeme, tentokrát ne"). */
export function rfqThanksMail(m: Pick<RfqMailInput, "number" | "salutation" | "address" | "signature">): { subject: string; body: string } {
  const ty = m.address === "ty";
  const body = [
    m.salutation,
    "",
    `${ty ? "díky za nabídku" : "děkujeme za Vaši nabídku"} k poptávce ${m.number}. Tentokrát jsme zakázku zadali jinde — ${ty ? "budu" : "budeme"} se těšit na další spolupráci.`,
    "",
    ty ? "Díky," : "S pozdravem,",
  ].join("\n");
  return { subject: `Re: Poptávka ${m.number}`, body: withSignature(body, m.signature) };
}

// ── Číslo poptávky v e-mailu (párování odpovědi) ────────────
const RFQ_NUMBER_RE = /\bPD(?:\s?[-–]\s?|\s)(20\d{2})\s?[-–/]\s?(\d{1,5})\b/gi;

/** Naše čísla poptávek v textu („PD-2026-004", „PD 2026/4") → normalizovaně „PD-2026-004". */
export function extractRfqNumbers(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of String(t ?? "").matchAll(RFQ_NUMBER_RE)) out.add(`PD-${m[1]}-${m[2].padStart(3, "0")}`);
  }
  return [...out];
}

// ── Kvalita ─────────────────────────────────────────────────
export interface QualityScore {
  /** 0–1 (0,5 = neutrální bez dat). */
  score: number;
  /** Na pětibodové stupnici (1–5) pro text. */
  stars: number;
  noHistory: boolean;
  /** „kvalita 4,6/5 · včas 9 z 10 · 1 problém" / „bez historie". */
  text: string;
}

export function qualityScore(q: SupplierQuality | null | undefined): QualityScore {
  const rating = q?.rating !== null && q?.rating !== undefined && q.rating > 0 ? Math.min(5, Math.max(1, Number(q.rating))) : null;
  const measured = q ? q.onTime + q.late : 0;
  const parts: number[] = [];
  const bits: string[] = [];
  if (rating !== null) parts.push((rating - 1) / 4);
  let hist: number | null = null;
  if (q && (measured > 0 || q.jobs > 0)) {
    const onTimeRate = measured ? q.onTime / measured : null;
    const issueRate = q.jobs ? Math.min(1, q.issues / q.jobs) : 0;
    hist = onTimeRate === null ? 1 - issueRate : onTimeRate * 0.7 + (1 - issueRate) * 0.3;
    parts.push(hist);
    if (measured) bits.push(`včas ${q.onTime} z ${measured}`);
    if (q.issues) bits.push(`${q.issues} ${q.issues === 1 ? "problém" : q.issues <= 4 ? "problémy" : "problémů"}`);
  }
  if (q?.certifications?.length) bits.push(q.certifications.slice(0, 2).join(", "));
  if (!parts.length) {
    return { score: 0.5, stars: 3, noHistory: true, text: ["bez historie", ...bits].join(" · ") };
  }
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  const stars = Math.round((1 + score * 4) * 10) / 10;
  return { score, stars, noHistory: false, text: [`kvalita ${String(stars).replace(".", ",")}/5`, ...bits].join(" · ") };
}

// ── Doporučení dodavatelů před odesláním ────────────────────
export interface RankSupplier {
  id: string;
  name: string;
  technologies: string[];
  materials: string[];
  certifications: string[];
  leadDays: number | null;
  rating: number | null;
  /** Adresa pro poptávky (účel „Poptávky"), jinak kontakt / firma. */
  email: string | null;
}

export interface RankHistory {
  /** Dřívější objednávky stejných výkresů (dodavatel, cena za kus). */
  drawings: { drawingNumber: string; supplierId: string | null; unitPrice: number | null }[];
  /** Dřívější kroky stejného druhu (dodavatel). */
  operations: { kind: OperationKind; supplierId: string | null }[];
  /** Dřívější poptávky / nabídky dodavatele (kolik odpověděl). */
  rfq?: { supplierId: string; asked: number; answered: number }[];
}

export interface RankedSupplier {
  supplier: RankSupplier;
  score: number;
  /** Doporučeno (předvybráno) — nejlepší 3 s nějakou shodou. */
  recommended: boolean;
  reasons: string[];
  quality: QualityScore;
  /** Technologie sedí na to, co se poptává. */
  techMatch: boolean;
}

function fold(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Co se poptává → druhy kroků (celý díl = obrábění / kompletní dodávka). */
export function askedKinds(scope: RfqScope, kinds: OperationKind[]): OperationKind[] {
  if (scope === "operace" && kinds.length) return kinds;
  return ["kompletni_dodavka", "vyroba"];
}

/**
 * Pořadí dodavatelů k poptávce: technologie (druh / rodina operace) → materiál → certifikace → historie (stejný výkres,
 * stejná operace, levná cena) → kvalita (hodnocení + včas / problémy) → obvyklá lhůta. Předvybere 3 nejlepší s shodou.
 */
export function rankRfqSuppliers(input: {
  suppliers: RankSupplier[];
  scope: RfqScope;
  kinds: OperationKind[];
  materials: (string | null | undefined)[];
  drawingNumbers: (string | null | undefined)[];
  history: RankHistory;
  quality: Map<string, SupplierQuality>;
  preselect?: number;
}): RankedSupplier[] {
  const asked = askedKinds(input.scope, input.kinds);
  const fams = new Set(asked.map(operationFamily));
  const mats = input.materials.map(fold).filter((m) => m.length >= 2);
  const norms = new Set(input.drawingNumbers.map((d) => normalizeDrawingNumber(d)).filter((x): x is string => Boolean(x)));
  const drawingHits = input.history.drawings.filter((d) => norms.has(normalizeDrawingNumber(d.drawingNumber) ?? ""));
  const prices = drawingHits.filter((d) => d.unitPrice !== null && d.supplierId).map((d) => d.unitPrice as number);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const leads = input.suppliers.map((s) => s.leadDays).filter((x): x is number => x !== null && x > 0);
  const minLead = leads.length ? Math.min(...leads) : null;

  const ranked = input.suppliers.map((s): RankedSupplier => {
    const reasons: string[] = [];
    const kinds = kindsOfTechnologies(s.technologies);
    const exact = kinds.some((k) => asked.includes(k)) || (fams.has("obrabeni") && kinds.some((k) => operationFamily(k) === "obrabeni"));
    const family = !exact && kinds.some((k) => fams.has(operationFamily(k)));
    const techMatch = exact || family;
    let score = exact ? 0.4 : family ? 0.25 : 0;
    if (techMatch) {
      // technologie lidsky (klíče kalkulace „frezovani_3osy" → „frézování")
      const show = [...new Set(kinds.map((k) => OPERATION_KINDS[k]?.label.toLowerCase()).filter(Boolean))].slice(0, 3).join(", ");
      reasons.push(`umí ${show || whatText(input.scope, input.kinds)}`);
    }
    const sm = s.materials.map(fold);
    if (mats.length && sm.some((m) => mats.some((x) => x.includes(m) || m.includes(x)))) {
      score += 0.1;
      reasons.push("materiál");
    }
    if (s.certifications.length) {
      score += 0.03;
    }
    const hits = drawingHits.filter((d) => d.supplierId === s.id);
    if (hits.length) {
      score += 0.15;
      const best = hits.filter((h) => h.unitPrice !== null).map((h) => h.unitPrice as number);
      if (best.length && minPrice !== null && Math.min(...best) <= minPrice + 1e-6) {
        score += 0.05;
        reasons.push("dělal tento výkres nejlevněji");
      } else reasons.push("dělal tento výkres");
    } else if (input.history.operations.some((o) => o.supplierId === s.id && asked.some((k) => operationFamily(k) === operationFamily(o.kind)))) {
      score += 0.08;
      reasons.push("dělal stejnou operaci");
    }
    const quality = qualityScore(input.quality.get(s.id) ? { ...input.quality.get(s.id)!, rating: s.rating, certifications: s.certifications } : {
      supplierId: s.id, rating: s.rating, certifications: s.certifications, ordersDone: 0, onTime: 0, late: 0, avgDelayDays: null, issues: 0, jobs: 0,
    });
    score += quality.score * 0.2;
    if (!quality.noHistory) reasons.push(quality.text.split(" · ")[0]);
    if (s.leadDays && minLead) {
      score += 0.07 * (minLead / s.leadDays);
      if (s.leadDays === minLead && leads.length > 1) reasons.push(`nejkratší lhůta (${s.leadDays} dní)`);
    }
    const rr = input.history.rfq?.find((r) => r.supplierId === s.id);
    if (rr && rr.asked >= 2) {
      score += 0.05 * (rr.answered / rr.asked);
      if (rr.answered / rr.asked < 0.5) reasons.push(`odpovídá málokdy (${rr.answered} z ${rr.asked})`);
    }
    if (!s.email) score -= 0.2;
    return { supplier: s, score: Math.round(score * 1000) / 1000, recommended: false, reasons, quality, techMatch };
  });
  ranked.sort((a, b) => b.score - a.score || a.supplier.name.localeCompare(b.supplier.name, "cs"));
  const n = input.preselect ?? 3;
  let picked = 0;
  for (const r of ranked) {
    if (picked >= n) break;
    if ((r.techMatch || r.reasons.length) && r.supplier.email) {
      r.recommended = true;
      picked++;
    }
  }
  return ranked;
}

// ── Porovnání nabídek a doporučení ──────────────────────────
export interface CompareCell {
  recipientId: string;
  supplierName: string;
  supplierId: string | null;
  quoteId: string;
  /** Cena za kus pro množství zákazníka (nebo nejbližší poptané). */
  unitPrice: number | null;
  quantity: number;
  total: number | null;
  currency: string;
  leadTimeDays: number | null;
  deliveryDate: string | null;
  validUntil: string | null;
  note: string | null;
  /** Ceny ostatních variant množství (10 / 50 / 100). */
  variants: { quantity: number; unitPrice: number | null }[];
  cheapest: boolean;
  fastest: boolean;
  score: number | null;
  quality: QualityScore;
  /** Termín vůči našemu požadovanému (dny rezervy, záporně = pozdě). */
  bufferDays: number | null;
}

export interface CompareRow {
  item: RfqItem;
  cells: CompareCell[];
  recommended: { recipientId: string; reason: string } | null;
  selected: RfqSelectionView | null;
}

export interface Comparison {
  rows: CompareRow[];
  /** Jeden dodavatel vede u všech položek (nebo má nejlepší skóre celkem a pokryje vše). */
  overall: { recipientId: string; supplierName: string; reason: string; total: number | null; currency: string } | null;
  /** Vybraný vítěz celého kola. */
  selectedAll: RfqSelectionView | null;
}

function offerDelivery(o: RfqOffer): string | null {
  if (o.deliveryDate) return o.deliveryDate;
  if (o.leadTimeDays !== null && o.leadTimeDays !== undefined) return addDays((o.quoteDate ?? "").slice(0, 10) || isoOf(new Date()), o.leadTimeDays);
  return null;
}

function lineFor(o: RfqOffer, item: RfqItem, qty: number): RfqOfferLine | null {
  const byItem = o.lines.filter((l) => l.orderItemId === item.orderItemId
    || (!l.orderItemId && item.drawingNumber && normalizeDrawingNumber(l.drawingNumber) === normalizeDrawingNumber(item.drawingNumber)));
  return byItem.find((l) => Math.abs(l.quantity - qty) < 1e-6) ?? null;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round(((a - b) / b) * 100) : 0;
}

/** Skóre buňky (0–1) a krátký důvod. */
function scoreCell(c: CompareCell, cheapest: number | null, w: RfqWeights): number | null {
  if (c.unitPrice === null) return null;
  const price = cheapest !== null && c.unitPrice > 0 ? Math.min(1, cheapest / c.unitPrice) : 1;
  let deadline = 0.4;
  if (c.bufferDays !== null) deadline = c.bufferDays >= 0 ? 0.6 + 0.4 * Math.min(1, c.bufferDays / 14) : Math.max(0, 0.3 + 0.1 * c.bufferDays);
  const total = (w.price * price + w.deadline * deadline + w.quality * c.quality.score) / Math.max(1, w.price + w.deadline + w.quality);
  return Math.round(total * 1000) / 1000;
}

function deadlineText(buffer: number | null): string {
  if (buffer === null) return "termín neuveden";
  if (buffer === 0) return "termín přesně na náš termín";
  if (buffer > 0) return `termín ${buffer} ${buffer === 1 ? "den" : buffer <= 4 ? "dny" : "dní"} před naším termínem`;
  const late = -buffer;
  return `termín o ${late} ${late === 1 ? "den" : late <= 4 ? "dny" : "dní"} po našem termínu`;
}

function reasonFor(best: CompareCell, cells: CompareCell[]): string {
  const priced = cells.filter((c) => c.unitPrice !== null);
  const others = priced.filter((c) => c.recipientId !== best.recipientId).map((c) => c.unitPrice as number);
  const parts: string[] = [];
  if (best.unitPrice !== null && others.length) {
    const next = Math.min(...others);
    if (best.unitPrice < next) parts.push(`nejlevnější o ${Math.max(1, -pct(best.unitPrice, next))} %`);
    else if (best.unitPrice > next) parts.push(`o ${Math.max(1, pct(best.unitPrice, next))} % dražší než nejlevnější`);
    else parts.push("stejná cena jako nejlevnější");
  } else if (best.unitPrice !== null) parts.push("jediná nabídka s cenou");
  parts.push(deadlineText(best.bufferDays));
  parts.push(best.quality.noHistory ? "bez historie" : `kvalita ${String(best.quality.stars).replace(".", ",")}/5`);
  return parts.join(", ");
}

/**
 * Porovnání po položkách × dodavatel (cena za kus pro množství zákazníka, celkem, lhůta, platnost), nejlevnější a
 * nejrychlejší zvýrazněné; „Doporučujeme" = nejvyšší skóre cena / termín / kvalita (váhy z Nastavení).
 */
export function compareRfq(round: Pick<RfqRoundView, "items" | "recipients" | "offers" | "selections" | "requiredDate">, quality: Map<string, SupplierQuality>, weights: RfqWeights, ratings: Map<string, { rating: number | null; certifications: string[] }> = new Map()): Comparison {
  const recips = new Map(round.recipients.map((r) => [r.id, r]));
  const qOf = (r: RfqRecipientView | undefined): QualityScore => {
    const sid = r?.supplierId ?? "";
    const base = quality.get(sid);
    const card = ratings.get(sid);
    return qualityScore(base || card ? {
      supplierId: sid, ordersDone: 0, onTime: 0, late: 0, avgDelayDays: null, issues: 0, jobs: 0, ...(base ?? {}),
      rating: card?.rating ?? base?.rating ?? null, certifications: card?.certifications ?? base?.certifications ?? [],
    } : null);
  };
  const rows: CompareRow[] = round.items.map((item) => {
    const cells: CompareCell[] = [];
    for (const o of round.offers) {
      const r = recips.get(o.recipientId);
      if (!r || r.status === "odmitl" || r.status === "zruseno") continue;
      const qty = item.customerQty || item.quantities[0] || 1;
      const main = lineFor(o, item, qty) ?? item.quantities.map((q) => lineFor(o, item, q)).find((l) => l && l.unitPrice !== null) ?? null;
      if (!main && !item.quantities.some((q) => lineFor(o, item, q))) continue;
      const delivery = offerDelivery(o);
      const cell: CompareCell = {
        recipientId: o.recipientId, supplierName: r.supplierName, supplierId: r.supplierId, quoteId: o.quoteId,
        unitPrice: main?.unitPrice ?? null, quantity: main?.quantity ?? qty,
        total: main && main.unitPrice !== null ? Math.round(main.unitPrice * main.quantity * 100) / 100 : null,
        currency: o.currency || "CZK", leadTimeDays: o.leadTimeDays, deliveryDate: delivery, validUntil: o.validUntil, note: o.note,
        variants: item.quantities.filter((q) => Math.abs(q - (main?.quantity ?? qty)) > 1e-6).map((q) => ({ quantity: q, unitPrice: lineFor(o, item, q)?.unitPrice ?? null })),
        cheapest: false, fastest: false, score: null, quality: qOf(r),
        bufferDays: delivery && round.requiredDate ? daysBetween(delivery, round.requiredDate) : null,
      };
      cells.push(cell);
    }
    // stejná měna jako většina (cizí měnu nesrovnáváme automaticky)
    const cur = cells.find((c) => c.unitPrice !== null)?.currency ?? "CZK";
    const comparable = cells.filter((c) => c.unitPrice !== null && c.currency === cur && Math.abs(c.quantity - (item.customerQty || c.quantity)) < 1e-6);
    const cheapest = comparable.length ? Math.min(...comparable.map((c) => c.unitPrice as number)) : null;
    for (const c of comparable) c.cheapest = cheapest !== null && Math.abs((c.unitPrice as number) - cheapest) < 0.005;
    const dated = cells.filter((c) => c.deliveryDate);
    const first = dated.length > 1 ? dated.reduce((a, b) => ((b.deliveryDate as string) < (a.deliveryDate as string) ? b : a)).deliveryDate : null;
    for (const c of dated) c.fastest = first !== null && c.deliveryDate === first;
    for (const c of comparable) c.score = scoreCell(c, cheapest, weights);
    const best = [...comparable].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.unitPrice ?? 0) - (b.unitPrice ?? 0))[0] ?? null;
    const selected = round.selections.find((s) => s.orderItemId === item.orderItemId) ?? null;
    return { item, cells, recommended: best ? { recipientId: best.recipientId, reason: reasonFor(best, comparable) } : null, selected };
  });

  // celé kolo: dodavatel, který pokryje všechny položky a má nejlepší průměrné skóre
  let overall: Comparison["overall"] = null;
  const ids = [...new Set(round.offers.map((o) => o.recipientId))];
  const full = ids.filter((id) => rows.length > 0 && rows.every((row) => row.cells.some((c) => c.recipientId === id && c.score !== null)));
  if (full.length && rows.length) {
    // celé kolo jedním dodavatelem: stejné skóre jako u položky, ale z CELKOVÉ ceny (váha podle hodnoty položek),
    // nejhoršího termínu napříč položkami a kvality
    const cells = (id: string) => rows.map((row) => row.cells.find((c) => c.recipientId === id) as CompareCell);
    const totalOf = (id: string) => cells(id).reduce((s, c) => s + (c.total ?? 0), 0);
    const bufferOf = (id: string): number | null => {
      const b = cells(id).map((c) => c.bufferDays);
      return b.some((x) => x === null) ? null : Math.min(...(b as number[]));
    };
    const cheapestTotal = Math.min(...full.map(totalOf));
    const agg = (id: string): CompareCell => ({ ...cells(id)[0], unitPrice: totalOf(id), bufferDays: bufferOf(id) });
    const scoreOf = (id: string) => scoreCell(agg(id), cheapestTotal, weights) ?? 0;
    const win = [...full].sort((a, b) => scoreOf(b) - scoreOf(a) || totalOf(a) - totalOf(b))[0];
    const winsAll = rows.every((row) => row.recommended?.recipientId === win);
    const r = recips.get(win);
    const others = full.filter((x) => x !== win).map(totalOf);
    const t = totalOf(win);
    const first = agg(win);
    const priceBit = others.length
      ? (t < Math.min(...others) ? `celkem nejlevnější o ${Math.max(1, -pct(t, Math.min(...others)))} %`
        : t > Math.min(...others) ? `celkem o ${Math.max(1, pct(t, Math.min(...others)))} % dražší než nejlevnější` : "celkem stejně jako nejlevnější")
      : "jediná úplná nabídka";
    overall = {
      recipientId: win, supplierName: r?.supplierName ?? "",
      reason: [winsAll ? "nejlepší u všech položek" : null, priceBit, deadlineText(first.bufferDays),
        first.quality.noHistory ? "bez historie" : `kvalita ${String(first.quality.stars).replace(".", ",")}/5`].filter(Boolean).join(", "),
      total: Math.round(t * 100) / 100, currency: first.currency,
    };
  }
  return { rows, overall, selectedAll: round.selections.find((s) => s.orderItemId === null) ?? null };
}

// ── Odpověď dodavatele → předvyplnění nabídky ───────────────
export interface ReplyPrefill {
  lines: { orderItemId: string; quantity: number; unitPrice: number }[];
  leadTimeDays: number | null;
  validUntil: string | null;
  number: string | null;
  found: number;
}

function money(s: string): number | null {
  const n = Number(s.replace(/\s| /g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ceny z textu odpovědi: řádek s číslem výkresu (nebo naším „PD-…/n") a částkou „1 180 Kč / 1180,- / 1 180 CZK";
 * víc částek na řádku = varianty množství v poptaném pořadí. Lhůta „dodací lhůta 3 týdny / 15 pracovních dní",
 * platnost „platnost do 30. 11. 2026", číslo nabídky „nabídka č. 123/26".
 */
export function parseSupplierReply(text: string | null | undefined, items: Pick<RfqItem, "orderItemId" | "ref" | "drawingNumber" | "quantities" | "customerQty">[], today: string): ReplyPrefill {
  const src = String(text ?? "").split(/\r?\n-- \r?\n/)[0];
  const lines = src.split(/\r?\n/).filter((l) => !/^\s*>/.test(l));
  const out: ReplyPrefill = { lines: [], leadTimeDays: null, validUntil: null, number: null, found: 0 };
  const PRICE = /(\d{1,3}(?:[  .]\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:,-|kč|czk|eur|€)/gi;
  for (const it of items) {
    const dn = normalizeDrawingNumber(it.drawingNumber);
    const refN = it.ref.replace(/\s/g, "").toUpperCase();
    const line = lines.find((l) => {
      const flat = l.replace(/[\s.\-/]/g, "").toUpperCase();
      return (dn && flat.includes(dn)) || flat.includes(refN.replace(/[\s.\-/]/g, ""));
    });
    if (!line) continue;
    const prices = [...line.matchAll(PRICE)].map((m) => money(m[1])).filter((x): x is number => x !== null);
    if (!prices.length) continue;
    out.found++;
    prices.slice(0, it.quantities.length).forEach((p, i) => out.lines.push({ orderItemId: it.orderItemId, quantity: it.quantities[i], unitPrice: p }));
  }
  // jediná položka a jediná cena kdekoli v textu
  if (!out.found && items.length === 1) {
    const all = [...src.matchAll(PRICE)].map((m) => money(m[1])).filter((x): x is number => x !== null);
    if (all.length) {
      out.found = 1;
      all.slice(0, items[0].quantities.length).forEach((p, i) => out.lines.push({ orderItemId: items[0].orderItemId, quantity: items[0].quantities[i], unitPrice: p }));
    }
  }
  const f = fold(src);
  const lead = /(?:dodaci\s+lhut\w*|termin\s+dodani|dodani|lhut\w*)[^\d\n]{0,20}(\d{1,3})\s*(?:-\s*\d{1,3}\s*)?(prac\w*\s+)?(dn\w*|tydn\w*|tyd\w*)/.exec(f);
  if (lead) {
    const n = Number(lead[1]);
    out.leadTimeDays = /tyd/.test(lead[3]) ? n * 7 : lead[2] ? Math.round(n * 1.4) : n;
  }
  const valid = /platnost\w*[^\d\n]{0,15}(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/.exec(f);
  if (valid) out.validUntil = `${valid[3]}-${valid[2].padStart(2, "0")}-${valid[1].padStart(2, "0")}`;
  else {
    const vd = /platnost\w*[^\d\n]{0,15}(\d{1,3})\s*(dn\w*|tyd\w*)/.exec(f);
    if (vd) out.validUntil = addDays(today, Number(vd[1]) * (/tyd/.test(vd[2]) ? 7 : 1));
  }
  const num = /nabidk\w*\s*(?:c\.|cislo)\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,30})/.exec(f);
  if (num) out.number = num[1].toUpperCase();
  return out;
}

/** Druhy kroků z neznámého vstupu (jen platné). */
export function cleanKinds(v: unknown): OperationKind[] {
  return (Array.isArray(v) ? v : []).filter(isOperationKind).filter((k, i, a) => a.indexOf(k) === i).slice(0, 6);
}
