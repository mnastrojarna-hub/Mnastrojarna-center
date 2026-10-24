/**
 * TS zrcadlo SQL funkcí anon_is_candidate / anon_unsupported_ext (migrace 20261023159000).
 * Kandidát = EXTERNÍ soubor vhodného typu; „je to výkres?" rozhoduje až služba.
 * Shodu s SQL hlídá integrační test (candidate.integration.test.ts).
 */

export const CANDIDATE_KINDS = ["vykres", "model_3d", "ostatni", "foto", "poptavka", "objednavka"] as const;
/** Od dodavatele, ale bez ceny (technická dokumentace) — zrcadlo price-visibility SUPPLIER_TECH_KINDS. */
const SUPPLIER_TECH_KINDS = ["vykres", "model_3d"];
export const CANDIDATE_MIMES =["application/pdf", "image/jpeg", "image/png", "image/webp", "image/tiff", "image/heic", "image/heif"] as const;
const SUPPORTED_EXT_RE = /\.(pdf|jpe?g|png|webp|tiff?|heic|heif|dxf|stp|step)$/;
const UNSUPPORTED_EXT_RE = /\.(dwg|sldprt|sldasm|slddrw|ipt|iam|idw|catpart|catproduct|prt|asm|par|psm|x_t|x_b|jt|3dm|f3d|stl|3mf|igs|iges)$/;

export function isUnsupportedExt(filename: string | null | undefined): boolean {
  return UNSUPPORTED_EXT_RE.test(String(filename ?? "").toLowerCase());
}

export function isAnonCandidate(
  kind: string | null | undefined,
  filename: string | null | undefined,
  mime: string | null | undefined,
  origin: string | null | undefined,
  issuer: string | null | undefined,
): boolean {
  if ((origin ?? "upload") === "generated") return false;
  if ((issuer ?? "") === "my") return false;
  if (!(CANDIDATE_KINDS as readonly string[]).includes(kind ?? "")) return false;
  // nákupní doklad dodavatele (#25 — cena) se neanonymizuje: kopie by obešla pravidlo o cenách
  if ((issuer ?? "") === "dodavatel" && !SUPPLIER_TECH_KINDS.includes(kind ?? "")) return false;
  const m = String(mime ?? "").toLowerCase();
  const f = String(filename ?? "").toLowerCase();
  return (CANDIDATE_MIMES as readonly string[]).includes(m) || SUPPORTED_EXT_RE.test(f) || UNSUPPORTED_EXT_RE.test(f);
}

export type SourceFormat = "pdf" | "image" | "tiff" | "heic" | "dxf" | "step" | "unsupported" | "unknown";

/** Formát zdroje podle MIME, přípony a hlavičky souboru. */
export function sourceFormat(filename: string | null | undefined, mime: string | null | undefined, head?: Uint8Array): SourceFormat {
  const f = String(filename ?? "").toLowerCase();
  const m = String(mime ?? "").toLowerCase();
  if (head && head.length >= 4) {
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    if (head[0] === 0xff && head[1] === 0xd8) return "image";
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
    if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a)) return "tiff";
    if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45) return "image";
    if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "heic";
  }
  if (isUnsupportedExt(f)) return "unsupported";
  if (m === "application/pdf" || f.endsWith(".pdf")) return "pdf";
  if (m === "image/tiff" || /\.tiff?$/.test(f)) return "tiff";
  if (m === "image/heic" || m === "image/heif" || /\.hei[cf]$/.test(f)) return "heic";
  if (/^image\/(jpeg|png|webp)$/.test(m) || /\.(jpe?g|png|webp)$/.test(f)) return "image";
  if (f.endsWith(".dxf")) return "dxf";
  if (/\.(stp|step)$/.test(f)) return "step";
  return "unknown";
}
