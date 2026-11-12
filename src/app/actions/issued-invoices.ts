"use server";

import { revalidatePath } from "next/cache";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { isUuid, translateDbError } from "@/lib/jobs/mapping";
import { pdfFileName } from "@/lib/pdf/job-docs";
import { isInvoiceRelease, releaseJobInvoiceCore } from "@/lib/jobs/invoice-release";
import { jobOnlyId } from "@/lib/issued-invoices/model";
import type { ActionResult } from "@/lib/jobs/types";
import { deleteJobFile } from "./job-files";

/**
 * Faktury vydané — smazání faktury. Stejná cesta jako smazání PDF faktury v Dokumentech: smažou se PDF faktury
 * z aplikace u zakázky (i starší verze), poslední smazání zruší vystavení (release_job_invoice — číslo, datum,
 * evidence, čítač FV, stav „Vyfakturováno" → „Dodáno zákazníkovi"). Faktura bez PDF z aplikace (vystavená mimo
 * systém) se zruší tímtéž RPC rovnou. Nahrané / vyfocené doklady zakázky zůstávají. Uhrazenou fakturu
 * (invoices.status = uhrazena) smazat nejde. Jen super admin / plný přístup (issued_invoices + delete).
 */

export interface IssuedInvoiceDeleteResult {
  number: string;
  /** Číslo bylo v řadě poslední — nová faktura dostane totéž. */
  numberFree: boolean;
  /** Stav zakázky vrácen na „Dodáno zákazníkovi". */
  stageReturned: boolean;
  /** Smazaná PDF faktury (všechny verze). */
  filesDeleted: number;
  jobId: string | null;
}

const NOT_FOUND = "Faktura nenalezena — možná už byla smazaná. Obnov stránku.";
const PAID = "Fakturu označenou jako uhrazenou smazat nejde.";

type Row = Record<string, unknown>;

