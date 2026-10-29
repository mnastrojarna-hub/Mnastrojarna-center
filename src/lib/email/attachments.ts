import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchImapMessage, isSyntheticMessageId } from "@/lib/email/mail-fetch";
import { resolveIncoming } from "@/lib/email/mail-config";
import { extractPart } from "@/lib/email/mime-parts";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * Obsah přílohy e-mailu: z úložiště (odeslané, POP3, import), jinak ze serveru (IMAP — celá zpráva
 * podle složky a UID, ověřená UIDVALIDITY a Message-ID — jinak dohledaná podle Message-ID; příloha podle
 * čísla části). Viditelnost e-mailu kontroluje volající.
 */

export interface LoadedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

const BUCKET = "documents";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function loadEmailAttachment(attachmentId: string): Promise<{ ok: true; file: LoadedAttachment; emailId: string } | { ok: false; error: string }> {
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data: a } = await db.from("email_attachments").select("id, email_id, filename, mime_type, storage_path, imap_part, size_bytes").eq("id", attachmentId).maybeSingle();
  const att = a as { id: string; email_id: string; filename: string | null; mime_type: string | null; storage_path: string | null; imap_part: string | null; size_bytes: number | null } | null;
  if (!att) return { ok: false, error: "Příloha nenalezena." };
  const filename = (att.filename ?? "").trim() || "priloha";
  if (att.size_bytes && att.size_bytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Příloha je příliš velká (max. 20 MB)." };
  if (att.storage_path) {
    if (att.storage_path.includes("..") || att.storage_path.startsWith("/")) return { ok: false, error: "Neplatná cesta přílohy." };
    const { data: blob, error } = await db.storage.from(BUCKET).download(att.storage_path);
    if (error || !blob) return { ok: false, error: `Přílohu se nepodařilo načíst z úložiště${error?.message ? `: ${error.message}` : "."}` };
    return { ok: true, emailId: att.email_id, file: { filename, contentType: att.mime_type || "application/octet-stream", content: Buffer.from(await blob.arrayBuffer()) } };
  }
  if (!att.imap_part) return { ok: false, error: "Obsah přílohy není k dispozici (zpráva bez uložené přílohy)." };
  const { data: em } = await db.from("emails").select("mailbox_id, imap_folder, imap_uid, imap_uidvalidity, message_id").eq("id", att.email_id).maybeSingle();
  const mail = em as { mailbox_id: string | null; imap_folder: string | null; imap_uid: number | null; imap_uidvalidity: string | null; message_id: string | null } | null;
  if (!mail?.mailbox_id || (!mail.imap_uid && (!mail.message_id || isSyntheticMessageId(mail.message_id)))) {
    return { ok: false, error: "Zpráva už není spojená se schránkou na serveru." };
  }
  const { data: box } = await db.from("mailboxes").select("email, config").eq("id", mail.mailbox_id).maybeSingle();
  const mb = box as { email: string; config: MailboxConfig | null } | null;
  const incoming = mb ? resolveIncoming(mb.config, mb.email) : null;
  if (!mb || !incoming || incoming.protocol !== "imap") return { ok: false, error: "Schránka nemá IMAP — přílohu nelze ze serveru stáhnout." };
  try {
    const synthetic = /^imap-.+-(\d+)-\d+$/.exec(mail.message_id ?? "");
    const res = await fetchImapMessage(incoming, mb.email, {
      folder: mail.imap_folder || "INBOX",
      uid: mail.imap_uid ? Number(mail.imap_uid) : null,
      uidValidity: mail.imap_uidvalidity ?? synthetic?.[1] ?? null,
      messageId: mail.message_id,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.reason === "changed"
          ? "Zpráva na serveru se změnila (schránka byla přenastavená nebo složka přečíslovaná) — tuto přílohu už ze serveru stáhnout nejde."
          : "Zpráva už na serveru není (smazaná nebo přesunutá).",
      };
    }
    // dohledáno podle Message-ID pod jiným UID → uložit, ať se příště nehledá
    if (res.uid !== Number(mail.imap_uid) || res.uidValidity !== mail.imap_uidvalidity) {
      await db.from("emails").update({ imap_uid: res.uid, imap_uidvalidity: res.uidValidity }).eq("id", att.email_id);
    }
    const part = extractPart(res.source, att.imap_part);
    if (!part) return { ok: false, error: "Příloha ve zprávě nenalezena." };
    if (part.content.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Příloha je příliš velká (max. 20 MB)." };
    return { ok: true, emailId: att.email_id, file: { filename: part.filename?.trim() || filename, contentType: att.mime_type || part.contentType || "application/octet-stream", content: part.content } };
  } catch (err) {
    return { ok: false, error: `Přílohu se nepodařilo stáhnout ze serveru (${err instanceof Error ? err.message : "chyba"}).` };
  }
}
