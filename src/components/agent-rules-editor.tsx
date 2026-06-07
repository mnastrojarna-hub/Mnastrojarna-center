"use client";

import * as React from "react";
import { Plus, X, Check, CircleCheck, CircleX, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { saveAgentRules } from "@/app/actions/agent-rules";
import type { AgentRules } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export function AgentRulesEditor({ rules }: { rules: AgentRules }) {
  const [instructions, setInstructions] = React.useState(rules.instructions);
  const [always, setAlways] = React.useState<string[]>(rules.always_rules);
  const [never, setNever] = React.useState<string[]>(rules.never_rules);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; msg: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const res = await saveAgentRules({ agentKey: rules.agent_key, instructions, always, never });
    setStatus(
      res.ok
        ? { ok: true, msg: "Pravidla uložena. Agent se jimi řídí od příští zprávy." }
        : { ok: false, msg: res.error ?? "Uložení selhalo." },
    );
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Co má agent dělat */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" /> Co má agent dělat
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Popiš slovy, co má agent s poštou dělat…"
          className="min-h-[90px]"
        />
      </div>

      <RuleList
        title="Co musí VŽDY"
        tone="success"
        icon={<CircleCheck className="h-4 w-4 text-success" />}
        placeholder="Např. Poptávky vždy označ vysokou prioritou"
        items={always}
        setItems={setAlways}
      />

      <RuleList
        title="Co nesmí NIKDY"
        tone="destructive"
        icon={<CircleX className="h-4 w-4 text-destructive" />}
        placeholder="Např. Nikdy neodesílej nabídku bez schválení ceny"
        items={never}
        setItems={setNever}
      />

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Uložit pravidla
        </Button>
        {status && (
          <span className={cn("text-sm", status.ok ? "text-success" : "text-destructive")}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}

function RuleList({
  title,
  tone,
  icon,
  placeholder,
  items,
  setItems,
}: {
  title: string;
  tone: "success" | "destructive";
  icon: React.ReactNode;
  placeholder: string;
  items: string[];
  setItems: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const [draft, setDraft] = React.useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setItems((prev) => [...prev, v]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon} {title}
        <Badge variant={tone === "success" ? "success" : "destructive"}>{items.length}</Badge>
      </div>

      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              tone === "success" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
            )}
          >
            <span className="flex-1">{item}</span>
            <button
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Odebrat pravidlo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">Zatím žádné pravidlo.</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="icon" onClick={add} aria-label="Přidat pravidlo">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
