/**
 * Spodní list (bottom sheet) na mobilu – čistá logika tažení dolů a návratu tlačítkem Zpět.
 * Bez DOM a Reactu, aby šla otestovat (sheet-drag.test.ts); DOM a posluchače jsou v use-sheet-drag.ts,
 * komponenty v bottom-sheet.tsx. Jedna logika pro všechny spodní listy CADu (nabídky pásu karet,
 * nabídka Soubor, seznam dokumentů, panel prvku / komponenty na úzkém displeji).
 */

/** px pohybu prstu, než se rozhodne, zda jde o tažení listu, nebo o posun obsahu / klepnutí */
export const SHEET_SLOP = 6;
/** list se zavře po stažení alespoň o tuto část své výšky */
export const SHEET_CLOSE_FRACTION = 0.25;
/** rychlé švihnutí dolů (px/ms) list zavře i při kratší dráze */
export const SHEET_FLICK_VELOCITY = 0.5;
/** nejkratší dráha švihnutí (px) – drobné cuknutí list nezavře */
export const SHEET_FLICK_MIN = 24;
/** rychlost se počítá z pohybu za posledních N ms před puštěním */
export const SHEET_VELOCITY_WINDOW = 100;

export type SheetGestureStart = {
  /** dotyk začal na úchytu nebo záhlaví listu */
  fromGrip: boolean;
  /** všechny posuvné prvky mezi místem dotyku a listem jsou nahoře (scrollTop == 0) */
  scrolledTop: boolean;
};

/**
 * Rozhodnutí po prvním výraznějším pohybu prstu:
 * - „pending“ – pohyb je zatím v toleranci (může to být klepnutí),
 * - „drag“ – list se táhne za prstem,
 * - „native“ – gesto patří obsahu (posun seznamu, vodorovný posun, tažení nahoru v obsahu).
 * Úchyt / záhlaví táhne list vždy při svislém pohybu; obsah jen dolů a jen když je posunutý úplně nahoře.
 */
export function sheetGestureStart(g: SheetGestureStart, dx: number, dy: number): "pending" | "drag" | "native" {
  if (Math.abs(dx) < SHEET_SLOP && Math.abs(dy) < SHEET_SLOP) return "pending";
  if (Math.abs(dx) > Math.abs(dy)) return "native";
  if (g.fromGrip) return "drag";
  return dy > 0 && g.scrolledTop ? "drag" : "native";
}

/** posun listu za prstem: dolů 1 : 1, nahoru (nad otevřenou polohu) jen mírný odpor */
export function sheetOffset(dy: number): number {
  if (dy >= 0) return dy;
  return -Math.min(16, Math.sqrt(-dy) * 2);
}

/** Po puštění: zavřít (stažení ≥ 25 % výšky nebo rychlé švihnutí dolů), jinak vrátit na místo. */
export function sheetRelease(dy: number, height: number, velocity: number): "close" | "snap" {
  if (!(dy > 0)) return "snap";
  if (height > 0 && dy >= height * SHEET_CLOSE_FRACTION) return "close";
  if (velocity >= SHEET_FLICK_VELOCITY && dy >= SHEET_FLICK_MIN) return "close";
  return "snap";
}

/** Rychlost prstu (px/ms, kladná = dolů) z posledních vzorků; zastavení před puštěním = 0. */
export class SheetVelocity {
  private s: { t: number; y: number }[] = [];
  add(t: number, y: number) {
    this.s.push({ t, y });
    while (this.s.length > 2 && t - this.s[0].t > SHEET_VELOCITY_WINDOW) this.s.shift();
  }
  velocity(now: number): number {
    const recent = this.s.filter((p) => now - p.t <= SHEET_VELOCITY_WINDOW);
    if (recent.length < 2) return 0;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }
}

/**
 * Zásobník otevřených spodních listů a jeden záznam v historii prohlížeče („Zpět“ list zavře, nikoli stránku).
 * `env` obaluje window.history (v testu náhrada). Pravidla:
 * - první otevřený list přidá jeden záznam (pushState se stejnou adresou), další listy ho sdílejí;
 * - systémové Zpět (popstate) zavře horní list; zůstane-li otevřený další, záznam se přidá znovu;
 * - zavření jinak (tažení, podklad, křížek, Esc, položka nabídky) vrátí vlastní záznam (history.back),
 *   a jen pokud je náš záznam pořád nahoře – cizí navigaci nevrací;
 * - popstate vyvolaný naším history.back se nepočítá jako Zpět uživatele.
 */
export type SheetHistoryEnv = { push(): void; back(): void; isOurs(): boolean };
export type SheetHandle = { close: () => void };

export function createSheetStack(env: SheetHistoryEnv) {
  const stack: SheetHandle[] = [];
  let pushed = false;
  let pendingBack = 0;
  const ensurePushed = () => {
    if (!pushed && pendingBack === 0 && stack.length) {
      env.push();
      pushed = true;
    }
  };
  return {
    /** otevřený list; vrací funkci, kterou list volá při zavření jinak než tlačítkem Zpět */
    open(h: SheetHandle): () => void {
      stack.push(h);
      ensurePushed();
      return () => {
        const i = stack.indexOf(h);
        if (i < 0) return; // už zavřený (Zpět) nebo odregistrovaný
        stack.splice(i, 1);
        if (stack.length === 0 && pushed) {
          pushed = false;
          if (env.isOurs()) {
            pendingBack++;
            env.back();
          }
        }
      };
    },
    /** posluchač popstate */
    onPop() {
      if (pendingBack > 0) {
        pendingBack--;
        ensurePushed(); // mezitím se otevřel jiný list
        return;
      }
      pushed = false;
      const top = stack.pop();
      if (top) top.close();
      ensurePushed();
    },
    get size() {
      return stack.length;
    },
  };
}

const SHEET_STATE_KEY = "mnSheet";
let shared: ReturnType<typeof createSheetStack> | null = null;

/** sdílený zásobník listů pro celé okno (posluchač popstate se přidá jednou) */
export function sheetStack() {
  if (shared) return shared;
  const env: SheetHistoryEnv = {
    // stav aktuálního záznamu (u Next.js jeho interní data) se zkopíruje – Zpět pak obnoví tutéž stránku bez načtení
    push: () => window.history.pushState({ ...((window.history.state as object | null) ?? {}), [SHEET_STATE_KEY]: true }, ""),
    back: () => window.history.back(),
    isOurs: () => !!(window.history.state as Record<string, unknown> | null)?.[SHEET_STATE_KEY],
  };
  const s = createSheetStack(env);
  window.addEventListener("popstate", () => s.onPop());
  shared = s;
  return s;
}
