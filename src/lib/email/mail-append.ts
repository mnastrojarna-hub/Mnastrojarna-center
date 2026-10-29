import "server-only";
import type { ImapFlow } from "imapflow";
import { imapLogin, type NetOptions } from "@/lib/email/mail-connect";
import { classifyMailError, describeMailError, rawErrorText, resolveIncoming } from "@/lib/email/mail-config";
import { findSentFolder, type FolderInfo } from "@/lib/email/mail-folders";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * Kopie odeslaného e-mailu do složky Odeslané na IMAP serveru (APPEND, příznak \Seen) — aby ho
 * uživatel viděl i ve webmailu / Outlooku. Selhání odeslání neshodí (vrací stav a důvod).
 */

export type SentCopyState = "ok" | "failed" | "skipped";
export interface SentCopyResult {
  state: SentCopyState;
  error?: string;
  folder?: string;
}

/** Složka odeslané pošty na otevřeném IMAP spojení (null = nenalezena). */
export async function detectSentFolder(client: ImapFlow): Promise<FolderInfo | null> {
  const list = await client.list();
  return findSentFolder(
    list.map((f) => ({ path: f.path, specialUse: f.specialUse ?? null, flags: f.flags ? [...f.flags] : [], delimiter: f.delimiter ?? null })),
  );
}

export async function appendToSent(
  box: { email: string; config: MailboxConfig | null | undefined; provider?: string | null },
  raw: Buffer,
  opts: NetOptions = {},
): Promise<SentCopyResult> {
  if (box.provider === "outlook") return { state: "ok", folder: "Odeslaná pošta (Microsoft 365)" }; // Graph ukládá sám
  const incoming = resolveIncoming(box.config, box.email);
  if (!incoming) return { state: "skipped", error: "schránka nemá nastavený příchozí server" };
  if (incoming.protocol !== "imap") return { state: "skipped", error: "POP3 nemá složku Odeslané (jen IMAP)" };
  let client: ImapFlow | undefined;
  try {
    const res = await imapLogin(incoming, { user: incoming.user, pass: incoming.password }, { timeoutMs: opts.timeoutMs ?? 10_000, ca: opts.ca, keepOpen: true });
    client = res.client!;
    const folder = await detectSentFolder(client);
    if (!folder) return { state: "failed", error: "na serveru není složka Odeslané (Sent)" };
    await client.append(folder.path, raw, ["\\Seen"], new Date());
    return { state: "ok", folder: folder.path };
  } catch (err) {
    const kind = classifyMailError(err);
    return { state: "failed", error: describeMailError(kind, { endpoint: incoming, raw: rawErrorText(err), user: incoming.user }) };
  } finally {
    if (client) await client.logout().catch(() => client?.close());
  }
}
