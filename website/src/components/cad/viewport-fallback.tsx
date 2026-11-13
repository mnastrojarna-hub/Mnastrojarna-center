"use client";

import { langMeta, tr } from "@/cad/i18n";
import { Component, forwardRef, isValidElement, useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { explainRenderFailure, type RenderFailure } from "@/cad/diagnostics";
import { CadIcon } from "./cad-icons";
import { softView } from "./soft-bridge";
import type { ViewportHandle } from "./viewport";
import { SOFT_BTN, SoftViewport, type SoftScene } from "./viewport-soft";

/**
 * Hranice chyb kolem 3D okna: výjimka při vykreslování nebo v efektech 3D okna neshodí celou aplikaci –
 * 3D okno se odpojí a aplikace zobrazí chybovou obrazovku (ViewportFallback). Změna `resetKey` umožní nový pokus.
 * Odkaz (ref) odpojeného 3D okna mezitím drží náhradní ovládání, které míří do softwarového náhledu – pohledy
 * a přizpůsobení z pásu karet, kláves i textových příkazů tak fungují dál.
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
    if (!this.state.failed) return this.props.children;
    const ch = this.props.children;
    const ref = isValidElement<{ ref?: Ref<ViewportHandle> }>(ch) ? ch.props.ref : undefined;
    return ref ? <SoftHandle ref={ref} /> : null;
  }
}

/** Ovládání 3D okna přesměrované do softwarového náhledu (po pádu 3D okna); bez náhledu nedělá nic. */
const SoftHandle = forwardRef<ViewportHandle>(function SoftHandle(_, ref) {
  useImperativeHandle(
    ref,
    () => ({
      hintList: () => [],
      clickHint: () => false,
      setView: (v) => softView.current?.setView(v),
      fit: () => softView.current?.fit(),
      snapshot: () => softView.current?.snapshot() ?? null,
      bounds: () => softView.current?.bounds() ?? { center: [0, 0, 0], radius: 100 },
      // přiblížení na oblast (porovnání s referencí) – softwarový náhled ukáže celý model
      focus: () => softView.current?.fit(),
    }),
    [],
  );
  return null;
});

/**
 * Náhrada 3D okna, když WebGL není dostupné nebo selže.
 * Se scénou (`scene`) zobrazí model softwarově vykresleným náhledem (pohledy, přizpůsobení, přiblížení, otáčení –
 * bez výběru kliknutím) a příčinu s postupem nápravy schová pod tlačítko „Proč nevidím 3D?“.
 * Bez scény zobrazí rovnou chybovou obrazovku: česky příčina, postup, Zkusit znovu, Zkopírovat diagnostiku, nápověda.
 */
export function ViewportFallback({ failure, core, onRetry, onCopy, scene }: { failure: RenderFailure; core: string; onRetry: () => void; onCopy: () => void; scene?: SoftScene }) {
  const [why, setWhy] = useState(false);
  const [note, setNote] = useState(true);
  if (!scene) {
    return (
      <div role="alert" data-viewport-fallback className="absolute inset-0 z-20 overflow-y-auto bg-[#eef1f5]/95 p-4 sm:p-8">
        <HelpCard failure={failure} core={core} onRetry={onRetry} onCopy={onCopy} />
      </div>
    );
  }
  const title = explainRenderFailure(failure).title;
  return (
    <div data-viewport-fallback="soft" className="absolute inset-0">
      <SoftViewport
        scene={scene}
        toolbarExtra={
          <button type="button" data-soft-why aria-expanded={why} onClick={() => setWhy((v) => !v)} className={`${SOFT_BTN} border-brand/50 text-brand-600`}>
            {tr("Proč nevidím 3D?")}
          </button>
        }
      />
      {note && (
        <div role="status" data-soft-note className="absolute bottom-10 left-[92px] right-3 z-10 rounded-md border border-[#f3c6c2] bg-[#fff7f6]/95 py-2 pl-3 pr-7 text-[11.5px] leading-relaxed text-[#26303b] shadow lg:bottom-auto lg:left-3 lg:right-auto lg:top-3 lg:w-[276px]">
          <strong className="font-semibold">{tr("Zjednodušený náhled bez WebGL.")}</strong> {title}
          {tr(" – model se proto kreslí softwarově. Tažením otáčíte, kolečkem přibližujete, Shift + tažení posouvá. Výběr ploch a hran kliknutím zde nefunguje: použijte seznamy ve formulářích prvků a textové příkazy. Příčinu a postup nápravy ukáže tlačítko „Proč nevidím 3D?“.")}
          <button type="button" onClick={() => setNote(false)} aria-label={tr("Skrýt")} className="absolute right-1 top-1 rounded p-0.5 text-[#6b7785] hover:bg-white">
            <CadIcon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {why && (
        <div role="alert" data-viewport-help className="absolute inset-0 z-30 overflow-y-auto bg-[#eef1f5]/95 p-4 sm:p-8" onClick={() => setWhy(false)}>
          <HelpCard failure={failure} core={core} onRetry={onRetry} onCopy={onCopy} onClose={() => setWhy(false)} soft />
        </div>
      )}
    </div>
  );
}

/** Karta s příčinou a postupem nápravy. */
function HelpCard({ failure, core, onRetry, onCopy, onClose, soft }: { failure: RenderFailure; core: string; onRetry: () => void; onCopy: () => void; onClose?: () => void; soft?: boolean }) {
  const e = explainRenderFailure(failure);
  return (
    <div className="relative mx-auto max-w-2xl rounded-lg border border-[#d5dbe2] bg-white p-5 shadow-sm" onClick={(ev) => ev.stopPropagation()}>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={tr("Zavřít")} className="absolute right-2 top-2 rounded p-1 text-[#6b7785] hover:bg-[#eef2f6]">
          <CadIcon name="x" className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#fff1f0]">
          <CadIcon name="eye" className="h-6 w-6 text-brand" />
        </span>
        <div className="min-w-0 pr-6">
          <h2 className="text-[16px] font-semibold text-[#1f2933]">{e.title}</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#3c4856]">{e.cause}</p>
        </div>
      </div>
      <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7785]">{tr("Co zkusit")}</h3>
      <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-[#26303b]">
        {e.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="mt-3 rounded-md border border-[#e3e8ee] bg-[#f7f9fb] p-3 text-[12px] leading-relaxed text-[#3c4856]">
        {soft
          ? tr("Ostatní části programu fungují dál: nabídky, nápověda, nastavení, otevření a uložení souborů, 2D skica i výkresy. Model se místo 3D okna zobrazuje jako zjednodušený náhled: pohledy, přizpůsobení, přiblížení, otáčení i řez fungují, výběr ploch a hran kliknutím ne – použijte seznamy ve formulářích prvků a textové příkazy.")
          : e.note}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className="rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white shadow hover:bg-brand-600">
          {tr("Zkusit znovu")}
        </button>
        <button type="button" onClick={onCopy} className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f3f6f9]">
          {tr("Zkopírovat diagnostiku")}
        </button>
        <a href={langMeta().docs} target="_blank" rel="noopener" className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f3f6f9]">
          {tr("Nápověda a dokumentace")}
        </a>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[#f3f6f9]">
            {tr("Zpět k náhledu")}
          </button>
        )}
      </div>
      <p className="mt-3 break-words font-mono text-[10.5px] text-[#8a95a3]">
        Technicky: {failure.error.message} {tr("· WebGL:")}{" "}{failure.probe.ok ? `${failure.probe.api} · ${failure.probe.renderer ?? ""}` : tr("nedostupné")} {tr("· jádro:")}{" "}{core}
      </p>
    </div>
  );
}