export async function deleteIssuedInvoice(id: string): Promise<ActionResult<IssuedInvoiceDeleteResult>> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("issued_invoices");
  if ("error" in access) return { ok: false, error: access.error };
  if (!(await getAccess()).can("delete")) return { ok: false, error: "K mazání faktur nemáš oprávnění." };
  const user = access.user;
  const jobOnly = typeof id === "string" ? jobOnlyId(id) : null;
  if (!(jobOnly ? isUuid(jobOnly) : isUuid(id))) return { ok: false, error: NOT_FOUND };

  try {
    const db = await createOperatorClient({ actor: userActor(user) });
    let number = "";
    let jobId: string | null = null;
    let invoiceId: string | null = null;
    if (jobOnly) {
      // faktura zapsaná jen na zakázce (bez evidence)
      const { data } = await db.from("orders").select("id, invoice_number").eq("id", jobOnly).maybeSingle();
      const o = data as Row | null;
      number = String(o?.invoice_number ?? "").trim();
      if (!o || !number) return { ok: false, error: NOT_FOUND };
      jobId = jobOnly;
    } else {
      const { data } = await db.from("invoices").select("id, number, order_id, status").eq("id", id).maybeSingle();
      const inv = data as Row | null;
      if (!inv) return { ok: false, error: NOT_FOUND };
      if (inv.status === "uhrazena") return { ok: false, error: PAID };
      number = String(inv.number ?? "").trim();
      invoiceId = String(inv.id);
      jobId = typeof inv.order_id === "string" ? inv.order_id : null;
    }

    // zakázka, které faktura (pořád) patří
    let jobHasNumber = false;
    if (jobId) {
      const { data } = await db.from("orders").select("invoice_number").eq("id", jobId).maybeSingle();
      jobHasNumber = String((data as Row | null)?.invoice_number ?? "").trim() === number && Boolean(number);
    }

    if (!jobId || !jobHasNumber) {
      // evidence bez zakázky (nebo zakázka má už jiné číslo) → jen řádek evidence (+ archiv dokladů)
      if (!invoiceId) return { ok: false, error: NOT_FOUND };
      await db.from("documents").delete().eq("invoice_id", invoiceId).eq("doc_type", "faktura");
      const { error } = await db.from("invoices").delete().eq("id", invoiceId);
      if (error) return { ok: false, error: translateDbError(error.message) };
      const numberFree = await freeLastNumber(db, number);
      await logAudit({ action: "issued_invoice_deleted", entity: "invoices", entityId: invoiceId, diff: { number, numberFree, orphan: true }, actor: userActor(user) });
      revalidatePath("/issued-invoices");
      return { ok: true, number, numberFree, stageReturned: false, filesDeleted: 0, jobId: null };
    }

    // PDF faktury z aplikace (všechny verze): starší nejdřív, aktuální naposled → poslední smazání fakturu zruší
    const name = pdfFileName("faktura", number);
    const { data: fileData } = await db.from("job_files")
      .select("id, filename, archived, version, storage_path, origin, issuer")
      .eq("job_id", jobId).eq("kind", "faktura").eq("origin", "generated");
    let invoicePath: string | null = null;
    if (invoiceId) {
      const { data } = await db.from("invoices").select("storage_path").eq("id", invoiceId).maybeSingle();
      invoicePath = ((data as Row | null)?.storage_path as string | null) ?? null;
    }
    const files = ((fileData ?? []) as { id: string; filename: string; archived: boolean; version: number | null; storage_path: string | null; issuer: string | null }[])
      .filter((f) => f.issuer !== "dodavatel" && (f.filename === name || (invoicePath && f.storage_path === invoicePath)))
      .sort((a, b) => Number(b.archived) - Number(a.archived) || (a.version ?? 1) - (b.version ?? 1));

    let released: { numberFree: boolean; stageReturned: boolean } | null = null;
    let filesDeleted = 0;
    for (const f of files) {
      const r = await deleteJobFile(f.id);
      if (!r.ok) {
        return { ok: false, error: `${r.error ?? "PDF faktury se nepodařilo smazat."}${filesDeleted ? ` (smazáno ${filesDeleted} z ${files.length} PDF)` : ""}` };
      }
      filesDeleted++;
      if (r.invoiceReleased) released = r.invoiceReleased;
    }

    if (!released) {
      // bez PDF z aplikace, nebo u zakázky zůstal jiný doklad „faktura" (sken, faktura dodavatele) → zrušit přímo
      const { data } = await db.from("orders").select("invoice_number").eq("id", jobId).maybeSingle();
      if (String((data as Row | null)?.invoice_number ?? "").trim() === number) {
        const r = await releaseJobInvoiceCore(db, jobId, number, user.id, filesDeleted ? "smazáno ve Fakturách vydaných" : "smazáno ve Fakturách vydaných, bez PDF z aplikace");
        if (!isInvoiceRelease(r)) {
          if (r.reason === "paid") return { ok: false, error: PAID };
          return { ok: false, error: r.error ? translateDbError(r.error) : "Fakturu se nepodařilo zrušit." };
        }
        released = r;
      }
    }

    await logAudit({
      action: "issued_invoice_deleted", entity: "invoices", entityId: invoiceId ?? jobId,
      diff: { number, jobId, filesDeleted, numberFree: released?.numberFree ?? false, stageReturned: released?.stageReturned ?? false },
      actor: userActor(user),
    });
    revalidatePath("/issued-invoices");
    revalidatePath("/orders");
    revalidatePath(`/orders/${jobId}`);
    revalidatePath("/documents");
    return {
      ok: true, number, jobId, filesDeleted,
      numberFree: released?.numberFree ?? false, stageReturned: released?.stageReturned ?? false,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
  }
}

/** Číslo FV bylo v řadě poslední a nikdo jiný ho nemá → čítač zpět (nová faktura dostane totéž číslo). */
async function freeLastNumber(db: Awaited<ReturnType<typeof createOperatorClient>>, number: string): Promise<boolean> {
  const m = /^FV-(\d{4})-(\d+)$/.exec(number);
  if (!m) return false;
  const { data: other } = await db.from("orders").select("id").eq("invoice_number", number).limit(1);
  if ((other ?? []).length) return false;
  const year = Number(m[1]);
  const n = Number(m[2]);
  const { data } = await db.from("doc_counters").update({ counter: n - 1 } as never)
    .eq("doc_type", "FV").eq("year", year).eq("counter", n).select("doc_type");
  return ((data ?? []) as unknown[]).length > 0;
}
