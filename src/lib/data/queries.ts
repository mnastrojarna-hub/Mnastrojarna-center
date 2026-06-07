import "server-only";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  emailCategoryLabel, priorityLabel, orderStatusLabel, quoteStatusLabel, approvalTypeLabel,
} from "@/lib/data/labels";
import type {
  Email, ApprovalItemRow, Order, Quote, Customer, Supplier, Drawing,
} from "@/lib/supabase/database.types";
import * as mock from "@/lib/mock-data";

/**
 * Datová vrstva: čte ze Supabase, při nenakonfigurované nebo prázdné DB
 * vrací demo data (mock), aby UI fungovalo i bez živého backendu.
 */

async function supa() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createClient();
  } catch {
    return null;
  }
}

export async function getEmails(): Promise<mock.EmailItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db
      .from("emails")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(100);
    if (!error && data && data.length) {
      return (data as Email[]).map((e) => ({
        id: e.id,
        from: e.from_name ?? e.from_email ?? "—",
        fromEmail: e.from_email ?? "",
        subject: e.subject ?? "",
        preview: e.snippet ?? e.body_text?.slice(0, 140) ?? "",
        category: (e.category ? emailCategoryLabel[e.category] : "Ostatní") as mock.EmailCategory,
        priority: (e.priority ? priorityLabel[e.priority] : "Střední") as mock.EmailItem["priority"],
        customer: undefined,
        receivedAt: e.received_at,
        aiConfidence: e.ai_confidence ?? 0,
        unread: !e.is_read,
        hasDraft: e.has_draft,
      }));
    }
  }
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
  return mock.approvalQueue;
}

export async function getOrders(): Promise<mock.OrderItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });
    if (!error && data && data.length) {
      return (data as Order[]).map((o) => ({
        id: o.id,
        number: o.number ?? "",
        customer: "—",
        title: o.title ?? "",
        status: orderStatusLabel[o.status] as mock.OrderItem["status"],
        value: Number(o.value ?? 0),
        dueDate: o.due_date ?? "",
        owner: "—",
      }));
    }
  }
  return mock.orders;
}

export async function getQuotes(): Promise<mock.QuoteItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("quotes").select("*").order("created_at", { ascending: false });
    if (!error && data && data.length) {
      return (data as Quote[]).map((q) => ({
        id: q.id,
        number: q.number ?? "",
        customer: "—",
        drawing: "—",
        qty: 0,
        status: quoteStatusLabel[q.status] as mock.QuoteItem["status"],
        value: q.total ? Number(q.total) : undefined,
        createdAt: q.created_at,
      }));
    }
  }
  return mock.quotes;
}

export async function getCustomers(): Promise<mock.CustomerItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("customers").select("*").order("name");
    if (!error && data && data.length) {
      return (data as Customer[]).map((c) => ({
        id: c.id,
        name: c.name,
        ico: c.ico ?? "—",
        country: c.country,
        contact: c.email ?? "—",
        email: c.email ?? "",
        orders: 0,
        revenue: 0,
        owner: "—",
      }));
    }
  }
  return mock.customers;
}

export async function getSuppliers(): Promise<mock.SupplierItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("suppliers").select("*").order("name");
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
  return mock.suppliers;
}

export async function getDrawings(): Promise<mock.DrawingItem[]> {
  const db = await supa();
  if (db) {
    const { data, error } = await db.from("drawings").select("*").order("created_at", { ascending: false });
    if (!error && data && data.length) {
      return (data as Drawing[]).map((d) => ({
        id: d.id,
        number: d.drawing_number,
        revision: d.revision,
        customer: "—",
        material: d.material ?? "—",
        dimensions: d.dimensions ?? "—",
        qty: d.quantity ?? 0,
        fileType: (d.file_type as mock.DrawingItem["fileType"]) ?? "PDF",
        uploadedAt: d.created_at,
      }));
    }
  }
  return mock.drawings;
}
