/**
 * Jádro fulltextového hledání v nápovědě (bez obsahu a bez závislostí – používá ho `nápověda hledat` v enginu, `mncad help
 * search` i pole Hledat na stránce dokumentace):
 *
 *   - slova bez diakritiky a bez velikosti písmen (`zalozky` = `záložky`), ß → ss, ø → o
 *   - lehké odřezání koncovek (čeština / angličtina / němčina: `záložky` ~ `záložka`, `zaoblit` ~ `zaoblení`, `tabs` ~ `tab`)
 *     a shoda začátkem slova (`sestav` → `sestava`, `sestavit`)
 *   - překlepy jako paleta příkazů: slovo, které v rejstříku není, se hledá s jednou chybou (od 4 znaků; od 9 znaků se dvěma –
 *     záměna, vynechání, přidání i prohození sousedních písmen); překlep má přednost před pouhým začátkem slova
 *   - synonyma a překlady (`glossary`: skupiny slov cs / en / de) s nižší vahou; víceslovné heslo glosáře („bill of
 *     materials“) platí jako jedno slovo dotazu
 *   - BM25 po polích (název oddílu, příkazy, text, klíčová slova) × pokrytí dotazu vážené důležitostí slov: slovo, které
 *     někde v rejstříku něco pojmenovává (je v názvu, v příkazu nebo v klíčových slovech), váží víc než slovo z vět –
 *     otázka „jak přepnout na jinou záložku“ tak najde oddíl o záložkách, i když „přepnout“ a „jinou“ jsou jinde
 *   - varianta slova (synonymum, začátek, překlep) nemá vyšší váhu vzácnosti než slovo samo – vzácné cizí slovo, které se
 *     jen podobá, nepřebije běžné slovo, které uživatel myslel
 *
 * Výsledek je seřazený seznam úseků se skóre a se slovy, která se v úseku našla (pro výběr věty a zvýraznění).
 */

/** `lead` = první slova příkazu úseku („svar tupý“, „sestava vazba“) – dotaz, který příkaz jmenuje, najde jeho řádek první */
export type FieldName = "title" | "cmd" | "body" | "kw" | "lead";
/** úsek textu k hledání: pole se slovy + libovolná data volajícího */
export type SearchDoc<T = unknown> = { fields: Partial<Record<FieldName, string>>; boost?: number; data: T };
export type SearchHit<T = unknown> = { doc: SearchDoc<T>; index: number; score: number; terms: Set<string>; matched: number };

const FIELD_WEIGHT: Record<FieldName, number> = { title: 2.4, cmd: 1.7, body: 1, kw: 1.3, lead: 2.6 };
const K1 = 1.2;
const B = 0.55;

/** malá písmena bez diakritiky (ß → ss, ø → o) */
export const foldText = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o");

export type SearchLang = "cs" | "en" | "de";

/** slova bez významu pro hledání (spojky, předložky, výplň otázek „jak / kolik / how many / wie“) – platí ve všech jazycích */
const STOP = new Set(
  (
    "a i k o s u v z se si na do ze je jsou to ten ta ty tu ho mu mi me jak kde co kdy proc pro pri po od ve za by aby ale nebo ani jen tak uz lze muze mohu chci mam jde " +
    "ktery ktera ktere kterou jeho jej jejich tento tato toto tim tom jsem byt bude budou nez kdyz pak take tez az nejak " +
    "ma maji mit jiny jina jine jinou jineho jinym zda jestli treba potrebuji udelat provest " +
    "the an of to in on is are how do does can what which with for by it this that and or from into my me be use using want get " +
    "many much another other there should would need make any some when where why will have has was " +
    "ein eine einen einem einer und oder mit wie im zum zur von auf ist sind kann ich fur das dem des gibt viele andere anderen muss soll wird werden machen"
  ).split(" "),
);
/**
 * německá slova bez významu, která jinde význam mají: `der` = české „děr“ (díry), `die` = anglicky střižnice / zápustka,
 * `den`, `man`, `wo`, `zu`, `es` – vynechají se jen v německém běhu
 */
const STOP_DE = new Set("der die den man wo zu es".split(" "));

