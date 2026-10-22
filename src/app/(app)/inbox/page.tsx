import { InboxView } from "./inbox-view";
import { getEmails, getMailboxesForUser } from "@/lib/data/mail";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { NO_MAILBOX } from "@/lib/email/visibility";

export const dynamic = "force-dynamic";

/** Přijatá pošta: každý svou schránku, super admin všechny (přepínač schránek). */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("mail");
  const sp = await searchParams;
  const raw = typeof sp.schranka === "string" ? sp.schranka : undefined;
  const [{ can }, mailboxes] = await Promise.all([getAccess(), getMailboxesForUser()]);
  const all = can("mail_all");
  const mailboxId =
    raw && ((all && raw === NO_MAILBOX) || mailboxes.some((m) => m.id === raw)) ? raw : undefined;
  const emails = await getEmails({ direction: "in", mailboxId, limit: 200 });

  return (
    <InboxView
      emails={emails}
      mailboxes={mailboxes}
      scope={all ? "all" : "own"}
      mailboxId={mailboxId ?? null}
    />
  );
}
