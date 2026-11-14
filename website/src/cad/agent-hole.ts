/**
 * Textový příkaz `díra` – volby vrtáku závitové díry a dna slepé díry (CS / EN / DE):
 * - `dno ploché` / `ploché dno` (EN `flat bottom`, DE `flacher Grund` / `Grund flach`) = ploché dno (tipAngle 180);
 * - `hrot 118` (EN `tip 118`, DE `Spitze 118`) = vrcholový úhel hrotu vrtáku 60–170°, `hrot 180` = ploché dno;
 * - `jádro` (EN `core` / `minor`, DE `Kern`) = vrtat malý průměr závitu D1 podle ISO 965-1 (M8 → 6,647);
 * - `vrták` (EN `drill`, DE `Bohrer`) = tabulkový vrták pro závit (M8 → 6,8); `vrták 6,7` = zadaný průměr vrtáku;
 * - samotné označení `M8` / `M18×1,5` bez slova `závit` = závit díry.
 * Volby se z tokenů vyjmou dřív, než je přečte obecný parser voleb (číslo za `hrot` není průměr díry).
 * Pravidla průměru závitové díry (`holeThreadDrill`): bez průměru → tabulkový vrták; zadaný průměr má přednost
 * (zápis do protokolu); jmenovitý průměr závitu (`díra 8 závit M8`) = tabulkový vrták s poznámkou.
 */
import { getLang, tr } from "./i18n";
import { threadByName, type MetricThread } from "./defaults";
import { DEFAULT_TIP, FLAT_TIP, drillFitsThread, holeDrillD, holeTip, tapDrillD, tapDrillOf, threadMinorD, tipAngleOk, type TapDrill } from "./hole-spec";
import type { Feature } from "./types";

type HoleF = Extract<Feature, { type: "hole" }>;
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)°?$/.test(t);
const num = (t: string) => parseFloat(t.replace(",", ".").replace("°", ""));
/** číslo pro protokol: na tisíciny, desetinná čárka (EN tečka) */
export const fmtD = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", getLang() === "en" ? "." : ",");

const BOTTOM = new Set(["dno", "dnem", "dna", "bottom", "grund", "boden"]);
const FLAT = new Set(["ploche", "plochy", "plochym", "plochem", "rovne", "rovny", "rovnym", "flat", "flach", "flacher", "flaches", "flachem", "flachen", "eben", "ebener", "ebenem"]);
const CONE = new Set(["kuzel", "kuzelove", "kuzelovy", "cone", "conical", "kegel", "kegelig", "kegelform"]);
const TIP = new Set(["hrot", "hrotu", "spicka", "spicky", "tip", "spitze", "spitzenwinkel", "bohrerspitze"]);
const NO = new Set(["bez", "without", "no", "ohne", "kein", "keine", "keinen"]);
const CORE = new Set(["jadro", "core", "minor", "kern", "kerndurchmesser"]);
const DRILL = new Set(["vrtak", "drill", "tapdrill", "tap-drill", "bohrer", "kernlochbohrer"]);
const THREAD_WORDS = new Set(["zavit", "thread", "gewinde"]);
/** slova voleb díry, která smějí stát i jako `klíč=hodnota` (dno=ploché, vrták=6,7, hrot=120) */
const KV_WORDS = new Set([...BOTTOM, ...TIP, ...DRILL, ...CORE]);
/** kmeny slov, která vypadají jako volba dna / vrtáku, ale žádnou nejsou (s plochym, dnem kuzel…) – chyba místo tichého přehlédnutí */
const NEAR_MISS = /^(dn[oaeu]|dnem|ploch[eéyý]|flat|flach|hrot|spick|spitz|jadr|vrtak|bohrer|kegel|kuzel$)/;

/** Druh tokenu pro obecný parser voleb (agent.ts): "words" = volba s víceslovnou hodnotou (název, materiál, těleso…), "key" = jiná volba. */
export type TokenKind = (t: string) => "words" | "key" | null;

