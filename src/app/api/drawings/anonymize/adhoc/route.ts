import { after } from "next/server";
import { logAudit } from "@/lib/audit";
import { anonGuard, isUuid, json, readBody } from "@/lib/anonymize/route-helpers";
import { appOrigin, defaultDeadline, kick, runClaimed } from "@/lib/anonymize/service";
import { cleanNamePart } from "@/lib/anonymize/filename";
import { sha256Hex } from "@/lib/anonymize/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;
const EXT_RE = /\.(pdf|jpe?g|png|webp|tiff?|heic|heif|dxf|stp|step)$/i;

/**
 * Samostatný nástroj „Anonymizovat výkres" (Poptávky, i bez zakázky), asynchronně:
 *  1) POST { filename, size, mimeType } → řádek drawing_anon_adhoc (uploading) + podepsaná URL pro upload
 *     do capture/<uid>/anon/…,
 *  2) POST { id } → ověří nahraný soubor, zařadí (pending) a spustí zpracování,
 *  GET → „Moje anonymizace" (7 dní).
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const guard = await anonGuard("job_files");
  if (guard instanceof Response) return guard;
  const { db, user } = guard;

  if (isUuid(body.id)) {
    const { data } = await db.from("drawing_anon_adhoc").select("id, user_id, storage_path, filename, anon_status").eq("id", body.id).maybeSingle();
    const row = data as { id: string; user_id: string; storage_path: string; filename: string; anon_status: string } | null;
    if (!row || row.user_id !== user.id) return json({ error: "Soubor nenalezen." }, 404);
    if (row.anon_status === "processing") return json({ ok: true, id: row.id, status: "processing" });
    const { data: blob, error } = await db.storage.from("job-files").download(row.storage_path);
    if (error || !blob) return json({ error: "Soubor se nenahrál — zkus to znovu." }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_BYTES) return json({ error: "Soubor je větší než 50 MB." }, 400);
    const sha = await sha256Hex(bytes);
    await db.from("drawing_anon_adhoc").update({
      anon_status: "pending", anon_attempts: 0, anon_lock_until: null, anon_reason: null, content_sha256: sha, size_bytes: bytes.length,
      anon_via: "rucne", updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    await logAudit({ action: "drawing_anon_adhoc", entity: "drawing_anon_adhoc", entityId: row.id, diff: { sha256: sha, size: bytes.length }, actor: guard.actor });
    const k = await kick({ origin: appOrigin(req.url), table: "drawing_anon_adhoc", ids: [row.id], manualBy: user.id });
    if (!k.kicked) {
      const actor = guard.actor;
      after(async () => {
        await runClaimed(db, "drawing_anon_adhoc", [row.id], { actor, deadline: defaultDeadline(), manual: true }, 1);
      });
    }
    return json({ ok: true, id: row.id, status: "pending" });
  }

  const filename = cleanNamePart(typeof body.filename === "string" ? body.filename : "").slice(0, 120);
  const size = Number(body.size);
  const mime = typeof body.mimeType === "string" ? body.mimeType.slice(0, 100) : null;
  if (!filename || !EXT_RE.test(filename)) return json({ error: "Podporované soubory: PDF, fotky (JPEG, PNG, WebP, TIFF), DXF a STEP." }, 400);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return json({ error: "Soubor je větší než 50 MB." }, 400);
  const path = `capture/${user.id}/anon/${crypto.randomUUID()}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const { data: signed, error: signErr } = await db.storage.from("job-files").createSignedUploadUrl(path);
  if (signErr || !signed) return json({ error: signErr?.message ?? "Nahrání se nepodařilo připravit." }, 500);
  const { data: ins, error } = await db.from("drawing_anon_adhoc").insert({
    user_id: user.id, storage_path: path, filename, mime_type: mime, size_bytes: size, anon_status: "uploading", anon_via: "rucne",
  }).select("id").single();
  if (error || !ins) return json({ error: error?.message ?? "Záznam se nepodařilo vytvořit." }, 500);
  return json({ ok: true, id: (ins as { id: string }).id, path, token: signed.token });
}

export async function GET() {
  const guard = await anonGuard("job_files");
  if (guard instanceof Response) return guard;
  const { data } = await guard.db.from("drawing_anon_adhoc")
    .select("id, filename, anon_status, anon_reason, anon_summary, anon_filename, anon_at, created_at, expires_at")
    .eq("user_id", guard.user.id).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50);
  return json({ items: data ?? [] });
}
