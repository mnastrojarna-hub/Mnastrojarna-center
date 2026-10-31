import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { userActor } from "@/lib/supabase/actor-headers";
import { aiFailureMessage } from "@/lib/ai/ai-call";
import { isDocumentReaderConfigured } from "@/lib/ai/document-reader";
import { isFakeCapture } from "@/lib/ai/fake-capture";
import { readParty } from "@/lib/ai/party-reader";
import { aresByIco, aresSearchByName } from "@/lib/ares/ares-server";
import { pickAresByName, type AresCompany } from "@/lib/ares/ares";
import { CAPTURE_BUCKET, captureHiresPath, sniffDocumentMime } from "@/lib/jobs/capture-review";
import { cleanFileRefs } from "@/lib/jobs/capture-service";
import { AI_MAX_DOC_BYTES, AI_MAX_IMAGE_BYTES, AI_MAX_IMAGE_SIDE, imageDimensions } from "@/lib/jobs/capture-files";
import { parseEmailFile } from "@/lib/email/parse";
import { decodePart, isAttachmentLeaf, mimeLeaves } from "@/lib/email/mime-parts";
import { findPartyDuplicate } from "@/lib/parties/duplicates";
import { aresIcoOf, mergeWithAres, type AresStatus, type PartyExtract } from "@/lib/parties/party-extract";
import type { AresLookupResponse, PartyAutofillResponse } from "@/lib/parties/autofill-types";
import type { PartyKind } from "@/lib/contacts/roles";
import type { JobsDb } from "@/lib/jobs/events";

/**
 * „Vyplnit z dokladu" v dialogu Nový zákazník / Nový dodavatel: podklady (fotky, PDF, e-maily .eml/.msg,
 * vložený text) přečte AI → jen údaje firmy → IČO ověří a doplní ARES → kontrola, jestli firma v adresáři
 * už není. NIC se neukládá a nezakládá (žádná zakázka) — výsledek jen předvyplní formulář, uloží uživatel.
 * Soubory nahrává prohlížeč podepsanou URL do capture/<já>/ (jako focení dokladů); po přečtení se smažou.
 */

const MAX_FILES = 10;
const MAX_TEXT = 20_000;
const MAX_EMAIL_ATTACHMENTS = 3;
const AI_IMAGE_SIDE = 2400;

type Fail = { ok: false; error: string };

const AI_NOT_ALLOWED = "Nemáš povolené AI čtení dokladů — napiš IČO a klikni na „ARES“, zbytek se doplní z registru.";
const AI_DISABLED = "AI je vypnuté v Nastavení — napiš IČO a klikni na „ARES“, zbytek se doplní z registru.";
const AI_MISSING = "AI není nastavené (chybí Claude API klíč) — napiš IČO a klikni na „ARES“, zbytek se doplní z registru.";

