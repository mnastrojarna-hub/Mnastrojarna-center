/**
 * Komponenta = kopie dílu (vlna 22, bod 22g): `vložit "Deska A"` uloží do sestavy kopii dílu záložky a k ní otisk dílu
 * v tu chvíli (`origin` – geometrie, číslo, materiál, druh, výkresy). Pozdější změna dílu v záložce (číslo a materiál
 * doplněné až po vložení – běžný postup) se do sestavy sama nepromítne; sestava to ale VŽDY řekne (⚠ asm.stale-copy
 * v kusovníku, CSV, na listu sestavy, v `stav` a v panelu komponenty) a nabídne jednu funkci obnovy:
 *
 *   text `sestava obnovit "Deska A" | vše [údaje]`  ·  GUI „Obnovit z dílu“ (volá týž příkaz)  ·  balík D2 (zastaralé výstupy)
 *
 * Otisk rozliší směr změny: díl se od vložení změnil (kopie je starší než díl) × kopie se změnila v sestavě (`sestava
 * komponenta … materiál`, `sestava upravit`) – obnova by takovou úpravu přepsala, proto se hlásí zvlášť. Komponenta bez
 * otisku (dokument z dřívějška, normálie z knihovny) se porovná jen ve vlastnostech, které nezávisí na id prvků (číslo,
 * materiál, druh) – směr změny pak nejde určit.
 *
 * Čisté funkce; přečíslování ploch vazeb po obnově geometrie a přepočet vazeb dělá asm-agent.ts (`case "refresh"`).
 */
import { hashPair, sourceKey } from "./assembly";
import { tr } from "./i18n";
import type { AsmComponent, CadDoc, CopyOrigin } from "./types";

/** co se na kopii liší: geometrie, číslo, materiál (třída nebo označení), druh položky, výkresy dílu */
export type CopyField = "geometry" | "number" | "material" | "kind" | "drawing";
export const COPY_FIELDS: readonly CopyField[] = ["geometry", "number", "material", "kind", "drawing"];
/** pole kopie lidsky (protokol, GUI) */
export const copyFieldLabel = (f: CopyField): string =>
  f === "geometry" ? tr("geometrie") : f === "number" ? tr("číslo") : f === "material" ? tr("materiál") : f === "kind" ? tr("druh") : tr("výkres");
export const copyFieldsText = (fs: readonly CopyField[]): string => fs.map(copyFieldLabel).join(", ");

const sigMemo = new WeakMap<CadDoc, string>();
/** otisk geometrie dílu (`sourceKey`) – v mezipaměti podle objektu dokumentu (kusovník se počítá při každém překreslení) */
const geoSig = (d: CadDoc): string => {
  let s = sigMemo.get(d);
  if (s === undefined) sigMemo.set(d, (s = sourceKey({ kind: "part", doc: d })));
  return s;
};
const drwMemo = new WeakMap<CadDoc, string>();
const drawSig = (d: CadDoc): string | undefined => {
  if (!d.drawings?.length) return undefined;
  let s = drwMemo.get(d);
  if (s === undefined) drwMemo.set(d, (s = hashPair(JSON.stringify(d.drawings)).map((x) => x.toString(36)).join("")));
  return s;
};

/** otisk dílu: název, geometrie, vlastnosti do kusovníku (číslo, třída a označení materiálu, druh) a výkresy */
export function copyOrigin(part: CadDoc): CopyOrigin {
  const number = part.props?.number?.trim();
  const materialName = part.materialName?.trim();
  const drw = drawSig(part);
  return { part: part.name, sig: geoSig(part), ...(number ? { number } : {}), material: part.material, ...(materialName ? { materialName } : {}), ...(part.supply?.kind ? { kind: part.supply.kind } : {}), ...(drw ? { drw } : {}) };
}

function diff(a: CopyOrigin, b: CopyOrigin, geometry: boolean): CopyField[] {
  const out: CopyField[] = [];
  if (geometry && a.sig !== b.sig) out.push("geometry");
  if ((a.number ?? "") !== (b.number ?? "")) out.push("number");
  if ((a.material ?? "ocel") !== (b.material ?? "ocel") || (a.materialName ?? "") !== (b.materialName ?? "")) out.push("material");
  if ((a.kind ?? "") !== (b.kind ?? "")) out.push("kind");
  if (geometry && (a.drw ?? "") !== (b.drw ?? "")) out.push("drawing");
  return out;
}

/**
 * Stav kopie dílu v komponentě vůči dílu `part` (záložka stejného názvu): `stale` = co se na dílu změnilo od vložení /
 * poslední obnovy, `local` = co se změnilo na kopii v sestavě. `legacy` = komponenta bez otisku (směr změny neznámý,
 * geometrie se neporovnává). null = komponenta není kopie dílu nebo díl není otevřený.
 */
export type CopyState = { stale: CopyField[]; local: CopyField[]; legacy: boolean };
export function copyState(c: AsmComponent, part: CadDoc | null | undefined): CopyState | null {
  if (c.source.kind !== "part" || !part || part.kind === "assembly" || part.kind === "draft") return null;
  const now = copyOrigin(part);
  const copy = copyOrigin(c.source.doc);
  if (c.origin) return { stale: diff(c.origin, now, true), local: diff(c.origin, copy, true), legacy: false };
  return { stale: diff(copy, now, false), local: [], legacy: true };
}

/** název dílu, ze kterého komponenta vznikla (otisk, jinak název dílu v kopii) */
export const originName = (c: AsmComponent): string | undefined => (c.source.kind === "part" ? (c.origin?.part ?? c.source.doc.name)?.trim() || undefined : undefined);

export type PartLookup = (name: string) => CadDoc | null | undefined;
export type StaleCopy = { comp: AsmComponent; index: number; part: string } & CopyState;