export type HoleTextExtras = {
  /** tokeny bez vyjmutých voleb – pro obecný parser */
  rest: string[];
  /** vrcholový úhel (180 = ploché dno) */
  tip?: number;
  /** volba vrtáku závitové díry */
  drill?: "tap" | "minor";
  /** `vrták 6,7` = zadaný průměr vrtáku */
  drillD?: number;
  /** označení závitu napsané bez slova „závit“ */
  thread?: string;
};

/** Ověřený úhel hrotu z textu (60–170°, 180 = ploché dno). */
function tipValue(v: number): number {
  if (!tipAngleOk(v)) throw new Error(tr("díra: úhel hrotu {0}° – zadejte 60 až 170° (vrták 118°, 120°, 90°…) nebo 180 = ploché dno", fmtD(v)));
  return v;
}

/**
 * Vyjme z tokenů příkazu `díra` volby dna a vrtáku (viz hlavička souboru). Hodnota víceslovné volby (`název M8`, `název Vrták`,
 * `materiál …`) zůstane beze změny pro obecný parser – stejně jako u ostatních příkazů sahá do další volby (`kindOf`).
 */
export function holeTextExtras(tokens0: string[], kindOf: TokenKind = () => null): HoleTextExtras {
  const out: HoleTextExtras = { rest: [] };
  // tokeny hodnoty víceslovné volby (název…) se nečtou; `klíč=hodnota` u slov voleb díry = dvě slova
  const tokens: string[] = [];
  const kept: boolean[] = [];
  const take = (t: string, keep: boolean) => {
    tokens.push(t);
    kept.push(keep);
  };
  for (let i = 0; i < tokens0.length; i++) {
    const kv = /^([^=]+)=(.+)$/.exec(tokens0[i]);
    if (kv && KV_WORDS.has(fold(kv[1]))) {
      take(kv[1], false);
      take(kv[2], false);
    } else take(tokens0[i], false);
    // „bez“ je jinde volba otevřených ploch (skořepina) – „bez hrotu“ je ale dno díry
    if (kindOf(tokens0[i]) !== "words" || (NO.has(fold(tokens0[i])) && TIP.has(fold(tokens0[i + 1] ?? "")))) continue;
    while (i + 1 < tokens0.length && kindOf(tokens0[i + 1]) === null) take(tokens0[++i], true);
  }
  const w = tokens.map(fold);
  const hasThreadWord = w.some((x, i) => !kept[i] && THREAD_WORDS.has(x));
  let cone = "";
  const setTip = (v: number, src: string) => {
    if (out.tip !== undefined && Math.abs(out.tip - v) > 1e-9) throw new Error(tr("díra: dno je zadané dvakrát různě („{0}“) – použijte buď „dno ploché“, nebo „hrot 118“", src));
    out.tip = v;
  };
  const numAt = (j: number) => (j < tokens.length && !kept[j] && isNum(tokens[j]) ? num(tokens[j]) : NaN);
  for (let i = 0; i < tokens.length; i++) {
    const t = w[i];
    const next = kept[i + 1] ? "" : (w[i + 1] ?? "");
    if (kept[i]) {
      out.rest.push(tokens[i]);
      continue;
    }
    // dno ploché / ploché dno / s plochým dnem (EN flat bottom, DE flacher Grund); samotné „ploché“ (EN flat, DE flach) = totéž
    if ((BOTTOM.has(t) && FLAT.has(next)) || (FLAT.has(t) && BOTTOM.has(next))) {
      setTip(FLAT_TIP, `${tokens[i]} ${tokens[i + 1]}`);
      i++;
      continue;
    }
    if (FLAT.has(t) || t === "flat-bottom" || t === "flatbottom" || t === "flachgrund") {
      setTip(FLAT_TIP, tokens[i]);
      continue;
    }
    // bez hrotu (EN without tip, DE ohne Spitze) = ploché dno
    if (NO.has(t) && TIP.has(next)) {
      setTip(FLAT_TIP, `${tokens[i]} ${tokens[i + 1]}`);
      i++;
      continue;
    }
    // dno kužel [N] (EN bottom cone, DE Grund Kegel) = hrot vrtáku (výchozí 118°, s číslem jiný úhel); s „hrot N“ v libovolném pořadí
    if (BOTTOM.has(t) && CONE.has(next)) {
      cone = `${tokens[i]} ${tokens[i + 1]}`;
      i++;
      const v = numAt(i + 1);
      if (!Number.isNaN(v)) {
        setTip(tipValue(v), `${cone} ${tokens[i + 1]}`);
        i++;
      }
      continue;
    }
    // hrot N (EN tip N, DE Spitze N); „dno hrot N“ = totéž
    if (TIP.has(t) || (BOTTOM.has(t) && TIP.has(next))) {
      if (BOTTOM.has(t)) i++;
      const v = numAt(i + 1);
      if (Number.isNaN(v)) {
        setTip(DEFAULT_TIP, tokens[i]);
        continue;
      }
      setTip(tipValue(v), `${tokens[i]} ${tokens[i + 1]}`);
      i++;
      continue;
    }
    if (BOTTOM.has(t)) throw new Error(tr("díra: za slovem „{0}“ čekám „ploché“ nebo „hrot N“ (dno ploché | hrot 118)", tokens[i]));
    if (CORE.has(t)) {
      if (out.drill && out.drill !== "minor") throw new Error(tr("díra: „jádro“ a „vrták“ si odporují – zadejte jen jedno"));
      out.drill = "minor";
      continue;
    }
    if (DRILL.has(t)) {
      if (out.drill === "minor") throw new Error(tr("díra: „jádro“ a „vrták“ si odporují – zadejte jen jedno"));
      const nx = kept[i + 1] ? "" : (tokens[i + 1] ?? "");
      if (isNum(nx) || /^[øØ⌀]/.test(nx)) {
        const v = num(nx.replace(/^[øØ⌀]/, ""));
        if (!(v > 0)) throw new Error(tr("díra: průměr vrtáku musí být kladný: vrták 6,7"));
        out.drillD = v;
        i++;
      } else out.drill = "tap";
      continue;
    }
    // samotné označení závitu (M8, M18×1,5) bez slova „závit“
    if (!hasThreadWord && !out.thread && /^m\d/i.test(tokens[i]) && threadByName(tokens[i])) {
      out.thread = tokens[i];
      continue;
    }
    // slovo podobné volbě dna / vrtáku, které žádnou není → chyba (jinak by se tiše vrtal kužel 118° nebo tabulkový vrták)
    if (kindOf(tokens[i]) === null && NEAR_MISS.test(t)) throw new Error(tr("díra: nerozumím slovu „{0}“ – volby dna a vrtáku: dno ploché | hrot 118 | dno kužel | jádro | vrták [6,7]; název pište za slovo „název“", tokens[i]));
    out.rest.push(tokens[i]);
  }
  if (cone && out.tip !== undefined && out.tip >= FLAT_TIP - 1e-9) throw new Error(tr("díra: dno je zadané dvakrát různě („{0}“) – použijte buď „dno ploché“, nebo „hrot 118“", cone));
  if (cone && out.tip === undefined) out.tip = DEFAULT_TIP;
  return out;
}

