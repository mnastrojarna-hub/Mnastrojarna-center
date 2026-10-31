/** Záložky karty zakázky — klíče a aliasy z adresy (?tab=…). Bez závislostí (načítá se i v layoutu). */
export type DetailTab = "prehled" | "vyroba" | "polozky" | "nabidky" | "nakup" | "dokumenty" | "komunikace" | "historie";
export const DETAIL_TABS: DetailTab[] = ["prehled", "vyroba", "polozky", "nabidky", "nakup", "dokumenty", "komunikace", "historie"];

export function isDetailTab(v: unknown): v is DetailTab {
  return typeof v === "string" && (DETAIL_TABS as string[]).includes(v);
}

/** Anglické aliasy záložek (odkazy akcí toku: ?tab=items / quotes / production / purchasing). */
const TAB_ALIASES: Record<string, DetailTab> = {
  overview: "prehled", items: "polozky", quotes: "nabidky", production: "vyroba", purchasing: "nakup",
  documents: "dokumenty", history: "historie", communication: "komunikace", posta: "komunikace", mail: "komunikace",
};

export function detailTabOf(v: unknown): DetailTab | null {
  if (isDetailTab(v)) return v;
  return typeof v === "string" ? TAB_ALIASES[v] ?? null : null;
}
