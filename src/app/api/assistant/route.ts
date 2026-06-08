import { NextResponse } from "next/server";
import { askAssistant } from "@/lib/ai/claude";
import { getCustomers, getSuppliers, getOrders, getQuotes, getDrawings, getCommissions } from "@/lib/data/queries";

export const runtime = "nodejs";

/** Sestaví kompaktní kontext z firemních dat (RAG-lite) pro AI asistenta. */
async function buildContext(): Promise<string> {
  const [customers, suppliers, orders, quotes, drawings, commissions] = await Promise.all([
    getCustomers(), getSuppliers(), getOrders(), getQuotes(), getDrawings(), getCommissions(),
  ]);
  const parts: string[] = [];
  if (customers.length)
    parts.push("ZÁKAZNÍCI:\n" + customers.slice(0, 30).map((c) => `- ${c.name} (IČO ${c.ico}, obrat ${c.revenue} Kč, ${c.orders} obj.)`).join("\n"));
  if (suppliers.length)
    parts.push("DODAVATELÉ:\n" + suppliers.slice(0, 30).map((s) => `- ${s.name} (${s.country}, ${s.technologies.join(", ")}, materiály ${s.materials.join(", ")}, lhůta ${s.leadDays} d)`).join("\n"));
  if (orders.length)
    parts.push("ZAKÁZKY:\n" + orders.slice(0, 40).map((o) => `- ${o.number} ${o.customer}: ${o.title}, ${o.status}, ${o.value} Kč, termín ${o.dueDate}${o.technology ? `, ${o.technology}` : ""}`).join("\n"));
  if (quotes.length)
    parts.push("NABÍDKY:\n" + quotes.slice(0, 40).map((q) => `- ${q.number} ${q.customer}, výkres ${q.drawing}, ${q.qty} ks, ${q.status}${q.value ? `, ${q.value} Kč` : ""}`).join("\n"));
  if (drawings.length)
    parts.push("VÝKRESY:\n" + drawings.slice(0, 40).map((d) => `- ${d.number} rev.${d.revision}, ${d.material}, ${d.dimensions}, ${d.qty} ks (${d.customer})`).join("\n"));
  if (commissions.length)
    parts.push("PROVIZE (tento měsíc):\n" + commissions.map((c) => `- ${c.owner}: obrat ${c.revenue} Kč, provize ${c.commission} Kč`).join("\n"));
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Chybí dotaz." }, { status: 400 });
    }
    const context = await buildContext();
    const answer = await askAssistant({ question, context });
    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
