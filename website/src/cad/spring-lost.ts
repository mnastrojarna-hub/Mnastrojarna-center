/**
 * Ztracená dosedací plocha pružiny v sestavě (vlna 22, bod 20 – pružinová část, fáze 2 kolo 4).
 *
 * Po změně dílu (`sestava hotovo`, GUI „Zpět do sestavy“, `sestava obnovit` / „Obnovit z dílu“) prověří reference vazeb i dosedacích
 * ploch pružin jedna funkce (cad/asm-agent.ts `remapAsmRefs`). Dosedací plocha, kterou po úpravě dílu nejde jednoznačně najít, nese
 * `MateRef.lost` (otisk původní plochy) – délka pružiny se z ní nepočítá a nikde se nesmí ukázat uložená délka se ✓ jako platná.
 * Tento modul je čistý (jen typy + tr): kdo je ztracená, krátký popis a příkaz opravy – pro výpis vazeb, `sestava pružiny`, `stav`,
 * pohyb i GUI (seznam vazeb, panel pružiny).
 */
import { tr } from "./i18n";
import type { AsmComponent, CadDoc, MateRef, SpringDef } from "./types";

export type SpringSide = "a" | "b";

/** strany pružiny se ztracenou dosedací plochou */
export const springLostSides = (s?: SpringDef): SpringSide[] => (s ? (["a", "b"] as const).filter((k) => !!s[k]?.lost) : []);

/** pružiny sestavy se ztracenou dosedací plochou (pořadí komponent) */
export const lostSpringComps = (doc: CadDoc): AsmComponent[] => (doc.components ?? []).filter((c) => springLostSides(c.spring).length > 0);

/** „F3“ / „E2“ / „V1“ */
const entText = (r: MateRef) => `${r.ent === "edge" ? "E" : r.ent === "vertex" ? "V" : "F"}${r.face + 1}`;

/** komponenta pro textový příkaz: přezdívka / jediný název v uvozovkách, jinak #k */
export function compArgText(doc: CadDoc, id: string): string {
  const comps = doc.components ?? [];
  const c = comps.find((x) => x.id === id);
  if (!c) return "?";
  if (c.alias) return `"${c.alias}"`;
  return comps.filter((x) => x.name === c.name).length > 1 ? `#${comps.indexOf(c) + 1}` : `"${c.name}"`;
}

/** název komponenty odkazu (list podsestavy: název komponenty nejvyšší úrovně) */
const compName = (doc: CadDoc, id: string) => doc.components?.find((x) => x.id === id)?.name ?? "?";

/** „A F3 („Deska A“)“ – ztracené strany pružiny krátce (bez otisku) */
export function springLostShort(doc: CadDoc, c: AsmComponent): string {
  const s = c.spring;
  return springLostSides(s)
    .map((k) => `${k.toUpperCase()} ${entText(s![k])} („${compName(doc, s![k].compId)}“)`)
    .join(", ");
}

/**
 * Příkaz opravy: nové dosedací plochy stejným příkazem jako při zadání – ztracená strana `<plocha>`, platná strana své dosavadní číslo
 * (`sestava pružina "Pružina" mezi "Deska A" <plocha> "Přidržovač" F5`), nebo pružinu odebrat.
 */
export function springFixCmd(doc: CadDoc, c: AsmComponent): string {
  const s = c.spring!;
  const side = (k: SpringSide) => `${compArgText(doc, s[k].compId)} ${s[k].lost ? tr("<plocha>") : entText(s[k])}`;
  const me = compArgText(doc, c.id);
  return tr("sestava pružina {0} mezi {1} {2} | sestava pružina {0} odebrat", me, side("a"), side("b"));
}

/** krátká věta pro řádky stavu / pohybu: „„Pružina“ – ztracená dosedací plocha A F3 („Deska A“): délka nezkontrolována – sestava pružina …“ */
export function springLostNote(doc: CadDoc, c: AsmComponent, ref = ""): string {
  return tr("„{0}“{1} – ztracená dosedací plocha {2}: délka a síla nezkontrolovány – {3}", c.name, ref, springLostShort(doc, c), springFixCmd(doc, c));
}

/**
 * `sestava pružina #k odebrat` – tentýž textový příkaz jako tlačítko „Odebrat“ v panelu pružiny (asm-spring-props.tsx): GUI seznam
 * vazeb jde přes agenta, takže v protokolu je „✓ pružina odebrána“ a záznam agenta, ne tichá změna dokumentu.
 */
export function springRemoveCmd(doc: CadDoc, id: string): string {
  return `sestava pružina #${(doc.components ?? []).findIndex((x) => x.id === id) + 1} odebrat`;
}

/** sestava bez definice pružiny komponenty `id` (komponenta zůstává – jako `sestava pružina "P" odebrat`) */
export function withoutSpringOf(doc: CadDoc, id: string): CadDoc {
  return {
    ...doc,
    components: (doc.components ?? []).map((c) => {
      if (c.id !== id || !c.spring) return c;
      const out = { ...c };
      delete out.spring;
      return out;
    }),
  };
}

/** GUI: „A: dosedací plocha F3 dílu „Deska A“ – po úpravě dílu neexistuje“ po stranách */
export function springLostSideTexts(doc: CadDoc, c: AsmComponent): string[] {
  const s = c.spring;
  return springLostSides(s).map((k) => {
    const r = s![k];
    const why = r.lost!.why === "ambiguous" ? tr("není jednoznačná") : r.lost!.why === "unknown" ? tr("nejde ověřit") : r.lost!.why === "gone" ? tr("díl v podsestavě už není") : tr("po úpravě dílu neexistuje");
    return tr("{0}: dosedací plocha {1} dílu „{2}“ – {3}", k.toUpperCase(), entText(r), compName(doc, r.compId), why);
  });
}
