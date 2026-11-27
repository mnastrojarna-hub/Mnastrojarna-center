/**
 * Pravidla textu 2D výkresu pro agenty (vlna 23, R1/R2/R4/R6 – stejná jako u výkresu dílu, cad/drawing-notes-rules.ts).
 *
 * Kdo je agent: textová cesta 2D výkresu = `applyDraftText` (příkazy `2d …` v enginu – konzole, CLI, HTTP, `window.mncad.run`
 * a `window.mncad.draft`) a 2D dokument z JSON řádku skriptu / setDocument. Příkazový řádek 2D editoru v GUI jde přímo přes
 * `runScriptAsync` (draft-cmdline.tsx) – člověk omezen není. Dokument otevřený ze souboru z disku (`otevřít`, CLI `--open`)
 * má text „loaded“ (D1): nikdy ✗, export neblokuje, ale export / načtení ohlásí ⚠ drawing.notes-loaded.
 *
 * Kontrola příkazu je rozdílová: příkaz agenta, který přidá nebo změní text tak, že porušuje pravidla (nebo zvýší počet řádků
 * nad limit), se nepřijme – model zůstane, jak byl, a protokol řekne ✗ s radou. Nový / změněný text dostane `by: "agent"`
 * (`stampDraftAgent`) – export 2D výkresu textovou cestou list s porušením agenta nezapíše (`draftExportGuard`).
 *
 * Kanály (D2 – všechno, co čtenář vidí): TEXT / MTEXT (odstavce `\P` i zalomení podle šířky) v modelu, na rozvrženích
 * i uvnitř definic bloků (× počet vložení bloku), definice atributů (výchozí hodnota), atributy vložení s libovolnou značkou
 * = volný text (nejvýš 5 řádků celého výkresu, heslovitě, bez údajů razítka a pokynů; štítek jen podle seznamu – „A-A“,
 * „Řez A-A“, „Detail B“, pozice „12“, oblast „Z1“, měřítko „1:2“); text kóty (náhrada hodnoty slovy = ✗); odkazy LEADER
 * = místní popis (nejvýš 8, krátce, bez údajů celého dílu); atributy razítka (technický pás TEPELNE / TVRDOST / POVRCH /
 * HRANY / TOLERANCE / DRSNOST a MATERIAL heslovitě, NAZEV / CISLO_VYKRESU / KRESLIL bez údajů razítka a pokynů).
 */
import { tr } from "../i18n";
import { classifyNote, DIM_TEXT_MAX, DRAFT_TEXT_TYPES, LEADER_MAX_CHARS, lineCount, NOTE_MAX_LEADERS, NOTE_MAX_LINES, noteStyle, processWords, TITLE_FREE_MAX, TITLE_VALUE_MAX, titleDataIn, titleDataLabel, type Origin, type TitleDataKey } from "../drawing-notes-rules";
import type { DraftEntity, DraftModel } from "./model";

/** atribut technického pásu razítka 2D výkresu pro pole razítka (R1) */
const TECH_TAG: Record<TitleDataKey, string> = { heatTreatment: "TEPELNE", hardness: "TVRDOST", surfaceTreatment: "POVRCH", edges: "HRANY", tolerance: "TOLERANCE", roughness: "DRSNOST", material: "MATERIAL" };
const TECH_TAGS = new Set(Object.values(TECH_TAG));
const FREE_TAGS = new Set(["NAZEV", "CISLO_VYKRESU", "KRESLIL", "KONTROLOVAL", "SCHVALIL", "DATUM", "REVIZE", "MERITKO", "LIST", "FORMAT", "FIRMA", "ZAKAZNIK", "PROJEKT", "HMOTNOST", "POCET"]);

/** text MTEXT bez formátovacích kódů, po odstavcích (`\P`) */
export function mtextLines(s: string): string[] {
  return s
    .split(/\\P/)
    .map((l) => l.replace(/\\[ACcFfHQTWpLlOoKk](?:[^;\\{}]*;)?/g, "").replace(/\\~/g, " ").replace(/[{}]/g, "").trim())
    .filter(Boolean);
}

