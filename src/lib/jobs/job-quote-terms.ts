import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import { quoteTermsOfDoc, quoteTermsOfQuote, type QuoteTerms } from "@/lib/jobs/order-deadline";
import type { JobDetail } from "@/lib/jobs/types";

/**
 * Naše nabídky zakázky v systému pro termín objednávky bez reálného data: nabídky (quotes — přijatá
 * napřed, pak platné od nejnovější revize, bez zamítnutých) a dříve uložené doklady naší nabídky
 * (job_files „nabidka" s vytěženými dodacími podmínkami).
 */
export async function jobQuoteTerms(db: JobsDb, job: Pick<JobDetail, "id" | "quotes">): Promise<QuoteTerms[]> {
  const out: QuoteTerms[] = [];
  const quotes = [...(job.quotes ?? [])]
    .filter((q) => q.status !== "zamitnuto")
    .sort((a, b) => Number(b.accepted) - Number(a.accepted) || Number(a.archived) - Number(b.archived) || b.revision - a.revision);
  for (const q of quotes) out.push(quoteTermsOfQuote({ number: q.number, leadTimeDays: q.leadTimeDays, deliveryTerms: q.deliveryTerms, note: q.note }));
  const { data } = await db.from("job_files").select("ai_extracted, created_at")
    .eq("job_id", job.id).eq("kind", "nabidka").eq("archived", false)
    .order("created_at", { ascending: false }).limit(10);
  for (const r of (data ?? []) as { ai_extracted: Record<string, unknown> | null }[]) {
    const ax = r.ai_extracted;
    if (!ax || ax.docKind !== "nabidka" || ax.issuer !== "my") continue;
    const doc = normalizeExtracted(ax);
    const terms = quoteTermsOfDoc(doc, doc.documentNumber, { inSystem: true });
    if (terms.date || terms.texts.length || terms.notes?.length) out.push(terms);
  }
  return out;
}
