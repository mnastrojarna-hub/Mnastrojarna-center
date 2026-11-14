/**
 * Příprava dokumentu pro `docToScript` (doc-script.ts) s pomocí jádra – to, co čistý převodník bez jádra ověřit neumí:
 *
 *  1. ČÍSLA HRAN / PLOCH / VRCHOLŮ. Výběr prvku je uložen jako indexy s otisky (`edges` + `edgeSigs`, `ref.sig`). Po úpravě
 *     historie (prvek přesunutý nebo vložený před výběr) uložená čísla neplatí a aplikace entity hledá podle otisku. Skript
 *     s uloženými čísly by pak po přečtení dal jinou geometrii – u hran tiše. Jádro proto pro každý prvek s otisky najde
 *     entity na tělese PŘED prvkem stejným kódem jako stavba (`stampPicks` / `SigTable.resolve`) a do kopie dokumentu zapíše
 *     jejich aktuální čísla; ověřené otisky se odstraní (aplikace je při přečtení skriptu orazítkuje znovu). Prvek, jehož
 *     entitu jádro nenašlo, si otisky nechá – převodník ho zapíše i s nimi (obecný příkaz / JSON), přesně jako je uložen.
 *  2. SMAZANÉ VYGENEROVANÉ KÓTY listů výkresu (`options.smartOff` = klíče generátoru). Po „kótovat chytře“ by se vrátily;
 *     smazat je jde jen podle id (a3, a8) v seznamu, který generátor vydá – jádro ho spočítá a vrátí id pro `výkres smazat …`.
 *
 * Bez prohlížeče: jádro se předává jako rozhraní (`cad.pickSigs`, `cad.drawing` v aplikaci; zkušební stroj v testech).
 */
import { sheetUnsupported } from "./doc-script";
import { sheetMeta, sheetOptions } from "./drawing-agent";
import type { DrawingMeta, DrawingOptions } from "./drawing";
import { tr } from "./i18n";
import { getPath, pickFieldsOf, pickSigs, withPath } from "./pick-fields";
import type { Sig } from "./refs";
import type { CadDoc, Feature } from "./types";

export type ScriptKernel = {
  /** otisky a aktuální indexy výběru prvku nad dokumentem oříznutým před prvek – `cad.pickSigs` (pick-sigs.ts `stampPicks`) */
  pickSigs: (before: CadDoc, feature: Feature) => Promise<{ feature: Feature; changed: boolean; warnings: string[] } | null>;
  /** výkres listu s Chytrými kótami – `cad.drawing`; bez něj se smazané vygenerované kóty jen ohlásí */
  drawing?: (doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>) => Promise<{ smart?: { annotations: { auto?: string }[] } }>;
};
export type FreshScriptDoc = {
  /** kopie dokumentu: ověřené výběry mají aktuální čísla a jsou bez otisků */
  doc: CadDoc;
  /** id listu → id smazaných vygenerovaných kót po „kótovat chytře“ (volba `deletedDims` převodníku) */
  deletedDims: Record<string, string[]>;
  /** co se ověřit nepodařilo */
  notes: string[];
  stats: { /** prvky s otisky */ checked: number; /** prvky, kterým se čísla změnila */ renumbered: number; /** prvky s nenalezenou entitou */ lost: number; /** listy se smazanými kótami */ sheets: number; ms: number };
};