/** koncovky k odřezání (nejdelší první); slovesné jen u slov od 6 znaků */
const SUFFIX = ["ovanim", "ovani", "ujici", "ovych", "ovymi", "atech", "etech", "acich", "ungen", "ings", "eni", "ani", "ost", "osti", "emu", "eho", "ych", "ymi", "imi", "ami", "ach", "ech", "ich", "ove", "ovy", "ova", "ovi", "ung", "ing", "ek", "ou", "em", "im", "ym", "om", "um", "en", "er", "es", "ed", "y", "a", "e", "i", "o", "u", "s", "n"].sort((a, b) => b.length - a.length);
const VERB = ["ovat", "it", "et", "at"];

/** slova, která by po odříznutí koncovky splynula s jiným (formát → „form“ = forma, mezi → „mez“ = limit) */
const NO_STEM = new Set(["format", "prumet", "pocet", "vypocet", "soucet", "mezi"]);

/** lehký kmen složeného slova (bez diakritiky): odřízne jednu koncovku, kmen má aspoň 3 znaky */
export function stem(w: string): string {
  if (w.length < 4 || !/^[a-z]+$/.test(w) || NO_STEM.has(w)) return w;
  if (w.length >= 6) for (const s of VERB) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  for (const s of SUFFIX) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  return w;
}

/** slova textu (složená, bez stop slov, aspoň 2 znaky; čísla zůstanou – `m8`, `2d`, `7200`); `lang` = jazyk běhu / stránky */
export function words(s: string, lang?: SearchLang): string[] {
  const out: string[] = [];
  for (const m of foldText(s).matchAll(/[a-z0-9]+/g)) {
    const w = m[0];
    if (w.length < 2 || STOP.has(w) || (lang === "de" && STOP_DE.has(w))) continue;
    out.push(w);
  }
  return out;
}

/** vzdálenost slov (Damerau – optimal string alignment), s horní mezí `max` (nad ní vrací max + 1) */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= m; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

type Posting = { doc: number; tf: Record<FieldName, number>; len: number };

/**
 * skupiny synonym / překladů (slova se složí a odříznou na kmen); víceslovné heslo („bill of materials“, „title block“)
 * je fráze – v dotazu platí jako jedno slovo se synonymy skupiny, jeho jednotlivá slova synonymy nejsou
 */
export type Glossary = readonly (readonly string[])[];
export type IndexOptions = { lang?: SearchLang };

/** varianty jednoho slova dotazu: kmen rejstříku → váha (1 = přesně, synonymum / začátek / překlep méně) */
type Variants = Map<string, number>;
/** slovo (nebo fráze) dotazu: varianty, strop váhy vzácnosti (IDF slova, které uživatel myslel) a důležitost pro pokrytí */
type QueryTerm = { vars: Variants; cap: number; imp: number };

/** váha pokrytí dotazu: skóre × (COVER_MIN + (1 − COVER_MIN) × pokrytí ^ COVER_POW) */
const COVER_MIN = 0.12;
const COVER_POW = 1.6;
/** důležitost slova, které v rejstříku něco pojmenovává (název oddílu, příkaz, klíčové slovo), proti slovu z vět */
const IMP_KEY = 2.2;

export class SearchIndex<T = unknown> {
  readonly docs: SearchDoc<T>[];
  readonly lang: SearchLang | undefined;
  private readonly post = new Map<string, Posting[]>();
  /** složené tvary slov rejstříku → kmen (překlepy se hledají mezi tvary) */
  private readonly forms = new Map<string, string>();
  private readonly lens: number[] = [];
  private readonly avg: number;
  private readonly syn = new Map<string, Set<string>>();
  /** fráze glosáře: kmeny slov fráze spojené mezerou → kmeny synonym skupiny */
  private readonly phrases = new Map<string, Set<string>>();
  private phraseMax = 1;
  /** kmeny, které něco pojmenovávají: jsou v názvu, v příkazu nebo v klíčových slovech aspoň jednoho úseku */
  private readonly keys = new Set<string>();

