import { describe, it, expect } from "vitest";
import {
  buildCandidates, certCandidateHosts, classifyGraphError, classifyMailError, configFromDetection, describeMailError,
  isOwnDomainAlias, mailboxMissing, mergeMailboxSecrets, normalizeHost, normalizeMailboxConfig, parseSubjectAltNames,
  presetFromDns, presetOf, PRESETS, resolveIncoming, resolveSmtp, tlsModesForPort, validateMailboxConfig, describeConfigChanges,
} from "./mail-config";
import { fixUtf8Mojibake } from "./mail-fetch";
import { parseUidl, unstuffLines } from "./pop3";

describe("šifrování podle portu", () => {
  it("993/995/465 = TLS, 143/110/587/25/366 = STARTTLS, neznámý = oba", () => {
    for (const p of [993, 995, 465]) expect(tlsModesForPort(p)).toEqual(["tls"]);
    for (const p of [143, 110, 587, 25, 366]) expect(tlsModesForPort(p)).toEqual(["starttls"]);
    expect(tlsModesForPort(1993)).toEqual(["tls", "starttls"]);
  });

  it("resolveIncoming/resolveSmtp: výchozí uživatel = e-mail, SMTP heslo = heslo schránky, TLS podle portu", () => {
    const cfg = { imap_host: "mail.hosting90.cz", imap_port: 143, imap_password: "H" , smtp_host: "smtp.hosting90.cz", smtp_port: 587 };
    expect(resolveIncoming(cfg, "Jmeno@Nastrojarstvi.com")).toMatchObject({ protocol: "imap", tls: "starttls", user: "jmeno@nastrojarstvi.com", password: "H" });
    expect(resolveSmtp(cfg, "jmeno@nastrojarstvi.com")).toMatchObject({ tls: "starttls", user: "jmeno@nastrojarstvi.com", password: "H" });
    expect(resolveIncoming({ ...cfg, imap_port: 993, imap_tls: "starttls" }, "a@b.cz")?.tls).toBe("starttls"); // ruční přepnutí
    expect(resolveIncoming({ ...cfg, incoming_protocol: "pop3", imap_port: 995 }, "a@b.cz")).toMatchObject({ protocol: "pop3", tls: "tls" });
    expect(resolveIncoming({ imap_host: "x.cz" }, "a@b.cz")).toBeNull(); // bez hesla
  });
});

describe("normalizace konfigurace", () => {
  it("server: bez protokolu, cesty, mezer, velkých písmen; port z host:port", () => {
    expect(normalizeHost(" IMAP://Mail.Hosting90.cz:993/ ")).toEqual({ host: "mail.hosting90.cz", port: 993 });
    expect(normalizeHost("https://mail.hosting90.cz/webmail")).toEqual({ host: "mail.hosting90.cz" });
    expect(normalizeHost("mail.hosting90.cz.")).toEqual({ host: "mail.hosting90.cz" });
  });

  it("hesla se neořezávají (jen konce řádků), uživatel s @ malými písmeny, porty na čísla", () => {
    const { config, errors } = normalizeMailboxConfig({
      imap_host: " Mail.Hosting90.cz ", imap_port: "993" as unknown as number, imap_user: " Jmeno@Nastrojarstvi.COM ",
      imap_password: " Heslo s mezerou \n", smtp_host: "smtp.hosting90.cz", smtp_port: 465,
    });
    expect(errors).toEqual([]);
    expect(config).toMatchObject({ imap_host: "mail.hosting90.cz", imap_port: 993, imap_user: "jmeno@nastrojarstvi.com", imap_password: " Heslo s mezerou " });
  });

  it("neplatný port / server → česká chyba; POP3 port bez protokolu → POP3", () => {
    expect(normalizeMailboxConfig({ imap_port: 70000 }).errors[0]).toMatch(/Neplatný příchozí port/);
    expect(normalizeMailboxConfig({ imap_host: "jmeno@nastrojarstvi.com" }).config.imap_host).toBe("nastrojarstvi.com");
    expect(normalizeMailboxConfig({ imap_host: "mail .hosting90.cz " }).config.imap_host).toBe("mail.hosting90.cz");
    expect(normalizeMailboxConfig({ imap_host: "mail_.cz" }).errors[0]).toMatch(/Neplatný příchozí server/);
    const pop = normalizeMailboxConfig({ imap_host: "mail.nastrojarstvi.com", imap_port: 995 });
    expect(pop.config.incoming_protocol).toBe("pop3");
    expect(pop.notes[0]).toMatch(/POP3/);
  });

  it("neznámé klíče pryč, SMTP heslo shodné s IMAP se neukládá zvlášť", () => {
    const { config } = normalizeMailboxConfig({ imap_password: "A", smtp_password: "A", hack: "x" } as never);
    expect(config).toEqual({ imap_password: "A" });
  });
});