type Rec = Record<string, unknown>;
type EntKind = "face" | "edge" | "vertex";
type SigRef = { kind: EntKind; index: number; sig?: Sig };
const isSig = (s: unknown): s is Sig => !!s && typeof s === "object" && "t" in (s as Rec) && "c" in (s as Rec);
/** odkazy na plochu / hranu / vrchol s otiskem kdekoli v prvku (`planeDef.ref`, `faceRef`, `positionRef`, `extent.ref`…) */
function sigRefs(f: Feature): SigRef[] {
  const out: SigRef[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Rec;
    if ((o.kind === "face" || o.kind === "edge" || o.kind === "vertex") && typeof o.index === "number" && isSig(o.sig)) out.push(o as unknown as SigRef);
    for (const [k, x] of Object.entries(o)) if (!/Sigs\d?$/.test(k) && k !== "sig") walk(x);
  };
  for (const [k, v] of Object.entries(f)) if (k !== "id" && k !== "name" && k !== "type" && k !== "entities" && k !== "constraints" && k !== "dims") walk(v);
  return out;
}
/** pomocný prvek s jedním vybraným indexem – jádro jím najde entitu podle otisku (bez počtu `n` = stejné pravidlo jako u odkazů stavby) */
function probe(kind: EntKind, index: number, sig: Sig): Feature {
  const s: Sig = { t: sig.t, c: sig.c, s: sig.s, ...(sig.r !== undefined ? { r: sig.r } : {}) };
  const base = { id: "\u0004probe", name: "probe" };
  if (kind === "face") return { ...base, type: "shell", thickness: 1, faces: [index], faceSigs: { [index]: s } } as unknown as Feature;
  if (kind === "edge") return { ...base, type: "fillet", radius: 1, edges: [index], edgeSigs: { [index]: s } } as unknown as Feature;
  return { ...base, type: "chamfer", distance: 1, edges: [], vertices: [index], vertexSigs: { [index]: s } } as unknown as Feature;
}
const probeIndex = (f: Feature, kind: EntKind): unknown => ((f as unknown as Rec)[kind === "face" ? "faces" : kind === "edge" ? "edges" : "vertices"] as unknown[] | undefined)?.[0];

