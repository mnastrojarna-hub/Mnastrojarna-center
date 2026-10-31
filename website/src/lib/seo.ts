import type { Metadata } from "next";
import { SITE } from "@/content/site";

export function pageMeta({ title, description, path, image }: { title: string; description: string; path: string; image?: string }): Metadata {
  const url = `${SITE.url}${path}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url,
      title: `${title} | ${SITE.shortName}`,
      description,
      siteName: SITE.name,
      locale: "cs_CZ",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE.shortName}`, description },
  };
}

export const ORG_ID = `${SITE.url}/#organization`;

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    "@id": ORG_ID,
    name: SITE.name,
    alternateName: ["Mnástrojárna", "MNástrojárna", "Mnastrojarna"],
    url: SITE.url,
    logo: `${SITE.url}/brand/logo.svg`,
    image: `${SITE.url}/opengraph-image`,
    slogan: SITE.slogan,
    description: SITE.description,
    foundingDate: String(SITE.founded),
    vatID: SITE.dic,
    taxID: SITE.ico,
    email: SITE.email,
    telephone: SITE.phone,
    priceRange: "od 50 000 Kč",
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE.workshop.street,
      postalCode: SITE.workshop.zip,
      addressLocality: SITE.workshop.city,
      addressRegion: SITE.workshop.region,
      addressCountry: "CZ",
    },
    geo: { "@type": "GeoCoordinates", latitude: SITE.workshop.lat, longitude: SITE.workshop.lng },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "07:00",
      closes: "20:00",
    },
    areaServed: [{ "@type": "Country", name: "Česká republika" }, { "@type": "Place", name: "Evropa" }],
    hasCredential: [
      { "@type": "EducationalOccupationalCredential", credentialCategory: "certificate", name: "ISO 9001" },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "certificate", name: "ISO 14001" },
    ],
    knowsAbout: ["CNC obrábění", "Pětiosé obrábění", "Drátové řezání", "Nástrojářství", "Jednoúčelové stroje", "Výroba prototypů"],
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
