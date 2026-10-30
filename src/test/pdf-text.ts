import { openPdf } from "@/lib/anonymize/pdf-node";

/**
 * Jen pro testy: text všech stran PDF (pdf.js, ToUnicode písem) — to, co z dokladu přečte i zákazník
 * kopírováním. `squash` zahodí mezery (písmena s letterSpacing jdou z PDF po jednom).
 */
export async function pdfText(data: Uint8Array | Buffer | ArrayBuffer): Promise<string> {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  const pdf = await openPdf(bytes, { requireFonts: false });
  try {
    let out = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      for (const it of tc.items as { str?: string }[]) out += it.str ?? "";
    }
    return out;
  } finally {
    await pdf.destroy();
  }
}

/** Bez mezer (i nezlomitelných) — pro porovnání textu z PDF. */
export function squash(s: string): string {
  return s.replace(/[\s  ]+/g, "");
}
