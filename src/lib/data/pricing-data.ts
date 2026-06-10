import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Customer, MachineRateRow, MaterialRow, PricingCalculation } from "@/lib/supabase/database.types";
import type {
  CustomerPricingProfile, HistoricalPrice, MachineRate, MaterialAvailability,
  MaterialGroup, MaterialInfo, MachineSize, TechnologyKey,
} from "@/lib/pricing/types";

/**
 * Datová vrstva Nacenění v2: katalogy z DB, zákaznický cenový profil,
 * historické ceny dílu a ukládání kalkulací (historické učení).
 */

async function supa() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createOperatorClient();
  } catch {
    return null;
  }
}

/** Katalogy materiálů a strojních sazeb z DB (přepíšou výchozí katalog v aplikaci). */
export async function loadPricingCatalog(): Promise<{ materials?: MaterialInfo[]; machineRates?: MachineRate[] }> {
  const db = await supa();
  if (!db) return {};
  try {
    const [mats, rates] = await Promise.all([
      db.from("materials").select("*"),
      db.from("machine_rates").select("*"),
    ]);
    const materials = (mats.data as MaterialRow[] | null)?.map((m): MaterialInfo => ({
      key: m.key,
      label: m.label,
      group: m.material_group as MaterialGroup,
      densityKgDm3: Number(m.density_kg_dm3),
      pricePerKg: Number(m.price_per_kg),
      machinability: Number(m.machinability),
      special: m.special,
      availability: m.availability as MaterialAvailability,
      aliases: [m.key.toLowerCase(), m.label.toLowerCase(), ...(m.aliases ?? []).map((a) => a.toLowerCase())],
    }));
    const machineRates = (rates.data as MachineRateRow[] | null)?.map((r): MachineRate => ({
      key: r.key,
      label: r.label,
      technology: r.technology as TechnologyKey,
      size: r.size as MachineSize,
      ratePerHour: Number(r.rate_per_hour),
    }));
    return {
      materials: materials?.length ? materials : undefined,
      machineRates: machineRates?.length ? machineRates : undefined,
    };
  } catch {
    return {};
  }
}

/** Cenový profil zákazníka dle (části) názvu firmy. */
export async function getCustomerPricingProfile(name?: string | null): Promise<CustomerPricingProfile | null> {
  if (!name || !name.trim()) return null;
  const db = await supa();
  if (!db) return null;
  try {
    const { data } = await db
      .from("customers")
      .select("*")
      .ilike("name", `%${name.trim()}%`)
      .limit(1);
    const c = (data as Customer[] | null)?.[0];
    if (!c) return null;
    return {
      name: c.name,
      marginPercent: c.margin_percent != null ? Number(c.margin_percent) : null,
      priceLevel: c.price_level ?? null,
      businessPriority: c.business_priority ?? null,
      paymentMorale: c.payment_morale ?? null,
      riskLevel: c.risk_level ?? null,
      annualRevenueCzk: c.annual_revenue_czk != null ? Number(c.annual_revenue_czk) : null,
      repeatCustomer: c.repeat_customer ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Historické ceny dílu: dřívější kalkulace (vč. korekcí uživatele — ty mají
 * přednost) a položky nabídek se stejným číslem výkresu.
 */
export async function findHistoricalPrices(drawingNumber?: string | null): Promise<HistoricalPrice[]> {
  if (!drawingNumber || !drawingNumber.trim()) return [];
  const db = await supa();
  if (!db) return [];
  const out: HistoricalPrice[] = [];
  try {
    const { data } = await db
      .from("pricing_calculations")
      .select("unit_price, user_unit_price, corrected, created_at")
      .eq("drawing_number", drawingNumber.trim())
      .order("created_at", { ascending: false })
      .limit(5);
    for (const r of (data ?? []) as Pick<PricingCalculation, "unit_price" | "user_unit_price" | "corrected" | "created_at">[]) {
      const price = r.corrected && r.user_unit_price ? Number(r.user_unit_price) : Number(r.unit_price ?? 0);
      if (price > 0) out.push({ unitPrice: price, date: r.created_at, note: r.corrected ? "korigováno uživatelem" : "AI kalkulace" });
    }
  } catch { /* tabulka nemusí existovat před migrací */ }
  try {
    const { data } = await db
      .from("quote_items")
      .select("quantity, unit_price, quotes(number, total, created_at), drawings!inner(drawing_number)")
      .eq("drawings.drawing_number", drawingNumber.trim())
      .order("created_at", { ascending: false, foreignTable: "quotes" })
      .limit(5);
    for (const row of (data ?? []) as { quantity: number; unit_price: number | null; quotes?: { number: string; total: number | null; created_at: string } | null }[]) {
      const q = row.quotes;
      const unit = row.unit_price ?? (q?.total && row.quantity ? Number(q.total) / row.quantity : null);
      if (unit && q) out.push({ unitPrice: Math.round(unit * 100) / 100, date: q.created_at, note: `nabídka ${q.number}` });
    }
  } catch { /* bez nabídek */ }
  return out;
}

export interface SaveCalculationInput {
  drawingNumber?: string;
  customerName?: string;
  material?: string;
  quantity: number;
  inputs: Record<string, unknown>;
  baseline: Record<string, unknown>;
  estimate: Record<string, unknown>;
  unitPrice?: number;
  totalPrice?: number;
  marginPercent?: number;
  leadTimeDays?: number;
  strategyLevel?: number;
  confidence?: number;
}

/** Uloží kalkulaci do historie (samoučení). Best-effort — chyba nezhavaruje nacenění. */
export async function savePricingCalculation(input: SaveCalculationInput): Promise<string | null> {
  const db = await supa();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("pricing_calculations")
      .insert({
        drawing_number: input.drawingNumber || null,
        customer_name: input.customerName || null,
        material: input.material || null,
        quantity: input.quantity,
        inputs: input.inputs,
        baseline: input.baseline,
        estimate: input.estimate,
        unit_price: input.unitPrice ?? null,
        total_price: input.totalPrice ?? null,
        margin_percent: input.marginPercent ?? null,
        lead_time_days: input.leadTimeDays ?? null,
        strategy_level: input.strategyLevel ?? null,
        confidence: input.confidence ?? null,
      })
      .select("id")
      .single();
    if (error) return null;
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/** Poslední kalkulace pro přehled na stránce Nacenění. */
export async function getRecentPricingCalculations(limit = 15): Promise<PricingCalculation[]> {
  const db = await supa();
  if (!db) return [];
  try {
    const { data, error } = await db
      .from("pricing_calculations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as PricingCalculation[];
  } catch {
    return [];
  }
}

/** Korekce uložené kalkulace (cena/termín/marže) — vstup samoučení. */
export async function correctPricingCalculation(input: {
  id: string;
  userUnitPrice?: number;
  userLeadTimeDays?: number;
  userMarginPercent?: number;
  note?: string;
}): Promise<boolean> {
  const db = await supa();
  if (!db) return false;
  try {
    const { error } = await db
      .from("pricing_calculations")
      .update({
        corrected: true,
        user_unit_price: input.userUnitPrice ?? null,
        user_lead_time_days: input.userLeadTimeDays ?? null,
        user_margin_percent: input.userMarginPercent ?? null,
        user_note: input.note ?? null,
        corrected_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return !error;
  } catch {
    return false;
  }
}
