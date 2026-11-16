import "server-only";
/**
 * Text přílohy e-mailu pro hledání v Poště (majitel 16. 11.: „hledat i v obsahu příloh").
 * PDF s textovou vrstvou (pdfjs), textové soubory (txt, csv, eml, xml, json, html). Sken bez textu → null
 * (ten pokryje AI čtení dokumentu: job_files.ai_extracted, viz mail_messages). Best-effort, nic neblokuje.
 */
import { openPdf } from "@/lib/anonymize/pdf-node";

const MAX_CHARS = 20_000;
const MAX_PAGES = 15;

function textLike(mime: string, name: string): boolean {
  return /^text\//i.test(mime) || /(json|xml|csv|rfc822)/i.test(mime) || /\.(txt|csv|eml|xml|json|html?|md)$/i.test(name);
}

export async function attachmentText(content: Uint8Array, mime: string | null | undefined, filename: string | null | undefined): Promise<string | null> {
  const m = (mime ?? "").toLowerCase();
  const n = (filename ?? "").toLowerCase();
  try {
    if (textLike(m, n)) {
      const t = new TextDecoder("utf-8", { fatal: false }).decode(content.slice(0, MAX_CHARS * 4));
      return clean(t.replace(/<[^>]+>/g, " "));
    }
    if (m === "application/pdf" || n.endsWith(".pdf")) {
      const pdf = await openPdf(content, { requireFonts: false });
      try {
        const parts: string[] = [];
        let len = 0;
        for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES) && len < MAX_CHARS; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          const s = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
          parts.push(s);
          len += s.length;
        }
        return clean(parts.join("\n"));
      } finally {
        void pdf.destroy?.();
      }
    }
  } catch {
    // poškozená / šifrovaná příloha — bez textu
  }
  return null;
}

function clean(s: string): string | null {
  const t = s.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return t.length >= 3 ? t : null;
}
