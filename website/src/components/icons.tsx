import type { IconName } from "@/content/site";

type P = { className?: string; strokeWidth?: number };
const base = (p: P) => ({
  className: p.className ?? "h-6 w-6",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: p.strokeWidth ?? 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
});

const paths: Record<IconName | "arrow" | "check" | "phone" | "mail" | "upload" | "shield" | "clock" | "pin" | "x" | "menu" | "cube" | "sparkle" | "file" | "lock", React.ReactNode> = {
  mill: (<><path d="M9 2h6v4H9z" /><path d="M10 6v6l-2 3h8l-2-3V6" /><path d="M8 15l1 7M16 15l-1 7M12 15v7" /></>),
  axes: (<><path d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5" /><path d="M9.5 4.5 12 2l2.5 2.5M18 18.5l1.8-2-3.2-.6M3.4 15.4l.8 3.1 3-1" /><circle cx="12" cy="12" r="2" /></>),
  wire: (<><path d="M6 2v20M18 2v20" /><path d="M6 6h12M6 18h12" /><path d="M10 9l2 3-2 3M14 9l-2 3 2 3" /></>),
  die: (<><rect x="3" y="3" width="18" height="6" rx="1" /><rect x="3" y="15" width="18" height="6" rx="1" /><path d="M8 9v3h8V9M9 15v-2h6v2" /></>),
  machine: (<><rect x="2" y="13" width="20" height="8" rx="1" /><path d="M5 13V7h6v6M11 9h6l2 4" /><circle cx="7" cy="17" r="1" /><circle cx="17" cy="17" r="1" /><path d="M8 3v4" /></>),
  prototype: (<><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" /><path d="M12 11l8-4.5M12 11v9M12 11 4 6.5" /></>),
  spare: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>),
  cad: (<><rect x="3" y="3" width="18" height="14" rx="1.5" /><path d="M8 21h8M12 17v4" /><path d="M7 13l3-6 3 4 2-2 2 4" /></>),
  measure: (<><path d="M3 17 17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l1.5 1.5M13 7l2 2" /></>),
  stock: (<><path d="M3 9l9-6 9 6v12H3z" /><path d="M7 21v-8h10v8M7 17h10" /></>),
  arrow: (<><path d="M5 12h14M13 6l6 6-6 6" /></>),
  check: (<><path d="M5 12.5l4.5 4.5L19 7" /></>),
  phone: (<><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" /></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  upload: (<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>),
  shield: (<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  pin: (<><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>),
  x: (<><path d="M6 6l12 12M18 6 6 18" /></>),
  menu: (<><path d="M4 7h16M4 12h16M4 17h10" /></>),
  cube: (<><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="m3 7 9 5 9-5M12 12v10" /></>),
  sparkle: (<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>),
  file: (<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>),
  lock: (<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
};

export type AnyIcon = keyof typeof paths;

export function Icon({ name, ...p }: P & { name: AnyIcon }) {
  return <svg {...base(p)}>{paths[name]}</svg>;
}
