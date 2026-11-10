import { auditExport, buildMergedPdf, deliver, exportContext } from "@/lib/issued-invoices/export";
import { exportBaseName } from "@/lib/issued-invoices/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Faktury vydané → všechny faktury období v jednom PDF: GET /api/pdf/issued-invoices?obdobi=2026-11[&download=1].
 * Pod /api/pdf/ → odkaz otevře prohlížeč souborů v aplikaci (viewer-links); ?download=1 = stáhnout.
 * Jen super admin / plný přístup (issued_invoices).
 */
export async function GET(req: Request) {
  const ctx = await exportContext(req);
  if (ctx instanceof Response) return ctx;
  const pdf = await buildMergedPdf(ctx);
  const download = new URL(req.url).searchParams.get("download") === "1";
  await auditExport(ctx, "pdf", { included: pdf.included, missing: pdf.missing });
  return deliver(ctx, pdf.bytes, {
    contentType: "application/pdf",
    filename: `${exportBaseName(ctx.period)}.pdf`,
    inline: !download,
    headers: { "X-Invoices-Included": String(pdf.included), "X-Invoices-Missing": String(pdf.missing) },
  });
}
