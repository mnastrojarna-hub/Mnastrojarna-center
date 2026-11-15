/**
 * Příprava importu v aplikaci: `prepareImport` s výchozím dělením velké sestavy STEP klientem jádra prohlížeče (`cad`).
 * Vše ostatní je v import-core.ts (načítá ho i engine v Node – bez `client.ts`, CAD-HEADLESS-NAVRH.md kap. 2.2, 2.5).
 */
import { prepareImportWith, type ImportResult, type StepSplitter } from "./import-core";

export * from "./import-core";

const defaultSplitter: StepSplitter = async (bytes, fileName) => (await import("../client")).cad.stepSplit(bytes, fileName);

/** Rozpozná formát podle přípony i obsahu a připraví data pro jádro / skicu (sestavu STEP dělí klient jádra `cad`). */
export function prepareImport(file: File, splitter: StepSplitter = defaultSplitter): Promise<ImportResult> {
  return prepareImportWith(file, splitter);
}
