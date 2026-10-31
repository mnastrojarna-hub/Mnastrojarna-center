"use client";

import { useEffect, useRef, useState } from "react";
import { Accent } from "./accent";
import type { Dict } from "@/content/cs";
import { cn } from "@/lib/cn";

const AT = [0, 0.12, 0.5, 0.7, 0.86];

export function MachiningStory({ t }: { t: Dict["story"] }) {
  const STAGES = t.stages.map((s, i) => ({ ...s, at: AT[i] }));
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  // scroll → progres
  useEffect(() => {
    const on = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      progressRef.current = p;
      setProgress(p);
      let s = 0;
      AT.forEach((at, i) => {
        if (p >= at) s = i;
      });
      setStage(s);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  // 3D scéna — three.js se načte až když je sekce blízko obrazovky
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cleanup: (() => void) | void;
    let cancelled = false;
    const io = new IntersectionObserver(
      ([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        import("./story-scene").then((m) => {
          if (!cancelled) cleanup = m.mountStory(el, progressRef);
        });
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      cleanup?.();
    };
  }, []);

  return (
    <section ref={wrap} className="relative" style={{ height: "460vh" }} aria-label={t.aria}>
      <div className="paper sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="bg-grid-light absolute inset-0" />
        <div ref={host} className="absolute inset-0 md:left-[34%]" aria-hidden />

        <div className="container relative z-10 grid h-full grid-rows-[auto_1fr_auto] py-24 md:py-28">
          <div className="max-w-md">
            <p className="eyebrow">{t.eyebrow}</p>
            <h2 className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">
              <Accent text={t.title} />
            </h2>
          </div>

          <ol className="mt-8 hidden max-w-sm self-center md:block">
            {STAGES.map((s, i) => (
              <li key={s.t} className={cn("relative border-l-2 py-3 pl-6 transition-all duration-500", i === stage ? "border-brand" : "border-ink-700/10")}>
                <span className={cn("font-mono text-[11px] tracking-widest", i <= stage ? "text-brand" : "text-ink-700/30")}>0{i + 1}</span>
                <h3 className={cn("font-display text-2xl font-bold uppercase transition-colors", i === stage ? "text-ink-700" : "text-ink-700/30")}>{s.t}</h3>
                <div className={cn("grid transition-all duration-500", i === stage ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <div className="overflow-hidden">
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-700/65">{s.d}</p>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-ink-700/45">{s.machine}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* mobil: aktuální krok */}
          <div className="self-end rounded-2xl border border-ink-700/10 bg-white/90 p-5 backdrop-blur md:hidden">
            <p className="font-mono text-[11px] tracking-widest text-brand">0{stage + 1} / 05</p>
            <h3 className="font-display text-2xl font-bold uppercase text-ink-700">{STAGES[stage].t}</h3>
            <p className="mt-1 text-[14px] text-ink-700/65">{STAGES[stage].d}</p>
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <div className="h-px flex-1 bg-ink-700/10">
              <div className="h-px bg-brand transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] text-ink-700/45">{Math.round(progress * 100)} %</span>
          </div>
        </div>

        {/* protokol */}
        <div
          className={cn(
            "absolute bottom-8 right-6 z-10 hidden w-80 rounded-2xl border border-ink-700/10 bg-white p-5 shadow-[0_30px_60px_-30px_rgba(39,36,37,.35)] transition-all duration-700 md:block",
            stage === 4 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-700/50">{t.protocol}</p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">OK</span>
          </div>
          <table className="mt-3 w-full font-mono text-[12px]">
            <tbody>
              {t.rows.map(([a, b]) => [a, b, "✓"]).map(([a, b, c]) => (
                <tr key={a} className="border-t border-ink-700/5">
                  <td className="py-1.5 text-ink-700/60">{a}</td>
                  <td className="py-1.5 text-right text-ink-700">{b}</td>
                  <td className="py-1.5 pl-2 text-right text-emerald-600">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
