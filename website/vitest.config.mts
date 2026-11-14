import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({

  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // tsconfig má jsx: "preserve" (Next.js) – testy, které importují .tsx (pás karet 2D výkresu), potřebují převod JSX
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/**/*.test.ts"] },
});
