import "server-only";
import type { ActorContext } from "./actor-headers";

/**
 * Záložní autor pro createOperatorClient() bez explicitního actor: přihlášený aktivní uživatel.
 * Lazy import → žádný statický cyklus server ↔ session ↔ current-user. V server actions jde
 * o stejnou React cache jako checkFeature; v route handlerech cache nefunguje, proto begin()
 * předává autora explicitně a tohle je jen pojistka.
 */
export async function resolveRequestActor(): Promise<ActorContext | null> {
  try {
    const { getSessionUser } = await import("@/lib/auth/session");
    const u = await getSessionUser();
    return u && u.active && u.hasProfile ? { id: u.id, kind: "user", via: "rucne" } : null;
  } catch {
    return null; // mimo request (skript, cron bez cookies)
  }
}
