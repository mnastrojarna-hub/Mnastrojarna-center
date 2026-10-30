/**
 * Odeslání přes SMTP s opravou nejčastějších příčin „535 Incorrect authentication data" — čistá
 * logika bez sítě (pokus samotný dodá volající), aby šla testovat.
 *
 * Produkce 10/2026 (schránka hosting90): příjem fungoval, odeslání padalo na 535. Server je pro
 * IMAP/POP3 i SMTP stejný (195.181.248.81), takže heslo schránky platí i pro SMTP — aplikace ale
 * posílala uložené VLASTNÍ SMTP heslo (`config.smtp_password`, zbytek staršího formuláře), které
 * má přednost a v UI nebylo vidět. Postup (nejvýš 3 přihlášení — hosting90 při mnoha chybných
 * pokusech blokuje IP):
 *  1. uložené nastavení (síť / TLS selže → ověřené servery poskytovatele, jako dřív),
 *  2. odmítnuté heslo a vlastní SMTP heslo se liší od hesla příchozí pošty → znovu s heslem příchozí
 *     pošty (stahováním ověřené); když projde, volající uložené SMTP heslo smaže (`healSmtpPassword`),
 *  3. pořád odmítnuto → jednou druhým mechanismem AUTH (PLAIN ↔ LOGIN).
 * Chyba pak říká, kam (server:port, šifrování), jakým AUTH a s jakým heslem se zkoušelo.
 */
import {
  alternateAuthMethod, authMethodOf, classifyMailError, describeMailError, rawErrorText, SMTP_PASSWORD_SOURCE_LABEL, TLS_LABEL,
  type MailEndpoint, type MailErrorKind, type SmtpAuthMethod, type SmtpPasswordSource, type TlsMode,
} from "@/lib/email/mail-config";

export interface SmtpTry {
  host: string;
  port: number;
  tls: TlsMode;
  skipNameCheck?: boolean;
  user: string;
  password: string;
  passwordSource: SmtpPasswordSource;
  /** Vynucený mechanismus AUTH; bez něj první nabízený serverem (nodemailer: obvykle PLAIN). */
  authMethod?: SmtpAuthMethod;
}

export interface SmtpTryLog {
  host: string;
  port: number;
  tls: TlsMode;
  passwordSource: SmtpPasswordSource;
  authMethod?: SmtpAuthMethod;
  ok: boolean;
  kind?: MailErrorKind;
  raw?: string;
}

export interface SmtpRecoveryInput {
  first: SmtpTry;
  /** Heslo příchozí pošty, liší-li se od vlastního SMTP hesla (`resolveSmtp().incomingPassword`). */
  incomingPassword?: string;
  /** Ověřené servery poskytovatele pro chybu sítě / šifrování (ne hesla). */
  fallbacks?: () => Promise<Pick<MailEndpoint, "host" | "port" | "tls">[]>;
  attempt: (t: SmtpTry) => Promise<void>;
}

export interface SmtpRecoveryResult {
  ok: boolean;
  /** Poslední použité nastavení (úspěšné, nebo to, které odmítlo heslo / selhalo). */
  used: SmtpTry;
  error?: unknown;
  kind?: MailErrorKind;
  tries: SmtpTryLog[];
  /** Prošlo až s heslem příchozí pošty → uložené vlastní SMTP heslo je zastaralé (smazat). */
  healSmtpPassword: boolean;
}

/** Odmítnutí přihlášení (535 apod.), ne síť / TLS. */
export function isAuthRejection(err: unknown): boolean {
  return classifyMailError(err) === "auth";
}