/**
 * Komponenty nejvyšší úrovně, jejichž díl v záložce se od vložení změnil (kopie je starší než díl). Díl, který není
 * otevřený, se nehodnotí (`partOf` vrátí null) – nic se nehlásí, ale ani netvrdí, že kopie odpovídá.
 */
export function staleCopies(asm: CadDoc, partOf: PartLookup | undefined): StaleCopy[] {
  if (!partOf || asm.kind !== "assembly") return [];
  const out: StaleCopy[] = [];
  (asm.components ?? []).forEach((c, index) => {
    const name = originName(c);
    if (!name) return;
    const part = partOf(name);
    const st = copyState(c, part);
    if (st?.stale.length) out.push({ comp: c, index, part: name, ...st });
  });
  return out;
}

/** text ⚠ jedné zastaralé kopie s příkazem, který ji obnoví */
export function staleCopyText(s: StaleCopy): string {
  const ref = s.comp.alias ? `"${s.comp.alias}"` : `#${s.index + 1}`;
  const base = s.legacy
    ? tr("komponenta „{0}“ se liší od dílu „{1}“ v záložce ({2}) – kusovník a výkres ukazují údaje kopie v sestavě; převzít z dílu: sestava obnovit {3}", s.comp.name, s.part, copyFieldsText(s.stale), ref)
    : tr("komponenta „{0}“ je starší než díl „{1}“ v záložce ({2}) – kusovník a výkres ukazují údaje z vložení; obnovit: sestava obnovit {3}", s.comp.name, s.part, copyFieldsText(s.stale), ref);
  return s.local.length ? `${base} ${tr("(pozor: kopie byla upravena i v sestavě – {0}; obnova úpravu přepíše)", copyFieldsText(s.local))}` : base;
}

/* ───────────────────────── obnova z dílu ───────────────────────── */

/** otisk po obnově: celá obnova = díl teď; jen údaje = údaje dílu teď, geometrie a výkresy z dřívějšího otisku (nejsou obnovené) */
function metaOrigin(c: AsmComponent, part: CadDoc, metaOnly: boolean): CopyOrigin {
  const now = copyOrigin(part);
  if (!metaOnly) return now;
  const { drw: _d, ...rest } = now;
  void _d;
  const prev = c.origin ?? copyOrigin(c.source.kind === "part" ? c.source.doc : part);
  return { ...rest, sig: prev.sig, ...(prev.drw ? { drw: prev.drw } : {}) };
}

export type RefreshDone = { id: string; name: string; fields: CopyField[]; local: CopyField[]; geometry: boolean; keptNumber?: string };
export type RefreshPlan = { doc: CadDoc; done: RefreshDone[]; skipped: { name: string; why: string }[] };

/**
 * Obnova komponent z dílů záložek – JEDNA funkce pro text (`sestava obnovit`), GUI („Obnovit z dílu“) a balík D2.
 * `targets` = id komponent nejvyšší úrovně; `metaOnly` = jen vlastnosti do kusovníku (číslo, materiál, druh) bez geometrie
 * a výkresů. Poloha, natočení, přezdívka, barva, skupina, pružina a vazby zůstávají; číslo zadané na komponentě (přepis
 * v sestavě) zůstává, převzaté číslo se obnoví. Čistá funkce – přečíslování ploch vazeb dělá volající.
 */
export function refreshPlan(asm: CadDoc, targets: readonly string[], partOf: PartLookup, o: { metaOnly?: boolean } = {}): RefreshPlan {
  const done: RefreshDone[] = [];
  const skipped: RefreshPlan["skipped"] = [];
  const want = new Set(targets);
  const components = (asm.components ?? []).map((c) => {
    if (!want.has(c.id)) return c;
    if (c.source.kind !== "part") {
      skipped.push({ name: c.name, why: c.source.kind === "asm" ? tr("podsestava – obnovte její díly v její záložce") : tr("importovaný soubor – nemá díl v záložce") });
      return c;
    }
    const name = originName(c)!;
    const part = partOf(name);
    if (!part || part.kind === "assembly" || part.kind === "draft") {
      skipped.push({ name: c.name, why: tr("díl „{0}“ není otevřený v záložce", name) });
      return c;
    }
    const st = copyState(c, part)!;
    const old = c.source.doc;
    const fresh: CadDoc = o.metaOnly
      ? { ...old, material: part.material, materialName: part.materialName, props: { ...(old.props ?? {}), number: part.props?.number }, supply: part.supply }
      : { ...(JSON.parse(JSON.stringify(part)) as CadDoc), kind: "part" };
    if (!fresh.materialName) delete fresh.materialName;
    if (!fresh.supply) delete fresh.supply;
    if (fresh.props && !fresh.props.number) delete fresh.props.number;
    // číslo převzaté z dílu (GUI je při vložení kopíruje i na komponentu) se obnoví; jiné číslo = přepis v sestavě, zůstane
    const inherited = !c.number || c.number.trim() === (old.props?.number ?? "").trim();
    const next: AsmComponent = { ...c, source: { kind: "part", doc: fresh }, origin: metaOrigin(c, part, !!o.metaOnly) };
    if (inherited) {
      if (c.number && part.props?.number?.trim()) next.number = part.props.number.trim();
      else delete next.number;
    }
    const fields = o.metaOnly ? st.stale.filter((f) => f !== "geometry" && f !== "drawing") : st.stale;
    done.push({ id: c.id, name: c.name, fields, local: st.local, geometry: !o.metaOnly && sourceKey(c.source) !== sourceKey(next.source), ...(!inherited ? { keptNumber: c.number } : {}) });
    return next;
  });
  return { doc: { ...asm, components }, done, skipped };
}
