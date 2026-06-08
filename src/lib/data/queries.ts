import "server-only";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import {
  emailCategoryLabel, priorityLabel, orderStatusLabel, quoteStatusLabel, approvalTypeLabel,
} from "@/lib/data/labels";
import type {
  Email, ApprovalItemRow, Order, Quote, Customer, Supplier, Drawing,
} from "@/lib/supabase/database.types";
import * as mock from "@/lib/mock-data";

/**
 * Datová vrstva. Se servisním klíčem (operátorský režim) čte REÁLNÁ data
 * (i prázdná → prázdný stav). Bez něj (nebo bez Supabase) vrací demo data,
 * aby UI fungovalo i bez živého backendu.
 */

async function supa() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createOperatorClient();
  } catch {
    return null;
  }
}

/** Reálný režim: máme servisní klíč → vracíme skutečná (i prázdná) data místo demo. */
function real() {
  return hasServiceKey();
}

function warn(scope: string, error: { message: string } | null) {
  if (error) console.error(`[data:${scope}] Supabase chyba: ${error.message} — používám demo data.`);
}

// Pomocné typy pro vnořené (joinované) vztahy
type WithCustomer = { customers?: { name: string } | null };
type WithOwner = { profiles?: { full_name: string } | null };

export async function getEmails(): Promise<mock.EmailItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("emails")
      .select("*, customers(name)")
      .order("received_at", { ascending: false })
      .limit(100);
    warn("emails", error);
    if (!error && data && data.length) {
      return (data as (Email & WithCustomer)[]).map((e) => ({
        id: e.id,
        from: e.from_name ?? e.from_email ?? "—",
        fromEmail: e.from_email ?? "",
        subject: e.subject ?? "",
        preview: e.snippet ?? e.body_text?.slice(0, 140) ?? "",
        category: (e.category ? emailCategoryLabel[e.category] : "Ostatní") as mock.EmailCategory,
        priority: (e.priority ? priorityLabel[e.priority] : "Střední") as mock.EmailItem["priority"],
        customer: e.customers?.name,
        receivedAt: e.received_at,
        aiConfidence: e.ai_confidence ?? 0,
        unread: !e.is_read,
        hasDraft: e.has_draft,
      }));
    }
  }
  if (real()) return [];
  return mock.emails;
}

export async function getApprovalQueue(): Promise<mock.ApprovalItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("approval_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    warn("approval_queue", error);
    if (!error && data && data.length) {
      return (data as ApprovalItemRow[]).map((a) => ({
        id: a.id,
        type: approvalTypeLabel[a.type] as mock.ApprovalItem["type"],
        title: a.title,
        summary: a.summary ?? "",
        target: a.target ?? "",
        createdAt: a.created_at,
        aiConfidence: a.ai_confidence ?? 0,
      }));
    }
  }
  if (real()) return [];
  return mock.approvalQueue;
}

export async function getOrders(): Promise<mock.OrderItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("orders")
      .select("*, customers(name), profiles(full_name)")
      .order("created_at", { ascending: false });
    warn("orders", error);
    if (!error && data && data.length) {
      return (data as (Order & WithCustomer & WithOwner)[]).map((o) => ({
        id: o.id,
        number: o.number ?? "",
        customer: o.customers?.name ?? "—",
        title: o.title ?? "",
        status: orderStatusLabel[o.status] as mock.OrderItem["status"],
        value: Number(o.value ?? 0),
        dueDate: o.due_date ?? "",
        owner: o.profiles?.full_name ?? "—",
        technology: o.technology ?? undefined,
        location: o.manufacturing_location ?? undefined,
        requirements: o.specific_requirements ?? undefined,
      }));
    }
  }
  if (real()) return [];
  return mock.orders;
}

export async function getQuotes(): Promise<mock.QuoteItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("quotes")
      .select("*, customers(name), quote_items(quantity, drawings(drawing_number))")
      .order("created_at", { ascending: false });
    warn("quotes", error);
    if (!error && data && data.length) {
      type QRow = Quote & WithCustomer & {
        quote_items?: { quantity: number; drawings?: { drawing_number: string } | null }[];
      };
      return (data as QRow[]).map((q) => {
        const items = q.quote_items ?? [];
        return {
          id: q.id,
          number: q.number ?? "",
          customer: q.customers?.name ?? "—",
          drawing: items[0]?.drawings?.drawing_number ?? "—",
          qty: items.reduce((s, it) => s + (it.quantity ?? 0), 0),
          status: quoteStatusLabel[q.status] as mock.QuoteItem["status"],
          value: q.total ? Number(q.total) : undefined,
          createdAt: q.created_at,
        };
      });
    }
  }
  if (real()) return [];
  return mock.quotes;
}

