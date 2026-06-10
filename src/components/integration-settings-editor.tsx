"use client";

import * as React from "react";
import { Check, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { saveIntegrationSettings } from "@/app/actions/integrations";
import type { SettingMeta } from "@/lib/data/settings-data";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI — Claude (Anthropic)",
  email: "E-mail — IMAP / Microsoft 365 (globální záloha; schránky níže mají přednost)",
  firma: "Firemní údaje (tisknou se na doklady)",
  pricing: "Naceňování — sazby a marže",
  obecne: "Obecné",
};

export function IntegrationSettingsEditor({ settings }: { settings: SettingMeta[] }) {
  const [values, setValues] = React.useState<Record<string, string>>(
    Object.fromEntries(settings.map((s) => [s.key, s.value])),
  );
  const [setFlags] = React.useState<Record<string, boolean>>(
    Object.fromEntries(settings.map((s) => [s.key, s.isSet])),
  );
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; msg: string } | null>(null);

  if (settings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nastavení integrací je dostupné po připojení Supabase a přihlášení jako super admin.
        Zatím lze klíče zadat přes proměnné prostředí (<code>.env.local</code> / Vercel).
      </p>
    );
  }

  const categories = Array.from(new Set(settings.map((s) => s.category)));
  const secretKeys = settings.filter((s) => s.is_secret).map((s) => s.key);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const res = await saveIntegrationSettings(values, secretKeys);
    setStatus(res.ok ? { ok: true, msg: "Uloženo." } : { ok: false, msg: res.error ?? "Chyba." });
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {categories.map((cat) => (
        <div key={cat} className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {settings
              .filter((s) => s.category === cat)
              .map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <label htmlFor={s.key} className="flex items-center gap-2 text-sm font-medium">
                    {s.label}
                    {s.is_secret && (
                      <Badge variant={setFlags[s.key] ? "success" : "muted"}>
                        <KeyRound className="h-3 w-3" /> {setFlags[s.key] ? "nastaveno" : "tajné"}
                      </Badge>
                    )}
                  </label>
                  <Input
                    id={s.key}
                    type={s.is_secret ? "password" : "text"}
                    value={values[s.key] ?? ""}
                    placeholder={s.is_secret && setFlags[s.key] ? "•••••••• (ponech prázdné = beze změny)" : ""}
                    onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Uložit klíče
        </Button>
        {status && (
          <span className={cn("text-sm", status.ok ? "text-success" : "text-destructive")}>{status.msg}</span>
        )}
      </div>
    </div>
  );
}
