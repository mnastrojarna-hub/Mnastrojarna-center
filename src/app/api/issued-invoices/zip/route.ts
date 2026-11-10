import { auditExport, buildZip, deliver, exportContext } from "@/lib/issued-invoices/export";
import { exportBaseName } from "@/lib/issued-invoices/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Faktury vydané → ZIP pro účetní: GET /api/issued-invoices/zip?obdobi=2026-11 (nebo 2026 = celý rok).
 * Každá faktura jako samostatné PDF „FV-…_Odberatel.pdf", přehled CSV, CHYBI.txt u faktur bez PDF.
 * Jen super admin / plný přístup (issued_invoices).
 */
export async function GET(req: Request) {
  const ctx = await exportContext(req);
  if (ctx instanceof Response) return ctx;
  const zip = await buildZip(ctx);
  await auditExport(ctx, "zip", { included: zip.included, missing: zip.missing });
  return deliver(ctx, zip.bytes, {
    contentType: "application/zip",
    filename: `${exportBaseName(ctx.period)}.zip`,
    headers: { "X-Invoices-Included": String(zip.included), "X-Invoices-Missing": String(zip.missing) },
  });
}
