/**
 * Softwarové zobrazení bez WebGL (vlna 22, bod 21) – jeden seznam omezení pro horní lištu, poznámku „Proč nevidím 3D?“,
 * návod pro AI a příručku. Prostředí bez WebGL je OMEZENÍ PROSTŘEDÍ (neutrální stav „Softwarové zobrazení – WebGL není
 * dostupné“), ne chyba modelu: jádro, přepočet, řez, výběr, měření v panelu i export (včetně videa) běží dál.
 *
 * `key` = vlastnost 3D okna (viewport.tsx `ViewportProps`), kterou softwarový náhled (viewport-soft.tsx `SoftScene`)
 * nekreslí – vitest hlídá, že seznam odpovídá skutečnosti (vlastnost existuje ve 3D okně a náhled ji nemá).
 */
import { tr } from "./i18n";

export type SoftLimit = { key: string; what: () => string; instead: () => string };

/** Co softwarový náhled neukáže, a čím to nahradit. */
export const SOFT_LIMITS: readonly SoftLimit[] = [
  { key: "ortho", what: () => tr("perspektiva – náhled je vždy pravoúhlý"), instead: () => tr("pohledy a otáčení fungují") },
  { key: "gizmo", what: () => tr("gizmo přesunu a otočení komponenty"), instead: () => tr("poloha číslem v panelu komponenty nebo textem „sestava komponenta …“") },
  { key: "sketches", what: () => tr("skici v modelu"), instead: () => tr("skica se kreslí a upravuje ve 2D editoru skici") },
  { key: "datums", what: () => tr("pomocné roviny, osy a body"), instead: () => tr("seznam v historii prvků, textem „stav“") },
  { key: "showGrid", what: () => tr("mřížka a osy prostoru"), instead: () => tr("rozměry ukazuje „stav“ a panel Měření") },
  { key: "surface", what: () => tr("analýzy ploch – zebra, úkosy, tloušťka stěny, křivost"), instead: () => tr("číselné výsledky textem („analýza úkosů“, „měřit“)") },
  { key: "vertexColors", what: () => tr("barevná mapa odchylek a úkosů na modelu"), instead: () => tr("odchylky číselně v protokolu „porovnat“") },
  { key: "ghosts", what: () => tr("duchové – průhledné porovnání s referencí nebo předchozí polohou"), instead: () => tr("výsledek „porovnat“ v protokolu") },
  { key: "measure", what: () => tr("grafika měření a stopa bodu pohybové studie"), instead: () => tr("hodnoty v panelu Měření, v panelu Pohyb a textem „měřit“ / „pohyb stav“") },
  { key: "surfOverlay", what: () => tr("hřebeny křivosti a řídicí body ploch třídy A"), instead: () => tr("návaznost ploch textem („analýza návaznosti“, „analýza hřebenu“)") },
];

/** Jak vybrat hranu / plochu bez 3D okna (alternativy výběru). */
export const SOFT_PICK_ALTERNATIVES = (): string[] => [
  tr("klik v náhledu vybere plochu, hranu nebo vrchol (Ctrl / Shift přidá, tažení = výběr oknem)"),
  tr("„Ze seznamu…“ ve formuláři prvku – plochy a hrany podle čísla a popisu"),
  tr("textem „vyber F3 E2“ nebo window.mncad.select([…])"),
];

/** stav prostředí pro horní lištu a `window.mncad`: plné 3D, softwarové zobrazení, žádné zobrazení */
export type ViewEnv = "webgl" | "soft" | "none";

/**
 * Řádek zobrazení pro `window.mncad.status()` (kolo 7, bod 21): strojová část `view=webgl|soft|none projection=persp|ortho`
 * (nepřekládá se) a lidská věta. Popisuje prostředí aplikace, ne model – v CLI (`mncad run … stav`) se nevypisuje (tam žádné
 * zobrazení není).
 */
export function viewStatusLine(env: ViewEnv, o: { ortho?: boolean } = {}): string {
  // o.ortho = uživatel zvolil pravoúhlé promítání (bez WebGL je náhled pravoúhlý vždy)
  const proj = env === "webgl" && !o.ortho ? "persp" : "ortho";
  const what = env === "webgl" ? tr("3D okno (WebGL)") : env === "soft" ? softStatusText() : tr("model se nezobrazuje");
  // shodně se stavovým řádkem aplikace (`[data-projection]`): bez WebGL a s nastavenou perspektivou poznámka v závorce
  const how = env === "none" ? "" : ` · ${proj === "persp" ? tr("perspektiva") : env === "soft" && !o.ortho ? tr("pravoúhlá (perspektiva jen ve WebGL)") : tr("pravoúhlá")}`;
  return `${tr("Zobrazení:")} ${what}${how} · view=${env} projection=${proj}`;
}

/** text stavu prostředí (neutrální – omezení prohlížeče, ne chyba modelu) */
export const softStatusText = (): string => tr("Softwarové zobrazení – WebGL není dostupné");

/** celá poznámka: omezené funkce a náhrady – stejná pro „Proč nevidím 3D?“, návod pro AI a příručku */
export function softLimitsText(): string {
  const rows = SOFT_LIMITS.map((l) => `• ${l.what()} → ${l.instead()}`);
  const pick = SOFT_PICK_ALTERNATIVES().map((t) => `• ${t}`);
  return [tr("Bez WebGL náhled nekreslí:"), ...rows, tr("Výběr hran a ploch bez 3D okna:"), ...pick].join("\n");
}
