import type { MetadataRoute } from "next";
import { SITE } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  const isProd = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : true;
  return {
    rules: isProd ? [{ userAgent: "*", allow: "/", disallow: ["/api/"] }] : [{ userAgent: "*", disallow: "/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
