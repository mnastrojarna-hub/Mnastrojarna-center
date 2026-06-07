import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase klient pro prohlížeč (Client Components).
 * Používá publishable (anon) klíč — bezpečné pro klientskou stranu, chráněno RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
