"use client";

import * as React from "react";
import { AlertTriangle, Camera, Download, EyeOff, FileText, Loader2, Pencil, RefreshCw, Share2, ShieldCheck, Upload } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, relativeTime } from "@/lib/utils";
import { anonApi, downloadUrl, previewUrl, type AdhocItemDto } from "./anon-api";
import { FileAnonBadge } from "./anon-badge";
import { describeCounts, displayReason, NOTHING_REMOVED, type AnonUiStatus } from "./anon-status";
import { AnonymizeEditor } from "./anonymize-editor";
import { regionsBox, type NBox } from "./editor-geometry";

/**
 * Samostatný nástroj „Anonymizovat výkres" (Poptávky — velín): vyfotit / vybrat libovolný výkres (i bez
 * zakázky) → server smaže firmu, kdo kreslil, logo a cesty na disk → stáhnout / sdílet dodavateli.
 * Asynchronně s dotazováním na stav (přežije přepnutí aplikace na iOS), seznam „Moje anonymizace" 7 dní.
 * Náhled Před / Po je výřez kolem smazaných míst (razítko) se zvýrazněnými oblastmi; klepnutí otevře editor.
 */

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.heic,.heif,.dxf,.stp,.step,application/pdf,image/*";
const SUPPORTED = /\.(pdf|jpe?g|png|webp|tiff?|heic|heif|dxf|stp|step)$/i;
const MAX_BYTES = 50 * 1024 * 1024;
const BUSY = new Set(["uploading", "pending", "processing"]);
const POLL_MS = 2500;

/** Nepodporovaný soubor odmítne už v prohlížeči (accept nezastaví přetažení ani výběr na mobilu). */
export function toolRejectReason(f: { name: string; size: number }): string | null {
  if (!SUPPORTED.test(f.name)) return "Nelze anonymizovat — tento formát (např. DWG, SolidWorks) neumíme. Pošli PDF, fotku, DXF nebo STEP.";
  if (f.size > MAX_BYTES) return "Soubor je větší než 50 MB — pošli menší nebo ho rozděl.";
  return null;
}

interface Item {
  id: string;
  filename: string;
  status: string;
  reason: string | null;
  counts: Record<string, number>;
  total: number | null;
  at: string | null;
  createdAt: string;
  error?: string;
  local?: boolean;
}

function fromDto(d: AdhocItemDto): Item {
  return {
    id: d.id, filename: d.filename, status: d.anon_status, reason: d.anon_reason, counts: d.anon_summary?.counts ?? {},
    total: typeof d.anon_summary?.total === "number" ? d.anon_summary.total : null, at: d.anon_at, createdAt: d.created_at,
  };
}

const hasPreview = (name: string) => /\.(pdf|jpe?g|png|webp|tiff?)$/i.test(name);

export function AnonymizeToolButton({ label = "Anonymizovat výkres", variant = "outline", className }: { label?: string; variant?: ButtonProps["variant"]; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)} data-testid="anon-tool-open">
        <EyeOff className="h-4 w-4" /> {label}
      </Button>
      {open && <AnonymizeToolDialog open onOpenChange={setOpen} />}
    </>
  );
}

