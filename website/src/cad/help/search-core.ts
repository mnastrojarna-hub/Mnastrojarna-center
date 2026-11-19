/**
 * Jádro fulltextového hledání v nápovědě (bez obsahu a bez závislostí – používá ho `nápověda hledat` v enginu, `mncad help
 * search` i pole Hledat na stránce dokumentace):
 *
 *   - slova bez diakritiky a bez velikosti písmen (`zalozky` = `záložky`), ß → ss, ø → o
 *   - lehké odřezání koncovek (čeština / angličtina / němčina: `záložky` ~ `záložka`, `zaoblit` ~ `zaoblení`, `tabs` ~ `tab`)
 *     a shoda začátkem slova (`sestav` → `sestava`, `sestavit`)
 *   - překlepy jako paleta příkazů: slovo, které v rejstříku není, se hledá s jednou chybou (od 5 znaků; od 9 znaků se dvěma –
 *     záměna, vynechání, přidání i prohození sousedních písmen)
 *   - synonyma a překlady (`glossary`: skupiny slov cs / en / de) s nižší vahou
 *   - BM25 po polích (název oddílu, příkazy, text, klíčová slova) × pokrytí dotazu (kolik slov dotazu úsek obsahuje)
 *
 * Výsledek je seřazený seznam úseků se skóre a se slovy, která se v úseku našla (pro výběr věty a zvýraznění).
 */

export type FieldName = "title" | "cmd" | "body" | "kw";
/** úsek textu k hledání: pole se slovy + libovolná data volajícího */
export type SearchDoc<T = unknown> = { fields: Partial<Record<FieldName, string>>; boost?: number; data: T };
export type SearchHit<T = unknown> = { doc: SearchDoc<T>; index: number; score: number; terms: Set<string>; matched: number };

const FIELD_WEIGHT: Record<FieldName, number> = { title: 2.4, cmd: 1.7, body: 1, kw: 1.3 };
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

const STOP = new Set(
  (
    "a i k o s u v z se si na do ze je jsou to ten ta ty tu ho mu mi me jak kde co kdy proc pro pri po od ve za by aby ale nebo ani jen tak uz lze muze mohu chci mam jde " +
    "ktery ktera ktere kterou jeho jej jejich tento tato toto tim tom jsem byt bude budou nez kdyz pak take tez az nejak " +
    "the an of to in on is are how do does can what which with for by it this that and or from into my me be use using want get " +
    "der die das den dem des ein eine einen einem einer und oder mit wie was im zu zum zur von auf ist sind kann ich man fur wo"
  ).split(" "),
);

/** koncovky k odřezání (nejdelší první); slovesné jen u slov od 6 znaků */
const SUFFIX = ["ovanim", "ovani", "ujici", "ovych", "ovymi", "atech", "etech", "acich", "ungen", "ings", "eni", "ani", "ost", "osti", "emu", "eho", "ych", "ymi", "imi", "ami", "ach", "ech", "ich", "ove", "ovy", "ova", "ovi", "ung", "ing", "ek", "ou", "em", "im", "ym", "om", "um", "en", "er", "es", "ed", "y", "a", "e", "i", "o", "u", "s", "n"].sort((a, b) => b.length - a.length);
const VERB = ["ovat", "it", "et", "at"];

/** lehký kmen složeného slova (bez diakritiky): odřízne jednu koncovku, kmen má aspoň 3 znaky */
export function stem(w: string): string {
  if (w.length < 4 || !/^[a-z]+$/.test(w)) return w;
  if (w.length >= 6) for (const s of VERB) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  for (const s of SUFFIX) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  return w;
}

