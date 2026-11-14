/**
 * Skupiny pásu karet jádra 2D výkresu (Kreslení, Úpravy, Hladiny, Výstup …) jako čistá funkce – pracovní plocha jí
 * předá stav a akce, balíky připojí své skupiny přes `UI_EXTS` (ui-exts.ts). Odděleno od React komponenty, aby test
 * mikronávodů (src/cad/draft/draft-tips.test.ts) mohl projít všechna id tlačítek bez vykreslení.
 */
import { tr } from "@/cad/i18n";
import { findCommand } from "@/cad/draft/commands";
import { setCurrentLayer, setLayer } from "@/cad/draft/layers";
import { linetypeLibrary, loadLinetype } from "@/cad/draft/linetypes";
import type { DraftModel } from "@/cad/draft/model";
import type { CadIconName } from "../cad-icons";
import type { RGroup, RItem } from "../ribbon";
import type { DraftRibbonTab } from "./ui-ext";

export type DraftCoreRibbonDeps = {
  /** zobrazený model */
  model: DraftModel;
  /** otevřený panel vpravo */
  panel: string | null;
  /** id běžícího příkazu (zvýraznění tlačítka) */
  activeCmd: string | null;
  command: (cmd: string, pre?: string[]) => void;
  selectAll: () => void;
  selectNone: () => void;
  setPanel: (id: string | null) => void;
  commit: (m: DraftModel) => void;
  /** změna hladin vybraných objektů (bez výběru jen hláška) */
  layerOfSel: (fn: (m: DraftModel, layer: string) => DraftModel, what: string) => void;
  /** hladina prvního vybraného objektu jako aktuální (bez výběru příkaz LAYMCUR) */
  currentFromSel: () => void;
  save: () => void;
  share: () => void;
};

