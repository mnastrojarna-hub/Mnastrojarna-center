/**
 * Úrovně stavu prvku (vlna 22, body 22a–22c a 22i zprávy majitele: „rozlišit úspěch vytvoření prvku, úspěch booleovské
 * operace a platnost konečného tělesa“; „přijetí příkazu musí mít jiný stav než geometrický úspěch“).
 *
 * Jeden model pro jádro (`FeatureStatus`), protokol (řádky ✓ / ℹ / ⚠ / ✗ a JSON `entries[].data.levels`), textový stav
 * (`stav` → Prvky) i strom prvků v aplikaci:
 *
 *   1. přijato        příkaz je zapsaný v dokumentu – protokol ℹ `op.accepted` („… – výsledek po výpočtu níže“). Není to výsledek.
 *   2. vznik prvku    `ok` – stavitel prvku doběhl (jinak ✗ `feature.failed`).
 *   3. účinek         `effect` – o kolik se změnil objem tělesa proti objemu nástroje: none (nic) / partial (část nástroje) /
 *                     full (celý nástroj) / changed (prvek bez nástroje – zaoblení, úkos …).
 *   4. konečné těleso `body` – počet objemových těles, volné plochy (mimo tělesa) a výsledek kontroly platnosti; `valid: null`
 *                     = kontrola se NEPROVEDLA (důvod ve `why`) – takový prvek nikdy není ✓, ale ℹ `feature.unchecked`.
 *
 * Očekávaný typ výsledku: prvek objemového typu (primitiva, vysunutí, díra, zaoblení, pole, prvky rozšíření s operací …),
 * po kterém nezůstalo objemové těleso nebo přibyly volné plochy, je ✗ u toho prvku (`resultTypeError`).
 *
 * Modul je čistý (bez jádra) – používá ho stavba, engine, CLI i React.
 */
import { getLang, tr } from "./i18n";
import type { Feature, FeatureStatus } from "./types";

/** do kolika ploch se platnost tělesa kontroluje po každém prvku (dražší tělesa až na konci stavby) */
export const FEATURE_CHECK_FACES = 400;
/** do kolika ploch se platnost kontroluje na konci stavby */
export const FINAL_CHECK_FACES = 2000;

export type EffectLevel = "none" | "partial" | "full" | "changed";
export type EffectOp = "new" | "add" | "cut" | "intersect" | "modify";
export type FeatureEffect = {
  op: EffectOp;
  /** změna objemu tělesa prvkem v mm³ (kladná = přidáno, záporná = ubráno) */
  dV: number;
  /** objem nástrojů booleovských operací prvku v mm³ (když ho lze určit) */
  tool?: number;
  /** změna objemu podle přesného průniku tělesa s nástrojem v mm³ (jen když se počítal – podezřelý výsledek) */
  expected?: number;
  level: EffectLevel;
};
/** proč se platnost tělesa nekontrolovala: počet ploch nad limitem po prvku / na konci stavby, těleso měřené ze sítě */
export type BodyUnchecked = "feature-faces" | "feature-none" | "final-faces" | "approx";
export type BodyCheck = {
  /** počet objemových těles */
  solids: number;
  /** ploch mimo objemová tělesa (volné plochy, pláště) */
  free: number;
  faces: number;
  /** výsledek kontroly platnosti (BRepCheck); `null` = nezkontrolováno */
  valid: boolean | null;
  why?: BodyUnchecked;
};
export type Composition = { solids: number; free: number; faces: number };

/** pod jakým zlomkem objemu nástroje je účinek „žádný“ a nad jakým „celý nástroj“ */
const NONE = 1e-3;
const FULL = 1 - 1e-3;

/**
 * Úroveň účinku: `dV` = změna objemu tělesa, `tool` = objem nástrojů (není-li znám, rozhoduje jen to, zda se objem změnil),
 * `size` = objem tělesa před prvkem (měřítko numerického šumu).
 */
export function effectOf(op: EffectOp, dV: number, tool: number | undefined, size: number): FeatureEffect {
  const eps = 1e-9 * Math.max(1, Math.abs(size));
  const d = Math.abs(dV);
  const known = tool !== undefined && Number.isFinite(tool) && tool > 0;
  let level: EffectLevel;
  if (d <= eps) level = "none";
  else if (!known) level = "changed";
  else if (d <= NONE * tool!) level = "none";
  else if (d >= FULL * tool!) level = "full";
  else level = "partial";
  return { op, dV, ...(known ? { tool: tool! } : {}), level };
}

