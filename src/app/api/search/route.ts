import { NextResponse } from "next/server";
import { getCustomers, getSuppliers, getDrawings, getQuotes } from "@/lib/data/queries";

export const runtime = "nodejs";

/** Data pro globální vyhledávání (⌘K). Operátorský režim → živá data, jinak demo. */
export async function GET() {
  try {
    const [customers, suppliers, drawings, quotes] = await Promise.all([
      getCustomers(),
      getSuppliers(),
      getDrawings(),
      getQuotes(),
    ]);
    return NextResponse.json({
      customers: customers.map((c) => ({ id: c.id, label: c.name, hint: c.ico })),
      suppliers: suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.country })),
      drawings: drawings.map((d) => ({ id: d.id, label: d.number, hint: `${d.material} · rev. ${d.revision}` })),
      quotes: quotes.map((q) => ({ id: q.id, label: q.number, hint: q.customer })),
    });
  } catch {
    return NextResponse.json({ customers: [], suppliers: [], drawings: [], quotes: [] });
  }
}
