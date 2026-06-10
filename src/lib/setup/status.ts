import "server-only";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, createClient, hasServiceKey } from "@/lib/supabase/server";
import { canPersistEnv, isVercel } from "./runtime-env";
import { superAdminExists } from "./guard";
import { getSetting } from "@/lib/settings";

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

export async function getSetupStatus(): Promise<SetupStatus> {
  const { url, key } = getSupabaseEnv();
  const configured = isSupabaseConfigured();
  const secretKeySet = hasServiceKey();

  const [schema, adminExists] = await Promise.all([checkSchemaTables(), superAdminExists()]);

  let signedIn = false;
  let signedInEmail: string | null = null;
  if (configured) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedIn = Boolean(user);
      signedInEmail = user?.email ?? null;
    } catch {
      // bez session
    }
  }

  let aiConfigured = false;
  let mailboxCount = 0;
  const company: Record<string, string> = {};
  if (secretKeySet && schema.ok) {
    aiConfigured = Boolean(await getSetting("anthropic_api_key"));
    try {
      const db = createAdminClient();
      const { count } = await db.from("mailboxes").select("id", { count: "exact", head: true });
      mailboxCount = count ?? 0;
    } catch {
      mailboxCount = 0;
    }
    const values = await Promise.all(COMPANY_SETTING_KEYS.map((k) => getSetting(k)));
    COMPANY_SETTING_KEYS.forEach((k, i) => {
      company[k] = values[i] ?? "";
    });
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
