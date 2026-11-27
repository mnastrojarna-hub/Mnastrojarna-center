"use client";
/**
 * Panel Kolize řízený stavem (vlna 22, bod 1): žádná vlastní kopie výsledku – dostane záznam kontroly AKTIVNÍHO dokumentu
 * z enginu (`ws.asm.clash` pod klíčem dokumentu) a jeho stav vůči právě zobrazenému stavu sestavy
 * (`clashStateOf`, cad/engine/result-key.ts):
 *
 *  * `ok`        – zkontrolováno přesně pro tento dokument, revizi dílů, konfiguraci a polohu → „Bez kolizí ✓“,
 *  * `clash`     – totéž, s průniky → seznam dvojic,
 *  * `stale`     – sestava se od kontroly změnila (posun, úprava dílu, konfigurace, krok mechanismu) → „Neplatí“,
 *  * `unchecked` – pro tento dokument kontrola neproběhla (jiná záložka, nový dokument) → „Nezkontrolováno“.
 *
 * Zelený stav se nikdy neukáže pro jiný dokument ani pro jiný stav sestavy; neplatný a chybějící výsledek nabídne
 * „Zkontrolovat znovu“. Hlavička výsledku říká, pro co platí: dokument, počet komponent, čas, revize modelu a poloha
 * mechanismu.
 *
 * Třídy (vlna 22, bod 5 – balík C1): dvojice po třídách (skutečné, nevyhodnotitelné, pracovní kontakt, dotyk, pod hlavou,
 * šroub v závitu) s počty – třídy jsou přepínače (filtr), závady rozbalené, ostatní sbalené; opakované nálezy seskupené
 * („4× Přidržovač × Šroub M12 [#3, #4, #5, #6]“), u položky instance a místo průniku. Pravidla dokumentu (pracovní kontakt
 * operace, závit bez prvku, tolerance dotyku – cad/clash-rules.ts) se uplatní hned bez nové kontroly (geometrie se nemění).
 */
import { useMemo, useState } from "react";
import type { ClashClass } from "@/cad/clash-class";
import { CLASS_ORDER, className, entryClashes, faultLeafIds, groupClashes, groupPairText, groupVolText, placeText, ruleText, undeterminedWhy, type ClashGroup } from "@/cad/clash-report";
import { isFault, touchTol } from "@/cad/clash-rules";
import { countClasses } from "@/cad/clash-class";
import type { ClashState, ResultId } from "@/cad/engine/result-key";
import { tr } from "@/cad/i18n";
import type { CadDoc, ClashRule, Vec3 } from "@/cad/types";
import { clashHeader, clashNote, clashTitleClasses, type ClashPanelEntry } from "./clash-view";
import { FloatPanel } from "./ui";

/** pravidlo bez id (id přidělí dokument) */
export type ClashRuleDraft = Omit<ClashRule, "id">;

