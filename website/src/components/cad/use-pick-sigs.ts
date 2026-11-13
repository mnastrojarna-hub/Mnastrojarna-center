"use client";
/**
 * Otisky výběru hran / ploch / vrcholů (zápis viz `cad/pick-fields.ts`, jádro `cad/pick-sigs.ts`).
 *
 * Upravovaný prvek: po každé změně výběru (klik v modelu, seznam / pravidlo, „+ aktuální výběr“) jádro ve workeru doplní otisky nově
 * vybraných entit z tělesa PŘED prvkem; přečísloval-li změna dřívějšího prvku hrany/plochy, přepíše indexy prvku na znovunalezené entity,
 * takže zvýraznění v modelu i další klikání sedí na skutečné entity. Úprava nemění geometrii, proto jde mimo historii Zpět.
 * Textové příkazy (výběr pravidlem) razítkují přes `stampFeature` ještě před přidáním prvku.
 */
import { useEffect } from "react";
import { cad } from "@/cad/client";
import { hasPicks, mergePicks, picksKey } from "@/cad/pick-fields";
import type { CadDoc, Feature } from "@/cad/types";
import { docBefore } from "./entity-multi-pick";

const ids = new WeakMap<object, number>();
let seq = 0;
const idOf = (o: object) => {
  let v = ids.get(o);
  if (v === undefined) ids.set(o, (v = ++seq));
  return v;
};

/** klíč tělesa před prvkem: identita dřívějších prvků (nezměněné prvky si objekt drží) + nastavení dokumentu, která mění geometrii */
function beforeKey(d: CadDoc, f: Feature): string {
  const i = d.features.findIndex((x) => x.id === f.id);
  const prev = i >= 0 ? d.features.slice(0, i) : d.features;
  return JSON.stringify([prev.map(idOf), d.variables ?? null, d.bindings ?? null, d.configs ?? null, d.activeConfig ?? null, d.activeBody ?? null, f.body ?? null]);
}
const stateKey = (d: CadDoc, f: Feature) => `${beforeKey(d, f)}|${picksKey(f)}`;

/** Prvek s otisky výběru spočtenými nad dokumentem `before` (prvek do něj teprve přibude). Při chybě jádra vrátí prvek beze změny. */
export async function stampFeature(before: CadDoc, f: Feature): Promise<Feature> {
  if (!hasPicks(f)) return f;
  try {
    const res = await cad.pickSigs(before, f);
    return res?.changed ? res.feature : f;
  } catch {
    return f;
  }
}

/**
 * Hlídá výběr upravovaného prvku `activeId` a doplňuje / opravuje otisky. `update` = změna dokumentu mimo historii (funkčně nad
 * aktuálním stavem); převezme se jen tehdy, když se mezitím nezměnil výběr ani nic před prvkem.
 */
export function usePickSigs(doc: CadDoc, activeId: string | null, update: (fn: (d: CadDoc) => CadDoc) => void, enabled = true) {
  const f = enabled && activeId && doc.kind !== "assembly" ? (doc.features.find((x) => x.id === activeId) ?? null) : null;
  const key = f && hasPicks(f) ? stateKey(doc, f) : "";
  useEffect(() => {
    if (!key || !f) return;
    let dead = false;
    const before = docBefore(doc, f);
    const t = window.setTimeout(() => {
      cad.pickSigs(before, f).then(
        (res) => {
          if (dead || !res?.changed) return;
          update((d) => {
            const cur = d.features.find((x) => x.id === f.id);
            if (!cur || stateKey(d, cur) !== key) return d;
            const next = mergePicks(cur, res.feature);
            return { ...d, features: d.features.map((x) => (x === cur ? next : x)) };
          });
        },
        () => undefined, // zrušený výpočet / chyba jádra: výběr zůstane bez otisku (stavba jako dřív)
      );
    }, 120);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
    // klíč nese obsah (identitu dřívějších prvků a výběr) – objekty `doc` a `f` se mění při každém vykreslení
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
