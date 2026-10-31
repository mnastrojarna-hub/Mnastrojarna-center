"use client";

import * as React from "react";
import { CheckCircle2, Clock, Download, EyeOff, FileArchive, Loader2, Pencil, RefreshCw, ScanSearch, Send, ShieldOff, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cancelQueuedSend, sendQueuedWithOriginals, sendQueuedWithoutPending } from "@/app/actions/drawing-anon";
import { isAnonCandidate } from "@/lib/anonymize/candidate";
import { useAccess } from "@/components/access-provider";
import type { JobFile } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { anonApi, downloadUrl, previewUrl, type AnonTableParam, type SendQueueDto } from "./anon-api";
import { FileAnonBadge } from "./anon-badge";
import { describeCounts, displayReason, isBudgetWait, NOTHING_REMOVED, sendQueueText, sendQueueWhat, type AnonUiStatus } from "./anon-status";

/**
 * Anonymizace v Dokumentech zakázky (spec §6.2): položky menu dokumentu, viditelná akce „Pro dodavatele",
 * ZIP pro dodavatele a hláška o odeslání, které čeká na anonymizaci. Akce jdou přes routy (renderer na serveru).
 */

const EDITABLE = /\.(pdf|jpe?g|png|webp|tiff?)$/i;

/**
 * Může mít dokument anonymní kopii? Stejné pravidlo jako server (isAnonCandidate — externí výkres
 * vhodného typu, ne nákupní doklad dodavatele) a obsah není zamčený (#25).
 */
export function canAnonymize(f: Pick<JobFile, "filename" | "origin" | "issuer" | "kind" | "mimeType" | "locked">): boolean {
  if (f.locked) return false;
  return isAnonCandidate(f.kind, f.filename, f.mimeType ?? null, f.origin ?? null, f.issuer ?? null);
}

export function anonOf(f: JobFile): { status: AnonUiStatus | null; reviewed: boolean; reason: string | null; total: number | null } {
  return {
    status: (f.anon?.status ?? null) as AnonUiStatus | null, reviewed: Boolean(f.anon?.reviewed), reason: f.anon?.reason ?? null,
    total: f.anon && (f.anon.status === "done" || f.anon.status === "review") ? f.anon.total ?? null : null,
  };
}

/** Má smysl ukázat anonymizaci u souboru (kandidát, nebo náš / přeskočený stav s důvodem)? */
function relevant(f: JobFile): boolean {
  if (f.locked) return false;
  if (f.anon?.status === "skipped") return true;
  return canAnonymize(f);
}

export function AnonFileBadge({ file, stalled }: { file: JobFile; stalled?: boolean }) {
  const a = anonOf(file);
  if (!a.status || !relevant(file)) return null;
  return <FileAnonBadge status={a.status} reviewed={a.reviewed} reason={a.reason} total={a.total} backfill={Boolean(file.anon?.backfill)} stalled={stalled} />;
}

/** Výkres čeká / běží na serveru (ne starý výkres z backfillu — ten se sám nespouští). */
export function anonInFlight(f: JobFile): boolean {
  return !f.archived && !f.anon?.backfill && (f.anon?.status === "pending" || f.anon?.status === "processing") && !isBudgetWait(f.anon.status, f.anon.reason);
}

/** Hotová / ke kontrole kopie pro dodavatele (stáhnout smí jen kandidát, ne zamčený). */
export function supplierReady(f: JobFile): boolean {
  return !f.archived && canAnonymize(f) && (f.anon?.status === "done" || f.anon?.status === "review");
}

/**
 * Viditelná akce řádku „Pro dodavatele" (anonymizovaná kopie) — vedle stažení originálu, aby
 * nejzřetelnější stažení u anonymizovaného výkresu nebyl originál zákazníka.
 */
