import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth/session";
import { listSupplierDeliveryNotes } from "@/lib/data/supplier-delivery-notes";
import { todayIso } from "@/lib/jobs/mapping";
import { parseDlPeriod } from "@/lib/supplier-delivery-notes/model";
import { SupplierDlView } from "@/components/supplier-delivery-notes/supplier-dl-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dodací listy dodavatelů" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Dodací listy dodavatelů (majitel 19. 11.): kniha jako Faktury vydané / dodavatelů — číslo, dodavatel, datum,
 * naše objednávka (odkaz do Nákupu), zakázka, PDF. ?obdobi=2026-11 / 2026 / vse, ?q=hledání.
 */
export default async function SupplierDeliveryNotesPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("workflow");
  const sp = await searchParams;
  const today = todayIso();
  const period = parseDlPeriod(typeof sp.obdobi === "string" ? sp.obdobi : null, today);
  const rows = await listSupplierDeliveryNotes();
  if (!rows) return <p className="rounded-xl border p-4 text-sm text-muted-foreground">Dodací listy se nepodařilo načíst.</p>;
  return <SupplierDlView rows={rows} period={period} today={today} initialQuery={typeof sp.q === "string" ? sp.q.slice(0, 120) : ""} />;
}
