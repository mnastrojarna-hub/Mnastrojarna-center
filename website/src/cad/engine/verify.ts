/**
 * Ověření prvků běhu stavbou (CAD-HEADLESS-NAVRH.md kap. 5, balík B4; nález „UNVERIFIED ✓“ zkoušky 959).
 *
 * Každý dokument, do kterého běh přidal prvky, se postaví dřív, než se jeho prvky ohlásí – i dokument, ze kterého běh
 * odešel (`nový díl`, `záložka`, normálie). Prvek bez ověřeného výsledku stavby nikdy není ✓ (⚠ `feature.unverified`).
 *
 * * Díl, ze kterého běh odejde, se postaví jako komponenta sestavy (`asmParts`, klíč `sourceKey`) – výsledek jde do
 *   `ws.asm.cache`, takže pozdější `vložit` + vazby, kusovník a kolize díl znovu nestaví (žádná práce navíc).
 * * Přísný režim navíc ověří díl po každé operaci, která přidala prvek nebo změnila model (`kernel.check` – stavba bez sítě
 *   přes řetěz mezipaměti stavby: počítá se jen nový prvek); první ⚠/✗ tak zastaví běh na řádku prvku.
 */
import { sourceKey } from "../assembly";
import { tr } from "../i18n";
import { isCancelled } from "../kernel-client";
import type { CadDoc, ComponentSource, Feature, FeatureStatus } from "../types";
import { fmtNum } from "@/lib/mesh-metrics";
import { makeAsmEnv } from "./asm-env";
import { codeText } from "./codes";
import type { OpCtx } from "./ops/registry";
import { asmHooks } from "./ops/util";
import { docKeyOf } from "./run-doc";

/** klíč ověření pracovního dokumentu běhu (viz `lineageOf`) */
export const verifyKey = (ctx: OpCtx): string => lineageOf(ctx);

type Owned = { f: Feature; key: string; line: number | null };

const isPart = (d: CadDoc) => d.kind !== "assembly" && d.kind !== "draft";
/**
 * Klíč dokumentu pro ověření: klíč dokumentu běhu (`docKeyOf`) + druh – díl upravovaný v kontextu sestavy (`sestava
 * upravit`) sdílí klíč záložky sestavy, ale ověřuje se jako samostatný díl.
 */
const lineageOf = (ctx: OpCtx) => verifyKeyOf(docKeyOf(ctx), ctx.run.doc);
/** klíč ověření dokumentu `doc` pod klíčem dokumentu `docKey` (CLI `--open` → `preloaded` v engine/run.ts) */
export const verifyKeyOf = (docKey: string, doc: CadDoc): string => `${docKey}#${doc.kind === "assembly" ? "asm" : doc.kind === "draft" ? "draft" : "part"}`;
const featureSig = (d: CadDoc) => JSON.stringify(d.features);

export class RunVerifier {
  /** poslední stav dokumentů běhu podle klíče (`docKeyOf`) */
  private readonly docs = new Map<string, CadDoc>();
  /** prvky přidané nebo upravené během (pořadí poslední změny) s dokumentem a řádkem */
  private readonly added = new Map<string, Owned>();
  /** ohlášené prvky (id) */
  private readonly reported = new Set<string>();
  /** prvky, u kterých už zaznělo ⚠/✗ (přísná kontrola po úpravě neopakuje) */
  private readonly flagged = new Set<string>();
  /** podpis prvků dokumentu při poslední přísné kontrole */
  private readonly checkedSig = new Map<string, string>();
  /** podpis prvků dokumentu při posledním ověření jako komponenta (`verifyDoc`) */
  private readonly verifiedSig = new Map<string, string>();
  private lastKey: string | null = null;
  /** dokumenty načtené celé (JSON na řádku skriptu, CLI `--open`) → řádek načtení; ověří se stavbou jako celek */
  private readonly loadedAt = new Map<string, number | null>();

  constructor(private readonly ctx: OpCtx) {}

  /** dokument načtený celý (JSON, `--open`): jeho prvky se ověří stavbou (✗/⚠ na řádku načtení, ✓ se nevypisují) */
  loaded(key: string, doc: CadDoc, line: number | null): void {
    this.loadedAt.set(key, line);
    this.docs.set(key, doc);
    this.verifiedSig.delete(key);
  }
  /** řádek načtení dokumentu `key` (null = bez řádku nebo nenačtený) */
  loadedLine(key: string): number | null {
    return this.loadedAt.get(key) ?? null;
  }
  /** poslední stav dokumentu běhu podle klíče ověření */
  docOf(key: string): CadDoc | undefined {
    return this.docs.get(key);
  }
  /** ✗ feature.failed prvku `name` dokumentu `doc` už protokol má */
  hasFailure(doc: string, name: string): boolean {
    const head = codeText("feature.failed", name, "");
    return this.ctx.report.entries.some((e) => e.code === "feature.failed" && e.doc === doc && e.text.startsWith(head));
  }

