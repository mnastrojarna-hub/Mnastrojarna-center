import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { InvoiceUploader } from "@/components/supplier-invoices/invoice-uploader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nahrát fakturu" };

/** Nahrát fakturu dodavatele — smí každý; bez práva na faktury jen „Děkujeme, nahráno". */
export default async function UploadSupplierInvoicePage() {
  await requireFeature("supplier_invoices_upload");
  const { can } = await getAccess();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md"><ReceiptText className="h-6 w-6" /></span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Nahrát fakturu dodavatele</h1>
          <p className="text-sm text-muted-foreground">
            {can("supplier_invoices")
              ? "Vyfoť nebo nahraj fakturu — AI přečte dodavatele, položky a navrhne rozdělení na zakázky."
              : "Vyfoť nebo nahraj fakturu od dodavatele — zpracuje ji super admin. Fakturu po nahrání neuvidíš."}
          </p>
        </div>
      </div>
      <InvoiceUploader />
    </div>
  );
}
