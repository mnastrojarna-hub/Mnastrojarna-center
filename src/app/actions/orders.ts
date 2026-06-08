"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/supabase/database.types";

// CZ popisek → enum stav v DB
const LABEL_TO_ENUM: Record<string, OrderStatus> = {
  "Přijato": "prijato",
  "Nacenění": "naceneni",
  "Objednáno": "objednano",
  "Ve výrobě": "ve_vyrobe",
  "Expedováno": "expedovano",
  "Dokončeno": "dokonceno",
  "Zrušeno": "zruseno",
};

// Sloupec s časovým razítkem dle stavu (kniha zakázek hlídá průběh)
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  objednano: "confirmed_at",
  ve_vyrobe: "production_started_at",
  expedovano: "shipped_at",
  dokonceno: "delivered_at",
};

export async function updateOrderStatus(
  id: string,
  statusLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const status = LABEL_TO_ENUM[statusLabel];
  if (!status) return { ok: false, error: "Neznámý stav." };
  // Bez DB (demo na mock datech) jen potvrdíme — UI aktualizuje lokálně.
  if (!isSupabaseConfigured()) return { ok: true };

  try {
    const db = await createOperatorClient();
    const patch: Record<string, unknown> = { status };
    const ts = STATUS_TIMESTAMP[status];
    if (ts) patch[ts] = new Date().toISOString();
    const { error } = await db.from("orders").update(patch as never).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

const NEED = "Pro uložení doplň servisní klíč Supabase nebo se přihlas.";

export async function createOrder(input: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  if (!input.title?.trim()) return { ok: false, error: "Zadej název zakázky." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();

    // Číslo zakázky
    const { data: numData } = await db.rpc("next_doc_number", { p_prefix: "OBJ" });
    const number = (numData as string) || `OBJ-${Date.now()}`;

    // Volitelné dohledání zákazníka podle názvu
    let customerId: string | null = null;
    if (input.customer?.trim()) {
      const { data: c } = await db.from("customers").select("id").ilike("name", input.customer.trim()).maybeSingle();
      customerId = (c as { id: string } | null)?.id ?? null;
    }

    const { data, error } = await db
      .from("orders")
      .insert({
        number,
        title: input.title.trim(),
        customer_id: customerId,
        value: input.value ? Number(input.value) : null,
        due_date: input.dueDate || null,
        technology: input.technology?.trim() || null,
        specific_requirements: input.requirements?.trim() || null,
        status: "prijato",
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED };
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
