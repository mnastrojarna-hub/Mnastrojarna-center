import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ApprovalQueue } from "@/components/approval-queue";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getApprovalQueue, getResolvedApprovals } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/**
 * Fronta ke schválení (9. 11.) pro kolegu se „Smí řešit frontu ke schválení" (Šponer): odchozí e-maily, objednávky
 * dodavatelům v režimu „se schválením", návrhy stavu zakázky z pošty a další AI akce. AI návrhy nabídek schvaluje
 * dál super admin (v seznamu nejsou). Super admin má frontu v AI přehledu → přesměrování tam.
 */
export default async function ApprovalsPage() {
  await requireFeature("approval_queue");
  const { can } = await getAccess();
  if (can("dashboard")) redirect("/dashboard#fronta");
  const [approvals, resolved] = await Promise.all([getApprovalQueue(), getResolvedApprovals(8)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fronta ke schválení"
        description="Co AI a systém připravily a čeká na tvoje potvrzení — e-maily zákazníkům a dodavatelům, objednávky dodavatelům a změny stavu zakázek z pošty. Červené tlačítko odešle e-mail ze tvé schránky, zelené jen potvrdí změnu v systému."
      />
      <div className="max-w-4xl">
        <ApprovalQueue initialItems={approvals} recent={resolved} />
      </div>
    </div>
  );
}
