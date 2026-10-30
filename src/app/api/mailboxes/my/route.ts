import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { isUuidLike } from "@/lib/email/visibility";
import { detectMine, listMyMailboxes, removeMine, saveMine, setMineActive, testMine, testSendMine } from "@/lib/email/my-mailbox";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";
import type { MailboxConfig } from "@/lib/supabase/database.types";

// IMAP/POP3/SMTP klienti potřebují Node runtime; vlastní časové limity (40 s) drží výsledek pod limitem
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Moje e-mailová schránka (každý uživatel s poštou, jen svou vlastní — owner_id = já):
 *   GET → moje schránky (bez hesel)
 *   POST { action: "detect", email, password?, mailboxId?, preset?, host?, smtpHost?, smtpPort?, smtpTls? } → najít nastavení (IMAP/POP3 + SMTP)
 *   POST { action: "save", mailboxId?, email, displayName?, password?, smtpPassword?, config } → uložit
 *   POST { action: "test", mailboxId } → test příjmu i odesílání (spojení + přihlášení)
 *   POST { action: "testSend", mailboxId } → zkušební e-mail na vlastní adresu (+ kopie do Odeslaných)
 *   POST { action: "active", mailboxId, active } / { action: "delete", mailboxId } → vypnout / odpojit
 */
export async function GET() {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ mailboxes: await listMyMailboxes(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const uid = auth.user.id;
  const mailboxId = typeof body.mailboxId === "string" && isUuidLike(body.mailboxId) ? body.mailboxId : null;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  try {
    switch (body.action) {
      case "detect": {
        const r = await detectMine(uid, {
          mailboxId, email: str("email") ?? "", password: str("password"), preset: str("preset"), host: str("host"),
          smtpHost: str("smtpHost"), smtpPort: Number(body.smtpPort) || undefined, smtpTls: str("smtpTls"),
          user: str("user"), allowNameMismatch: body.allowNameMismatch === true,
        });
        await logAudit({
          action: "mailbox_detect", entity: "mailboxes", entityId: mailboxId ?? undefined,
          diff: { email: str("email") ?? "", ok: r.ok, self_service: true, found: r.incoming ? `${r.incoming.protocol} ${r.incoming.host}:${r.incoming.port}` : null, smtp: r.smtp ? `${r.smtp.host}:${r.smtp.port}` : null },
          actor: userActor(auth.user),
        });
        return NextResponse.json(r);
      }
      case "save": {
        const r = await saveMine(uid, {
          mailboxId, email: str("email") ?? "", displayName: str("displayName"), password: str("password"), smtpPassword: str("smtpPassword"),
          config: (typeof body.config === "object" && body.config ? body.config : {}) as MailboxConfig,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "test":
        if (!mailboxId) return NextResponse.json({ error: "Schránka nenalezena." }, { status: 400 });
        return NextResponse.json(await testMine(uid, mailboxId));
      case "testSend":
        if (!mailboxId) return NextResponse.json({ error: "Schránka nenalezena." }, { status: 400 });
        return NextResponse.json(await testSendMine(uid, mailboxId, auth.user.fullName));
      case "active":
        if (!mailboxId) return NextResponse.json({ error: "Schránka nenalezena." }, { status: 400 });
        return NextResponse.json(await setMineActive(uid, mailboxId, body.active === true));
      case "delete":
        if (!mailboxId) return NextResponse.json({ error: "Schránka nenalezena." }, { status: 400 });
        return NextResponse.json(await removeMine(uid, mailboxId));
      default:
        return NextResponse.json({ error: "Neznámá akce." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chyba." }, { status: 500 });
  }
}
