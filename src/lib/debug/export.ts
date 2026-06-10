/**
 * Formátování debug logu pro kopírování / stažení / nahlášení.
 */

import type { LogEntry } from "./log-store";
import { collectDiagnostics } from "./logger";

const LEVEL_TAG: Record<string, string> = {
  debug: "DEBUG",
  info: "INFO ",
  log: "LOG  ",
  warn: "WARN ",
  error: "ERROR",
  network: "NET  ",
  event: "EVENT",
  nav: "NAV  ",
  action: "ACT  ",
};

export function formatEntry(e: LogEntry): string {
  const ts = new Date(e.ts).toISOString();
  const tag = LEVEL_TAG[e.level] ?? e.level.toUpperCase();
  const repeat = e.count > 1 ? ` (×${e.count})` : "";
  const head = `[${ts}] ${tag} ${e.source} | ${e.message}${repeat}`;
  const lines = [head];
  if (e.url) lines.push(`    route: ${e.url}`);
  if (e.details && e.details !== '""') lines.push(indent(e.details, "    "));
  if (e.stack) lines.push(indent(e.stack, "    "));
  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

function diagnosticsBlock(): string {
  const d = collectDiagnostics();
  return Object.entries(d)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
}

/** Plný report: hlavička s diagnostikou + všechny (nebo vybrané) záznamy. */
export function buildReport(entries: readonly LogEntry[]): string {
  const errors = entries.filter((e) => e.level === "error").length;
  const warns = entries.filter((e) => e.level === "warn").length;
  return [
    "════════════════════════════════════════════════════════",
    "  CNC SALES OS — DEBUG REPORT",
    "════════════════════════════════════════════════════════",
    diagnosticsBlock(),
    `  Záznamů: ${entries.length} (chyb: ${errors}, varování: ${warns})`,
    "────────────────────────────────────────────────────────",
    "",
    ...entries.map(formatEntry),
    "",
    "──────────────────────────── konec reportu ────────────────────────────",
  ].join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback níže */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
