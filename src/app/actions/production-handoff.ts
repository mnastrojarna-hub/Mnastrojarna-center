"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { CurrentUser } from "@/lib/data/current-user";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid, translateDbError } from "@/lib/jobs/mapping";
import {
  buildHandoffPlan, deriveHandoffKind, ensureHandoffDocumentsCore, loadHandoffContext, productionHandoffCore, purchaseOrderMode,
  sendQueuedPurchaseOrder, usableMailbox, type HandoffActor,
} from "@/lib/jobs/production-handoff-store";
import { HANDOFF_KINDS, type HandoffErrorCode, type HandoffInput, type HandoffIssue, type HandoffKind, type HandoffPlan, type HandoffResult } from "@/lib/jobs/production-handoff-types";
import { isJobStage } from "@/lib/jobs/stages";
import type { PurchaseOrderMail } from "@/lib/jobs/purchasing-types";
import type { JobStage } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Předání do výroby — serverové akce (spec §F.2). Předat smí každý s Knihou zakázek (i zaměstnanec):
 * objednávky dodavatelům vystaví server z nabídek, ceny vidí a posílá jen obchodník / super admin
 * („margins"). Všechny zápisy jdou přes RPC production_apply (atomicky, idempotentně podle tokenu).
 */

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  actor: HandoffActor;
  can: (f: "dashboard" | "margins" | "mail_all") => boolean;
}

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return {
    db, user: access.user, can,
    actor: { id: access.user.id, fullName: access.user.fullName, margins: can("margins"), mailAll: can("mail_all"), via: "rucne" },
  };
}

function fail(err: unknown, code?: HandoffErrorCode, issues?: HandoffIssue[]): { ok: false; error: string; code?: HandoffErrorCode; issues?: HandoffIssue[] } {
  const error = typeof err === "string" ? translateDbError(err) : err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba.";
  return { ok: false, error, ...(code ? { code } : {}), ...(issues ? { issues } : {}) };
}

