import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Kompletní SQL schéma (všechny migrace v pořadí) — pro krok „Databáze"
 * v průvodci nastavením: zkopírovat a spustit v Supabase SQL editoru.
 */
export async function GET() {
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
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("Migrace nenalezeny.", { status: 404 });
  }
}