  /** po operaci: dokument operace a prvky, které přidala */
  note(added: readonly Feature[], line: number | null): void {
    const key = lineageOf(this.ctx);
    this.docs.set(key, this.ctx.run.doc);
    for (const f of added) {
      // znovu upravený prvek (upravit, přesunout) se ověří znovu a ohlásí na řádku poslední úpravy
      this.added.delete(f.id);
      this.reported.delete(f.id);
      this.added.set(f.id, { f, key, line });
    }
  }

  /** klíč dokumentu operace se změnil – vrátí předchozí klíč (dokument, ze kterého běh odešel) */
  switched(): string | null {
    const key = lineageOf(this.ctx);
    const prev = this.lastKey;
    this.lastKey = key;
    return prev !== null && prev !== key ? prev : null;
  }

  /** neohlášené prvky dokumentu `key`, které v něm ještě jsou (smazaný / odebraný prvek se nehlásí) */
  pending(key: string): Owned[] {
    const d = key === lineageOf(this.ctx) ? this.ctx.run.doc : this.docs.get(key);
    const ids = new Set((d?.features ?? []).map((f) => f.id));
    return [...this.added.values()].filter((x) => x.key === key && !this.reported.has(x.f.id) && ids.has(x.f.id));
  }
  /** klíče dokumentů s neohlášenými prvky (pořadí přidání) */
  pendingKeys(): string[] {
    const keys = [...new Set([...this.added.values()].filter((x) => !this.reported.has(x.f.id)).map((x) => x.key))].filter((k) => this.pending(k).length > 0);
    for (const k of this.loadedAt.keys()) if (!keys.includes(k) && this.docs.get(k)?.features.length && this.verifiedSig.get(k) !== featureSig(this.docs.get(k)!)) keys.push(k);
    return keys;
  }

  /**
   * Výsledky prvků dokumentu `key` ze stavby (`status`): ✓ / ⚠ feature.warning / ✗ feature.failed na řádku prvku.
   * `final`: prvek bez výsledku = ⚠ feature.unverified (nikdy ✓); jinak zůstane čekat na další stavbu.
   */
  report(key: string, doc: CadDoc, status: readonly FeatureStatus[] | null, o: { final: boolean; header?: boolean; took?: boolean }): void {
    const log = this.ctx.log;
    const rb = this.ctx.report;
    const st = new Map((status ?? []).map((s) => [s.id, s]));
    const took = (ms?: number) => (o.took && ms !== undefined && ms >= 100 ? ` · ${fmtNum(ms / 1000, 1)} s` : "");
    for (const x of this.pending(key)) {
      const s = st.get(x.f.id);
      if (!s && !o.final) continue;
      this.reported.add(x.f.id);
      const { f, line } = x;
      if (!s) {
        log?.tailLine(`⚠ ${f.name} (${f.type}): ${codeText("feature.unverified", f.name)}`);
        rb.code("feature.unverified", { line, doc: doc.name, args: [f.name] });
      } else if (s.ok === false) {
        this.flagged.add(f.id);
        log?.tailLine(`✗ ${f.name} (${f.type}): ${s.error ?? "chyba stavby"}`);
        rb.code("feature.failed", { line, doc: doc.name, args: [f.name, s.error ?? ""] });
      } else if (s.warning) {
        this.flagged.add(f.id);
        log?.tailLine(`⚠ ${f.name} (${f.type}): ${s.warning}${took(s.ms)}`);
        rb.code("feature.warning", { line, doc: doc.name, args: [f.name, s.warning] });
      } else {
        log?.tailLine(`✓ ${f.name} (${f.type})${took(s.ms)}`);
        rb.ok(line, `${f.name} (${f.type})`, doc.name);
      }
    }
  }

