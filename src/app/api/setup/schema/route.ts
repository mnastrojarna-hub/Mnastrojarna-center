import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { hasServiceKey } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Kompletní SQL schéma (všechny migrace v pořadí) — pro krok „Databáze"
 * v průvodci nastavením: zkopírovat a spustit v Supabase SQL editoru.
 * #25: jen dokud aplikace nemá servisní klíč (první nastavení), potom jen super adminovi
 * (schéma popisuje i pravidla oprávnění — nepatří každému přihlášenému ani anonymům).
 */
export async function GET() {
  if (hasServiceKey()) {
    const user = await getSessionUser().catch(() => null);
    if (!user || !user.active || user.role !== "super_admin") {
      return new NextResponse("Schéma databáze vidí jen super admin.", {
        status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
      });
    }
  }
  const dir = path.join(process.cwd(), "supabase", "migrations");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const sql = files
      .map((f) => `-- ═══════════ ${f} ═══════════\n${fs.readFileSync(path.join(dir, f), "utf8")}`)
      .join("\n\n");
    return new NextResponse(sql, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  } catch {
    return new NextResponse("Migrace nenalezeny.", { status: 404 });
  }
}
