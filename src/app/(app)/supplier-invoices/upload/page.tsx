import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { InvoiceRecorder } from "@/components/supplier-invoices/invoice-recorder";
import { emailInvoiceSource } from "@/lib/supplier-invoices/record-email";
import { supplierInvoicePerms } from "@/lib/supplier-invoices/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Zanést fakturu" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Zanést fakturu dodavatele — smí každý. Jen samotná faktura (PDF / fotka), AI přečte vše a zapíše ji;
 * nahrávající vidí potvrzení s hlavičkou. ?email=<id> (Pošta → Zapsat fakturu dodavatele) = příloha
 * e-mailu předvybraná.
 */
export default async function UploadSupplierInvoicePage({ searchParams }: { searchParams: Search }) {
  await requireFeature("supplier_invoices_upload");
  const sp = await searchParams;
  const { can } = await getAccess();
  const perms = supplierInvoicePerms(can);
  const emailId = typeof sp.email === "string" ? sp.email : "";
  const email = emailId ? await emailInvoiceSource(emailId) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md"><ReceiptText className="h-6 w-6" /></span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Zanést fakturu</h1>
          <p className="text-sm text-muted-foreground">
            Jen samotná faktura od dodavatele — PDF nebo fotka. AI z ní přečte dodavatele, částky, splatnost i položky a zapíše ji.
          </p>
        </div>
      </div>
      {emailId && !email && (
        <p className="rounded-xl border px-3 py-2 text-sm text-muted-foreground">E-mail nenalezen (nebo k němu nemáš přístup) — nahraj fakturu jako soubor.</p>
      )}
      {email && !email.attachments.some((a) => a.usable) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="invoice-email-none">
          E-mail „{email.subject || "bez předmětu"}“ nemá přílohu s fakturou (PDF nebo obrázek) — nahraj ji jako soubor.
        </p>
      )}
      <InvoiceRecorder email={email} canOpen={perms.view && perms.amounts} />
    </div>
  );
}
