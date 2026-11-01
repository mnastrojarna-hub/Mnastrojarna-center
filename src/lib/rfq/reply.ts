import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { extractRfqNumbers } from "./model";

/**
 * Pošta → poptávkové kolo (lehký modul bez PDF — volá ho stahování pošty, Pošta B).
 * Příchozí e-mail: odpověď na naši poptávku (naše číslo PD-… v předmětu / textu, nebo odpověď na náš odeslaný
 * e-mail) → dodavatel kola „Odpověděl" (+ e-mail odpovědi) a zakázka kola pro přiřazení pošty.
 */

type Row = Record<string, unknown>;

export interface RfqReplyHit { jobId: string; number: string; recipientId: string | null }

export interface RfqReplyEmail {
  id: string;
  direction: string;
  subject: string | null;
  body_text: string | null;
  from_email: string | null;
  supplier_id: string | null;
  in_reply_to: string | null;
  message_refs: string[] | null;
}

export async function noteRfqReply(dbIn: JobsDb | SupabaseClient, e: RfqReplyEmail): Promise<RfqReplyHit | null> {
  const db = dbIn as unknown as SupabaseClient;
  if (e.direction !== "in") return null;
  const refs = [e.in_reply_to, ...(e.message_refs ?? [])].map((x) => (x ?? "").trim()).filter(Boolean);
  let recipient: Row | null = null;
  let round: Row | null = null;
  if (refs.length) {
    const ids = [...new Set(refs.flatMap((r) => [r, r.replace(/^<|>$/g, ""), r.startsWith("<") ? r : `<${r}>`]))].slice(0, 60);
    const { data: ours } = await db.from("emails").select("id").eq("direction", "out").in("message_id", ids).limit(20);
    const ourIds = ((ours ?? []) as Row[]).map((x) => String(x.id));
    if (ourIds.length) {
      const { data: rec, error } = await db.from("rfq_recipients").select("*").in("email_id", ourIds).limit(1);
      if (error) return null;
      recipient = ((rec ?? []) as Row[])[0] ?? null;
    }
  }
  if (!recipient) {
    const numbers = extractRfqNumbers(e.subject, (e.body_text ?? "").slice(0, 20_000));
    if (!numbers.length) return null;
    const { data: rounds, error } = await db.from("rfq_rounds").select("id, job_id, number").in("number", numbers).limit(5);
    if (error || !(rounds ?? []).length) return null;
    round = ((rounds ?? []) as Row[])[0];
    const { data: recs } = await db.from("rfq_recipients").select("*").eq("round_id", round.id as string);
    const list = (recs ?? []) as Row[];
    const from = (e.from_email ?? "").trim().toLowerCase();
    const domain = from.split("@")[1] ?? "";
    recipient = list.find((r) => e.supplier_id && r.supplier_id === e.supplier_id)
      ?? list.find((r) => ((r.emails as string[]) ?? []).some((x) => x.toLowerCase() === from))
      ?? (domain ? list.find((r) => ((r.emails as string[]) ?? []).some((x) => x.toLowerCase().endsWith(`@${domain}`))) : undefined)
      ?? null;
  }
  if (recipient && !round) {
    const { data } = await db.from("rfq_rounds").select("id, job_id, number").eq("id", recipient.round_id as string).maybeSingle();
    round = (data as Row | null) ?? null;
  }
  if (!round) return null;
  if (recipient && ["odeslano", "bez_odpovedi", "ceka_na_anonymizaci"].includes(String(recipient.status))) {
    await db.from("rfq_recipients").update({ status: "odpovedel", replied_at: new Date().toISOString(), reply_email_id: e.id }).eq("id", recipient.id as string);
    await logJobEvent(db as unknown as JobsDb, {
      jobId: String(round.job_id), type: "email", entity: "supplier_quote", entityId: String(round.id), actorId: null, actorKind: "system", via: "automaticky",
      message: `Poptávka ${round.number}: odpověděl ${recipient.supplier_name} — zapiš jeho nabídku`,
      data: { rfqRoundId: round.id, rfqRecipientId: recipient.id, emailId: e.id, action: "replied" },
    });
  } else if (recipient && !recipient.reply_email_id) {
    await db.from("rfq_recipients").update({ reply_email_id: e.id }).eq("id", recipient.id as string);
  }
  return { jobId: String(round.job_id), number: String(round.number), recipientId: recipient ? String(recipient.id) : null };
}
