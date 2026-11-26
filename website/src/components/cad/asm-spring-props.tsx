"use client";
/**
 * Panel komponenty sestavy – přezdívka instance a pružina mezi komponentami (vlna 15, balík asm).
 * Přezdívka (`vložit … jako "K48"`) se ukládá přímo do komponenty; pružinu panel zadá stejným textovým příkazem jako agent
 * (`sestava pružina #k mezi #a #b volná … blok … tuhost …`) – dosedací plochy, délku a sílu tak počítá jedna cesta (cad/asm-spring-agent.ts).
 */
import { useState } from "react";
import { aliasProblem, fmt } from "@/cad/agent-asm";
import { springGeom } from "@/cad/asm-spring-geom";
import { solidOf, springVerdict } from "@/cad/asm-spring";
import { springFixCmd, springLostSideTexts } from "@/cad/spring-lost";
import { tr } from "@/cad/i18n";
import type { AsmComponent, CadDoc } from "@/cad/types";
import { Num } from "./props";

/** řádek protokolu, který se ukáže v hlášce po příkazu z panelu (✓ / ⚠ / ✗ pružiny, jinak první ✗) */
export function springRunNote(out: string): string {
  const lines = out.split("\n").map((l) => l.trim());
  return lines.find((l) => /^[✓⚠✗] /.test(l) && /pružin|spring|feder/i.test(l)) ?? lines.find((l) => l.startsWith("✗")) ?? lines.find(Boolean) ?? "";
}

const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55";

export function AsmInstanceProps({ c, doc, onChange, onRun }: { c: AsmComponent; doc: CadDoc; onChange: (p: Partial<AsmComponent>) => void; onRun?: (text: string) => void }) {
  const comps = doc.components ?? [];
  const ref = (id: string) => `#${comps.findIndex((x) => x.id === id) + 1}`;
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  const g = c.source.kind === "part" ? springGeom(c.source.doc) : null;
  const s = c.spring;
  const others = comps.filter((x) => x.id !== c.id);
  const [a, setA] = useState(s?.a.compId ?? others[0]?.id ?? "");
  const [b, setB] = useState(s?.b.compId ?? others[1]?.id ?? others[0]?.id ?? "");
  const [free, setFree] = useState(s?.free ?? g?.length ?? 0);
  const [solid, setSolid] = useState(s?.solid ?? 0);
  const [rate, setRate] = useState(s?.rate ?? 0);
  const state = s?.length !== undefined ? springVerdict(s.seat ?? s.length, s.free, solidOf(c)) : null;
  // ztracená dosedací plocha (po změně dílu): uložená délka neplatí – žádné ✓ ani délka/síla, jen která plocha chybí (spring-lost.ts)
  const lost = s ? springLostSideTexts(doc, c) : [];
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={label}>{tr("Přezdívka instance (vazby místo #k)")}</span>
        <input
          key={`${c.id}:alias:${c.alias ?? ""}`}
          defaultValue={c.alias ?? ""}
          aria-label={tr("Přezdívka instance (vazby místo #k)")}
          data-asm-alias
          placeholder={tr("např. K48")}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === (c.alias ?? "")) return setAliasErr(null);
            const why = v ? aliasProblem(doc, v, c.id) : null;
            setAliasErr(why);
            if (why) return;
            onChange({ alias: v || undefined });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
        />
        {aliasErr && <span className="mt-1 block text-[11px] text-[#b42318]">{aliasErr}</span>}
      </label>
      {g && onRun && (
        <fieldset className="space-y-2 rounded border border-[#dfe5eb] p-2" data-asm-spring>
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-700/60">{tr("Pružina mezi komponentami")}</legend>
          {s && lost.length > 0 && (
            <p className="rounded border border-[#f3c4c0] bg-[#fef3f2] px-2 py-1 text-[11.5px] text-[#912018]" data-asm-spring-state data-asm-spring-lost={lost.length}>
              ✗ {tr("Ztracená dosedací plocha – délka a síla pružiny se nekontrolují:")}
              {lost.map((t) => (
                <span key={t} className="block">
                  {t}
                </span>
              ))}
              <span className="block">{tr("Vyberte komponenty A a B a klikněte na Upravit pružinu (dosedací plocha = nejbližší kolmá rovinná plocha), nebo textem: {0}", springFixCmd(doc, c))}</span>
            </p>
          )}
          {s && !lost.length && (
            <p className="text-[11.5px] text-[#4a5563]" data-asm-spring-state>
              {state?.level === "error" ? "✗" : state?.level === "warn" ? "⚠" : "✓"} {tr("délka {0} mm", fmt(s.length ?? s.free, 3))} · L0 {fmt(s.free, 3)}
              {solidOf(c) !== undefined ? ` · Ln ${fmt(solidOf(c)!, 3)}` : ""}
              {s.rate !== undefined && s.length !== undefined ? ` · F ${fmt(s.rate * (s.free - s.length), 1)} N` : ""}
              {state?.note ? ` – ${state.note}` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [tr("Dosedá na (A)"), a, setA],
                [tr("Stlačuje (B)"), b, setB],
              ] as const
            ).map(([t, v, set]) => (
              <label key={t} className="block">
                <span className={label}>{t}</span>
                <select value={v} onChange={(e) => set(e.target.value)} className="w-full rounded border border-ink-700/12 px-1.5 py-1 text-[12px]">
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {ref(x.id)} {x.alias ? `[${x.alias}] ` : ""}{x.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Num label={tr("Volná délka L0")} value={free} min={0.1} step={0.5} onChange={setFree} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Délka na doraz Ln (0 = z modelu)")} value={solid} min={0} step={0.5} onChange={setSolid} />
            <Num label={tr("Tuhost c (0 = neuvádět)")} value={rate} min={0} step={0.5} suffix="N/mm" onChange={setRate} />
          </div>
          <p className="text-[11px] text-[#6b7785]">{tr("Dosedací plochy: nejbližší rovinná plocha komponenty kolmá na osu pružiny. Délka se přepočítá při každém přepočtu vazeb i v pohybové studii.")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-asm-spring-apply
              disabled={!a || !b || a === b || !(free > 0)}
              // 0 = zrušit dřív zadanou hodnotu (blok 0 = délka na doraz z modelu, tuhost 0 = bez síly) – jinak by stará hodnota zůstala
              onClick={() => onRun(`sestava pružina ${ref(c.id)} mezi ${ref(a)} ${ref(b)} volná ${free}${solid > 0 || s?.solid !== undefined ? ` blok ${solid}` : ""}${rate > 0 || s?.rate !== undefined ? ` tuhost ${rate}` : ""}`)}
              className="flex-1 rounded bg-[#2563eb] py-1.5 text-[12px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-40"
            >
              {s ? tr("Upravit pružinu") : tr("Nastavit pružinu")}
            </button>
            {s && (
              <button type="button" onClick={() => onRun(`sestava pružina ${ref(c.id)} odebrat`)} className="rounded border border-[#cfd6de] px-2 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
                {tr("Odebrat")}
              </button>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
