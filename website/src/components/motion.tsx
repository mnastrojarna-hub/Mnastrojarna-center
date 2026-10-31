"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * Pohybový systém webu (GSAP + Lenis). Deklarativně přes data-atributy:
 *  data-split        nadpis se odhalí po řádcích (maskované řádky)
 *  data-img          obrázek se odkryje clip-path maskou a „dosedne“ ze zvětšení
 *  data-speed="0.2"  paralaxa (posun v % výšky při scrollu)
 *  data-scrub-text   slova se postupně rozsvěcují podle scrollu
 *  data-hscroll      připnutá sekce, jejíž [data-hscroll-track] jede vodorovně
 *  data-draw         SVG čáry se kreslí podle scrollu
 *  data-magnetic     prvek se „přitahuje“ ke kurzoru
 *  data-cursor="…"   vlastní kurzor ukáže popisek
 */
export function Motion() {
  const pathname = usePathname();
  const lenisRef = useRef<Lenis | null>(null);

  // plynulý scroll
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });
    lenisRef.current = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    // kotvy (#id) přes Lenis
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.(
        "a[href^='#']",
      ) as HTMLAnchorElement | null;
      if (!a) return;
      const el = document.querySelector(a.getAttribute("href")!);
      if (el) {
        e.preventDefault();
        lenis.scrollTo(el as HTMLElement, { offset: -80 });
      }
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  // efekty pro aktuální stránku
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    lenisRef.current?.scrollTo(0, { immediate: true });
    // efekty se inicializují až po prvním vykreslení (LCP/TBT na mobilu)
    let ctx: ReturnType<typeof gsap.context> | null = null;
    type IdleWin = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const w = window as unknown as IdleWin;
    const idle = (cb: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 1200 }) : window.setTimeout(cb, 120));
    const cancelIdle = (id: number) => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
    const idleId = idle(() => {
      ctx = gsap.context(() => {
        // nadpisy po řádcích
        document.querySelectorAll<HTMLElement>("[data-split]").forEach((el) => {
          const split = SplitText.create(el, {
            type: "lines",
            mask: "lines",
            linesClass: "split-line",
          });
          gsap.from(split.lines, {
            yPercent: 110,
            duration: 1.1,
            ease: "expo.out",
            stagger: 0.08,
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });
        // obrázky — clip reveal
        document.querySelectorAll<HTMLElement>("[data-img]").forEach((el) => {
          const img = el.querySelector("img");
          const tl = gsap.timeline({
            scrollTrigger: { trigger: el, start: "top 90%", once: true },
          });
          tl.fromTo(
            el,
            { clipPath: "inset(100% 0% 0% 0%)" },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              duration: 1.3,
              ease: "expo.inOut",
            },
          );
          if (img)
            tl.fromTo(
              img,
              { scale: 1.35 },
              { scale: 1, duration: 1.6, ease: "expo.out" },
              0.1,
            );
        });
        // paralaxa
        document.querySelectorAll<HTMLElement>("[data-speed]").forEach((el) => {
          const s = Number(el.dataset.speed) || 0.15;
          gsap.fromTo(
            el,
            { yPercent: -s * 50 },
            {
              yPercent: s * 50,
              ease: "none",
              scrollTrigger: {
                trigger: el,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            },
          );
        });
        // rozsvěcování slov
        document
          .querySelectorAll<HTMLElement>("[data-scrub-text]")
          .forEach((el) => {
            const split = SplitText.create(el, { type: "words", aria: "none" });
            gsap.fromTo(
              split.words,
              { opacity: 0.12 },
              {
                opacity: 1,
                stagger: 0.1,
                ease: "none",
                scrollTrigger: {
                  trigger: el,
                  start: "top 80%",
                  end: "bottom 45%",
                  scrub: true,
                },
              },
            );
          });
        // vodorovný scroll
        const mm = gsap.matchMedia();
        mm.add("(min-width: 768px)", () => {
          document
            .querySelectorAll<HTMLElement>("[data-hscroll]")
            .forEach((sec) => {
              const track = sec.querySelector<HTMLElement>(
                "[data-hscroll-track]",
              );
              if (!track) return;
              const dist = () =>
                Math.max(0, track.scrollWidth - window.innerWidth + 48);
              gsap.to(track, {
                x: () => -dist(),
                ease: "none",
                scrollTrigger: {
                  trigger: sec,
                  start: "top top",
                  end: () => `+=${dist()}`,
                  pin: true,
                  scrub: 0.6,
                  invalidateOnRefresh: true,
                  anticipatePin: 1,
                },
              });
              const bar = sec.querySelector<HTMLElement>("[data-hscroll-bar]");
              if (bar)
                gsap.fromTo(
                  bar,
                  { scaleX: 0 },
                  {
                    scaleX: 1,
                    ease: "none",
                    scrollTrigger: {
                      trigger: sec,
                      start: "top top",
                      end: () => `+=${dist()}`,
                      scrub: true,
                    },
                  },
                );
            });
        });
        // kreslení SVG
        document.querySelectorAll<SVGElement>("[data-draw]").forEach((svg) => {
          svg
            .querySelectorAll<SVGGeometryElement>(
              "path, line, polyline, circle, rect",
            )
            .forEach((p) => {
              const len = p.getTotalLength?.() ?? 0;
              if (!len) return;
              gsap.fromTo(
                p,
                { strokeDasharray: len, strokeDashoffset: len },
                {
                  strokeDashoffset: 0,
                  ease: "none",
                  scrollTrigger: {
                    trigger: svg,
                    start: "top 85%",
                    end: "top 35%",
                    scrub: true,
                  },
                },
              );
            });
        });
      });
      // po načtení obrázků/fontů přepočítat
      setTimeout(() => ScrollTrigger.refresh(), 400);
    });
    return () => {
      cancelIdle(idleId);
      ctx?.revert();
    };
  }, [pathname]);

  // magnetická tlačítka
  useEffect(() => {
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const onMove = (e: PointerEvent) => {
      document
        .querySelectorAll<HTMLElement>("[data-magnetic]")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const near = Math.hypot(dx, dy) < Math.max(r.width, r.height) * 0.9;
          gsap.to(el, {
            x: near ? dx * 0.28 : 0,
            y: near ? dy * 0.35 : 0,
            duration: 0.6,
            ease: "power3.out",
          });
        });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return <Cursor />;
}

