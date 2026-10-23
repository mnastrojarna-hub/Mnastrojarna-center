import {
  MessageSquareQuote, ShoppingCart, Handshake, BadgeCheck, ReceiptText, BellRing, AlertTriangle,
  PencilRuler, Ban, Mail, FileText, Factory, Bot, Send, type LucideIcon,
} from "lucide-react";
import type {
  ApprovalType, EmailCategory as DbEmailCategory, JobStage, PriorityLevel,
} from "@/lib/supabase/database.types";
import type { EmailCategory, EmailItem, SentItem } from "@/lib/data/types";
import { emailCategoryLabel, priorityLabel } from "@/lib/data/labels";

/**
 * Pošta — čistá logika bez DB (sdílí server i klient, testy ve visibility.test.ts):
 *  - viditelnost: super admin vše, ostatní jen svou schránku / své e-maily
 *  - výběr schránek k synchronizaci, autorizace cronu, hlavní vypínač AI
 *  - barvy kategorií a druhů odeslané pošty (třídy Tailwindu vypsané celé kvůli JIT)
 *  - mapování řádků DB → view-modely, sloučení odeslané pošty, zakázka z e-mailu
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Speciální hodnota filtru schránky: e-maily bez schránky (import z Outlooku, globální účet). */
export const NO_MAILBOX = "none";

// ── Viditelnost ─────────────────────────────────────────────

export interface MailViewer {
  userId: string;
  /** Super admin (funkce mail_all) — vidí poštu všech schránek. */
  all: boolean;
}

export interface MailOwnership {
  owner_id: string | null;
  mailbox_id: string | null;
}

/** Schránka ve výběru (bez přístupových údajů — jde i na klienta). */
export interface MailboxOption {
  id: string;
  email: string;
  displayName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  /** Poslední úspěšné stažení (mailbox_status). */
  lastSyncAt?: string | null;
  /** Chyba posledního stažení (null = poslední proběhlo OK). */
  lastSyncError?: string | null;
  /** Server odmítl heslo a údaje se od té doby nezměnily — automaticky se nestahuje (jen ručně). */
  authBlocked?: boolean;
  /** Schránka nemá kompletní nastavení (server / heslo) — nestahuje se. */
  incomplete?: boolean;
}

export interface MailboxOwnership {
  id: string;
  owner_id: string | null;
  active?: boolean | null;
}

/** Schránky, které uživateli patří. */
export function ownedMailboxIds(mailboxes: readonly MailboxOwnership[], userId: string): string[] {
  if (!userId) return [];
  return mailboxes.filter((m) => m.owner_id === userId).map((m) => m.id);
}

/**
 * Smí uživatel vidět e-mail? Super admin vše; ostatní jen e-maily své schránky
 * nebo přímo přiřazené sobě. Pošta schránky bez vlastníka → jen super admin.
 */
export function canSeeEmail(viewer: MailViewer, email: MailOwnership, ownedIds: readonly string[]): boolean {
  if (viewer.all) return true;
  if (!viewer.userId) return false;
  if (email.owner_id && email.owner_id === viewer.userId) return true;
  return Boolean(email.mailbox_id && ownedIds.includes(email.mailbox_id));
}

/** Smí uživatel pracovat se schránkou (filtr, synchronizace)? */
export function canUseMailbox(viewer: MailViewer, mailbox: MailboxOwnership): boolean {
  if (viewer.all) return true;
  return Boolean(viewer.userId) && mailbox.owner_id === viewer.userId;
}

/**
 * PostgREST filtr `.or()` pro běžného uživatele: emails.owner_id = já NEBO
 * mailbox_id ∈ moje schránky. Jen UUID (žádná injekce do filtru); jinak null.
 */
export function emailVisibilityFilter(userId: string, ownedIds: readonly string[]): string | null {
  if (!isUuidLike(userId)) return null;
  const ids = ownedIds.filter(isUuidLike);
  const own = `owner_id.eq.${userId}`;
  return ids.length ? `${own},mailbox_id.in.(${ids.join(",")})` : own;
}

// ── Synchronizace ───────────────────────────────────────────

