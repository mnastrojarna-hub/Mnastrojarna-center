/**
 * Pravidla textu 2D výkresu pro agenty (vlna 23, R1/R2/R4/R6 – stejná jako u výkresu dílu, cad/drawing-notes-rules.ts).
 *
 * Kdo je agent: textová cesta 2D výkresu = `applyDraftText` (příkazy `2d …` v enginu – konzole, CLI, HTTP, `window.mncad.run`
 * a `window.mncad.draft`). Příkazový řádek 2D editoru v GUI jde přímo přes `runScriptAsync` (draft-cmdline.tsx) – člověk
 * omezen není. Kontrola je rozdílová: příkaz agenta, který přidá nebo změní text tak, že porušuje pravidla (nebo zvýší
 * počet řádků nad limit), se nepřijme – model zůstane, jak byl, a protokol řekne ✗ s radou. Text, který v modelu už byl
 * (ruční), příkaz agenta nezastaví, jen se počítá do limitu.
 *
 * Kanály: TEXT / MTEXT (odstavce `\P` i zalomení podle šířky) v modelu i na rozvrženích = volný text (nejvýš 5 řádků
 * celého výkresu, heslovitě, bez údajů razítka; krátký štítek – „A–A“, „Z1“, „DETAIL B“ – se nepočítá), odkazy LEADER
 * = místní popis (nejvýš 8, krátce, bez údajů celého dílu), atributy razítka (technický pás TEPELNE / TVRDOST / POVRCH /
 * HRANY / TOLERANCE / DRSNOST a MATERIAL heslovitě, NAZEV bez údajů razítka, POZNAMKA = řádek volného textu).
 */
import { tr } from "../i18n";
import { classifyNote, LEADER_MAX_CHARS, lineCount, NOTE_MAX_LEADERS, NOTE_MAX_LINES, noteStyle, TITLE_FREE_MAX, TITLE_VALUE_MAX, titleDataLabel, type TitleDataKey } from "../drawing-notes-rules";
import type { DraftEntity, DraftModel } from "./model";

/** atribut technického pásu razítka 2D výkresu pro pole razítka (R1) */
const TECH_TAG: Record<TitleDataKey, string> = { heatTreatment: "TEPELNE", hardness: "TVRDOST", surfaceTreatment: "POVRCH", edges: "HRANY", tolerance: "TOLERANCE", roughness: "DRSNOST", material: "MATERIAL" };
const TECH_TAGS = new Set(Object.values(TECH_TAG));
const FREE_TAGS = new Set(["NAZEV", "CISLO_VYKRESU", "KRESLIL"]);

/** text MTEXT bez formátovacích kódů, po odstavcích (`\P`) */
export function mtextLines(s: string): string[] {
  return s
    .split(/\\P/)
    .map((l) => l.replace(/\\[ACcFfHQTWpLlOoKk](?:[^;\\{}]*;)?/g, "").replace(/\\~/g, " ").replace(/[{}]/g, "").trim())
    .filter(Boolean);
}

/** krátký štítek (označení řezu, detailu, oblasti) – není poznámka */
const isLabel = (t: string) => /^\S{1,10}$/.test(t) || /^(?:řez|detail|pohled|section|view|schnitt|ansicht|einzelheit)\s+\S{1,4}(?:\s*[-–]\s*\S{1,4})?$/i.test(t);

type Item = { key: string; text: string; kind: "free" | "leader" | "attr"; tag?: string; lines: number };

/** všechny texty 2D výkresu (model + rozvržení; bloky jen přes atributy vložení) */
function itemsOf(m: DraftModel): Item[] {
  const out: Item[] = [];
  const lists: { space: string; list: DraftEntity[] }[] = [{ space: "model", list: m.entities }, ...(m.layouts ?? []).map((l) => ({ space: `layout:${l.id}`, list: l.entities }))];
  for (const { space, list } of lists) {
    for (const e of list) {
      const x = e as DraftEntity & { s?: string; w?: number; h?: number; text?: string; attribs?: { tag: string; value: string }[]; block?: string };
      if (e.type === "text" || e.type === "mtext") {
        const ls = e.type === "mtext" ? mtextLines(x.s ?? "") : [String(x.s ?? "").trim()].filter(Boolean);
        const text = ls.join("\n");
        if (!text || (ls.length === 1 && isLabel(ls[0]))) continue;
        // zalomení podle šířky rámečku MTEXT: přibližně 0,6 × výška na znak
        const perLine = e.type === "mtext" && (x.w ?? 0) > 0 && (x.h ?? 0) > 0 ? Math.max(8, Math.floor((x.w ?? 0) / ((x.h ?? 2.5) * 0.6))) : Infinity;
        const lines = ls.reduce((n, l) => n + Math.max(lineCount(l), Number.isFinite(perLine) ? Math.ceil(l.length / perLine) : 1), 0);
        out.push({ key: `${space}|${e.id}`, text, kind: "free", lines });
      } else if (e.type === "leader" && x.text) {
        const text = mtextLines(x.text).join(" ");
        if (text) out.push({ key: `${space}|${e.id}`, text, kind: "leader", lines: 0 });
      } else if (e.type === "insert" && x.attribs?.length) {
        for (const a of x.attribs) {
          const v = (a.value ?? "").trim();
          if (!v || v === "—" || v === "–") continue;
          if (a.tag === "POZNAMKA") {
            if (/^(?:rozměry v mm|dimensions in mm|maße in mm)$/i.test(v)) continue;
            out.push({ key: `${space}|${e.id}|${a.tag}`, text: v, kind: "free", tag: a.tag, lines: lineCount(v) });
          } else if (TECH_TAGS.has(a.tag) || FREE_TAGS.has(a.tag)) out.push({ key: `${space}|${e.id}|${a.tag}`, text: v, kind: "attr", tag: a.tag, lines: 0 });
        }
      }
    }
  }
  return out;
}

