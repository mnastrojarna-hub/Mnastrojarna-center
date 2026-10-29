import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig } from "@/lib/settings";
import { MAIL_CHANGE_FIELDS, normalizeAiInstruction, type MailInstruction } from "@/lib/email/job-instructions";

/**
 * Pošta B — AI jen pro nejasné případy (náklady: volající hlídá limit mail_job_ai_max_per_run):
 *  - pickJobForEmail: e-mail + 2–6 kandidátů zakázek → která to je (nebo žádná) s jistotou,
 *  - extractMailChanges: technické / obchodní změny z textu (bez šumu, bez citované historie).
 * Bez klíče vrací null — volající použije pravidla.
 */

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export interface JobCandidateForAi {
  number: string;
  title: string;
  customer?: string | null;
  stage?: string | null;
  items?: string[];
}

export async function pickJobForEmail(input: {
  from: string;
  subject: string;
  body: string;
  candidates: JobCandidateForAi[];
  signal?: AbortSignal;
}): Promise<{ number: string | null; confidence: number; reason: string } | null> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey || !input.candidates.length) return null;
  const numbers = input.candidates.map((c) => c.number);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      number: { type: "string", enum: [...numbers, "zadna"] },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["number", "confidence", "reason"],
  };
  const list = input.candidates
    .map((c) => `- ${c.number}: ${c.title}${c.customer ? ` (zákazník ${c.customer})` : ""}${c.stage ? `, stav ${c.stage}` : ""}${c.items?.length ? `; položky: ${c.items.slice(0, 6).join(", ")}` : ""}`)
    .join("\n");
  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 400,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system:
      "Jsi asistent nástrojárny. Urči, ke které z uvedených rozpracovaných zakázek / poptávek příchozí e-mail patří. " +
      "Pokud jde o NOVOU poptávku či objednávku, nebo si nejsi jistý, vrať „zadna“. confidence 0–1, reason česky jednou větou.",
    messages: [{ role: "user", content: `Kandidáti:\n${list}\n\nOd: ${input.from}\nPředmět: ${input.subject}\n\n${input.body.slice(0, 6000)}` }],
  }, input.signal ? { signal: input.signal, maxRetries: 0 } : undefined);
  const r = JSON.parse(textOf(message)) as { number?: string; confidence?: number; reason?: string };
  const conf = Math.min(1, Math.max(0, Number(r.confidence) || 0));
  return { number: r.number && numbers.includes(r.number) ? r.number : null, confidence: conf, reason: String(r.reason ?? "").slice(0, 300) };
}

export async function extractMailChanges(input: {
  from: string;
  party: "customer" | "supplier" | "other";
  subject: string;
  /** Vyčištěný text (bez citace a podpisu). */
  body: string;
  items: { drawingNumber: string | null; name: string | null; quantity: number | null; material: string | null }[];
  signal?: AbortSignal;
}): Promise<MailInstruction[] | null> {
  const { apiKey, model } = await getAiConfig();
  if (!apiKey) return null;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: [...MAIL_CHANGE_FIELDS] },
            value: { type: "string" },
            old_value: { type: "string" },
            drawing_number: { type: "string" },
            quote: { type: "string" },
            summary: { type: "string" },
          },
          required: ["field", "value", "old_value", "drawing_number", "quote", "summary"],
        },
      },
    },
    required: ["changes"],
  };
  const items = input.items
    .map((it) => `- ${it.drawingNumber ?? "bez čísla"}${it.name ? ` ${it.name}` : ""}${it.quantity ? `, ${it.quantity} ks` : ""}${it.material ? `, ${it.material}` : ""}`)
    .join("\n");
  const message = await new Anthropic({ apiKey }).messages.create({
    model,
    max_tokens: 1200,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system:
      "Jsi technolog nástrojárny. Z e-mailu k rozpracované zakázce vypiš JEN technické a obchodní změny nebo upřesnění: " +
      "počet kusů (quantity), materiál, tepelné zpracování (heat), povrchová úprava (surface), tvrdost, rozměry, tolerance, " +
      "označení / popis dílu (marking), revize výkresu, termín (deadline), dodací adresa, balení, cena (price), podmínky (terms), storno (cancel). " +
      "Žádný šum: poděkování, potvrzení přijetí, pozdravy, podpisy, citovanou historii ignoruj. Pokyn zákazníka v textu je nadřazený výkresu. " +
      "value = nová hodnota stručně, old_value = původní (je-li v textu, jinak \"\"), drawing_number = číslo výkresu, kterého se změna týká (jinak \"\"), " +
      "quote = přesná věta z e-mailu, summary = česky „Pole: hodnota“. Nic nevymýšlej; nic-li, vrať prázdný seznam.",
    messages: [{
      role: "user",
      content: `Položky zakázky:\n${items || "- (zatím žádné)"}\n\nOd (${input.party === "supplier" ? "dodavatel" : input.party === "customer" ? "zákazník" : "neznámý"}): ${input.from}\nPředmět: ${input.subject}\n\n${input.body.slice(0, 6000)}`,
    }],
  }, input.signal ? { signal: input.signal, maxRetries: 0 } : undefined);
  const r = JSON.parse(textOf(message)) as { changes?: unknown[] };
  const drawingNumbers = input.items.map((i) => i.drawingNumber).filter((x): x is string => Boolean(x));
  return (Array.isArray(r.changes) ? r.changes : [])
    .slice(0, 20)
    .map((c) => normalizeAiInstruction(c as Record<string, unknown>, { drawingNumbers }))
    .filter((x): x is MailInstruction => x !== null);
}