export type SyncSelection =
  | { kind: "all" }
  | { kind: "own"; mailboxIds: string[] }
  | { kind: "none" };

/** Co smí uživatel stáhnout: super admin vše, ostatní jen své aktivní schránky. */
export function selectMailboxesToSync(viewer: MailViewer, mailboxes: readonly MailboxOwnership[]): SyncSelection {
  if (viewer.all) return { kind: "all" };
  const ids = mailboxes
    .filter((m) => m.active !== false && canUseMailbox(viewer, m))
    .map((m) => m.id);
  return ids.length ? { kind: "own", mailboxIds: ids } : { kind: "none" };
}

/** Schránky pro synchronizaci: bez filtru všechny, s filtrem jen vybrané. */
export function filterMailboxesForSync<T extends { id: string }>(mailboxes: readonly T[], mailboxIds?: readonly string[]): T[] {
  if (mailboxIds === undefined) return [...mailboxes];
  const wanted = new Set(mailboxIds);
  return mailboxes.filter((m) => wanted.has(m.id));
}

/** Globální přístupové údaje (Nastavení → integrace) jen při synchronizaci všeho. */
export function allowGlobalFallback(opts?: { mailboxIds?: readonly string[] }): boolean {
  return opts?.mailboxIds === undefined;
}

/** Hlavní vypínač AI — vypnuto jen výslovně („false", „0", „off", „ne", „no"). */
export function isAiSwitchOn(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const v = value.trim().toLowerCase();
  return !["false", "0", "off", "ne", "no"].includes(v);
}

