/**
 * Dokument pro výkres: závity se na výkrese kreslí zjednodušeně (ISO 6410) – kružnice válce / jádra s označením závitu,
 * ne skutečná šroubovice. Modelovaný závit (tažení po šroubovici s profilem Závit 60°, drážky prvku Závit) se proto
 * pro výkres potlačí: zůstane hladký válec / díra a označení (M18×1,5) přidá `threadsOfDoc`.
 * Přesná projekce (HLR) šroubovicových ploch v jádře trvá minuty – to byl důvod „zaseknutého“ výkresu i exportu PDF.
 *
 * Pružiny (prvek Pružina, normálie pružin, Tažení po šroubovici s profilem Kruh, tlačná pružina z tabulky `spring.compression`
 * – nové těleso, nebo první materiál tělesa; i jako komponenty sestavy a v podsestavách) se kreslí zjednodušeně podle ISO 2162-1: obrys vinutí (vnější a vnitřní průměr
 * přes celou volnou délku – `springEnvelopeDims`), osa pružiny a čerchované osy drátu na středním průměru (`springMarksOf`,
 * kreslí je `makeDrawing` v pohledech i v řezu; řez obal nešrafuje). Které šroubovice jsou pružiny, určuje `drawnSpringIndices`:
 * šroubovice přidaná na existující těleso je závit nebo šnek (normálie šnek, oblý závit na hřídeli) a kreslí se přesně.
 * Volba listu `springs: "full"` (`výkres pružiny plně`) kreslí skutečnou šroubovici. Šroubovicová drážka (odebrání)
 * zůstává vždy přesná – není to pružina. Chytré kóty čtou i u zjednodušeného listu skutečný tvar (kernel-ops.ts).
 */
import { flattenAssembly, transformPoint } from "./assembly";
import { DEFAULT_BODY, isNewBodyMode } from "./bodies";
import { threadByName } from "./defaults";
import { threadOfFeature } from "./thread-spec";
import { holeDrillD } from "./hole-spec";
import { tr } from "./i18n";
import { placementOf } from "./placements";
import type { Direction, Ref } from "./refs";
import { readCompression, springAxisOf } from "./springs";
import type { Axis, CadDoc, ComponentSource, Feature, Vec3 } from "./types";

/** Kreslení pružin na výkrese: zjednodušeně podle ISO 2162-1 (výchozí), nebo plným tvarem šroubovice. */
export type SpringDraw = "simple" | "full";
type SpringF = Extract<Feature, { type: "spring" }>;
type ExtF = Extract<Feature, { type: "ext" }>;

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Je prvek modelovaný závit, který se na výkrese nahradí zjednodušenou značkou? */
export function isModeledThread(f: Feature): boolean {
  if (f.suppressed) return false;
  if (f.type === "thread") return !!f.modeled;
  if (f.type === "ext" && f.ext === "surf.helixSweep") return f.data?.profile === "thread60";
  return false;
}

/**
 * Rozměry obalu vinutí pružiny (vztaženo k ose od začátku šroubovice): vnější a vnitřní poloměr a rozsah podél osy. Průřez
 * drátu je kolmý na šroubovici, krajní body obou konců proto leží (d/2)·cos α před začátkem a za koncem (α = úhel stoupání).
 */
