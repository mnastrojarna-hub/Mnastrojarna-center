/**
 * Písma a sdílení od hostitele enginu (CAD-HEADLESS-NAVRH.md kap. 2.3, balík B2) – nahrazují Node shim (`fetch("/fonts/…")`,
 * `location`) v CLI a `mncad serve`: `pdf.ts` (písma PDF), `build.ts`, `feat/refs-more.ts`, `ext/advanced.ts` (písmo
 * textu modelu) a `share.ts` (stránka odkazu a vlastní úložiště) se nejdřív zeptají zde. V prohlížeči nic nastavené není
 * a platí původní cesta (`fetch` z webu, `location`). Nastavuje se pro vlákno / modul (jádro CLI běží ve stejném vlákně).
 */
export type HostAssets = {
  /** písmo podle názvu souboru (`Roboto-Regular.ttf`, `Roboto-Bold.ttf`) */
  font?: (name: string) => Promise<ArrayBuffer>;
  /** sdílení: stránka CADu, na kterou odkaz vede (`https://…/cad`), a vlastní úložiště krátkých odkazů (`null` = jen v odkazu) */
  share?: { page: string; store: string | null };
};

let assets: HostAssets = {};

/** nastaví zdroje hostitele (CLI vlákno běhu); `{}` = zpět na prohlížečovou cestu */
export function setHostAssets(a: HostAssets): void {
  assets = a;
}
export const hostAssets = (): HostAssets => assets;

/** písmo od hostitele, nebo null (pak se stáhne z webu jako dřív) */
export const hostFont = (name: string): Promise<ArrayBuffer> | null => assets.font?.(name) ?? null;
