"use client";
/**
 * Panel Kolize řízený stavem (vlna 22, bod 1): žádná vlastní kopie výsledku – dostane záznam kontroly AKTIVNÍHO dokumentu
 * z enginu (`ws.asm.clash` pod klíčem dokumentu) a jeho stav vůči právě zobrazenému stavu sestavy
 * (`clashStateOf`, cad/engine/result-key.ts):
 *
 *  * `ok`        – zkontrolováno přesně pro tento dokument, revizi dílů, konfiguraci a polohu → „Bez kolizí ✓“,
 *  * `clash`     – totéž, s průniky → seznam dvojic,
 *  * `stale`     – sestava se od kontroly změnila (posun, úprava dílu, konfigurace, krok mechanismu) → „Neplatí“,
 *  * `unchecked` – pro tento dokument kontrola neproběhla (jiná záložka, nový dokument) → „Nezkontrolováno“.
 *
 * Zelený stav se nikdy neukáže pro jiný dokument ani pro jiný stav sestavy; neplatný a chybějící výsledek nabídne
 * „Zkontrolovat znovu“. Hlavička výsledku říká, pro co platí: dokument, počet komponent, čas, revize modelu a poloha
 * mechanismu. Formulace o vůli a třídy kolizí doplní balík C (zde jen stavové řízení).
 */
import type { ClashState, ResultId } from "@/cad/engine/result-key";
import { tr } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";
import { fmtNum } from "@/lib/mesh-metrics";
import { clashHeader, clashNote, clashTitle, type ClashPanelEntry } from "./clash-view";
import { FloatPanel } from "./ui";

export function ClashPanel({
  doc,
  docKey,
  state,
  entry,
  id,
  busy,
  top,
  onRecheck,
  onClose,
  onSelect,
}: {
  /** aktivní sestava (názvy komponent) */
  doc: CadDoc;
  docKey: string;
  state: ClashState;
  /** záznam kontroly aktivního dokumentu (undefined = žádný) */
  entry?: ClashPanelEntry;
  /** identita, pro kterou záznam vznikl (razítko) */
  id?: ResultId;
  /** kontrola právě běží */
  busy?: boolean;
  top?: number;
  onRecheck: () => void;
  onClose: () => void;
  onSelect: (compId: string) => void;
}) {
  const valid = state === "ok" || state === "clash";
  const n = entry?.res.length ?? 0;
  return (
    <FloatPanel title={clashTitle(state, n)} icon="section" tone={state === "ok" ? "tool" : "cut"} onClose={onClose} initial={{ x: 12, y: top ?? 12 }}>
      <div data-clash-panel data-clash-state={state} data-clash-doc={docKey} data-clash-name={doc.name} data-clash-rev={valid ? (id?.rev ?? "") : ""} data-clash-pose={valid ? (id?.pose ?? "") : ""} data-clash-busy={busy ? "1" : undefined}>
        {valid && entry && (
          <>
            <p data-clash-result className="mb-1 text-[11px] leading-snug text-[#5b6776]">
              {n ? `${n} ${n === 1 ? tr("průnik") : n < 5 ? tr("průniky") : tr("průniků")}` : tr("Žádný průnik komponent")} {tr("· zkontrolováno")} {clashHeader(entry, id, doc.name)}
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {entry.res.map((x, i) => {
                const a = doc.components?.find((c) => c.id === x.a);
                const b = doc.components?.find((c) => c.id === x.b);
                return (
                  <button key={i} type="button" onClick={() => onSelect(x.a)} className="block w-full rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-[#fde3e1]">
                    <span className="font-medium">{a?.name}</span> × <span className="font-medium">{b?.name}</span>
                    <span className="block font-mono text-[10.5px] text-brand-600">{fmtNum(x.volume, 2)} mm³</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {!valid && (
          <>
            <p data-clash-note className="mb-2 rounded border border-[#f1d9a7] bg-[#fff8e6] px-2 py-1.5 text-[11.5px] leading-snug text-[#7a5600]">
              {clashNote(state)}
            </p>
            {state === "stale" && entry && (
              <p data-clash-old className="mb-2 text-[10.5px] leading-snug text-[#8a95a3]">
                {tr("Poslední kontrola platila pro:")} {clashHeader(entry, id, doc.name)}
              </p>
            )}
            <button type="button" data-clash-recheck disabled={busy} onClick={onRecheck} className="w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {busy ? tr("Kontroluji kolize…") : state === "stale" ? tr("Zkontrolovat znovu") : tr("Zkontrolovat kolize")}
            </button>
          </>
        )}
        {valid && busy && <p className="mt-1 text-[11px] text-[#8a95a3]">{tr("Kontroluji kolize…")}</p>}
      </div>
    </FloatPanel>
  );
}