describe("hesla: prázdné = beze změny", () => {
  const prev = { imap_host: "mail.hosting90.cz", imap_password: "Stare", smtp_password: "Stare", ms_graph_client_secret: "S" };
  it("úprava bez hesla heslo zachová", () => {
    const out = mergeMailboxSecrets(prev, { imap_host: "mail.hosting90.cz", imap_port: 993 });
    expect(out.imap_password).toBe("Stare");
    expect(out.ms_graph_client_secret).toBe("S");
  });
  it("výslovná změna hesla platí i pro SMTP (bylo stejné)", () => {
    const out = mergeMailboxSecrets(prev, { imap_host: "x" }, { imap_password: "Nove" });
    expect(out.imap_password).toBe("Nove");
    expect(out.smtp_password).toBeUndefined(); // = použije se heslo schránky
    expect(resolveSmtp({ ...out, smtp_host: "s" }, "a@b.cz")?.password).toBe("Nove");
  });
  it("vlastní SMTP heslo zůstane, prázdný řetězec heslo nesmaže", () => {
    const out = mergeMailboxSecrets({ imap_password: "A", smtp_password: "B" }, {}, { imap_password: "", smtp_password: "" });
    expect(out).toEqual({ imap_password: "A", smtp_password: "B" });
  });
  it("audit bez hesel", () => {
    const d = describeConfigChanges(prev, { ...prev, imap_password: "Nove", imap_port: 993 });
    expect(d).toEqual({ imap_password: "změněno", imap_port: { from: null, to: 993 } });
    expect(JSON.stringify(d)).not.toContain("Nove");
  });
});

describe("validace před uložením", () => {
  const base = { provider: "imap" as const, email: "jmeno@nastrojarstvi.com" };
  it("povinné: server, port, heslo; hosting90 = celá adresa", () => {
    expect(validateMailboxConfig({ ...base, config: {} })).toMatch(/příchozí server/);
    expect(validateMailboxConfig({ ...base, config: { imap_host: "mail.hosting90.cz" } })).toMatch(/port/);
    expect(validateMailboxConfig({ ...base, config: { imap_host: "mail.hosting90.cz", imap_port: 993 } })).toMatch(/heslo/);
    expect(validateMailboxConfig({ ...base, config: { imap_host: "mail.hosting90.cz", imap_port: 993 }, stored: { imap_password: true } })).toBeNull();
    expect(
      validateMailboxConfig({ ...base, config: { imap_host: "mail.hosting90.cz", imap_port: 993, imap_user: "jmeno", imap_password: "x", preset: "hosting90" } }),
    ).toMatch(/celá e-mailová adresa/);
    expect(validateMailboxConfig({ ...base, email: "spatne" , config: {} })).toMatch(/Neplatná/);
  });
  it("Microsoft 365: Client ID, Tenant ID, Secret", () => {
    expect(validateMailboxConfig({ provider: "outlook", email: "a@firma.cz", config: { ms_graph_client_id: "c" } })).toMatch(/Tenant ID, Client Secret/);
  });
  it("neúplná schránka (UI bez hesel)", () => {
    expect(mailboxMissing("imap", {}, () => false)).toEqual(["příchozí server", "heslo"]);
    expect(mailboxMissing("imap", { imap_host: "x" }, () => true)).toEqual([]);
  });
});

describe("předvolby a detekce poskytovatele", () => {
  it("hosting90: ověřená jména a porty", () => {
    expect(PRESETS.hosting90.imap[0]).toMatchObject({ host: "mail.hosting90.cz", port: 993, tls: "tls" });
    expect(PRESETS.hosting90.smtp.map((e) => e.port)).toEqual([465, 587, 366, 25]);
    expect(PRESETS.hosting90.pop3[0]).toMatchObject({ port: 995, tls: "tls" });
  });
  it("DNS: obě firemní domény (MX antispam.hosting90.cz) i cizí doména na hosting90", () => {
    expect(presetFromDns({ mx: ["antispam.hosting90.cz"], ns: ["ns1.hosting90.cz"] })).toBe("hosting90"); // nastrojarstvi.com, mnastrojarna.cz
    expect(presetFromDns({ mx: [], ns: ["ns3.hosting90.net"] })).toBe("hosting90");
    expect(presetFromDns({ mx: ["mx.jinde.cz"], ns: [], mailIps: ["195.181.248.81"], hosting90Ips: ["195.181.248.81"] })).toBe("hosting90");
    expect(presetFromDns({ mx: ["firma-cz.mail.protection.outlook.com"], ns: [] })).toBe("m365");
    expect(presetFromDns({ mx: ["aspmx.l.google.com"], ns: [] })).toBe("gmail");
    expect(presetFromDns({ mx: ["mx.seznam.cz"], ns: [] })).toBeNull();
  });
  it("předvolba uložené schránky", () => {
    expect(presetOf("imap", { imap_host: "mail.hosting90.cz" })).toBe("hosting90");
    expect(presetOf("outlook", {})).toBe("m365");
    expect(presetOf("imap", { preset: "other", imap_host: "mail.hosting90.cz" })).toBe("other");
  });
});

