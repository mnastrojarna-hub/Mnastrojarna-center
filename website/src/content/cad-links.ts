/** Adresy online CADu a jeho dokumentace pro menu, patičku, úvodní stránku i aplikaci. (cad-docs.ts je opakuje, protože ji čte i Node skript bez importů.) */
export const CAD_LINKS = {
  app: "/cad",
  docs: "/cad/dokumentace",
  pdf: "/cad/mnastrojarna-cad-prirucka.pdf",
  md: "/cad/dokumentace.md",
  /** návod a schéma pro AI agenty a automatizaci */
  agent: "/cad/schema-pro-ai.md",
} as const;

/** Adresa aplikace v daném jazyce rozhraní (čeština bez prefixu, /en/cad, /de/cad). */
export const cadAppHref = (locale: "cs" | "en" | "de") => (locale === "cs" ? CAD_LINKS.app : `/${locale}/cad`);
/** Dokumentace CADu v daném jazyce (anglická a německá stránka shrnuje ovládání a odkazuje na úplnou českou příručku). */
export const cadDocsHref = (locale: "cs" | "en" | "de") => (locale === "cs" ? CAD_LINKS.docs : locale === "en" ? "/en/cad/documentation" : "/de/cad/dokumentation");
/** Je cesta stránkou aplikace CAD (v libovolném jazyce)? */
export const isCadAppPath = (pathname: string) => /^(\/(en|de))?\/cad\/?$/.test(pathname);
