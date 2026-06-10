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

/** Zákaznický cenový profil (Nacenění v2) — marže, hladina, priorita, morálka, riziko. */
export async function updateCustomerPricingProfile(input: {
  id: string;
  marginPercent?: string;
  priceLevel?: string;
  businessPriority?: string;
  paymentMorale?: string;
  riskLevel?: string;
  annualRevenueCzk?: string;
  repeatCustomer?: boolean;
}): Promise<Result> {
  if (!input.id) return { ok: false, error: "Chybí zákazník." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const numOrNull = (v?: string) => {
    const n = Number(v);
    return v?.trim() && Number.isFinite(n) ? n : null;
  };
  try {
    const db = await createOperatorClient();
    const { error } = await db
      .from("customers")
      .update({
        margin_percent: numOrNull(input.marginPercent),
        price_level: input.priceLevel || null,
        business_priority: input.businessPriority || null,
        payment_morale: input.paymentMorale || null,
        risk_level: input.riskLevel || null,
        annual_revenue_czk: numOrNull(input.annualRevenueCzk),
        repeat_customer: Boolean(input.repeatCustomer),
      } as never)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/customers/${input.id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