async function aiAvailable(): Promise<{ ok: true } | Fail> {
  const access = await getAccess();
  if (access.can("ai_capture") && (await isDocumentReaderConfigured())) return { ok: true };
  const ctxOn = { ...access.ctx, aiEnabled: true, aiConfigured: true };
  if (isFakeCapture() && can(access.user, "ai_capture", ctxOn)) return { ok: true };
  if (!can(access.user, "ai_capture", ctxOn)) return { ok: false, error: AI_NOT_ALLOWED };
  if (!access.ctx.aiEnabled) return { ok: false, error: AI_DISABLED };
  return { ok: false, error: AI_MISSING };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function isHeic(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const brand = String.fromCharCode(...b.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand);
}

/** Fotka pro Claude: JPEG/PNG/WebP/GIF do 5 MB a 8000 px; jinak (HEIC, obří fotka) převod na JPEG ≤ 2400 px. */
async function imageForAi(bytes: Uint8Array): Promise<Anthropic.ContentBlockParam | null> {
  const mime = sniffDocumentMime(bytes);
  const dim = imageDimensions(bytes);
  if (mime && mime !== "application/pdf" && bytes.length <= AI_MAX_IMAGE_BYTES && (!dim || Math.max(dim.width, dim.height) <= AI_MAX_IMAGE_SIDE)) {
    return { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: b64(bytes) } };
  }
  try {
    const sharp = (await import("sharp")).default;
    let src = bytes;
    if (isHeic(bytes)) src = await (await import("@/lib/anonymize/image")).heicToJpeg(bytes);
    const jpeg = await sharp(Buffer.from(src), { limitInputPixels: 400_000_000 })
      .rotate()
      .resize(AI_IMAGE_SIDE, AI_IMAGE_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (jpeg.length > AI_MAX_IMAGE_BYTES) return null;
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch {
    return null;
  }
}

function looksLikeEmail(name: string, bytes: Uint8Array): boolean {
  if (/\.(eml|msg|mime)$/i.test(name)) return true;
  if (bytes.length > 8 && Buffer.from(bytes.subarray(0, 4)).readUInt32BE(0) === 0xd0cf11e0) return true;
  const head = Buffer.from(bytes.subarray(0, 2048)).toString("latin1");
  return /^(?:[\w-]+:.*\r?\n)*?(?:from|received|return-path|message-id|subject):/im.test(head) && /\r?\n\r?\n/.test(head);
}

function isPlainText(name: string, bytes: Uint8Array): boolean {
  if (/\.(txt|csv|vcf|html?)$/i.test(name)) return true;
  const sample = bytes.subarray(0, 4096);
  let bad = 0;
  for (const c of sample) if (c === 0 || (c < 9 && c !== 0)) bad += 1;
  return sample.length > 0 && bad === 0;
}

function textOf(name: string, bytes: Uint8Array): string {
  let t = Buffer.from(bytes).toString("utf8");
  if (/\.html?$/i.test(name) || /<html|<body|<div|<p[\s>]/i.test(t.slice(0, 2000))) {
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"");
  }
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

interface Prepared {
  blocks: Anthropic.ContentBlockParam[];
  texts: { label: string; text: string }[];
}

/** Soubor → bloky pro AI (fotka / PDF / e-mail i s přílohami / text). Chyba = česká věta. */
async function prepareFile(name: string, bytes: Uint8Array, out: Prepared, budget: { bytes: number }): Promise<string | null> {
  const mime = sniffDocumentMime(bytes);
  if (mime === "application/pdf") {
    if (budget.bytes + bytes.length > AI_MAX_DOC_BYTES) return `${name}: podklady jsou dohromady moc velké — nahraj jen stránku s hlavičkou.`;
    budget.bytes += bytes.length;
    out.blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } });
    return null;
  }
  if (mime || isHeic(bytes)) {
    const block = await imageForAi(bytes);
    if (!block) return `${name}: fotku se nepodařilo přečíst — zkus ji vyfotit znovu (JPG / PNG).`;
    budget.bytes += bytes.length;
    out.blocks.push(block);
    return null;
  }
  if (looksLikeEmail(name, bytes)) {
    const buf = Buffer.from(bytes);
    const parsed = parseEmailFile(name, buf);
    if (!parsed.ok || !parsed.email) return `${name}: e-mail se nepodařilo přečíst.`;
    const e = parsed.email;
    const head = [
      `Od: ${[e.fromName, e.fromEmail ? `<${e.fromEmail}>` : ""].filter(Boolean).join(" ")}`,
      e.toEmail ? `Komu: ${e.toEmail}` : "",
      e.ccEmail ? `Kopie: ${e.ccEmail}` : "",
      e.subject ? `Předmět: ${e.subject}` : "",
    ].filter(Boolean).join("\n");
    out.texts.push({ label: `E-mail (${name})`, text: `${head}\n\n${e.body ?? ""}`.slice(0, MAX_TEXT) });
    // přílohy .eml (objednávka v PDF, vizitka) — jen pár PDF / fotek
    if (!/\.msg$/i.test(name)) {
      let added = 0;
      try {
        for (const leaf of mimeLeaves(buf).filter(isAttachmentLeaf)) {
          if (added >= MAX_EMAIL_ATTACHMENTS) break;
          const data = new Uint8Array(decodePart(leaf));
          const m = sniffDocumentMime(data);
          if (!m || leaf.truncated) continue;
          if (m === "application/pdf") {
            if (budget.bytes + data.length > AI_MAX_DOC_BYTES) continue;
            budget.bytes += data.length;
            out.blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(data) } });
            added += 1;
          } else if (data.length > 20_000) {
            // malé obrázky = loga a ikony v podpisu, ty nic neřeknou
            const block = await imageForAi(data);
            if (block) {
              out.blocks.push(block);
              added += 1;
            }
          }
        }
      } catch {
        // přílohy jsou jen bonus
      }
    }
    return null;
  }
  if (isPlainText(name, bytes)) {
    const t = textOf(name, bytes);
    if (t) out.texts.push({ label: `Text (${name})`, text: t });
    return null;
  }
  return `${name}: tenhle formát AI nepřečte — nahraj fotku, PDF nebo e-mail (.eml / .msg).`;
}

