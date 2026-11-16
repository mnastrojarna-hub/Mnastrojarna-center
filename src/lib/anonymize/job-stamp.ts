/**
 * Naše číslo zakázky na odesílaném výkresu (majitel 16. 11.: „kdyby to naše číslo zakázky dávala AI i na každý
 * výkres nad hlavičku"). Jen do KOPIE pro dodavatele — uložený originál ani anonymizovaná kopie se nemění.
 *
 * Umístění: pravý dolní roh, nad rohovým razítkem (ISO 7200 — razítko vpravo dole, výška do ~70 mm).
 * Bílý podklad (ať jde číst i přes čáry), malé písmo. Otočené stránky (/Rotate 90/180/270) se přepočítají,
 * aby text stál vždy vodorovně vpravo dole tak, jak se stránka zobrazí.
 * Jen PDF; poškozené / šifrované PDF → beze změny (výkres odejde bez razítka, nic se neblokuje).
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const MM = 72 / 25.4;

/** „Zakázka 2026/026 · pol. 2" — jen znaky, které umí standardní písmo (WinAnsi). */
export function jobStampText(jobNumber: string, position?: number | null): string {
  const base = jobNumber.trim().replace(/^[Zz][-\s]?(\d{4})[-/](\d+)$/, "$1/$2");
  const pos = typeof position === "number" && position > 0 ? ` · pol. ${position}` : "";
  return `Zakázka ${base}${pos}`;
}

/** Umístění textu ve vizuálních souřadnicích → souřadnice stránky + otočení textu. */
export function stampPlacement(
  page: { width: number; height: number; rotation: number },
  box: { w: number; h: number },
): { x: number; y: number; rotate: number } {
  const r = ((Math.round(page.rotation / 90) * 90) % 360 + 360) % 360;
  const W = page.width;
  const H = page.height;
  const vw = r === 90 || r === 270 ? H : W;
  // vpravo 13 mm od okraje (uvnitř rámečku), ~75 mm nad spodním okrajem (nad razítkem); malá stránka → úměrně níž
  const vx = vw - 13 * MM - box.w;
  const vh = r === 90 || r === 270 ? W : H;
  const vy = Math.min(75 * MM, vh * 0.3);
  if (r === 90) return { x: W - vy, y: vx, rotate: 90 };
  if (r === 180) return { x: W - vx, y: H - vy, rotate: 180 };
  if (r === 270) return { x: vy, y: H - vx, rotate: 270 };
  return { x: vx, y: vy, rotate: 0 };
}

export async function stampJobNumber(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  if (!text.trim()) return bytes;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const size = 9;
    const pad = 2.5;
    const tw = font.widthOfTextAtSize(text, size);
    const box = { w: tw + pad * 2, h: size + pad * 2 };
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const rotation = page.getRotation().angle;
      const p = stampPlacement({ width, height, rotation }, box);
      const rot = degrees(p.rotate);
      page.drawRectangle({ x: p.x, y: p.y, width: box.w, height: box.h, color: rgb(1, 1, 1), opacity: 0.9, rotate: rot, borderColor: rgb(0.878, 0.224, 0.188), borderWidth: 0.6 });
      // text uvnitř rámečku (posun o odsazení ve směru otočení)
      const a = (p.rotate * Math.PI) / 180;
      const dx = pad * Math.cos(a) - (pad + 0.6) * Math.sin(a);
      const dy = pad * Math.sin(a) + (pad + 0.6) * Math.cos(a);
      page.drawText(text, { x: p.x + dx, y: p.y + dy, size, font, color: rgb(0.878, 0.224, 0.188), rotate: rot });
    }
    return await doc.save({ useObjectStreams: false });
  } catch (err) {
    console.error(`[job-stamp] Číslo zakázky do výkresu nešlo vložit: ${err instanceof Error ? err.message : String(err)}`);
    return bytes;
  }
}
