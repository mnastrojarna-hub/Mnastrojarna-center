/**
 * Akce „Tabulka ozubení“ bez UI (vlna 19, balík text): tabulky ozubení kol aktivního dílu jako řádky protokolu. Volá ji
 * engine přímo (`ExtDef.report` akce `gear.table`, engine/ops/api.ts) – stejný výpis v aplikaci i v CLI; tlačítko v UI ji
 * zobrazí v okně (components/cad/ext/gears-text-ui.ts). Čistá funkce, bez jádra.
 */
import { gearTablesOf, gearTableText } from "./gears/data";
import { kindOfExt } from "./gears/registry";
import { tr } from "./i18n";
import type { CadDoc } from "./types";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/**
 * Tabulky ozubení kol aktivního dílu jako řádky protokolu. `arg` = "" poslední kolo dílu, "*" všechna, jinak název kola.
 * Prázdný díl / neznámý název = chyba s výčtem kol (nikdy tiše).
 */
export function gearTableReport(doc: Pick<CadDoc, "features" | "kind" | "name">, arg = ""): string[] {
  if (doc.kind === "assembly" || doc.kind === "draft") throw new Error(tr("tabulka ozubení: „{0}“ není díl – přepněte na záložku dílu s kolem", doc.name));
  const tables = gearTablesOf(doc);
  const all = doc.features.filter((f) => f.type === "ext" && !f.suppressed && kindOfExt(f.ext));
  if (!tables.length) throw new Error(all.length ? tr("tabulka ozubení: kola v dílu „{0}“ mají neplatné zadání – opravte je (stav prvku)", doc.name) : tr("tabulka ozubení: v dílu „{0}“ není žádné kolo – vytvořte ho příkazem kolo <druh> …", doc.name));
  let pick = tables;
  if (arg === "*") pick = tables;
  else if (arg) {
    pick = tables.filter((t) => fold(t.name) === fold(arg));
    if (!pick.length) throw new Error(tr("tabulka ozubení: kolo „{0}“ v dílu není – kola: {1}", arg, tables.map((t) => `„${t.name}“`).join(", ")));
  } else pick = [tables[tables.length - 1]];
  const out: string[] = [];
  for (const t of pick) {
    const f = doc.features.find((x) => x.id === t.featureId);
    out.push(...gearTableText(t.name, t.ext, f && f.type === "ext" ? (f.data ?? {}) : {}));
  }
  if (!arg && tables.length > 1) out.push(tr("(v dílu je {0} kol – všechna: kolo tabulka vše)", tables.length));
  return out;
}

