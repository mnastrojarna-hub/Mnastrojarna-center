"use client";
/**
 * Přesná kontrola platnosti tělesa ve stavovém řádku (vlna 22, bod 22a): po stavbě proběhne jen rychlá kontrola BRepCheck –
 * čip to říká („platné · rychlá kontrola“) a tlačítkem spustí přesnou (operace jádra `validity`, stejná jako `kontrola přesně`
 * v konzoli a CLI). Výsledek platí jen pro geometrii, pro kterou vznikl (otisk `geometrySig` – po změně modelu zmizí).
 * Stav pro e2e: `data-validity` = fast | running | exact-ok | exact-bad | skipped | error.
 */
import { useState } from "react";
import { cad } from "@/cad/client";
import { geometrySig } from "@/cad/engine/result-key";
import { tr } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";
import { EXACT_MAX_FACES, validityText, type ValidityResult } from "@/cad/validity";

type Shown = { sig: string; v: ValidityResult | null; error?: string };

export function ValidityChip({ doc, fast, dark }: { doc: CadDoc; fast: boolean; dark?: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const sig = geometrySig(doc);
  const cur = shown && shown.sig === sig ? shown : null;
  const run = async () => {
    setRunning(sig);
    try {
      const v = await cad.validity(doc, EXACT_MAX_FACES);
      setShown({ sig, v });
    } catch (e) {
      setShown({ sig, v: null, error: (e as Error)?.message ?? String(e) });
    } finally {
      setRunning(null);
    }
  };
  const state = running === sig ? "running" : !cur ? "fast" : cur.error ? "error" : cur.v?.method === "exact" ? (cur.v.valid ? "exact-ok" : "exact-bad") : "skipped";
  const cls = `rounded-full px-2 py-0.5 text-[11px] ${state === "exact-bad" || state === "error" ? "bg-brand/15 text-brand-700" : dark ? "bg-white/10 text-white/85" : "bg-ink-700/6 text-ink-700"}`;
  const label =
    state === "running"
      ? tr("Přesná kontrola platnosti…")
      : state === "exact-ok"
        ? tr("platné · přesná kontrola")
        : state === "exact-bad"
          ? tr("NEPLATNÉ · přesná kontrola ({0} ploch)", cur!.v!.badFaces)
          : state === "skipped"
            ? tr("přesná kontrola neprovedena")
            : state === "error"
              ? tr("přesná kontrola selhala")
              : fast
                ? tr("platné · rychlá kontrola")
                : tr("NEPLATNÉ · rychlá kontrola");
  const title = cur?.v ? validityText(cur.v, fast) : cur?.error ? cur.error : tr("Po stavbě proběhla rychlá kontrola platnosti (BRepCheck). Kliknutím spustíte přesnou kontrolu (odchylka hran od ploch počítaná přesně) – totéž jako „kontrola přesně“ v konzoli.");
  return (
    <button type="button" data-validity={state} className={cls} title={title} disabled={state === "running"} onClick={() => void run()}>
      {label}
    </button>
  );
}