export function springEnvelopeDims(f: { radius: number; pitch: number; turns: number; wire: number }): { ro: number; ri: number; from: number; len: number } {
  const c = 2 * Math.PI * f.radius;
  const e = (f.wire / 2) * (c / Math.hypot(c, f.pitch));
  return { ro: f.radius + f.wire / 2, ri: f.radius - f.wire / 2, from: -e, len: f.pitch * f.turns + 2 * e };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const addsBody = (mode: unknown) => mode === "add" || mode === "new";

/** Tažení po šroubovici s profilem Kruh (drát), které přidává materiál nebo tvoří těleso. */
function isHelixWire(f: Feature): f is ExtF {
  return f.type === "ext" && f.ext === "surf.helixSweep" && (f.data?.profile ?? "circle") === "circle" && addsBody(f.data?.mode ?? "add");
}
/** tlačná pružina z tabulky (`spring.compression`, vlna 21) s osou bez odkazu na geometrii, která přidává materiál / tvoří těleso */
function isTableSpring(f: Feature): boolean {
  return f.type === "ext" && f.ext === "spring.compression" && addsBody(f.data?.mode ?? "new") && !f.data?.atRef && springAxisOf(f.data ?? {}) !== null;
}
/** šroubovice s kruhovým průřezem, která přidává materiál (pružina, šnek, oblý závit – co z toho, rozhodne těleso) */
const isHelixCandidate = (f: Feature) => (f.type === "spring" && addsBody(f.mode) && !isSpringEnvelope(f)) || isHelixWire(f) || isTableSpring(f);
/** operace prvku (přidat / odebrat / …); prvky bez operace (zaoblení, přesun, pole…) těleso mění jinak */
const modeOf = (f: Feature): unknown => {
  if (f.type === "ext") return f.ext === "surf.helixSweep" ? (f.data?.mode ?? "add") : f.data?.mode;
  return "mode" in f ? f.mode : undefined;
};
const NO_GEOMETRY = new Set<Feature["type"]>(["sketch", "datum", "datumAxis", "datumPoint", "csys"]);

/**
 * Indexy prvků, které výkres (při `springs: "simple"`) kreslí zjednodušeně jako pružinu: prvek Pružina nebo Tažení po
 * šroubovici s profilem Kruh, který přidává materiál do tělesa, ve kterém před ním ještě nic není (normálie pružiny,
 * `pružina …` jako první prvek dílu, `… nové těleso "Pružina"`); těleso pak smí už jen odebírat (zabroušené konce) nebo
 * přidat jiný tvar (očka tažné pružiny, ramena zkrutné).
 * Šroubovice přidaná na existující těleso je závit, šnek nebo vinutí na dílu (normálie šnek – chod na jádře, oblý závit
 * na hřídeli, pružina přidaná do pouzdra): obal vinutí by zakryl skutečný tvar a Chytré kóty by kótovaly neexistující
 * díru, proto se kreslí přesně. Totéž, když se těleso pružiny později přesune, zaoblí, zkopíruje, zrcadlí, sloučí nebo
 * dostane druhou šroubovici (obal by se s tím nesešel). Pravidla těles jako `bodies.ts` / `build.ts`.
 */
export function drawnSpringIndices(doc: Pick<CadDoc, "features">): Set<number> {
  const out = new Set<number>();
  let active = DEFAULT_BODY;
  const filled = new Set<string>(); // tělesa, ve kterých už je materiál
  const known = new Set<string>([DEFAULT_BODY]);
  const springsIn = new Map<string, number[]>(); // těleso → pružiny v něm
  const spoil = (body: string | undefined) => {
    for (const j of (body && springsIn.get(body)) || []) out.delete(j);
  };
  doc.features.forEach((f, i) => {
    if (f.suppressed) return;
    if (f.body && f.body !== active) {
      if (known.has(f.body)) active = f.body;
      else if (!filled.has(active)) {
        known.delete(active); // první těleso dostane vlastní název
        known.add(f.body);
        active = f.body;
      } else if (isNewBodyMode(f)) {
        known.add(f.body);
        active = f.body;
      } else return; // neexistující těleso – stavba prvek odmítne
    }
    if (NO_GEOMETRY.has(f.type)) return;
    if (isHelixCandidate(f) && !filled.has(active)) {
      out.add(i);
      springsIn.set(active, [...(springsIn.get(active) ?? []), i]);
    } else {
      // na tělese pružiny smí být už jen odebrání (zabroušené konce) a přidání jiného tvaru (očka, ramena normálií);
      // druhá šroubovice, přesun, zaoblení, pole, zrcadlení… by se s obalem nesešly
      const m = modeOf(f);
      if (m !== "cut" && m !== "intersect" && !(addsBody(m) && !isHelixCandidate(f))) spoil(active);
    }
    if (f.type === "combine") {
      spoil(f.target?.trim() || active);
      spoil(f.tool?.trim());
    }
    if (f.type === "splitBodies") {
      const b = f.nameB?.trim();
      if (b) {
        known.add(b);
        filled.add(b);
      }
    } else if (f.type === "copyBody") {
      spoil(f.source?.trim() || active);
      const b = f.newName?.trim();
      if (b) {
        known.add(b);
        filled.add(b);
      }
    }
    filled.add(active);
  });
  return out;
}

/** Kreslí výkres prvek `i` dokumentu zjednodušeně jako pružinu? (viz `drawnSpringIndices`) */
export const isDrawnSpring = (doc: Pick<CadDoc, "features">, i: number): boolean => drawnSpringIndices(doc).has(i);

/**
 * Značka kopie prvku Pružina pro výkres (obal vinutí místo šroubovice – `springEnvelope`). Hodnota je náhodná pro každý běh
 * programu: dokument, řádek JSON ani sdílený odkaz ji nezadá, takže skutečný model se jí nikdy nezmění (jen kopie z `drawingDoc`).
 */
const ENVELOPE_KEY = "drawingEnvelope";
const ENVELOPE_TOKEN = `w${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
/** Je prvek zjednodušená pružina z `drawingDoc` (stavitel prvku Pružina pak postaví obal vinutí)? */
export const isSpringEnvelope = (f: Feature): boolean => (f as unknown as Record<string, unknown>)[ENVELOPE_KEY] === ENVELOPE_TOKEN;
const asEnvelope = (f: SpringF): Feature => ({ ...f, [ENVELOPE_KEY]: ENVELOPE_TOKEN }) as Feature;

/** osa Tažení po šroubovici (`axis` = Direction nebo starší zápis „Z“ / „-X“ / [x, y, z]) → osa a směr prvku Pružina */
function helixAxis(v: unknown): { axis: Axis; dirDef?: Direction } | null {
  if (v == null || v === "") return { axis: "Z" };
  if (typeof v === "string") {
    const m = /^\s*([+\-−]?)\s*([XYZ])\s*$/i.exec(v);
    if (!m) return /^(normal|normála|normala|kolmo)$/i.test(v.trim()) ? { axis: "Z" } : null;
    const axis = m[2].toUpperCase() as Axis;
    if (!m[1] || m[1] === "+") return { axis };
    const w: Vec3 = [0, 0, 0];
    w["XYZ".indexOf(axis)] = -1;
    return { axis: "Z", dirDef: { kind: "vector", v: w } };
  }
  if (Array.isArray(v)) return v.length >= 3 && v.slice(0, 3).every(isNum) ? { axis: "Z", dirDef: { kind: "vector", v: [v[0], v[1], v[2]] } } : null;
  if (typeof v !== "object") return null;
  const d = v as Direction;
  if (d.kind === "axis") return ["X", "Y", "Z"].includes(d.axis) ? { axis: d.axis } : null;
  if (d.kind === "normal") return { axis: "Z" };
  if (d.kind === "vector") return Array.isArray(d.v) && d.v.length >= 3 && d.v.slice(0, 3).every(isNum) ? { axis: "Z", dirDef: d } : null;
  return d.kind === "edge" || d.kind === "twoPoints" || d.kind === "faceNormal" || d.kind === "tangent" ? { axis: "Z", dirDef: d } : null;
}

/**
 * Obal tlačné pružiny z tabulky: prvek Pružina se značkou obalu, jehož obal (`springEnvelopeDims`) leží přesně mezi koncovými
 * rovinami pružiny 0 a L (délka tvaru `len`, jinak L0) a má průměry De / Di z výpočtu (`@/cad/springs`). Poloha a osa z dat
 * prvku (bod `at`, osa X / Y / Z / vektor); osa odkazem → null (plný tvar).
 */
function tableEnvelope(f: ExtF): Feature | null {
  const i = readCompression(f.data ?? {});
  const ax = springAxisOf(f.data ?? {});
  if (!ax || !(i.d > 0 && i.D > i.d && i.n > 0 && i.L0 > 0)) return null;
  const L = typeof f.data?.len === "number" && f.data.len > 0 ? f.data.len : i.L0;
  const nt = i.ends === "open" ? i.n : i.n + 2;
  const R = i.D / 2;
  // stoupání p a přesah konců e = (d/2)·cos α (springEnvelopeDims) tak, aby obal byl 0 … L: p·nt + 2e = L
  let p = Math.max(1e-3, (L - i.d) / nt);
  let e = i.d / 2;
  for (let k = 0; k < 6; k++) {
    e = springEnvelopeDims({ radius: R, pitch: p, turns: nt, wire: i.d }).len / 2 - (p * nt) / 2;
    p = Math.max(1e-3, (L - 2 * e) / nt);
  }
  const at = Array.isArray(f.data?.at) ? (f.data.at as unknown[]).slice(0, 3).map((x) => Number(x) || 0) : [0, 0, 0];
  const position: Vec3 = [at[0] + ax[0] * e, at[1] + ax[1] * e, at[2] + ax[2] * e];
  const z = ax[2] > 1 - 1e-12;
  const sp: SpringF = { id: f.id, name: f.name, ...(f.body ? { body: f.body } : {}), type: "spring", radius: R, pitch: p, turns: nt, wire: i.d, position, mode: f.data?.mode === "add" ? "add" : "new", axis: "Z", ...(z ? {} : { dirDef: { kind: "vector", v: ax } }) };
  return asEnvelope(sp);
}

/** Zjednodušená pružina pro výkres: tentýž prvek (id, těleso, poloha, osa) s obalem vinutí; null = nelze (zůstane plný tvar). */
function envelopeOf(f: Feature): Feature | null {
  if (f.type === "spring") return asEnvelope(f);
  if (isTableSpring(f)) return tableEnvelope(f as ExtF);
  if (!isHelixWire(f)) return null;
  const d = f.data;
  const [radius, pitch, turns, wire] = [d.radius, d.pitch, d.turns, d.wire].map(Number);
  const ax = helixAxis(d.axis);
  if (!ax || ![radius, pitch, turns, wire].every((x) => x > 0)) return null;
  const pos = Array.isArray(d.position) && d.position.length >= 3 ? (d.position.slice(0, 3).map((x) => Number(x) || 0) as Vec3) : ([0, 0, 0] as Vec3);
  const ref = d.positionRef && typeof d.positionRef === "object" ? { positionRef: d.positionRef as Ref } : {};
  const sp: SpringF = { id: f.id, name: f.name, ...(f.body ? { body: f.body } : {}), type: "spring", radius, pitch, turns, wire, position: pos, mode: d.mode === "new" ? "new" : "add", ...ax, ...ref };
  return asEnvelope(sp);
}

/** Zdroj komponenty pro výkres (díl / podsestava rekurzivně); beze změny vrátí původní objekt. */
export function drawingSource(s: ComponentSource, springs: SpringDraw = "simple", depth = 0): ComponentSource {
  if (s.kind === "file") return s;
  const doc = drawingDoc(s.doc, springs, depth);
  return doc === s.doc ? s : { ...s, doc };
}

/**
 * Kopie dokumentu pro stavbu tělesa výkresu: potlačené modelované závity a (při `springs: "simple"`) pružiny jako obal vinutí,
 * u sestavy totéž v dílech komponent i v podsestavách. Beze změny vrátí původní objekt.
 */
export function drawingDoc(doc: CadDoc, springs: SpringDraw = "simple", depth = 0): CadDoc {
  let out = doc;
  const drawn = springs !== "full" ? drawnSpringIndices(doc) : new Set<number>();
  if (drawn.size || doc.features.some(isModeledThread)) {
    out = { ...doc, features: doc.features.map((f, i) => (isModeledThread(f) ? { ...f, suppressed: true } : drawn.has(i) ? (envelopeOf(f) ?? f) : f)) };
  }
  // podsestavy (zanoření omezené jako u stavby sestavy – cyklus jádro odmítne samo)
  if (doc.components?.length && depth <= 16) {
    let changed = false;
    const components = doc.components.map((c) => {
      const src = drawingSource(c.source, springs, depth + 1);
      if (src === c.source) return c;
      changed = true;
      return { ...c, source: src };
    });
    if (changed) out = { ...out, components };
  }
  return out;
}

/** Má dokument (díl, komponenty sestavy, podsestavy) pružinu, kterou výkres kreslí zjednodušeně? */
export function hasDrawnSprings(doc: CadDoc, depth = 0): boolean {
  if (depth > 16) return false;
  if (drawnSpringIndices(doc).size) return true;
  return (doc.components ?? []).some((c) => c.source.kind !== "file" && hasDrawnSprings(c.source.doc, depth + 1));
}

/**
 * Zjednodušená pružina na listu: osa vinutí od začátku obalu `p` ve směru `a` (jednotkový) v délce `len`, střední poloměr
 * drátu `r`, vnější a vnitřní poloměr obalu `ro` / `ri` (souřadnice tělesa výkresu; u sestavy světové).
 */
export type SpringMark = { p: Vec3; a: Vec3; len: number; r: number; ro: number; ri: number };

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * pružiny dokumentu pro výkres (už po `drawingDoc`): obaly prvků Pružina v souřadnicích dílu (těleso pružiny se po ní už
 * nepřesouvá ani nekopíruje – `drawnSpringIndices`)
 */
function partMarks(doc: CadDoc): SpringMark[] {
  const out: SpringMark[] = [];
  doc.features.forEach((f) => {
    if (f.suppressed || f.type !== "spring" || !isSpringEnvelope(f)) return;
    const pl = placementOf(f);
    if (!pl || !(f.radius > 0 && f.wire > 0 && f.pitch > 0 && f.turns > 0)) return;
    const e = springEnvelopeDims(f);
    const a = unit3(pl.dir);
    out.push({ p: [pl.position[0] + a[0] * e.from, pl.position[1] + a[1] * e.from, pl.position[2] + a[2] * e.from], a, len: e.len, r: f.radius, ro: e.ro, ri: e.ri });
  });
  return out;
}

/**
 * Osy zjednodušených pružin pro `makeDrawing` (`DrawingMeta.springs`) – z dokumentu po `drawingDoc` a po stavbě (poloha
 * zadaná odkazem se bere z placements.ts). U sestavy pružiny všech viditelných dílů v jejich umístění.
 */
export function springMarksOf(doc: CadDoc): SpringMark[] {
  if (doc.kind !== "assembly") return partMarks(doc);
  const out: SpringMark[] = [];
  const memo = new Map<CadDoc, SpringMark[]>();
  for (const leaf of flattenAssembly(doc)) {
    if (leaf.hidden || leaf.comp.source.kind !== "part") continue;
    const src = leaf.comp.source.doc;
    let ms = memo.get(src);
    if (!ms) memo.set(src, (ms = partMarks(src)));
    for (const m of ms) {
      const p = transformPoint(leaf.placement, m.p);
      const a = unit3(sub3(transformPoint(leaf.placement, [m.p[0] + m.a[0], m.p[1] + m.a[1], m.p[2] + m.a[2]]), p));
      out.push({ ...m, p, a });
    }
  }
  return out;
}

/** Označení závitů pro kótování kružnic (poloměr válce / jádra → text místo Ø). */
export function threadsOfDoc(doc: CadDoc): { r: number; label: string }[] {
  const out: { r: number; label: string; derived?: boolean }[] = [];
  for (const f of doc.features) {
    if (f.suppressed) continue;
    // katalogový závit: prvek Závit (kosmetický, drážky, šroubovice) i Tažení po šroubovici s označením `thread=` – stejně (22d)
    const th = threadOfFeature(f);
    if (th) {
      out.push({ r: (th.internal ? th.t.tap : th.t.d) / 2, label: `${th.designation}${th.length > 0 ? ` dl. ${fmt(th.length)}` : ""}` });
    } else if (f.type === "hole" && f.kind === "tapped" && f.thread) {
      const t = threadByName(f.thread);
      if (t) out.push({ r: holeDrillD(f) / 2, label: `${t.name}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : ""}` }); // vrták podle volby (hole-spec.ts)
    } else if (f.type === "ext" && f.ext === "surf.helixSweep" && f.data?.profile === "thread60") {
      const d = f.data;
      const R = typeof d.radius === "number" ? d.radius : 0;
      const h = typeof d.depth === "number" ? d.depth : 0;
      const p = typeof d.pitch === "number" ? d.pitch : 0;
      if (!(R > 0 && p > 0)) continue;
      const internal = d.side === "internal";
      const removing = d.mode === "cut" || d.mode === "intersect";
      // velký průměr: vnitřní odebrání / vnější přidání jdou od R ven (R + h), jinak je R sám velký poloměr
      const major = 2 * ((internal ? removing : !removing) ? R + h : R);
      const length = typeof d.turns === "number" ? d.turns * p : 0;
      out.push({ r: R, label: `M${fmt(major)}×${fmt(p)}${length > 0 ? ` dl. ${fmt(length)}` : ""}`, derived: true });
    }
  }
  // katalogové označení (prvek Závit, závitová díra) má přednost před označením odvozeným z geometrie šroubovice
  return out.sort((a, b) => Number(!!a.derived) - Number(!!b.derived)).map(({ r, label }) => ({ r, label }));
}

/** Poznámky výkresu k plechu: křížový zlom (úhlopříčky panelu se na výkrese kreslí jako hrany modelu, popis do poznámky). */
export function formNotesOfDoc(doc: CadDoc): string[] {
  return doc.features
    .filter((f): f is Extract<Feature, { type: "ext" }> => f.type === "ext" && f.ext === "sheet.crossbreak" && !f.suppressed)
    .map((f) => tr("KŘÍŽOVÝ ZLOM {0}° {1} ({2})", fmt(typeof f.data?.angle === "number" ? f.data.angle : 1.5), f.data?.direction === "down" ? tr("dolů") : tr("nahoru"), f.name));
}
