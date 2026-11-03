/** Adresy online CADu a jeho dokumentace pro menu, patičku, úvodní stránku i aplikaci. (cad-docs.ts je opakuje, protože ji čte i Node skript bez importů.) */
export const CAD_LINKS = {
  app: "/cad",
  docs: "/cad/dokumentace",
  pdf: "/cad/mnastrojarna-cad-prirucka.pdf",
  md: "/cad/dokumentace.md",
  /** návod a schéma pro AI agenty a automatizaci */
  agent: "/cad/schema-pro-ai.md",
} as const;
