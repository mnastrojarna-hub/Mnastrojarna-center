/**
 * Otisk CELÉHO dokumentu (vlna 22 kolo 7, bod 12 – oprava po oponentuře): zrušený běh vrací dřívější záložku do stavu před
 * svým prvním zápisem jen tehdy, když od posledního zápisu běhu záložku nikdo jiný nezměnil. Revize modelu (`modelRev`) na to
 * nestačí – je to otisk geometrie a změnu výkresů, vazeb, razítka, materiálu, názvu … nevidí; vrácení by ji tiše zahodilo.
 * Tady se porovnává celý dokument (JSON, FNV-1a 64 bitů ve dvou 32bitových polovinách) – jakákoli změna = jiný otisk.
 */
import type { CadDoc } from "../types";

export function docSig(doc: CadDoc): string {
  let s: string;
  try {
    s = JSON.stringify(doc) ?? "";
  } catch {
    return `x${Math.random()}`; // nejde serializovat (cyklus) – nikdy se neshoduje = nic se nevrací (bezpečná strana)
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${s.length.toString(36)}.${h1.toString(36)}.${h2.toString(36)}`;
}
