import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { aiToneFor } from "@/lib/contacts/server";
import { normEmail } from "@/lib/contacts/roles";

/**
 * Tón pro AI text, který odejde pod jménem přihlášeného uživatele `userId` adresátovi `to`
 * (API routy, akce). Bez adresy / DB = null → AI píše zdvořilé vykání.
 */
export async function userAiTone(userId: string, to: unknown, nameHint?: string | null) {
  const email = typeof to === "string" ? normEmail(to) : null;
  if (!email || !isSupabaseConfigured()) return null;
  try {
    return await aiToneFor(await createOperatorClient(), userId, email, nameHint ?? null);
  } catch {
    return null;
  }
}
