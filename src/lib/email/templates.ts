import { COMPANY } from "@/lib/company";

/**
 * Systémové e-maily (obnova hesla, uvítání nového uživatele) — čistá logika, testováno.
 * HTML je tabulkové s inline styly (Outlook / Gmail), barvy dle logomanuálu.
 * Každá interpolace prochází escapeHtml.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const RED = "#E03930";
const ANTHRACITE = "#272425";
const GREY = "#6C6D6F";
const FONT = "Roboto, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Roboto Mono', Consolas, 'Courier New', Courier, monospace";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Do odkazu jen http(s) — jinak neškodné „#". */
function safeUrl(url: string | null | undefined): string {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}

function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

function companyFooterLines(): string[] {
  const a = COMPANY.address;
  return [
    COMPANY.name,
    [a.street, [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [COMPANY.web, COMPANY.email, COMPANY.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

/** Společná kostra: červený proužek, wordmark, karta s obsahem, patička firmy. */
function layout(input: { preheader: string; heading: string; body: string }): string {
  const footer = companyFooterLines()
    .map((l) => escapeHtml(l))
    .join("<br>");
  return `<!DOCTYPE html>
<html lang="cs" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F1F1;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F1F1;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E7E3E3;">
    <tr><td style="height:6px;line-height:6px;font-size:0;background-color:${RED};">&nbsp;</td></tr>
    <tr><td style="padding:24px 32px 8px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="28" height="28" style="width:28px;height:28px;background-color:${RED};border-radius:6px 6px 14px 14px;">&nbsp;</td>
        <td style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:700;color:${ANTHRACITE};letter-spacing:-0.2px;">Mnástrojárna</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:12px 32px 0 32px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${ANTHRACITE};">${escapeHtml(input.heading)}</td></tr>
    <tr><td style="padding:12px 32px 28px 32px;font-family:${FONT};font-size:15px;line-height:24px;color:${ANTHRACITE};">
${input.body}
    </td></tr>
    <tr><td style="padding:18px 32px;background-color:#FAF8F8;border-top:1px solid #EFEAEA;font-family:${FONT};font-size:12px;line-height:18px;color:${GREY};">
      ${footer}<br><span style="font-style:italic;">${escapeHtml(COMPANY.slogan)}</span>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function paragraph(html: string, extra = ""): string {
  return `<p style="margin:0 0 14px 0;${extra}">${html}</p>`;
}

/** „Bulletproof" tlačítko (funguje i v Outlooku). */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;"><tr>
  <td align="center" bgcolor="${RED}" style="border-radius:10px;background-color:${RED};">
    <a href="${escapeHtml(safeUrl(href))}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
  </td>
</tr></table>`;
}

// ── Obnova hesla ────────────────────────────────────────────

export function passwordResetEmail(input: { code: string; name?: string | null; minutes: number }): EmailContent {
  const code = String(input.code);
  const name = firstName(input.name);
  const greeting = name ? `Dobrý den, ${name},` : "Dobrý den,";
  const subject = `Kód pro obnovu hesla: ${code}`;

  const text = [
    greeting,
    "",
    "někdo (nejspíš vy) požádal o obnovu hesla do systému Mnástrojárna.",
    "",
    `Váš kód: ${code}`,
    "",
    `Kód zadejte na stránce obnovy hesla. Platí ${input.minutes} minut a lze ho použít jen jednou.`,
    "",
    "Pokud jste o obnovu nežádali, tento e-mail ignorujte — vaše heslo zůstává beze změny.",
    "",
    "--",
    ...companyFooterLines(),
  ].join("\n");

  const body = [
    paragraph(escapeHtml(greeting)),
    paragraph("někdo (nejspíš vy) požádal o obnovu hesla do systému <strong>Mnástrojárna</strong>. Zadejte tento kód na stránce obnovy hesla:"),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px 0;"><tr>
  <td align="center" style="padding:20px 12px;background-color:#FDF1F0;border:2px dashed ${RED};border-radius:12px;font-family:${MONO};font-size:36px;line-height:40px;font-weight:700;letter-spacing:12px;color:${ANTHRACITE};">${escapeHtml(code)}</td>
</tr></table>`,
    paragraph(
      `Kód platí <strong>${escapeHtml(input.minutes)} minut</strong> a lze ho použít jen jednou.`,
      `color:${GREY};font-size:14px;`,
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr>
  <td style="padding:12px 14px;background-color:#F6F5F5;border-left:4px solid ${GREY};border-radius:6px;font-family:${FONT};font-size:13px;line-height:20px;color:${GREY};">
    Pokud jste o obnovu hesla nežádali, tento e-mail ignorujte — vaše heslo zůstává beze změny. Kód nikomu nesdělujte, ani kolegům.
  </td>
</tr></table>`,
  ].join("\n");

  return {
    subject,
    text,
    html: layout({ preheader: `Váš kód je ${code} — platí ${input.minutes} minut.`, heading: "Obnova hesla", body }),
  };
}

// ── Uvítání nového uživatele ────────────────────────────────

export function welcomeUserEmail(input: {
  name: string;
  email: string;
  loginUrl: string;
  password?: string | null;
  roleLabel?: string | null;
  forgotUrl?: string | null;
}): EmailContent {
  const name = firstName(input.name);
  const greeting = name ? `Dobrý den, ${name},` : "Dobrý den,";
  const subject = "Váš účet v systému Mnástrojárna je připraven";
  const forgotUrl = input.forgotUrl || input.loginUrl.replace(/\/login\/?$/, "/forgot-password");

  const text = [
    greeting,
    "",
    "byl vám vytvořen účet v systému Mnástrojárna — Kniha zakázek, zákazníci, dodavatelé a pošta na jednom místě.",
    "",
    `Přihlášení: ${input.loginUrl}`,
    `E-mail: ${input.email}`,
    input.password ? `Heslo: ${input.password}` : "Heslo vám sdělí správce systému.",
    input.roleLabel ? `Role: ${input.roleLabel}` : "",
    "",
    "Po prvním přihlášení si heslo změňte v menu Můj účet.",
    `Zapomenuté heslo obnovíte tady: ${forgotUrl}`,
    "",
    "--",
    ...companyFooterLines(),
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");

  const row = (label: string, value: string, mono = false) => `<tr>
  <td style="padding:6px 0;width:90px;font-family:${FONT};font-size:13px;color:${GREY};vertical-align:top;">${escapeHtml(label)}</td>
  <td style="padding:6px 0;font-family:${mono ? MONO : FONT};font-size:${mono ? "16px" : "14px"};font-weight:700;color:${ANTHRACITE};${mono ? "letter-spacing:1px;" : ""}word-break:break-all;">${escapeHtml(value)}</td>
</tr>`;

  const credentials = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;background-color:#FAF8F8;border:1px solid #EFEAEA;border-radius:12px;"><tr><td style="padding:14px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row("E-mail", input.email)}
${input.password ? row("Heslo", input.password, true) : row("Heslo", "sdělí vám správce systému")}
${input.roleLabel ? row("Role", input.roleLabel) : ""}
</table>
</td></tr></table>`;

  const body = [
    paragraph(escapeHtml(greeting)),
    paragraph(
      "byl vám vytvořen účet v systému <strong>Mnástrojárna</strong> — Kniha zakázek, zákazníci, dodavatelé a pošta na jednom místě. Fotku dokladu stačí vyfotit mobilem a zakázka se doplní.",
    ),
    credentials,
    button(input.loginUrl, "Přihlásit se"),
    paragraph(
      `Po prvním přihlášení si heslo změňte v menu <strong>Můj účet</strong>. Zapomenuté heslo obnovíte <a href="${escapeHtml(safeUrl(forgotUrl))}" style="color:${RED};font-weight:700;text-decoration:underline;">tady</a>.`,
      `color:${GREY};font-size:14px;`,
    ),
  ].join("\n");

  return {
    subject,
    text,
    html: layout({ preheader: "Přihlašovací údaje k vašemu novému účtu.", heading: "Vítejte v týmu!", body }),
  };
}
