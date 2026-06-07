"use client";

import * as React from "react";
import { Sparkles, Send, User } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const suggestions = [
  "Najdi poslední cenu výkresu VK-2291.",
  "Kdo dodával materiál 1.2343 nejlevněji?",
  "Jaká byla poslední marže u TDK Precision?",
  "Kolik vydělal M. Novák tento měsíc?",
];

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export default function AssistantPage() {
  const [messages, setMessages] = React.useState<Msg[]>([
    {
      role: "assistant",
      text: "Ahoj! Jsem firemní AI asistent. Zeptej se mě na cenu výkresu, podobný díl, marži zákazníka nebo provize obchodníka.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer ?? data.error ?? "Bez odpovědi." },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Nepodařilo se spojit s AI. Zkus to prosím znovu." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col gap-4">
      <PageHeader title="AI Asistent" description="Ptej se přirozeným jazykem na cokoliv z firmy." />

      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardContent className="flex-1 space-y-4 overflow-y-auto scrollbar-thin p-5">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  m.role === "assistant" ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
                )}
              >
                {m.role === "assistant" ? <Sparkles className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  m.role === "assistant"
                    ? "bg-muted text-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4 animate-pulse" />
              </div>
              <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                AI přemýšlí…
              </div>
            </div>
          )}
        </CardContent>

        <div className="border-t p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Napiš dotaz…"
              className="flex-1"
              disabled={loading}
            />
            <Button type="submit" size="icon" aria-label="Odeslat" disabled={loading}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
