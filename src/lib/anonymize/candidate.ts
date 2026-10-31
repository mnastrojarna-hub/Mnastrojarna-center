/**
 * Kdo se anonymizuje — TS zrcadlo SQL funkcí anon_is_candidate / anon_drawing_path / anon_unsupported_ext
 * (migrace 20261031140000_anonymizace_jen_vykresy, dříve 20261023159000 a 20261030140000). Shodu s SQL
 * hlídá integrační test (anonymize.integration / formats.integration).
 *
 * Pravidlo majitele (31. 10.): „Anonymizovat to má výkresy, ne objednávky… Jde jen o výkresy." a
 * „3D modely taky nemají žádné razítko nebo žádný název firmy." Kandidát = EXTERNÍ 2D VÝKRES:
 *  1) druh „Výkres" (vykres) ve formátu PDF / obrázek / TIFF / HEIC (+ BMP, SVG → „Nelze automaticky"),
 *  2) 2D CAD výkres podle přípony bez ohledu na druh: DXF (anonymizuje se), DWG, DWF, SLDDRW, IDW,
 *     CATDrawing, DRW, DFT (→ „Nelze automaticky" s návodem),
 *  3) druh neznámý — „Ostatní" / „Fotka" (příloha bez rozpoznaného druhu) ve formátu PDF / obrázek:
 *     zpracuje se JEN když je to výkres (AI klasifikace stránky, bez AI kotvy razítka / CAD producent);
 *     jinak „Není výkres" (skipped) a nic se nemaže (needsDrawingCheck),
 *  4) kontejner ZIP / e-mail .eml (a nerozbalitelné .msg, RAR, 7z…) z podkladů zákazníka — rozbalí se
 *     a anonymizují se jen jeho VÝKRESY (položky dostanou vlastní druh podle názvu).
 * NIKDY: 3D modely (STEP, IGES, STL, nativní CAD díly a sestavy, 3MF, OBJ), objednávky zákazníka, naše
 * objednávky / doklady (issuer my, origin generated), nabídky, nacenění, potvrzení, dodací listy,
 * faktury, korespondence (kromě rozbalení .eml), kancelářské dokumenty, doklady dodavatele (kromě
 * jeho výkresu).
 */

/** Druhy, u kterých PDF / obrázek je (nebo může být) výkres: vykres = jistě, ostatni / foto = rozhodne klasifikace. */
export const CANDIDATE_KINDS = ["vykres", "ostatni", "foto"] as const;
/** Druh neznámý — anonymizuje se jen to, co klasifikace pozná jako výkres. */
export const UNKNOWN_KINDS = ["ostatni", "foto"] as const;
/** Druhy, ze kterých se rozbalí archiv / e-mail (podklady zákazníka — uvnitř mohou být výkresy). */
export const CONTAINER_KINDS = ["vykres", "model_3d", "ostatni", "foto", "poptavka", "objednavka", "korespondence"] as const;
/** Od dodavatele: jen jeho výkres (bez ceny) — zrcadlo price-visibility SUPPLIER_TECH_KINDS bez 3D modelu. */
const SUPPLIER_TECH_KINDS = ["vykres"];
export const CANDIDATE_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
/** PDF a obrázky (formát výkresu, sken, fotka). */
export const DOC_EXT_RE = /\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif)$/;
/** 2D výkres z CAD podle přípony (DXF se anonymizuje, ostatní „Nelze automaticky"). */
export const CAD2D_EXT_RE = /\.(dxf|dwg|dwf|dwfx|slddrw|idw|catdrawing|drw|dft)$/;
/** Výkres jako obrázek, který neumíme (jen u druhu Výkres). */
const DRAWING_IMAGE_UNSUPPORTED_RE = /\.(bmp|svg)$/;
/** Kontejner: ZIP / .eml se rozbalí; .msg, RAR, 7z… „Nelze automaticky" (rozbal a nahraj výkresy). */
export const CONTAINER_EXT_RE = /\.(zip|eml|msg|rar|7z|tar|gz|tgz)$/;
/** Anonymizuje se (PDF, obrázky, DXF; STEP/STL/IGES jen v samostatném nástroji) nebo rozbalí (ZIP, e-mail .eml). */
export const SUPPORTED_EXT_RE = /\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif|dxf|stp|step|stl|igs|iges|zip|eml)$/;
/** Nelze anonymizovat automaticky (nativní CAD, DWG, kancelářské dokumenty, jiné archivy, Outlook .msg…). */
export const UNSUPPORTED_EXT_RE = /\.(dwg|dwf|dwfx|sldprt|sldasm|slddrw|ipt|iam|idw|ipn|catpart|catproduct|catdrawing|prt|asm|drw|par|psm|dft|x_t|x_b|xmt_txt|sat|sab|jt|3dm|f3d|3mf|obj|skp|doc|docx|docm|xls|xlsx|xlsm|ppt|pptx|odt|ods|odg|rtf|rar|7z|tar|gz|tgz|msg|bmp|svg)$/;
/** 3D model / CAD geometrie — nikdy kandidát (nemá razítko ani název firmy). */
export const MODEL_3D_EXT_RE = /\.(stp|step|igs|iges|stl|3mf|obj|x_t|x_b|xmt_txt|sat|sab|sldprt|sldasm|ipt|iam|ipn|catpart|catproduct|prt|asm|par|psm|jt|3dm|f3d|skp)$/;

