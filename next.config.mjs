import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runtime env z průvodce nastavením (data/runtime-env.json) — doplní chybějící
// proměnné při startu serveru, takže lokální provoz funguje i bez ručního .env.
try {
  const runtimeEnvFile = path.join(__dirname, "data", "runtime-env.json");
  if (fs.existsSync(runtimeEnvFile)) {
    const values = JSON.parse(fs.readFileSync(runtimeEnvFile, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string" && value && !process.env[key]) process.env[key] = value;
    }
  }
} catch {
  // poškozený soubor nesmí shodit server
}

// Soubory pro anonymizaci výkresů (src/lib/anonymize/pdf-node.ts): standardní písma a cmaps pdf.js
// (bez nich se nevložená písma nevykreslí — hlídá to kontrola inkoustu), worker a nativní binárky.
const ANON_TRACE = [
  "./node_modules/pdfjs-dist/standard_fonts/**",
  "./node_modules/pdfjs-dist/cmaps/**",
  "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "./node_modules/@napi-rs/canvas/**",
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
  "./node_modules/sharp/**",
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Projekt je v podadresáři repozitáře — ukotvi tracing sem (kvůli Vercel buildu)
  outputFileTracingRoot: __dirname,
  // @react-pdf nebundlovat (yoga/fontkit) — běží jako externí balík na serveru.
  // Anonymizace výkresů: @napi-rs/canvas (nativní) se načítá za běhu z node_modules (sharp je ve
  // výchozím seznamu Next.js). pdfjs-dist se bundluje (klientské náhledy PDF ho importují přes
  // new URL(…, import.meta.url), což externí balík nedovolí); worker se v Node předává přímo
  // (globalThis.pdfjsWorker) a písma / cmaps se čtou z node_modules (tracing níže).
  serverExternalPackages: ["@react-pdf/renderer", "@napi-rs/canvas"],
  // Zahrnout fonty do serverless funkce generující PDF + SQL migrace pro průvodce
  outputFileTracingIncludes: {
    // PDF se generuje i v akcích zakázek (uložení do dokumentů, odeslání nabídky)
    "/**": ["./public/fonts/**"],
    "/api/pdf/**": ["./public/fonts/**"],
    "/api/setup/**": ["./supabase/migrations/**"],
    // Anonymizace výkresů vykresluje JEN v těchto routách (nikdy v server action)
    "/api/drawings/anonymize/**": ANON_TRACE,
    "/api/cron/drawing-anonymize/**": ANON_TRACE,
  },
  // musl binárky (Alpine) do funkce na Vercelu (glibc) nepatří
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**",
      "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
      "./node_modules/@img/sharp-linuxmusl-x64/**",
    ],
  },
};

export default nextConfig;
