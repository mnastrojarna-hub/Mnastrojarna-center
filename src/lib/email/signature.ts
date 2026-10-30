/**
 * Grafický podpis e-mailu — každý uživatel si ho nastaví sám, pro každou schránku zvlášť.
 * Čistá logika (bez DB, bez Node API) — používá ji server (odeslání) i editor v prohlížeči (živý náhled).
 *
 *  - SignatureSettings = co si uživatel uloží (jméno, pozice, telefon, varianta, co ukázat).
 *    Firemní údaje se NEUKLÁDAJÍ k podpisu — berou se živě z Nastavení (SignatureCompany),
 *    takže změna adresy firmy se propíše do podpisů všech.
 *  - renderSignature() → { html, text }: HTML bezpečné pro e-mailové klienty (tabulky, jen inline
 *    styly, Roboto → Arial/Helvetica, max. 520 px, funguje i na mobilu a v tmavém režimu)
 *    + pěkně formátovaná textová verze. Každý vstup se escapuje.
 *  - htmlBodyWithSignature() → HTML zprávy z textu napsaného v okně psaní: blok podpisu v textu
 *    nahradí grafickým podpisem (když ho uživatel z textu smazal nebo upravil, zůstane jen text).
 *
 * Logo: PNG 2× (public/brand/mnastrojarna-email-logo@2x.png, generuje tools/brand/render-email-logo.mjs)
 * — bílý podklad ve velikosti ochranné zóny (logomanuál), takže antracitový nápis zůstane čitelný
 * i v tmavém režimu Outlooku / Gmailu. Zdroj: absolutní URL (signatureLogoUrl) nebo vložená
 * příloha cid:SIGNATURE_LOGO_CID (signatureLogoSrc).
 */

// ── Konstanty ────────────────────────────────────────────────────────────────────────────────

export const SIGNATURE_COLORS = { red: "#E03930", text: "#272425", muted: "#6C6D6F", line: "#E8E4E4" } as const;
const FONT = "Roboto,Arial,Helvetica,sans-serif";
const { red: RED, text: TEXT, muted: MUTED, line: LINE } = SIGNATURE_COLORS;

/** Logo pro podpis (PNG 2×, 320 × 80) — cesta ve webu aplikace (public/). */
export const SIGNATURE_LOGO_PATH = "/brand/mnastrojarna-email-logo@2x.png";
/** Content-ID loga vloženého do zprávy jako inline příloha (src="cid:…"). */
export const SIGNATURE_LOGO_CID = "podpis-logo@mnastrojarna.cz";
/** Zobrazený rozměr loga v podpisu (PNG má dvojnásobek). */
export const SIGNATURE_LOGO_WIDTH = 160;
export const SIGNATURE_LOGO_HEIGHT = 40;
/** Maximální šířka podpisu. */
export const SIGNATURE_MAX_WIDTH = 520;

export const DEFAULT_CLOSING = "S pozdravem";
/** Korespondenční adresa provozovny (poštovní místo Pelhřimov) — dokud není v Nastavení. */
export const DEFAULT_CORRESPONDENCE_ADDRESS = "Mezná 9, 393 01 Pelhřimov";
export const DEFAULT_CERTIFICATIONS = ["ISO 9001", "ISO 14001"] as const;

/** Limity délek (stejné v editoru i při uložení). */
export const SIGNATURE_LIMITS = {
  closing: 60, fullName: 80, role: 80, phone: 40, email: 120, web: 120, link: 200, links: 3, note: 300,
} as const;

// ── Model ────────────────────────────────────────────────────────────────────────────────────

export const SIGNATURE_VARIANTS = ["kompaktni", "firemni", "vizitka"] as const;
export type SignatureVariant = (typeof SIGNATURE_VARIANTS)[number];

export const SIGNATURE_VARIANT_INFO: Record<SignatureVariant, { label: string; hint: string }> = {
  kompaktni: { label: "Kompaktní", hint: "Jméno, logo a kontakt na jednom řádku — ideální do odpovědí." },
  firemni: { label: "Firemní", hint: "Navíc drobným písmem fakturační údaje, adresa a certifikace." },
  vizitka: { label: "Vizitka", hint: "Logo vlevo, kontakty vpravo pod sebou — na mobilu se složí pod sebe." },
};

/** Které bloky podpisu ukázat. */
export interface SignatureBlocks {
  logo: boolean;
  /** Fakturační údaje: firma, sídlo, IČO, DIČ. */
  company: boolean;
  /** Doručovací a korespondenční adresa. */
  address: boolean;
  certifications: boolean;
  /** Slogan „místo pro Vaši kooperaci…". */
  slogan: boolean;
}

