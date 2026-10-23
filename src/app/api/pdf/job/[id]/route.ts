import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { getJob } from "@/lib/data/jobs";
import { isUuid } from "@/lib/jobs/mapping";
import {
  buildConfirmationDoc, buildDeliveryNoteDoc, buildInvoiceDoc, buildQuoteDoc, pdfFileName, relevantQuote,
  type JobDocKind,
} from "@/lib/pdf/job-docs";
import { renderConfirmationPdf, renderDeliveryNotePdf, renderInvoicePdf, renderQuotePdf } from "@/lib/pdf/render";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Náhled dokladu ze zakázky (nic se neukládá — uložení dělá generateJobDocument):
 *   GET /api/pdf/job/<jobId>?type=nabidka|potvrzeni|dodaci-list|faktura[&quoteId=…][&download=1]
 * Dodací list / faktura bez přiděleného čísla se zobrazí jako „NÁHLED".
 * #25: neschválená nabídka má vodoznak „NESCHVÁLENO — NEODESÍLAT" (hlavička X-Doc-Watermark, název
 * souboru …-NESCHVALENO.pdf) a každé takové zobrazení se zapíše do auditu. Čistý náhled před schválením není.
 */

const TYPES: Record<string, JobDocKind> = {
  nabidka: "nabidka",
  potvrzeni: "potvrzeni",
  "dodaci-list": "dodaci_list",
  dodaci_list: "dodaci_list",
  faktura: "faktura",
};

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequire("documents");
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!isUuid(id)) return json("Zakázka nenalezena.", 404);
  const sp = new URL(req.url).searchParams;
  const rawType = (sp.get("type") ?? "nabidka").trim().toLowerCase();
  const kind = Object.hasOwn(TYPES, rawType) ? TYPES[rawType] : undefined;
  if (!kind) return json("Neznámý typ dokladu (nabidka, potvrzeni, dodaci-list, faktura).", 400);
  const quoteId = sp.get("quoteId")?.trim() || null;
  if (quoteId && !isUuid(quoteId)) return json("Nabídka nenalezena.", 404);
  const download = sp.get("download") === "1";

  const job = await getJob(id);
  if (!job) return json("Zakázka nenalezena.", 404);
  const preparedBy = auth.user.fullName || auth.user.email || undefined;

  try {
    let buffer: Buffer;
    let number: string;
    let watermarked = false;
    if (kind === "nabidka") {
      const quote = quoteId ? job.quotes.find((q) => q.id === quoteId.toLowerCase()) : relevantQuote(job);
      if (!quote) return json(quoteId ? "Nabídka k této zakázce nepatří." : "Zakázka zatím nemá nabídku.", 404);
      const data = await buildQuoteDoc(job, quote, { preparedBy });
      number = data.number;
      buffer = await renderQuotePdf(data);
      if (data.watermark) {
        watermarked = true;
        await logAudit({
          action: "quote_preview_unapproved", entity: "quotes", entityId: quote.id,
          diff: { jobId: job.id, number: quote.number, download },
        });
      }
    } else if (kind === "potvrzeni") {
      const data = await buildConfirmationDoc(job, { preparedBy });
      number = data.number;
      buffer = await renderConfirmationPdf(data);
    } else if (kind === "dodaci_list") {
      number = job.deliveryNoteNumber?.trim() || "DL-NÁHLED";
      buffer = await renderDeliveryNotePdf(await buildDeliveryNoteDoc(job, { number, preparedBy }));
    } else {
      number = job.invoiceNumber?.trim() || "FV-NÁHLED";
      buffer = await renderInvoicePdf(await buildInvoiceDoc(job, { number, preparedBy }));
    }

    const filename = watermarked ? pdfFileName(kind, number).replace(/\.pdf$/, "-NESCHVALENO.pdf") : pdfFileName(kind, number);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        ...(watermarked ? { "X-Doc-Watermark": "neschvaleno" } : {}),
      },
    });
  } catch (err) {
    return json(err instanceof Error ? err.message : "Chyba generování PDF", 500);
  }
}