/** Vlastní kurzor: bod + kroužek, nad [data-cursor] zobrazí popisek. Jen pro myš. */
function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    setOn(true);
    document.documentElement.classList.add("has-cursor");
    const xd = gsap.quickTo(dot.current, "x", { duration: 0.08 });
    const yd = gsap.quickTo(dot.current, "y", { duration: 0.08 });
    const xr = gsap.quickTo(ring.current, "x", {
      duration: 0.45,
      ease: "power3",
    });
    const yr = gsap.quickTo(ring.current, "y", {
      duration: 0.45,
      ease: "power3",
    });
    const move = (e: PointerEvent) => {
      xd(e.clientX);
      yd(e.clientY);
      xr(e.clientX);
      yr(e.clientY);
      const t = (e.target as HTMLElement)?.closest?.(
        "[data-cursor], a, button",
      ) as HTMLElement | null;
      const l = t?.dataset.cursor ?? null;
      setLabel(l);
      ring.current?.classList.toggle("is-link", !!t && !l);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.classList.remove("has-cursor");
    };
  }, []);

  if (!on) return null;
  return (
    <>
      <div ref={dot} className="cursor-dot" aria-hidden />
      <div
        ref={ring}
        className={label ? "cursor-ring has-label" : "cursor-ring"}
        aria-hidden
      >
        {label && <span>{label}</span>}
      </div>
    </>
  );
}
