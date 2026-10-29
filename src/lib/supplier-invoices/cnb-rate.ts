import "server-only";
import { isFakeCapture } from "@/lib/ai/fake-capture";
import { parseCnbDaily } from "@/lib/supplier-invoices/cnb-parse";

/**
 * Kurz ČNB pro fakturu v cizí měně (Kč za 1 jednotku) ke dni DUZP (jinak vystavení). Bez kurzu se faktura
 * do nákladu zakázky NEPOČÍTÁ (nikdy 1:1 jako Kč) — kurz se pak doplní ručně.
 * TESTY: CNB_FAKE_RATES="EUR=24.335;USD=22.1" (bez sítě); v testovacím režimu AI bez té proměnné → null.
 */

const URL = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";
const TIMEOUT_MS = 4_000;
const cache = new Map<string, { at: number; text: string }>();
const TTL_MS = 12 * 3600_000;

function fakeRates(): Record<string, number> | null {
  const raw = process.env.CNB_FAKE_RATES;
  if (!raw) return null;
  const out: Record<string, number> = {};
  for (const part of raw.split(/[;,]/)) {
    const [k, v] = part.split("=");
    const n = Number(String(v ?? "").replace(",", "."));
    if (k && Number.isFinite(n) && n > 0) out[k.trim().toUpperCase()] = n;
  }
  return out;
}

function czDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Kurz ČNB měny ke dni (RRRR-MM-DD; prázdné = dnes). null = nevím (síť, neznámá měna). */
export async function cnbRate(currency: string, dateIso?: string | null): Promise<number | null> {
  const cur = String(currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || cur === "CZK") return null;
  const fake = fakeRates();
  if (fake) return fake[cur] ?? null;
  if (isFakeCapture() || process.env.SUPPLIER_INVOICE_CNB === "off") return null;
  const day = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : new Date().toISOString().slice(0, 10);
  // budoucí datum → dnešní kurz
  const today = new Date().toISOString().slice(0, 10);
  const key = day > today ? today : day;
  try {
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${URL}?date=${czDate(key)}`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) return null;
        hit = { at: Date.now(), text: await res.text() };
        cache.set(key, hit);
      } finally {
        clearTimeout(t);
      }
    }
    return parseCnbDaily(hit.text)[cur] ?? null;
  } catch {
    return null;
  }
}