  constructor(docs: SearchDoc<T>[], glossary: Glossary = [], opts: IndexOptions = {}) {
    this.docs = docs;
    this.lang = opts.lang;
    docs.forEach((d, i) => {
      const tfs = new Map<string, Record<FieldName, number>>();
      let len = 0;
      for (const f of Object.keys(d.fields) as FieldName[]) {
        for (const w of words(d.fields[f] ?? "", this.lang)) {
          const s = stem(w);
          if (!this.forms.has(w)) this.forms.set(w, s);
          let r = tfs.get(s);
          if (!r) tfs.set(s, (r = { title: 0, cmd: 0, body: 0, kw: 0, lead: 0 }));
          r[f]++;
          len += FIELD_WEIGHT[f];
          if (f !== "body") this.keys.add(s);
        }
      }
      this.lens.push(len);
      for (const [s, tf] of tfs) {
        let p = this.post.get(s);
        if (!p) this.post.set(s, (p = []));
        p.push({ doc: i, tf, len });
      }
    });
    this.avg = this.lens.reduce((a, b) => a + b, 0) / Math.max(1, this.lens.length);
    for (const g of glossary) {
      const single = new Set<string>();
      const multi: string[][] = [];
      for (const x of g) {
        const ws = words(x, this.lang).map(stem);
        if (ws.length === 1) single.add(ws[0]);
        else if (ws.length > 1) multi.push(ws);
      }
      for (const s of single) {
        let set = this.syn.get(s);
        if (!set) this.syn.set(s, (set = new Set()));
        for (const o of single) if (o !== s) set.add(o);
      }
      for (const ws of multi) {
        const k = ws.join(" ");
        let set = this.phrases.get(k);
        if (!set) this.phrases.set(k, (set = new Set()));
        for (const o of single) set.add(o);
        this.phraseMax = Math.max(this.phraseMax, ws.length);
      }
    }
  }

  /** počet úseků se slovem (kmenem) */
  df(s: string): number {
    return this.post.get(s)?.length ?? 0;
  }

