import "server-only";
import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/data/current-user";
import type { JobsDb } from "@/lib/jobs/events";
import { todayIso } from "@/lib/jobs/mapping";
import { invoiceFileBytes, loadIssuedInvoices, type IssuedLoad } from "@/lib/data/issued-invoices";
import {
  dedupeEntryNames, exportBaseName, invoiceEntryName, invoicesCsv, parsePeriod, periodKey, periodLabel, sortInvoices,
  type IssuedInvoice, type IssuedPeriod,
} from "@/lib/issued-invoices/model";

/**
 * Hromadný export Faktur vydaných za období (měsíc / rok) pro účetní: ZIP s PDF každé faktury (+ přehled CSV),
 * jedno sloučené PDF k otevření v prohlížeči a CSV. Každá route ověří právo `issued_invoices` sama (401 / 403).
 * Odpověď nad 4 MB (limit těla odpovědi Vercelu) se uloží do úložiště (exports/<uživatel>/…) a route přesměruje
 * na krátkodobou podepsanou URL — stejně jako otevření dokumentu zakázky.
 */

export const MAX_INVOICES = 500;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const DIRECT_LIMIT = 4 * 1024 * 1024;
/** Pevný čas v ZIPu (stejný obsah = stejný soubor). */
const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

export interface ExportCtx {
  db: JobsDb;
  user: CurrentUser;
  period: IssuedPeriod;
  load: IssuedLoad;
  /** Seřazeno pro export: od nejstarší (datum, číslo). */
  items: IssuedInvoice[];
}

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Právo + období (?obdobi=2026-11 | 2026) + faktury. Response = chyba. */
export async function exportContext(req: Request): Promise<ExportCtx | Response> {
  const guard = await apiRequire("issued_invoices");
  if (guard instanceof NextResponse) return guard;
  if (!isSupabaseConfigured()) return json("Supabase není nakonfigurováno.", 503);
  const access = await getAccess();
  if (!access.can("issued_invoices")) return json("Bez oprávnění.", 403);
  const url = new URL(req.url);
  const today = todayIso();
  const period = parsePeriod(url.searchParams.get("obdobi"), today);
  const db = await createOperatorClient({ actor: userActor(guard.user) });
  const load = await loadIssuedInvoices(db, period, today);
  const items = sortInvoices(load.items.filter((it) => it.payment.state !== "storno"), "datum", "asc");
  return { db, user: guard.user, period, load, items };
}

/** Stáhnout (attachment) / zobrazit (inline); velké → úložiště + přesměrování na podepsanou URL. */
export async function deliver(
  ctx: Pick<ExportCtx, "db" | "user">,
  bytes: Uint8Array,
  opts: { contentType: string; filename: string; inline?: boolean; headers?: Record<string, string> },
): Promise<Response> {
  const disposition = `${opts.inline ? "inline" : "attachment"}; filename="${opts.filename}"`;
  if (bytes.length <= DIRECT_LIMIT) {
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": opts.contentType,
        "Content-Disposition": disposition,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        ...(opts.headers ?? {}),
      },
    });
  }
  const path = `exports/${ctx.user.id}/${crypto.randomUUID()}-${opts.filename}`;
  const { error } = await ctx.db.storage.from("job-files").upload(path, bytes, { contentType: opts.contentType, upsert: false });
  if (error) return json(`Export se nepodařilo připravit: ${error.message}`, 500);
  const { data: signed } = await ctx.db.storage.from("job-files")
    .createSignedUrl(path, 600, opts.inline ? undefined : { download: opts.filename });
  if (!signed?.signedUrl) return json("Odkaz na export se nepodařilo vytvořit.", 500);
  const res = NextResponse.redirect(signed.signedUrl as string, 302);
  res.headers.set("Cache-Control", "private, no-store");
  for (const [k, v] of Object.entries(opts.headers ?? {})) res.headers.set(k, v);
  return res;
}

interface LoadedFile {
  invoice: IssuedInvoice;
  bytes: Uint8Array;
  ext: string;
}

/** Soubory faktur (v pořadí exportu) + co chybí a proč. */
async function loadFiles(ctx: ExportCtx): Promise<{ files: LoadedFile[]; missing: { invoice: IssuedInvoice; reason: string }[] }> {
  const files: LoadedFile[] = [];
  const missing: { invoice: IssuedInvoice; reason: string }[] = [];
  let total = 0;
  const list = ctx.items.slice(0, MAX_INVOICES);
  for (const it of ctx.items.slice(MAX_INVOICES)) missing.push({ invoice: it, reason: `nad limit ${MAX_INVOICES} faktur v jednom exportu` });
  // stahování po pěti (úložiště nezahltit, ale nečekat na každou fakturu zvlášť)
  for (let i = 0; i < list.length; i += 5) {
    const chunk = list.slice(i, i + 5);
    const got = await Promise.all(chunk.map(async (it) => {
      const ref = ctx.load.files.get(it.id);
      if (!ref) return { it, bytes: null as Uint8Array | null, ref: null, reason: "faktura nemá PDF v dokumentech zakázky" };
      const bytes = await invoiceFileBytes(ctx.db, ref);
      return { it, bytes, ref, reason: bytes ? "" : "soubor v úložišti nenalezen" };
    }));
    for (const g of got) {
      if (!g.bytes || !g.ref) { missing.push({ invoice: g.it, reason: g.reason }); continue; }
      total += g.bytes.length;
      if (total > MAX_TOTAL_BYTES) { missing.push({ invoice: g.it, reason: "export by byl větší než 200 MB" }); continue; }
      const ext = /\.([A-Za-z0-9]{1,8})$/.exec(g.ref.filename)?.[1]?.toLowerCase() ?? "pdf";
      files.push({ invoice: g.it, bytes: g.bytes, ext });
    }
  }
  return { files, missing };
}