/**
 * Průměr vrtání závitové díry z textu: `d` = průměr napsaný za `díra` (nebo `průměr N`), `x` = volby z `holeTextExtras`.
 * Vrací průměr, volbu vrtáku pro prvek (chybí = tabulkový) a poznámku do protokolu.
 */
export function holeThreadDrill(d: number | undefined, t: MetricThread, x: Pick<HoleTextExtras, "drill" | "drillD">): { diameter: number; tapDrill?: TapDrill; note?: string } {
  const near = (a: number, b: number) => Math.abs(a - b) < 5e-4;
  const D1 = threadMinorD(t);
  const nominal = d !== undefined && near(d, t.d);
  if (x.drillD !== undefined && d !== undefined && !nominal && !near(d, x.drillD)) throw new Error(tr("díra: průměr {0} a „vrták {1}“ si odporují – zadejte jen jedno", fmtD(d), fmtD(x.drillD)));
  const given = x.drillD ?? (nominal ? undefined : d);
  if (x.drill === "minor") {
    if (given !== undefined && !near(given, D1)) throw new Error(tr("díra: průměr {0} a „jádro“ (D1 závitu {1} = {2}) si odporují – zadejte jen jedno", fmtD(given), t.name, fmtD(D1)));
    return { diameter: D1, tapDrill: "minor", note: tr("vrták Ø{0} = jádro D1 závitu {1} podle ISO 965-1 (tabulkový vrták {2})", fmtD(D1), t.name, fmtD(t.tap)) };
  }
  if (x.drill === "tap" && given !== undefined && !near(given, t.tap)) throw new Error(tr("díra: průměr {0} a „vrták“ (tabulkový {1} pro {2}) si odporují – zadejte jen jedno", fmtD(given), fmtD(t.tap), t.name));
  if (nominal && x.drillD === undefined)
    return { diameter: t.tap, note: tr("Ø{0} je jmenovitý průměr závitu {1} – vrtá se tabulkový vrták Ø{2} (jádro D1 Ø{3}: volba „jádro“, jiný vrták: „vrták 6,7“ nebo průměr za slovem díra)", fmtD(t.d), t.name, fmtD(t.tap), fmtD(D1)) };
  if (given === undefined || near(given, t.tap)) return { diameter: t.tap };
  // nesmyslně malý vrták (o víc než stoupání pod jádrem D1) = zástupné číslo ze starších zápisů („díra 5 závit M18×1,5“)
  if (x.drillD === undefined && given < D1 - t.pitch)
    return { diameter: t.tap, note: tr("Ø{0} je pro závit {1} příliš malý (pod jádrem D1 {2} o víc než stoupání) – vrtá se tabulkový vrták Ø{3}; jiný vrták: „vrták 6,7“", fmtD(given), t.name, fmtD(D1), fmtD(t.tap)) };
  if (given >= t.d - 5e-4) throw new Error(tr("díra: vrták Ø{0} musí být menší než závit {1} (Ø{2}) – průchozí díra pro šroub je díra bez závitu (např. díra 9 skrz)", fmtD(given), t.name, fmtD(t.d)));
  return { diameter: given, tapDrill: "custom", note: tr("vrták Ø{0} zadán ručně (tabulkový {1})", fmtD(given), fmtD(t.tap)) };
}

