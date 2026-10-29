"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/send";
import { replyHeaders, replySubject } from "@/lib/email/threading";
import { recordCorrection } from "@/app/actions/corrections";
import { logAudit } from "@/lib/audit";
import { OUTBOUND_APPROVAL_TYPES } from "@/lib/data/types";
import type { ApprovalType } from "@/lib/supabase/database.types";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { approveJobQuote } from "@/app/actions/jobs";
import { resolvePurchaseOrderQueue } from "@/lib/jobs/production-handoff-store";

type Result = { ok: boolean; error?: string; sent?: boolean };

interface QueueRow {
  id: string;
  type: ApprovalType;
  title: string;
  target: string | null;
  quote_id: string | null;
  email_id?: string | null;
  status: string;
  payload: { body?: string; subject?: string } | null;
  owner_id?: string | null;
  order_id?: string | null;
  purchase_order_id?: string | null;
}

const NO_RIGHT = "K této akci nemáš oprávnění.";

/**
 * Objednávku dodavateli ve frontě vyřídí super admin (fronta) nebo obchodník u své zakázky (owner_id = já).
 * Ostatní řádky jen s právem „dashboard".
 */
function mayResolve(row: Pick<QueueRow, "type" | "owner_id">, userId: string, can: (f: "dashboard" | "margins") => boolean): boolean {
  if (can("dashboard")) return true;
  return row.type === "purchase_order" && can("margins") && Boolean(row.owner_id) && row.owner_id === userId;
}

/**
 * Vyřízení položky fronty ke schválení (kdo vyřídil zapíše DB do resolved_by z hlavičky autora).
 * Schválení odchozí akce (odpověď, nabídka, upomínka…) e-mail SKUTEČNĚ odešle; schválení AI
 * nabídky zapíše quotes.approved_by (stejná pravidla jako „Schválit" u nabídky — R10).
 * Objednávka dodavateli (předání do výroby): odešle se ze schránky obchodníka zakázky, když ji schvaluje
 * admin a obchodník schránku má (odpověď dodavatele dojde jemu); zamítnutí ji nechá vystavenou.
 */
