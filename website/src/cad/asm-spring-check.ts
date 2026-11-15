/**
 * Kontrola tlačné pružiny v sestavě (vlna 21, balík motion): pevnost, nejmenší mezery mezi závity a vzpěr podle EN 13906-1
 * (statické zatížení, studeně vinutá pružina z kruhového drátu). Jedna sada vzorců: VŠE se počítá výpočtem pružiny z tabulky
 * (`@/cad/springs` – calcCompression, materiály EN 10270, shearStress, solidLength); tady jen to, co potřebuje tabulka
 * „Pružina mezi díly“ a protokol kinematické i dynamické pohybové studie, s hláškami pro pracovní bod v sestavě.
 *
 *   střední průměr        D = De − d (= Di + d), index vinutí w = D / d
 *   tuhost                R = G · d⁴ / (8 · D³ · n)                                    [N/mm]
 *   závity, délka na doraz nt = n + 2 (přiložené konce) / n (otevřené); Ln = nt·d (broušené), (nt + 1,5)·d (neobroušené),
 *                         (nt + 1)·d (otevřené konce – prvek Pružina se stálým stoupáním)
 *   nejmenší součet mezer Sa = (0,0015 · D² / d + 0,1 · d) · n  → nejmenší pracovní délka Ln + Sa (pod ní se závity dotýkají)
 *   napětí                τ = 8 · D · F / (π · d³), k = (w + 0,5) / (w − 0,75) (Bergsträsser), τk = k · τ
 *   dovolené (statické)   τzul = 0,5 · Rm(d), Rm = dolní mez pevnosti drátu (EN 10270-1 / -2 / -3, log-log interpolace)
 *   kontrola napětí       jako výpočet pružiny z tabulky: statická kontrola napětím BEZ korekce (τ ≤ τzul, na dorazu τn ≤ τzul);
 *                         τk = k · τ nad τzul = přísnější ⚠ pro opakované zatížení (stírače, vyhazovače) s „staticky vyhoví“
 *   vzpěr                 sK = L0 · 0,5 / (1 − G/E) · [1 − √(1 − (1 − G/E) / (0,5 + G/E) · (π·D / (ν·L0))²)],
 *                         ν = uložení z tabulky pružiny (`uložení`, výchozí 0,5 = oba konce na rovnoběžných deskách) – stejný
 *                         výsledek jako `pružina tabulka`; záporný výraz pod odmocninou = pružina se nevybočí;
 *                         pružina v díře / kapse nebo na trnu je vedená (`SpringDef.guided`) – vzpěr se nehlásí.
 *
 * Ruční příklad (recenze vlny 21, „Pružina mezi díly“ d 3 · De 19,5 · L0 41 · n 4, SH, stlačená na F = 964,4 N):
 *   D = 16,5, w = 5,5, R = 81 500·81 / (8·4 492,125·4) = 45,924 N/mm, Ln = 6·3 = 18 mm,
 *   τ = 8·964,4·16,5 / (π·27) = 1 500,8 MPa, k = 6 / 4,75 = 1,2632, τk = 1 895,8 MPa, Rm(3) = 1 840 → τzul = 920 MPa
 *   → statická kontrola τ 163 % (⚠ pružina sedne), τk 206 %.
 * Střižníková pružina 2 × 19,5 × 41, n 7,5 stlačená na 20 mm: D = 17,5, Ln = 9,5·2 = 19, Sa = (0,0015·306,25/2 + 0,2)·7,5
 *   = 3,2227 → Ln + Sa = 22,22 mm > 20 mm – závity se dotýkají.
 */
import { springGeom } from "./asm-spring-geom";
import { getLang, tr } from "./i18n";
import { calcCompression, readCompression, shearStress, solidLength, springMaterial, type Ends, type SpringData } from "./springs";
import type { AsmComponent, CadDoc } from "./types";

export type SpringEnds = Ends;

