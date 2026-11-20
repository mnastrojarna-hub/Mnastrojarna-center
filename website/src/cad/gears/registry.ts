/** Registr druhů kol: `KINDS`, hledání podle id prvku, převod řádků tabulky na parametry automatického formuláře. */
import type { ExtParam } from "../ext/registry";
import { BEVEL } from "./bevel";
import { CYCLODISC } from "./cyclodisc";
import { CYCLOID } from "./cycloid";
import { HELICAL, HERRINGBONE, INTERNAL, SPUR } from "./cylindrical";
import { HYPOID } from "./hypoid";
import { PULLEY } from "./pulley";
import { RACK } from "./rackgear";
import { RATCHET } from "./ratchet";
import { SPROCKET } from "./sprocket";
import type { GearData, GearKind, GearRow, KindDef } from "./types";
import { WORM } from "./worm";
import { WORMWHEEL } from "./wormwheel";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- registr drží druhy s různými typy zadání a výpočtu */
export type AnyKind = KindDef<any, any>;

export const KINDS: Record<GearKind, AnyKind> = {
  spur: SPUR,
  helical: HELICAL,
  herringbone: HERRINGBONE,
  internal: INTERNAL,
  rack: RACK,
  bevel: BEVEL,
  hypoid: HYPOID,
  worm: WORM,
  wormwheel: WORMWHEEL,
  cycloid: CYCLOID,
  cyclodisc: CYCLODISC,
  sprocket: SPROCKET,
  pulley: PULLEY,
  ratchet: RATCHET,
};
export const GEAR_KINDS = Object.keys(KINDS) as GearKind[];

/** druh podle id prvku rozšíření („gear.spur“) */
export const kindOfExt = (ext: string): AnyKind | undefined => (ext.startsWith("gear.") ? KINDS[ext.slice(5) as GearKind] : undefined);

/** řádky tabulky → parametry automatického formuláře prvku rozšíření (a obecného příkazu `prvek gear.*`) */
export function rowsToParams(rows: GearRow[]): ExtParam[] {
  return rows.map((r): ExtParam => {
    const hint = r.hint || undefined;
    switch (r.kind) {
      case "number":
      case "int":
        return { key: r.key, label: r.label, kind: "number", ...(r.unit !== undefined ? { unit: r.unit } : r.kind === "int" ? { unit: "" } : {}), ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}), step: r.step ?? (r.kind === "int" ? 1 : undefined), hint };
      case "enum":
        return { key: r.key, label: r.label, kind: "enum", options: r.options ?? [], hint };
      case "bool":
        return { key: r.key, label: r.label, kind: "bool", hint };
      case "vec3":
        return { key: r.key, label: r.label, kind: "vec3", hint };
      case "point":
        return { key: r.key, label: r.label, kind: "point", hint };
      case "direction":
        return { key: r.key, label: r.label, kind: "direction", hint };
      case "mode":
        return { key: r.key, label: r.label, kind: "mode", newLabel: NEW_BODY() };
      default:
        return { key: r.key, label: r.label, kind: "text", hint };
    }
  });
}
import { tr } from "../i18n";
const NEW_BODY = () => tr("Nové těleso");

/** data prvku doplněná o výchozí hodnoty druhu (chybějící klíče starších dokumentů) */
export const withDefaults = (def: AnyKind, data: GearData): GearData => ({ ...def.defaults(), ...data });