export function isUnsupportedExt(filename: string | null | undefined): boolean {
  return UNSUPPORTED_EXT_RE.test(String(filename ?? "").toLowerCase());
}

/** 3D model (druh nebo přípona) — neanonymizuje se a odeslání neblokuje. */
export function isModel3d(kind: string | null | undefined, filename: string | null | undefined): boolean {
  const f = String(filename ?? "").toLowerCase();
  if (CAD2D_EXT_RE.test(f) || CONTAINER_EXT_RE.test(f)) return false;
  return (kind ?? "") === "model_3d" || MODEL_3D_EXT_RE.test(f);
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
  const k = kind ?? "";
  // doklad dodavatele (#25 — cena) se neanonymizuje: kopie by obešla pravidlo o cenách; jen jeho výkres
  if ((issuer ?? "") === "dodavatel" && !SUPPLIER_TECH_KINDS.includes(k)) return false;
  const m = String(mime ?? "").toLowerCase();
  const f = String(filename ?? "").toLowerCase();
  // 2D výkres z CAD podle přípony (DXF / DWG…) — vždy výkres
  if (CAD2D_EXT_RE.test(f)) return true;
  if (MODEL_3D_EXT_RE.test(f)) return false;
  // archiv / e-mail z podkladů zákazníka → rozbalí se, anonymizují se jen výkresy uvnitř
  if (CONTAINER_EXT_RE.test(f)) return (CONTAINER_KINDS as readonly string[]).includes(k);
  if (!(CANDIDATE_KINDS as readonly string[]).includes(k)) return false;
  const doc = (CANDIDATE_MIMES as readonly string[]).includes(m) || DOC_EXT_RE.test(f);
  if (k === "vykres") return doc || DRAWING_IMAGE_UNSUPPORTED_RE.test(f);
  return doc;
}

/** Druh neznámý (Ostatní / Fotka) — výkres musí potvrdit klasifikace (AI, kotvy razítka). */
export function needsDrawingCheck(kind: string | null | undefined, filename?: string | null): boolean {
  if (CAD2D_EXT_RE.test(String(filename ?? "").toLowerCase())) return false;
  return (UNKNOWN_KINDS as readonly string[]).includes(kind ?? "");
}

/** Archiv výkresů (přímé nahrání bez druhu): kandidát = 2D výkres (PDF, obrázek, DXF, DWG…), ne 3D model. */
export function isAnonDrawingPath(path: string | null | undefined): boolean {
  const f = String(path ?? "").toLowerCase();
  return DOC_EXT_RE.test(f) || CAD2D_EXT_RE.test(f) || DRAWING_IMAGE_UNSUPPORTED_RE.test(f);
}

export type SourceFormat =
  | "pdf" | "image" | "tiff" | "heic" | "dxf" | "step" | "stl" | "iges" | "zip" | "eml" | "unsupported" | "unknown";

