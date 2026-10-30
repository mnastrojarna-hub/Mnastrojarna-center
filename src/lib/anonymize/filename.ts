/**
 * Anonymní názvy souborů (spec §4.6): „<číslo výkresu>[_<rev>][_l<list>].<ext>", bez čísla
 * „<číslo naší zakázky>-V<pořadí>.<ext>" — NIKDY původní název. Číslo s termínem → review.
 */

import { containsTerm, type Term } from "./rules";

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX = 80;

export function cleanNamePart(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(FORBIDDEN, "")
    .replace(/\s+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX);
}

export interface AnonNameInput {
  drawingNumber?: string | null;
  revision?: string | null;
  /** List (1..n) u víc listů jednoho výkresu. */
  sheet?: number | null;
  ext: string;
  jobNumber?: string | null;
  /** Pořadí výkresu v zakázce (1..n). */
  index?: number | null;
  terms?: readonly Term[];
}

export interface AnonName {
  filename: string;
  /** Číslo výkresu obsahuje termín — název z čísla se nepoužil, rozhodne člověk. */
  review?: string;
}

export function anonFilename(input: AnonNameInput): AnonName {
  const ext = cleanNamePart(input.ext).replace(/^\.+/, "").toLowerCase().slice(0, 8) || "pdf";
  const num = cleanNamePart(input.drawingNumber);
  const rev = cleanNamePart(input.revision).slice(0, 12);
  const sheet = input.sheet && input.sheet > 0 ? `_l${Math.floor(input.sheet)}` : "";
  let review: string | undefined;
  if (num && input.terms?.length && (containsTerm(input.drawingNumber ?? "", input.terms) || containsTerm(num, input.terms))) {
    review = "Číslo výkresu obsahuje zkratku firmy — rozhodni.";
  } else if (num) {
    const base = `${num}${rev ? `_${rev}` : ""}${sheet}`.slice(0, MAX);
    return { filename: `${base}.${ext}` };
  }
  const job = cleanNamePart(input.jobNumber) || "vykres";
  const idx = input.index && input.index > 0 ? Math.floor(input.index) : 1;
  return { filename: `${job}-V${idx}${sheet}.${ext}`, ...(review ? { review } : {}) };
}

/** Kolize v ZIPu / přílohách: deterministická přípona „-2", „-3"… (case-insensitive). */
export function dedupeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf(".");
    const base = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : "";
    let cand = n;
    let i = 2;
    while (used.has(cand.toLowerCase())) cand = `${base}-${i++}${ext}`;
    used.add(cand.toLowerCase());
    return cand;
  });
}

/** Přípona výstupu podle metody (PDF zůstane PDF, fotka JPEG/PNG, CAD stejně). */
export function outputExt(method: "raster_pdf" | "image" | "image_pdf" | "dxf" | "step" | "stl" | "iges", srcExt: string): string {
  switch (method) {
    case "raster_pdf":
    case "image_pdf":
      return "pdf";
    case "dxf":
      return "dxf";
    case "step":
      return /^stp$/i.test(srcExt) ? "stp" : "step";
    case "stl":
      return "stl";
    case "iges":
      return /^igs$/i.test(srcExt) ? "igs" : "iges";
    default:
      return /^png$/i.test(srcExt) ? "png" : "jpg";
  }
}

/**
 * Název převzatý z kopie stejného souboru v JINÉ zakázce (cache výstupu): náhradní název
 * „<zakázka>-V<n>" nesmí nést číslo cizí zakázky → přepočítá se na vlastní zakázku a pořadí.
 * Název z čísla výkresu („D-1234_B.pdf") zůstává.
 */
export function rebaseTwinFilename(name: string | null | undefined, twinJobNumber: string | null | undefined, own: { jobNumber: string | null; index: number }): string | null {
  if (!name) return null;
  const twin = cleanNamePart(twinJobNumber);
  if (!twin) return name;
  const m = new RegExp(`^${twin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-V\\d+((?:_l\\d+)?\\.[A-Za-z0-9]+)$`).exec(name);
  if (!m) return name;
  const job = cleanNamePart(own.jobNumber) || "vykres";
  const idx = own.index > 0 ? Math.floor(own.index) : 1;
  return `${job}-V${idx}${m[1]}`;
}
