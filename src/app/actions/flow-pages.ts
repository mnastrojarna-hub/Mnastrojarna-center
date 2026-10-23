"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { logJobEvent } from "@/lib/jobs/events";
import { cleanDate, isUuid, todayIso, translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Doplňkové akce stránek obchodního toku (vše ostatní je v actions/flow-status). Autor jde
 * v hlavičkách klienta, DB doplní *_by a stav nabídky přepočítá sama.
 */

const QUOTE_NOT_FOUND = "Nabídka nenalezena.";

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  if (err && typeof err === "object" && "message" in err) return { ok: false, error: translateDbError(String((err as { message: unknown }).message)) };
  return { ok: false, error: "Neočekávaná chyba." };
}

function czDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

/** „Prodloužit platnost“ odeslané nabídky (vypršelá → zase Odeslaná). Jen budoucí datum. */
export async function extendQuoteValidity(quoteId: string, validUntil: string): Promise<ActionResult<{ validUntil: string }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("workflow");
  if ("error" in access) return fail(access.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  const date = cleanDate(validUntil);
  if (!date) return fail("Neplatné datum platnosti (čekám RRRR-MM-DD).");
  if (date < todayIso()) return fail("Nová platnost musí být dnes nebo později.");
  try {
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const { data, error } = await db.from("quotes").update({ valid_until: date } as never)
      .eq("id", quoteId).eq("status", "odeslano").select("id, job_id, number, valid_until");
    if (error) return fail(error);
    const row = ((data ?? []) as { id: string; job_id: string | null; number: string | null; valid_until: string | null }[])[0];
    if (!row) return fail("Prodloužit jde jen odeslanou nabídku, na kterou zákazník ještě neodpověděl.");
    if (row.job_id) {
      await logJobEvent(db, {
        jobId: row.job_id, type: "quote", entity: "quote", entityId: quoteId, actorId: access.user.id,
        message: `${row.number ? `Nabídka ${row.number}` : "Nabídka"}: platnost prodloužena do ${czDate(date)}`,
        data: { quoteId, number: row.number, action: "extended", validUntil: date },
      });
      revalidatePath(`/orders/${row.job_id}`);
    }
    for (const p of ["/quotes", "/orders", "/pricing", "/dashboard"]) revalidatePath(p);
    return { ok: true, validUntil: date };
  } catch (err) {
    return fail(err);
  }
}
