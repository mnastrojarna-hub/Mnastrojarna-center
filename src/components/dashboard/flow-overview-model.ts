// AI přehled: „Co kdo dnes posunul" — čisté seskupení dnešních událostí stavu podle autora (testy flow-overview.test.tsx).
import type { ActorKind } from "@/lib/supabase/database.types";

export interface MoverGroup {
  /** Klíč skupiny (id účtu, „ai", „system"). */
  key: string;
  name: string;
  kind: ActorKind;
  count: number;
  items: { jobId: string; jobNumber: string | null; message: string; at: string }[];
}

export function startOfPragueDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
  for (const offset of [2, 1]) {
    const t = Date.UTC(y, m - 1, d) - offset * 3_600_000;
    if (fmt.format(new Date(t)) === day && fmt.format(new Date(t - 1)) !== day) return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

/** Seskupí dnešní posuny stavů podle autora (nejaktivnější první). Čistá funkce kvůli testům. */
export function groupMovers(rows: {
  job_id: string; message: string; created_at: string; actor_id: string | null; actor_kind: string | null; actor_name: string | null;
  actor?: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
  job?: { number: string | null } | { number: string | null }[] | null;
}[]): MoverGroup[] {
  const groups = new Map<string, MoverGroup>();
  for (const r of rows) {
    const kind: ActorKind = r.actor_kind === "ai" ? "ai" : r.actor_id ? "user" : "system";
    const p = Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor ?? null;
    const person = p ? (p.full_name ?? "").trim() || (p.email ?? "").trim() || null : null;
    const key = kind === "user" ? r.actor_id! : kind === "ai" ? `ai:${r.actor_id ?? ""}` : "system";
    const name = kind === "ai"
      ? person ? `✨ AI za účet ${person}` : "✨ AI"
      : kind === "user" ? person ?? (r.actor_name ? `${r.actor_name} (účet zrušen)` : "Neznámý účet") : "Automaticky / systém";
    const g = groups.get(key) ?? { key, name, kind, count: 0, items: [] };
    g.count += 1;
    const job = Array.isArray(r.job) ? r.job[0] ?? null : r.job ?? null;
    if (g.items.length < 5) g.items.push({ jobId: r.job_id, jobNumber: job?.number ?? null, message: r.message, at: r.created_at });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));
}
