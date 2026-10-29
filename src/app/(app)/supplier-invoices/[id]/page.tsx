import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/auth/session";
import { getSupplierInvoice } from "@/lib/data/supplier-invoices";
import { InvoiceDetailView } from "@/components/supplier-invoices/invoice-detail";
import { todayIso } from "@/lib/jobs/mapping";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Faktura dodavatele" };

/** Detail faktury dodavatele: náhled vedle položek, rozdělení na zakázky, úhrada (super admin). */
export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("supplier_invoices");
  const { id } = await params;
  const invoice = await getSupplierInvoice(id);
  if (!invoice) notFound();
  return <InvoiceDetailView initial={invoice} today={todayIso()} />;
}
