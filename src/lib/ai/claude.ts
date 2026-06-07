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

// ── Oceňování dle výkresu (jako technolog) ──────────────────
export interface PriceOperation {
  name: string;
  machine_minutes: number;
  setup_minutes: number;
}
export interface PriceEstimate {
  material: string;
  operations: PriceOperation[];
  material_cost_per_piece: number;
  cooperation_cost_per_piece: number;
  labor_rate_per_hour: number;
  margin_percent: number;
  unit_price: number;
  total_price: number;
  lead_time_days: number;
  confidence: number;
  reasoning: string;
  needs_clarification: string[];
}

export async function priceDrawing(input: {
  drawingNumber?: string;
  material?: string;
  dimensions?: string;
  quantity: number;
  requirements?: string;
  drawingText?: string;
  rules?: string;
}): Promise<PriceEstimate> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      material: input.material || "—",
      operations: [],
      material_cost_per_piece: 0,
      cooperation_cost_per_piece: 0,
      labor_rate_per_hour: 0,
      margin_percent: 0,
      unit_price: 0,
      total_price: 0,
      lead_time_days: 0,
      confidence: 0,
      reasoning: "AI není nakonfigurováno — doplň Claude API klíč v Nastavení → Integrace.",
      needs_clarification: ["Claude API klíč"],
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      material: { type: "string" },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            machine_minutes: { type: "number" },
            setup_minutes: { type: "number" },
          },
          required: ["name", "machine_minutes", "setup_minutes"],
        },
      },
      material_cost_per_piece: { type: "number" },
      cooperation_cost_per_piece: { type: "number" },
      labor_rate_per_hour: { type: "number" },
      margin_percent: { type: "number" },
      unit_price: { type: "number" },
      total_price: { type: "number" },
      lead_time_days: { type: "integer" },
      confidence: { type: "number" },
      reasoning: { type: "string" },
      needs_clarification: { type: "array", items: { type: "string" } },
    },
    required: [
      "material", "operations", "material_cost_per_piece", "cooperation_cost_per_piece",
      "labor_rate_per_hour", "margin_percent", "unit_price", "total_price",
      "lead_time_days", "confidence", "reasoning", "needs_clarification",
    ],
  };

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 2500,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system:
      "Jsi zkušený technolog a kalkulant CNC nástrojárny Mnástrojárna. Oceň díl podle výkresu a zadání. " +
      "Postupuj jako při reálné kalkulaci: materiál a polotovar, operace a jejich strojní/seřizovací čas, " +
      "kooperace (kalení, povlakování), množstevní efekt, hodinová sazba, marže, cena za kus i celkem, dodací lhůta. " +
      "Ceny v CZK. Buď realistický; u nejistot sniž confidence a doplň needs_clarification." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content:
          `Výkres: ${input.drawingNumber ?? "—"}\nMateriál: ${input.material ?? "neuvedeno"}\n` +
          `Rozměry: ${input.dimensions ?? "neuvedeno"}\nMnožství: ${input.quantity} ks\n` +
          `Požadavky: ${input.requirements ?? "—"}\n\n${input.drawingText ?? ""}`,
      },
    ],
  });

  return JSON.parse(textOf(message)) as PriceEstimate;
}

// ── Generování nabídky z poptávky ───────────────────────────
export interface GeneratedQuote {
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[];
  lead_time_days: number;
  valid_until_days: number;
  cover_email: string;
  note: string;
}

export async function generateQuote(input: {
  customer: string;
  inquiry: string;
  estimate?: PriceEstimate;
  rules?: string;
}): Promise<GeneratedQuote> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return {
      items: [],
      lead_time_days: 0,
      valid_until_days: 30,
      cover_email: "Nabídku vygeneruje AI po doplnění Claude API klíče v Nastavení.",
      note: "",
    };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            unit_price: { type: "number" },
            vat_rate: { type: "number" },
          },
          required: ["description", "quantity", "unit", "unit_price", "vat_rate"],
        },
      },
      lead_time_days: { type: "integer" },
      valid_until_days: { type: "integer" },
      cover_email: { type: "string" },
      note: { type: "string" },
    },
    required: ["items", "lead_time_days", "valid_until_days", "cover_email", "note"],
  };

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system:
      "Jsi obchodník nástrojárny Mnástrojárna. Z poptávky a kalkulace technologa sestav cenovou nabídku " +
      "(položky s cenami, dodací lhůta, platnost) a průvodní e-mail v češtině. Sazba DPH 21 %." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content:
          `Zákazník: ${input.customer}\nPoptávka: ${input.inquiry}\n` +
          (input.estimate
            ? `\nKalkulace technologa: cena/ks ${input.estimate.unit_price} CZK, celkem ${input.estimate.total_price} CZK, ` +
              `lhůta ${input.estimate.lead_time_days} dní, materiál ${input.estimate.material}.`
            : ""),
      },
    ],
  });

  return JSON.parse(textOf(message)) as GeneratedQuote;
}

// ── Potvrzení (poptávka / objednávka / faktura) ─────────────
export async function generateConfirmation(input: {
  kind: "poptavka" | "objednavka" | "faktura";
  reference: string;
  customer: string;
  rules?: string;
}): Promise<string> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return `Dobrý den,\n\npotvrzujeme přijetí (${input.reference}). (Plný text vygeneruje AI po doplnění klíče.)\n\nS pozdravem,\nMNástrojárna s.r.o.`;
  }

  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 900,
    output_config: { effort: "low" },
    system:
      "Jsi asistent nástrojárny Mnástrojárna. Napiš krátké zdvořilé potvrzení v češtině. " +
      "Podpis: 'S pozdravem, MNástrojárna s.r.o.'. Vrať pouze tělo e-mailu." +
      (input.rules ? `\n\n${input.rules}` : ""),
    messages: [
      {
        role: "user",
        content: `Typ potvrzení: ${input.kind}\nReference: ${input.reference}\nZákazník: ${input.customer}`,
      },
    ],
  });

  return textOf(message).trim();
}
