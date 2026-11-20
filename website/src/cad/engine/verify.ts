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
import { bodyText, featureState, levelsData, levelsText, uncheckedText, type FeatureState } from "../feature-levels";
import { fmtNum } from "@/lib/mesh-metrics";
import { makeAsmEnv } from "./asm-env";
import { codeText } from "./codes";
import type { OpCtx } from "./ops/registry";
import { asmHooks } from "./ops/util";
import { docKeyOf } from "./run-doc";

/** klíč ověření pracovního dokumentu běhu (viz `lineageOf`) */
export const verifyKey = (ctx: OpCtx): string => lineageOf(ctx);

type Owned = { f: Feature; key: string; line: number | null };
/** kódy ℹ, které jsou výsledkem stavby (ne přijetím příkazu) */
const RESULT_NOTES: ReadonlySet<string> = new Set(["feature.unchecked", "feature.suppressed", "feature.built", "doc.unchecked", "feature.unverified", "op.superseded"]);

const isPart = (d: CadDoc) => d.kind !== "assembly" && d.kind !== "draft";
/**
 * Klíč dokumentu pro ověření: klíč dokumentu běhu (`docKeyOf`) + druh – díl upravovaný v kontextu sestavy (`sestava
 * upravit`) sdílí klíč záložky sestavy, ale ověřuje se jako samostatný díl.
 */
