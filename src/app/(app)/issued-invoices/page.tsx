import type { Metadata } from "next";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { listIssuedInvoices } from "@/lib/data/issued-invoices";
import { todayIso } from "@/lib/jobs/mapping";
import { parsePeriod } from "@/lib/issued-invoices/model";
import { IssuedInvoicesView } from "@/components/issued-invoices/issued-invoices-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Faktury vydané" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Faktury vydané (majitel 10. 11.): naše faktury po měsících — komu, kdy, za kolik, zaplaceno; součty měsíce,
 * hromadné stažení PDF (ZIP) a sloučené PDF pro účetní, CSV, smazání. ?obdobi=2026-11 (měsíc) / 2026 (rok).
 * Zatím jen super admin / plný přístup (issued_invoices).
 */
export default async function IssuedInvoicesPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("issued_invoices");
  const sp = await searchParams;
  const today = todayIso();
  const period = parsePeriod(typeof sp.obdobi === "string" ? sp.obdobi : null, today);
  const [data, { can }] = await Promise.all([listIssuedInvoices(period), getAccess()]);
  if (!data) {
    return <p className="rounded-xl border p-4 text-sm text-muted-foreground">Faktury se nepodařilo načíst.</p>;
  }
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  return (
    <IssuedInvoicesView
      period={period}
      items={data.items}
      rates={data.rates}
      today={today}
      canDelete={can("delete")}
      initialQuery={q}
    />
  );
}
