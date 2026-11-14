/**
 * Dokument pro výkres: závity se na výkrese kreslí zjednodušeně (ISO 6410) – kružnice válce / jádra s označením závitu,
 * ne skutečná šroubovice. Modelovaný závit (tažení po šroubovici s profilem Závit 60°, drážky prvku Závit) se proto
 * pro výkres potlačí: zůstane hladký válec / díra a označení (M18×1,5) přidá `threadsOfDoc`.
 * Přesná projekce (HLR) šroubovicových ploch v jádře trvá minuty – to byl důvod „zaseknutého“ výkresu i exportu PDF.
 */
import { threadByName } from "./defaults";
import { holeDrillD } from "./hole-spec";
import { tr } from "./i18n";
import type { CadDoc, Feature } from "./types";

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Je prvek modelovaný závit, který se na výkrese nahradí zjednodušenou značkou? */
export function isModeledThread(f: Feature): boolean {
  if (f.suppressed) return false;
  if (f.type === "thread") return !!f.modeled;
  if (f.type === "ext" && f.ext === "surf.helixSweep") return f.data?.profile === "thread60";
  return false;
}

/** Kopie dokumentu s potlačenými modelovanými závity (pro stavbu tělesa výkresu). Beze změny vrátí původní objekt. */
export function drawingDoc(doc: CadDoc): CadDoc {
  if (!doc.features.some(isModeledThread)) return doc;
  return { ...doc, features: doc.features.map((f) => (isModeledThread(f) ? { ...f, suppressed: true } : f)) };
}

/** Označení závitů pro kótování kružnic (poloměr válce / jádra → text místo Ø). */
export function threadsOfDoc(doc: CadDoc): { r: number; label: string }[] {
  const out: { r: number; label: string; derived?: boolean }[] = [];
  for (const f of doc.features) {
    if (f.suppressed) continue;
    if (f.type === "thread") {
      const t = threadByName(f.designation);
      if (t) out.push({ r: (f.internal ? t.tap : t.d) / 2, label: `${t.name}${f.length > 0 ? ` dl. ${fmt(f.length)}` : ""}` });
    } else if (f.type === "hole" && f.kind === "tapped" && f.thread) {
      const t = threadByName(f.thread);
      if (t) out.push({ r: holeDrillD(f) / 2, label: `${t.name}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : ""}` }); // vrták podle volby (hole-spec.ts)
    } else if (f.type === "ext" && f.ext === "surf.helixSweep" && f.data?.profile === "thread60") {
      const d = f.data;
      const R = typeof d.radius === "number" ? d.radius : 0;
      const h = typeof d.depth === "number" ? d.depth : 0;
      const p = typeof d.pitch === "number" ? d.pitch : 0;
      if (!(R > 0 && p > 0)) continue;
      const internal = d.side === "internal";
      const removing = d.mode === "cut" || d.mode === "intersect";
      // velký průměr: vnitřní odebrání / vnější přidání jdou od R ven (R + h), jinak je R sám velký poloměr
      const major = 2 * ((internal ? removing : !removing) ? R + h : R);
      const length = typeof d.turns === "number" ? d.turns * p : 0;
      out.push({ r: R, label: `M${fmt(major)}×${fmt(p)}${length > 0 ? ` dl. ${fmt(length)}` : ""}`, derived: true });
    }
  }
  // katalogové označení (prvek Závit, závitová díra) má přednost před označením odvozeným z geometrie šroubovice
  return out.sort((a, b) => Number(!!a.derived) - Number(!!b.derived)).map(({ r, label }) => ({ r, label }));
}

/** Poznámky výkresu k plechu: křížový zlom (úhlopříčky panelu se na výkrese kreslí jako hrany modelu, popis do poznámky). */
export function formNotesOfDoc(doc: CadDoc): string[] {
  return doc.features
    .filter((f): f is Extract<Feature, { type: "ext" }> => f.type === "ext" && f.ext === "sheet.crossbreak" && !f.suppressed)
    .map((f) => tr("KŘÍŽOVÝ ZLOM {0}° {1} ({2})", fmt(typeof f.data?.angle === "number" ? f.data.angle : 1.5), f.data?.direction === "down" ? tr("dolů") : tr("nahoru"), f.name));
}
