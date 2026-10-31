/** Ikony nástrojů CAD (vlastní, technický styl). */
const P: Record<string, React.ReactNode> = {
  sketch: (<><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="2 2" /><path d="M7 16l4-8 3 5 2-3 2 6" /></>),
  extrude: (<><path d="M4 17l8 4 8-4M4 17V9l8-4 8 4v8" /><path d="M12 13v8M4 9l8 4 8-4" /><path d="M12 2v3" strokeDasharray="1.5 1.5" /></>),
  revolve: (<><path d="M12 3v18" strokeDasharray="2 2" /><path d="M8 6h3v12H8M16 6h-3" /><path d="M18.5 9a7 3 0 0 1 0 6M5.5 15a7 3 0 0 1 0-6" /></>),
  box: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  cylinder: (<><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" /></>),
  tube: (<><ellipse cx="12" cy="6" rx="7" ry="2.6" /><ellipse cx="12" cy="6" rx="3.5" ry="1.2" /><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" /></>),
  cone: (<><path d="M12 3L5 18M12 3l7 15" /><ellipse cx="12" cy="18" rx="7" ry="2.6" /></>),
  sphere: (<><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="8" ry="3" /></>),
  hole: (<><path d="M3 9l9-4 9 4-9 4z" /><ellipse cx="12" cy="9" rx="3" ry="1.3" /><path d="M9 9v8M15 9v8M9 17c0 .8 1.3 1.4 3 1.4s3-.6 3-1.4" strokeDasharray="1.5 1.5" /></>),
  fillet: (<><path d="M4 20V10a6 6 0 0 1 6-6h10" /><path d="M4 4h6" strokeDasharray="1.5 2" /><path d="M4 4v6" strokeDasharray="1.5 2" /></>),
  chamfer: (<><path d="M4 20V9l5-5h11" /><path d="M4 4h5M4 4v5" strokeDasharray="1.5 2" /></>),
  shell: (<><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M7 8.5l5-2.5 5 2.5v7l-5 2.5-5-2.5z" /></>),
  pattern: (<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" strokeDasharray="2 1.5" /><rect x="3" y="15" width="6" height="6" rx="1" strokeDasharray="2 1.5" /><rect x="15" y="15" width="6" height="6" rx="1" strokeDasharray="2 1.5" /></>),
  mirror: (<><path d="M12 2v20" strokeDasharray="2 2" /><path d="M9 6L4 18h5zM15 6l5 12h-5z" /></>),
  import: (<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  select: (<><path d="M5 3l14 8-6 2-3 6z" /></>),
  line: (<><circle cx="5" cy="19" r="1.8" /><circle cx="19" cy="5" r="1.8" /><path d="M6.3 17.7L17.7 6.3" /></>),
  rect: (<><rect x="4" y="6" width="16" height="12" rx="1" /></>),
  circle: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1" /></>),
  arc: (<><path d="M4 18a10 10 0 0 1 16 0" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="18" r="1.5" /></>),
  polygon: (<><path d="M12 3l8 5v8l-8 5-8-5V8z" /></>),
  slot: (<><rect x="3" y="8" width="18" height="8" rx="4" /></>),
  grid: (<><path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" /></>),
  drawing: (<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M14 15h6M14 15v5M6 8h5v5H6z" /></>),
  iso: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>),
  front: (<><rect x="5" y="5" width="14" height="14" rx="1" /><path d="M5 19l14-14" opacity=".3" /></>),
  top: (<><rect x="5" y="5" width="14" height="14" rx="1" /><circle cx="12" cy="12" r="3" /></>),
  right: (<><path d="M7 5l10 3v8l-10 3z" /></>),
  plane: (<><path d="M3 15l6-8h12l-6 8z" /></>),
  face: (<><path d="M3 15l6-8h12l-6 8z" /><path d="M12 11v9M9 17l3 3 3-3" /></>),
  new: (<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 12v6M9 15h6" /></>),
  open: (<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>),
  save: (<><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></>),
  cube: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>),
  redo: (<><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>),
  check: (<><path d="M5 12.5l4.5 4.5L19 7" /></>),
  x: (<><path d="M6 6l12 12M18 6L6 18" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  trash: (<><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>),
  tree: (<><path d="M4 5h6M8 12h8M8 19h8M6 5v14M6 12h2M6 19h2" /></>),
  sweep: (<><path d="M4 19c3-9 9-3 12-12" strokeDasharray="2 1.6" /><circle cx="17" cy="6" r="3.5" /><circle cx="4.5" cy="18.5" r="2" /></>),
  loft: (<><rect x="3" y="15" width="9" height="5" rx="1" /><circle cx="16" cy="6.5" r="3.5" /><path d="M3 15l9.5-8M12 15l7.5-8" /></>),
  draft: (<><path d="M5 20l3-16h8l3 16z" /><path d="M12 4v16" strokeDasharray="1.5 1.5" /></>),
  split: (<><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M2 12h20" strokeDasharray="2.5 1.5" /></>),
  transform: (<><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>),
  datum: (<><path d="M2 16l6-9h14l-6 9z" /><path d="M9 11.5h6" strokeDasharray="1.5 1.5" /></>),
  text: (<><path d="M5 6V4h14v2M12 4v16M9 20h6" /></>),
  thread: (<><path d="M8 3v18M16 3v18" /><path d="M8 5l8 2M8 9l8 2M8 13l8 2M8 17l8 2" /></>),
  measure: (<><path d="M3 17L17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>),
  section: (<><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M12 4v16" /><path d="M12 4l8 4v8l-8 4" opacity=".35" /></>),
  variables: (<><path d="M8 4c-2 0-2 1.5-2 3s-1 3-2.5 3C5 10 6 11.5 6 13s0 3 2 3M16 4c2 0 2 1.5 2 3s1 3 2.5 3c-1.5 0-2.5 1.5-2.5 3s0 3-2 3" /><path d="M10 13l4-6M10 7l4 6" /></>),
  configs: (<><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="8" y="14" width="8" height="7" rx="1" /></>),
  mass: (<><path d="M6 9h12l2 11H4z" /><circle cx="12" cy="6" r="2.5" /></>),
  shaded: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fillOpacity=".25" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  shadedEdges: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fillOpacity=".18" strokeWidth={2.2} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" strokeWidth={2.2} /></>),
  wireframe: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M4 16.5L12 12l8 4.5M12 3v9" strokeDasharray="1.5 1.5" /></>),
  hiddenLine: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M4 16.5l8-4.5" strokeDasharray="1.2 1.6" opacity=".6" /></>),
  xray: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fillOpacity=".08" strokeDasharray="2.5 1.2" /><circle cx="12" cy="12" r="3" /></>),
  perspective: (<><path d="M3 6l7 3v6l-7 3zM21 4l-11 5M21 20l-11-5M21 4v16" /></>),
  ortho: (<><rect x="4" y="6" width="10" height="12" /><path d="M14 6l6-2v12l-6 2M4 6l6-2h10" /></>),
  palette: (<><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5-1-2 0-3s3 0 4.5-1S21 13 21 11c0-4.5-4-8-9-8z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10" cy="7" r="1.2" /><circle cx="15" cy="7.5" r="1.2" /></>),
  fit: (<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></>),
  back: (<><rect x="5" y="5" width="14" height="14" rx="1" strokeDasharray="2 1.5" /><path d="M9 12h6" /></>),
  bottom: (<><rect x="5" y="5" width="14" height="14" rx="1" /><circle cx="12" cy="12" r="3" strokeDasharray="1.5 1.5" /></>),
  left: (<><path d="M17 5L7 8v8l10 3z" /></>),
  export: (<><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>),
  help: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></>),
  mouse: (<><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 7v3" /></>),
  chevronDown: (<><path d="M6 9l6 6 6-6" /></>),
  chevronRight: (<><path d="M9 6l6 6-6 6" /></>),
  edit: (<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  up: (<><path d="M12 19V5M6 11l6-6 6 6" /></>),
  down: (<><path d="M12 5v14M6 13l6 6 6-6" /></>),
  copy: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>),
  layers: (<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>),
  axes: (<><path d="M5 19V5M5 19h14M5 19l9-9" /></>),
  home: (<><path d="M3 11l9-7 9 7M5 9v11h14V9" /></>),
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  table: (<><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 10h18M3 15h18M9 4v16" /></>),
};

export type CadIconName = keyof typeof P;

/** Barevné tóny ikon podle kategorie (jako barevné ikony v profesionálních CAD). */
export const TONE = {
  sketch: "#2563EB",
  create: "#0E7490",
  feature: "#D97706",
  cut: "#E03930",
  pattern: "#16A34A",
  ref: "#7C3AED",
  view: "#475569",
  tool: "#9333EA",
  file: "#334155",
} as const;
export type Tone = keyof typeof TONE;

/**
 * Ikona nástroje. S `tone` se kreslí dvoubarevně: obrys v barvě kategorie + jemná výplň.
 */
export function CadIcon({ name, className = "h-5 w-5", tone }: { name: CadIconName; className?: string; tone?: Tone }) {
  const body = P[name] ?? P.cube;
  if (!tone) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {body}
      </svg>
    );
  }
  const c = TONE[tone];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g fill={c} fillOpacity={0.16} stroke="none">
        {body}
      </g>
      <g stroke={c} strokeWidth={1.6}>
        {body}
      </g>
    </svg>
  );
}
