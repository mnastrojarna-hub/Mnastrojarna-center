"use server";

import { revalidatePath } from "next/cache";
import { applyRuntimeEnv, canPersistEnv } from "@/lib/setup/runtime-env";
import { canModifySetup, superAdminExists } from "@/lib/setup/guard";
import { checkSchemaTables, type SchemaCheck } from "@/lib/setup/status";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, createClient, hasServiceKey } from "@/lib/supabase/server";

const GUARD_ERROR = "Systém už je nastaven — změny smí provádět jen přihlášený super admin.";

function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export interface SupabaseTestResult {
  ok: boolean;
  urlOk: boolean;
  publishableOk: boolean;
  secretOk: boolean | null; // null = klíč nezadán
  schemaOk: boolean | null; // null = nelze ověřit bez servisního klíče
  message?: string;
}

/** Otestuje zadané Supabase údaje přímým voláním API (nic neukládá). */
export async function testSupabaseConnection(input: {
  url: string;
  publishableKey: string;
  secretKey?: string;
}): Promise<SupabaseTestResult> {
  const url = normalizeUrl(input.url);
  const publishableKey = input.publishableKey.trim();
  const secretKey = input.secretKey?.trim() || "";

  const result: SupabaseTestResult = {
    ok: false,
    urlOk: false,
    publishableOk: false,
    secretOk: secretKey ? false : null,
    schemaOk: null,
  };
  if (!url || !publishableKey) {
    result.message = "Vyplň URL projektu a publishable klíč.";
    return result;
  }

  try {
    const health = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(8000),
    });
    result.urlOk = health.status < 500;
  } catch {
    result.message = "Server neodpovídá — zkontroluj URL projektu.";
    return result;
  }

  try {
    const rest = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(8000),
    });
    result.publishableOk = rest.ok;
    if (!rest.ok) result.message = "Publishable klíč byl odmítnut (zkontroluj sb_publishable_…).";
  } catch {
    result.message = "REST API neodpovídá.";
    return result;
  }

  if (secretKey) {
    try {
      const res = await fetch(`${url}/rest/v1/integration_settings?select=key&limit=1`, {
        headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        result.secretOk = true;
        result.schemaOk = true;
      } else if (res.status === 404) {
        // klíč platí, ale tabulky ještě neexistují (PGRST205)
        result.secretOk = true;
        result.schemaOk = false;
      } else {
        result.secretOk = false;
        result.message = "Servisní klíč byl odmítnut (zkontroluj sb_secret_…).";
      }
    } catch {
      result.secretOk = false;
      result.message = "Ověření servisního klíče selhalo.";
    }
  }

  result.ok = result.urlOk && result.publishableOk && result.secretOk !== false;
  return result;
}

export interface SaveSupabaseResult {
  ok: boolean;
  persisted: boolean;
  error?: string;
  envBlock?: string; // pro Vercel — hodnoty ke zkopírování do dashboardu
}

/** Uloží Supabase připojení: hned do běžícího procesu + trvale (.env.local / data). */
export async function saveSupabaseConfig(input: {
  url: string;
  publishableKey: string;
  secretKey?: string;
}): Promise<SaveSupabaseResult> {
  if (!(await canModifySetup())) {
    return { ok: false, persisted: false, error: GUARD_ERROR };
  }

  const test = await testSupabaseConnection(input);
  if (!test.ok) {
    return { ok: false, persisted: false, error: test.message ?? "Připojení se nepodařilo ověřit." };
  }

  const values: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: normalizeUrl(input.url),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: input.publishableKey.trim(),
  };
  if (input.secretKey?.trim()) values.SUPABASE_SECRET_KEY = input.secretKey.trim();

  const { persisted } = applyRuntimeEnv(values);
  revalidatePath("/setup");
  revalidatePath("/settings");

  if (!persisted && !canPersistEnv()) {
    const envBlock = Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return { ok: true, persisted: false, envBlock };
  }
  return { ok: true, persisted };
}

/** Znovu ověří existenci tabulek schématu. */
export async function recheckSchema(): Promise<SchemaCheck> {
  const check = await checkSchemaTables();
  revalidatePath("/setup");
  return check;
}

export interface CreateAdminResult {
  ok: boolean;
  error?: string;
  signedIn?: boolean;
}

/** Vytvoří super admina (nebo povýší existující účet) a rovnou ho přihlásí. */
export async function createSuperAdmin(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<CreateAdminResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const fullName = input.fullName.trim() || email;

  if (!email || !password) return { ok: false, error: "Vyplň e-mail a heslo." };
  if (password.length < 8) return { ok: false, error: "Heslo musí mít alespoň 8 znaků." };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { ok: false, error: "Nejdřív dokonči připojení Supabase (včetně servisního klíče)." };
  }
  if (!(await canModifySetup())) return { ok: false, error: GUARD_ERROR };

  const db = createAdminClient();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "super_admin" },
  });

  let userId: string | undefined = created?.user?.id;

  if (createError) {
    // Účet už existuje → povýšení na super admina (bez resetu hesla).
    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (!profile) {
      return { ok: false, error: createError.message };
    }
    userId = (profile as { id: string }).id;
  }

  if (userId) {
    await db
      .from("profiles")
      .upsert({ id: userId, email, full_name: fullName, role: "super_admin" } as never);
  }

  // Přihlášení (nastaví session cookies)
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  revalidatePath("/setup");
  if (signInError) {
    return {
      ok: true,
      signedIn: false,
      error: `Účet je připraven, ale přihlášení selhalo: ${signInError.message}`,
    };
  }
  return { ok: true, signedIn: true };
}

/** Stav superadmina pro průvodce (po akcích). */
export async function getAdminExists(): Promise<boolean> {
  return superAdminExists();
}
