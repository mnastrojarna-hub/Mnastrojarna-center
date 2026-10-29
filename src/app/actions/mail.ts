"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { copyEmailAttachmentsToJob, extractAndApply, linkThread, type MailJobActor } from "@/lib/email/job-link-store";
import { cleanMailText, itemHintsFromMail } from "@/lib/email/job-instructions";
import { checkFeature } from "@/lib/auth/session";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { translateDbError } from "@/lib/jobs/mapping";
import { matchPartyByEmail, type PartyRef } from "@/lib/email/match";
import {
  buildJobFromEmail, isUuidLike, isDbEmailCategory, jobPeopleFromEmail, type EmailForJob,
} from "@/lib/email/visibility";
import { emailCategoryLabel } from "@/lib/data/labels";
import type { EmailCategory } from "@/lib/supabase/database.types";

/**
 * Akce pošty: přečteno / nepřečteno, tělo e-mailu, založení zakázky z e-mailu.
 * Data jdou servisním klíčem → každá akce ověří, že uživatel e-mail smí vidět.
 */

const NOT_FOUND = "E-mail nenalezen (nebo k němu nemáš přístup).";

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

/** Označí e-mail jako přečtený / nepřečtený. */
export async function markEmailRead(emailId: string, read: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("mail");
  if ("error" in access) return fail(access.error);
  try {
    const found = await getVisibleEmailRow<{ id: string; is_read: boolean }>(emailId, "id, is_read");
    if (!found) return fail(NOT_FOUND);
    if (found.row.is_read === Boolean(read)) return { ok: true };
    const db = await createOperatorClient();
    const { error } = await db.from("emails").update({ is_read: Boolean(read) } as never).eq("id", emailId);
    if (error) return fail(error.message);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Ruční zařazení e-mailu do kategorie (bez AI ho tak roztřídí člověk).
 * Pokud kategorii dřív určila AI, oprava se uloží jako korekce — AI se poučí.
 */
export async function setEmailCategory(
  emailId: string,
  category: EmailCategory,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("mail");
  if ("error" in access) return fail(access.error);
  if (!isDbEmailCategory(category)) return fail("Neznámá kategorie.");
  try {
    const found = await getVisibleEmailRow<{
      id: string; category: EmailCategory | null; ai_confidence: number | null; subject: string | null; from_email: string | null;
    }>(emailId, "id, category, ai_confidence, subject, from_email");
    if (!found) return fail(NOT_FOUND);
    const prev = found.row.category;
    if (prev === category && !note?.trim()) return { ok: true };
    const db = await createOperatorClient();
    const { error } = await db
      .from("emails")
      .update({ category, is_spam: category === "spam" } as never)
      .eq("id", emailId);
    if (error) return fail(error.message);

    // AI se učí z ruční opravy (jen když kategorii předtím určila AI, nebo je k ní pravidlo)
    if ((found.row.ai_confidence !== null && prev !== category) || note?.trim()) {
      await db.from("ai_corrections").insert({
        agent_key: "email",
        field: "category",
        context: `Předmět: ${(found.row.subject ?? "").slice(0, 300)} (od ${found.row.from_email ?? "?"})`,
        ai_value: prev ? emailCategoryLabel[prev] : null,
        corrected_value: emailCategoryLabel[category],
        note: note?.trim().slice(0, 1000) || null,
        created_by: access.user.id,
      } as never);
    }
    await logAudit({ action: "email_category_set", entity: "emails", entityId: emailId, diff: { from: prev, to: category } });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export interface EmailBody {
  ok: boolean;
  error?: string;
  body?: string;
  toEmail?: string | null;
  ccEmail?: string | null;
  attachments?: { id: string; filename: string; sizeBytes: number | null }[];
}

const BODY_MAX = 20000;

/** Celé tělo e-mailu (do detailu se načítá až po otevření — seznam nese jen náhled). */
export async function getEmailBody(emailId: string): Promise<EmailBody> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("mail");
  if ("error" in access) return fail(access.error);
  try {
    const found = await getVisibleEmailRow<{ id: string; body_text: string | null; snippet: string | null; to_email: string | null; cc_email: string | null }>(
      emailId,
      "id, body_text, snippet, to_email, cc_email",
    );
    if (!found) return fail(NOT_FOUND);
    const db = await createOperatorClient();
    const { data: att } = await db
      .from("email_attachments")
      .select("id, filename, size_bytes")
      .eq("email_id", emailId);
    const body = (found.row.body_text ?? found.row.snippet ?? "").slice(0, BODY_MAX);
    return {
      ok: true,
      body,
      toEmail: found.row.to_email,
      ccEmail: found.row.cc_email,
      attachments: ((att ?? []) as { id: string; filename: string | null; size_bytes: number | null }[]).map((a) => ({
        id: a.id,
        filename: a.filename ?? "příloha",
        sizeBytes: a.size_bytes,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Autor zápisů Pošty B (přiřazení vlákna, změny z e-mailu, přílohy) = přihlášený uživatel. */
async function mailActor(user: { id: string }): Promise<MailJobActor> {
  const ctx = userActor(user);
  return { db: (await createOperatorClient({ actor: ctx })) as unknown as SupabaseClient, actorId: user.id, kind: "user", ctx };
}

/**
 * Přílohy e-mailu → dokumenty zakázky (Pošta B: jednou, bez duplicit podle obsahu, nový výkres stejného
 * čísla = nová revize; obsah i ze serveru IMAP). Vystavitel podle e-mailu (#25 §4.2).
 */
async function copyAttachments(a: MailJobActor, emailId: string, jobId: string): Promise<number> {
  return (await copyEmailAttachmentsToJob(a, emailId, jobId)).copied;
}

/**
 * Přiřadí e-mail k existující zakázce (stejné číslo objednávky zákazníka — žádná duplicitní
 * zakázka). Přílohy se zkopírují do Dokumentů zakázky; do historie se zapíše, kdo přiřadil.
 */
export async function linkEmailToJob(emailId: string, jobId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("orders");
  if ("error" in access) return fail(access.error);
  if (!isUuidLike(emailId)) return fail(NOT_FOUND);
  if (!isUuidLike(jobId)) return fail("Zakázka nenalezena.");
  const { user } = access;
  try {
    const found = await getVisibleEmailRow<{ id: string; subject: string | null; order_id: string | null }>(emailId, "id, subject, order_id");
    if (!found) return fail(NOT_FOUND);
    if (found.row.order_id) return found.row.order_id === jobId ? { ok: true } : fail("E-mail už patří k jiné zakázce.");
    const db = await createOperatorClient();
    const { data: job } = await db.from("orders").select("id, number").eq("id", jobId).maybeSingle();
    if (!job) return fail("Zakázka nenalezena.");
    // Pošta B: přiřazení platí pro celé vlákno (e-mail i ostatní nepřiřazené zprávy vlákna) — s autorem,
    // zdrojem „ručně" a JEDNÍM řádkem v historii; technické změny z textu, přílohy jednou
    const a = await mailActor(user);
    const { data: em } = await a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email").eq("id", emailId).maybeSingle();
    if (!em) return fail(NOT_FOUND);
    const linked = await linkThread(a, { email: em as never, jobId, source: "manual", confidence: null, strong: true });
    if (!linked.ok) return fail(linked.error ?? "E-mail se nepodařilo přiřadit.");
    const { data: now } = await db.from("emails").select("order_id").eq("id", emailId).maybeSingle();
    if ((now as { order_id: string | null } | null)?.order_id !== jobId) return fail("E-mail mezitím přiřadil někdo jiný — obnov stránku.");
    await extractAndApply(a, emailId, jobId, { force: true });
    await copyAttachments(a, emailId, jobId);
    await logAudit({ action: "email_linked_to_job", entity: "emails", entityId: emailId, diff: { jobId } });
    for (const p of ["/orders", "/inbox", "/inquiries", "/confirmations"]) revalidatePath(p);
    revalidatePath(`/orders/${jobId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Vlastník schránky e-mailu (emails.owner_id, jinak vlastník schránky) — jen aktivní účet. */
async function mailboxOwnerOf(db: JobsDb, ownerId: string | null, mailboxId: string | null): Promise<{ id: string; role: string } | null> {
  let id = ownerId;
  if (!id && mailboxId) {
    const { data } = await db.from("mailboxes").select("owner_id").eq("id", mailboxId).maybeSingle();
    id = (data as { owner_id: string | null } | null)?.owner_id ?? null;
  }
  if (!id) return null;
  const { data: p } = await db.from("profiles").select("id, role, active").eq("id", id).maybeSingle();
  const prof = p as { id: string; role: string; active: boolean } | null;
  return prof && prof.active !== false ? { id: prof.id, role: prof.role } : null;
}

async function customerOwnerOf(db: JobsDb, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await db.from("customers").select("owner_id").eq("id", customerId).maybeSingle();
  return (data as { owner_id: string | null } | null)?.owner_id ?? null;
}

/**
 * Založí zakázku z e-mailu (Poptávka, u objednávky/potvrzení stav Objednávka)
 * a propojí ji s e-mailem. Už propojený e-mail vrátí existující zakázku.
 * Obchodník / Zpracovává podle vlastníka schránky (#25), založil = klikající.
 */
export async function createJobFromEmail(
  emailId: string,
): Promise<{ ok: boolean; error?: string; id?: string; number?: string; existed?: boolean }> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("orders");
  if ("error" in access) return fail(access.error);
  if (!isUuidLike(emailId)) return fail(NOT_FOUND);
  const { user } = access;

  try {
    const found = await getVisibleEmailRow<EmailForJob & { order_id: string | null; owner_id: string | null; mailbox_id: string | null; body_text: string | null }>(
      emailId,
      "id, subject, from_name, from_email, customer_id, category, received_at, ai_summary, snippet, order_id, owner_id, mailbox_id, body_text",
    );
    if (!found) return fail(NOT_FOUND);
    const email = found.row;
    const db = await createOperatorClient();

    // Už propojeno → otevřít existující zakázku
    if (email.order_id) {
      const { data: existing } = await db.from("orders").select("id, number").eq("id", email.order_id).maybeSingle();
      const job = existing as { id: string; number: string | null } | null;
      if (job) return { ok: true, id: job.id, number: job.number ?? undefined, existed: true };
    }

    // Zákazník: z e-mailu, jinak dohledat podle adresy odesílatele (zákazník mohl přibýt později)
    let customerId = email.customer_id;
    if (!customerId && email.from_email) {
      const { data: customers } = await db.from("customers").select("id, email");
      customerId = matchPartyByEmail(email.from_email, (customers ?? []) as PartyRef[]) ?? null;
    }

    const { data: number, error: numErr } = await db.rpc("next_job_number");
    if (numErr || typeof number !== "string" || !number) {
      return fail(numErr?.message ?? "Nepodařilo se přidělit číslo zakázky.");
    }

    // #25: zakázka patří vlastníkovi schránky (obchodník → Obchodník, zaměstnanec → Zpracovává)
    const people = jobPeopleFromEmail({
      mailboxOwner: await mailboxOwnerOf(db, email.owner_id, email.mailbox_id),
      customerOwnerId: await customerOwnerOf(db, customerId),
      actor: { id: user.id, role: user.role },
    });
    const row = buildJobFromEmail(email, { number, actorId: user.id, customerId, ownerId: people.ownerId, assigneeId: people.assigneeId });
    const { data: created, error } = await db.from("orders").insert(row as never).select("id, number").single();
    if (error || !created) return fail(error?.message ?? "Zakázku se nepodařilo založit.");
    const job = created as { id: string; number: string };

    // Propojení e-mailu; souběžné dvojí kliknutí → zůstane jen první zakázka
    let link = db.from("emails").update({ order_id: job.id } as never).eq("id", emailId);
    if (!email.order_id) link = link.is("order_id", null);
    const { data: linked, error: linkErr } = await link.select("id");
    if (linkErr) console.error(`[mail] Propojení e-mailu se zakázkou selhalo: ${linkErr.message}`);
    if (!linkErr && (!linked || (linked as unknown[]).length === 0)) {
      const { data: cur } = await db.from("emails").select("order_id").eq("id", emailId).maybeSingle();
      const other = (cur as { order_id: string | null } | null)?.order_id;
      if (other && other !== job.id) {
        await db.from("orders").delete().eq("id", job.id);
        const { data: prev } = await db.from("orders").select("id, number").eq("id", other).maybeSingle();
        const p = prev as { id: string; number: string | null } | null;
        return { ok: true, id: other, number: p?.number ?? undefined, existed: true };
      }
    }

    const subject = (email.subject ?? "").trim() || "(bez předmětu)";
    await logJobEvent(db, {
      jobId: job.id,
      type: "created",
      message: `Zakázka založena z e-mailu „${subject.slice(0, 200)}“`,
      data: { emailId, from: email.from_email, category: email.category },
      actorId: user.id,
    });

    // poznámka zakázky (shrnutí / začátek e-mailu) i v historii — majitel: „měly by tam být i poznámky"
    const note = typeof (row as { note?: unknown }).note === "string" ? ((row as { note: string }).note) : null;
    if (note) {
      await logJobEvent(db, {
        jobId: job.id, type: "field", message: `Interní poznámka: ${note.slice(0, 300)}`,
        data: { changes: [{ field: "note", label: "Interní poznámka", from: null, to: note, fromText: "—", toText: note }], note: true },
        actorId: user.id,
      });
    }

    // Pošta B (B4): položky z textu e-mailu (výkres + počet) a pokyn zákazníka z e-mailu je NADŘAZENÝ
    // výkresu — „prosím kalit" se propíše do položky (s odznakem a možností vrátit), ne jen do poznámky
    const a = await mailActor(user);
    const { data: attRows } = await a.db.from("email_attachments").select("filename").eq("email_id", emailId);
    const names = ((attRows ?? []) as { filename: string | null }[]).map((r) => r.filename ?? "").filter(Boolean);
    const hints = itemHintsFromMail(email.body_text, names);
    if (hints.length) {
      const { error: itemErr } = await a.db.from("order_items").insert(hints.map((h, i) => ({
        order_id: job.id, position: i, drawing_number: h.drawingNumber.slice(0, 120), name: h.name, quantity: h.quantity ?? 1, unit: "ks",
        note: h.quantity ? null : "Počet doplň — v e-mailu není",
      })));
      if (itemErr) console.error(`[mail] Položky z e-mailu se nepodařilo uložit: ${itemErr.message}`);
      else {
        await logJobEvent(db, {
          jobId: job.id, type: "field", message: `Položky z e-mailu: ${hints.map((h) => `${h.drawingNumber}${h.quantity ? ` · ${h.quantity} ks` : ""}`).join(", ").slice(0, 300)}`,
          data: { items: hints.length, emailId }, actorId: user.id,
        });
      }
    }
    await a.db.from("emails").update({ job_link_source: "created", job_link_actor: "user", job_linked_at: new Date().toISOString(), job_linked_by: user.id, job_match_at: new Date().toISOString() }).eq("id", emailId);
    const { data: em } = await a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email").eq("id", emailId).maybeSingle();
    if (em) await linkThread(a, { email: em as never, jobId: job.id, source: "created", confidence: null, strong: true });
    // zakázka založená z tohoto e-mailu: odesílatel je její zákazník a text je zadání (i u starší pošty)
    if (cleanMailText(email.body_text)) await extractAndApply(a, emailId, job.id, { mode: "full", party: "customer", allowOld: true, force: true });
    await copyAttachments(a, emailId, job.id);

    await logAudit({ action: "job_created_from_email", entity: "orders", entityId: job.id, diff: { emailId, number: job.number } });
    for (const p of ["/orders", "/inbox", "/inquiries", "/confirmations", "/"]) revalidatePath(p);
    revalidatePath(`/orders/${job.id}`);
    return { ok: true, id: job.id, number: job.number };
  } catch (err) {
    return fail(err);
  }
}
