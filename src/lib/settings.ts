import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Čtení konfigurace integrací: nejdřív z DB (integration_settings),
 * fallback na proměnné prostředí. Umožní nastavovat klíče přes UI i přes .env.
 */

const ENV_FALLBACK: Record<string, string> = {
  anthropic_api_key: "ANTHROPIC_API_KEY",
  anthropic_model: "ANTHROPIC_MODEL",
  imap_host: "IMAP_HOST",
  imap_port: "IMAP_PORT",
  imap_user: "IMAP_USER",
  imap_password: "IMAP_PASSWORD",
  smtp_host: "SMTP_HOST",
  smtp_port: "SMTP_PORT",
  smtp_user: "SMTP_USER",
  smtp_password: "SMTP_PASSWORD",
  ms_graph_client_id: "MS_GRAPH_CLIENT_ID",
  ms_graph_client_secret: "MS_GRAPH_CLIENT_SECRET",
  ms_graph_tenant_id: "MS_GRAPH_TENANT_ID",
  ms_graph_user: "MS_GRAPH_USER",
};

let cache: Record<string, string> | null = null;
let cacheAt = 0;
const TTL = 30_000; // 30s

async function loadFromDb(): Promise<Record<string, string>> {
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return {};
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("integration_settings").select("key, value");
    if (error || !data) return {};
    const map: Record<string, string> = {};
    for (const row of data as { key: string; value: string | null }[]) {
      if (row.value) map[row.key] = row.value;
    }
    return map;
  } catch {
    return {};
  }
}

/** Vrátí hodnotu nastavení (DB má přednost před env). */
export async function getSetting(key: string): Promise<string | undefined> {
  const now = Date.now();
  if (!cache || now - cacheAt > TTL) {
    cache = await loadFromDb();
    cacheAt = now;
  }
  const fromDb = cache[key];
  if (fromDb) return fromDb;
  const envName = ENV_FALLBACK[key];
  const fromEnv = envName ? process.env[envName] : undefined;
  return fromEnv || undefined;
}

export async function getAiConfig(): Promise<{ apiKey?: string; model: string }> {
  const apiKey = await getSetting("anthropic_api_key");
  const model = (await getSetting("anthropic_model")) || "claude-opus-4-8";
  return { apiKey, model };
}

export async function getImapConfig() {
  const [host, port, user, password] = await Promise.all([
    getSetting("imap_host"),
    getSetting("imap_port"),
    getSetting("imap_user"),
    getSetting("imap_password"),
  ]);
  return { host, port: Number(port || 993), user, password };
}

export async function getGraphConfig() {
  const [clientId, clientSecret, tenantId, user] = await Promise.all([
    getSetting("ms_graph_client_id"),
    getSetting("ms_graph_client_secret"),
    getSetting("ms_graph_tenant_id"),
    getSetting("ms_graph_user"),
  ]);
  return { clientId, clientSecret, tenantId, user };
}
