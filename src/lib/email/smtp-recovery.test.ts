import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { sendWithSmtpRecovery, describeSmtpFailure, type SmtpTry } from "./smtp-recovery";
import { smtpTransport } from "./mail-connect";
import {
  alternateAuthMethod, authMethodOf, classifyMailError, mergeMailboxSecrets, normalizeMailboxConfig, resolveSmtp, endpointLabel,
  buildCandidates, PRESETS,
} from "./mail-config";

/**
 * BUG produkce 10/2026: „Odeslání selhalo — Přihlášení odmítnuto — server smtp.nastrojarstvi.com nepřijal
 * uživatele nebo heslo … 535 Incorrect authentication data", přitom příjem ze stejné schránky (stejný
 * server hosting90) fungoval. Příčina: uložené vlastní `smtp_password` (zbytek staršího formuláře, kde
 * pole „SMTP heslo“ bylo vždy vidět a ukládalo se), které má přednost před heslem schránky, v UI nebylo
 * vidět a odškrtnuté „SMTP má jiné heslo“ ho nesmazalo.
 */

const auth535 = (method = "PLAIN") =>
  Object.assign(new Error("Invalid login: 535 Incorrect authentication data"), { code: "EAUTH", responseCode: 535, response: "535 Incorrect authentication data", command: `AUTH ${method}` });
const netErr = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

const STALE: SmtpTry = {
  host: "smtp.nastrojarstvi.com", port: 366, tls: "starttls", user: "semorad@nastrojarstvi.com", password: "stare-smtp", passwordSource: "smtp",
};

describe("resolveSmtp — odkud je heslo", () => {
  it("vlastní SMTP heslo má přednost, heslo příchozí pošty je záloha (jen když se liší)", () => {
    const r = resolveSmtp({ imap_host: "mail.hosting90.cz", imap_password: "schranka", smtp_host: "smtp.nastrojarstvi.com", smtp_port: 366, smtp_password: "stare" }, "Semorad@Nastrojarstvi.com");
    expect(r).toMatchObject({ host: "smtp.nastrojarstvi.com", port: 366, tls: "starttls", user: "semorad@nastrojarstvi.com", password: "stare", passwordSource: "smtp", incomingPassword: "schranka" });
    const same = resolveSmtp({ imap_password: "x", smtp_host: "s", smtp_password: "x" }, "a@b.cz");
    expect(same?.incomingPassword).toBeUndefined();
    expect(resolveSmtp({ imap_password: "x", smtp_host: "s" }, "a@b.cz")).toMatchObject({ password: "x", passwordSource: "incoming" });
  });
});

describe("mergeMailboxSecrets — změna hesla schránky mění i heslo, které používá SMTP", () => {
  const prev = { imap_password: "Stare", smtp_password: "Jine-stare" };
  it("nové heslo schránky → staré vlastní SMTP heslo pryč (dřív zůstalo → 535)", () => {
    const out = mergeMailboxSecrets(prev, {}, { imap_password: "Nove" });
    expect(out).toEqual({ imap_password: "Nove" });
    expect(resolveSmtp({ ...out, smtp_host: "s" }, "a@b.cz")).toMatchObject({ password: "Nove", passwordSource: "incoming" });
  });
  it("odškrtnuté „SMTP má jiné heslo“ → smazat i bez změny hesla schránky", () => {
    expect(mergeMailboxSecrets(prev, {}, { clear_smtp_password: true })).toEqual({ imap_password: "Stare" });
  });
  it("zaškrtnuté (ponechat) + nové heslo schránky → vlastní SMTP heslo zůstane", () => {
    expect(mergeMailboxSecrets(prev, {}, { imap_password: "Nove", keep_smtp_password: true })).toEqual({ imap_password: "Nove", smtp_password: "Jine-stare" });
  });
  it("výslovně zadané SMTP heslo vyhrává i nad „smazat“", () => {
    expect(mergeMailboxSecrets(prev, {}, { smtp_password: "Nove-smtp", clear_smtp_password: true })).toEqual({ imap_password: "Stare", smtp_password: "Nove-smtp" });
  });
  it("úprava bez hesel (ani jedno zaškrtávátko neposláno) nic nemaže — staré volání", () => {
    expect(mergeMailboxSecrets(prev, { imap_host: "h" })).toEqual({ imap_host: "h", imap_password: "Stare", smtp_password: "Jine-stare" });
  });
  it("stejné heslo znovu zadané u schránky (beze změny) SMTP heslo nemaže", () => {
    expect(mergeMailboxSecrets(prev, {}, { imap_password: "Stare" })).toEqual(prev);
  });
});

