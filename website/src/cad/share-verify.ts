/**
 * Ověření sdíleného odkazu textem (vlna 22, bod 16): `odkaz ověřit [<odkaz|kód>] [heslo X]` (EN `link verify`, DE `link
 * prüfen`) – stejně v konzoli prohlížeče, ve `window.mncad.run` i v `mncad run`. Odkaz se otevře tak, jak ho otevře
 * příjemce (stažení z úložiště hostitele odkazu, dešifrování, rozbalení, kontrola dokumentu a platnosti), a vrátí se:
 *  - u funkčního odkazu režim (self / store / link), platnost, pohled a obsah (`ShareContent`: komponenty, díly, listy,
 *    přílohy) – nic se neotevírá ani nemění;
 *  - u nefunkčního odkazu důvod: `truncated` (useknutý – obsah končí předčasně), `corrupt` (změněný), `password` (chybí
 *    / nesprávné heslo), `expired`, `revoked`, `notfound`, `network`, `insecure`, `unrecognized` (text není odkaz ani kód).
 * Úložiště pro odkaz s kódem / `#q=` = `<origin odkazu>/cad/share/` (odkaz z jiného webu se ověří u svého webu), u samotného
 * kódu úložiště hostitele (`selfStoreBase`).
 */
import { tr } from "./i18n";
import { openErrorText, openShareLink, parseShareInput, SELF_STORE_PATH, shareCodeProblem, type OpenResult, type ParsedShare, type ShareDamage, type ShareMode, type ShareView } from "./share";
import { shareContent, type ShareContent } from "./engine/share-content";

export type VerifyReason = Extract<OpenResult, { ok: false }>["reason"] | ShareDamage | "unrecognized";
export type VerifyResult =
  | { ok: true; url: string; chars: number; kind: ParsedShare["kind"]; mode: ShareMode; exp: string | null; view: ShareView; from?: string; content: ShareContent }
  | { ok: false; url: string; chars: number; kind?: ParsedShare["kind"]; reason: VerifyReason; text: string; exp?: string | null };

const isoDay = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : null);

/** úložiště, u kterého se odkaz ověří: `<origin>/cad/share/` webu, ze kterého odkaz je; samotný kód → výchozí (undefined) */
export function storeForLink(text: string): string | undefined {
  const m = /https?:\/\/[^\s/#?]+/i.exec(text);
  if (!m) return undefined;
  try {
    return new URL(m[0]).origin + SELF_STORE_PATH;
  } catch {
    return undefined;
  }
}

/** Ověří odkaz (viz záhlaví). `password` = heslo odkazu; `store` = vynucené úložiště (testy). */
export async function verifyShareLink(text: string, o: { password?: string; store?: string | null } = {}): Promise<VerifyResult> {
  const url = String(text ?? "").trim();
  const parsed = parseShareInput(url);
  if (!parsed) {
    const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : url;
    const code = shareCodeProblem(hash, url.includes("#"));
    // `#s=` bez rozpoznatelné hlavičky / data = useknutý hned za # (hlavička 1d. / 1r. chybí nebo je neúplná)
    if (/[#&]s=1?[dr]?p?\.?$/.test(url) || /[#&]s=$/.test(url)) return { ok: false, url, chars: url.length, reason: "truncated", text: tr("Odkaz je useknutý – za #s= chybí data dokumentu ({0} znaků odkazu).", url.length) };
    return { ok: false, url, chars: url.length, reason: "unrecognized", text: code ?? tr("Text není sdílený odkaz Mnástrojárna CAD ani kód odkazu (čeká se …/s#KÓD, …/cad#s=…, …/cad#q=… nebo desetimístný kód).") };
  }
  const store = o.store !== undefined ? o.store : storeForLink(url);
  const r = await openShareLink(parsed, o.password, store !== undefined ? { store } : {});
  if (r.ok) {
    const p = r.payload;
    return { ok: true, url, chars: url.length, kind: parsed.kind, mode: r.mode, exp: isoDay(p.exp), view: p.view ?? "model", ...(p.from ? { from: p.from } : {}), content: shareContent(p.doc) };
  }
  const reason: VerifyReason = r.reason === "invalid" && r.damage ? r.damage : r.reason;
  const t = r.reason === "password" && !o.password ? tr("Odkaz je chráněný heslem – ověřte ho s heslem: odkaz ověřit <odkaz> heslo <heslo>.") : openErrorText(r.reason, r.exp, parsed.kind, r);
  return { ok: false, url, chars: url.length, kind: parsed.kind, reason, text: t, ...(r.exp !== undefined ? { exp: isoDay(r.exp) } : {}) };
}
