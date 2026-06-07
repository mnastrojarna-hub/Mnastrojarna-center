import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { EmailCategory, PriorityLevel } from "@/lib/supabase/database.types";
import { getAiConfig } from "@/lib/settings";

/**
 * AI vrstva nad Claude API (Anthropic). Klíč a model se berou z nastavení
 * (DB integration_settings → fallback na ANTHROPIC_API_KEY v env).
 * Bez klíče funkce vrací bezpečný fallback, aby appka běžela i bez AI.
 */

export async function isAiConfigured() {
  return Boolean((await getAiConfig()).apiKey);
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ── Kategorizace e-mailu ────────────────────────────────────
export interface EmailAnalysis {
  category: EmailCategory;
  priority: PriorityLevel;
  importance: number; // 0–100
  is_spam: boolean;
  summary: string;
  confidence: number; // 0–1
}

const CATEGORY_ENUM: EmailCategory[] = [
  "poptavka", "objednavka", "nabidka_dodavatele", "potvrzeni_objednavky",
  "faktura", "upominka", "reklamace", "technicka_dokumentace", "spam", "ostatni",
];

export async function categorizeEmail(input: {
  from: string;
  subject: string;
  body: string;
  rules?: string; // firemní pravidla (VŽDY/NIKDY/pokyny) z ai_agent_rules
}): Promise<EmailAnalysis> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      category: "ostatni",
      priority: "stredni",
      importance: 50,
      is_spam: false,
      summary: "AI není nakonfigurováno (doplň Claude API klíč v Nastavení).",
      confidence: 0,
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: CATEGORY_ENUM },
      priority: { type: "string", enum: ["nizka", "stredni", "vysoka"] },
      importance: { type: "integer" },
      is_spam: { type: "boolean" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["category", "priority", "importance", "is_spam", "summary", "confidence"],
  };

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema },
    },
    system:
      "Jsi asistent nástrojárny Mnástrojárna. Klasifikuj příchozí e-mail do jedné z kategorií " +
      "a urči prioritu, důležitost (0–100), zda jde o spam, krátké shrnutí česky a confidence (0–1). " +
      "Kategorie: poptavka, objednavka, nabidka_dodavatele, potvrzeni_objednavky, faktura, upominka, " +
      "reklamace, technicka_dokumentace, spam, ostatni." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Od: ${input.from}\nPředmět: ${input.subject}\n\n${input.body}`,
      },
    ],
  });

  return JSON.parse(textOf(message)) as EmailAnalysis;
}

// ── Návrh odpovědi na e-mail ────────────────────────────────
export async function draftReply(input: {
  from: string;
  subject: string;
  body: string;
  category?: string;
  rules?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return "Dobrý den,\n\nděkujeme za Vaši zprávu. (Návrh vygeneruje AI po doplnění Claude API klíče v Nastavení.)\n\nS pozdravem,\nMNástrojárna s.r.o.";
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 1500,
    output_config: { effort: "medium" },
    system:
      "Jsi obchodní asistent firmy Mnástrojárna s.r.o. (nástrojárna). Napiš zdvořilou, věcnou " +
      "odpověď v češtině na příchozí e-mail. Bez vymýšlení cen a termínů — pokud chybí, napiš, že " +
      "je doplníme. Podpis: 'S pozdravem, Mnástrojárna s.r.o.'. Vrať pouze tělo e-mailu." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Kategorie: ${input.category ?? "neznámá"}\nOd: ${input.from}\nPředmět: ${input.subject}\n\n${input.body}`,
      },
    ],
  });

  return textOf(message).trim();
}

// ── Firemní AI asistent (Q&A) ───────────────────────────────
export async function askAssistant(input: {
  question: string;
  context?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return "AI asistent zatím není aktivní — doplň Claude API klíč v Nastavení → Integrace. Po nastavení odpovím nad tvými daty (RAG: nabídky, objednávky, výkresy).";
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system:
      "Jsi firemní AI asistent nástrojárny Mnástrojárna s.r.o. Odpovídáš česky, stručně a konkrétně " +
      "na dotazy o zákaznících, nabídkách, objednávkách, výkresech, dodavatelích a provizích. " +
      "Pokud nemáš data, řekni to a navrhni, kde je v systému najít.",
    messages: [
      {
        role: "user",
        content: input.context
          ? `Kontext z databáze:\n${input.context}\n\nDotaz: ${input.question}`
          : input.question,
      },
    ],
  });

  return textOf(message).trim();
}