/** Typy prvků, které těleso jen upravují – na čistě plošném modelu se od nich objemové těleso nečeká. */
const MODIFY_TYPES = new Set<string>(["fillet", "chamfer", "shell", "draft", "split", "splitBodies", "pattern", "mirror", "pushPull", "offsetFace", "combine", "transform"]);
/** Typy prvků, jejichž výsledkem má být objemové těleso. */
const SOLID_TYPES = new Set<string>(["extrude", "revolve", "sweep", "loft", "box", "cylinder", "sphere", "cone", "tube", "hole", "text", "spring", "thread", "thicken", "rib", "copyBody", ...MODIFY_TYPES]);
const BOOL_MODES = new Set<string>(["new", "add", "cut", "intersect"]);

/**
 * Má být výsledkem prvku objemové těleso? Prvky ploch (karta Plochy – `surf.*` – bez booleovské operace), smazání plochy,
 * import (obsah souboru) a prvky bez geometrie (skica, pomocné roviny) ne. Prvek, který těleso jen upravuje, na čistě
 * plošném modelu také ne. Prvek rozšíření je objemový, když má booleovskou operaci (`mode`), nebo když nepatří na kartu
 * Plochy (`solidExt` – plech, svařence, pružiny, pokročilé prvky; ty bez operace těleso upravují).
 */
export type TypedFeature = { type: Feature["type"] | string; data?: unknown; modeled?: boolean; /** prvek rozšíření mimo kartu Plochy (registr `ExtDef.tab`) */ solidExt?: boolean };
export function expectsSolid(f: TypedFeature, before: Composition | null): boolean {
  if (f.type === "ext") {
    const mode = f.data && typeof f.data === "object" ? (f.data as Record<string, unknown>).mode : undefined;
    if (BOOL_MODES.has(String(mode ?? ""))) return true;
    return !!f.solidExt && !(before && before.solids === 0);
  }
  if (!SOLID_TYPES.has(f.type)) return false;
  if (f.type === "thread" && !f.modeled) return false;
  if (MODIFY_TYPES.has(f.type) && before && before.solids === 0) return false;
  return true;
}

/** popis složení pro hlášku: „2 pláště / 6 volných ploch“ */
const freeText = (c: Composition) => (c.free === 1 ? tr("1 volná plocha") : tr("{0} volných ploch", c.free));

/**
 * Chyba očekávaného typu výsledku (text pro ✗ prvku), nebo `null`. `before` = složení tělesa před prvkem (null = žádné).
 * ✗ když po prvku objemového typu není žádné objemové těleso, nebo když přibyly plochy mimo tělesa.
 */
export function resultTypeError(f: TypedFeature, before: Composition | null, after: Composition): string | null {
  if (!after.faces || !expectsSolid(f, before)) return null;
  if (after.solids === 0) return tr("Prvek má dát objemové těleso, ale výsledek je jen plocha / plášť ({0}, žádné těleso) – uzavřete profil nebo dráhu, zkontrolujte parametry; plochy uzavře Plochy → Uzavřít do tělesa.", freeText(after));
  const was = before?.free ?? 0;
  if (after.free > was) return tr("Prvek má dát objemové těleso, ale vedle tělesa zůstaly volné plochy ({0} navíc) – výsledek není uzavřený; zkontrolujte profil, dráhu a parametry.", after.free - was);
  return null;
}

export type FeatureState = "ok" | "unchecked" | "off" | "warn" | "error";
/**
 * Souhrnný stav prvku: ✗ error (nevznikl) · ⚠ warn (vznikl s výhradou) · ℹ unchecked (vznikl, ale platnost tělesa se
 * nekontrolovala) · ℹ off (potlačený – nestavěl se) · ✓ ok. Prvek bez výsledku stavby stav nemá (`undefined`).
 */
export function featureState(s: Pick<FeatureStatus, "ok" | "warning" | "body" | "suppressed"> | undefined | null): FeatureState | undefined {
  if (!s) return undefined;
  if (s.ok === false) return "error";
  if (s.suppressed) return "off";
  if (s.warning) return "warn";
  if (s.body && s.body.valid === null) return "unchecked";
  return "ok";
}
export const STATE_SYMBOL: Record<FeatureState, string> = { ok: "✓", unchecked: "ℹ", off: "ℹ", warn: "⚠", error: "✗" };