function missingText(period: IssuedPeriod, missing: { invoice: IssuedInvoice; reason: string }[]): string {
  return [
    `Faktury ${periodLabel(period)} bez souboru v tomto exportu:`,
    "",
    ...missing.map((m) => `${m.invoice.number}${m.invoice.customer?.name ? ` (${m.invoice.customer.name})` : ""} — ${m.reason}`),
    "",
  ].join("\r\n");
}

/** ZIP: každá faktura zvlášť (FV-…_Odberatel.pdf), přehled CSV, CHYBI.txt pro faktury bez PDF. */
export async function buildZip(ctx: ExportCtx): Promise<{ bytes: Uint8Array; included: number; missing: number }> {
  const { files, missing } = await loadFiles(ctx);
  const names = dedupeEntryNames(files.map((f) => invoiceEntryName(f.invoice, f.ext)));
  const input: Record<string, [Uint8Array, { mtime: Date; level?: 0 | 6 }]> = {};
  // PDF jsou už komprimovaná — level 0 (rychlé, stejně velké)
  files.forEach((f, i) => { input[names[i]] = [f.bytes, { mtime: FIXED_MTIME, level: f.ext === "pdf" ? 0 : 6 }]; });
  input[`Prehled_${exportBaseName(ctx.period)}.csv`] = [strToU8(invoicesCsv(ctx.items)), { mtime: FIXED_MTIME, level: 6 }];
  if (missing.length) input["CHYBI.txt"] = [strToU8(missingText(ctx.period, missing)), { mtime: FIXED_MTIME, level: 6 }];
  return { bytes: zipSync(input), included: files.length, missing: missing.length };
}

/** Jedno PDF ze všech faktur období (obrázky faktur jako strana A4); prázdné období = strana s vysvětlením. */
export async function buildMergedPdf(ctx: ExportCtx): Promise<{ bytes: Uint8Array; included: number; missing: number }> {
  const { files, missing } = await loadFiles(ctx);
  const out = await PDFDocument.create();
  out.setTitle(`Faktury vydané ${periodLabel(ctx.period)}`);
  out.setCreator("Mnástrojárna — Faktury vydané");
  let included = 0;
  for (const f of files) {
    try {
      if (f.ext === "pdf") {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      } else if (f.ext === "jpg" || f.ext === "jpeg" || f.ext === "png") {
        const img = f.ext === "png" ? await out.embedPng(f.bytes) : await out.embedJpg(f.bytes);
        const page = out.addPage([595.28, 841.89]);
        const scale = Math.min((595.28 - 40) / img.width, (841.89 - 40) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
      } else {
        missing.push({ invoice: f.invoice, reason: `soubor .${f.ext} nejde vložit do PDF (je v ZIPu)` });
        continue;
      }
      included++;
    } catch {
      missing.push({ invoice: f.invoice, reason: "PDF faktury je poškozené nebo zamčené" });
    }
  }
  if (!included || missing.length) {
    // strana s vysvětlením (bez diakritiky — standardní písmo PDF ji neumí)
    const font = await out.embedFont(StandardFonts.Helvetica);
    const page = included ? out.addPage([595.28, 841.89]) : out.insertPage(0, [595.28, 841.89]);
    const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");
    let y = 790;
    const line = (s: string, size = 11) => { page.drawText(ascii(s).slice(0, 110), { x: 40, y, size, font, color: rgb(0.15, 0.14, 0.15) }); y -= size + 7; };
    line(`Faktury vydane ${periodKey(ctx.period)}`, 16);
    y -= 6;
    if (!included) line(ctx.items.length ? "Zadna faktura v obdobi nema PDF." : "V tomto obdobi nebyla vystavena zadna faktura.");
    for (const m of missing.slice(0, 40)) line(`${m.invoice.number} - ${m.reason}`, 10);
  }
  const bytes = await out.save();
  return { bytes, included, missing: missing.length };
}

export function csvBytes(ctx: ExportCtx): Uint8Array {
  return strToU8(invoicesCsv(ctx.items));
}

export async function auditExport(ctx: ExportCtx, format: "zip" | "pdf" | "csv", diff: Record<string, unknown> = {}): Promise<void> {
  await logAudit({
    action: "issued_invoices_export", entity: "invoices",
    diff: { format, period: periodKey(ctx.period), count: ctx.items.length, ...diff },
    actor: userActor(ctx.user),
  });
}
