import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { isSupabaseConfigured } from "./config";
import { actorHeaders, SYSTEM_ACTOR, type ActorContext } from "./actor-headers";
import { resolveRequestActor } from "./actor";

export { isSupabaseConfigured };

/**
 * Supabase klient pro server (Server Components, Server Actions, Route Handlers).
 * Drží uživatelskou session přes cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Volání ze Server Component — session obnoví middleware.
          }
        },
      },
    },
  );
}

/**
 * Admin klient se servisním klíčem (sb_secret_…) — POUZE na serveru, obchází RLS. Nese hlavičky
 * autora změny; DB (app_actor) jim věří jen u servisní role. Klient se vytváří pro KAŽDÉ volání —
 * nikdy ho nesdílet v modulu (hlavička autora by přetekla k jinému uživateli; hlídá ESLint).
 * Bez `actor` = „Systém".
 */
export function createAdminClient(opts: { actor?: ActorContext | null } = {}) {
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: actorHeaders(opts.actor ?? SYSTEM_ACTOR) },
    },
  );
}

/** True, pokud je k dispozici servisní klíč (jednofiremní „operátorský" režim). */
export function hasServiceKey() {
  return Boolean(process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Operátorský klient pro jednofiremní provoz. Se servisním klíčem nese autora: explicitně
 * (begin() → access.user, AI, cron), jinak přihlášeného uživatele z ověřené session.
 * `actor: null` = vědomě „Systém". Bez klíče spadne na uživatelskou session (RLS, DB zná auth.uid()).
 */
export async function createOperatorClient(opts: { actor?: ActorContext | null } = {}) {
  if (hasServiceKey()) {
    const actor = opts.actor !== undefined ? opts.actor : await resolveRequestActor();
    return createAdminClient({ actor: actor ?? SYSTEM_ACTOR });
  }
  return createClient();
}