function startsWithText(head: Uint8Array, text: string): boolean {
  if (head.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (head[i] !== text.charCodeAt(i)) return false;
  return true;
}

/** Formát zdroje podle MIME, přípony a hlavičky souboru (obsah má přednost před příponou). */
export function sourceFormat(filename: string | null | undefined, mime: string | null | undefined, head?: Uint8Array): SourceFormat {
  const f = String(filename ?? "").toLowerCase();
  const m = String(mime ?? "").toLowerCase();
  if (head && head.length >= 4) {
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    if (head[0] === 0xff && head[1] === 0xd8) return "image";
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
    if (startsWithText(head, "GIF8")) return "image";
    if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a)) return "tiff";
    if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45) return "image";
    if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "heic";
  }
  if (isUnsupportedExt(f)) return "unsupported";
  // ZIP podle obsahu jen bez jiné známé přípony (DOCX / XLSX / 3MF jsou také ZIP)
  if (head && head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 && (f.endsWith(".zip") || !/\.[a-z0-9_]{1,8}$/.test(f))) return "zip";
  if (head && startsWithText(head, "ISO-10303-21")) return "step";
  if (m === "application/pdf" || f.endsWith(".pdf")) return "pdf";
  if (m === "image/tiff" || /\.tiff?$/.test(f)) return "tiff";
  if (m === "image/heic" || m === "image/heif" || /\.hei[cf]$/.test(f)) return "heic";
  if (/^image\/(jpeg|png|webp|gif)$/.test(m) || /\.(jpe?g|png|webp|gif)$/.test(f)) return "image";
  if (f.endsWith(".dxf")) return "dxf";
  if (/\.(stp|step)$/.test(f)) return "step";
  if (f.endsWith(".stl")) return "stl";
  if (/\.ige?s$/.test(f)) return "iges";
  if (f.endsWith(".zip") || m === "application/zip" || m === "application/x-zip-compressed") return "zip";
  if (f.endsWith(".eml") || m === "message/rfc822") return "eml";
  return "unknown";
}

/** Začátek každého důvodu „nelze" (štítek v UI je „Nelze anonymizovat automaticky"). */
export const UNSUPPORTED_PREFIX = "Nelze anonymizovat automaticky";

/**
 * Česká jednořádková rada pro formát, který anonymizace neumí (stav unsupported) — co má uživatel udělat.
 * Výchozí: obecná rada (PDF / DXF / STEP).
 */
export function unsupportedHowTo(filename: string | null | undefined): string {
  const f = String(filename ?? "").toLowerCase();
  const ext = /\.([a-z0-9_]+)$/.exec(f)?.[1] ?? "";
  const say = (what: string, how: string) => `${UNSUPPORTED_PREFIX} (${what}) — ${how}`;
  if (ext === "dwg" || ext === "dwf" || ext === "dwfx") return say(ext.toUpperCase(), "ulož výkres jako PDF nebo DXF (AutoCAD: Uložit jako → DXF) a nahraj znovu.");
  if (["slddrw", "idw", "catdrawing", "drw", "dft"].includes(ext)) return say("výkres z CAD", "ulož ho jako PDF nebo DXF a nahraj znovu.");
  if (["sldprt", "sldasm", "ipt", "iam", "ipn", "catpart", "catproduct", "prt", "asm", "par", "psm", "x_t", "x_b", "xmt_txt", "sat", "sab", "jt", "3dm", "f3d", "skp"].includes(ext)) {
    return say("nativní CAD model", "exportuj ho jako STEP (Soubor → Uložit jako → STEP) a nahraj znovu.");
  }
  if (["3mf", "obj"].includes(ext)) return say(`model ${ext.toUpperCase()}`, "exportuj ho jako STEP nebo STL a nahraj znovu.");
  if (["doc", "docx", "docm", "odt", "rtf"].includes(ext)) return say("dokument Word", "ulož ho jako PDF (Soubor → Uložit jako → PDF) a nahraj znovu.");
  if (["xls", "xlsx", "xlsm", "ods"].includes(ext)) return say("tabulka Excel", "ulož ji jako PDF (Soubor → Uložit jako → PDF) a nahraj znovu.");
  if (["ppt", "pptx", "odg"].includes(ext)) return say("prezentace", "ulož ji jako PDF a nahraj znovu.");
  if (["rar", "7z", "tar", "gz", "tgz"].includes(ext)) return say(`archiv ${ext.toUpperCase()}`, "rozbal ho a nahraj výkresy jednotlivě (nebo pošli ZIP — ten se rozbalí sám).");
  if (ext === "msg") return say("e-mail z Outlooku", "ulož přílohy a nahraj je zvlášť (nebo e-mail přepošli do firemní schránky).");
  if (ext === "bmp") return say("BMP", "ulož obrázek jako PNG nebo JPEG a nahraj znovu.");
  if (ext === "svg") return say("SVG", "ulož výkres jako PDF a nahraj znovu.");
  return say("neznámý formát", "pošli dodavateli PDF, DXF nebo STEP.");
}
