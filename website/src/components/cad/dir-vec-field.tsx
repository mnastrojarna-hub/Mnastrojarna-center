"use client";

/**
 * Sdílené zadání směru „čísly nebo odkazem“ pro panely mimo historii prvků (formařské nástroje, pole komponent v sestavě):
 * rychlé volby X / Y / Z a obrácení, vektor čísly a – je-li po ruce model dílu – odkaz na normálu plochy, hranu (osu válce)
 * nebo dva body; odkaz se zadává stejným polem jako směr vysunutí (`DirectionField`). Hodnotou je vždy jednotkový vektor –
 * odkaz se přes jádro vyřeší nad aktuálním modelem (a znovu po každé jeho změně).
 */
import { useContext, useEffect, useRef, useState } from "react";
import { cad } from "@/cad/client";
import { tr } from "@/cad/i18n";
import { fmtVec, isPlaceholder, type Direction } from "@/cad/refs";
import type { CadDoc, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { Vec } from "./props";
import { DirectionField, RefPickContext } from "./ref-field";
import { unitVec } from "./unit-vec";

const AX: Record<"X" | "Y" | "Z", Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
/** druhy odkazu, které dávají směr nezávisle na rovině skici */
export const REF_DIR_KINDS: Direction["kind"][] = ["faceNormal", "edge", "twoPoints"];

export { unitVec };
const neg = (v: Vec3): Vec3 => v.map((c) => -c || 0) as Vec3;
const same = (a: Vec3, b: Vec3) => a.every((c, i) => Math.abs(c - b[i]) < 1e-9);

/** je odkaz směru celý vyplněný (vybraná plocha / hrana / oba body)? */
function complete(d: Direction): boolean {
  if (d.kind === "twoPoints") return !isPlaceholder(d.a) && !isPlaceholder(d.b);
  if (d.kind === "edge" || d.kind === "faceNormal" || d.kind === "tangent") return !isPlaceholder(d.ref);
  return true;
}

/** Vyřeší směr na jednotkový vektor nad modelem `doc` (odkazy přes jádro – rovina „bodem a normálou“ s tímto směrem). */
export async function resolveDirVec(doc: CadDoc, d: Direction): Promise<Vec3> {
  if (d.kind === "axis") return AX[d.axis];
  if (d.kind === "vector") {
    const u = unitVec(d.v);
    if (!u) throw new Error(tr("Nulový směr – zadejte nenulový vektor."));
    return u;
  }
  const r = await cad.planeDef(doc, { kind: "pointNormal", p: { kind: "csys" }, dir: d });
  if (!r.plane) throw new Error(r.error ?? tr("Směr nelze určit."));
  return unitVec(r.plane.normal) ?? r.plane.normal;
}

/**
 * Směr vektorem nebo odkazem. `def` = uložený odkaz (normála plochy / hrana / dva body), `flip` = obrácený odkaz.
 * `attr` = název data-atributu rychlých voleb (X, Y, Z, flip) – pro automatizaci a testy.
 */
export function DirVecField({
  label,
  value,
  def,
  flip = false,
  onChange,
  refs = true,
  attr = "data-dir",
  children,
}: {
  label: string;
  value: Vec3;
  def?: Direction;
  flip?: boolean;
  onChange: (v: Vec3, def?: Direction, flip?: boolean) => void;
  /** nabídnout odkaz na geometrii dílu (jen kde jádro zná model – ne v sestavě) */
  refs?: boolean;
  attr?: string;
  /** doplňková tlačítka pod polem (např. „Směr z plochy v modelu…“ v sestavě) */
  children?: React.ReactNode;
}) {
  const ctx = useContext(RefPickContext);
  const byRef = !!def && REF_DIR_KINDS.includes(def.kind);
  const [err, setErr] = useState<string | null>(null);
  const key = byRef ? JSON.stringify(def) : "";
  const doc = ctx?.doc;
  // výsledek přijde asynchronně – použít aktuální hodnotu a zpětné volání (ne ty z doby spuštění)
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // odkaz → vektor; znovu po změně modelu (asociativně jako u prvků historie)
  useEffect(() => {
    if (!byRef || !def || !doc || !complete(def)) return setErr(null);
    let dead = false;
    resolveDirVec(doc, def).then(
      (v) => {
        if (dead) return;
        setErr(null);
        const out = flip ? neg(v) : v;
        if (!same(out, latest.current.value)) latest.current.onChange(out, def, flip);
      },
      (e) => !dead && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- řeší se jen při změně odkazu, obrácení nebo modelu
  }, [key, flip, doc]);
  const u = unitVec(value);
  const isAxis = (a: "X" | "Y" | "Z") => !!u && Math.abs(Math.abs(u[a === "X" ? 0 : a === "Y" ? 1 : 2]) - 1) < 1e-6;
  const btn = "rounded border py-1 text-[11.5px]";
  return (
    <div className="space-y-1.5" data-dir-field={byRef ? "ref" : "vector"}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {(["X", "Y", "Z"] as const).map((a) => (
          <button key={a} type="button" {...{ [attr]: a }} title={tr("Směr podél globální osy {0}", a)} onClick={() => onChange(u && isAxis(a) && !byRef ? (u.map((c) => Math.round(c)) as Vec3) : AX[a], undefined, false)} className={cn(btn, !byRef && isAxis(a) ? "border-brand bg-brand/10" : "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
            {a}
          </button>
        ))}
        <button type="button" {...{ [attr]: "flip" }} title={tr("Obrátit směr")} onClick={() => (byRef ? onChange(neg(value), def, !flip) : onChange(neg(value), undefined, false))} className={cn(btn, "border-[#cfd6de] hover:bg-[#f3f6f9]")}>
          ±
        </button>
      </div>
      {byRef ? (
        <>
          <DirectionField label={tr("Směr odkazem")} value={def} allowNormal={false} kinds={REF_DIR_KINDS} onChange={(d) => onChange(value, d && REF_DIR_KINDS.includes(d.kind) ? d : undefined, d ? flip : false)} />
          <p className={cn("text-[11px]", err ? "text-brand-600" : "text-ink-700/55")} data-dir-resolved>
            {err ? `⚠ ${err}` : complete(def!) ? tr("Směr: {0}{1}", fmtVec(value), flip ? tr(" (obráceně)") : "") : tr("Klikněte do pole odkazu a vyberte geometrii v modelu.")}
          </p>
          <button type="button" className="text-[11.5px] text-brand hover:underline" onClick={() => onChange(value, undefined, false)}>
            {tr("Zadat čísly (vektor)")}
          </button>
        </>
      ) : (
        <>
          <Vec label={tr("Vektor")} value={value} onChange={(v: Vec3) => onChange(v, undefined, false)} />
          {u === null && <p className="text-[11px] text-brand-600">{tr("Nulový směr – zadejte nenulový vektor.")}</p>}
          {refs && ctx && (
            <button type="button" data-dir-byref className="text-[11.5px] text-brand hover:underline" onClick={() => onChange(value, { kind: "faceNormal", ref: { kind: "face", index: -1 } }, false)}>
              {tr("Zadat odkazem (normála plochy, hrana, dva body)…")}
            </button>
          )}
        </>
      )}
      {children}
    </div>
  );
}
