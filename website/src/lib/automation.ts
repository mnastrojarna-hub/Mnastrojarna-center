/**
 * Režim automatizace: prohlížeč ovládá skript nebo AI agent (Playwright, Selenium, Puppeteer, rozšíření prohlížeče).
 * V tomto režimu CAD nikdy neotevírá systémová okna, která automatizace neumí obsloužit (dialog „Uložit jako“,
 * `window.prompt` / `confirm` / `alert`, dotaz při zavření karty) – soubory se stahují rovnou pod výchozím názvem
 * a dotazy jsou dialogy na stránce (`data-ask` – automatizace je přečte a odpoví).
 *
 * Zapne se sám, když prohlížeč hlásí `navigator.webdriver === true` (WebDriver, CDP – Playwright i Selenium), nebo
 * příznakem v adrese `?agent=1` (např. rozšíření prohlížeče, které webdriver nenastavuje). Příznak z adresy si karta
 * pamatuje (sessionStorage) – platí i po přechodu na jinou adresu v téže kartě (přepnutí jazyka /cad → /en/cad,
 * odkaz bez `?agent`); vypne ho `?agent=0`.
 */

const KEY = "mn-cad-agent";

/** úložiště karty (může chybět nebo vyhodit výjimku – soukromé okno, zakázaná data webu) */
function tabStore(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** zdroj režimu automatizace pro hlášky; null = běžný uživatel */
export function automationSource(): "webdriver" | "url" | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof navigator !== "undefined" && navigator.webdriver === true) return "webdriver";
    const q = new URLSearchParams(window.location.search);
    const st = tabStore();
    if (q.has("agent")) {
      const v = (q.get("agent") ?? "").toLowerCase();
      const on = v !== "0" && v !== "false" && v !== "ne" && v !== "off";
      try {
        if (on) st?.setItem(KEY, "1");
        else st?.removeItem(KEY);
      } catch {
        /* bez úložiště platí příznak jen pro tuto adresu */
      }
      return on ? "url" : null;
    }
    try {
      if (st?.getItem(KEY) === "1") return "url";
    } catch {
      /* bez úložiště = běžný režim */
    }
  } catch {
    /* bez přístupu k adrese = běžný režim */
  }
  return null;
}

/** ovládá prohlížeč automatizace / AI agent? (pak žádná systémová okna) */
export const isAutomation = () => automationSource() !== null;