describe("Outlook „Žádné“ (port 366 bez SSL)", () => {
  it("normalizace: `none` jen u SMTP, u příchozí pošty ne", () => {
    const { config } = normalizeMailboxConfig({ smtp_host: "smtp.nastrojarstvi.com", smtp_port: 366, smtp_tls: "none", imap_tls: "none" as never, imap_host: "mail.hosting90.cz" });
    expect(config.smtp_tls).toBe("none");
    expect(config.imap_tls).toBeUndefined();
    expect(resolveSmtp({ ...config, imap_password: "x" }, "a@b.cz")?.tls).toBe("none");
    expect(endpointLabel({ protocol: "smtp", host: "smtp.nastrojarstvi.com", port: 366, tls: "none" })).toBe("SMTP smtp.nastrojarstvi.com:366 bez SSL (STARTTLS, nabídne-li ho server)");
  });
  it("„Najít nastavení“: zadaný port 366 + Žádné jde jako první; port 366 i u neznámého serveru", () => {
    const { smtp } = buildCandidates({ email: "semorad@nastrojarstvi.com", smtpHost: "smtp.nastrojarstvi.com", smtpPort: 366, smtpTls: "none" }, { preset: PRESETS.hosting90 });
    expect(smtp[0]).toMatchObject({ host: "smtp.nastrojarstvi.com", port: 366, tls: "none" });
    expect(smtp.some((e) => e.host === "smtp.nastrojarstvi.com" && e.port === 366 && e.tls === "starttls")).toBe(true);
    // bez výslovné volby se „bez SSL“ nikdy nezkouší
    const auto = buildCandidates({ email: "a@firma.cz", smtpHost: "smtp.firma.cz" }, { preset: null });
    expect(auto.smtp.some((e) => e.tls === "none")).toBe(false);
    expect(auto.smtp.some((e) => e.port === 366)).toBe(true);
  });
});

