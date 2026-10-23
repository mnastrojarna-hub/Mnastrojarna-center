/**
 * „Moje" obchodního toku (#25, pravidlo 1) — čistá logika bez DB (sdílí server i klient).
 *
 * Obchodní tok (Poptávky, Nabídky, Potvrzení objednávek, Objednávky dodavatelům, Dokumenty, odznaky
 * menu, ⌘K „Nabídky") vidí ne-admin jen „svůj"; super admin vše (flow_all), s přepínačem „Jen moje".
 * „Moje" je FILTR datových dotazů, ne hranice oprávnění — Kniha zakázek, detail zakázky, zákazníci
 * a dodavatelé zůstávají všem.
 *
 * Zakázka J je „moje" pro uživatele U (M(U) = schránky, jejichž vlastníkem je U), když:
 *   (a) J.owner_id = U (Obchodník)  (b) J.assignee_id = U (Zpracovává)  (c) J.created_by = U (Založil)
 *   (d) e-mail J.email_id má owner_id = U nebo mailbox_id ∈ M(U)
 *   (e) nějaký e-mail s order_id = J má owner_id = U nebo mailbox_id ∈ M(U) (i moje odeslaná pošta)
 *   (f) nějaká nabídka J má U mezi created_by / owner_id / approval_requested_by.
 * SQL dvojče: flow_mine_job_ids(p_user) (migrace 20261023155000) — test parity hlídá shodu.
 * Vlastník zákazníka do „moje" záměrně nepatří (bylo by širší než „ze SVÉHO mailu").
 */

export type FlowWho = "vsichni" | "moje";
export const FLOW_WHO_PARAM = "kdo";
export const FLOW_WHO_COOKIE = "flow_kdo";
/** Platnost volby super admina „Všichni / Jen moje" (dny). */
export const FLOW_WHO_COOKIE_DAYS = 180;
/** p_mine pro uživatele bez přístupu — nikdo (nikdy null = „všichni"). */
export const NOBODY = "00000000-0000-0000-0000-000000000000";

export interface FlowViewer {
  userId: string;
  /** true = vidí obchodní tok všech (super admin v režimu „Všichni"). */
  all: boolean;
  who: FlowWho;
  /** Smí přepínat „Všichni / Jen moje" (flow_all). */
  canToggle: boolean;
}

export interface FlowScope extends FlowViewer {
  /** Moje zakázky (prázdné u all). */
  jobIds: ReadonlySet<string>;
  /** Moje schránky (id) a jejich adresy (poznámka v liště rozsahu). */
  mailboxIds: readonly string[];
  mailboxEmails: readonly string[];
  /** RPC selhalo → seznamy jsou prázdné a lišta rozsahu to řekne (nikdy „Žádná poptávka nečeká"). */
  error: boolean;
}

function firstString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return null;
}

/** Ne-admin → vždy „moje"; admin → „moje" jen na výslovné přání (?kdo=moje / cookie). */
export function parseFlowWho(raw: unknown, canAll: boolean): FlowWho {
  if (!canAll) return "moje";
  return (firstString(raw) ?? "").trim().toLowerCase() === "moje" ? "moje" : "vsichni";
}

/** SQL p_mine: null = všichni (admin „Všichni"), jinak id uživatele; bez přístupu = nikdo. */
export function mineParam(v: FlowViewer | null | undefined): string | null {
  if (!v || !v.userId) return NOBODY;
  return v.all ? null : v.userId;
}

export interface MineJobFacts {
  ownerId: string | null;
  assigneeId: string | null;
  createdBy: string | null;
  /** E-maily zakázky: J.email_id (d) a e-maily s order_id = J (e). */
  emails: readonly { ownerId: string | null; mailboxId: string | null }[];
  /** Lidé nabídek zakázky (created_by, owner_id, approval_requested_by) (f). */
  quotePeople: readonly (string | null)[];
}

/** TS dvojče SQL flow_mine_job_ids (test parity). */
export function isMineJob(f: MineJobFacts, viewer: { userId: string; mailboxIds: readonly string[] }): boolean {
  const u = viewer.userId;
  if (!u) return false;
  if (f.ownerId === u || f.assigneeId === u || f.createdBy === u) return true;
  if (f.emails.some((e) => e.ownerId === u || (e.mailboxId !== null && viewer.mailboxIds.includes(e.mailboxId)))) return true;
  return f.quotePeople.some((p) => p === u);
}

/** Zakázka v rozsahu. null rozsah = bez přístupu → false (fail closed); all → true; chyba → false. */
export function inScope(scope: FlowScope | null | undefined, jobId: string | null | undefined): boolean {
  if (!scope) return false;
  if (scope.all) return true;
  if (scope.error || !jobId) return false;
  return scope.jobIds.has(jobId.toLowerCase()) || scope.jobIds.has(jobId);
}

/** Rozsah použitelný pro „moje" (ne všichni, bez chyby) — jinak null. */
function mineOf(scope: FlowScope | null | undefined): FlowScope | null {
  if (!scope || scope.all || scope.error || !scope.userId) return null;
  return scope;
}

/** Nabídka: moje zakázka, nebo jsem ji vytvořil / jsem její obchodník / žádal o schválení (i bez zakázky). */
export function isMineQuote(
  q: { jobId: string | null; createdBy: string | null; ownerId?: string | null; approvalRequestedBy?: string | null },
  scope: FlowScope | null | undefined,
): boolean {
  if (scope?.all) return true;
  const s = mineOf(scope);
  if (!s) return false;
  if (q.jobId && inScope(s, q.jobId)) return true;
  return [q.createdBy, q.ownerId ?? null, q.approvalRequestedBy ?? null].includes(s.userId);
}

/** Dokument: moje zakázka, nebo jsem ho nahrál. */
export function isMineFile(f: { jobId: string; uploadedBy: string | null }, scope: FlowScope | null | undefined): boolean {
  if (scope?.all) return true;
  const s = mineOf(scope);
  if (!s) return false;
  return inScope(s, f.jobId) || f.uploadedBy === s.userId;
}

/** Objednávka dodavateli: moje zakázka, nebo jsem ji vytvořil / odeslal / odešla z mé schránky. */
export function isMinePurchaseOrder(
  p: { jobId: string; createdBy: string | null; sentBy?: string | null; sentMailboxId?: string | null },
  scope: FlowScope | null | undefined,
): boolean {
  if (scope?.all) return true;
  const s = mineOf(scope);
  if (!s) return false;
  if (inScope(s, p.jobId)) return true;
  if (p.createdBy === s.userId || (p.sentBy ?? null) === s.userId) return true;
  return Boolean(p.sentMailboxId && s.mailboxIds.includes(p.sentMailboxId));
}

/** Rozsah „všichni" (super admin) — pomocník pro testy a volající bez DB. */
export function allScope(userId: string): FlowScope {
  return {
    userId, all: true, who: "vsichni", canToggle: true, jobIds: new Set(), mailboxIds: [], mailboxEmails: [], error: false,
  };
}
