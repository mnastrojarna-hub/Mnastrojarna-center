import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_PRICING_PARAMS, type PricingParams } from "@/lib/pricing/params";

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

export async function getPricingParams(): Promise<PricingParams> {
  const d = DEFAULT_PRICING_PARAMS;
  const num = async (key: string, fallback: number) => {
    const v = Number(await getSetting(key));
    return Number.isFinite(v) && v !== 0 ? v : fallback;
  };
  const [
    hourlyRate, handlingRate, programmingRate, setupRate, inspectionRate,
    marginPercent, inflationPercent, transportDefault, materialTransport,
    strategyLevel, utilizationPercent,
    smallQtySurchargePct, specialMaterialSurchargePct, certificationSurchargePct, scarceMaterialSurchargePct,
    maxPriceStepPct, expressSurchargePct, fastSurchargePct, country,
  ] = await Promise.all([
    num("hourly_rate_czk", d.hourlyRate),
    num("handling_rate_czk", d.handlingRate),
    num("programming_rate_czk", d.programmingRate),
    num("setup_rate_czk", d.setupRate),
    num("inspection_rate_czk", d.inspectionRate),
    num("default_margin_percent", d.marginPercent),
    num("inflation_percent", d.inflationPercent),
    num("transport_default_czk", d.transportDefault),
    num("material_transport_czk", d.materialTransport),
    num("price_strategy_level", d.strategyLevel),
    num("shop_utilization_percent", d.utilizationPercent),
    num("small_qty_surcharge_pct", d.smallQtySurchargePct),
    num("special_material_surcharge_pct", d.specialMaterialSurchargePct),
    num("certification_surcharge_pct", d.certificationSurchargePct),
    num("scarce_material_surcharge_pct", d.scarceMaterialSurchargePct),
    num("max_price_step_pct", d.maxPriceStepPct),
    num("express_surcharge_pct", d.expressSurchargePct),
    num("fast_surcharge_pct", d.fastSurchargePct),
    getSetting("production_country"),
  ]);
  return {
    hourlyRate, handlingRate, programmingRate, setupRate, inspectionRate,
    marginPercent, inflationPercent, transportDefault, materialTransport,
    strategyLevel, utilizationPercent,
    smallQtySurchargePct, specialMaterialSurchargePct, certificationSurchargePct, scarceMaterialSurchargePct,
    maxPriceStepPct, expressSurchargePct, fastSurchargePct,
    countryCode: country || d.countryCode,
  };
}
