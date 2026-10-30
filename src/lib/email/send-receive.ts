/**
 * „Přijmout a odeslat" (Pošta) — čistá logika výsledku (testy v send-receive.test.ts): krátká česká
 * hláška „Přijato 3, odesláno 1." + co opravit, když něco selhalo.
 */

export interface ReceiveOutcome {
  ok: boolean;
  text: string;
  ingested: number;
  configured: boolean;
}

export interface SendOutcome {
  ok: boolean;
  error?: string;
  sent: number;
  failed: number;
  errors: { subject: string; error: string }[];
  needsSettings: boolean;
  waitingDrawings: number;
  blockedDrawings: number;
}

export interface SendReceiveSummary {
  ok: boolean;
  text: string;
  /** Chyba v nastavení schránky (heslo / server) → nabídnout „Nastavení pošty". */
  needsSettings: boolean;
}

const AUTH_RE = /heslo odmítnuto|přihlášení odmítnuto|incorrect authentication|authentication failed|smtp není nakonfigurováno|nenastaven/i;

function messages(n: number): string {
  return n === 1 ? "zpráva" : n >= 2 && n <= 4 ? "zprávy" : "zpráv";
}

export function sendReceiveText(received: ReceiveOutcome | null, sent: SendOutcome | null): SendReceiveSummary {
  const parts: string[] = [];
  const inN = received?.configured ? received.ingested : 0;
  const outN = sent?.sent ?? 0;
  parts.push(`Přijato ${inN}, odesláno ${outN}.`);
  let ok = true;
  let needsSettings = false;
  if (received && !received.configured) {
    parts.push(received.text);
    needsSettings = true;
    ok = false;
  } else if (received && !received.ok) {
    parts.push(`Příjem: ${received.text}`);
    ok = false;
    if (AUTH_RE.test(received.text)) needsSettings = true;
  } else if (received && /zbytek se stáhne/.test(received.text)) {
    parts.push("Zbytek starší pošty se stahuje dál.");
  }
  if (sent && !sent.ok && sent.error) {
    parts.push(`Odesílání: ${sent.error}`);
    ok = false;
  }
  if (sent && sent.failed > 0) {
    ok = false;
    const first = sent.errors[0];
    parts.push(`Neodesláno ${sent.failed} ${messages(sent.failed)}${first ? ` („${first.subject || "bez předmětu"}“): ${first.error}` : "."}`);
    if (sent.needsSettings) needsSettings = true;
  }
  if (sent?.waitingDrawings) parts.push(`Čeká na anonymizaci výkresů: ${sent.waitingDrawings} (odejde samo, až bude hotovo).`);
  if (sent?.blockedDrawings) parts.push(`Čeká na tvou kontrolu výkresů v zakázce: ${sent.blockedDrawings}.`);
  if (needsSettings) parts.push("Oprav to v Nastavení pošty → Schránka.");
  return { ok, text: parts.join(" "), needsSettings };
}