/**
 * Štítek, který poznámkou není (D2 – výslovný seznam, ne „každé krátké slovo“): označení řezu / pohledu / detailu („A“,
 * „A-A“, „Řez A-A“, „Detail B“), číslo pozice („12“, „Poz. 3“), oblast úpravy („Z1“), měřítko („1:2“, „M 2:1“).
 * „Kalit“, „HRC60“, „±0,1“ ani „Odmastit“ štítkem nejsou.
 */
export const isLabel = (t: string): boolean => /^[A-Z](?:\s*[-–]\s*[A-Z])?$/.test(t) || /^(?:řez|rez|detail|pohled|section|view|schnitt|ansicht|einzelheit)\s+[A-Z]{1,2}\d?(?:\s*[-–]\s*[A-Z]{1,2}\d?)?(?:\s*\(\s*\d+\s*:\s*\d+\s*\))?$/i.test(t) || /^\d{1,3}$/.test(t) || /^(?:poz|pos|pozice|position)\.?\s*\d{1,3}$/i.test(t) || /^Z\d{1,2}$/.test(t) || /^(?:M\s*)?\d{1,3}\s*:\s*\d{1,3}$/.test(t);

/** blok razítka rozvržení (cad/draft/layout/sheets.ts TITLE_BLOCK) */
const TITLE_BLOCK_NAME = "ISO7200_TITLE";

type Item = { key: string; text: string; kind: "free" | "leader" | "attr" | "dim"; tag?: string; lines: number; by: Origin; measurement?: number };

const byOf = (e: { by?: Origin }): Origin => e.by ?? "user";
type X = DraftEntity & { s?: string; w?: number; h?: number; text?: string; attribs?: { tag: string; value: string }[]; block?: string; def?: string; tag?: string; measurement?: number; kind?: string };

/** řádky TEXT / MTEXT (zalomení podle šířky rámečku MTEXT: přibližně 0,6 × výška na znak) */
function textItem(e: X): { text: string; lines: number } | null {
  const ls = e.type === "mtext" ? mtextLines(e.s ?? "") : [String(e.s ?? "").trim()].filter(Boolean);
  const text = ls.join("\n");
  if (!text || (ls.length === 1 && isLabel(ls[0]))) return null;
  const perLine = e.type === "mtext" && (e.w ?? 0) > 0 && (e.h ?? 0) > 0 ? Math.max(8, Math.floor((e.w ?? 0) / ((e.h ?? 2.5) * 0.6))) : Infinity;
  return { text, lines: ls.reduce((n, l) => n + Math.max(lineCount(l), Number.isFinite(perLine) ? Math.ceil(l.length / perLine) : 1), 0) };
}

