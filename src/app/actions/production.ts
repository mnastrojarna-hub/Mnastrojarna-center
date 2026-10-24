"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanMoney, cleanText, isUuid, stageEventMessage, todayIso, translateDbError } from "@/lib/jobs/mapping";
import { isOperationKind, isOperationStatus, nextOperationStatus, type OperationKind, type OperationStatus } from "@/lib/jobs/operations";
import {
  CUSTOMER_NOTE_MAX, OPERATION_SELECT, addedEventMessage, appendNote, canDeleteOwnOperation, czDay, describeOperationChanges,
  diffOperation, expandTemplate, insertPositions, moveOperation, nextToAutoStart, operationDisplayName,
  operationInputToRow, operationKindOf, operationLabel, operationLocation, positionUpdates, rowToJobOperation, sortOperations,
  statusEventMessage, templateLabel, updateEventMessage, validateOperationInput, validateOperationList, validateReorder,
  whoRefFromRow, type JobOperationDbRow,
} from "@/lib/jobs/production";
import type { JobOperationInput } from "@/lib/jobs/production-types";
import { confirmDeliveryNoteCore, setInvoiceInfoCore } from "@/lib/jobs/production-store";
import {
  checkStepPurchaseOrderChange, replaceStepSupplierCore, syncStepPurchaseOrder, type HandoffActor,
} from "@/lib/jobs/production-handoff-store";
import type { StepWho } from "@/lib/jobs/production-handoff-types";
import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Výroba zakázky: podrobný postup (operace v pořadí, kdo je dělá, stav, termín,
 * poznámka) a konec toku — domluvy se zákazníkem, potvrzený dodací list, faktura
 * se splatností a úhrada. Souhrn „kde se zakázka nachází" (orders.production_*)
 * i přechod do „Ve výrobě" / „Dokončeno" dělají DB triggery; akce jen zapisují
 * a každou změnu zapíšou do historie zakázky (bez částek).
 */

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  can: (feature: Feature) => boolean;
}

type Row = Record<string, unknown>;

const NOT_FOUND = "Zakázka nenalezena.";
const OP_NOT_FOUND = "Operace nenalezena.";

