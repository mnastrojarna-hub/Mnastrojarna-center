"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

const NEED_OPERATOR =
  "Pro ukládání doplň servisní klíč Supabase (SUPABASE_SECRET_KEY) nebo se přihlas.";

export async function createCustomer(input: Record<string, string>): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "Zadej název firmy." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("customers")
      .insert({
        name: input.name.trim(),
        ico: input.ico?.trim() || null,
        dic: input.dic?.trim() || null,
        country: input.country?.trim() || "CZ",
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    revalidatePath("/customers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function createSupplier(input: Record<string, string>): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "Zadej název dodavatele." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const list = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
    const { data, error } = await db
      .from("suppliers")
      .insert({
        name: input.name.trim(),
        country: input.country?.trim() || "CZ",
        email: input.email?.trim() || null,
        technologies: list(input.technologies),
        materials: list(input.materials),
        lead_days: input.leadDays ? Number(input.leadDays) : null,
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