export function ForSupplierLink({ file, onReviewDownload, wrapClassName }: { file: JobFile; onReviewDownload: (f: JobFile) => void; wrapClassName?: string }) {
  const superAdmin = useAccess().role === "super_admin";
  const wrap = (el: React.ReactElement) => (wrapClassName ? <div className={wrapClassName}>{el}</div> : el);
  // formát, který anonymizovat nejde (DWG, Word…): originál ven jen super admin s výslovným potvrzením
  if (!file.archived && file.anon?.status === "unsupported" && canAnonymize(file)) return superAdmin ? wrap(<OriginalForSupplier file={file} />) : null;
  if (!supplierReady(file)) return null;
  const cls = "inline-flex min-h-8 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  // „Ke kontrole" už nevzniká (plná automatika) — hotová kopie se stahuje bez potvrzování
  void onReviewDownload;
  return wrap(
    <a href={downloadUrl(file.id)} className={cls} title={`Anonymizovaná kopie: ${file.anon?.filename ?? ""}`} data-testid="anon-for-supplier">
      <Download className="h-3.5 w-3.5" /> Pro dodavatele
    </a>,
  );
}

/** Text výslovného potvrzení originálu (stejný v ZIPu, u souboru i ve frontě odeslání). */
export const ORIGINAL_CONFIRM = "Poslat ORIGINÁL bez anonymizace (zákazník bude vidět) — potvrzuji jako super admin";

/**
 * „Poslat originál…" u souboru, který anonymizovat nejde (jen super admin): potvrzení s varováním, stažení
 * přes /download?original=1 (server ověří roli a stav, zapíše audit, soubor bez původního názvu).
 */
