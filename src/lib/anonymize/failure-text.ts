/**
 * Technická chyba běhu anonymizace → česká hláška pro uživatele (čistá funkce).
 * Surová (anglická) zpráva patří jen do logu serveru — nikdy do anon_reason, odznaku ani tooltipu.
 */
export function userFacingFailure(message: string, fmt: string | null): string {
  const m = String(message ?? "");
  const jsError = /TypeError|ReferenceError|RangeError|Cannot read|undefined|is not a function|\bnull\b/i.test(m);
  if (/password|encrypt/i.test(m)) return "PDF je zaheslované — nejde otevřít. Požádej o soubor bez hesla.";
  if (/stáhnout|nemá uloženou cestu|Object not found/i.test(m)) return "Soubor se nepodařilo načíst z úložiště — zkus Anonymizovat znovu.";
  // české hlášky jádra („Písmo se nevykreslilo…", „Soubor je větší než 50 MB") projdou beze změny
  if (/[ěščřžýáíéůúňťď]/i.test(m) && !jsError) return m;
  if (fmt === "pdf") return "PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.";
  if (/429|overloaded|rate.?limit/i.test(m)) return "AI je teď přetížená — zkusí se znovu za chvíli (nebo Anonymizovat znovu).";
  return "Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.";
}
