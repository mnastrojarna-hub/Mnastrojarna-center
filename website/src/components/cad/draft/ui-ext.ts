/**
 * Rozšíření GUI 2D výkresu: balíky fáze B přidávají skupiny pásu karet, panely, položky stavového řádku,
 * kontextovou nabídku a kreslení pod / nad entity – každý ve SVÉM souboru (ui-edit.tsx, ui-annot.tsx, ui-layout.tsx,
 * ui-io.tsx), pracovní plocha je jen spojí (seznam UI_EXTS níže je hotový, balíky ho neupravují).
 */
import type { ReactNode } from "react";
import type { CadDoc } from "@/cad/types";
import type { DraftCmdResult, DraftSession } from "@/cad/draft/session";
import type { DraftModel, DraftSpace, Vec2 } from "@/cad/draft/model";
import type { View } from "@/cad/draft/render";
import type { CadIconName } from "../cad-icons";
import type { RGroup, RMenuEntry } from "../ribbon";

/** karty pásu 2D výkresu */
export type DraftRibbonTab = "draw" | "modify" | "layers" | "annotate" | "blocks" | "layout" | "output";

/** rozhraní pracovní plochy pro rozšíření */
export type DraftUiApi = {
  doc: CadDoc;
  /** zobrazený model (během příkazu včetně rozpracovaných změn) */
  model: DraftModel;
  session: DraftSession;
  /** spustí příkaz v příkazovém řádku (interaktivně); `pre` = zadání předem (např. ["3p"]) */
  command: (name: string, pre?: string[]) => void;
  /** provede 2D příkazy textem (každý příkaz atomicky, jako `2d …`) a zapíše je jako jeden krok historie */
  run: (text: string) => Promise<DraftCmdResult[]>;
  /** zapíše nový model jako jeden krok historie */
  commit: (m: DraftModel) => void;
  /** nastaví výběr */
  select: (ids: string[]) => void;
  flash: (msg: string) => void;
  /** pohled plátna */
  view: () => View | null;
  setView: (v: Partial<Pick<View, "cx" | "cy" | "scale">>) => void;
  zoomExtents: () => void;
  /** zobrazený prostor (model / rozvržení) – přepíná balík 3 */
  space: DraftSpace;
  setSpace: (s: DraftSpace) => void;
  /** otevře / zavře panel vpravo (id panelu jádra: „properties“, „layers“, nebo panelu rozšíření) */
  openPanel: (id: string | null) => void;
  download: (name: string, data: Uint8Array | string, mime: string) => void;
  /** otevře dokument v nové záložce (import) */
  openDoc: (d: CadDoc) => void;
  /** překreslit plátno (po změně stavu rozšíření) */
  redraw: () => void;
};

/** událost ukazatele nad plátnem pro rozšíření (úpravy úchopy, rám výřezu…) */
export type DraftPointerEvent = {
  kind: "down" | "move" | "up";
  /** poloha ve výkresu (bez uchopení) a výsledný bod (uchopení / ortho / polární) */
  world: Vec2;
  snapped: Vec2;
  screen: Vec2;
  button: number;
  shift: boolean;
  ctrl: boolean;
};

export type DraftPanelDef = { title: () => string; icon: CadIconName; render: (api: DraftUiApi) => ReactNode };

export type DraftUiExt = {
  id: string;
  /** skupiny pásu karet podle karty (připojí se za skupiny jádra) */
  ribbon?: (api: DraftUiApi) => Partial<Record<DraftRibbonTab, RGroup[]>>;
  /** panely vpravo (id → definice); otevírá je api.openPanel(id) */
  panels?: Record<string, DraftPanelDef>;
  /** levá část stavového řádku (např. záložky Model / Rozvržení) */
  statusLeft?: (api: DraftUiApi) => ReactNode;
  /** položky kontextové nabídky plátna (pravé tlačítko) */
  context?: (api: DraftUiApi) => RMenuEntry[];
  /** kreslení pod entity (papír a okraje rozvržení) – pixely zařízení */
  underlay?: (ctx: CanvasRenderingContext2D, api: DraftUiApi, view: View) => void;
  /** kreslení nad entity (rámy výřezů, náhledy úprav) */
  overlay?: (ctx: CanvasRenderingContext2D, api: DraftUiApi, view: View) => void;
  /** poklepání na entitu (úprava textu, kóty, bloku…) – true = obslouženo */
  dblclick?: (api: DraftUiApi, id: string) => boolean;
  /**
   * ukazatel nad plátnem (myš / pero, ne dotyk dvěma prsty) PŘED zpracováním jádrem; true = obslouženo (jádro událost
   * přeskočí – u „down“ i následné „up“). Volá se jen mimo běžící příkaz (úchopy, tažení rámu výřezu…).
   */
  pointer?: (api: DraftUiApi, ev: DraftPointerEvent) => boolean;
};

export type { RGroup, RMenuEntry };
