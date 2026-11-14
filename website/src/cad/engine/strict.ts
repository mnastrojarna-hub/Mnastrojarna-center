/**
 * Přísný režim (CAD-HEADLESS-NAVRH.md kap. 5.3, balík B4 strict-silent).
 *
 * * Zapnutí: volba běhu (`--strict`, `strict: true`, `--strict=kromě kód,…`) nebo řádek skriptu `přísně` (EN `strict`,
 *   DE `streng`) – platí od toho řádku; `přísně vyp` vypne, `přísně kromě kód[,kód]` = výjimky (kód nebo předpona `hole.`).
 * * Chyby a varování rozboru: v přísném úseku se neprovede nic (všechny se vypíšou, STOP na prvním).
 * * Za běhu zastaví první ⚠ nebo ✗ (kromě výjimek); ℹ nikdy nezastaví. Relace zůstane, výstupy `--formats` se nezapíšou.
 *
 * **Úseky podle řádků:** o zastavení rozhoduje stav přísného režimu na řádku záznamu (volba běhu + řádky `přísně` nad ním),
 * záznam bez řádku (závěrečná stavba, výstupy CLI) se posoudí podle stavu na konci skriptu. Smyčka běhu (`engine/run.ts`),
 * závěr běhu v prohlížeči i pojistka CLI (`cli/job.ts`) se ptají téže funkce `hit` – stejný skript tak zastaví (nebo
 * nezastaví) stejně v konzoli prohlížeče i v CLI. Záznamy posouzené dřív, než skript začal (`--open`), jsou `settled`.
 */
import type { Entry } from "./protocol-types";

/** volba přísného režimu: vyp / zap / zap s výjimkami (kódy nebo předpony končící tečkou) */
export type StrictOpt = boolean | { except: string[] };

/** příkaz `přísně [vyp] [kromě kód,…]` z rozboru skriptu */
export type StrictCmd = { on: boolean; except?: string[] };
/** řádek `přísně …` skriptu (pro stav přísného režimu na libovolném řádku) */
export type StrictMark = StrictCmd & { line: number };

/** kód odpovídá výjimce: přesně, nebo předponou („hole.“ / „hole“ = všechny `hole.*`) */
export function excepted(code: string | undefined, except: ReadonlySet<string> | readonly string[]): boolean {
  const list = [...except];
  if (!code || !list.length) return false;
  for (const x of list) if (code === x || code.startsWith(x.endsWith(".") ? x : `${x}.`)) return true;
  return false;
}

/** první záznam, na kterém přísný režim zastaví (⚠ / ✗ mimo výjimky); ℹ, ✓ a výpisy nikdy */
export function stopEntry(entries: readonly Entry[], except: ReadonlySet<string> | readonly string[]): Entry | undefined {
  return entries.find((e) => (e.level === "error" || e.level === "warn") && !excepted(e.code, except));
}

export class StrictState {
  on: boolean;
  except: Set<string>;
  /** přísný režim byl v běhu někdy zapnutý (hlavička JSON `strict`) */
  used: boolean;
  /** záznamy posouzené mimo smyčku běhu (CLI `--open` před skriptem) – `hit` je už neposuzuje */
  readonly settled = new WeakSet<Entry>();
  private readonly opt0: StrictOpt;
  private readonly marks: StrictMark[];

  /** `o` = volba běhu, `marks` = řádky `přísně …` skriptu (stav na řádku = volba + řádky nad ním) */
  constructor(o: StrictOpt | undefined = false, marks: readonly StrictMark[] = []) {
    this.opt0 = o ?? false;
    this.on = !!o;
    this.except = new Set(typeof o === "object" && o ? o.except : []);
    this.used = this.on || marks.some((m) => m.on);
    this.marks = [...marks].sort((a, b) => a.line - b.line);
  }

  /** řádek `přísně …`: zapne / vypne; výjimky nového zapnutí nahradí dosavadní, `přísně kromě …` za zapnutým je přidá */
  apply(c: StrictCmd): void {
    if (!c.on) {
      this.on = false;
      return;
    }
    if (c.except?.length) for (const x of c.except) this.except.add(x);
    else if (!this.on) this.except.clear();
    this.on = true;
    this.used = true;
  }

  /**
   * Stav na řádku `line` (volba běhu + řádky `přísně` NAD ním); `null` = stav na konci skriptu (po všech řádcích
   * `přísně`) – pro záznamy bez řádku (závěrečná stavba, výstupy).
   */
  at(line: number | null): { on: boolean; except: ReadonlySet<string> } {
    const s = new StrictState(this.opt0);
    for (const m of this.marks) if (line === null || m.line < line) s.apply(m);
    return s;
  }

  /**
   * První záznam, na kterém se má běh zastavit: ⚠/✗ (mimo výjimky) na řádku, kde přísný režim platí. Záznam bez řádku se
   * posoudí podle `fallback` (řádek právě provedené operace; `null` = konec skriptu). ℹ nikdy; `settled` se přeskočí.
   */
  hit(entries: readonly Entry[], fallback: number | null): Entry | undefined {
    const cache = new Map<number | null, { on: boolean; except: ReadonlySet<string> }>();
    const at = (l: number | null) => {
      let s = cache.get(l);
      if (!s) cache.set(l, (s = this.at(l)));
      return s;
    };
    return entries.find((e) => {
      if (this.settled.has(e) || (e.level !== "error" && e.level !== "warn")) return false;
      const s = at(e.line ?? fallback);
      return s.on && !excepted(e.code, s.except);
    });
  }

  /**
   * Kód `code` na řádku `line` platí v přísném úseku a není výjimkou (`přísně kromě …`, `--strict=kromě …`) – pro nálezy,
   * které přísný režim zvyšuje z ⚠ na ✗ (automatický výklad vstupu, např. `drawing.section-legacy`); výjimka zůstane ⚠
   * a běh nezastaví, stejně jako u `hit`.
   */
  escalates(code: string, line: number | null): boolean {
    const s = this.at(line);
    return s.on && !excepted(code, s.except);
  }

  /** záznam, na kterém se má běh zastavit (jen v zapnutém režimu – stav právě prováděného řádku) */
  stopper(entries: readonly Entry[]): Entry | undefined {
    return this.on ? stopEntry(entries, this.except) : undefined;
  }

  /** stav jako volba (CLI: závěrečná stavba, výstupy a kód ukončení podle stavu na konci skriptu) */
  get opt(): StrictOpt {
    return this.on ? (this.except.size ? { except: [...this.except] } : true) : false;
  }

  clone(): StrictState {
    const s = new StrictState(this.opt0, this.marks);
    s.on = this.on;
    s.except = new Set(this.except);
    s.used = this.used;
    return s;
  }
}
