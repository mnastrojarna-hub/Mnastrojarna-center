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
};

export type CadIconName = keyof typeof P;

export function CadIcon({ name, className = "h-5 w-5" }: { name: CadIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? P.cube}
    </svg>
  );
}
