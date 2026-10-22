"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, Download, ExternalLink, FolderOpen, Search, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FileKindBadge } from "@/components/jobs/stage-badge";
import { FILE_KINDS, FILE_KIND_ORDER } from "@/lib/jobs/file-kinds";
import type { JobFileKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { FlowEmpty } from "./flow-header";
import { czDay, fileKindCounts, filterFiles, formatBytes, isImageFile, todayPrague } from "./flow-utils";

/** Dokument zakázky pro přehled (čistá data ze serveru). */
export interface FlowFile {
  id: string;
  kind: JobFileKind;
  title: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  archived: boolean;
  note: string | null;
  createdAt: string;
  uploadedBy: string | null;
  hasAiData: boolean;
  job: { id: string; number: string; title: string; customerName: string | null };
}

const PAGE = 60;

/**
 * Všechny dokumenty všech zakázek: barevné filtry podle druhu (s počty), hledání
 * (soubor, název, zakázka, zákazník), archiv starých verzí. Mřížka s náhledy
 * fotek, na mobilu seznam.
 */
export function DocumentsBrowser({ files, today }: { files: FlowFile[]; today: string }) {
  const [kind, setKind] = React.useState<JobFileKind | "vse">("vse");
  const [archived, setArchived] = React.useState(false);
  const [q, setQ] = React.useState("");
  // stránkování se při změně filtru vrací na začátek
  const filterKey = `${kind}|${archived}|${q}`;
  const [page, setPage] = React.useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;

  const counts = React.useMemo(() => fileKindCounts(files, archived), [files, archived]);
  const archivedCount = React.useMemo(() => files.filter((f) => f.archived).length, [files]);
  const shown = React.useMemo(() => filterFiles(files, { kind, archived, q }), [files, kind, archived, q]);
  const kinds = FILE_KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 || k === kind);

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
          <button
            type="button"
            onClick={() => setKind("vse")}
            aria-pressed={kind === "vse"}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
              kind === "vse" ? "bg-foreground text-background shadow-sm" : "bg-muted hover:brightness-95",
            )}
          >
            Vše <span className="rounded-full bg-background/30 px-1.5 text-[10.5px] tabular-nums">{counts.vse ?? 0}</span>
          </button>
          {kinds.map((k) => {
            const m = FILE_KINDS[k];
            const Icon = m.icon;
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(on ? "vse" : k)}
                aria-pressed={on}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition hover:brightness-95",
                  m.badge,
                  on && "shadow-sm ring-2 ring-current ring-offset-1 ring-offset-background",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {m.label}
                <span className="rounded-full bg-background/60 px-1.5 text-[10.5px] tabular-nums dark:bg-black/20">{counts[k] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledej soubor, číslo zakázky, zákazníka…" className="h-10 pl-8" aria-label="Hledat v dokumentech" />
            {q && (
              <button type="button" aria-label="Vymazat hledání" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={archived} onCheckedChange={setArchived} aria-label="Zobrazit archivované" />
            Zobrazit archivované{archivedCount ? ` (${archivedCount})` : ""}
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <FlowEmpty
          icon={FolderOpen}
          iconClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
          title={files.length === 0 ? "Zatím žádné dokumenty" : "Nic neodpovídá filtru"}
        >
          {files.length === 0 ? (
            <>Dokumenty se sem sbírají ze všech zakázek — vyfoť doklad tlačítkem „Vyfotit doklad“, nahraj soubor v kartě zakázky, nebo vystav doklad níže.</>
          ) : (
            <>Zkus jiný druh dokumentu, vymaž hledání nebo zapni „Zobrazit archivované“.</>
          )}
        </FlowEmpty>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {shown.slice(0, limit).map((f) => (
              <FileCard key={f.id} file={f} today={today} />
            ))}
          </ul>
          {shown.length > limit && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => setPage({ key: filterKey, limit: limit + PAGE })}>
                Zobrazit další ({shown.length - limit})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FileCard({ file: f, today }: { file: FlowFile; today: string }) {
  const m = FILE_KINDS[f.kind] ?? FILE_KINDS.ostatni;
  const Icon = m.icon;
  const href = `/api/jobs/files/${f.id}`;
  // poškozený / nepodporovaný obrázek → ikona druhu místo rozbitého náhledu
  const [broken, setBroken] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const image = isImageFile(f.mimeType, f.filename) && !broken;
  // chyba načtení před hydratací se do onError nedostane → zkontrolovat po připojení
  React.useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, []);
  const size = formatBytes(f.sizeBytes);
  return (
    <li className={cn("group flex overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md sm:flex-col", f.archived && "opacity-70")}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Otevřít ${f.filename}`}
        className={cn("relative flex w-20 shrink-0 items-center justify-center overflow-hidden sm:h-32 sm:w-full", m.badge)}
      >
        {image ? (
          <img ref={imgRef} src={href} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : (
          <Icon className="h-8 w-8 opacity-80 sm:h-12 sm:w-12" />
        )}
        {f.version > 1 && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-bold text-foreground shadow-sm">v{f.version}</span>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center gap-1">
          <FileKindBadge kind={f.kind} />
          {f.archived && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              <Archive className="h-3 w-3" /> archiv
            </span>
          )}
          {f.hasAiData && <Sparkles aria-label="AI z dokladu přečetla údaje" className="h-3.5 w-3.5 text-violet-500" />}
        </div>
        <p className="line-clamp-2 break-words text-sm font-medium leading-snug" title={f.filename}>{f.title || f.filename}</p>
        {f.title && <p className="truncate text-[11px] text-muted-foreground" title={f.filename}>{f.filename}</p>}
        <Link href={`/orders/${f.job.id}?tab=dokumenty`} className="flex min-w-0 items-center gap-1 text-xs hover:underline">
          <span className="shrink-0 whitespace-nowrap font-mono font-semibold">{f.job.number}</span>
          <span className="truncate text-muted-foreground">{f.job.customerName ?? f.job.title}</span>
        </Link>
        <div className="mt-auto flex items-center gap-1 pt-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {czDay(todayPrague(new Date(f.createdAt)), { short: true, today })}
            {size ? ` · ${size}` : ""}
            {f.uploadedBy ? ` · ${f.uploadedBy}` : ""}
          </span>
          <Button asChild size="icon-sm" variant="ghost" title="Otevřít">
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Otevřít ${f.filename}`}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="icon-sm" variant="ghost" title="Stáhnout">
            <a href={`${href}?download=1`} aria-label={`Stáhnout ${f.filename}`}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </li>
  );
}
