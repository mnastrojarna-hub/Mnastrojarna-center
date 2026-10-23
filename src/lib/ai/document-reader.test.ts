import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { readBusinessDocument, BUSINESS_DOC_SCHEMA, AI_NOT_CONFIGURED } from "./document-reader";
import { emptyExtracted, normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import objednavka from "@/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json";

const FIXTURE = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json");

type Schema = { properties: Record<string, Schema & { items?: Schema }>; required: string[]; additionalProperties: boolean };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BUSINESS_DOC_SCHEMA", () => {
  it("zrcadlí ExtractedBusinessDoc — všechna pole povinná, nic navíc", () => {
    const s = BUSINESS_DOC_SCHEMA as unknown as Schema;
    const empty = emptyExtracted();
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(Object.keys(empty).sort());
    expect(Object.keys(s.properties).sort()).toEqual(Object.keys(empty).sort());
    expect([...s.properties.customer.required].sort()).toEqual(Object.keys(empty.customer).sort());
    expect(s.properties.supplier.additionalProperties).toBe(false);
    const itemKeys = Object.keys(normalizeExtracted({ items: [{ name: "x" }] }).items[0]).sort();
    expect([...s.properties.items.items!.required].sort()).toEqual(itemKeys);
    expect(s.properties.items.items!.additionalProperties).toBe(false);
  });
});

describe("readBusinessDocument", () => {
  it("AI_FAKE_CAPTURE vrátí normalizovaný obsah souboru bez volání API", async () => {
    vi.stubEnv("AI_FAKE_CAPTURE", FIXTURE);
    const doc = await readBusinessDocument({ files: [] });
    expect(doc).toEqual(normalizeExtracted(objednavka));
  });

  it("bez API klíče hází srozumitelnou chybu", async () => {
    vi.stubEnv("AI_FAKE_CAPTURE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(readBusinessDocument({ files: [{ mediaType: "image/jpeg", dataBase64: "AAAA" }] }))
      .rejects.toThrow(AI_NOT_CONFIGURED);
  });
});

describe("výkres a dávka (testovací háček)", () => {
  it("DRAWING_SCHEMA zrcadlí DrawingExtract", async () => {
    const { DRAWING_SCHEMA } = await import("./document-reader");
    const { emptyDrawing } = await import("@/lib/jobs/capture-batch");
    const s = DRAWING_SCHEMA as unknown as Schema;
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(Object.keys(emptyDrawing()).sort());
    expect(Object.keys(s.properties).sort()).toEqual(Object.keys(emptyDrawing()).sort());
  });

  it("readDrawing a vytěžení dokladu dávky čtou fixtures podle druhu a skupiny", async () => {
    vi.stubEnv("AI_FAKE_CAPTURE", FIXTURE);
    const { readDrawing, readBusinessDocumentDetailed } = await import("./document-reader");
    const d = await readDrawing({ files: [], fake: { type: "vykres", group: "g2" } });
    expect(d.drawing).toMatchObject({ drawingNumber: "4711-03", revision: "A" });
    expect(d.usage).toBeNull();
    const b = await readBusinessDocumentDetailed({ files: [], fake: { type: "nabidka_dodavatel", group: "0" } });
    expect(b.doc).toMatchObject({ docKind: "nabidka", issuer: "dodavatel", documentNumber: "NAB-552" });
    const v1 = await readBusinessDocumentDetailed({ files: [] });
    expect(v1.doc.documentNumber).toBe("4795-2026");
  });
});
