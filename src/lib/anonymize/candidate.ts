/**
 * TS zrcadlo SQL funkcí anon_is_candidate / anon_unsupported_ext (migrace 20261023159000, rozšířeno
 * 20261030140000 — všechny formáty, které zákazník reálně pošle). Kandidát = EXTERNÍ soubor vhodného
 * typu; „je to výkres?" rozhoduje až služba. Shodu s SQL hlídá integrační test (anonymize.integration).
 *
 * Pravidlo majitele: „vždycky tam musí být anonymizace" — každý externí podklad zákazníka buď projde
 * anonymizací, nebo dostane stav „Nelze anonymizovat automaticky" s návodem (a k dodavateli nesmí,
 * originál jen po výslovném potvrzení super admina). Nic neprojde potichu.
 */

export const CANDIDATE_KINDS = ["vykres", "model_3d", "ostatni", "foto", "poptavka", "objednavka"] as const;
/** Od dodavatele, ale bez ceny (technická dokumentace) — zrcadlo price-visibility SUPPLIER_TECH_KINDS. */
const SUPPLIER_TECH_KINDS = ["vykres", "model_3d"];
export const CANDIDATE_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const;
/** Anonymizuje se (PDF, obrázky, DXF, STEP, STL, IGES) nebo rozbalí (ZIP, e-mail .eml). */
export const SUPPORTED_EXT_RE = /\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif|dxf|stp|step|stl|igs|iges|zip|eml)$/;
/** Nelze anonymizovat automaticky (nativní CAD, DWG, kancelářské dokumenty, jiné archivy, Outlook .msg…). */
export const UNSUPPORTED_EXT_RE = /\.(dwg|dwf|dwfx|sldprt|sldasm|slddrw|ipt|iam|idw|ipn|catpart|catproduct|catdrawing|prt|asm|drw|par|psm|dft|x_t|x_b|xmt_txt|sat|sab|jt|3dm|f3d|3mf|obj|skp|doc|docx|docm|xls|xlsx|xlsm|ppt|pptx|odt|ods|odg|rtf|rar|7z|tar|gz|tgz|msg|bmp|svg)$/;

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
  // nákupní doklad dodavatele (#25 — cena) se neanonymizuje: kopie by obešla pravidlo o cenách
  if ((issuer ?? "") === "dodavatel" && !SUPPLIER_TECH_KINDS.includes(kind ?? "")) return false;
  // e-mail zákazníka uložený jako soubor (.eml / .msg, druh korespondence) nese jeho podklady i podpis
  if ((kind ?? "") === "korespondence" && /\.(eml|msg)$/.test(String(filename ?? "").toLowerCase())) return true;
  if (!(CANDIDATE_KINDS as readonly string[]).includes(kind ?? "")) return false;
  const m = String(mime ?? "").toLowerCase();
  const f = String(filename ?? "").toLowerCase();
  return (CANDIDATE_MIMES as readonly string[]).includes(m) || SUPPORTED_EXT_RE.test(f) || UNSUPPORTED_EXT_RE.test(f);
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
