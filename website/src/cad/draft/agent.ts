/**
 * 2D výkres pro AI agenty: textové příkazy `2d …` (cs), `2d …` / `draft …` (en), `2d …` / `zeichnen …` (de)
 * a JavaScript API `window.mncad.draft(text)` se strukturovaným výsledkem. Příkaz za předponou je libovolný příkaz
 * 2D výkresu (jako na příkazovém řádku: `2d čára 0,0 100,0 @0,50`), více příkazů na řádku odděluje „;“.
 */
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import "./index";
import { runScriptAsync, splitScript, tokenize } from "./commands";
import { draftLine, draftUndoLine, setDraftStatusHook } from "./prefix";
import { emptyDraftDoc, isDraftDoc, normalizeDraftDoc } from "./doc";
import { pruneSelection, sessionFor, type DraftCmdResult } from "./session";
import { draftStatus, draftStatusText, type DraftStatus } from "./status";
import { parseUnits } from "./units";
import type { DraftModel, DraftUnits } from "./model";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

const NEW = ["novy", "nova", "new", "neu"];

export { draftLine, draftUndoLine };

/** sběr strukturovaných výsledků pro window.mncad.draft */
let collector: DraftCmdResult[] | null = null;
/** běh window.mncad.draft změnil dokument (počká se na jeho zápis v aplikaci) */
let collectorChanged = false;

export type DraftApplyResult = { doc: CadDoc; changed: boolean; newDoc?: CadDoc; log: string[]; results: DraftCmdResult[] };

/**
 * Provede text 2D příkazů nad dokumentem (bez GUI). `2d nový [název] [mm|cm|m|in]` založí nový výkres (newDoc –
 * aplikace ho otevře v nové záložce); ostatní příkazy pracují s otevřeným 2D výkresem.
 */
export async function applyDraftText(doc: CadDoc, text: string): Promise<DraftApplyResult> {
  const log: string[] = [];
  const results: DraftCmdResult[] = [];
  let cur = doc;
  let newDoc: CadDoc | undefined;
  let changed = false;
  for (const line of splitScript(text)) {
    const t = tokenize(line);
    if (NEW.includes(fold(t[0] ?? ""))) {
      let units: DraftUnits | undefined;
      const nameParts: string[] = [];
      for (const w of t.slice(1)) {
        const u = parseUnits(w);
        if (u) units = u;
        else nameParts.push(w);
      }
      newDoc = emptyDraftDoc(nameParts.join(" ") || tr("Nový 2D výkres"), { units });
      cur = newDoc;
      log.push(tr("✓ nový 2D výkres „{0}“ ({1}) – nová záložka", newDoc.name, newDoc.draft!.vars.units));
      continue;
    }
    if (!isDraftDoc(cur)) {
      const msg = tr("otevřený dokument „{0}“ není 2D výkres – nejdřív „2d nový“ nebo přepněte na záložku s 2D výkresem", cur.name);
      log.push(`✗ ${msg}`);
      results.push({ cmd: t[0] ?? "", input: line, ok: false, log: [], error: msg, created: [], changed: [], deleted: [] });
      continue;
    }
    const model = cur.draft as DraftModel;
    const s = sessionFor(model);
    const r = await runScriptAsync(model, s, line, { interactive: false });
    const res = r.results[0];
    results.push(...r.results);
    if (res) {
      if (res.ok) log.push(...(res.log.length ? res.log : [tr("✓ {0}", res.cmd)]));
      else log.push(`✗ ${res.cmd}: ${res.error}`);
      const nm = res.data?.newModel as DraftModel | undefined;
      if (nm) {
        newDoc = normalizeDraftDoc({ ...emptyDraftDoc(String(res.data?.name ?? tr("Výkres"))), draft: nm });
        cur = newDoc;
        delete res.data!.newModel;
        continue;
      }
    }
    if (r.model !== model) {
      cur = { ...cur, draft: r.model };
      if (!newDoc) changed = true;
      else newDoc = cur;
      pruneSelection(s, r.model);
    }
  }
  if (collector) {
    collector.push(...results);
    collectorChanged = collectorChanged || changed || !!newDoc;
  }
  return { doc: newDoc ? doc : cur, changed, newDoc, log, results };
}

/** výsledek window.mncad.draft */
export type DraftApiResult = { ok: boolean; log: string; results: DraftCmdResult[]; status: DraftStatus | null; doc: string };

/**
 * window.mncad.draft(text): každý řádek / příkaz za „;“ je 2D příkaz (předpona „2d“ se doplní). Provede se stejnou cestou
 * jako textové příkazy (historie, nová záložka) a vrátí strukturované výsledky + stav výkresu.
 */
export async function draftApi(text: string, run: (t: string) => Promise<string>, getDoc: () => CadDoc): Promise<DraftApiResult> {
  const lines = splitScript(text).map((l) => (draftLine(l) !== null ? l : `2d ${l}`));
  collector = [];
  collectorChanged = false;
  const before = getDoc();
  let log = "";
  try {
    log = await run(lines.join("\n"));
  } finally {
    // výsledky se sbírají i při výjimce
  }
  const results = collector ?? [];
  collector = null;
  // zápis do dokumentu se v aplikaci projeví až po vykreslení – počkat (nejvýš 2 s), ať stav odpovídá výsledkům
  const changes = collectorChanged;
  for (let i = 0; changes && i < 80 && getDoc() === before; i++) await new Promise((r) => setTimeout(r, 25));
  const d = getDoc();
  return {
    ok: results.every((r) => r.ok) && !/^✗/m.test(log),
    log,
    results,
    status: isDraftDoc(d) ? draftStatus(d.draft, sessionFor(d.draft)) : null,
    doc: d.name,
  };
}

/** textový stav 2D dokumentu (konec protokolu textových příkazů, stav v konzoli) */
export function draftDocStatus(d: CadDoc): string {
  return isDraftDoc(d) ? draftStatusText(d.draft, sessionFor(d.draft), d.name) : "";
}

setDraftStatusHook(draftDocStatus);

/** window.mncad.draftImport: DXF / DWG jako nový 2D výkres (otevře ho aplikace) */
export async function draftImportApi(file: { name: string; base64?: string; text?: string }, open: (d: CadDoc) => void): Promise<{ ok: boolean; note: string; status: DraftStatus }> {
  const { draftImport, fromB64 } = await import("./io");
  const bytes = file.base64 !== undefined ? fromB64(file.base64) : new TextEncoder().encode(file.text ?? "");
  const r = await draftImport(file.name, bytes);
  const d = normalizeDraftDoc({ ...emptyDraftDoc(file.name.replace(/\.[^.]+$/, "")), draft: r.model });
  open(d);
  return { ok: true, note: r.note, status: draftStatus(d.draft!, sessionFor(d.draft!)) };
}
