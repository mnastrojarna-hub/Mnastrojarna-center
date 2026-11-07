import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";

/**
 * Převod výkresu DXF / DWG zakázky na PDF ↔ lokální Supabase (route POST /api/jobs/files/<id>/pdf):
 *  - DXF s kótami bez čísla v bloku → PDF (druh výkres, stejný základ názvu, vazba source_file_id,
 *    poznámka, původ zdroje) s čísly kót v textu; originál beze změny,
 *  - opakovaný převod = nová verze téhož PDF; hromadný (?skip=1) výkres s PDF přeskočí,
 *  - DWG (LibreDWG v Node) → PDF; název zabraný PDF zákazníka → „(z DWG)",
 *  - jiný soubor → 415, cizí id → 404, anonymizace PDF zařadí jako každý výkres.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/drawing-convert.integration.test.ts
 */

const who = vi.hoisted(() => ({ id: "", role: "super_admin" as string }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/supabase/server", async () => {
  const sb = await import("@supabase/supabase-js");
  const { loadLocalEnv: env } = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const e = env();
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: headers.actorHeaders((opts.actor ?? headers.SYSTEM_ACTOR) as never) },
  });
  return {
    isSupabaseConfigured: () => true, hasServiceKey: () => true, createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts), createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const user = () => ({ id: who.id, role: who.role, active: true, email: "x@local.test", full_name: "Test", aiAccess: true });
  const access = () => ({ user: user(), can: (f: string) => f !== "margins" || who.role === "super_admin", features: ["orders"], ctx: { aiEnabled: true } });
  return {
    getSessionUser: async () => user(),
    getAccess: async () => access(),
    checkFeature: async () => ({ user: user() }),
    apiRequire: async () => ({ user: user() }),
    requireFeature: async () => user(),
  };
});

const STAMP = Date.now().toString(36);
const BUCKET = "job-files";
const DWG = fileURLToPath(new URL("../viewer3d/formats/__fixtures__/dwg-example-r2018.dwg", import.meta.url));

/** DXF s kótou bez bloku a kótou, jejíž blok má jen čáry (číslo chybí) — přesně případ majitele. */
function dimsDxf(): string {
  const g = (...p: (string | number)[]) => { const o: string[] = []; for (let i = 0; i < p.length; i += 2) o.push(String(p[i]), String(p[i + 1])); return o.join("\n"); };
  return [
    g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"),
    g(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 1, 0, "LAYER", 2, "KOTY", 70, 0, 62, 3, 6, "CONTINUOUS", 0, "ENDTAB", 0, "ENDSEC"),
    g(0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 8, "0", 2, "*D1", 70, 1, 10, 0, 20, 0, 30, 0, 3, "*D1",
      0, "LINE", 8, "0", 10, 0, 20, 30, 30, 0, 11, 80, 21, 30, 31, 0, 0, "ENDBLK", 8, "0", 0, "ENDSEC"),
    g(0, "SECTION", 2, "ENTITIES",
      0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 0, 20, 0, 10, 80, 20, 0, 10, 80, 20, 25, 10, 0, 20, 25,
      0, "DIMENSION", 5, "D1", 8, "KOTY", 2, "*D1", 10, 80, 20, 30, 30, 0, 11, 40, 21, 32, 31, 0, 70, 32, 42, 80, 13, 0, 23, 0, 33, 0, 14, 80, 24, 0, 34, 0,
      0, "DIMENSION", 5, "D2", 8, "KOTY", 10, 90, 20, 25, 30, 0, 11, 92, 21, 12.5, 31, 0, 70, 0, 50, 90, 13, 80, 23, 0, 33, 0, 14, 80, 24, 25, 34, 0,
      0, "TEXT", 8, "0", 10, 0, 20, -10, 30, 0, 40, 3.5, 1, "DESKA — materiál S235JR",
      0, "ENDSEC", 0, "EOF"),
  ].join("\n");
}

async function pdfTextOf(bytes: Uint8Array): Promise<string> {
  const { openPdf } = await import("@/lib/anonymize/pdf-node");
  const doc = await openPdf(bytes);
  try {
    const c = await (await doc.getPage(1)).getTextContent();
    return c.items.map((i) => ("str" in i ? i.str : "")).join("\n");
  } finally {
    await doc.destroy();
  }
}