async function begin(feature: Feature = "orders"): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user, can };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function revalidateProduction(jobId: string, money = false) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${jobId}`);
  revalidatePath("/");
  if (money) {
    revalidatePath("/commissions");
    revalidatePath("/documents");
  }
}

async function loadJob(db: JobsDb, id: string, columns: string): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[production] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function loadOperation(db: JobsDb, id: string): Promise<JobOperationDbRow | null> {
  const { data, error } = await db.from("job_operations").select(OPERATION_SELECT).eq("id", id).maybeSingle();
  if (error) console.error(`[production] Načtení operace selhalo: ${error.message}`);
  return (data as unknown as JobOperationDbRow | null) ?? null;
}

async function loadJobOperations(db: JobsDb, jobId: string): Promise<JobOperationDbRow[]> {
  const { data, error } = await db
    .from("job_operations")
    .select(OPERATION_SELECT)
    .eq("job_id", jobId)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return sortOperations((data ?? []) as unknown as JobOperationDbRow[]);
}

async function supplierNames(db: JobsDb, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data, error } = await db.from("suppliers").select("id, name").in("id", ids);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { id: string; name: string }[]) out.set(r.id, r.name);
  return out;
}

/** Objednávky vydané musí patřit k zakázce. */
async function purchaseOrdersOk(db: JobsDb, jobId: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { data } = await db.from("purchase_orders").select("id").eq("job_id", jobId).in("id", ids);
  return ((data ?? []) as { id: string }[]).length === ids.length;
}

function nameOf(row: JobOperationDbRow): string {
  return operationDisplayName(rowToJobOperation(row));
}

/** Název operace ze sloupců (před zápisem do DB). */
function nameFromColumns(r: Row, names: Map<string, string>): string {
  const kind = operationKindOf(r.kind);
  const sup = isUuid(r.supplier_id) ? names.get(r.supplier_id) : null;
  return operationDisplayName({
    label: operationLabel(kind, r.title as string | null | undefined),
    location: operationLocation({
      inHouse: Boolean(r.in_house),
      supplier: sup ? { name: sup } : null,
      supplierName: (r.supplier_name as string | null | undefined) ?? null,
    }),
  });
}

/**
 * Zakázka je dodaná jen částečně (po položkách nebo poznámkou bez položek) — faktura ani potvrzený
 * DL pak stav neposouvají (M5); na Dodáno zákazníkovi ji posune až úplné dodání (DB).
 */
async function partiallyDelivered(db: JobsDb, jobId: string): Promise<boolean> {
  const j = await loadJob(db, jobId, "id, status, items_count, items_delivered, items_partial, partial_delivery_at");
  if (!j) return false;
  const count = Number(j.items_count) || 0;
  const delivered = Number(j.items_delivered) || 0;
  const partial = Number(j.items_partial) || 0;
  if (count > 0) return (delivered > 0 || partial > 0) && delivered < count;
  const late = ["dodano_zakaznikovi", "fakturovano", "dokonceno"].includes(String(j.status));
  return Boolean(j.partial_delivery_at) && !late;
}

async function jobStage(db: JobsDb, jobId: string): Promise<JobStage | null> {
  const j = await loadJob(db, jobId, "id, status");
  return j && isJobStage(j.status) ? j.status : null;
}

function logStage(c: Ctx, jobId: string, from: JobStage | null, to: JobStage, note: string | null, extra: Row = {}) {
  return logJobEvent(c.db, {
    jobId, type: "stage", message: stageEventMessage(from, to, note),
    data: { from, to, ...(note ? { note } : {}), ...extra }, actorId: c.user.id,
  });
}

/** Trigger mohl posunout zakázku do „Ve výrobě" — zapsat do historie. */
async function logAutoStage(c: Ctx, jobId: string, before: JobStage | null): Promise<void> {
  const after = await jobStage(c.db, jobId);
  if (after && before && after !== before) await logStage(c, jobId, before, after, "výroba začala", { auto: true });
}

function handoffActor(c: Ctx): HandoffActor {
  return { id: c.user.id, fullName: c.user.fullName, margins: c.can("margins"), mailAll: c.can("mail_all"), via: "rucne" };
}

/**
 * Konečný termín (zákazník) smí mít jen poslední nepřeskočený krok: po přesunu / vložení za konečný
 * krok se mu příznak odebere (termín zůstává jako mezitermín) a zapíše se to do historie.
 */
async function demoteFinalIfNotLast(c: Ctx, jobId: string): Promise<void> {
  const ops = (await loadJobOperations(c.db, jobId)).filter((o) => o.status !== "preskoceno");
  const fin = ops.find((o) => o.ends_at_customer_date);
  if (!fin || ops[ops.length - 1]?.id === fin.id) return;
  const { error } = await c.db.from("job_operations").update({ ends_at_customer_date: false } as never).eq("id", fin.id);
  if (error) { console.error(`[production] Konečný termín se nepodařilo přesunout: ${error.message}`); return; }
  await logJobEvent(c.db, {
    jobId, type: "field",
    message: `Výroba: ${nameOf(fin)} už není poslední krok — konečný termín (zákazník) patří poslednímu kroku`,
    data: { production: "updated", operationId: fin.id, fields: ["ends_at_customer_date"] }, actorId: c.user.id,
    entity: "operation", entityId: fin.id,
  });
}

interface StepPo { id: string; number: string | null; status: PurchaseOrderStatus }

async function linkedPurchaseOrder(db: JobsDb, poId: string): Promise<(StepPo & { supplier_id: string | null }) | null> {
  const { data } = await db.from("purchase_orders").select("id, number, status, supplier_id").eq("id", poId).maybeSingle();
  return (data as (StepPo & { supplier_id: string | null }) | null) ?? null;
}

function isUnsent(s: PurchaseOrderStatus): boolean {
  return s === "navrh" || s === "vystavena";
}

/** Objednávka kroku + zda ji sdílí jiný nepřeskočený krok. */
async function stepPurchaseOrder(db: JobsDb, op: JobOperationDbRow): Promise<{ po: StepPo; shared: boolean } | null> {
  if (!op.purchase_order_id) return null;
  const { data } = await db.from("purchase_orders").select("id, number, status").eq("id", op.purchase_order_id).maybeSingle();
  const po = data as StepPo | null;
  if (!po || po.status === "zrusena" || po.status === "dodana") return null;
  const { data: others } = await db.from("job_operations").select("id, status").eq("purchase_order_id", po.id).neq("id", op.id);
  const shared = ((others ?? []) as { status: string }[]).some((o) => o.status !== "preskoceno");
  return { po, shared };
}

async function cancelStepPurchaseOrder(c: Ctx, jobId: string, po: StepPo, reason: string): Promise<string | null> {
  const { error } = await c.db.from("purchase_orders").update({ status: "zrusena", cancel_reason: reason } as never).eq("id", po.id).in("status", ["navrh", "vystavena"]);
  if (error) return error.message;
  await logJobEvent(c.db, {
    jobId, type: "field", message: `Objednávka ${po.number ?? ""} zrušena — ${reason}`.replace("  ", " "),
    data: { purchaseOrderId: po.id, reason, statusFrom: po.status, statusTo: "zrusena" }, actorId: c.user.id, entity: "purchase_order", entityId: po.id,
  });
  return null;
}

async function applyPositions(db: JobsDb, updates: { id: string; position: number }[]): Promise<string | null> {
  const res = await Promise.all(
    updates.map((u) => db.from("job_operations").update({ position: u.position } as never).eq("id", u.id)),
  );
  return res.find((r) => r.error)?.error?.message ?? null;
}

// ── Přidání operací ─────────────────────────────────────────
async function insertOperations(
  c: Ctx,
  jobId: string,
  ops: JobOperationInput[],
  at: number | null | undefined,
  event: { prefix?: string; extra?: Row } = {},
): Promise<{ ids: string[] } | { error: string }> {
  const job = await loadJob(c.db, jobId, "id, status");
  if (!job) return { error: NOT_FOUND };
  const before = isJobStage(job.status) ? job.status : null;

  const rows = ops.map((op) => operationInputToRow(op));
  const supIds = [...new Set(rows.map((r) => r.supplier_id).filter(isUuid))];
  const names = await supplierNames(c.db, supIds);
  if (names.size !== supIds.length) return { error: "Dodavatel nenalezen." };
  const poIds = [...new Set(rows.map((r) => r.purchase_order_id).filter(isUuid))];
  if (!(await purchaseOrdersOk(c.db, jobId, poIds))) return { error: "Objednávka nepatří k této zakázce." };

  const existing = await loadJobOperations(c.db, jobId);
  const { positions, shifts } = insertPositions(existing, rows.length, at);
  if (shifts.length) {
    const err = await applyPositions(c.db, shifts);
    if (err) return { error: err };
  }
  const insert = rows.map((r, i) => ({ ...r, job_id: jobId, position: positions[i], created_by: c.user.id }));
  const { data, error } = await c.db.from("job_operations").insert(insert as never).select("id, position");
  if (error || !data) return { error: error?.message ?? "Operace se nepodařilo uložit." };
  const created = (data as { id: string; position: number }[]).slice().sort((a, b) => a.position - b.position);
  const ids = created.map((r) => r.id);

  await logJobEvent(c.db, {
    jobId, type: "field",
    message: addedEventMessage(rows.map((r) => nameFromColumns(r, names)), event.prefix),
    data: {
      production: "added",
      operations: rows.map((r, i) => ({ id: ids[i] ?? null, kind: r.kind, position: positions[i] })),
      ...(event.extra ?? {}),
    },
    actorId: c.user.id,
  });
  await demoteFinalIfNotLast(c, jobId);
  await logAutoStage(c, jobId, before);
  return { ids };
}

/** Přidá operace na konec postupu (nebo na pozici `atPosition`, ostatní se posunou). */
export async function addJobOperations(
  jobId: string,
  ops: JobOperationInput[],
  opts: { atPosition?: number } = {},
): Promise<ActionResult<{ ids: string[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const bad = validateOperationList(ops);
  if (bad) return fail(bad);
  const at = opts?.atPosition;
  if (at !== undefined && (typeof at !== "number" || !Number.isFinite(at) || at < 0)) return fail("Neplatná pozice operace.");
  try {
    const res = await insertOperations(c, jobId, ops, at);
    if ("error" in res) return fail(res.error);
    revalidateProduction(jobId);
    return { ok: true, ids: res.ids };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Postup ze šablony (připojí se na konec). `supplierByKind`: pro druh operace
 * id dodavatele, „u_nas", nebo název firmy mimo adresář.
 */
export async function applyOperationTemplate(
  jobId: string,
  templateKey: string,
  /** Dodavatel podle druhu kroku, nebo po krocích šablony `{ byIndex: [...] }` (stejný druh dvakrát, D.8). */
  supplierByKind?: Partial<Record<OperationKind, string>> | { byIndex: (string | null)[] },
): Promise<ActionResult<{ ids: string[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (supplierByKind !== undefined && supplierByKind !== null) {
    if (typeof supplierByKind !== "object" || Array.isArray(supplierByKind)) return fail("Neplatný výběr dodavatelů.");
    if ("byIndex" in supplierByKind) {
      const list = (supplierByKind as { byIndex: unknown }).byIndex;
      if (!Array.isArray(list) || list.length > 20 || Object.keys(supplierByKind).length !== 1) return fail("Neplatný výběr dodavatelů.");
      if (list.some((v) => v !== undefined && v !== null && (typeof v !== "string" || v.length > 300))) return fail("Neplatný dodavatel.");
    } else {
      for (const [k, v] of Object.entries(supplierByKind)) {
        if (!isOperationKind(k)) return fail("Neznámý druh operace.");
        if (v !== undefined && v !== null && typeof v !== "string") return fail("Neplatný dodavatel.");
      }
    }
  }
  const ops = typeof templateKey === "string" ? expandTemplate(templateKey, supplierByKind) : null;
  if (!ops) return fail("Neznámá šablona postupu.");
  try {
    const res = await insertOperations(c, jobId, ops, null, {
      prefix: `Postup výroby ze šablony „${templateLabel(templateKey)}"`,
      extra: { template: templateKey },
    });
    if ("error" in res) return fail(res.error);
    revalidateProduction(jobId);
    return { ok: true, ids: res.ids };
  } catch (err) {
    return fail(err);
  }
}

