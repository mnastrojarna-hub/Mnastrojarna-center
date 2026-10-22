"use client";

import * as React from "react";
import Link from "next/link";
import { Banknote, KeyRound, Factory, FileSearch, Loader2, Send, Sparkles, TrendingUp, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Chat s firemním AI asistentem (odpovídá nad daty Knihy zakázek, zákazníků, dodavatelů…). */

const SUGGESTIONS: { text: string; icon: React.ReactNode; tone: string }[] = [
  { text: "Jaká byla poslední cena výkresu …?", icon: <FileSearch />, tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  { text: "Které zakázky jsou po termínu a proč?", icon: <Wrench />, tone: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  { text: "Kdo z dodavatelů umí kalení a jak rychle?", icon: <Factory />, tone: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  { text: "Jaká byla poslední marže u zákazníka …?", icon: <TrendingUp />, tone: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
  { text: "Kolik vydělali obchodníci tento měsíc?", icon: <Banknote />, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
];

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

let seq = 0;
const msg = (role: Msg["role"], text: string, error = false): Msg => ({ id: `m${++seq}`, role, text, error });

export function AssistantChat({ configured, userName }: { configured: boolean; userName: string }) {
  const [messages, setMessages] = React.useState<Msg[]>(() => [
    msg(
      "assistant",
      `Ahoj${userName ? ` ${userName.split(" ")[0]}` : ""}! Jsem firemní AI asistent. Vidím Knihu zakázek, nabídky, zákazníky, dodavatele, výkresy i provize. Zeptej se třeba na poslední cenu výkresu nebo na zakázky po termínu.`,
    ),
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, msg("user", q)]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) setMessages((m) => [...m, msg("assistant", data.error ?? "Bez odpovědi — zkus to prosím znovu.", true)]);
      else setMessages((m) => [...m, msg("assistant", data.answer as string)]);
    } catch {
      setMessages((m) => [...m, msg("assistant", "Nepodařilo se spojit s AI. Zkontroluj připojení a zkus to znovu.", true)]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[26rem] flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {!configured && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <KeyRound className="h-4 w-4 shrink-0" />
          <span className="flex-1">AI zatím nemá Claude API klíč — asistent odpoví jen nápovědou.</span>
          <Button asChild size="sm" variant="outline"><Link href="/settings">Doplnit klíč</Link></Button>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin sm:p-5" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                m.role === "assistant" ? "bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white" : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
              )}
            >
              {m.role === "assistant" ? <Sparkles className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "assistant"
                  ? m.error
                    ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200"
                    : "bg-purple-50 text-foreground dark:bg-purple-500/10"
                  : "bg-foreground text-background",
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-purple-50 px-4 py-2.5 text-sm text-muted-foreground dark:bg-purple-500/10">
              <Loader2 className="h-4 w-4 animate-spin" /> AI prochází data…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              type="button"
              onClick={() => setInput(s.text.replace("…", "").trimEnd() + " ")}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95 [&_svg]:h-3.5 [&_svg]:w-3.5", s.tone)}
            >
              {s.icon}{s.text}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Napiš dotaz… (Enter odešle, Shift+Enter nový řádek)"
            rows={1}
            className="max-h-40 min-h-[40px] flex-1 resize-none"
            disabled={loading}
            aria-label="Dotaz pro AI asistenta"
          />
          <Button type="submit" size="icon" aria-label="Zeptat se" disabled={loading || !input.trim()} className="h-10 w-10 bg-purple-600 text-white hover:bg-purple-600/90">
            {loading ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      </div>
    </div>
  );
}