async function removeCapture(db: JobsDb, paths: string[]): Promise<void> {
  if (!paths.length) return;
  try { await db.storage.from(CAPTURE_BUCKET).remove(paths); } catch { /* úklid je best-effort */ }
}

const ARES_MESSAGE: Record<AresStatus, string> = {
  found: "Název, DIČ a sídlo doplněny z ARES podle IČO.",
  by_name: "IČO na dokladu nebylo — firma dohledána v ARES podle názvu. Zkontroluj, že je to ona.",
  choose: "IČO na dokladu nebylo a v ARES je víc firem s podobným názvem — vyber správnou.",
  invalid_ico: "IČO na dokladu nemá platnou kontrolní číslici — zkontroluj ho (údaje jsou z dokladu).",
  not_found: "V ARES jsme firmu nenašli — údaje jsou jen z dokladu.",
  unavailable: "ARES teď neodpovídá — údaje jsou jen z dokladu, IČO ověř později tlačítkem „ARES“.",
  skipped: "Zahraniční firma / bez IČO — údaje jsou jen z dokladu.",
};

/** ARES k přečteným údajům: IČO → registr; bez IČO podle názvu (jistá shoda, jinak kandidáti). */
async function resolveAres(doc: PartyExtract): Promise<{ status: AresStatus; company: AresCompany | null; candidates: AresCompany[] }> {
  const { ico, invalid } = aresIcoOf(doc);
  if (ico) {
    const res = await aresByIco(ico);
    if (res.ok) return { status: "found", company: res.company, candidates: [] };
    if (res.reason === "unavailable") return { status: "unavailable", company: null, candidates: [] };
  }
  const czech = !doc.country || doc.country === "CZ";
  if (!czech || !doc.name || doc.name.length < 3) {
    return { status: invalid ? "invalid_ico" : ico ? "not_found" : "skipped", company: null, candidates: [] };
  }
  const found = await aresSearchByName(doc.name, 10);
  if (!found.ok) return { status: invalid ? "invalid_ico" : "unavailable", company: null, candidates: [] };
  const { pick, candidates } = pickAresByName(found.items, { name: doc.name, zip: doc.zip, city: doc.city });
  // IČO z dokladu bylo, ale v registru není / chybné → shoda podle názvu ho opraví (ukáže se jako by_name)
  if (pick) return { status: "by_name", company: pick, candidates: [] };
  if (candidates.length) return { status: invalid ? "invalid_ico" : "choose", company: null, candidates };
  return { status: invalid ? "invalid_ico" : "not_found", company: null, candidates: [] };
}

export interface PartyAutofillInput {
  kind: unknown;
  files?: unknown;
  text?: unknown;
  /** Upravovaná firma (u „Upravit" se sama za duplicitu nepovažuje). */
  exceptId?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function partyAutofill(input: PartyAutofillInput, signal?: AbortSignal | null): Promise<PartyAutofillResponse> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const kind: PartyKind | null = input?.kind === "customer" || input?.kind === "supplier" ? input.kind : null;
  if (!kind) return { ok: false, error: "Neplatný požadavek." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const access = await getAccess();
  if (!access.can(kind === "customer" ? "customers" : "suppliers")) return { ok: false, error: "K této akci nemáš oprávnění." };
  const exceptId = typeof input.exceptId === "string" && UUID_RE.test(input.exceptId) ? input.exceptId : null;
  const text = typeof input.text === "string" ? input.text.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT) : "";
  const hasFiles = Array.isArray(input.files) && input.files.length > 0;
  if (!hasFiles && !text) return { ok: false, error: "Vyfoť nebo nahraj doklad, nebo vlož text (třeba podpis z e-mailu)." };