/**
 * Drát pružiny: průměr drátu d, střední průměr D, činné / celkové závity, konce, materiál, volná délka, délka na doraz a součinitel
 * uložení ν pro vzpěr (EN 13906-1 obr. 4: 0,5 oba konce vetknuté / na rovnoběžných deskách, 0,7, 1 oba kloubové, 2 volný konec).
 */
export type SpringWire = { d: number; D: number; n: number; nt: number; ends: SpringEnds; material: string; L0: number; Ln: number; nu: number };

/** data výpočtu pružiny z tabulky pro drát – uložení ν z tabulky pružiny (`uložení`), u ostatních 0,5 (oba konce na deskách) */
const wireData = (w: SpringWire): SpringData => ({ d: w.d, D: w.D, n: w.n, L0: w.L0, ends: w.ends, material: w.material, nu: String(w.nu) });

/** drát z dat tabulky (`spring.compression` nebo tabulka Pružina mezi díly) včetně uložení ν – null = chybí rozměry */
function wireOfData(data: SpringData): SpringWire | null {
  const i = readCompression(data);
  if (!(i.d > 0 && i.D > 0 && i.n > 0 && i.L0 > 0)) return null;
  const nt = i.ends === "open" ? i.n : i.n + 2;
  return { d: i.d, D: i.D, n: i.n, nt, ends: i.ends, material: springMaterial(i.material).id, L0: i.L0, Ln: solidLength(i.d, nt, i.ends), nu: i.nu };
}

/** Tabulka pružiny (Pružina mezi díly / text `sestava pružina nová`): d, De, L0, n, materiál; konce přiložené a broušené. */
export function wireOfSpec(s: { d: number; De: number; L0: number; n: number; material?: string }, ends: SpringEnds = "ground"): SpringWire {
  const nt = ends === "open" ? s.n : s.n + 2;
  return wireOfData({ d: s.d, De: s.De, L0: s.L0, n: s.n, ends, material: s.material ?? "SH" }) ?? { d: s.d, D: s.De - s.d, n: s.n, nt, ends, material: springMaterial(s.material).id, L0: s.L0, Ln: solidLength(s.d, nt, ends), nu: 0.5 };
}

/**
 * Drát pružiny z dílu: tabulková tlačná pružina `spring.compression` (d, D / De / Di, n / nt, konce a MATERIÁL z dat prvku – čte je
 * výpočet `@/cad/springs`), jinak prvek Pružina (stálé stoupání: drát, poloměr = střední, závity = činné, otevřené konce,
 * Ln = (závity + 1)·drát jako v asm-spring-geom), materiál z dílu („nerez“ → 1.4310, jinak SH). null = díl není drátová pružina.
 */
export function springWireOf(doc: CadDoc | undefined): SpringWire | null {
  if (!doc || doc.kind === "assembly" || !springGeom(doc)) return null;
  const live = doc.features.filter((f) => !f.suppressed);
  const tab = live.find((f) => f.type === "ext" && f.ext === "spring.compression");
  if (tab && tab.type === "ext") return wireOfData(tab.data ?? {});
  const sp = live.find((f) => f.type === "spring");
  if (sp && sp.type === "spring" && sp.wire > 0 && sp.radius > 0 && sp.turns > 0) {
    return { d: sp.wire, D: 2 * sp.radius, n: sp.turns, nt: sp.turns, ends: "open", material: springMaterial(doc.material).id, L0: sp.pitch * sp.turns + sp.wire, Ln: solidLength(sp.wire, sp.turns, "open"), nu: 0.5 };
  }
  return null;
}

/** tuhost R = G·d⁴ / (8·D³·n) [N/mm] – z výpočtu pružiny (`@/cad/springs` calcCompression) */
export const wireRate = (w: SpringWire) => calcCompression(wireData(w)).v.R ?? 0;
/** Tuhost pružiny z geometrie dílu [N/mm] (dynamika: pružina bez zadané tuhosti); null = díl není drátová pružina. */
export function springRateOf(doc: CadDoc | undefined): number | null {
  const w = springWireOf(doc);
  return w ? wireRate(w) : null;
}

