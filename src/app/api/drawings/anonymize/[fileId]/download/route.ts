import { NextResponse } from "next/server";
import { anonGuard, json, loadSubject, tableParam, type AnonGuard } from "@/lib/anonymize/route-helpers";
import { pickShareFile, sharePriceDocIds, verifyShareBytes, ShareVerifyError, type FileRowWithAnon } from "@/lib/anonymize/share";
import { unsupportedHowTo } from "@/lib/anonymize/candidate";
import type { AnonTable } from "@/lib/anonymize/queue";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INLINE_MAX = 4 * 1024 * 1024;

/**
 * „Stáhnout pro dodavatele": anonymizovaná kopie pod anonymním názvem po ověření prefixu a sha256.
 * Hotová kopie (done; starší „ke kontrole" platí také) bez dalšího potvrzení. Velké soubory → podepsaná URL.
 * ?original=1 = „Poslat originál" u formátu, který anonymizovat nejde: jen super admin, audit, bez původního názvu.
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
    // archiv výkresů nemá sloupec filename → název z cesty (kandidát se pozná podle přípony)
    filename: String(r.filename ?? (r.storage_path ? String(r.storage_path).split("/").pop() : "") ?? "vykres") || "vykres", mime_type: (r.mime_type as string | null) ?? null, storage_path: (r.storage_path as string | null) ?? null,
    origin: (r.origin as string | null) ?? (table === "job_files" ? null : "upload"), issuer: (r.issuer as string | null) ?? null,
    anon_status: r.anon_status, anon_path: r.anon_path, anon_filename: (r.anon_filename as string | null) ?? null,
    anon_mime: (r.anon_mime as string | null) ?? null, anon_sha256: (r.anon_sha256 as string | null) ?? null, anon_reason: (r.anon_reason as string | null) ?? null,
  };
  const priceDocument = table === "job_files" && (await sharePriceDocIds(guard.db as never, [r.id])).has(r.id.toLowerCase());
  const bucket = table === "drawings" ? "documents" : "job-files";
  // „Poslat originál" (formát, který anonymizovat nejde — DWG, Word…): stejné pravidlo jako ZIP pro dodavatele
  if (url.searchParams.get("original") === "1") return sendOriginal(guard, table, row, bucket);
  const d = pickShareFile(row, { reviewedByCaller: url.searchParams.get("reviewed") === "1", priceDocument });
  if (!d.ok) return json({ error: d.message, reason: d.reason }, 409);
  if (d.source !== "anon") return json({ error: "Soubor nemá anonymizovanou kopii." }, 409);
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

/**
 * Originál bez anonymizace jen super admin, jen u souboru, který anonymizovat nejde (hotovou kopii nikdy
 * neobchází), vždy s auditem a bez původního názvu (ten často nese jméno zákazníka). Ostatní: 403 s návodem.
 */
async function sendOriginal(guard: AnonGuard, table: AnonTable, row: FileRowWithAnon, bucket: string): Promise<Response> {
  if (table === "drawing_anon_adhoc") return json({ error: "Samostatný nástroj originál neposílá — originál máš u sebe." }, 409);
  if (guard.user.role !== "super_admin") {
    const how = row.anon_status === "unsupported" ? ` ${row.anon_reason || unsupportedHowTo(row.filename)}` : "";
    return json({ error: `Originál bez anonymizace smí dodavateli poslat jen super admin — požádej ho o odeslání, nebo soubor převeď (PDF, DXF, STEP) a nahraj znovu, pak se anonymizuje sám.${how}`, reason: "forbidden" }, 403);
  }
  if (row.anon_status !== "unsupported") {
    return json({ error: "Originál bez anonymizace jde poslat jen u souboru, který anonymizovat nejde — pošli anonymizovanou kopii.", reason: "excluded" }, 409);
  }
  const d = pickShareFile(row, { original: true, isSuperAdmin: true });
  if (!d.ok) return json({ error: d.message, reason: d.reason }, 409);
  try {
    const bytes = await verifyShareBytes(guard.db as never, d, row, { archive: table === "drawings" });
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(d.filename)?.[0]?.toLowerCase() ?? "";
    const name = `original${ext}`;
    await logAudit({
      action: "anon_original_download", entity: table, entityId: row.id,
      diff: { jobId: row.job_id, status: row.anon_status, size: bytes.length }, actor: guard.actor,
    });
    if (bytes.length <= INLINE_MAX) {
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "Content-Type": d.mime, "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${name}"` },
      });
    }
    const { data } = await guard.db.storage.from(bucket).createSignedUrl(d.path, 120, { download: name });
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
