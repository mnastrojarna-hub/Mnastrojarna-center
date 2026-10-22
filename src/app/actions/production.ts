"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isForward, isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanMoney, cleanText, isUuid, stageEventMessage, todayIso, translateDbError } from "@/lib/jobs/mapping";
import { isOperationKind, isOperationStatus, nextOperationStatus, type OperationKind, type OperationStatus } from "@/lib/jobs/operations";
import {
  CUSTOMER_NOTE_MAX, OPERATION_SELECT, addedEventMessage, appendNote, canDeleteOwnOperation, czDay, describeOperationChanges,
  diffOperation, dueDateFor, expandTemplate, insertPositions, moveOperation, nextToAutoStart, operationDisplayName,
  operationInputToRow, operationKindOf, operationLabel, operationLocation, positionUpdates, rowToJobOperation, sortOperations,
  statusEventMessage, templateLabel, updateEventMessage, validateOperationInput, validateOperationList, validateReorder,
  whoRefFromRow, type JobOperationDbRow,
} from "@/lib/jobs/production";
import type { JobOperationInput } from "@/lib/jobs/production-types";
import type { JobStage } from "@/lib/supabase/database.types";
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
  const db = await createOperatorClient();
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
  supplierByKind?: Partial<Record<OperationKind, string>>,
): Promise<ActionResult<{ ids: string[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (supplierByKind !== undefined && supplierByKind !== null) {
    if (typeof supplierByKind !== "object" || Array.isArray(supplierByKind)) return fail("Neplatný výběr dodavatelů.");
    for (const [k, v] of Object.entries(supplierByKind)) {
      if (!isOperationKind(k)) return fail("Neznámý druh operace.");
      if (v !== undefined && v !== null && typeof v !== "string") return fail("Neplatný dodavatel.");
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
export async function updateJobOperation(id: string, patch: Partial<JobOperationInput>): Promise<ActionResult> {
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
    if (!Object.keys(changed).length) return { ok: true };

    const names = isUuid(changed.supplier_id) ? await supplierNames(c.db, [changed.supplier_id]) : new Map<string, string>();
    if (isUuid(changed.supplier_id) && !names.size) return fail("Dodavatel nenalezen.");
    if (isUuid(changed.purchase_order_id) && !(await purchaseOrdersOk(c.db, before.job_id, [changed.purchase_order_id]))) {
      return fail("Objednávka nepatří k této zakázce.");
    }
    const stageBefore = "status" in changed ? await jobStage(c.db, before.job_id) : null;

    const { error } = await c.db.from("job_operations").update(changed as never).eq("id", id);
    if (error) return fail(error.message);

    const whoChanged = "in_house" in changed || "supplier_id" in changed || "supplier_name" in changed;
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
    revalidateProduction(before.job_id);
    return { ok: true };
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
): Promise<ActionResult<{ status: OperationStatus }>> {
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
    await logAutoStage(c, before.job_id, stageBefore);
    revalidateProduction(before.job_id);
    return { ok: true, status };
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
    revalidateProduction(jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Smazat smí super admin (právo „delete"), ostatní jen vlastní operaci do 24 hodin. */
export async function deleteJobOperation(id: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(OP_NOT_FOUND);
  try {
    const op = await loadOperation(c.db, id);
    if (!op) return fail(OP_NOT_FOUND);
    if (!c.can("delete") && !canDeleteOwnOperation(op, c.user.id)) {
      return fail("Smazat lze jen vlastní operaci do 24 hodin od založení — jinak ji označ jako přeskočenou.");
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
    return { ok: true };
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
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const rawDate = opts?.date;
  const date = rawDate === undefined || rawDate === null || rawDate === "" ? todayIso() : cleanDate(rawDate);
  if (!date) return fail("Neplatné datum (čekám RRRR-MM-DD).");
  const fileId = opts?.fileId || null;
  if (fileId !== null && !isUuid(fileId)) return fail("Dokument nenalezen.");
  try {
    const job = await loadJob(c.db, jobId, "id, status, delivery_note_confirmed_at");
    if (!job) return fail(NOT_FOUND);
    const from = isJobStage(job.status) ? job.status : null;

    if (fileId) {
      const { data: file } = await c.db.from("job_files").select("id, note").eq("id", fileId).eq("job_id", jobId).maybeSingle();
      if (!file) return fail("Dokument nepatří k této zakázce.");
      const line = `Potvrzeno zákazníkem ${czDay(date)}`;
      const prev = cleanText((file as { note: string | null }).note, 5000);
      const { error: fErr } = await c.db
        .from("job_files")
        .update({ title: "Potvrzený dodací list", kind: "dodaci_list", note: prev && !prev.includes(line) ? `${prev}\n${line}` : prev ?? line } as never)
        .eq("id", fileId);
      if (fErr) return fail(fErr.message);
    }

    const toStage: JobStage | null = from && isForward(from, "dodano_zakaznikovi") ? "dodano_zakaznikovi" : null;
    const update: Row = { delivery_note_confirmed_at: date };
    if (toStage) update.status = toStage;
    const { error } = await c.db.from("orders").update(update as never).eq("id", jobId);
    if (error) return fail(error.message);

    await logJobEvent(c.db, {
      jobId, type: fileId ? "file" : "field", message: `Potvrzený dodací list vrácen (${czDay(date)})`,
      data: { production: "delivery_note", date, ...(fileId ? { fileId } : {}) }, actorId: c.user.id,
    });
    if (toStage) await logStage(c, jobId, from, toStage, "potvrzený dodací list");
    revalidateProduction(jobId, true);
    return { ok: true, stage: toStage ?? from ?? "poptavka", date };
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
 * (už zaplacená zakázka rovnou Dokončeno), jen dopředu.
 */
export async function setInvoiceInfo(
  jobId: string,
  input: { invoiceNumber?: string | null; invoiceDate?: string | null; invoiceDueDate?: string | null },
): Promise<ActionResult<{ invoiceDate: string | null; invoiceDueDate: string | null; stage: JobStage }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!input || typeof input !== "object") return fail("Chybí údaje faktury.");
  for (const v of [input.invoiceDate, input.invoiceDueDate]) {
    if (v !== undefined && v !== null && v !== "" && cleanDate(v) === null) return fail("Neplatné datum faktury (čekám RRRR-MM-DD).");
  }
  if (input.invoiceNumber !== undefined && input.invoiceNumber !== null && typeof input.invoiceNumber !== "string") return fail("Neplatné číslo faktury.");
  if (typeof input.invoiceNumber === "string" && input.invoiceNumber.trim().length > 120) return fail("Číslo faktury je příliš dlouhé.");
  try {
    const job = await loadJob(
      c.db, jobId,
      "id, status, invoice_number, invoice_date, invoice_due_date, paid_at, customer:customers!customer_id(payment_terms_days)",
    );
    if (!job) return fail(NOT_FOUND);
    const from = isJobStage(job.status) ? job.status : null;
    const cust = Array.isArray(job.customer) ? job.customer[0] : job.customer;
    const terms = (cust as { payment_terms_days?: number | null } | null)?.payment_terms_days ?? null;

    const patch: Row = {};
    if (input.invoiceNumber !== undefined) patch.invoice_number = cleanText(input.invoiceNumber, 120);
    if (input.invoiceDate !== undefined) patch.invoice_date = cleanDate(input.invoiceDate);
    if (input.invoiceDueDate !== undefined) patch.invoice_due_date = cleanDate(input.invoiceDueDate);

    const invoiceDate = cleanDate("invoice_date" in patch ? patch.invoice_date : job.invoice_date);
    const dueGiven = cleanDate(input.invoiceDueDate);
    if (!dueGiven) {
      if (invoiceDate) {
        const dateChanged = "invoice_date" in patch && cleanDate(job.invoice_date) !== invoiceDate;
        const dueEmpty = !cleanDate("invoice_due_date" in patch ? patch.invoice_due_date : job.invoice_due_date);
        if (dateChanged || dueEmpty) patch.invoice_due_date = dueDateFor(invoiceDate, terms);
      } else if ("invoice_date" in patch && input.invoiceDueDate === undefined) {
        patch.invoice_due_date = null;
      }
    }
    const due = cleanDate("invoice_due_date" in patch ? patch.invoice_due_date : job.invoice_due_date);
    if (invoiceDate && due && due < invoiceDate) return fail("Splatnost je před datem faktury.");

    const number = cleanText("invoice_number" in patch ? patch.invoice_number : job.invoice_number, 120);
    const target: JobStage = job.paid_at ? "dokonceno" : "fakturovano";
    const toStage = (number || invoiceDate) && from && isForward(from, target) ? target : null;
    if (toStage) patch.status = toStage;

    const changedCols = (["invoice_number", "invoice_date", "invoice_due_date"] as const).filter((k) =>
      k in patch && (k === "invoice_number" ? cleanText(job[k], 120) !== patch[k] : cleanDate(job[k]) !== patch[k]));
    if (!changedCols.length && !toStage) {
      return { ok: true, invoiceDate, invoiceDueDate: due, stage: from ?? "poptavka" };
    }

    const { data: after, error } = await c.db
      .from("orders")
      .update(patch as never)
      .eq("id", jobId)
      .select("status, invoice_number, invoice_date, invoice_due_date")
      .single();
    if (error || !after) return fail(error?.message ?? "Fakturu se nepodařilo uložit.");
    const a = after as { status: JobStage; invoice_number: string | null; invoice_date: string | null; invoice_due_date: string | null };

    const LABELS = { invoice_number: "Číslo faktury", invoice_date: "Datum faktury", invoice_due_date: "Splatnost faktury" } as const;
    const views = (["invoice_number", "invoice_date", "invoice_due_date"] as const)
      .filter((k) => (k === "invoice_number" ? cleanText(job[k], 120) !== a[k] : cleanDate(job[k]) !== cleanDate(a[k])))
      .map((k) => {
        const f = k === "invoice_number" ? cleanText(job[k], 120) : cleanDate(job[k]);
        const t = k === "invoice_number" ? a[k] : cleanDate(a[k]);
        const txt = (v: string | null) => (v ? (k === "invoice_number" ? v : czDay(v)) : "—");
        return { field: k, label: LABELS[k], from: f, to: t, fromText: txt(f), toText: txt(t) };
      });
    if (views.length) {
      const head = `${a.invoice_number ? `Faktura ${a.invoice_number}` : "Faktura"}${a.invoice_date ? ` ze dne ${czDay(a.invoice_date)}` : ""}`;
      await logJobEvent(c.db, {
        jobId, type: "field", message: a.invoice_due_date ? `${head}, splatnost ${czDay(a.invoice_due_date)}` : head,
        data: { changes: views, production: "invoice" }, actorId: c.user.id,
      });
    }
    if (a.status !== from && isJobStage(a.status)) await logStage(c, jobId, from, a.status, "faktura vystavena");
    revalidateProduction(jobId, true);
    return { ok: true, invoiceDate: cleanDate(a.invoice_date), invoiceDueDate: cleanDate(a.invoice_due_date), stage: a.status };
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
  const c = await begin();
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
