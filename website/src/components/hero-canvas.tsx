"use client";

import dynamic from "next/dynamic";

/** Three.js se načte až v prohlížeči (mimo kritickou cestu vykreslení). */
const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

export function HeroCanvas({ className }: { className?: string }) {
  return <HeroScene className={className} />;
}
