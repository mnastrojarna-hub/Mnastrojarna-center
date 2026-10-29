"use client";

import * as React from "react";
import { progressText } from "@/lib/email/mail-types";

/**
 * „Stáhnout poštu" až do konce: /api/emails/sync stáhne dávky do časového limitu a vrátí `total` /
 * `remaining` / `done`; tady se volá znovu, dokud server nehlásí hotovo (průběh „Staženo 340 z 2 150").
 */

export interface SyncResponse {
  configured?: boolean;
  fetched?: number;
  ingested?: number;
  ai?: boolean;
  total?: number;
  remaining?: number;
  done?: boolean;
  message?: string;
  error?: string;
  boxes?: { id: string; email: string; ok: boolean; skipped?: string; error?: string; remaining?: number; total?: number; partial?: boolean }[];
}

export interface SyncProgress {
  running: boolean;
  total: number;
  remaining: number;
  fetched: number;
  ingested: number;
  round: number;
}

export interface SyncOutcome {
  ok: boolean;
  text: string;
  ingested: number;
  configured: boolean;
}

const MAX_ROUNDS = 60;

/** Pokračovat dalším kolem? (čistá funkce — testy v mail-ui-components.test.tsx) */
export function shouldContinue(data: SyncResponse | null, prev: { remaining: number; round: number; idle: number }): boolean {
  if (!data || !data.configured || prev.round >= MAX_ROUNDS) return false;
  if (data.done) return false;
  const failed = (data.boxes ?? []).every((b) => !b.ok);
  if (failed && (data.boxes ?? []).length) return false;
  // bez posunu třikrát po sobě (např. zámek jiného procesu) → konec
  return prev.idle < 3;
}

export function useMailSync(opts: { canAi?: boolean; onRound?: () => void } = {}) {
  const [progress, setProgress] = React.useState<SyncProgress>({ running: false, total: 0, remaining: 0, fetched: 0, ingested: 0, round: 0 });
  const running = React.useRef(false);

  const run = React.useCallback(async (body: { auto?: boolean; mailboxId?: string } = {}): Promise<SyncOutcome | null> => {
    if (running.current) return null;
    running.current = true;
    let fetched = 0;
    let ingested = 0;
    let round = 0;
    let idle = 0;
    let last: SyncResponse | null = null;
    let status = 200;
    setProgress({ running: true, total: 0, remaining: 0, fetched: 0, ingested: 0, round: 0 });
    try {
      for (;;) {
        const res = await fetch("/api/emails/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        status = res.status;
        // Vercel při překročení limitu vrací HTML/504 — ne JSON
        const data = (await res.json().catch(() => null)) as SyncResponse | null;
        round++;
        if (!data) {
          last = null;
          break;
        }
        last = data;
        fetched += data.fetched ?? 0;
        ingested += data.ingested ?? 0;
        idle = (data.fetched ?? 0) === 0 ? idle + 1 : 0;
        setProgress({ running: true, total: data.total ?? 0, remaining: data.remaining ?? 0, fetched, ingested, round });
        opts.onRound?.();
        if (!shouldContinue(data, { remaining: data.remaining ?? 0, round, idle })) break;
        // nic se nestáhlo (schránku právě stahuje živá pošta / plánovač) → chvíli počkat
        if (idle) await new Promise((r) => setTimeout(r, 2500));
        body = { ...body, auto: false }; // další kola = ruční pokračování
      }
    } catch {
      last = null;
      status = 0;
    } finally {
      running.current = false;
      setProgress((p) => ({ ...p, running: false }));
    }
    if (!last) {
      return {
        ok: false, configured: true, ingested,
        text: status === 504 ? "Server nestihl stáhnout poštu (časový limit) — zbytek se stáhne při dalším stažení, zkus to znovu." : status ? `Synchronizace selhala (HTTP ${status}).` : "Synchronizace selhala (síť).",
      };
    }
    if (!last.configured) return { ok: false, configured: false, ingested, text: last.message ?? "Schránka není nastavená." };
    // neúplně nastavené schránky ukazuje stav schránek pod přepínačem — nejsou chybou stažení, pokud aspoň jedna běžela
    const boxes = last.boxes ?? [];
    const failed = boxes.some((b) => !b.ok && b.skipped !== "incomplete") || (boxes.length > 0 && boxes.every((b) => !b.ok));
    const ran = (last.boxes ?? []).filter((b) => !b.skipped);
    const left = last.remaining ?? 0;
    const base = `Staženo ${fetched}, nových ${ingested}${last.ai && opts.canAi ? " · roztříděno AI" : ""}${ran.length > 1 ? ` (${ran.length} schránky)` : ""}.`;
    const more = left > 0 ? ` ${progressText(last.total ?? 0, left)} — zbytek se stáhne při dalším stažení.` : "";
    return { ok: !failed, configured: true, ingested, text: `${base}${more}${last.message && (failed || !last.done) ? ` ${last.message}` : ""}` };
  }, [opts]);

  return { progress, run };
}
