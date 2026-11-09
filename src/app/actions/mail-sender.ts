"use server";

import { getSessionUser } from "@/lib/auth/session";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { isUuidLike } from "@/lib/email/visibility";
import { resolveSender, senderChoiceFor, signatureForDecision, type SenderChoice } from "@/lib/email/sender-rules";

/**
 * „Odeslat z" v dialozích odeslání (doklad, nabídka, objednávka, poptávka, psaní, fronta ke schválení).
 * Majitel 9. 11.: každý posílá ze své schránky, vybírat smí jen super admin — seznam schránek dostane jen on,
 * ostatní jen adresu, ze které jejich e-mail odejde. Volbu stejně ověřuje server při odeslání (sender-rules.ts).
 */

async function me() {
  const user = await getSessionUser();
  if (!user) return { error: "Nejsi přihlášen — přihlas se znovu." } as const;
  if (!user.active) return { error: "Účet není aktivní." } as const;
  return { user } as const;
}

/** Schránka, kam přišel e-mail, na který odpovídám (jen viditelný e-mail; jinak null). */
async function replyMailboxOf(sourceEmailId: unknown): Promise<string | null> {
  if (!isUuidLike(sourceEmailId)) return null;
  const found = await getVisibleEmailRow<{ mailbox_id: string | null }>(sourceEmailId, "id").catch(() => null);
  return found?.row.mailbox_id ?? null;
}

/** Odkud by e-mail odešel (a pro super admina z čeho může vybírat). `sourceEmailId` = odpověď na tento e-mail. */
export async function senderChoiceAction(input: { sourceEmailId?: string | null } = {}): Promise<{ ok: true; choice: SenderChoice } | { ok: false; error: string }> {
  const a = await me();
  if ("error" in a) return { ok: false, error: a.error ?? "Chyba přihlášení." };
  try {
    return { ok: true, choice: await senderChoiceFor(a.user.id, { replyMailboxId: await replyMailboxOf(input?.sourceEmailId) }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Odesílatele se nepodařilo zjistit." };
  }
}

/**
 * Podpis pro schránku zvolenou v „Odeslat z" (null = výchozí moje) — dialog jím nahradí podpis v textu.
 * Osobní schránka kolegy → jeho podpis (zpráva odchází jeho jménem); firemní / moje → můj.
 */
export async function senderSignatureAction(
  mailboxId: string | null, input: { sourceEmailId?: string | null } = {},
): Promise<{ ok: true; signature: string; email: string | null } | { ok: false; error: string }> {
  const a = await me();
  if ("error" in a) return { ok: false, error: a.error ?? "Chyba přihlášení." };
  try {
    const d = await resolveSender(a.user.id, { mailboxId: isUuidLike(mailboxId) ? mailboxId : null, replyMailboxId: await replyMailboxOf(input?.sourceEmailId) });
    return { ok: true, signature: (await signatureForDecision(d)).trim(), email: d.mailboxEmail };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Podpis se nepodařilo načíst." };
  }
}
