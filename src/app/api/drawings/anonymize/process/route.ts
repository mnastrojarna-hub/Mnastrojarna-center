import { routeDeadline } from "@/lib/ai/ai-call";
import { cronActor } from "@/lib/supabase/actor-headers";
import { anonGuard, idList, json, readBody, tableParam } from "@/lib/anonymize/route-helpers";
import { runnableIds } from "@/lib/anonymize/service";
import { processInBackground } from "@/lib/anonymize/runner";
import { NudgeLimiter, nudgeKey } from "@/lib/anonymize/nudge-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const limiter = new NudgeLimiter();
/** Souběžné běhy jedné zakázky (víc souborů najednou, ale ne bez omezení). */
const MAX_PER_JOB = 2;

/**
 * „Šťouchnutí" do fronty anonymizace od kohokoli, kdo vidí dokumenty zakázky / poptávky (přihlášený,
 * bez CRON_SECRET): POST { jobId? | jobIds?, fileIds?, table? } → čekající soubory, které uživatel smí
 * otevřít, zpracuje TATO funkce po odpovědi (after(), automatika: AI za nahrávajícího, denní limit).
 * Volá ho prohlížeč hned po nahrání a během čekání v Dokumentech / Poptávkách — fronta se tak vyprázdní
 * i bez plánovače a bez funkčního interního rozvětvení. Omezeno: 1× / 8 s na uživatele a zakázku,
 * ≤ 2 běhy na zakázku, ≤ 4 běhy na instanci. Vrací { started, pending, reason? }.
 */
export async function POST(req: Request) {
  const start = Date.now();
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const table = tableParam(body.table);
  if (table === "drawing_anon_adhoc") return json({ error: "Samostatný nástroj má vlastní adresu (/adhoc)." }, 400);
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const fileIds = idList(body.fileIds, 200);
  const jobIds = table === "job_files" ? [...idList(body.jobIds, 20), ...idList([body.jobId], 1)] : [];
  if (!fileIds.length && !jobIds.length) return json({ error: "Vyber výkresy nebo zakázku." }, 400);

  const { db } = guard;
  const candidates = await runnableIds(db, table, { ids: fileIds.length ? fileIds : null, jobIds: jobIds.length ? jobIds : null, limit: 20 });
  if (!candidates.length) return json({ ok: true, started: false, pending: 0 });

  // jen soubory, které uživatel smí otevřít (stejná kontrola jako otevření dokumentu zakázky)
  let allowed = candidates;
  /** Jediná zakázka → běh po svém souboru pokračuje dalšími čekajícími výkresy té zakázky. */
  let singleJob: string | null = null;
  if (table === "job_files") {
    const { assertJobFileAccess } = await import("@/lib/jobs/job-file-access");
    allowed = [];
    for (const id of candidates) if ((await assertJobFileAccess(db as never, id, guard.access, "view")).ok) allowed.push(id);
    if (!allowed.length) return json({ ok: true, started: false, pending: 0 });
    // souběh na zakázku: běží-li už dva živé běhy, ty frontu zakázky dokončí
    const { data: rows } = await db.from("job_files").select("job_id").in("id", allowed);
    const jobs = [...new Set(((rows ?? []) as { job_id: string }[]).map((r) => r.job_id))];
    if (jobs.length === 1) {
      singleJob = jobs[0];
      const { count } = await db.from("job_files").select("id", { count: "exact", head: true })
        .eq("job_id", jobs[0]).eq("anon_status", "processing").gt("anon_lock_until", new Date().toISOString());
      if ((count ?? 0) >= MAX_PER_JOB) return json({ ok: true, started: false, pending: allowed.length, reason: "running" });
    }
  }

  // klíč: konkrétní soubory (po nahrání — každý nový soubor projde hned), jinak zakázka (čekání v Dokumentech)
  const key = nudgeKey(guard.user.id, table, fileIds.length ? allowed : jobIds);
  const slot = limiter.acquire(key);
  if (slot !== "ok") return json({ ok: true, started: false, pending: allowed.length, reason: slot });
  processInBackground({
    table, ...(singleJob ? { jobIds: [singleJob] } : { ids: allowed }), actor: cronActor("drawing-anon"), manual: false,
    deadline: routeDeadline(start), maxFiles: 10, label: "šťouchnutí z UI", onDone: () => limiter.release(),
  });
  return json({ ok: true, started: true, pending: allowed.length });
}
