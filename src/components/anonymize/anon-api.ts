"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Volání rout anonymizace z prohlížeče (jen fetch na /api/drawings/anonymize/** — renderer běží na
 * serveru v routách, nikdy v server action ani v prohlížeči).
 */

export type AnonTableParam = "job_files" | "drawings" | "adhoc";

export interface AnonRegionDto {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  quad?: number[];
  category: string;
  source: string;
  zone?: string;
  manual?: "added" | "removed";
  /** Čitelný text (jen super admin). */
  text?: string;
}

export interface AnonLineDto {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zone: string;
  /** Chráněné pole (číslo výkresu, materiál, název…) podle pravidel serveru. */
  keep?: boolean;
}

export interface AnonBoxDto {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnonStateDto {
  id: string;
  status: string | null;
  reason: string | null;
  method: string | null;
  filename: string | null;
  at: string | null;
  reviewedAt: string | null;
  summary: { counts?: Record<string, number>; total?: number; warnings?: { code: string; message: string; page?: number }[] } | null;
  pages: { total?: number; included?: number[]; excluded?: { page: number; why: string }[] } | null;
  regions: AnonRegionDto[];
  /** Existuje anonymizovaná kopie („Po")? (stahuje se jen přes /download s ověřením sha) */
  hasAfter: boolean;
  lines?: AnonLineDto[];
  /** Chráněná pole stránky (jen PDF s lines=1). */
  keep?: (AnonBoxDto & { field: string })[];
  /** Razítko stránky (jen PDF s lines=1). */
  titleBlock?: AnonBoxDto | null;
}

export interface AdhocItemDto {
  id: string;
  filename: string;
  anon_status: string;
  anon_reason: string | null;
  anon_summary: AnonStateDto["summary"];
  anon_filename: string | null;
  anon_at: string | null;
  created_at: string;
  expires_at: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number; data?: unknown }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : `Chyba ${res.status}`, status: res.status, data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Spojení se nepovedlo — zkus to znovu.", status: 0 };
  }
}

const q = (table?: AnonTableParam) => (table && table !== "job_files" ? `table=${table}` : "");

