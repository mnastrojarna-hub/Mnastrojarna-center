import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { anonymizePdf, type PdfAnonInput } from "./pdf-pipeline";
import { checkPdfOutput } from "./pdf-raster";
import { PDF_INVALID_TEXT, PDF_PASSWORD_TEXT } from "./failure-text";
import { ALL_REDACT, makeTerms } from "./rules";
import { decideAnonStatus } from "./decide";
import * as F from "./__fixtures__/encrypted-pdf";

/**
 * „anonymizace stále nefunguje píše to: PDF je poškozené nebo zaheslované" (majitel 30. 10.).
 * PDF s heslem VLASTNÍKA (zákaz úprav / kopírování — běžné u exportů ze SolidWorks, Inventoru, Heliosu,
 * SAPu) se otevře bez hesla: pdf.js ho dešifruje, pdf-lib ho nepřečte (příprava anotací se přeskočí) a
 * výstup je NOVÉ nešifrované PDF z rastru. Jen PDF s heslem k OTEVŘENÍ je „zaheslované".
 */

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const input = (bytes: Uint8Array): PdfAnonInput => ({
  bytes, ctx: { terms: makeTerms(["Strojmetal a.s."], "crm"), keepTerms: ["Mnástrojárna"], redact: { ...ALL_REDACT } }, ai: null,
  verifyPhotos: true, fillPdf: "white", fillPhoto: "white", maxDpi: 150, maxMpx: 40, pageFrom: 1, deadline: Date.now() + 240_000,
});

/** Bajty + rozbalené proudy (hledání úniku). */
function grepText(b: Uint8Array): string {
  const buf = Buffer.from(b);
  const raw = buf.toString("latin1");
  let s = raw;
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const a = (m.index ?? 0) + m[0].length, e = raw.indexOf("endstream", a);
    try { s += inflateSync(buf.subarray(a, e)).toString("latin1"); } catch { /* obrázek / šifrované */ }
  }
  return s;
}

const OWNER = { "RC4-40": F.OWNER_RC4_40, "RC4-128": F.OWNER_RC4_128, "AES-128": F.OWNER_AES_128, "AES-256 (R6)": F.OWNER_AES_256, "AES-128 + anotace": F.OWNER_AES_128_ANNOT };

describe("PDF s heslem vlastníka (CAD / ERP) se anonymizuje normálně", () => {
  for (const [cipher, data] of Object.entries(OWNER)) {
    it(`${cipher}: vstup je opravdu šifrovaný, výstup čisté nešifrované PDF bez úniku`, async () => {
      const src = b64(data);
      expect(Buffer.from(src).toString("latin1")).toContain("/Encrypt");
      // pdf-lib šifrované PDF nepřečte (proto se dřív mohlo zdát „poškozené") …
      await expect(PDFDocument.load(src)).rejects.toThrow(/encrypted/i);
      const res = await anonymizePdf(input(src));
      expect(res.failure).toBeNull();
      expect(res.unsupported).toBeFalsy();
      expect(res.pages).toHaveLength(1);
      // … pdf.js ho dešifruje: pravidla našla firmu i jméno v textové vrstvě
      const cats = new Set(res.pages[0].regions.map((r) => r.category));
      // firma zákazníka z CRM (vlastní termín) i jméno kreslíře
      expect(cats.has("company") || cats.has("custom"), [...cats].join(",")).toBe(true);
      expect(cats.has("person"), [...cats].join(",")).toBe(true);
      const out = res.partPdf!;
      expect(out).toBeTruthy();
      const lat = Buffer.from(out).toString("latin1");
      expect(lat.startsWith("%PDF-")).toBe(true);
      expect(lat).not.toContain("/Encrypt");
      // nešifrovaný výstup: pdf-lib ho otevře bez ignoreEncryption
      const doc = await PDFDocument.load(out);
      expect(doc.isEncrypted).toBe(false);
      expect(doc.getPageCount()).toBe(1);
      const chk = await checkPdfOutput(out, [{ widthPt: res.pages[0].out!.widthPt, heightPt: res.pages[0].out!.heightPt }]);
      expect(chk.problems).toEqual([]);
      expect(F.ENCRYPTED_LEAK.test(grepText(out))).toBe(false);
      // anotace u šifrovaného PDF nejde zploštit (pdf-lib) → poznámka, nikdy selhání
      if (cipher.includes("anotace")) {
        expect(res.warnings.some((w) => w.code === "text_layer_untrusted")).toBe(true);
        // jméno v anotaci (Rect 700–870 × 300–316 b zdola) se smaže i bez zploštění (text z hodnoty anotace);
        // oblasti jsou normované 0..1 od levého horního rohu → y ≈ 0,63 (razítko je níž, y > 0,75)
        const inAnnot = res.pages[0].regions.filter((r) => r.category === "person" && r.y > 0.58 && r.y < 0.66);
        expect(inAnnot.length, JSON.stringify(res.pages[0].regions.map((r) => [r.category, r.x.toFixed(3), r.y.toFixed(3)]))).toBeGreaterThan(0);
        const d = decideAnonStatus({
          mode: "full", method: "raster_pdf", aiUsed: false, modelFallback: false, confidence: 1, ruleHitsCovered: true, outputChecksPassed: true,
          verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false, warnings: res.warnings,
          customerStandard: false, termInKeep: false, titleBlockFound: true,
        });
        // plná automatika (majitel 31. 10.): poznámka v historii, nic ke kontrole
        expect(d.status).toBe("done");
      }
    }, 60_000);
  }
});

describe("poctivé důvody „nelze“", () => {
  it("heslo k OTEVŘENÍ → „zaheslované“ (nelze), nikdy „poškozené“", async () => {
    const res = await anonymizePdf(input(b64(F.USER_AES_128)));
    expect(res.failure).toBe(PDF_PASSWORD_TEXT);
    expect(res.unsupported).toBe(true);
    expect(res.failure).not.toMatch(/poškozené/);
  });
  it("nečitelné PDF (náhodná data, HTML stránka místo PDF) → „není čitelné PDF“ (nelze)", async () => {
    for (const bytes of [new Uint8Array(Buffer.from("<html><body>404</body></html>")), new Uint8Array(4096).map((_, i) => (i * 7919) % 251)]) {
      const res = await anonymizePdf(input(bytes));
      expect(res.failure).toBe(PDF_INVALID_TEXT);
      expect(res.unsupported).toBe(true);
    }
  });
});
