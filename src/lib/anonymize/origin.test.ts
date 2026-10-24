import { afterEach, describe, expect, it } from "vitest";
import { appOrigin } from "./queue";

const KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("adresa interního běhu anonymizace (nese tajemství) — nikdy z hlaviček požadavku", () => {
  it("konfigurace má přednost před adresou požadavku", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://zakazky.mnastrojarna.cz/";
    expect(appOrigin("https://evil.example/api/drawings/anonymize")).toBe("https://zakazky.mnastrojarna.cz");
  });
  it("bez konfigurace: jen localhost / 127.0.0.1 z požadavku, cizí host nikdy", () => {
    for (const k of KEYS) delete process.env[k];
    expect(appOrigin("http://localhost:3000/api/x")).toBe("http://localhost:3000");
    expect(appOrigin("http://127.0.0.1:3800/api/x")).toBe("http://127.0.0.1:3800");
    expect(appOrigin("https://evil.example/api/x")).toBeNull();
    expect(appOrigin(null)).toBeNull();
  });
  it("VERCEL_URL jako záloha", () => {
    for (const k of KEYS) delete process.env[k];
    process.env.VERCEL_URL = "mnastrojarna.vercel.app";
    expect(appOrigin("https://evil.example/x")).toBe("https://mnastrojarna.vercel.app");
  });
});
