/**
 * Bloky příkazů výkresu a vyhodnocení listů za běh skriptu (CAD-HEADLESS-NAVRH.md kap. 5.3; balík B4).
 *
 * * **Blok** = po sobě jdoucí příkazy `výkres …` (přepnutí listu `výkres list …` blok uzavře). Na konci bloku se znovu
 *   ověří překryvy a přesahy rámečku poznámek z příkazů bloku (pozdější `výkres upravit … posun=` je může opravit) a
 *   v přísném režimu se spočítá aktivní list – varování listu jdou na řádek posledního příkazu bloku (`data.lines`).
 * * **Konec běhu** (normální i přísný režim): každý list, který běh měnil, se spočítá jednou v konečném stavu dokumentu;
 *   nálezy, které už protokol má (blok, `výkres stav`, export), se neopakují. Normální režim tak hlásí totéž co přísný
 *   (např. ✗ `drawing.section-miss`), jen bez zastavení – nezávisle na tom, jestli se list exportuje (`--formats`).
 */
import { isCancelled } from "../kernel-client";
import type { CadDoc } from "../types";
import { drawExtras } from "./asm-status";
import { codeText, type Code, type CodeLevel } from "./codes";
import type { OpCtx } from "./ops/registry";
import { asmHooks } from "./ops/util";
import type { Entry } from "./protocol-types";
import { runOf } from "./run-doc";
import { drawingMemo, evaluateSheet, recheckIssue, sameSheetFinding, sheetIssueText, sheetLabel, type SheetIssue } from "./sheet-eval";
import { tr } from "../i18n";
import { verifyKey } from "./verify";