function revalidateHandoff(jobId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${jobId}`);
  revalidatePath("/purchasing");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

/** Předvyplněný plán dialogu (jen čtení). Bez práva na marže žádné ceny. */
export async function prepareProductionHandoff(
  jobId: string,
  opts: { kind?: HandoffKind; operationId?: string; existingPurchaseOrderId?: string; target?: JobStage } = {},
): Promise<ActionResult<{ plan: HandoffPlan; code?: HandoffErrorCode }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail("Zakázka nenalezena.");
  if (opts?.kind !== undefined && !HANDOFF_KINDS.includes(opts.kind)) return fail("Neznámý druh předání.");
  if (opts?.operationId !== undefined && !isUuid(opts.operationId)) return fail("Krok nenalezen.");
  if (opts?.existingPurchaseOrderId !== undefined && !isUuid(opts.existingPurchaseOrderId)) return fail("Objednávka nenalezena.");
  if (opts?.target !== undefined && !isJobStage(opts.target)) return fail("Neplatný cílový stav.");
  try {
    const ctx = await loadHandoffContext(c.db, jobId);
    if (!ctx) return fail("Zakázka nenalezena.");
    if (!opts.kind || opts.kind === "predani") {
      const derived = deriveHandoffKind(ctx.job.status, ctx.ops);
      if ("error" in derived) return fail(derived.error, derived.code);
    }
    const [mode, box] = await Promise.all([purchaseOrderMode(c.db), c.actor.margins ? usableMailbox(c.db, c.user.id) : Promise.resolve(null)]);
    const plan = buildHandoffPlan(ctx, {
      ...opts, margins: c.actor.margins, mailAll: c.actor.mailAll, actorId: c.user.id, automationMode: mode, senderEmail: box?.email ?? null,
    });
    return { ok: true, plan };
  } catch (err) {
    return fail(err);
  }
}

/** Předání (všechny druhy) — jedno volání RPC, potom PDF objednávek a odeslání podle režimu. */
export async function submitProductionHandoff(
  jobId: string,
  input: HandoffInput,
): Promise<ActionResult<{ result: HandoffResult; code?: HandoffErrorCode; issues?: HandoffIssue[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail("Zakázka nenalezena.");
  try {
    const res = await productionHandoffCore(c.db, c.actor, jobId, input, { source: "ui" });
    if (!res.ok) return fail(res.error, res.code, res.issues);
    revalidateHandoff(jobId);
    return { ok: true, result: res.result };
  } catch (err) {
    return fail(err);
  }
}

/** Doplní chybějící PDF a řádky fronty předání („Zkusit znovu"). Nikdy neodesílá. */
export async function ensureHandoffDocuments(jobId: string, handoffId: string): Promise<ActionResult<{ purchaseOrders: HandoffResult["purchaseOrders"] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId) || !isUuid(handoffId)) return fail("Předání nenalezeno.");
  try {
    const purchaseOrders = await ensureHandoffDocumentsCore(c.db, c.actor, jobId, handoffId);
    revalidateHandoff(jobId);
    return { ok: true, purchaseOrders };
  } catch (err) {
    return fail(err);
  }
}

/** Zrušenou objednávku kroku vystavit znovu (obchodník / admin): plán s „Objednat hned". */
export async function reissueStepPurchaseOrder(operationId: string): Promise<ActionResult<{ purchaseOrderId: string; number: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!c.actor.margins) return fail("Objednávku dodavateli vystaví znovu obchodník nebo admin.", "FORBIDDEN");
  if (!isUuid(operationId)) return fail("Krok nenalezen.");
  try {
    const { data } = await c.db.from("job_operations").select("id, job_id").eq("id", operationId).maybeSingle();
    const row = data as { id: string; job_id: string } | null;
    if (!row) return fail("Krok nenalezen.");
    const ctx = await loadHandoffContext(c.db, row.job_id);
    if (!ctx) return fail("Zakázka nenalezena.");
    const op = ctx.ops.find((o) => o.id === operationId);
    if (!op) return fail("Krok nenalezen.");
    if (op.purchaseOrder && op.purchaseOrder.status !== "zrusena") return fail(`Krok už má objednávku ${op.purchaseOrder.number ?? ""}.`.replace(" .", "."));
    if (op.status === "hotovo" || op.status === "preskoceno") return fail("Hotový nebo přeskočený krok se znovu neobjednává.");
    const who = op.inHouse ? null : op.supplier ? { type: "supplier" as const, id: op.supplier.id, name: op.supplier.name } : op.supplierName ? { type: "free" as const, name: op.supplierName } : null;
    if (!who) return fail("Krok nemá dodavatele — vyber, kdo to dělá.");
    const input: HandoffInput = {
      token: crypto.randomUUID(), kind: "plan", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
      steps: [{
        operationId: op.id, kind: op.kind, who, plannedEnd: op.plannedEnd, endsAtCustomerDate: Boolean(op.endsAtCustomerDate),
        deadlineAgreed: op.deadlineState === "dohodnuto", deadlineSource: op.deadlineSource ?? "rucne", whoSource: op.whoSource ?? "rucne",
        supplierQuoteId: op.supplierQuoteId ?? null, orderItemIds: op.orderItemIds ?? null, po: { mode: "vystavit", orderNow: true },
      }],
    };
    if (op.status !== "ceka") {
      // běžící krok: doplnění objednávky (jen kdo / termín / objednávka, nikdy stav)
      input.kind = "doplneni";
    }
    // zrušená objednávka nesmí zůstat navázaná (RPC by ji nechala) — nejdřív odpojit
    if (op.purchaseOrderId) {
      await c.db.from("job_operations").update({ purchase_order_id: null } as never).eq("id", op.id);
      const fresh = await loadHandoffContext(c.db, row.job_id);
      if (fresh) input.expectedRouteVersion = fresh.routeVersion;
    }
    const res = await productionHandoffCore(c.db, c.actor, row.job_id, input, { source: "ui" });
    if (!res.ok) return fail(res.error, res.code, res.issues);
    const po = res.result.purchaseOrders[0];
    if (!po) return fail("Objednávku se nepodařilo vystavit.");
    revalidateHandoff(row.job_id);
    return { ok: true, purchaseOrderId: po.id, number: po.number };
  } catch (err) {
    return fail(err);
  }
}

/** „Odeslat" objednávku kroku (obchodník / admin): zabere řádek fronty a odešle; při chybě ho vrátí. */
export async function sendStepPurchaseOrder(purchaseOrderId: string, mail?: Partial<PurchaseOrderMail>): Promise<ActionResult<{ sent: boolean; emailId?: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!c.actor.margins) return fail("Objednávku dodavateli odešle obchodník nebo admin.", "FORBIDDEN");
  if (!isUuid(purchaseOrderId)) return fail("Objednávka nenalezena.");
  if (mail !== undefined && (mail === null || typeof mail !== "object")) return fail("Neplatný e-mail.");
  try {
    const { data } = await c.db.from("purchase_orders").select("id, job_id, created_by, job:orders!job_id(owner_id)").eq("id", purchaseOrderId).maybeSingle();
    const po = data as { id: string; job_id: string; created_by: string | null; job?: { owner_id: string | null } | { owner_id: string | null }[] | null } | null;
    if (!po) return fail("Objednávka nenalezena.");
    // cizí objednávku (zakázka jiného obchodníka) posílá jen super admin — stejně jako ve frontě (mayResolve)
    if (!c.can("dashboard")) {
      const owner = (Array.isArray(po.job) ? po.job[0] : po.job)?.owner_id ?? null;
      const { data: q } = await c.db.from("approval_queue").select("owner_id").eq("purchase_order_id", po.id).eq("status", "pending");
      const rowOwners = ((q ?? []) as { owner_id: string | null }[]).map((r) => r.owner_id);
      if (owner !== c.user.id && po.created_by !== c.user.id && !rowOwners.includes(c.user.id)) {
        return fail("Objednávku k cizí zakázce odešle její obchodník nebo admin.", "FORBIDDEN");
      }
    }
    const res = await sendQueuedPurchaseOrder(c.db, { id: c.user.id, fullName: c.user.fullName, mailAll: c.actor.mailAll }, purchaseOrderId, {
      mail: mail ? { to: mail.to, cc: mail.cc, subject: mail.subject, body: mail.body } : undefined,
    });
    if (!res.ok) return fail(res.error);
    revalidateHandoff(po.job_id);
    revalidatePath("/sent");
    return { ok: true, sent: true, ...(res.emailId ? { emailId: res.emailId } : {}) };
  } catch (err) {
    return fail(err);
  }
}