export async function getCustomers(): Promise<mock.CustomerItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("customers")
      .select("*, orders(value), profiles(full_name)")
      .order("name");
    warn("customers", error);
    if (!error && data && data.length) {
      type CRow = Customer & WithOwner & { orders?: { value: number | null }[] };
      return (data as CRow[]).map((c) => {
        const ords = c.orders ?? [];
        return {
          id: c.id,
          name: c.name,
          ico: c.ico ?? "—",
          country: c.country,
          contact: c.email ?? "—",
          email: c.email ?? "",
          orders: ords.length,
          revenue: ords.reduce((s, o) => s + Number(o.value ?? 0), 0),
          owner: c.profiles?.full_name ?? "—",
        };
      });
    }
  }
  if (real()) return [];
  return mock.customers;
}

export async function getSuppliers(): Promise<mock.SupplierItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("suppliers").select("*").order("name");
    warn("suppliers", error);
    if (!error && data && data.length) {
      return (data as Supplier[]).map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        technologies: s.technologies ?? [],
        materials: s.materials ?? [],
        leadDays: s.lead_days ?? 0,
        rating: s.rating ? Number(s.rating) : 0,
      }));
    }
  }
  if (real()) return [];
  return mock.suppliers;
}

export async function getDrawings(): Promise<mock.DrawingItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("drawings")
      .select("*, customers(name)")
      .order("created_at", { ascending: false });
    warn("drawings", error);
    if (!error && data && data.length) {
      return (data as (Drawing & WithCustomer)[]).map((d) => ({
        id: d.id,
        number: d.drawing_number,
        revision: d.revision,
        customer: d.customers?.name ?? "—",
        material: d.material ?? "—",
        dimensions: d.dimensions ?? "—",
        qty: d.quantity ?? 0,
        fileType: (d.file_type as mock.DrawingItem["fileType"]) ?? "PDF",
        uploadedAt: d.created_at,
      }));
    }
  }
  if (real()) return [];
  return mock.drawings;
}

export async function getCommissions(): Promise<mock.CommissionRow[]> {
  const db = await supa();
  if (db) {
    const period = new Date();
    const first = new Date(period.getFullYear(), period.getMonth(), 1).toISOString().slice(0, 10);
    const { data, error } = await db
      .from("commission_entries")
      .select("id, owner_id, revenue, margin, rate, commission, profiles(full_name)")
      .gte("period", first);
    warn("commissions", error);
    if (!error && data && data.length) {
      type CE = {
        id: string; owner_id: string; revenue: number; margin: number; rate: number;
        commission: number; profiles?: { full_name: string } | null;
      };
      // Agregace po obchodníkovi za aktuální období
      const byOwner = new Map<string, mock.CommissionRow>();
      for (const r of data as CE[]) {
        const name = r.profiles?.full_name ?? "—";
        const cur = byOwner.get(r.owner_id) ?? { id: r.owner_id, owner: name, revenue: 0, margin: 0, rate: Number(r.rate), commission: 0 };
        cur.revenue += Number(r.revenue);
        cur.commission += Number(r.commission);
        cur.margin = Number(r.margin);
        byOwner.set(r.owner_id, cur);
      }
      return [...byOwner.values()];
    }
  }
  if (real()) return [];
  return mock.commissions;
}

/** Najde nejnovější historickou nabídku pro dané číslo výkresu (pro reuse ceny + inflace). */
export async function findHistoricalQuote(drawingNumber?: string): Promise<{ found: boolean; unitPrice?: number; note?: string }> {
  if (!drawingNumber || !drawingNumber.trim()) return { found: false };
  const db = await supa();
  if (!db) return { found: false };
  try {
    const { data, error } = await db
      .from("quote_items")
      .select("quantity, unit_price, quotes(number, total, status, created_at), drawings!inner(drawing_number)")
      .eq("drawings.drawing_number", drawingNumber.trim())
      .order("created_at", { ascending: false, foreignTable: "quotes" })
      .limit(1);
    if (error || !data || !data.length) return { found: false };
    const row = data[0] as {
      quantity: number; unit_price: number | null;
      quotes?: { number: string; total: number | null; status: string; created_at: string } | null;
    };
    const q = row.quotes;
    const unit = row.unit_price ?? (q?.total && row.quantity ? Number(q.total) / row.quantity : undefined);
    return {
      found: true,
      unitPrice: unit ? Math.round(unit * 100) / 100 : undefined,
      note: q ? `nabídka ${q.number} z ${new Date(q.created_at).toLocaleDateString("cs-CZ")} (${q.status})` : undefined,
    };
  } catch {
    return { found: false };
  }
}
