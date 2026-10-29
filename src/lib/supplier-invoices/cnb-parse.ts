// Kurzovní lístek ČNB (denni_kurz.txt): „země|měna|množství|kód|kurz" → Kč za 1 jednotku měny.

export function parseCnbDaily(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const cols = line.split("|");
    if (cols.length < 5) continue;
    const amount = Number(cols[2].replace(/\s+/g, "").replace(",", "."));
    const code = cols[3].trim().toUpperCase();
    const rate = Number(cols[4].replace(/\s+/g, "").replace(",", "."));
    if (!/^[A-Z]{3}$/.test(code) || !(amount > 0) || !(rate > 0)) continue;
    out[code] = Math.round((rate / amount) * 1e6) / 1e6;
  }
  return out;
}
