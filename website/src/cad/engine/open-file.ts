/**
 * Dokument ze vstupního souboru hostitele (CAD-HEADLESS-NAVRH.md kap. 2.5 „Předání dokumentů“): `otevřít "…"`, CLI `--open`,
 * HTTP `open`. Čte se přes `host.inputs` (FileSource); .mncad / .json = dokument (`internBlobs`), STEP / BREP / síťové
 * formáty přes `prepareImport` – sestava STEP se rozdělí na díly jádrem hostitele (`kernel.stepSplit`, ne přes klienta
 * prohlížeče), DXF jako skica. Výsledek je dokument pro novou záložku.
 */
import { internBlobs } from "../blobs";
import { prepareImportWith } from "../formats/import-core";
import { tr } from "../i18n";
import { emptyDoc, uid, type CadDoc, type Feature } from "../types";
import type { EngineHost } from "./host";

export type OpenedDoc = { doc: CadDoc; file: string; note?: string };

const isDocJson = (v: unknown): v is CadDoc => !!v && typeof v === "object" && typeof (v as CadDoc).name === "string" && Array.isArray((v as CadDoc).features);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Přečte `name` ze vstupů hostitele a vrátí dokument. Chybějící soubor = `MissingInputError` (✗ `file.missing`). */
export async function readDocument(host: Pick<EngineHost, "inputs" | "kernel">, name: string): Promise<OpenedDoc> {
  const f = await host.inputs.read(name);
  const ext = (/\.([^.]+)$/.exec(f.name)?.[1] ?? "").toLowerCase();
  const base = f.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || f.name;
  if (ext === "mncad" || ext === "json") {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(f.data));
    } catch (e) {
      throw new Error(tr("„{0}“ není platný JSON dokumentu: {1}", name, errText(e)));
    }
    if (!isDocJson(raw)) throw new Error(tr("„{0}“ není dokument MN CAD (chybí název nebo prvky)", name));
    return { doc: internBlobs(raw), file: f.name };
  }
  const file = new File([f.data as BlobPart], f.name.replace(/^.*[\\/]/, ""));
  const res = await prepareImportWith(file, (bytes, fileName) => host.kernel.stepSplit(bytes, fileName));
  if (res.kind === "unsupported") throw new Error(res.message);
  if (res.kind === "assembly") return { doc: res.doc, file: f.name, note: res.note };
  if (res.kind === "body") {
    const feat: Feature = { id: uid(), name: `Import ${res.fileName}`, type: "import", fileName: res.fileName, format: res.format, data: res.data };
    return { doc: { ...emptyDoc(base), kind: "part", features: [feat] }, file: f.name, ...(res.note ? { note: res.note } : {}) };
  }
  const sk: Feature = { id: uid(), name: res.name, type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: res.entities };
  return { doc: { ...emptyDoc(base), kind: "part", features: [sk] }, file: f.name, ...(res.note ? { note: res.note } : {}) };
}