/** Popis vrtáku závitové díry pro stav: „vrták Ø6,8“, „vrták = jádro D1 Ø6,647“, „vrták Ø6,647 zadán ručně“. */
export function holeDrillText(f: HoleF): string {
  const d = fmtD(holeDrillD(f));
  return f.tapDrill === "minor" ? tr("vrták = jádro D1 Ø{0}", d) : f.tapDrill === "custom" ? tr("vrták Ø{0} zadán ručně", d) : tr("vrták Ø{0}", d);
}

/** Dno slepé díry pro stav: „ · dno ploché“, „ · hrot 120°“ (výchozí 118° se nevypisuje; úhel mimo 60–170° jako v jádře oříznutý). */
export function holeBottomText(f: HoleF): string {
  const blind = f.end ? f.end.kind === "blind" : f.depth > 0;
  if (!blind) return "";
  const tip = holeTip(f);
  if (tip === null) return tr(" · dno ploché");
  return Math.abs(tip - DEFAULT_TIP) > 1e-9 ? tr(" · hrot {0}°", fmtD(tip)) : "";
}

/** Které z polí díry zadal uživatel / změnila úprava (upravit, prvek hole …). */
export type HoleKeys = { diameter?: boolean; thread?: boolean; tapDrill?: boolean; tipAngle?: boolean };
/** pole díry změněná úpravou (porovnání před / po) */
export const changedHoleKeys = (a: HoleF, b: HoleF): HoleKeys => ({ diameter: a.diameter !== b.diameter, thread: a.thread !== b.thread, tapDrill: a.tapDrill !== b.tapDrill, tipAngle: a.tipAngle !== b.tipAngle });

