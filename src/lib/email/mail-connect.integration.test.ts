import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeEndpoint, diagnoseEndpoint, detectMailSettings, connectWithFallback, imapLogin } from "./mail-connect";
import { fetchIncoming } from "./mail-fetch";
import { Pop3Client } from "./pop3";
import type { MailEndpoint } from "./mail-config";

/**
 * Skutečná komunikace s testovacím poštovním serverem (tools/e2e/mail-test-server.mjs —
 * IMAP/POP3/SMTP, vlastní CA, certifikát vystavený na jiné jméno než „localhost").
 * Potřebuje jen `openssl`; bez něj se přeskočí.
 */

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; proto?: string; user?: string; secure?: boolean }[];
  addMessage: (user: string, m: { subject: string }) => number;
  close: () => Promise<void>;
};

const USER = "jmeno@nastrojarstvi.test";
const PASS = "Spravne-Heslo-1";

describe.skipIf(!hasOpenssl)("pošta — skutečný IMAP/POP3/SMTP server", () => {
  let srv: Srv;
  let ca: Buffer;
  const P = (k: string) => srv.ports[k];

  beforeAll(async () => {
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-it-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 42000 + Math.floor(Math.random() * 1500) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err; // obsazený port → jiný rozsah
      }
    }
    ca = fs.readFileSync(srv.caFile);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      {
        domains: ["nastrojarstvi.test"],
        label: "hosting90 (test)",
        imap: [{ host: "localhost", port: P("imaps"), tls: "tls" }, { host: "localhost", port: P("imap"), tls: "starttls" }],
        pop3: [{ host: "localhost", port: P("pop3s"), tls: "tls" }],
        smtp: [{ host: "localhost", port: P("smtps"), tls: "tls" }, { host: "localhost", port: P("smtp"), tls: "starttls" }],
      },
      {
        domains: ["pop3only.test"],
        imap: [{ host: "127.0.0.1", port: P("closed"), tls: "tls" }],
        pop3: [{ host: "127.0.0.1", port: P("pop3s"), tls: "tls" }, { host: "127.0.0.1", port: P("pop3"), tls: "starttls" }],
        smtp: [{ host: "127.0.0.1", port: P("smtps"), tls: "tls" }],
      },
      {
        domains: ["jinycert.test"],
        imap: [{ host: "localhost", port: P("nameonlyImaps"), tls: "tls" }],
        pop3: [],
        smtp: [{ host: "localhost", port: P("nameonlySmtps"), tls: "tls" }],
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  const ep = (protocol: MailEndpoint["protocol"], host: string, port: number, tls: MailEndpoint["tls"]): MailEndpoint => ({ protocol, host, port, tls });

  it("sonda: platný certifikát, nesedící jméno, zavřený port, špatné šifrování, němý server", async () => {
    const ok = await probeEndpoint(ep("imap", "127.0.0.1", P("imaps"), "tls"), { ca });
    expect(ok.ok).toBe(true);
    expect(ok.steps.map((s) => s.id)).toEqual(["dns", "tcp", "tls"]);

    const mism = await probeEndpoint(ep("imap", "localhost", P("imaps"), "tls"), { ca });
    expect(mism.ok).toBe(false);
    expect(mism.kind).toBe("tls_hostname");
    expect(mism.chainOk).toBe(true);
    expect(mism.certNames).toContain("127.0.0.1");

    const refused = await probeEndpoint(ep("imap", "127.0.0.1", P("closed"), "tls"), { ca });
    expect(refused.kind).toBe("refused");
    expect(refused.error).toMatch(/zavřený/);

    const wrongTls = await probeEndpoint(ep("imap", "127.0.0.1", P("imap"), "tls"), { ca, timeoutMs: 3000 });
    expect(wrongTls.kind).toBe("tls_protocol");

    const starttls = await probeEndpoint(ep("imap", "127.0.0.1", P("imap"), "starttls"), { ca });
    expect(starttls.ok).toBe(true);

    const pop3OnImap = await probeEndpoint(ep("imap", "127.0.0.1", P("pop3s"), "tls"), { ca });
    expect(pop3OnImap.kind).toBe("greeting");

    const t = Date.now();
    const silent = await probeEndpoint(ep("imap", "127.0.0.1", P("blackhole"), "starttls"), { ca, timeoutMs: 1500 });
    expect(silent.ok).toBe(false);
    expect(["greeting", "timeout"]).toContain(silent.kind);
    expect(Date.now() - t).toBeLessThan(5000);

    const dns = await probeEndpoint(ep("imap", "neexistuje.invalid", 993, "tls"), { ca, timeoutMs: 3000 });
    expect(dns.kind).toBe("dns");
  }, 30_000);

  it("test po krocích: IMAP OK + počet zpráv, špatné heslo = „Přihlášení odmítnuto“, POP3 a SMTP", async () => {
    const imap = await diagnoseEndpoint({ ...ep("imap", "127.0.0.1", P("imaps"), "tls"), user: USER, password: PASS }, { ca });
    expect(imap.ok).toBe(true);
    expect(imap.messages).toBe(3);
    expect(imap.steps.map((s) => s.id)).toEqual(["dns", "tcp", "tls", "login", "inbox"]);

    const bad = await diagnoseEndpoint({ ...ep("imap", "127.0.0.1", P("imaps"), "tls"), user: USER, password: "spatne" }, { ca });
    expect(bad.ok).toBe(false);
    expect(bad.kind).toBe("auth");
    expect(bad.error).toMatch(/^Přihlášení odmítnuto/);
    expect(bad.error).toMatch(/Authentication failed/);

    const mism = await diagnoseEndpoint({ ...ep("imap", "localhost", P("imaps"), "tls"), user: USER, password: PASS }, { ca });
    expect(mism.kind).toBe("tls_hostname");
    expect(mism.error).toMatch(/Použij správný název serveru poskytovatele: 127\.0\.0\.1/);

    const pop = await diagnoseEndpoint({ ...ep("pop3", "127.0.0.1", P("pop3"), "starttls"), user: USER, password: PASS }, { ca });
    expect(pop.ok).toBe(true);
    expect(pop.messages).toBe(3);

    const smtp = await diagnoseEndpoint({ ...ep("smtp", "127.0.0.1", P("smtp"), "starttls"), user: USER, password: PASS }, { ca });
    expect(smtp.ok).toBe(true);
    const smtpBad = await diagnoseEndpoint({ ...ep("smtp", "127.0.0.1", P("smtps"), "tls"), user: USER, password: "x" }, { ca });
    expect(smtpBad.kind).toBe("auth");

    const skip = await diagnoseEndpoint({ ...ep("imap", "localhost", P("nameonlyImaps"), "tls"), skipNameCheck: true, user: USER, password: PASS }, { ca });
    expect(skip.ok).toBe(true);
    expect(skip.steps.find((s) => s.id === "tls")?.detail).toMatch(/BEZ ověření jména/);
  }, 30_000);

  it("najít automaticky: jen e-mail + heslo → jméno z certifikátu (127.0.0.1), IMAP i SMTP", async () => {
    const r = await detectMailSettings({ email: USER, password: PASS }, { ca, budgetMs: 30_000 });
    expect(r.ok).toBe(true);
    expect(r.incoming).toMatchObject({ protocol: "imap", host: "127.0.0.1", port: P("imaps"), tls: "tls", messages: 3 });
    expect(r.smtp).toMatchObject({ protocol: "smtp", host: "127.0.0.1" });
    expect(r.config).toMatchObject({ imap_host: "127.0.0.1", imap_port: P("imaps"), imap_tls: "tls", incoming_protocol: "imap", imap_user: USER });
    expect(r.attempts.some((a) => a.kind === "tls_hostname" && a.endpoint.host === "localhost")).toBe(true);
    expect(r.attempts.filter((a) => a.stage === "login" && !a.ok)).toHaveLength(0);
  }, 40_000);

  it("najít automaticky: POP3-only (IMAP zavřený) → POP3", async () => {
    const r = await detectMailSettings({ email: "pop@pop3only.test", password: "Pop3-Heslo-1" }, { ca, budgetMs: 30_000 });
    expect(r.ok).toBe(true);
    expect(r.incoming).toMatchObject({ protocol: "pop3", host: "127.0.0.1", port: P("pop3s") });
    expect(r.config?.incoming_protocol).toBe("pop3");
  }, 40_000);

  it("najít automaticky: certifikát jen na cizí jméno → potvrzení, po souhlasu bez ověření jména", async () => {
    const authsBefore = srv.events.filter((e) => e.type === "auth").length;
    const r = await detectMailSettings({ email: "jmeno@jinycert.test", password: PASS, user: USER }, { ca, budgetMs: 30_000 });
    expect(r.ok).toBe(false);
    expect(r.needsConfirmation?.endpoint).toMatchObject({ host: "localhost", port: P("nameonlyImaps"), skipNameCheck: true });
    expect(r.needsConfirmation?.certNames).toContain("mail.hosting90.test");
    expect(r.error).toMatch(/potvrď/);
    expect(srv.events.filter((e) => e.type === "auth").length).toBe(authsBefore); // bez souhlasu heslo vůbec neodešlo

    const ok = await detectMailSettings({ email: "jmeno@jinycert.test", password: PASS, user: USER, allowNameMismatch: true }, { ca, budgetMs: 30_000 });
    expect(ok.ok).toBe(true);
    expect(ok.incoming?.skipNameCheck).toBe(true);
    expect(ok.config?.imap_skip_name_check).toBe(true);
    expect(ok.smtp?.skipNameCheck).toBe(true);
  }, 60_000);

  it("najít automaticky: špatné heslo → hned konec (1 pokus o přihlášení), srozumitelná chyba", async () => {
    const r = await detectMailSettings({ email: USER, password: "spatne-heslo" }, { ca, budgetMs: 30_000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Přihlášení odmítnuto/);
    expect(r.attempts.filter((a) => a.stage === "login")).toHaveLength(1);
  }, 40_000);

  it("heslo nikdy nešifrovaně", () => {
    expect(srv.events.filter((e) => e.type === "plaintext-auth")).toEqual([]);
    expect(srv.events.filter((e) => e.type === "auth").every((e) => e.secure)).toBe(true);
  });

  it("stahování IMAP: první = nejnovější, pak jen nové (UID), časový limit posune stav jen o zpracované", async () => {
    const inc = { ...ep("imap", "127.0.0.1", P("imaps"), "tls"), user: USER, password: PASS };
    const first = await fetchIncoming(inc, USER, {}, 2, { ca });
    expect(first.emails.map((e) => e.subject)).toEqual(["Objednávka 4500123", "Nabídka materiálu"]);
    expect(first.emails[0].fromEmail).toBe("eva@firma.test");
    expect(first.emails[0].body).toMatch(/přírub/);
    expect(first.stateAfter(2).imap).toEqual({ uidValidity: "1700000000", lastUid: 3 });
    expect(first.stateAfter(0).imap?.lastUid).toBe(1);

    const none = await fetchIncoming(inc, USER, first.stateAfter(2), 20, { ca });
    expect(none.emails).toHaveLength(0);

    srv.addMessage(USER, { subject: "Nová poptávka" });
    srv.addMessage(USER, { subject: "Druhá nová" });
    const fresh = await fetchIncoming(inc, USER, first.stateAfter(2), 1, { ca });
    expect(fresh.emails.map((e) => e.subject)).toEqual(["Nová poptávka"]);
    expect(fresh.remaining).toBe(1);
    const rest = await fetchIncoming(inc, USER, fresh.stateAfter(1), 20, { ca });
    expect(rest.emails.map((e) => e.subject)).toEqual(["Druhá nová"]);
  }, 30_000);

  it("stahování POP3: UIDL, bez mazání, druhé stažení jen nové", async () => {
    const user = "pop@pop3only.test";
    const inc = { ...ep("pop3", "127.0.0.1", P("pop3s"), "tls"), user, password: "Pop3-Heslo-1" };
    const first = await fetchIncoming(inc, user, {}, 20, { ca });
    expect(first.emails).toHaveLength(3);
    expect(first.emails[0].subject).toBe("Pop: Poptávka hřídele 50 ks");
    expect(first.emails[0].body).toMatch(/\.tečka na začátku řádku/);
    expect(first.emails[0].messageId).toMatch(/^e2e-1\./);
    const st = first.stateAfter(3);
    const again = await fetchIncoming(inc, user, st, 20, { ca });
    expect(again.emails).toHaveLength(0);
    srv.addMessage(user, { subject: "POP3 nová" });
    const fresh = await fetchIncoming(inc, user, st, 20, { ca });
    expect(fresh.emails.map((e) => e.subject)).toEqual(["POP3 nová"]);
    expect(srv.events.some((e) => e.type === "pop3-dele")).toBe(false);
  }, 30_000);

  it("stahování POP3: schránka s > 5000 zprávami — staré zprávy se nestahují znovu dokola", async () => {
    const user = "kolega@mnastrojarna.test";
    for (let i = 0; i < 5005; i++) srv.addMessage(user, { subject: `Archiv ${i}` });
    const inc = { ...ep("pop3", "127.0.0.1", P("pop3s"), "tls"), user, password: "Kolega-Heslo-1" };
    const first = await fetchIncoming(inc, user, {}, 5, { ca, timeoutMs: 20_000 });
    expect(first.emails.map((e) => e.subject)).toEqual(["Archiv 5000", "Archiv 5001", "Archiv 5002", "Archiv 5003", "Archiv 5004"]);
    let st = first.stateAfter(5);
    expect((st.pop3?.seen ?? []).length).toBe(first.total); // všechny UIDL na serveru, žádné prořezání podle počtu
    for (let round = 0; round < 2; round++) {
      const again = await fetchIncoming(inc, user, st, 20, { ca, timeoutMs: 20_000 });
      expect(again.emails).toHaveLength(0); // dřív: 8 nejstarších zpráv znovu v každém kole
      expect(again.remaining).toBe(0);
      st = again.stateAfter(0);
    }
    srv.addMessage(user, { subject: "Po archivu" });
    const fresh = await fetchIncoming(inc, user, st, 20, { ca, timeoutMs: 20_000 });
    expect(fresh.emails.map((e) => e.subject)).toEqual(["Po archivu"]);
  }, 90_000);

  it("samooprava: uložený server s nesedícím certifikátem → ověřený server poskytovatele", async () => {
    const stored = { ...ep("imap", "mail.nastrojarstvi.invalid", 993, "tls"), user: USER, password: PASS };
    const r = await connectWithFallback(stored, USER, (e, auth) => imapLogin(e, auth, { ca }), { ca });
    expect(r.healed).toBe(true);
    expect(r.endpoint.port).toBe(P("imaps"));
    expect(r.result.messages).toBeGreaterThanOrEqual(3);
  }, 40_000);

  it("POP3 klient: STLS povinné, bez TLS heslo neodešle", async () => {
    const c = await Pop3Client.connect({ host: "127.0.0.1", port: P("pop3"), tls: "starttls", ca, timeoutMs: 3000 });
    expect(c.secure).toBe(true);
    await c.login(USER, PASS);
    const list = await c.uidl();
    expect(list.length).toBeGreaterThanOrEqual(3);
    await c.quit();
  });
});
