"use client";

import { Component, type ReactNode } from "react";
import { explainRenderFailure, type RenderFailure } from "@/cad/diagnostics";
import { CAD_LINKS } from "@/content/cad-links";
import { CadIcon } from "./cad-icons";

/**
 * Hranice chyb kolem 3D okna: výjimka při vykreslování nebo v efektech 3D okna neshodí celou aplikaci –
 * 3D okno se odpojí a aplikace zobrazí chybovou obrazovku (ViewportFallback). Změna `resetKey` umožní nový pokus.
 */
export class ViewportBoundary extends Component<{ children: ReactNode; resetKey: number; onError: (error: Error) => void }, { failed: boolean; key: number }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromProps(p: { resetKey: number }, s: { failed: boolean; key: number }) {
    return p.resetKey !== s.key ? { failed: false, key: p.resetKey } : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Chybová obrazovka 3D okna: česky příčina, postup, Zkusit znovu, Zkopírovat diagnostiku, odkaz na nápovědu. */
export function ViewportFallback({ failure, core, onRetry, onCopy }: { failure: RenderFailure; core: string; onRetry: () => void; onCopy: () => void }) {
  const e = explainRenderFailure(failure);
  return (
    <div role="alert" data-viewport-fallback className="absolute inset-0 z-20 overflow-y-auto bg-[#eef1f5]/95 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl rounded-lg border border-[#d5dbe2] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#fff1f0]">
            <CadIcon name="eye" className="h-6 w-6 text-brand" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[#1f2933]">{e.title}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#3c4856]">{e.cause}</p>
          </div>
        </div>
        <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7785]">Co zkusit</h3>
        <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-[#26303b]">
          {e.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 rounded-md border border-[#e3e8ee] bg-[#f7f9fb] p-3 text-[12px] leading-relaxed text-[#3c4856]">{e.note}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onRetry} className="rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white shadow hover:bg-brand-600">
            Zkusit znovu
          </button>
          <button type="button" onClick={onCopy} className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f3f6f9]">
            Zkopírovat diagnostiku
          </button>
          <a href={CAD_LINKS.docs} target="_blank" rel="noopener" className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f3f6f9]">
            Nápověda a dokumentace
          </a>
        </div>
        <p className="mt-3 break-words font-mono text-[10.5px] text-[#8a95a3]">
          Technicky: {failure.error.message} · WebGL: {failure.probe.ok ? `${failure.probe.api} · ${failure.probe.renderer ?? ""}` : "nedostupné"} · jádro: {core}
        </p>
      </div>
    </div>
  );
}
