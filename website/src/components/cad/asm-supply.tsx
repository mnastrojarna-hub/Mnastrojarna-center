"use client";
/**
 * Panel komponenty sestavy – druh položky kusovníku (vyráběný / normálie / nakupovaný) s údaji normálie a nákupu a stav
 * kopie dílu („starší než díl v záložce“ + tlačítko Obnovit z dílu) – vlna 22, body 19 a 22g.
 *
 * Druh se ukládá na komponentu (`AsmComponent.supply`, přepis druhu dílu) stejně jako textem
 * `sestava komponenta #k druh nakupovaný katalog "…" výrobce "…"`; obnova z dílu volá týž textový příkaz jako agent
 * (`sestava obnovit #k`) – jedna funkce `refreshPlan` (cad/asm-refresh.ts) pro text, CLI i aplikaci.
 */
import { bomWarnings } from "@/cad/agent-asm";
import type { BomRow } from "@/cad/assembly";
import { copyFieldsText, copyState, originName, staleCopies, staleCopyText, staleHints } from "@/cad/asm-refresh";
import { defaultSupply, supplyOf, supplyOptions, supplyWord } from "@/cad/bom-model";
import { tr } from "@/cad/i18n";
import type { AsmComponent, CadDoc, SupplyInfo, SupplyKind } from "@/cad/types";

const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55";
const input = "w-full rounded border border-[#cfd6de] px-2 py-1 text-[12px]";

export type PartLookup = (name: string) => CadDoc | null;

/**
 * upozornění k tabulce Kusovník: zastaralé kopie dílů (s obnovou) a co chybí vyráběným dílům – stejné texty jako příkaz
 * `kusovník` (asm-agent.ts: `bomWarnings(rows, staleHints(…))` – u starší kopie rada `sestava obnovit #N`, bod 22g, kolo 6)
 */
export function bomNotesOf(doc: CadDoc, rows: BomRow[], partOf: PartLookup): { text: string; stale?: boolean }[] {
  if (doc.kind !== "assembly") return [];
  return [...staleCopies(doc, partOf).map((s) => ({ text: staleCopyText(s), stale: true })), ...bomWarnings(rows, staleHints(doc, partOf)).map((text) => ({ text }))];
}

/**
 * Výpis příkazu `výkresy dílů` z protokolu běhu (tlačítko „Výrobní dokumentace“ v okně Kusovník – bod 19, kolo 7): od nadpisu
 * „Výkresy dílů sestavy …“ po konec výpisu; ⚠ řádky protokolu (díl bez výkresu, varování listu) se připojí – nic se nezamlčí.
 */
export function partDrawingsNote(out: string): string {
  const lines = out.split("\n");
  const head = tr("Výkresy dílů sestavy „{0}“ – vyráběných dílů {1} (normálie {2} a nakupované {3} výkres nedostanou):", "", "", "", "").split("„")[0];
  const i = lines.findIndex((l) => l.trimStart().startsWith(head));
  if (i < 0) return out.trim();
  // výpis = nadpis, oddíly (Založeno / Výkres už mají / Nezaloženo …) a jejich odsazené řádky; končí prázdným řádkem nebo
  // dalším záznamem protokolu (✓ ℹ ⚠ ✗ → =) či stavem dokumentu
  const body: string[] = [lines[i].trim()];
  for (const l of lines.slice(i + 1)) {
    if (!l.trim() || /^(✓|ℹ|⚠|✗|→|=|Dokument:|Document:|Dokument „)/.test(l)) break;
    body.push(l.trim());
  }
  return [...body, ...lines.filter((l) => l.startsWith("⚠") || l.startsWith("✗"))].join("\n");
}

