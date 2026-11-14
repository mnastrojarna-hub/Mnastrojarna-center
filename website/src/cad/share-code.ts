/**
 * Krátký kód sdíleného odkazu (`https://mnastrojarna.cz/s#Ab3kZ9xQ2m`) – jen konstanty bez závislostí, aby je mohly
 * použít i serverové stránky (skript, který část za # odloží dřív, než se načte aplikace) a sdílení (share.ts).
 */
/** abeceda kódu: base58 bez 0 O I l (dá se přečíst nahlas i opsat) */
export const SHARE_CODE_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SHARE_CODE_LEN = 10;
/** znaková třída abecedy pro regulární výrazy */
export const SHARE_CODE_CLASS = "[1-9A-HJ-NP-Za-km-z]";
/**
 * Co messenger, věta nebo kopírování přilepí za odkaz („…#Ab3kZ9xQ2m).“, uvozovky, hvězdičky, mezera, lomítko…) – cokoli,
 * co není písmeno ani číslice základní abecedy; ignoruje se. (Prohlížeč některé znaky v adrese zakóduje – `>` na `%3E`,
 * uvozovku na `%22` –, proto se část za # před porovnáním dekóduje.)
 */
const TRAIL = "[^0-9A-Za-z]*";
/** zdroj regulárního výrazu pro (dekódovanou) část adresy za # tvořenou jen kódem (1. skupina = kód); bez úvodního # */
export const SHARE_CODE_HASH_SRC = `^(${SHARE_CODE_CLASS}{${SHARE_CODE_LEN}})${TRAIL}$`;
/** parametr adresy, kterým přesměrování z `/s` řekne stránce CADu „příjemce přišel zadat kód“ (`/s` → `/cad?kod=1`) */
export const SHARE_ASK_PARAM = "kod";
/** klíč sessionStorage s odloženou částí adresy za # (sdílený odkaz otevřený v této kartě – F5 ho otevře znovu) */
export const SHARE_STASH_KEY = "mn-cad-share";

/**
 * Skript stránky CADu (běží už při načtení HTML): sdílený odkaz (`#<KÓD>`, `#q=…`, `#s=…`, `#r=…`) hned odloží do
 * sessionStorage a z adresy odstraní, aby se nedostal do historie prohlížeče ani do měření návštěvnosti (dokument pod NDA).
 * S odloženým odkazem z adresy zmizí i parametr `kod` (přišel-li příjemce přes `/s#KÓD`), takže `?kod=1` v adrese
 * zůstane jen tehdy, když kód chybí – a aplikace se na něj zeptá (share-entry.ts).
 * Na nezabezpečené adrese (http:// – prohlížeč tam nemá šifrování WebCrypto, odkaz by nešel otevřít) stránku se sdíleným
 * odkazem nebo s žádostí o zadání kódu (`?kod=1` z `/s`) rovnou přepne na https:// (část za # zůstane); jen na výchozím
 * portu – místní vývojový server na http://localhost je zabezpečený kontext a nepřepíná se.
 */
export const SHARE_STASH_SCRIPT = `try{var l=location,h=l.hash,d=h;try{d=decodeURIComponent(h)}catch(e){}var c=/^#(${SHARE_CODE_CLASS}{${SHARE_CODE_LEN}})${TRAIL}$/.exec(d),s=/^#[sqr]=/.test(h);if((c||s||/[?&]${SHARE_ASK_PARAM}=1(&|$)/.test(l.search))&&l.protocol==='http:'&&window.isSecureContext===false&&!l.port){l.replace('https://'+l.host+l.pathname+l.search+h)}else if(c||s){sessionStorage.setItem('${SHARE_STASH_KEY}',c?'#'+c[1]:h);history.replaceState(null,'',l.pathname+l.search.replace(/[?&]${SHARE_ASK_PARAM}=1(?=&|$)/,'').replace(/^&/,'?'))}}catch(e){}`;
