"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { settingsFromRow, settingsToRow, configHash, type AnonSettings } from "@/lib/anonymize/settings";
import { anonRunnerStatus, appOrigin, approve, enqueue, kick, promoteLegacy, skip, type AnonDb, type AnonTable } from "@/lib/anonymize/queue";
import { allowQueuedOriginals, cancelSend, enqueueSend, sendWithoutPending, validateSendRequest, type SendKind, type SendPayload } from "@/lib/anonymize/send-queue";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";
import { getAccess } from "@/lib/auth/session";

/**
 * Akce anonymizace výkresů — JEN zápisy do DB a „šťouchnutí" do fronty (fetch na interní run).
 * NIKDY nevykreslují: renderer (pdf.js, canvas, sharp) běží jen v routách /api/drawings/anonymize/**
 * a /api/cron/drawing-anonymize/** (test importního grafu hlídá, že sem nevede).
 */

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY = "Chybí SUPABASE_SECRET_KEY — anonymizace výkresů běží jen se servisním klíčem.";

async function begin(feature: "orders" | "settings" = "orders") {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." } as const;
  if (!hasServiceKey()) return { error: NO_KEY } as const;
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error } as const;
  const actor = userActor(access.user, "rucne");
  return { user: access.user, actor, db: createAdminClient({ actor }) as AnonDb };
}

/** Adresa pro interní běh: z konfigurace (appOrigin), hlavička Host jen u lokálního vývoje. */
async function origin(): Promise<string | null> {
  const configured = appOrigin(null);
  if (configured) return configured;
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host || !(host.startsWith("localhost") || host.startsWith("127."))) return null;
    return `http://${host}`;
  } catch {
    return null;
  }
}

function tableOf(v: unknown): AnonTable {
  return v === "drawings" ? "drawings" : "job_files";
}

async function canSee(db: AnonDb, fileId: string): Promise<string | null> {
  const access = await getAccess();
  const chk = await assertJobFileAccess(db as never, fileId, access, "view");
  return chk.ok ? null : chk.error;
}

function revalidate() {
  try {
    revalidatePath("/inquiries");
    revalidatePath("/orders");
    revalidatePath("/documents");
  } catch {
    // mimo požadavek Next.js
  }
}

/** Načte nastavení anonymizace (pro formulář Nastavení). */
export async function getAnonSettings(): Promise<Result<{ settings: AnonSettings; runner: ReturnType<typeof anonRunnerStatus> }>> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  const { data } = await c.db.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle();
  // runner: Nastavení ukáže, že chybí CRON_SECRET (bez záchranného plánovače)
  return { ok: true, settings: settingsFromRow(data as Record<string, unknown> | null), runner: anonRunnerStatus() };
}

/** Uloží nastavení (jen super admin), s autorem a v audit logu. */
export async function saveAnonSettings(input: Partial<AnonSettings>): Promise<Result<{ settings: AnonSettings; configHash: string }>> {
  const c = await begin("settings");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (c.user.role !== "super_admin") return { ok: false, error: "Nastavení anonymizace mění jen super admin." };
  if (!input || typeof input !== "object") return { ok: false, error: "Neplatné nastavení." };
  const { data: prev } = await c.db.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle();
  const merged = { ...settingsFromRow(prev as Record<string, unknown> | null), ...input };
  const row = settingsToRow(merged);
  const { error } = await c.db.from("drawing_anon_settings").upsert({ id: 1, ...row, updated_at: new Date().toISOString(), updated_by: c.user.id });
  if (error) return { ok: false, error: error.message };
  const settings = settingsFromRow({ ...row });
  await logAudit({ action: "drawing_anon_settings", entity: "drawing_anon_settings", entityId: "1", diff: { ...row, extra_terms: (row.extra_terms as string[]).length }, actor: c.actor });
  revalidatePath("/settings");
  return { ok: true, settings, configHash: await configHash(settings) };
}

