import { NextResponse } from "next/server";
import { askAssistant } from "@/lib/ai/claude";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { getCustomers, getSuppliers, getDrawings, getCommissions } from "@/lib/data/queries";
import { listJobs, listQuotes } from "@/lib/data/jobs";
import { STAGES } from "@/lib/jobs/stages";
import { quoteStatusLabel } from "@/lib/data/labels";

export const runtime = "nodejs";

const MAX_QUESTION = 2000;

function czk(n: number | null | undefined): string {
  return n === null || n === undefined ? "bez ceny" : `${Math.round(n)} Kč`;
}

/** Sestaví kompaktní kontext z firemních dat (RAG-lite) pro AI asistenta. */
async function buildContext(): Promise<string> {
  const { can } = await getAccess();
  const [customers, suppliers, jobs, quotes, drawings, commissions] = await Promise.all([
    getCustomers(),
    getSuppliers(),
    listJobs({ sort: "updated", dir: "desc", limit: 60 }),
    listQuotes({ includeArchived: false }),
    can("drawings") ? getDrawings() : Promise.resolve([]),
    can("commissions") ? getCommissions() : Promise.resolve([]),
  ]);
  const parts: string[] = [];
  if (jobs.length)
    parts.push(
      "ZAKÁZKY (Kniha zakázek, nejnověji změněné):\n" +
        jobs
          .map((j) => {
            const bits = [
              `${j.number} ${j.customer?.name ?? "bez zákazníka"}: ${j.title || "bez názvu"}`,
              `stav ${STAGES[j.stage]?.label ?? j.stage}`,
              j.customerOrderNumber ? `obj. zákazníka ${j.customerOrderNumber}` : null,
              j.customerInquiryNumber ? `poptávka zákazníka ${j.customerInquiryNumber}` : null,
              j.customerRequiredDate ? `požadovaný termín ${j.customerRequiredDate}` : null,
              j.dueDate ? `potvrzený termín ${j.dueDate}` : null,
              j.value !== null ? `hodnota ${czk(j.value)}` : null,
              j.drawingNumbers.length ? `výkresy ${j.drawingNumbers.slice(0, 5).join(", ")}` : null,
              j.owner ? `obchodník ${j.owner.name}` : null,
            ];
            return "- " + bits.filter(Boolean).join(", ");
          })
          .join("\n"),
    );
  if (customers.length)
    parts.push(
      "ZÁKAZNÍCI:\n" +
        customers
          .slice(0, 40)
          .map((c) => `- ${c.customerNumber ?? ""} ${c.name} (IČO ${c.ico ?? "—"}, ${c.city ?? c.country}, ${c.totalJobs} zakázek, obrat ${czk(c.revenue)}${c.owner ? `, obchodník ${c.owner.name}` : ""})`.trim())
          .join("\n"),
    );
  if (suppliers.length)
    parts.push(
      "DODAVATELÉ:\n" +
        suppliers
          .slice(0, 40)
          .map((s) => `- ${s.name} (${s.country}; technologie ${s.technologies.join(", ") || "—"}; materiály ${s.materials.join(", ") || "—"}; lhůta ${s.leadDays ?? "?"} d; hodnocení ${s.rating ?? "—"}/5)`)
          .join("\n"),
    );
  if (quotes.length)
    parts.push(
      "NABÍDKY:\n" +
        quotes
          .slice(0, 40)
          .map((q) => {
            const items = q.items.slice(0, 3).map((it) => `${it.drawingNumber ?? it.name ?? "položka"} ${it.quantity} ${it.unit}${it.unitPrice !== null ? ` á ${czk(it.unitPrice)}` : ""}`);
            return `- ${q.number} ${q.customer?.name ?? ""}${q.job ? ` (zakázka ${q.job.number})` : ""}: ${quoteStatusLabel[q.status] ?? q.status}, ${czk(q.total)}${items.length ? `; ${items.join("; ")}` : ""}`;
          })
          .join("\n"),
    );
  if (drawings.length)
    parts.push("VÝKRESY:\n" + drawings.slice(0, 40).map((d) => `- ${d.number} rev.${d.revision}, ${d.material}, ${d.dimensions}, ${d.qty} ks (${d.customer})`).join("\n"));
  if (commissions.length)
    parts.push("PROVIZE (tento měsíc):\n" + commissions.map((c) => `- ${c.owner}: obrat ${czk(c.revenue)}, provize ${czk(c.commission)}`).join("\n"));
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const auth = await apiRequire("ai_assistant");
  if (auth instanceof NextResponse) return auth;
  let question: unknown;
  try {
    ({ question } = await req.json());
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Chybí dotaz." }, { status: 400 });
  }
  try {
    const context = await buildContext();
    const answer = await askAssistant({ question: question.trim().slice(0, MAX_QUESTION), context });
    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
