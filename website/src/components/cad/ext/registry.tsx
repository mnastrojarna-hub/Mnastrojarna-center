/**
 * UI registr modulů rozšíření: vlastní formuláře prvků a akce tlačítek (co nevytváří prvek, např. export rozvinu).
 * Modul UI (soubor v `components/cad/ext/`) je importován z `components/cad/ext/index.tsx`.
 */
import type { ComponentType } from "react";
import type { BuildResult, CadDoc, Feature, Vec3 } from "@/cad/types";
import type { SelItem } from "../selection";
import { getExt } from "@/cad/ext/index";

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

export type ExtUi = {
  Form?: ComponentType<ExtFormProps>;
  action?: (api: ExtActionApi) => void | Promise<void>;
  /**
   * klik na plochu modelu při úpravě prvku (s bodem dopadu) – místo prostého přepnutí indexu plochy: vrací změnu dat prvku,
   * text = hlášení (např. „vyberte rovinnou plochu“), null = nic
   */
  onFacePick?: (a: { f: Extract<Feature, { type: "ext" }>; index: number; point: Vec3 }) => Promise<Record<string, unknown> | string | null> | Record<string, unknown> | string | null;
  /** výzva v řádku příkazů při úpravě prvku */
  prompt?: (f: Extract<Feature, { type: "ext" }>) => string;
  /** co se při úpravě vybírá v modelu, závisí-li to na datech prvku (tupý svar: plocha čela / hrana spáry); jinak `pick` z registru jádra */
  pick?: (f: Extract<Feature, { type: "ext" }>) => { kind: "faces" | "edges"; key: string } | undefined;
};

const ui = new Map<string, ExtUi>();
export function registerExtUi(ext: string, def: ExtUi) {
  ui.set(ext, { ...(ui.get(ext) ?? {}), ...def });
}
export const getExtUi = (ext: string) => ui.get(ext);
/** výběr v modelu při úpravě prvku rozšíření (podle dat prvku, jinak podle registru jádra) */
export const extPickOf = (f: Extract<Feature, { type: "ext" }>) => ui.get(f.ext)?.pick?.(f) ?? getExt(f.ext)?.pick;
