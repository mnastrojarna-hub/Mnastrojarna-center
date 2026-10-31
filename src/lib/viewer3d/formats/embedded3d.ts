import { ModelImportError, type ParsedModel } from "../types";
import { extractPdf3DStreams, pdfIsEncrypted } from "./pdf3d";

/**
 * Dekódování 3D obsahu z PDF (U3D / PRC) a samostatných .u3d / .prc souborů.
 * Dekodéry se načítají líně (velké moduly) — jen když je soubor opravdu potřebuje.
 */

export async function decodeU3D(bytes: Uint8Array): Promise<ParsedModel> {
  const mod = (await import("./u3d")) as { parseU3D: (b: Uint8Array) => ParsedModel };
  return mod.parseU3D(bytes);
}

export async function decodePRC(bytes: Uint8Array): Promise<ParsedModel> {
  const mod = (await import("./prc")) as { parsePRC: (b: Uint8Array) => ParsedModel };
  return mod.parsePRC(bytes);
}

/** 3D model z PDF — všechny 3D proudy (bývá jeden) spojené do jednoho modelu. */
export async function decodePdf3D(bytes: Uint8Array): Promise<ParsedModel> {
  let streams;
  try {
    streams = extractPdf3DStreams(bytes);
  } catch (e) {
    throw new ModelImportError(`3D obsah PDF se nepodařilo rozbalit: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!streams.length) {
    if (pdfIsEncrypted(bytes)) throw new ModelImportError("PDF je zašifrované — 3D obsah z něj nejde přečíst. Požádej o nezašifrovanou verzi nebo o STEP.");
    throw new ModelImportError("V PDF není žádný 3D model (U3D ani PRC).");
  }
  const models: ParsedModel[] = [];
  const errors: string[] = [];
  for (const s of streams) {
    try {
      models.push(s.kind === "u3d" ? await decodeU3D(s.data) : await decodePRC(s.data));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!models.length) {
    if (pdfIsEncrypted(bytes)) throw new ModelImportError("PDF je zašifrované — 3D obsah z něj nejde přečíst. Požádej o nezašifrovanou verzi nebo o STEP.");
    throw new ModelImportError(errors[0] ?? "3D obsah PDF se nepodařilo přečíst.");
  }
  if (models.length === 1) {
    const m = models[0];
    return errors.length ? { ...m, warnings: [...(m.warnings ?? []), ...errors] } : m;
  }
  // více 3D pohledů / anotací → jeden model s více větvemi
  const parts = [];
  const children = [];
  for (const [i, m] of models.entries()) {
    const offset = parts.length;
    parts.push(...m.parts);
    const shift = (n: ParsedModel["root"]): ParsedModel["root"] => ({ name: n.name, parts: n.parts.map((p) => p + offset), children: n.children.map(shift) });
    children.push({ ...shift(m.root), name: m.root.name || `3D model ${i + 1}` });
  }
  return {
    parts,
    root: { name: "3D PDF", parts: [], children },
    format: models[0].format,
    warnings: [...models.flatMap((m) => m.warnings ?? []), ...errors],
  };
}
