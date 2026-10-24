import { NextResponse } from "next/server";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { getCustomers, getSuppliers, getDrawings } from "@/lib/data/queries";
import { listJobs, listQuotes } from "@/lib/data/jobs";
import { getFlowScope } from "@/lib/data/flow-scope";
import { isMineQuote } from "@/lib/auth/flow-scope";
import { searchNormalize } from "@/lib/jobs/mapping";
import type { JobStage } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Jedna položka globálního hledání (⌘K). keywords = normalizovaný text pro hledání. */
interface SearchEntry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  keywords: string;
  stage?: JobStage;
  /** Zakázky: čísla jejích nabídek (hledá se i podle nich — i kolegových; hint „nab. …" ukáže paleta). */
  quoteNumbers?: string[];
}

function kw(...parts: (string | null | undefined)[]): string {
  return searchNormalize(parts.filter(Boolean).join(" "));
}

/**
 * Data pro globální vyhledávání — jen to, co uživatel smí vidět:
 * zakázky a nabídky s Knihou zakázek, výkresy jen s archivem výkresů.
 */
export async function GET() {
  const auth = await apiRequire();
  if (auth instanceof NextResponse) return auth;
  const { can } = await getAccess();
  const empty = Promise.resolve([] as never[]);
  try {
    const [jobs, customers, suppliers, allQuotes, drawings, scope] = await Promise.all([
      can("orders") ? listJobs({ sort: "updated", dir: "desc", limit: 1500 }) : empty,
      can("customers") ? getCustomers() : empty,
      can("suppliers") ? getSuppliers() : empty,
      // všechny nabídky jen na serveru: čísla nabídek k zakázkám (Kniha je všech), skupina „Nabídky" jen „moje"
      can("orders") ? listQuotes() : empty,
      can("drawings") ? getDrawings() : empty,
      getFlowScope(),
    ]);
    const quotes = allQuotes.filter((q) => isMineQuote({
      jobId: q.job?.id ?? null, createdBy: q.createdBy?.id ?? null, ownerId: q.ownerId ?? null,
      approvalRequestedBy: q.approvalRequestedBy ?? null,
    }, scope));
    const quoteNumbers = new Map<string, string[]>();
    for (const q of allQuotes) {
      if (!q.job || !q.number) continue;
      quoteNumbers.set(q.job.id, [...(quoteNumbers.get(q.job.id) ?? []), q.number]);
    }
    const out: Record<"jobs" | "customers" | "suppliers" | "quotes" | "drawings", SearchEntry[]> = {
      jobs: jobs.map((j) => ({
        id: j.id,
        label: `${j.number} · ${j.title || "bez názvu"}`,
        hint: [j.customer?.name, j.customerOrderNumber ? `obj. ${j.customerOrderNumber}` : null].filter(Boolean).join(" · "),
        href: `/orders/${j.id}`,
        stage: j.stage,
        keywords: kw(
          j.number, j.title, j.customer?.name, j.customer?.customerNumber, j.customerOrderNumber,
          j.customerInquiryNumber, j.invoiceNumber, ...j.drawingNumbers, ...(quoteNumbers.get(j.id) ?? []),
        ),
        quoteNumbers: quoteNumbers.get(j.id),
      })),
      customers: customers.map((c) => ({
        id: c.id,
        label: c.name,
        hint: [c.customerNumber, c.ico ? `IČO ${c.ico}` : null, c.city].filter(Boolean).join(" · "),
        href: `/customers/${c.id}`,
        keywords: kw(c.name, c.customerNumber, c.ico, c.dic, c.city, c.contactPerson, c.email),
      })),
      suppliers: suppliers.map((s) => ({
        id: s.id,
        label: s.name,
        hint: s.technologies.slice(0, 3).join(", ") || s.country,
        href: `/suppliers?q=${encodeURIComponent(s.name)}`,
        keywords: kw(s.name, s.ico, s.contactPerson, s.email, ...s.technologies, ...s.materials),
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        label: q.number,
        hint: [q.customer?.name, q.job?.number].filter(Boolean).join(" · "),
        href: q.job ? `/orders/${q.job.id}` : "/quotes",
        stage: q.job?.stage,
        keywords: kw(q.number, q.title, q.customer?.name, q.job?.number, q.job?.title, ...q.items.map((it) => it.drawingNumber)),
      })),
      drawings: drawings.map((d) => ({
        id: d.id,
        label: d.number,
        hint: [d.material !== "—" ? d.material : null, `rev. ${d.revision}`, d.customer !== "—" ? d.customer : null].filter(Boolean).join(" · "),
        href: "/drawings",
        keywords: kw(d.number, d.material, d.customer, d.revision),
      })),
    };
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ jobs: [], customers: [], suppliers: [], quotes: [], drawings: [] });
  }
}
