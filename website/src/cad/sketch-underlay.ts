/**
 * Podklad skici (obrázek / stránka PDF pod geometrií) – čistá matematika a práce s dokumentem (bez DOM a Reactu,
 * testováno ve sketch-underlay.test.ts):
 *  – převod pixel podkladu ↔ bod skici, rohy, matice pro vykreslení v SVG,
 *  – kalibrace měřítka dvěma body, posun, natočení, šířka,
 *  – rozměr zmenšené bitmapy (velké obrázky se před uložením zmenšují),
 *  – uložení podkladu na úrovni dokumentu (`CadDoc.underlays`), mimo prvek skici.
 *
 * Souřadnice: pixel podkladu má počátek v levém horním rohu bitmapy a osu Y dolů; skica je v mm s osou Y nahoru.
 */
import { uid, type CadDoc, type Feature, type SketchUnderlay, type Vec2 } from "./types";

/** delší strana uložené bitmapy nejvýš tolik px – větší obrázek se zmenší, stránka PDF se na tuto velikost vykreslí */
export const UNDERLAY_MAX_SIDE = 2000;
/**
 * Cílová velikost obrázku v dokumentu [znaky data URL, ≈ 0,5 MB dat]. Dokument se ukládá i do úložiště prohlížeče
 * (šifrovaně, kvóta kolem 5 MB na celý web) a drží se v historii kroků zpět, proto se větší bitmapa dál zmenšuje.
 */
export const UNDERLAY_MAX_CHARS = 700_000;
/** pod tuto delší stranu se kvůli velikosti už nezmenšuje (kóty na výkrese musí zůstat čitelné) – sníží se jen kvalita JPEG */
export const UNDERLAY_MIN_SIDE = 1000;
/** 1 bod PDF (1/72 palce) v mm: stránka PDF vytištěná v měřítku 1:1 má správnou velikost i bez kalibrace */
export const PT_MM = 25.4 / 72;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** úhel do rozsahu (−180; 180] */
export const normAngle = (deg: number) => {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
};

/** Pixel podkladu → bod skici [mm]. */
export function underlayToSketch(u: SketchUnderlay, px: Vec2): Vec2 {
  const lx = (px[0] - u.w / 2) * u.mmPerPx;
  const ly = (u.h / 2 - px[1]) * u.mmPerPx;
  const c = Math.cos(rad(u.angle));
  const s = Math.sin(rad(u.angle));
  return [u.x + lx * c - ly * s, u.y + lx * s + ly * c];
}

/** Bod skici [mm] → pixel podkladu (i mimo bitmapu). */
export function sketchToUnderlay(u: SketchUnderlay, p: Vec2): Vec2 {
  const dx = p[0] - u.x;
  const dy = p[1] - u.y;
  const c = Math.cos(rad(u.angle));
  const s = Math.sin(rad(u.angle));
  return [(dx * c + dy * s) / u.mmPerPx + u.w / 2, u.h / 2 - (-dx * s + dy * c) / u.mmPerPx];
}

/** Rohy podkladu ve skice [mm]: levý horní, pravý horní, pravý dolní, levý dolní (podle bitmapy). */
export function underlayCorners(u: SketchUnderlay): Vec2[] {
  return ([[0, 0], [u.w, 0], [u.w, u.h], [0, u.h]] as Vec2[]).map((p) => underlayToSketch(u, p));
}

/** Leží bod skici na podkladu? */
export function underlayContains(u: SketchUnderlay, p: Vec2): boolean {
  const [x, y] = sketchToUnderlay(u, p);
  return x >= 0 && y >= 0 && x <= u.w && y <= u.h;
}

/**
 * Matice `matrix(a,b,c,d,e,f)` pro prvek `<image width={w} height={h}>` vložený do skupiny SVG, která kreslí v mm skici
 * (osa Y nahoru): pixel (px, py) se zobrazí do bodu `underlayToSketch`.
 */
export function underlayMatrix(u: SketchUnderlay): [number, number, number, number, number, number] {
  const k = u.mmPerPx;
  const c = Math.cos(rad(u.angle)) * k;
  const s = Math.sin(rad(u.angle)) * k;
  return [c, s, s, -c, u.x - (c * u.w) / 2 - (s * u.h) / 2, u.y - (s * u.w) / 2 + (c * u.h) / 2];
}

/**
 * Kalibrace měřítka: dva body `a`, `b` [mm ve skice] naklikané na podkladu mají být ve skutečnosti `real` mm od sebe.
 * Podklad se zvětší / zmenší kolem bodu `a` (ten zůstane na místě, natočení se nemění). Neplatné zadání (body na sobě,
 * nekladná nebo nečíselná vzdálenost) vrací null.
 */
export function calibrateUnderlay(u: SketchUnderlay, a: Vec2, b: Vec2, real: number): SketchUnderlay | null {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(d > 1e-9) || !Number.isFinite(real) || !(real > 0)) return null;
  const k = real / d;
  return { ...u, mmPerPx: u.mmPerPx * k, x: a[0] + (u.x - a[0]) * k, y: a[1] + (u.y - a[1]) * k };
}

