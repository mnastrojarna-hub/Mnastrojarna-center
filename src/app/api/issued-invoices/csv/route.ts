import { auditExport, csvBytes, deliver, exportContext } from "@/lib/issued-invoices/export";
import { exportBaseName } from "@/lib/issued-invoices/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Faktury vydané → CSV pro účetní (UTF-8 s BOM, středník — český Excel): GET /api/issued-invoices/csv?obdobi=2026-11.
 * Jen super admin / plný přístup (issued_invoices).
 */
export async function GET(req: Request) {
  const ctx = await exportContext(req);
  if (ctx instanceof Response) return ctx;
  await auditExport(ctx, "csv");
  return deliver(ctx, csvBytes(ctx), { contentType: "text/csv; charset=utf-8", filename: `${exportBaseName(ctx.period)}.csv` });
}
