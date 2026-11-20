/**
 * Tokeny řádku se zachováním uvozovek pro obecný rozbor voleb (agent.ts `parseOpts`): text v uvozovkách je DOSLOVNÝ – název
 * záložky „D“, přezdívka „H“, „V“, „na“, „jako“… Obecný rozbor uvozovky nezná a takový text četl jako klíčové slovo
 * (D = průměr, H = výška, V = poloha), takže `vložit "Q" jako "H"` končilo „chybí přezdívka“ a `vložit "D"` „chybí název“.
 * Každý text v uvozovkách se proto před rozborem nahradí zástupným tokenem (není číslo ani klíčové slovo) a po rozboru
 * se vrátí (`restore`). Text bez uvozovek se čte jako dřív.
 */
const RE = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
const MARK = "\u0001";

export function literalTokens(line: string): { tokens: string[]; restore: (t: string) => string } {
  const tokens: string[] = [];
  const lit: string[] = [];
  for (const m of line.matchAll(RE)) {
    const quoted = m[1] ?? m[2] ?? m[3];
    if (quoted === undefined) tokens.push(m[4]);
    else tokens.push(`${MARK}${lit.push(quoted) - 1}${MARK}`);
  }
  const one = new RegExp(`^${MARK}(\\d+)${MARK}$`);
  return { tokens, restore: (t) => ((k) => (k ? lit[Number(k[1])] : t))(one.exec(t)) };
}