/** Posun podkladu o `d` [mm]. */
export const moveUnderlay = (u: SketchUnderlay, d: Vec2): SketchUnderlay => ({ ...u, x: u.x + d[0], y: u.y + d[1] });

/** Natočení podkladu na úhel `angle` [°, proti směru hodin] kolem bodu `pivot` [mm] (výchozí: střed podkladu). */
export function rotateUnderlay(u: SketchUnderlay, angle: number, pivot?: Vec2): SketchUnderlay {
  if (!Number.isFinite(angle)) return u;
  const a = normAngle(angle);
  if (!pivot) return { ...u, angle: a };
  const t = rad(a - u.angle);
  const dx = u.x - pivot[0];
  const dy = u.y - pivot[1];
  return { ...u, angle: a, x: pivot[0] + dx * Math.cos(t) - dy * Math.sin(t), y: pivot[1] + dx * Math.sin(t) + dy * Math.cos(t) };
}

/** Šířka podkladu [mm] (měřítko × šířka bitmapy). */
export const underlayWidth = (u: SketchUnderlay) => u.w * u.mmPerPx;
/** Nastaví šířku podkladu [mm] – mění měřítko kolem středu. Nekladná šířka podklad nezmění. */
export const setUnderlayWidth = (u: SketchUnderlay, widthMm: number): SketchUnderlay => (Number.isFinite(widthMm) && widthMm > 0 ? { ...u, mmPerPx: widthMm / u.w } : u);

/** Rozměr zmenšené bitmapy: delší strana nejvýš `maxSide` px, poměr stran zachován, nikdy se nezvětšuje (`k` = poměr zmenšení). */
export function fitBitmap(w: number, h: number, maxSide = UNDERLAY_MAX_SIDE): { w: number; h: number; k: number } {
  const k = Math.min(1, maxSide / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}

/** Vykreslí zdroj (obrázek, stránku PDF) do bitmapy w × h px a vrátí ji jako data URL daného typu (JPEG s kvalitou 0–1). */
export type BitmapEncode = (w: number, h: number, type: "image/png" | "image/jpeg", quality?: number) => Promise<string> | string;
export type EncodedBitmap = { src: string; w: number; h: number; type: "image/png" | "image/jpeg"; quality?: number; /** vešla se do limitu `maxChars` */ fits: boolean };
/** pořadí pokusů o uložení: PNG (ostré čáry výkresu, malé u jednobarevných ploch), pak JPEG v klesající kvalitě */
const ENCODINGS: ["image/png" | "image/jpeg", number | undefined][] = [["image/png", undefined], ["image/jpeg", 0.85], ["image/jpeg", 0.7], ["image/jpeg", 0.55]];

/**
 * Bitmapa podkladu pro uložení do dokumentu: delší strana nejvýš `maxSide` px (výchozí UNDERLAY_MAX_SIDE), data URL
 * nejvýš `maxChars` znaků (UNDERLAY_MAX_CHARS). Zkouší PNG a JPEG v klesající kvalitě; když nic nestačí, zmenšuje
 * bitmapu po 3/4 až k `minSide` (UNDERLAY_MIN_SIDE) a nakonec vrátí nejmenší výsledek (`fits: false`).
 */
export async function shrinkToFit(w0: number, h0: number, encode: BitmapEncode, o: { maxSide?: number; maxChars?: number; minSide?: number } = {}): Promise<EncodedBitmap> {
  const maxSide = o.maxSide ?? UNDERLAY_MAX_SIDE;
  const maxChars = o.maxChars ?? UNDERLAY_MAX_CHARS;
  const minSide = Math.min(o.minSide ?? UNDERLAY_MIN_SIDE, maxSide);
  let { w, h } = fitBitmap(w0, h0, maxSide);
  let best: EncodedBitmap | null = null;
  for (let guard = 0; guard < 16; guard++) {
    for (const [type, quality] of ENCODINGS) {
      const src = await encode(w, h, type, quality);
      if (!best || src.length < best.src.length) best = { src, w, h, type, quality, fits: false };
      if (src.length <= maxChars) return { src, w, h, type, quality, fits: true };
    }
    const side = Math.max(w, h);
    if (side <= minSide) break;
    const f = Math.max(0.75, minSide / side);
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
  }
  return best!;
}

/**
 * Nový podklad se středem v `center` [mm]. Měřítko: dané (`mmPerPx` – stránka PDF 1:1), jinak takové, aby se obrázek
 * vešel do 80 % okna `fit` [šířka, výška viditelné části skici v mm] – skutečné měřítko pak nastaví kalibrace.
 */
export function newUnderlay(o: { src: string; w: number; h: number; name?: string; center: Vec2; mmPerPx?: number; fit?: [number, number]; page?: number; pages?: number; pxPerPt?: number }): SketchUnderlay {
  const fit = o.fit ?? [200, 150];
  const mmPerPx = o.mmPerPx && o.mmPerPx > 0 ? o.mmPerPx : Math.max(1e-6, Math.min((fit[0] * 0.8) / o.w, (fit[1] * 0.8) / o.h));
  const u: SketchUnderlay = { id: uid(), src: o.src, w: o.w, h: o.h, x: o.center[0], y: o.center[1], mmPerPx, angle: 0, opacity: 0.6 };
  if (o.name) u.name = o.name;
  if (o.page) u.page = o.page;
  if (o.pages) u.pages = o.pages;
  if (o.pxPerPt) u.pxPerPt = o.pxPerPt;
  return u;
}

/**
 * Stránka PDF jako podklad ve skutečné velikosti (1 bod PDF = 25,4/72 mm): `pageW`, `pageH` = rozměr stránky v bodech,
 * bitmapa `w` × `h` px vykreslená s `pxPerPt` px na bod.
 */
export function pdfPageUnderlay(o: { src: string; w: number; h: number; pxPerPt: number; name?: string; center: Vec2; page: number; pages: number }): SketchUnderlay {
  return newUnderlay({ ...o, mmPerPx: PT_MM / o.pxPerPt });
}

/**
 * Převod bodu stránky PDF [body PDF, počátek vlevo nahoře, osa Y dolů – jako `extractPdfPaths`] na bod skici [mm] podle
 * polohy, měřítka (kalibrace) a natočení podkladu. Podklad bez `pxPerPt` (obrázek) bere 1 px = 1 bod.
 */
export function pdfToSketch(u: SketchUnderlay): (p: Vec2) => Vec2 {
  const k = u.pxPerPt && u.pxPerPt > 0 ? u.pxPerPt : 1;
  return (p) => underlayToSketch(u, [p[0] * k, p[1] * k]);
}

/**
 * Nová bitmapa téhož podkladu (jiná stránka PDF, znovu vybraný soubor): střed, natočení, krytí a viditelnost zůstávají.
 * U stránek PDF zůstává i skutečná velikost bodu PDF (kalibrace platí dál), jinak šířka podkladu v mm.
 */
export function replaceBitmap(u: SketchUnderlay, b: { src: string; w: number; h: number; name?: string; page?: number; pages?: number; pxPerPt?: number }): SketchUnderlay {
  const mmPerPx = u.pxPerPt && b.pxPerPt ? (u.mmPerPx * u.pxPerPt) / b.pxPerPt : (u.mmPerPx * u.w) / b.w;
  const out: SketchUnderlay = { ...u, src: b.src, w: b.w, h: b.h, mmPerPx };
  for (const k of ["name", "page", "pages", "pxPerPt"] as const) {
    if (b[k] != null) (out as Record<string, unknown>)[k] = b[k];
    else delete out[k];
  }
  return out;
}

/**
 * Měřítko stránky PDF po kalibraci jako na výkrese: skutečná délka / délka na papíře → „1:1“, „1:2“ (zmenšeno), „5:1“
 * (zvětšeno). Podklad, který není stránkou PDF, měřítko nemá (null). `num` formátuje číslo (výchozí: na 3 desetinná místa).
 */
export function pdfScaleLabel(u: SketchUnderlay, num: (v: number) => string = (v) => String(Math.round(v * 1000) / 1000)): string | null {
  if (!u.pxPerPt) return null;
  const f = (u.mmPerPx * u.pxPerPt) / PT_MM;
  if (!(f > 0) || !Number.isFinite(f)) return null;
  // 1,0004 je po kalibraci naklikanými body pořád 1:1
  const r = (v: number) => (Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v) : v);
  return f >= 1 ? `1:${num(r(f))}` : `${num(r(1 / f))}:1`;
}

