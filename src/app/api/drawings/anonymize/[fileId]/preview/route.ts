import { NextResponse } from "next/server";
import { anonGuard, json, loadSubject, tableParam } from "@/lib/anonymize/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIDE = 2400;

/**
 * Serverový náhled ORIGINÁLU pro editor (žádný pdf.js v prohlížeči): PNG ≤ 2400 px.
 * ?page=n (PDF), ?box=x,y,w,h (normalizovaný výřez v plném rozlišení, např. razítko).
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const url = new URL(req.url);
  const table = tableParam(url.searchParams.get("table"));
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, table, fileId, "view");
  if (loaded instanceof Response) return loaded;
  const r = loaded.row;
  const path = String(r.anon_source_path ?? r.storage_path ?? "");
  if (!path) return json({ error: "Soubor nenalezen." }, 404);
  const bucket = table === "drawings" ? "documents" : "job-files";
  const { data: blob, error } = await guard.db.storage.from(bucket).download(path);
  if (error || !blob) return json({ error: "Soubor se nepodařilo načíst." }, 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const boxParam = (url.searchParams.get("box") ?? "").split(",").map(Number);
  const box = boxParam.length === 4 && boxParam.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && boxParam[2] > 0 && boxParam[3] > 0
    ? { x: boxParam[0], y: boxParam[1], w: Math.min(boxParam[2], 1 - boxParam[0]), h: Math.min(boxParam[3], 1 - boxParam[1]) } : null;
  try {
    const sharp = (await import("sharp")).default;
    const { sourceFormat } = await import("@/lib/anonymize/candidate");
    const fmt = sourceFormat(path, null, bytes.subarray(0, 16));
    let png: Buffer;
    if (fmt === "pdf") {
      const { openPdf } = await import("@/lib/anonymize/pdf-node");
      const { renderPageRaster, rawSharp } = await import("@/lib/anonymize/pdf-raster");
      const pdf = await openPdf(bytes);
      try {
        if (page > pdf.numPages) return json({ error: "Stránka neexistuje." }, 404);
        const p = await pdf.getPage(page);
        const vp = p.getViewport({ scale: 1 });
        const target = box ? MAX_SIDE / Math.max(vp.width * box.w, vp.height * box.h) : MAX_SIDE / Math.max(vp.width, vp.height);
        const scale = Math.min(target, Math.sqrt(40e6 / (vp.width * vp.height)));
        const raster = await renderPageRaster(p, scale, true);
        let img = rawSharp(sharp, raster);
        if (box) img = img.extract({ left: Math.floor(box.x * raster.width), top: Math.floor(box.y * raster.height), width: Math.max(1, Math.floor(box.w * raster.width)), height: Math.max(1, Math.floor(box.h * raster.height)) });
        png = await img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      } finally {
        await pdf.destroy();
      }
    } else if (fmt === "image" || fmt === "tiff") {
      let img = sharp(Buffer.from(bytes), { limitInputPixels: 60e6, ...(fmt === "tiff" ? { page: page - 1 } : {}) }).rotate();
      if (box) {
        const meta = await sharp(await img.toBuffer()).metadata();
        const W = meta.width ?? 1, H = meta.height ?? 1;
        img = sharp(await img.toBuffer()).extract({ left: Math.floor(box.x * W), top: Math.floor(box.y * H), width: Math.max(1, Math.floor(box.w * W)), height: Math.max(1, Math.floor(box.h * H)) });
      }
      png = await img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } else {
      return json({ error: "Náhled pro tento formát není k dispozici." }, 415);
    }
    return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Náhled se nepodařilo vytvořit." }, 500);
  }
}