export function AnonymizeToolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Item | null>(null);
  const [drag, setDrag] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const refreshList = React.useCallback(async () => {
    const r = await anonApi.adhocList();
    setLoaded(true);
    if (!r.ok) return setError(r.error);
    setItems((prev) => {
      const server = r.data.items.map(fromDto);
      const localOnly = prev.filter((p) => p.local && !server.some((s) => s.id === p.id));
      return [...localOnly, ...server];
    });
  }, []);

  React.useEffect(() => {
    if (open) void refreshList();
  }, [open, refreshList]);

  // dotazování na rozpracované (+ po návratu do aplikace)
  const busyIds = items.filter((i) => BUSY.has(i.status) && !i.error && !i.id.startsWith("tmp-")).map((i) => i.id).join(",");
  React.useEffect(() => {
    if (!open || !busyIds) return;
    let stop = false;
    const tick = async () => {
      for (const id of busyIds.split(",")) {
        const r = await anonApi.adhocState(id);
        if (stop || !r.ok) continue;
        setItems((prev) => prev.map((p) => (p.id === id ? {
          ...p, status: r.data.status, reason: r.data.reason, counts: r.data.summary?.counts ?? {},
          total: typeof r.data.summary?.total === "number" ? r.data.summary.total : null, local: false,
        } : p)));
      }
    };
    const t = window.setInterval(() => void tick(), POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    void tick();
    return () => { stop = true; window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [open, busyIds]);

  async function addFiles(files: FileList | File[]) {
    setError(null);
    for (const f of Array.from(files).slice(0, 10)) {
      const tmp = `tmp-${Math.random().toString(36).slice(2)}`;
      const rejected = toolRejectReason(f);
      if (rejected) {
        // nepodporovaný formát: rovnou „Nelze anonymizovat", nic se nenahrává
        setItems((prev) => [{ id: tmp, filename: f.name, status: "unsupported", reason: rejected, counts: {}, total: null, at: null, createdAt: new Date().toISOString(), local: true, error: rejected }, ...prev]);
        continue;
      }
      setItems((prev) => [{ id: tmp, filename: f.name, status: "uploading", reason: null, counts: {}, total: null, at: null, createdAt: new Date().toISOString(), local: true }, ...prev]);
      const r = await anonApi.adhocUpload(f);
      setItems((prev) => prev.map((p) => (p.id !== tmp ? p : r.ok ? { ...p, id: r.id, status: "pending" } : { ...p, status: "failed", error: r.error, reason: r.error })));
    }
  }

  async function retry(it: Item) {
    setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "pending", reason: null, error: undefined } : p)));
    const r = await anonApi.adhocRetry(it.id);
    if (!r.ok) setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "failed", reason: r.error } : p)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="top-0 flex max-h-[100dvh] w-full flex-col rounded-none sm:top-[5%] sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:rounded-xl" data-testid="anon-tool">
        <div className="flex items-start gap-3 border-b px-4 py-3.5 pr-12">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><EyeOff className="h-5 w-5" /></span>
          <div className="min-w-0">
            <DialogTitle>Anonymizovat výkres</DialogTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Smaže <strong>název firmy, kdo kreslil, logo a cestu na disk</strong> — všechno ostatní (kóty, tolerance, materiál, číslo výkresu) zůstane.
              Pošli ho dodavateli bez obav, že vás obejde.
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files); }}
            className={cn("flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition", drag ? "border-primary bg-primary/5" : "border-border bg-muted/30")}
          >
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="send" className="min-h-11" onClick={() => input.current?.click()} data-testid="anon-tool-pick">
                <Camera className="h-4 w-4" /> Vyfotit nebo vybrat výkres
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">PDF, fotka (JPEG, PNG, HEIC), TIFF, DXF nebo STEP · do 50 MB · i bez zakázky · na počítači sem soubor přetáhni</p>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              data-testid="anon-tool-input"
              onChange={(e) => { const f = e.target.files; if (f?.length) void addFiles(f); e.target.value = ""; }}
            />
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

          <section aria-label="Moje anonymizace" className="space-y-2">
            <h3 className="text-sm font-semibold">Moje anonymizace <span className="font-normal text-muted-foreground">· posledních 7 dní</span></h3>
            {!loaded ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Načítám…</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg border bg-card px-3 py-4 text-sm text-muted-foreground">Zatím nic. Vyfoť nebo vyber výkres — za chvilku ho tu najdeš připravený ke stažení.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => <ToolItem key={it.id} item={it} onEdit={() => setEditing(it)} onRetry={() => void retry(it)} />)}
              </ul>
            )}
          </section>
        </div>
        {editing && (
          <AnonymizeEditor
            open
            onOpenChange={(o) => !o && setEditing(null)}
            fileId={editing.id}
            table="adhoc"
            sourceName={editing.filename}
            title={`Upravit anonymizaci — ${editing.filename}`}
            onSaved={() => void refreshList()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Výřez kolem smazaných oblastí (první strana) + oblasti v něm pro zvýraznění na „Před". */
function useCrop(item: Item, ready: boolean): { box: NBox | null; regions: NBox[]; page: number; loaded: boolean } {
  const [state, setState] = React.useState<{ box: NBox | null; regions: NBox[]; page: number; loaded: boolean }>({ box: null, regions: [], page: 1, loaded: false });
  React.useEffect(() => {
    if (!ready || !hasPreview(item.filename) || item.id.startsWith("tmp-")) return;
    let stop = false;
    void anonApi.state(item.id, { table: "adhoc" }).then((r) => {
      if (stop) return;
      if (!r.ok) return setState({ box: null, regions: [], page: 1, loaded: true });
      const page = r.data.pages?.included?.[0] ?? 1;
      const live = (r.data.regions ?? []).filter((g) => g.page === page && g.manual !== "removed");
      // výřez na razítko (tam je firma a jména); plot stamp u okraje by výřez roztáhl přes celou stranu
      const tb = live.filter((g) => g.zone === "title_block");
      const box = regionsBox(tb.length ? tb : live, page, 0.04);
      setState({ box, regions: live, page, loaded: true });
    });
    return () => { stop = true; };
  }, [item.id, item.filename, item.at, ready]);
  return state;
}

function ToolItem({ item, onEdit, onRetry }: { item: Item; onEdit: () => void; onRetry: () => void }) {
  const [reviewed, setReviewed] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [shareErr, setShareErr] = React.useState<string | null>(null);
  const status = item.status as AnonUiStatus;
  const ready = status === "done" || status === "review";
  const needsConfirm = status === "review" && !reviewed;
  const dl = downloadUrl(item.id, { table: "adhoc", reviewed: status === "review" });
  const counts = describeCounts(item.counts);
  const empty = ready && !counts && (item.total ?? 0) === 0;
  const v = item.at;
  const reason = displayReason(status, item.reason);
  const crop = useCrop(item, ready);

  async function share() {
    setSharing(true);
    setShareErr(null);
    try {
      // soubor se stáhne předem do paměti — share() pak běží hned v obsluze klepnutí (iOS)
      const res = await fetch(dl, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: "Stažení selhalo." }))).error ?? "Stažení selhalo.");
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const file = new File([blob], name ? decodeURIComponent(name) : "vykres.pdf", { type: blob.type || "application/octet-stream" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: file.name });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setShareErr(err instanceof Error ? err.message : "Sdílení selhalo.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <li className="rounded-xl border bg-card p-3 shadow-sm" data-testid="anon-tool-item" data-status={status}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.filename}>{item.filename}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <FileAnonBadge status={status} reason={reason} total={ready ? item.total : null} />
            <span suppressHydrationWarning>{relativeTime(item.createdAt)}</span>
          </div>
          {counts && ready && <p className="mt-1 text-xs"><span className="text-muted-foreground">Smazáno:</span> {counts}</p>}
          {empty && <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {NOTHING_REMOVED}</p>}
          {(status === "review" || status === "failed" || status === "unsupported" || item.error) && reason && (
            <p className={cn("mt-1 text-xs", status === "failed" ? "text-red-700 dark:text-red-300" : status === "unsupported" ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300")}>{reason}</p>
          )}
        </div>
      </div>
      {ready && hasPreview(item.filename) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["orig", "anon"] as const).map((variant) => (
            <button key={variant} type="button" onClick={onEdit} className="group overflow-hidden rounded-lg border bg-card text-left" aria-label={`${variant === "orig" ? "Před" : "Po"} — otevřít v editoru`} data-testid={`anon-tool-thumb-${variant}`}>
              <span className="flex min-h-24 items-center justify-center bg-white">
                {/* obal = přesně obrázek (přirozený poměr stran) → oblasti sedí na výřez */}
                {crop.loaded ? (
                  <span className="relative block w-full">
                    {/* key = nový prvek pro nový výřez (prohlížeč by jinak chvíli ukazoval starý obrázek pod novými oblastmi) */}
                    <img
                      key={`${variant}-${crop.page}-${crop.box ? [crop.box.x, crop.box.y, crop.box.w, crop.box.h].join(",") : "full"}-${v ?? ""}`}
                      src={previewUrl(item.id, { table: "adhoc", variant, v, w: 640, box: crop.box, page: crop.page })}
                      alt={variant === "orig" ? "Před" : "Po"}
                      loading="lazy"
                      className="block h-auto w-full"
                    />
                    {variant === "orig" && crop.box && <CropOverlay box={crop.box} regions={crop.regions} />}
                  </span>
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Načítám náhled" />
                )}
              </span>
              <span className="block border-t bg-muted/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                {variant === "orig" ? "Před — co se smaže" : "Po — pro dodavatele"}
              </span>
            </button>
          ))}
        </div>
      )}
      {ready && (
        <div className="mt-3 space-y-2">
          {status === "review" && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 px-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
              <input type="checkbox" className="h-5 w-5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              Zkontroloval jsem náhled „Po“
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild={!needsConfirm} variant="send" size="sm" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" disabled={needsConfirm}>
              {needsConfirm ? <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" /> Stáhnout</span> : <a href={dl} data-testid="anon-tool-download"><Download className="h-4 w-4" /> Stáhnout</a>}
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" disabled={needsConfirm || sharing} onClick={() => void share()}>
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Sdílet
            </Button>
            {hasPreview(item.filename) && (
              <Button variant="outline" size="sm" className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" onClick={onEdit}>
                <Pencil className="h-4 w-4" /> Upravit oblasti
              </Button>
            )}
          </div>
          {shareErr && <p className="text-xs text-red-700 dark:text-red-300">{shareErr}</p>}
          {status === "done" && !empty && (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Bez metadat, bez textové vrstvy — název souboru je anonymní.</p>
          )}
        </div>
      )}
      {status === "failed" && !item.id.startsWith("tmp-") && (
        <Button variant="outline" size="sm" className="mt-2 min-h-11 sm:min-h-9" onClick={onRetry} data-testid="anon-tool-retry">
          <RefreshCw className="h-4 w-4" /> Zkusit znovu
        </Button>
      )}
      {status === "uploading" && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Upload className="h-3.5 w-3.5" /> Nahrávám…</p>}
    </li>
  );
}

/** Oblasti smazaného přes výřez „Před" (souřadnice stránky → výřez). */
function CropOverlay({ box, regions }: { box: NBox; regions: NBox[] }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {regions.map((r, i) => (
        <span
          key={i}
          className="absolute rounded-[2px] border-2 border-rose-500 bg-rose-500/25"
          style={{
            left: `${((r.x - box.x) / box.w) * 100}%`, top: `${((r.y - box.y) / box.h) * 100}%`,
            width: `${(r.w / box.w) * 100}%`, height: `${(r.h / box.h) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
