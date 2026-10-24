/**
 * Texty a barvy stavů anonymizace výkresů (čistý modul — server i klient).
 * „Ven" jde jen to, co je hotové (nebo po kontrole); UI proto stav ukazuje vždy u souboru i zakázky.
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

/** Varování, když se z výkresu nic nesmazalo (fotka bez AI, nic nenalezeno). */
export const NOTHING_REMOVED = "Nic se nesmazalo — firma a jména můžou být na výkrese dál.";

/** Čeká na denní limit AI (pending s důvodem „limit"). */
export function isBudgetWait(status: string | null | undefined, reason: string | null | undefined): boolean {
  return status === "pending" && /limit/i.test(reason ?? "");
}

/** Důvod pro uživatele: technickou (anglickou) chybu u selhání nahradí českou větou. */
export function displayReason(status: string | null | undefined, reason: string | null | undefined): string | null {
  if (!reason) return null;
  return status === "failed" ? userFacingFailure(reason, null) : reason;
}

/** Stav jednoho souboru → štítek. total = počet smazaných oblastí (když je znám). */
export function fileAnonLabel(a: { status: AnonUiStatus; reviewed?: boolean; reason?: string | null; total?: number | null }): { label: string; tone: AnonTone; hint: string } {
  switch (a.status) {
    case "uploading":
      return { label: "Nahrávám…", tone: "busy", hint: "Soubor se nahrává." };
    case "pending":
    case "processing":
      if (isBudgetWait(a.status, a.reason)) return { label: "Čeká (denní limit)", tone: "muted", hint: a.reason ?? "" };
      return { label: "Anonymizuje se…", tone: "busy", hint: "AI maže firmu, jména, logo a cesty — za chvíli bude hotovo." };
    case "done":
      if (a.total === 0) {
        return a.reviewed
          ? { label: "Schváleno bez změn", tone: "warn", hint: NOTHING_REMOVED }
          : { label: "Nic nenalezeno", tone: "warn", hint: NOTHING_REMOVED };
      }
      return {
        label: a.reviewed ? "Anonymizováno ✓" : "Anonymizováno",
        tone: "ok",
        hint: a.reviewed ? "Zkontrolováno — kopie pro dodavatele je připravená." : "Kopie pro dodavatele je připravená.",
      };
    case "review":
      return { label: "Ke kontrole", tone: "warn", hint: a.reason ?? "Zkontroluj anonymizaci před odesláním." };
    case "failed":
      return { label: "Anonymizace selhala", tone: "error", hint: displayReason("failed", a.reason) ?? "Zkus to znovu." };
    case "unsupported":
      return { label: "Nelze anonymizovat", tone: "muted", hint: a.reason ?? "Formát nelze anonymizovat — pošli PDF, DXF nebo STEP." };
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
  if (b.review) parts.push({ text: `${b.review} ke kontrole`, tone: "warn" });
  if (b.pending) {
    const budget = b.waitingBudget ?? 0;
    parts.push(budget >= b.pending ? { text: "Čeká (limit)", tone: "muted" } : { text: "Čeká…", tone: "busy" });
  }
  if (anonymizable > 0) {
    const all = b.done === anonymizable;
    parts.push({ text: `Výkresy ${b.done}/${anonymizable}${all ? " ✓" : ""}`, tone: all ? "ok" : "muted" });
  }
  if (b.unsupported) parts.push({ text: `${b.unsupported} nejde (DWG)`, tone: "muted" });
  const tone: AnonTone = b.failed ? "error" : b.review || b.sendWaiting ? "warn" : parts.some((p) => p.tone === "busy") ? "busy" : parts.every((p) => p.tone === "ok") ? "ok" : "muted";
  const title = `Výkresy pro dodavatele (firma, jména, logo, cesty smazané): ${parts.map((p) => p.text).join(" · ")}`;
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
  if (q.status === "blocked") return `je pozastaven${fem ? "á" : "ý"} — ${q.reason ?? "výkres čeká na kontrolu anonymizace"}. Po schválení ${fem ? "odejde sama" : "odejde sám"}.`;
  if (q.status === "sending") return "se právě odesílá…";
  if (q.status === "waiting" && q.reason) return `Odeslání se nepovedlo — ${q.reason.replace(/\.?\s*$/, ".")} Zkusí se znovu.`;
  if (q.pendingCount <= 0) return "odchází…";
  return `odejde po dokončení anonymizace (${drawingsWord(q.pendingCount)}).`;
}