/**
 * Počty prvků podle stavu pro souhrn dokumentu (řádek D `feat=ok/warn/error` + `unchecked=N` + `off=N`, JSON `docs[].features`):
 * prvek, po kterém se platnost tělesa nekontrolovala, ani potlačený prvek (nestavěl se) se mezi ✓ (`ok`) NEPOČÍTÁ – mají
 * vlastní počty `unchecked` / `off`.
 */
export function featureCounts(status: readonly Pick<FeatureStatus, "ok" | "warning" | "body" | "suppressed">[]): { ok: number; warn: number; error: number; unchecked?: number; off?: number } {
  const n = { ok: 0, warn: 0, error: 0, unchecked: 0, off: 0 };
  for (const s of status) n[featureState(s)!]++;
  const { unchecked, off, ...rest } = n;
  return { ...rest, ...(unchecked ? { unchecked } : {}), ...(off ? { off } : {}) };
}

/** objem v mm³ pro text: 3 platné řády za čárkou podle velikosti, bez koncových nul, desetinná čárka (tečka v EN) */
const mm3 = (v: number): string => {
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return "–";
  const d = a >= 100 ? 1 : a >= 1 ? 2 : 4;
  const t = a.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return getLang() === "en" ? t : t.replace(".", ",");
};

/** text účinku: „úběr 352,1 mm³ (99 % nástroje)“, „přidáno 24000 mm³“, „objem beze změny“ */
export function effectText(e: FeatureEffect | undefined): string {
  if (!e) return "";
  if (e.level === "none") return tr("objem beze změny");
  const head = e.dV < 0 ? tr("úběr {0} mm³", mm3(e.dV)) : tr("přidáno {0} mm³", mm3(e.dV));
  if (e.level === "full" && e.op !== "new") return tr("{0} (celý nástroj)", head);
  if (e.level === "partial" && e.tool) {
    const p = (Math.abs(e.dV) / e.tool) * 100;
    return tr("{0} ({1} % nástroje)", head, p < 1 ? "<1" : p > 99 ? ">99" : String(Math.round(p)));
  }
  return head;
}

/** důvod nezkontrolované platnosti (s čísly) */
export function uncheckedText(b: Pick<BodyCheck, "why" | "faces">): string {
  if (b.why === "feature-faces") return tr("{0} ploch > {1} – platnost se ověří na konci stavby", b.faces, FEATURE_CHECK_FACES);
  if (b.why === "feature-none") return tr("po tomto prvku se platnost nekontroluje – ověří se na konci stavby");
  if (b.why === "final-faces") return tr("{0} ploch > {1}", b.faces, FINAL_CHECK_FACES);
  if (b.why === "approx") return tr("velké těleso, {0} ploch – měřeno ze sítě, platnost se nekontroluje", b.faces);
  return tr("kontrola se neprovedla");
}

/** text úrovně konečného tělesa: „těleso platné“, „2 tělesa, platná“, „těleso nezkontrolováno (468 ploch > 400 …)“ */
export function bodyText(b: BodyCheck | undefined): string {
  return bodyTextOf(b);
}
function bodyTextOf(b: BodyCheck | undefined): string {
  if (!b) return "";
  if (!b.solids) return tr("žádné objemové těleso");
  const many = b.solids > 1;
  const free = b.free > 0 ? ` + ${b.free === 1 ? tr("1 volná plocha") : tr("{0} volných ploch", b.free)}` : "";
  if (free) return `${bodyTextOf({ ...b, free: 0 })}${free}`;
  if (b.valid === null) return (many ? tr("{0} těles, platnost nezkontrolována ({1})", b.solids, uncheckedText(b)) : tr("těleso nezkontrolováno ({0})", uncheckedText(b)));
  if (b.valid === false) return many ? tr("{0} těles, NEPLATNÁ geometrie", b.solids) : tr("těleso NEPLATNÉ");
  return many ? tr("{0} těles, platná", b.solids) : tr("těleso platné");
}

