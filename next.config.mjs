import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Projekt je v podadresáři repozitáře — ukotvi tracing sem (kvůli Vercel buildu)
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
