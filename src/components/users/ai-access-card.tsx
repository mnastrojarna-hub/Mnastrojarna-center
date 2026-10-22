"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Brain, Camera, CheckCircle2, GraduationCap, Loader2, Power, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { saveAiAccessSettings } from "@/app/actions/ai-access";
import { cn } from "@/lib/utils";

/**
 * AI přístup: hlavní vypínač + AI čtení dokladů pro všechny. Per uživatel se
 * AI zapíná přepínačem „AI" v seznamu uživatelů.
 */
export function AiAccessCard({
  aiEnabled,
  aiCaptureForAll,
  aiConfigured,
  usersWithAi,
  activeUsers,
}: {
  aiEnabled: boolean;
  aiCaptureForAll: boolean;
  aiConfigured: boolean;
  /** Kolik aktivních uživatelů (mimo super adminy) má AI povolenou jednotlivě. */
  usersWithAi: number;
  activeUsers: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(aiEnabled);
  const [forAll, setForAll] = React.useState(aiCaptureForAll);
  const [saving, setSaving] = React.useState<"enabled" | "forAll" | null>(null);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => setEnabled(aiEnabled), [aiEnabled]);
  React.useEffect(() => setForAll(aiCaptureForAll), [aiCaptureForAll]);

  const save = async (which: "enabled" | "forAll", next: { aiEnabled: boolean; aiCaptureForAll: boolean }) => {
    const prev = { enabled, forAll };
    setEnabled(next.aiEnabled);
    setForAll(next.aiCaptureForAll);
    setSaving(which);
    setStatus(null);
    try {
      const res = await saveAiAccessSettings(next);
      if (!res.ok) {
        setEnabled(prev.enabled);
        setForAll(prev.forAll);
        setStatus({ ok: false, text: res.error ?? "Uložení se nepovedlo." });
      } else {
        setStatus({ ok: true, text: "Uloženo — platí okamžitě pro všechny." });
        router.refresh();
      }
    } catch {
      setEnabled(prev.enabled);
      setForAll(prev.forAll);
      setStatus({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setSaving(null);
    }
  };

  const effective = !enabled || !aiConfigured
    ? "AI je teď vypnutá pro všechny — doklady se vyplňují ručně."
    : forAll
      ? "AI čtení dokladů může používat každý aktivní uživatel."
      : usersWithAi > 0
        ? `AI má super admin a ${usersWithAi} ${usersWithAi === 1 ? "další uživatel" : usersWithAi < 5 ? "další uživatelé" : "dalších uživatelů"} (přepínač AI v seznamu).`
        : "AI má jen super admin. Ostatním ji zapneš přepínačem AI v seznamu výše.";

  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-primary" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Sparkles className="h-4 w-4" />
          </span>
          AI přístup
        </CardTitle>
        <CardDescription>
          Kdo smí nechat Claude AI přečíst vyfocený doklad a vyplnit zakázku. AI asistent, znalostní databáze a
          ladění AI zůstávají jen pro super admina.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!aiConfigured && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">
              Není nastaven klíč Claude API — AI nepoběží pro nikoho, dokud ho nedoplníš.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings">Nastavit klíč</Link>
            </Button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <SwitchTile
            icon={Power}
            tone="bg-primary/10 text-primary"
            title="AI zapnuto (hlavní vypínač)"
            text="Vypnutím zastavíš veškeré volání AI v aplikaci — i pro super admina."
            checked={enabled}
            busy={saving === "enabled"}
            disabled={saving !== null}
            onChange={(v) => void save("enabled", { aiEnabled: v, aiCaptureForAll: forAll })}
          />
          <SwitchTile
            icon={Camera}
            tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            title="AI čtení dokladů z fotky pro všechny uživatele"
            text={`Zapne AI všem aktivním uživatelům (${activeUsers}). Jinak jen těm, kterým ji povolíš jednotlivě.`}
            checked={forAll}
            busy={saving === "forAll"}
            disabled={saving !== null || !enabled}
            onChange={(v) => void save("forAll", { aiEnabled: enabled, aiCaptureForAll: v })}
          />
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-[auto_1fr]">
          <GraduationCap className="hidden h-5 w-5 text-emerald-600 sm:block" />
          <div className="space-y-1">
            <p className="font-medium">Jak to funguje</p>
            <p className="text-muted-foreground">
              Pro ostatní uživatele je AI ve výchozím stavu vypnutá: fotku dokladu přiloží k zakázce a údaje
              vyplní ručně. AI se z těchto ručních záznamů učí, takže je postupně přesnější. Super admin může AI
              povolit konkrétnímu člověku přepínačem <strong>AI</strong> v seznamu, nebo všem najednou tady.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-violet-500" />
          <span>{effective}</span>
          {status && (
            <span className={cn("ml-auto inline-flex items-center gap-1 text-xs", status.ok ? "text-success" : "text-destructive")}>
              {status.ok && <CheckCircle2 className="h-3.5 w-3.5" />}
              {status.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SwitchTile({
  icon: Icon,
  tone,
  title,
  text,
  checked,
  busy,
  disabled,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  text: string;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3 transition-colors", checked && "bg-violet-500/5")}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </label>
      <div className="flex items-center gap-2 pt-1">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          className="data-[state=checked]:bg-violet-500"
        />
      </div>
    </div>
  );
}
