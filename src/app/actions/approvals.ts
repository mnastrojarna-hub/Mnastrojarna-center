"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/send";
import { recordCorrection } from "@/app/actions/corrections";
import { OUTBOUND_APPROVAL_TYPES } from "@/lib/data/types";
import type { ApprovalType } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string; sent?: boolean };

interface QueueRow {
  id: string;
  type: ApprovalType;
  title: string;
  target: string | null;
  payload: { body?: string; subject?: string } | null;
}

/**
 * Vyřízení položky fronty ke schválení.
 * Schválení odchozí akce (odpověď, nabídka, upomínka…) e-mail SKUTEČNĚ odešle.
 */
export async function resolveApproval(
  id: string,
  action: "approved" | "rejected",
): Promise<Result> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  try {
    const supabase = await createOperatorClient();

    if (action === "approved") {
      const { data } = await supabase
        .from("approval_queue")
        .select("id, type, title, target, payload")
        .eq("id", id)
        .maybeSingle();
      const row = data as QueueRow | null;

      // Odchozí akce: schválení = skutečné odeslání e-mailu adresátovi
      if (row && OUTBOUND_APPROVAL_TYPES.includes(row.type) && row.payload?.body) {
        if (!row.target || !row.target.includes("@")) {
          return { ok: false, error: "Chybí e-mailová adresa příjemce — nejdřív ji doplň úpravou položky." };
        }
        const res = await sendMail({
          to: row.target,
          subject: row.payload.subject || row.title,
          text: row.payload.body,
        });
        if (!res.sent) {
          return { ok: false, error: res.reason ?? "Odeslání selhalo." };
        }
        const { error } = await supabase
          .from("approval_queue")
          .update({ status: "approved", resolved_at: new Date().toISOString() } as never)
          .eq("id", id);
        if (error) return { ok: false, error: error.message };
        revalidatePath("/dashboard");
        revalidatePath("/inbox");
        return { ok: true, sent: true };
      }
    }

    const { error } = await supabase
      .from("approval_queue")
      .update({ status: action, resolved_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
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
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno." };
  }
  if (!input.body.trim()) return { ok: false, error: "Text nesmí být prázdný." };
  try {
    const supabase = await createOperatorClient();
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

    revalidatePath("/dashboard");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