/** skupiny pásu jádra podle karty */
export function draftCoreRibbon(d: DraftCoreRibbonDeps): Record<DraftRibbonTab, RGroup[]> {
  const model0 = d.model;
  const cmdItem = (id: string, label: string, icon: CadIconName, cmd: string, pre: string[] = [], hint?: string, kbd?: string): RItem => ({ id, label, icon, tone: "sketch", hint, kbd, onClick: () => d.command(cmd, pre), active: !!d.activeCmd && d.activeCmd === findCommand(cmd)?.id });
  return {
    draw: [
      {
        label: tr("Kreslit"),
        big: 4,
        items: [
          cmdItem("line", tr("Úsečka"), "line", "LINE", [], tr("úsečky na sebe navazující · Uzavřít, Zpět"), "L"),
          cmdItem("pline", tr("Křivka"), "polyline", "PLINE", [], tr("úseky a oblouky jedné entity, šířka"), "PL"),
          { id: "circle", label: tr("Kružnice"), icon: "circle", tone: "sketch", kbd: "C", onClick: () => d.command("CIRCLE"), menu: [
            { id: "c1", label: tr("Střed, poloměr"), icon: "circle", onClick: () => d.command("CIRCLE") },
            { id: "c3", label: tr("2 body"), icon: "circle", onClick: () => d.command("CIRCLE", ["2p"]) },
            { id: "c4", label: tr("3 body"), icon: "circle", onClick: () => d.command("CIRCLE", ["3p"]) },
            { id: "c5", label: tr("Tečná, tečná, poloměr"), icon: "circle", onClick: () => d.command("CIRCLE", ["ttr"]) },
          ] },
          { id: "arc", label: tr("Oblouk"), icon: "arc", tone: "sketch", kbd: "A", onClick: () => d.command("ARC"), menu: [
            { id: "a1", label: tr("3 body"), icon: "arc", onClick: () => d.command("ARC") },
            { id: "a2", label: tr("Počátek, střed, konec"), icon: "arcCenter", onClick: () => d.command("ARC") },
            { id: "a3", label: tr("Střed, počátek, konec"), icon: "arcCenter", onClick: () => d.command("ARC", ["center"]) },
          ] },
          cmdItem("rect", tr("Obdélník"), "rect", "RECTANG", [], tr("dva rohy, rozměry, zaoblení, zkosení"), "REC"),
          cmdItem("polygon", tr("Mnohoúhelník"), "polygon", "POLYGON", [], undefined, "POL"),
          { id: "ellipse", label: tr("Elipsa"), icon: "ellipse", tone: "sketch", kbd: "EL", onClick: () => d.command("ELLIPSE"), menu: [
            { id: "e1", label: tr("Osa, konec"), icon: "ellipse", onClick: () => d.command("ELLIPSE") },
            { id: "e2", label: tr("Střed"), icon: "ellipse", onClick: () => d.command("ELLIPSE", ["center"]) },
            { id: "e3", label: tr("Eliptický oblouk"), icon: "arc", onClick: () => d.command("ELLIPSE", ["arc"]) },
          ] },
          { id: "spline", label: tr("Spline"), icon: "spline", tone: "sketch", kbd: "SPL", onClick: () => d.command("SPLINE"), menu: [
            { id: "s1", label: tr("Proložením bodů"), icon: "spline", onClick: () => d.command("SPLINE", ["method", "fit"]) },
            { id: "s2", label: tr("Řídicími body"), icon: "spline", onClick: () => d.command("SPLINE", ["method", "cv"]) },
          ] },
          cmdItem("xline", tr("Přímka"), "construction", "XLINE", [], tr("nekonečná konstrukční přímka"), "XL"),
          cmdItem("ray", tr("Polopřímka"), "construction", "RAY"),
          cmdItem("point", tr("Bod"), "point", "POINT", [], undefined, "PO"),
        ],
      },
      { label: tr("Text"), big: 1, items: [cmdItem("text", tr("Text"), "text", "TEXT", [], tr("jednořádkový text"), "DT")] },
      {
        label: tr("Dotazy"),
        items: [cmdItem("dist", tr("Vzdálenost"), "measure", "DIST", [], undefined, "DI"), cmdItem("area", tr("Plocha"), "measure", "AREA", [], undefined, "AA"), cmdItem("id", tr("Souřadnice"), "point", "ID"), cmdItem("list", tr("Výpis"), "info", "LIST", [], undefined, "LI")],
      },
    ],
    modify: [
      {
        label: tr("Výběr"),
        items: [
          { id: "all", label: tr("Vybrat vše"), icon: "select", kbd: "Ctrl+A", onClick: d.selectAll },
          { id: "none", label: tr("Zrušit výběr"), icon: "x", kbd: "Esc", onClick: d.selectNone },
        ],
      },
      { label: tr("Upravit"), big: 2, items: [cmdItem("erase", tr("Smazat"), "trash", "ERASE", [], undefined, "Del"), { id: "props", label: tr("Vlastnosti"), icon: "edit", active: d.panel === "properties", onClick: () => d.setPanel(d.panel === "properties" ? null : "properties") }] },
    ],
    layers: [
      {
        label: tr("Hladiny"),
        big: 2,
        items: [
          { id: "lm", label: tr("Správce hladin"), icon: "layers", tone: "view", active: d.panel === "layers", onClick: () => d.setPanel(d.panel === "layers" ? null : "layers"), kbd: "LA" },
          { id: "cur", label: tr("Aktuální: {0}", model0.vars.clayer), icon: "check", menu: model0.layers.map((l) => ({ id: `cl-${l.name}`, label: l.name, icon: (l.name === model0.vars.clayer ? "check" : "layers") as CadIconName, disabled: l.frozen, onClick: () => d.commit(setCurrentLayer(model0, l.name)) })) },
          { id: "mcur", label: tr("Aktuální podle objektu"), icon: "select", onClick: d.currentFromSel },
          { id: "loff", label: tr("Vypnout hladinu objektu"), icon: "eye", onClick: () => d.layerOfSel((m, l) => setLayer(m, l, { on: false }), tr("vypnout hladinu")) },
          { id: "lfrz", label: tr("Zmrazit hladinu objektu"), icon: "eye", onClick: () => d.layerOfSel((m, l) => (l === m.vars.clayer ? m : setLayer(m, l, { frozen: true })), tr("zmrazit hladinu")) },
          { id: "llck", label: tr("Zamknout hladinu objektu"), icon: "lock", onClick: () => d.layerOfSel((m, l) => setLayer(m, l, { locked: true }), tr("zamknout hladinu")) },
          { id: "lall", label: tr("Zapnout a rozmrazit vše"), icon: "eye", onClick: () => d.commit({ ...model0, layers: model0.layers.map((l) => ({ ...l, on: true, frozen: false })) }) },
          { id: "lunl", label: tr("Odemknout vše"), icon: "lock", onClick: () => d.commit({ ...model0, layers: model0.layers.map((l) => ({ ...l, locked: false })) }) },
        ],
      },
      {
        label: tr("Typy čar"),
        items: [
          { id: "ltload", label: tr("Načíst typ čáry"), icon: "centerline", menu: linetypeLibrary(model0.vars.measurement === 1).map((l) => ({ id: `lt-${l.name}`, label: `${l.name} — ${l.desc.split(" ")[0]}`, icon: "centerline" as CadIconName, active: model0.linetypes.some((x) => x.name === l.name), onClick: () => d.commit(loadLinetype(model0, l.name)[0]) })) },
          { id: "lts", label: tr("Měřítko čar (LTSCALE {0})", model0.vars.ltscale), icon: "scale", onClick: () => d.command("LTSCALE") },
          { id: "lwt", label: tr("Zobrazit tloušťky"), icon: "line", active: model0.vars.lwdisplay, onClick: () => d.commit({ ...model0, vars: { ...model0.vars, lwdisplay: !model0.vars.lwdisplay } }) },
        ],
      },
    ],
    annotate: [{ label: tr("Text"), big: 1, items: [cmdItem("text2", tr("Text"), "text", "TEXT", [], tr("jednořádkový text"), "DT")] }],
    blocks: [],
    layout: [],
    output: [
      // export a otevření DWG / DXF: skupina „DWG / DXF“ balíku io (ui-io.tsx) – zde jen uložení
      { label: tr("Soubor"), big: 1, items: [{ id: "save", label: tr("Uložit .mncad"), icon: "save", tone: "file", kbd: "Ctrl+S", onClick: d.save }] },
      { label: tr("Sdílet"), big: 1, items: [{ id: "share", label: tr("Sdílet odkazem"), icon: "share", tone: "file", onClick: d.share }] },
    ],
  };
}

/** všechna id tlačítek pásu (skupiny jádra i balíků, bez položek rozbalovacích nabídek) – pro mikronávody `draft/<id>` */
export function ribbonItemIds(groups: Partial<Record<DraftRibbonTab, RGroup[]>>): string[] {
  const ids: string[] = [];
  for (const gs of Object.values(groups)) for (const g of gs ?? []) for (const it of g.items) ids.push(it.id);
  return ids;
}
