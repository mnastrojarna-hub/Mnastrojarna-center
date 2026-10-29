"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ExternalLink, FileUp, Loader2, Plus, ReceiptText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadCapturePage } from "@/components/jobs/capture/capture-client";
import type { CaptureFileRef } from "@/lib/jobs/capture-review";
import { cn } from "@/lib/utils";

export interface UploadDone {
  message: string;
  id?: string;
  duplicate?: boolean;
}

interface Page { key: string; file: File; url: string | null }

/**
 * Nahrání faktury dodavatele (mobil: Vyfotit / Nahrát soubor; víc fotek = stránky jedné faktury).
 * Soubory jdou přímo do úložiště (podepsaná URL, jako focení), pak `endpoint` vytvoří fakturu.
 */
export function InvoiceUploader({
  endpoint = "/api/supplier-invoices/upload",
  body,
  submitLabel = "Uložit fakturu",
  onDone,
  renderDone,
}: {
  endpoint?: string;
  body?: Record<string, unknown>;
  submitLabel?: string;
  onDone?: (res: Record<string, unknown>) => void;
  /** Vlastní obrazovka po uložení (jinak „Děkujeme, nahráno"). */
  renderDone?: (res: Record<string, unknown>, reset: () => void) => React.ReactNode;
}) {
  const [pages, setPages] = React.useState<Page[]>([]);
  const [busy, setBusy] = React.useState<null | "upload" | "save">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Record<string, unknown> | null>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);

  const urls = React.useRef<string[]>([]);
  React.useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const next = [...list].map((file) => {
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      return { key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, url };
    });
    setPages((p) => [...p, ...next].slice(0, 30));
  };

  const reset = () => { setPages([]); setDone(null); setError(null); };

  const submit = async () => {
    if (!pages.length || busy) return;
    setBusy("upload");
    setError(null);
    const refs: CaptureFileRef[] = [];
    for (const p of pages) {
      const r = await uploadCapturePage(p.file, { sortPreview: false });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
      refs.push(r.ref);
    }
    setBusy("save");
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: refs, ...(body ?? {}) }) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!j.ok) { setError(typeof j.error === "string" ? j.error : "Nahrání se nepodařilo."); return; }
      setDone(j);
      setPages([]);
      onDone?.(j);
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    if (renderDone) return <>{renderDone(done, reset)}</>;
    const id = typeof done.id === "string" ? done.id : null;
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10" data-testid="invoice-upload-done">
        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
        <p className="text-lg font-semibold" data-testid="invoice-upload-message">{String(done.message ?? "Děkujeme, nahráno.")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {id && <Button asChild><Link href={`/supplier-invoices/${id}`}><ExternalLink /> Otevřít fakturu</Link></Button>}
          <Button variant="outline" onClick={reset}><Camera /> Nahrát další</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="invoice-uploader">
      <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="invoice-camera-input" />
      <input ref={picker} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="invoice-file-input" />
      {!pages.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => camera.current?.click()} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-rose-300 bg-rose-50 p-5 text-rose-800 transition hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <Camera className="h-9 w-9" /> <span className="text-base font-semibold">Vyfotit fakturu</span>
            <span className="text-xs opacity-80">víc stran = víc fotek</span>
          </button>
          <button type="button" onClick={() => picker.current?.click()} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-5 text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <FileUp className="h-9 w-9" /> <span className="text-base font-semibold">Nahrát soubor</span>
            <span className="text-xs opacity-80">PDF nebo obrázek</span>
          </button>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {pages.map((p, i) => (
              <li key={p.key} className="relative overflow-hidden rounded-xl border bg-muted/40">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.file.name} className="h-28 w-full object-cover" />
                ) : (
                  <div className="flex h-28 flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground"><ReceiptText className="h-6 w-6" /><span className="line-clamp-2 break-all">{p.file.name}</span></div>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">str. {i + 1}</span>
                <button type="button" aria-label="Odebrat" onClick={() => setPages((x) => x.filter((y) => y.key !== p.key))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => camera.current?.click()} className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs text-muted-foreground hover:bg-accent">
                <Plus className="h-5 w-5" /> další strana
              </button>
            </li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" variant="success" className="h-12 flex-1 text-base" disabled={Boolean(busy)} onClick={() => void submit()} data-testid="invoice-upload-submit">
              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {busy === "upload" ? "Nahrávám…" : busy === "save" ? "Ukládám…" : submitLabel}
            </Button>
            <Button size="lg" variant="ghost" className={cn("h-12")} disabled={Boolean(busy)} onClick={reset}>Zrušit</Button>
          </div>
        </>
      )}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert">{error}</p>}
    </div>
  );
}
