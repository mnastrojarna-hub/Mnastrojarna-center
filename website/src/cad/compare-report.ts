/**
 * Report porovnání s referenčním modelem (compare.ts) – popisy oblastí, text a CSV pro export. Čisté funkce bez jádra.
 *
 * CSV má stejné zvyklosti jako kusovník (bomCsv): oddělovač „;“, desetinná čárka v číselných buňkách, BOM na začátku a
 * řádky CRLF, aby se v Excelu s českým nebo německým nastavením otevřel rovnou do sloupců. Text (report, popisy oblastí)
 * má desetinnou čárku, v angličtině tečku.
 */
import { getLang, tr } from "./i18n";
import type { CompareResult, DiffRegion, SurfaceHint } from "./compare";

/** metadata reportu (doplní UI) */
export type CompareReportMeta = {
  /** název modelu (dokumentu) */
  model: string;
  /** tolerance odchylky (mm) */
  tolerance: number;
  /** datum a čas porovnání (text) */
  date?: string;
};

/** oblast se svým pořadím v seznamu (1…) */
export type NumberedRegion = DiffRegion & { n: number };

/** Všechny oblasti obou stran v jednom seznamu, od největší; číslo `n` = pořadí v seznamu. */
export function regionList(res: Pick<CompareResult, "extra" | "missing">): NumberedRegion[] {
  return [...(res.extra?.regions ?? []), ...(res.missing?.regions ?? [])].sort((a, b) => b.volume - a.volume).map((g, i) => ({ ...g, n: i + 1 }));
}

const num = (v: number, digits: number, comma: boolean) => {
  if (!Number.isFinite(v)) return "";
  const s = v.toFixed(digits);
  const t = /^-0[.,]?0*$/.test(s) ? s.slice(1) : s;
  return comma ? t.replace(".", ",") : t;
};
/** číslo pro text: pevný počet desetinných míst, desetinná čárka (anglicky tečka) */
export const fmt = (v: number, digits = 2) => num(v, digits, getLang() !== "en");
const cm3 = (mm3: number) => fmt(mm3 / 1000, 3);
/** číslo do buňky CSV: vždy desetinná čárka (jako kusovník) */
const cfmt = (v: number, digits = 2) => num(v, digits, true);
const ccm3 = (mm3: number) => cfmt(mm3 / 1000, 3);

/** Stručný popis ploch oblasti: „anuloid R195,35/r8 · rovina“, „válec Ø13 · 2× rovina“. */
export function surfacesText(hints: SurfaceHint[]): string {
  const part = (h: SurfaceHint) => {
    const times = h.n > 1 ? `${h.n}× ` : "";
    switch (h.kind) {
      case "torus":
        return times + tr("anuloid R{0}/r{1}", fmt(h.R ?? 0, 2), fmt(h.r ?? 0, 2));
      case "cylinder":
        return times + tr("válec Ø{0}", fmt(2 * (h.r ?? 0), 2));
      case "sphere":
        return times + tr("koule Ø{0}", fmt(2 * (h.r ?? 0), 2));
      case "cone":
        return times + tr("kužel");
      case "plane":
        return times + tr("rovina");
      default:
        return times + tr("obecná plocha");
    }
  };
  return hints.map(part).join(" · ");
}

/** Strana rozdílu slovy. */
export function sideText(side: DiffRegion["side"]): string {
  return side === "extra" ? tr("navíc v modelu") : tr("chybí v modelu");
}

/**
 * Co oblast nejspíš znamená pro uživatele, který modeluje podle reference: materiál navíc v modelu = v referenci je
 * na tom místě vybrání (drážka, díra, kapsa), které model nemá; chybějící materiál = model má vybrání navíc nebo mu chybí
 * výstupek.
 */
