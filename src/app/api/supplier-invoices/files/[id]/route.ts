import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { isUuid } from "@/lib/jobs/mapping";
import { invoiceSession } from "@/lib/data/supplier-invoices";
import { SUPPLIER_INVOICE_BUCKET } from "@/lib/supplier-invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Soubor faktury dodavatele: jen kdo faktury vidí i s částkami (zatím super admin) → krátkodobá podepsaná URL (60 s)
 * vytvořená až po kontrole. ?download=1 = stáhnout pod původním názvem. Ostatní 403 (ani existenci nepotvrdí).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequire("supplier_invoices");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Soubor nenalezen." }, { status: 404 });
  const s = await invoiceSession();
  // soubor faktury nese částky → jen kdo vidí částky (zaměstnanec ani v režimu „všichni vidí"; stejně jako storage RLS)
  if (!s || !s.perms.amounts) return NextResponse.json({ error: "Bez oprávnění." }, { status: 403 });
  try {
    const { data } = await s.db.from("supplier_invoice_files").select("storage_path, filename").eq("id", id).maybeSingle();
    const f = data as { storage_path: string; filename: string } | null;
    if (!f) return NextResponse.json({ error: "Soubor nenalezen." }, { status: 404 });
    const download = new URL(req.url).searchParams.get("download") === "1";
    const { data: signed, error } = await s.db.storage.from(SUPPLIER_INVOICE_BUCKET)
      .createSignedUrl(f.storage_path, 60, download ? { download: f.filename } : undefined);
    if (error || !signed?.signedUrl) return NextResponse.json({ error: "Soubor v úložišti nenalezen." }, { status: 404 });
    const res = NextResponse.redirect(signed.signedUrl as string, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chyba" }, { status: 500 });
  }
}
