import { NextResponse } from "next/server";
import { aresLookup } from "@/lib/ares";
import { isValidCzIco } from "@/lib/lead";

export async function GET(req: Request) {
  const ico = new URL(req.url).searchParams.get("ico")?.replace(/\s/g, "") ?? "";
  if (!isValidCzIco(ico)) return NextResponse.json({ ok: false, error: "Neplatné IČO." }, { status: 400 });
  const company = await aresLookup(ico);
  if (!company) return NextResponse.json({ ok: false, error: "Firma nenalezena v ARES." }, { status: 404 });
  return NextResponse.json({ ok: true, company }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
}
