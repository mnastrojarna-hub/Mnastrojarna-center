"use client";

import * as React from "react";
import {
  Bug,
  X,
  Trash2,
  Copy,
  Download,
  Send,
  Pause,
  Play,
  ChevronUp,
  ChevronDown,
  Search,
  AlertTriangle,
  AlertOctagon,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { debugStore, EMPTY_SNAPSHOT, type LogEntry, type LogLevel } from "@/lib/debug/log-store";
import { installDebugCapture } from "@/lib/debug/capture";
import { buildReport, formatEntry, copyText, downloadText } from "@/lib/debug/export";

const LEVELS: { key: LogLevel; label: string }[] = [
  { key: "error", label: "Chyby" },
  { key: "warn", label: "Varování" },
  { key: "network", label: "Síť" },
  { key: "nav", label: "Navigace" },
  { key: "action", label: "Akce" },
  { key: "event", label: "Události" },
  { key: "info", label: "Info" },
  { key: "log", label: "Log" },
  { key: "debug", label: "Debug" },
];

function levelClasses(level: LogLevel): string {
  switch (level) {
    case "error":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "warn":
      return "bg-warning/15 text-warning border-warning/30";
    case "network":
      return "bg-blue-500/15 text-blue-500 border-blue-500/30";
    case "nav":
      return "bg-purple-500/15 text-purple-500 border-purple-500/30";
    case "action":
      return "bg-primary/15 text-primary border-primary/30";
    case "event":
      return "bg-success/15 text-success border-success/30";
    case "info":
      return "bg-muted text-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleTimeString("cs-CZ", { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

export function DebugBar() {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<Set<LogLevel>>(() => new Set(LEVELS.map((l) => l.key)));
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [autoscroll, setAutoscroll] = React.useState(true);
  const [copied, setCopied] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const entries = React.useSyncExternalStore(
    (cb) => debugStore.subscribe(cb),
    () => debugStore.getSnapshot(),
    () => EMPTY_SNAPSHOT,
  );

  React.useEffect(() => {
    setMounted(true);
    installDebugCapture();
  }, []);

  // Klávesová zkratka: Ctrl/Cmd + ` přepíná lištu
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const errorCount = React.useMemo(() => entries.filter((e) => e.level === "error").length, [entries]);
  const warnCount = React.useMemo(() => entries.filter((e) => e.level === "warn").length, [entries]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!active.has(e.level)) return false;
      if (!q) return true;
      return (
        e.message.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        (e.details?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, active, query]);

  React.useEffect(() => {
    if (open && autoscroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length, open, autoscroll]);

  const flash = (label: string) => {
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const toggleLevel = (lvl: LogLevel) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    debugStore.setPaused(next);
  };

  const doCopyAll = async () => {
    const ok = await copyText(filtered.map(formatEntry).join("\n\n"));
    flash(ok ? "Zkopírováno" : "Chyba kopírování");
  };
  const doReport = async () => {
    const ok = await copyText(buildReport(filtered));
    flash(ok ? "Report zkopírován" : "Chyba kopírování");
  };
  const doDownload = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(buildReport(entries), `cnc-debug-${stamp}.txt`);
    flash("Staženo");
  };
  const doCopyEntry = async (e: LogEntry) => {
    const ok = await copyText(formatEntry(e));
    flash(ok ? "Záznam zkopírován" : "Chyba");
  };

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-stretch md:bottom-0">
      {/* Vyskakovací panel */}
      {open && (
        <div className="pointer-events-auto mx-auto flex h-[min(60vh,520px)] w-full max-w-screen-2xl flex-col overflow-hidden border-t border-border bg-card/98 shadow-2xl backdrop-blur-md">
          {/* Hlavička s ovládáním */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
            <div className="flex items-center gap-1.5 pr-1 text-xs font-semibold">
              <Bug className="h-4 w-4 text-primary" /> Debug log
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Hledat v logu…"
                className="h-7 w-40 rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring sm:w-56"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {LEVELS.map((l) => {
                const on = active.has(l.key);
                const n = entries.filter((e) => e.level === l.key).length;
                return (
                  <button
                    key={l.key}
                    onClick={() => toggleLevel(l.key)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                      on ? levelClasses(l.key) : "border-border bg-transparent text-muted-foreground opacity-50",
                    )}
                    title={`${l.label}: ${n}`}
                  >
                    {l.label} {n > 0 && <span className="tabular-nums">{n}</span>}
                  </button>
                );
              })}
            </div>

            <div className="ml-auto flex items-center gap-1">
              {copied && (
                <span className="flex items-center gap-1 text-[11px] text-success">
                  <Check className="h-3 w-3" /> {copied}
                </span>
              )}
              <BarButton onClick={togglePause} title={paused ? "Pokračovat v záznamu" : "Pozastavit záznam"}>
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </BarButton>
              <BarButton onClick={doCopyAll} title="Kopírovat zobrazené záznamy">
                <Copy className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton onClick={doReport} title="Kopírovat report (s diagnostikou)">
                <Send className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton onClick={doDownload} title="Stáhnout celý log jako .txt">
                <Download className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton onClick={() => debugStore.clear()} title="Vymazat log">
                <Trash2 className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton onClick={() => setOpen(false)} title="Zavřít (Ctrl+`)">
                <X className="h-3.5 w-3.5" />
              </BarButton>
            </div>
          </div>

          {/* Seznam záznamů */}
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              setAutoscroll(atBottom);
            }}
            className="scrollbar-thin flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed"
          >
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Žádné záznamy odpovídající filtru.
              </div>
            ) : (
              filtered.map((e) => (
                <LogRow
                  key={e.id}
                  entry={e}
                  expanded={expandedId === e.id}
                  onToggle={() => setExpandedId((id) => (id === e.id ? null : e.id))}
                  onCopy={() => doCopyEntry(e)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Trvalá spodní lišta */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto flex h-9 w-full items-center gap-2 border-t border-border bg-card/95 px-3 text-left text-xs backdrop-blur-md"
        title="Debug log (Ctrl+`)"
      >
        <Bug className={cn("h-4 w-4 shrink-0", errorCount > 0 ? "text-destructive" : "text-primary")} />
        <span className="font-semibold">Debug</span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">
            <AlertOctagon className="h-3 w-3" /> {errorCount}
          </span>
        )}
        {warnCount > 0 && (
          <span className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
            <AlertTriangle className="h-3 w-3" /> {warnCount}
          </span>
        )}
        <span className="truncate text-muted-foreground">
          {entries.length === 0 ? "Žádné události zatím." : entries[entries.length - 1].message}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
          <span className="tabular-nums">{entries.length}</span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>
    </div>
  );
}

function BarButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
  onCopy,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-2 py-1 text-left hover:bg-accent/40"
      >
        <span className="shrink-0 text-muted-foreground/70">{fmtTime(entry.ts)}</span>
        <span className={cn("shrink-0 rounded border px-1 py-px text-[9px] font-bold uppercase", levelClasses(entry.level))}>
          {entry.level}
        </span>
        <span className="shrink-0 text-primary/80">{entry.source}</span>
        <span className="min-w-0 flex-1 truncate">{entry.message}</span>
        {entry.count > 1 && (
          <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-bold text-muted-foreground">×{entry.count}</span>
        )}
        {(entry.details || entry.stack) &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3 w-3 shrink-0 rotate-180 text-muted-foreground" />
          ))}
      </button>

      {expanded && (entry.details || entry.stack) && (
        <div className="relative border-t border-border/40 bg-muted/30 px-3 py-2">
          <button
            onClick={onCopy}
            className="absolute right-2 top-2 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3 w-3" /> Kopírovat
          </button>
          {entry.url && <div className="mb-1 text-[10px] text-muted-foreground">route: {entry.url}</div>}
          {entry.details && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-foreground/90">
              {entry.details}
            </pre>
          )}
          {entry.stack && (
            <details className="mt-1.5" open>
              <summary className="cursor-pointer text-[10px] text-muted-foreground">Stack trace</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                {entry.stack}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