const lineageOf = (ctx: OpCtx) => verifyKeyOf(docKeyOf(ctx), ctx.run.doc);
/** klíč ověření dokumentu `doc` pod klíčem dokumentu `docKey` (CLI `--open` → `preloaded` v engine/run.ts) */
export const verifyKeyOf = (docKey: string, doc: CadDoc): string => `${docKey}#${doc.kind === "assembly" ? "asm" : doc.kind === "draft" ? "draft" : "part"}`;
/** otisk vstupů stavby dokumentu: prvky i proměnné, vazby parametrů a konfigurace (změna aktivní konfigurace = jiný model) */
const featureSig = (d: CadDoc) => JSON.stringify([d.features, d.variables ?? null, d.bindings ?? null, d.configs ?? null, d.activeConfig ?? null]);

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
  /** řádek poslední operace, která změnila prvek nebo cokoli před ním v historii (klíč dokumentu + id prvku) */
  private readonly affected = new Map<string, number | null>();
  /** stav prvku, jak ho protokol naposledy ohlásil (klíč dokumentu + id prvku → podpis stavu) */
  private readonly told = new Map<string, string>();
  /** dokumenty načtené celé (JSON na řádku skriptu, CLI `--open`) → řádek načtení; ověří se stavbou jako celek */
  private readonly loadedAt = new Map<string, number | null>();
  /** načtené dokumenty, jejichž výsledek první ověřovací stavby už protokol má (`docResult`) */
  private readonly loadedTold = new Set<string>();
  /** řádky operací, po kterých se dokument přepočítává a které ještě nemají výsledek (klíč dokumentu → řádky) */
  private readonly rebuilt = new Map<string, Set<number>>();
  /**
   * řádek poslední operace, která dokument změnila (načtení, prvek, úprava; null = načteno bez řádku) – stavba ověřuje JEN
   * stav po ní; výsledek „dokument … postaven“ smí dostat jen tento řádek, dřívější mezistavy se nestavěly
   */
  private readonly lastChange = new Map<string, number | null>();

  constructor(private readonly ctx: OpCtx) {}

  /** dokument načtený celý (JSON, `--open`): jeho prvky se ověří stavbou (✗/⚠ na řádku načtení, ✓ se nevypisují) */
  loaded(key: string, doc: CadDoc, line: number | null): void {
    this.loadedAt.set(key, line);
    this.lastChange.set(key, line);
    this.loadedTold.delete(key);
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

  /**
   * po operaci: dokument operace a prvky, které přidala nebo přímo upravila; `from` = index v historii, od kterého operace
   * dokument změnila (`changedFrom`, null = beze změny) – prvky od něj dál mají výsledek „po řádku této operace“;
   * `changed` = operace změnila model (i na místě – otisk `modelSig` před a po)
   */
  note(added: readonly Feature[], line: number | null, from: number | null = null, changed = from !== null): void {
    const key = lineageOf(this.ctx);
    this.docs.set(key, this.ctx.run.doc);
    for (const f of added) {
      // znovu upravený prvek (upravit, přesunout) se ověří znovu a ohlásí na řádku poslední úpravy
      this.added.delete(f.id);
      this.reported.delete(f.id);
      this.added.set(f.id, { f, key, line });
      this.affected.set(`${key}\u0000${f.id}`, line);
    }
    const after = from === null ? [] : this.ctx.run.doc.features.slice(from);
    for (const f of after) this.affected.set(`${key}\u0000${f.id}`, line);
    if (!changed && from === null && !added.length) return;
    this.lastChange.set(key, line);
    // operace, po které se něco přepočítá, dluží svému řádku výsledek (má-li řádek po stavbě jen přijetí – `report`)
    if ((after.length || added.length) && line !== null) (this.rebuilt.get(key) ?? this.rebuilt.set(key, new Set()).get(key)!).add(line);
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
    // dokument s přijatou úpravou bez nového prvku (konfigurace, proměnná, potlačení v kontextu sestavy…), jejíž řádek ještě
    // nemá výsledek – ověří se také (22i: každé přijetí dostane výsledek)
    for (const k of this.rebuilt.keys()) if (!keys.includes(k) && this.owes(k)) keys.push(k);
    return keys;
  }
  /** dokument `key` má řádek přijaté změny, který čeká na výsledek stavby */
  private owes(key: string): boolean {
    return (this.rebuilt.get(key)?.size ?? 0) > 0 && !!this.docs.get(key)?.features.length;
  }

  /**
   * Výsledky prvků dokumentu `key` ze stavby (`status`) – jediné místo, které je do protokolu zapisuje (vlna 22, 22i):
   * * prvek, který běh přidal nebo přímo upravil: ✓ / ℹ `feature.unchecked` na řádku jeho vzniku / poslední přímé úpravy,
   *   ⚠ `feature.warning` / ✗ `feature.failed` na řádku poslední operace, která změnila jeho nebo cokoli před ním v historii;
   * * prvek, jehož už ohlášený stav se změnil (úprava jiného prvku, proměnné, smazání …): nový stav na řádku té operace
   *   – nikdy tedy nezůstane ✓, které už neplatí;
   * * ostatní prvky (načtený JSON / --open, relace): jen ⚠/✗ – na řádku poslední úpravy, jinak na řádku načtení (✓ se nepíší).
   * `final`: prvek bez výsledku = ⚠ feature.unverified (nikdy ✓); jinak zůstane čekat na další stavbu. `line` = řádek
   * operace, která stavbu vyvolala (přísný režim) – pro prvky bez vlastního řádku.
   */
  report(key: string, doc: CadDoc, status: readonly FeatureStatus[] | null, o: { final: boolean; header?: boolean; took?: boolean; line?: number | null }): void {
    const st = new Map((status ?? []).map((s) => [s.id, s]));
    const pend = new Map(this.pending(key).map((x) => [x.f.id, x]));
    const loadedLine = this.loadedAt.get(key) ?? null;
    /** výsledky k zapsání (pořadí historie) – zapíší se najednou, aby řádek s ⚠/✗ jednoho prvku nedostal ✓ jiného */
    const out: { f: Feature; s: FeatureStatus; state: FeatureState; line: number | null; o: { took?: boolean; typed?: boolean } }[] = [];
    for (const f of doc.features) {
      const s = st.get(f.id);
      const x = pend.get(f.id);
      const id = `${key}\u0000${f.id}`;
      if (!s) {
        if (!x || !o.final) continue;
        this.reported.add(f.id);
        this.told.set(id, "unverified");
        this.ctx.log?.tailLine(`⚠ ${f.name} (${f.type}): ${codeText("feature.unverified", f.name)}`);
        this.ctx.report.code("feature.unverified", { line: x.line, doc: doc.name, args: [f.name] });
        continue;
      }
      const state = featureState(s)!;
      const sig = `${state}\u0000${state === "error" ? (s.error ?? "") : state === "warn" ? s.warning : state === "unchecked" ? (s.body?.why ?? "") : ""}`;
      const before = this.told.get(id);
      const bad = state === "error" || state === "warn";
      const after = this.affected.get(id);
      if (x) {
        this.reported.add(f.id);
        this.told.set(id, sig);
        out.push({ f, s, state, line: bad ? (after ?? x.line) : x.line, o: { took: o.took, typed: true } });
      } else if (before === undefined) {
        // varování prvku, který běh nezměnil, jen u načteného dokumentu nebo po úpravě, která ho mohla způsobit
        if (!bad || this.flagged.has(f.id) || (state === "warn" && after === undefined && loadedLine === null)) continue;
        this.told.set(id, sig);
        // dokument, ze kterého běh odešel (ověření `verifyDoc`), píše prvek s typem jako dřív; otevřený dokument na konci bez typu
        out.push({ f, s, state, line: after ?? loadedLine ?? o.line ?? null, o: { typed: !!o.header } });
      } else if (before !== sig) {
        this.told.set(id, sig);
        out.push({ f, s, state, line: after ?? o.line ?? null, o: { took: o.took, typed: true } });
      }
    }
    // řádek (příkaz), kterému patří ⚠/✗ některého prvku, není zelený: ✓ jiných prvků na témže řádku se píše jako ℹ feature.built
    const red = new Set<number>();
    for (const x of out) if ((x.state === "error" || x.state === "warn") && x.line !== null) red.add(x.line);
    for (const e of this.ctx.report.entries) if ((e.level === "error" || e.level === "warn") && e.line !== null && e.doc === doc.name) red.add(e.line);
    for (const x of out) this.emit(doc, x.f, x.s, x.state, x.line, { ...x.o, demote: x.line !== null && red.has(x.line) });
    if (!status) return;
    // Stavba ověřila stav dokumentu po POSLEDNÍ operaci, která ho změnila. Výsledek celého dokumentu („… postaven“) proto
    // smí dostat jen její řádek; řádek načtení / dřívější úpravy, jehož mezistav se samostatně nestavěl a který nemá výsledek
    // žádného prvku, dostane ℹ `op.superseded` (nezkontrolováno – nikdy ✓ za stav, který se nepočítal).
    const last = this.lastChange.get(key);
    const has = (line: number | null) => this.ctx.report.entries.some((e) => e.line === line && e.doc === doc.name && (e.level === "ok" || e.level === "warn" || e.level === "error" || RESULT_NOTES.has(e.code ?? "")));
    if (this.loadedAt.has(key) && !this.loadedTold.has(key)) {
      const at = this.loadedAt.get(key) ?? null;
      if (last !== undefined && last !== at) {
        if (!has(at) || at === null) this.superseded(doc, at, last);
        this.loadedTold.add(key);
      } else if (this.docResult(doc, status, at, red, o.final)) this.loadedTold.add(key);
    }
    for (const line of [...(this.rebuilt.get(key) ?? [])].sort((a, b) => a - b)) {
      if (has(line)) this.rebuilt.get(key)!.delete(line);
      else if (line !== last) {
        this.superseded(doc, line, last ?? null);
        this.rebuilt.get(key)!.delete(line);
      } else if (this.docResult(doc, status, line, red, o.final)) this.rebuilt.get(key)!.delete(line);
    }
  }

  /** ℹ stav modelu po řádku `line` se samostatně nestavěl – ověřen je až stav po řádku `last` */
  private superseded(doc: CadDoc, line: number | null, last: number | null): void {
    const o = { doc: doc.name, args: [last ?? "–"] };
    if (this.ctx.log) this.ctx.log.coded(line, "op.superseded", o);
    else this.ctx.report.code("op.superseded", { ...o, line });
  }

  /**
   * Výsledek stavby celého dokumentu na řádku `line`: řádek načtení dokumentu (JSON na řádku, `otevřít`, `--open` – načtení
   * samo je jen přijetí ℹ `op.accepted` a ✓ jednotlivých prvků se u načteného dokumentu nepíší) a řádek úpravy, po které se
   * dokument přepočítal a žádný prvek na něm nezměnil stav (22i: přijetí má vždy výsledek; žádný řádek nemá ✓ a pak ✗).
   * ✓ jen když jsou VŠECHNY prvky dokumentu ✓; má-li některý ⚠/✗, mluví jeho řádek; nekontrolovala-li se platnost tělesa,
   * je výsledek ℹ `doc.unchecked` s důvodem. Vrací false, když stavba ještě nedala výsledky všech prvků (zkusí se příště).
   */
  private docResult(doc: CadDoc, status: readonly FeatureStatus[], line: number | null, red: ReadonlySet<number>, final: boolean): boolean {
    const st = new Map(status.map((s) => [s.id, s]));
    const states = doc.features.map((f) => featureState(st.get(f.id)));
    if (states.some((x) => x === undefined)) {
      // stavba nevrátila výsledek některého prvku: nikdy ✓ – na konci ⚠ feature.unverified (prvky běhu hlásí `report`)
      if (!final) return false;
      for (const f of doc.features) {
        if (st.has(f.id) || this.added.has(f.id)) continue;
        this.ctx.log?.tailLine(`⚠ ${f.name}: ${codeText("feature.unverified", f.name)}`);
        this.ctx.report.code("feature.unverified", { line, doc: doc.name, args: [f.name] });
      }
      return true;
    }
    if (!states.length || states.some((x) => x === "error" || x === "warn")) return true;
    if (line !== null && red.has(line)) return true;
    const last = [...doc.features].reverse().map((f) => st.get(f.id)).find((s) => s?.body);
    const unchecked = states.filter((x) => x === "unchecked").length;
    const data = { loaded: { features: states.length, unchecked, ...(last?.body ? { body: levelsData({ ok: true, body: last.body }).body } : {}) } };
    if (unchecked) {
      const why = bodyText(last?.body) || uncheckedText({ why: undefined, faces: 0 });
      this.ctx.log?.tailLine(`ℹ ${codeText("doc.unchecked", doc.name, states.length, why)}`);
      this.ctx.report.code("doc.unchecked", { line, doc: doc.name, args: [doc.name, states.length, why], data });
      return true;
    }
    const body = bodyText(last?.body);
    const text = tr("dokument „{0}“ postaven: prvků {1}, bez ⚠ a ✗{2}", doc.name, states.length, body ? ` · ${body}` : "");
    this.ctx.log?.tailLine(`✓ ${text}`);
    this.ctx.report.add({ line, level: "ok", text, doc: doc.name, data });
    return true;
  }

  /** řádek konzole (za stavbou) a záznam protokolu o stavu prvku; `typed` = s typem prvku v závorce (prvky běhu) */
  private emit(doc: CadDoc, f: Feature, s: FeatureStatus, state: FeatureState, line: number | null, o: { took?: boolean; typed?: boolean; demote?: boolean }): void {
    const log = this.ctx.log;
    const rb = this.ctx.report;
    const took = o.took && s.ms !== undefined && s.ms >= 100 ? ` · ${fmtNum(s.ms / 1000, 1)} s` : "";
    const name = o.typed ? `${f.name} (${f.type})` : f.name;
    const data = { levels: levelsData(s) };
    const lv = levelsText(s);
    if (state === "error") {
      this.flagged.add(f.id);
      log?.tailLine(`✗ ${name}: ${s.error ?? "chyba stavby"}`);
      rb.code("feature.failed", { line, doc: doc.name, args: [f.name, s.error ?? ""], data });
    } else if (state === "warn") {
      this.flagged.add(f.id);
      log?.tailLine(`⚠ ${name}: ${s.warning}${took}`);
      rb.code("feature.warning", { line, doc: doc.name, args: [f.name, s.warning ?? ""], data });
    } else if (state === "off") {
      // potlačený prvek (přímo nebo konfigurací) se nestavěl – žádné ✓ za prvek, který model neobsahuje
      this.flagged.delete(f.id);
      log?.tailLine(`ℹ ${name} · ${lv}`);
      rb.code("feature.suppressed", { line, doc: doc.name, args: [f.name], data });
    } else if (state === "unchecked") {
      const text = lv || uncheckedText({ why: s.body?.why, faces: s.body?.faces ?? 0 });
      log?.tailLine(`ℹ ${name} · ${text}${took}`);
      rb.code("feature.unchecked", { line, doc: doc.name, args: [f.name, text], data });
    } else if (o.demote) {
      this.flagged.delete(f.id);
      log?.tailLine(`ℹ ${f.name} (${f.type})${lv ? ` · ${lv}` : ""}${took}`);
      rb.code("feature.built", { line, doc: doc.name, args: [f.name, lv || f.type], data });
    } else {
      this.flagged.delete(f.id);
      const text = `${f.name} (${f.type})${lv ? ` · ${lv}` : ""}`;
      log?.tailLine(`✓ ${text}${took}`);
      rb.add({ line, level: "ok", text, doc: doc.name, data });
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
    const touched = loaded || this.owes(key) || [...this.added.values()].some((x) => x.key === key);
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
    // (načtený dokument – JSON, --open: prvky, které běh nepřidal, hlásí `report` jen ✗/⚠ na řádku načtení, ✓ se nepíší)
    this.report(key, doc, status, { final, header: true });
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
    const kernel = this.ctx.host.kernel;
    // jádro bez operace `check` (starší hostitel, test) – plná stavba dá tytéž výsledky prvků
    const res = typeof kernel.check === "function" ? await kernel.check(d) : await kernel.build(d).then((b) => ({ status: b.status, paramErrors: b.paramErrors ?? [], solid: !!b.metrics }));
    this.checkedSig.set(key, sig);
    // nové prvky na jejich řádku; prvky, kterým operace změnila už ohlášený stav (i ✓ → ⚠/✗), na řádku operace
    this.report(key, d, res.status, { final: false, line });
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
