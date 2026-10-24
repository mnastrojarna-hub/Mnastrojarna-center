/**
 * Nastavení anonymizace výkresů (drawing_anon_settings, jeden řádek) — čistý modul:
 * výchozí hodnoty, normalizace řádku z DB a validace vstupu z formuláře Nastavení.
 */

import { DEFAULT_REDACT, type RedactToggles } from "./rules";
import { sha256Hex } from "./text";

/** Verze detektoru — změna = přepočet (anon_config_hash). */
export const DETECTOR_VERSION = "anon-v1.0";

export interface AnonSettings {
  enabled: boolean;
  autoCapture: boolean;
  autoUpload: boolean;
  autoEmail: boolean;
  hiresCapture: boolean;
  redact: RedactToggles;
  extraTerms: string[];
  keepTerms: string[];
  includeCrmCustomer: boolean;
  fillPdf: "white" | "black";
  fillPhoto: "background" | "white" | "black";
  maxDpi: number;
  maxMpx: number;
  verifyPhotos: boolean;
  dailyUsd: number;
}

export const DEFAULT_ANON_SETTINGS: AnonSettings = {
  enabled: true, autoCapture: true, autoUpload: true, autoEmail: true, hiresCapture: true,
  redact: { ...DEFAULT_REDACT }, extraTerms: [], keepTerms: ["Mnástrojárna", "Mnastrojarna"], includeCrmCustomer: true,
  fillPdf: "white", fillPhoto: "background", maxDpi: 300, maxMpx: 40, verifyPhotos: true, dailyUsd: 5,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function cleanTerms(v: unknown, max = 100): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const t = x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeRedact(v: unknown): RedactToggles {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_REDACT };
  for (const k of Object.keys(DEFAULT_REDACT) as (keyof RedactToggles)[]) out[k] = bool(o[k], DEFAULT_REDACT[k]);
  return out;
}

/** Řádek z DB (snake_case) → nastavení. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): AnonSettings {
  if (!row) return { ...DEFAULT_ANON_SETTINGS, redact: { ...DEFAULT_REDACT } };
  const d = DEFAULT_ANON_SETTINGS;
  return {
    enabled: bool(row.enabled, d.enabled),
    autoCapture: bool(row.auto_capture, d.autoCapture),
    autoUpload: bool(row.auto_upload, d.autoUpload),
    autoEmail: bool(row.auto_email, d.autoEmail),
    hiresCapture: bool(row.hires_capture, d.hiresCapture),
    redact: normalizeRedact(row.redact),
    extraTerms: cleanTerms(row.extra_terms),
    keepTerms: cleanTerms(row.keep_terms).length ? cleanTerms(row.keep_terms) : [...d.keepTerms],
    includeCrmCustomer: bool(row.include_crm_customer, d.includeCrmCustomer),
    fillPdf: row.fill_pdf === "black" ? "black" : "white",
    fillPhoto: row.fill_photo === "white" || row.fill_photo === "black" ? row.fill_photo : "background",
    maxDpi: clampNum(row.max_dpi, 100, 600, d.maxDpi),
    maxMpx: clampNum(row.max_mpx, 4, 60, d.maxMpx),
    verifyPhotos: bool(row.verify_photos, d.verifyPhotos),
    dailyUsd: clampNum(row.daily_usd, 0, 1000, d.dailyUsd),
  };
}

/** Nastavení → řádek pro zápis (validace vstupu formuláře). */
export function settingsToRow(s: Partial<AnonSettings>): Record<string, unknown> {
  const m = { ...DEFAULT_ANON_SETTINGS, ...s };
  return {
    enabled: Boolean(m.enabled),
    auto_capture: Boolean(m.autoCapture),
    auto_upload: Boolean(m.autoUpload),
    auto_email: Boolean(m.autoEmail),
    hires_capture: Boolean(m.hiresCapture),
    redact: normalizeRedact(m.redact),
    extra_terms: cleanTerms(m.extraTerms),
    keep_terms: cleanTerms(m.keepTerms),
    include_crm_customer: Boolean(m.includeCrmCustomer),
    fill_pdf: m.fillPdf === "black" ? "black" : "white",
    fill_photo: m.fillPhoto === "white" || m.fillPhoto === "black" ? m.fillPhoto : "background",
    max_dpi: Math.round(clampNum(m.maxDpi, 100, 600, 300)),
    max_mpx: Math.round(clampNum(m.maxMpx, 4, 60, 40)),
    verify_photos: Boolean(m.verifyPhotos),
    daily_usd: Math.round(clampNum(m.dailyUsd, 0, 1000, 5) * 100) / 100,
  };
}

/** Hash verze detektoru + nastavení BEZ termínů (termíny má anon_terms_hash). */
export async function configHash(s: AnonSettings): Promise<string> {
  const payload = JSON.stringify({
    v: DETECTOR_VERSION, redact: s.redact, fillPdf: s.fillPdf, fillPhoto: s.fillPhoto, maxDpi: s.maxDpi, maxMpx: s.maxMpx,
    verifyPhotos: s.verifyPhotos, keep: [...s.keepTerms].sort(),
  });
  return (await sha256Hex(payload)).slice(0, 32);
}

export async function termsHash(terms: readonly string[]): Promise<string> {
  return (await sha256Hex(JSON.stringify([...new Set(terms.map((t) => t.toLowerCase()))].sort()))).slice(0, 32);
}
