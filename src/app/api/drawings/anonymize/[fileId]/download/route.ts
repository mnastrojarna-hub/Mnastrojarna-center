import { NextResponse } from "next/server";
import { anonGuard, json, loadSubject, tableParam } from "@/lib/anonymize/route-helpers";
import { pickShareFile, verifyShareBytes, ShareVerifyError, type FileRowWithAnon } from "@/lib/anonymize/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INLINE_MAX = 4 * 1024 * 1024;

/**
 * „Stáhnout pro dodavatele": anonymizovaná kopie pod anonymním názvem po ověření prefixu a sha256.
 * U „ke kontrole" vyžaduje ?reviewed=1 (stejné potvrzení jako odeslání). Velké soubory → podepsaná URL.
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const url = new URL(req.url);
  const table = tableParam(url.searchParams.get("table"));
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, table, fileId, "send");
  if (loaded instanceof Response) return loaded;
  const r = loaded.row;
  const row: FileRowWithAnon = {
    id: r.id, job_id: (r.job_id as string | null) ?? null, kind: (r.kind as string | null) ?? (table === "job_files" ? null : "vykres"),
    filename: String(r.filename ?? "vykres"), mime_type: (r.mime_type as string | null) ?? null, storage_path: (r.storage_path as string | null) ?? null,
    origin: (r.origin as string | null) ?? (table === "job_files" ? null : "upload"), issuer: (r.issuer as string | null) ?? null,
    anon_status: r.anon_status, anon_path: r.anon_path, anon_filename: (r.anon_filename as string | null) ?? null,
    anon_mime: (r.anon_mime as string | null) ?? null, anon_sha256: (r.anon_sha256 as string | null) ?? null, anon_reason: (r.anon_reason as string | null) ?? null,
  };
  const d = pickShareFile(row, { reviewedByCaller: url.searchParams.get("reviewed") === "1" });
  if (!d.ok) return json({ error: d.message, reason: d.reason }, 409);
  if (d.source !== "anon") return json({ error: "Soubor nemá anonymizovanou kopii." }, 409);
  const bucket = table === "drawings" ? "documents" : "job-files";
  try {
    const prefixOk = table === "drawing_anon_adhoc" ? String(d.path).startsWith(`capture/${String(r.user_id)}/anon/out/`) : true;
    if (!prefixOk) throw new ShareVerifyError("Anonymizovaná kopie je na nečekaném místě — anonymizuj znovu.");
    const bytes = table === "drawing_anon_adhoc"
      ? await verifyAdhoc(guard.db, bucket, d.path, d.sha256 ?? "")
      : await verifyShareBytes(guard.db as never, d, row, { archive: table === "drawings" });
    if (bytes.length <= INLINE_MAX) {
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": d.mime, "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${asciiName(d.filename)}"; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
        },
      });
    }
    const { data } = await guard.db.storage.from(bucket).createSignedUrl(d.path, 120, { download: d.filename });
    if (!data?.signedUrl) return json({ error: "Soubor se nepodařilo připravit." }, 500);
    return NextResponse.redirect(data.signedUrl, 302);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Chyba" }, err instanceof ShareVerifyError ? 409 : 500);
  }
}

function asciiName(n: string): string {
  return n.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "vykres";
}

async function verifyAdhoc(db: { storage: { from(b: string): { download(p: string): Promise<{ data: Blob | null; error: { message: string } | null }> } } }, bucket: string, path: string, sha: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new ShareVerifyError("Soubor se nepodařilo načíst.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const got = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (!sha || got !== sha) throw new ShareVerifyError("Anonymizovaná kopie byla změněna — anonymizuj znovu.");
  return bytes;
}