/** jeden díl: čísla výběrů podle otisků; vrátí týž objekt, když se nic neměnilo */
async function freshPart(doc: CadDoc, k: ScriptKernel, out: FreshScriptDoc): Promise<CadDoc> {
  const feats = [...doc.features];
  let changed = false;
  for (let i = 0; i < feats.length; i++) {
    const f0 = feats[i];
    const fields = pickFieldsOf(f0).filter((fd) => Object.keys(pickSigs(f0, fd)).length);
    const refs = sigRefs(f0);
    if (!fields.length && !refs.length) continue;
    out.stats.checked++;
    // těleso před prvkem tak, jak ho staví aplikace (původní prvky, cílové těleso prvku)
    const before: CadDoc = { ...doc, features: doc.features.slice(0, i), activeBody: f0.body ?? doc.activeBody };
    let f = f0;
    let lost = false;
    if (fields.length) {
      const res = await k.pickSigs(before, f0).catch(() => null);
      if (res && !res.warnings.length) {
        f = res.feature;
        for (const fd of pickFieldsOf(f)) f = withPath(f, fd.sigPath, undefined);
      } else lost = true;
    }
    if (refs.length && !lost) {
      const g = JSON.parse(JSON.stringify(f)) as Feature;
      for (const r of sigRefs(g)) {
        const res = r.index >= 0 ? await k.pickSigs(before, probe(r.kind, r.index, r.sig!)).catch(() => null) : null;
        const j = res && !res.warnings.length ? probeIndex(res.feature, r.kind) : undefined;
        if (typeof j === "number") {
          r.index = j;
          delete r.sig;
        } else lost = true;
      }
      if (!lost) f = g;
    }
    if (lost) {
      // entita se nenašla (nebo díl před prvkem nemá těleso): prvek zůstává přesně jak je uložen, i s otisky
      out.stats.lost++;
      out.notes.push(tr("prvek „{0}“ dílu „{1}“: vybranou hranu / plochu se podle otisku nepodařilo najít – prvek je ve skriptu zapsán i s otisky", f0.name, doc.name));
      continue;
    }
    const nums = (x: Feature) => JSON.stringify([pickFieldsOf(x).map((fd) => getPath(x, fd.path) ?? null), refIndices(x)]);
    if (nums(f) !== nums(f0)) out.stats.renumbered++;
    feats[i] = f;
    changed = true;
  }
  const next = changed ? { ...doc, features: feats } : doc;
  // smazané vygenerované kóty: id v seznamu, který „kótovat chytře“ vydá (počítá se nad původním dílem – geometrie je stejná)
  if (k.drawing) {
    const sheets = doc.drawings ?? [];
    for (let si = 0; si < sheets.length; si++) {
      const s = sheets[si];
      const o = (s.options ?? {}) as Rec;
      const off = Array.isArray(o.smartOff) ? (o.smartOff as unknown[]).filter((x): x is string => typeof x === "string") : [];
      // list s volbami, které skript nepřenese (pomocné pohledy, detaily…), by po přečtení vygeneroval jiný seznam kót → id by neseděla
      if (!off.length || o.dimensions !== "smart" || sheetUnsupported(o).length) continue;
      out.stats.sheets++;
      try {
        const res = await k.drawing(doc, sheetMeta(doc, s, si), { ...sheetOptions(s), dimensions: "smart" });
        const ann = res.smart?.annotations ?? [];
        const ids = [...new Set(off.map((key) => ann.findIndex((a) => a.auto === key)).filter((j) => j >= 0))].sort((a, b) => a - b).map((j) => `a${j + 1}`);
        if (ids.length) out.deletedDims[s.id] = ids;
        if (ids.length < off.length) out.notes.push(tr("list „{0}“ dílu „{1}“: {2} ze {3} smazaných vygenerovaných kót generátor už nevydává – ve skriptu nejsou", s.name, doc.name, off.length - ids.length, off.length));
      } catch (e) {
        out.notes.push(tr("list „{0}“ dílu „{1}“: smazané vygenerované kóty se nepodařilo určit ({2}) – po přečtení skriptu se vrátí", s.name, doc.name, e instanceof Error ? e.message : String(e)));
      }
    }
  }
  return next;
}
/** čísla jednotlivých odkazů prvku (plocha / hrana / vrchol) v pořadí průchodu */
function refIndices(f: Feature): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Rec;
    if ((o.kind === "face" || o.kind === "edge" || o.kind === "vertex") && typeof o.index === "number") out.push(o.index);
    for (const [k, x] of Object.entries(o)) if (!/Sigs\d?$/.test(k) && k !== "sig") walk(x);
  };
  walk(f);
  return out;
}
/**
 * Dokument připravený pro `docToScript`: díl, nebo sestava (každý jedinečný díl komponent jednou). Dokument se nemění –
 * vrací se kopie dotčených částí. 2D výkres a sestava bez dílů projdou beze změny.
 */
export async function freshScriptDoc(doc: CadDoc, k: ScriptKernel): Promise<FreshScriptDoc> {
  const t0 = Date.now();
  const out: FreshScriptDoc = { doc, deletedDims: {}, notes: [], stats: { checked: 0, renumbered: 0, lost: 0, sheets: 0, ms: 0 } };
  const kind = doc.kind ?? "part";
  if (kind === "part") out.doc = await freshPart(doc, k, out);
  else if (kind === "assembly") {
    // stejný díl ve více komponentách (stejný obsah) se ověří jednou
    const done = new Map<string, CadDoc>();
    const comps = [];
    let changed = false;
    for (const cp of doc.components ?? []) {
      if (cp.source.kind !== "part") {
        comps.push(cp);
        continue;
      }
      const key = JSON.stringify(cp.source.doc);
      let fresh = done.get(key);
      if (!fresh) {
        fresh = await freshPart(cp.source.doc, k, out);
        done.set(key, fresh);
      }
      if (fresh !== cp.source.doc) changed = true;
      comps.push(fresh === cp.source.doc ? cp : { ...cp, source: { ...cp.source, doc: fresh } });
    }
    if (changed) out.doc = { ...doc, components: comps };
  }
  out.notes = [...new Set(out.notes)];
  out.stats.ms = Date.now() - t0;
  return out;
}
