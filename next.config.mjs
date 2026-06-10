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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Projekt je v podadresáři repozitáře — ukotvi tracing sem (kvůli Vercel buildu)
  outputFileTracingRoot: __dirname,
  // @react-pdf nebundlovat (yoga/fontkit) — běží jako externí balík na serveru
  serverExternalPackages: ["@react-pdf/renderer"],
  // Zahrnout fonty do serverless funkce generující PDF + SQL migrace pro průvodce
  outputFileTracingIncludes: {
    "/api/pdf/**": ["./public/fonts/**"],
    "/api/setup/**": ["./supabase/migrations/**"],
  },
};

export default nextConfig;
