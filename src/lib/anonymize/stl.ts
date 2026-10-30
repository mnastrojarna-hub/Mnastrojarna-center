/**
 * Anonymizace STL (síť trojúhelníků) — žádný viditelný text, jen „jméno" souboru uvnitř:
 *  - ASCII: řádek „solid <název>" a „endsolid <název>" (SolidWorks / Inventor sem píšou název dílu,
 *    často s firmou nebo cestou) → „solid" / „endsolid" bez názvu,
 *  - binární: 80bajtová hlavička (exportér, autor, „COLOR=…") → vynulovaná, počet trojúhelníků a data
 *    beze změny. Barva/materiál v hlavičce („COLOR=", „MATERIAL=") se zahodí (není potřeba pro výrobu).
 * Geometrie se nemění (kontrola po zápisu). Čistý modul.
 */

export interface StlResult {
  bytes: Uint8Array | null;
  kind: "ascii" | "binary" | null;
  /** Odstraněný text (jen pro super admina — co se smazalo). */
  texts: { category: string; text: string }[];
  problems: string[];
  unsupported?: string;
}

function isBinaryStl(b: Uint8Array): boolean {
  if (b.length < 84) return false;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
  return 84 + n * 50 === b.length;
}

function printable(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : " ";
  return s.replace(/\s+/g, " ").trim();
}

export function anonymizeStl(bytes: Uint8Array): StlResult {
  const res: StlResult = { bytes: null, kind: null, texts: [], problems: [] };
  // binární STL může začínat i slovem „solid" (SolidWorks) — rozhoduje velikost
  if (isBinaryStl(bytes)) {
    res.kind = "binary";
    const head = printable(bytes.subarray(0, 80));
    if (head) res.texts.push({ category: "other", text: head });
    const out = new Uint8Array(bytes);
    out.fill(0, 0, 80);
    const label = new TextEncoder().encode("binary STL");
    out.set(label, 0);
    res.bytes = out;
    // kontrola: data za hlavičkou beze změny
    for (let i = 80; i < bytes.length; i++) if (out[i] !== bytes[i]) { res.problems.push("geometrie STL se změnila"); break; }
    return res;
  }
  const text = new TextDecoder("latin1").decode(bytes);
  if (!/^\s*solid\b/i.test(text) || !/\bfacet\b/i.test(text.slice(0, 4096)) && !/\bendsolid\b/i.test(text)) {
    res.unsupported = "Soubor STL nejde přečíst (poškozený nebo neznámý formát) — exportuj model znovu jako STL nebo STEP.";
    return res;
  }
  res.kind = "ascii";
  const out = text.replace(/^(\s*(?:end)?solid)([ \t]+[^\r\n]*)?$/gim, (_m, kw: string, name?: string) => {
    if (name && name.trim()) res.texts.push({ category: "other", text: name.trim() });
    return kw;
  });
  // kontrola: kromě „solid / endsolid" jen čísla a klíčová slova STL
  const rest = out.replace(/\b(?:end)?solid\b|\bfacet\b|\bnormal\b|\bouter\b|\bloop\b|\bvertex\b|\bendloop\b|\bendfacet\b/gi, " ");
  if (/[A-DF-Za-df-z]/.test(rest.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, " "))) res.problems.push("v STL zůstal text");
  const numsIn = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.length ?? 0;
  const numsOut = out.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.length ?? 0;
  // názvy mohou obsahovat čísla (D-4711) — geometrie nesmí přibýt
  if (numsOut > numsIn) res.problems.push("geometrie STL se změnila");
  res.bytes = new TextEncoder().encode(out);
  return res;
}
