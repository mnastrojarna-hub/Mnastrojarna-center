"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Dict } from "@/content/cs";
import { checkFit, type FitShape } from "@/lib/fit";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

type T = Dict["pages"]["machinery"];

function Field({ label, value, set, unit = "mm" }: { label: string; value: number; set: (v: number) => void; unit?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
      <span className="flex items-center rounded-xl border border-ink-700/15 bg-white focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
        <input
          type="number"
          min={0}
          inputMode="decimal"
          value={value || ""}
          onChange={(e) => set(Math.max(0, Number(e.target.value)))}
          className="w-full min-w-0 bg-transparent px-3 py-2.5 font-mono text-[15px] text-ink-700 outline-none"
        />
        <span className="pr-3 font-mono text-[12px] text-ink-700/40">{unit}</span>
      </span>
    </label>
  );
}

/** „Vejde se váš díl?“ — okamžitá orientační kontrola proti pracovním rozsahům strojů. */
export function FitChecker({ t, names, rfqHref }: { t: T; names: Record<string, string>; rfqHref: string }) {
  const [shape, setShape] = useState<FitShape>("rot");
  const [d, setD] = useState(180);
  const [len, setLen] = useState(420);
  const [x, setX] = useState(600);
  const [y, setY] = useState(400);
  const [z, setZ] = useState(150);
  const [kg, setKg] = useState(40);
  const res = useMemo(() => checkFit({ shape, d, len, x, y, z, kg }), [shape, d, len, x, y, z, kg]);
  const n = res.filter((r) => r.ok).length;
  const desc = shape === "rot" ? `Ø ${d} × ${len} mm, ${kg} kg` : `${x} × ${y} × ${z} mm${shape === "edm" ? "" : `, ${kg} kg`}`;

  return (
    <div className="grid overflow-hidden rounded-3xl border border-ink-700/10 bg-white shadow-[0_40px_80px_-50px_rgba(39,36,37,.4)] lg:grid-cols-5">
      <div className="space-y-6 p-8 md:p-10 lg:col-span-3">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{t.fitShape}</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(t.fitShapes) as FitShape[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={shape === k}
                onClick={() => setShape(k)}
                className={cn("rounded-full border px-4 py-2 text-[14px] font-medium transition", shape === k ? "border-brand bg-brand text-white" : "border-ink-700/15 text-ink-700 hover:border-ink-700/40")}
              >
                {t.fitShapes[k]}
              </button>
            ))}
          </div>
        </div>
        {shape === "rot" ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label={t.fitDiameter} value={d} set={setD} />
            <Field label={t.fitLength} value={len} set={setLen} />
            <Field label={t.fitWeight} value={kg} set={setKg} unit="kg" />
          </div>
        ) : (
          <div className={cn("grid gap-3", shape === "edm" ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
            <Field label={t.fitX} value={x} set={setX} />
            <Field label={t.fitY} value={y} set={setY} />
            <Field label={t.fitZ} value={z} set={setZ} />
            {shape !== "edm" && <Field label={t.fitWeight} value={kg} set={setKg} unit="kg" />}
          </div>
        )}
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-700/40">{t.fitNote}</p>
      </div>
      <div className="relative bg-steel-100 p-8 md:p-10 lg:col-span-2">
        <div className="bg-grid-light absolute inset-0 opacity-70" />
        <div className="relative">
          <p className="text-[15px] font-semibold text-ink-700">{n ? t.fitResultOk.replace("{n}", String(n)) : t.fitResultNone}</p>
          <ul className="mt-5 space-y-2">
            {res.map((r) => (
              <li key={r.id} className={cn("flex items-center justify-between rounded-xl border px-4 py-2.5 text-[14px] transition", r.ok ? "border-emerald-600/25 bg-white text-ink-700" : "border-transparent text-ink-700/35")}>
                <span className="font-medium">{names[r.id] ?? r.id}</span>
                <span className={cn("flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider", r.ok ? "text-emerald-700" : "")}>
                  <Icon name={r.ok ? "check" : "x"} className="h-3.5 w-3.5" strokeWidth={2.4} /> {r.ok ? t.fitYes : t.fitNo}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`${rfqHref}?popis=${encodeURIComponent(desc)}`} className="btn-primary mt-6">
            {t.fitCta} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
