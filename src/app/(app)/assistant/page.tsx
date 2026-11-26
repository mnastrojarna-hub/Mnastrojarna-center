import { Sparkles } from "lucide-react";
import { AssistantChat } from "./assistant-chat";
import { requireFeature, getAccess } from "@/lib/auth/session";

/** AI asistent — dotazy přirozenou řečí nad daty firmy (vidí jen to, co smí uživatel), uložené konverzace. */
export default async function AssistantPage() {
  const user = await requireFeature("ai_assistant");
  const { ctx } = await getAccess();

  return (
    <div className="mx-auto flex h-[calc(100dvh-12rem)] min-h-[30rem] max-w-3xl flex-col gap-4 md:h-[calc(100vh-8rem)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white shadow-sm">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI asistent</h1>
          <p className="text-sm text-muted-foreground">Ptej se běžnou řečí (i hlasem) na zakázky, poštu, dokumenty, faktury, ceny, zákazníky i dodavatele. Konverzace si pamatuje.</p>
        </div>
      </div>
      <AssistantChat configured={ctx.aiConfigured} userName={user.fullName} />
    </div>
  );
}
