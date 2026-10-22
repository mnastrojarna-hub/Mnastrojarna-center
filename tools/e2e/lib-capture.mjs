// Pomocné funkce pro E2E suite „capture" (📷 Vyfotit doklad).
// Jen testovací kód — aplikaci nemění.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { sql } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// ── Malé PNG (bez závislostí) ─────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * „Fotka dokladu": bílý list s šedými řádky textu a červenou hlavičkou.
 * seed mění odstín, aby se soubory lišily (detekce duplicit / verzí).
 */
export function makeDocPng({ width = 240, height = 320, seed = 0 } = {}) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filtr None
    for (let x = 0; x < width; x++) {
      let r = 250, g = 250, b = 248;
      if (y < 36) { r = 224; g = 57 + (seed % 40); b = 48; } // hlavička (korporátní červená)
      else if (y % 18 < 5 && x > 16 && x < width - 16 - ((y * 7) % 60)) { r = g = b = 120 + (seed % 30); } // řádky textu
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Soubor pro setInputFiles. */
export function pngFile(name, seed = 0) {
  return { name, mimeType: "image/png", buffer: makeDocPng({ seed }) };
}

// ── SQL pomocníci ────────────────────────────────────────
/** Bezpečný SQL literál. */
export function q(v) {
  if (v === null || v === undefined) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function userId(email) {
  return sql(`select id from profiles where email = ${q(email)}`);
}

/** JSON z dotazu (select json_agg(...) / row_to_json). */
export function sqlJson(query) {
  const out = sql(query);
  return out ? JSON.parse(out) : null;
}

/**
 * Vlastní zakázka testu (vlastní číslo E2E-CAP-…, aby se nepálil čítač dokladů).
 * Vrací id.
 */
export function insertJob({ number, title, customerId = null, stage = "nabidka", ownerId, extra = {} }) {
  const cols = { number, title, customer_id: customerId, status: stage, owner_id: ownerId, created_by: ownerId, source: "manual", ...extra };
  const keys = Object.keys(cols);
  const vals = keys.map((k) => q(cols[k]));
  return sql(`insert into orders (${keys.join(", ")}) values (${vals.join(", ")}) returning id`).split("\n")[0].trim();
}

export function insertItem(jobId, { position = 0, drawingNumber, revision = null, name, material = null, quantity = 1, unit = "ks", unitPrice = null }) {
  sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price)
       values (${q(jobId)}, ${position}, ${q(drawingNumber)}, ${q(revision)}, ${q(name)}, ${q(material)}, ${quantity}, ${q(unit)}, ${unitPrice ?? "null"})`);
}

// ── Úložiště (Supabase Storage přes servisní klíč) ───────
function localEnv() {
  const file = path.join(ROOT, ".local-supabase/env");
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/**
 * Kontrola prostředí: má klientský build vložené NEXT_PUBLIC_SUPABASE_URL?
 * (Next je do prohlížečového JS vkládá při `next build`; build bez nich = prohlížeč
 * nemá Supabase klienta a nahrání stránky dokladu skončí chybou @supabase/ssr.)
 * Vrací true, když v načtených skriptech zůstal nenahrazený odkaz na proměnnou.
 */
export async function clientBuildLacksSupabaseEnv(page) {
  return page.evaluate(async () => {
    const srcs = [...document.querySelectorAll("script[src]")].map((s) => s.src).filter((s) => s.includes("/_next/static/"));
    for (const src of srcs) {
      try {
        const t = await (await fetch(src)).text();
        if (t.includes("env.NEXT_PUBLIC_SUPABASE_URL")) return true;
      } catch {
        // ignorovat
      }
    }
    return false;
  });
}

/**
 * Náhrada chybějících NEXT_PUBLIC_* v prohlížeči (jen když build je bez nich).
 * Next polyfill `process` vezme globální window.process, pokud má objekt env.
 * Při správném buildu nemá žádný vliv (hodnoty jsou ve skriptech natvrdo).
 */
export async function installEnvShim(context) {
  const env = localEnv();
  const pub = {
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  await context.addInitScript((vars) => {
    if (typeof window === "undefined" || window.process) return;
    window.process = {
      env: { ...vars, NODE_ENV: "production" },
      browser: true, title: "browser", version: "", versions: {}, platform: "browser", argv: [],
      cwd: () => "/",
      nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
      on() {}, off() {}, once() {}, emit() {}, addListener() {}, removeListener() {}, removeAllListeners() {}, listeners: () => [],
    };
  }, pub);
}

/** Smaže objekty z bucketu job-files (best-effort). */
export async function removeStorage(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  try {
    const env = localEnv();
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefixes: list }),
    });
  } catch {
    // úklid je best-effort
  }
}

/** Objekty v úložišti, jejichž název obsahuje fragment (např. unikátní název souboru testu). */
export function storageObjects(fragment) {
  const out = sql(`select name from storage.objects where bucket_id = 'job-files' and name like ${q(`%${fragment}%`)} order by name`);
  return out ? out.split("\n") : [];
}

/**
 * Úklid jedné zakázky testu se vším, co k ní zápis dokladu vytvořil
 * (učení, dokumenty a jejich soubory v úložišti). Pořadí kvůli FK.
 */
export async function deleteJobDeep(jobId) {
  if (!jobId) return;
  const files = sql(`select storage_path from job_files where job_id = ${q(jobId)}`);
  sql(`delete from ai_training_examples where job_id = ${q(jobId)}`);
  sql(`delete from job_files where job_id = ${q(jobId)}`);
  sql(`delete from job_events where job_id = ${q(jobId)}`);
  sql(`delete from order_items where order_id = ${q(jobId)}`);
  sql(`delete from orders where id = ${q(jobId)}`);
  await removeStorage(files ? files.split("\n") : []);
}

/** Dialog „Vyfotit doklad" je vidět. */
export function captureDialog(page) {
  return page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Vyfotit doklad" }) });
}

/** Stránka nepřetéká do strany (mobil). */
export async function noHorizontalOverflow(page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    ok: document.documentElement.scrollWidth <= window.innerWidth + 1,
  }));
}

/** Prvky dialogu, které přesahují šířku okna (diagnostika přetečení). */
export async function overflowingInDialog(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return [];
    const w = window.innerWidth;
    const out = [];
    for (const el of dlg.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
        out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 60)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
      }
      if (out.length > 8) break;
    }
    return out;
  });
}

/** Minimální jednostránkové PDF (text „label"). */
export function makePdf(label = "E2E doklad") {
  const text = String(label).replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 40 760 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function pdfFile(name, label) {
  return { name, mimeType: "application/pdf", buffer: makePdf(label ?? name) };
}
