/**
 * Vlákna a odpovědi — čistá logika (server i klient, testy v threading.test.ts).
 *
 * Do vlákna řadí e-maily DB (trigger emails_thread_assign, migrace 20261029100000): podle
 * In-Reply-To / References (Message-ID), jinak odpověď bez hlaviček podle předmětu bez „Re:" +
 * protistrany. TS dvojče normalizace předmětu (`normalizeSubject`, `isReplySubject`, `subjectKey`)
 * MUSÍ odpovídat SQL funkcím mail_subject_norm / mail_subject_is_reply / mail_first_address.
 */

/** Předpony odpovědi / přeposlání (cs, en, de, fr, sk, nordic). */
const PREFIX_RE = /^\s*((re|odp|aw|fw|fwd|wg|tr|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i;
const REPLY_RE = /^\s*(re|odp|aw|fw|fwd|wg|tr|sv|vs)\s*(\[\d+\])?\s*:/i;
const ADDRESS_RE = /[^\s<>",;]+@[^\s<>",;]+/;

/** Předmět bez „Re:/Fwd:/Odp:", malými písmeny, jedna mezera (= SQL mail_subject_norm). */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "").replace(PREFIX_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Předmět začíná předponou odpovědi / přeposlání (= SQL mail_subject_is_reply). */
export function isReplySubject(subject: string | null | undefined): boolean {
  return REPLY_RE.test(subject ?? "");
}

/** První e-mailová adresa z textu, malými písmeny (= SQL mail_first_address). */
export function firstAddress(value: string | null | undefined): string | null {
  const m = ADDRESS_RE.exec(value ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** Klíč vlákna bez hlaviček: předmět + protistrana (příchozí = odesílatel, odchozí = první adresát). */
export function subjectKey(email: { subject: string | null | undefined; direction: "in" | "out"; fromEmail?: string | null; toEmail?: string | null }): string {
  const party = firstAddress(email.direction === "out" ? email.toEmail : email.fromEmail) ?? "";
  return `${normalizeSubject(email.subject)}|${party}`;
}

/** Message-ID ve tvaru <…> (hlavičky In-Reply-To / References ho tak vyžadují). */
export function bracketId(id: string | null | undefined): string | null {
  const v = (id ?? "").trim();
  if (!v) return null;
  return v.startsWith("<") ? v : `<${v.replace(/^<|>$/g, "")}>`;
}

/** Seznam Message-ID z hlavičky References / In-Reply-To („<a@b> <c@d>"). */
export function parseMessageIds(header: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (header ?? "").matchAll(/<[^<>\s]+>/g)) if (!out.includes(m[0])) out.push(m[0]);
  if (!out.length) {
    const bare = (header ?? "").trim();
    if (bare && !/\s/.test(bare)) out.push(bracketId(bare)!);
  }
  return out;
}

export interface ReplySource {
  messageId: string | null | undefined;
  /** References původní zprávy (nejstarší první). */
  references?: string[] | null;
  subject: string | null | undefined;
}

/** Předmět odpovědi: „Re: <předmět>" (už začíná-li Re:/Odp:, beze změny). */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (/^(re|odp)\s*:/i.test(s)) return s;
  return `Re: ${s.replace(PREFIX_RE, "").trim() || "(bez předmětu)"}`;
}

/** Předmět přeposlání: „Fwd: <předmět>". */
export function forwardSubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (/^(fw|fwd)\s*:/i.test(s)) return s;
  return `Fwd: ${s.replace(PREFIX_RE, "").trim() || "(bez předmětu)"}`;
}

/**
 * Hlavičky odpovědi (RFC 5322 §3.6.4): In-Reply-To = Message-ID původní zprávy, References =
 * References původní + její Message-ID (bez duplicit, max. 20 posledních — dlouhá vlákna).
 */
export function replyHeaders(src: ReplySource): { inReplyTo?: string; references: string[] } {
  const own = bracketId(src.messageId);
  const refs = (src.references ?? []).map((r) => bracketId(r)).filter((r): r is string => Boolean(r));
  const all = [...refs, ...(own ? [own] : [])].filter((r, i, a) => a.indexOf(r) === i);
  return { ...(own ? { inReplyTo: own } : {}), references: all.slice(-20) };
}

function fmtDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
}

