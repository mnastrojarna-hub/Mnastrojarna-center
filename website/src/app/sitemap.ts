import type { MetadataRoute } from "next";
import { SERVICES, SITE } from "@/content/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "weekly"],
    ["/sluzby", 0.9, "monthly"],
    ["/poptavka", 0.9, "yearly"],
    ["/strojovy-park", 0.8, "monthly"],
    ["/cad", 0.9, "monthly"],
    ["/kvalita", 0.7, "yearly"],
    ["/o-nas", 0.7, "yearly"],
    ["/kontakt", 0.7, "yearly"],
    ["/kariera", 0.3, "monthly"],
  ];
  return [
    ...pages.map(([p, priority, changeFrequency]) => ({ url: `${SITE.url}${p}`, lastModified: now, priority, changeFrequency })),
    ...SERVICES.map((s) => ({ url: `${SITE.url}/sluzby/${s.slug}`, lastModified: now, priority: 0.85, changeFrequency: "monthly" as const })),
  ];
}