/** Změna skici z editoru: entity / vazby / kóty a volitelně podklad (objekt = nastavit, null = odebrat, bez klíče = beze změny). */
export type SketchDocPatch = { underlay?: SketchUnderlay | null } & Record<string, unknown>;

/**
 * Promítne změnu skici do dokumentu: entity, vazby a kóty do prvku skici, podklad do `doc.underlays[sketchId]` – mimo
 * prvek, protože jádro staví klíč mezipaměti z `JSON.stringify` prvku a obrázek (data URL) by ho zbytečně zvětšoval
 * a měnil. Mění-li se jen podklad, pole prvků zůstává týmž objektem (model se kvůli podkladu nepřestavuje). Podklady
 * skic, které už v dokumentu nejsou (smazaná skica), se při změně podkladu zahodí.
 */
export function applySketchPatch(doc: CadDoc, sketchId: string, patch: SketchDocPatch): CadDoc {
  const { underlay, ...rest } = patch;
  const features = Object.keys(rest).length ? doc.features.map((f) => (f.id === sketchId ? ({ ...f, ...rest } as Feature) : f)) : doc.features;
  if (underlay === undefined) return { ...doc, features };
  const ids = new Set(features.filter((f) => f.type === "sketch").map((f) => f.id));
  const next: Record<string, SketchUnderlay> = {};
  for (const [id, u] of Object.entries(doc.underlays ?? {})) if (id !== sketchId && ids.has(id)) next[id] = u;
  if (underlay && ids.has(sketchId)) next[sketchId] = underlay;
  const out: CadDoc = { ...doc, features };
  if (Object.keys(next).length) out.underlays = next;
  else delete out.underlays;
  return out;
}
