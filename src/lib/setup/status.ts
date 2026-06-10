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
  env: { canPersist: boolean; isVercel: boolean };
}

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
  if (secretKeySet && schema.ok) {
    aiConfigured = Boolean(await getSetting("anthropic_api_key"));
    try {
      const db = createAdminClient();
      const { count } = await db.from("mailboxes").select("id", { count: "exact", head: true });
      mailboxCount = count ?? 0;
    } catch {
      mailboxCount = 0;
    }
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
    env: { canPersist: canPersistEnv(), isVercel: isVercel() },
  };
}
