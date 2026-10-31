"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, CheckCircle2, Loader2, RefreshCw, ScanSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { anonApi, previewUrl } from "./anon-api";
import { FileAnonBadge } from "./anon-badge";
import { describeCounts, displayReason, drawingsWord, NOTHING_REMOVED, type AnonUiStatus } from "./anon-status";
import { AnonymizeEditor } from "./anonymize-editor";

/**
 * Sekce „Anonymizace výkresů" (Poptávky): výkresy, jejichž anonymizace se technicky nepovedla, s důvodem
 * a „Anonymizovat znovu"; hromadně „Anonymizovat vše, co čeká (n)". „Ke kontrole" už nevzniká (plná
 * automatika, majitel 31. 10.) — starší řádek „ke kontrole" (před migrací) ukáže Zkontrolovat / Schválit.
 */

export interface AnonReviewRowView {
  id: string;
  jobId: string;
  jobNumber: string | null;
  jobTitle: string | null;
  filename: string;
  anonFilename: string | null;
  status: AnonUiStatus;
  reason: string | null;
  counts: Record<string, number>;
  at: string | null;
  /** Počet smazaných oblastí (null = neznámý). */
  total?: number | null;
  /** Výřez miniatury (razítko kolem smazaných oblastí). */
  crop?: { x: number; y: number; w: number; h: number } | null;
  /** Strana originálu pro miniaturu (první zahrnutá). */
  page?: number;
}

const PREVIEWABLE = /\.(pdf|jpe?g|png|webp|tiff?)$/i;
const PHOTO = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;

/** Jedním klepnutím schválit jen když se něco smazalo a nejde o fotku (jinak přes editor). */
export function approveDirectly(it: Pick<AnonReviewRowView, "filename" | "counts" | "total">): boolean {
  const total = typeof it.total === "number" ? it.total : Object.values(it.counts ?? {}).reduce((s, n) => s + (n || 0), 0);
  return total > 0 && !PHOTO.test(it.filename);
}

