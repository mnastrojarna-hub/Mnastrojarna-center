import { routeDeadline } from "@/lib/ai/ai-call";
import { anonGuard, idList, json, readBody, tableParam } from "@/lib/anonymize/route-helpers";
import { appOrigin, enqueue } from "@/lib/anonymize/service";
import { processInBackground } from "@/lib/anonymize/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ruční / hromadná anonymizace: POST { fileIds?, jobIds?, force?, table? } → zařadí do fronty
 * (force = i done/review/skipped, priorita 0) a zpracuje je sama po odpovědi (after(), runner.ts);
 * interní rozvětvení (kick) jen přidá souběh. Vrací { queued, statuses, skipped }.
 */
export async function POST(req: Request) {
  const start = Date.now();
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const table = tableParam(body.table);
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const fileIds = idList(body.fileIds);
  const jobIds = table === "job_files" ? idList(body.jobIds, 100) : [];
  if (!fileIds.length && !jobIds.length) return json({ error: "Vyber výkresy nebo zakázky." }, 400);
  if (table === "drawing_anon_adhoc") return json({ error: "Samostatný nástroj má vlastní adresu (/adhoc)." }, 400);

  // viditelnost: soubory jen ze zakázek, které uživatel smí otevřít (stejná kontrola jako otevření dokumentu)
  if (table === "job_files" && fileIds.length) {
    const { assertJobFileAccess } = await import("@/lib/jobs/job-file-access");
    for (const id of fileIds) {
      const chk = await assertJobFileAccess(guard.db as never, id, guard.access, "view");
      if (!chk.ok) return json({ error: chk.error }, chk.status);
    }
  }
  // soubory ze zakázek (jobIds) projdou stejnou kontrolou po souborech (nákupní doklady, neschválené nabídky…)
  const allow = table === "job_files"
    ? async (id: string) => {
      const { assertJobFileAccess } = await import("@/lib/jobs/job-file-access");
      return (await assertJobFileAccess(guard.db as never, id, guard.access, "view")).ok;
    }
    : undefined;
  // staré výkresy (backfill) smí ručně předřadit (mimo denní limit) jen super admin
  const res = await enqueue(guard.db, {
    table, fileIds, jobIds, force: body.force === true, priority: 0, via: "rucne", allow, keepBackfill: guard.user.role !== "super_admin",
  });
  const backfill = new Set(res.backfill ?? []);
  const queuedIds = Object.entries(res.statuses).filter(([id, s]) => s === "pending" && !backfill.has(id)).map(([id]) => id);
  if (queuedIds.length) {
    // zpracuje TATO funkce po odpovědi (první soubor hned, bez HTTP volání sama sebe); zbytek se rozvětví
    // kickem na souběžné běhy — když rozvětvení nefunguje (chráněná adresa, 401…), dojede to tady postupně
    processInBackground({
      table, ids: queuedIds, actor: guard.actor, manual: true, deadline: routeDeadline(start), maxFiles: 20,
      origin: appOrigin(req.url), label: "ruční zařazení",
    });
  }
  return json({ ok: true, ...res });
}
