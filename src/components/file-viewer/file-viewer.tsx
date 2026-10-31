"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeft, Box, Download, ExternalLink, FileQuestion, FileText, Loader2 } from "lucide-react";
import { filenameFromDisposition, sniffFile, type Sniffed } from "@/lib/viewer3d/sniff";
import { pdfHas3D } from "@/lib/viewer3d/formats/pdf3d";
import { cn } from "@/lib/utils";
import { PdfView } from "./pdf-view";
import { ImageView } from "./image-view";
import { standaloneViewerHref } from "./viewer-links";

// three.js + OpenCascade jen když se otevírá 3D model
const ModelViewer = dynamic(() => import("@/components/viewer3d/model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> Spouštím 3D prohlížeč…
    </div>
  ),
});

export interface ViewerRequest {
  /** Vlastní /api/… adresa souboru (u `blob` jen identifikace). */
  href: string;
  filename?: string | null;
  /** Už stažený obsah (např. náhled PDF vytvořený na serveru) — nestahuje se znovu. */
  blob?: Blob;
}

interface Loaded {
  bytes: Uint8Array;
  blobUrl: string;
  filename: string;
  sniffed: Sniffed;
  has3D: boolean;
  contentType: string;
}

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

async function readWithProgress(res: Response, onProgress: (done: number, total: number) => void): Promise<Uint8Array> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    done += r.value.length;
    onProgress(done, total);
  }
  const out = new Uint8Array(done);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Název z cesty podepsané URL úložiště (…/soubor.step?token=…). */
function filenameFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return /\.[a-z0-9_]{1,8}$/i.test(last) ? last.replace(/^\d{10,}[-_]/, "") : null;
  } catch {
    return null;
  }
}

/**
 * Prohlížeč souboru přes celou obrazovku: PDF (i 3D PDF), obrázky, 3D modely (STEP, IGES, STL…),
 * text; ostatní ke stažení. Nahoře vždy velké „Zpět" (i na telefonu).
 */
