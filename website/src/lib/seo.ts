import type { Metadata } from "next";
import { getDict } from "@/content";
import { SITE } from "@/content/site";
import { LOCALES, LOCALE_META, alternates, href, type Locale, type PageKey } from "@/i18n/config";

/** Metadata stránky vč. canonical a hreflang (cs, en, de, x-default). */
export function pageMeta({
  locale,
  page,
  serviceId,
  title,
  description,
  keywords,
  noindex,
}: {
  locale: Locale;
  page: PageKey;
  /** ID služby nebo český slug zakázky */
  serviceId?: string;
  title: string;
  description: string;
  keywords?: string[];
  noindex?: boolean;
}): Metadata {
  const path = href(locale, page, serviceId);
  const alt = alternates(page, serviceId);
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].hreflang, alt[l]]));
  languages["x-default"] = alt.cs;
  return {
    title,
    description,
    keywords,
    alternates: { canonical: path, languages },
    openGraph: {
      type: "website",
      url: `${SITE.url}${path}`,
      title: `${title} | ${SITE.shortName}`,
      description,
      siteName: SITE.name,
      locale: LOCALE_META[locale].og,
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => LOCALE_META[l].og),
    },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE.shortName}`, description },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export const ORG_ID = `${SITE.url}/#organization`;

export function organizationJsonLd(locale: Locale) {
  const t = getDict(locale);
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    "@id": ORG_ID,
    name: SITE.name,
    alternateName: ["Mnástrojárna", "MNástrojárna", "Mnastrojarna"],
    url: SITE.url,
    logo: `${SITE.url}/brand/logo.svg`,
    image: `${SITE.url}/opengraph-image`,
    slogan: t.slogan,
    description: t.meta.description,
    foundingDate: String(SITE.founded),
    vatID: SITE.dic,
    taxID: SITE.ico,
    email: SITE.email,
    telephone: SITE.phone,
    priceRange: "CZK 50,000+",
    knowsLanguage: ["cs", "en", "de"],
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE.workshop.street,
      postalCode: SITE.workshop.zip,
      addressLocality: SITE.workshop.city,
      addressRegion: t.addresses.region,
      addressCountry: "CZ",
    },
    geo: { "@type": "GeoCoordinates", latitude: SITE.workshop.lat, longitude: SITE.workshop.lng },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "07:00",
      closes: "20:00",
    },
    areaServed: [{ "@type": "Country", name: "Czech Republic" }, { "@type": "Place", name: "Europe" }],
    hasCredential: [
      { "@type": "EducationalOccupationalCredential", credentialCategory: "certificate", name: "ISO 9001" },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "certificate", name: "ISO 14001" },
    ],
    knowsAbout: Object.values(t.services).map((s) => s.title),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE.url}${it.path}` })),
  };
}

export function faqJsonLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
