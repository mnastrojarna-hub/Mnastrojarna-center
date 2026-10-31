/** Verze DWG k výběru v UI (oddělený modul bez knihovny – aby se acad-ts načítala jen při exportu). */
export type DwgVersion = "R2000" | "R2004" | "R2007" | "R2010" | "R2013" | "R2018";

export const DWG_VERSIONS: { id: DwgVersion; label: string; hint: string }[] = [
  { id: "R2018", label: "AutoCAD 2018+", hint: "AC1032 – AutoCAD 2018–2026, ZWCAD, BricsCAD, DraftSight" },
  { id: "R2013", label: "AutoCAD 2013–2017", hint: "AC1027" },
  { id: "R2010", label: "AutoCAD 2010–2012", hint: "AC1024" },
  { id: "R2007", label: "AutoCAD 2007–2009", hint: "AC1021 – větší soubor (bez komprese stránek)" },
  { id: "R2004", label: "AutoCAD 2004–2006", hint: "AC1018 – znaky mimo ASCII jako \\U+XXXX" },
  { id: "R2000", label: "AutoCAD 2000–2002", hint: "AC1015 – nejstarší kompatibilní, znaky mimo ASCII jako \\U+XXXX" },
];

/** Podpis v hlavičce souboru pro danou verzi (prvních 6 bajtů). */
export const DWG_SIGNATURE: Record<DwgVersion, string> = { R2000: "AC1015", R2004: "AC1018", R2007: "AC1021", R2010: "AC1024", R2013: "AC1027", R2018: "AC1032" };