export function ClashPanel({
  doc,
  docKey,
  state,
  entry,
  id,
  busy,
  top,
  onRecheck,
  onClose,
  onSelect,
  onFocus,
  onRules,
  onTol,
  focused,
}: {
  /** aktivní sestava (názvy komponent, pravidla kolizí) */
  doc: CadDoc;
  docKey: string;
  state: ClashState;
  /** záznam kontroly aktivního dokumentu (undefined = žádný) */
  entry?: ClashPanelEntry;
  /** identita, pro kterou záznam vznikl (razítko) */
  id?: ResultId;
  /** kontrola právě běží */
  busy?: boolean;
  top?: number;
  onRecheck: () => void;
  onClose: () => void;
  onSelect: (compId: string) => void;
  /** přiblížit 3D okno na místo průniku (kolo 7, bod 5): střed a obálka průniku ve světových souřadnicích */
  onFocus?: (at: Vec3, box?: [Vec3, Vec3]) => void;
  /** přidat pravidla / odebrat pravidlo (vlna 22, bod 5); bez obsluhy panel pravidla jen ukáže */
  onRules?: (add: ClashRuleDraft[], removeId?: string) => void;
  /** tolerance dotyku [mm] */
  onTol?: (mm: number) => void;
  /** cíl kamery po posledním přiblížení na místo průniku („x;y;z“, z 3D okna – e2e) */
  focused?: string;
}) {
  const valid = state === "ok" || state === "clash";
  const n = entry?.res.length ?? 0;
  // výsledné třídy po NYNĚJŠÍCH pravidlech dokumentu (bez nové kontroly – pravidla geometrii nemění)
  const list = useMemo(() => (valid && entry ? entryClashes(entry, doc) : []), [valid, entry, doc]);
  const counts = useMemo(() => (valid && entry ? countClasses(list) : null), [valid, entry, list]);
  const groups = useMemo(() => groupClashes(list, doc), [list, doc]);
  const faults = (counts?.real ?? 0) + (counts?.undetermined ?? 0);
  /** rozbalené třídy (filtr): závady vždy na začátku rozbalené, ostatní sbalené */
  const [open, setOpen] = useState<Set<ClashClass>>(() => new Set<ClashClass>(["real", "undetermined"]));
  const [ruleFor, setRuleFor] = useState<number | null>(null);
  const toggle = (c: ClashClass) => setOpen((s) => (s.has(c) ? new Set([...s].filter((x) => x !== c)) : new Set([...s, c])));
  const rules = doc.clashRules ?? [];
  return (
    <FloatPanel title={clashTitleClasses(state, n, counts)} icon="section" tone={state === "ok" || (state === "clash" && !faults) ? "tool" : "cut"} width={312} onClose={onClose} initial={{ x: 12, y: top ?? 12 }}>
      <div
        data-clash-panel
        data-clash-state={state}
        data-clash-doc={docKey}
        data-clash-name={doc.name}
        data-clash-rev={valid ? (id?.rev ?? "") : ""}
        data-clash-pose={valid ? (id?.pose ?? "") : ""}
        data-clash-busy={busy ? "1" : undefined}
        data-clash-real={counts?.real ?? undefined}
        data-clash-undetermined={counts?.undetermined ?? undefined}
        data-clash-thread={counts ? counts.thread + counts.underhead : undefined}
        data-clash-touch={counts?.touch ?? undefined}
        data-clash-work={counts?.work ?? undefined}
        data-clash-groups={valid ? groups.length : undefined}
        data-clash-hl={valid ? [...faultLeafIds(list)].sort().join(" ") : undefined}
        data-clash-focused={focused || undefined}
      >
        {valid && entry && (
          <>
            <p data-clash-result className="mb-1 text-[11px] leading-snug text-[#5b6776]">
              {n ? `${n} ${n === 1 ? tr("průnik") : n < 5 ? tr("průniky") : tr("průniků")}` : tr("Žádný průnik komponent")} {tr("· zkontrolováno")} {clashHeader(entry, id, doc.name)}
            </p>
            {/* vlna 22, bod 6: nulový průnik není důkaz, že nic nedře – vůli měří pohybová studie */}
            <p data-clash-clearance="unchecked" className="mb-1 text-[10.5px] leading-snug text-[#8a5300]">
              {tr("Vůle (nejmenší vzdálenost dílů) se tu nekontroluje – průnik pod 0,001 mm³ a dotyk se nehlásí. Vůli s limitem sleduje pohybová studie: sekce Vůle, nebo pohyb vůle \"A\" \"B\" min 0,05.")}
            </p>
            {n > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label={tr("Třídy kolizí")}>
                {CLASS_ORDER.map((c) => {
                  const k = (counts?.[c] as number | undefined) ?? 0;
                  if (!k) return null;
                  return (
                    <button
                      key={c}
                      type="button"
                      data-clash-filter={c}
                      aria-pressed={open.has(c)}
                      onClick={() => toggle(c)}
                      className={`rounded border px-1.5 py-0.5 text-[10.5px] ${open.has(c) ? (isFault(c) ? "border-brand bg-[#fde3e1] text-brand-600" : "border-[#9fb3c8] bg-[#eef3f8]") : "border-[#d5dbe2] text-[#5b6776]"}`}
                    >
                      {className(c)} {k}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {groups.map((g, gi) =>
                open.has(g.cls) ? (
                  <GroupRow
                    key={gi}
                    g={g}
                    doc={doc}
                    onSelect={onSelect}
                    onFocus={onFocus}
                    ruleOpen={ruleFor === gi}
                    onRuleOpen={(v) => setRuleFor(v ? gi : null)}
                    onRules={onRules}
                  />
                ) : null,
              )}
              {n > 0 && !groups.some((g) => open.has(g.cls)) && <p className="text-[11px] text-[#8a95a3]">{tr("Zvolte třídu nahoře – dvojice jsou skryté filtrem.")}</p>}
            </div>
            {(rules.length > 0 || onTol) && (
              <details data-clash-rules className="mt-2 border-t border-[#e3e8ee] pt-1.5 text-[11px]">
                <summary className="cursor-pointer text-[#4a5664]">
                  {tr("Pravidla kolizí ({0}) · dotyk pod {1} mm", rules.length, String(touchTol(doc)).replace(".", ","))}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {rules.map((r) => (
                    <li key={r.id} data-clash-rule={r.id} className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 leading-snug">{ruleText(doc, r)}</span>
                      {onRules && (
                        <button type="button" data-clash-rule-del={r.id} aria-label={tr("Odebrat pravidlo")} onClick={() => onRules([], r.id)} className="rounded px-1 text-[#8a95a3] hover:bg-[#f3f6f9] hover:text-brand">
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {onTol && (
                  <label className="mt-1 flex items-center gap-1.5">
                    {tr("Tolerance dotyku [mm]")}
                    <input
                      type="number"
                      data-clash-tol
                      min={0}
                      step={0.001}
                      defaultValue={touchTol(doc)}
                      onBlur={(e) => {
                        const v = Number(e.currentTarget.value.replace(",", "."));
                        if (Number.isFinite(v) && v >= 0 && v !== touchTol(doc)) onTol(v);
                      }}
                      className="w-20 rounded border border-[#cfd6de] px-1 py-0.5"
                    />
                  </label>
                )}
              </details>
            )}
          </>
        )}
        {!valid && (
          <>
            <p data-clash-note className="mb-2 rounded border border-[#f1d9a7] bg-[#fff8e6] px-2 py-1.5 text-[11.5px] leading-snug text-[#7a5600]">
              {clashNote(state)}
            </p>
            {state === "stale" && entry && (
              <p data-clash-old className="mb-2 text-[10.5px] leading-snug text-[#8a95a3]">
                {tr("Poslední kontrola platila pro:")} {clashHeader(entry, id, doc.name)}
              </p>
            )}
            <button type="button" data-clash-recheck disabled={busy} onClick={onRecheck} className="w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {busy ? tr("Kontroluji kolize…") : state === "stale" ? tr("Zkontrolovat znovu") : tr("Zkontrolovat kolize")}
            </button>
          </>
        )}
        {valid && busy && <p className="mt-1 text-[11px] text-[#8a95a3]">{tr("Kontroluji kolize…")}</p>}
      </div>
    </FloatPanel>
  );
}

/** jedna skupina nálezů: dvojice (instance), objem, místo, důvod; u závady volba pravidla pracovního kontaktu / závitu */
function GroupRow({ g, doc, onSelect, onFocus, ruleOpen, onRuleOpen, onRules }: { g: ClashGroup; doc: CadDoc; onSelect: (compId: string) => void; onFocus?: (at: Vec3, box?: [Vec3, Vec3]) => void; ruleOpen: boolean; onRuleOpen: (v: boolean) => void; onRules?: (add: ClashRuleDraft[], removeId?: string) => void }) {
  const fault = isFault(g.cls);
  const first = g.items[0];
  const place = placeText(first);
  const canWork = !!onRules && (fault || g.cls === "touch");
  const canThread = !!onRules && g.why === "no-thread-feature";
  return (
    <div data-clash-group data-clash-cls={g.cls} data-clash-n={g.items.length} className={`rounded px-1.5 py-1 text-[11.5px] ${fault ? "hover:bg-[#fde3e1]" : "hover:bg-[#f3f6f9]"}`}>
      <button
        type="button"
        data-clash-at={first.at ? first.at.map((v) => Math.round(v * 1000) / 1000).join(";") : undefined}
        title={first.at && onFocus ? tr("Vybrat a přiblížit na místo průniku") : undefined}
        onClick={() => {
          onSelect(first.aPath?.[0] ?? first.a);
          // přiblížení na místo průniku (kolo 7, bod 5 – dřív klik jen vybral komponentu)
          if (first.at && onFocus) onFocus(first.at, first.box);
        }}
        className="block w-full text-left"
      >
        <span className="font-medium">
          {g.items.length > 1 ? `${g.items.length}× ` : ""}
          {groupPairText(g)}
        </span>
        <span className={`block font-mono text-[10.5px] ${fault ? "text-brand-600" : "text-[#5b6776]"}`}>
          {className(g.cls)} · {groupVolText(g)} mm³{place ? ` · ${place}` : ""}
        </span>
        {g.cls === "undetermined" && <span className="block text-[10.5px] leading-snug text-[#7a5600]">{undeterminedWhy(first)}</span>}
      </button>
      {(canWork || canThread) && !ruleOpen && (
        <div className="mt-0.5 flex gap-1">
          {canWork && (
            <button type="button" data-clash-rule-add="work" onClick={() => onRuleOpen(true)} className="rounded border border-[#cfd6de] px-1.5 py-0.5 text-[10.5px] hover:bg-white">
              {tr("Pracovní kontakt…")}
            </button>
          )}
          {canThread && (
            <button type="button" data-clash-rule-add="thread" onClick={() => onRules!(g.items.map((i) => ({ kind: "thread", a: i.aPath ?? [i.a], b: i.bPath ?? [i.b] })))} className="rounded border border-[#cfd6de] px-1.5 py-0.5 text-[10.5px] hover:bg-white">
              {tr("Je to závit")}
            </button>
          )}
        </div>
      )}
      {ruleOpen && onRules && <WorkRuleForm g={g} doc={doc} onCancel={() => onRuleOpen(false)} onSave={(when) => (onRules(g.items.map((i) => ({ kind: "work", a: i.aPath ?? [i.a], b: i.bPath ?? [i.b], ...(when ? { when } : {}) }))), onRuleOpen(false))} />}
    </div>
  );
}

/** okno pracovního kontaktu: vždy / kroky studie / hodnota motoru vazby */
function WorkRuleForm({ g, doc, onCancel, onSave }: { g: ClashGroup; doc: CadDoc; onCancel: () => void; onSave: (when: ClashRule["when"] | undefined) => void }) {
  const motors = doc.motion?.motors ?? [];
  const [mode, setMode] = useState<"always" | "steps" | "mate">(motors.length ? "mate" : doc.motion ? "steps" : "always");
  const [k0, setK0] = useState(0);
  const [k1, setK1] = useState(doc.motion?.steps ?? 0);
  const [mate, setMate] = useState(motors[0]?.mate ?? doc.mates?.[0]?.id ?? "");
  const mo = motors.find((m) => m.mate === mate);
  const [v0, setV0] = useState(mo?.from ?? 0);
  const [v1, setV1] = useState(mo?.to ?? 0);
  const num = (s: string) => Number(s.replace(",", "."));
  return (
    <div data-clash-rule-form className="mt-1 space-y-1 rounded border border-[#d5dbe2] bg-white p-1.5 text-[11px]">
      <p className="leading-snug text-[#4a5664]">{tr("Pracovní kontakt {0} – mimo okno zůstane skutečnou kolizí.", groupPairText(g))}</p>
      <select data-clash-rule-mode value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-full rounded border border-[#cfd6de] px-1 py-0.5">
        <option value="always">{tr("vždy")}</option>
        <option value="steps">{tr("v krocích pohybové studie")}</option>
        <option value="mate">{tr("při hodnotě motoru / vazby")}</option>
      </select>
      {mode === "steps" && (
        <div className="flex items-center gap-1">
          <input type="number" data-clash-rule-k0 value={k0} onChange={(e) => setK0(Math.round(num(e.target.value)))} className="w-16 rounded border border-[#cfd6de] px-1" />–
          <input type="number" data-clash-rule-k1 value={k1} onChange={(e) => setK1(Math.round(num(e.target.value)))} className="w-16 rounded border border-[#cfd6de] px-1" />
        </div>
      )}
      {mode === "mate" && (
        <div className="space-y-1">
          <select data-clash-rule-mate value={mate} onChange={(e) => setMate(e.target.value)} className="w-full rounded border border-[#cfd6de] px-1 py-0.5">
            {(doc.mates ?? []).map((m, i) => (
              <option key={m.id} value={m.id}>
                {m.name ?? `${i + 1}`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input type="number" data-clash-rule-v0 value={v0} onChange={(e) => setV0(num(e.target.value))} className="w-20 rounded border border-[#cfd6de] px-1" />–
            <input type="number" data-clash-rule-v1 value={v1} onChange={(e) => setV1(num(e.target.value))} className="w-20 rounded border border-[#cfd6de] px-1" />
          </div>
        </div>
      )}
      <div className="flex gap-1">
        <button type="button" data-clash-rule-save onClick={() => onSave(mode === "steps" ? { steps: [k0, k1] } : mode === "mate" && mate ? { mate, from: v0, to: v1 } : undefined)} className="rounded border border-brand bg-[#fde3e1] px-2 py-0.5 text-brand-600">
          {tr("Uložit pravidlo")}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-[#cfd6de] px-2 py-0.5">
          {tr("Zrušit")}
        </button>
      </div>
    </div>
  );
}
