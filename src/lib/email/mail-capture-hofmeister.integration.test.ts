import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin } from "@/test/local-supabase";
import type { BatchApplyState, BatchReviewModel, BatchSortModel, DocApplyState } from "@/lib/jobs/capture-batch-types";
import { batchSaveProblem, relinkGroupDocs, savedDocIds, warningResolved, withAck } from "@/components/jobs/capture/capture-flow";
import { switchTarget } from "@/lib/jobs/capture-review";

/**
 * Majitel 9. 11. (HOFMEISTER s.r.o., Petr Fous): Pošta → „Založit zakázku" u poptávky s textem
 * „A290-7904-Y832 — 8 ks, A290-7904-Y823 — 4 ks, materiál POM" a dvěma výkresy (PET100 na výkresu, razítko
 * špatně čitelné). Dřív „Uložit vše (1)": výkres Y832 byl už u starší zakázky (výchozí cíl), cíl se přepnul
 * na novou a vazba výkresu zůstala na položce staré zakázky → „Vybraná položka nepatří k zakázce", uložil
 * se jen jeden. Teď: obě položky a oba výkresy jedním uložením, rozhodnutí přímo u upozornění, oprava po
 * částečném uložení. Fixtures: batch/mail-hofmeister.json, batch/vykres-gh1a/b/c.json.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-capture-hofmeister.integration.test.ts
 */

