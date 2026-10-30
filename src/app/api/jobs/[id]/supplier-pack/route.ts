import { zipSync, strToU8 } from "fflate";
import { logAudit } from "@/lib/audit";
import { anonGuard, isUuid, json } from "@/lib/anonymize/route-helpers";
import { dedupeNames, cleanNamePart } from "@/lib/anonymize/filename";
import { pickShareFile, SHARE_FILE_SELECT, sharePriceDocIds, verifyShareBytes, type FileRowWithAnon } from "@/lib/anonymize/share";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 80;
const MAX_BYTES = 100 * 1024 * 1024;
/** Pevný čas v ZIPu (žádná stopa „kdy a kde"). */
const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

/**
 * „Balíček pro kooperanta (ZIP)": jen soubory přes pickShareFile + verifyShareBytes, anonymní názvy,
 * CHYBI.txt pro vyřazené, uloží se do exports/<uživatel>/ a vrátí podepsanou URL (7 dní).
 * ?files=id,id&reviewed=id,id (potvrzeno „zkontroloval jsem náhled").
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isUuid(jobId)) return json({ error: "Zakázka nenalezena." }, 404);
  const guard = await anonGuard("job_files");
  if (guard instanceof Response) return guard;
  const url = new URL(req.url);
  const files = (url.searchParams.get("files") ?? "").split(",").filter(isUuid).slice(0, MAX_FILES);
  const reviewed = new Set((url.searchParams.get("reviewed") ?? "").split(",").filter(isUuid));
  /** Potvrzeno „není to podklad zákazníka" (externí soubor bez anonymizace). */
  const confirmed = new Set((url.searchParams.get("confirmed") ?? "").split(",").filter(isUuid));
  /** Originál bez anonymizace (formát, který nejde — DWG, Word…): jen super admin, vždy s auditem. */
  const superAdmin = guard.user.role === "super_admin";
  const sendOriginal = new Set((url.searchParams.get("original") ?? "").split(",").filter(isUuid));
  if (sendOriginal.size && !superAdmin) return json({ error: "Originál bez anonymizace smí dodavateli poslat jen super admin." }, 403);
  const originals: string[] = [];
  if (!files.length) return json({ error: "Vyber soubory." }, 400);
  const { data: job } = await guard.db.from("orders").select("id, number").eq("id", jobId).maybeSingle();
  if (!job) return json({ error: "Zakázka nenalezena." }, 404);
  const { data } = await guard.db.from("job_files").select(SHARE_FILE_SELECT).eq("job_id", jobId).in("id", files);
  const rows = (data ?? []) as FileRowWithAnon[];
  // nákupní doklady (ceny dodavatele) nikdy do balíčku — bez ohledu na oprávnění k maržím
  const price = await sharePriceDocIds(guard.db as never, files);

  const entries: { name: string; bytes: Uint8Array }[] = [];
  const missing: { id: string; filename: string; reason: string }[] = [];
  let total = 0;
  for (const id of files) {
    const row = rows.find((r) => r.id === id);
    if (!row) { missing.push({ id, filename: "?", reason: "Soubor nepatří k zakázce." }); continue; }
    const chk = await assertJobFileAccess(guard.db as never, id, guard.access, "send");
    if (!chk.ok) { missing.push({ id, filename: row.filename, reason: chk.error }); continue; }
    const d = pickShareFile(row, {
      reviewedByCaller: reviewed.has(id), confirmNotCustomerMaterial: confirmed.has(id), priceDocument: price.has(id.toLowerCase()),
      // výslovně potvrzený originál jen u souboru, který anonymizovat nejde (hotovou kopii nikdy neobchází)
      ...(sendOriginal.has(id) && row.anon_status === "unsupported" ? { original: true, isSuperAdmin: superAdmin } : {}),
    });
    if (!d.ok) { missing.push({ id, filename: d.reason === "pending" ? "(anonymizuje se)" : row.anon_filename ?? "výkres", reason: d.message }); continue; }
    try {
      const bytes = await verifyShareBytes(guard.db as never, d, row);
      total += bytes.length;
      if (total > MAX_BYTES) { missing.push({ id, filename: d.filename, reason: "Balíček by byl větší než 100 MB." }); continue; }
      // originál (super admin) bez původního názvu — ten často nese jméno zákazníka
      const ext = /\.[A-Za-z0-9]{1,8}$/.exec(d.filename)?.[0]?.toLowerCase() ?? "";
      entries.push({ name: d.source === "original" && sendOriginal.has(id) ? `original-${entries.length + 1}${ext}` : d.filename, bytes });
      if (d.audit) originals.push(id);
    } catch (err) {
      missing.push({ id, filename: d.filename, reason: err instanceof Error ? err.message : "Chyba" });
    }
  }
  if (!entries.length) return json({ error: "Žádný soubor nejde přiložit.", missing }, 409);
  const names = dedupeNames(entries.map((e) => e.name));
  const zipInput: Record<string, [Uint8Array, { mtime: Date }]> = {};
  entries.forEach((e, i) => { zipInput[names[i]] = [e.bytes, { mtime: FIXED_MTIME }]; });
  if (missing.length) {
    // CHYBI.txt bez původních názvů souborů (mohou nést jméno zákazníka)
    const text = ["Některé podklady nebyly přiloženy:", ...missing.map((m, i) => `${i + 1}. ${m.filename.startsWith("(") ? m.filename : "výkres"} — ${m.reason}`)].join("\r\n");
    zipInput["CHYBI.txt"] = [strToU8(text), { mtime: FIXED_MTIME }];
  }
  const zip = zipSync(zipInput, { level: 6 });
  const number = cleanNamePart((job as { number: string | null }).number ?? "zakazka") || "zakazka";
  const path = `exports/${guard.user.id}/${crypto.randomUUID()}-${number}_podklady.zip`;
  const { error } = await guard.db.storage.from("job-files").upload(path, zip, { contentType: "application/zip", upsert: false });
  if (error) return json({ error: `Balíček se nepodařilo uložit: ${error.message}` }, 500);
  const { data: signed } = await guard.db.storage.from("job-files").createSignedUrl(path, 7 * 24 * 3600, { download: `${number}_podklady.zip` });
  await logAudit({ action: "supplier_pack", entity: "orders", entityId: jobId, diff: { files: entries.length, missing: missing.length, originals }, actor: guard.actor });
  return json({ ok: true, url: signed?.signedUrl ?? null, included: entries.length, missing });
}
