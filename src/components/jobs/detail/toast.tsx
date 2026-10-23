"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, Info, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Malé oznámení karty zakázky (vpravo dole, na mobilu nad spodní lištou).
 * Bez nové závislosti — stačí pro „uloženo" / „chyba" / „PDF hotové — otevřít".
 */

export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  href: string;
  /** Otevřít v novém panelu (PDF, dokument). */
  external?: boolean;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
  action?: ToastAction;
}

export type Notify = (tone: ToastTone, text: string, action?: ToastAction) => void;

const ToastContext = React.createContext<Notify>(() => {});

export function useNotify(): Notify {
  return React.useContext(ToastContext);
}

const TONE: Record<ToastTone, { icon: typeof Info; cls: string; iconCls: string }> = {
  success: { icon: CheckCircle2, cls: "border-green-300/60 dark:border-green-500/30", iconCls: "text-green-600 dark:text-green-400" },
  error: { icon: AlertTriangle, cls: "border-red-300/70 dark:border-red-500/40", iconCls: "text-red-600 dark:text-red-400" },
  info: { icon: Info, cls: "border-sky-300/60 dark:border-sky-500/30", iconCls: "text-sky-600 dark:text-sky-400" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);
  const timers = React.useRef(new Map<number, number>());

  const dismiss = React.useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notify = React.useCallback<Notify>((tone, text, action) => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list.slice(-3), { id, tone, text, action }]);
    const ms = tone === "error" ? 8000 : action ? 9000 : 3500;
    timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) window.clearTimeout(t);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {/* mobil: nahoře — dole by zakryl potvrzovací tlačítka dialogů (panel zespodu) */}
      <div className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto">
        {items.map((t) => {
          const m = TONE[t.tone];
          const Icon = m.icon;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-lg animate-fade-in",
                m.cls,
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.iconCls)} />
              <div className="min-w-0 flex-1">
                <p className="break-words leading-snug">{t.text}</p>
                {t.action && (
                  <a
                    href={t.action.href}
                    target={t.action.external ? "_blank" : undefined}
                    rel={t.action.external ? "noopener noreferrer" : undefined}
                    onClick={() => dismiss(t.id)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    {t.action.label}
                    {t.action.external && <ExternalLink className="h-3 w-3" />}
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Zavřít oznámení"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
