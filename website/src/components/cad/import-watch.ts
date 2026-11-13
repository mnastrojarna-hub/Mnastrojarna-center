/**
 * Otevření souboru až po zobrazení modelu: místo okamžitého „Model importován“ se čeká na výsledek jádra a teprve pak se
 * ohlásí úspěch (s dobou a velikostí sítě), prázdný výsledek nebo srozumitelná chyba. Díly sestav se načítají po dávkách,
 * aby se obraz objevil hned a přibýval (sestava STEP 46 MB: první obraz za pár sekund, ne po minutách).
 */
import { cadLocale, tr } from "@/cad/i18n";
import { cad } from "@/cad/client";
import { blobOf, isBlobRef } from "@/cad/blobs";
import { perfMark } from "@/cad/perf-log";
import { uid, type AsmComponent, type BuildResult, type CadDoc, type ComponentSource } from "@/cad/types";

/** čekající otevření souboru: `docId` záložky, do které se otevřel; u dílu id prvku Import */
export type PendingImport = { docId: string; name: string; t0: number; kind: "part" | "asm"; featureId?: string; bytes: number };

export type ImportOutcome = { ok: true; text: string } | { ok: false; title: string; body: string };

const mb = (n: number) => (n / 1048576).toLocaleString(cadLocale(), { maximumFractionDigits: 1 });
const secs = (ms: number) => (ms / 1000).toLocaleString(cadLocale(), { maximumFractionDigits: 1 });

/** hláška při začátku načítání (velikost souboru, model se počítá) */
export const importStartText = (name: string, bytes: number) =>
  bytes > 2 * 1048576 ? tr("Načítám {0} ({1} MB) – model se počítá, průběh a Zrušit jsou dole.", name, mb(bytes)) : tr("Načítám {0}…", name);

/** Výsledek stavby dílu s importem → hláška (úspěch až když je co zobrazit). */
export function partImportOutcome(res: BuildResult, p: PendingImport): ImportOutcome {
  const st = p.featureId ? res.status.find((s) => s.id === p.featureId) : undefined;
  if (st && !st.ok) return { ok: false, title: tr("Soubor {0} se nepodařilo otevřít", p.name), body: st.error ?? tr("Chyba CAD jádra.") };
  const tris = res.mesh ? res.mesh.triangles.length / 3 : 0;
  if (!res.mesh || !tris) return { ok: false, title: tr("Soubor {0} neobsahuje nic k zobrazení", p.name), body: tr("Jádro soubor přečetlo, ale nevzniklo žádné těleso ani plocha (prázdný soubor, jen křivky nebo body). Zkontrolujte export ve zdrojovém programu (STEP AP214, tělesa).") };
  return { ok: true, text: tr("Model {0} zobrazen za {1} s ({2} trojúhelníků) – můžete na něj navázat dalšími prvky.", p.name, secs(Date.now() - p.t0), tris.toLocaleString(cadLocale())) };
}

/** Výsledek načtení všech dílů sestavy → hláška. */
export function asmImportOutcome(results: (BuildResult | undefined)[], p: PendingImport): ImportOutcome {
  const total = results.length;
  const failed = results.filter((r) => !r?.mesh || !r.mesh.triangles.length);
  const errors = [...new Set(results.flatMap((r) => r?.status.filter((s) => !s.ok).map((s) => s.error ?? "") ?? []).filter(Boolean))];
  if (total && failed.length === total) return { ok: false, title: tr("Sestavu {0} se nepodařilo zobrazit", p.name), body: errors.slice(0, 3).join("\n") || tr("Žádný díl sestavy neobsahuje geometrii.") };
  const tris = results.reduce((s, r) => s + (r?.mesh ? r.mesh.triangles.length / 3 : 0), 0);
  const base = tr("Sestava {0} zobrazena za {1} s: {2} komponent, {3} trojúhelníků.", p.name, secs(Date.now() - p.t0), total, Math.round(tris).toLocaleString(cadLocale()));
  if (failed.length) return { ok: true, text: base + " " + tr("{0} dílů se nepodařilo načíst: {1}", failed.length, errors.slice(0, 2).join("; ")) };
  return { ok: true, text: base };
}

/** Sestava jako podsestava (vložení sestavy STEP do otevřené sestavy). */
export const subassemblyComponent = (doc: CadDoc): AsmComponent => ({ id: uid(), name: doc.name, source: { kind: "asm", doc: { ...doc, kind: "assembly" } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, group: "Podsestavy" });

/** Komponenta ze souboru → díl s prvkem Import (přesné těleso k modelování v nové záložce). */
export function fileComponentAsPart(c: AsmComponent): CadDoc | null {
  const s = c.source;
  if (s.kind !== "file") return null;
  return { app: "mnastrojarna-cad", version: 2, name: c.name, material: c.material ?? "ocel", kind: "part", color: c.color, features: [{ id: uid(), name: `Import ${s.fileName}`, type: "import", fileName: s.fileName, format: s.format, data: s.data }] };
}

// ---------------- díly sestavy po dávkách ----------------

/** klíče, které se právě načítají (opakované spuštění efektu je nepožádá znovu) */
const inflight = new Set<string>();
const sizeOf = (s: ComponentSource): number => (s.kind === "file" ? (isBlobRef(s.data) ? (blobOf(s.data)?.length ?? 0) : s.data.length * 0.75) : 50_000);

/** Rozdělí díly na dávky: první malá (rychlý první obraz), další do ~3 MB dat nebo 16 dílů. */
export function chunkParts<T extends { source: ComponentSource }>(parts: T[], first = 4, maxBytes = 3 * 1048576, maxParts = 16): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const p of parts) {
    const lim = out.length === 0 ? first : maxParts;
    const sz = sizeOf(p.source);
    if (cur.length && (cur.length >= lim || bytes + sz > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(p);
    bytes += sz;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Načte díly sestavy po dávkách; `onChunk` dostane výsledky každé dávky hned (obraz přibývá). Chyba jádra (pád) ukončí
 * načítání a vyhodí se. Díly, které se už načítají z dřívějšího volání, se přeskočí.
 */
export async function loadAsmParts(need: Map<string, ComponentSource>, onChunk: (res: { key: string; result: BuildResult }[]) => void): Promise<void> {
  const parts = [...need.entries()].filter(([k]) => !inflight.has(k)).map(([key, source]) => ({ key, source }));
  if (!parts.length) return;
  for (const p of parts) inflight.add(p.key);
  const t0 = Date.now();
  let done = 0;
  try {
    for (const ch of chunkParts(parts)) {
      const res = await cad.asmParts(ch, done, parts.length);
      done += ch.length;
      for (const p of ch) inflight.delete(p.key);
      onChunk(res);
      if (done === ch.length) perfMark("ui.asm.firstChunk", Date.now() - t0, { parts: ch.length });
    }
    perfMark("ui.asm.all", Date.now() - t0, { parts: parts.length });
  } finally {
    for (const p of parts) inflight.delete(p.key);
  }
}
