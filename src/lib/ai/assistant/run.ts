import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig } from "@/lib/settings";
import { ASSISTANT_TOOLS, runAssistantTool } from "./tools";

/**
 * Firemní AI asistent (majitel 26. 11.): drží linku konverzace (předchozí dotazy a odpovědi jdou s každým
 * dotazem) a data si sám dohledá a přečte nástroji (zakázky, pošta, dokumenty, faktury…) — vždy jen to,
 * co smí vidět přihlášený uživatel. Jen čte.
 */
const SYSTEM = [
  "Jsi firemní AI asistent nástrojárny Mnástrojárna s.r.o. (kooperace obrábění, zakázková výroba).",
  "Odpovídáš česky, věcně a konkrétně — čísla zakázek, výkresů, nabídek, faktur, data a částky uváděj přesně.",
  "Data NEHÁDEJ: vždy si je dohledej nástroji (zakázky, detail zakázky, pošta, e-maily a jejich přílohy, dokumenty zakázky, nabídky, faktury, zákazníci, dodavatelé, výkresy, provize).",
  "Když dotaz navazuje na předchozí („a kolik to stálo?“, „pošli mi ten mail“, „co k tomu psal?“), vztáhni ho k tomu, o čem byla řeč v konverzaci.",
  "Hledej postupně: najdi zakázku / e-mail, pak si otevři detail nebo dokument. Když nic nenajdeš, zkus jiná slova (číslo bez předpony, název firmy, číslo výkresu) a teprve pak řekni, že to v systému není.",
  "Nic neměníš ani neodesíláš — když uživatel chce něco udělat, řekni mu, kde to v aplikaci najde.",
  "Odpověď piš stručně; delší výčty jako krátký seznam. Uváděj, odkud informace je (např. „zakázka Z-2026-025“, „e-mail od X z 12. 11.“).",
].join("\n");

const MAX_ROUNDS = 10;

export interface AssistantTurn { role: "user" | "assistant"; content: string }

export async function runAssistant(input: { history: AssistantTurn[]; question: string; today: string }): Promise<{ answer: string; tools: string[] }> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) {
    return { answer: "AI asistent zatím není aktivní — doplň Claude API klíč v Nastavení → Integrace.", tools: [] };
  }
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...input.history.slice(-30).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `(Dnes je ${input.today}.)\n\n${input.question}` },
  ];
  const used: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: ASSISTANT_TOOLS,
      messages,
    });
    if (res.stop_reason === "refusal") return { answer: "Na tohle ti neodpovím.", tools: used };
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: text || "Odpověď se nepodařilo sestavit — zkus dotaz položit jinak.", tools: used };
    }
    // celé content (i thinking bloky) zpět beze změny
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
      used.push(c.name);
      try {
        const out = await runAssistantTool(c.name, (c.input ?? {}) as Record<string, unknown>);
        return { type: "tool_result", tool_use_id: c.id, content: out };
      } catch (err) {
        return { type: "tool_result", tool_use_id: c.id, is_error: true, content: err instanceof Error ? err.message : "Nástroj selhal." };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  return { answer: "Dotaz je příliš rozsáhlý — zkus ho rozdělit na menší otázky.", tools: used };
}