/** Zařadí výkresy (nebo všechny ze zakázek) do anonymizace a šťouchne do fronty. Bez vykreslování. */
export async function queueDrawingAnonymize(input: { fileIds?: string[]; jobIds?: string[]; force?: boolean; table?: AnonTable }): Promise<Result<{ queued: number; statuses: Record<string, string | null> }>> {
  const table = tableOf(input?.table);
  const c = await begin(table === "drawings" ? "settings" : "orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  const fileIds = (input?.fileIds ?? []).filter((x) => UUID_RE.test(x)).slice(0, 200);
  const jobIds = (input?.jobIds ?? []).filter((x) => UUID_RE.test(x)).slice(0, 100);
  if (!fileIds.length && !jobIds.length) return { ok: false, error: "Vyber výkresy nebo zakázky." };
  if (table === "job_files") {
    for (const id of fileIds) {
      const err = await canSee(c.db, id);
      if (err) return { ok: false, error: err };
    }
  }
  // i soubory ze zakázek (jobIds) projdou kontrolou po souborech (nákupní doklady, neschválené nabídky…)
  const allow = table === "job_files" ? async (id: string) => (await canSee(c.db, id)) === null : undefined;
  // staré výkresy (backfill) ručně předřadí (mimo denní limit) jen super admin
  const res = await enqueue(c.db, { table, fileIds, jobIds, force: input?.force === true, priority: 0, via: "rucne", allow, keepBackfill: c.user.role !== "super_admin" });
  const backfill = new Set(res.backfill ?? []);
  const pending = Object.entries(res.statuses).filter(([id, s]) => s === "pending" && !backfill.has(id)).map(([id]) => id);
  if (pending.length) await kick({ origin: await origin(), table, ids: pending.slice(0, 5), manualBy: c.user.id }).catch(() => undefined);
  revalidate();
  return { ok: true, queued: res.queued, statuses: res.statuses };
}

/** „Schválit" (review → done). */
export async function approveDrawingAnon(fileId: string, table?: AnonTable): Promise<Result> {
  const t = tableOf(table);
  const c = await begin(t === "drawings" ? "settings" : "orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!UUID_RE.test(fileId)) return { ok: false, error: "Soubor nenalezen." };
  if (t === "job_files") {
    const err = await canSee(c.db, fileId);
    if (err) return { ok: false, error: err };
  }
  const r = await approve(c.db, t, fileId, c.actor);
  revalidate();
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Schválení selhalo." };
}

/** „Neanonymizovat (náš výkres)". */
export async function skipDrawingAnon(fileId: string, reason?: string | null, table?: AnonTable): Promise<Result> {
  const t = tableOf(table);
  const c = await begin(t === "drawings" ? "settings" : "orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!UUID_RE.test(fileId)) return { ok: false, error: "Soubor nenalezen." };
  if (t === "job_files") {
    const err = await canSee(c.db, fileId);
    if (err) return { ok: false, error: err };
  }
  const r = await skip(c.db, t, fileId, c.actor, reason ?? null);
  revalidate();
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Uložení selhalo." };
}

/** Přepočet po změně pravidel: soubory s jiným anon_config_hash → pending (priorita 5). Jen super admin. */
export async function requeueChangedConfig(): Promise<Result<{ queued: number; ids?: string[] }>> {
  const c = await begin("settings");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (c.user.role !== "super_admin") return { ok: false, error: "Přepočet spouští jen super admin." };
  const { data: s } = await c.db.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle();
  const hash = await configHash(settingsFromRow(s as Record<string, unknown> | null));
  const { data, error } = await c.db.from("job_files").update({ anon_status: "pending", anon_priority: 5, anon_attempts: 0, anon_lock_until: null, anon_via: "rucne" })
    .in("anon_status", ["done", "review"]).neq("anon_config_hash", hash).select("id");
  if (error) return { ok: false, error: error.message };
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) await kick({ origin: await origin(), table: "job_files", ids: ids.slice(0, 5) }).catch(() => undefined);
  await logAudit({ action: "drawing_anon_requeue", entity: "drawing_anon_settings", entityId: "1", diff: { count: ids.length }, actor: c.actor });
  // ids → prohlížeč hned šťouchne do /api/drawings/anonymize/process (akce nevykresluje)
  return { ok: true, queued: ids.length, ids: ids.slice(0, 50) };
}

/**
 * Odeslání čekající na anonymizaci (volá hák sendPurchaseOrder / sendJobDocument / poptávka dodavateli,
 * když některý výkres je pending): zařadí do anon_send_queue a šťouchne do fronty.
 */
export async function queueSendAfterAnon(input: { kind: SendKind; jobId: string | null; refId?: string | null; payload: SendPayload; fileIds: string[] }): Promise<Result<{ id: string }>> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!input || typeof input !== "object") return { ok: false, error: "Neplatný požadavek." };
  const access = await getAccess();
  // všechny přílohy (výkresy, naše doklady, potvrzené náhledy) i objednávka se ověří na serveru
  const chk = await validateSendRequest(c.db, input, {
    canSendFile: async (id) => {
      const r = await assertJobFileAccess(c.db as never, id, access, "send");
      return r.ok ? null : r.error;
    },
    canSendPurchaseOrder: access.can("margins"),
  });
  if (!chk.ok) return { ok: false, error: chk.error };
  // fronta odeslání jen pro e-mail zakázky s výkresy, které čekají na anonymizaci — ne obecná pošta
  if (!input.jobId || chk.fileIds.length === 0) {
    return { ok: false, error: "Na anonymizaci se čeká jen u odeslání ze zakázky s výkresy — bez nich odešli e-mail rovnou." };
  }
  const r = await enqueueSend(c.db, { kind: input.kind, jobId: input.jobId, refId: chk.refId, payload: chk.payload, fileIds: chk.fileIds, createdBy: c.user.id });
  if (!r.ok) return { ok: false, error: r.error };
  await kick({ origin: await origin(), table: "job_files", ids: chk.fileIds.slice(0, 5), manualBy: c.user.id }).catch(() => undefined);
  return { ok: true, id: r.id };
}