describe.skipIf(!LOCAL_ENABLED)("výkres DXF / DWG → PDF (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let jobId = "";
  let route: typeof import("@/app/api/jobs/files/[id]/pdf/route");
  const paths: string[] = [];

  async function addFile(filename: string, bytes: Uint8Array, mime: string, kind = "vykres"): Promise<string> {
    const path = `zakazky/${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
    const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: mime });
    if (up.error) throw new Error(up.error.message);
    paths.push(path);
    const { data, error } = await svc.from("job_files").insert({
      job_id: jobId, kind, filename, mime_type: mime, size_bytes: bytes.length, storage_path: path, version: 1, archived: false,
      uploaded_by: who.id, origin: "email", issuer: "zakaznik",
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  const post = async (id: string, skip = false) => {
    const res = await route.POST(new Request(`http://localhost/api/jobs/files/${id}/pdf${skip ? "?skip=1" : ""}`, { method: "POST" }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as { skipped?: boolean; file?: { id: string; filename: string; version: number }; error?: string; sheet?: string } };
  };

  const row = async (id: string) => {
    const { data } = await svc.from("job_files").select("*").eq("id", id).single();
    return data as Record<string, unknown>;
  };

  const download = async (storagePath: string) => {
    const { data, error } = await svc.storage.from(BUCKET).download(storagePath);
    if (error || !data) throw new Error(error?.message ?? "download");
    return new Uint8Array(await data.arrayBuffer());
  };

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = localAdmin();
    who.id = await profileId(svc, DEMO.sales.email);
    who.role = "obchodnik";
    const { data: j, error } = await svc.from("orders").insert({ number: `Z-E2E-DXFPDF-${STAMP}`, title: "E2E výkres → PDF", source: "manual", status: "poptavka", owner_id: who.id }).select("id").single();
    if (error) throw new Error(error.message);
    jobId = (j as { id: string }).id;
    route = await import("@/app/api/jobs/files/[id]/pdf/route");
  }, 120_000);

  afterAll(async () => {
    if (!jobId) return;
    const { data } = await svc.from("job_files").select("storage_path").eq("job_id", jobId);
    const all = [...paths, ...((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path)];
    if (all.length) await svc.storage.from(BUCKET).remove([...new Set(all)]);
    localSql(`delete from orders where id = '${jobId}'`);
  });

  it("DXF → PDF: nový výkres s čísly kót, vazba na zdroj, původ zdroje, nová verze, hromadně přeskočí", async () => {
    const srcBytes = new TextEncoder().encode(dimsDxf());
    const src = await addFile("DESKA-80x25.dxf", srcBytes, "application/dxf");
    const r1 = await post(src);
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.skipped).toBe(false);
    expect(r1.body.file!.filename).toBe("DESKA-80x25.pdf");
    expect(r1.body.sheet).toBe("A4 na šířku");
    const pdf = await row(r1.body.file!.id);
    expect(pdf).toMatchObject({
      job_id: jobId, kind: "vykres", mime_type: "application/pdf", version: 1, archived: false, source_file_id: src,
      note: "Převedeno z DESKA-80x25.dxf", origin: "email", issuer: "zakaznik",
    });
    // anonymizace: PDF výkresu je kandidát (stav určil DB trigger, ne „netýká se")
    expect(pdf.anon_status).not.toBeNull();
    const bytes = await download(String(pdf.storage_path));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const text = await pdfTextOf(bytes);
    for (const s of ["80", "25", "DESKA — materiál S235JR", "DESKA-80x25.dxf"]) expect(text, s).toContain(s);
    // originál beze změny
    expect(await download(String((await row(src)).storage_path))).toEqual(srcBytes);
    // historie
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", jobId).ilike("message", "Výkres převeden do PDF%");
    expect((ev ?? []).length).toBe(1);

    // znovu → nová verze téhož PDF
    const r2 = await post(src);
    expect(r2.status).toBe(200);
    expect(r2.body.file).toMatchObject({ filename: "DESKA-80x25.pdf", version: 2 });
    expect(await row(r1.body.file!.id)).toMatchObject({ archived: true, replaced_by: r2.body.file!.id });
    // hromadně → přeskočit
    const r3 = await post(src, true);
    expect(r3.body).toMatchObject({ skipped: true, file: { id: r2.body.file!.id } });
  }, 60_000);

  it("DWG → PDF v Node (LibreDWG); název zabraný PDF zákazníka → „(z DWG)“", async () => {
    await addFile("EXAMPLE.pdf", new Uint8Array(await (await PDFDocument.create()).save()), "application/pdf");
    const src = await addFile("EXAMPLE.dwg", new Uint8Array(readFileSync(DWG)), "application/acad");
    const r = await post(src, true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.file!.filename).toBe("EXAMPLE (z DWG).pdf");
    const text = await pdfTextOf(await download(String((await row(r.body.file!.id)).storage_path)));
    for (const s of ["1504,68", "108°", "277,87"]) expect(text, s).toContain(s);
  }, 90_000);

  it("jiný soubor → 415, neexistující → 404, poškozený DXF → 422 se srozumitelnou chybou", async () => {
    const txt = await addFile("poznamka.txt", new TextEncoder().encode("ahoj"), "text/plain", "ostatni");
    expect((await post(txt)).status).toBe(415);
    expect((await post(randomUUID())).status).toBe(404);
    const bad = await addFile("ROZBITY.dxf", new TextEncoder().encode("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"), "application/dxf");
    const r = await post(bad);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/prázdný/);
  }, 30_000);
});