export async function resolveApproval(
  id: string,
  action: "approved" | "rejected",
): Promise<Result> {
  // řádek se načte PŘED kontrolou práv (objednávku smí vyřídit i obchodník u své zakázky)
  const auth = await checkFeature("orders");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (action !== "approved" && action !== "rejected") return { ok: false, error: "Neplatná akce." };
  if (typeof id !== "string" || !id) return { ok: false, error: "Chybí položka fronty." };
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  try {
    const { can } = await getAccess();
    const actor = userActor(auth.user);
    const supabase = await createOperatorClient({ actor });
    const { data } = await supabase
      .from("approval_queue")
      .select("id, type, title, target, quote_id, email_id, status, payload, owner_id, order_id, purchase_order_id")
      .eq("id", id)
      .maybeSingle();
    const row = data as QueueRow | null;
    if (!row) return can("dashboard") ? { ok: false, error: "Položka fronty nenalezena." } : { ok: false, error: NO_RIGHT };
    if (!mayResolve(row, auth.user.id, can)) return { ok: false, error: NO_RIGHT };
    if (row.status !== "pending") return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };

    // objednávka dodavateli: vlastní větev (bez korekcí AI, bez obecného odeslání níže)
    if (row.type === "purchase_order") {
      const res = await resolvePurchaseOrderQueue(supabase, { id: auth.user.id, fullName: auth.user.fullName, mailAll: can("mail_all") }, id, action);
      if (!res.ok) return { ok: false, error: res.error };
      await logAudit({ action: `approval_${action}`, entity: "approval_queue", entityId: id, diff: { type: row.type, title: row.title, sent: res.sent }, actor });
      revalidatePath("/dashboard");
      revalidatePath("/purchasing");
      revalidatePath("/orders");
      if (row.order_id) revalidatePath(`/orders/${row.order_id}`);
      if (res.sent) revalidatePath("/sent");
      return { ok: true, ...(res.sent ? { sent: true } : {}) };
    }

    if (action === "approved") {
      // AI nabídka: schvaluje jen super admin — stejné jádro jako „Schválit“ u nabídky (approveQuoteCore, #25)
      // Řádky „quote“ zakládá jen AI návrh (ai-quote.ts) — jiný řádek se nabídkou neschvaluje. Už schválenou /
      // odeslanou (schválil ji někdo v kartě nabídky) nebo nabídku bez nutnosti schválení jen vyřídíme.
      if (row.type === "quote" && row.quote_id) {
        const { data: qd } = await supabase.from("quotes").select("state, ai_generated").eq("id", row.quote_id).maybeSingle();
        const quote = qd as { state: string | null; ai_generated: boolean | null } | null;
        if (!quote) return { ok: false, error: "Nabídka z této položky už neexistuje — položku zamítni." };
        if (!quote.ai_generated) {
          return { ok: false, error: "Položka fronty neodpovídá AI návrhu nabídky — nabídku schval v záložce Nabídky zakázky." };
        }
        if (quote.state === "ke_schvaleni") {
          const appr = await approveJobQuote(row.quote_id);
          if (!appr.ok) return { ok: false, error: appr.error ?? "Nabídku se nepodařilo schválit." };
        }
      }

      // Odchozí akce: schválení = skutečné odeslání e-mailu adresátovi
      if (row && OUTBOUND_APPROVAL_TYPES.includes(row.type) && row.payload?.body) {
        if (!row.target || !row.target.includes("@")) {
          return { ok: false, error: "Chybí e-mailová adresa příjemce — nejdřív ji doplň úpravou položky." };
        }
        // Stejná cesta jako odpověď z Přijaté pošty (pickSmtpMailbox): vlastní schránka schvalujícího
        // (u odpovědi přednostně ta, kam e-mail přišel) → firemní schránka, kam e-mail přišel → firemní
        // → globální SMTP; nikdy osobní schránka kolegy. Odpověď nese In-Reply-To / References (vlákno).
        type ReplySource = { mailbox_id: string | null; message_id: string | null; message_refs: string[] | null; subject: string | null; order_id: string | null; customer_id: string | null; supplier_id: string | null; thread_id: string | null };
        let reply: ReplySource | null = null;
        if (row.email_id) {
          const { data: em } = await supabase
            .from("emails")
            .select("mailbox_id, message_id, message_refs, subject, order_id, customer_id, supplier_id, thread_id" as "*")
            .eq("id", row.email_id)
            .maybeSingle();
          reply = (em as unknown as ReplySource | null) ?? null;
        }
        const headers = reply ? replyHeaders({ messageId: reply.message_id, references: reply.message_refs, subject: reply.subject }) : null;
        const res = await sendMail({
          to: row.target,
          subject: row.payload.subject || (reply ? replySubject(reply.subject) : row.title),
          text: row.payload.body,
          from: { ownerId: auth.user.id, replyMailboxId: reply?.mailbox_id ?? null },
          senderId: auth.user.id,
          inReplyTo: headers?.inReplyTo ?? null,
          references: headers?.references ?? null,
          jobId: reply?.order_id ?? row.order_id ?? undefined,
          customerId: reply?.customer_id ?? null,
          supplierId: reply?.supplier_id ?? null,
        });
        if (!res.sent) {
          return { ok: false, error: res.reason ?? "Odeslání selhalo." };
        }
        // odpověď do vlákna původního e-mailu (i když odešla z jiné schránky / globálního SMTP)
        if (res.emailId && reply?.thread_id) {
          await supabase.from("emails").update({ thread_id: reply.thread_id, has_draft: false } as never).eq("id", res.emailId);
          await supabase.from("emails").update({ has_draft: false } as never).eq("id", row.email_id!);
        }
        const { error } = await supabase
          .from("approval_queue")
          .update({ status: "approved", resolved_at: new Date().toISOString() } as never)
          .eq("id", id)
          .eq("status", "pending");
        if (error) return { ok: false, error: error.message };
        await logAudit({
          action: "email_sent",
          entity: "approval_queue",
          entityId: id,
          diff: { to: row.target, title: row.title, type: row.type },
          actor,
        });
        revalidatePath("/dashboard");
        revalidatePath("/inbox");
        return { ok: true, sent: true };
      }
    }

    const { data: upd, error } = await supabase
      .from("approval_queue")
      .update({ status: action, resolved_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!(upd ?? []).length) return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };
    await logAudit({ action: `approval_${action}`, entity: "approval_queue", entityId: id, diff: { type: row.type, title: row.title }, actor });
    revalidatePath("/dashboard");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/**
 * Úprava připraveného obsahu před schválením.
 * Uloží novou verzi A zaznamená korekci — AI se z tvé opravy poučí.
 */
export async function updateApprovalBody(input: {
  id: string;
  body: string;
  target?: string;
  agentKey: string;
  originalBody: string;
  context: string;
}): Promise<Result> {
  const auth = await checkFeature("orders");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  if (typeof input?.body !== "string" || !input.body.trim()) return { ok: false, error: "Text nesmí být prázdný." };
  try {
    const { can } = await getAccess();
    const actor = userActor(auth.user);
    const supabase = await createOperatorClient({ actor });
    const { data } = await supabase
      .from("approval_queue")
      .select("type, owner_id, payload")
      .eq("id", input.id)
      .maybeSingle();
    const found = data as { type: ApprovalType; owner_id: string | null; payload?: Record<string, unknown> | null } | null;
    if (!found ? !can("dashboard") : !mayResolve(found, auth.user.id, can)) return { ok: false, error: NO_RIGHT };
    const payload = (found?.payload ?? {}) as Record<string, unknown>;
    const isPo = found?.type === "purchase_order";

    // objednávka: upravený text se při schválení už nepřepíše podpisem odesílatele (edited); opravený
    // příjemce platí (target i payload.to — odesílá se na to, co člověk ve frontě vidí)
    const target = typeof input.target === "string" ? input.target.trim() : "";
    const update: Record<string, unknown> = {
      payload: { ...payload, body: input.body, ...(isPo ? { edited: true, ...(target ? { to: target } : {}) } : {}) },
    };
    if (target) update.target = target;

    const { error } = await supabase
      .from("approval_queue")
      .update(update as never)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };

    // Učení: rozdíl mezi AI návrhem a tvojí verzí se uloží jako korekce do promptů (objednávka dodavateli
    // je šablona serveru, ne AI návrh — žádná korekce)
    if (!isPo && input.originalBody.trim() && input.originalBody.trim() !== input.body.trim()) {
      await recordCorrection({
        agentKey: input.agentKey,
        field: "content",
        context: input.context,
        aiValue: input.originalBody,
        correctedValue: input.body,
      });
    }

    await logAudit({ action: "approval_edited", entity: "approval_queue", entityId: input.id, actor });
    revalidatePath("/dashboard");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
