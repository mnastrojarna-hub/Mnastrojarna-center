/**
 * Sdílený odkaz z enginu (CAD-HEADLESS-NAVRH.md kap. 3.4, balík B3): příkaz `sdílet` v konzoli i v CLI, `--share` CLI /
 * HTTP. Tvar odkazu a šifrování zůstává v share.ts (`createShareLink`); tady je jen volba cesty a hlášky protokolu:
 *
 *  - `auto` (výchozí `sdílet`, `--share`): krátký odkaz přes úložiště (Supabase → vlastní úložiště hostitele); úložiště
 *    nedostupné → dlouhý odkaz a ⚠ `share.fallback-link`; úložiště zápis odmítlo (403, limit…) → ✗ `share.rejected`
 *    s důvodem serveru a ⚠ `share.fallback-link` s dlouhým odkazem; úložiště vypnuté (`--share-store off`) → dlouhý
 *    odkaz bez ⚠ (jiná možnost není);
 *  - `store` (`sdílet úložiště`): jen krátký odkaz – nedostupné úložiště = ✗ `share.store-unavailable`, odmítnutí =
 *    ✗ `share.rejected`, žádný tichý dlouhý odkaz; s `nebo odkaz` (`orLink`) místo toho dlouhý odkaz s ⚠;
 *  - `link` (`sdílet odkazem`): celý dokument v odkazu.
 * Odkaz delší než 4096 znaků (prohlížeč agenta v cloudu delší adresu odmítne) dostane ⚠ `share.long-link` s délkou.
 * Popis režimu `mode=self|store|link` je ze skutečného výsledku (`ShareResult.mode`). Platnost delší, než úložiště dovolí
 * (90 dní), se zkrátí s ⚠ `share.days-clamped`; `sdílet úložiště bez omezení` je ✗ `share.days-unlimited` bez dotazu na
 * úložiště. Úložiště, které při nahrávání přestane odpovídat (časový limit share.ts `uploadTimeoutMs`), je nedostupné
 * úložiště, ne odmítnutí (`store`: ✗ `share.store-unavailable`, `auto`: ⚠ `share.fallback-link`). Texty uvádějí adresu
 * úložiště, na které se šlo.
 */
import { tr } from "../i18n";
import { createShareLink, probeSelfStore, SELF_STORE_PATH, selfStoreBase, selfStoreProbeError, shareStoreConfigured, storeDownText, storeUnavailable, type ShareMode, type ShareOptions, type ShareResult, type ShareView } from "../share";
import type { CadDoc } from "../types";
import type { Code, CodeEntryInit } from "./codes";
import type { ShareInfo } from "./protocol-types";

/** nejdelší adresa, kterou přijme prohlížeč agenta v cloudu (polní zpráva 959) */
export const LINK_BROWSER_MAX = 4096;
/** nejdelší platnost v úložišti Supabase (share.ts `asStore`) a výchozí u vlastního úložiště bez `max_days` */
const STORE_MAX_DAYS = 90;

/* ───────────────────────── poslední odkaz (`odkaz`, window.mncad.share) ───────────────────────── */

export type LastLink = {
  url: string;
  mode: ShareMode;
  bytes: number;
  exp: number | null;
  name: string;
  view: ShareView;
  password: boolean;
  /** kód krátkého odkazu (část za #, vlna 16) */
  code?: string;
  note?: string;
  /** co odkaz obsahuje (vlna 22, bod 16 – engine/share-content.ts) */
  content?: import("./share-content").ShareContent;
};
let lastLink: LastLink | null = null;
/** poslední sdílený odkaz (příkaz „odkaz“); zapisuje i window.mncad.share() */
export const rememberLink = (l: LastLink) => void (lastLink = l);
export const lastShareLink = () => lastLink;
/** zapomene poslední odkaz (testy) */
export const forgetLastLink = () => void (lastLink = null);

/** odkaz pro protokol (řádek O, JSON `share`) */
export const shareInfo = (l: Pick<LastLink, "url" | "mode" | "bytes" | "exp" | "note">): ShareInfo => ({
  url: l.url,
  mode: l.mode,
  bytes: l.bytes,
  exp: l.exp ? new Date(l.exp).toISOString().slice(0, 10) : null,
  ...(l.note ? { note: l.note } : {}),
});

/* ───────────────────────── volba cesty ───────────────────────── */

export type ShareWant = "auto" | "store" | "link";
export type ShareRequest = {
  days: number | null;
  password?: string;
  from?: string;
  view: ShareView;
  want: ShareWant;
  /** `nebo odkaz`: selže-li úložiště, dlouhý odkaz s ⚠ místo ✗ */
  orLink?: boolean;
  /** stránka, na kterou odkaz vede (výchozí stránka / hostitel) */
  base?: string;
  /** vlastní úložiště (`https://…/cad/share/`, null = žádné; výchozí hostitel / prostředí) */
  store?: string | null;
};
/** hláška protokolu k odkazu (kód z registru + argumenty / vlastní text) */
export type ShareNote = { code: Code } & Pick<CodeEntryInit, "args" | "text">;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** text ⚠ share.fallback-link: proč, a jak dlouhý je náhradní odkaz */
const fallbackText = (r: ShareResult, why: string) =>
  tr("krátký odkaz se nepodařil – použit dlouhý odkaz ({0} znaků{1}): {2}", r.url.length, r.url.length > LINK_BROWSER_MAX ? tr(", prohlížeč agenta v cloudu přijme nejvýš {0}", LINK_BROWSER_MAX) : "", why);