/** Konstantní čas porovnání (bez node:crypto — modul se používá i na klientu). */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Cron: `Authorization: Bearer <CRON_SECRET>`. 503 = secret nenastaven, 401 = špatný/chybí. */
export function cronAuthStatus(authorization: string | null | undefined, secret: string | null | undefined): 200 | 401 | 503 {
  const s = (secret ?? "").trim();
  if (!s) return 503;
  const header = (authorization ?? "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return 401;
  return safeEqual(m[1].trim(), s) ? 200 : 401;
}

// ── Barvy kategorií (Inbox) ─────────────────────────────────

export interface CategoryStyle {
  label: EmailCategory;
  icon: LucideIcon;
  /** Měkký chip / odznak. */
  chip: string;
  /** Aktivní chip filtru. */
  active: string;
  /** Tečka nepřečteného e-mailu. */
  dot: string;
  /** Levý barevný pruh řádku. */
  bar: string;
  /** Text / ikona v barvě kategorie. */
  text: string;
}

export const CATEGORY_STYLE: Record<EmailCategory, CategoryStyle> = {
  "Poptávka": {
    label: "Poptávka", icon: MessageSquareQuote,
    chip: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
    active: "border-sky-500 bg-sky-500 text-white", dot: "bg-sky-500", bar: "bg-sky-500", text: "text-sky-600 dark:text-sky-400",
  },
  "Objednávka": {
    label: "Objednávka", icon: ShoppingCart,
    chip: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
    active: "border-orange-500 bg-orange-500 text-white", dot: "bg-orange-500", bar: "bg-orange-500", text: "text-orange-600 dark:text-orange-400",
  },
  "Potvrzení objednávky": {
    label: "Potvrzení objednávky", icon: BadgeCheck,
    chip: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
    active: "border-indigo-500 bg-indigo-500 text-white", dot: "bg-indigo-500", bar: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400",
  },
  "Nabídka dodavatele": {
    label: "Nabídka dodavatele", icon: Handshake,
    chip: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300",
    active: "border-teal-500 bg-teal-500 text-white", dot: "bg-teal-500", bar: "bg-teal-500", text: "text-teal-600 dark:text-teal-400",
  },
  "Faktura": {
    label: "Faktura", icon: ReceiptText,
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    active: "border-emerald-500 bg-emerald-500 text-white", dot: "bg-emerald-500", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400",
  },
  "Upomínka": {
    label: "Upomínka", icon: BellRing,
    chip: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    active: "border-amber-500 bg-amber-500 text-white", dot: "bg-amber-500", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400",
  },
  "Reklamace": {
    label: "Reklamace", icon: AlertTriangle,
    chip: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    active: "border-rose-500 bg-rose-500 text-white", dot: "bg-rose-500", bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400",
  },
  "Technická dokumentace": {
    label: "Technická dokumentace", icon: PencilRuler,
    chip: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
    active: "border-blue-500 bg-blue-500 text-white", dot: "bg-blue-500", bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400",
  },
  "Ostatní": {
    label: "Ostatní", icon: Mail,
    chip: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
    active: "border-slate-500 bg-slate-500 text-white", dot: "bg-slate-400", bar: "bg-slate-300 dark:bg-slate-600", text: "text-slate-600 dark:text-slate-400",
  },
  "Spam": {
    label: "Spam", icon: Ban,
    chip: "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-600/40 dark:bg-zinc-500/10 dark:text-zinc-400",
    active: "border-zinc-500 bg-zinc-500 text-white", dot: "bg-zinc-400", bar: "bg-zinc-300 dark:bg-zinc-600", text: "text-zinc-500 dark:text-zinc-400",
  },
};

/** Pořadí chipů v Inboxu. */
export const INBOX_CATEGORIES: EmailCategory[] = [
  "Poptávka", "Objednávka", "Potvrzení objednávky", "Nabídka dodavatele", "Faktura", "Upomínka",
  "Reklamace", "Technická dokumentace", "Ostatní", "Spam",
];

export function categoryStyle(label: string | null | undefined): CategoryStyle {
  return (label && CATEGORY_STYLE[label as EmailCategory]) || CATEGORY_STYLE["Ostatní"];
}

/** Počty e-mailů po kategoriích (pro chipy filtru). */
export function countByCategory(emails: readonly Pick<EmailItem, "category">[]): Record<EmailCategory, number> {
  const out = Object.fromEntries(INBOX_CATEGORIES.map((c) => [c, 0])) as Record<EmailCategory, number>;
  for (const e of emails) out[categoryStyle(e.category).label] += 1;
  return out;
}

// ── Druhy odeslané pošty ────────────────────────────────────

export type SentKind = NonNullable<SentItem["kind"]>;

export interface SentKindStyle {
  label: string;
  icon: LucideIcon;
  chip: string;
  active: string;
  text: string;
}

export const SENT_KIND_STYLE: Record<SentKind, SentKindStyle> = {
  email: {
    label: "E-mail", icon: Send,
    chip: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
    active: "border-cyan-500 bg-cyan-500 text-white", text: "text-cyan-600 dark:text-cyan-400",
  },
  quote: {
    label: "Nabídka", icon: FileText,
    chip: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
    active: "border-violet-500 bg-violet-500 text-white", text: "text-violet-600 dark:text-violet-400",
  },
  reminder: {
    label: "Upomínka", icon: BellRing,
    chip: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    active: "border-amber-500 bg-amber-500 text-white", text: "text-amber-600 dark:text-amber-400",
  },
  supplier: {
    label: "Dodavateli", icon: Factory,
    chip: "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-500/30 dark:bg-lime-500/10 dark:text-lime-300",
    active: "border-lime-600 bg-lime-600 text-white", text: "text-lime-700 dark:text-lime-400",
  },
};

/** Odznak „Automaticky" (odeslala plná automatika). */
export const SENT_AUTO_STYLE: SentKindStyle = {
  label: "Automaticky", icon: Bot,
  chip: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
  active: "border-fuchsia-500 bg-fuchsia-500 text-white", text: "text-fuchsia-600 dark:text-fuchsia-400",
};

export const SENT_KINDS: SentKind[] = ["email", "quote", "reminder", "supplier"];

export function isSentKind(v: unknown): v is SentKind {
  return typeof v === "string" && (SENT_KINDS as string[]).includes(v);
}

/** Druh odeslaného e-mailu podle předmětu (odpověď = e-mail). */
export function inferSentKind(subject: string | null | undefined): SentKind {
  const s = (subject ?? "").trim();
  if (!s || /^(re|odp|aw|fw|fwd|wg)\s*:/i.test(s)) return "email";
  if (/upom[ií]nk|reminder|mahnung/i.test(s)) return "reminder";
  if (/(popt[aá]vk[ay]?|objedn[aá]vk[ay]?)\s+(u\s+)?dodavatel|dodavateli|\brfq\b|anfrage/i.test(s)) return "supplier";
  if (/nab[ií]dk|quotation|angebot|\bnab-\d/i.test(s)) return "quote";
  return "email";
}

export function sentKindFromApproval(type: ApprovalType): SentKind {
  if (type === "quote") return "quote";
  if (type === "reminder") return "reminder";
  if (type === "supplier_request") return "supplier";
  return "email";
}

export function approvalTypeForKind(kind: SentKind): ApprovalType {
  if (kind === "quote") return "quote";
  if (kind === "reminder") return "reminder";
  if (kind === "supplier") return "supplier_request";
  return "email_reply";
}

/** Druh položky odeslané pošty (nová pole → staré rawType). */
export function sentItemKind(item: Pick<SentItem, "rawType"> & { kind?: SentKind }): SentKind {
  return item.kind && isSentKind(item.kind) ? item.kind : sentKindFromApproval(item.rawType);
}

// ── Mapování řádků DB → view-modely ─────────────────────────

/** PostgREST vrací vnořený vztah jako objekt (s nápovědou FK) — pojistka i pro pole. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Shrnutí AI bez zástupných textů ze starších verzí (AI nebylo nastaveno). */
export function usefulAiSummary(summary: string | null | undefined): string | undefined {
  const s = (summary ?? "").trim();
  if (!s || /^AI není nakonfigurováno/i.test(s)) return undefined;
  return s;
}

const DB_CATEGORIES = Object.keys(emailCategoryLabel) as DbEmailCategory[];
const DB_PRIORITIES = Object.keys(priorityLabel) as PriorityLevel[];

export function isDbEmailCategory(v: unknown): v is DbEmailCategory {
  return typeof v === "string" && (DB_CATEGORIES as string[]).includes(v);
}

/** Český popisek kategorie → kód v DB (neznámý → null). */
export function categoryCodeFromLabel(label: string | null | undefined): DbEmailCategory | null {
  const hit = DB_CATEGORIES.find((c) => emailCategoryLabel[c] === label);
  return hit ?? null;
}

export function isPriorityLevel(v: unknown): v is PriorityLevel {
  return typeof v === "string" && (DB_PRIORITIES as string[]).includes(v);
}

export interface EmailListRow {
  id: string;
  mailbox_id: string | null;
  owner_id?: string | null;
  direction?: "in" | "out" | null;
  from_name: string | null;
  from_email: string | null;
  to_email?: string | null;
  subject: string | null;
  snippet: string | null;
  body_text?: string | null;
  category: DbEmailCategory | null;
  priority: PriorityLevel | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  is_read: boolean;
  has_draft: boolean;
  received_at: string;
  order_id?: string | null;
  customer?: { name: string | null } | { name: string | null }[] | null;
  job?: { id: string; number: string | null } | { id: string; number: string | null }[] | null;
  mailbox?: { email: string | null } | { email: string | null }[] | null;
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function toEmailItem(row: EmailListRow): EmailItem {
  const customer = one(row.customer);
  const job = one(row.job);
  const mailbox = one(row.mailbox);
  const category = isDbEmailCategory(row.category) ? row.category : "ostatni";
  const priority = isPriorityLevel(row.priority) ? row.priority : "stredni";
  const preview = clean(row.snippet) || clean(row.body_text).slice(0, 200);
  const jobId = job?.id ?? row.order_id ?? undefined;
  return {
    id: row.id,
    from: clean(row.from_name) || clean(row.from_email) || "—",
    fromEmail: clean(row.from_email),
    subject: clean(row.subject),
    preview: preview.slice(0, 200),
    category: emailCategoryLabel[category] as EmailCategory,
    priority: priorityLabel[priority] as EmailItem["priority"],
    customer: customer?.name ?? undefined,
    receivedAt: row.received_at,
    aiConfidence: Number(row.ai_confidence ?? 0) || 0,
    aiSummary: usefulAiSummary(row.ai_summary),
    unread: !row.is_read,
    hasDraft: Boolean(row.has_draft),
    mailboxId: row.mailbox_id ?? undefined,
    mailboxEmail: mailbox?.email ?? undefined,
    direction: row.direction === "out" ? "out" : "in",
    toEmail: clean(row.to_email) || undefined,
    jobId: jobId ?? undefined,
    jobNumber: job?.number ?? undefined,
  };
}

export interface SentMailRow {
  id: string;
  mailbox_id: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string;
  order_id?: string | null;
  job?: { id: string; number: string | null } | { id: string; number: string | null }[] | null;
  mailbox?: { email: string | null } | { email: string | null }[] | null;
  sender?: { full_name: string | null } | { full_name: string | null }[] | null;
}

export const SENT_BODY_MAX = 8000;

export function toSentItemFromMail(row: SentMailRow): SentItem {
  const job = one(row.job);
  const mailbox = one(row.mailbox);
  const sender = one(row.sender);
  const kind = inferSentKind(row.subject);
  const to = clean(row.to_email);
  return {
    id: row.id,
    type: SENT_KIND_STYLE[kind].label,
    rawType: approvalTypeForKind(kind),
    title: clean(row.subject) || "(bez předmětu)",
    target: to,
    body: (row.body_text ?? row.snippet ?? "").slice(0, SENT_BODY_MAX),
    sentAt: row.received_at,
    auto: false,
    toEmail: to || undefined,
    jobId: job?.id ?? row.order_id ?? undefined,
    jobNumber: job?.number ?? undefined,
    mailboxEmail: mailbox?.email ?? undefined,
    senderName: sender?.full_name ?? undefined,
    source: "mail",
    kind,
  };
}

export interface ApprovalSentRow {
  id: string;
  type: ApprovalType;
  title: string;
  target: string | null;
  payload: unknown;
  status?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export const SENT_APPROVAL_TYPES: ApprovalType[] = ["email_reply", "quote", "supplier_request", "reminder"];

export function toSentItemFromApproval(row: ApprovalSentRow): SentItem | null {
  if (!SENT_APPROVAL_TYPES.includes(row.type)) return null;
  const kind = sentKindFromApproval(row.type);
  const payload = (row.payload ?? {}) as { body?: unknown };
  const target = clean(row.target);
  return {
    id: row.id,
    type: SENT_KIND_STYLE[kind].label,
    rawType: row.type,
    title: clean(row.title),
    target,
    body: typeof payload.body === "string" ? payload.body.slice(0, SENT_BODY_MAX) : "",
    sentAt: row.resolved_at ?? row.created_at,
    auto: row.status === "auto_executed",
    toEmail: extractAddress(target) ?? undefined,
    source: "approval",
    kind,
  };
}

/** E-mailová adresa z textu („Jan <jan@firma.cz>" → jan@firma.cz), malými písmeny. */
export function extractAddress(v: string | null | undefined): string | null {
  const m = /[^\s<>"',;]+@[^\s<>"',;]+/.exec(v ?? "");
  return m ? m[0].toLowerCase() : null;
}

/**
 * Odeslaná pošta: záznamy z `emails` (direction = out) + starší log fronty
 * schvalování. Stejné odeslání je často v obou — položka fronty se spáruje
 * s e-mailem stejnému adresátovi v časovém okně a předá mu druh + příznak automatiky.
 */
export function mergeSentItems(mail: readonly SentItem[], approvals: readonly SentItem[], windowMs = 10 * 60 * 1000): SentItem[] {
  const out: SentItem[] = mail.map((m) => ({ ...m }));
  const used = new Set<number>();
  for (const a of approvals) {
    const addr = a.toEmail ?? extractAddress(a.target);
    const at = Date.parse(a.sentAt);
    let match = -1;
    let best = Infinity;
    if (addr && Number.isFinite(at)) {
      out.forEach((m, i) => {
        if (used.has(i) || m.source === "approval") return;
        const mAddr = m.toEmail ?? extractAddress(m.target);
        if (mAddr !== addr) return;
        const d = Math.abs(Date.parse(m.sentAt) - at);
        if (Number.isFinite(d) && d <= windowMs && d < best) {
          best = d;
          match = i;
        }
      });
    }
    if (match >= 0) {
      used.add(match);
      const m = out[match];
      const kind = a.kind ?? sentKindFromApproval(a.rawType);
      out[match] = {
        ...m,
        auto: m.auto || a.auto,
        kind,
        rawType: a.rawType,
        type: SENT_KIND_STYLE[kind].label,
        body: m.body || a.body,
      };
    } else {
      out.push({ ...a });
    }
  }
  return out.sort((x, y) => (Date.parse(y.sentAt) || 0) - (Date.parse(x.sentAt) || 0));
}

// ── Zakázka z e-mailu ───────────────────────────────────────

/** Objednávka / potvrzení → zakázka ve stavu Objednávka, jinak Poptávka. */
export function jobStageForEmailCategory(category: DbEmailCategory | null | undefined): Extract<JobStage, "poptavka" | "objednavka"> {
  return category === "objednavka" || category === "potvrzeni_objednavky" ? "objednavka" : "poptavka";
}

export const JOB_TITLE_MAX = 120;

/** Název zakázky z předmětu — bez „Re:/Fwd:/Odp:" a ořezaný na 120 znaků. */
export function jobTitleFromSubject(subject: string | null | undefined): string {
  let s = clean(subject);
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^(re|odp|aw|fw|fwd|wg|tr)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  s = s.trim();
  if (!s) return "Zakázka z e-mailu";
  return s.length > JOB_TITLE_MAX ? `${s.slice(0, JOB_TITLE_MAX - 1).trimEnd()}…` : s;
}

/** Datum RRRR-MM-DD v pražském čase (přijetí e-mailu kolem půlnoci). */
export function pragueDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(d);
}

export interface EmailForJob {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  customer_id: string | null;
  category: DbEmailCategory | null;
  received_at: string;
  ai_summary: string | null;
  snippet: string | null;
}

/**
 * Kdo zakázku z e-mailu vlastní (#25 §5): obchodník / super admin, kterému patří schránka → Obchodník;
 * zaměstnanec, kterému patří schránka → Zpracovává (Obchodník = obchodník zákazníka, jinak klikající
 * obchodník / super admin, jinak nikdo); schránka bez vlastníka (info@) → obchodník zákazníka, jinak klikající.
 */
export function jobPeopleFromEmail(input: {
  mailboxOwner: { id: string; role: string } | null;
  customerOwnerId: string | null;
  actor: { id: string; role: string };
}): { ownerId: string | null; assigneeId: string | null } {
  const sales = (r: string) => r === "obchodnik" || r === "super_admin";
  const box = input.mailboxOwner;
  if (box && sales(box.role)) return { ownerId: box.id, assigneeId: null };
  if (box) {
    return { ownerId: input.customerOwnerId ?? (sales(input.actor.role) ? input.actor.id : null), assigneeId: box.id };
  }
  return { ownerId: input.customerOwnerId ?? input.actor.id, assigneeId: null };
}

/** Kategorie e-mailu, jejichž přílohy vystavil dodavatel (nabídka, faktura — fail closed). */
const SUPPLIER_MAIL_CATEGORIES: readonly DbEmailCategory[] = ["nabidka_dodavatele", "faktura"];
/** Kategorie, jejichž přílohy od ZÁKAZNÍKA jsou podklady (poptávka, objednávka, reklamace, výkresy). */
const CUSTOMER_MAIL_CATEGORIES: readonly DbEmailCategory[] = [
  "poptavka", "objednavka", "potvrzeni_objednavky", "reklamace", "technicka_dokumentace",
];

/**
 * Kdo vystavil přílohy e-mailu, které se kopírují do Dokumentů zakázky (#25 §4.2):
 * dodavatel (nabídka dodavatele, faktura, nebo e-mail jen od dodavatele) → nákupní doklad, zaměstnanci
 * zamčený; zákazník (poptávka, objednávka, reklamace, technická dokumentace od zákazníka) → podklad,
 * ne nákupní doklad; jinak null (u cenových druhů pak platí „neznámý vystavitel" = zamčeno).
 */
export function attachmentIssuer(email: {
  category: DbEmailCategory | null | undefined;
  supplierId?: string | null;
  customerId?: string | null;
}): "dodavatel" | "zakaznik" | null {
  const category = email.category ?? null;
  if (category && SUPPLIER_MAIL_CATEGORIES.includes(category)) return "dodavatel";
  if (email.supplierId && !email.customerId) return "dodavatel";
  if (email.customerId && !email.supplierId && category && CUSTOMER_MAIL_CATEGORIES.includes(category)) return "zakaznik";
  return null;
}

/** Řádek nové zakázky (orders) z e-mailu — bez čísla a id uživatele se nevolá. */
export function buildJobFromEmail(
  email: EmailForJob,
  input: { number: string; actorId: string; customerId?: string | null; ownerId?: string | null; assigneeId?: string | null },
): Record<string, unknown> {
  const stage = jobStageForEmailCategory(email.category);
  const date = pragueDate(email.received_at);
  const note = usefulAiSummary(email.ai_summary) ?? (clean(email.snippet) || null);
  return {
    number: input.number,
    title: jobTitleFromSubject(email.subject),
    status: stage,
    customer_id: input.customerId ?? email.customer_id ?? null,
    customer_contact_email: clean(email.from_email).slice(0, 200) || null,
    customer_contact: clean(email.from_name).slice(0, 200) || null,
    ...(stage === "objednavka" ? { order_date: date } : { inquiry_date: date }),
    source: "email",
    email_id: email.id,
    created_by: input.actorId,
    owner_id: input.ownerId !== undefined ? input.ownerId : input.actorId,
    ...(input.assigneeId ? { assignee_id: input.assigneeId } : {}),
    note: note ? note.slice(0, 2000) : null,
  };
}

// ── Filtr Inboxu (klient) ───────────────────────────────────

export type InboxFilter = "Vše" | EmailCategory;

/** Malá písmena bez diakritiky — hledání „poptavka" najde „Poptávka". */
export function foldText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesEmailSearch(email: EmailItem, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = foldText(
    [email.from, email.fromEmail, email.subject, email.preview, email.customer, email.jobNumber, email.mailboxEmail]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((w) => hay.includes(w));
}

/** „Vše" = bez spamu (spam se filtruje automaticky, je vidět jen pod chipem Spam). */
export function filterInbox(
  emails: readonly EmailItem[],
  f: { category: InboxFilter; query?: string; unreadOnly?: boolean },
): EmailItem[] {
  return emails.filter((e) => {
    const cat = categoryStyle(e.category).label;
    if (f.category === "Vše" ? cat === "Spam" : cat !== f.category) return false;
    if (f.unreadOnly && !e.unread) return false;
    return matchesEmailSearch(e, f.query ?? "");
  });
}

/** Odpověď v poštovním programu (mailto:) — bez AI. */
export function mailtoReply(email: Pick<EmailItem, "fromEmail" | "subject">): string | null {
  const to = extractAddress(email.fromEmail);
  if (!to) return null;
  const subject = /^(re|odp)\s*:/i.test(email.subject.trim()) ? email.subject.trim() : `Re: ${email.subject.trim()}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}`;
}

// ── Filtr odeslané pošty (klient) ───────────────────────────

export type SentFilter = "all" | SentKind | "auto";

export function filterSent(
  items: readonly SentItem[],
  f: { kind: SentFilter; query?: string },
): SentItem[] {
  const words = foldText(f.query).split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f.kind === "auto" ? !i.auto : f.kind !== "all" && sentItemKind(i) !== f.kind) return false;
    if (!words.length) return true;
    const hay = foldText([i.title, i.target, i.toEmail, i.jobNumber, i.mailboxEmail, i.senderName].filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

export function countSentKinds(items: readonly SentItem[]): Record<SentFilter, number> {
  const out: Record<SentFilter, number> = { all: items.length, email: 0, quote: 0, reminder: 0, supplier: 0, auto: 0 };
  for (const i of items) {
    out[sentItemKind(i)] += 1;
    if (i.auto) out.auto += 1;
  }
  return out;
}