export async function cancelQueuedSend(id: string): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!UUID_RE.test(id)) return { ok: false, error: "Odeslání nenalezeno." };
  const r = await cancelSend(c.db, id, c.user.id, c.user.role === "super_admin");
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Zrušení selhalo." };
}

/**
 * „Poslat originál…" u odeslání zablokovaného souborem, který anonymizovat nejde (DWG, Word…): jen super admin,
 * s výslovným potvrzením v dialogu, zapíše audit a hned odešle (ostatní výkresy jen anonymizované).
 */
export async function sendQueuedWithOriginals(id: string, confirm: boolean): Promise<Result<{ sent: boolean }>> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!UUID_RE.test(id)) return { ok: false, error: "Odeslání nenalezeno." };
  if (c.user.role !== "super_admin") {
    return { ok: false, error: "Originál bez anonymizace smí dodavateli poslat jen super admin — požádej ho o odeslání, nebo soubor převeď (PDF, DXF, STEP) a nahraj znovu, pak se anonymizuje sám." };
  }
  if (confirm !== true) return { ok: false, error: "Potvrď, že posíláš originál bez anonymizace." };
  const r = await allowQueuedOriginals(c.db, id, c.user, c.actor);
  return r.ok ? { ok: true, sent: Boolean(r.sent) } : { ok: false, error: r.error ?? "Odeslání selhalo." };
}

/** „Odeslat hned bez těchto výkresů". */
export async function sendQueuedWithoutPending(id: string): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (!UUID_RE.test(id)) return { ok: false, error: "Odeslání nenalezeno." };
  const r = await sendWithoutPending(c.db, id, c.user.id, c.user.role === "super_admin");
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Odeslání selhalo." };
}

/** Režim anonymizace (automation_settings modul drawing_anonymize): plná automatika / se schválením. Jen super admin. */
export async function setAnonMode(mode: "full" | "approval"): Promise<Result> {
  const c = await begin("settings");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (c.user.role !== "super_admin") return { ok: false, error: "Režim anonymizace mění jen super admin." };
  if (mode !== "full" && mode !== "approval") return { ok: false, error: "Neplatný režim." };
  const { data: prev } = await c.db.from("automation_settings").select("mode").eq("module", "drawing_anonymize").maybeSingle();
  const { error } = await c.db.from("automation_settings").upsert(
    { module: "drawing_anonymize", mode, enabled: true, updated_by: c.user.id, updated_at: new Date().toISOString() } as never,
    { onConflict: "module" },
  );
  if (error) return { ok: false, error: error.message };
  const from = (prev as { mode: string } | null)?.mode ?? null;
  if (from !== mode) await logAudit({ action: "automation_mode_changed", entity: "automation_settings", entityId: "drawing_anonymize", diff: { module: "drawing_anonymize", from, to: mode }, actor: c.actor });
  revalidatePath("/settings");
  return { ok: true };
}

/** „Zpracovat staré výkresy (n)": backfill (priorita 9) → priorita 5 a šťouchnout; běží v rámci denního limitu. Jen super admin. */
export async function queueLegacyDrawings(): Promise<Result<{ queued: number; ids?: string[] }>> {
  const c = await begin("settings");
  if ("error" in c) return { ok: false, error: c.error as string };
  if (c.user.role !== "super_admin") return { ok: false, error: "Zpracování starých výkresů spouští jen super admin." };
  const { ids, error } = await promoteLegacy(c.db, { limit: 200 });
  if (error) return { ok: false, error };
  if (!ids.length) return { ok: true, queued: 0 };
  await kick({ origin: await origin(), table: "job_files", ids: ids.slice(0, 5) }).catch(() => undefined);
  await logAudit({ action: "drawing_anon_backfill", entity: "drawing_anon_settings", entityId: "1", diff: { count: ids.length }, actor: c.actor });
  revalidatePath("/settings");
  return { ok: true, queued: ids.length, ids: ids.slice(0, 50) };
}