/** úrovně prvku jedním řádkem za stavem: „úběr 352,1 mm³ (99 % nástroje) · těleso platné“ (prázdné u prvku bez tělesa) */
export function levelsText(s: Pick<FeatureStatus, "ok" | "effect" | "body" | "suppressed"> | undefined | null): string {
  if (!s || s.ok === false) return "";
  if (s.suppressed) return tr("potlačen – nestaví se");
  return [effectText(s.effect), bodyText(s.body)].filter(Boolean).join(" · ");
}

export type LevelsData = {
  built: boolean;
  /** potlačený prvek (nestavěl se) */
  suppressed?: true;
  effect?: { op: EffectOp; level: EffectLevel; dV_mm3: number; tool_mm3?: number; expected_mm3?: number };
  body?: { solids: number; free: number; valid: boolean | "unchecked"; why?: BodyUnchecked };
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** strojová podoba úrovní prvku (JSON `entries[].data.levels`, stejná v cs/en/de) */
export function levelsData(s: Pick<FeatureStatus, "ok" | "effect" | "body" | "suppressed">): LevelsData {
  if (s.suppressed && s.ok !== false) return { built: false, suppressed: true };
  const out: LevelsData = { built: s.ok !== false };
  if (s.ok === false) return out;
  if (s.effect) out.effect = { op: s.effect.op, level: s.effect.level, dV_mm3: r4(s.effect.dV), ...(s.effect.tool !== undefined ? { tool_mm3: r4(s.effect.tool) } : {}), ...(s.effect.expected !== undefined ? { expected_mm3: r4(s.effect.expected) } : {}) };
  if (s.body) out.body = { solids: s.body.solids, free: s.body.free, valid: s.body.valid === null ? "unchecked" : s.body.valid, ...(s.body.valid === null && s.body.why ? { why: s.body.why } : {}) };
  return out;
}

export type FinalCheck = { valid?: boolean; faces: number; approx?: boolean };
/**
 * Závěrečná kontrola tělesa doplní úroveň „konečné těleso“ prvkům, u kterých se po prvku nekontrolovala (`valid: null`):
 * platné těleso na konci → platné po každém takovém prvku (neplatnost by zůstala); neplatné → prvky od původce vady nesou
 * varování (`flagInvalidBody`) a jsou neplatné, prvky před ním platné; kontrola se neprovedla → zůstává `null` s důvodem.
 * Vrací nové pole stavů (uložené stavy stavby se nemění).
 */
export function settleBodyChecks(status: readonly FeatureStatus[], final: FinalCheck, invalidLead?: string): FeatureStatus[] {
  let bad = false;
  return status.map((s) => {
    if (invalidLead && s.warning?.includes(invalidLead)) bad = true;
    if (!s.body || s.body.valid !== null) return s;
    if (final.valid === undefined) return { ...s, body: { ...s.body, why: final.approx ? ("approx" as const) : ("final-faces" as const), faces: final.faces } };
    const { why: _why, ...rest } = s.body;
    void _why;
    return { ...s, body: { ...rest, valid: final.valid ? true : !bad } };
  });
}

/** řádek „Geometrie“ textového stavu – kontrola, která se neprovedla, se vypíše jako „nezkontrolováno“ s důvodem */
export function geometryText(m: { valid?: boolean; solids?: number; faces: number; approx?: boolean; validCheck?: "fast" | "exact" }): string {
  const bodies = m.solids ? ` · ${m.solids === 1 ? tr("1 těleso") : tr("{0} těles", m.solids)}` : "";
  // která kontrola platnost určila (vlna 22, bod 22a): rychlá po stavbě, nebo přesná (kontrola přesně, export) – na konci řádku
  const how = ` · ${m.validCheck === "exact" ? tr("přesná kontrola") : tr("rychlá kontrola")}`;
  if (m.solids === 0) return tr("ŽÁDNÉ objemové těleso (jen plochy) – export STEP nedá solid");
  if (m.valid === false) return tr("NEPLATNÁ (sebeprotínající nebo neorientovatelné plochy) – export STEP může selhat; opravte prvek označený ⚠") + bodies + how;
  if (m.valid === undefined) return tr("nezkontrolováno ({0})", uncheckedText({ why: m.approx ? "approx" : "final-faces", faces: m.faces })) + bodies;
  return tr("platná") + bodies + how;
}