/**
 * Pravidla vrtáku a dna pro `upravit "Díra 1" …` a `prvek hole …` – stejná jako text `díra` a formulář (žádná tichá změna):
 * - `tapDrill` jen table | minor | custom (i tabulkový / jádro / vlastní, DE Tabelle / Kern / eigen), jinak chyba;
 * - `tipAngle` 60–170° nebo 180 (= ploché dno; i slovo „ploché“), jinak chyba jako `díra … hrot 200`;
 * - závitová díra: zadaný `diameter` má přednost – stejná pravidla jako `díra 6,647 závit M8` (tabulkový / jmenovitý /
 *   zástupný průměr → tabulkový vrták s poznámkou; ≥ závit → chyba); s `tapDrill` najednou jako `… jádro` / `… vrták 6,647`;
 * - změna závitu u vlastního vrtáku: vrták zůstane, jen když se k novému závitu hodí (D1 − P ≤ d < D), jinak tabulkový s poznámkou.
 * Upraví `f` na místě, vrací poznámky do protokolu.
 */
export function holeFieldRules(f: HoleF, keys: HoleKeys): string[] {
  const notes: string[] = [];
  const rec = f as unknown as Record<string, unknown>;
  if (keys.tapDrill && f.tapDrill !== undefined) {
    const m = tapDrillOf(f.tapDrill);
    if (!m) throw new Error(tr("tapDrill „{0}“ – zadejte table (tabulkový vrták), minor (jádro D1) nebo custom (vrtá se diameter)", String(f.tapDrill)));
    if (m === "table") delete f.tapDrill;
    else f.tapDrill = m;
  }
  if (keys.tipAngle && f.tipAngle !== undefined) {
    const raw = rec.tipAngle;
    const v = typeof raw === "number" ? raw : /^(ploch|flat|flach|rovn|eben)/.test(fold(String(raw))) ? FLAT_TIP : num(String(raw));
    if (Number.isNaN(v) || !tipAngleOk(v)) throw new Error(tr("díra: úhel hrotu {0}° – zadejte 60 až 170° (vrták 118°, 120°, 90°…) nebo 180 = ploché dno", String(raw)));
    f.tipAngle = v;
  }
  const t = f.kind === "tapped" ? threadByName(f.thread) : undefined;
  if (!t) return notes;
  if (keys.diameter) {
    // průměr s volbou vrtáku najednou = jako text „díra 6,647 závit M8 jádro | vrták | vrták 6,647“ (rozpor → chyba)
    const x: Pick<HoleTextExtras, "drill" | "drillD"> = !keys.tapDrill ? {} : f.tapDrill === "minor" ? { drill: "minor" } : f.tapDrill === "custom" ? { drillD: f.diameter } : { drill: "tap" };
    const td = holeThreadDrill(f.diameter, t, x);
    f.diameter = td.diameter;
    if (td.tapDrill) f.tapDrill = td.tapDrill;
    else delete f.tapDrill;
    if (td.note) notes.push(td.note);
    return notes;
  }
  if (!keys.thread && !keys.tapDrill) return notes;
  if (keys.thread && !keys.tapDrill && f.tapDrill === "custom" && !drillFitsThread(f.diameter, t)) {
    // vlastní vrták z výkresu pro předchozí závit – k novému se nehodí → tabulkový (formulář dělá totéž, threadPatch)
    notes.push(tr("vlastní vrták Ø{0} se k závitu {1} nehodí (vhodný je Ø{2} až pod Ø{3}) – vrtá se tabulkový vrták Ø{4}", fmtD(f.diameter), t.name, fmtD(threadMinorD(t) - t.pitch), fmtD(t.d), fmtD(t.tap)));
    delete f.tapDrill;
    f.diameter = t.tap;
  } else if (f.tapDrill === "custom") {
    if (!(f.diameter > 0)) throw new Error(tr("tapDrill custom potřebuje průměr vrtáku: diameter=6,647"));
    if (f.diameter >= t.d - 5e-4) throw new Error(tr("díra: vrták Ø{0} musí být menší než závit {1} (Ø{2}) – průchozí díra pro šroub je díra bez závitu (např. díra 9 skrz)", fmtD(f.diameter), t.name, fmtD(t.d)));
  } else f.diameter = tapDrillD(t, f.tapDrill, f.diameter); // uložený průměr = skutečný vrták (tabulkový / jádro D1)
  return notes;
}