/** všechny texty 2D výkresu (model + rozvržení + definice bloků × počet vložení) */
function itemsOf(m: DraftModel): Item[] {
  const out: Item[] = [];
  const spaces: { space: string; list: DraftEntity[] }[] = [{ space: "model", list: m.entities }, ...(m.layouts ?? []).map((l) => ({ space: `layout:${l.id}`, list: l.entities }))];
  // počet vložení každého bloku (model, rozvržení i vnořené bloky – vnořené jednou za každé vložení nadřazeného)
  const inserts = new Map<string, number>();
  const countIn = (list: DraftEntity[], k: number, depth: number) => {
    for (const e of list) {
      const x = e as X;
      if (e.type !== "insert" || !x.block) continue;
      const n = k * Math.max(1, ((e as { cols?: number }).cols ?? 1) * ((e as { rows?: number }).rows ?? 1));
      inserts.set(x.block, (inserts.get(x.block) ?? 0) + n);
      const b = m.blocks?.find((q) => q.name === x.block);
      if (b && depth < 8) countIn(b.entities, n, depth + 1);
    }
  };
  for (const { list } of spaces) countIn(list, 1, 0);
  // definice razítka rozvržení (popisky buněk „Název“, „Materiál“ …) poznámkou není – hodnoty nesou atributy vložení
  const lists = [...spaces.map((s) => ({ ...s, mult: 1 })), ...(m.blocks ?? []).filter((b) => b.name !== TITLE_BLOCK_NAME).map((b) => ({ space: `block:${b.name}`, list: b.entities, mult: inserts.get(b.name) ?? 0 }))];
  for (const { space, list, mult } of lists) {
    for (const e of list) {
      const x = e as X;
      const by = byOf(x);
      const key = `${space}|${e.id}`;
      if (e.type === "text" || e.type === "mtext") {
        const t = textItem(x);
        if (t && mult > 0) out.push({ key, text: t.text, kind: "free", lines: t.lines * mult, by });
      } else if (e.type === "attdef") {
        // definice atributu: výchozí hodnota se ukáže v každém vložení (v modelu je vidět sama)
        const v = String(x.def ?? "").trim();
        if (v && !isLabel(v) && (mult > 0 || !space.startsWith("block:"))) out.push({ key, text: v, kind: TECH_TAGS.has(x.tag ?? "") || FREE_TAGS.has(x.tag ?? "") ? "attr" : "free", tag: x.tag, lines: lineCount(v) * Math.max(1, mult), by });
      } else if (e.type === "leader" && x.text) {
        const text = mtextLines(x.text).join(" ");
        if (text && mult > 0) out.push({ key, text, kind: "leader", lines: 0, by });
      } else if (e.type === "dimension" && x.text?.trim() && x.text.trim() !== "<>") {
        out.push({ key, text: x.text.trim(), kind: "dim", lines: 0, by, ...(typeof x.measurement === "number" ? { measurement: x.measurement } : {}) });
      } else if (e.type === "insert" && x.attribs?.length) {
        for (const a of x.attribs) {
          const v = (a.value ?? "").trim();
          if (!v || v === "—" || v === "–" || isLabel(v)) continue;
          const k = `${key}|${a.tag}`;
          if (a.tag === "POZNAMKA") {
            if (/^(?:rozměry v mm|dimensions in mm|maße in mm)$/i.test(v)) continue;
            out.push({ key: k, text: v, kind: "free", tag: a.tag, lines: lineCount(v), by });
          } else if (TECH_TAGS.has(a.tag) || FREE_TAGS.has(a.tag)) out.push({ key: k, text: v, kind: "attr", tag: a.tag, lines: 0, by });
          // atribut s jinou značkou (POZN2, NOTE …) je volný text na výkrese (D2)
          else out.push({ key: k, text: v, kind: "free", tag: a.tag, lines: lineCount(v), by });
        }
      }
    }
  }
  return out;
}

export type DraftNotesFinding = { key: string; text: string; count?: number; by: Origin; code: "drawing.notes-limit" | "drawing.leaders-limit" | "drawing.note-style" | "drawing.note-title-data" };

/** rada, kam s údajem razítka ve 2D */
const titleHint2d = (keys: TitleDataKey[]) => tr("do razítka rozvržení: 2d upravit-atributy <razítko> {0} (nebo 2d rozvržení nové … {0})", keys.map((k) => `${TECH_TAG[k]}="…"`).join(" "));
const mix = (bs: Origin[]): Origin => (bs.includes("agent") ? "agent" : bs.includes("loaded") ? "loaded" : "user");

/** text kóty zakryl hodnotu: nemá „<>“ ani číslo, nebo nese čísla bez naměřené hodnoty */
function dimHides(text: string, measurement?: number): boolean {
  if (text.includes("<>")) return false;
  const nums = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => parseFloat(x[0].replace(",", ".")));
  if (!nums.length) return true;
  return measurement !== undefined && !nums.some((n) => Math.abs(n - measurement) <= Math.max(0.051, measurement * 1e-3));
}

