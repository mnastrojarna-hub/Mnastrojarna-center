import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { canSendFrom, describeSender, loadSendBoxes, type SendBoxRow, type SmtpPreference } from "@/lib/email/send";
import { outgoingSignature } from "@/lib/email/signature-server";

/**
 * Odkud odchází e-mail, který posílá uživatel z aplikace — JEDNO pravidlo pro každé odeslání
 * (doklad, nabídka, objednávka dodavateli, poptávka dodavateli, psaní / odpověď, schválení ve frontě,
 * fronta anonymizace). Majitel 9. 11.: „Když cokoliv odesílá ze systému Šponer, jde to ze Šponerova
 * mailu. Když cokoliv posílá Volný, jde to z Volného mailu. Jediný já si to můžu vybrat jakožto super admin."
 *
 *  - Kdokoli kromě super admina (i „plný přístup", obchodník, zaměstnanec): VŽDY vlastní schránka
 *    (send.ts pickSmtpMailbox: vlastní → u odpovědi firemní schránka, kam e-mail přišel → firemní → globální
 *    SMTP; nikdy osobní schránka kolegy). Požadovaná schránka z klienta se ignoruje.
 *  - Super admin (profiles.role = super_admin, ne plný přístup): požadovaná schránka (svoje, firemní i
 *    kolegy), umí-li odesílat; nevybral-li → jeho vlastní (stejně jako ostatní).
 *  - Podpis = ten, z čí schránky zpráva odchází: vybral-li super admin osobní schránku kolegy, podpis
 *    a jméno kolegy (odpověď dojde jemu, e-mail vypadá jako jeho); firemní / vlastní schránka → podpis
 *    super admina.
 *
 * Volající NIKDY nesestavuje `{ mailboxId }` sám — jen přes resolveSender, takže volbu nejde obejít z klienta.
 */

export interface SenderRequest {
  /** Schránka zvolená v „Odeslat z" (platí jen pro super admina). */
  mailboxId?: string | null;
  /** Odpověď: schránka, kam původní e-mail přišel (send.ts ji použije, je-li moje nebo firemní). */
  replyMailboxId?: string | null;
}

export interface SenderDecision {
  from: SmtpPreference;
  /** Čí podpis / jméno patří do e-mailu (vlastník zvolené schránky, jinak odesílatel). */
  signerId: string;
  /** Výslovně zvolená schránka (super admin), jinak null = výchozí vlastní. */
  chosenMailboxId: string | null;
}

/**
 * Čisté pravidlo (testy): kdo posílá (`superAdmin` = skutečná role v DB) + všechny schránky + požadavek.
 * Neexistující / neodesílající zvolená schránka se NEnahrazuje potichu jinou: zůstane `{ mailboxId }`
 * a send.ts odeslání odmítne s důvodem („Schránka … nemá nastavené odesílání").
 */
export function decideSender(actor: { id: string; superAdmin: boolean }, rows: SendBoxRow[], req: SenderRequest = {}): SenderDecision {
  const requested = typeof req.mailboxId === "string" ? req.mailboxId.trim().toLowerCase() : "";
  if (actor.superAdmin && requested) {
    const box = rows.find((b) => b.id.toLowerCase() === requested);
    return { from: { mailboxId: box?.id ?? requested }, signerId: box?.owner_id ?? actor.id, chosenMailboxId: box?.id ?? requested };
  }
  return {
    from: { ownerId: actor.id, ...(req.replyMailboxId ? { replyMailboxId: req.replyMailboxId } : {}) },
    signerId: actor.id,
    chosenMailboxId: null,
  };
}

export interface SenderOption {
  id: string;
  email: string;
  /** „info@… · firemní", „volny@… · Václav Volný". */
  label: string;
  kind: "own" | "company" | "user";
}

/** Schránky, ze kterých smí super admin poslat (umí odesílat): vlastní → firemní → kolegů (podle adresy). */
export function senderOptions(actorId: string, rows: SendBoxRow[], names: Record<string, string> = {}): SenderOption[] {
  const kindOf = (b: SendBoxRow): SenderOption["kind"] => (b.owner_id === actorId ? "own" : b.owner_id ? "user" : "company");
  const order = { own: 0, company: 1, user: 2 } as const;
  return rows
    .filter((b) => canSendFrom(b))
    .map((b) => {
      const kind = kindOf(b);
      const who = kind === "own" ? "moje" : kind === "company" ? "firemní" : (names[b.owner_id ?? ""] || "kolega");
      return { id: b.id, email: b.email, label: `${b.email} · ${who}`, kind };
    })
    .sort((a, b) => order[a.kind] - order[b.kind] || a.email.localeCompare(b.email, "cs"));
}

