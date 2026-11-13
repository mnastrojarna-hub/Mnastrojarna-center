/** Rychlé kontroly souboru STEP bez jádra (hlavička, úplnost, přítomnost sestavy). */
import { tr } from "../i18n";

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x8000)));
  return s;
};

/** Začíná soubor hlavičkou ISO-10303-21? */
export const stepHasHeader = (bytes: Uint8Array) => /ISO-10303-21/.test(latin1(bytes.subarray(0, 512)));

/** Končí soubor STEP řádně (END-ISO-10303-21)? Useknutý soubor (nedokončené stažení / uložení) se pozná podle konce. */
export const stepIsComplete = (bytes: Uint8Array) => /END-ISO-10303-21/i.test(latin1(bytes.subarray(Math.max(0, bytes.length - 4096))));

/** Text chyby pro useknutý soubor STEP. */
export const truncatedStepText = (fileName: string) =>
  tr("Soubor {0} je neúplný – chybí konec souboru STEP (END-ISO-10303-21). Nejspíš se nestáhl nebo neuložil celý; uložte / exportujte ho znovu.", fileName || "STEP");

/** Obsahuje soubor strukturu sestavy (NEXT_ASSEMBLY_USAGE_OCCURRENCE)? Jeden průchod bajty bez převodu na text. */
export function stepHasAssembly(bytes: Uint8Array): boolean {
  const needle = "NEXT_ASSEMBLY_USAGE_OCCURRENCE";
  const n0 = needle.charCodeAt(0);
  const L = needle.length;
  outer: for (let i = bytes.indexOf(n0); i >= 0 && i + L <= bytes.length; i = bytes.indexOf(n0, i + 1)) {
    for (let k = 1; k < L; k++) if (bytes[i + k] !== needle.charCodeAt(k)) continue outer;
    return true;
  }
  return false;
}
