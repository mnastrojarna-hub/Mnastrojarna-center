import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Projekt je v podadresáři repozitáře — ukotvi tracing sem (kvůli Vercel buildu)
  outputFileTracingRoot: __dirname,
  // @react-pdf nebundlovat (yoga/fontkit) — běží jako externí balík na serveru
  serverExternalPackages: ["@react-pdf/renderer"],
  // Zahrnout fonty do serverless funkce generující PDF
  outputFileTracingIncludes: {
    "/api/pdf/**": ["./public/fonts/**"],
  },
};

export default nextConfig;