// ── server ───────────────────────────────────────────────────────────────────────────────────

function dbReady(): boolean {
  return isSupabaseConfigured() && hasServiceKey();
}

/** Je uživatel super admin (skutečná role v DB, aktivní)? Plný přístup NE — vybírat schránku nesmí. */
export async function isRealSuperAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !dbReady()) return false;
  try {
    const { data } = await createAdminClient({ actor: null }).from("profiles").select("role, active").eq("id", userId).maybeSingle();
    const p = data as { role: string | null; active: boolean | null } | null;
    return p?.role === "super_admin" && p.active !== false;
  } catch {
    return false;
  }
}

async function boxes(): Promise<SendBoxRow[]> {
  if (!dbReady()) return [];
  try {
    return await loadSendBoxes();
  } catch {
    return [];
  }
}

/**
 * Odkud pošle `actorId` (každé odeslání uživatele jde přes tohle): rozhodnutí + adresa, ze které by
 * zpráva opravdu odešla (null = odeslat nejde — důvod řekne send.ts při odeslání).
 */
export async function resolveSender(actorId: string, req: SenderRequest = {}): Promise<SenderDecision & { mailboxEmail: string | null }> {
  const wantsChoice = Boolean(req.mailboxId);
  const superAdmin = wantsChoice ? await isRealSuperAdmin(actorId) : false;
  const rows = wantsChoice && superAdmin ? await boxes() : [];
  const decision = decideSender({ id: actorId, superAdmin }, rows, req);
  let mailboxEmail: string | null = null;
  try {
    const d = await describeSender(decision.from);
    mailboxEmail = d.ok ? d.from ?? null : null;
  } catch {
    mailboxEmail = null;
  }
  return { ...decision, mailboxEmail };
}

/** Text podpisu pro rozhodnutí (návrh e-mailu v dialogu): podepisující + schránka, ze které zpráva odejde. */
export async function signatureForDecision(decision: SenderDecision & { mailboxEmail: string | null }): Promise<string> {
  if (!dbReady()) return "";
  try {
    return (await outgoingSignature({ userId: decision.signerId, mailboxEmail: decision.mailboxEmail })).text;
  } catch {
    return "";
  }
}

export interface SenderChoice {
  /** Smí vybírat (jen super admin). */
  canChoose: boolean;
  /** Výchozí schránka (vlastní; u odpovědi ta, kam e-mail přišel) — null = globální SMTP / nejde odeslat. */
  defaultMailboxId: string | null;
  defaultEmail: string | null;
  /** Proč odeslat nejde (výchozí odesílatel). */
  error?: string;
  options: SenderOption[];
}

/** Pro „Odeslat z" v dialozích: super admin dostane seznam schránek, ostatní jen svou adresu. */
export async function senderChoiceFor(actorId: string, req: { replyMailboxId?: string | null } = {}): Promise<SenderChoice> {
  const pref: SmtpPreference = { ownerId: actorId, ...(req.replyMailboxId ? { replyMailboxId: req.replyMailboxId } : {}) };
  const [sender, superAdmin] = await Promise.all([
    describeSender(pref).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : "chyba", from: undefined, mailboxId: null })),
    isRealSuperAdmin(actorId),
  ]);
  const base: SenderChoice = {
    canChoose: false,
    defaultMailboxId: sender.ok ? sender.mailboxId ?? null : null,
    defaultEmail: sender.ok ? sender.from ?? null : null,
    ...(sender.ok ? {} : { error: sender.reason }),
    options: [],
  };
  if (!superAdmin) return base;
  const rows = await boxes();
  const ownerIds = [...new Set(rows.map((b) => b.owner_id).filter((x): x is string => Boolean(x) && x !== actorId))];
  const names: Record<string, string> = {};
  if (ownerIds.length) {
    try {
      const { data } = await createAdminClient({ actor: null }).from("profiles").select("id, full_name").in("id", ownerIds);
      for (const p of (data ?? []) as { id: string; full_name: string | null }[]) if (p.full_name?.trim()) names[p.id] = p.full_name.trim();
    } catch {
      // jména jsou kosmetika
    }
  }
  return { ...base, canChoose: true, options: senderOptions(actorId, rows, names) };
}
