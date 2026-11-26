// Spodní list na mobilu (hlášení majitele 25. 11.: „okno co vyskakuje ze spoda nejde zatáhnout dolu“):
// rozhodnutí tažení × posun obsahu, práh zavření, švihnutí, návrat na místo a záznam v historii pro tlačítko Zpět.
import { describe, expect, it } from "vitest";
import { SHEET_CLOSE_FRACTION, SHEET_FLICK_MIN, SHEET_FLICK_VELOCITY, SheetVelocity, createSheetStack, sheetGestureStart, sheetOffset, sheetRelease } from "./sheet-drag";

describe("sheetGestureStart – kdo dostane gesto", () => {
  it("pohyb v toleranci je zatím nerozhodnutý (klepnutí na položku nabídky dál funguje)", () => {
    expect(sheetGestureStart({ fromGrip: true, scrolledTop: true }, 2, 3)).toBe("pending");
    expect(sheetGestureStart({ fromGrip: false, scrolledTop: true }, 0, 5)).toBe("pending");
  });
  it("úchyt / záhlaví táhne list svisle vždy, i když je obsah posunutý", () => {
    expect(sheetGestureStart({ fromGrip: true, scrolledTop: false }, 0, 20)).toBe("drag");
    expect(sheetGestureStart({ fromGrip: true, scrolledTop: false }, 1, -20)).toBe("drag");
  });
  it("obsah nahoře (scrollTop == 0) + tah dolů = tažení listu", () => {
    expect(sheetGestureStart({ fromGrip: false, scrolledTop: true }, 2, 30)).toBe("drag");
  });
  it("posunutý obsah se posouvá, list se netáhne (zavírání jen ze scrollTop == 0)", () => {
    expect(sheetGestureStart({ fromGrip: false, scrolledTop: false }, 0, 30)).toBe("native");
  });
  it("tah nahoru v obsahu posouvá obsah, ne list", () => {
    expect(sheetGestureStart({ fromGrip: false, scrolledTop: true }, 0, -30)).toBe("native");
  });
  it("vodorovný pohyb (posuvník, vodorovný seznam) list netáhne", () => {
    expect(sheetGestureStart({ fromGrip: false, scrolledTop: true }, 40, 10)).toBe("native");
    expect(sheetGestureStart({ fromGrip: true, scrolledTop: true }, 40, 10)).toBe("native");
  });
});

describe("sheetRelease – zavřít, nebo vrátit", () => {
  const H = 600;
  it("stažení o ≥ 25 % výšky list zavře", () => {
    expect(SHEET_CLOSE_FRACTION).toBe(0.25);
    expect(sheetRelease(150, H, 0)).toBe("close");
    expect(sheetRelease(400, H, 0)).toBe("close");
  });
  it("krátké pomalé stažení list vrátí na místo", () => {
    expect(sheetRelease(149, H, 0)).toBe("snap");
    expect(sheetRelease(80, H, 0.2)).toBe("snap");
  });
  it("rychlé švihnutí dolů zavře i na kratší dráze", () => {
    expect(sheetRelease(60, H, SHEET_FLICK_VELOCITY)).toBe("close");
    expect(sheetRelease(60, H, 1.5)).toBe("close");
  });
  it("drobné cuknutí (pod minimální dráhou) nezavře ani rychle", () => {
    expect(sheetRelease(SHEET_FLICK_MIN - 1, H, 3)).toBe("snap");
  });
  it("tah nahoru nebo nulový posun nic nezavře", () => {
    expect(sheetRelease(-50, H, -2)).toBe("snap");
    expect(sheetRelease(0, H, 0)).toBe("snap");
    expect(sheetRelease(Number.NaN, H, 0)).toBe("snap");
  });
  it("švihnutí nahoru po dlouhém tahu dolů rozhoduje dráha (≥ 25 %)", () => {
    expect(sheetRelease(200, H, -1)).toBe("close");
    expect(sheetRelease(100, H, -1)).toBe("snap");
  });
});

describe("sheetOffset – list jde za prstem", () => {
  it("dolů 1 : 1, nahoru jen malý odpor", () => {
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(123)).toBe(123);
    expect(sheetOffset(-4)).toBeLessThan(0);
    expect(sheetOffset(-10000)).toBeGreaterThanOrEqual(-16);
  });
});

