import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import { makeVectorDrawing } from "./__fixtures__/samples";
import { HEIC_SAMPLE_B64 } from "./__fixtures__/heic-sample";

/**
 * „Vždycky tam musí být anonymizace" ↔ lokální Supabase (migrace 20261030140000, testovací AI AI_FAKE_ANON):
 * SQL zrcadlo kandidáta a návodu, ZIP a e-mail .eml se rozbalí do souborů zakázky (zpracují se ve stejném
 * běhu, opakování nic nezdvojí), HEIC z iPhonu, STL, IGES, binární DXF, Word / DWG „nelze automaticky"
 * s návodem a originál k dodavateli jen super admin.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/formats.integration.test.ts
 * Vlastní data: zakázky Z-E2E-FMT-*, zákazník „E2E-FMT …"; vše se po sobě uklidí.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/email/send", () => ({ sendMail: vi.fn(async () => ({ sent: true })) }));
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

const STAMP = Date.now().toString(36);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe.skipIf(!LOCAL_ENABLED)("anonymizace — všechny formáty ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let salesId = "";
  let jobId = "";
  let customerId = "";
  const prevFake = process.env.AI_FAKE_ANON;
  let runner: typeof import("./runner");
  let share: typeof import("./share");
  let pdf: Uint8Array;

  async function addFile(filename: string, bytes: Uint8Array, mime: string | null, patch: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const p = `zakazky/${jobId}/${randomUUID()}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const up = await svc.storage.from("job-files").upload(p, bytes, { contentType: mime ?? "application/octet-stream", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await localAdmin(userActor({ id: salesId })).from("job_files").insert({
      job_id: jobId, kind: "vykres", filename, mime_type: mime, size_bytes: bytes.length, storage_path: p, origin: "email", issuer: "zakaznik",
      uploaded_by: salesId, content_sha256: sha(bytes), ...patch,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  const row = async (id: string) => ((await svc.from("job_files").select("*").eq("id", id).single()).data as Record<string, unknown>);
  async function runQueue(ids: string[]) {
    const o = await runner.processQueue({ ids, fanOut: false, deadline: Date.now() + 240_000, maxFiles: 30 });
    return o;
  }
  async function output(r: Record<string, unknown>): Promise<Uint8Array> {
    const { data } = await svc.storage.from("job-files").download(String(r.anon_path));
    return new Uint8Array(await data!.arrayBuffer());
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fmt-"));
    svc = localAdmin();
    salesId = await profileId(svc, DEMO.sales.email);
    runner = await import("./runner");
    share = await import("./share");
    pdf = (await makeVectorDrawing({ company: "Strojmetal a.s." })).pdf;
    localSql("update automation_settings set mode = 'full', enabled = true where module = 'drawing_anonymize'");
    const { data: c, error: ce } = await svc.from("customers").insert({ name: `E2E-FMT ${STAMP} Strojmetal a.s.`, email: "jan.dvorak@strojmetal.cz", contact_person: "Ing. Jan Dvořák" }).select("id").single();
    if (ce) throw new Error(ce.message);
    customerId = (c as { id: string }).id;
    const { data: j, error } = await svc.from("orders").insert({ number: `Z-E2E-FMT-${STAMP}`, title: "E2E formáty", source: "manual", status: "poptavka", customer_id: customerId }).select("id").single();
    if (error) throw new Error(error.message);
    jobId = (j as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    if (prevFake === undefined) delete process.env.AI_FAKE_ANON; else process.env.AI_FAKE_ANON = prevFake;
    if (!svc || !jobId) return;
    const { data: f } = await svc.from("job_files").select("id, storage_path, anon_path").eq("job_id", jobId);
    const rows = (f ?? []) as { id: string; storage_path: string; anon_path: string | null }[];
    const paths = rows.flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x));
    for (let i = 0; i < paths.length; i += 100) await svc.storage.from("job-files").remove(paths.slice(i, i + 100));
    for (const r of rows) await svc.from("drawing_anon_usage_log").delete().eq("subject_id", r.id);
    await svc.from("orders").delete().eq("id", jobId);
    await svc.from("customers").delete().eq("id", customerId);
  }, 120_000);

  it("SQL zrcadlo: kandidát a návod „nelze automaticky“ = TS", async () => {
    const { isAnonCandidate, unsupportedHowTo } = await import("./candidate");
    const cases: [string, string, string | null, string | null, string | null][] = [
      ["ostatni", "a.docx", null, "upload", null], ["ostatni", "a.zip", "application/zip", "email", "zakaznik"], ["korespondence", "a.eml", null, "upload", null],
      ["korespondence", "a.msg", null, "email", "dodavatel"], ["model_3d", "a.stl", null, "upload", null], ["vykres", "a.IGS", null, "upload", null],
      ["foto", "a.gif", "image/gif", "capture", null], ["ostatni", "a.txt", "text/plain", "upload", null], ["faktura", "a.xlsx", null, "email", null],
      ["vykres", "a.svg", null, "upload", "my"], ["korespondence", "a.pdf", null, "upload", null],
    ];
    for (const c of cases) {
      const { data, error } = await svc.rpc("anon_is_candidate", { p_kind: c[0], p_filename: c[1], p_mime: c[2], p_origin: c[3], p_issuer: c[4] });
      expect(error).toBeNull();
      expect(data, c.join(" ")).toBe(isAnonCandidate(...c));
    }
    for (const f of ["x.dwg", "x.DWF", "x.sldprt", "x.slddrw", "x.3mf", "x.docx", "x.xlsx", "x.pptx", "x.rar", "x.msg", "x.bmp", "x.svg", "x.weird"]) {
      const { data } = await svc.rpc("anon_unsupported_reason", { p_filename: f });
      expect(data, f).toBe(unsupportedHowTo(f));
    }
  });

  it("trigger: Word / DWG hned „nelze automaticky“ s návodem, e-mail .eml a ZIP do fronty", async () => {
    const docx = await addFile("poptavka.docx", strToU8("PK"), null, { kind: "poptavka" });
    expect(docx.anon_status).toBe("unsupported");
    expect(String(docx.anon_reason)).toMatch(/^Nelze anonymizovat automaticky \(dokument Word\)/);
    const dwg = await addFile("sestava.dwg", new Uint8Array([0x41, 0x43, 0x31, 0x30]), null);
    expect(String(dwg.anon_reason)).toMatch(/\(DWG\).*DXF/);
    // DWG k dodavateli: výchozí blok, originál jen super admin
    expect(share.pickShareFile(dwg as never)).toMatchObject({ ok: false, reason: "unsupported" });
    expect(share.pickShareFile(dwg as never, { original: true })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(share.pickShareFile(dwg as never, { original: true, isSuperAdmin: true })).toMatchObject({ ok: true, source: "original", audit: true });
    const coll = await share.collectSupplierAttachments(svc as never, [dwg.id as string]);
    expect(coll.ready).toEqual([]);
    expect(coll.blocked[0]?.message).toMatch(/DWG/);
  });

  it("ZIP: rozbalí se do souborů zakázky, ty se anonymizují ve stejném běhu; DWG uvnitř „nelze“; opakování nic nezdvojí", async () => {
    const step = strToU8("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('D-1.stp','2026-10-29',('Jan Dvorak'),('Strojmetal a.s.'),'x','y','');\nFILE_SCHEMA(('AP214'));\nENDSEC;\nDATA;\n#1=PRODUCT('D-1','Strojmetal hridel','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n");
    const zip = zipSync({ "Strojmetal/D-1.pdf": pdf, "Strojmetal/D-1.step": step, "Strojmetal/D-1.dwg": new Uint8Array([0x41, 0x43, 1, 2]), "__MACOSX/._D-1.pdf": new Uint8Array([1]) });
    const z = await addFile("vykresy-strojmetal.zip", zip, "application/zip", { kind: "ostatni" });
    expect(z.anon_status).toBe("pending");
    const o = await runQueue([z.id as string]);
    const parent = o.results.find((r) => r.id === z.id)!;
    expect(parent.status).toBe("unsupported");
    expect(parent.reason).toMatch(/^Rozbaleno do 3 souborů/);
    expect(parent.spawned).toHaveLength(3);
    // děti zpracované v tomtéž běhu
    const kids = await Promise.all(parent.spawned!.map(row));
    const by = (n: string) => kids.find((k) => String(k.filename).endsWith(n))!;
    expect(by(".pdf").anon_status).toMatch(/^(done|review)$/);
    expect(by(".step").anon_status).toBe("done");
    expect(by(".dwg").anon_status).toBe("unsupported");
    for (const k of kids) {
      expect(k.origin).toBe("email");
      expect(k.issuer).toBe("zakaznik");
      expect(String(k.note)).toContain("vykresy-strojmetal.zip");
    }
    expect(latin(await output(by(".step")))).not.toMatch(/strojmetal|dvorak/i);
    // archiv sám nikdy k dodavateli
    expect(share.pickShareFile((await row(z.id as string)) as never)).toMatchObject({ ok: false, reason: "unsupported" });
    // nové spuštění (Anonymizovat znovu) → stejné soubory, žádné duplicity
    await svc.from("job_files").update({ anon_status: "pending", anon_attempts: 0 }).eq("id", z.id as string);
    const o2 = await runQueue([z.id as string]);
    expect(o2.results.find((r) => r.id === z.id)!.spawned!.sort()).toEqual([...parent.spawned!].sort());
    const { count } = await svc.from("job_files").select("id", { count: "exact", head: true }).eq("job_id", jobId).ilike("note", "%vykresy-strojmetal.zip%");
    expect(count).toBe(3);
  }, 240_000);

  it("e-mail .eml zákazníka: přílohy jako soubory zakázky, vložené logo z podpisu ne", async () => {
    const boundary = "b1";
    const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/.{76}/g, "$&\r\n");
    const eml = [
      "From: Ing. Jan Dvořák <jan.dvorak@strojmetal.cz>", "To: info@mnastrojarna.cz", "Subject: Poptavka", "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", "Dobry den, posilam vykres.", "",
      `--${boundary}`, "Content-Type: image/png", "Content-Disposition: inline", "Content-ID: <logo>", "Content-Transfer-Encoding: base64", "", b64(new Uint8Array(200).fill(7)), "",
      `--${boundary}`, "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="D-2.pdf"', "Content-Transfer-Encoding: base64", "", b64(pdf), "",
      `--${boundary}--`, "",
    ].join("\r\n");
    const e = await addFile("poptavka.eml", strToU8(eml), "message/rfc822", { kind: "korespondence" });
    expect(e.anon_status).toBe("pending");
    const o = await runQueue([e.id as string]);
    const parent = o.results.find((r) => r.id === e.id)!;
    expect(parent.reason).toMatch(/^Rozbaleno do 1 souboru/);
    const kid = await row(parent.spawned![0]);
    expect(kid.filename).toBe("D-2.pdf");
    expect(kid.anon_status).toMatch(/^(done|review)$/);
  }, 240_000);

  it("HEIC z iPhonu: dekóduje se na serveru, výstup JPEG bez EXIF / GPS; STL a IGES bez jmen; binární DXF projde", async () => {
    const heic = await addFile("IMG_0042.HEIC", new Uint8Array(Buffer.from(HEIC_SAMPLE_B64, "base64")), "image/heic", { kind: "foto" });
    const stl = await addFile("Strojmetal_D-1.stl", strToU8("solid Strojmetal_D-1_JDvorak\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid Strojmetal_D-1_JDvorak\n"), "model/stl", { kind: "model_3d" });
    const line = (d: string, s: string, n: number) => `${d.padEnd(72).slice(0, 72)}${s}${String(n).padStart(7)}`;
    const iges = [line("Strojmetal a.s. - Jan Dvorak", "S", 1), line("1H,,1H;,4HD-1 ,7HD-1.igs,2HSW,2HSW,32,38,6,308,15,3HD-1,1.,2,2HMM,1,", "G", 1),
      line("0.01,13H20261029.1012,1E-06,500.,10HJan Dvorak,15HStrojmetal a.s.,11,0;", "G", 2),
      line("     116       1       0       0       0       0       0       000000000", "D", 1), line("     116       0       0       1       0                               0", "D", 2),
      `${"116,0.,0.,0.,0,0,0;".padEnd(64)}${"1".padStart(8)}P${"1".padStart(7)}`, line("S      1G      2D      2P      1", "T", 1)].join("\n") + "\n";
    const igs = await addFile("D-1.igs", strToU8(iges), null, { kind: "model_3d" });
    const binDxf = new Uint8Array([...strToU8("AutoCAD Binary DXF\r\n\x1a\0"), 0, 0, ...strToU8("SECTION"), 0, 2, 0, ...strToU8("ENTITIES"), 0,
      0, 0, ...strToU8("TEXT"), 0, 1, 0, ...strToU8("Strojmetal a.s."), 0, 0, 0, ...strToU8("ENDSEC"), 0, 0, 0, ...strToU8("EOF"), 0]);
    const dxf = await addFile("D-1.dxf", binDxf, null);
    await runQueue([heic.id, stl.id, igs.id, dxf.id] as string[]);

    const h = await row(heic.id as string);
    expect(h.anon_status, String(h.anon_reason)).toBe("review"); // testovací AI nic nenašla → ke kontrole, ne „hotovo"
    expect(h.anon_mime).toBe("image/jpeg");
    const sharp = (await import("sharp")).default;
    const hb = await output(h);
    const m = await sharp(Buffer.from(hb)).metadata();
    expect([m.width, m.height, m.exif, m.xmp]).toEqual([320, 240, undefined, undefined]);
    expect(latin(hb)).not.toMatch(/Dvorak/);

    const s = await row(stl.id as string);
    expect(s.anon_status).toBe("done");
    expect(s.anon_method).toBe("stl");
    expect(latin(await output(s))).not.toMatch(/strojmetal|dvorak/i);
    expect(String(s.anon_filename)).not.toMatch(/strojmetal/i);

    const g = await row(igs.id as string);
    expect(g.anon_status).toBe("done");
    expect(g.anon_method).toBe("iges");
    expect(latin(await output(g))).not.toMatch(/strojmetal|dvorak/i);

    const d = await row(dxf.id as string);
    expect(d.anon_status).toBe("review");
    expect(latin(await output(d))).not.toMatch(/strojmetal/i);
  }, 240_000);

  it("jednorázové zařazení po migraci proběhlo (značka)", () => {
    expect(localSql("select value from integration_settings where key = 'drawing_anon_formats_v2'")).toBe("done");
  });
});
