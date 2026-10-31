import type { Metadata } from "next";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { listSupplierInvoices, type InvoiceListView } from "@/lib/data/supplier-invoices";
import { InvoiceList, type ListView } from "@/components/supplier-invoices/invoice-list";
import { SupplierInvoiceTabs } from "@/components/supplier-invoices/invoice-tabs";
import { parseVisibility, VISIBILITY_SETTING_KEY } from "@/lib/supplier-invoices/access";
import { isUuid, todayIso } from "@/lib/jobs/mapping";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Faktury dodavatelů" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: InvoiceListView[] = ["vse", "ke_kontrole", "neprirazene", "nezaplacene", "po_splatnosti", "duplicity"];
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 120) : "");
const date = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

function periodRange(key: string, today: string): { from: string; to: string } | null {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (key === "mesic") return { from: iso(y, m, 1), to: iso(y, m, last(y, m)) };
  if (key === "minuly") { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: iso(py, pm, 1), to: iso(py, pm, last(py, pm)) }; }
  if (key === "kvartal") { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return { from: iso(y, q0, 1), to: iso(y, q0 + 2, last(y, q0 + 2)) }; }
  if (key === "rok") return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
  return null;
}

/** Faktury dodavatelů — zatím jen super admin (přepínač viditelnosti dole na stránce). */
export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("supplier_invoices");
  const sp = await searchParams;
  const today = todayIso();
  const view = (VIEWS as string[]).includes(str(sp.stav)) ? (str(sp.stav) as ListView) : "vse";
  const supplierId = isUuid(str(sp.dodavatel)) ? str(sp.dodavatel) : "";
  const jobId = isUuid(str(sp.zakazka)) ? str(sp.zakazka) : "";
  const period = ["mesic", "minuly", "kvartal", "rok", "vlastni"].includes(str(sp.obdobi)) ? str(sp.obdobi) : "";
  const range = period === "vlastni" ? { from: date(sp.od), to: date(sp.do) } : periodRange(period, today) ?? { from: "", to: "" };
  const q = str(sp.q);
  const data = await listSupplierInvoices({ view, supplierId, jobId, from: range.from || null, to: range.to || null, q });
  const { can } = await getAccess();
  const visibility = can("supplier_invoices_paid") ? parseVisibility(await getSetting(VISIBILITY_SETTING_KEY)) : null;
  if (!data) {
    return <p className="rounded-xl border p-4 text-sm text-muted-foreground">Faktury se nepodařilo načíst.</p>;
  }
  const list = (
    <InvoiceList
      items={data.items}
      totals={data.totals}
      suppliers={data.suppliers}
      perms={data.perms}
      filter={{ view, supplierId, jobId, from: range.from, to: range.to, q, period }}
      visibility={visibility}
      today={today}
    />
  );
  // Platební plán vidí jen super admin (stejné právo jako zaplaceno / nezaplaceno)
  if (!data.perms.paid) return list;
  return (
    <div className="space-y-3">
      <SupplierInvoiceTabs active="faktury" />
      {list}
    </div>
  );
}
