import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  emailCategoryLabel, priorityLabel, orderStatusLabel, quoteStatusLabel, approvalTypeLabel,
} from "@/lib/data/labels";
import type {
  Email, ApprovalItemRow, Order, Quote, Customer, Supplier, Drawing, ApprovalType,
} from "@/lib/supabase/database.types";
import type {
  EmailItem, ApprovalItem, OrderItem, QuoteItem, CustomerItem, SupplierItem,
  DrawingItem, CommissionRow, BadgeCounts,
} from "@/lib/data/types";
import { periodStart } from "@/lib/data/periods";

/**
 * Datová vrstva — VÝHRADNĚ reálná data ze Supabase.
 * Bez konfigurace nebo při chybě vrací prázdné kolekce (UI ukáže prázdný stav s návodem).
 */

async function supa() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createOperatorClient();
  } catch {
    return null;
  }
}

function warn(scope: string, error: { message: string } | null) {
  if (error) console.error(`[data:${scope}] Supabase chyba: ${error.message}`);
}

// Pomocné typy pro vnořené (joinované) vztahy
type WithCustomer = { customers?: { name: string } | null };
type WithOwner = { profiles?: { full_name: string } | null };

export async function getEmails(): Promise<EmailItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("emails")
    .select("*, customers(name)")
    .order("received_at", { ascending: false })
    .limit(100);
  warn("emails", error);
  if (error || !data) return [];
  return (data as (Email & WithCustomer)[]).map((e) => ({
    id: e.id,
    from: e.from_name ?? e.from_email ?? "—",
    fromEmail: e.from_email ?? "",
    subject: e.subject ?? "",
    preview: e.snippet ?? e.body_text?.slice(0, 140) ?? "",
    category: (e.category ? emailCategoryLabel[e.category] : "Ostatní") as EmailItem["category"],
    priority: (e.priority ? priorityLabel[e.priority] : "Střední") as EmailItem["priority"],
    customer: e.customers?.name,
    receivedAt: e.received_at,
    aiConfidence: e.ai_confidence ?? 0,
    aiSummary: e.ai_summary ?? undefined,
    unread: !e.is_read,
    hasDraft: e.has_draft,
  }));
}

export async function getApprovalQueue(): Promise<ApprovalItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("approval_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  warn("approval_queue", error);
  if (error || !data) return [];
  return (data as ApprovalItemRow[]).map((a) => ({
    id: a.id,
    rawType: a.type as ApprovalType,
    type: approvalTypeLabel[a.type as ApprovalType] ?? a.type,
    title: a.title,
    summary: a.summary ?? "",
    target: a.target ?? "",
    body: typeof (a.payload as { body?: unknown })?.body === "string"
      ? ((a.payload as { body: string }).body)
      : "",
    createdAt: a.created_at,
    aiConfidence: a.ai_confidence ?? 0,
  }));
}

export async function getOrders(): Promise<OrderItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("orders")
    .select("*, customers(name), profiles(full_name)")
    .order("created_at", { ascending: false });
  warn("orders", error);
  if (error || !data) return [];
  return (data as (Order & WithCustomer & WithOwner)[]).map((o) => ({
    id: o.id,
    number: o.number ?? "",
    customer: o.customers?.name ?? "—",
    title: o.title ?? "",
    status: orderStatusLabel[o.status] as OrderItem["status"],
    value: Number(o.value ?? 0),
    dueDate: o.due_date ?? "",
    owner: o.profiles?.full_name ?? "—",
    technology: o.technology ?? undefined,
    location: o.manufacturing_location ?? undefined,
    requirements: o.specific_requirements ?? undefined,
  }));
}

export async function getQuotes(): Promise<QuoteItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("quotes")
    .select("*, customers(name), quote_items(quantity, drawings(drawing_number))")
    .order("created_at", { ascending: false });
  warn("quotes", error);
  if (error || !data) return [];
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
      status: quoteStatusLabel[q.status] as QuoteItem["status"],
      value: q.total ? Number(q.total) : undefined,
      createdAt: q.created_at,
    };
  });
}

export async function getCustomers(): Promise<CustomerItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("customers")
    .select("*, orders(value), profiles(full_name)")
    .order("name");
  warn("customers", error);
  if (error || !data) return [];
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

export async function getSuppliers(): Promise<SupplierItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db.from("suppliers").select("*").order("name");
  warn("suppliers", error);
  if (error || !data) return [];
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

export async function getDrawings(): Promise<DrawingItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("drawings")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });
  warn("drawings", error);
  if (error || !data) return [];
  return (data as (Drawing & WithCustomer)[]).map((d) => ({
    id: d.id,
    number: d.drawing_number,
    revision: d.revision,
    customer: d.customers?.name ?? "—",
    material: d.material ?? "—",
    dimensions: d.dimensions ?? "—",
    qty: d.quantity ?? 0,
    fileType: (d.file_type as DrawingItem["fileType"]) ?? "PDF",
    uploadedAt: d.created_at,
  }));
}

