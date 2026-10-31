/**
 * Texty a barvy stavů anonymizace výkresů (čistý modul — server i klient).
 * „Ven" jde jen to, co je hotové (plná automatika, bez kontroly člověkem); stav u souboru i zakázky.
 */

import { userFacingFailure } from "@/lib/anonymize/failure-text";

export type AnonUiStatus = "pending" | "processing" | "done" | "review" | "failed" | "unsupported" | "skipped" | "uploading";

export type AnonTone = "ok" | "warn" | "error" | "busy" | "muted";

export const ANON_TONE_CLASS: Record<AnonTone, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  error: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  busy: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

/** Kategorie smazaných oblastí (česky, jednotné / množné číslo). */
export const ANON_CATEGORY_LABELS: Record<string, [string, string]> = {
  company: ["firma", "firmy"],
  logo: ["logo", "loga"],
  person: ["jméno", "jména"],
  signature: ["podpis", "podpisy"],
  path: ["cesta na disk", "cesty na disk"],
  contact: ["kontakt", "kontakty"],
  code: ["QR / čárový kód", "kódy"],
  copyright_owner: ["vlastník v doložce", "vlastníci v doložce"],
  custom: ["vlastní termín", "vlastní termíny"],
  other: ["ručně označeno", "ručně označené"],
};

export const ANON_CATEGORY_COLOR: Record<string, string> = {
  company: "#e03930",
  logo: "#c026d3",
  person: "#7c3aed",
  signature: "#9333ea",
  path: "#0284c7",
  contact: "#0d9488",
  code: "#475569",
  copyright_owner: "#b45309",
  custom: "#db2777",
  other: "#f59e0b",
};

/** „firma, 2 jména, cesta na disk" (bez textů). */
export function describeCounts(counts: Record<string, number> | null | undefined): string {
  const parts: string[] = [];
  for (const [cat, n] of Object.entries(counts ?? {})) {
    if (!n || n <= 0) continue;
    const l = ANON_CATEGORY_LABELS[cat] ?? ["oblast", "oblasti"];
    parts.push(n === 1 ? l[0] : `${n} ${l[1]}`);
  }
  return parts.join(", ");
}

export function regionsWord(n: number): string {
  return n === 1 ? "oblast" : n >= 2 && n <= 4 ? "oblasti" : "oblastí";
}

/** 1 výkres · 2–4 výkresy · 0 / 5+ výkresů. */
export function drawingsWord(n: number): string {
  return `${n} ${n === 1 ? "výkres" : n >= 2 && n <= 4 ? "výkresy" : "výkresů"}`;
}

/** Hotovo, ale nic se nesmazalo (název firmy na výkrese není). */
export const NOTHING_REMOVED = "Název firmy se na výkrese nenašel — kopie pro dodavatele je připravená.";

/** Čeká na denní limit AI (pending s důvodem „limit"). */
export function isBudgetWait(status: string | null | undefined, reason: string | null | undefined): boolean {
  return status === "pending" && /limit/i.test(reason ?? "");
}

/** Důvod pro uživatele: technickou (anglickou) chybu u selhání nahradí českou větou. */
export function displayReason(status: string | null | undefined, reason: string | null | undefined): string | null {
  if (!reason) return null;
  return status === "failed" ? userFacingFailure(reason) : reason;
}

/** Stav jednoho souboru → štítek. total = počet smazaných oblastí (když je znám). */
export function fileAnonLabel(a: {
  status: AnonUiStatus; reviewed?: boolean; reason?: string | null; total?: number | null;
  /** Starý výkres (backfill) — nic neběží, čeká na „Zpracovat staré výkresy". */
  backfill?: boolean;
  /** Čeká déle než obvykle (UI přestalo čekat) — místo spinneru „Zkusit znovu". */
  stalled?: boolean;
}): { label: string; tone: AnonTone; hint: string } {
  switch (a.status) {
    case "uploading":
      return { label: "Nahrávám…", tone: "busy", hint: "Soubor se nahrává." };
    case "pending":
    case "processing":
      if (isBudgetWait(a.status, a.reason)) return { label: "Čeká (denní limit)", tone: "muted", hint: a.reason ?? "" };
      if (a.backfill && a.status === "pending") return { label: "Starší výkres", tone: "muted", hint: "Výkres z doby před anonymizací — spusť „Anonymizovat“ v menu, nebo hromadně v Nastavení." };
      if (a.stalled) return { label: "Čeká déle než obvykle", tone: "warn", hint: "Anonymizace se nerozběhla — zkus to znovu." };
      if (a.status === "pending" && a.reason) return { label: "Zkouší se znovu…", tone: "busy", hint: displayReason("failed", a.reason) ?? "Předchozí pokus selhal — zkouší se znovu." };
      return { label: "Anonymizuje se…", tone: "busy", hint: "Maže se název firmy zákazníka — za chvíli bude hotovo." };
    // „Ke kontrole" už nevzniká (plná automatika, majitel 31. 10.) — starší řádek = hotovo
    case "review":
    case "done":
      if (a.total === 0) return { label: "Anonymizováno", tone: "ok", hint: NOTHING_REMOVED };
      return {
        label: a.reviewed ? "Anonymizováno ✓" : "Anonymizováno",
        tone: "ok",
        hint: "Název firmy smazán — kopie pro dodavatele je připravená.",
      };
    case "failed":
      return { label: "Anonymizace selhala", tone: "error", hint: displayReason("failed", a.reason) ?? "Zkus to znovu." };
    case "unsupported":
      // archiv / e-mail rozbalený do samostatných souborů (ty se anonymizují samy)
      if (/^Rozbaleno/i.test(a.reason ?? "")) return { label: "Rozbaleno", tone: "muted", hint: a.reason ?? "" };
      return { label: "Nelze anonymizovat automaticky", tone: "warn", hint: a.reason ?? "Formát nelze anonymizovat — pošli PDF, DXF nebo STEP." };
    case "skipped":
      return { label: skippedLabel(a.reason), tone: "muted", hint: a.reason ?? "Bez anonymizace." };
    default:
      return { label: "—", tone: "muted", hint: "" };
  }
}

