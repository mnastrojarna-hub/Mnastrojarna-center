import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiRequire } from "@/lib/auth/session";
import { createOperatorClient } from "@/lib/supabase/server";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { loadEmailAttachment } from "@/lib/email/attachments";
import { isUuidLike } from "@/lib/email/visibility";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Stažení přílohy e-mailu (jen e-mail, který uživatel smí vidět; IMAP příloha ze serveru). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: "Příloha nenalezena." }, { status: 404 });
  const db = (await createOperatorClient()) as unknown as SupabaseClient;
  const { data } = await db.from("email_attachments").select("email_id").eq("id", id).maybeSingle();
  const emailId = (data as { email_id: string } | null)?.email_id;
  if (!emailId || !(await getVisibleEmailRow(emailId, "id"))) return NextResponse.json({ error: "Příloha nenalezena." }, { status: 404 });
  const res = await loadEmailAttachment(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  const name = res.file.filename.replace(/[\r\n"]/g, "_");
  return new NextResponse(new Uint8Array(res.file.content), {
    headers: {
      "Content-Type": res.file.contentType,
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
