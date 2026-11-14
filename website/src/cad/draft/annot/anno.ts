/**
 * BALÍK 2 (annot) – měřítko poznámek (anotativní objekty): anotativní text, kóta, odkaz, tolerance, značka a šrafa
 * mají velikosti „na papíře“; ve výkrese se násobí měřítkem poznámek (násobitel k = jednotek výkresu na jednotku
 * papíru, 1:50 → 50). Modelový prostor používá `vars.cannoscale` – CANNOSCALEVALUE AutoCADu = papír : skutečnost
 * (1:50 → 0,02, 2:1 → 2; stejně jej zapisuje balík 3 při změně měřítka výřezu), násobitel je 1 / cannoscale.
 *
 * SMLOUVA PRO BALÍK 3 (layout): výřez s měřítkem 1:N vykreslí místo `model.entities` seznam
 * `annoScaledList(model.entities, N, model)` (N = násobitel = 1 / poměr výřezu papír : skutečnost) – anotativní entity
 * (příznak `annotative`, i kóty s anotativním stylem DIMANNO) v něm jsou kopie se stejným id a měřítkem N (stabilní podle
 * identity seznamu a tabulky stylů, takže mezipaměti geometrie platí), ostatní entity jsou tytéž objekty.
 */
import { tr } from "../../i18n";
import type { DraftDimStyle, DraftEntity, DraftModel } from "../model";

type Tagged = { annotative?: boolean; __anno?: number };

/** násobitel měřítka poznámek modelu (1 / CANNOSCALE; bez hodnoty 1) */
export const annoMultiplier = (m: DraftModel): number => {
  const r = m.vars.cannoscale;
  return r !== undefined && Number.isFinite(r) && r > 0 ? 1 / r : 1;
};
/** CANNOSCALE (papír : skutečnost) pro násobitel měřítka poznámek */
export const cannoscaleOf = (k: number): number => 1 / k;

/** měřítko poznámek pro entitu (kopie pro výřez → měřítko výřezu, jinak CANNOSCALE modelu) */
export const annoScaleOf = (e: object, m: DraftModel): number => {
  const t = e as Tagged;
  const k = t.__anno ?? annoMultiplier(m);
  return Number.isFinite(k) && k > 0 ? k : 1;
};
export const isAnnotative = (e: object) => !!(e as Tagged).annotative;

/** kóta s anotativním stylem (DIMANNO) nebo přepsáním */
function annoByStyle(e: DraftEntity, styles: DraftDimStyle[] | undefined): boolean {
  if (e.type !== "dimension") return false;
  const d = e as unknown as { style?: string; overrides?: Partial<DraftDimStyle> };
  if (d.overrides?.dimanno !== undefined) return !!d.overrides.dimanno;
  if (!styles?.length) return false;
  const n = (d.style ?? "").toLowerCase();
  return !!(styles.find((s) => s.name.toLowerCase() === n) ?? styles[0]).dimanno;
}

const memo = new WeakMap<readonly DraftEntity[], Map<number, { styles: unknown; res: DraftEntity[] }>>();
/**
 * Seznam entit pro výřez v měřítku 1:k (k = násobitel, 1:50 → 50): anotativní entity jako kopie s měřítkem k.
 * `m` (nepovinné) = model – pak se jako anotativní berou i kóty, jejichž kótovací styl má DIMANNO.
 */
export function annoScaledList(list: readonly DraftEntity[], k: number, m?: DraftModel): DraftEntity[] {
  let byK = memo.get(list);
  if (!byK) memo.set(list, (byK = new Map()));
  const styles = m?.dimStyles;
  const hit = byK.get(k);
  if (hit && hit.styles === styles) return hit.res;
  let any = false;
  const out = list.map((e) => {
    if (!(e as Tagged).annotative && !annoByStyle(e, styles)) return e;
    any = true;
    return { ...e, __anno: k } as unknown as DraftEntity;
  });
  const res = any ? out : (list as DraftEntity[]);
  byK.set(k, { styles, res });
  return res;
}

/** standardní měřítka poznámek (ČSN EN ISO 5455) jako násobitele (1:50 → 50, 2:1 → 0,5) */
export const ANNO_SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 0.5, 0.2, 0.1] as const;
/** „1:50“ / „2:1“ / „50“ → násobitel měřítka poznámek (jednotek výkresu na jednotku papíru) */
export function parseAnnoScale(raw: string): number {
  const t = raw.trim().replace(",", ".");
  const m = /^(\d*\.?\d+)\s*[:/]\s*(\d*\.?\d+)$/.exec(t);
  const v = m ? Number(m[2]) / Number(m[1]) : Number(t);
  if (!(Number.isFinite(v) && v > 0)) throw new Error(tr("měřítko poznámek: 1:50, 2:1 nebo číslo, ne „{0}“", raw));
  return v;
}
/** popisek násobitele: 50 → „1:50“, 0,5 → „2:1“ */
export const annoScaleLabel = (k: number) => (k >= 1 ? `1:${Math.round(k * 1e6) / 1e6}` : `${Math.round((1 / k) * 1e6) / 1e6}:1`);
/** násobitel shodný s jedním ze standardních (po převodu CANNOSCALE ↔ násobitel) */
export const sameAnnoScale = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
