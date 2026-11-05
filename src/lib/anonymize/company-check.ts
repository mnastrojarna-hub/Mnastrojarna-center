import "server-only";
import { addUsage } from "@/lib/ai/ai-call";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { boxInsideSent } from "./claude-image";
import { asArray, checkCompanies, isRemovableCompany, type AiCallConfig, type AiImageSpec, type CompanyItem } from "./detect-ai";
import { cropToJpeg } from "./image";
import { burnGraphic, type Raster } from "./pdf-raster";
import { containsTerm, isTechnicalText, type RuleContext, type Term } from "./rules";
import { normalizeText } from "./text";
import type { Box } from "./types";

/**
 * Výstupní kontrola anonymizované kopie OBRAZEM (majitel 2. 11.: „výkresy vedené jako anonymizované mají furt
 * v hlavičce název firmy"): textová vrstva nestačí — název může být křivkami, v logu, ve fontu Type3 / CID bez
 * ToUnicode, natočený nebo rozsypaný po znacích. AI dostane VÝSTUPNÍ rastr (přehled + razítko / okraje
 * v plném rozlišení) a vypíše každý název firmy, který je pořád vidět. Nález se vypálí (box z AI) a kontrola
 * se zopakuje; když název zůstane (nebo ho nejde vypálit bez zásahu do čísla výkresu), stránka NEPROŠLA
 * a kopie se nikdy nepoužije.
 */

export interface CompanyCheckInput {
  raster: Raster;
  page: number;
  ai: AiCallConfig;
  /** Oblasti výstupu (px) posílané ve vyšším rozlišení — razítko, okraje listu. */
  focus: { box: Box; label: string }[];
  keepTerms: readonly string[];
  /** Termíny firem (CRM, vlastní, z výkresu): přepis, který je obsahuje, je únik i při jiné roli od AI. */
  terms?: readonly Term[];
  /** Keep pole (číslo výkresu, materiál…) v px výstupu — přes ně se box z AI nevypaluje. */
  keepBoxes: readonly Box[];
  fill: readonly number[];
  /** Smazat i logo bez čitelného názvu (volba „logo"). */
  logo: boolean;
  /** Kola kontroly (kontrola → vypálení nálezů → kontrola); výchozí podle zbývajícího času (2–3). */
  rounds?: number;
}

/** Třetí kolo kontroly (další levné volání) jen když do termínu zbývá aspoň tolik. */
export const THIRD_ROUND_MIN_LEFT_MS = 90_000;

/**
 * Počet kol kontroly podle času: majitel 5. 11. („někdy to musí dělat na třikrát") — dřív dvě kola: nález
 * ve druhém kole (druhý výskyt názvu, který AI v prvním kole nevypsala) = kopie neprošla a celý běh se
 * opakoval. Třetí kolo je jedno levné volání navíc a většinu takových případů dořeší hned.
 */
export function checkRounds(deadline: number, now = Date.now()): number {
  return deadline - now >= THIRD_ROUND_MIN_LEFT_MS ? 3 : 2;
}

export interface CompanyCheckOutcome {
  /** Ve výstupu nezůstal žádný název firmy (podle poslední kontroly). */
  clean: boolean;
  /** Doplněné (vypálené) oblasti v px výstupu. */
  healed: Box[];
  /** Počet nálezů v poslední kontrole. */
  leaks: number;
  /**
   * Čitelné názvy firem, které kontrola ve výstupu viděla (přepis AI; i ty, které se podařilo vypálit).
   * Volající je přidá k termínům — další stránky / další pokus je pak najdou pravidly v textové vrstvě
   * (všechny výskyty), ne jen jako box z obrazu.
   */
  names: string[];
  usage: AiUsage | null;
  calls: number;
  fallback: boolean;
}

const MAX_IMAGES = 6;

