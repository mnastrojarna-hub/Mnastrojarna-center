"use client";

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, Loader2, Printer } from "lucide-react";
import { isPrintMessage, printModeFor, printPageHref, safePrintSrc } from "@/lib/print/print-links";
import { PrintDocument, type PrintEvent } from "./print-document";

/**
 * „Tisknout" odkudkoli v aplikaci — jedním klepnutím systémový dialog tisku (výběr tiskárny):
 *  - počítač (Chrome, Edge, Firefox): skrytý rám s tiskovou stránkou /print → dialog tisku hned,
 *    bez opuštění stránky (dole malé „Připravuji tisk… 3 / 10"),
 *  - Safari na počítači: tisková stránka v nové kartě,
 *  - telefon / tablet (iOS AirPrint, Android tisk / Uložit jako PDF): přechod na tiskovou stránku
 *    (náhled, velké „Tisknout" a „Zpět"),
 *  - obsah už v paměti (náhled PDF vytvořený na serveru, snímek 3D pohledu): vykreslení přímo
 *    v aplikaci a tisk stránky — tiskové CSS skryje vše kromě stran dokumentu.
 */

export interface PrintRequest {
  /** Vlastní /api/… adresa dokumentu (stejná jako pro náhled / stažení). */
  href?: string | null;
  filename?: string | null;
  /** Obsah už stažený / vytvořený v prohlížeči. */
  blob?: Blob | null;
}

export type PrintResult = "started" | "navigated" | "invalid" | "error";

type Toast = { kind: "busy"; text: string } | { kind: "error"; text: string } | null;

let host: { el: HTMLDivElement; root: Root } | null = null;
let job: { cancel: () => void } | null = null;

function render(toast: Toast, layer: React.ReactNode = null) {
  if (typeof document === "undefined") return;
  if (!host) {
    const el = document.createElement("div");
    el.id = "mn-print-host";
    document.body.appendChild(el);
    host = { el, root: createRoot(el) };
  }
  host.root.render(
    <>
      {layer}
      {toast && <PrintToast toast={toast} />}
    </>,
  );
}

function PrintToast({ toast }: { toast: NonNullable<Toast> }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4 md:bottom-6" data-testid="print-toast">
      <div
        role={toast.kind === "error" ? "alert" : "status"}
        className={
          toast.kind === "error"
            ? "flex max-w-md items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg dark:border-red-500/30 dark:bg-red-950 dark:text-red-100"
            : "flex max-w-md items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg"
        }
      >
        {toast.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
        <span>{toast.text}</span>
        {toast.kind === "busy" && <Printer className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
    </div>
  );
}

function progressText(e: Extract<PrintEvent, { type: "progress" }>): string {
  if (!e.total) return e.done > 0 ? `Připravuji tisk… strana ${e.done + 1}` : "Připravuji tisk…";
  return `Připravuji tisk… ${Math.min(e.done + 1, e.total)} / ${e.total}`;
}

function showError(text: string, prefix = "Tisk se nepovedl: ") {
  render({ kind: "error", text: `${prefix}${text}` });
  const t = window.setTimeout(() => render(null), 7000);
  job = { cancel: () => window.clearTimeout(t) };
}

/** Krátká nápověda u souboru, který vytisknout nejde (klepnutí na vypnuté „Tisknout" na telefonu). */
export function showPrintHint(text: string): void {
  if (typeof window === "undefined") return;
  job?.cancel();
  showError(text, "");
}

/** Tisk obsahu už v paměti — strany se vykreslí v aplikaci (skrytě) a otevře se tisk stránky. */
function printInPage(blob: Blob, filename: string | null): Promise<PrintResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: PrintResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let closeTimer = 0;
      const cleanup = () => {
        window.clearTimeout(closeTimer);
        render(null, null);
      };
      job = { cancel: cleanup };
      const onEvent = (e: PrintEvent) => {
        if (e.type === "progress") render({ kind: "busy", text: progressText(e) }, layer);
        else if (e.type === "ready") {
          render(null, layer);
          settle("started");
        } else if (e.type === "printed") {
          // po zavření dialogu tisku (Safari tiskne asynchronně → s rezervou)
          window.clearTimeout(closeTimer);
          closeTimer = window.setTimeout(() => {
            if (job?.cancel === cleanup) job = null;
            cleanup();
          }, 1500);
        } else if (e.type === "error") {
          cleanup();
          showError(e.message);
          settle("error");
        }
      };
      const layer = <PrintDocument key={Date.now()} source={{ bytes, contentType: blob.type, name: filename }} mode="hidden" onEvent={onEvent} />;
      render({ kind: "busy", text: "Připravuji tisk…" }, layer);
    }, () => {
      showError("Dokument se nepodařilo přečíst.");
      settle("error");
    });
  });
}

/** Skrytý rám s tiskovou stránkou (počítač) — dialog tisku bez opuštění stránky. */
function printInFrame(src: string, filename: string | null): Promise<PrintResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: PrintResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("data-testid", "print-frame");
    frame.title = "Tisk dokumentu";
    // mimo obrazovku, ale s rozměrem strany (obrázky se v rámu načtou a dekódují)
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none";
    let watchdog = 0;
    let removeTimer = 0;
    const arm = () => {
      window.clearTimeout(watchdog);
      // bez zprávy z rámu 45 s → něco se pokazilo (chyba načtení stránky)
      watchdog = window.setTimeout(() => {
        cleanup();
        showError("tisková stránka neodpověděla. Zkus to znovu.");
        settle("error");
      }, 45_000);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== window.location.origin || !isPrintMessage(e.data)) return;
      const m = e.data;
      arm();
      if (m.type === "progress") render({ kind: "busy", text: progressText({ type: "progress", done: m.done, total: m.total }) });
      else if (m.type === "ready") {
        window.clearTimeout(watchdog);
        render(null);
        settle("started");
      } else if (m.type === "printed") {
        window.clearTimeout(watchdog);
        window.clearTimeout(removeTimer);
        removeTimer = window.setTimeout(() => {
          if (job?.cancel === cleanup) job = null;
          cleanup();
        }, 2000);
      } else if (m.type === "error") {
        cleanup();
        showError(m.message);
        settle("error");
      }
    };
    const cleanup = () => {
      window.clearTimeout(watchdog);
      window.clearTimeout(removeTimer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      render(null);
    };
    job = { cancel: cleanup };
    window.addEventListener("message", onMessage);
    render({ kind: "busy", text: "Připravuji tisk…" });
    arm();
    frame.src = printPageHref(src, { name: filename, embed: true });
    document.body.appendChild(frame);
  });
}

/**
 * Vytiskne dokument. Volat přímo z obsluhy klepnutí (Safari: nová karta se otevře jen synchronně).
 * Vrací "invalid" pro adresu, kterou tisk nepovoluje (cizí / nepodporovaná route).
 */
export function printDocument(req: PrintRequest): Promise<PrintResult> {
  if (typeof window === "undefined") return Promise.resolve("invalid");
  job?.cancel();
  job = null;
  const filename = req.filename ?? null;
  if (req.blob) return printInPage(req.blob, filename);
  const src = safePrintSrc(req.href);
  if (!src) return Promise.resolve("invalid");
  const mode = printModeFor(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const page = printPageHref(src, { name: filename });
  if (mode === "page") {
    window.location.assign(page);
    return Promise.resolve("navigated");
  }
  if (mode === "tab") {
    const w = window.open(page, "_blank");
    if (!w) window.location.assign(page);
    return Promise.resolve("navigated");
  }
  return printInFrame(src, filename);
}
