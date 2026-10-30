import "server-only";
import { createHash } from "node:crypto";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { guessFileKind } from "@/lib/jobs/file-kinds";
import { CANDIDATE_KINDS, UNSUPPORTED_PREFIX } from "./candidate";
import type { AnonDb, Subject } from "./queue";

/**
 * Archiv ZIP / e-mail .eml mezi soubory zakázky (příloha od zákazníka, ruční nahrání): rozbalí se do
 * SAMOSTATNÝCH souborů zakázky (stejný původ, vystavitel a nahrávající), každý se pak anonymizuje sám
 * (trigger je zařadí, běh je zpracuje hned — AnonRunResult.spawned). Archiv sám zůstává „nelze
 * anonymizovat" (k dodavateli nikdy; posílají se rozbalené výkresy).
 *
 * Idempotence: cesta položky v úložišti je odvozená (archiv + pořadí + název) — opakovaný běh nic
 * nezdvojí. Limity (počet, velikost, ZIP bomba) z dávkového focení (unzipLimited).
 */

const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
/** Malé vložené obrázky v e-mailu (logo v podpisu, ikony) nejsou podklad. */
const INLINE_IMAGE_MAX = 100 * 1024;

export interface ContainerEntry {
  name: string;
  data: Uint8Array;
  mime: string;
}

/** Bezpečný název do cesty úložiště (A–Z, 0–9, . _ -). */
function safePart(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "soubor").slice(-100);
}

/** UUID odvozené z obsahu (stabilní cesta při opakovaném běhu). */
function derivedUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Položky e-mailu (přílohy; vložené malé obrázky z podpisu vynechány). */
export async function emlEntries(bytes: Uint8Array): Promise<ContainerEntry[]> {
  const { mimeLeaves, isAttachmentLeaf, decodePart } = await import("@/lib/email/mime-parts");
  const out: ContainerEntry[] = [];
  for (const leaf of mimeLeaves(Buffer.from(bytes))) {
    if (!isAttachmentLeaf(leaf)) continue;
    const data = new Uint8Array(decodePart(leaf));
    if (!data.length) continue;
    if (leaf.contentType.startsWith("image/") && leaf.disposition !== "attachment" && data.length < INLINE_IMAGE_MAX) continue;
    const ext = leaf.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
    out.push({ name: leaf.filename || `priloha-${leaf.partId}.${ext}`, data, mime: leaf.contentType });
  }
  return out;
}

export async function explodeContainer(db: AnonDb, s: Subject, bytes: Uint8Array, fmt: "zip" | "eml"): Promise<{ reason: string; spawned: string[] }> {
  const what = fmt === "zip" ? "archiv ZIP" : "e-mail";
  let entries: ContainerEntry[] = [];
  const skipped: string[] = [];
  if (fmt === "zip") {
    const { unzipLimited, mimeFromName } = await import("@/lib/jobs/capture-files");
    const r = unzipLimited(bytes);
    if (!r.ok) {
      const why = r.reason.replace(/\s*—\s*přiložen celý\.?$/, "").replace(/\.$/, "");
      return { reason: `${UNSUPPORTED_PREFIX} (${what}: ${why.charAt(0).toLowerCase()}${why.slice(1)}) — rozbal ho a nahraj výkresy jednotlivě.`, spawned: [] };
    }
    entries = r.entries.map((e) => ({ ...e, mime: mimeFromName(e.name) }));
  } else {
    try {
      entries = await emlEntries(bytes);
    } catch {
      return { reason: `${UNSUPPORTED_PREFIX} (${what} nejde přečíst) — ulož přílohy a nahraj je zvlášť.`, spawned: [] };
    }
  }
  if (!entries.length) {
    return { reason: fmt === "zip" ? `${UNSUPPORTED_PREFIX} (archiv ZIP je prázdný).` : "E-mail bez příloh — k dodavateli se neposílá (jen text zákazníka).", spawned: [] };
  }
  const spawned: string[] = [];
  const jobId = String(s.jobId ?? "").toLowerCase();
  const parentKind = s.kind ?? "ostatni";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.data.length > MAX_ENTRY_BYTES) { skipped.push(e.name); continue; }
    const path = `zakazky/${jobId}/${derivedUuid(`${s.id}|${i}|${e.name}`)}-${safePart(e.name)}`;
    const { data: have } = await db.from("job_files").select("id").eq("storage_path", path).maybeSingle();
    if (have) { spawned.push((have as { id: string }).id); continue; }
    const { error: upErr } = await db.storage.from("job-files").upload(path, e.data, { contentType: e.mime || "application/octet-stream", upsert: true });
    if (upErr) throw new Error(`Rozbalení ${what}u selhalo: ${upErr.message}`);
    const guessed = guessFileKind(e.name, e.mime);
    // položka z podkladů zákazníka zůstává podkladem zákazníka (faktura v ZIPu od zákazníka = ostatní)
    const kind = (CANDIDATE_KINDS as readonly string[]).includes(guessed) || guessed === "korespondence" ? guessed
      : (CANDIDATE_KINDS as readonly string[]).includes(parentKind) && parentKind !== "poptavka" && parentKind !== "objednavka" ? parentKind : "ostatni";
    const { data: ins, error } = await db.from("job_files").insert({
      job_id: jobId, kind, filename: e.name.slice(0, 200), mime_type: e.mime || null, size_bytes: e.data.length, storage_path: path,
      origin: s.origin ?? "upload", issuer: s.issuer, uploaded_by: s.uploadedBy, note: `Z ${fmt === "zip" ? "archivu" : "e-mailu"} ${s.filename}`.slice(0, 500),
      content_sha256: createHash("sha256").update(e.data).digest("hex"),
      // obsah archivu / e-mailu je originál (nikdo ho nezmenšoval) → zdroj anonymizace v plném rozlišení
      anon_source_path: path,
    }).select("id").single();
    if (error || !ins) {
      await db.storage.from("job-files").remove([path]).catch(() => undefined);
      throw new Error(`Rozbalení ${what}u selhalo: ${error?.message ?? "záznam nevznikl"}`);
    }
    spawned.push((ins as { id: string }).id);
  }
  const n = spawned.length;
  const files = `${n} ${n === 1 ? "soubor" : n >= 2 && n <= 4 ? "soubory" : "souborů"}`;
  if (jobId && n) {
    await logJobEvent(db as unknown as JobsDb, {
      jobId, type: "file", message: `${fmt === "zip" ? "Archiv" : "E-mail"} ${s.filename} rozbalen: ${files} — výkresy se anonymizují jednotlivě`,
      data: { fileId: s.id, spawned }, actorId: null, actorKind: "system", via: "automaticky", agent: "anonymizace", entity: "file", entityId: s.id,
    });
  }
  const tooBig = skipped.length ? ` ${skipped.length} ${skipped.length === 1 ? "soubor je větší" : "soubory jsou větší"} než 50 MB — rozděl je.` : "";
  return {
    reason: `Rozbaleno do ${n} ${n === 1 ? "souboru" : "souborů"} — anonymizují se jednotlivě, dodavateli pošli je (ne ${fmt === "zip" ? "archiv" : "e-mail"}).${tooBig}`,
    spawned,
  };
}
