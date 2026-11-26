import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Uložené konverzace AI asistenta — jen vlastní (RLS: user_id = auth.uid()). */
export interface AssistantConversation { id: string; title: string; updatedAt: string }
export interface AssistantMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string }

export async function listAssistantConversations(userId: string): Promise<AssistantConversation[]> {
  const db = await createClient();
  const { data } = await db.from("assistant_conversations").select("id, title, updated_at").eq("user_id", userId)
    .order("updated_at", { ascending: false }).limit(100);
  return ((data ?? []) as { id: string; title: string; updated_at: string }[]).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function getAssistantMessages(conversationId: string): Promise<AssistantMessage[]> {
  const db = await createClient();
  const { data } = await db.from("assistant_messages").select("id, role, content, created_at").eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }).limit(400);
  return ((data ?? []) as { id: string; role: "user" | "assistant"; content: string; created_at: string }[])
    .map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}
