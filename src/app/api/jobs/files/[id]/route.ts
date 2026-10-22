import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isUuid } from "@/lib/jobs/mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Otevření dokumentu zakázky: ověří přístup, vytvoří krátkodobou podepsanou URL
 * (60 s) a přesměruje na ni. ?download=1 = stáhnout pod původním názvem.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequire("orders");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Dokument nenalezen." }, { status: 404 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase není nakonfigurováno." }, { status: 503 });

  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("job_files")
      .select("id, storage_path, filename")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const file = data as { id: string; storage_path: string | null; filename: string } | null;
    if (!file?.storage_path) return NextResponse.json({ error: "Dokument nenalezen." }, { status: 404 });

    const download = new URL(req.url).searchParams.get("download") === "1";
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