/** nálezy pravidel textu 2D výkresu (klíč položky; `count` = limit řádků / popisů; `by` = původ) */
export function draftNotesAudit(m: DraftModel): DraftNotesFinding[] {
  const items = itemsOf(m);
  const out: DraftNotesFinding[] = [];
  const free = items.filter((i) => i.kind === "free");
  const total = free.reduce((n, i) => n + i.lines, 0);
  if (total > NOTE_MAX_LINES) out.push({ key: "limit", count: total, by: mix(free.map((i) => i.by)), code: "drawing.notes-limit", text: tr("2D výkres by měl {0} řádků volného textu (nejvýš {1}): {2} – údaje celého dílu do razítka (technický pás), popis plochy krátce odkazem, nadbytečné smažte", total, NOTE_MAX_LINES, free.slice(0, 6).map((i) => `„${i.text.replace(/\s+/g, " ").slice(0, 28)}“`).join(" · ")) });
  const leaders = items.filter((i) => i.kind === "leader");
  if (leaders.length > NOTE_MAX_LEADERS) out.push({ key: "leaders", count: leaders.length, by: mix(leaders.map((i) => i.by)), code: "drawing.leaders-limit", text: tr("2D výkres by měl {0} odkazů s popisem (nejvýš {1}) – slučte popisy stejné úpravy, údaje celého dílu dejte do razítka", leaders.length, NOTE_MAX_LEADERS) });
  for (const i of items) {
    const f = (code: DraftNotesFinding["code"], text: string) => out.push({ key: i.key, text, by: i.by, code });
    if (i.kind === "free") {
      const cls = classifyNote(i.text.replace(/\n/g, "; "));
      if (cls?.parts.length) {
        f("drawing.note-title-data", tr("„{0}“ obsahuje údaj razítka ({1}) – {2}", i.text.replace(/\s+/g, " ").slice(0, 60), cls.parts.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(cls.parts.map((p) => p.key))));
        continue;
      }
      const bad = i.text.split("\n").map((l) => [l, noteStyle(l)] as const).find(([, w]) => w);
      if (bad) f("drawing.note-style", tr("„{0}“ není heslovitý: {1} – zkraťte (strojařsky, bez vět)", bad[0].slice(0, 60), bad[1]!));
    } else if (i.kind === "leader") {
      const why = noteStyle(i.text, LEADER_MAX_CHARS, 5);
      const bad = classifyNote(i.text)?.parts.filter((p) => p.key !== "edges" && p.key !== "roughness") ?? [];
      if (why) f("drawing.note-style", tr("odkaz „{0}“ není heslovitý: {1} – popis u plochy krátce (např. „Brousit“)", i.text.slice(0, 40), why));
      else if (bad.length) f("drawing.note-title-data", tr("odkaz „{0}“ obsahuje údaj celého dílu ({1}) – {2}", i.text.slice(0, 40), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(bad.map((p) => p.key))));
    } else if (i.kind === "dim") {
      // D2: text kóty = hodnota (s „<>“ nebo číslem) a nanejvýš krátká tolerance – ne poznámka, ne údaj razítka
      const why = noteStyle(i.text, DIM_TEXT_MAX, 4);
      const bad = titleDataIn(i.text, ["tolerance"]);
      const pw = processWords(i.text);
      if (why) f("drawing.note-style", tr("text kóty „{0}“: {1} – u kóty jen hodnota a tolerance, ne poznámka", i.text.slice(0, 40), why));
      else if (bad.length) f("drawing.note-title-data", tr("text kóty „{0}“ obsahuje údaj razítka ({1}) – {2}", i.text.slice(0, 40), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(bad.map((p) => p.key))));
      else if (pw.length) f("drawing.note-style", tr("text kóty „{0}“ je pokyn („{1}“) – u kóty jen hodnota a tolerance", i.text.slice(0, 40), pw[0]));
      else if (dimHides(i.text, i.measurement)) f("drawing.note-style", tr("text kóty „{0}“ nahrazuje naměřenou hodnotu – ponechte „<>“ nebo číslo rozměru", i.text.slice(0, 40)));
    } else {
      const tech = TECH_TAGS.has(i.tag!);
      const why = noteStyle(i.text, tech ? TITLE_VALUE_MAX : TITLE_FREE_MAX, tech ? 5 : 8);
      const bad = !tech ? titleDataIn(i.text) : [];
      const pw = !tech ? processWords(i.text) : [];
      if (why) f("drawing.note-style", tr("atribut razítka {0} „{1}“: {2} – hodnota buňky heslovitě", i.tag!, i.text.slice(0, 40), why));
      else if (bad.length) f("drawing.note-title-data", tr("atribut razítka {0} „{1}“ obsahuje údaj jiného pole ({2}) – {3}", i.tag!, i.text.slice(0, 40), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(bad.map((p) => p.key))));
      else if (pw.length) f("drawing.note-style", tr("atribut razítka {0} „{1}“ je pokyn („{2}“) – buňka nese jméno / číslo, pokyny na výkres nepatří", i.tag!, i.text.slice(0, 40), pw[0]));
    }
  }
  return out;
}