describe("kandidáti pro automatické zjištění", () => {
  it("hosting90 + nastavení z Outlooku (POP3 mail.nastrojarstvi.com:995): nejdřív mail.hosting90.cz IMAP", () => {
    const { incoming, smtp } = buildCandidates(
      { email: "jmeno@nastrojarstvi.com", host: "mail.nastrojarstvi.com", port: 995, smtpHost: "smtp.nastrojarstvi.com" },
      { preset: PRESETS.hosting90 },
    );
    expect(incoming[0]).toMatchObject({ protocol: "imap", host: "mail.hosting90.cz", port: 993, tls: "tls" });
    expect(incoming.findIndex((e) => e.protocol === "pop3")).toBeGreaterThan(incoming.findIndex((e) => e.protocol === "imap"));
    expect(incoming.some((e) => e.host === "imap.nastrojarstvi.com")).toBe(false); // vede na web
    expect(incoming.some((e) => e.host === "mail.nastrojarstvi.com" && e.port === 995 && e.protocol === "pop3")).toBe(true);
    expect(smtp[0]).toMatchObject({ host: "smtp.nastrojarstvi.com", port: 465, tls: "tls" }); // má vlastní certifikát
    expect(smtp.some((e) => e.host === "smtp.hosting90.cz" && e.port === 587 && e.tls === "starttls")).toBe(true);
  });
  it("mnastrojarna.cz i jiná doména na hosting90 — stejné servery", () => {
    for (const email of ["kolega@mnastrojarna.cz", "x@jina-firma.cz"]) {
      const { incoming, smtp } = buildCandidates({ email }, { preset: PRESETS.hosting90 });
      expect(incoming[0].host).toBe("mail.hosting90.cz");
      expect(smtp[0].host).toBe("smtp.hosting90.cz");
    }
  });
  it("neznámý poskytovatel: mail./imap./pop3./smtp.<doména> a server z MX, IMAP před POP3", () => {
    const { incoming, smtp } = buildCandidates({ email: "a@firma.cz" }, { preset: null, mxHosts: ["mx1.firma.cz", "posta.firma.cz"] });
    const hosts = incoming.map((e) => `${e.protocol}:${e.host}:${e.port}`);
    expect(hosts.slice(0, 2)).toEqual(["imap:mail.firma.cz:993", "imap:mail.firma.cz:143"]);
    expect(hosts).toContain("imap:posta.firma.cz:993");
    expect(hosts).toContain("pop3:pop3.firma.cz:995");
    expect(smtp.map((e) => e.host)).toContain("smtp.firma.cz");
  });
  it("alias vlastní domény a jména z certifikátu", () => {
    expect(isOwnDomainAlias("mail.nastrojarstvi.com", "a@nastrojarstvi.com")).toBe(true);
    expect(isOwnDomainAlias("mail.hosting90.cz", "a@nastrojarstvi.com")).toBe(false);
    expect(certCandidateHosts("mail.nastrojarstvi.com", ["*.hosting90.cz", "mail.hosting90.cz"])).toEqual(["mail.hosting90.cz"]);
    expect(certCandidateHosts("localhost", ["mail.hosting90.test", "127.0.0.1"])).toEqual(["mail.hosting90.test", "127.0.0.1"]);
    expect(parseSubjectAltNames("DNS:mail.hosting90.cz, IP Address:127.0.0.1")).toEqual(["mail.hosting90.cz", "127.0.0.1"]);
  });
  it("nalezená kombinace → konfigurace k uložení", () => {
    const c = configFromDetection({ imap_user: "a@b.cz" }, { protocol: "pop3", host: "h", port: 995, tls: "tls", skipNameCheck: true }, { protocol: "smtp", host: "s", port: 587, tls: "starttls" }, "hosting90");
    expect(c).toEqual({ imap_user: "a@b.cz", incoming_protocol: "pop3", imap_host: "h", imap_port: 995, imap_tls: "tls", imap_skip_name_check: true, smtp_host: "s", smtp_port: 587, smtp_tls: "starttls", preset: "hosting90" });
  });
});

