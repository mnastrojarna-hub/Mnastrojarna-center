import QRCode from "qrcode";

/**
 * QR Platba (formát SPD 1.0 České bankovní asociace) — čisté funkce bez DB.
 * SPD*1.0*ACC:<IBAN>[+<BIC>]*AM:<částka>*CC:CZK*X-VS:<VS>*DT:<YYYYMMDD>*MSG:<zpráva>
 * Generuje se jen ze skutečného IBANu (z Nastavení) — nic se nedomýšlí.
 */

export interface SpdInput {
  iban: string;
  bic?: string;
  amount?: number;
  currency?: string;
  variableSymbol?: string;
  /** Datum splatnosti YYYY-MM-DD. */
  dueDate?: string;
  message?: string;
}

/** IBAN bez mezer, velkými písmeny. */
export function normalizeIban(value: string): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Kontrola tvaru a kontrolního součtu IBAN (mod 97). */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Částka s desetinnou tečkou a 2 místy; nekladná / nesmyslná → undefined. */
export function spdAmount(amount?: number): string | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  const s = amount.toFixed(2);
  return s.length <= 10 ? s : undefined; // SPD: max 10 znaků (9 999 999.99)
}

/** Variabilní symbol: jen číslice, max 10 (delší → posledních 10). */
export function spdVariableSymbol(value?: string): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Zpráva pro příjemce: bez diakritiky a „*", jeden řádek, max 60 znaků. */
export function spdMessage(value?: string): string | undefined {
  const s = (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\*/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return s || undefined;
}

function spdDate(value?: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[1]}${m[2]}${m[3]}` : undefined;
}

/** Řetězec QR Platby, nebo null, když IBAN chybí / je neplatný. */
export function buildSpdString(input: SpdInput): string | null {
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) return null;
  const bic = (input.bic ?? "").replace(/\s+/g, "").toUpperCase();
  const acc = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic) ? `${iban}+${bic}` : iban;

  const parts = ["SPD", "1.0", `ACC:${acc}`];
  const am = spdAmount(input.amount);
  if (am) parts.push(`AM:${am}`);
  const cc = (input.currency || "CZK").toUpperCase();
  if (/^[A-Z]{3}$/.test(cc)) parts.push(`CC:${cc}`);
  const vs = spdVariableSymbol(input.variableSymbol);
  if (vs) parts.push(`X-VS:${vs}`);
  const dt = spdDate(input.dueDate);
  if (dt) parts.push(`DT:${dt}`);
  const msg = spdMessage(input.message);
  if (msg) parts.push(`MSG:${msg}`);
  return parts.join("*");
}

// ── Matice QR kódu (vektorové vykreslení v PDF) ─────────────

export interface QrMatrix {
  size: number;
  /** modules[row][col] = tmavý modul. */
  modules: boolean[][];
}

export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const modules: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(Boolean(qr.modules.get(r, c)));
    modules.push(row);
  }
  return { size, modules };
}

export interface QrRun {
  x: number;
  y: number;
  w: number;
}

/** Sloučí sousední tmavé moduly v řádku do obdélníků (méně prvků v PDF, bez švů). */
export function qrRuns(m: QrMatrix): QrRun[] {
  const runs: QrRun[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.modules[y][x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.size && m.modules[y][x]) x++;
      runs.push({ x: start, y, w: x - start });
    }
  }
  return runs;
}
