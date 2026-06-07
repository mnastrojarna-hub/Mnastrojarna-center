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
