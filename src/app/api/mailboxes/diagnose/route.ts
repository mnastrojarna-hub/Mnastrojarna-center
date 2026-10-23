import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { isUuidLike } from "@/lib/email/visibility";
import { detectMailbox, testMailbox, type DetectRequest, type MailboxTestInput } from "@/lib/email/mailbox-diagnose";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";

// IMAP/POP3/SMTP klienti potřebují Node runtime; vlastní časové limity (40 s) drží výsledek pod limitem
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Nastavení schránky (jen super admin — funkce „settings"):
 *   { action: "test", mailboxId?, provider, email, config, secrets? } → postupná diagnostika IMAP/POP3 + SMTP (+ Graph)
 *   { action: "detect", mailboxId?, email, password?, host?, port?, protocol?, smtpHost?, smtpPort?, allowNameMismatch? }
 *     → „Najít nastavení automaticky" (tabulka pokusů, první fungující kombinace)
 * Uložená hesla se doplní na serveru podle mailboxId (do prohlížeče se neposílají).
 */
export async function POST(req: Request) {
  const auth = await apiRequire("settings");
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const mailboxId = typeof body.mailboxId === "string" && isUuidLike(body.mailboxId) ? body.mailboxId : null;

  try {
    if (body.action === "detect") {
      const result = await detectMailbox({ ...(body as unknown as DetectRequest), mailboxId });
      await logAudit({
        action: "mailbox_detect",
        entity: "mailboxes",
        entityId: mailboxId ?? undefined,
        diff: {
          email: String(body.email ?? ""),
          ok: result.ok,
          found: result.incoming ? `${result.incoming.protocol} ${result.incoming.host}:${result.incoming.port}` : null,
          allowNameMismatch: body.allowNameMismatch === true,
        },
        actor: userActor(auth.user),
      });
      return NextResponse.json(result);
    }
    if (body.action === "test") {
      const input = body as unknown as MailboxTestInput;
      if (!input.provider || typeof input.config !== "object") return NextResponse.json({ error: "Chybí údaje schránky." }, { status: 400 });
      return NextResponse.json(await testMailbox({ ...input, mailboxId }, { userId: auth.user.id }));
    }
    return NextResponse.json({ error: "Neznámá akce." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Test připojení selhal." }, { status: 500 });
  }
}
