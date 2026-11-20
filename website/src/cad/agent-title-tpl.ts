/**
 * Pojmenované šablony hlavičky textem (vlna 22, bod 22j) – čistý parser:
 * - `výkres hlavička` – přehled šablon (dokument, Nastavení, výchozí, šablona listu),
 * - `výkres hlavička uložit "Firma" [výchozí] [pole=…]` – uloží razítko aktivního listu (druh, logo, firma, …) jako šablonu do
 *   dokumentu i Nastavení; s poli = šablona z polí (logo="soubor.svg" | data URL, šablona=nástrojářská, firma="…"),
 * - `výkres hlavička použít "Firma"` – razítko listu podle šablony (= `výkres razítko šablona="Firma"`),
 * - `výkres hlavička smazat "Firma"`.
 * EN `drawing title-template [save|use|delete] …` (`header`), DE `zeichnung kopfvorlage [speichern|verwenden|löschen] …`.
 */
import type { RawTok } from "./agent-drawing";
import { titleFieldOf, type TitleCmdField } from "./agent-title";
import { tr } from "./i18n";

export type TplCmd = { op: "tpl"; act: "list" } | { op: "tpl"; act: "save"; name: string; setDefault: boolean; fields: Partial<Record<TitleCmdField, string>> } | { op: "tpl"; act: "use" | "delete"; name: string };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w);
export const TPL_W = W("hlavicka", "hlavicky", "sablonahlavicky", "sablona-hlavicky", "title-template", "titletemplate", "header", "headertemplate", "kopfvorlage", "schriftfeldvorlage", "kopf");
const SAVE_W = W("ulozit", "uloz", "save", "store", "speichern");
const USE_W = W("pouzit", "pouzij", "use", "apply", "verwenden", "anwenden");
const DEL_W = W("smazat", "smaz", "odstranit", "delete", "remove", "loschen", "loeschen", "entfernen");
const DEF_W = W("vychozi", "default", "standard", "standardmassig");

export const TPL_USE = () => tr("výkres hlavička · výkres hlavička uložit \"název\" [výchozí] [šablona=… logo=\"soubor.svg\" firma=\"…\" …] · výkres hlavička použít \"název\" · výkres hlavička smazat \"název\"");

/** `výkres hlavička …` (tokeny za slovem výkres) → povel; null = jiný podpříkaz */
export function parseTplText(rt: RawTok[]): TplCmd | null {
  const h = rt[0];
  if (!h || h.q || h.key || !TPL_W.has(fold(h.s))) return null;
  const a = rt[1];
  if (!a) return { op: "tpl", act: "list" };
  const w = a.q || a.key ? "" : fold(a.s);
  const act = SAVE_W.has(w) ? "save" : USE_W.has(w) ? "use" : DEL_W.has(w) ? "delete" : null;
  if (!act) throw new Error(tr("výkres hlavička: neznámé „{0}“ – {1}", a.key ? `${a.key}=` : a.s, TPL_USE()));
  const rest = rt.slice(2);
  const nameTok = rest.find((t) => !t.key && !(act === "save" && !t.q && DEF_W.has(fold(t.s))));
  const name = nameTok?.s.trim() ?? "";
  if (!name) throw new Error(tr("výkres hlavička {0}: chybí název šablony v uvozovkách – {1}", a.s, TPL_USE()));
  if (act !== "save") {
    if (rest.length > 1) throw new Error(TPL_USE());
    return { op: "tpl", act, name };
  }
  const fields: Partial<Record<TitleCmdField, string>> = {};
  let setDefault = false;
  for (const t of rest) {
    if (t === nameTok) continue;
    if (!t.key && !t.q && DEF_W.has(fold(t.s))) {
      setDefault = true;
      continue;
    }
    const f = t.key ? titleFieldOf(t.key) : undefined;
    if (!f) throw new Error(tr("výkres hlavička uložit: neznámé „{0}“ – {1}", t.key ? `${t.key}=` : t.s, TPL_USE()));
    fields[f] = t.s;
  }
  return { op: "tpl", act: "save", name, setDefault, fields };
}
