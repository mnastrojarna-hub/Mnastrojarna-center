/**
 * Mikronávody u ikon pásu karet (bublina po najetí myší): co příkaz dělá, kdy ho použít, co vybrat a jak postupovat.
 *
 * Texty jsou v balících `tips/<balík>.<jazyk>.ts` (čeština je zdroj a načítá se hned, angličtina a němčina až při prvním
 * použití v daném jazyce – nejsou v úvodním balíku aplikace). Klíč = `RItem.id` tlačítka. Znamená-li stejné id na různých
 * místech něco jiného, použije se klíč s kontextem `<kontext>/<id>`; kontext je karta pásu (`create`, `sketch`, `asm`…),
 * rozbalovací nabídka `menu:<id tlačítka>`, pracovní plocha výkresu `drawing-ws` nebo rychlá lišta u výběru `quick`.
 * Hledá se `<kontext>/<id>`, pak `<kontext>/*` (společný návod pro všechny položky nabídky, např. barvy nebo rozměry
 * normálií) a nakonec samotné `<id>`.
 */
import { getLang, type CadLang } from "@/cad/i18n";
import { CS_TIPS, TIP_PACKAGES, loadTipPackage, type TipPackage } from "./tips/index";

export type MicroTip = {
  /** jedna věta: co příkaz dělá (do ~110 znaků) */
  what: string;
  /** jedna věta: kdy ho použít, typický případ (do ~110 znaků) */
  when: string;
  /** co vybrat nebo připravit předem či ve formuláři (hrany, plochy, skicu, komponentu…); bez výběru vynechat */
  select?: string;
  /** 1–3 krátké kroky v rozkazovacím způsobu, názvy polí přesně jako ve formuláři (do ~80 znaků) */
  steps: string[];
  /** ekvivalentní textový příkaz (konzole, AI agenti) – musí projít parseAgentText */
  cmd?: string;
  /** nejčastější past nebo omezení, jeden řádek */
  note?: string;
};
export type TipMap = Record<string, MicroTip>;

/** Délkové limity polí ve znacích pro češtinu (angličtina a němčina mají rezervu 35 %, `cmd` ne) – hlídá je tips.test.ts. */
export const TIP_LIMITS = { what: 120, when: 120, select: 140, step: 90, cmd: 60, note: 130, steps: 3 } as const;

/** Pořadí klíčů, ve kterém se návod hledá. */
export function tipKeys(id: string, ctx?: string): string[] {
  return ctx ? [`${ctx}/${id}`, `${ctx}/*`, id] : [id];
}

/** Návod pro tlačítko v daném kontextu ze slovníku (nebo null) – i s klíčem, který se použil. */
export function resolveTip(map: Record<string, MicroTip | undefined>, id: string, ctx?: string): { key: string; tip: MicroTip } | null {
  for (const key of tipKeys(id, ctx)) {
    const tip = map[key];
    if (tip) return { key, tip };
  }
  return null;
}

// ---------- slovníky podle jazyka ----------

const merged: Partial<Record<CadLang, TipMap>> = {};
const pending: Partial<Record<CadLang, Promise<TipMap>>> = {};
const listeners = new Set<() => void>();

function mergePackages(parts: TipMap[]): TipMap {
  return Object.assign({}, ...parts) as TipMap;
}
merged.cs = mergePackages(TIP_PACKAGES.map((p) => CS_TIPS[p]));

/** Je slovník jazyka načtený (čeština vždy)? */
export const tipsReady = (lang: CadLang = getLang()) => !!merged[lang];

/** Načte balíky návodů jazyka (angličtina, němčina líně); po načtení upozorní posluchače (bublina se překreslí). */
export function loadTips(lang: CadLang = getLang()): Promise<TipMap> {
  const have = merged[lang];
  if (have) return Promise.resolve(have);
  return (pending[lang] ??= Promise.all(TIP_PACKAGES.map((p: TipPackage) => loadTipPackage(lang as Exclude<CadLang, "cs">, p))).then((parts) => {
    const m = mergePackages(parts);
    merged[lang] = m;
    for (const l of listeners) l();
    return m;
  }));
}

/** Přihlášení k načtení dalšího jazyka (vrací odhlášení). */
export function onTipsLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Návod pro tlačítko `id` v kontextu `ctx` v aktuálním jazyce. Není-li slovník jazyka ještě načtený, vrátí null
 * a načítání spustí (volající ukáže náhradní bublinu: název, zkratka, krátká nápověda).
 */
export function lookupTip(id: string, ctx?: string, lang: CadLang = getLang()): MicroTip | null {
  const map = merged[lang];
  if (!map) {
    void loadTips(lang);
    return null;
  }
  return resolveTip(map, id, ctx)?.tip ?? null;
}
