import { LOGO_BANDS, LOGO_CHIPS, LOGO_SRO, LOGO_VIEWBOX, LOGO_WORDMARK } from "./logo-paths";
import { cn } from "@/lib/cn";

/**
 * Logo Mnástrojárna z originálního vektoru logomanuálu — „oživené“:
 * štít frézy se při načtení sestaví po pásech, třísky odletí, za symbolem pulzuje červená záře.
 */
export function Logo({
  tone = "dark",
  animate = false,
  glow = false,
  sro = true,
  className,
  title = "Mnástrojárna s.r.o.",
}: {
  tone?: "dark" | "light";
  animate?: boolean;
  glow?: boolean;
  sro?: boolean;
  className?: string;
  title?: string;
}) {
  const ink = tone === "light" ? "#FFFFFF" : "#272425";
  const vb = sro ? LOGO_VIEWBOX : "111.27 259.43 344 61.3";
  return (
    <svg viewBox={vb} className={cn("mn-logo overflow-visible", animate && "animate", className)} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <radialGradient id="mn-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF4A3D" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#E03930" stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow && (
        <ellipse className="glow animate-glow-pulse" cx="158" cy="290" rx="44" ry="40" fill="url(#mn-glow)" opacity="0.5" />
      )}
      <g fill="#E03930">
        {LOGO_BANDS.map((d, i) => (
          <path key={i} className="band" d={d} />
        ))}
      </g>
      <g fill="#E03930">
        {LOGO_CHIPS.map((d, i) => (
          <path key={i} className="chip" d={d} />
        ))}
      </g>
      <g fill={ink}>
        {LOGO_WORDMARK.map((d, i) => (
          <path key={i} d={d} />
        ))}
        {sro && LOGO_SRO.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

/** Jen symbol frézy (štít + třísky). */
export function LogoMark({ className, animate = false }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="110 258 66 64" className={cn("mn-logo overflow-visible", animate && "animate", className)} aria-hidden>
      <g fill="#E03930">
        {LOGO_BANDS.map((d, i) => (
          <path key={i} className="band" d={d} />
        ))}
      </g>
      <g fill="#E03930">
        {LOGO_CHIPS.map((d, i) => (
          <path key={i} className="chip" d={d} />
        ))}
      </g>
    </svg>
  );
}