describe("SheetVelocity – rychlost z posledních vzorků", () => {
  it("rovnoměrný pohyb 1 px/ms", () => {
    const v = new SheetVelocity();
    for (let t = 0; t <= 200; t += 16) v.add(t, t);
    expect(v.velocity(200)).toBeCloseTo(1, 5);
  });
  it("zastavení prstu před puštěním = rychlost 0 (pomalý tah se nepočítá jako švihnutí)", () => {
    const v = new SheetVelocity();
    for (let t = 0; t <= 100; t += 16) v.add(t, t * 2);
    expect(v.velocity(400)).toBe(0);
  });
  it("jediný vzorek = 0", () => {
    const v = new SheetVelocity();
    v.add(0, 10);
    expect(v.velocity(5)).toBe(0);
  });
});

/** náhrada window.history: zásobník stavů a asynchronní popstate */
function fakeHistory() {
  const entries: ({ mn?: boolean } | null)[] = [null];
  let idx = 0;
  const log: string[] = [];
  const env = {
    push: () => {
      entries.splice(idx + 1);
      entries.push({ mn: true });
      idx++;
      log.push("push");
    },
    back: () => {
      log.push("back");
      queued++;
    },
    isOurs: () => !!entries[idx]?.mn,
  };
  let queued = 0;
  return {
    env,
    log,
    entries,
    get idx() {
      return idx;
    },
    /** prohlížeč provede odložené history.back() a pošle popstate */
    flush(stack: { onPop(): void }) {
      while (queued > 0) {
        queued--;
        idx--;
        stack.onPop();
      }
    },
    /** uživatel stiskne systémové Zpět */
    userBack(stack: { onPop(): void }) {
      idx--;
      stack.onPop();
    },
    /** cizí navigace (jiný záznam nahoře) */
    navigate() {
      entries.splice(idx + 1);
      entries.push(null);
      idx++;
    },
  };
}

describe("createSheetStack – tlačítko Zpět zavře list, ne stránku", () => {
  it("otevření přidá jeden záznam, Zpět zavře list a záznam zmizí", () => {
    const h = fakeHistory();
    const s = createSheetStack(h.env);
    let closed = 0;
    s.open({ close: () => closed++ });
    expect(h.idx).toBe(1);
    h.userBack(s);
    expect(closed).toBe(1);
    expect(h.idx).toBe(0);
    expect(s.size).toBe(0);
    expect(h.log).toEqual(["push"]);
  });
  it("zavření jinak (tažení, podklad) vrátí vlastní záznam – stránka zůstane na stejném místě historie", () => {
    const h = fakeHistory();
    const s = createSheetStack(h.env);
    let closed = 0;
    const release = s.open({ close: () => closed++ });
    release();
    h.flush(s);
    expect(h.idx).toBe(0);
    expect(closed).toBe(0); // náš vlastní back nezavírá nic dalšího
    expect(h.log).toEqual(["push", "back"]);
    release(); // dvojí zavření je neškodné
    expect(h.log).toEqual(["push", "back"]);
  });
  it("dva listy sdílí jeden záznam; Zpět zavře horní a záznam se obnoví pro spodní", () => {
    const h = fakeHistory();
    const s = createSheetStack(h.env);
    const closed: string[] = [];
    s.open({ close: () => closed.push("panel") });
    s.open({ close: () => closed.push("menu") });
    expect(h.log).toEqual(["push"]);
    h.userBack(s);
    expect(closed).toEqual(["menu"]);
    expect(h.idx).toBe(1);
    h.userBack(s);
    expect(closed).toEqual(["menu", "panel"]);
    expect(h.idx).toBe(0);
  });
  it("list zavřený a hned otevřený nový (dřív než dorazí popstate) – nový list má svůj záznam", () => {
    const h = fakeHistory();
    const s = createSheetStack(h.env);
    const r1 = s.open({ close: () => undefined });
    r1();
    let closed2 = 0;
    s.open({ close: () => closed2++ });
    expect(h.log).toEqual(["push", "back"]); // push až po popstate
    h.flush(s);
    expect(h.log).toEqual(["push", "back", "push"]);
    expect(h.idx).toBe(1);
    h.userBack(s);
    expect(closed2).toBe(1);
  });
  it("cizí navigace nad naším záznamem se zavřením listu nevrací", () => {
    const h = fakeHistory();
    const s = createSheetStack(h.env);
    const r = s.open({ close: () => undefined });
    h.navigate();
    r();
    expect(h.log).toEqual(["push"]);
  });
});
