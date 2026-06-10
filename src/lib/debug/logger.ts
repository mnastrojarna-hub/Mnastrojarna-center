/**
 * Veřejné API pro logování z aplikačního kódu.
 *
 * Použij kdekoli (klient i komponenty) pro „extrémně podrobné" hlášky:
 *   debug.action("outlook-import", "Začínám import", { files: 3 })
 *   debug.error("sync", "Synchronizace selhala", err)
 *
 * Zapisuje do globálního debug logu (spodní lišta) a zároveň do konzole.
 */

import { debugStore, type LogLevel } from "./log-store";
import { detailFromArgs, summarizeArgs } from "./serialize";

function emit(level: LogLevel, source: string, message: string, args: unknown[]) {
  const details = args.length ? detailFromArgs(args) : undefined;
  const extra = args.length ? summarizeArgs(args) : "";
  const stack =
    level === "error" || level === "warn"
      ? args.find((a) => a instanceof Error)?.["stack" as never] ??
        (typeof Error !== "undefined" ? new Error().stack?.split("\n").slice(2).join("\n") : undefined)
      : undefined;

  debugStore.add({
    level,
    source,
    message: extra ? `${message} — ${extra}`.slice(0, 400) : message,
    details,
    stack: stack as string | undefined,
  });
}

export const debug = {
  debug: (source: string, message: string, ...args: unknown[]) => emit("debug", source, message, args),
  info: (source: string, message: string, ...args: unknown[]) => emit("info", source, message, args),
  log: (source: string, message: string, ...args: unknown[]) => emit("log", source, message, args),
  warn: (source: string, message: string, ...args: unknown[]) => emit("warn", source, message, args),
  error: (source: string, message: string, ...args: unknown[]) => emit("error", source, message, args),
  event: (source: string, message: string, ...args: unknown[]) => emit("event", source, message, args),
  action: (source: string, message: string, ...args: unknown[]) => emit("action", source, message, args),
};

/** Diagnostika prostředí pro report (do hlavičky kopírovaného/staženého logu). */
export function collectDiagnostics(): Record<string, string> {
  const out: Record<string, string> = {
    Aplikace: "CNC Sales OS — Mnástrojárna s.r.o.",
    Čas: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    out["URL"] = window.location.href;
    out["Referrer"] = document.referrer || "—";
    out["Rozlišení okna"] = `${window.innerWidth}×${window.innerHeight}`;
    out["Rozlišení obrazovky"] = `${window.screen?.width}×${window.screen?.height} @${window.devicePixelRatio}x`;
    out["Téma"] = document.documentElement.classList.contains("dark") ? "dark" : "light";
    out["Jazyk"] = navigator.language;
    out["Platforma"] = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "—";
    out["User-Agent"] = navigator.userAgent;
    out["Online"] = navigator.onLine ? "ano" : "ne";
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (conn?.effectiveType) out["Síť"] = conn.effectiveType;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
    if (mem?.usedJSHeapSize) {
      out["Paměť JS"] = `${(mem.usedJSHeapSize / 1048576).toFixed(1)} / ${((mem.jsHeapSizeLimit ?? 0) / 1048576).toFixed(0)} MB`;
    }
  }
  return out;
}