export type { CommissionPeriod } from "@/lib/data/periods";

export async function getCommissions(
  period: import("@/lib/data/periods").CommissionPeriod = "month",
): Promise<CommissionRow[]> {
  const db = await supa();
  if (!db) return [];
  const first = periodStart(period);
  const { data, error } = await db
    .from("commission_entries")
    .select("id, owner_id, revenue, margin, rate, commission, profiles(full_name)")
    .gte("period", first);
  warn("commissions", error);
  if (error || !data) return [];
  type CE = {
    id: string; owner_id: string; revenue: number; margin: number; rate: number;
    commission: number; profiles?: { full_name: string } | null;
  };
  // Agregace po obchodníkovi za aktuální období
  const byOwner = new Map<string, CommissionRow>();
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

/** Počty pro odznaky v navigaci — reálná čísla z DB. */
export async function getBadgeCounts(): Promise<BadgeCounts> {
  const empty: BadgeCounts = {
    inbox: 0, inquiries: 0, pricing: 0, quotes: 0, confirmations: 0, orders: 0, approvals: 0,
  };
  const db = await supa();
  if (!db) return empty;
  try {
    const [inbox, inquiries, pricing, quotes, confirmations, orders, approvals] = await Promise.all([
      db.from("emails").select("id", { count: "exact", head: true }).eq("is_read", false).neq("category", "spam"),
      db.from("emails").select("id", { count: "exact", head: true }).eq("is_read", false).eq("category", "poptavka"),
      db.from("quotes").select("id", { count: "exact", head: true }).eq("status", "navrh_ai"),
      db.from("quotes").select("id", { count: "exact", head: true }).eq("status", "ke_schvaleni"),
      db.from("orders").select("id", { count: "exact", head: true }).eq("status", "prijato"),
      db.from("orders").select("id", { count: "exact", head: true }).not("status", "in", "(dokonceno,zruseno)"),
      db.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    return {
      inbox: inbox.count ?? 0,
      inquiries: inquiries.count ?? 0,
      pricing: pricing.count ?? 0,
      quotes: quotes.count ?? 0,
      confirmations: confirmations.count ?? 0,
      orders: orders.count ?? 0,
      approvals: approvals.count ?? 0,
    };
  } catch {
    return empty;
  }
}

/** Odeslaná pošta — log odchozích akcí (schválených i automatických). */
export async function getSentLog(): Promise<import("@/lib/data/types").SentItem[]> {
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("approval_queue")
    .select("*")
    .in("status", ["approved", "auto_executed"])
    .order("resolved_at", { ascending: false })
    .limit(200);
  warn("sent_log", error);
  if (error || !data) return [];
  return (data as (ApprovalItemRow & { resolved_at?: string | null; status?: string })[])
    .filter((a) => ["email_reply", "quote", "supplier_request", "reminder"].includes(a.type))
    .map((a) => ({
      id: a.id,
      rawType: a.type as ApprovalType,
      type: approvalTypeLabel[a.type as ApprovalType] ?? a.type,
      title: a.title,
      target: a.target ?? "",
      body: typeof (a.payload as { body?: unknown })?.body === "string"
        ? (a.payload as { body: string }).body
        : "",
      sentAt: a.resolved_at ?? a.created_at,
      auto: a.status === "auto_executed",
    }));
}

/** Detail zákazníka s kompletní historií (CRM — nabídky, zakázky, komunikace, výkresy). */
export async function getCustomerDetail(id: string) {
  const db = await supa();
  if (!db) return null;
  const [customer, contacts, quotes, orders, emails, drawings] = await Promise.all([
    db.from("customers").select("*, profiles(full_name)").eq("id", id).maybeSingle(),
    db.from("customer_contacts").select("*").eq("customer_id", id),
    db.from("quotes").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("orders").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("emails").select("id, from_name, from_email, subject, category, received_at").eq("customer_id", id).order("received_at", { ascending: false }).limit(50),
    db.from("drawings").select("id, drawing_number, revision, material, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  if (!customer.data) return null;
  return {
    customer: customer.data as Customer & WithOwner,
    contacts: (contacts.data ?? []) as { id: string; name: string; email: string | null; phone: string | null; position: string | null }[],
    quotes: (quotes.data ?? []) as Quote[],
    orders: (orders.data ?? []) as Order[],
    emails: (emails.data ?? []) as Pick<Email, "id" | "from_name" | "from_email" | "subject" | "category" | "received_at">[],
    drawings: (drawings.data ?? []) as Pick<Drawing, "id" | "drawing_number" | "revision" | "material" | "created_at">[],
  };
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