const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const Y832 = "A290-7904-Y832";
const Y823 = "A290-7904-Y823";
const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createOperatorClient: async (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const ctx = () => ({ aiEnabled: true, aiCaptureForAll: false, aiConfigured: false });
  const access = () => ({
    user: h.user, ctx: ctx(), features: perms.allowedFeatures(h.user as never, ctx()),
    can: (f: string) => perms.can(h.user as never, f as never, ctx()),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx()) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

/** Vektorové PDF (výkres) — seed = jiný obsah. */
async function vectorPdf(seed: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.setProducer("SOLIDWORKS 2024");
  d.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  d.setModificationDate(new Date(Date.UTC(2026, 0, 1)));
  d.addPage([842 + seed, 595]);
  return Buffer.from(await d.save());
}

const BODY = `Dobrý den,\nprosím o cenovou nabídku:\n${Y832} — 8 ks\n${Y823} — 4 ks\nmateriál POM\n\nS pozdravem\nPetr Fous\nHOFMEISTER s.r.o.\n__mail-hofmeister`;

describe.skipIf(!LOCAL_ENABLED)("Pošta → zakázka: HOFMEISTER (2 výkresy, 2 položky, výkres u starší zakázky)", () => {
  let svc: SupabaseClient;
  let s: typeof import("@/lib/jobs/capture-service");
  let b: typeof import("@/lib/jobs/capture-batch-service");
  let admin: Record<string, unknown>;
  let customerId = "";
  let DOM = "";
  const RUN = Date.now().toString(36);
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const emailIds: string[] = [];
  const storagePaths: string[] = [];
  const captureIds = new Set<string>();
  let seq = 0;

  /** Úklid: zakázky a zákazníci testů HOFMEISTER (all = i z dřívějších běhů), výkresy A290-7904-* z archivu. */
  async function cleanup(all: boolean) {
    const { data: custs } = await svc.from("customers").select("id").like("email", all ? "%@hofmeister-%.test" : `%@hofmeister-${RUN}-%`);
    const custIds = ((custs ?? []) as { id: string }[]).map((c) => c.id);
    if (custIds.length) {
      const { data: jobs } = await svc.from("orders").select("id").in("customer_id", custIds);
      const ids = ((jobs ?? []) as { id: string }[]).map((j) => j.id);
      if (ids.length) {
        const { data: f } = await svc.from("job_files").select("storage_path").in("job_id", ids);
        const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
        for (let i = 0; i < paths.length; i += 100) await svc.storage.from("job-files").remove(paths.slice(i, i + 100));
        await svc.from("emails").update({ order_id: null }).in("order_id", ids);
        await svc.from("job_mail_changes").delete().in("job_id", ids);
        await svc.from("drawings").delete().in("job_id", ids);
        await svc.from("orders").delete().in("id", ids);
      }
      await svc.from("drawings").delete().in("customer_id", custIds);
      await svc.from("customer_contacts").delete().in("customer_id", custIds);
      await svc.from("customers").delete().in("id", custIds);
    }
    await svc.from("drawings").delete().like("drawing_number", "A290-7904-%");
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    delete process.env.ANTHROPIC_API_KEY;
    svc = localAdmin();
    const { data: p } = await svc.from("profiles").select("id, email").eq("email", "admin@local.test").single();
    const prof = p as { id: string; email: string };
    admin = { id: prof.id, email: prof.email, fullName: "Admin", role: "super_admin", initials: "AD", roleLabel: "Super admin", aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
    h.user = admin;
    await cleanup(true);
    s = await import("@/lib/jobs/capture-service");
    b = await import("@/lib/jobs/capture-batch-service");
  }, 60_000);

  // každý test = vlastní zákazník (odesílatel), ať zakázky jiného testu nejsou „stejný zákazník a výkres"
  beforeEach(async () => {
    DOM = `hofmeister-${RUN}-${seq}.test`;
    const { data: c, error } = await svc.from("customers").insert({ name: `HOFMEISTER ${RUN}-${seq} s.r.o.`, email: `nakup@${DOM}`, owner_id: admin.id }).select("id").single();
    if (error) throw new Error(error.message);
    customerId = (c as { id: string }).id;
  });

  afterAll(async () => {
    await cleanup(false);
    if (emailIds.length) await svc.from("emails").delete().in("id", emailIds);
    if (storagePaths.length) await svc.storage.from("documents").remove(storagePaths);
    for (const id of captureIds) {
      const { data } = await svc.from("capture_sessions").select("data").eq("id", id).maybeSingle();
      const fs = ((data as { data?: { files?: { path: string }[] } } | null)?.data?.files ?? []);
      if (fs.length) await svc.storage.from("job-files").remove(fs.map((x) => x.path));
      await svc.from("capture_sessions").delete().eq("id", id);
    }
    await svc.from("ai_training_examples").delete().gte("created_at", startedAt).eq("created_by", admin.id as string).in("kind", ["capture", "capture_drawing", "capture_sort"]);
  }, 120_000);

  /** E-mail poptávky s výkresy → dávka → vytěžení → kontrola. docOf(číslo) = doklad podle názvu souboru. */
  async function mailReview(files: { name: string; body: Buffer }[]) {
    const { data, error } = await svc.from("emails").insert({
      subject: "Poptávka klamp", from_email: `petr.fous@${DOM}`, from_name: "Petr Fous", category: "poptavka", body_text: BODY,
      direction: "in", thread_id: `t-${RUN}-${seq++}`, received_at: new Date().toISOString(), has_attachments: true, owner_id: admin.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const emailId = (data as { id: string }).id;
    emailIds.push(emailId);
    for (const [i, f] of files.entries()) {
      const p = `email-attachments/test-${RUN}/${emailId}/${i}-${f.name}`;
      const up = await svc.storage.from("documents").upload(p, f.body, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(up.error.message);
      storagePaths.push(p);
      await svc.from("email_attachments").insert({ email_id: emailId, filename: f.name, mime_type: "application/pdf", size_bytes: f.body.length, storage_path: p });
    }
    const res = await s.analyzeCapture({ files: [], mail: { emailId } });
    if (!res.ok || !("batch" in res)) throw new Error(JSON.stringify(res).slice(0, 300));
    const batch: BatchSortModel = res.batch;
    captureIds.add(batch.captureId);
    for (const d of batch.sort.docs.filter((x) => !x.excluded)) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
    }
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    const filenameOf = (docId: string) => {
      const pageId = batch.sort.docs.find((x) => x.id === docId)?.pageIds[0];
      const fileId = batch.pages.find((p) => p.id === pageId)?.fileId;
      return batch.files.find((f) => f.id === fileId)?.filename ?? "";
    };
    const docOf = (num: string) => r.review.docs.find((d) => d.kind === "drawing" && filenameOf(d.docId).startsWith(num))!.docId;
    return { batch, rv: r.review as BatchReviewModel, emailId, docOf };
  }

  const drawingState = (st: BatchApplyState, docId: string) => {
    const d = st.docs[docId];
    if (d.kind !== "drawing") throw new Error("čekám výkres");
    return d.state;
  };
  const itemsOf = async (jobId: string) => {
    const { data } = await svc.from("order_items").select("id, drawing_number, quantity, material").eq("order_id", jobId).order("position");
    return ((data ?? []) as { id: string; drawing_number: string; quantity: number | string; material: string | null }[]).map((i) => ({ ...i, quantity: Number(i.quantity) }));
  };
  const drawingFilesOf = async (jobId: string) => {
    const { data } = await svc.from("job_files").select("id, filename, order_item_id, content_sha256").eq("job_id", jobId).eq("kind", "vykres");
    return (data ?? []) as { id: string; filename: string; order_item_id: string | null; content_sha256: string | null }[];
  };
  /** Obě položky (Y832, Y823) s počty a každý výkres u své položky. */
  async function expectBothSaved(jobId: string, qty: [number, number]) {
    const items = await itemsOf(jobId);
    expect(items.map((i) => [i.drawing_number, i.quantity])).toEqual([[Y832, qty[0]], [Y823, qty[1]]]);
    const files = await drawingFilesOf(jobId);
    expect(files).toHaveLength(2);
    const itemOf = (n: string) => items.find((i) => i.drawing_number === n)!.id;
    const byItem = Object.fromEntries(files.map((f) => [f.order_item_id, f.filename]));
    expect(byItem[itemOf(Y832)]).toMatch(/Y832/);
    expect(byItem[itemOf(Y823)]).toMatch(/Y823/);
  }

  it("2 výkresy + text e-mailu: obě položky z textu (POM, 8 a 4 ks), výkresy u svých položek, rozhodnutí u upozornění, 1 uložení = vše", async () => {
    const { batch, rv, docOf } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: await vectorPdf(1) },
      { name: `${Y823}__vykres-gh1b.pdf`, body: await vectorPdf(2) },
    ]);
    const d832 = docOf(Y832);
    const d823 = docOf(Y823);
    expect(rv.groups).toHaveLength(1);
    const g = rv.initial.groups[0];
    expect(g.job.targetKey).toBe("new");
    expect(g.job.stage).toBe("poptavka");
    expect(g.job.items.map((i) => [i.key, i.drawingNumber, i.quantity, i.material])).toEqual([["ai-0", Y832, "8", "POM"], ["ai-1", Y823, "4", "POM"]]);
    expect(drawingState(rv.initial, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(drawingState(rv.initial, d823).link).toEqual({ mode: "docItem", itemKey: "ai-1" });
    // nic neblokuje; materiál = rozhodnutí na místě, poznámky AI jsou u karty výkresu
    expect(rv.warnings.filter((w) => w.severity === "block")).toEqual([]);
    expect(batchSaveProblem(rv, rv.initial)).toBeNull();
    const mat = rv.warnings.find((w) => w.code === "material_conflict" && w.docIds.includes(d832))!;
    expect(mat.actions.map((a) => a.kind)).toEqual(["ack", "use_drawing_material"]);
    expect(mat.actions[0].label).toBe("Platí POM (z textu e-mailu)");
    const dr = rv.docs.find((d) => d.docId === d832);
    expect(dr?.kind === "drawing" && dr.drawing.needsClarification).toContain("Materiál na výkresu: S400 (japonská norma JIS) — potvrdit.");

    // „Platí POM" = potvrzeno; „Platí materiál z výkresu" u druhého = materiál položky z výkresu
    let st = withAck(rv.initial, mat.id);
    expect(warningResolved(mat, st, rv)).toBe(true);
    const mat2 = rv.warnings.find((w) => w.code === "material_conflict" && w.docIds.includes(d823))!;
    st = withAck({ ...st, groups: st.groups.map((x) => ({ ...x, job: { ...x.job, items: x.job.items.map((i) => (i.key === "ai-1" ? { ...i, material: "PET100 (POLYPENCO)" } : i)) } })) }, mat2.id);
    expect(warningResolved(mat2, st, rv)).toBe(true);

    const res = await b.captureBatchApply({ captureId: batch.captureId, state: st });
    expect(res.status, JSON.stringify(res.docs.filter((d) => !d.ok))).toBe("done");
    expect(res.docs.filter((d) => d.ok && !d.skipped)).toHaveLength(2);
    const jobId = res.groups[0].jobId!;
    await expectBothSaved(jobId, [8, 4]);
    expect((await itemsOf(jobId)).map((i) => i.material)).toEqual(["POM", "PET100 (POLYPENCO)"]);
  }, 180_000);

  it("počet v Položkách přepsaný z 8 na 4: uloží se 4 ks, „Platí poptávka: 8 ks“ zmizí, výkres zůstává u své položky", async () => {
    const { batch, rv, docOf } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: await vectorPdf(11) },
      { name: `${Y823}__vykres-gh1b.pdf`, body: await vectorPdf(12) },
    ]);
    const d832 = docOf(Y832);
    const q = rv.warnings.find((w) => w.code === "quantity_conflict" && w.docIds.includes(d832))!;
    expect(q.message).toMatch(/Platí poptávka: 8 ks/);
    expect(warningResolved(q, rv.initial, rv)).toBe(false);
    const g = rv.initial.groups[0];
    const edited: BatchApplyState = { ...rv.initial, groups: [{ ...g, job: { ...g.job, items: g.job.items.map((i) => (i.key === "ai-0" ? { ...i, quantity: "4" } : i)) } }] };
    expect(warningResolved(q, edited, rv)).toBe(true);
    expect(drawingState(edited, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(batchSaveProblem(rv, edited)).toBeNull();
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: edited });
    expect(res.status, JSON.stringify(res.docs.filter((d) => !d.ok))).toBe("done");
    await expectBothSaved(res.groups[0].jobId!, [4, 4]);
  }, 180_000);

  it("výkres už u starší zakázky (stejný obsah i číslo): nová poptávka → nová zakázka, výkres se uloží i sem s odkazem; přepnutí cíle tam a zpět nerozbije vazby", async () => {
    const pdf832 = await vectorPdf(21);
    // starší zakázka téhož zákazníka (už objednaná) s výkresem Y832 — stejný soubor
    const { data: old, error } = await svc.from("orders").insert({
      number: `Z-HF-${RUN}`, title: "klamp — starší", status: "objednavka", customer_id: customerId, source: "manual",
      owner_id: admin.id, created_by: admin.id, inquiry_date: "2026-03-01", priority: "stredni",
    } as never).select("id, number").single();
    if (error) throw new Error(error.message);
    const oldJob = old as { id: string; number: string };
    const { data: oi } = await svc.from("order_items").insert({ order_id: oldJob.id, position: 0, drawing_number: Y832, name: "klamp", quantity: 10, unit: "ks" } as never).select("id").single();
    const oldItemId = (oi as { id: string }).id;
    const sha = createHash("sha256").update(pdf832).digest("hex");
    await svc.from("job_files").insert({
      job_id: oldJob.id, kind: "vykres", filename: `${Y832}.pdf`, storage_path: `zakazky/${oldJob.id}/${Y832}.pdf`, content_sha256: sha,
      order_item_id: oldItemId, ai_extracted: { drawingNumber: Y832, revision: "" },
    } as never);

    const { batch, rv, docOf } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: pdf832 },
      { name: `${Y823}__vykres-gh1b.pdf`, body: await vectorPdf(22) },
    ]);
    const d832 = docOf(Y832);
    const d823 = docOf(Y823);
    const g0 = rv.initial.groups[0];
    const targets = rv.groups[0].model.targets;
    expect(targets.some((t) => t.key === oldJob.id)).toBe(true);   // starší zakázka v nabídce cílů
    expect(g0.job.targetKey).toBe("new");                            // opakovaná poptávka = nová zakázka
    expect(rv.warnings.find((w) => w.code === "repeat_inquiry")?.links?.[0].href).toBe(`/orders/${oldJob.id}`);
    const also = rv.warnings.find((w) => w.code === "also_in_job" && w.docIds.includes(d832));
    expect(also).toMatchObject({ severity: "info", links: [{ href: `/orders/${oldJob.id}` }] });
    expect(rv.warnings.some((w) => w.code === "already_saved")).toBe(false);
    expect(drawingState(rv.initial, d832).onDuplicate).toBeNull();   // nic se nepřeskočí
    const dr = rv.docs.find((d) => d.docId === d832);
    expect(dr?.kind === "drawing" && dr.duplicateOf?.jobId).toBe(oldJob.id);

    // člověk přepne na starší zakázku (výkres tam je → volba „neukládat / nová verze") a zpět na novou
    const from = targets.find((t) => t.key === "new")!;
    const to = targets.find((t) => t.key === oldJob.id)!;
    let st: BatchApplyState = { ...rv.initial, groups: [{ ...g0, job: switchTarget(g0.job, from, to, g0.job.customer, g0.job.supplier) }] };
    st = relinkGroupDocs(rv, st, g0.key);
    expect(drawingState(st, d832).link).toEqual({ mode: "item", itemId: oldItemId });
    expect(drawingState(st, d832).onDuplicate).toBe("skip");
    expect(warningResolved(also!, st, rv)).toBe(true);               // teď rozhoduje volba na kartě
    const back = st.groups[0];
    st = { ...st, groups: [{ ...back, job: switchTarget(back.job, to, from, g0.job.customer, g0.job.supplier) }] };
    st = relinkGroupDocs(rv, st, g0.key);
    expect(drawingState(st, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(drawingState(st, d823).link).toEqual({ mode: "docItem", itemKey: "ai-1" });
    expect(drawingState(st, d832).onDuplicate).toBeNull();

    const res = await b.captureBatchApply({ captureId: batch.captureId, state: st });
    expect(res.status, JSON.stringify(res.docs.filter((d) => !d.ok))).toBe("done");
    const jobId = res.groups[0].jobId!;
    expect(jobId).not.toBe(oldJob.id);
    await expectBothSaved(jobId, [8, 4]);
    // výkres se stejným obsahem je teď u obou zakázek; starší zakázka beze změny
    expect(await drawingFilesOf(oldJob.id)).toHaveLength(1);
    expect((await drawingFilesOf(jobId)).some((f) => f.content_sha256 === sha)).toBe(true);
    expect((await itemsOf(oldJob.id)).map((i) => [i.drawing_number, i.quantity])).toEqual([[Y832, 10]]);
  }, 180_000);

  it("starý klient: vazba výkresu na položku jiné zakázky (přepnutý cíl) → server ji opraví podle čísla, uloží se oba (dřív „Vybraná položka nepatří k zakázce“)", async () => {
    const { data: old } = await svc.from("orders").insert({
      number: `Z-HG-${RUN}`, title: "klamp — jiná", status: "dokonceno", customer_id: customerId, source: "manual",
      owner_id: admin.id, created_by: admin.id, inquiry_date: "2026-02-01", priority: "stredni",
    } as never).select("id").single();
    const oldId = (old as { id: string }).id;
    const { data: oi } = await svc.from("order_items").insert({ order_id: oldId, position: 0, drawing_number: Y832, name: "klamp", quantity: 3, unit: "ks" } as never).select("id").single();
    const { batch, rv, docOf } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: await vectorPdf(31) },
      { name: `${Y823}__vykres-gh1b.pdf`, body: await vectorPdf(32) },
    ]);
    const d832 = docOf(Y832);
    expect(rv.initial.groups[0].job.targetKey).toBe("new");
    const stale: BatchApplyState = {
      ...rv.initial,
      docs: { ...rv.initial.docs, [d832]: { kind: "drawing", state: { ...drawingState(rv.initial, d832), link: { mode: "item", itemId: (oi as { id: string }).id } } } as DocApplyState },
    };
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: stale });
    expect(res.status, JSON.stringify(res.docs.filter((d) => !d.ok))).toBe("done");
    expect(res.docs.find((d) => d.docId === d832)?.summary).toMatch(/patřila k jiné zakázce — připojeno k položce se stejným číslem/);
    await expectBothSaved(res.groups[0].jobId!, [8, 4]);
    expect(await drawingFilesOf(oldId)).toHaveLength(0);
  }, 180_000);

  it("OCR přečetla druhý výkres jako Y832 (soubor Y823): upozornění s volbou „je A290-7904-Y823“ → oba výkresy u svých položek", async () => {
    const { batch, rv } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: await vectorPdf(41) },
      { name: `${Y823}__vykres-gh1c.pdf`, body: await vectorPdf(42) },
    ]);
    const docs = rv.docs.filter((d) => d.kind === "drawing").map((d) => d.docId);
    expect(docs.map((id) => drawingState(rv.initial, id).drawingNumber)).toEqual([Y832, Y832]);
    expect(docs.map((id) => drawingState(rv.initial, id).link)).toEqual([{ mode: "docItem", itemKey: "ai-0" }, { mode: "docItem", itemKey: "ai-0" }]);
    const w = rv.warnings.find((x) => x.code === "drawing_item_shared")!;
    expect(w.severity).toBe("warn");
    const link = w.actions.find((a) => a.kind === "link_item")!;
    expect(link).toMatchObject({ itemKey: "ai-1", value: Y823, label: `„${Y823}.pdf“ je ${Y823} (4 ks)` });
    expect(w.actions.at(-1)).toMatchObject({ kind: "ack", label: "Jsou to listy téhož výkresu" });
    // duplicita v dávce: „Ponechat oba" (vyřazení až druhá volba)
    const dupw = rv.warnings.find((x) => x.code === "duplicate_doc");
    expect(dupw?.actions.map((a) => a.kind)).toEqual(["ack", "exclude_doc"]);
    expect(batchSaveProblem(rv, rv.initial)).toBeNull();

    // klik „… je A290-7904-Y823 (4 ks)" (jako dialog: vazba + číslo + počet z řádku)
    const d = drawingState(rv.initial, link.docId!);
    const st: BatchApplyState = {
      ...rv.initial,
      docs: { ...rv.initial.docs, [link.docId!]: { kind: "drawing", state: { ...d, link: { mode: "docItem", itemKey: "ai-1" }, drawingNumber: Y823, quantity: "4" } } },
    };
    expect(warningResolved(w, st, rv)).toBe(true);
    expect(warningResolved(dupw!, st, rv)).toBe(true);
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: st });
    expect(res.status, JSON.stringify(res.docs.filter((x) => !x.ok))).toBe("done");
    await expectBothSaved(res.groups[0].jobId!, [8, 4]);
  }, 180_000);

  it("částečné uložení: neuložený výkres zůstane uložitelný (důvod u něj), další uložení dokončí jen zbytek bez zdvojení", async () => {
    const { batch, rv, docOf } = await mailReview([
      { name: `${Y832}__vykres-gh1a.pdf`, body: await vectorPdf(51) },
      { name: `${Y823}__vykres-gh1b.pdf`, body: await vectorPdf(52) },
    ]);
    const d823 = docOf(Y823);
    // soubor výkresu Y823 v relaci dočasně pryč → uložení výkresu selže (jako výpadek úložiště)
    const { data: sess } = await svc.from("capture_sessions").select("data").eq("id", batch.captureId).single();
    const sdata = (sess as { data: { files: { id: string; path: string }[]; pages: { id: string; fileId: string }[] } }).data;
    const pageId = batch.sort.docs.find((x) => x.id === d823)!.pageIds[0];
    const file = sdata.files.find((f) => f.id === sdata.pages.find((p) => p.id === pageId)!.fileId)!;
    const dl = await svc.storage.from("job-files").download(file.path);
    if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "soubor relace chybí");
    const bytes = Buffer.from(await dl.data.arrayBuffer());
    await svc.storage.from("job-files").remove([file.path]);

    const first = await b.captureBatchApply({ captureId: batch.captureId, state: rv.initial });
    expect(first.status).toBe("partial");
    expect(first.pending).toEqual([d823]);
    expect(first.docs.find((x) => x.docId === d823)?.error).toBeTruthy();
    const locked = savedDocIds(first);
    expect(locked.has(d823)).toBe(false);
    expect(locked.size).toBe(1);
    // zbytek jde uložit (nic neblokuje), uložené doklady se znovu neukládají
    expect(batchSaveProblem(rv, rv.initial, locked)).toBeNull();

    await svc.storage.from("job-files").upload(file.path, bytes, { contentType: "application/pdf", upsert: true });
    const second = await b.captureBatchApply({ captureId: batch.captureId, state: rv.initial });
    expect(second.status, JSON.stringify(second.docs.filter((x) => !x.ok))).toBe("done");
    expect(second.groups[0].jobId).toBe(first.groups[0].jobId);
    await expectBothSaved(second.groups[0].jobId!, [8, 4]);
  }, 180_000);
});
