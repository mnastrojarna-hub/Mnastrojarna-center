"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowLeftRight, Building2, CheckCircle2, Combine, Info, Loader2, Search, ShieldAlert,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/jobs/stage-badge";
import { mergeJobs, previewJobMerge, searchMergeCandidates } from "@/app/actions/job-merge";
import {
  MERGE_RULE_LABELS, canConfirmMerge, czPlural, mergeBlockers, mergeCountLines, mergeForceConflicts, mergeNotices,
  type MergeCandidate, type MergeCandidateReason, type MergeConflict, type MergePreview,
} from "@/lib/jobs/job-merge-types";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { DialogHead, ErrorBox } from "./confirm-dialog";

/**
 * „Sloučit s jinou zakázkou…" (#24): vyber druhou zakázku (hledání podle čísla, zákazníka, výkresu;
 * návrhy stejný zákazník / stejný výkres / nedávné) → náhled (co se přesune, konflikty, co vyhraje) →
 * potvrdit. Po sloučení přejde na zakázku, která zůstala.
 */

const REASON_LABEL: Record<MergeCandidateReason, string> = {
  capture: "Ze stejného focení",
  drawing: "Stejný výkres",
  customer: "Stejný zákazník",
  recent: "Nedávné zakázky",
  search: "Nalezeno",
};

/** Čip důvodu u kandidáta (jen silné důvody). */
const REASON_CHIP: Partial<Record<MergeCandidateReason, string>> = {
  capture: "stejné focení",
  drawing: "stejný výkres",
  customer: "stejný zákazník",
};

function newToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // záložní v4 (starší prohlížeče)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function MergeJobDialog({ job, open, onOpenChange }: { job: JobDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [other, setOther] = React.useState<MergeCandidate | null>(null);
  React.useEffect(() => {
    if (!open) setOther(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[2%] flex max-h-[96dvh] w-[calc(100%-1rem)] flex-col sm:top-[6%] sm:max-h-[88vh] sm:max-w-2xl"
      >
        <DialogHead
          icon={Combine}
          tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          title="Sloučit s jinou zakázkou"
          subtitle={other ? `${job.number} a ${other.number} — zkontroluj, co se přesune` : `Vyber duplicitní zakázku k ${job.number}`}
        />
        {other
          ? <MergePreviewStep job={job} other={other} onBack={() => setOther(null)} onDone={() => onOpenChange(false)} />
          : <PickStep job={job} onPick={setOther} />}
      </DialogContent>
    </Dialog>
  );
}

// ── 1) Výběr druhé zakázky ──────────────────────────────────
export function PickStep({ job, onPick, initial }: { job: JobDetail; onPick: (c: MergeCandidate) => void; initial?: MergeCandidate[] }) {
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<MergeCandidate[] | null>(initial ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await searchMergeCandidates(job.id, q);
        if (my !== seq.current) return;
        if (res.ok) { setList(res.candidates); setError(null); } else setError(res.error);
      } catch {
        if (my === seq.current) setError("Spojení se nepovedlo — zkus to znovu.");
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [job.id, q]);

  const groups = React.useMemo(() => {
    const out: { reason: MergeCandidateReason; items: MergeCandidate[] }[] = [];
    for (const c of list ?? []) {
      const r = c.reason ?? "search";
      let g = out.find((x) => x.reason === r);
      if (!g) { g = { reason: r, items: [] }; out.push(g); }
      g.items.push(c);
    }
    return out;
  }, [list]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 sm:px-5">
        <label className="relative block">
          <span className="sr-only">Hledat zakázku</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Číslo, zákazník, objednávka, výkres…"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
          {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Zakázka, kterou vybereš, se sloučí do <strong className="text-foreground">{job.number}</strong> (směr jde v dalším kroku prohodit).
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
        <div className="px-2"><ErrorBox error={error} /></div>
        {list && !list.length && !busy && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {q ? "Nic nenalezeno — zkus číslo zakázky nebo výkresu." : "Žádné návrhy — napiš číslo zakázky, zákazníka nebo výkresu."}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.reason} className="mb-2" aria-label={REASON_LABEL[g.reason]}>
            <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{REASON_LABEL[g.reason]}</h3>
            <ul className="space-y-1">
              {g.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    data-testid="merge-candidate"
                    className="flex w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-left transition hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-sm font-bold">{c.number}</span>
                      <StageBadge stage={c.stage} size="xs" />
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDay(c.createdAt)}</span>
                    </span>
                    <span className="truncate text-sm">{c.title || "Bez názvu"}</span>
                    {(c.reasons ?? []).some((r) => REASON_CHIP[r]) && (
                      <span className="flex flex-wrap gap-1" data-testid="merge-candidate-reasons">
                        {(c.reasons ?? []).filter((r) => REASON_CHIP[r]).map((r) => (
                          <span key={r} className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300">
                            {REASON_CHIP[r]}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {c.customer && <span className="inline-flex min-w-0 items-center gap-1"><Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{c.customer}</span></span>}
                      {c.customerOrderNumber && <span>obj. <span className="font-mono text-foreground">{c.customerOrderNumber}</span></span>}
                      {c.drawingNumbers.slice(0, 3).map((d) => (
                        <span key={d} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{d}</span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" }).format(d);
}

// ── 2) Náhled a potvrzení ───────────────────────────────────
function MergePreviewStep({ job, other, onBack, onDone }: { job: JobDetail; other: MergeCandidate; onBack: () => void; onDone: () => void }) {
  const router = useRouter();
  // výchozí směr: zůstane otevřená zakázka, druhá se do ní sloučí — kromě případu, kdy je druhá dál
  // (např. otevřená Z-014 s nabídkou × Z-013 s objednávkou): pak jednou sám prohodí a řekne proč
  const [swap, setSwap] = React.useState(false);
  const [autoSwapped, setAutoSwapped] = React.useState<{ keep: string; stage: MergePreview["stage"]["to"] } | null>(null);
  const autoTried = React.useRef(false);
  const targetId = swap ? other.id : job.id;
  const sourceId = swap ? job.id : other.id;
  const [preview, setPreview] = React.useState<MergePreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [force, setForce] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const token = React.useRef<string>(newToken());

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    setForce(false);
    token.current = newToken();
    previewJobMerge(targetId, sourceId).then((res) => {
      if (!alive) return;
      if (!res.ok) { setError(res.error); return; }
      const p = res.preview;
      if (!autoTried.current) {
        autoTried.current = true;
        // druhá zakázka je dál (STAGE_ADVANCE) a sloučení opačně nic neblokuje → ponechat tu, která je dál
        if (!swap && p.ok && p.conflicts.some((c) => c.code === "STAGE_ADVANCE")) {
          setAutoSwapped({ keep: p.source.number, stage: p.source.stage });
          setSwap(true);
          return;                                    // náhled se načte znovu pro prohozený směr
        }
      }
      setPreview(p);
    }).catch(() => alive && setError("Spojení se nepovedlo — zkus to znovu.")).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // swap čte jen první pokus o automatické prohození (autoTried)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, sourceId]);

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mergeJobs({ targetId, sourceId, token: token.current, force, reason });
      if (!res.ok) { setError(res.error); return; }
      const r = res.result;
      onDone();
      // nová adresa = čerstvá data cíle ze serveru (akce už zneplatnila cache); co se přesunulo a
      // případná upozornění ukáže banner na cíli (žádný toast navíc — na mobilu by zabral obrazovku)
      router.push(`/orders/${r.targetId}?slouceno=${encodeURIComponent(r.sourceNumber)}`);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {loading && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Připravuji náhled sloučení…
          </div>
        )}
        <ErrorBox error={error} />
        {preview && autoSwapped && swap && preview.target.number === autoSwapped.keep && (
          <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200" data-testid="merge-auto-swap">
            <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Ponechám <span className="whitespace-nowrap font-mono font-semibold">{autoSwapped.keep}</span> — je dál
              ({stageMeta(autoSwapped.stage).label}). Chceš-li opak, dej „Prohodit směr“.
            </span>
          </p>
        )}
        {preview && <MergePreviewBody preview={preview} onSwap={() => setSwap((v) => !v)} force={force} setForce={setForce} reason={reason} setReason={setReason} />}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="h-4 w-4" /> Vybrat jinou
        </Button>
        <Button
          type="button"
          onClick={() => void confirm()}
          disabled={busy || loading || !preview || !canConfirmMerge(preview, { enabled: force, reason })}
          data-testid="merge-confirm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Combine className="h-4 w-4" />}
          {preview ? `Sloučit do ${preview.target.number}` : "Sloučit"}
        </Button>
      </div>
    </div>
  );
}

/** Obsah náhledu (bez načítání — testuje ho i render test). */
export function MergePreviewBody({ preview: p, onSwap, force, setForce, reason, setReason }: {
  preview: MergePreview;
  onSwap?: () => void;
  force: boolean;
  setForce: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
}) {
  const blockers = mergeBlockers(p);
  const forceList = mergeForceConflicts(p);
  // „druhá zakázka je dál" patří nad karty (rozhoduje o směru); ostatní upozornění hned pod ně —
  // ne až na konec náhledu (na mobilu by zůstala pod okrajem a potvrzení je přilepené dole)
  const all = mergeNotices(p);
  const direction = all.filter((c) => c.code === "STAGE_ADVANCE");
  const notices = all.filter((c) => c.code !== "STAGE_ADVANCE");
  const lines = mergeCountLines(p.counts).filter((l) => l.key !== "events");
  const events = p.counts.events;
  return (
    <>
      {direction.map((c, i) => <ConflictBox key={`d${i}`} c={c} />)}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <JobCard label="Sloučí se (zruší se jako duplicita)" job={p.source} tone="source" />
        <div className="flex items-center justify-center gap-2 sm:flex-col">
          <ArrowDown className="h-4 w-4 text-muted-foreground sm:-rotate-90" aria-hidden />
          {onSwap && (
            <Button type="button" variant="outline" size="sm" onClick={onSwap} title="Prohodit, která zakázka zůstane" data-testid="merge-swap">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Prohodit směr
            </Button>
          )}
        </div>
        <JobCard label="Zůstane" job={p.target} tone="target" />
      </div>

      {blockers.length === 0 && notices.map((c, i) => <ConflictBox key={`n${i}`} c={c} />)}
      {blockers.map((c, i) => <ConflictBox key={`b${i}`} c={c} />)}
      {forceList.map((c, i) => <ConflictBox key={`f${i}`} c={c} />)}
      {forceList.length > 0 && blockers.length === 0 && (
        p.canForce ? (
          <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={force} onChange={(e) => setForce(e.target.checked)} data-testid="merge-force" />
              <span>Vím, co dělám — sloučit i přes upozornění (jen super admin).</span>
            </label>
            {force && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Důvod (zapíše se do historie)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="merge-reason"
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Tyhle zakázky sloučí jen super admin — požádej ho.</p>
        )
      )}

      {blockers.length === 0 && (
        <>
          <section aria-label="Co se přesune" className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-semibold">Do <Num>{p.target.number}</Num> se přesune</h3>
            {lines.length ? (
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {lines.map((l) => (
                  <li key={l.key} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />{l.text}</li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Zakázka {p.source.number} nemá nic k přesunu — jen se uzavře.</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              {events > 0 ? `Historie (${czPlural(events, ["záznam", "záznamy", "záznamů"])}) se přesune s odkazem odkud. ` : ""}
              {p.counts.filesDuplicate > 0
                ? `${czPlural(p.counts.filesDuplicate, ["dokument", "dokumenty", "dokumentů"])} se stejným obsahem už v ${p.target.number} je — uloží se jako archivovaná kopie. `
                : ""}
              Zakázka {p.source.number} zůstane v historii jako „Zrušeno — sloučeno do {p.target.number}“ a její odkaz povede sem; číslo se znovu nepoužije.
            </p>
          </section>

          <section aria-label="Stav po sloučení" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Stav po sloučení:</span>
            <StageBadge stage={p.stage.to} size="sm" />
            {p.stage.to !== p.stage.from && <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">(teď <StageBadge stage={p.stage.from} size="xs" />)</span>}
            {p.acceptQuote && (
              <span className="text-xs text-muted-foreground">· nabídka <strong className="font-mono text-foreground">{p.acceptQuote.number}</strong> se označí jako přijatá</span>
            )}
          </section>

          {p.fields.length > 0 && (
            <section aria-label="Hodnoty" className="rounded-lg border">
              <h3 className="border-b px-3 py-2 text-sm font-semibold">Hodnoty (vyhrává <Num>{p.target.number}</Num>, prázdné doplní <Num>{p.source.number}</Num>)</h3>
              <ul className="divide-y">
                {p.fields.map((f) => (
                  <li key={f.field} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[11rem_1fr] sm:gap-3">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="min-w-0 whitespace-pre-line break-words font-medium">{f.result ?? "—"}</span>
                        <RuleChip rule={f.rule} />
                      </span>
                      {f.rule === "keep" && f.source && (
                        <span className="block break-words text-xs text-muted-foreground">{p.source.number}: <s>{f.source}</s></span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {blockers.length > 0 && notices.map((c, i) => <ConflictBox key={`n${i}`} c={c} />)}
    </>
  );
}

/** Číslo zakázky se nezalomí („Z-↵2026-014"). */
function Num({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

function RuleChip({ rule }: { rule: MergePreview["fields"][number]["rule"] }) {
  const tone = rule === "keep" ? "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"
    : rule === "admin_only" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", tone)}>{MERGE_RULE_LABELS[rule]}</span>;
}

function JobCard({ label, job, tone }: { label: string; job: MergePreview["target"]; tone: "source" | "target" }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-3",
        tone === "target" ? "border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
          : "border-dashed bg-muted/40",
      )}
      data-testid={tone === "target" ? "merge-target" : "merge-source"}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold">{job.number}</span>
        <StageBadge stage={job.stage} size="xs" />
      </div>
      <div className="mt-0.5 truncate text-sm">{job.title || "Bez názvu"}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {job.customer ?? "Bez zákazníka"}{job.customerOrderNumber ? ` · obj. ${job.customerOrderNumber}` : ""}
      </div>
    </div>
  );
}

function ConflictBox({ c }: { c: MergeConflict }) {
  const meta = c.level === "block"
    ? { icon: ShieldAlert, cls: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" }
    : c.level === "force"
      ? { icon: AlertTriangle, cls: "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" }
      : { icon: Info, cls: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200" };
  const Icon = meta.icon;
  return (
    <div role={c.level === "block" ? "alert" : undefined} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", meta.cls)} data-testid={`merge-conflict-${c.level}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{c.message}</span>
    </div>
  );
}