/** slova textu (složená, bez stop slov, aspoň 2 znaky; čísla zůstanou – `m8`, `2d`, `7200`) */
export function words(s: string): string[] {
  const out: string[] = [];
  for (const m of foldText(s).matchAll(/[a-z0-9]+/g)) {
    const w = m[0];
    if (w.length < 2 || STOP.has(w)) continue;
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

/** skupiny synonym / překladů (slova se složí a odříznou na kmen) */
export type Glossary = readonly (readonly string[])[];

/** varianty jednoho slova dotazu: kmen rejstříku → váha (1 = přesně, synonymum / začátek / překlep méně) */
type Variants = Map<string, number>;

export class SearchIndex<T = unknown> {
  readonly docs: SearchDoc<T>[];
  private readonly post = new Map<string, Posting[]>();
  /** složené tvary slov rejstříku → kmen (překlepy se hledají mezi tvary) */
  private readonly forms = new Map<string, string>();
  private readonly lens: number[] = [];
  private readonly avg: number;
  private readonly syn = new Map<string, Set<string>>();

  constructor(docs: SearchDoc<T>[], glossary: Glossary = []) {
    this.docs = docs;
    docs.forEach((d, i) => {
      const tfs = new Map<string, Record<FieldName, number>>();
      let len = 0;
      for (const f of Object.keys(d.fields) as FieldName[]) {
        for (const w of words(d.fields[f] ?? "")) {
          const s = stem(w);
          if (!this.forms.has(w)) this.forms.set(w, s);
          let r = tfs.get(s);
          if (!r) tfs.set(s, (r = { title: 0, cmd: 0, body: 0, kw: 0 }));
          r[f]++;
          len += FIELD_WEIGHT[f];
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
      const stems = new Set(g.flatMap((x) => words(x).map(stem)));
      for (const s of stems) {
        let set = this.syn.get(s);
        if (!set) this.syn.set(s, (set = new Set()));
        for (const o of stems) if (o !== s) set.add(o);
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
    const out: Variants = new Map();
    const put = (s: string, v: number) => {
      if (this.post.has(s) && (out.get(s) ?? 0) < v) out.set(s, v);
    };
    const s = stem(w);
    put(s, 1);
    if (w !== s) put(w, 1);
    // synonyma / překlady (skupiny glosáře), i přes kmen dotazu
    for (const o of this.syn.get(s) ?? []) put(o, 0.85);
    for (const o of this.syn.get(w) ?? []) put(o, 0.85);
    // začátek slova: kmen dotazu je začátkem kmene rejstříku (od 4 znaků; 3znakový kmen jen u krátkých slov)
    if (s.length >= 3) {
      for (const k of this.post.keys()) {
        if (k === s || !k.startsWith(s)) continue;
        if (s.length >= 4 || k.length <= 5) put(k, s.length >= 5 ? 0.75 : 0.6);
      }
      // kmen rejstříku je začátkem slova dotazu (dotaz „zalozkami“ → „zalozk“)
      for (let n = s.length - 1; n >= Math.max(4, s.length - 3); n--) put(s.slice(0, n), 0.7);
    }
    // překlep: jen když slovo (ani kmen) v rejstříku není
    if (!out.size && w.length >= 5 && /^[a-z]+$/.test(w)) {
      const max = w.length >= 9 ? 2 : 1;
      for (const [f, fs] of this.forms) {
        if (Math.abs(f.length - w.length) > max || f[0] !== w[0]) continue;
        const d = editDistance(w, f, max);
        if (d <= max) put(fs, d === 1 ? 0.65 : 0.5);
      }
      for (const [f, fs] of this.forms) {
        if (out.size || Math.abs(f.length - w.length) > max || f[0] === w[0]) continue;
        if (editDistance(w, f, 1) <= 1) put(fs, 0.55);
      }
    }
    return out;
  }

  /** hledání: seřazené úseky (nejlepší první), `limit` = kolik nejvýš */
  search(query: string, limit = 50): SearchHit<T>[] {
    const qw = [...new Set(words(query))];
    if (!qw.length) return [];
    const vars = qw.map((w) => this.variants(w));
    const active = vars.filter((v) => v.size).length;
    if (!active) return [];
    const acc = new Map<number, { score: number; terms: Set<string>; matched: Set<number> }>();
    vars.forEach((v, qi) => {
      // nejlepší varianta slova dotazu v úseku (varianty se nesčítají – synonymum nepřebije přesnou shodu)
      const best = new Map<number, number>();
      for (const [s, wv] of v) {
        const idf = this.idf(s);
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
          if (!a) acc.set(p.doc, (a = { score: 0, terms: new Set(), matched: new Set() }));
          a.terms.add(s);
          a.matched.add(qi);
        }
      }
      for (const [d, sc] of best) acc.get(d)!.score += sc;
    });
    const hits: SearchHit<T>[] = [];
    for (const [i, a] of acc) {
      const cover = a.matched.size / active;
      const doc = this.docs[i];
      hits.push({ doc, index: i, score: a.score * cover * cover * (doc.boost ?? 1), terms: a.terms, matched: a.matched.size });
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
