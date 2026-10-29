import type { EmailCategory } from "@/lib/data/types";

/** Typy Přijaté pošty (vlákna, složky) — sdílí server i klient. */

export type MailFolder = "inbox" | "jobs" | "sent" | "flagged" | "all" | "spam" | "shared";
export const MAIL_FOLDERS: MailFolder[] = ["inbox", "jobs", "sent", "flagged", "all", "spam", "shared"];
export const FOLDER_LABEL: Record<MailFolder, string> = {
  inbox: "Přijaté",
  jobs: "K zakázkám",
  sent: "Odeslané",
  flagged: "Označené",
  all: "Vše",
  spam: "Spam",
  shared: "Předané mně",
};

export type MailSort = "date" | "priority" | "flag" | "unread";
export const SORT_LABEL: Record<MailSort, string> = {
  date: "Nejnovější",
  priority: "Podle priority",
  flag: "Označené nahoře",
  unread: "Nepřečtené nahoře",
};

export function isMailFolder(v: unknown): v is MailFolder {
  return typeof v === "string" && (MAIL_FOLDERS as string[]).includes(v);
}
export function isMailSort(v: unknown): v is MailSort {
  return v === "date" || v === "priority" || v === "flag" || v === "unread";
}

export interface ThreadQuery {
  folder: MailFolder;
  /** Id schránky, NO_MAILBOX, nebo null = všechny moje. */
  mailboxId?: string | null;
  query?: string;
  /** Jen priorita ≤ (1 = jen nejvyšší). */
  priorityMax?: number | null;
  unreadOnly?: boolean;
  /** Kategorie (český popisek, např. „Poptávka"); null = všechny. */
  category?: EmailCategory | null;
  sort?: MailSort;
  offset?: number;
  limit?: number;
}

export interface ThreadSummary {
  threadId: string;
  /** Zobrazená zpráva vlákna (nejnovější ve složce). */
  emailId: string;
  mailboxId: string | null;
  mailboxEmail?: string;
  direction: "in" | "out";
  from: string;
  fromEmail: string;
  toEmail?: string;
  subject: string;
  preview: string;
  category: EmailCategory;
  aiConfidence: number;
  aiSummary?: string;
  /** Poslední zpráva vlákna (ve složce Odeslané poslední odeslaná). */
  lastAt: string;
  jobId?: string;
  jobNumber?: string;
  customer?: string;
  hasDraft: boolean;
  messageCount: number;
  unreadCount: number;
  flagged: boolean;
  /** Účinná priorita 1 (nejvyšší) – 5. */
  priority: number;
  /** Prioritu nastavil člověk (jinak z AI / pravidel). */
  priorityManual: boolean;
  hasAttachments: boolean;
  aiPending: boolean;
  /** Předáno mně kolegou: poznámka, kdo, nepřečteno. */
  share?: { note: string | null; by: string | null; unread: boolean };
  /** Pošta B: název zakázky vlákna, jak a kdo ji přiřadil. */
  jobTitle?: string;
  jobLinkSource?: string;
  jobLinkActor?: string;
  /** Pošta B: návrh „Patří k Z-…?" (vlákno bez zakázky). */
  suggestion?: JobSuggestionRef;
}

export interface JobSuggestionRef {
  id: string;
  jobId: string;
  jobNumber: string;
  jobTitle?: string;
  score: number;
  /** Otázka k jedné zprávě vlákna, které patří jiné zakázce (odpověď jmenuje tuto zakázku). */
  forMessage?: boolean;
  /** Zpráva, ke které otázka patří (do rozhodnutí u ní neutrální kategorie „K zakázce?"). */
  emailId?: string;
}

export interface ThreadPage {
  items: ThreadSummary[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface FolderCounts {
  inboxUnread: number;
  flagged: number;
  spam: number;
  shared: number;
  sharedUnread: number;
  aiPending: number;
  /** Pošta B: vlákna k zakázkám s nepřečtenou poštou, návrhy přiřazení. */
  jobsUnread?: number;
  jobSuggestions?: number;
}

export const EMPTY_COUNTS: FolderCounts = { inboxUnread: 0, flagged: 0, spam: 0, shared: 0, sharedUnread: 0, aiPending: 0, jobsUnread: 0, jobSuggestions: 0 };

export interface ThreadAttachment {
  id: string;
  filename: string;
  sizeBytes: number | null;
  mimeType: string | null;
}

export interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  mailboxId: string | null;
  mailboxEmail?: string;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  ccEmail: string;
  bccEmail?: string;
  subject: string;
  body: string;
  receivedAt: string;
  isRead: boolean;
  flagged: boolean;
  flaggedBy?: string | null;
  /** Ruční priorita (null = z AI). */
  manualPriority: number | null;
  priority: number;
  prioritySetBy?: string | null;
  category: EmailCategory;
  aiConfidence: number;
  aiSummary?: string;
  aiPending: boolean;
  hasDraft: boolean;
  jobId?: string;
  jobNumber?: string;
  /** Pošta B: jak a kdo zprávu přiřadil k zakázce. */
  jobLinkSource?: string | null;
  jobLinkActor?: string | null;
  customer?: string;
  messageId: string | null;
  references: string[];
  attachments: ThreadAttachment[];
  sentCopy?: "ok" | "failed" | "skipped" | null;
  sentCopyError?: string | null;
  senderName?: string | null;
}

export interface ThreadShare {
  id: string;
  by: string | null;
  to: string | null;
  toId: string;
  note: string | null;
  at: string;
  readAt: string | null;
}

export interface ThreadDetail {
  ok: boolean;
  error?: string;
  threadId?: string;
  subject?: string;
  messages?: ThreadMessage[];
  shares?: ThreadShare[];
  /** Moje adresy (pro „Odpovědět všem" bez sebe). */
  myAddresses?: string[];
  /** Zakázka vlákna (pro přílohy z dokumentů zakázky). */
  jobId?: string | null;
  /** Pošta B: číslo a název zakázky vlákna, návrh přiřazení. */
  jobNumber?: string | null;
  jobTitle?: string | null;
  suggestion?: JobSuggestionRef | null;
}

/** Text průběhu stahování („Staženo 340 z 2 150"). */
export function progressText(total: number, remaining: number): string {
  const done = Math.max(0, total - remaining);
  const f = (n: number) => n.toLocaleString("cs-CZ");
  return total > 0 ? `Staženo ${f(done)} z ${f(total)}` : "Stahuji…";
}

/** „1 vlákno", „2 vlákna", „5 vláken" (počet v hlavičce seznamu). */
export function threadCountLabel(n: number): string {
  const f = n.toLocaleString("cs-CZ");
  return `${f} ${n === 1 ? "vlákno" : n >= 2 && n <= 4 ? "vlákna" : "vláken"}`;
}
