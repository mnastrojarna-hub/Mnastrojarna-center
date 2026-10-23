"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/send";
import { recordCorrection } from "@/app/actions/corrections";
import { logAudit } from "@/lib/audit";
import { OUTBOUND_APPROVAL_TYPES } from "@/lib/data/types";
import type { ApprovalType } from "@/lib/supabase/database.types";
import { checkFeature } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { approveJobQuote } from "@/app/actions/jobs";

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
}

/**
 * Vyřízení položky fronty ke schválení (kdo vyřídil zapíše DB do resolved_by z hlavičky autora).
 * Schválení odchozí akce (odpověď, nabídka, upomínka…) e-mail SKUTEČNĚ odešle; schválení AI
 * nabídky zapíše quotes.approved_by (stejná pravidla jako „Schválit" u nabídky — R10).
 */
export async function resolveApproval(
  id: string,
  action: "approved" | "rejected",
): Promise<Result> {
  const auth = await checkFeature("dashboard");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (action !== "approved" && action !== "rejected") return { ok: false, error: "Neplatná akce." };
  if (typeof id !== "string" || !id) return { ok: false, error: "Chybí položka fronty." };
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  try {
    const actor = userActor(auth.user);
    const supabase = await createOperatorClient({ actor });
    const { data } = await supabase
      .from("approval_queue")
      .select("id, type, title, target, quote_id, email_id, status, payload")
      .eq("id", id)
      .maybeSingle();
    const row = data as QueueRow | null;
    if (!row) return { ok: false, error: "Položka fronty nenalezena." };
    if (row.status !== "pending") return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };

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
        // Odpověď na e-mail jde ze schránky, kam e-mail přišel; ostatní ze schránky schvalujícího.
        // E-mail bez schránky (globální účet) = firemní (systémová) schránka.
        let replyMailbox: string | null | undefined;
        if (row.email_id) {
          const { data: em } = await supabase.from("emails").select("mailbox_id").eq("id", row.email_id).maybeSingle();
          replyMailbox = em ? ((em as { mailbox_id: string | null }).mailbox_id ?? null) : undefined;
        }
        const res = await sendMail({
          to: row.target,
          subject: row.payload.subject || row.title,
          text: row.payload.body,
          from: replyMailbox ? { mailboxId: replyMailbox } : replyMailbox === null ? { system: true } : { ownerId: auth.user.id },
          senderId: auth.user.id,
        });
        if (!res.sent) {
          return { ok: false, error: res.reason ?? "Odeslání selhalo." };
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
  const auth = await checkFeature("dashboard");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  if (typeof input?.body !== "string" || !input.body.trim()) return { ok: false, error: "Text nesmí být prázdný." };
  try {
    const actor = userActor(auth.user);
    const supabase = await createOperatorClient({ actor });
    const { data } = await supabase
      .from("approval_queue")
      .select("payload")
      .eq("id", input.id)
      .maybeSingle();
    const payload = ((data as { payload?: Record<string, unknown> } | null)?.payload ?? {}) as Record<string, unknown>;

    const update: Record<string, unknown> = { payload: { ...payload, body: input.body } };
    if (input.target?.trim()) update.target = input.target.trim();

    const { error } = await supabase
      .from("approval_queue")
      .update(update as never)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };

    // Učení: rozdíl mezi AI návrhem a tvojí verzí se uloží jako korekce do promptů
    if (input.originalBody.trim() && input.originalBody.trim() !== input.body.trim()) {
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
