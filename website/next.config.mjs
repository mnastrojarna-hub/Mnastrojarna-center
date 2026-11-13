import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const legacy = [
  // zakázka přejmenovaná bez roku v adrese
  ["/zakazky/upinaci-pripravek-2015", "/zakazky/upinaci-pripravek-s-celistmi"],
  ["/en/projects/clamping-fixture-2015", "/en/projects/clamping-fixture-with-jaws"],
  ["/de/projekte/spannvorrichtung-2015", "/de/projekte/spannvorrichtung-mit-wechselbacken"],
  ["/cz", "/"],
  ["/cz/o-nas/o-nas", "/o-nas"],
  ["/cz/o-nas/certifikaty", "/kvalita"],
  ["/cz/o-nas/reference", "/reference"],
  ["/cz/o-nas/galerie", "/strojovy-park"],
  ["/cz/o-nas/akce", "/kontakt"],
  ["/cz/sluzby/oblasti-cinnosti", "/sluzby"],
  ["/cz/sluzby/vyroba-dilu-na-zakazku", "/sluzby/cnc-obrabeni"],
  ["/cz/technologie/cnc-obrabeni", "/sluzby/cnc-obrabeni"],
  ["/cz/technologie/petiose-cnc-obrabeni", "/sluzby/petiose-cnc-obrabeni"],
  ["/cz/technologie/elektroerozivni-obrabeni", "/sluzby/elektroerozivni-obrabeni"],
  ["/cz/technologie/mereni-a-kontrola-kvality", "/sluzby/mereni-a-kontrola-kvality"],
  ["/cz/kariera", "/kariera"],
  ["/cz/kontakt", "/kontakt"],
  ["/cz/mapa-stranek", "/sitemap.xml"],
  ["/3d-prohlizec", "/cad"],
  // poptávkový formulář byl zrušen → kontakt (primární kontakt Vít Volný)
  ["/poptavka", "/kontakt"],
  ["/en/request-a-quote", "/en/contact"],
  ["/de/anfrage", "/de/kontakt"],
];

/** Přejmenované složky: přesměruje se celý obsah (soubor po souboru), např. obrázky zakázky bez roku v adrese. */
const legacyDirs = [
  ["/img/zakazky/upinaci-pripravek-2015", "/img/zakazky/upinaci-pripravek-s-celistmi"],
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// STATIC_EXPORT=1 → čisté HTML do složky out/ pro klasický FTP hosting (Hosting90/Webglobe).
// Přesměrování a hlavičky pak řeší public/.htaccess (vygeneruje scripts/gen-htaccess.mjs).
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  ...(staticExport ? { output: "export", trailingSlash: true } : {}),
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  poweredByHeader: false,
  images: staticExport ? { unoptimized: true } : { formats: ["image/avif", "image/webp"] },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (r) => { r.request = r.request.replace(/^node:/, ""); }));
      // Emscripten glue OpenCascade obsahuje větve pro Node — v prohlížeči je nepotřebujeme
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false, module: false, url: false, worker_threads: false, perf_hooks: false };
    }
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // acad-ts (DWG/DXF) hledá typy DXF podle jména třídy (constructor.name). Minifikace produkčního buildu třídy
    // přejmenuje („h is not a DXF subclass“) – proto předpřipravený balík knihovny, který jména drží (esbuild keepNames).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@node-projects/acad-ts$": fileURLToPath(new URL("./node_modules/@node-projects/acad-ts/dist/index-min.js", import.meta.url)),
    };
    return config;
  },
  ...(staticExport ? {} : {
  async redirects() {
    return [
      ...legacy.map(([source, destination]) => ({ source, destination, permanent: true })),
      ...legacyDirs.map(([from, to]) => ({ source: `${from}/:file*`, destination: `${to}/:file*`, permanent: true })),
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/vendor/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  }),
};

export { legacy, legacyDirs, securityHeaders };
export default nextConfig;