export async function sendWithSmtpRecovery(input: SmtpRecoveryInput): Promise<SmtpRecoveryResult> {
  const tries: SmtpTryLog[] = [];
  const run = async (t: SmtpTry): Promise<unknown | null> => {
    const base = { host: t.host, port: t.port, tls: t.tls, passwordSource: t.passwordSource };
    try {
      await input.attempt(t);
      tries.push({ ...base, authMethod: t.authMethod, ok: true });
      return null;
    } catch (err) {
      tries.push({ ...base, authMethod: authMethodOf(err) ?? t.authMethod, ok: false, kind: classifyMailError(err), raw: rawErrorText(err) });
      return err ?? new Error("SMTP chyba");
    }
  };
  const done = (used: SmtpTry, heal = false): SmtpRecoveryResult => ({ ok: true, used, tries, healSmtpPassword: heal });
  const failed = (used: SmtpTry, error: unknown): SmtpRecoveryResult => ({ ok: false, used, error, kind: classifyMailError(error), tries, healSmtpPassword: false });

  let cur = input.first;
  let err = await run(cur);
  if (err === null) return done(cur);

  // 1) síť / šifrování → ověřené servery poskytovatele (heslo odmítnuté tam pokračuje opravou hesla)
  if (!isAuthRejection(err)) {
    let authErr: unknown = null;
    for (const ep of input.fallbacks ? await input.fallbacks().catch(() => []) : []) {
      if (ep.host === cur.host && ep.port === cur.port) continue;
      const t: SmtpTry = { ...cur, host: ep.host, port: ep.port, tls: ep.tls, skipNameCheck: false };
      const e2 = await run(t);
      if (e2 === null) return done(t);
      if (isAuthRejection(e2)) {
        cur = t;
        authErr = e2;
        break;
      }
    }
    if (!authErr) return failed(input.first, err);
    err = authErr;
  }

  // 2) vlastní SMTP heslo odmítnuto → heslo příchozí pošty (ověřené stahováním)
  const incoming = input.incomingPassword;
  if (cur.passwordSource === "smtp" && incoming && incoming !== cur.password) {
    const t: SmtpTry = { ...cur, password: incoming, passwordSource: "incoming" };
    const e2 = await run(t);
    if (e2 === null) return done(t, true);
    if (!isAuthRejection(e2)) return failed(t, e2);
    cur = t;
    err = e2;
  }

  // 3) druhý mechanismus AUTH (PLAIN ↔ LOGIN), jednou
  const usedMethod = authMethodOf(err) ?? cur.authMethod;
  const alt: SmtpTry = { ...cur, authMethod: alternateAuthMethod(usedMethod) };
  const e3 = await run(alt);
  if (e3 === null) return done(alt, alt.passwordSource === "incoming" && input.first.passwordSource === "smtp");
  // neznámý mechanismus (504) apod. — hlásit původní odmítnutí hesla
  return isAuthRejection(e3) && /\b535\b/.test(rawErrorText(e3)) ? failed(alt, e3) : failed(cur, err);
}

/** „smtp.x.cz:366 STARTTLS · AUTH PLAIN · vlastní SMTP heslo" */
export function describeSmtpTry(t: Pick<SmtpTryLog, "host" | "port" | "tls" | "authMethod" | "passwordSource">): string {
  return `${t.host}:${t.port} ${TLS_LABEL[t.tls]} · AUTH ${t.authMethod ?? "PLAIN/LOGIN dle serveru"} · ${SMTP_PASSWORD_SOURCE_LABEL[t.passwordSource]}`;
}

/** Co dělat při odmítnutém hesle (podle toho, čí schránka to je). */
export function smtpAuthNextStep(kind: "own" | "company" | "global"): string {
  if (kind === "global") return "Co dál: oprav heslo globálního SMTP v Nastavení → API klíče a integrace (super admin).";
  if (kind === "company") return "Co dál: zadej heslo schránky znovu v Nastavení → E-mailové schránky → Upravit → Změnit heslo (super admin) a klikni na Vyzkoušet odeslání.";
  return "Co dál: zadej heslo ke schránce znovu v Můj účet → Moje e-mailová schránka → Upravit a klikni na Vyzkoušet odeslání. Když ani to nepomůže, heslo platí jen pro příjem — ověř ho v administraci schránky u poskytovatele (hosting90).";
}

/** Česká hláška o neúspěšném odeslání: příčina + kam/jak/s jakým heslem se zkoušelo + další krok. */
export function describeSmtpFailure(r: SmtpRecoveryResult, ctx: { owner: "own" | "company" | "global" }): string {
  const kind = r.kind ?? "other";
  const u = r.used;
  const endpoint: MailEndpoint = { protocol: "smtp", host: u.host, port: u.port, tls: u.tls };
  const base = describeMailError(kind, { endpoint, raw: rawErrorText(r.error), user: u.user });
  if (kind !== "auth") return base;
  const tried = r.tries.filter((t) => !t.ok).map((t) => `${describeSmtpTry(t)} → ${t.kind === "auth" ? "odmítnuto" : "chyba"}`);
  return `${base} Zkoušeno: ${tried.join("; ")}. ${smtpAuthNextStep(ctx.owner)}`;
}
