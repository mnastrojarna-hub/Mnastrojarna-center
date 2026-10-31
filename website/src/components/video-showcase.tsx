"use client";

import Image from "next/image";
import { useState } from "react";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/cn";
import type { Video } from "@/content/site";
import { LiteYouTube } from "./lite-youtube";

/** „Dílna naživo“ — velké video + výběr dalších strojů. */
export function VideoShowcase({ videos, locale, play, note }: { videos: Video[]; locale: Locale; play: string; note: string }) {
  const [i, setI] = useState(0);
  const v = videos[i];
  return (
    <div className="grid gap-4">
      <LiteYouTube key={v.id} id={v.id} title={v.title[locale]} play={play} note={note} className="aspect-video rounded-3xl md:aspect-[21/9]" sizes="100vw" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {videos.map((x, k) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() => setI(k)}
              aria-pressed={k === i}
              className={cn("group relative block aspect-video w-full overflow-hidden rounded-2xl ring-2 transition", k === i ? "ring-brand" : "ring-transparent hover:ring-ink-700/20")}
            >
              <Image src={`/img/video/${x.id}.jpg`} alt="" fill sizes="(min-width:1024px) 20vw, 50vw" className="object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <span className="absolute inset-x-3 bottom-2 text-left text-[12px] font-medium leading-tight text-white">{x.title[locale]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
