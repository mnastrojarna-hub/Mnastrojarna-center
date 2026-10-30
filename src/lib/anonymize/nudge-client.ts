/**
 * Prohlížeč: „šťouchnutí" do fronty anonymizace (POST /api/drawings/anonymize/process) — hned po nahrání
 * výkresu a během čekání v Dokumentech / Poptávkách / Archivu. Zpracování běží na serveru v routě
 * (after()), sem nevede žádný renderer. Nikdy nehází; keepalive = dojde i při zavření stránky.
 */

export interface NudgeInput {
  table?: "job_files" | "drawings";
  jobId?: string | null;
  jobIds?: string[];
  fileIds?: string[];
}

export interface NudgeResult {
  ok: boolean;
  started: boolean;
  pending: number;
  reason?: string;
  error?: string;
}

export async function nudgeAnonymize(input: NudgeInput): Promise<NudgeResult> {
  const body = {
    table: input.table ?? "job_files",
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.jobIds?.length ? { jobIds: input.jobIds.slice(0, 20) } : {}),
    ...(input.fileIds?.length ? { fileIds: input.fileIds.slice(0, 200) } : {}),
  };
  if (!("jobId" in body) && !("jobIds" in body) && !("fileIds" in body)) return { ok: true, started: false, pending: 0 };
  try {
    const res = await fetch("/api/drawings/anonymize/process", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Partial<NudgeResult> & { error?: string };
    if (!res.ok) return { ok: false, started: false, pending: 0, error: data.error ?? `Chyba ${res.status}` };
    return { ok: true, started: Boolean(data.started), pending: Number(data.pending ?? 0), reason: data.reason };
  } catch {
    return { ok: false, started: false, pending: 0, error: "Spojení se nepovedlo." };
  }
}
