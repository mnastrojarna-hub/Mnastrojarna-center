import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cs } from "@/content/cs";
import { de } from "@/content/de";
import { en } from "@/content/en";
import { CASES } from "@/content/cases";
import { LOCALES, SERVICE_IDS, alternates, href, resolvePath, type PageKey } from "./config";

const APP = path.resolve(__dirname, "../app");
const base = { cs: "(cs)/(site)", en: "(en)", de: "(de)" } as const;
const KEYS: PageKey[] = ["home", "services", "cases", "machinery", "quality", "references", "about", "contact", "rfq", "careers", "privacy"];

describe("lokalizované trasy", () => {
  it("každá adresa z tabulky má soubor stránky", () => {
    for (const l of LOCALES)
      for (const k of KEYS) {
        const p = href(l, k);
        const file = path.join(APP, base[l], p === "/" ? "" : p, "page.tsx");
        expect(fs.existsSync(file), `${l} ${k} → ${file}`).toBe(true);
      }
  });
  it("služby: [slug] route ve všech jazycích a zpětné rozpoznání adresy", () => {
    for (const l of LOCALES) {
      expect(fs.existsSync(path.join(APP, base[l], href(l, "services"), "[slug]", "page.tsx"))).toBe(true);
      for (const id of SERVICE_IDS) expect(resolvePath(href(l, "service", id))).toEqual({ locale: l, key: "service", serviceId: id });
    }
  });
  it("zakázky: [slug] route a rozpoznání adresy ve všech jazycích", () => {
    for (const l of LOCALES) {
      expect(fs.existsSync(path.join(APP, base[l], href(l, "cases"), "[slug]", "page.tsx"))).toBe(true);
      for (const c of CASES) expect(resolvePath(href(l, "case", c.slug.cs))).toEqual({ locale: l, key: "case", caseId: c.slug.cs });
    }
  });
  it("hreflang alternativy vedou na stejnou stránku", () => {
    const a = alternates("service", "nastrojarstvi");
    expect(a).toEqual({ cs: "/sluzby/nastrojarstvi", en: "/en/services/toolmaking", de: "/de/leistungen/werkzeugbau" });
  });
});

describe("slovníky", () => {
  // SEO klíčová slova se mezi jazyky smí lišit počtem
  const shape = (o: unknown): unknown =>
    Array.isArray(o) ? o.map(shape) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "keywords" ? "keywords" : shape(v)])) : typeof o;
  it("EN a DE mají stejnou strukturu jako CZ", () => {
    expect(shape({ ...en, locale: "" })).toEqual(shape({ ...cs, locale: "" }));
    expect(shape({ ...de, locale: "" })).toEqual(shape({ ...cs, locale: "" }));
  });
  it("zvýraznění *…* jsou párová", () => {
    const walk = (o: unknown, out: string[] = []): string[] => {
      if (typeof o === "string") out.push(o);
      else if (o && typeof o === "object") Object.values(o).forEach((v) => walk(v, out));
      return out;
    };
    for (const d of [cs, en, de]) for (const s of walk(d)) expect((s.match(/\*/g) ?? []).length % 2, s).toBe(0);
  });
});
