"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";

type Item = { href: string; title: string; summary: string; year?: number; kind: string; photo: string; photos: number };

/** Archiv zakázek s filtrem podle typu. */
export function CasesGrid({ items, kinds, all, photosLabel, openLabel }: { items: Item[]; kinds: Record<string, string>; all: string; photosLabel: string; openLabel: string }) {
  const [f, setF] = useState<string | null>(null);
  const list = f ? items.filter((i) => i.kind === f) : items;
  return (
    <>
      <div className="mb-10 flex flex-wrap gap-2">
        {[null, ...Object.keys(kinds)].map((k) => (
          <button
            key={k ?? "all"}
            type="button"
            onClick={() => setF(k)}
            className={cn("rounded-full border px-4 py-2 text-[14px] font-medium transition", f === k ? "border-ink-700 bg-ink-700 text-white" : "border-ink-700/15 text-ink-700 hover:border-ink-700/40")}
          >
            {k ? kinds[k] : all} <span className="ml-1 font-mono text-[11px] opacity-60">{k ? items.filter((i) => i.kind === k).length : items.length}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c, i) => (
          <Link key={c.href} href={c.href} data-cursor={openLabel} className={cn("group block", i % 3 === 1 && "lg:mt-16")}>
            <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-steel-200">
              <Image src={c.photo} alt={c.title} fill sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-[1.2s] ease-out group-hover:scale-[1.06]" />
              <span className="absolute left-5 top-5 rounded-full bg-white/90 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-700 backdrop-blur">
                {kinds[c.kind]}
                {c.year ? ` · ${c.year}` : ""}
              </span>
              <span className="absolute bottom-5 right-5 rounded-full bg-black/40 px-3 py-1 font-mono text-[10px] text-white backdrop-blur">
                {c.photos} {photosLabel}
              </span>
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700 transition-colors group-hover:text-brand">{c.title}</h2>
            <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-ink-700/60">{c.summary}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
