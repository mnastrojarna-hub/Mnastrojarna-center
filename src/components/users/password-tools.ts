/**
 * Pravidla a pomůcky pro hesla — čistá logika bez závislostí na Node,
 * sdílí ji klient (formuláře) i server (akce). Testováno.
 */

export const MIN_PASSWORD_LENGTH = 8;
/** Supabase (bcrypt) ořezává hesla nad 72 bajtů. */
export const MAX_PASSWORD_LENGTH = 72;

/** Vrátí českou chybu, nebo null když je heslo v pořádku. */
export function passwordProblem(password: string, confirm?: string): string | null {
  const pw = password ?? "";
  if (pw.length < MIN_PASSWORD_LENGTH) return `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků.`;
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_LENGTH) return "Heslo je příliš dlouhé (max. 72 znaků).";
  if (pw.trim().length === 0) return "Heslo nesmí být jen z mezer.";
  if (confirm !== undefined && pw !== confirm) return "Hesla se neshodují.";
  return null;
}

// Bez zaměnitelných znaků (0/O, 1/l/I) — heslo jde nadiktovat do telefonu.
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "-_!?+";

function randomIndex(max: number): number {
  // rovnoměrně (rejection sampling), crypto je v prohlížeči i v Node 19+
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function pick(chars: string): string {
  return chars[randomIndex(chars.length)];
}

/** Čitelné náhodné heslo: malá + velká písmena, číslice a jeden symbol. */
export function generatePassword(length = 12): string {
  const len = Math.max(MIN_PASSWORD_LENGTH, Math.min(length, 64));
  const all = LOWER + UPPER + DIGITS;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < len) chars.push(pick(all));
  // zamíchat (Fisher–Yates), symbol nesmí být na začátku ani na konci
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const isSym = (c: string) => SYMBOLS.includes(c);
  if (isSym(chars[0]) || isSym(chars[chars.length - 1])) {
    const symAt = chars.findIndex(isSym);
    const mid = Math.floor(chars.length / 2);
    [chars[symAt], chars[mid]] = [chars[mid], chars[symAt]];
  }
  return chars.join("");
}

export interface PasswordStrength {
  /** 0 = nic, 1 = slabé … 4 = výborné */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Tailwind třída barvy ukazatele. */
  color: string;
}

/** Jednoduchý ukazatel síly hesla pro formuláře. */
export function passwordStrength(password: string): PasswordStrength {
  const pw = password ?? "";
  if (!pw) return { score: 0, label: "", color: "bg-muted" };
  let points = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) points++;
  if (pw.length >= 12) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;
  if (/^(.)\1+$/.test(pw) || /^(?:12345678|password|heslo123|qwertyui)/i.test(pw)) points = 0;
  if (pw.length < MIN_PASSWORD_LENGTH) points = Math.min(points, 1);

  const score = (Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4);
  const meta: Record<1 | 2 | 3 | 4, { label: string; color: string }> = {
    1: { label: "Slabé", color: "bg-red-500" },
    2: { label: "Ujde", color: "bg-amber-500" },
    3: { label: "Dobré", color: "bg-lime-500" },
    4: { label: "Výborné", color: "bg-emerald-500" },
  };
  return { score, ...meta[score] };
}
