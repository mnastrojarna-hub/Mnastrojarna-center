import { NextResponse } from "next/server";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { cronActor, userActor } from "@/lib/supabase/actor-headers";
import { appOrigin, defaultDeadline, internalRunAuth, runClaimed, type AnonDb } from "@/lib/anonymize/service";
import { processInBackground } from "@/lib/anonymize/runner";
import { idList, tableParam } from "@/lib/anonymize/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authError(status: 200 | 401 | 503): NextResponse | null {
  if (status === 503) return NextResponse.json({ error: "Chybí CRON_SECRET i SUPABASE_SECRET_KEY." }, { status: 503 });
  if (status === 401) return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  if (!hasServiceKey()) return NextResponse.json({ error: "Chybí SUPABASE_SECRET_KEY." }, { status: 503 });
  return null;
}

/** Kontrola dosažitelnosti interního běhu (Nastavení): stejné ověření, nic nezpracuje. */
export async function GET(req: Request) {
  const err = authError(internalRunAuth(req.headers.get("authorization")));
  if (err) return err;
  return NextResponse.json({ ok: true, probe: true }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Interní běh anonymizace JEDNOHO souboru (rozvětvení z kick): claim + zpracování, potom po odpovědi
 * (after()) pokračuje PŘÍMO dalšími soubory z fronty až do termínu funkce (bez dalšího HTTP volání —
 * fronta se protáhne, i když rozvětvení na chráněné adrese nefunguje). Chráněno internalRunSecret
 * (CRON_SECRET, jinak HMAC ze SUPABASE_SECRET_KEY; cesta /api/cron je bez session).
 * Tělo: { table, ids: [id], manualBy? }.
 */
export async function POST(req: Request) {
  // CRON_SECRET, nebo (bez něj) tajemství odvozené ze SUPABASE_SECRET_KEY — viz internalRunSecret
  const err = authError(internalRunAuth(req.headers.get("authorization")));
  if (err) return err;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // prázdné tělo = vezmi z fronty
  }
  const table = tableParam(body.table);
  const ids = idList(body.ids, 1);
  const manualBy = typeof body.manualBy === "string" && /^[0-9a-f-]{36}$/i.test(body.manualBy) ? body.manualBy : null;
  const actor = manualBy ? userActor({ id: manualBy }, "rucne") : cronActor("drawing-anon");
  const db = createAdminClient({ actor }) as AnonDb;
  const start = Date.now();
  const deadline = defaultDeadline(start);
  try {
    const results = await runClaimed(db, table, ids.length ? ids : null, { actor, deadline, manual: Boolean(manualBy) }, 1);
    // další z fronty (stejná tabulka, i staré výkresy — denní limit hlídá služba) — jen když se něco zpracovalo
    if (results.some((r) => r.reason !== "budget")) {
      processInBackground({
        table, actor: cronActor("drawing-anon"), deadline, maxFiles: 10, includeBackfill: true, fanOut: false,
        origin: appOrigin(req.url), label: "pokračování fronty",
      });
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Chyba" }, { status: 500 });
  }
}
