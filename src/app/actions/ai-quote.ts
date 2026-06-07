"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { renderQuotePdf } from "@/lib/pdf/render";
import { SUPPLIER_PARTY } from "@/lib/pdf/components";
import { sendMail } from "@/lib/email/send";
import { COMPANY } from "@/lib/company";

export interface QuoteItemInput {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
}

export interface SubmitQuoteInput {
  customer: string;
  customerEmail?: string;
  items: QuoteItemInput[];
  coverEmail: string;
  leadTimeDays: number;
  validUntilDays: number;
  autoSend?: boolean; // plná automatika → odeslat hned
}

export interface SubmitQuoteResult {
  ok: boolean;
  number?: string;
  archived?: boolean;
  sent?: boolean;
  sentReason?: string;
  error?: string;
}

export async function submitAiQuote(input: SubmitQuoteInput): Promise<SubmitQuoteResult> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SECRET_KEY) {
    return { ok: false, error: "Pro uložení doplň Supabase URL + servisní klíč (Nastavení → Integrace)." };
  }
  if (!input.items.length) return { ok: false, error: "Nabídka nemá žádné položky." };

  try {
    const db = createAdminClient();

    // Číslo nabídky
    const { data: numData } = await db.rpc("next_doc_number", { p_prefix: "NAB" });
    const number = (numData as string) || `NAB-${Date.now()}`;

    const total = input.items.reduce(
      (s, it) => s + it.quantity * it.unit_price * (1 + it.vat_rate / 100),
      0,
    );
    const validUntil = new Date(Date.now() + input.validUntilDays * 86400000)
      .toISOString()
      .slice(0, 10);

    // Ulož nabídku + položky
    const { data: quote, error: qErr } = await db
      .from("quotes")
      .insert({
        number,
        status: "ke_schvaleni",
        total,
        valid_until: validUntil,
        ai_generated: true,
        note: input.coverEmail,
        sent_at: null,
      } as never)
      .select("id")
      .single();
    if (qErr || !quote) return { ok: false, error: qErr?.message ?? "Nepodařilo se uložit nabídku." };
    const quoteId = (quote as { id: string }).id;

    await db.from("quote_items").insert(
      input.items.map((it, i) => ({
        quote_id: quoteId,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        position: i,
      })) as never,
    );

    // PDF do archivu (Supabase Storage)
    let archived = false;
    let storagePath: string | null = null;
    try {
      const pdf = await renderQuotePdf({
        number,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil,
        currency: "CZK",
        supplier: SUPPLIER_PARTY,
        customer: { name: input.customer },
        items: input.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unit_price,
          vatRate: it.vat_rate,
        })),
        note: input.coverEmail,
      });
      storagePath = `nabidky/${number}.pdf`;
      const up = await db.storage.from("documents").upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (!up.error) {
        archived = true;
        await db.from("documents").insert({
          doc_type: "nabidka",
          number,
          title: `Nabídka ${number} — ${input.customer}`,
          quote_id: quoteId,
          storage_path: storagePath,
          total,
        } as never);
      }
    } catch {
      /* PDF/storage best-effort */
    }

    // Fronta ke schválení
    await db.from("approval_queue").insert({
      type: "quote",
      title: `Nabídka ${number} — ${input.customer}`,
      summary: `${input.items.length} položek, celkem ${Math.round(total)} Kč. Lhůta ${input.leadTimeDays} dní.`,
      target: input.customer,
      quote_id: quoteId,
      ai_confidence: 0.9,
    } as never);

    // Odeslání (plná automatika)
    let sent = false;
    let sentReason: string | undefined;
    if (input.autoSend && input.customerEmail) {
      const res = await sendMail({
        to: input.customerEmail,
        subject: `Cenová nabídka ${number} — ${COMPANY.name}`,
        text: input.coverEmail,
      });
      sent = res.sent;
      sentReason = res.reason;
      if (sent) {
        await db.from("quotes").update({ status: "odeslano", sent_at: new Date().toISOString() } as never).eq("id", quoteId);
      }
    }

    revalidatePath("/quotes");
    revalidatePath("/documents");
    return { ok: true, number, archived, sent, sentReason };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání nabídky" };
  }
}
