/**
 * Stav prvku ve stromu prvků – stejné úrovně jako protokol textových příkazů (vlna 22, cad/feature-levels.ts):
 * ✗ prvek nevznikl · ⚠ vznikl s výhradou · ? vznikl, ale platnost tělesa se nekontrolovala · – potlačený (nestavěl se) ·
 * (bez značky) ✓.
 * Atributy `data-feature-*` řádku nesou tentýž stav strojově (e2e porovnává strom s protokolem).
 */
import { featureState, levelsText, uncheckedText } from "@/cad/feature-levels";
import { tr } from "@/cad/i18n";
import type { FeatureStatus } from "@/cad/types";

/** atributy řádku prvku: stav, úroveň účinku, úroveň tělesa a text úrovní (jako za ✓ v protokolu) */
export function featureStateAttrs(st: FeatureStatus | undefined): Record<string, string | undefined> {
  const state = featureState(st);
  return {
    "data-feature-state": state ?? "pending",
    "data-feature-effect": st?.ok ? st.effect?.level : undefined,
    "data-feature-body": st?.ok && st.body ? (st.body.solids === 0 ? "none" : st.body.valid === null ? "unchecked" : st.body.valid ? "valid" : "invalid") : undefined,
    "data-feature-levels": levelsText(st) || undefined,
  };
}

/** značka stavu vpravo v řádku prvku (✓ značku nemá – úrovně jsou v popisku názvu a pod aktivním prvkem) */
export function FeatureStateBadge({ st }: { st: FeatureStatus | undefined }) {
  const state = featureState(st);
  if (!st || !state || state === "ok") return null;
  if (state === "error")
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-white" title={st.error}>
        !
      </span>
    );
  if (state === "off")
    return (
      <span data-feature-off className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#c3cad2] text-[10px] font-bold text-white" title={tr("Prvek je potlačený – nestaví se a nemá výsledek.")}>
        –
      </span>
    );
  if (state === "warn")
    return (
      <span data-feature-warning className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white" title={st.warning}>
        ⚠
      </span>
    );
  return (
    <span data-feature-unchecked className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#8a96a3] text-[10px] font-bold text-white" title={tr("Platnost tělesa po tomto prvku nebyla zkontrolována ({0}).", uncheckedText({ why: st.body?.why, faces: st.body?.faces ?? 0 }))}>
      ?
    </span>
  );
}

/** řádek pod aktivním prvkem: chyba, varování, nebo úrovně stavu (účinek · těleso) */
export function FeatureStateNote({ st }: { st: FeatureStatus | undefined }) {
  if (!st) return null;
  if (!st.ok) return <p className="mx-2 mb-1 rounded bg-brand/10 px-2 py-1 text-[11px] text-brand-600">{st.error}</p>;
  if (st.warning) return <p className="mx-2 mb-1 rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-800">{st.warning}</p>;
  const lv = levelsText(st);
  return lv ? (
    <p data-feature-levels-note className="mx-2 mb-1 rounded bg-[#eef2f6] px-2 py-1 text-[11px] text-[#4a5663]">
      {lv}
    </p>
  ) : null;
}
