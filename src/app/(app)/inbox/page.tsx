import { InboxView } from "./inbox-view";
import { getMailboxesForUser } from "@/lib/data/mail";
import { getFolderCounts, listThreads } from "@/lib/data/mail-threads";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { NO_MAILBOX } from "@/lib/email/visibility";
import { isMailFolder } from "@/lib/email/mail-types";

export const dynamic = "force-dynamic";

/** Přijatá pošta: vlákna ve složkách (Přijaté / Odeslané / Označené / Vše / Spam), každý svou schránku, super admin všechny. */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("mail");
  const sp = await searchParams;
  const raw = typeof sp.schranka === "string" ? sp.schranka : undefined;
  const folder = isMailFolder(sp.slozka) ? sp.slozka : "inbox";
  const [{ can }, mailboxes] = await Promise.all([getAccess(), getMailboxesForUser()]);
  const all = can("mail_all");
  const mailboxId =
    raw && ((all && raw === NO_MAILBOX) || mailboxes.some((m) => m.id === raw)) ? raw : undefined;
  const [initial, counts] = await Promise.all([
    listThreads({ folder, mailboxId: mailboxId ?? null, limit: 50 }),
    getFolderCounts(mailboxId ?? null),
  ]);

  return (
    <InboxView
      initial={initial}
      counts={counts}
      mailboxes={mailboxes}
      scope={all ? "all" : "own"}
      mailboxId={mailboxId ?? null}
      folder={folder}
    />
  );
}