export type DraftNotesFinding = { key: string; text: string; count?: number };

/** rada, kam s údajem razítka ve 2D */
const titleHint2d = (keys: TitleDataKey[]) => tr("do razítka rozvržení: 2d upravit-atributy <razítko> {0} (nebo 2d rozvržení nové … {0})", keys.map((k) => `${TECH_TAG[k]}="…"`).join(" "));

/** nálezy pravidel textu 2D výkresu (klíč položky; `count` = limit řádků / popisů) */
export function draftNotesAudit(m: DraftModel): DraftNotesFinding[] {
  const items = itemsOf(m);
  const out: DraftNotesFinding[] = [];
  const free = items.filter((i) => i.kind === "free");
  const total = free.reduce((n, i) => n + i.lines, 0);
  if (total > NOTE_MAX_LINES) out.push({ key: "limit", count: total, text: tr("2D výkres by měl {0} řádků volného textu (nejvýš {1}): {2} – údaje celého dílu do razítka (technický pás), popis plochy krátce odkazem, nadbytečné smažte", total, NOTE_MAX_LINES, free.slice(0, 6).map((i) => `„${i.text.replace(/\s+/g, " ").slice(0, 28)}“`).join(" · ")) });
  const leaders = items.filter((i) => i.kind === "leader");
  if (leaders.length > NOTE_MAX_LEADERS) out.push({ key: "leaders", count: leaders.length, text: tr("2D výkres by měl {0} odkazů s popisem (nejvýš {1}) – slučte popisy stejné úpravy, údaje celého dílu dejte do razítka", leaders.length, NOTE_MAX_LEADERS) });
  for (const i of items) {
    if (i.kind === "free") {
      const cls = classifyNote(i.text.replace(/\n/g, "; "));
      if (cls?.parts.length) {
        out.push({ key: i.key, text: tr("„{0}“ obsahuje údaj razítka ({1}) – {2}", i.text.replace(/\s+/g, " ").slice(0, 60), cls.parts.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(cls.parts.map((p) => p.key))) });
        continue;
      }
      const bad = i.text.split("\n").map((l) => [l, noteStyle(l)] as const).find(([, w]) => w);
      if (bad) out.push({ key: i.key, text: tr("„{0}“ není heslovitý: {1} – zkraťte (strojařsky, bez vět)", bad[0].slice(0, 60), bad[1]!) });
    } else if (i.kind === "leader") {
      const why = noteStyle(i.text, LEADER_MAX_CHARS, 5);
      const bad = classifyNote(i.text)?.parts.filter((p) => p.key !== "edges" && p.key !== "roughness") ?? [];
      if (why) out.push({ key: i.key, text: tr("odkaz „{0}“ není heslovitý: {1} – popis u plochy krátce (např. „Brousit“)", i.text.slice(0, 40), why) });
      else if (bad.length) out.push({ key: i.key, text: tr("odkaz „{0}“ obsahuje údaj celého dílu ({1}) – {2}", i.text.slice(0, 40), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(bad.map((p) => p.key))) });
    } else {
      const tech = TECH_TAGS.has(i.tag!);
      const why = noteStyle(i.text, tech ? TITLE_VALUE_MAX : TITLE_FREE_MAX, tech ? 5 : 8);
      const bad = !tech ? (classifyNote(i.text)?.parts ?? []) : [];
      if (why) out.push({ key: i.key, text: tr("atribut razítka {0} „{1}“: {2} – hodnota buňky heslovitě", i.tag!, i.text.slice(0, 40), why) });
      else if (bad.length) out.push({ key: i.key, text: tr("atribut razítka {0} „{1}“ obsahuje údaj jiného pole ({2}) – {3}", i.tag!, i.text.slice(0, 40), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint2d(bad.map((p) => p.key))) });
    }
  }
  return out;
}

/** textová podoba položek (klíč → text) – co příkaz změnil */
const itemMap = (m: DraftModel) => new Map(itemsOf(m).map((i) => [i.key, i.text]));

/**
 * Porušení, která příkaz agenta způsobil (nová / změněná položka s nálezem, limit, který příkaz zvýšil) – prázdné = v pořádku.
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

/** řádek stavu 2D výkresu: „Poznámky nad razítkem: 2/5 řádků · odkazy 1/8“ */
export function draftNotesLine(m: DraftModel): string {
  const items = itemsOf(m);
  return tr("Poznámky nad razítkem: {0}/{1} řádků · odkazy s popisem {2}/{3}", items.filter((i) => i.kind === "free").reduce((n, i) => n + i.lines, 0), NOTE_MAX_LINES, items.filter((i) => i.kind === "leader").length, NOTE_MAX_LEADERS);
}
