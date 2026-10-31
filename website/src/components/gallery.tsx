"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

/** Galerie skutečných zakázek s náhledem přes celou obrazovku (šipky, Esc). */
export function Gallery({ items, alt, limit }: { items: { src: string; w: number; h: number }[]; alt: string; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items;
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open == null) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i == null ? i : (i + 1) % list.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i == null ? i : (i - 1 + list.length) % list.length));
    };
    window.addEventListener("keydown", on);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", on);
      document.body.style.overflow = "";
    };
  }, [open, list.length]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {list.map((g, i) => (
          <button
            key={g.src}
            type="button"
            onClick={() => setOpen(i)}
            data-reveal
            style={{ ["--d" as string]: `${(i % 4) * 70}ms` }}
            className={cn("group relative overflow-hidden rounded-2xl border border-ink-700/10 bg-steel-100", i % 5 === 0 ? "aspect-[4/5] md:row-span-2 md:aspect-auto" : "aspect-[4/3]")}
            aria-label={`${alt} ${i + 1}`}
          >
            <Image src={g.src} alt={`${alt} ${i + 1}`} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.06]" />
            <span className="absolute inset-0 bg-gradient-to-t from-ink/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <span className="absolute bottom-3 left-3 font-mono text-[10px] uppercase tracking-widest text-white opacity-0 transition-opacity duration-500 group-hover:opacity-100">
              {String(i + 1).padStart(2, "0")}
            </span>
          </button>
        ))}
      </div>
      {open != null && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-white/95 p-4 backdrop-blur" role="dialog" aria-modal onClick={() => setOpen(null)}>
          <div className="relative h-[80vh] w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <Image src={list[open].src} alt={`${alt} ${open + 1}`} fill sizes="100vw" className="object-contain" />
          </div>
          <button type="button" className="absolute right-5 top-5 rounded-full border border-ink-700/15 bg-white p-3" onClick={() => setOpen(null)} aria-label="×">
            <Icon name="x" />
          </button>
          <button type="button" className="absolute left-4 top-1/2 -translate-y-1/2 rotate-180 rounded-full border border-ink-700/15 bg-white p-3" onClick={(e) => { e.stopPropagation(); setOpen((open - 1 + list.length) % list.length); }} aria-label="←">
            <Icon name="arrow" />
          </button>
          <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-ink-700/15 bg-white p-3" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % list.length); }} aria-label="→">
            <Icon name="arrow" />
          </button>
          <p className="absolute bottom-5 font-mono text-[12px] text-ink-700/50">
            {open + 1} / {list.length}
          </p>
        </div>
      )}
    </>
  );
}
