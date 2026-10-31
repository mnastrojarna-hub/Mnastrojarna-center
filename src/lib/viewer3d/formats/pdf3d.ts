import { unzlibSync, inflateSync } from "fflate";

/**
 * 3D PDF: v PDF je anotace /Subtype /3D a na ni navázaný proud /Type /3D /Subtype /U3D nebo /PRC.
 * Tady jen najdeme a rozbalíme ten proud (dekódování U3D / PRC je v u3d.ts / prc.ts).
 * Čteme přímo bajty souboru (proudy nemohou být uvnitř objektových proudů), délka bývá přímo
 * číslem nebo odkazem na jiný objekt — oboje řešíme; když délka nesedí, hledáme „endstream".
 */

export interface Pdf3DStream {
  kind: "u3d" | "prc";
  data: Uint8Array;
}

function latin1(bytes: Uint8Array): string {
  // po kouscích — String.fromCharCode s obřím polem by přetekl zásobník
  let out = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(bytes.length, i + CH))));
  }
  return out;
}

/** Hledání ASCII řetězce v bajtech (bez převodu celého souboru na text). */
function indexOfAscii(bytes: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = bytes.indexOf(first, from); i >= 0 && i <= bytes.length - n; i = bytes.indexOf(first, i + 1)) {
    for (let k = 1; k < n; k++) if (bytes[i + k] !== needle.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

const NAME_END = new Set([0x20, 0x0a, 0x0d, 0x09, 0x2f, 0x3e, 0x3c, 0x5b, 0x5d, 0x28, 0x29]);

function hasName(bytes: Uint8Array, name: string): boolean {
  for (let i = indexOfAscii(bytes, name); i >= 0; i = indexOfAscii(bytes, name, i + 1)) {
    const next = bytes[i + name.length];
    if (next === undefined || NAME_END.has(next)) return true;
  }
  return false;
}

/** Rychlá kontrola, jestli PDF obsahuje 3D model (U3D / PRC), bez rozbalování. */
export function pdfHas3D(bytes: Uint8Array): boolean {
  return hasName(bytes, "/U3D") || hasName(bytes, "/PRC");
}

export function pdfIsEncrypted(bytes: Uint8Array): boolean {
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(latin1(bytes.subarray(0, Math.min(bytes.length, 1 << 20))));
}

/** Najde slovník „<< … >>" obsahující pozici `at` (vyvážené závorky). */
function enclosingDict(text: string, at: number): { start: number; end: number } | null {
  // dozadu na začátek objektu
  const objStart = text.lastIndexOf(" obj", at);
  if (objStart < 0) return null;
  const open = text.indexOf("<<", objStart);
  if (open < 0 || open > at) return null;
  let depth = 0;
  for (let i = open; i < text.length - 1; i++) {
    if (text[i] === "<" && text[i + 1] === "<") {
      depth++;
      i++;
    } else if (text[i] === ">" && text[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) return { start: open, end: i + 1 };
    }
  }
  return null;
}

function resolveLength(text: string, dict: string): number | null {
  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  if (direct) return Number(direct[1]);
  const ref = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (ref) {
    const re = new RegExp(`(?:^|[\\r\\n\\s])${ref[1]}\\s+${ref[2]}\\s+obj\\s*(\\d+)`, "g");
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

function decodeStream(raw: Uint8Array, dict: string): Uint8Array {
  const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? "";
  if (/FlateDecode/.test(filters)) {
    try {
      return unzlibSync(raw);
    } catch {
      // některé generátory zapisují raw deflate bez zlib hlavičky
      return inflateSync(raw);
    }
  }
  if (filters && !/^\s*$/.test(filters.replace(/[[\]]/g, ""))) {
    throw new Error(`nepodporovaný filtr proudu ${filters}`);
  }
  return raw;
}

/** Vytáhne všechny 3D proudy (U3D / PRC) z PDF. */
export function extractPdf3DStreams(bytes: Uint8Array): Pdf3DStream[] {
  const text = latin1(bytes);
  const out: Pdf3DStream[] = [];
  const seen = new Set<number>();
  const re = /\/Subtype\s*\/(U3D|PRC)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = enclosingDict(text, m.index);
    if (!d || seen.has(d.start)) continue;
    seen.add(d.start);
    const dict = text.slice(d.start, d.end);
    // musí to být proud (za slovníkem klíčové slovo stream)
    const after = text.slice(d.end, d.end + 32);
    const sm = /^\s*stream(\r\n|\n|\r)/.exec(after);
    if (!sm) continue;
    const dataStart = d.end + sm.index + sm[0].length;
    let length = resolveLength(text, dict);
    if (length === null || dataStart + length > bytes.length || !/^\s*endstream/.test(text.slice(dataStart + length, dataStart + length + 32))) {
      const endIdx = text.indexOf("endstream", dataStart);
      if (endIdx < 0) continue;
      length = endIdx - dataStart;
      // odříznout koncový EOL před endstream
      while (length > 0 && (bytes[dataStart + length - 1] === 0x0a || bytes[dataStart + length - 1] === 0x0d)) length--;
    }
    const raw = bytes.subarray(dataStart, dataStart + length);
    out.push({ kind: m[1] === "U3D" ? "u3d" : "prc", data: decodeStream(raw, dict) });
  }
  return out;
}
