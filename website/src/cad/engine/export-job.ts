/**
 * Export 3D modelu jako úloha s pojmenovanými fázemi (vlna 22, bod 22h) – stejný postup pro export z menu aplikace,
 * `window.mncad.exportFile`, textové `export step` (konzole, CLI, serve) i `--formats step` CLI:
 *
 *   model   – přestavba modelu (jen díl; mezipaměť jádra, průběh po prvcích „Počítám prvek k/n“)
 *   convert – převod do formátu (STEP, STL, BREP…; u sestavy včetně složení modelu)
 *   verify  – kontrola zpětným načtením (STEP / BREP: tělesa, objem, obálka proti modelu – `verifyExport`)
 *   write   – zápis souboru / stažení / předání dat volajícímu
 *
 * Mezi fázemi se kontroluje zrušení (`signal`) – zrušený export nic nezapíše (výjimka `CadCancelled`, stejná jako po tlačítku
 * Zrušit u výpočtu v jádře). Uklidit cíl, který už existuje (prázdný soubor z dialogu „Uložit jako“ File System Access API),
 * je věc volajícího (`components/cad/export-run.ts`).
 *
 * Výsledek nese revizi modelu (`modelRev`, engine/result-key.ts), ze které soubor vznikl, a časy fází.
 */
import { CadCancelled } from "../kernel-client";
import type { Export3dFormat, ExportCheck } from "../agent-out";
import type { CadDoc } from "../types";
import type { SolidParts } from "../solid-export";
import { embedBlobs } from "../blobs";
import { isEmptyDoc, modelBytes, verifyExport } from "./files";
import type { KernelApi } from "./kernel";
import { modelRev } from "./result-key";
import { EXPORT_PHASES, exportPhaseText, type ExportPhase } from "./export-phases";

export { EXPORT_PHASES, exportPhaseText, type ExportPhase };

export type ExportFormat3d = Exclude<Export3dFormat, "mncad">;

export type ExportJobDeps<T> = {
  kernel: Pick<KernelApi, "check" | "exportFile" | "exportStats">;
  /** zápis dat (soubor CLI, stažení, FS Access, base64 volajícímu) */
  write: (data: Uint8Array) => Promise<T>;
  /** začátek fáze (průběh pro tracker / `--progress`) */
  phase?: (p: ExportPhase) => void;
  signal?: AbortSignal;
};

export type ExportJobOptions = {
  /** kontrola zpětným načtením (STEP / BREP); false = vynechat (`bez kontroly`) */
  check?: boolean;
  /** přestavba modelu jako samostatná fáze (výchozí: díl ano, sestava ne – sestava se skládá při převodu) */
  rebuild?: boolean;
  /** zápis až po kontrole (výchozí) – false = zapsat hned po převodu a kontrolovat potom (pořadí řádků protokolu textu) */
  verifyFirst?: boolean;
  /** komponenty sestavy bez tělesa / s volnými plochami – jména do hlášky kontroly (vlna 22, bod 22c – solid-check.ts) */
  parts?: SolidParts;
};

export type ExportJobResult<T> = {
  data: Uint8Array;
  out: T;
  check?: ExportCheck;
  /** revize modelu, ze které soubor vznikl (`r·a1b2c3`) */
  modelRev: string;
  phases: { phase: ExportPhase; ms: number }[];
};

/** revize modelu exportu: stejný výpočet jako uložený .mncad (data importů vložená – prohlížeč i CLI dají totéž) */
export const exportModelRev = (doc: CadDoc): string => modelRev(embedBlobs(doc) as unknown as CadDoc);

const verifiable = (f: ExportFormat3d): f is "step" | "brep" => f === "step" || f === "brep";

/** Export jako úloha s fázemi (viz hlavička modulu). */
export async function runExportJob<T>(doc: CadDoc, format: ExportFormat3d, deps: ExportJobDeps<T>, o: ExportJobOptions = {}): Promise<ExportJobResult<T>> {
  const phases: { phase: ExportPhase; ms: number }[] = [];
  let cur: { phase: ExportPhase; t0: number } | null = null;
  const step = (p: ExportPhase) => {
    if (deps.signal?.aborted) throw new CadCancelled();
    const t = Date.now();
    if (cur) phases.push({ phase: cur.phase, ms: t - cur.t0 });
    cur = { phase: p, t0: t };
    deps.phase?.(p);
  };
  const close = () => {
    if (cur) phases.push({ phase: cur.phase, ms: Date.now() - cur.t0 });
    cur = null;
  };
  const rev = exportModelRev(doc);
  // prázdný model a 2D výkres: bez přestavby – převod skončí srozumitelnou chybou (`modelBytes`)
  const rebuild = o.rebuild ?? (doc.kind !== "assembly" && doc.kind !== "draft" && !isEmptyDoc(doc));
  if (rebuild) {
    step("model");
    await deps.kernel.check(doc);
  }
  step("convert");
  const data = await modelBytes(deps.kernel, doc, format);
  const wantCheck = o.check !== false && verifiable(format);
  let check: ExportCheck | undefined;
  let out: T;
  if (o.verifyFirst === false) {
    step("write");
    out = await deps.write(data);
    if (wantCheck) {
      step("verify");
      check = await verifyExport(deps.kernel, doc, data, format as "step" | "brep", o.parts);
    }
  } else {
    if (wantCheck) {
      step("verify");
      check = await verifyExport(deps.kernel, doc, data, format as "step" | "brep", o.parts);
    }
    step("write");
    out = await deps.write(data);
  }
  close();
  return { data, out, ...(check ? { check } : {}), modelRev: rev, phases };
}
