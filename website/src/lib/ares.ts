import type { CompanyInfo } from "./lead";

/** Ověření firmy v ARES (veřejný registr MF ČR). Vrací null, když IČO neexistuje nebo ARES neodpoví. */
export async function aresLookup(ico: string, timeoutMs = 4000): Promise<CompanyInfo | null> {
  const clean = ico.replace(/\s/g, "");
  if (!/^\d{8}$/.test(clean)) return null;
  try {
    const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      ico?: string;
      obchodniJmeno?: string;
      dic?: string;
      pravniForma?: string;
      sidlo?: { textovaAdresa?: string };
    };
    if (!j.obchodniJmeno) return null;
    return {
      ico: j.ico ?? clean,
      name: j.obchodniJmeno,
      address: j.sidlo?.textovaAdresa,
      dic: j.dic,
      legalForm: j.pravniForma,
      // 101 = fyzická osoba podnikající dle živnostenského zákona
      selfEmployed: j.pravniForma === "101",
    };
  } catch {
    return null;
  }
}