export const anonApi = {
  enqueue(body: { fileIds?: string[]; jobIds?: string[]; force?: boolean; table?: AnonTableParam }) {
    return call<{ queued: number; statuses: Record<string, string | null>; skipped: { id: string; reason: string }[]; backfill?: string[] }>("/api/drawings/anonymize", {
      method: "POST", body: JSON.stringify(body),
    });
  },
  state(id: string, opts: { table?: AnonTableParam; lines?: boolean; page?: number } = {}) {
    const p = [q(opts.table), opts.lines ? "lines=1" : "", opts.page ? `page=${opts.page}` : ""].filter(Boolean).join("&");
    return call<AnonStateDto>(`/api/drawings/anonymize/${id}${p ? `?${p}` : ""}`);
  },
  save(id: string, body: { regions: AnonRegionDto[]; expectedAt: string | null; table?: AnonTableParam; confirmKeep?: boolean }) {
    return call<{ ok: boolean; status: string; reason?: string | null; warnings?: { code: string; message: string }[] }>(`/api/drawings/anonymize/${id}`, { method: "PUT", body: JSON.stringify(body) });
  },
  approve(id: string, table?: AnonTableParam) {
    return call<{ ok: boolean }>(`/api/drawings/anonymize/${id}/approve`, { method: "POST", body: JSON.stringify({ table }) });
  },
  skip(id: string, reason?: string, table?: AnonTableParam) {
    return call<{ ok: boolean }>(`/api/drawings/anonymize/${id}/skip`, { method: "POST", body: JSON.stringify({ table, reason }) });
  },
  supplierPack(jobId: string, files: string[], reviewed: string[] = [], original: string[] = []) {
    const p = new URLSearchParams({ files: files.join(",") });
    if (reviewed.length) p.set("reviewed", reviewed.join(","));
    // originál bez anonymizace — jen super admin (server ověří roli)
    if (original.length) p.set("original", original.join(","));
    return call<{ url: string | null; included: number; missing: { id: string; filename: string; reason: string }[] }>(`/api/jobs/${jobId}/supplier-pack?${p}`);
  },
  adhocList() {
    return call<{ items: AdhocItemDto[] }>("/api/drawings/anonymize/adhoc");
  },
  adhocState(id: string) {
    return call<{ id: string; filename: string; status: string; reason: string | null; summary: AnonStateDto["summary"]; anonFilename: string | null; downloadUrl: string | null }>(`/api/drawings/anonymize/adhoc/${id}`);
  },
  /** Samostatný nástroj: záznam → upload na podepsanou URL → spuštění. */
  async adhocUpload(file: File): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const prep = await call<{ id: string; path: string; token: string }>("/api/drawings/anonymize/adhoc", {
      method: "POST", body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type || null }),
    });
    if (!prep.ok) return { ok: false, error: prep.error };
    try {
      const { error } = await createClient().storage.from("job-files").uploadToSignedUrl(prep.data.path, prep.data.token, file, {
        contentType: file.type || "application/octet-stream", upsert: false,
      });
      if (error) return { ok: false, error: `Nahrání selhalo: ${error.message}` };
    } catch {
      return { ok: false, error: "Nahrání selhalo — zkontroluj připojení." };
    }
    const start = await call<{ id: string; status: string }>("/api/drawings/anonymize/adhoc", { method: "POST", body: JSON.stringify({ id: prep.data.id }) });
    if (!start.ok) return { ok: false, error: start.error };
    return { ok: true, id: prep.data.id };
  },
  /** Samostatný nástroj: znovu spustit (po selhání) — soubor je už nahraný. */
  adhocRetry(id: string) {
    return call<{ id: string; status: string }>("/api/drawings/anonymize/adhoc", { method: "POST", body: JSON.stringify({ id }) });
  },
  sendQueue(jobId: string) {
    return call<{ items: SendQueueDto[] }>(`/api/drawings/anonymize/send-queue?jobId=${jobId}`);
  },
};

export interface SendQueueDto {
  id: string;
  kind: string;
  status: "waiting" | "blocked" | "sending" | "sent" | "cancelled" | "failed";
  to: string | null;
  fileCount: number;
  pendingCount: number;
  createdAt: string;
  reason: string | null;
  mine: boolean;
  /** Výkres, který odeslání blokuje (ke kontrole / selhal) — „Zkontrolovat výkres". */
  blockingFileId?: string | null;
}

/**
 * Náhled originálu (variant=orig) nebo anonymizované kopie (variant=anon) jako PNG ≤ 2400 px.
 * box = normalizovaný výřez [x, y, w, h] (strana originálu), w = nejdelší strana (miniatura 320).
 */
export function previewUrl(id: string, opts: { table?: AnonTableParam; page?: number; variant?: "orig" | "anon"; box?: [number, number, number, number] | { x: number; y: number; w: number; h: number } | null; v?: string | null; w?: number } = {}): string {
  const p = new URLSearchParams();
  if (opts.table && opts.table !== "job_files") p.set("table", opts.table);
  if (opts.page && opts.page > 1) p.set("page", String(opts.page));
  if (opts.variant === "anon") p.set("variant", "anon");
  if (opts.box) {
    const b = Array.isArray(opts.box) ? opts.box : [opts.box.x, opts.box.y, opts.box.w, opts.box.h];
    p.set("box", b.map((v) => v.toFixed(4)).join(","));
  }
  if (opts.w) p.set("w", String(Math.round(opts.w)));
  if (opts.v) p.set("v", opts.v);
  const s = p.toString();
  return `/api/drawings/anonymize/${id}/preview${s ? `?${s}` : ""}`;
}

export function downloadUrl(id: string, opts: { table?: AnonTableParam; reviewed?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (opts.table && opts.table !== "job_files") p.set("table", opts.table);
  if (opts.reviewed) p.set("reviewed", "1");
  const s = p.toString();
  return `/api/drawings/anonymize/${id}/download${s ? `?${s}` : ""}`;
}
