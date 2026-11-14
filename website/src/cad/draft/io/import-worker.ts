/**
 * Pracovní vlákno importu DWG / DXF: čtení velkých souborů neblokuje okno (průběh, Zrušit = ukončení vlákna).
 * Zpráva { name, bytes, lang } → { t: "p", stage, f } (průběh) … { t: "done", model, note, format, version } | { t: "err", msg }.
 */
import { setLang, type CadLang } from "../../i18n";
import { draftFromFile } from "./files";

type Req = { name: string; bytes: Uint8Array; lang?: CadLang };

self.onmessage = (ev: MessageEvent<Req>) => {
  const { name, bytes, lang } = ev.data;
  if (lang) setLang(lang); // hlášky (varování, chyby) v jazyce rozhraní
  try {
    let last = 0;
    const r = draftFromFile(name, bytes, (stage, f) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      (self as unknown as Worker).postMessage({ t: "p", stage, f });
    });
    (self as unknown as Worker).postMessage({ t: "done", model: r.model, note: r.note, format: r.format, version: r.version });
  } catch (e) {
    (self as unknown as Worker).postMessage({ t: "err", msg: (e as Error)?.message ?? String(e) });
  }
};
