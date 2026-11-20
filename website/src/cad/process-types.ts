/**
 * Smlouva operace jádra `process` (vlna 22, bod 4 – procesní vrstva pohybové studie): požadavek a odpověď bez závislosti na OCCT,
 * sdílené hlavním vláknem (cad/motion-process.ts) a jádrem (cad/process-kernel.ts).
 *
 * Geometrická aproximace střihu a otisku: v každém kroku studie se nástroj (v poloze kroku vůči obrobku) protne s PŮVODNÍM
 * obrobkem, průniky se sjednotí (odebraný objem R roste) a stav obrobku je obrobek − R. Žádné síly, otřep, odpružení ani tok
 * materiálu – jen booleovské operace na geometrii.
 */
import type { ComponentSource, MeshData, Vec3 } from "./types";

/** těleso dílu v jádře: klíč geometrie (`sourceKey`) a zdroj (díl se postaví, není-li v mezipaměti) */
export type ProcPart = { key: string; source: ComponentSource };

export type ProcReq = {
  /** obrobek (souřadnice obrobku = souřadnice jeho dílu) */
  target: ProcPart;
  /** nástroj (jeho tělesa) */
  tool: ProcPart;
  kind: "cut" | "imprint";
  /** hloubka zásahu [mm] (otisk vždy, střih volitelně = nástřih); bez hloubky střih sleduje nástroj */
  depth?: number;
  /**
   * poloha nástroje v souřadnicích obrobku po krocích: 12 čísel [R po řádcích, t] (zaokrouhleno na 1e-7 – stejná mřížka jako kolize);
   * null = operace v kroku ještě neplatí (podmínka začátku)
   */
  rels: (number[] | null)[];
  /** strop booleovských operací (výkon u velké sestavy); nad ním se kroky se záběrem podvzorkují */
  maxOps?: number;
  /** stavy, jejichž sítě se mají vrátit (index do `states`) – jen zobrazení (prohlížeč); CLI sítě nepotřebuje */
  mesh?: number[];
};

/** záběr nástroje v kroku */
export type ProcStep = {
  /** nástroj se obrobku dotýká (průnik s nenulovým objemem) */
  contact: boolean;
  /** hloubka odebraného materiálu ve směru pohybu [mm] (rozsah R podél směru) */
  depth: number;
  /** nástroj prošel celou tloušťkou (hrot opustil materiál) – odpad se oddělil */
  through: boolean;
  /** stav obrobku (index do `states`; 0 = plný) */
  state: number;
  /** krok se záběrem se nepočítal booleovsky (strop operací) – stav převzat z předchozího spočítaného */
  skipped?: boolean;
};

/** stav obrobku: odebraný objem, objem zbytku, odpad (po prostřižení), sítě (jen na požádání) */
export type ProcState = {
  removed: number;
  volume: number;
  /** odpad: oddělené kusy (objem, těžiště v souřadnicích obrobku) – jen po prostřižení */
  scrap: { volume: number; center: Vec3 }[];
  mesh?: MeshData | null;
  scrapMesh?: MeshData | null;
};

export type ProcRes = {
  steps: ProcStep[];
  states: ProcState[];
  /** směr pohybu nástroje v souřadnicích obrobku (jednotkový; null = nástroj se nepohnul) */
  dir: Vec3 | null;
  /** tloušťka materiálu pod nástrojem ve směru pohybu (z prostřižení; null = neprostřiženo) */
  thickness: number | null;
  /** objem obrobku před operací */
  volume0: number;
  /** podvzorkování: kroků se záběrem / spočítaných booleovsky */
  approx?: { contact: number; computed: number };
  /** chyba booleovské operace (výsledek pak jen do posledního platného stavu) */
  error?: string;
  /** výsledek z mezipaměti jádra */
  cached?: boolean;
  /** čas výpočtu [ms] */
  ms: number;
};

/** výchozí strop booleovských operací na operaci */
export const PROC_MAX_OPS = 48;
/** klíč požadavku (bez sítí): stejná studie a geometrie = tentýž výsledek (mezipaměť jádra i sítí v prohlížeči) */
export const procKey = (q: ProcReq): string => JSON.stringify([q.target.key, q.tool.key, q.kind, q.depth ?? null, q.maxOps ?? PROC_MAX_OPS, q.rels]);
