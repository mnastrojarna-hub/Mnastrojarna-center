"use client";

import { endSession } from "@/app/auth/actions";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * Odhlášení (menu avataru na počítači, mobilní Menu): relace v prohlížeči i na serveru (cookies),
 * pak jedno čisté přesměrování na /login.
 */
export async function signOutEverywhere(): Promise<void> {
  await Promise.allSettled([createBrowserClient().auth.signOut(), endSession()]);
  window.location.assign("/login");
}