/** textová podoba položek (klíč → text) – co příkaz změnil */
const itemMap = (m: DraftModel) => new Map(itemsOf(m).map((i) => [i.key, `${i.text}|${i.lines}`]));

/**
 * Porušení, která příkaz agenta způsobil (nová / změněná položka s nálezem, limit, který příkaz zvýšil nebo kterého se
 * agent nově účastní) – prázdné = v pořádku.
 */
export function draftNotesGuard(before: DraftModel, after: DraftModel): DraftNotesFinding[] {
  const fb = draftNotesAudit(before);
  const ib = itemMap(before);
  const ia = itemMap(after);
  return draftNotesAudit(after).filter((f) => {
    if (f.count !== undefined) {
      const p = fb.find((x) => x.key === f.key);
      return !p || f.count > (p.count ?? 0);
    }
    return ia.get(f.key) !== ib.get(f.key);
  });
}

/** podpis textu entity (změna textu = nový zápis agenta) */
const sig = (e: DraftEntity): string => {
  const x = e as X & { prompt?: string };
  return JSON.stringify([x.s, x.text, x.def, x.tag, x.prompt, x.attribs?.map((a) => [a.tag, a.value])]);
};

/**
 * Po příkazu agenta: nové a textově změněné textové entity (model, rozvržení, definice bloků) dostanou `by: "agent"` – export
 * textovou cestou pak pozná text agenta (D1). Nezměněné entity si původ nechají.
 */
export function stampDraftAgent(before: DraftModel, after: DraftModel): DraftModel {
  const prev = new Map<string, string>();
  const reg = (space: string, list?: DraftEntity[]) => list?.forEach((e) => DRAFT_TEXT_TYPES.has(e.type) && prev.set(`${space}|${e.id}`, sig(e)));
  reg("model", before.entities);
  before.layouts?.forEach((l) => reg(`layout:${l.id}`, l.entities));
  before.blocks?.forEach((b) => reg(`block:${b.name}`, b.entities));
  let changed = false;
  const st = (space: string, list: DraftEntity[]) =>
    list.map((e) => {
      if (!DRAFT_TEXT_TYPES.has(e.type) || e.by === "agent" || prev.get(`${space}|${e.id}`) === sig(e)) return e;
      changed = true;
      return { ...e, by: "agent" as const };
    });
  const out: DraftModel = {
    ...after,
    entities: st("model", after.entities),
    ...(after.layouts ? { layouts: after.layouts.map((l) => ({ ...l, entities: st(`layout:${l.id}`, l.entities) })) } : {}),
    ...(after.blocks ? { blocks: after.blocks.map((b) => ({ ...b, entities: st(`block:${b.name}`, b.entities) })) } : {}),
  };
  return changed ? out : after;
}

/** export 2D výkresu textovou cestou: porušení agenta (`bad` – export se odmítne) a text načteného souboru (`loaded` – ⚠) */
export function draftExportGuard(m: DraftModel): { bad: DraftNotesFinding[]; loaded: DraftNotesFinding[] } {
  const all = draftNotesAudit(m);
  return { bad: all.filter((f) => f.by === "agent"), loaded: all.filter((f) => f.by === "loaded") };
}

/** řádek stavu 2D výkresu: „Poznámky nad razítkem: 2/5 řádků · odkazy s popisem 1/8“ (+ nálezy agenta / načteného souboru) */
export function draftNotesLine(m: DraftModel): string {
  const items = itemsOf(m);
  const all = draftNotesAudit(m);
  const ag = all.filter((f) => f.by === "agent").length;
  const ld = all.filter((f) => f.by === "loaded").length;
  const tail = [ag ? tr("✗ porušení agenta {0}", ag) : "", ld ? tr("⚠ ze souboru {0}", ld) : ""].filter(Boolean).join(", ");
  return tr("Poznámky nad razítkem: {0}/{1} řádků · odkazy s popisem {2}/{3}", items.filter((i) => i.kind === "free").reduce((n, i) => n + i.lines, 0), NOTE_MAX_LINES, items.filter((i) => i.kind === "leader").length, NOTE_MAX_LEADERS) + (tail ? ` · ${tail}` : "");
}