/**
 * Vytvoří odkaz podle `q.want` (viz záhlaví) a hlášky předá `note`. Vrací výsledek, nebo null, když odkaz nevznikl
 * (✗ už je v `note`). Chyby, které nemají náhradu (prázdný / příliš velký dokument), vyhodí.
 */
export async function shareWithPolicy(doc: CadDoc, q: ShareRequest, note: (n: ShareNote) => void): Promise<ShareResult | null> {
  const r = await sharePolicy(doc, q, note);
  // odkaz bez komprese (prostředí bez deflate-raw) nikdy tiše – ℹ share.uncompressed (soupis 5.2 č. 34)
  if (r && /#s=1r\./.test(r.url)) note({ code: "share.uncompressed" });
  return r;
}

async function sharePolicy(doc: CadDoc, q: ShareRequest, note: (n: ShareNote) => void): Promise<ShareResult | null> {
  const opts: ShareOptions = {
    days: q.days,
    view: q.view,
    ...(q.password ? { password: q.password } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.base ? { base: q.base } : {}),
    ...(q.store !== undefined ? { store: q.store } : {}),
  };
  const long = (r: ShareResult) => {
    if (r.mode === "link" && r.url.length > LINK_BROWSER_MAX) note({ code: "share.long-link", args: [r.url.length] });
    return r;
  };
  const asLink = () => createShareLink(doc, { ...opts, mode: "link" });
  if (q.want === "link") return long(await asLink());
  // bez omezení platnosti nemůže být dokument v úložišti (createShareLink to řekne v `note`)
  if (q.want === "auto" && q.days === null) return long(await createShareLink(doc, opts));
  const fallback = q.want === "auto" || !!q.orLink;
  // `sdílet úložiště bez omezení`: odporující si volby – rozhodne se bez dotazu na úložiště (nejde o odmítnutí serverem)
  if (q.days === null) {
    if (!fallback) {
      note({ code: "share.days-unlimited", args: [STORE_MAX_DAYS] });
      return null;
    }
    const r = await asLink();
    note({ code: "share.fallback-link", text: fallbackText(r, tr("bez omezení platnosti nemůže být odkaz v úložišti")) });
    return r;
  }
  // adresa úložiště, na které se jde (CLI --share-store, hostitel, prostředí, stránka) – do textů hlášek
  const where = (q.store !== undefined ? q.store : selfStoreBase()) ?? SELF_STORE_PATH;
  // úložiště vypnuté (CLI --share-store off, hostitel bez úložiště): dlouhý odkaz je jediná možnost – bez ⚠ fallback
  const configured = shareStoreConfigured() || !!(q.store !== undefined ? q.store : selfStoreBase());
  if (!configured) {
    if (!fallback) {
      note({ code: "share.store-unavailable", text: tr("úložiště krátkých odkazů není nastavené") });
      return null;
    }
    // vypnuté úložiště (CLI --share-store off) je vidět – ℹ s délkou odkazu, ne tichý dlouhý odkaz (vlna 22, bod 16)
    const r = long(await asLink());
    note({ code: "share.store-off", args: [r.url.length] });
    return r;
  }
  const info = shareStoreConfigured() ? null : await probeSelfStore(false, q.store);
  if (!shareStoreConfigured() && !info) {
    const why = storeDownText(where);
    if (!fallback) {
      note({ code: "share.store-unavailable", text: why });
      return null;
    }
    const r = await asLink();
    note({ code: "share.fallback-link", text: fallbackText(r, why) });
    return r;
  }
  try {
    const r = await createShareLink(doc, { ...opts, mode: "store" });
    // platnost zkrácená úložištěm (share.ts `storeDays`) – výsledek se liší od zadání → ⚠
    const max = info?.maxDays ?? STORE_MAX_DAYS;
    if (typeof q.days === "number" && Math.round(q.days) > max) note({ code: "share.days-clamped", args: [max, q.days] });
    return r;
  } catch (e) {
    const unavailable = storeUnavailable(e);
    // důvod z `?ping` (HTTP stav, chyba serveru) se připojí, není-li už v textu chyby (share.ts `withReason`)
    const probe = unavailable ? selfStoreProbeError() : "";
    const msg = errText(e);
    const why = unavailable ? `${msg} (${where})${probe && !msg.includes(probe) ? ` – ${probe}` : ""}` : msg;
    // nedostupné při nahrávání = jako nedostupné při ?ping: ✗ jen bez náhrady; odmítnutí serverem je ✗ vždy
    if (!unavailable) note({ code: "share.rejected", args: [why] });
    else if (!fallback) note({ code: "share.store-unavailable", text: why });
    if (!fallback) return null;
    const r = await asLink();
    note({ code: "share.fallback-link", text: fallbackText(r, why) });
    return r;
  }
}
