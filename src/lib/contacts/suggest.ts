/**
 * Našeptávač e-mailových adres — sloučení a řazení kandidátů z adresáře (zákazníci, kontaktní osoby,
 * dodavatelé, kolegové) a z konverzací. Čistá logika (testy v suggest.test.ts), DB čte suggest-server.ts.
 */

export type SuggestionKind = "kontakt" | "zákazník" | "dodavatel" | "kolega" | "konverzace";

export interface RecipientSuggestion {
  email: string;
  /** Jméno osoby nebo firmy. */
  name: string;
  kind: SuggestionKind;
  /** Firma (u kontaktní osoby / konverzace s doménou zákazníka). */
  company?: string | null;
  position?: string | null;
  phone?: string | null;
  /** Účel adresy („Fakturace", „Nabídky"). */
  roles?: string[];
  /** Kolikrát a kdy naposledy v poště (u konverzací i u adresáře). */
  hits?: number;
  lastAt?: string | null;
  /** Patří k zákazníkovi / dodavateli otevřené zakázky (nahoře i bez psaní). */
  related?: boolean;
}

const KIND_WEIGHT: Record<SuggestionKind, number> = { kontakt: 8, "zákazník": 5, dodavatel: 5, kolega: 4, konverzace: 0 };

export function foldText(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Jak dobře kandidát odpovídá dotazu (0 = vůbec). Bez diakritiky, začátek slova má přednost. */
export function matchScore(s: Pick<RecipientSuggestion, "email" | "name" | "company">, query: string): number {
  const q = foldText(query).trim();
  if (!q) return 1;
  const email = foldText(s.email);
  const name = foldText(s.name);
  const company = foldText(s.company);
  if (email.startsWith(q)) return 60;
  if (name.startsWith(q)) return 55;
  const words = `${name} ${company}`.split(/[\s.,()\-–]+/);
  if (words.some((w) => w.startsWith(q))) return 45;
  if (email.split(/[@._-]/).some((w) => w.startsWith(q))) return 40;
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => `${name} ${company} ${email}`.includes(p))) return 35;
  if (email.includes(q) || name.includes(q) || company.includes(q)) return 20;
  return 0;
}

function recency(lastAt: string | null | undefined, now: number): number {
  if (!lastAt) return 0;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / 86_400_000;
  if (days <= 14) return 20;
  if (days <= 60) return 14;
  if (days <= 180) return 8;
  if (days <= 365) return 4;
  return 1;
}

/**
 * Sloučí kandidáty (stejná adresa = jeden záznam: bohatší údaje z adresáře, četnost z pošty) a seřadí:
 * shoda s dotazem, souvislost se zakázkou, četnost a čerstvost v poště, druh. Vyřadí `exclude` (už vybrané).
 */
export function mergeSuggestions(
  lists: RecipientSuggestion[][],
  query: string,
  opts: { exclude?: string[]; limit?: number; now?: number } = {},
): RecipientSuggestion[] {
  const byEmail = new Map<string, RecipientSuggestion>();
  const exclude = new Set((opts.exclude ?? []).map((e) => e.toLowerCase()));
  for (const list of lists) {
    for (const raw of list) {
      const email = raw.email.trim().toLowerCase();
      if (!email || exclude.has(email)) continue;
      const cur = byEmail.get(email);
      if (!cur) {
        byEmail.set(email, { ...raw, email, roles: raw.roles ? [...raw.roles] : undefined });
        continue;
      }
      const richer = KIND_WEIGHT[raw.kind] > KIND_WEIGHT[cur.kind];
      const base = richer ? { ...raw, email } : cur;
      const other = richer ? cur : raw;
      byEmail.set(email, {
        ...base,
        name: base.name && base.name !== email ? base.name : other.name || email,
        company: base.company ?? other.company ?? null,
        position: base.position ?? other.position ?? null,
        phone: base.phone ?? other.phone ?? null,
        roles: [...new Set([...(cur.roles ?? []), ...(raw.roles ?? [])])],
        hits: Math.max(cur.hits ?? 0, raw.hits ?? 0) || undefined,
        lastAt: [cur.lastAt, raw.lastAt].filter(Boolean).sort().pop() ?? null,
        related: Boolean(cur.related || raw.related),
      });
    }
  }
  const now = opts.now ?? Date.now();
  const scored = [...byEmail.values()]
    .map((s) => {
      const m = matchScore(s, query);
      const score = m === 0 ? -1
        : m + (s.related ? 30 : 0) + Math.min(24, Math.log2(1 + (s.hits ?? 0)) * 6) + recency(s.lastAt, now) + KIND_WEIGHT[s.kind] + (s.roles?.length ? 3 : 0);
      return { s, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name, "cs"));
  return scored.slice(0, opts.limit ?? 10).map((x) => ({ ...x.s, roles: x.s.roles?.length ? x.s.roles : undefined }));
}

/** Druhý řádek položky: „Bosch s.r.o. · nákupčí · Fakturace · 12× v poště". */
export function suggestionDetail(s: RecipientSuggestion): string {
  const parts: string[] = [];
  if (s.company && s.company !== s.name) parts.push(s.company);
  if (s.position) parts.push(s.position);
  if (s.roles?.length) parts.push(s.roles.join(", "));
  if (s.kind === "kolega") parts.push("kolega");
  else if (s.kind === "konverzace" && s.hits) parts.push(`${s.hits}× v poště`);
  else if (s.kind === "dodavatel" && !s.company) parts.push("dodavatel");
  else if (s.kind === "zákazník" && !s.company) parts.push("zákazník");
  return parts.join(" · ");
}

/** Vložený text „Jan <a@b.cz>; c@d.cz, x" → adresy + zbytek, který adresou není. */
export function splitPasted(text: string): { emails: string[]; rest: string[] } {
  const emails: string[] = [];
  const rest: string[] = [];
  for (const raw of String(text ?? "").split(/[,;\n\t]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const found = part.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
    if (found?.length) {
      for (const f of found) {
        const e = f.toLowerCase();
        if (!emails.includes(e)) emails.push(e);
      }
    } else rest.push(part);
  }
  return { emails, rest };
}
