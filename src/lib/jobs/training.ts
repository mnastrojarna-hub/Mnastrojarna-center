import "server-only";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import type { AiTrainingExample } from "@/lib/supabase/database.types";
import { DOC_KIND_LABEL, type CaptureDocKind } from "@/lib/jobs/capture-types";

/**
 * Učení AI z ruční práce: každý doklad, který člověk vyplnil / opravil, se uloží
 * do ai_training_examples a nejnovější příklady se vkládají do promptu čtení
 * dokladů jako vzor („takto lidé vyplnili podobné doklady"). Vše best-effort —
 * chyba učení nikdy nesmí shodit nahrání dokladu.
 */

export interface TrainingExampleInput {
  jobId?: string;
  jobFileId?: string;
  docKind?: string;
  /** ai = AI vyplnila a nikdo neopravil · manual = vyplnil člověk · corrected = člověk opravil AI. */
  source: "ai" | "manual" | "corrected";
  /** Výstup AI (pokud běžela). */
  extracted?: unknown;
  /** Finální údaje po kontrole člověkem. */
  final?: unknown;
  createdBy?: string;
}

/** Uloží příklad pro učení. Bez servisního klíče nebo při chybě tiše nic. */
export async function recordTrainingExample(input: TrainingExampleInput): Promise<void> {
  if (!hasServiceKey()) return;
  try {
    const db = createAdminClient();
    await db.from("ai_training_examples").insert({
      kind: "capture",
      job_id: input.jobId ?? null,
      job_file_id: input.jobFileId ?? null,
      doc_kind: input.docKind ?? null,
      source: input.source,
      extracted: toJson(input.extracted),
      final: toJson(input.final),
      created_by: input.createdBy ?? null,
    });
  } catch {
    // učení je doplněk — nahrání dokladu kvůli němu nepadá
  }
}

function toJson(v: unknown): unknown {
  if (v == null) return null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

// ── Few-shot text do promptu ────────────────────────────────

export type LearningRow = Pick<AiTrainingExample, "doc_kind" | "source" | "final" | "created_at">;

const MAX_EXAMPLE_CHARS = 400;

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return v === 0 || !Number.isFinite(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isEmptyValue);
  return false;
}

/** Položka → „VK-2291 rev. B Upínka 1.2379 50 ks". */
function compactItem(v: unknown): string {
  if (typeof v !== "object" || v === null) return String(v ?? "");
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const qty = Number(o.quantity) || 0;
  return [
    str("drawingNumber"),
    str("revision") && `rev. ${str("revision")}`,
    str("name"),
    str("material"),
    qty > 0 && `${qty} ${str("unit") || "ks"}`,
    Number(o.unitPrice) > 0 && `á ${o.unitPrice}`,
  ].filter(Boolean).join(" ");
}

/** Hodnoty bez prázdných polí, klíče jako ve schématu (customerOrderNumber: …). */
function compactValue(v: unknown, depth = 0): string {
  if (Array.isArray(v)) {
    return v.filter((x) => !isEmptyValue(x)).map((x) => (typeof x === "object" ? compactItem(x) : String(x))).join("; ");
  }
  if (typeof v === "object" && v !== null) {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isEmptyValue(val)) continue;
      if (k === "confidence" || k === "summary" || k === "needsClarification") continue;
      if (k === "items" && Array.isArray(val)) {
        parts.push(`položky: ${compactValue(val, depth + 1)}`);
      } else if (typeof val === "object" && depth < 2) {
        parts.push(`${k}: {${compactValue(val, depth + 1)}}`);
      } else if (typeof val !== "object") {
        parts.push(`${k}: ${String(val).replace(/\s+/g, " ").trim()}`);
      }
    }
    return parts.join(", ");
  }
  return String(v ?? "").trim();
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Čistý formátovač few-shot textu (testovatelný bez DB). */
export function formatCaptureLearningPrompt(rows: LearningRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (isEmptyValue(r.final)) continue;
    const kind = DOC_KIND_LABEL[r.doc_kind as CaptureDocKind] ?? (r.doc_kind || "Doklad");
    const how = r.source === "corrected" ? "opraveno člověkem" : "vyplněno ručně";
    const body = compactValue(r.final);
    if (!body) continue;
    lines.push(clip(`${lines.length + 1}) [${kind}, ${how}] ${body}`, MAX_EXAMPLE_CHARS));
  }
  if (!lines.length) return "";
  return (
    "UČENÍ Z RUČNÍ PRÁCE — Takto lidé vyplnili podobné doklady (vzor, jak doklady číst a kam které " +
    "číslo patří; hodnoty nepřebírej, pokud nejsou na tomto dokladu):\n" +
    lines.join("\n")
  );
}

/**
 * Nejnovější ručně vyplněné / opravené doklady jako few-shot text do promptu
 * čtení dokladů. Bez servisního klíče nebo při chybě vrací "".
 */
export async function buildCaptureLearningPrompt(limit = 8): Promise<string> {
  if (!hasServiceKey()) return "";
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ai_training_examples")
      .select("doc_kind, source, final, created_at")
      .eq("kind", "capture")
      .in("source", ["manual", "corrected"])
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 30)));
    if (error || !data) return "";
    return formatCaptureLearningPrompt(data as LearningRow[]);
  } catch {
    return "";
  }
}