describe("sendWithSmtpRecovery — opravy při 535", () => {
  it("PŘÍČINA: zastaralé vlastní SMTP heslo → druhý pokus heslem příchozí pošty projde → smazat SMTP heslo", async () => {
    const seen: SmtpTry[] = [];
    const r = await sendWithSmtpRecovery({
      first: STALE, incomingPassword: "heslo-schranky",
      attempt: async (t) => { seen.push(t); if (t.password !== "heslo-schranky") throw auth535(); },
    });
    expect(r.ok).toBe(true);
    expect(r.healSmtpPassword).toBe(true);
    expect(r.used).toMatchObject({ password: "heslo-schranky", passwordSource: "incoming", host: "smtp.nastrojarstvi.com", port: 366 });
    expect(seen).toHaveLength(2);
  });

  it("obě hesla odmítnuta → jednou druhý mechanismus AUTH (PLAIN → LOGIN), nejvýš 3 pokusy; chyba říká kam, jak a s jakým heslem", async () => {
    const seen: SmtpTry[] = [];
    const r = await sendWithSmtpRecovery({
      first: STALE, incomingPassword: "heslo-schranky",
      attempt: async (t) => { seen.push(t); throw auth535(t.authMethod ?? "PLAIN"); },
    });
    expect(r.ok).toBe(false);
    expect(seen.map((t) => `${t.passwordSource}/${t.authMethod ?? "-"}`)).toEqual(["smtp/-", "incoming/-", "incoming/LOGIN"]);
    const msg = describeSmtpFailure(r, { owner: "own" });
    expect(msg).toMatch(/^Přihlášení odmítnuto — server smtp\.nastrojarstvi\.com nepřijal uživatele nebo heslo \(uživatel semorad@nastrojarstvi\.com\)/);
    expect(msg).toContain("535 Incorrect authentication data");
    expect(msg).toContain("smtp.nastrojarstvi.com:366 STARTTLS · AUTH PLAIN · vlastní SMTP heslo → odmítnuto");
    expect(msg).toContain("smtp.nastrojarstvi.com:366 STARTTLS · AUTH PLAIN · heslo příchozí pošty → odmítnuto");
    expect(msg).toContain("AUTH LOGIN · heslo příchozí pošty → odmítnuto");
    expect(msg).toContain("Co dál: zadej heslo ke schránce znovu v Můj účet → Moje e-mailová schránka → Upravit");
    expect(describeSmtpFailure(r, { owner: "company" })).toContain("Nastavení → E-mailové schránky → Upravit → Změnit heslo");
  });

  it("server přijme jen AUTH LOGIN (PLAIN 535) → druhý mechanismus projde, heslo se nemaže", async () => {
    const r = await sendWithSmtpRecovery({
      first: { ...STALE, password: "ok", passwordSource: "incoming" },
      attempt: async (t) => { if (t.authMethod !== "LOGIN") throw auth535("PLAIN"); },
    });
    expect(r).toMatchObject({ ok: true, healSmtpPassword: false, used: { authMethod: "LOGIN" } });
    expect(r.tries).toHaveLength(2);
  });

  it("bez vlastního SMTP hesla se heslo schránky nezkouší dvakrát (2 pokusy: PLAIN, LOGIN)", async () => {
    let n = 0;
    const r = await sendWithSmtpRecovery({ first: { ...STALE, passwordSource: "incoming" }, incomingPassword: undefined, attempt: async () => { n++; throw auth535(); } });
    expect(r.ok).toBe(false);
    expect(n).toBe(2);
  });

  it("síť / TLS → ověřený server poskytovatele; tam 535 → oprava hesla na NĚM a hláška jmenuje ten server", async () => {
    const seen: string[] = [];
    const r = await sendWithSmtpRecovery({
      first: STALE, incomingPassword: "heslo-schranky",
      fallbacks: async () => [{ host: "smtp.hosting90.cz", port: 465, tls: "tls" }],
      attempt: async (t) => {
        seen.push(`${t.host}:${t.port}:${t.passwordSource}`);
        if (t.host === "smtp.nastrojarstvi.com") throw netErr();
        if (t.password !== "heslo-schranky") throw auth535();
      },
    });
    expect(seen).toEqual(["smtp.nastrojarstvi.com:366:smtp", "smtp.hosting90.cz:465:smtp", "smtp.hosting90.cz:465:incoming"]);
    expect(r).toMatchObject({ ok: true, healSmtpPassword: true, used: { host: "smtp.hosting90.cz", port: 465 } });
  });

  it("síťová chyba bez fungující zálohy → původní chyba a server", async () => {
    const r = await sendWithSmtpRecovery({ first: STALE, fallbacks: async () => [], attempt: async () => { throw netErr(); } });
    expect(r).toMatchObject({ ok: false, kind: "refused", used: { host: "smtp.nastrojarstvi.com", port: 366 } });
    expect(describeSmtpFailure(r, { owner: "own" })).toMatch(/^Port 366 na serveru smtp\.nastrojarstvi\.com je zavřený/);
  });

  it("druhý mechanismus server nezná (504) → hlásí se původní odmítnutí hesla", async () => {
    const r = await sendWithSmtpRecovery({
      first: { ...STALE, passwordSource: "incoming" },
      attempt: async (t) => {
        if (t.authMethod === "LOGIN") throw Object.assign(new Error("Invalid login: 504 5.5.4 Unrecognized authentication type"), { code: "EAUTH", responseCode: 504, command: "AUTH LOGIN" });
        throw auth535();
      },
    });
    expect(r.ok).toBe(false);
    expect(r.used.authMethod).toBeUndefined();
    expect(describeSmtpFailure(r, { owner: "own" })).toContain("535 Incorrect authentication data");
  });

  it("mechanismus AUTH z chyby nodemaileru", () => {
    expect(authMethodOf({ command: "AUTH PLAIN" })).toBe("PLAIN");
    expect(authMethodOf({ command: "AUTH LOGIN" })).toBe("LOGIN");
    expect(authMethodOf({ command: "MAIL FROM" })).toBeUndefined();
    expect(alternateAuthMethod("PLAIN")).toBe("LOGIN");
    expect(alternateAuthMethod("LOGIN")).toBe("PLAIN");
    expect(alternateAuthMethod(undefined)).toBe("LOGIN");
    expect(classifyMailError(auth535())).toBe("auth");
  });
});

/**
 * Skutečný nodemailer proti malému SMTP serveru jako Exim u hosting90 (535 Incorrect authentication data):
 * port bez SSL, AUTH PLAIN LOGIN, volitelně jen LOGIN; zaznamenává použitý mechanismus a heslo.
 */
