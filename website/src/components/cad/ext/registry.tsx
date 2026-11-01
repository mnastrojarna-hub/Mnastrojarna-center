/**
 * UI registr modulů rozšíření: vlastní formuláře prvků a akce tlačítek (co nevytváří prvek, např. export rozvinu).
 * Modul UI (soubor v `components/cad/ext/`) je importován z `components/cad/ext/index.tsx`.
 */
import type { ComponentType } from "react";
import type { BuildResult, CadDoc, Feature } from "@/cad/types";
import type { SelItem } from "../selection";
import "@/cad/ext/index";

export type ExtFormProps = {
  f: Extract<Feature, { type: "ext" }>;
  doc: CadDoc;
  /** změna dat prvku (sloučí se do data) */
  onChange: (patch: Record<string, unknown>) => void;
};

/** API pro akce tlačítek (bez prvku v historii). */
export type ExtActionApi = {
  doc: CadDoc;
  result: BuildResult | null;
  selection: SelItem[];
  commit: (next: CadDoc) => void;
  flash: (msg: string) => void;
  notice: (title: string, body: string) => void;
  download: (name: string, data: BlobPart, type: string) => void;
  /** vyexportuje těleso/sestavu v daném formátu (volá worker) */
  exportModel: (format: string) => Promise<void>;
};

export type ExtUi = { Form?: ComponentType<ExtFormProps>; action?: (api: ExtActionApi) => void | Promise<void> };

const ui = new Map<string, ExtUi>();
export function registerExtUi(ext: string, def: ExtUi) {
  ui.set(ext, { ...(ui.get(ext) ?? {}), ...def });
}
export const getExtUi = (ext: string) => ui.get(ext);
