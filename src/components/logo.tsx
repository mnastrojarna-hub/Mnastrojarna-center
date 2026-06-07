import { cn } from "@/lib/utils";

/**
 * Značka Mnástrojárna — stylizovaný symbol frézy (šrafovaný štít) v korporátní červené #E03930.
 * Vektorová rekreace dle logomanuálu pro použití v UI (sidebar, login, favicon).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <clipPath id="mn-shield">
          {/* Štít / vlajka frézy */}
          <path d="M7 6 h21 a3 3 0 0 1 3 3 v15.5 a3 3 0 0 1 -0.9 2.15 L21 38 l-9.1 -11.35 A3 3 0 0 1 11 24.5 V6 Z" transform="translate(-1 -2)" />
        </clipPath>
      </defs>
      <g clipPath="url(#mn-shield)">
        <rect x="0" y="0" width="40" height="40" fill="#E03930" />
        {/* Diagonální šrafování (zuby frézy) */}
        <g stroke="#fff" strokeWidth="3.1">
          <line x1="-6" y1="14" x2="20" y2="-12" />
          <line x1="-6" y1="22" x2="28" y2="-12" />
          <line x1="-6" y1="30" x2="36" y2="-12" />
          <line x1="-2" y1="36" x2="40" y2="-6" />
          <line x1="6" y1="40" x2="44" y2="2" />
        </g>
      </g>
      {/* Drobné odlétající třísky vlevo dole */}
      <g fill="#E03930">
        <path d="M4 30 l3 1.4 -2.6 1.9 Z" />
        <path d="M2.5 33.5 l2.6 0.6 -1.7 1.9 Z" />
      </g>
    </svg>
  );
}

export function Logo({
  className,
  showSlogan = false,
  subtitle,
}: {
  className?: string;
  showSlogan?: boolean;
  subtitle?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="h-8 w-8" />
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-foreground">
          Mnástrojárna
        </div>
        {subtitle ? (
          <div className="text-[11px] font-medium text-muted-foreground">{subtitle}</div>
        ) : showSlogan ? (
          <div className="text-[11px] italic text-muted-foreground">místo pro Vaši kooperaci…</div>
        ) : null}
      </div>
    </div>
  );
}