/** Uložený podpis (uživatel × schránka). Bez firemních údajů — ty jsou v SignatureCompany. */
export interface SignatureSettings {
  v: 1;
  /** false = do zpráv z této schránky se podpis nevkládá. */
  enabled: boolean;
  variant: SignatureVariant;
  /** Pozdrav nad jménem („S pozdravem"); prázdné = bez pozdravu. */
  closing: string;
  fullName: string;
  /** Pozice / oddělení. */
  role: string;
  phone: string;
  /** Druhý telefon (pevná linka …). */
  phone2: string;
  email: string;
  web: string;
  /** Odkazy (LinkedIn, Facebook …) — max. 3, jen http(s). */
  links: string[];
  /** Krátká poznámka pod podpisem (dostupnost, upozornění …). */
  note: string;
  show: SignatureBlocks;
}

/** Firemní údaje pro podpis (živě z Nastavení → Firemní údaje). */
export interface SignatureCompany {
  name: string;
  /** Sídlo (fakturační adresa) na jednom řádku. */
  billingAddress: string;
  /** Doručovací a korespondenční adresa na jednom řádku. */
  correspondenceAddress: string;
  ico: string;
  dic: string;
  web: string;
  certifications: string[];
  slogan: string;
}

export interface SignatureRenderOptions {
  company: SignatureCompany;
  /**
   * Zdroj loga: absolutní https URL (signatureLogoUrl), „cid:…" (vložená příloha), kořenová cesta
   * „/brand/…" (náhled v aplikaci) nebo data:image/png. null / neplatné = podpis bez loga.
   */
  logoSrc?: string | null;
}

export interface RenderedSignature {
  html: string;
  text: string;
}

/** Firemní údaje tak, jak je drží lib/company (COMPANY) — jen co podpis potřebuje. */
export interface CompanyLike {
  name: string;
  slogan?: string | null;
  address: { street?: string | null; city?: string | null; zip?: string | null };
  ico?: string | null;
  dic?: string | null;
  web?: string | null;
}

// ── Pomocné funkce (texty, odkazy) ───────────────────────────────────────────────────────────