type Fake = { port: number; auths: { mech: string; user: string; pass: string; ok: boolean }[]; close: () => Promise<void> };
async function fakeExim(opts: { pass: string; onlyLogin?: boolean; starttls?: boolean }): Promise<Fake> {
  const auths: Fake["auths"] = [];
  const server = net.createServer((sock) => {
    let buf = "";
    let st: { login?: "user" | "pass"; user?: string; data?: boolean; authed?: boolean } = {};
    const w = (l: string) => sock.write(`${l}\r\n`);
    const finish = (mech: string, user: string, pass: string) => {
      const ok = user === "semorad@nastrojarstvi.com" && pass === opts.pass && !(opts.onlyLogin && mech === "PLAIN");
      auths.push({ mech, user, pass, ok });
      if (ok) st.authed = true;
      w(ok ? "235 Authentication succeeded" : "535 Incorrect authentication data");
    };
    w("220 smtp.hosting90.test ESMTP Exim 4.96");
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (st.data) { if (line === ".") { st.data = false; w("250 OK id=1"); } continue; }
        if (st.login === "user") { st.user = Buffer.from(line, "base64").toString(); st.login = "pass"; w("334 UGFzc3dvcmQ6"); continue; }
        if (st.login === "pass") { st.login = undefined; finish("LOGIN", st.user ?? "", Buffer.from(line, "base64").toString()); continue; }
        const [cmd, a1, a2] = line.split(" ");
        switch (cmd.toUpperCase()) {
          case "EHLO": w("250-smtp.hosting90.test Hello"); if (opts.starttls) w("250-STARTTLS"); w(`250-AUTH ${opts.onlyLogin ? "PLAIN LOGIN" : "PLAIN LOGIN"}`); w("250 SIZE 52428800"); break;
          case "STARTTLS": w("454 TLS currently unavailable"); break;
          case "AUTH":
            if (a1.toUpperCase() === "PLAIN") { const p = Buffer.from(a2 ?? "", "base64").toString().split("\0"); finish("PLAIN", p[1] ?? "", p[2] ?? ""); }
            else if (a1.toUpperCase() === "LOGIN") { st.login = "user"; w("334 VXNlcm5hbWU6"); }
            else w("504 Unrecognized authentication type");
            break;
          case "MAIL": w(st.authed ? "250 OK" : "530 Authentication required"); break;
          case "RCPT": w("250 Accepted"); break;
          case "DATA": st.data = true; w("354 Enter message"); break;
          case "QUIT": w("221 bye"); sock.end(); st = {}; break;
          default: w("250 OK");
        }
      }
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  return { port: (server.address() as net.AddressInfo).port, auths, close: () => new Promise((res) => server.close(() => res())) };
}

describe("nodemailer proti serveru jako Exim (535)", () => {
  let exim: Fake;
  let loginOnly: Fake;
  let noTls: Fake;
  beforeAll(async () => {
    exim = await fakeExim({ pass: "heslo-schranky", starttls: true });
    loginOnly = await fakeExim({ pass: "heslo-schranky", onlyLogin: true });
    noTls = await fakeExim({ pass: "heslo-schranky" });
  });
  afterAll(async () => { await Promise.all([exim.close(), loginOnly.close(), noTls.close()]); });

  const sendVia = (port: number) => async (t: SmtpTry) => {
    const tr = await smtpTransport({ protocol: "smtp", host: "127.0.0.1", port, tls: t.tls }, { user: t.user, pass: t.password, ...(t.authMethod ? { method: t.authMethod } : {}) }, { timeoutMs: 3000 });
    try {
      await tr.sendMail({ envelope: { from: "semorad@nastrojarstvi.com", to: ["x@firma.test"] }, raw: "Subject: t\r\n\r\nahoj\r\n" });
    } finally {
      tr.close();
    }
  };

  it("Outlook „Žádné“ (port 366): server STARTTLS nabídne, ale nejde → pokračuje bez SSL; zastaralé SMTP heslo 535 → heslo schránky projde", async () => {
    const r = await sendWithSmtpRecovery({
      first: { host: "127.0.0.1", port: exim.port, tls: "none", user: "semorad@nastrojarstvi.com", password: "stare-smtp", passwordSource: "smtp" },
      incomingPassword: "heslo-schranky",
      attempt: sendVia(exim.port),
    });
    expect(r.tries, JSON.stringify(r.tries)).toHaveLength(2);
    expect(r.ok).toBe(true);
    expect(r.healSmtpPassword).toBe(true);
    expect(exim.auths.map((a) => `${a.mech}:${a.pass}:${a.ok}`)).toEqual(["PLAIN:stare-smtp:false", "PLAIN:heslo-schranky:true"]);
  });

  it("server bere jen AUTH LOGIN → vynucený LOGIN projde (nodemailer sám volí PLAIN)", async () => {
    const r = await sendWithSmtpRecovery({
      first: { host: "127.0.0.1", port: loginOnly.port, tls: "none", user: "semorad@nastrojarstvi.com", password: "heslo-schranky", passwordSource: "incoming" },
      attempt: sendVia(loginOnly.port),
    });
    expect(r).toMatchObject({ ok: true, used: { authMethod: "LOGIN" } });
    expect(loginOnly.auths.map((a) => `${a.mech}:${a.ok}`)).toEqual(["PLAIN:false", "LOGIN:true"]);
  });

  it("STARTTLS povinně (podle portu) na serveru bez STARTTLS → heslo se vůbec nepošle", async () => {
    const before = noTls.auths.length;
    const r = await sendWithSmtpRecovery({
      first: { host: "127.0.0.1", port: noTls.port, tls: "starttls", user: "semorad@nastrojarstvi.com", password: "heslo-schranky", passwordSource: "incoming" },
      attempt: sendVia(noTls.port),
    });
    expect(r.ok).toBe(false);
    expect(r.kind).not.toBe("auth");
    expect(noTls.auths.length).toBe(before);
  });
});