export function OriginalForSupplier({ file, table }: { file: Pick<JobFile, "id" | "filename" | "anon">; table?: AnonTableParam }) {
  const [open, setOpen] = React.useState(false);
  const [ok, setOk] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOk(false); setOpen(true); }} data-testid="anon-send-original"
        className="inline-flex min-h-8 items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 text-[11px] font-semibold text-red-800 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
        <ShieldOff className="h-3.5 w-3.5" /> Poslat originál…
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-lg">
            <div className="space-y-3 p-5">
              <DialogTitle>Poslat originál bez anonymizace?</DialogTitle>
              <p className="text-sm text-muted-foreground">{file.anon?.reason ?? "Tento formát nejde anonymizovat automaticky."}</p>
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:bg-red-500/10 dark:text-red-100">
                Dodavatel uvidí zákazníka, projektanta i razítko. Soubor se stáhne bez původního názvu a stažení se zapíše do auditu.
              </p>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm text-red-900 dark:border-red-500/30 dark:text-red-100" data-testid="anon-send-original-confirm">
                <input type="checkbox" className="h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {ORIGINAL_CONFIRM}
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
                <Button asChild={ok} variant="send" disabled={!ok}>
                  {ok ? (
                    <a href={downloadUrl(file.id, { table, original: true })} onClick={() => setTimeout(() => setOpen(false), 300)} data-testid="anon-send-original-download">
                      <Download className="h-4 w-4" /> Stáhnout originál
                    </a>
                  ) : <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" /> Stáhnout originál</span>}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Položky menu dokumentu: Stáhnout anonymizovaný · Upravit oblasti · Schválit · Anonymizovat (teď / znovu) · Neanonymizovat. */
export function AnonMenuItems({
  file, onEdit, onAction, onReviewDownload,
}: {
  file: JobFile;
  onEdit: (f: JobFile) => void;
  /** Volání routy s oznámením výsledku. */
  onAction: (f: JobFile, action: "enqueue" | "approve" | "skip") => void;
  /** U „ke kontrole" se před stažením potvrzuje náhled. */
  onReviewDownload: (f: JobFile) => void;
}) {
  const a = anonOf(file);
  void onReviewDownload; // „Ke kontrole" už nevzniká — stažení bez potvrzování
  if (!canAnonymize(file)) return null;
  const ready = a.status === "done" || a.status === "review";
  const waiting = a.status === "pending" || a.status === "processing";
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <EyeOff className="h-3.5 w-3.5" /> Pro dodavatele
      </DropdownMenuLabel>
      {ready && (
        <DropdownMenuItem asChild>
          <a href={downloadUrl(file.id)} data-testid="anon-download"><Download /> Stáhnout anonymizovaný</a>
        </DropdownMenuItem>
      )}
      {(ready || a.status === "failed") && EDITABLE.test(file.filename) && (
        <DropdownMenuItem onSelect={() => onEdit(file)} data-testid="anon-edit">
          <Pencil /> Upravit oblasti…
        </DropdownMenuItem>
      )}
      {a.status === "pending" && (
        <DropdownMenuItem onSelect={() => onAction(file, "enqueue")} data-testid="anon-run">
          <Zap /> Anonymizovat teď{isBudgetWait(a.status, a.reason) ? " (mimo denní limit)" : ""}
        </DropdownMenuItem>
      )}
      {!waiting && a.status !== "unsupported" && (
        <DropdownMenuItem onSelect={() => onAction(file, "enqueue")} data-testid="anon-run">
          {a.status ? <><RefreshCw /> Anonymizovat znovu</> : <><EyeOff /> Anonymizovat</>}
        </DropdownMenuItem>
      )}
      {a.status !== "skipped" && a.status !== "unsupported" && (
        <DropdownMenuItem onSelect={() => onAction(file, "skip")}>
          <ShieldOff /> Neanonymizovat (náš výkres)
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
    </>
  );
}

/** Potvrzení „zkontroloval jsem náhled" před stažením výkresu ke kontrole — s náhledem „Po". */
export function ReviewDownloadDialog({ file, onClose, onEdit }: { file: JobFile; onClose: () => void; onEdit: (f: JobFile) => void }) {
  const [ok, setOk] = React.useState(false);
  const [imgOk, setImgOk] = React.useState(true);
  const empty = file.anon?.total === 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg">
        <div className="space-y-3 p-5">
          <DialogTitle>Výkres je ke kontrole</DialogTitle>
          <p className="text-sm text-muted-foreground">{file.anon?.reason ?? "AI si u tohoto výkresu není jistá."} Před odesláním dodavateli zkontroluj náhled „Po“.</p>
          {empty && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{NOTHING_REMOVED}</p>}
          {EDITABLE.test(file.filename) && (
            <figure className="overflow-hidden rounded-lg border bg-white">
              {imgOk ? (
                <img src={previewUrl(file.id, { variant: "anon", v: file.anon?.at ?? null, w: 1200 })} alt="Náhled „Po“ — co dostane dodavatel" className="max-h-[42vh] w-full object-contain" onError={() => setImgOk(false)} data-testid="anon-review-preview" />
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">Náhled se nepodařilo načíst — otevři ho v editoru.</p>
              )}
              <figcaption className="border-t bg-muted/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground">Po — takhle to dostane dodavatel</figcaption>
            </figure>
          )}
          <label className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 px-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            <input type="checkbox" className="h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Zkontroloval jsem náhled
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => { onClose(); onEdit(file); }}><ScanSearch className="h-4 w-4" /> Otevřít v editoru</Button>
            <Button asChild={ok} variant="send" disabled={!ok}>
              {ok ? <a href={downloadUrl(file.id, { reviewed: true })} onClick={() => setTimeout(onClose, 300)}><Download className="h-4 w-4" /> Stáhnout</a> : <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" /> Stáhnout</span>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Stav kopií pro dodavatele v zakázce: „Pro dodavatele: 2 z 3 připraveno · 1 ke kontrole". */
export function supplierSummary(files: JobFile[]): string | null {
  const cands = files.filter((f) => !f.archived && canAnonymize(f) && f.anon && f.anon.status !== "skipped");
  if (!cands.length) return null;
  const ready = cands.filter((f) => f.anon!.status === "done" || f.anon!.status === "review").length;
  const waiting = cands.filter((f) => f.anon!.status === "pending" || f.anon!.status === "processing").length;
  const failed = cands.filter((f) => f.anon!.status === "failed").length;
  const parts = [`Pro dodavatele: ${ready} z ${cands.length} připraveno`];
  if (waiting) parts.push(`${waiting} čeká`);
  if (failed) parts.push(`${failed} selhalo`);
  return parts.join(" · ");
}

/** „Balíček pro kooperanta (ZIP)": jen anonymizované kopie (ke kontrole s potvrzením), anonymní názvy. */
export function SupplierPackButton({ jobId, files, onEdit }: { jobId: string; files: JobFile[]; onEdit?: (f: JobFile) => void }) {
  const candidates = files.filter((f) => !f.archived && canAnonymize(f) && f.anon && f.anon.status !== "skipped");
  const [open, setOpen] = React.useState(false);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  void onEdit;
  /** Super admin výslovně potvrdil originál bez anonymizace (formát, který anonymizovat nejde). */
  const [originals, setOriginals] = React.useState<Set<string>>(new Set());
  const superAdmin = useAccess().role === "super_admin";
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ url: string | null; included: number; missing: { filename: string; reason: string }[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!candidates.length) return null;

  function openDialog() {
    setSel(new Set(candidates.filter((f) => f.anon?.status === "done" || f.anon?.status === "review").map((f) => f.id)));
    setOriginals(new Set());
    setResult(null);
    setError(null);
    setOpen(true);
  }

  async function build() {
    setBusy(true);
    setError(null);
    const r = await anonApi.supplierPack(jobId, [...sel], [], [...originals].filter((id) => sel.has(id)));
    setBusy(false);
    if (!r.ok) {
      const d = r.data as { missing?: { filename: string; reason: string }[] } | undefined;
      setError(d?.missing?.length ? `${r.error} ${d.missing.map((m) => m.reason).join(" · ")}` : r.error);
      return;
    }
    setResult(r.data);
    if (r.data.url) window.location.assign(r.data.url);
  }

  return (
    <>
      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={openDialog} data-testid="supplier-pack">
        <FileArchive className="h-4 w-4" /> ZIP pro dodavatele
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg">
            <div className="space-y-3 p-5">
              <DialogTitle>Balíček pro kooperanta (ZIP)</DialogTitle>
              <p className="text-sm text-muted-foreground">Jen anonymizované kopie výkresů s anonymními názvy — bez názvu firmy zákazníka. Co nejde přiložit, vypíše CHYBI.txt.</p>
              <ul className="divide-y rounded-lg border">
                {candidates.map((f) => {
                  const st = f.anon!.status;
                  const unsupported = st === "unsupported";
                  const usable = st === "done" || st === "review" || (unsupported && superAdmin && originals.has(f.id));
                  return (
                    <li key={f.id} className="flex flex-col gap-1 px-3 py-2">
                      <label className={cn("flex min-h-11 items-center gap-2 text-sm", !usable && "opacity-60")}>
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0"
                          disabled={!usable}
                          checked={sel.has(f.id)}
                          onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" title={f.filename}>{f.title || f.filename}</span>
                          {f.anon?.filename && <span className="block truncate text-[11px] text-muted-foreground">→ pro dodavatele: {f.anon.filename}</span>}
                        </span>
                        <FileAnonBadge status={st} reviewed={f.anon?.reviewed} reason={f.anon?.reason} total={usable ? f.anon?.total : null} />
                      </label>
                      {unsupported && (
                        <div className="ml-7 space-y-1">
                          {f.anon?.reason && <p className="text-[11px] text-muted-foreground">{f.anon.reason}</p>}
                          {superAdmin && (
                            <label className="flex min-h-9 items-center gap-2 text-xs text-red-800 dark:text-red-300" data-testid="supplier-pack-original">
                              <input type="checkbox" className="h-4 w-4" checked={originals.has(f.id)}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setOriginals((s) => { const n = new Set(s); if (on) n.add(f.id); else n.delete(f.id); return n; });
                                  setSel((s) => { const n = new Set(s); if (on) n.add(f.id); else n.delete(f.id); return n; });
                                }} />
                              {ORIGINAL_CONFIRM}
                            </label>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
              {result && (
                <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                  Hotovo: {result.included} {result.included === 1 ? "soubor" : result.included < 5 ? "soubory" : "souborů"}{result.missing.length ? ` · chybí ${result.missing.length} (viz CHYBI.txt)` : ""}.
                  {result.url && <> <a href={result.url} className="font-semibold underline">Stáhnout znovu</a> (odkaz platí 7 dní)</>}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Zavřít</Button>
                <Button variant="send" onClick={() => void build()} disabled={busy || sel.size === 0} data-testid="supplier-pack-build">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />} Vytvořit ZIP ({sel.size})
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Souhrn anonymizace dokumentu (pod názvem): co se smazalo, nebo důvod (vidět i na mobilu, ne jen v tooltipu). */
export function AnonSummaryLine({ file, onRetry, stalled }: { file: JobFile; onRetry?: (f: JobFile) => void; stalled?: boolean }) {
  const a = file.anon;
  if (!a || !relevant(file)) return null;
  const reason = displayReason(a.status, a.reason);
  const retry = onRetry && (a.status === "failed" || stalled) ? (
    <button type="button" onClick={() => onRetry(file)} data-testid="anon-retry"
      className="ml-1 inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold text-foreground hover:bg-muted">
      <RefreshCw className="h-3 w-3" /> Zkusit znovu
    </button>
  ) : null;
  if (stalled && (a.status === "pending" || a.status === "processing")) {
    return <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">Anonymizace se nerozběhla.{retry}</p>;
  }
  if (a.status === "failed" || a.status === "unsupported") {
    if (!reason && !retry) return null;
    return <p className={cn("mt-0.5 text-[11px]", a.status === "failed" ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>{reason}{retry}</p>;
  }
  if (a.status === "pending" && isBudgetWait(a.status, a.reason)) return <p className="mt-0.5 text-[11px] text-muted-foreground">{a.reason}</p>;
  if (a.status !== "done" && a.status !== "review") return null;
  const c = describeCounts(a.counts);
  return (
    <>
      {!c && a.total === 0 ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{NOTHING_REMOVED}</p>
      ) : (c || a.excludedPages.length > 0) && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {c && <>Pro dodavatele smazáno: {c}</>}
          {a.excludedPages.length > 0 && <>{c ? " · " : ""}vyřazené strany {a.excludedPages.join(", ")}</>}
        </p>
      )}
    </>
  );
}

/**
 * Odeslání čekající na anonymizaci: „Odejde po dokončení anonymizace (2 výkresy)" + Zrušit /
 * Odeslat hned bez těchto výkresů; zablokované → „Zkontrolovat výkres". Jen čte frontu a volá akce
 * fronty (odesílací akce nemění).
 */
export function SendQueueNotice({ jobId, refreshKey, files = [], onEdit }: { jobId: string; refreshKey?: string; files?: JobFile[]; onEdit?: (f: JobFile) => void }) {
  const [items, setItems] = React.useState<SendQueueDto[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await anonApi.sendQueue(jobId);
    if (r.ok) setItems(r.data.items.filter((i) => i.status === "waiting" || i.status === "blocked" || i.status === "sending" || i.status === "failed"));
  }, [jobId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);
  React.useEffect(() => {
    if (!items.some((i) => i.status === "waiting" || i.status === "sending")) return;
    const t = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(t);
  }, [items, load]);

  async function act(id: string, kind: "cancel" | "send") {
    setBusy(id);
    setError(null);
    try {
      const r = kind === "cancel" ? await cancelQueuedSend(id) : await sendQueuedWithoutPending(id);
      if (!r.ok) setError(r.error);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    }
    setBusy(null);
    void load();
  }

  /** „Poslat originál…" (super admin): potvrzení v dialogu → server ověří roli, zapíše audit a odešle. */
  const [originalFor, setOriginalFor] = React.useState<SendQueueDto | null>(null);
  const [confirmOk, setConfirmOk] = React.useState(false);
  async function sendOriginal(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await sendQueuedWithOriginals(id, true);
      if (!r.ok) setError(r.error);
      else setOriginalFor(null);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    }
    setBusy(null);
    void load();
  }

  if (!items.length) return null;
  return (
    <div className="space-y-2" data-testid="send-queue-notice">
      {items.map((q) => {
        const { what } = sendQueueWhat(q.kind);
        const blocked = q.status === "blocked";
        const problem = blocked || q.status === "failed" || (q.status === "waiting" && Boolean(q.reason));
        const blocking = q.blockingFileId ? files.find((f) => f.id === q.blockingFileId) ?? null : null;
        return (
          <div key={q.id} className={cn("flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-sm sm:flex-row sm:items-center",
            problem ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
              : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100")}>
            <span className="flex flex-1 items-start gap-2">
              {q.status === "sending" || (q.status === "waiting" && q.pendingCount === 0 && !q.reason) ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                : problem ? <Clock className="mt-0.5 h-4 w-4 shrink-0" /> : <Send className="mt-0.5 h-4 w-4 shrink-0" />}
              <span><strong>{what}{q.to ? ` (${q.to})` : ""}</strong> {sendQueueText(q)}</span>
            </span>
            {q.mine && (q.status === "waiting" || q.status === "blocked") && (
              <span className="flex flex-wrap gap-2">
                {blocked && blocking && onEdit && (
                  <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onEdit(blocking)} data-testid="send-queue-review">
                    <ScanSearch className="h-4 w-4" /> Otevřít výkres
                  </Button>
                )}
                {q.canSendOriginal && (
                  <Button size="sm" variant="outline" className="min-h-11 border-red-300 text-red-800 sm:min-h-8 dark:text-red-200" disabled={busy === q.id}
                    onClick={() => { setConfirmOk(false); setOriginalFor(q); }} data-testid="send-queue-original">
                    <ShieldOff className="h-4 w-4" /> Poslat originál…
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" disabled={busy === q.id} onClick={() => void act(q.id, "cancel")}><X className="h-4 w-4" /> Zrušit</Button>
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy === q.id} onClick={() => void act(q.id, "send")}>
                  {busy === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Odeslat hned bez těchto výkresů
                </Button>
              </span>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {originalFor && (
        <Dialog open onOpenChange={(o) => !o && busy === null && setOriginalFor(null)}>
          <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-lg">
            <div className="space-y-3 p-5">
              <DialogTitle>Poslat originál bez anonymizace?</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {originalFor.unsupportedCount === 1 ? "1 soubor" : `${originalFor.unsupportedCount ?? 0} soubory`} v tomto odeslání nejde anonymizovat automaticky
                (např. DWG, Word). Ostatní výkresy odejdou jen jako anonymizované kopie.
              </p>
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900 dark:bg-red-500/10 dark:text-red-100">
                Dodavatel uvidí zákazníka, projektanta i razítko. Originál odejde bez původního názvu a zapíše se do auditu.
              </p>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm text-red-900 dark:border-red-500/30 dark:text-red-100" data-testid="send-queue-original-confirm">
                <input type="checkbox" className="h-5 w-5" checked={confirmOk} onChange={(e) => setConfirmOk(e.target.checked)} /> {ORIGINAL_CONFIRM}
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setOriginalFor(null)} disabled={busy !== null}>Zrušit</Button>
                <Button variant="send" disabled={!confirmOk || busy !== null} onClick={() => void sendOriginal(originalFor.id)} data-testid="send-queue-original-send">
                  {busy === originalFor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Odeslat s originálem
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
