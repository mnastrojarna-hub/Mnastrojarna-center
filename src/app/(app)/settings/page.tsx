import { Mail, Bot, Plug, ShieldCheck, BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutomationSettings } from "@/components/automation-settings";
import { AgentRulesEditor } from "@/components/agent-rules-editor";
import { getAgentRules } from "@/lib/ai/rules";

export default async function SettingsPage() {
  const emailRules = await getAgentRules("email");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nastavení"
        description="Připojení schránek, AI a režim automatizace pro každý modul."
      />

      {/* Připojené schránky */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" /> Připojené schránky
          </CardTitle>
          <CardDescription>Pošta se stahuje a analyzuje automaticky.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Connection name="Microsoft 365 / Outlook" detail="obchod@mnastrojarna.cz" status="connected" />
          <Connection name="IMAP — hosting90" detail="info@mnastrojarna.cz" status="connected" />
          <Connection name="Gmail" detail="Nepřipojeno" status="disconnected" />
        </CardContent>
      </Card>

      {/* AI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-muted-foreground" /> AI engine
          </CardTitle>
          <CardDescription>Sdílí API klíč s Claude Code.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Connection name="Claude API (Anthropic)" detail="model: claude-opus-4-8" status="connected" />
          <Connection name="Embeddings + pgvector" detail="Supabase Vector" status="connected" />
        </CardContent>
      </Card>

      {/* Pravidla AI agenta pošty — řízení slovními příkazy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" /> {emailRules.label}
          </CardTitle>
          <CardDescription>
            Řiď agenta běžnou řečí — co má dělat, co musí <b>vždy</b> a co <b>nikdy</b>. Pravidla se
            promítnou do třídění pošty i do návrhů odpovědí.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentRulesEditor rules={emailRules} />
        </CardContent>
      </Card>

      {/* Režim automatizace per modul */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Režim automatizace
          </CardTitle>
          <CardDescription>
            Pro každou činnost zvol, zda ji AI provede sama (100 %), nebo počká na tvé schválení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutomationSettings />
        </CardContent>
      </Card>
    </div>
  );
}

function Connection({
  name,
  detail,
  status,
}: {
  name: string;
  detail: string;
  status: "connected" | "disconnected";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
          <Plug className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
      </div>
      {status === "connected" ? (
        <Badge variant="success">Připojeno</Badge>
      ) : (
        <Button variant="outline" size="sm">
          Připojit
        </Button>
      )}
    </div>
  );
}
