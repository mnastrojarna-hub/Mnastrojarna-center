/**
 * Balíky mikronávodů. Čeština je zdroj a výchozí jazyk – importuje se staticky. Angličtina a němčina se načítají až
 * v daném jazyce (dynamický import), aby nebyly v úvodním balíku aplikace.
 *
 * Balíky (soubory `<balík>.cs.ts`, `<balík>.en.ts`, `<balík>.de.ts`, každý `export default { … } satisfies Record<string, MicroTip>`):
 *   create      – karta Tvorba (vestavěné příkazy a jejich nabídky)
 *   edit        – karty Nástroje, Zobrazení, Data, rychlá lišta u výběru (`quick/…`) a obecné nabídky
 *   sketchdraw  – karta Skica, karta Sestava, karta Výkres a lišty pracovní plochy výkresu (`drawing-ws/…`)
 *   ext         – karty Plochy, Plech, Svařence a všechny prvky rozšíření (src/cad/ext/*.ts), ať jsou na kterékoli kartě
 * Které klíče musí každý balík obsahovat, říká `../tips-manifest.ts`.
 */
import type { MicroTip } from "../tips";
import create from "./create.cs";
import edit from "./edit.cs";
import ext from "./ext.cs";
import sketchdraw from "./sketchdraw.cs";

export const TIP_PACKAGES = ["create", "edit", "sketchdraw", "ext"] as const;
export type TipPackage = (typeof TIP_PACKAGES)[number];

export const CS_TIPS: Record<TipPackage, Record<string, MicroTip>> = { create, edit, sketchdraw, ext };

type Mod = Promise<{ default: Record<string, MicroTip> }>;
const LOADERS: Record<"en" | "de", Record<TipPackage, () => Mod>> = {
  en: {
    create: () => import("./create.en"),
    edit: () => import("./edit.en"),
    sketchdraw: () => import("./sketchdraw.en"),
    ext: () => import("./ext.en"),
  },
  de: {
    create: () => import("./create.de"),
    edit: () => import("./edit.de"),
    sketchdraw: () => import("./sketchdraw.de"),
    ext: () => import("./ext.de"),
  },
};

/** Balík návodů v jazyce (čeština hned, ostatní dynamickým importem). */
export async function loadTipPackage(lang: "cs" | "en" | "de", p: TipPackage): Promise<Record<string, MicroTip>> {
  if (lang === "cs") return CS_TIPS[p];
  return (await LOADERS[lang][p]()).default;
}
