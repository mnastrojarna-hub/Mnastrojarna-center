import type { MetadataRoute } from "next";
import { CASES } from "@/content/cases";
import { SITE } from "@/content/site";
import { LOCALES, LOCALE_META, SERVICE_IDS, alternates, href, type PageKey } from "@/i18n/config";

const PAGES: [PageKey, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["home", 1, "weekly"],
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
    { url: `${SITE.url}/cad`, lastModified: now, priority: 0.9, changeFrequency: "monthly" },
  ];
}
