import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { runAssistant } from "@/lib/ai/assistant/run";
import { getAssistantMessages, listAssistantConversations } from "@/lib/data/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// asistent si data dohledává v několika krocích (nástroje) — delší limit funkce
export const maxDuration = 300;

const MAX_QUESTION = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function today(): string {
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

/** GET: seznam mých konverzací; ?conversation=<id> → její zprávy. */
export async function GET(req: Request) {
  const auth = await apiRequire("ai_assistant");
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get("conversation");
  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Konverzace nenalezena." }, { status: 404 });
    return NextResponse.json({ messages: await getAssistantMessages(id) });
  }
  return NextResponse.json({ conversations: await listAssistantConversations(auth.user.id) });
}

/** DELETE ?conversation=<id>: smazat moji konverzaci. */
export async function DELETE(req: Request) {
  const auth = await apiRequire("ai_assistant");
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get("conversation");
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Konverzace nenalezena." }, { status: 404 });
  const db = await createClient();
  const { error } = await db.from("assistant_conversations").delete().eq("id", id).eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * POST { question, conversationId? }: dotaz v konverzaci (bez id = nová). Předchozí dotazy a odpovědi
 * konverzace jdou s dotazem (navazující otázky), dotaz i odpověď se uloží.
 */
export async function POST(req: Request) {
  const auth = await apiRequire("ai_assistant");
  if (auth instanceof NextResponse) return auth;
  let body: { question?: unknown; conversationId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION) : "";
  if (!question) return NextResponse.json({ error: "Chybí dotaz." }, { status: 400 });
  const db = await createClient();
  let conversationId = typeof body.conversationId === "string" && UUID_RE.test(body.conversationId) ? body.conversationId : null;
  try {
    if (conversationId) {
      const { data } = await db.from("assistant_conversations").select("id").eq("id", conversationId).eq("user_id", auth.user.id).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const title = question.replace(/\s+/g, " ").slice(0, 80);
      const { data, error } = await db.from("assistant_conversations").insert({ user_id: auth.user.id, title } as never).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "Konverzaci se nepodařilo založit.");
      conversationId = (data as { id: string }).id;
    }
    const history = (await getAssistantMessages(conversationId)).map((m) => ({ role: m.role, content: m.content }));
    await db.from("assistant_messages").insert({ conversation_id: conversationId, role: "user", content: question } as never);
    const { answer, tools } = await runAssistant({ history, question, today: today() });
    await db.from("assistant_messages").insert({ conversation_id: conversationId, role: "assistant", content: answer } as never);
    await db.from("assistant_conversations").update({ updated_at: new Date().toISOString() } as never).eq("id", conversationId);
    return NextResponse.json({ conversationId, answer, tools });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: msg, conversationId }, { status: 500 });
  }
}