/** jedno textové pole údaje druhu (uloží se při opuštění pole / Enter) */
function SupplyText({ id, title, value, placeholder, onCommit }: { id: string; title: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      <input
        key={`${id}:${value}`}
        data-supply-field={id}
        defaultValue={value}
        placeholder={placeholder}
        className={input}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== value) onCommit(e.currentTarget.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function AsmSupplyFields({ c, doc, onChange, onRun, partOf }: { c: AsmComponent; doc: CadDoc; onChange: (p: Partial<AsmComponent>) => void; onRun?: (text: string) => void; partOf?: PartLookup }) {
  if (c.source.kind === "asm") return null;
  const s = supplyOf(c);
  const def = defaultSupply(c);
  const set = (patch: Partial<SupplyInfo>) => {
    const next: SupplyInfo = { ...(c.supply ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof SupplyInfo)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange({ supply: Object.keys(next).length ? next : undefined });
  };
  const k = (doc.components ?? []).findIndex((x) => x.id === c.id) + 1;
  const ref = c.alias ? `"${c.alias}"` : `#${k}`;
  const name = originName(c);
  const st = name && partOf ? copyState(c, partOf(name)) : null;
  const why = def.why === "file" ? tr("importovaný soubor") : def.why === "import" ? tr("díl jen z importu") : def.why === "library" ? tr("z knihovny normálií") : tr("vlastní díl");
  return (
    <div className="space-y-2" data-supply-kind={s.kind} data-supply-explicit={s.explicit || undefined}>
      <label className="block">
        <span className={label}>{tr("Druh v kusovníku")}</span>
        <select
          data-supply-select
          value={c.supply?.kind ?? ""}
          onChange={(e) => set({ kind: (e.target.value || undefined) as SupplyKind | undefined })}
          className={input}
        >
          {supplyOptions().map((o) => (
            <option key={o.v} value={o.v}>
              {o.v ? o.l : tr("výchozí – {0} ({1})", supplyWord(def.kind), why)}
            </option>
          ))}
        </select>
      </label>
      {s.kind === "standard" && (
        <div className="grid grid-cols-2 gap-2">
          <SupplyText id="size" title={tr("Rozměr")} value={c.supply?.size ?? ""} placeholder={s.size} onCommit={(v) => set({ size: v })} />
          <SupplyText id="grade" title={tr("Třída / tolerance")} value={c.supply?.grade ?? ""} placeholder={s.grade} onCommit={(v) => set({ grade: v })} />
        </div>
      )}
      {s.kind === "buy" && (
        <div className="grid grid-cols-2 gap-2">
          <SupplyText id="catalog" title={tr("Katalogové číslo")} value={c.supply?.catalog ?? ""} placeholder={s.catalog} onCommit={(v) => set({ catalog: v })} />
          <SupplyText id="vendor" title={tr("Výrobce")} value={c.supply?.vendor ?? ""} placeholder={s.vendor} onCommit={(v) => set({ vendor: v })} />
        </div>
      )}
      {st && st.stale.length > 0 && (
        <div data-copy-stale={copyFieldsText(st.stale)} className="rounded border border-[#f0c36d] bg-[#fff8e6] p-2 text-[11.5px] leading-snug text-[#7a5300]">
          <p>
            ⚠ {st.legacy ? tr("Kopie v sestavě se liší od dílu „{0}“ v záložce: {1}.", name, copyFieldsText(st.stale)) : tr("Kopie je starší než díl „{0}“ v záložce: {1}.", name, copyFieldsText(st.stale))}{" "}
            {tr("Kusovník a výkres sestavy ukazují údaje kopie.")}
          </p>
          {st.local.length > 0 && <p className="mt-1">{tr("Kopie byla upravena i v sestavě ({0}) – obnova tuto úpravu přepíše.", copyFieldsText(st.local))}</p>}
          {onRun && (
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" data-refresh-btn="all" onClick={() => onRun(`sestava obnovit ${ref}`)} className="rounded bg-brand px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-brand-600">
                {tr("Obnovit z dílu")}
              </button>
              {st.stale.some((f) => f !== "geometry" && f !== "drawing") && st.stale.some((f) => f === "geometry" || f === "drawing") && (
                <button type="button" data-refresh-btn="meta" onClick={() => onRun(`sestava obnovit ${ref} údaje`)} className="rounded border border-[#cfd6de] bg-white px-2 py-1 text-[11.5px] hover:bg-[#f3f6f9]" title={tr("Jen číslo, materiál a druh – geometrie a výkresy zůstanou")}>
                  {tr("Jen údaje")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
