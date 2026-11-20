/**
 * Opakovaný běh skriptu (vlna E, balík runs): volba za názvem nového dokumentu `nový díl "A" znovu|nový`
 * (EN `new part "A" again|new`, DE `neues Teil "A" erneut|neu`).
 *
 * Pravidlo (engine/runs.ts, pro všechny dokumenty běhu): `nový díl "A"` / `nová sestava "A"` použije záložku „A“ stejného
 * druhu, kterou založil DŘÍVĚJŠÍ běh příkazem, který dokument vytváří (ne `otevřít` / JSON), a tento běh ji ještě nepoužil –
 * obsah nahradí prázdným dokumentem (jeden krok historie) a ohlásí to (ℹ `doc.reused`, v konzoli věta na řádku ✓).
 * Opakované spuštění téhož skriptu tak nezaloží druhou sadu záložek.
 * * `znovu` (again / erneut) = použít i záložku „A“ jiného původu (otevřený soubor, JSON, ruční práce, `--open`);
 * * `nový` (new / neu) = vždy nová záložka (dnešní chování – dvě záložky stejného názvu);
 * * bez názvu (`nový díl`) = vždy nový dokument s číslovaným výchozím názvem („Nový díl 2“) – nic se znovu nepoužije.
 *
 * Volba platí jen jako POSLEDNÍ slovo bez uvozovek a jen za názvem (`nový díl znovu` = díl s názvem „znovu“); název,
 * který tím slovem končí, patří do uvozovek (`nový díl "Kryt nový"`).
 */
export type NewDocMode = "reuse" | "new";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** slova volby (bez diakritiky, malými písmeny) */
const MODE_WORDS: Record<string, NewDocMode> = {
  znovu: "reuse",
  again: "reuse",
  reuse: "reuse",
  erneut: "reuse",
  wieder: "reuse",
  novy: "new",
  nova: "new",
  nove: "new",
  new: "new",
  neu: "new",
  neue: "new",
  neues: "new",
  neuer: "new",
};

/** slova řádku s příznakem uvozovek (stejný rozklad jako `tokenize` v agent.ts) */
function quotedTokens(line: string): { s: string; quoted: boolean }[] {
  const out: { s: string; quoted: boolean }[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ s: m[1] ?? m[2] ?? m[3] ?? m[4], quoted: m[4] === undefined });
  return out;
}

/**
 * Název a volba řádku `nový díl …` / `nová sestava …` (řádek bez komentáře): slova za příkazem a druhem dokumentu
 * (`nový` `díl`), poslední slovo bez uvozovek `znovu` / `nový` (a EN / DE tvary) je volba, je-li před ním název.
 */
export function newDocTail(line: string): { name: string; mode?: NewDocMode } {
  const rest = quotedTokens(line).slice(2);
  const last = rest[rest.length - 1];
  const mode = rest.length >= 2 && last && !last.quoted ? MODE_WORDS[fold(last.s)] : undefined;
  const words = mode ? rest.slice(0, -1) : rest;
  return { name: words.map((t) => t.s).join(" ").trim(), ...(mode ? { mode } : {}) };
}
