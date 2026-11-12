import type { MetadataRoute } from "next";
import { CASES } from "@/content/cases";
import { cadAppHref, cadDocsHref } from "@/content/cad-links";
import { SITE } from "@/content/site";
import { LOCALES, LOCALE_META, SERVICE_IDS, alternates, href, type PageKey } from "@/i18n/config";

const PAGES: [PageKey, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["home", 1, "weekly"],
  ["maintenance", 0.9, "monthly"],
  ["services", 0.9, "monthly"],
  ["cases", 0.9, "monthly"],
  ["machinery", 0.8, "monthly"],
  ["references", 0.8, "monthly"],
  ["quality", 0.7, "yearly"],
  ["about", 0.7, "yearly"],
  ["contact", 0.7, "yearly"],
  ["careers", 0.3, "monthly"],
];

/** Sitemapa všech jazykových verzí vč. hreflang alternativ. */
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entry = (key: PageKey, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"], id?: string) => {
    const alt = alternates(key, id);
    const languages = Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].hreflang, `${SITE.url}${alt[l]}`]));
    return LOCALES.map((l) => ({ url: `${SITE.url}${href(l, key, id)}`, lastModified: now, priority, changeFrequency, alternates: { languages } }));
  };
  return [
    ...PAGES.flatMap(([k, p, f]) => entry(k, p, f)),
    ...SERVICE_IDS.flatMap((id) => entry("service", 0.85, "monthly", id)),
    ...CASES.flatMap((c) => entry("case", 0.75, "yearly", c.slug.cs)),
    ...LOCALES.map((l) => ({ url: `${SITE.url}${cadAppHref(l)}`, lastModified: now, priority: 0.9, changeFrequency: "monthly" as const, alternates: { languages: Object.fromEntries(LOCALES.map((x) => [LOCALE_META[x].hreflang, `${SITE.url}${cadAppHref(x)}`])) } })),
    ...LOCALES.map((l) => ({ url: `${SITE.url}${cadDocsHref(l)}`, lastModified: now, priority: l === "cs" ? 0.85 : 0.6, changeFrequency: "monthly" as const, alternates: { languages: Object.fromEntries(LOCALES.map((x) => [LOCALE_META[x].hreflang, `${SITE.url}${cadDocsHref(x)}`])) } })),
  ];
}
