"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";

const fmt = (n: number) => Math.round(n).toLocaleString("cs-CZ");

function Slider({ label, value, set, min, max, step, unit }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[14px] text-ink-700/70">{label}</span>
        <span className="whitespace-nowrap pl-3 font-mono text-[15px] font-medium text-ink-700">
          {fmt(value)} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-ink-700/10 accent-[#E03930]"
        style={{ background: `linear-gradient(90deg,#E03930 ${((value - min) / (max - min)) * 100}%,rgba(39,36,37,.1) 0)` }}
      />
    </label>
  );
}

/** Kalkulačka ceny prostoje — ukazuje, proč se vyplatí rychlý a spolehlivý dodavatel dílů. */
export function DowntimeCalc() {
  const [perHour, setPerHour] = useState(25_000);
  const [hours, setHours] = useState(16);
  const [events, setEvents] = useState(4);
  const total = perHour * hours * events;

  return (
    <div className="grid overflow-hidden rounded-3xl border border-ink-700/10 bg-white shadow-[0_40px_80px_-50px_rgba(39,36,37,.4)] lg:grid-cols-2">
      <div className="space-y-8 p-8 md:p-10">
        <p className="eyebrow">Kalkulačka prostoje</p>
        <Slider label="Náklady prostoje linky za hodinu" value={perHour} set={setPerHour} min={2_000} max={200_000} step={1_000} unit="Kč" />
        <Slider label="Hodin čekání na náhradní díl" value={hours} set={setHours} min={1} max={168} step={1} unit="h" />
        <Slider label="Počet takových situací ročně" value={events} set={setEvents} min={1} max={24} step={1} unit="×" />
      </div>
      <div className="relative flex flex-col justify-between overflow-hidden bg-steel-100 p-8 md:p-10">
        <div className="bg-grid-light absolute inset-0 opacity-70" />
        <div className="relative">
          <p className="text-[14px] text-ink-700/60">Roční ztráta kvůli čekání na díly</p>
          <p className="mt-2 whitespace-nowrap font-display text-4xl font-bold tracking-tight text-ink-700 md:text-5xl">
            <span className="text-brand">{fmt(total)}</span> Kč
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-700/65">
            Kritické díly vám můžeme držet v <strong className="text-ink-700">konsignačním skladu</strong> a stálým partnerům vyrábíme
            urgentně. Každá ušetřená hodina je čistý zisk.
          </p>
        </div>
        <div className="relative mt-8 flex flex-wrap items-center gap-3">
          <Link href="/poptavka?sluzba=nahradni-dily-pro-vyrobni-linky" className="btn-primary">
            Zajistit náhradní díly <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-700/45">
            {fmt(perHour * hours)} Kč / výpadek
          </span>
        </div>
      </div>
    </div>
  );
}
