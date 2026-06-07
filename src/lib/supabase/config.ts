/**
 * Detekce a validace Supabase konfigurace. Bez závislosti na next/headers,
 * aby šla použít i v middleware (edge runtime).
 */

export function getSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

/** True jen když je URL i klíč vyplněný, není to placeholder a URL je platná http(s). */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return false;
  // placeholdery z .env.example (např. https://<project-ref>.supabase.co, sb_publishable_...)
  if (url.includes("<") || url.includes("your-") || key.includes("<") || key.trim().endsWith("...")) {
    return false;
  }
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
