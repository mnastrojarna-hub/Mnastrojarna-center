import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // serverové moduly jdou testovat i mimo Next.js
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      // líně načítané záložky karty zakázky — v testech synchronně (renderToString), viz stub
      "next/dynamic": path.resolve(__dirname, "src/test/next-dynamic-stub.tsx"),
    },
  },
  // Vitest 4 (Vite 8) překládá přes oxc — JSX v .tsx (PDF šablony, UI testy)
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
  },
});
