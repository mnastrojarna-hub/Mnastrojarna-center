import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const legacy = [
  ["/cz", "/"],
  ["/cz/o-nas/o-nas", "/o-nas"],
  ["/cz/o-nas/certifikaty", "/kvalita"],
  ["/cz/o-nas/reference", "/o-nas"],
  ["/cz/o-nas/galerie", "/strojovy-park"],
  ["/cz/o-nas/akce", "/poptavka"],
  ["/cz/sluzby/oblasti-cinnosti", "/sluzby"],
  ["/cz/sluzby/vyroba-dilu-na-zakazku", "/sluzby/cnc-obrabeni"],
  ["/cz/technologie/cnc-obrabeni", "/sluzby/cnc-obrabeni"],
  ["/cz/technologie/petiose-cnc-obrabeni", "/sluzby/petiose-cnc-obrabeni"],
  ["/cz/technologie/elektroerozivni-obrabeni", "/sluzby/elektroerozivni-obrabeni"],
  ["/cz/technologie/mereni-a-kontrola-kvality", "/sluzby/mereni-a-kontrola-kvality"],
  ["/cz/kariera", "/kariera"],
  ["/cz/kontakt", "/kontakt"],
  ["/cz/mapa-stranek", "/sitemap.xml"],
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  async redirects() {
    return legacy.map(([source, destination]) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/vendor/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
