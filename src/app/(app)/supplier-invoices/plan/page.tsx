import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth/session";
import { createOperatorClient } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { todayIso } from "@/lib/jobs/mapping";
import { loadPaymentPlan } from "@/lib/supplier-invoices/payment-plan-store";
import { SupplierInvoiceTabs } from "@/components/supplier-invoices/invoice-tabs";
import { PaymentPlan } from "@/components/supplier-invoices/payment-plan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Platební plán" };

/** Faktury dodavatelů → Platební plán (jen super admin): poznámky komu, kolik, kdy zaplatit. */
export default async function PaymentPlanPage() {
  await requireFeature("supplier_invoices");
  const user = await requireFeature("supplier_invoices_paid");
  const db = (await createOperatorClient({ actor: userActor(user) })) as unknown as JobsDb;
  const data = await loadPaymentPlan(db, todayIso());
  return (
    <div className="space-y-3">
      <SupplierInvoiceTabs active="plan" />
      {"error" in data ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">Platební plán se nepodařilo načíst: {data.error}</p>
      ) : (
        <PaymentPlan data={data} />
      )}
    </div>
  );
}
