import "server-only";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, createClient, hasServiceKey } from "@/lib/supabase/server";
import { canPersistEnv, isVercel } from "./runtime-env";
import { superAdminExists } from "./guard";
import { getSetting } from "@/lib/settings";
import { getVerifiedAuthUser } from "@/lib/supabase/verified-claims";

/** Reprezentativní tabulky schématu — pokud existují, migrace proběhly. */
export const REQUIRED_TABLES = [
  "profiles",
  "customers",
  "suppliers",
  "drawings",
  "quotes",
  "orders",
  "emails",
  "mailboxes",
  "approval_queue",
  "integration_settings",
  "ai_agent_rules",
  "ai_corrections",
  "invoices",
  "documents",
  "knowledge_documents",
] as const;

export interface SchemaCheck {
  checked: boolean;
  ok: boolean;
  missing: string[];
}

export interface SetupStatus {
  supabase: {
    url: string;
    urlSet: boolean;
    publishableKey: string;
    publishableKeySet: boolean;
    secretKeySet: boolean;
    configured: boolean;
  };
  schema: SchemaCheck;
  adminExists: boolean;
  signedIn: boolean;
  signedInEmail: string | null;
  aiConfigured: boolean;
  mailboxCount: number;
  /** Firemní údaje (vystavovatel dokladů) — pro krok onboardingu. */
  company: Record<string, string>;
  companyFilled: boolean;
  env: { canPersist: boolean; isVercel: boolean };
}

/** Klíče firemních údajů v nastavení (kategorie „firma"). */
export const COMPANY_SETTING_KEYS = [
  "company_name",
  "company_street",
  "company_city",
  "company_zip",
  "company_ico",
  "company_dic",
  "company_email",
  "company_phone",
  "company_web",
  "company_bank_account",
  "company_iban",
  "company_bank_name",
  "company_registration",
  "company_delivery_address",
  "company_correspondence_address",
  "company_certifications",
] as const;

/** Ověří existenci tabulek přes admin klienta (vyžaduje servisní klíč). */
export async function checkSchemaTables(): Promise<SchemaCheck> {
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { checked: false, ok: false, missing: [...REQUIRED_TABLES] };
  }
  try {
    const db = createAdminClient();
    const results = await Promise.all(
      REQUIRED_TABLES.map(async (table) => {
        const { error } = await db.from(table).select("*", { count: "exact", head: true }).limit(0);
        return { table, ok: !error };
      }),
    );
    const missing = results.filter((r) => !r.ok).map((r) => r.table);
    return { checked: true, ok: missing.length === 0, missing };
  } catch {
    return { checked: false, ok: false, missing: [...REQUIRED_TABLES] };
  }
}

/** Přihlášený uživatel (ověřený token, bez síťového volání na Auth — viz verified-claims.ts). */
async function signedInUser(): Promise<{ email: string | null } | null> {
  try {
    return await getVerifiedAuthUser(await createClient());
  } catch {
    return null; // bez session
  }
}

/** AI klíč, počet schránek a firemní údaje (servisním klíčem). */
async function loadChecklistExtras(): Promise<{ aiConfigured: boolean; mailboxCount: number; company: Record<string, string> }> {
  const [apiKey, mailboxCount, values] = await Promise.all([
    getSetting("anthropic_api_key"),
    (async () => {
      try {
        const db = createAdminClient();
        const { count } = await db.from("mailboxes").select("id", { count: "exact", head: true });
        return (count as number | null) ?? 0;
      } catch {
        return 0;
      }
    })(),
    Promise.all(COMPANY_SETTING_KEYS.map((k) => getSetting(k))),
  ]);
  const company: Record<string, string> = {};
  COMPANY_SETTING_KEYS.forEach((k, i) => {
    company[k] = values[i] ?? "";
  });
  return { aiConfigured: Boolean(apiKey), mailboxCount, company };
}

/**
 * Kontrolní seznam prvního spuštění pro AI přehled — bez kontroly 14 tabulek schématu (přihlášený
 * uživatel s načteným přehledem schéma má; plnou kontrolu dělá průvodce /setup přes getSetupStatus).
 */
export async function getSetupChecklist(): Promise<{
  supabase: { configured: boolean; secretKeySet: boolean };
  aiConfigured: boolean;
  mailboxCount: number;
  companyFilled: boolean;
}> {
  const configured = isSupabaseConfigured();
  const secretKeySet = hasServiceKey();
  const extras = secretKeySet ? await loadChecklistExtras() : null;
  return {
    supabase: { configured, secretKeySet },
    aiConfigured: extras ? extras.aiConfigured : Boolean(process.env.ANTHROPIC_API_KEY),
    mailboxCount: extras?.mailboxCount ?? 0,
    companyFilled: Boolean(extras?.company.company_name && extras?.company.company_ico),
  };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const { url, key } = getSupabaseEnv();
  const configured = isSupabaseConfigured();
  const secretKeySet = hasServiceKey();

  // vše najednou (dřív tabulky → přihlášení → nastavení → schránky postupně = 4 round-tripy za sebou);
  // počet schránek a nastavení se použijí jen při servisním klíči a hotovém schématu (jako dřív)
  const [schema, adminExists, signed, extras] = await Promise.all([
    checkSchemaTables(),
    superAdminExists(),
    configured ? signedInUser() : Promise.resolve(null),
    secretKeySet ? loadChecklistExtras() : Promise.resolve(null),
  ]);
  const signedIn = Boolean(signed);
  const signedInEmail = signed?.email ?? null;

  let aiConfigured = false;
  let mailboxCount = 0;
  let company: Record<string, string> = {};
  if (secretKeySet && schema.ok && extras) {
    ({ aiConfigured, mailboxCount, company } = extras);
  } else if (process.env.ANTHROPIC_API_KEY) {
    aiConfigured = true;
  }

  return {
    supabase: {
      url: configured ? (url ?? "") : (url && !url.includes("<") ? url : ""),
      urlSet: Boolean(url),
      publishableKey: configured ? (key ?? "") : "",
      publishableKeySet: Boolean(key),
      secretKeySet,
      configured,
    },
    schema,
    adminExists,
    signedIn,
    signedInEmail,
    aiConfigured,
    mailboxCount,
    company,
    companyFilled: Boolean(company.company_name && company.company_ico),
    env: { canPersist: canPersistEnv(), isVercel: isVercel() },
  };
}