// ── Úprava a stav ───────────────────────────────────────────
export async function updateJobOperation(
  id: string,
  patch: Partial<JobOperationInput>,
  opts: { confirmReplace?: boolean; notifySupplier?: boolean } = {},
): Promise<ActionResult<{ hint: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  const invalid = validateOperationInput(patch, true);
  if (invalid) return fail(invalid);
  try {
    const before = await loadOperation(c.db, id);
    if (!before) return fail(OP_NOT_FOUND);
    const row = operationInputToRow(patch, true);
    const start = cleanDate("planned_start" in row ? row.planned_start : before.planned_start);
    const end = cleanDate("planned_end" in row ? row.planned_end : before.planned_end);
    if (start && end && start > end) return fail("Začátek operace je po jejím termínu.");

    const changed = diffOperation(before as unknown as Row, row);
    // „Termín mám dohodnutý s {Firma}" → stav termínu (určuje server; u nás = plán dílny)
    const stateRow: Row = {};
    if (patch.deadlineAgreed !== undefined) {
      const inHouse = "in_house" in changed ? Boolean(changed.in_house) : Boolean(before.in_house);
      const cur = before.deadline_state ?? null;
      if (patch.deadlineAgreed && !inHouse && cur !== "dohodnuto") stateRow.deadline_state = "dohodnuto";
      else if (!patch.deadlineAgreed && cur === "dohodnuto") stateRow.deadline_state = inHouse ? "plan" : "odhad";
    }
    if (!Object.keys(changed).length && !Object.keys(stateRow).length) return { ok: true };

    const names = isUuid(changed.supplier_id) ? await supplierNames(c.db, [changed.supplier_id]) : new Map<string, string>();
    if (isUuid(changed.supplier_id) && !names.size) return fail("Dodavatel nenalezen.");
    if (isUuid(changed.purchase_order_id) && !(await purchaseOrdersOk(c.db, before.job_id, [changed.purchase_order_id]))) {
      return fail("Objednávka nepatří k této zakázce.");
    }
    let whoChanged = "in_house" in changed || "supplier_id" in changed || "supplier_name" in changed;
    let deadlineChanged = "planned_end" in changed;
    const poChanged = "purchase_order_id" in changed;
    let hint: string | undefined;
    let cancelAfter: StepPo | null = null;
    const curPo = before.purchase_order_id ? await linkedPurchaseOrder(c.db, before.purchase_order_id) : null;
    const activePo = curPo && curPo.status !== "zrusena" ? curPo : null;
    if (poChanged) {
      // odpojit / vyměnit objednávku kroku jen obchodník / admin (jinak by šel obejít zákaz změny dodavatele)
      if (activePo && !c.can("margins")) return fail(`Krok má objednávku ${activePo.number ?? ""} — objednávku kroku změní obchodník nebo admin.`.replace("  ", " "));
      const nextPoId = isUuid(changed.purchase_order_id) ? changed.purchase_order_id : null;
      if (nextPoId) {
        const next = await linkedPurchaseOrder(c.db, nextPoId);
        const inHouseAfter = "in_house" in changed ? Boolean(changed.in_house) : Boolean(before.in_house);
        const supplierAfter = "supplier_id" in changed ? (changed.supplier_id as string | null) : before.supplier_id;
        if (!next || next.status === "zrusena") return fail("Zrušenou objednávku nelze ke kroku přiřadit.");
        if (inHouseAfter || !supplierAfter || next.supplier_id !== supplierAfter) {
          return fail(`Objednávka ${next.number ?? ""} je u jiného dodavatele než krok — nejdřív změň, kdo krok dělá.`.replace("  ", " "));
        }
      }
      if (activePo && activePo.id !== nextPoId) {
        const { data: others } = await c.db.from("job_operations").select("id, status").eq("purchase_order_id", activePo.id).neq("id", id);
        const shared = ((others ?? []) as { status: string }[]).some((o) => o.status !== "preskoceno");
        if (!shared && activePo.status === "dodana") return fail(`Objednávka ${activePo.number ?? ""} je dodaná — od kroku se neodpojuje.`.replace("  ", " "));
        if (!shared && !isUnsent(activePo.status)) {
          return fail(`Krok má odeslanou objednávku ${activePo.number ?? ""} — nejdřív ji zruš v Nákupu, nebo změň dodavatele kroku.`.replace("  ", " "));
        }
        if (!shared) cancelAfter = activePo;   // nevyslaná objednávka bez kroku by zůstala ve frontě → zrušit
      }
    } else if (activePo && whoChanged) {
      // krok s objednávkou: jiného dodavatele smí jen obchodník / admin (u odeslané s potvrzením nahrazení)
      const block = await checkStepPurchaseOrderChange(c.db, handoffActor(c), id, { who: true, confirmReplace: opts.confirmReplace });
      if (block) return fail(block);
      if (!isUnsent(activePo.status) && opts.confirmReplace) {
        // odeslaná: nový dodavatel + nová objednávka atomicky (RPC), storno staré až po potvrzení — krok se tu nepíše
        const inHouse = "in_house" in changed ? Boolean(changed.in_house) : Boolean(before.in_house);
        const supplierId = "supplier_id" in changed ? (changed.supplier_id as string | null) : before.supplier_id;
        const supplierName = cleanText("supplier_name" in changed ? changed.supplier_name : before.supplier_name, 300);
        const who: StepWho = inHouse ? { type: "u_nas" } : isUuid(supplierId) ? { type: "supplier", id: supplierId } : supplierName ? { type: "free", name: supplierName } : { type: "none" };
        const res = await replaceStepSupplierCore(c.db, handoffActor(c), id, { who, ...(deadlineChanged ? { plannedEnd: cleanDate(changed.planned_end) } : {}) }, opts.notifySupplier ?? true);
        if (!res.ok) return fail(res.error);
        hint = res.hint;
        for (const k of ["in_house", "supplier_id", "supplier_name", "planned_end"]) delete changed[k];
        whoChanged = false;
        deadlineChanged = false;
        if (!Object.keys(changed).length && !Object.keys(stateRow).length) {
          revalidatePath("/purchasing");
          revalidateProduction(before.job_id);
          return { ok: true, ...(hint ? { hint } : {}) };
        }
      }
    }
    const stageBefore = "status" in changed ? await jobStage(c.db, before.job_id) : null;

    const { error } = await c.db.from("job_operations").update({ ...changed, ...stateRow } as never).eq("id", id);
    if (error) return fail(error.message);
    // krok s objednávkou: dodavatel / termín se propíše do objednávky (E.5); když to nejde, krok se vrátí
    if (activePo && !poChanged && (whoChanged || deadlineChanged)) {
      const sync = await syncStepPurchaseOrder(c.db, handoffActor(c), id, {
        who: whoChanged, deadline: deadlineChanged, confirmReplace: opts.confirmReplace, notifySupplier: opts.notifySupplier,
        previousEnd: before.planned_end,
      });
      revalidatePath("/purchasing");
      if (!sync.ok) {
        const revert: Row = {};
        for (const k of Object.keys(changed)) revert[k] = (before as unknown as Row)[k] ?? null;
        await c.db.from("job_operations").update(revert as never).eq("id", id);
        return fail(`Objednávku se nepodařilo upravit: ${sync.error} — krok zůstal beze změny.`);
      }
      hint = [hint, sync.hint].filter(Boolean).join(" ") || undefined;
    }
    if (cancelAfter) {
      const err = await cancelStepPurchaseOrder(c, before.job_id, cancelAfter, "Objednávka odpojena od kroku výroby");
      hint = [hint, err ? `Objednávku ${cancelAfter.number ?? ""} se nepodařilo zrušit: ${err}` : `Objednávka ${cancelAfter.number ?? ""} zrušena (odpojena od kroku).`].filter(Boolean).join(" ");
      revalidatePath("/purchasing");
    }
    if (!Object.keys(changed).length) {
      await logJobEvent(c.db, {
        jobId: before.job_id, type: "field",
        message: `Výroba: ${nameOf(before)} — termín ${stateRow.deadline_state === "dohodnuto" ? "dohodnutý" : "zatím nedohodnutý"}`,
        data: { production: "updated", operationId: id, fields: ["deadline_state"] }, actorId: c.user.id,
      });
      revalidateProduction(before.job_id);
      return { ok: true, ...(hint ? { hint } : {}) };
    }

    const after = rowToJobOperation({
      ...before,
      ...(changed as Partial<JobOperationDbRow>),
      supplier: whoChanged
        ? (isUuid(changed.supplier_id) ? { id: changed.supplier_id, name: names.get(changed.supplier_id) ?? "" } : null)
        : before.supplier,
    });
    const name = nameOf(before);
    const keys = Object.keys(changed);
    const message = keys.length === 1 && keys[0] === "status"
      ? statusEventMessage(name, after.status)
      : updateEventMessage(name, describeOperationChanges(changed, after.location));
    await logJobEvent(c.db, {
      jobId: before.job_id, type: "field", message,
      data: { production: "updated", operationId: id, fields: keys }, actorId: c.user.id,
    });
    if ("status" in changed) await logAutoStage(c, before.job_id, stageBefore);
    if ("ends_at_customer_date" in changed || "status" in changed) await demoteFinalIfNotLast(c, before.job_id);
    revalidateProduction(before.job_id);
    return { ok: true, ...(hint ? { hint } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Stav jedním klepnutím (výběr ze seznamu). `note` se připíše k poznámce operace
 * s časem a jménem. Na rozdíl od advanceJobOperation nic dalšího nespouští.
 */
export async function setJobOperationStatus(
  id: string,
  status: OperationStatus,
  note?: string,
): Promise<ActionResult<{ status: OperationStatus; hint: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  if (!isOperationStatus(status)) return fail("Neznámý stav operace.");
  if (note !== undefined && note !== null && typeof note !== "string") return fail("Neplatná poznámka.");
  const text = cleanText(note, 2000);
  try {
    const before = await loadOperation(c.db, id);
    if (!before) return fail(OP_NOT_FOUND);
    if (before.status === status && !text) return { ok: true, status };
    // přeskočení kroku s vlastní objednávkou (E.5): nevyslanou zruší obchodník / admin, odeslanou nikdo bez práva
    let hint: string | undefined;
    let cancelPo: StepPo | null = null;
    if (status === "preskoceno" && before.status !== "preskoceno") {
      const sp = await stepPurchaseOrder(c.db, before);
      if (sp && !sp.shared) {
        const sent = !isUnsent(sp.po.status);
        if (sent && !c.can("margins")) return fail(`Krok má odeslanou objednávku ${sp.po.number ?? ""} — přeskočení udělá obchodník nebo admin.`);
        if (sent) hint = `Objednávka ${sp.po.number ?? ""} už odešla dodavateli — stornuj ji u dodavatele (Nákup).`;
        else if (c.can("margins")) cancelPo = sp.po;
        else hint = `Objednávka ${sp.po.number ?? ""} zůstává vystavená — zruší ji obchodník nebo admin.`;
      }
    }
    const stageBefore = await jobStage(c.db, before.job_id);
    const update: Row = { status };
    if (text) update.note = appendNote(before.note, text, c.user.fullName);
    const { error } = await c.db.from("job_operations").update(update as never).eq("id", id);
    if (error) return fail(error.message);

    const name = nameOf(before);
    await logJobEvent(c.db, {
      jobId: before.job_id, type: "field",
      message: before.status === status ? `Výroba: ${name} — poznámka: ${text}` : statusEventMessage(name, status, text),
      data: { production: "status", operationId: id, from: before.status, to: status, ...(text ? { note: text } : {}) },
      actorId: c.user.id,
    });
    if (cancelPo) {
      const err = await cancelStepPurchaseOrder(c, before.job_id, cancelPo, "Krok výroby přeskočen");
      hint = err ? `Objednávku ${cancelPo.number ?? ""} se nepodařilo zrušit: ${err}` : `Objednávka ${cancelPo.number ?? ""} zrušena (krok přeskočen).`;
    }
    await logAutoStage(c, before.job_id, stageBefore);
    revalidateProduction(before.job_id);
    return { ok: true, status, ...(hint ? { hint } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Hlavní tlačítko operace: čeká → probíhá → hotovo. Po „hotovo" se další čekající
 * operace rozběhne sama, jen když ji děláme u nás nebo ji dělá stejná firma.
 */
export async function advanceJobOperation(id: string): Promise<ActionResult<{ status: OperationStatus; nextId: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  try {
    const before = await loadOperation(c.db, id);
    if (!before) return fail(OP_NOT_FOUND);
    const next = nextOperationStatus(before.status);
    if (!next) {
      return fail(before.status === "hotovo" ? "Operace je už hotová." : "Přeskočená operace se neposouvá — změň její stav.");
    }
    const stageBefore = await jobStage(c.db, before.job_id);
    // jen ze stavu, který uživatel viděl (dvojité klepnutí neposune o dva kroky)
    const { data, error } = await c.db
      .from("job_operations")
      .update({ status: next } as never)
      .eq("id", id)
      .eq("status", before.status)
      .select("id");
    if (error) return fail(error.message);
    if (!((data ?? []) as unknown[]).length) {
      const now = await loadOperation(c.db, id);
      return { ok: true, status: now ? now.status : next };
    }
    await logJobEvent(c.db, {
      jobId: before.job_id, type: "field", message: statusEventMessage(nameOf(before), next),
      data: { production: "status", operationId: id, from: before.status, to: next }, actorId: c.user.id,
    });

    let nextId: string | undefined;
    if (next === "hotovo") {
      const ops = await loadJobOperations(c.db, before.job_id);
      const candidate = nextToAutoStart(ops.map(whoRefFromRow), id);
      if (candidate) {
        const { data: started } = await c.db
          .from("job_operations")
          .update({ status: "probiha" } as never)
          .eq("id", candidate)
          .eq("status", "ceka")
          .select("id");
        if (((started ?? []) as unknown[]).length) {
          nextId = candidate;
          const row = ops.find((o) => o.id === candidate);
          await logJobEvent(c.db, {
            jobId: before.job_id, type: "field",
            message: statusEventMessage(row ? nameOf(row) : "další operace", "probiha", "navazuje automaticky"),
            data: { production: "status", operationId: candidate, from: "ceka", to: "probiha", auto: true }, actorId: c.user.id,
          });
        }
      }
    }
    await logAutoStage(c, before.job_id, stageBefore);
    revalidateProduction(before.job_id);
    return { ok: true, status: next, ...(nextId ? { nextId } : {}) };
  } catch (err) {
    return fail(err);
  }
}

// ── Pořadí a mazání ─────────────────────────────────────────
export async function moveJobOperation(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  if (direction !== "up" && direction !== "down") return fail("Neplatný směr posunu.");
  try {
    const op = await loadOperation(c.db, id);
    if (!op) return fail(OP_NOT_FOUND);
    const ops = await loadJobOperations(c.db, op.job_id);
    const moved = moveOperation(ops.map((o) => o.id), op.id, direction);
    if (!moved) return { ok: true };
    const err = await applyPositions(c.db, positionUpdates(ops, moved));
    if (err) return fail(err);
    await logJobEvent(c.db, {
      jobId: op.job_id, type: "field",
      message: `Výroba: ${nameOf(op)} — posunuto ${direction === "up" ? "dřív" : "později"} v postupu`,
      data: { production: "reorder", operationId: id, direction }, actorId: c.user.id,
    });
    await demoteFinalIfNotLast(c, op.job_id);
    revalidateProduction(op.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Nové pořadí celého postupu (drag & drop) — musí obsahovat všechny operace zakázky. */
export async function reorderJobOperations(jobId: string, orderedIds: string[]): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const ops = await loadJobOperations(c.db, jobId);
    const ids = Array.isArray(orderedIds) ? orderedIds.map((x) => (typeof x === "string" ? x.toLowerCase() : x)) : orderedIds;
    const bad = validateReorder(ops.map((o) => o.id), ids);
    if (bad) return fail(bad);
    const updates = positionUpdates(ops, ids);
    if (!updates.length) return { ok: true };
    const err = await applyPositions(c.db, updates);
    if (err) return fail(err);
    const byId = new Map(ops.map((o) => [o.id, rowToJobOperation(o).label]));
    const labels = ids.map((x) => byId.get(x) ?? "—");
    await logJobEvent(c.db, {
      jobId, type: "field",
      message: `Výroba: nové pořadí — ${labels.slice(0, 10).join(" → ")}${labels.length > 10 ? " …" : ""}`,
      data: { production: "reorder", order: ids }, actorId: c.user.id,
    });
    await demoteFinalIfNotLast(c, jobId);
    revalidateProduction(jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Smazat smí super admin (právo „delete"), ostatní jen vlastní operaci do 24 hodin. */
export async function deleteJobOperation(id: string): Promise<ActionResult<{ skipped: boolean; hint: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  try {
    const op = await loadOperation(c.db, id);
    if (!op) return fail(OP_NOT_FOUND);
    if (!c.can("delete") && !canDeleteOwnOperation(op, c.user.id)) {
      return fail("Smazat lze jen vlastní operaci do 24 hodin od založení — jinak ji označ jako přeskočenou.");
    }
    // krok s vlastní objednávkou (E.5): sdílená se jen odpojí (smazáním kroku); odeslaná brání smazání;
    // nevyslanou zruší obchodník / admin — ostatním se krok místo smazání přeskočí (objednávka zůstane)
    let hint: string | undefined;
    const sp = await stepPurchaseOrder(c.db, op);
    if (sp && !sp.shared) {
      if (!isUnsent(sp.po.status)) {
        return fail(`Krok má odeslanou objednávku ${sp.po.number ?? ""} — nejdřív ji zruš v Nákupu, nebo krok přeskoč.`);
      }
      if (!c.can("margins")) {
        const res = await setJobOperationStatus(id, "preskoceno", "Smazání kroku s objednávkou — přeskočeno");
        if (!res.ok) return fail(res.error ?? "Krok se nepodařilo přeskočit.");
        return { ok: true, skipped: true, hint: `Krok má objednávku ${sp.po.number ?? ""} — místo smazání je přeskočený (objednávku zruší obchodník nebo admin).` };
      }
      const err = await cancelStepPurchaseOrder(c, op.job_id, sp.po, "Krok výroby zrušen");
      if (err) return fail(err);
      hint = `Objednávka ${sp.po.number ?? ""} zrušena.`;
    }
    const { error } = await c.db.from("job_operations").delete().eq("id", id);
    if (error) return fail(error.message);
    const view = rowToJobOperation(op);
    await logJobEvent(c.db, {
      jobId: op.job_id, type: "field", message: `Výroba: operace ${operationDisplayName(view)} odstraněna`,
      data: { production: "deleted", operationId: id, kind: view.kind }, actorId: c.user.id,
    });
    await logAudit({
      action: "job_operation_deleted", entity: "job_operations", entityId: id,
      diff: { jobId: op.job_id, kind: view.kind, title: view.title, location: view.location, status: view.status },
    });
    revalidateProduction(op.job_id);
    return { ok: true, ...(hint ? { hint } : {}) };
  } catch (err) {
    return fail(err);
  }
}

// ── Domluvy se zákazníkem ───────────────────────────────────
export async function setCustomerNote(jobId: string, text: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (text !== null && text !== undefined && typeof text !== "string") return fail("Neplatný text.");
  if (typeof text === "string" && text.trim().length > CUSTOMER_NOTE_MAX) return fail("Poznámka je příliš dlouhá.");
  const note = cleanText(text, CUSTOMER_NOTE_MAX);
  try {
    const job = await loadJob(c.db, jobId, "id, customer_note");
    if (!job) return fail(NOT_FOUND);
    if ((cleanText(job.customer_note, CUSTOMER_NOTE_MAX) ?? null) === note) return { ok: true };
    const { error } = await c.db.from("orders").update({ customer_note: note } as never).eq("id", jobId);
    if (error) return fail(error.message);
    await logJobEvent(c.db, {
      jobId, type: "field", message: note ? "Domluvy se zákazníkem upraveny" : "Domluvy se zákazníkem smazány",
      data: { field: "customer_note", text: note ? note.slice(0, 2000) : null }, actorId: c.user.id,
    });
    revalidateProduction(jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── Konec toku: dodací list, faktura, úhrada ────────────────
/**
 * Zákazník vrátil potvrzený dodací list. `fileId` = nahraný sken / fotka
 * (job_files) — označí se jako „Potvrzený dodací list". Zakázka → Dodáno zákazníkovi.
 */
export async function confirmDeliveryNote(
  jobId: string,
  opts: { date?: string; fileId?: string } = {},
): Promise<ActionResult<{ stage: JobStage; date: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const partial = isUuid(jobId) && (await partiallyDelivered(c.db, jobId));
    const res = await confirmDeliveryNoteCore(c.db, c.user.id, jobId, { ...(opts ?? {}), ...(partial ? { stage: false } : {}) });
    if (!res.ok) return fail(res.error);
    revalidateProduction(jobId, true);
    return res;
  } catch (err) {
    return fail(err);
  }
}

/** Zrušení potvrzení dodacího listu (omyl). Stav zakázky se nemění. */
export async function unconfirmDeliveryNote(jobId: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, delivery_note_confirmed_at");
    if (!job) return fail(NOT_FOUND);
    if (!job.delivery_note_confirmed_at) return { ok: true };
    const { error } = await c.db.from("orders").update({ delivery_note_confirmed_at: null } as never).eq("id", jobId);
    if (error) return fail(error.message);
    await logJobEvent(c.db, {
      jobId, type: "field", message: "Potvrzení dodacího listu zrušeno",
      data: { production: "delivery_note", date: null }, actorId: c.user.id,
    });
    revalidateProduction(jobId, true);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Naše faktura: číslo, datum, splatnost. Bez zadané splatnosti = datum faktury
 * + splatnost zákazníka (jinak 14 dní). S číslem / datem faktury → Vyfakturováno
 * (už zaplacená zakázka rovnou Dokončeno), jen dopředu — při částečném dodání stav zůstává.
 */
export async function setInvoiceInfo(
  jobId: string,
  input: { invoiceNumber?: string | null; invoiceDate?: string | null; invoiceDueDate?: string | null },
): Promise<ActionResult<{ invoiceDate: string | null; invoiceDueDate: string | null; stage: JobStage }>> {
  const c = await begin("margins"); // faktura a úhrady = finance (obchodník, admin)
  if ("error" in c) return fail(c.error);
  try {
    const partial = isUuid(jobId) && (await partiallyDelivered(c.db, jobId));
    const res = await setInvoiceInfoCore(c.db, c.user.id, jobId, input, partial ? { stage: false } : {});
    if (!res.ok) return fail(res.error);
    if (res.changed) revalidateProduction(jobId, true);
    const { changed: _changed, ...out } = res;
    void _changed;
    return out;
  } catch (err) {
    return fail(err);
  }
}

/**
 * Zákazník zaplatil. Vyfakturovaná zakázka → Dokončeno (DB trigger). Částku
 * (paid_amount, prázdná = hodnota zakázky) smí zadat jen role s právem na marže.
 */
export async function markJobPaid(
  jobId: string,
  opts: { date?: string; amount?: number | null } = {},
): Promise<ActionResult<{ stage: JobStage; paidAt: string }>> {
  const c = await begin("margins"); // faktura a úhrady = finance (obchodník, admin)
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const rawDate = opts?.date;
  const date = rawDate === undefined || rawDate === null || rawDate === "" ? todayIso() : cleanDate(rawDate);
  if (!date) return fail("Neplatné datum úhrady (čekám RRRR-MM-DD).");
  const patch: Row = { paid_at: date };
  if (c.can("margins") && opts?.amount !== undefined) {
    const amount = opts.amount === null ? null : cleanMoney(opts.amount);
    if (opts.amount !== null && (amount === null || amount < 0)) return fail("Neplatná částka úhrady.");
    patch.paid_amount = amount;
  }
  try {
    const job = await loadJob(c.db, jobId, "id, status, paid_at");
    if (!job) return fail(NOT_FOUND);
    const from = isJobStage(job.status) ? job.status : null;
    const { data: after, error } = await c.db.from("orders").update(patch as never).eq("id", jobId).select("status").single();
    if (error || !after) return fail(error?.message ?? "Úhradu se nepodařilo uložit.");
    let stage = (after as { status: JobStage }).status;
    // už dřív zaplacená (trigger reaguje jen na první úhradu) → dokončit ručně
    if (stage === "fakturovano") {
      const { error: sErr } = await c.db.from("orders").update({ status: "dokonceno" } as never).eq("id", jobId);
      if (sErr) return fail(sErr.message);
      stage = "dokonceno";
    }
    const prev = cleanDate(job.paid_at);
    await logJobEvent(c.db, {
      jobId, type: "field",
      message: prev && prev !== date ? `Datum úhrady: ${czDay(prev)} → ${czDay(date)}` : `Zaplaceno ${czDay(date)}`,
      data: { production: "paid", paidAt: date }, actorId: c.user.id,
    });
    if (stage !== from) await logStage(c, jobId, from, stage, "zaplaceno");
    revalidateProduction(jobId, true);
    return { ok: true, stage, paidAt: date };
  } catch (err) {
    return fail(err);
  }
}

/** Zrušení úhrady (omyl) — jen s právem na marže. Dokončená zakázka se vrátí do Vyfakturováno. */
export async function unmarkJobPaid(jobId: string): Promise<ActionResult<{ stage: JobStage }>> {
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, status, paid_at");
    if (!job) return fail(NOT_FOUND);
    const from = isJobStage(job.status) ? job.status : null;
    if (!job.paid_at) return { ok: true, stage: from ?? "poptavka" };
    const patch: Row = { paid_at: null, paid_amount: null };
    if (from === "dokonceno") patch.status = "fakturovano";
    const { error } = await c.db.from("orders").update(patch as never).eq("id", jobId);
    if (error) return fail(error.message);
    await logJobEvent(c.db, {
      jobId, type: "field", message: "Úhrada zrušena",
      data: { production: "paid", paidAt: null }, actorId: c.user.id,
    });
    const stage: JobStage = from === "dokonceno" ? "fakturovano" : from ?? "poptavka";
    if (from === "dokonceno") await logStage(c, jobId, from, stage, "úhrada zrušena");
    revalidateProduction(jobId, true);
    return { ok: true, stage };
  } catch (err) {
    return fail(err);
  }
}
