/**
 * Protokol konzole prohlížeče (dnešní text `runAgentText`, CAD-HEADLESS-NAVRH.md kap. 4.1 „v konzoli prohlížeče plný“)
 * souběžně se záznamy s kódem pro stručný protokol CLI/HTTP. Obsluhy operací píší řádky stejně jako dřív smyčka
 * v cad-app.tsx (`log.push(…)`); každý řádek se zapíše do konzole beze změny a zároveň jako záznam reportu:
 *
 *   „✓ …“ → ✓ · „⚠ …“, „! …“ → ⚠ (`msg.warn`) · „✗ …“ → ✗ (`msg.error`) · „→ …“, odsazená poznámka → ℹ (`msg.note`)
 *   ostatní souvislé řádky (výpisy: stav, měření, kusovník, nápověda) → jeden vyžádaný výpis `=` druhu operace.
 *
 * Výpis `=` má strojovou část stejnou v cs/en/de (kap. 4.2): obsluha, která má údaje (měření, stav, výkres), ji předá
 * (`kv`, engine/kv.ts) a lokalizovaný text výpisu jde do `Entry.detail` (plný protokol, JSON); bez ní je první řádek
 * `lines=<n>` a řádky výpisu jsou pokračovací řádky (volný text v jazyce běhu).
 *
 * Přesné kódy podle soupisu 5.2 doplní balík B4 (strict-silent); výjimky obsluh mají kód podle třídy chyby.
 */
import { tr } from "../i18n";
import { isAcceptance } from "./accept";
import type { Code, CodeEntryInit } from "./codes";
import { codeText } from "./codes";
import type { ReportBuilder } from "./protocol";

/** druh výpisu `=` podle druhu operace */
const LISTING: Record<string, string> = { measure: "measure", status: "status", asm: "asm", drawingCmd: "drawing", info: "help", surf: "surf", draft: "draft", edit: "edit", clash: "clash", api: "api", out: "out", check: "check", compare: "compare" };

export class ConsoleLog {
  /** řádky operací s řádkem skriptu (konzole je vypíše seřazené podle řádku, stabilně) */
  readonly body: { line: number; text: string }[] = [];
  /** řádky po stavbě (výsledky prvků, čas výpočtu, prázdný řádek, stav dokumentu) */
  readonly tail: string[] = [];

  constructor(private readonly rb: ReportBuilder) {}

  /**
   * Řádky operace `kind` na řádku `line` (texty jako dřív v `log.push`); `doc` = dokument operace pro záznamy ⚠/✗;
   * `kv` = strojová část prvního výpisu (jinak `lines=<n>`). Prázdný řádek se do konzole zapíše, do reportu ne.
   */
  push(line: number, kind: string, texts: readonly string[], doc?: string, kv?: string): void {
    let listing: string[] = [];
    const k = LISTING[kind] ?? "value";
    const o = doc !== undefined ? { doc } : {};
    let data = kv;
    const flushListing = () => {
      if (!listing.length) return;
      if (data !== undefined) this.rb.measure(line, k, data, { ...o, detail: listing.join("\n") });
      else this.rb.measure(line, k, [`lines=${listing.length}`, ...listing].join("\n"), o);
      data = undefined;
      listing = [];
    };
    for (const t of texts) {
      this.body.push({ line, text: t });
      const s = t.trimStart();
      const lead = s.slice(0, 1);
      if (!s) continue;
      if (lead === "✓") {
        flushListing();
        this.rb.ok(line, s.slice(1).trim(), doc);
      } else if (lead === "⚠" || lead === "!") {
        flushListing();
        this.rb.code("msg.warn", { line, text: s.slice(1).trim(), ...(doc !== undefined ? { doc } : {}) });
      } else if (lead === "✗") {
        flushListing();
        this.rb.code("msg.error", { line, text: s.slice(1).trim(), ...(doc !== undefined ? { doc } : {}) });
      } else if (lead === "→" || (t.startsWith("  ") && !listing.length)) {
        flushListing();
        // „→ … – výsledek po výpočtu níže“ = přijetí příkazu (ℹ op.accepted), jiná „→“ / odsazená poznámka = ℹ msg.note
        this.rb.code(isAcceptance(s) ? "op.accepted" : "msg.note", { line, text: s.replace(/^→\s*/, ""), ...(doc !== undefined ? { doc } : {}) });
      } else listing.push(t);
    }
    flushListing(); // `kv` patří k výpisu – operace jen s ✓/⚠/✗ (výkres bez výpisu) žádný záznam `=` nepřidá
  }

  /** chyba operace: konzole „✗ řádek N: …“ (jako dřív), report ✗ s kódem (výchozí `op.failed`) */
  error(line: number, message: string, o: { code?: Code; doc?: string } = {}): void {
    this.body.push({ line, text: tr("✗ řádek {0}: {1}", line, message) });
    const code = o.code ?? "op.failed";
    this.rb.code(code, { line, ...(code === "op.failed" ? { args: [message] } : { text: message }), ...(o.doc !== undefined ? { doc: o.doc } : {}) });
  }

  /**
   * Záznam s kódem z registru a jeho řádek v konzoli: `ℹ`/`⚠`/`✗` + „řádek N: “ + text kódu (hostitel bez 3D okna,
   * příkaz jen v aplikaci, restart jádra). Volný text kódu je lokalizovaný.
   */
  coded(line: number | null, code: Code, o: CodeEntryInit = {}): void {
    const e = this.rb.code(code, { ...o, line });
    const sym = e.level === "error" ? "✗" : e.level === "warn" ? "⚠" : "ℹ";
    const text = o.text ?? codeText(code, ...(o.args ?? []));
    this.body.push({ line: line ?? 0, text: line ? `${sym} ${tr("řádek {0}: {1}", line, text)}` : `${sym} ${text}` });
  }

  /** řádek za stavbou (výsledek prvku, čas výpočtu, stav) – jen konzole; záznamy reportu zapisuje volající */
  tailLine(...t: string[]): void {
    this.tail.push(...t);
  }

  /** text konzole: řádky operací seřazené podle řádku skriptu (stabilně), pak řádky po stavbě */
  text(): string {
    const ordered = [...this.body].sort((a, b) => a.line - b.line).map((e) => e.text);
    return [...ordered, ...this.tail].join("\n");
  }
}
