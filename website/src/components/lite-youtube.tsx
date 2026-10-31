"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Video z YouTube načtené až po kliknutí (youtube-nocookie) — rychlé načítání stránky a žádné cookies předem.
 */
export function LiteYouTube({ id, title, play, note, className, sizes = "100vw", priority }: { id: string; title: string; play: string; note?: string; className?: string; sizes?: string; priority?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <div className={cn("group relative overflow-hidden bg-ink", className)}>
      {on ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button type="button" onClick={() => setOn(true)} className="absolute inset-0 h-full w-full text-left" aria-label={`${title} – ${play}`} data-cursor={play}>
          <Image src={`/img/video/${id}.jpg`} alt="" fill sizes={sizes} priority={priority} className="object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-[1.04]" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <span className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand text-white shadow-[0_20px_50px_-10px_rgba(224,57,48,.9)] transition-transform duration-500 group-hover:scale-110 md:h-24 md:w-24">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/40 [animation-duration:2.2s]" />
            <svg viewBox="0 0 24 24" className="relative ml-1 h-8 w-8" fill="currentColor" aria-hidden>
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          </span>
          <span className="absolute inset-x-5 bottom-5 text-white">
            <span className="block font-display text-xl font-bold uppercase leading-tight md:text-2xl">{title}</span>
            {note && <span className="mt-1 block font-mono text-[10px] uppercase tracking-widest text-white/60">{note}</span>}
          </span>
        </button>
      )}
    </div>
  );
}
