import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import {
  FLOW_WHO_COOKIE, FLOW_WHO_PARAM, parseFlowWho, type FlowScope, type FlowViewer,
} from "@/lib/auth/flow-scope";

/**
 * „Moje" obchodního toku na serveru (#25): kdo se dívá a které zakázky jsou jeho.
 * Ne-admin → vždy „moje"; super admin (flow_all) → „Všichni", nebo „Jen moje" (?kdo=moje / cookie flow_kdo).
 * Zakázky „moje" počítá DB (flow_mine_job_id_list → flow_mine_job_ids, stejné pravidlo jako
 * lib/auth/flow-scope isMineJob). Chyba DB → prázdný rozsah s error (fail closed).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kdo se dívá na obchodní tok (bez DB). null = bez přístupu. */
export const getFlowViewer = cache(async (who?: string | null): Promise<FlowViewer | null> => {
  try {
    const access = await getAccess();
    const user = access.user;
    if (!user || !user.active || !UUID_RE.test(user.id)) return null;
    if (!access.can("workflow") && !access.can("documents") && !access.can("orders")) return null;
    const canToggle = access.can("flow_all");
    const w = parseFlowWho(who, canToggle);
    return { userId: user.id, all: canToggle && w === "vsichni", who: w, canToggle };
  } catch (err) {
    console.error(`[data:flow-scope:viewer] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
});

function failed(viewer: FlowViewer): FlowScope {
  return { ...viewer, jobIds: new Set(), mailboxIds: [], mailboxEmails: [], error: true };
}

/** Rozsah „moje" (zakázky + moje schránky). null = bez přístupu; DB chyba → error: true, nic. */
export const getFlowScope = cache(async (who?: string | null): Promise<FlowScope | null> => {
  const viewer = await getFlowViewer(who);
  if (!viewer) return null;
  if (viewer.all) return { ...viewer, jobIds: new Set(), mailboxIds: [], mailboxEmails: [], error: false };
  if (!isSupabaseConfigured()) return failed(viewer);
  try {
    const db = await createOperatorClient();
    const [ids, boxes] = await Promise.all([
      db.rpc("flow_mine_job_id_list", { p_user: viewer.userId }),
      db.from("mailboxes").select("id, email").eq("owner_id", viewer.userId).order("email"),
    ]);
    if (ids.error || boxes.error) {
      console.error(`[data:flow-scope] Supabase chyba: ${(ids.error ?? boxes.error)?.message}`);
      return failed(viewer);
    }
    const list = Array.isArray(ids.data) ? (ids.data as unknown[]) : [];
    const rows = (boxes.data ?? []) as { id: string; email: string | null }[];
    return {
      ...viewer,
      jobIds: new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase())),
      mailboxIds: rows.map((m) => m.id),
      mailboxEmails: rows.map((m) => (m.email ?? "").trim()).filter(Boolean),
      error: false,
    };
  } catch (err) {
    console.error(`[data:flow-scope] ${err instanceof Error ? err.message : String(err)}`);
    return failed(viewer);
  }
});

/** Pro stránky: ?kdo=…, jinak cookie flow_kdo (volba super admina; ostatním se nepoužije). */
export async function flowWhoFrom(sp: Record<string, string | string[] | undefined> | null | undefined): Promise<string | null> {
  const raw = sp?.[FLOW_WHO_PARAM];
  const fromUrl = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? null : null;
  if (fromUrl) return fromUrl;
  try {
    return (await cookies()).get(FLOW_WHO_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