/** Čip v hlavičce Poptávek „N ke kontrole ↓" → sjede na sekci. */
export function AnonReviewChip({ count }: { count: number }) {
  React.useEffect(() => {
    // odkaz z Dashboardu (/inquiries#anonymizace): stránka se streamuje, prohlížeč na kotvu sám nesjede
    if (typeof window === "undefined" || window.location.hash !== "#anonymizace") return;
    const t = window.setTimeout(() => document.getElementById("anonymizace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <a
      href="#anonymizace"
      onClick={(e) => { e.preventDefault(); document.getElementById("anonymizace")?.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", "#anonymizace"); }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
      data-testid="anon-review-chip"
    >
      <AlertTriangle className="h-3.5 w-3.5" /> {drawingsWord(count)} — anonymizace se nepovedla <ArrowDown className="h-3.5 w-3.5" />
    </a>
  );
}

export function AnonReviewList({ items, pendingFileIds, pendingCount }: { items: AnonReviewRowView[]; pendingFileIds: string[]; pendingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = React.useState<AnonReviewRowView | null>(null);
  const [done, setDone] = React.useState<Set<string>>(new Set());

  async function approve(it: AnonReviewRowView) {
    setBusy(it.id);
    const r = await anonApi.approve(it.id);
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setDone((s) => new Set(s).add(it.id));
    setMsg({ tone: "ok", text: `${it.filename} schválen${it.anonFilename ? ` (pro dodavatele: ${it.anonFilename})` : ""} — může jít dodavateli.` });
    router.refresh();
  }

  async function retry(it: AnonReviewRowView) {
    setBusy(it.id);
    const r = await anonApi.enqueue({ fileIds: [it.id], force: true });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setMsg({ tone: "ok", text: `${it.filename}: anonymizuje se znovu…` });
    router.refresh();
  }

  async function bulk() {
    setBusy("bulk");
    const r = await anonApi.enqueue({ fileIds: pendingFileIds });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    const later = r.data.backfill?.length ?? 0;
    setMsg({ tone: "ok", text: `Zařazeno ${drawingsWord(r.data.queued)} — za chvíli budou hotové.${later ? ` Starší výkresy (${later}) poběží v rámci denního limitu.` : ""}` });
    router.refresh();
  }

  const visible = items.filter((i) => !done.has(i.id));

  return (
    <div className="space-y-2" data-testid="anon-review">
      {pendingCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-sm text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100 sm:flex-row sm:items-center">
          <span className="flex-1">
            <strong>{pendingCount}</strong> {pendingCount === 1 ? "výkres čeká" : pendingCount < 5 ? "výkresy čekají" : "výkresů čeká"} na anonymizaci.
          </span>
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy === "bulk" || !pendingFileIds.length} onClick={() => void bulk()} data-testid="anon-bulk">
            {busy === "bulk" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Anonymizovat vše, co čeká ({pendingCount})
          </Button>
        </div>
      )}
      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2 text-sm", msg.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200")}>
          {msg.text}
        </p>
      )}
      <ul className="space-y-2">
        {visible.map((it) => {
          const counts = describeCounts(it.counts);
          const empty = it.status === "review" && !counts;
          const direct = approveDirectly(it);
          const reason = displayReason(it.status, it.reason);
          const canPreview = it.status === "review" && PREVIEWABLE.test(it.filename);
          return (
            <li key={it.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center" data-testid="anon-review-item">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <button
                  type="button"
                  className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border bg-white disabled:cursor-default"
                  onClick={() => setEditing(it)}
                  disabled={!canPreview}
                  aria-label={canPreview ? `Otevřít náhled — ${it.filename}` : undefined}
                >
                  {canPreview ? (
                    <img src={previewUrl(it.id, { variant: "anon", v: it.at, w: 320, box: it.crop ?? null, page: it.page })} alt="Po — výřez kolem smazaného" loading="lazy" decoding="async" className="h-full w-full object-contain" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground"><ScanSearch className="h-6 w-6" /></span>
                  )}
                </button>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium" title={it.filename}>{it.filename}</span>
                    <FileAnonBadge status={it.status} reason={reason} />
                  </div>
                  {it.anonFilename && <p className="truncate text-[11px] text-muted-foreground">→ pro dodavatele: <span className="font-mono">{it.anonFilename}</span></p>}
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/orders/${it.jobId}?tab=dokumenty`} className="font-mono font-semibold text-foreground/80 hover:underline">{it.jobNumber ?? "zakázka"}</Link>
                    {it.jobTitle ? ` · ${it.jobTitle}` : ""}
                  </p>
                  {reason && <p className={cn("text-xs", it.status === "failed" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300")}>{reason}</p>}
                  {counts && <p className="text-xs"><span className="text-muted-foreground">Smaže se:</span> {counts}</p>}
                  {empty && <p className="flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {NOTHING_REMOVED}</p>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {it.status === "failed" ? (
                  <Button size="sm" variant="outline" className="min-h-11 flex-1 sm:min-h-9" disabled={busy === it.id} onClick={() => void retry(it)}>
                    {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Anonymizovat znovu
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="min-h-11 flex-1 sm:min-h-9" onClick={() => setEditing(it)} data-testid="anon-review-open">
                      <ScanSearch className="h-4 w-4" /> Zkontrolovat
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      className="min-h-11 flex-1 sm:min-h-9"
                      disabled={busy === it.id}
                      onClick={() => (direct ? void approve(it) : setEditing(it))}
                      data-testid="anon-review-approve"
                      data-approve={direct ? "direct" : "editor"}
                      title={direct ? undefined : "Nejdřív zkontroluj náhled — schválíš v editoru"}
                    >
                      {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Schválit{direct ? "" : "…"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <AnonymizeEditor
          open
          onOpenChange={(o) => { if (!o) { setEditing(null); router.refresh(); } }}
          fileId={editing.id}
          sourceName={editing.filename}
          title={`Zkontrolovat — ${editing.filename}`}
        />
      )}
    </div>
  );
}
