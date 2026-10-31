"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

type Row = { href: string; title: string; short: string; photo: string };

/** Index služeb: velké řádky, nad kterými se objevuje skutečná fotka zakázky sledující kurzor. */
export function ServicesIndex({ rows, cursorLabel }: { rows: Row[]; cursorLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (preview.current) gsap.set(preview.current, { xPercent: -50, yPercent: -50 });
  }, []);

  const move = (e: React.PointerEvent) => {
    if (!preview.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    gsap.to(preview.current, { x: e.clientX - r.left, y: e.clientY - r.top, duration: 0.6, ease: "power3.out" });
  };

  return (
    <div ref={box} className="relative" onPointerMove={move} onPointerLeave={() => setActive(null)}>
      <ol className="border-t border-ink-700/15">
        {rows.map((r, i) => (
          <li key={r.href} onPointerEnter={() => setActive(i)}>
            <Link
              href={r.href}
              data-cursor={cursorLabel}
              className="group grid grid-cols-[3rem_1fr_auto] items-baseline gap-4 border-b border-ink-700/15 py-6 transition-colors duration-500 md:grid-cols-[4rem_1.2fr_1fr_auto] md:py-8"
            >
              <span className="font-mono text-[12px] text-ink-700/40 transition-colors group-hover:text-brand">{String(i + 1).padStart(2, "0")}</span>
              <span className="h-display text-3xl text-ink-700 transition-transform duration-500 group-hover:translate-x-3 md:text-5xl">{r.title}</span>
              <span className="hidden text-[15px] leading-relaxed text-ink-700/55 md:block">{r.short}</span>
              <span className="grid h-10 w-10 place-items-center rounded-full border border-ink-700/15 text-ink-700 transition-all duration-500 group-hover:rotate-[-45deg] group-hover:border-brand group-hover:bg-brand group-hover:text-white">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div
        ref={preview}
        className="pointer-events-none absolute left-0 top-0 z-10 hidden h-56 w-80 overflow-hidden rounded-2xl shadow-2xl transition-[opacity,transform] duration-300 md:block"
        style={{ opacity: active == null ? 0 : 1, scale: active == null ? "0.85" : "1" }}
        aria-hidden
      >
        {rows.map((r, i) => (
          <Image key={r.photo + i} src={r.photo} alt="" fill sizes="320px" className="object-cover transition-opacity duration-300" style={{ opacity: active === i ? 1 : 0 }} />
        ))}
      </div>
    </div>
  );
}