export function regionHint(g: DiffRegion): string {
  const torus = g.surfaces.find((s) => s.kind === "torus");
  const cyl = g.surfaces.find((s) => s.kind === "cylinder");
  if (g.side === "extra") {
    if (torus) return tr("v modelu chybí drážka / zápich R{0}", fmt(torus.r ?? 0, 2));
    if (cyl) return tr("v modelu chybí díra / vybrání Ø{0}", fmt(2 * (cyl.r ?? 0), 2));
    return tr("v modelu chybí vybrání (materiál navíc)");
  }
  if (torus) return tr("model má navíc drážku / zápich R{0}", fmt(torus.r ?? 0, 2));
  if (cyl) return tr("model má navíc díru / vybrání Ø{0} (nebo mu chybí čep)", fmt(2 * (cyl.r ?? 0), 2));
  return tr("v modelu chybí materiál (výstupek)");
}

const csvCell = (s: string | number) => {
  const t = String(s);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvLine = (cells: (string | number)[]) => cells.map(csvCell).join(";");

/** Report jako CSV (souhrn nahoře, pod ním tabulka oblastí). */
export function compareReportCsv(res: CompareResult, meta: CompareReportMeta): string {
  const lines: string[] = [];
  const kv = (k: string, v: string) => lines.push(csvLine([k, v]));
  kv(tr("Porovnání s referenčním modelem"), meta.date ?? "");
  kv(tr("Model"), meta.model);
  kv(tr("Reference"), res.reference.fileName);
  kv(tr("Zarovnání"), alignText(res));
  kv(tr("Tolerance [mm]"), cfmt(meta.tolerance, 3));
  kv(tr("Objem modelu [cm³]"), ccm3(res.model.volume));
  kv(tr("Objem reference [cm³]"), ccm3(res.reference.volume));
  kv(tr("Rozdíl objemů model − reference [cm³]"), ccm3(res.volumeDiff));
  kv(tr("Materiál navíc v modelu (model − reference) [cm³]"), res.extra ? ccm3(res.extra.volume) : tr("nespočítáno"));
  kv(tr("Materiál chybí v modelu (reference − model) [cm³]"), res.missing ? ccm3(res.missing.volume) : tr("nespočítáno"));
  const noise = (res.extra?.noise.volume ?? 0) + (res.missing?.noise.volume ?? 0);
  const noiseN = (res.extra?.noise.count ?? 0) + (res.missing?.noise.count ?? 0);
  kv(tr("Numerický šum [cm³]"), tr("{0} ({1} těles)", ccm3(noise), noiseN));
  if (res.map) {
    kv(tr("Největší odchylka vně reference [mm]"), cfmt(res.map.stats.maxOut, 3));
    kv(tr("Největší odchylka uvnitř reference [mm]"), cfmt(res.map.stats.maxIn, 3));
    kv(tr("Plocha v toleranci [%]"), cfmt(100 * (res.map.stats.withinArea ?? res.map.stats.within), 1));
    kv(tr("Přesnost mapy odchylek [mm]"), `±${cfmt(res.map.accuracy, 3)}`);
  }
  for (const w of res.warnings) kv(tr("Upozornění"), w);
  lines.push("");
  lines.push(
    csvLine([
      tr("Č."),
      tr("Strana"),
      tr("Objem [cm³]"),
      tr("Rozměr X [mm]"),
      tr("Rozměr Y [mm]"),
      tr("Rozměr Z [mm]"),
      tr("Střed X [mm]"),
      tr("Střed Y [mm]"),
      tr("Střed Z [mm]"),
      tr("Plochy"),
      tr("Význam"),
    ]),
  );
  for (const g of regionList(res)) lines.push(csvLine([g.n, sideText(g.side), ccm3(g.volume), ...g.size.map((v) => cfmt(v, 3)), ...g.center.map((v) => cfmt(v, 3)), surfacesText(g.surfaces), regionHint(g)]));
  for (const [side, s] of [["extra", res.extra], ["missing", res.missing]] as const)
    if (s?.more.count) lines.push(csvLine(["…", sideText(side), ccm3(s.more.volume), "", "", "", "", "", "", tr("dalších {0} oblastí", s.more.count), ""]));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Popis použitého zarovnání reference. */
export function alignText(res: Pick<CompareResult, "transform">): string {
  const t = res.transform;
  const mode = t.mode === "auto" ? tr("automaticky (24 poloh po 90°)") : t.mode === "center" ? tr("středy obalových kvádrů") : tr("jak je v souboru");
  if (t.identity) return mode + tr(" – bez přesunu");
  const rot = t.rot.some(Boolean) ? tr(", otočení X {0}° Y {1}° Z {2}°", t.rot[0], t.rot[1], t.rot[2]) : "";
  return mode + rot + tr(", posun {0} / {1} / {2} mm", fmt(t.t[0], 3), fmt(t.t[1], 3), fmt(t.t[2], 3));
}

/** Report jako čitelný text (souhrn a seznam oblastí). */
export function compareReportText(res: CompareResult, meta: CompareReportMeta): string {
  const out: string[] = [];
  out.push(tr("POROVNÁNÍ S REFERENČNÍM MODELEM") + (meta.date ? ` – ${meta.date}` : ""));
  out.push(tr("Model: {0}", meta.model));
  out.push(tr("Reference: {0} ({1})", res.reference.fileName, res.reference.format.toUpperCase()));
  out.push(tr("Zarovnání: {0}", alignText(res)));
  out.push(tr("Tolerance: {0} mm", fmt(meta.tolerance, 3)));
  out.push("");
  out.push(tr("Objem modelu: {0} cm³", cm3(res.model.volume)));
  out.push(tr("Objem reference: {0} cm³", cm3(res.reference.volume)));
  out.push(tr("Rozdíl objemů (model − reference): {0} cm³", cm3(res.volumeDiff)));
  if (res.extra) out.push(tr("Materiál navíc v modelu (model − reference): {0} cm³", cm3(res.extra.volume)));
  if (res.missing) out.push(tr("Materiál chybí v modelu (reference − model): {0} cm³", cm3(res.missing.volume)));
  if (!res.extra && !res.missing) out.push(tr("Rozdílová tělesa se nepočítala."));
  const noiseN = (res.extra?.noise.count ?? 0) + (res.missing?.noise.count ?? 0);
  if (noiseN) out.push(tr("Numerický šum: {0} drobných těles, {1} cm³", noiseN, cm3((res.extra?.noise.volume ?? 0) + (res.missing?.noise.volume ?? 0))));
  if (res.map) {
    const s = res.map.stats;
    out.push(tr("Mapa odchylek: největší +{0} mm (vně reference) / {1} mm (uvnitř), v toleranci {2} % plochy, přesnost ±{3} mm", fmt(s.maxOut, 3), fmt(s.maxIn, 3), fmt(100 * (s.withinArea ?? s.within), 1), fmt(res.map.accuracy, 3)));
  }
  for (const w of res.warnings) out.push(tr("Upozornění: {0}", w));
  const list = regionList(res);
  out.push("");
  out.push(list.length ? tr("Rozdílové oblasti ({0}):", list.length) : tr("Žádné rozdílové oblasti nad prahem šumu."));
  for (const g of list)
    out.push(
      tr(
        "{0}. {1}: {2} cm³ · rozměr {3} × {4} × {5} mm · střed [{6}; {7}; {8}] · {9} · {10}",
        g.n,
        sideText(g.side),
        cm3(g.volume),
        fmt(g.size[0], 2),
        fmt(g.size[1], 2),
        fmt(g.size[2], 2),
        fmt(g.center[0], 2),
        fmt(g.center[1], 2),
        fmt(g.center[2], 2),
        surfacesText(g.surfaces),
        regionHint(g),
      ),
    );
  for (const [side, s] of [["extra", res.extra], ["missing", res.missing]] as const) if (s?.more.count) out.push(tr("… a dalších {0} oblastí ({1}), celkem {2} cm³", s.more.count, sideText(side), cm3(s.more.volume)));
  return out.join("\n") + "\n";
}