function skippedLabel(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (/není výkres/i.test(r)) return "Není výkres";
  if (/náš výkres/i.test(r)) return "Náš výkres";
  return "Bez anonymizace";
}

export interface JobBadgeInput {
  total: number;
  done: number;
  review: number;
  failed: number;
  pending: number;
  unsupported: number;
  skipped: number;
  sendWaiting: number;
  /** Čeká na denní limit AI. */
  waitingBudget?: number;
  /** Staré výkresy (backfill) — sám se nespouští. */
  waitingLegacy?: number;
}

export interface JobBadgeView {
  /** Všechny čipy podle naléhavosti. */
  parts: { text: string; tone: AnonTone }[];
  /** Nejvýš 2 viditelné čipy (zbytek „+N", celý seznam v title). */
  visible: { text: string; tone: AnonTone }[];
  more: number;
  tone: AnonTone;
  title: string;
}

/**
 * Odznak zakázky jako čipy podle naléhavosti: Odeslání čeká · selhal · ke kontrole · Čeká… · Výkresy n/m · nejde.
 * Každý čip má vlastní barvu; na řádku nejvýš 2 + „+N".
 */
export function jobAnonBadge(b: JobBadgeInput | null | undefined): JobBadgeView | null {
  if (!b) return null;
  const relevant = b.total - b.skipped;
  if (relevant <= 0 && b.sendWaiting <= 0) return null;
  const parts: { text: string; tone: AnonTone }[] = [];
  const anonymizable = relevant - b.unsupported;
  if (b.sendWaiting) parts.push({ text: "Odeslání čeká", tone: "warn" });
  if (b.failed) parts.push({ text: `${b.failed} ${b.failed === 1 ? "selhal" : "selhaly"}`, tone: "error" });
  // starší „ke kontrole" = hotovo (kontrola už není)
  const done = b.done + b.review;
  if (b.pending) {
    const budget = b.waitingBudget ?? 0;
    const legacy = b.waitingLegacy ?? 0;
    parts.push(budget + legacy < b.pending ? { text: "Čeká…", tone: "busy" }
      : budget >= legacy ? { text: "Čeká (limit)", tone: "muted" } : { text: "Starší výkresy", tone: "muted" });
  }
  if (anonymizable > 0) {
    const all = done === anonymizable;
    parts.push({ text: `Výkresy ${done}/${anonymizable}${all ? " ✓" : ""}`, tone: all ? "ok" : "muted" });
  }
  if (b.unsupported) parts.push({ text: `${b.unsupported} nelze automaticky`, tone: "muted" });
  const tone: AnonTone = b.failed ? "error" : b.sendWaiting ? "warn" : parts.some((p) => p.tone === "busy") ? "busy" : parts.every((p) => p.tone === "ok") ? "ok" : "muted";
  const title = `Výkresy pro dodavatele (název firmy smazaný): ${parts.map((p) => p.text).join(" · ")}`;
  const visible = parts.slice(0, 2);
  return { parts, visible, more: parts.length - visible.length, tone, title };
}

export interface SendQueueLike {
  kind: string;
  status: "waiting" | "blocked" | "sending" | "sent" | "cancelled" | "failed";
  pendingCount: number;
  reason: string | null;
}

/** Co odeslání / objednávka / poptávka (rod: e-mail → -ý, objednávka / poptávka → -á). */
export function sendQueueWhat(kind: string): { what: string; fem: boolean } {
  if (kind === "purchase_order") return { what: "Objednávka dodavateli", fem: true };
  if (kind === "supplier_inquiry") return { what: "Poptávka dodavateli", fem: true };
  return { what: "E-mail s výkresy", fem: false };
}

/** Text hlášky fronty odeslání (za názvem odeslání). */
export function sendQueueText(q: SendQueueLike): string {
  const { fem } = sendQueueWhat(q.kind);
  if (q.status === "failed") return `se nepodařilo odeslat${q.reason ? ` — ${q.reason}` : ""}.`;
  if (q.status === "blocked") return `je pozastaven${fem ? "á" : "ý"} — ${q.reason ?? "anonymizace výkresu se nepovedla"}. Po opravě ${fem ? "odejde sama" : "odejde sám"}.`;
  if (q.status === "sending") return "se právě odesílá…";
  if (q.status === "waiting" && q.reason) return `Odeslání se nepovedlo — ${q.reason.replace(/\.?\s*$/, ".")} Zkusí se znovu.`;
  if (q.pendingCount <= 0) return "odchází…";
  return `odejde po dokončení anonymizace (${drawingsWord(q.pendingCount)}).`;
}
