"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { logJobEvent } from "@/lib/jobs/events";
import { cleanText, isUuid, translateDbError } from "@/lib/jobs/mapping";
import { techPatchChanges, type ItemTechPatch } from "@/lib/jobs/technology";
import { syncPurchaseOrderSupplierNotes } from "@/lib/jobs/production-handoff-store";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Technologie položek (záložka „Technologie", feedback majitele 29. 10.): technologický postup
 * technologa, „Bez technologie — kompletně zadáno {firma}", poznámka pro dodavatele (do objednávky).
 * Smí každý s Knihou zakázek (technolog bývá zaměstnanec); bez cen. Každá změna jde do historie.
 */

type Row = Record<string, unknown>;

function fail(err: unknown): { ok: false; error: string } {
  const error = typeof err === "string" ? translateDbError(err) : err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba.";
  return { ok: false, error };
}

export async function saveItemTechnology(jobId: string, patches: ItemTechPatch[]): Promise<ActionResult<{ saved: number; notice?: string }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("orders");
  if ("error" in access) return fail(access.error);
  if (!isUuid(jobId)) return fail("Zakázka nenalezena.");
  if (!Array.isArray(patches) || !patches.length) return { ok: true, saved: 0 };
  if (patches.length > 200) return fail("Příliš mnoho položek najednou.");
  try {
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const ids = patches.map((p) => p?.itemId).filter((x): x is string => isUuid(x));
    if (ids.length !== patches.length) return fail("Položka nenalezena.");
    const { data, error } = await db.from("order_items")
      .select("id, order_id, position, drawing_number, name, tech_procedure, tech_complete, tech_complete_by, supplier_note")
      .eq("order_id", jobId).in("id", ids);
    if (error) return fail(error.message);
    const rows = new Map(((data ?? []) as Row[]).map((r) => [String(r.id), r]));
    if (rows.size !== new Set(ids).size) return fail("Položka nepatří k této zakázce.");
    const { data: job } = await db.from("orders").select("status").eq("id", jobId).maybeSingle();
    if (!job) return fail("Zakázka nenalezena.");

    let saved = 0;
    const allChanges: Row[] = [];
    const noteItems: string[] = [];
    for (const p of patches) {
      const old = rows.get(p.itemId) as Row;
      const { patch, changes } = techPatchChanges(old, p);
      if (!changes.length) continue;
      const { error: upErr } = await db.from("order_items").update(patch as never).eq("id", p.itemId).eq("order_id", jobId);
      if (upErr) return fail(upErr.message);
      saved += 1;
      allChanges.push(...changes);
      if (changes.some((c) => c.field === "item_note")) noteItems.push(p.itemId);
    }
    if (allChanges.length) {
      const one = allChanges.length === 1 ? allChanges[0] : null;
      await logJobEvent(db, {
        jobId, type: "field",
        message: one ? `${one.label}: ${String(one.toText).slice(0, 300)}` : `Technologie upravena (${saved} ${saved === 1 ? "položka" : saved < 5 ? "položky" : "položek"})`,
        data: {
          changes: allChanges, technology: true,
          // poznámka pro dodavatele = poznámka (historie → Poznámky & štítky)
          ...(allChanges.every((c) => c.field === "item_note") ? { note: true } : {}),
        },
        actorId: access.user.id,
      });
    }
    // poznámka pro dodavatele → i do už vystavené (neodeslané) objednávky: „Pozor: …" u položky + nové PDF
    let notice: string | undefined;
    if (noteItems.length) {
      try {
        const r = await syncPurchaseOrderSupplierNotes(db, { id: access.user.id, fullName: access.user.fullName }, jobId, { itemIds: noteItems });
        const parts: string[] = [];
        if (r.updated.length) parts.push(`Doplněno do objednávky ${r.updated.join(", ")} (nové PDF).`);
        if (r.sent.length) parts.push(`Objednávka ${r.sent.join(", ")} už odešla — poznámku pošli dodavateli zvlášť.`);
        if (parts.length) notice = parts.join(" ");
      } catch (err) {
        console.error(`[technology] poznámky do objednávky: ${err instanceof Error ? err.message : String(err)}`);
      }
      revalidatePath("/purchasing");
    }
    revalidatePath(`/orders/${jobId}`);
    return { ok: true, saved, ...(notice ? { notice } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/** Celá zakázka „Bez technologie — kompletně zadáno {firma}" jedním ťuknutím (nebo zrušení). */
export async function setJobCompleteDelivery(jobId: string, firm: string | null): Promise<ActionResult<{ saved: number }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("orders");
  if ("error" in access) return fail(access.error);
  if (!isUuid(jobId)) return fail("Zakázka nenalezena.");
  try {
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const { data, error } = await db.from("order_items").select("id").eq("order_id", jobId);
    if (error) return fail(error.message);
    const name = cleanText(firm, 300);
    const patches: ItemTechPatch[] = ((data ?? []) as { id: string }[]).map((r) => ({ itemId: r.id, complete: Boolean(name), completeBy: name }));
    return await saveItemTechnology(jobId, patches);
  } catch (err) {
    return fail(err);
  }
}
