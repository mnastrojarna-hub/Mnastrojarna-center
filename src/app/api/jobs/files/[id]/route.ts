import { NextResponse } from "next/server";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isUuid } from "@/lib/jobs/mapping";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ?view=image (převod TIFF / HEIC) trvá u velkého skenu i desítky sekund
export const maxDuration = 60;

/**
 * Otevření dokumentu zakázky: ověří přístup, vytvoří krátkodobou podepsanou URL
 * (60 s) a přesměruje na ni. ?download=1 = stáhnout pod původním názvem.
 * #25: nákupní doklad bez práva na marže → 403; PDF nabídky čekající na schválení /
 * vystavené před posledním schválením → 409 (super admin smí).
 * ?view=image&page=N = náhled TIFF / HEIC jako PNG / JPEG (strana N, hlavička X-Page-Count) — stejná
 * kontrola přístupu jako originál; prohlížeč v aplikaci tak ukáže i sken TIFF se „Zpět".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequire("orders");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Dokument nenalezen." }, { status: 404 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase není nakonfigurováno." }, { status: 503 });

  try {
    const db = await createOperatorClient();
    const access = await getAccess();
    const checked = await assertJobFileAccess(db, id, access, "view");
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    const file = checked.file;
    if (!file.storage_path) return NextResponse.json({ error: "Dokument nenalezen." }, { status: 404 });

    const url = new URL(req.url);
    if (url.searchParams.get("view") === "image") return await imagePreview(db, file, Number(url.searchParams.get("page") ?? 1));

    const download = url.searchParams.get("download") === "1";
    const { data: signed, error: signErr } = await db.storage
      .from("job-files")
      .createSignedUrl(file.storage_path, 60, download ? { download: file.filename } : undefined);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: signErr?.message ?? "Soubor v úložišti nenalezen." }, { status: 404 });
    }

    const res = NextResponse.redirect(signed.signedUrl as string, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chyba" }, { status: 500 });
  }
}

/** Náhled TIFF / HEIC (už po kontrole přístupu). */
async function imagePreview(
  db: Awaited<ReturnType<typeof createOperatorClient>>,
  file: { storage_path: string | null; filename: string; mime_type: string | null; size_bytes: number | string | null },
  page: number,
): Promise<Response> {
  const { rasterFormatOf, rasterPreview } = await import("@/lib/jobs/raster-preview");
  if (!rasterFormatOf(file.filename, file.mime_type)) {
    return NextResponse.json({ error: "Náhled jako obrázek je jen pro TIFF a HEIC." }, { status: 415 });
  }
  if (Number(file.size_bytes ?? 0) > 80 * 1024 * 1024) {
    return NextResponse.json({ error: "Soubor je na náhled moc velký — stáhni si originál." }, { status: 413 });
  }
  const { data: blob, error } = await db.storage.from("job-files").download(file.storage_path!);
  if (error || !blob) return NextResponse.json({ error: "Soubor v úložišti nenalezen." }, { status: 404 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const format = rasterFormatOf(file.filename, file.mime_type, bytes.subarray(0, 16));
  if (!format) return NextResponse.json({ error: "Soubor není TIFF ani HEIC." }, { status: 415 });
  try {
    const out = await rasterPreview(bytes, format, Number.isFinite(page) ? page : 1);
    return new NextResponse(new Uint8Array(out.body), {
      status: 200,
      headers: {
        "Content-Type": out.contentType,
        "Cache-Control": "private, no-store",
        "X-Page-Count": String(out.pages),
        "X-Page": String(out.page),
        "Access-Control-Expose-Headers": "X-Page-Count, X-Page",
      },
    });
  } catch (err) {
    console.error(`[api:jobs:files:image] ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Náhled se nepodařilo připravit (soubor je poškozený, nebo formát neumím) — stáhni si originál." }, { status: 422 });
  }
}
