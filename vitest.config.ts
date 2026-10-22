import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // serverové moduly jdou testovat i mimo Next.js
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
    esbuild: { jsx: "automatic" } as never,
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
