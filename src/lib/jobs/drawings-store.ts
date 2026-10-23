import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid } from "@/lib/jobs/mapping";
import {
  SPEC_COLUMN_NAMES, insertSpecRow, mergeSpecPatch, type DrawingSpecColumns, type SpecSources,
} from "@/lib/jobs/drawing-spec";

/** Sloupce materiálu / hmotnosti / úprav + zdroje (pro mergeSpecPatch). */
export const SPEC_ROW_SELECT = `id, ${SPEC_COLUMN_NAMES.join(", ")}, spec_sources`;

/**
 * Materiál, hmotnost a úpravy z výkresu do existujícího řádku archivu: prázdné a AI-vyplněné se
 * doplní / nahradí, ručně zadané zůstane (mergeSpecPatch).
 */
export async function applySpecToDrawing(
  db: JobsDb, drawingId: string, columns: DrawingSpecColumns, sources: SpecSources,
): Promise<{ ok: boolean; changed: string[] }> {
  const { data, error } = await db.from("drawings").select(SPEC_ROW_SELECT).eq("id", drawingId).maybeSingle();
  if (error || !data) return { ok: false, changed: [] };
  const m = mergeSpecPatch(data as Record<string, unknown>, columns, sources);
  if (!Object.keys(m.patch).length) return { ok: true, changed: [] };
  const { error: upErr } = await db.from("drawings").update(m.patch as never).eq("id", drawingId);
  return { ok: !upErr, changed: upErr ? [] : m.changed };
}

/**
 * Archiv výkresů z dokumentů zakázky (dávkové focení): výkres se do archivu (drawings, unikát
 * číslo + revize globálně) zapíše s odkazem na soubor zakázky v job-files. Existuje-li už u téhož
 * zákazníka, jen se propojí; u jiného zákazníka (nebo když zakázka zákazníka nemá) se archiv
 * přeskočí (konflikt k upozornění).
 * Zápis servisním klientem — vedlejší účinek zakázky i bez práva „drawings".
 */

export interface CaptureDrawingInput {
  drawingNumber: string;
  revision: string;
  customerId: string | null;
  title: string;
  material: string;
  dimensions: string;
  generalTolerance: string;
  tightestTolerance: string;
  quantity: number | null;
  /** PDF / IMG / DXF / STEP */
  fileType: string;
  storagePath: string;
  jobFileId: string;
  jobId: string;
  aiMetadata: Record<string, unknown>;
  uploadedBy: string;
  /** Materiál, hmotnost, TZ / PÚ, poznámky (drawing-spec.ts) — u nového řádku se zapíše celé. */
  spec?: { columns: DrawingSpecColumns; sources: SpecSources };
}

export type CaptureDrawingResult =
  | { status: "inserted"; drawingId: string }
  | { status: "linked"; drawingId: string }
  | { status: "conflict"; message: string }
  | { status: "skipped"; message: string };

/** Prázdná revize v archivu = „-". */
export function archiveRevision(rev: string): string {
  const r = (rev ?? "").trim();
  return r || "-";
}

export function tolerancesText(general: string, tightest: string): string | null {
  const parts = [general.trim(), tightest.trim()].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

async function findSame(db: JobsDb, number: string, revision: string): Promise<{ id: string; customer_id: string | null } | null> {
  const { data } = await db.from("drawings").select("id, revision, customer_id").eq("drawing_number", number);
  const rows = (data ?? []) as { id: string; revision: string; customer_id: string | null }[];
  return rows.find((r) => r.revision.trim().toLowerCase() === revision.toLowerCase()) ?? null;
}

export async function upsertDrawingFromCapture(db: JobsDb, input: CaptureDrawingInput): Promise<CaptureDrawingResult> {
  const number = input.drawingNumber.trim().slice(0, 120);
  if (!number) return { status: "skipped", message: "Výkres bez čísla se do archivu nezapisuje." };
  const revision = archiveRevision(input.revision).slice(0, 20);
  const customerId = isUuid(input.customerId) ? input.customerId : null;
  const existing = await findSame(db, number, revision);
  if (existing) {
    if (existing.customer_id && customerId && existing.customer_id !== customerId) {
      return { status: "conflict", message: `Číslo ${number} ${revision} je v archivu u jiného zákazníka — do archivu se nezapsalo.` };
    }
    // zakázka bez zákazníka se nepropojí s výkresem konkrétního zákazníka (stejné číslo ≠ stejný díl)
    if (existing.customer_id && !customerId) {
      return { status: "skipped", message: `Číslo ${number} ${revision} je v archivu u zákazníka — zakázka zákazníka nemá, nepropojeno.` };
    }
    return { status: "linked", drawingId: existing.id };
  }
  const row = {
    drawing_number: number,
    revision,
    customer_id: customerId,
    material: input.material.trim() || null,
    dimensions: input.dimensions.trim() || null,
    tolerances: tolerancesText(input.generalTolerance, input.tightestTolerance),
    quantity: input.quantity && input.quantity > 0 ? Math.round(input.quantity) : null,
    file_type: input.fileType,
    storage_path: input.storagePath,
    storage_bucket: "job-files",
    job_file_id: input.jobFileId,
    job_id: input.jobId,
    title: input.title.trim() || null,
    ai_metadata: input.aiMetadata,
    uploaded_by: input.uploadedBy,
    ...(input.spec ? insertSpecRow(input.spec.columns, input.spec.sources) : {}),
  };
  const { data, error } = await db.from("drawings").insert(row as never).select("id").single();
  if (error || !data) {
    // souběh (unikát číslo + revize) → propojit s tím, co vzniklo
    const again = await findSame(db, number, revision);
    if (again && (!again.customer_id || again.customer_id === customerId)) return { status: "linked", drawingId: again.id };
    return { status: "skipped", message: `Výkres ${number} se nepodařilo zapsat do archivu.` };
  }
  return { status: "inserted", drawingId: (data as { id: string }).id };
}