  const db = (await createOperatorClient({ actor: userActor(user, "foto") })) as unknown as JobsDb;
  let paths: string[] = [];
  try {
    const prepared: Prepared = { blocks: [], texts: [] };
    if (hasFiles) {
      const refs = cleanFileRefs(user.id, input.files, MAX_FILES);
      if (typeof refs === "string") return { ok: false, error: refs };
      paths = refs.flatMap((f) => {
        const hires = captureHiresPath(f.path);
        return [f.path, ...(f.sortPath ? [f.sortPath] : []), ...(hires ? [hires] : [])];
      });
      const avail = await aiAvailable();
      if (!avail.ok) return avail;
      const budget = { bytes: 0 };
      for (const f of refs) {
        const { data, error } = await db.storage.from(CAPTURE_BUCKET).download(f.path);
        if (error || !data) return { ok: false, error: `Soubor ${f.filename} se nepodařilo načíst — nahraj ho prosím znovu.` };
        const err = await prepareFile(f.filename, new Uint8Array(await (data as Blob).arrayBuffer()), prepared, budget);
        if (err) return { ok: false, error: err };
      }
    } else {
      const avail = await aiAvailable();
      if (!avail.ok) return avail;
    }
    if (text) prepared.texts.push({ label: "Vložený text", text });

    let doc: PartyExtract;
    try {
      doc = (await readParty({ kind, blocks: prepared.blocks, texts: prepared.texts, clientSignal: signal ?? null })).party;
    } catch (err) {
      return { ok: false, error: aiFailureMessage(err) };
    }
    if (doc.onlyOurs && !doc.contacts.length && !doc.email) {
      return { ok: false, error: `Na podkladu jsme našli jen naši firmu — ${kind === "customer" ? "zákazníka" : "dodavatele"} z něj nepoznám. Zkus jiný doklad nebo napiš IČO.` };
    }
    if (!doc.name && !doc.ico && !doc.email && !doc.contacts.length && !doc.phone) {
      return { ok: false, error: "Na podkladu jsme žádné údaje o firmě nenašli — zkus jiný doklad nebo napiš IČO a klikni na „ARES“." };
    }

    const ares = await resolveAres(doc);
    const { fields, sources } = mergeWithAres(doc, ares.company);
    const warnings = [...doc.needsClarification];
    if (ares.company?.defunct) warnings.unshift(`Pozor: firma ${ares.company.name} v ARES zanikla${ares.company.defunctDate ? ` (${ares.company.defunctDate.split("-").reverse().join(". ")})` : ""}.`);
    if (doc.ico && ares.company && doc.ico !== ares.company.ico) warnings.push(`IČO na dokladu (${doc.ico}) se liší od ARES (${ares.company.ico}) — použito IČO z ARES.`);
    const duplicate = await findPartyDuplicate(db, kind, { name: fields.name, ico: fields.ico, dic: fields.dic }, exceptId);
    return {
      ok: true,
      kind,
      fields,
      sources,
      email: doc.email,
      phone: doc.phone,
      website: doc.website,
      contacts: doc.contacts,
      roleEmails: doc.roleEmails,
      paymentTermsDays: doc.paymentTermsDays,
      supplierNumberAtCustomer: doc.supplierNumberAtCustomer,
      deliveryAddress: doc.deliveryAddress,
      technologies: doc.technologies,
      materials: doc.materials,
      certifications: doc.certifications,
      ares: { status: ares.status, message: ARES_MESSAGE[ares.status], candidates: ares.candidates },
      duplicate,
      summary: doc.summary,
      documentKind: doc.documentKind,
      confidence: doc.confidence,
      warnings: [...new Set(warnings)].slice(0, 8),
    };
  } catch (err) {
    console.error(`[party-autofill] ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "Čtení podkladu se nepovedlo — zkus to znovu." };
  } finally {
    await removeCapture(db, paths);
  }
}

/** ARES podle IČO z dialogu (+ duplicita v adresáři). */
export async function partyAresLookup(input: { kind: unknown; ico: unknown; exceptId?: unknown }): Promise<AresLookupResponse> {
  const kind: PartyKind | null = input?.kind === "customer" || input?.kind === "supplier" ? input.kind : null;
  if (!kind) return { ok: false, error: "Neplatný požadavek." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const access = await getAccess();
  if (!access.can(kind === "customer" ? "customers" : "suppliers")) return { ok: false, error: "K této akci nemáš oprávnění." };
  const res = await aresByIco(String(input.ico ?? "").slice(0, 40));
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason };
  const exceptId = typeof input.exceptId === "string" && UUID_RE.test(input.exceptId) ? input.exceptId : null;
  let duplicate = null;
  if (isSupabaseConfigured()) {
    const db = await createOperatorClient({ actor: userActor(user) });
    duplicate = await findPartyDuplicate(db, kind, { name: res.company.name, ico: res.company.ico, dic: res.company.dic }, exceptId);
  }
  return { ok: true, company: res.company, duplicate };
}
