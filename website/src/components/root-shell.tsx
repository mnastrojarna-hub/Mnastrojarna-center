import type { Metadata, Viewport } from "next";
import { getDict } from "@/content";
import { SITE } from "@/content/site";
import { LOCALE_META, href, type Locale } from "@/i18n/config";
import { organizationJsonLd } from "@/lib/seo";
import { Analytics } from "./analytics";
import { JsonLd } from "./json-ld";
import { RevealObserver } from "./reveal-observer";
import { display, mono, sans } from "../app/fonts";
import "../app/globals.css";

export function rootMetadata(locale: Locale): Metadata {
  const t = getDict(locale);
  return {
    metadataBase: new URL(SITE.url),
    title: { default: t.meta.title, template: t.meta.template },
    description: t.meta.description,
    applicationName: SITE.name,
    keywords: t.meta.keywords,
    authors: [{ name: SITE.name }],
    formatDetection: { telephone: false },
    openGraph: { type: "website", locale: LOCALE_META[locale].og, siteName: SITE.name, url: SITE.url },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    verification: process.env.NEXT_PUBLIC_GSC_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION } : undefined,
  };
}

export const rootViewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

/** Kořen dokumentu pro daný jazyk (každý jazyk má vlastní root layout → správné <html lang>). */
export function RootShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = getDict(locale);
  return (
    <html lang={locale} className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans">
        <a href="#obsah" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-white">
          {t.nav.skip}
        </a>
        {children}
        <RevealObserver />
        <Analytics t={t.cookie} privacyHref={href(locale, "privacy")} />
        <JsonLd data={organizationJsonLd(locale)} />
      </body>
    </html>
  );
}