  private idf(s: string): number {
    const n = this.df(s);
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  /** varianty jednoho slova dotazu v rejstříku */
  variants(w: string): Variants {
    return this.term(w)?.vars ?? new Map();
  }

  /** slovo dotazu → varianty v rejstříku, strop IDF a důležitost; null = slovo v rejstříku není ani přibližně */
  private term(w: string): QueryTerm | null {
    const out: Variants = new Map();
    const put = (s: string, v: number) => {
      if (this.post.has(s) && (out.get(s) ?? 0) < v) out.set(s, v);
    };
    const s = stem(w);
    put(s, 1);
    if (w !== s) put(w, 1);
    /** slovo (nebo jeho kmen) v rejstříku je – jinak se hledá i překlep */
    const known = out.size > 0;
    // synonyma / překlady (skupiny glosáře), i přes kmen dotazu
    for (const o of this.syn.get(s) ?? []) put(o, 0.85);
    for (const o of this.syn.get(w) ?? []) put(o, 0.85);
    const exact = new Map(out);
    // začátek slova: kmen dotazu je začátkem kmene rejstříku (od 4 znaků; 3znakový kmen jen u krátkých slov)
    if (s.length >= 3) {
      for (const k of this.post.keys()) {
        if (k === s || !k.startsWith(s)) continue;
        if (s.length >= 4 || k.length <= 5) put(k, s.length >= 5 ? 0.75 : 0.6);
      }
    }
    // překlep: jen když slovo (ani kmen) v rejstříku není – od 4 znaků (u 4 znaků jen záměna / prohození se stejným začátkem)
    let typo = false;
    if (!known && w.length >= 4 && /^[a-z]+$/.test(w)) {
      const max = w.length >= 9 ? 2 : 1;
      const before = out.size;
      for (const [f, fs] of this.forms) {
        if (Math.abs(f.length - w.length) > max) continue;
        if (w.length === 4 && (f.length !== 4 || f[0] !== w[0])) continue;
        const d = editDistance(w, f, max);
        if (d <= max) put(fs, (d === 1 ? 0.7 : 0.5) * (f[0] === w[0] ? 1 : 0.8));
      }
      typo = out.size > before;
    }
    // kmen rejstříku je začátkem slova dotazu (dotaz „tolerancemi“ → „toleranc“) – jen když slovo není v rejstříku a
    // nenašel se překlep („sestva“ je překlep slova sestava, ne tvar slova „šest“)
    if (!known && !typo && s.length >= 5) for (let n = s.length - 1, cut = 1; n >= Math.max(4, s.length - 3); n--, cut++) put(s.slice(0, n), 0.75 - 0.15 * cut);
    if (!out.size) return null;
    /*
     * strop vzácnosti: slovo, které uživatel napsal (je-li v rejstříku), jinak nejčastější z nejlepších kandidátů –
     * vzácná varianta (jiné slovo se stejným začátkem, synonymum) tak nezíská víc než slovo samo
     */
    let cap = 0;
    if (known) for (const k of [s, w]) if (this.post.has(k)) cap = Math.max(cap, this.idf(k));
    if (!cap && exact.size) cap = Math.max(...[...exact.keys()].map((k) => this.idf(k))); // jen synonyma: nejvzácnější z nich
    if (!cap) {
      const best = Math.max(...out.values());
      let df = 0;
      for (const [k, v] of out) if (v >= best - 0.06 && this.df(k) > df) df = this.df(k);
      cap = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
    }
    let key = false;
    for (const [k, v] of out) if (v >= 0.7 && this.keys.has(k)) key = true;
    return { vars: out, cap, imp: key ? IMP_KEY : 1 };
  }

  /** slova a fráze dotazu (fráze glosáře = jedno slovo se synonymy skupiny) */
  private queryTerms(query: string): (QueryTerm | null)[] {
    const ws = [...new Set(words(query, this.lang))];
    const out: (QueryTerm | null)[] = [];
    for (let i = 0; i < ws.length; ) {
      let hit = 0;
      for (let n = Math.min(this.phraseMax, ws.length - i); n >= 2 && !hit; n--) {
        const set = this.phrases.get(
          ws
            .slice(i, i + n)
            .map(stem)
            .join(" "),
        );
        if (!set) continue;
        const vars: Variants = new Map();
        for (const o of set) if (this.post.has(o)) vars.set(o, 1);
        if (!vars.size) continue;
        out.push({ vars, cap: Math.max(...[...vars.keys()].map((k) => this.idf(k))), imp: IMP_KEY });
        hit = n;
      }
      if (hit) i += hit;
      else out.push(this.term(ws[i++]));
    }
    return out;
  }

  /** hledání: seřazené úseky (nejlepší první), `limit` = kolik nejvýš */
  search(query: string, limit = 50): SearchHit<T>[] {
    const terms = this.queryTerms(query).filter((t): t is QueryTerm => !!t);
    if (!terms.length) return [];
    const total = terms.reduce((a, t) => a + t.imp, 0);
    const acc = new Map<number, { score: number; terms: Set<string>; matched: Set<number>; cover: number }>();
    terms.forEach((t, qi) => {
      // nejlepší varianta slova dotazu v úseku (varianty se nesčítají – synonymum nepřebije přesnou shodu)
      const best = new Map<number, number>();
      for (const [s, wv] of t.vars) {
        const idf = Math.min(this.idf(s), t.cap);
        for (const p of this.post.get(s) ?? []) {
          let sc = 0;
          for (const f of Object.keys(p.tf) as FieldName[]) {
            const tf = p.tf[f];
            if (!tf) continue;
            sc += FIELD_WEIGHT[f] * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * p.len) / this.avg)));
          }
          sc *= idf * wv;
          if (sc > (best.get(p.doc) ?? 0)) best.set(p.doc, sc);
          let a = acc.get(p.doc);
          if (!a) acc.set(p.doc, (a = { score: 0, terms: new Set(), matched: new Set(), cover: 0 }));
          a.terms.add(s);
          if (!a.matched.has(qi)) {
            a.matched.add(qi);
            a.cover += t.imp;
          }
        }
      }
      for (const [d, sc] of best) acc.get(d)!.score += sc;
    });
    const hits: SearchHit<T>[] = [];
    for (const [i, a] of acc) {
      const doc = this.docs[i];
      const cover = COVER_MIN + (1 - COVER_MIN) * Math.pow(a.cover / total, COVER_POW);
      hits.push({ doc, index: i, score: a.score * cover * (doc.boost ?? 1), terms: a.terms, matched: a.matched.size });
    }
    hits.sort((x, y) => y.score - x.score || x.index - y.index);
    return hits.slice(0, limit);
  }

  /** složené tvary slov textu, které odpovídají některému kmeni `terms` (zvýraznění, výběr věty) */
  static matchesIn(text: string, terms: Set<string>): number {
    let n = 0;
    for (const w of words(text)) {
      const s = stem(w);
      if (terms.has(s) || terms.has(w)) n++;
    }
    return n;
  }
}

/** bajty UTF-8 (bez TextEncoderu) */
export function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** zkrátí text na nejvýš `max` bajtů UTF-8 na hranici slova (s „…“) */
export function clipBytes(s: string, max: number): string {
  if (utf8Len(s) <= max) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    const b = utf8Len(ch);
    if (n + b > max - 3) break;
    out += ch;
    n += b;
  }
  const cut = out.replace(/\s+\S*$/, "");
  return (cut.length > out.length * 0.6 ? cut : out).replace(/[\s,;:·–-]+$/, "") + "…";
}
