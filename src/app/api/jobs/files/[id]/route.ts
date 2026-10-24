import { NextResponse } from "next/server";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isUuid } from "@/lib/jobs/mapping";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Otevření dokumentu zakázky: ověří přístup, vytvoří krátkodobou podepsanou URL
 * (60 s) a přesměruje na ni. ?download=1 = stáhnout pod původním názvem.
 * #25: nákupní doklad bez práva na marže → 403; PDF nabídky čekající na schválení /
 * vystavené před posledním schválením → 409 (super admin smí).
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
