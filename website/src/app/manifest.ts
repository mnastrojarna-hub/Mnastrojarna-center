import type { MetadataRoute } from "next";
import { cs } from "@/content/cs";
import { SITE } from "@/content/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: cs.meta.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0F0E0E",
    theme_color: "#E03930",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
