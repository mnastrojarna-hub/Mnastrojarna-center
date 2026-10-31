/**
 * Jazykové verze a lokalizované adresy. Čeština je výchozí (bez prefixu), EN pod /en, DE pod /de.
 * Každá stránka má v každém jazyce vlastní SEO slug; z tabulky se generují odkazy, hreflang i přepínač jazyků.
 */

export const LOCALES = ["cs", "en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";

export const LOCALE_META: Record<Locale, { label: string; short: string; hreflang: string; og: string }> = {
  cs: { label: "Čeština", short: "CZ", hreflang: "cs-CZ", og: "cs_CZ" },
  en: { label: "English", short: "EN", hreflang: "en", og: "en_GB" },
  de: { label: "Deutsch", short: "DE", hreflang: "de", og: "de_DE" },
};

export type PageKey = "home" | "services" | "service" | "machinery" | "quality" | "references" | "about" | "contact" | "rfq" | "careers" | "privacy";
type StaticKey = Exclude<PageKey, "service">;

const PATHS: Record<Locale, Record<StaticKey, string>> = {
  cs: {
    home: "/",
    services: "/sluzby",
    machinery: "/strojovy-park",
    quality: "/kvalita",
    references: "/reference",
    about: "/o-nas",
    contact: "/kontakt",
    rfq: "/poptavka",
    careers: "/kariera",
    privacy: "/ochrana-osobnich-udaju",
  },
  en: {
    home: "/en",
    services: "/en/services",
    machinery: "/en/machinery",
    quality: "/en/quality",
    references: "/en/references",
    about: "/en/about-us",
    contact: "/en/contact",
    rfq: "/en/request-a-quote",
    careers: "/en/careers",
    privacy: "/en/privacy-policy",
  },
  de: {
    home: "/de",
    services: "/de/leistungen",
    machinery: "/de/maschinenpark",
    quality: "/de/qualitaet",
    references: "/de/referenzen",
    about: "/de/ueber-uns",
    contact: "/de/kontakt",
    rfq: "/de/anfrage",
    careers: "/de/karriere",
    privacy: "/de/datenschutz",
  },
};

/** ID služby = český slug (stabilní klíč). */
export const SERVICE_IDS = [
  "cnc-obrabeni",
  "petiose-cnc-obrabeni",
  "elektroerozivni-obrabeni",
  "nahradni-dily-pro-vyrobni-linky",
  "nastrojarstvi",
  "jednoucelove-stroje",
  "vyroba-prototypu",
  "programovani-a-konstrukce",
  "mereni-a-kontrola-kvality",
  "konsignacni-skladovani",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

const SERVICE_SLUGS: Record<ServiceId, Record<Locale, string>> = {
  "cnc-obrabeni": { cs: "cnc-obrabeni", en: "cnc-machining", de: "cnc-bearbeitung" },
  "petiose-cnc-obrabeni": { cs: "petiose-cnc-obrabeni", en: "5-axis-cnc-machining", de: "5-achs-cnc-bearbeitung" },
  "elektroerozivni-obrabeni": { cs: "elektroerozivni-obrabeni", en: "wire-edm", de: "drahterodieren" },
  "nahradni-dily-pro-vyrobni-linky": { cs: "nahradni-dily-pro-vyrobni-linky", en: "spare-parts-for-production-lines", de: "ersatzteile-fuer-produktionslinien" },
  nastrojarstvi: { cs: "nastrojarstvi", en: "toolmaking", de: "werkzeugbau" },
  "jednoucelove-stroje": { cs: "jednoucelove-stroje", en: "special-purpose-machines", de: "sondermaschinenbau" },
  "vyroba-prototypu": { cs: "vyroba-prototypu", en: "prototype-manufacturing", de: "prototypenbau" },
  "programovani-a-konstrukce": { cs: "programovani-a-konstrukce", en: "engineering-and-cnc-programming", de: "konstruktion-und-cnc-programmierung" },
  "mereni-a-kontrola-kvality": { cs: "mereni-a-kontrola-kvality", en: "inspection-and-quality-control", de: "messtechnik-und-qualitaetskontrolle" },
  "konsignacni-skladovani": { cs: "konsignacni-skladovani", en: "consignment-stock", de: "konsignationslager" },
};

export function href(locale: Locale, key: PageKey, serviceId?: ServiceId): string {
  if (key === "service") {
    if (!serviceId) throw new Error("serviceId chybí");
    return `${PATHS[locale].services}/${SERVICE_SLUGS[serviceId][locale]}`;
  }
  return PATHS[locale][key];
}

export function serviceSlug(locale: Locale, id: ServiceId) {
  return SERVICE_SLUGS[id][locale];
}

/** Adresy téže stránky ve všech jazycích (pro hreflang a přepínač). */
export function alternates(key: PageKey, serviceId?: ServiceId): Record<Locale, string> {
  return Object.fromEntries(LOCALES.map((l) => [l, href(l, key, serviceId)])) as Record<Locale, string>;
}

export type Resolved = { key: PageKey; serviceId?: ServiceId };

/** Najde stránku podle cesty (např. „/de/leistungen/werkzeugbau“). */
export function resolvePath(pathname: string): (Resolved & { locale: Locale }) | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const locale of LOCALES) {
    for (const [key, p] of Object.entries(PATHS[locale]) as [StaticKey, string][]) {
      if (p === clean) return { locale, key };
    }
    const base = PATHS[locale].services + "/";
    if (clean.startsWith(base)) {
      const slug = clean.slice(base.length);
      const id = (Object.keys(SERVICE_SLUGS) as ServiceId[]).find((s) => SERVICE_SLUGS[s][locale] === slug);
      if (id) return { locale, key: "service", serviceId: id };
    }
  }
  return null;
}

export function localeOfPath(pathname: string): Locale {
  if (pathname === "/en" || pathname.startsWith("/en/")) return "en";
  if (pathname === "/de" || pathname.startsWith("/de/")) return "de";
  return "cs";
}

/** Cesty pro generateStaticParams catch-all routy daného jazyka (bez prefixu jazyka). */
export function staticSegments(locale: Exclude<Locale, "cs">): string[][] {
  const prefix = `/${locale}`;
  const strip = (p: string) => p.slice(prefix.length).split("/").filter(Boolean);
  const out = (Object.keys(PATHS[locale]) as StaticKey[]).map((k) => strip(PATHS[locale][k]));
  for (const id of SERVICE_IDS) out.push(strip(href(locale, "service", id)));
  return out;
}