  /**
   * Ověří dokument, ze kterého běh odešel (nebo který na konci není aktivní): díl se postaví jako komponenta sestavy
   * (mezipaměť `ws.asm.cache` – pozdější sestava ho nestaví znovu), výsledky prvků se ohlásí. Sestava a 2D výkres prvky
   * dílů nemají – jejich prvky (např. JSON) se ohlásí jako neověřené jen na konci.
   */
  async verifyDoc(key: string, final = true): Promise<void> {
    const doc = this.docs.get(key);
    if (!doc) return;
    // díl změněný během se postaví jako komponenta i tehdy, když jeho prvky už ohlásila přísná kontrola: řetěz mezipaměti
    // stavby je teď „teplý“ (jen síť) a pozdější sestava díl znovu nestaví
    const loaded = this.loadedAt.has(key) && doc.features.length > 0; // prázdný načtený dokument nemá co ověřit
    const touched = loaded || [...this.added.values()].some((x) => x.key === key);
    const sig = featureSig(doc);
    if (!this.pending(key).length && (!touched || this.verifiedSig.get(key) === sig)) return;
    this.verifiedSig.set(key, sig);
    if (!isPart(doc)) {
      if (final) this.report(key, doc, null, { final: true, header: true });
      return;
    }
    const source: ComponentSource = { kind: "part", doc: { ...doc, kind: "part" } };
    const skey = sourceKey(source);
    let status: FeatureStatus[] | null = null;
    try {
      const env = makeAsmEnv(this.ctx.ws, this.ctx.host.kernel, asmHooks(this.ctx));
      const [r] = await env.parts([{ key: skey, source }]);
      status = r?.result?.status ?? null;
    } catch (e) {
      if (isCancelled(e)) throw e;
      this.ctx.report.code("build.failed", { doc: doc.name, args: [e instanceof Error ? e.message : String(e)] });
    }
    this.report(key, doc, status, { final, header: true });
    // načtený dokument (JSON, --open): prvky, které běh nepřidal, se ověří jako celek – ✗/⚠ na řádku načtení, ✓ se nepíší
    if (loaded && status) this.reportLoaded(doc, status, this.loadedAt.get(key) ?? null);
  }

  /** ✗ / ⚠ prvků načteného dokumentu, které běh nepřidal a které ještě nezazněly (řádek načtení) */
  private reportLoaded(doc: CadDoc, status: readonly FeatureStatus[], line: number | null): void {
    const st = new Map(status.map((s) => [s.id, s]));
    for (const f of doc.features) {
      const s = st.get(f.id);
      if (!s || this.added.has(f.id) || this.flagged.has(f.id) || (s.ok !== false && !s.warning)) continue;
      this.flagged.add(f.id);
      if (s.ok === false) {
        this.ctx.log?.tailLine(`✗ ${f.name} (${f.type}): ${s.error ?? "chyba stavby"}`);
        this.ctx.report.code("feature.failed", { line, doc: doc.name, args: [f.name, s.error ?? ""] });
      } else {
        this.ctx.log?.tailLine(`⚠ ${f.name} (${f.type}): ${s.warning}`);
        this.ctx.report.code("feature.warning", { line, doc: doc.name, args: [f.name, s.warning ?? ""] });
      }
    }
  }

  /**
   * Přísný režim po operaci: díl se postaví bez sítě (`kernel.check`, řetěz mezipaměti stavby) a ohlásí se výsledky nových
   * prvků; po úpravě (`upravit`, `zpět`, potlačení) i prvky, které tím nově selhaly (na řádku úpravy).
   */
  async strictCheck(line: number): Promise<void> {
    const d = this.ctx.run.doc;
    if (!isPart(d) || !d.features.length) return;
    const key = lineageOf(this.ctx);
    const sig = featureSig(d);
    if (this.checkedSig.get(key) === sig) return;
    const pend = this.pending(key);
    const kernel = this.ctx.host.kernel;
    // jádro bez operace `check` (starší hostitel, test) – plná stavba dá tytéž výsledky prvků
    const res = typeof kernel.check === "function" ? await kernel.check(d) : await kernel.build(d).then((b) => ({ status: b.status, paramErrors: b.paramErrors ?? [], solid: !!b.metrics }));
    this.checkedSig.set(key, sig);
    if (pend.length) this.report(key, d, res.status, { final: false });
    // změna dřívějších prvků: nové ✗/⚠ na řádku operace (prvky přidané během hlásí `report` na jejich řádku)
    const mine = new Set(this.added.keys());
    for (const s of res.status) {
      if (mine.has(s.id) || this.flagged.has(s.id) || (s.ok !== false && !s.warning)) continue;
      const f = d.features.find((x) => x.id === s.id);
      if (!f) continue;
      this.flagged.add(s.id);
      if (s.ok === false) this.ctx.report.code("feature.failed", { line, doc: d.name, args: [f.name, s.error ?? ""] });
      else this.ctx.report.code("feature.warning", { line, doc: d.name, args: [f.name, s.warning ?? ""] });
    }
    for (const pe of res.paramErrors) this.ctx.report.code("build.failed", { line, doc: d.name, args: [pe] });
  }

  /** prvky dokumentu `key` se neohlásí jednotlivě (stavba selhala celá – volající zapíše ✗ build.failed) */
  drop(key: string): void {
    for (const x of this.pending(key)) this.reported.add(x.f.id);
  }

  /** ⚠/✗ už ohlášené u prvku (závěrečná stavba je neopakuje) */
  isFlagged(id: string): boolean {
    return this.flagged.has(id);
  }
}
