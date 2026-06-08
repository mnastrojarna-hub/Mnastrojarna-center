"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteCorrection } from "@/app/actions/corrections";
import type { Correction } from "@/lib/supabase/database.types";

const AGENT_LABEL: Record<string, string> = {
  email: "Pošta",
  pricing: "Oceňování",
  quote: "Nabídky",
  confirmation: "Potvrzení",
  extraction: "Čtení příloh",
};

export function CorrectionsList({ corrections }: { corrections: Correction[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const remove = async (id: string) => {
    setBusy(id);
    await deleteCorrection(id);
    router.refresh();
    setBusy(null);
  };

  if (corrections.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <GraduationCap className="h-4 w-4" />
        Zatím žádné korekce. Když opravíš výstup AI (např. kategorii e-mailu), uloží se sem a AI se z ní
        v plné automatice poučí.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {corrections.map((c) => (
        <div key={c.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{AGENT_LABEL[c.agent_key] ?? c.agent_key}</Badge>
              {c.field && <Badge variant="muted">{c.field}</Badge>}
            </div>
            {c.context && <p className="mt-1 truncate text-xs text-muted-foreground">{c.context}</p>}
            <p className="mt-1">
              {c.ai_value && <span className="text-destructive line-through">{c.ai_value}</span>}{" "}
              <span className="font-medium text-success">→ {c.corrected_value}</span>
            </p>
            {c.note && <p className="mt-0.5 text-xs text-muted-foreground">Pravidlo: {c.note}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => remove(c.id)} disabled={busy === c.id} aria-label="Smazat korekci">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
