import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";
import { Analytics } from "@/components/analytics";
import { JsonLd } from "@/components/json-ld";
import { RevealObserver } from "@/components/reveal-observer";
import { SITE } from "@/content/site";
import { organizationJsonLd } from "@/lib/seo";
import "./globals.css";

const sans = Roboto({ subsets: ["latin", "latin-ext"], weight: ["300", "400", "500", "700"], variable: "--font-sans", display: "swap" });
const display = Roboto_Condensed({ subsets: ["latin", "latin-ext"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
const mono = Roboto_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.shortName} – CNC obrábění, nástrojárna a výroba strojů | ${SITE.slogan}`,
    template: `%s | ${SITE.shortName}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "CNC obrábění",
    "nástrojárna",
    "pětiosé obrábění",
    "drátové řezání",
    "výroba náhradních dílů",
    "jednoúčelové stroje",
    "výroba prototypů",
    "strojírenská výroba na zakázku",
    "Pelhřimov",
    "Vysočina",
  ],
  authors: [{ name: SITE.name }],
  formatDetection: { telephone: false },
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "cs_CZ", siteName: SITE.name, url: SITE.url },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  verification: process.env.NEXT_PUBLIC_GSC_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#0F0E0E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans">
        <a href="#obsah" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-white">
          Přeskočit na obsah
        </a>
        {children}
        <RevealObserver />
        <Analytics />
        <JsonLd data={organizationJsonLd()} />
      </body>
    </html>
  );
}
