"use client";

/**
 * Sestava › Pružina mezi díly (vlna 21): klik na dosedací plochu A (rovina, nebo díra / kapsa = válcová plocha) a na plochu B →
 * osa z díry / roviny, změřená vzdálenost dosedacích ploch, tabulka pružiny předvyplněná podle díry (d, De, L0, n, materiál)
 * se spočtenými řádky (D, tuhost R, nt, Ln, nejmenší pracovní délka Ln + Sa, síla a napětí τk při montáži a na dorazu vůči τzul,
 * vzpěr, rezerva do dorazu – EN 13906-1, cad/asm-spring-check.ts) a náhledem z boku; Vytvořit spustí textový příkaz
 * `sestava pružina nová … mezi #A F… #B F… [do děr vzoru]` (cad/asm-spring-between.ts) – vložení, zámek k A, dosedací plochy,
 * délka a síla jednou cestou s textem. U díry vzoru jedním klikem do všech děr (stírač na 6 pružinách).
 */
import { useEffect, useMemo, useState } from "react";
import { fmt, faceShort, type CompFaceRow } from "@/cad/agent-asm";
import type { MateFaceInfo } from "@/cad/asm-kernel";
import { springDefaults, springLite, SPRING_WIRE_MATERIALS, type SpringSpec } from "@/cad/asm-spring-between";
import { springWireOf } from "@/cad/asm-spring-check";
import { tr } from "@/cad/i18n";
import type { CadDoc, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { springRunNote } from "../asm-spring-props";
import type { Leaf } from "../asm-flatten";
import { FloatPanel } from "../ui";
import { DecimalInput } from "./decimal-input";

/** díl s prvkem pružiny (Pružina nebo tabulková pružina balíku part) – ne deska s válcovou dírou */
const isSpringPart = (d: CadDoc) => d.features.some((f) => !f.suppressed && (f.type === "spring" || (f.type === "ext" && f.ext.startsWith("spring."))));
/** vybraná plocha ve světových souřadnicích */
type Picked = { compId: string; leafId: string; face: number; kind: "plane" | "cylinder"; origin: Vec3; normal: Vec3; radius?: number; extent?: [number, number]; point?: Vec3; part?: string };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** bod / směr přenesený maticí 4×4 (po sloupcích) */
const tp = (m: number[], p: Vec3): Vec3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const td = (m: number[], v: Vec3): Vec3 => unit([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]);

/** Osa a vzdálenost dosedacích ploch z výběru (stejně jako cad/asm-spring-between.ts applySpringNew); null = plochy nejdou spojit. */
export function pickLayout(a: Picked, b: Picked): { seat: number; holeD?: number; why?: string } | null {
  const hole = a.kind === "cylinder" ? a : b.kind === "cylinder" ? b : null;
  let u: Vec3;
  if (a.kind === "plane") u = a.normal;
  else if (b.kind === "plane") u = [-b.normal[0], -b.normal[1], -b.normal[2]];
  else u = dot(sub(b.origin, a.origin), hole!.normal) >= 0 ? hole!.normal : [-hole!.normal[0], -hole!.normal[1], -hole!.normal[2]];
  if (hole && Math.abs(Math.abs(dot(hole.normal, u)) - 1) > 1e-3) return { seat: 0, why: tr("Osa díry není kolmá na dosedací rovinu – vyberte protější rovinnou plochu.") };
  if (a.kind === "plane" && b.kind === "plane" && dot(a.normal, b.normal) > -0.999) return { seat: 0, why: tr("Dosedací roviny musí být protilehlé a rovnoběžné.") };
  const axisPt = hole ? hole.origin : (a.point ?? a.origin);
  const mid = (h: Picked) => add(h.origin, h.normal, ((h.extent?.[0] ?? 0) + (h.extent?.[1] ?? 0)) / 2);
  const len = (h: Picked) => Math.abs((h.extent?.[1] ?? 0) - (h.extent?.[0] ?? 0));
  const tA = a.kind === "plane" ? dot(sub(a.origin, axisPt), a.normal) / dot(u, a.normal) : dot(sub(mid(a), axisPt), u) - len(a) / 2;
  const P0 = add(axisPt, u, tA);
  const tB = b.kind === "plane" ? dot(sub(b.origin, P0), b.normal) / dot(u, b.normal) : dot(sub(mid(b), P0), u) + len(b) / 2;
  if (!(tB > 0)) return { seat: 0, why: tr("Plocha B neleží ve směru pružiny od plochy A – vyberte protější plochu.") };
  return { seat: tB, ...(hole ? { holeD: 2 * (hole.radius ?? 0) } : {}) };
}

/** Postup „Pružina mezi díly“ pro aplikaci: tlačítko pásu karet, výběr ploch v 3D okně, výzva a dialog s tabulkou. */
export function useSpringBetween(o: { doc: CadDoc; isAsm: boolean; leaves: Leaf[]; faceInfo: (key: string, face: number) => Promise<MateFaceInfo | null>; faceRows: (compId: string) => Promise<CompFaceRow[]>; run: (text: string) => Promise<string>; flash: (t: string) => void }) {
  const [pick, setPick] = useState<{ a?: Picked; b?: Picked } | null>(null);
  const comps = o.doc.components ?? [];
  const nameOf = (id: string) => comps.find((c) => c.id === id)?.name ?? "?";
  const onFace = async (leafId: string, face: number, point?: Vec3) => {
    if (!pick || face < 0) return;
    const leaf = o.leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    const info = await o.faceInfo(leaf.key, face).catch(() => null);
    if (!info || (info.kind !== "plane" && info.kind !== "cylinder")) return o.flash(tr("Pružina dosedá na rovinnou plochu nebo do díry (válcová plocha) – klikněte na jinou plochu."));
    const p: Picked = { compId: leaf.topId, leafId, face, kind: info.kind, origin: tp(leaf.matrix, info.origin), normal: td(leaf.matrix, info.normal), ...(info.radius ? { radius: info.radius } : {}), ...(info.extent ? { extent: info.extent } : {}), ...(point ? { point } : {}), ...(leaf.id !== leaf.topId ? { part: leaf.comp.name } : {}) };
    choose(p);
  };
  /** vybraná plocha (kliknutím v modelu nebo v seznamu ploch) */
  const choose = (p: Picked) => {
    if (!pick) return;
    if (!pick.a) {
      setPick({ a: p });
      o.flash(tr("Plocha A: {0} – teď klikněte na protější plochu jiného dílu (B).", nameOf(p.compId)));
      return;
    }
    if (p.compId === pick.a.compId) return o.flash(tr("Plocha B musí být na jiném dílu než plocha A."));
    const lay = pickLayout(pick.a, p);
    if (!lay || lay.why) return o.flash(lay?.why ?? tr("Plochy nejde spojit pružinou."));
    setPick({ a: pick.a, b: p });
  };
  const prompt = !pick ? null : !pick.a ? tr("Pružina mezi díly: klikněte na dosedací plochu A – rovinu, nebo díru / kapsu, ve které pružina sedí · Esc zruší") : !pick.b ? tr("Pružina mezi díly: klikněte na protější plochu B jiného dílu (pružinu stlačuje) · Esc zruší") : tr("Pružina mezi díly: vyplňte tabulku a Vytvořit · Esc zruší");
  const springs = comps.filter((c) => c.source.kind === "part" && isSpringPart(c.source.doc));
  const dialog = !pick ? null : !(pick.a && pick.b) ? (
    <FacePicker key={pick.a ? "b" : "a"} doc={o.doc} step={pick.a ? "b" : "a"} exclude={pick.a?.compId} chosen={pick.a} faceRows={o.faceRows} onPick={choose} onCancel={() => setPick(null)} />
  ) : pick.a && pick.b ? (
      <SpringBetweenDialog
        key={`${pick.a.leafId}:${pick.a.face}:${pick.b.leafId}:${pick.b.face}`}
        a={pick.a}
        b={pick.b}
        doc={o.doc}
        existing={springs.map((c) => ({ id: c.id, name: c.name, doc: c.source.kind === "part" ? c.source.doc : null }))}
        onCancel={() => setPick(null)}
        onCreate={async (text) => {
          try {
            const out = await o.run(text);
            o.flash(springRunNote(out));
            if (!/^✗/m.test(out)) setPick(null);
          } catch (e) {
            o.flash((e as Error).message);
          }
        }}
      />
    ) : null;
  return {
    active: !!pick && !(pick.a && pick.b),
    open: !!pick,
    start: () => setPick({}),
    cancel: () => setPick(null),
    onFace,
    prompt,
    dialog,
    ribbonItem: { id: "springBetween", label: tr("Pružina mezi díly"), icon: "sweep", tone: "pattern" as const, active: !!pick, disabled: !o.isAsm || comps.length < 2, why: tr("Sestava potřebuje aspoň dva díly."), onClick: () => (pick ? setPick(null) : setPick({})), hint: tr("klik na díru nebo plochu A a protější plochu B – tabulka pružiny, do všech děr vzoru") },
  };
}

const ref = (doc: CadDoc, p: Picked) => `#${(doc.components ?? []).findIndex((c) => c.id === p.compId) + 1} F${p.face + 1}${p.part ? `@${p.part}` : ""}`;

function SpringBetweenDialog({ a, b, doc, existing, onCancel, onCreate }: { a: Picked; b: Picked; doc: CadDoc; existing: { id: string; name: string; doc: CadDoc | null }[]; onCancel: () => void; onCreate: (text: string) => Promise<void> }) {
  const lay = pickLayout(a, b)!;
  const [s, setS] = useState<SpringSpec>(() => springDefaults(lay.seat, lay.holeD));
  const [rate, setRate] = useState<number | null>(null);
  const [holes, setHoles] = useState(a.kind === "cylinder" || b.kind === "cylinder");
  const [busy, setBusy] = useState(false);
  const guided = a.kind === "cylinder" || b.kind === "cylinder";
  const calc = useMemo(() => springLite(s, lay.seat, guided), [s, lay.seat, guided]);
  const R = rate ?? calc.R;
  const F = R * (s.L0 - lay.seat);
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const row = "grid grid-cols-[1fr_auto] items-center gap-2";
  const input = "w-20 rounded border border-[#cfd6de] px-1.5 py-0.5 text-right font-mono text-[12px]";
  const numIn = (key: keyof SpringSpec, label: string, sym: string, hint: string) => (
    <label className={row} title={hint}>
      <span>
        <b className="font-semibold">{sym}</b> <span className="text-[#5b6776]">{label}</span>
      </span>
      <DecimalInput data-spring-row={key} aria-label={`${sym} ${label}`} className={input} value={s[key] as number} valid={(v) => v > 0} onValue={(v) => v !== null && setS((cur) => ({ ...cur, [key]: v }))} />
    </label>
  );
  const fromExisting = (id: string) => {
    // prvek Pružina i tabulková pružina balíku part (drát, střední průměr, činné závity, L0)
    const w = springWireOf(existing.find((x) => x.id === id)?.doc ?? undefined);
    if (w) setS({ ...s, d: w.d, De: w.D + w.d, L0: w.L0, n: w.n, material: w.material });
  };
  const text = `sestava pružina nová d ${s.d} De ${s.De} L0 ${s.L0} n ${s.n} materiál ${s.material ?? "SH"}${rate !== null ? ` tuhost ${rate}` : ""} mezi ${ref(doc, a)} ${ref(doc, b)}${a.kind === "plane" && b.kind === "plane" && a.point ? ` v ${a.point.map((v) => Math.round(v * 1000) / 1000).join(" ")}` : ""}${holes && (a.kind === "cylinder" || b.kind === "cylinder") ? " do děr vzoru" : ""}`;
  // náhled z boku: dosedací plochy, závity ve volné délce (čárkovaně) a v montážní délce
  const W = 120;
  const H = 150;
  const k = (H - 20) / Math.max(s.L0, lay.seat, 1);
  const coil = (L: number, dash?: boolean) => {
    const n = Math.max(1, Math.round(s.n + 2));
    const w = Math.min(W - 30, Math.max(14, s.De * k));
    const pts: string[] = [];
    for (let i = 0; i <= n * 2; i++) pts.push(`${W / 2 + (i % 2 ? w / 2 : -w / 2)},${H - 10 - (L * k * i) / (n * 2)}`);
    return <polyline points={pts.join(" ")} fill="none" stroke={dash ? "#9aa7b5" : "#E03930"} strokeWidth={dash ? 1 : Math.max(1, s.d * k)} strokeDasharray={dash ? "3 2" : undefined} />;
  };
  return (
    <FloatPanel title={tr("Pružina mezi díly")} icon="sweep" tone="pattern" width={380} initial={{ x: 380, y: 56 }} onClose={onCancel}>
      <div data-spring-between className="max-h-[72vh] space-y-2.5 overflow-y-auto p-3 text-[12px]">
        <p className="text-[11.5px] text-[#4a5664]">
          {tr("A: „{0}“ {1} → B: „{2}“ {3} · vzdálenost dosedacích ploch {4} mm{5}", nm(a.compId), a.kind === "cylinder" ? tr("díra Ø{0}", fmt(2 * (a.radius ?? 0))) : tr("rovina"), nm(b.compId), b.kind === "cylinder" ? tr("díra Ø{0}", fmt(2 * (b.radius ?? 0))) : tr("rovina"), fmt(lay.seat, 3), "")}
        </p>
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {numIn("d", tr("drát"), "d", tr("průměr drátu [mm]"))}
            {numIn("De", tr("vnější průměr"), "De", tr("vnější průměr pružiny [mm] – v díře s vůlí"))}
            {numIn("L0", tr("volná délka"), "L0", tr("délka nezatížené pružiny [mm]"))}
            {numIn("n", tr("činné závity"), "n", tr("počet činných závitů (+ 2 přiložené)"))}
            <label className={row}>
              <span className="text-[#5b6776]">{tr("materiál")}</span>
              <select aria-label={tr("materiál")} value={s.material ?? "SH"} onChange={(e) => setS({ ...s, material: e.target.value })} className="w-28 rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]">
                {SPRING_WIRE_MATERIALS().map((m) => (
                  <option key={m.id} value={m.id} title={m.label}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
            <label className={row} title={tr("prázdné = spočtená tuhost")}>
              <span>
                <b className="font-semibold">R</b> <span className="text-[#5b6776]">{tr("tuhost (ručně)")}</span>
              </span>
              <DecimalInput data-spring-row="rate" aria-label={tr("tuhost (ručně)")} className={input} placeholder={fmt(calc.R, 3)} value={rate} empty valid={(v) => v > 0} onValue={setRate} />
            </label>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0 rounded border border-[#e3e8ee] bg-white" aria-label={tr("Náhled pružiny")}>
            <line x1="6" x2={W - 6} y1={H - 10} y2={H - 10} stroke="#272425" strokeWidth="2" />
            <line x1="6" x2={W - 6} y1={H - 10 - lay.seat * k} y2={H - 10 - lay.seat * k} stroke="#272425" strokeWidth="2" />
            {coil(s.L0, true)}
            {coil(Math.min(lay.seat, s.L0))}
            <text x={W - 4} y={H - 10 - lay.seat * k - 3} textAnchor="end" fontSize="9" fill="#272425">
              L {fmt(lay.seat, 1)}
            </text>
            <text x={4} y={H - 10 - s.L0 * k - 3} fontSize="9" fill="#6b7785">
              L0 {fmt(s.L0, 1)}
            </text>
          </svg>
        </div>
        <table data-spring-calc className="w-full text-[11.5px]">
          <tbody>
            {(
              [
                ["D", tr("střední průměr"), `${fmt(calc.D, 3)} mm`],
                ["R", tr("tuhost (EN 13906-1)"), `${fmt(R, 3)} N/mm`],
                ["nt", tr("celkem závitů"), fmt(calc.nt, 2)],
                ["Ln", tr("délka na doraz"), `${fmt(calc.Ln, 3)} mm`],
                ["Ln+Sa", tr("nejmenší pracovní délka (mezery Sa {0} mm)", fmt(calc.Sa, 2)), `${fmt(calc.Lmin, 2)} mm`],
                ["F", tr("síla při montáži (L = {0} mm)", fmt(lay.seat, 2)), `${fmt(F, 1)} N`],
                // napětí jako tabulka pružiny (`@/cad/springs`): τ = statická kontrola, τk = k · τ pro opakované zatížení
                ["τ", tr("napětí při montáži – statická kontrola (τzul {0} MPa)", fmt(calc.tauzul, 0)), calc.tauSeat !== undefined ? `${fmt(calc.tauSeat, 0)} MPa · ${fmt((100 * calc.tauSeat) / calc.tauzul, 0)} %` : "–"],
                ["τk", tr("napětí s korekcí k při montáži (opakované zatížení)"), calc.taukSeat !== undefined ? `${fmt(calc.taukSeat, 0)} MPa · ${fmt((100 * calc.taukSeat) / calc.tauzul, 0)} %` : "–"],
                ["τn", tr("napětí na dorazu Ln – statická kontrola"), `${fmt(calc.tauLn, 0)} MPa · ${fmt((100 * calc.tauLn) / calc.tauzul, 0)} %`],
                ["τkn", tr("napětí na dorazu Ln s korekcí k"), `${fmt(calc.taukLn, 0)} MPa · ${fmt((100 * calc.taukLn) / calc.tauzul, 0)} %`],
                ["sK", tr("vzpěr – kritický zdvih"), guided ? tr("vedená v díře") : Number.isFinite(calc.sK) ? `${fmt(calc.sK, 1)} mm` : tr("nevybočí")],
                ["Sh", tr("rezerva do dorazu"), `${fmt(lay.seat - calc.Ln, 2)} mm`],
              ] as const
            ).map(([sym, label, v]) => (
              <tr key={sym} className="border-t border-[#eef2f6]">
                <td className="py-0.5 pr-2 font-semibold">{sym}</td>
                <td className="py-0.5 text-[#5b6776]">{label}</td>
                <td className="py-0.5 text-right font-mono" data-spring-calc-row={sym}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {calc.issues.map((t) => (
          <p key={t} data-spring-issue className="rounded bg-brand/10 px-2 py-1 text-[11px] text-brand-600">
            {calc.bad ? "✗" : "⚠"} {t}
          </p>
        ))}
        {existing.length > 0 && (
          <label className="flex items-center gap-2 text-[11.5px]">
            <span className="shrink-0 text-[#5b6776]">{tr("Rozměry jako")}</span>
            <select aria-label={tr("Rozměry jako")} defaultValue="" onChange={(e) => e.target.value && fromExisting(e.target.value)} className="min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[11.5px]">
              <option value="">{tr("nová pružina z tabulky")}</option>
              {existing.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-1">
          {(
            [
              [tr("Měkká"), 12],
              [tr("Střední"), 10],
              [tr("Tuhá"), 8],
            ] as const
          ).map(([label, q]) => (
            <button key={q} type="button" onClick={() => setS({ ...s, d: Math.max(0.5, Math.round((s.De / q) * 10) / 10) })} className={cn("flex-1 rounded border px-1 py-0.5 text-[11px]", Math.abs(s.d - Math.round((s.De / q) * 10) / 10) < 1e-9 ? "border-[#272425] bg-[#272425] text-white" : "border-[#cfd6de] bg-white")}>
              {label} d {fmt(Math.max(0.5, Math.round((s.De / q) * 10) / 10))}
            </button>
          ))}
        </div>
        {(a.kind === "cylinder" || b.kind === "cylinder") && (
          <label className="flex items-center gap-2">
            <input type="checkbox" data-spring-holes className="accent-[#E03930]" checked={holes} onChange={(e) => setHoles(e.target.checked)} />
            {tr("Do všech děr vzoru (stejný Ø a osa)")}
          </label>
        )}
        <p className="break-words rounded bg-[#f3f6f9] px-2 py-1 font-mono text-[10.5px] text-[#4a5664]" data-spring-text>
          {text}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-spring-create
            disabled={busy || calc.bad || !(s.d > 0 && s.De > s.d && s.L0 > 0 && s.n > 0)}
            onClick={async () => {
              setBusy(true);
              await onCreate(text);
              setBusy(false);
            }}
            className="flex-1 rounded bg-brand py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? tr("Vytvářím…") : tr("Vytvořit")}
          </button>
          <button type="button" onClick={onCancel} className="rounded border border-[#cfd6de] px-3 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
            {tr("Zrušit")}
          </button>
        </div>
      </div>
    </FloatPanel>
  );
}

/** Výběr dosedací plochy ze seznamu (stejně platí klik do modelu): komponenta → rovinné plochy a díry (válcové plochy). */
function FacePicker({ doc, step, exclude, chosen, faceRows, onPick, onCancel }: { doc: CadDoc; step: "a" | "b"; exclude?: string; chosen?: Picked; faceRows: (compId: string) => Promise<CompFaceRow[]>; onPick: (p: Picked) => void; onCancel: () => void }) {
  const comps = (doc.components ?? []).filter((c) => c.id !== exclude && !(c.source.kind === "part" && isSpringPart(c.source.doc)));
  const [comp, setComp] = useState(comps[0]?.id ?? "");
  const [rows, setRows] = useState<CompFaceRow[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    if (comp) void faceRows(comp).then((r) => live && setRows(r), () => live && setRows([]));
    return () => {
      live = false;
    };
    // seznam ploch jen při změně komponenty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);
  // díry nahoře (pružina v kapse), pak rovinné plochy od největší
  const list = (rows ?? []).filter((r) => r.kind === "cylinder" || r.kind === "plane").sort((x, y) => (x.kind === y.kind ? (x.kind === "plane" ? (y.area ?? 0) - (x.area ?? 0) : (y.radius ?? 0) - (x.radius ?? 0)) : x.kind === "cylinder" ? -1 : 1));
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  return (
    <FloatPanel title={tr("Pružina mezi díly")} icon="sweep" tone="pattern" width={330} initial={{ x: 380, y: 56 }} onClose={onCancel}>
      <div data-spring-pick={step} className="space-y-2 p-3 text-[12px]">
        <p className="text-[11.5px] text-[#4a5664]">{step === "a" ? tr("1/2 Dosedací plocha A – díra / kapsa, ve které pružina sedí, nebo rovinná plocha. Klikněte do modelu nebo vyberte ze seznamu.") : tr("2/2 Protější plocha B jiného dílu (pružinu stlačuje).")}</p>
        {chosen && (
          <p className="rounded bg-[#eef2f6] px-2 py-1 text-[11px]" data-spring-chosen>
            A: „{nm(chosen.compId)}“ {chosen.kind === "cylinder" ? tr("díra Ø{0}", fmt(2 * (chosen.radius ?? 0))) : tr("rovina")} · F{chosen.face + 1}
          </p>
        )}
        <select data-spring-comp aria-label={tr("Komponenta")} value={comp} onChange={(e) => setComp(e.target.value)} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
          {comps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <ul data-spring-faces className="max-h-[220px] divide-y divide-[#edf1f5] overflow-y-auto rounded border border-[#d5dbe2] bg-white">
          {rows === null && <li className="px-2 py-1 text-[11px] text-[#6b7785]">{tr("Načítám plochy…")}</li>}
          {list.map((r) => (
            <li key={`${r.leafId}:${r.face}`}>
              <button
                type="button"
                data-spring-face={faceShort(r)}
                onClick={() => onPick({ compId: comp, leafId: r.leafId, face: r.face, kind: r.kind, origin: r.origin, normal: r.normal, ...(r.radius ? { radius: r.radius } : {}), ...(r.kind === "cylinder" ? { extent: [-(r.length ?? 0) / 2, (r.length ?? 0) / 2] as [number, number] } : {}), ...(r.part ? { part: r.part.split(" › ").pop() } : {}) })}
                className="w-full px-2 py-1 text-left text-[11.5px] hover:bg-[#f3f6f9]"
              >
                {faceShort(r)}
                {r.kind === "plane" && r.area ? <span className="text-[#6b7785]"> · {fmt(r.area, 0)} mm²</span> : r.kind === "cylinder" ? <span className="text-[#6b7785]"> · {tr("délka {0} mm", fmt(r.length ?? 0))}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </FloatPanel>
  );
}
