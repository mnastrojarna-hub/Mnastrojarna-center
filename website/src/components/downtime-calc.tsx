"use client";

import { useState } from "react";
import type { Dict } from "@/content/cs";
import { Icon } from "./icons";

const LOC: Record<string, string> = { cs: "cs-CZ", en: "en-GB", de: "de-DE" };

function Slider({ label, value, set, min, max, step, unit, fmt }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string; fmt: (n: number) => string }) {
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

/** Kalkulačka ceny prostoje — ukazuje, proč se vyplatí rychlý a spolehlivý dodavatel dílů. Měna dle jazyka (Kč / €). */
export function DowntimeCalc({ t, ctaHref, locale }: { t: Dict["calc"]; ctaHref: string; locale: string }) {
  const r = t.rate;
  const step = Math.max(1, Math.round(1000 * r));
  const [perHour, setPerHour] = useState(Math.round(25_000 * r));
  const [hours, setHours] = useState(16);
  const [events, setEvents] = useState(4);
  const total = perHour * hours * events;
  const fmt = (n: number) => Math.round(n).toLocaleString(LOC[locale] ?? "cs-CZ");

  return (
    <div className="grid overflow-hidden rounded-3xl border border-ink-700/10 bg-white shadow-[0_40px_80px_-50px_rgba(39,36,37,.4)] lg:grid-cols-2">
      <div className="space-y-8 p-8 md:p-10">
        <p className="eyebrow">{t.eyebrow}</p>
        <Slider label={t.perHour} value={perHour} set={setPerHour} min={Math.round(2_000 * r)} max={Math.round(200_000 * r)} step={step} unit={t.currency} fmt={fmt} />
        <Slider label={t.hours} value={hours} set={setHours} min={1} max={168} step={1} unit={t.hoursUnit} fmt={fmt} />
        <Slider label={t.events} value={events} set={setEvents} min={1} max={24} step={1} unit="×" fmt={fmt} />
      </div>
      <div className="relative flex flex-col justify-between overflow-hidden bg-steel-100 p-8 md:p-10">
        <div className="bg-grid-light absolute inset-0 opacity-70" />
        <div className="relative">
          <p className="text-[14px] text-ink-700/60">{t.result}</p>
          <p className="mt-2 whitespace-nowrap font-display text-4xl font-bold tracking-tight text-ink-700 md:text-5xl">
            <span className="text-brand">{fmt(total)}</span> {t.currency}
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-700/65">
            {t.text1} <strong className="text-ink-700">{t.textStrong}</strong> {t.text2}
          </p>
        </div>
        <div className="relative mt-8 flex flex-wrap items-center gap-3">
          <a href={ctaHref} className="btn-primary">
            {t.cta} <Icon name="arrow" className="h-4 w-4" />
          </a>
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-700/45">
            {fmt(perHour * hours)} {t.currency} {t.perEvent}
          </span>
        </div>
      </div>
    </div>
  );
}
