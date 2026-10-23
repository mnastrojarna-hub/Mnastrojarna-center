import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { actorHeaders, type ActorContext } from "@/lib/supabase/actor-headers";

/**
 * Pomůcky integračních testů proti lokálnímu Supabase (tools/local-supabase):
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run <soubor>
 */

export const LOCAL_ENABLED = process.env.LOCAL_SUPABASE === "1";

const REPO = path.resolve(__dirname, "../..");

export function loadLocalEnv(): Record<string, string> {
  const file = path.join(REPO, ".local-supabase/env");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Servisní klient. S `actor` nese hlavičky autora (ctx „app"), bez něj holý klíč (ctx „service"). */
export function localAdmin(actor?: ActorContext | null): SupabaseClient {
  const env = loadLocalEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: AUTH,
    ...(actor !== undefined ? { global: { headers: actorHeaders(actor) } } : {}),
  });
}

/** Klient s publishable klíčem přihlášený přes GoTrue (ctx „session"); headers = případný podvrh. */
export async function localSession(email: string, password: string, headers: Record<string, string> = {}): Promise<SupabaseClient> {
  const env = loadLocalEnv();
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: AUTH, global: { headers } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Přihlášení ${email} selhalo: ${error.message}`);
  return c;
}

/** Anonymní klient (publishable klíč bez přihlášení). */
export function localAnon(headers: Record<string, string> = {}): SupabaseClient {
  const env = loadLocalEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: AUTH, global: { headers } });
}

/** SQL přímo do DB jako postgres (ctx „db"). Vrací výstup psql (-tA). */
export function localSql(sql: string): string {
  return execFileSync(path.join(REPO, "tools/local-supabase/psql.sh"), ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export const DEMO = {
  admin: { email: "admin@local.test", password: "Admin123!" },
  sales: { email: "obchod@local.test", password: "Obchod123!" },
  worker: { email: "dilna@local.test", password: "Dilna123!" },
} as const;

/** Id profilu podle e-mailu (servisní klíč). */
export async function profileId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.from("profiles").select("id").eq("email", email).single();
  if (error || !data) throw new Error(`Profil ${email} nenalezen: ${error?.message ?? ""}`);
  return (data as { id: string }).id;
}