type Pending = NonNullable<ReturnType<typeof runOf>["drawIssues"]>[number];
type Touched = { key: string; sheetId: string; lines: number[]; docName: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class DrawingTracker {
  private block: number[] = [];
  private pending: Pending[] = [];
  /** listy, které běh měnil (klíč dokumentu běhu + id listu) → řádky posledního bloku */
  private readonly touched = new Map<string, Touched>();

  constructor(private readonly ctx: OpCtx) {}

  /** blok příkazů výkresu je otevřený */
  get open(): boolean {
    return this.block.length > 0;
  }
  /** řádek posledního příkazu otevřeného bloku (0 = žádný blok) */
  get lastLine(): number {
    return this.block[this.block.length - 1] ?? 0;
  }

  /** po příkazu výkresu: řádek do bloku a nálezy, které rozhodne konec bloku */
  add(line: number): void {
    const r = runOf(this.ctx);
    this.block.push(line);
    if (r.drawIssues?.length) this.pending.push(...r.drawIssues.splice(0));
  }

  /**
   * Konec bloku: překryvy poznámek, které pořád trvají (na řádku příkazu, který je způsobil), v přísném režimu (`strict`)
   * i varování aktivního listu na řádku posledního příkazu bloku. Vrací nové záznamy (k rozhodnutí přísného režimu).
   */
  async close(strict: boolean): Promise<Entry[]> {
    const ctx = this.ctx;
    const rb = ctx.report;
    const before = rb.entries.length;
    const lines = this.block;
    const pending = this.pending;
    this.block = [];
    this.pending = [];
    if (!lines.length) return [];
    const r = runOf(ctx);
    const d = r.doc;
    const line = lines[lines.length - 1];
    const extras = () => drawExtras(ctx.ws, ctx.host.kernel, d, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
    const compute = drawingMemo(ctx.host.kernel);
    try {
      for (const p of pending) {
        if (p.issue.kind === "dims-skipped") continue; // vynechané kóty hlásí vyhodnocení listu (stav po celém bloku)
        const chk = await recheckIssue(d, p.issue, compute, extras);
        if (chk.present) this.add1(p.line, "drawing.overlap", d.name, codeText("drawing.overlap", chk.sheet, p.issue.text), lines);
      }
      const { activeSheetIndex } = await import("../drawing-agent");
      const idx = d.kind === "draft" ? -1 : activeSheetIndex(d);
      const sheet = idx >= 0 ? d.drawings?.[idx] : undefined;
      if (sheet) {
        this.touched.set(`${verifyKey(ctx)}\u0000${sheet.id}`, { key: verifyKey(ctx), sheetId: sheet.id, lines, docName: d.name });
        if (strict) for (const x of await evaluateSheet(d, idx, compute, extras)) this.addSheet(line, x, d.name, lines);
      }
    } catch (e) {
      if (isCancelled(e)) throw e;
      this.add1(line, "op.failed", d.name, codeText("op.failed", errMessage(e)), lines);
    }
    return rb.entries.slice(before);
  }

  /**
   * Konec běhu: každý list, který běh měnil, v konečném stavu dokumentu (`docOf` = poslední stav dokumentu podle klíče;
   * aktivní dokument běhu = `run.doc`). Nálezy, které protokol už má, se neopakují. Vrací nové záznamy.
   */
  async finish(docOf: (key: string) => CadDoc | undefined): Promise<Entry[]> {
    const ctx = this.ctx;
    const rb = ctx.report;
    const before = rb.entries.length;
    const cur = verifyKey(ctx);
    const compute = drawingMemo(ctx.host.kernel);
    for (const t of this.touched.values()) {
      const d = t.key === cur ? runOf(ctx).doc : docOf(t.key);
      const idx = d?.drawings?.findIndex((s) => s.id === t.sheetId) ?? -1;
      if (!d || idx < 0) continue;
      const line = t.lines[t.lines.length - 1];
      try {
        const extras = () => drawExtras(ctx.ws, ctx.host.kernel, d, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
        for (const x of await evaluateSheet(d, idx, compute, extras)) this.addSheet(line, x, d.name, t.lines);
        // 22i: výsledek listu až po vyhodnocení – ✓ jen když list (v konečném stavu) nemá žádný nález na řádcích svého bloku
        if (!rb.entries.some((e) => this.findingOf(e, d.name, t.lines))) this.sheetOk(line, d.name, sheetLabel(d, idx), t.lines);
      } catch (e) {
        if (isCancelled(e)) throw e;
        this.add1(line, "op.failed", d.name, codeText("op.failed", errMessage(e)), t.lines);
      }
    }
    return rb.entries.slice(before);
  }

  /** ✗ / ⚠ výkresu (nebo chyba příkazu) dokumentu `doc` na některém z řádků bloku */
  private findingOf(e: Entry, doc: string, lines: number[]): boolean {
    if (e.level !== "error" && !(e.level === "warn" && e.code?.startsWith("drawing."))) return false;
    if (e.doc !== undefined && e.doc !== doc) return false;
    const at = [...(e.lines ?? []), ...(e.line !== null ? [e.line] : []), ...(((e.data as { lines?: number[] } | undefined)?.lines ?? []) as number[])];
    return at.some((l) => lines.includes(l));
  }

  /** ✓ listu po vyhodnocení (řádek posledního příkazu bloku): pohledy, řezy a Chytré kóty bez hlášení */
  private sheetOk(line: number, doc: string, sheet: string, lines: number[]): void {
    const text = tr("výkres: list „{0}“ vyhodnocen bez nálezů (pohledy, řezy, Chytré kóty)", sheet);
    if (this.ctx.log) this.ctx.log.body.push({ line, text: `✓ ${text}` });
    this.ctx.report.add({ line, level: "ok", text, doc, data: { lines } });
  }

  /** nález listu (hlášení jádra výkresu) na řádku – text s přesným důvodem, úroveň z hlášení (řez mimo těleso = ✗) */
  private addSheet(line: number, x: SheetIssue, doc: string, lines: number[]): void {
    this.add1(line, x.code, doc, sheetIssueText(x), lines, x.level);
  }

  /** nález na řádku (do konzole i protokolu), pokud ho protokol pro týž dokument ještě nemá; řez mimo těleso = ✗ */
  private add1(line: number, code: Code, doc: string, text: string, lines: number[], level0?: CodeLevel): void {
    const rb = this.ctx.report;
    const level = level0 ?? (code === "drawing.section-miss" ? ("error" as const) : undefined);
    if (rb.entries.some((x) => sameSheetFinding(x, { code, doc, text }))) return;
    const o = { doc, text, data: { lines }, ...(level ? { level } : {}) };
    if (this.ctx.log) this.ctx.log.coded(line, code, o);
    else rb.code(code, { line, ...o });
  }
}