function compact(s: string): string {
  return normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Je nález AI ve výstupu únik? (role k smazání, ne naše firma, ne norma / materiál). Přepis se známým
 * termínem firmy (zákazník z CRM, jméno z výkresu) je únik vždy — i když ho AI označí jako výrobce dílu.
 */
export function isCompanyLeak(it: Pick<CompanyItem, "role" | "text" | "form">, keepTerms: readonly string[], logo: boolean, terms: readonly Term[] = []): boolean {
  const t = String(it.text ?? "").trim();
  const kept = (v: string) => keepTerms.some((k) => {
    const kc = compact(k);
    return kc.length >= 3 && compact(v).includes(kc);
  });
  if (it.role !== "ours" && t && terms.length && containsTerm(t, terms) && !kept(t)) return true;
  if (!isRemovableCompany(it.role)) return false;
  // logo bez čitelného názvu jen s volbou „logo"; název jako křivky bez přepisu je pořád název
  if (!/\p{L}{2,}/u.test(t)) return it.form === "curves" || logo;
  if (isTechnicalText(t)) return false;
  return !kept(t);
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

async function imagesFor(raster: Raster, focus: CompanyCheckInput["focus"], page: number): Promise<AiImageSpec[]> {
  const specs: AiImageSpec[] = [];
  const ov = await cropToJpeg(raster, { x: 0, y: 0, w: raster.width, h: raster.height });
  specs.push({ index: 0, kind: "overview", page, crop: ov.crop, s: ov.s, outW: ov.outW, outH: ov.outH, jpeg: ov.jpeg, label: `kopie strany ${page} — přehled` });
  for (const f of focus) {
    if (specs.length >= MAX_IMAGES) break;
    const b = clamp(f.box, raster.width, raster.height);
    if (!b) continue;
    const j = await cropToJpeg(raster, b);
    specs.push({ index: specs.length, kind: "crop", page, crop: j.crop, s: j.s, outW: j.outW, outH: j.outH, jpeg: j.jpeg, label: `kopie strany ${page} — ${f.label}` });
  }
  return specs;
}

function clamp(b: Box, W: number, H: number): Box | null {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const x2 = Math.min(W, b.x + b.w), y2 = Math.min(H, b.y + b.h);
  return x2 - x >= 8 && y2 - y >= 8 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export async function checkAndHealCompanies(input: CompanyCheckInput): Promise<CompanyCheckOutcome> {
  const out: CompanyCheckOutcome = { clean: false, healed: [], leaks: 0, names: [], usage: null, calls: 0, fallback: false };
  const rounds = Math.max(1, input.rounds ?? checkRounds(input.ai.deadline));
  for (let round = 0; round < rounds; round++) {
    const specs = await imagesFor(input.raster, input.focus, input.page);
    const r = await checkCompanies(input.ai, { images: specs, extra: { round, page: input.page, width: input.raster.width, height: input.raster.height } });
    out.usage = addUsage(out.usage, r.meta.usage);
    out.calls++;
    if (r.meta.fallback) out.fallback = true;
    const boxes: Box[] = [];
    let unhealable = 0;
    for (const it of asArray<CompanyItem>(r.data?.items)) {
      if (!isCompanyLeak(it, input.keepTerms, input.logo, input.terms ?? [])) continue;
      const txt = String(it.text ?? "").replace(/[\r\n]+/g, " ").trim();
      if (/\p{L}{2,}/u.test(txt) && !isTechnicalText(txt) && !out.names.includes(txt)) out.names.push(txt.slice(0, 120));
      const spec = specs.find((s) => s.index === it.img);
      // únik bez použitelných souřadnic nejde opravit → kopie neprošla (nikdy „asi v pořádku")
      if (!spec || !boxInsideSent(spec, it.x, it.y, it.w, it.h)) { unhealable++; continue; }
      const raw: Box = { x: spec.crop.x + it.x / spec.s, y: spec.crop.y + it.y / spec.s, w: it.w / spec.s, h: it.h / spec.s };
      const pad = Math.max(2, 0.15 * Math.min(raw.w, raw.h));
      const box: Box = { x: raw.x - pad, y: raw.y - pad, w: raw.w + 2 * pad, h: raw.h + 2 * pad };
      // číslo výkresu / materiál se nikdy nevypálí — nález přes ně = neprošlo
      if (input.keepBoxes.some((k) => overlapArea(k, box) > 0.5 * Math.max(1, k.w * k.h))) { unhealable++; continue; }
      boxes.push(box);
    }
    out.leaks = boxes.length + unhealable;
    if (!out.leaks) {
      out.clean = true;
      return out;
    }
    if (unhealable || round === rounds - 1) return out;
    for (const b of boxes) out.healed.push(burnGraphic(input.raster, b, input.fill).box);
  }
  return out;
}

/** Kontrola rastru skenu / fotky (razítko neznáme přesně → pravý dolní roh a dolní okraj ve vyšším rozlišení). */
export async function checkRasterCompanies(
  raster: Raster, page: number, ai: AiCallConfig, ctx: RuleContext, keepBoxes: readonly Box[], fill: "background" | "white" | "black",
): Promise<CompanyCheckOutcome> {
  const W = raster.width, H = raster.height;
  return checkAndHealCompanies({
    raster, page, ai, keepTerms: ctx.keepTerms, terms: ctx.terms, keepBoxes, fill: fill === "black" ? [0, 0, 0] : [255, 255, 255], logo: ctx.redact.logo,
    focus: [
      { box: { x: 0.5 * W, y: 0.62 * H, w: 0.5 * W, h: 0.38 * H }, label: "pravý dolní roh (razítko)" },
      { box: { x: 0, y: 0.9 * H, w: W, h: 0.1 * H }, label: "dolní okraj listu" },
    ],
  });
}