/** Escapování pro HTML text i hodnoty atributů. */
export function escapeSignatureHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const esc = escapeSignatureHtml;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Jeden řádek: bez řídicích znaků a zalomení, zkrácené mezery, oříznuté na `max` znaků. */
export function cleanLine(value: unknown, max: number): string {
  return String(value ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Víc řádků (poznámka): max. 3 řádky, bez řídicích znaků. */
function cleanNote(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(CONTROL, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n")
    .slice(0, max)
    .trim();
}

const EMAIL_RE = /^[^\s@<>"'(),;:\\[\]]+@[^\s@<>"'(),;:\\[\]]+\.[a-z]{2,}$/i;

export function isSignatureEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/**
 * Telefon k zobrazení: české číslo (9 číslic, s +420 / 00420 i bez) → „+420 734 846 246",
 * jiné (zahraniční, s linkou …) beze změny.
 */
export function formatPhone(value: unknown): string {
  const raw = cleanLine(value, SIGNATURE_LIMITS.phone);
  const digits = raw.replace(/[\s./()-]/g, "");
  const cz = /^(?:\+420|00420)?([0-9]{9})$/.exec(digits);
  if (cz) return `+420 ${cz[1].slice(0, 3)} ${cz[1].slice(3, 6)} ${cz[1].slice(6)}`;
  return raw;
}

/** Odkaz tel: (jen číslice a +); české číslo bez předvolby dostane +420. null = není telefon. */
export function phoneHref(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const plain = digits.replace(/^00/, "+");
  if (plain.replace(/\D/g, "").length < 6) return null;
  return `tel:${/^\d{9}$/.test(plain) ? `+420${plain}` : plain}`;
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?$/i;

/** Web / odkaz: https://… (bez protokolu se doplní). null = neplatná adresa (mezery, javascript: …). */
export function safeWebHref(value: string): string | null {
  const v = value.trim();
  if (!v || /[\s"'<>\\`]/.test(v)) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : /^[a-z][a-z0-9+.-]*:/i.test(v) ? null : `https://${v.replace(/^\/+/, "")}`;
  if (!withProto) return null;
  const m = /^(https?):\/\/([^/?#]+)([/?#].*)?$/i.exec(withProto);
  if (!m || !HOST_RE.test(m[2]) || m[2].includes("@")) return null;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ?? ""}`;
}

/** Web k zobrazení: bez protokolu a koncového lomítka. */
export function displayWeb(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

const LINK_LABELS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)(facebook|fb)\.com$/i, "Facebook"],
  [/(^|\.)instagram\.com$/i, "Instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "YouTube"],
  [/(^|\.)(x|twitter)\.com$/i, "X"],
];

/** Popisek odkazu podle domény (LinkedIn, Facebook …), jinak doména. */
export function linkLabel(href: string): string {
  const host = (/^https?:\/\/([^/?#:]+)/i.exec(href)?.[1] ?? href).replace(/^www\./i, "");
  return LINK_LABELS.find(([re]) => re.test(host))?.[1] ?? host;
}

// ── Firemní údaje ────────────────────────────────────────────────────────────────────────────

/**
 * Firemní blok podpisu z COMPANY (lib/company, přepsané Nastavením přes refreshCompanyFromSettings).
 * Korespondenční adresa a certifikace zatím v Nastavení nejsou → `extras` (navržená nastavení
 * company_correspondence_address / company_certifications), jinak výchozí hodnoty firmy.
 */
export function signatureCompanyFrom(
  company: CompanyLike,
  extras: { correspondenceAddress?: string | null; certifications?: string | string[] | null } = {},
): SignatureCompany {
  const a = company.address ?? {};
  const billing = [cleanLine(a.street, 120), cleanLine([a.zip, a.city].filter(Boolean).join(" "), 120)].filter(Boolean).join(", ");
  const certs = Array.isArray(extras.certifications)
    ? extras.certifications
    : typeof extras.certifications === "string"
      ? extras.certifications.split(/[,;\n]/)
      : [...DEFAULT_CERTIFICATIONS];
  return {
    // název firmy podle logomanuálu „Mnástrojárna s.r.o." (výchozí nastavení mělo „MNástrojárna")
    name: cleanLine(company.name, 120).replace(/^MNástrojárna\b/, "Mnástrojárna"),
    billingAddress: billing,
    correspondenceAddress: cleanLine(extras.correspondenceAddress, 160) || DEFAULT_CORRESPONDENCE_ADDRESS,
    ico: cleanLine(company.ico, 20),
    dic: cleanLine(company.dic, 20),
    web: cleanLine(company.web, SIGNATURE_LIMITS.web),
    certifications: certs.map((c) => cleanLine(c, 40)).filter(Boolean).slice(0, 6),
    slogan: cleanLine(company.slogan, 80),
  };
}

// ── Výchozí podpis a normalizace ─────────────────────────────────────────────────────────────

export const DEFAULT_BLOCKS: SignatureBlocks = { logo: true, company: true, address: true, certifications: true, slogan: false };

/**
 * Výchozí podpis (AI princip „vše předvyplněno"): jméno, pozice a telefon z profilu, e-mail =
 * adresa schránky, web firmy, varianta Firemní se všemi údaji. Uživatel jen koriguje.
 */
export function defaultSignatureFor(
  user: { fullName?: string | null; phone?: string | null; position?: string | null; email?: string | null },
  mailboxEmail: string | null | undefined,
  company: Pick<SignatureCompany, "web"> | Pick<CompanyLike, "web"> | null | undefined,
): SignatureSettings {
  const email = cleanLine(mailboxEmail, SIGNATURE_LIMITS.email) || cleanLine(user.email, SIGNATURE_LIMITS.email);
  return {
    v: 1,
    enabled: true,
    variant: "firemni",
    closing: DEFAULT_CLOSING,
    fullName: cleanLine(user.fullName, SIGNATURE_LIMITS.fullName),
    role: cleanLine(user.position, SIGNATURE_LIMITS.role),
    phone: formatPhone(user.phone),
    phone2: "",
    email: isSignatureEmail(email) ? email.toLowerCase() : "",
    web: cleanLine(company?.web, SIGNATURE_LIMITS.web),
    links: [],
    note: "",
    show: { ...DEFAULT_BLOCKS },
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function str(v: unknown, fallback: string): unknown {
  return typeof v === "string" ? v : fallback;
}

/**
 * Bezpečný podpis z libovolného vstupu (z prohlížeče, z DB): neznámé klíče pryč, délky oříznuté,
 * neplatná varianta / e-mail / odkazy nahrazené. Chybějící pole doplní `base` (výchozí podpis).
 */
export function normalizeSignature(input: unknown, base: SignatureSettings): SignatureSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const show = (o.show && typeof o.show === "object" ? o.show : {}) as Record<string, unknown>;
  const L = SIGNATURE_LIMITS;
  const email = cleanLine(str(o.email, base.email), L.email);
  const links = (Array.isArray(o.links) ? o.links : base.links)
    .map((l) => cleanLine(l, L.link))
    .filter((l) => l && safeWebHref(l))
    .slice(0, L.links);
  return {
    v: 1,
    enabled: bool(o.enabled, base.enabled),
    variant: SIGNATURE_VARIANTS.includes(o.variant as SignatureVariant) ? (o.variant as SignatureVariant) : base.variant,
    closing: cleanLine(str(o.closing, base.closing), L.closing),
    fullName: cleanLine(str(o.fullName, base.fullName), L.fullName),
    role: cleanLine(str(o.role, base.role), L.role),
    phone: cleanLine(str(o.phone, base.phone), L.phone),
    phone2: cleanLine(str(o.phone2, base.phone2), L.phone),
    email: email && !isSignatureEmail(email) ? base.email : email,
    web: cleanLine(str(o.web, base.web), L.web),
    links,
    note: cleanNote(str(o.note, base.note), L.note),
    show: {
      logo: bool(show.logo, base.show.logo),
      company: bool(show.company, base.show.company),
      address: bool(show.address, base.show.address),
      certifications: bool(show.certifications, base.show.certifications),
      slogan: bool(show.slogan, base.show.slogan),
    },
  };
}

/** Jsou dva podpisy obsahově stejné (tlačítko Uložit / „upraveno")? */
export function sameSignature(a: SignatureSettings, b: SignatureSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Uložení: jeden JSON u uživatele, podpis pro každou schránku zvlášť ───────────────────────

/**
 * profiles.mail_signatures (jsonb): { v: 1, default?: podpis pro všechny schránky,
 * mailboxes?: { "adresa@schranky.cz": podpis } }. Klíč = adresa schránky malými písmeny —
 * přežije „Odpojit" a znovu připojení (nové id schránky) a funguje i pro firemní schránku,
 * ze které odpovídá víc lidí (každý má svůj podpis).
 */
export interface StoredSignatures {
  v: 1;
  default?: SignatureSettings;
  mailboxes?: Record<string, SignatureSettings>;
}

export function mailboxKey(mailboxEmail: string | null | undefined): string | null {
  const k = cleanLine(mailboxEmail, SIGNATURE_LIMITS.email).toLowerCase();
  return k && isSignatureEmail(k) ? k : null;
}

function storedOf(stored: unknown): { default?: unknown; mailboxes: Record<string, unknown> } {
  const o = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
  const boxes = o.mailboxes && typeof o.mailboxes === "object" && !Array.isArray(o.mailboxes) ? (o.mailboxes as Record<string, unknown>) : {};
  return { default: o.default, mailboxes: boxes };
}

/**
 * Uložený podpis pro schránku: podpis schránky → společný podpis → null (nic uloženo; volající
 * pak použije starý textový podpis profiles.mail_signature, nebo defaultSignatureFor).
 */
export function pickStoredSignature(stored: unknown, mailboxEmail: string | null | undefined, base: SignatureSettings): {
  settings: SignatureSettings; source: "mailbox" | "default";
} | null {
  const s = storedOf(stored);
  const key = mailboxKey(mailboxEmail);
  const own = key ? s.mailboxes[key] : undefined;
  if (own && typeof own === "object") return { settings: normalizeSignature(own, base), source: "mailbox" };
  if (s.default && typeof s.default === "object") return { settings: normalizeSignature(s.default, base), source: "default" };
  return null;
}

/**
 * Nový obsah profiles.mail_signatures po uložení (`settings`) nebo smazání (`null` = obnovit výchozí)
 * podpisu schránky; `mailboxEmail` null = společný podpis pro všechny schránky. Max. 20 schránek.
 */
export function putStoredSignature(
  stored: unknown,
  mailboxEmail: string | null | undefined,
  settings: SignatureSettings | null,
): StoredSignatures {
  const s = storedOf(stored);
  const key = mailboxKey(mailboxEmail);
  const mailboxes: Record<string, SignatureSettings> = {};
  for (const [k, v] of Object.entries(s.mailboxes)) {
    const kk = mailboxKey(k);
    if (kk && v && typeof v === "object" && kk !== key) mailboxes[kk] = v as SignatureSettings;
  }
  let def = s.default && typeof s.default === "object" ? (s.default as SignatureSettings) : undefined;
  if (key) {
    if (settings) mailboxes[key] = settings;
  } else {
    def = settings ?? undefined;
  }
  const keys = Object.keys(mailboxes).slice(-20);
  const out: StoredSignatures = { v: 1 };
  if (def) out.default = def;
  if (keys.length) out.mailboxes = Object.fromEntries(keys.map((k) => [k, mailboxes[k]]));
  return out;
}

// ── Logo ─────────────────────────────────────────────────────────────────────────────────────

function envAppUrl(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const e = process.env;
  return e.APP_URL || e.NEXT_PUBLIC_APP_URL
    || (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
    || (e.VERCEL_URL ? `https://${e.VERCEL_URL}` : undefined);
}

/** Absolutní URL loga (APP_URL / NEXT_PUBLIC_APP_URL / Vercel). null = adresa aplikace není známá. */
export function signatureLogoUrl(appUrl?: string | null): string | null {
  const base = cleanLine(appUrl ?? envAppUrl(), 300).replace(/\/+$/, "");
  const m = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(base);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2]}${m[3] ?? ""}${SIGNATURE_LOGO_PATH}`;
}

/** Zdroj loga pro odchozí zprávu: vložená příloha (cid, výchozí — Outlook neblokuje) nebo URL. */
export function signatureLogoSrc(mode: "cid" | "url", appUrl?: string | null): string | null {
  return mode === "cid" ? `cid:${SIGNATURE_LOGO_CID}` : signatureLogoUrl(appUrl);
}

/**
 * HTML odeslané zprávy pro uložení / zobrazení v aplikaci: vložené logo (cid:) → logo z webu
 * aplikace (emails.body_html; cid v aplikaci nic neznamená).
 */
export function signatureHtmlForApp(html: string): string {
  return String(html ?? "").split(`src="cid:${SIGNATURE_LOGO_CID}"`).join(`src="${SIGNATURE_LOGO_PATH}"`);
}

/** Povolené zdroje obrázku loga (nic jiného se do src nedostane). */
function safeLogoSrc(src: string | null | undefined): string | null {
  const v = (src ?? "").trim();
  if (!v || /[\s"'<>\\]/.test(v)) return null;
  if (/^https?:\/\/[^/]/i.test(v)) return v;
  if (/^cid:[A-Za-z0-9._@-]+$/.test(v)) return v;
  if (/^\/(?!\/)[A-Za-z0-9._~@%/-]*$/.test(v)) return v;
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
  return null;
}

// ── Vykreslení ───────────────────────────────────────────────────────────────────────────────

interface Ctx {
  s: SignatureSettings;
  c: SignatureCompany;
  logo: string | null;
  phones: { text: string; href: string | null }[];
  email: string;
  web: { text: string; href: string } | null;
  links: { text: string; href: string }[];
}

function context(settings: SignatureSettings, opts: SignatureRenderOptions): Ctx {
  const s = settings;
  const phones = [s.phone, s.phone2]
    .map((p) => formatPhone(p))
    .filter(Boolean)
    .map((p) => ({ text: p, href: phoneHref(p) }));
  // vlastní web, jinak (i když je vlastní neplatný) web firmy
  const webValue = [s.web, opts.company.web].find((w) => w && safeWebHref(w)) ?? "";
  const webHref = webValue ? safeWebHref(webValue) : null;
  return {
    s,
    c: opts.company,
    logo: s.show.logo ? safeLogoSrc(opts.logoSrc) : null,
    phones,
    email: s.email && isSignatureEmail(s.email) ? s.email : "",
    web: webHref ? { text: displayWeb(webValue), href: webHref } : null,
    links: s.links.map((l) => safeWebHref(l)).filter((h): h is string => Boolean(h)).map((href) => ({ href, text: linkLabel(href) })),
  };
}

/** Styl buňky — písmo a výška řádku vždy u každé buňky (Outlook nedědí). */
function cell(size: number, lh: number, extra = ""): string {
  return `font-family:${FONT};font-size:${size}px;line-height:${lh}px;mso-line-height-rule:exactly;${extra}`;
}

function link(href: string | null, text: string, color: string, extra = ""): string {
  const label = esc(text);
  if (!href) return `<span style="color:${color};${extra}">${label}</span>`;
  return `<a href="${esc(href)}" target="_blank" style="color:${color};text-decoration:none;${extra}">${label}</a>`;
}

/** Oddělovač položek: za tečkou obyčejná mezera → řádek se láme mezi položkami (nikdy nezačne tečkou). */
const DOT = `<span style="color:${RED};">&nbsp;&nbsp;&middot;&nbsp;</span> `;

/** Kontakty do jednoho řádku (položky se nelámou uvnitř, řádek se láme mezi nimi). */
function contactLine(x: Ctx): string {
  const items = [
    ...x.phones.map((p) => link(p.href, p.text, TEXT, "white-space:nowrap;")),
    x.email ? link(`mailto:${x.email}`, x.email, TEXT, "white-space:nowrap;") : "",
    x.web ? link(x.web.href, x.web.text, MUTED, "white-space:nowrap;") : "",
    ...x.links.map((l) => link(l.href, l.text, MUTED, "white-space:nowrap;")),
  ].filter(Boolean);
  return items.join(DOT);
}

/** Kontakty pod sebou s drobným červeným štítkem (Vizitka). */
function contactRows(x: Ctx): string {
  const rows: [string, string][] = [
    ...x.phones.map((p): [string, string] => ["T", link(p.href, p.text, TEXT, "white-space:nowrap;")]),
    ...(x.email ? [["E", link(`mailto:${x.email}`, x.email, TEXT)] as [string, string]] : []),
    ...(x.web ? [["W", link(x.web.href, x.web.text, TEXT, "white-space:nowrap;")] as [string, string]] : []),
  ];
  const linkRow = x.links.length
    ? `<tr><td colspan="2" style="${cell(12, 18, `padding:2px 0 0 0;color:${MUTED};`)}">${x.links.map((l) => link(l.href, l.text, MUTED, "white-space:nowrap;")).join(DOT)}</td></tr>`
    : "";
  return rows
    .map(([label, value]) => `<tr><td width="16" style="${cell(11, 20, `width:16px;padding:0;color:${RED};font-weight:700;vertical-align:top;`)}">${label}</td><td style="${cell(13, 20, `padding:0;color:${TEXT};word-break:break-word;`)}">${value}</td></tr>`)
    .join("") + linkRow;
}

function logoImg(x: Ctx): string {
  if (!x.logo) return "";
  const img = `<img src="${esc(x.logo)}" width="${SIGNATURE_LOGO_WIDTH}" height="${SIGNATURE_LOGO_HEIGHT}" alt="${esc(x.c.name || "Mnástrojárna s.r.o.")}" style="display:block;width:${SIGNATURE_LOGO_WIDTH}px;height:${SIGNATURE_LOGO_HEIGHT}px;max-width:${SIGNATURE_LOGO_WIDTH}px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;font-family:${FONT};font-size:14px;font-weight:700;color:${RED};">`;
  return x.web ? `<a href="${esc(x.web.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
}

/** Řádek pozice; bez loga se připojí název firmy (jinak by v podpisu chyběl). */
function roleText(x: Ctx): string {
  return [x.s.role, x.logo ? "" : x.c.name].filter(Boolean).join(" · ");
}

function companyRows(x: Ctx, padTop: number): string {
  const { s, c } = x;
  const rows: string[] = [];
  if (s.show.company) {
    const head = [c.name ? `<span style="color:${TEXT};font-weight:700;">${esc(c.name)}</span>` : "", esc(c.billingAddress)].filter(Boolean).join(", ");
    const ids = [c.ico ? `IČO&nbsp;${esc(c.ico)}` : "", c.dic ? `DIČ&nbsp;${esc(c.dic)}` : ""].filter(Boolean).join(DOT);
    if (head) rows.push(head);
    if (ids) rows.push(ids);
  }
  if (s.show.address && c.correspondenceAddress) rows.push(`Doručovací a korespondenční adresa: ${esc(c.correspondenceAddress)}`);
  if (s.show.certifications && c.certifications.length) {
    rows.push(`Certifikace ${c.certifications.map((n) => `<span style="color:${TEXT};white-space:nowrap;">${esc(n)}</span>`).join(DOT)}`);
  }
  if (!rows.length) return "";
  return `<tr><td style="padding:${padTop}px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="${cell(1, 1, `padding:0 0 9px 0;border-top:1px solid ${LINE};`)}">&nbsp;</td></tr><tr><td style="${cell(11, 17, `color:${MUTED};`)}">${rows.join("<br>")}</td></tr></table></td></tr>`;
}

function noteRow(x: Ctx, padTop: number): string {
  if (!x.s.note) return "";
  return `<tr><td style="${cell(11, 16, `padding:${padTop}px 0 0 0;color:${MUTED};font-style:italic;`)}">${x.s.note.split("\n").map(esc).join("<br>")}</td></tr>`;
}

/** Odsazení sloganu pod logem — začíná pod „M" wordmarku (jako varianta loga se sloganem v logomanuálu). */
const SLOGAN_INDENT = 33;

function sloganRow(x: Ctx, indent: number): string {
  if (!x.s.show.slogan || !x.c.slogan) return "";
  return `<tr><td style="${cell(11, 15, `padding:0 0 0 ${indent}px;color:${MUTED};font-style:italic;white-space:nowrap;`)}">${esc(x.c.slogan)}</td></tr>`;
}

function wrap(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:${SIGNATURE_MAX_WIDTH}px;" data-mn-signature="1">${rows}</table>`;
}

function closingRow(x: Ctx): string {
  return x.s.closing ? `<tr><td style="${cell(14, 20, `padding:0 0 14px 0;color:${TEXT};`)}">${esc(x.s.closing)}</td></tr>` : "";
}

function nameRows(x: Ctx): string {
  const role = roleText(x);
  return [
    x.s.fullName ? `<tr><td style="${cell(16, 22, `padding:0;color:${TEXT};font-weight:700;`)}">${esc(x.s.fullName)}</td></tr>` : "",
    role ? `<tr><td style="${cell(13, 18, `padding:0;color:${MUTED};`)}">${esc(role)}</td></tr>` : "",
  ].join("");
}

function htmlCompact(x: Ctx, withCompany: boolean): string {
  const contacts = contactLine(x);
  const hasName = Boolean(x.s.fullName || roleText(x));
  return wrap([
    closingRow(x),
    nameRows(x),
    // logo má vlastní bílý okraj (ochranná zóna) → menší mezera nad ním
    x.logo ? `<tr><td style="padding:${hasName ? 8 : 0}px 0 0 0;">${logoImg(x)}</td></tr>` : "",
    x.logo ? sloganRow(x, SLOGAN_INDENT) : "",
    contacts ? `<tr><td style="${cell(13, 20, `padding:${x.logo ? 6 : hasName ? 8 : 0}px 0 0 0;color:${TEXT};`)}">${contacts}</td></tr>` : "",
    !x.logo ? sloganRow(x, 0) : "",
    withCompany ? companyRows(x, 14) : "",
    noteRow(x, withCompany ? 10 : 12),
  ].join(""));
}

function htmlCard(x: Ctx): string {
  const details = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${nameRows(x)}${
    contactRows(x) ? `<tr><td style="padding:8px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${contactRows(x)}</table></td></tr>` : ""
  }</table>`;
  // Logo a údaje vedle sebe (inline-block; Outlook přes podmíněnou tabulku); na úzkém displeji
  // se blok údajů zalomí pod logo a červená linka zůstane vlevo od textu.
  // červená linka vždy na buňce tabulky (spolehlivé i v Outlooku); bloky vedle sebe přes
  // inline-block, v Outlooku (Word) přes podmíněnou tabulku bez vlastních okrajů
  const ruled = (inner: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="padding:0 0 0 16px;border-left:2px solid ${RED};">${inner}</td></tr></table>`;
  const slogan = x.s.show.slogan && x.c.slogan
    ? `<div style="${cell(11, 15, `padding:0 0 0 ${SLOGAN_INDENT}px;color:${MUTED};font-style:italic;white-space:nowrap;`)}">${esc(x.c.slogan)}</div>`
    : "";
  const card = x.logo
    ? `<tr><td style="padding:0;font-size:0;line-height:0;">`
      + `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="${SIGNATURE_LOGO_WIDTH + 18}"><![endif]-->`
      + `<div style="display:inline-block;vertical-align:middle;width:${SIGNATURE_LOGO_WIDTH}px;margin:0 18px 12px 0;">${logoImg(x)}${slogan}</div>`
      + `<!--[if mso]></td><td valign="middle"><![endif]-->`
      + `<div style="display:inline-block;vertical-align:middle;max-width:340px;margin:0 0 12px 0;">${ruled(details)}</div>`
      + `<!--[if mso]></td></tr></table><![endif]-->`
      + `</td></tr>`
    : `<tr><td style="padding:0;">${ruled(details)}</td></tr>`;
  return wrap([closingRow(x), card, companyRows(x, x.logo ? 2 : 14), noteRow(x, 10)].join(""));
}

// ── Textová verze ────────────────────────────────────────────────────────────────────────────

function textVersion(x: Ctx): string {
  const { s, c } = x;
  const out: string[] = [];
  if (s.closing) out.push(s.closing, "");
  if (s.fullName) out.push(s.fullName);
  const role = [s.role, c.name].filter(Boolean).join(" | ");
  if (role) out.push(role);
  const contacts: string[] = [];
  if (s.variant === "kompaktni") {
    const line = [...x.phones.map((p) => p.text), x.email, x.web?.text ?? ""].filter(Boolean).join(" | ");
    if (line) contacts.push(line);
  } else {
    for (const p of x.phones) contacts.push(`tel.: ${p.text}`);
    if (x.email) contacts.push(`e-mail: ${x.email}`);
    if (x.web) contacts.push(`web: ${x.web.text}`);
  }
  if (x.links.length) contacts.push(x.links.map((l) => `${l.text}: ${l.href}`).join("\n"));
  if (contacts.length) out.push(...(s.fullName || role ? [""] : []), ...contacts);
  if (s.variant !== "kompaktni") {
    const company: string[] = [];
    if (s.show.company) {
      const head = [c.name, c.billingAddress].filter(Boolean).join(", ");
      if (head) company.push(head);
      const ids = [c.ico ? `IČO ${c.ico}` : "", c.dic ? `DIČ ${c.dic}` : ""].filter(Boolean).join(", ");
      if (ids) company.push(ids);
    }
    if (s.show.address && c.correspondenceAddress) company.push(`Doručovací a korespondenční adresa: ${c.correspondenceAddress}`);
    if (s.show.certifications && c.certifications.length) company.push(`Certifikace: ${c.certifications.join(", ")}`);
    if (company.length) out.push("", ...company);
  }
  if (s.show.slogan && c.slogan) out.push(c.slogan);
  if (s.note) out.push("", s.note);
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * Podpis jako HTML (do e-mailu) a text (textová část zprávy, okno psaní). Vypnutý nebo prázdný
 * podpis → prázdné řetězce. Textová verze je bez oddělovače „-- " (přidá ho volající).
 */
export function renderSignature(settings: SignatureSettings, opts: SignatureRenderOptions): RenderedSignature {
  // i rozepsaná hodnota z editoru (mezery, neplatné odkazy …) se vykreslí stejně jako uložená
  const s = normalizeSignature(settings, settings);
  if (!s.enabled) return { html: "", text: "" };
  const x = context(s, opts);
  const text = textVersion(x);
  if (!text.trim() || text.trim() === s.closing) return { html: "", text: "" };
  const html = s.variant === "vizitka" ? htmlCard(x) : htmlCompact(x, s.variant === "firemni");
  return { html, text };
}

// ── Zpráva s podpisem (text z okna psaní → HTML) ─────────────────────────────────────────────

const SIG_DELIMITER = "-- \n";

/**
 * Najde blok podpisu v textu zprávy — první výskyt přesného textu podpisu (přednostně za
 * oddělovačem „-- "), aby se nenahradil podpis v přeposlané / citované starší zprávě.
 * null = podpis v textu není (uživatel ho smazal nebo upravil).
 */
export function locateSignature(body: string, signatureText: string): { before: string; after: string } | null {
  const text = String(body ?? "").replace(/\r\n?/g, "\n");
  const sig = String(signatureText ?? "").replace(/\r\n?/g, "\n").trim();
  if (!sig) return null;
  const delimited = text.indexOf(SIG_DELIMITER + sig);
  if (delimited >= 0) {
    return { before: text.slice(0, delimited), after: text.slice(delimited + SIG_DELIMITER.length + sig.length) };
  }
  const at = text.indexOf(sig);
  if (at < 0) return null;
  return { before: text.slice(0, at), after: text.slice(at + sig.length) };
}

/** Závěrečný pozdrav (řádek sám o sobě). */
const CLOSING_LINE = /^(?:(?:děkuj(?:i|eme)(?: Vám)?(?: a)? )?s (?:přátelským |srdečným )?pozdravem|s úctou|(?:přeji|přejeme) (?:hezký|pěkný) den|hezký den|best regards|kind regards|regards|mit freundlichen grüßen)[\s,.!]*$/i;

/**
 * Text bez závěrečného pozdravu a podpisu na konci („S pozdravem, Mnástrojárna s.r.o." z návrhu AI
 * nebo staré šablony) — před připojením grafického podpisu, aby ve zprávě nebyly dva. Odstraní se
 * jen pozdrav v posledních řádcích a nejvýš 5 krátkých řádků pod ním (jméno, firma, telefon).
 * Pozdrav na stejném řádku s podpisem („S pozdravem, Mnástrojárna s.r.o.") se pozná také.
 */
export function stripClosing(body: string): string {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 7); i--) {
    const line = lines[i].trim();
    const head = line.split(/,\s*/)[0];
    // „S pozdravem, Jan Novák" na jednom řádku — jen u „s pozdravem / s úctou" (ne „Hezký den, posílám …")
    const closing = CLOSING_LINE.test(line) || (line.length <= 80 && /\bs (?:přátelským |srdečným )?pozdravem$|^s úctou$/i.test(head) && CLOSING_LINE.test(`${head},`));
    if (!closing) continue;
    const tail = lines.slice(i + 1).filter((l) => l.trim());
    if (tail.length > 5 || tail.some((l) => l.trim().length > 80)) return lines.join("\n");
    return lines.slice(0, i).join("\n").replace(/\s+$/, "");
  }
  return lines.join("\n");
}

const URL_OR_MAIL = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|([^\s<>"'(),;:\\[\]]+@[^\s<>"'(),;:\\[\]]+\.[a-z]{2,})/gi;

function linkify(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_OR_MAIL)) {
    const i = m.index ?? 0;
    out += esc(line.slice(last, i));
    const v = m[0];
    const href = m[1] ? safeWebHref(v) : isSignatureEmail(v) ? `mailto:${v}` : null;
    out += href ? `<a href="${esc(href)}" target="_blank" style="color:${RED};">${esc(v)}</a>` : esc(v);
    last = i + v.length;
  }
  return out + esc(line.slice(last));
}

/** Text → HTML: escapování, odkazy, zachované mezery na začátku řádku, citace „>" jako blockquote. */
export function plainTextToHtml(text: string): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let depth = 0;
  for (const raw of lines) {
    const q = /^((?:>\s?)+)/.exec(raw);
    const level = q ? (q[1].match(/>/g) ?? []).length : 0;
    const line = q ? raw.slice(q[1].length) : raw;
    while (depth < level) {
      html += `<blockquote style="margin:4px 0 4px 2px;padding:0 0 0 10px;border-left:2px solid #D9D4D4;color:${MUTED};">`;
      depth++;
    }
    while (depth > level) {
      html += "</blockquote>";
      depth--;
    }
    const lead = /^ +/.exec(line)?.[0].length ?? 0;
    html += `${"&nbsp;".repeat(lead)}${linkify(line.slice(lead))}<br>`;
  }
  while (depth-- > 0) html += "</blockquote>";
  return html.replace(/(<br>)+$/, "");
}

/**
 * HTML zprávy z textu napsaného v okně psaní: text nad podpisem, grafický podpis, pod ním citace
 * / přeposlaná zpráva. null = podpis v textu není → poslat jen text (jako dosud).
 */
export function htmlBodyWithSignature(body: string, signature: RenderedSignature): string | null {
  if (!signature.html || !signature.text) return null;
  const parts = locateSignature(body, signature.text);
  if (!parts) return null;
  const before = parts.before.replace(/\s+$/, "");
  const after = parts.after.replace(/^\s*\n/, "").replace(/\s+$/, "");
  return [
    '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="margin:0;padding:0;"><div style="font-family:${FONT};font-size:14px;line-height:21px;color:${TEXT};">`,
    before ? `<div>${plainTextToHtml(before)}</div><div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>` : "",
    signature.html,
    after ? `<div style="height:20px;line-height:20px;font-size:20px;">&nbsp;</div><div>${plainTextToHtml(after)}</div>` : "",
    "</div></body></html>",
  ].join("");
}
