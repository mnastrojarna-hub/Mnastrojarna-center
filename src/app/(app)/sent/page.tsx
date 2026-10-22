import { PageHeader } from "@/components/page-header";
import { SentList } from "@/components/sent-list";
import { getMailboxesForUser, getSentMail } from "@/lib/data/mail";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { NO_MAILBOX } from "@/lib/email/visibility";

export const dynamic = "force-dynamic";

/** Odeslaná pošta: každý svou, super admin všechny schránky (+ starší log fronty schvalování). */
export default async function SentPage({
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
  const items = await getSentMail({ mailboxId });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Odeslaná pošta"
        description={
          all
            ? "Vše, co odešlo ven ze všech schránek — ručně, po schválení i plnou automatikou. Klikni a přečti si přesný text."
            : "Co jsi odeslal(a) ven — komu, kdy a ke které zakázce. Klikni a přečti si přesný text."
        }
      />
      <SentList
        items={items}
        mailboxes={all ? mailboxes : []}
        mailboxId={mailboxId ?? null}
        scope={all ? "all" : "own"}
      />
    </div>
  );
}