describe("chyby → česká hláška podle příčiny", () => {
  const e = { protocol: "imap" as const, host: "mail.nastrojarstvi.com", port: 993, tls: "tls" as const };
  it("imapflow: špatné heslo (Command failed + authenticationFailed)", () => {
    const err = Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "Authentication failed." });
    expect(classifyMailError(err)).toBe("auth");
    expect(describeMailError("auth", { endpoint: e, raw: "Authentication failed." })).toMatch(/^Přihlášení odmítnuto.*CELÁ e-mailová adresa.*„Authentication failed\.“/);
  });
  it("síť a TLS", () => {
    expect(classifyMailError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND x" })).toBe("dns");
    expect(classifyMailError({ code: "ECONNREFUSED" })).toBe("refused");
    expect(classifyMailError({ code: "ERR_TLS_CERT_ALTNAME_INVALID", message: "Hostname/IP does not match certificate's altnames" })).toBe("tls_hostname");
    expect(classifyMailError({ message: "C0:error:0A00010B:SSL routines:ssl3_get_record:wrong version number" })).toBe("tls_protocol");
    expect(classifyMailError({ message: "SSL routines:tls_get_more_records:packet length too long" })).toBe("tls_protocol");
    expect(classifyMailError({ code: "GREETING_TIMEOUT", message: "Failed to receive greeting from server in required time" })).toBe("greeting");
    expect(classifyMailError({ code: "CONNECT_TIMEOUT", message: "Failed to establish connection in required time" })).toBe("timeout");
    expect(classifyMailError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self-signed certificate" })).toBe("tls_untrusted");
    expect(classifyMailError({ message: "Server does not support STARTTLS" })).toBe("no_starttls");
    expect(classifyMailError({ code: "EAUTH", responseCode: 535, message: "Invalid login: 535 5.7.8 Error: authentication failed" })).toBe("auth");
    expect(classifyMailError({ code: "ESOCKET", message: "Hostname/IP does not match certificate's altnames: Host: mail.x" })).toBe("tls_hostname");
    expect(classifyMailError({ code: "ETIMEDOUT", message: "Greeting never received" })).toBe("greeting");
    expect(classifyMailError({ serverResponseCode: "NONEXISTENT" })).toBe("no_inbox");
  });
  it("nesedící certifikát → navrhne mail.hosting90.cz / smtp.hosting90.cz", () => {
    expect(describeMailError("tls_hostname", { endpoint: e, certNames: ["mail.hosting90.cz"], suggestion: "mail.hosting90.cz" })).toMatch(/Použij správný název serveru poskytovatele: mail\.hosting90\.cz/);
    expect(describeMailError("tls_hostname", { endpoint: { ...e, protocol: "smtp", host: "mail.nastrojarstvi.com", port: 465 } })).toMatch(/smtp\.hosting90\.cz/);
    expect(describeMailError("dns", { endpoint: e })).toMatch(/neexistuje/);
    expect(describeMailError("refused", { endpoint: e })).toMatch(/zavřený/);
    expect(describeMailError("timeout", { endpoint: e })).toMatch(/neodpovídá.*firewall/);
    expect(describeMailError("no_inbox", { endpoint: e })).toMatch(/INBOX/);
  });
  it("Microsoft Graph (AADSTS)", () => {
    expect(classifyGraphError(401, "AADSTS7000215: Invalid client secret provided")).toBe("graph_secret");
    expect(classifyGraphError(400, "AADSTS90002: Tenant not found")).toBe("graph_tenant");
    expect(classifyGraphError(403, "ErrorAccessDenied")).toBe("graph_forbidden");
    expect(classifyGraphError(404, "MailboxNotEnabledForRESTAPI")).toBe("graph_mailbox");
  });
});

describe("POP3 a kódování", () => {
  it("UIDL a tečkování", () => {
    expect(parseUidl("1 abc\r\n2 def\r\n")).toEqual([{ n: 1, uid: "abc" }, { n: 2, uid: "def" }]);
    expect(unstuffLines(Buffer.from("a\r\n..tečka\r\nb")).toString("latin1")).toBe(Buffer.from("a\r\n.tečka\r\nb").toString("latin1"));
  });
  it("8bitová UTF-8 hlavička", () => {
    expect(fixUtf8Mojibake(Buffer.from("Nová poptávka", "utf8").toString("latin1"))).toBe("Nová poptávka");
    expect(fixUtf8Mojibake("Café")).toBe("Café");
  });
});