export function FileViewer({ request, onBack, standalone = false }: { request: ViewerRequest; onBack: () => void; standalone?: boolean }) {
  const [state, setState] = React.useState<{ loading: true; done: number; total: number } | { loading: false; error: string } | { loading: false; data: Loaded }>({ loading: true, done: 0, total: 0 });
  const [mode, setMode] = React.useState<"3d" | "pages">("3d");

  React.useEffect(() => {
    const ac = new AbortController();
    let blobUrl: string | null = null;
    (async () => {
      try {
        if (request.blob) {
          const bytes = new Uint8Array(await request.blob.arrayBuffer());
          const filename = request.filename || "dokument";
          const sniffed = sniffFile(bytes, filename, request.blob.type);
          blobUrl = URL.createObjectURL(request.blob);
          setState({ loading: false, data: { bytes, blobUrl, filename, sniffed, has3D: sniffed.kind === "pdf" && pdfHas3D(bytes), contentType: request.blob.type } });
          return;
        }
        const res = await fetch(request.href, { signal: ac.signal, credentials: "same-origin" });
        if (!res.ok) {
          let msg = `Soubor se nepodařilo načíst (chyba ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* tělo není JSON */
          }
          if (res.status === 401) msg = "Přihlášení vypršelo — obnov stránku a přihlas se znovu.";
          setState({ loading: false, error: msg });
          return;
        }
        const ct = res.headers.get("content-type") ?? "";
        const bytes = await readWithProgress(res, (done, total) => setState({ loading: true, done, total }));
        const filename = request.filename || filenameFromDisposition(res.headers.get("content-disposition")) || filenameFromUrl(res.url) || "soubor";
        const sniffed = sniffFile(bytes, filename, ct);
        const mime = sniffed.kind === "pdf" ? "application/pdf" : sniffed.kind === "image" ? (ct.startsWith("image/") ? ct : "image/*") : ct || "application/octet-stream";
        blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        const has3D = sniffed.kind === "pdf" && pdfHas3D(bytes);
        setState({ loading: false, data: { bytes, blobUrl, filename, sniffed, has3D, contentType: ct } });
      } catch (e) {
        if (ac.signal.aborted) return;
        setState({ loading: false, error: e instanceof Error && e.name !== "TypeError" ? e.message : "Spojení se nepovedlo — zkontroluj internet a zkus to znovu." });
      }
    })();
    return () => {
      ac.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [request.href, request.filename, request.blob]);

  const data = "data" in state ? state.data : null;
  const title = data?.filename ?? request.filename ?? "Dokument";
  const isModel = data?.sniffed.kind === "model" || !!data?.has3D;
  const modelBytes = React.useMemo(() => (data && (data.sniffed.kind === "model" || data.has3D) ? (data.bytes.buffer as ArrayBuffer) : null), [data]);

  return (
    <div className="flex h-full flex-col bg-background" data-testid="file-viewer">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 pt-[env(safe-area-inset-top)] sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]"
          data-testid="viewer-back"
        >
          <ArrowLeft className="h-5 w-5" /> Zpět
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-semibold" title={title}>{title}</p>
          {data && <p className="truncate text-[11px] text-muted-foreground">{data.has3D ? "3D PDF" : data.sniffed.label} · {fmtSize(data.bytes.length)}</p>}
        </div>
        {data?.has3D && (
          <div className="flex shrink-0 rounded-lg border p-0.5 text-xs font-medium" role="tablist" aria-label="Zobrazení 3D PDF">
            <button type="button" role="tab" aria-selected={mode === "3d"} onClick={() => setMode("3d")} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2", mode === "3d" ? "bg-foreground text-background" : "hover:bg-accent")}>
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
            <button type="button" role="tab" aria-selected={mode === "pages"} onClick={() => setMode("pages")} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2", mode === "pages" ? "bg-foreground text-background" : "hover:bg-accent")}>
              <FileText className="h-3.5 w-3.5" /> Stránky
            </button>
          </div>
        )}
        {data && (
          <a
            href={data.blobUrl}
            download={data.filename}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            aria-label="Stáhnout"
            title="Stáhnout"
            data-no-viewer=""
          >
            <Download className="h-5 w-5" />
          </a>
        )}
        {!standalone && !request.blob && (
          <a
            href={standaloneViewerHref(request.href, data?.filename ?? request.filename)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent sm:inline-flex"
            aria-label="Otevřít v novém okně"
            title="Otevřít v novém okně"
            data-no-viewer=""
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {state.loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>
              Stahuji soubor…{" "}
              {state.done > 0 && (state.total ? `${fmtSize(state.done)} / ${fmtSize(state.total)}` : fmtSize(state.done))}
            </span>
            {state.total > 0 && (
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((state.done / state.total) * 100)}%` }} />
              </div>
            )}
          </div>
        ) : "error" in state ? (
          <Message icon={AlertTriangle} tone="text-amber-500" title="Soubor nejde otevřít" text={state.error} />
        ) : data && isModel && modelBytes ? (
          <>
            {/* 3D zůstává načtené i při přepnutí na stránky PDF */}
            <div className={cn("absolute inset-0", data.has3D && mode === "pages" && "invisible")}>
              <ModelViewer
                bytes={modelBytes}
                format={data.has3D ? "pdf" : data.sniffed.format!}
                name={data.filename}
                formatLabel={data.has3D ? "3D PDF" : data.sniffed.label}
              />
            </div>
            {data.has3D && mode === "pages" && (
              <div className="absolute inset-0">
                <PdfView data={data.bytes} />
              </div>
            )}
          </>
        ) : data?.sniffed.kind === "pdf" ? (
          <PdfView data={data.bytes} />
        ) : data?.sniffed.kind === "image" ? (
          <ImageView src={data.blobUrl} alt={data.filename} />
        ) : data?.sniffed.kind === "text" ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">{new TextDecoder().decode(data.bytes.subarray(0, 2_000_000))}</pre>
        ) : data ? (
          <Message
            icon={FileQuestion}
            tone="text-muted-foreground"
            title={`Náhled formátu ${data.sniffed.label} zatím neumím`}
            text="Soubor si stáhni a otevři v programu, který ho umí (Word, Excel, CAD…)."
            action={<a href={data.blobUrl} download={data.filename} data-no-viewer="" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"><Download className="h-4 w-4" /> Stáhnout {data.filename}</a>}
          />
        ) : null}
      </div>
    </div>
  );
}

function Message({ icon: Icon, tone, title, text, action }: { icon: React.ComponentType<{ className?: string }>; tone: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-sm" role="alert">
        <Icon className={cn("mx-auto h-8 w-8", tone)} />
        <p className="mt-2 font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        {action}
      </div>
    </div>
  );
}