export interface QuoteSource {
  fromName?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  ccEmail?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  body?: string | null;
}

/** Citace původní zprávy pod odpovědí („Dne … napsal(a):" + řádky s „> "). */
export function quoteForReply(src: QuoteSource): string {
  const who = [src.fromName?.trim(), src.fromEmail?.trim() ? `<${src.fromEmail.trim()}>` : ""].filter(Boolean).join(" ") || "odesílatel";
  const when = fmtDate(src.receivedAt);
  const lines = (src.body ?? "").replace(/\r\n/g, "\n").trimEnd().split("\n").map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`));
  return `${when ? `Dne ${when} ` : ""}${who} napsal(a):\n${lines.join("\n")}`;
}

/** Blok přeposlané zprávy (hlavička + celé tělo). */
export function forwardBlock(src: QuoteSource): string {
  const head = [
    "---------- Přeposlaná zpráva ----------",
    `Od: ${[src.fromName?.trim(), src.fromEmail?.trim() ? `<${src.fromEmail.trim()}>` : ""].filter(Boolean).join(" ") || "—"}`,
    src.receivedAt ? `Datum: ${fmtDate(src.receivedAt)}` : null,
    `Předmět: ${src.subject?.trim() || "(bez předmětu)"}`,
    src.toEmail ? `Komu: ${src.toEmail}` : null,
    src.ccEmail ? `Kopie: ${src.ccEmail}` : null,
  ].filter(Boolean);
  return `${head.join("\n")}\n\n${(src.body ?? "").replace(/\r\n/g, "\n").trimEnd()}`;
}

/** Podpis pod text („-- " oddělovač podle RFC 3676). */
export function withSignature(text: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  return sig ? `${text}\n\n-- \n${sig}` : text;
}

/** Rozdělí seznam adres („a@b.cz, Jan <c@d.cz>; e@f.cz") na adresy, malými písmeny, bez duplicit. */
export function splitAddresses(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (value ?? "").matchAll(/[^\s<>",;]+@[^\s<>",;]+/g)) {
    const a = m[0].toLowerCase();
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Adresáti odpovědi. Odpovědět = odesílatel (u vlastní odeslané zprávy její adresáti);
 * Odpovědět všem = navíc ostatní adresáti a kopie — bez mých adres a bez duplicit.
 */
export function replyRecipients(
  msg: { direction: "in" | "out"; fromEmail?: string | null; toEmail?: string | null; ccEmail?: string | null },
  mine: readonly string[],
  all: boolean,
): { to: string[]; cc: string[] } {
  const me = new Set(mine.map((m) => m.toLowerCase()));
  const notMe = (a: string) => !me.has(a);
  const from = splitAddresses(msg.fromEmail);
  const toList = splitAddresses(msg.toEmail);
  const ccList = splitAddresses(msg.ccEmail);
  const primary = msg.direction === "out" ? toList : from;
  const to = primary.filter(notMe);
  if (!all) return { to: to.length ? to : primary.slice(0, 1), cc: [] };
  const rest = [...(msg.direction === "out" ? [] : toList), ...ccList].filter((a) => notMe(a) && !to.includes(a));
  return { to: to.length ? to : primary.slice(0, 1), cc: rest.filter((a, i) => rest.indexOf(a) === i) };
}

export interface ThreadMessageLike {
  id: string;
  receivedAt: string;
}

/** Zprávy vlákna od nejstarší po nejnovější (stabilně podle času, pak id). */
export function sortThread<T extends ThreadMessageLike>(messages: readonly T[]): T[] {
  return messages.slice().sort((a, b) => (Date.parse(a.receivedAt) || 0) - (Date.parse(b.receivedAt) || 0) || a.id.localeCompare(b.id));
}