export type SpringIssue = { level: "warn" | "error"; text: string };
export type SpringCheck = {
  D: number;
  w: number;
  R: number;
  Ln: number;
  Sa: number;
  /** nejmenší pracovní délka Ln + Sa */
  Lmin: number;
  k: number;
  Rm: number;
  tauzul: number;
  /** kritický zdvih vzpěru (Infinity = nevybočí) */
  sK: number;
  /** napětí bez korekce τ (statická kontrola) a korigované τk = k · τ při síle F [MPa] */
  tau: (F: number) => number;
  tauk: (F: number) => number;
  /** τ / τk při pracovní délce / síle (je-li zadaná) a na dorazu Ln [MPa] */
  tauWork?: number;
  taukWork?: number;
  tauLn: number;
  taukLn: number;
  issues: SpringIssue[];
};

const fmt = (n: number, d = 2): string => {
  const s = String(Math.round(n * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
const pct = (a: number, b: number) => fmt((100 * a) / b, 0);

/**
 * Kontrola pružiny v pracovním bodě: `L` = nejmenší pracovní délka (montáž nebo nejkratší délka v pohybu), `F` = největší síla
 * (jinak R·(L0 − L)), `guided` = pružina vedená dírou / kapsou nebo trnem (true – vzpěr se nehlásí, false – nevedená,
 * undefined – neznámo), `noLn` = bez upozornění na napětí na dorazu (protokol pohybu hlásí jen skutečně dosažené stlačení).
 * Hodnoty (R, Sa, k, Rm, τzul, sK) dává výpočet pružiny z tabulky; Ln je z drátu (u pružiny v sestavě z její definice).
 */
export function springCheck(w: SpringWire, work: { L?: number; F?: number; guided?: boolean; noLn?: boolean } = {}): SpringCheck {
  const v = calcCompression(wireData(w)).v;
  const { d, D, L0, Ln } = w;
  const R = v.R ?? 0;
  const Sa = v.Sa ?? 0;
  const Lmin = Ln + Sa;
  const k = v.k ?? 1;
  const Rm = v.Rm ?? 0;
  const tauzul = v.tauzul ?? 0;
  const sK = v.sK ?? Infinity;
  const tau = (F: number) => shearStress(D, d, F);
  const tauk = (F: number) => k * tau(F);
  const tauLn = tau(R * Math.max(0, L0 - Ln));
  const taukLn = k * tauLn;
  const issues: SpringIssue[] = [];
  if (L0 <= Ln + 1e-9) issues.push({ level: "error", text: tr("volná délka L0 {0} mm není větší než délka na doraz Ln {1} mm (nt {2} × d {3}) – zvětšete L0 nebo zmenšete n či d", fmt(L0, 3), fmt(Ln, 3), fmt(w.nt, 2), fmt(d, 3)) });
  const F = work.F ?? (work.L !== undefined ? R * Math.max(0, L0 - work.L) : undefined);
  const tauWork = F !== undefined ? tau(Math.abs(F)) : undefined;
  const taukWork = tauWork !== undefined ? k * tauWork : undefined;
  if (work.L !== undefined && L0 > Ln) {
    if (work.L < Ln - 1e-6) {
      /* pod délkou na doraz hlásí volající (✗) */
    } else if (work.L < Lmin - 1e-6) issues.push({ level: "warn", text: tr("pracovní délka {0} mm je pod nejmenší přípustnou Ln + Sa = {1} mm (Ln {2} + mezery Sa {3}) – závity se dotýkají", fmt(work.L, 3), fmt(Lmin, 2), fmt(Ln, 2), fmt(Sa, 2)) });
  }
  // napětí jako výpočet pružiny z tabulky: statická kontrola bez korekce, τk jen jako přísnější rada pro opakované zatížení
  if (tauWork !== undefined && tauWork > tauzul) issues.push({ level: "warn", text: tr("napětí {0} % dovoleného při síle {1} N (τ = {2} MPa, τzul = 0,5·Rm = {3} MPa, statická kontrola EN 13906-1) – pružina sedne; silnější drát, víc závitů nebo menší zdvih", pct(tauWork, tauzul), fmt(Math.abs(F!), 1), fmt(tauWork, 0), fmt(tauzul, 0)) });
  else if (taukWork !== undefined && taukWork > tauzul) issues.push({ level: "warn", text: tr("napětí s korekcí k {0} % dovoleného při síle {1} N (τk = {2} MPa) – staticky vyhoví (τ {3} %), při opakovaném zatížení (stírače, vyhazovače) volte silnější drát, víc závitů nebo menší zdvih", pct(taukWork, tauzul), fmt(Math.abs(F!), 1), fmt(taukWork, 0), pct(tauWork!, tauzul)) });
  if (!work.noLn && L0 > Ln && tauLn > tauzul && !(tauWork !== undefined && tauWork > tauzul)) issues.push({ level: "warn", text: tr("na doraz Ln by napětí bylo {0} % dovoleného (τn = {1} MPa) – omezte zdvih dorazem nad Ln", pct(tauLn, tauzul), fmt(tauLn, 0)) });
  const s = work.L !== undefined ? L0 - work.L : undefined;
  if (work.guided !== true && s !== undefined && Number.isFinite(sK) && s > sK)
    issues.push({
      level: "warn",
      text:
        work.guided === false
          ? tr("pružina se vybočí – zdvih {0} mm je větší než kritický sK = {1} mm (L0/D = {2}); použijte trn nebo vedení v díře", fmt(s, 2), fmt(sK, 2), fmt(L0 / D, 2))
          : tr("pružina se může vybočit – zdvih {0} mm je větší než kritický sK = {1} mm (L0/D = {2}), není-li vedená v díře nebo na trnu", fmt(s, 2), fmt(sK, 2), fmt(L0 / D, 2)),
    });
  return { D, w: D / d, R, Ln, Sa, Lmin, k, Rm, tauzul, sK, tau, tauk, ...(tauWork !== undefined ? { tauWork, taukWork } : {}), tauLn, taukLn, issues };
}

/**
 * Kontrola pružiny komponenty v pohybové studii při nejkratší dosažené délce `Lmin`: L0 a Ln z definice pružiny v sestavě (jinak
 * z dílu), síla z tuhosti definice (jinak z geometrie) bez tlumiče; vedení dírou / kapsou z definice (`guided` – zapíše ho
 * Pružina mezi díly u díry), jinak neznámé. null = díl není drátová pružina (trubka / válec), nemá definici, nebo zadaná tuhost
 * neodpovídá geometrii dílu (víc než ±10 % – díl je jen náhradní tvar jiné pružiny, např. normálie s ručně zadanou tuhostí;
 * napětí a mezery drátu by se týkaly jiné pružiny).
 */
export function springMotionCheck(c: AsmComponent, Lmin: number): SpringCheck | null {
  const w0 = c.spring && c.source.kind === "part" ? springWireOf(c.source.doc) : null;
  if (!w0 || !c.spring) return null;
  const Rg = wireRate(w0);
  if (c.spring.rate !== undefined && Math.abs(c.spring.rate - Rg) > 0.1 * Rg) return null;
  const w: SpringWire = { ...w0, L0: c.spring.free, Ln: c.spring.solid ?? w0.Ln };
  const R = c.spring.rate ?? Rg;
  return springCheck(w, { L: Lmin, F: R * Math.max(0, w.L0 - Lmin), noLn: true, ...(c.spring.guided !== undefined ? { guided: c.spring.guided } : {}) });
}
