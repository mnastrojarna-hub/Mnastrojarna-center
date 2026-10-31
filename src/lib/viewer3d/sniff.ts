/**
 * Rozpoznání druhu souboru pro prohlížeč — podle obsahu (magic bytes), přípony a Content-Type.
 * Obsah má přednost: e-mailové přílohy chodí často jako application/octet-stream
 * a soubory z CAD mívají přípony velkými písmeny nebo žádné.
 */

export type Model3DFormat = "step" | "iges" | "brep" | "stl" | "obj" | "ply" | "off" | "3mf" | "glb" | "gltf" | "u3d" | "prc" | "dxf" | "dwg";
export type ViewKind = "pdf" | "image" | "model" | "text" | "unsupported";

export interface Sniffed {
  kind: ViewKind;
  /** Jen pro kind = "model". */
  format?: Model3DFormat;
  /** Lidsky čitelný typ, např. „STEP (AP214)". */
  label: string;
}

export const MODEL_EXTENSIONS: Record<string, Model3DFormat> = {
  step: "step", stp: "step", p21: "step", stpz: "step",
  iges: "iges", igs: "iges",
  brep: "brep", brp: "brep",
  stl: "stl",
  obj: "obj",
  ply: "ply",
  off: "off",
  "3mf": "3mf",
  glb: "glb",
  gltf: "gltf",
  u3d: "u3d",
  prc: "prc",
  dxf: "dxf",
  dwg: "dwg",
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"]);
const TEXT_EXT = new Set(["txt", "csv", "log", "json", "xml", "md"]);

export function extensionOf(filename: string | null | undefined): string {
  const m = /\.([a-z0-9_]{1,8})$/i.exec((filename ?? "").trim());
  return m ? m[1].toLowerCase() : "";
}

/** Je přípona 3D model, který prohlížeč umí otevřít? */
export function isViewable3D(filename: string | null | undefined): boolean {
  return extensionOf(filename) in MODEL_EXTENSIONS;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** Binární STL: 80 B hlavička + počet trojúhelníků × 50 B. */
function looksLikeBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const n = (bytes[80] | (bytes[81] << 8) | (bytes[82] << 16) | (bytes[83] << 24)) >>> 0;
  return n > 0 && 84 + n * 50 === bytes.length;
}

/** IGES: pevné řádky 80 znaků, ve sloupci 73 písmeno sekce (S/G/D/P/T). */
function looksLikeIges(head: string): boolean {
  const line = head.split(/\r?\n/)[0] ?? "";
  return line.length >= 73 && (line[72] === "S" || line[72] === "G") && /^\s*\d+$/.test(line.slice(73, 80).trim() || "1");
}

function imageMagic(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === "WEBP") ||
    startsWith(bytes, [0x42, 0x4d]) // BMP
  );
}

const STEP_LABEL = (head: string): string => {
  const m = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(head);
  const schema = m?.[1]?.toUpperCase() ?? "";
  if (schema.includes("AP242") || schema.includes("MANAGED_MODEL_BASED")) return "STEP (AP242)";
  if (schema.includes("AUTOMOTIVE_DESIGN")) return "STEP (AP214)";
  if (schema.includes("CONFIG_CONTROL")) return "STEP (AP203)";
  return "STEP";
};

/**
 * Rozpozná druh souboru. `bytes` stačí prvních ~64 kB (pro binární STL je potřeba celá délka —
 * proto volající předává celý soubor, když ho má).
 */
export function sniffFile(bytes: Uint8Array, filename?: string | null, contentType?: string | null): Sniffed {
  const ext = extensionOf(filename);
  const ct = (contentType ?? "").toLowerCase();
  const head = ascii(bytes, 0, 4096);
  const headTrim = head.replace(/^﻿/, "").trimStart();

  // --- podle obsahu ---
  if (head.startsWith("%PDF") || head.slice(0, 1024).includes("%PDF-")) return { kind: "pdf", label: "PDF" };
  if (/^ISO-10303-21\s*;/i.test(headTrim)) return { kind: "model", format: "step", label: STEP_LABEL(head) };
  if (startsWith(bytes, [0x55, 0x33, 0x44, 0x00])) return { kind: "model", format: "u3d", label: "U3D" };
  if (head.startsWith("PRC")) return { kind: "model", format: "prc", label: "PRC" };
  // DWG: „AC1012"…„AC1032" na začátku
  if (/^AC10\d{2}/.test(head)) return { kind: "model", format: "dwg", label: `DWG (${head.slice(0, 6)})` };
  // DXF: binární se značkou, textový začíná skupinou 0 / SECTION (případně komentářem 999)
  if (head.startsWith("AutoCAD Binary DXF")) return { kind: "model", format: "dxf", label: "DXF (binární)" };
  if (/^(?:999\s*\r?\n[^\n]*\r?\n\s*)?0\s*\r?\n\s*SECTION\s*\r?\n/.test(headTrim)) return { kind: "model", format: "dxf", label: "DXF (výkres)" };
  if (startsWith(bytes, [0x67, 0x6c, 0x54, 0x46])) return { kind: "model", format: "glb", label: "glTF (GLB)" };
  if (/^DBRep_DrawableShape/.test(headTrim) || /^CASCADE Topology/.test(headTrim)) return { kind: "model", format: "brep", label: "BREP (OpenCascade)" };
  if (/^ply\r?\n/.test(headTrim)) return { kind: "model", format: "ply", label: "PLY" };
  if (looksLikeBinaryStl(bytes)) return { kind: "model", format: "stl", label: "STL (binární)" };
  if (/^solid[ \t\r\n]/i.test(headTrim) && /facet\s+normal/i.test(head)) return { kind: "model", format: "stl", label: "STL (text)" };
  if (imageMagic(bytes)) return { kind: "image", label: "Obrázek" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && ext === "3mf") {
    return { kind: "model", format: "3mf", label: "3MF" };
  }
  if (looksLikeIges(head) && (ext === "igs" || ext === "iges" || !ext)) return { kind: "model", format: "iges", label: "IGES" };

  // --- podle přípony ---
  const fmt = MODEL_EXTENSIONS[ext];
  if (fmt) {
    const labels: Record<Model3DFormat, string> = {
      step: "STEP", iges: "IGES", brep: "BREP", stl: "STL", obj: "OBJ", ply: "PLY", off: "OFF", "3mf": "3MF",
      glb: "glTF (GLB)", gltf: "glTF", u3d: "U3D", prc: "PRC", dxf: "DXF (výkres)", dwg: "DWG (výkres)",
    };
    return { kind: "model", format: fmt, label: labels[fmt] };
  }
  if (ext === "pdf" || ct.includes("pdf")) return { kind: "pdf", label: "PDF" };
  if (IMAGE_EXT.has(ext) || ct.startsWith("image/")) {
    if (ext === "svg" || ct.includes("svg")) return { kind: "image", label: "Obrázek (SVG)" };
    return { kind: "image", label: "Obrázek" };
  }
  if (TEXT_EXT.has(ext) || ct.startsWith("text/")) return { kind: "text", label: "Text" };
  // OBJ bez přípony: řádky „v x y z" a „f …"
  if (/^(#.*\n|\s*\n)*(o |g |v |mtllib )/m.test(headTrim) && /\nv\s+-?\d/.test(head) && /\nf\s+\d/.test(head)) {
    return { kind: "model", format: "obj", label: "OBJ" };
  }
  return { kind: "unsupported", label: ext ? ext.toUpperCase() : "Neznámý typ" };
}

/** Název souboru z hlavičky Content-Disposition (filename* má přednost). */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* spadne na prosté filename */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}
