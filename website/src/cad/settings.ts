/** Uživatelské nastavení CAD – uložené v prohlížeči (localStorage), s exportem/importem JSON. */
import type { DisplayMode, MouseScheme } from "@/components/cad/viewport";

export type Settings = {
  // zobrazení
  display: DisplayMode;
  bg: string;
  ortho: boolean;
  showGrid: boolean;
  showViewCube: boolean;
  showTriad: boolean;
  showChips: boolean;
  meshQuality: "draft" | "normal" | "fine";
  edgeWidth: 1 | 2;
  // ovládání
  mouse: MouseScheme;
  invertZoom: boolean;
  zoomToCursor: boolean;
  confirmDelete: boolean;
  // jednotky
  units: "mm" | "inch";
  decimals: 1 | 2 | 3 | 4;
  angleDecimals: 0 | 1 | 2;
  // skica
  snapGrid: boolean;
  gridStep: number; // 0 = automaticky
  autoConstraints: boolean;
  showConstraints: boolean;
  autoExtrude: boolean; // po dokončení skici nabídnout vysunutí
  // soubory
  autosave: boolean;
  startScreen: boolean;
  defaultMaterial: string;
  recentLimit: number;
  // výkres
  author: string;
  sheet: "auto" | "A4" | "A3" | "A2" | "A1" | "A0";
  projection: "E" | "A";
  tolerance: string;
  // zkratky (příkaz → klávesa)
  shortcuts: Record<string, string>;
};

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  "view.iso": "0",
  "view.front": "1",
  "view.top": "2",
  "view.right": "3",
  "view.back": "4",
  "view.bottom": "5",
  "view.left": "6",
  "view.fit": "F",
  "view.ortho": "P",
  "tool.measure": "M",
  "tool.section": "X",
  "feature.extrude": "E",
  "feature.hole": "H",
  "feature.fillet": "B",
  "feature.chamfer": "N",
  "sketch.new": "S",
  "palette": "Ctrl+K",
  "file.save": "Ctrl+S",
  "file.open": "Ctrl+O",
  "edit.undo": "Ctrl+Z",
  "edit.redo": "Ctrl+Y",
};

export const DEFAULT_SETTINGS: Settings = {
  display: "shadedEdges",
  bg: "blue",
  ortho: false,
  showGrid: true,
  showViewCube: true,
  showTriad: true,
  showChips: true,
  meshQuality: "normal",
  edgeWidth: 1,
  mouse: "zw3d",
  invertZoom: false,
  zoomToCursor: true,
  confirmDelete: false,
  units: "mm",
  decimals: 2,
  angleDecimals: 1,
  snapGrid: true,
  gridStep: 0,
  autoConstraints: true,
  showConstraints: true,
  autoExtrude: true,
  autosave: true,
  startScreen: true,
  defaultMaterial: "ocel",
  recentLimit: 12,
  author: "",
  sheet: "auto",
  projection: "E",
  tolerance: "ISO 2768-mK",
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

const KEY = "mn-cad-settings-v2";
const LEGACY = "mn-cad-prefs-v1";

export function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...s, shortcuts: { ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) } };
    }
    const legacy = localStorage.getItem(LEGACY);
    if (legacy) return { ...DEFAULT_SETTINGS, ...JSON.parse(legacy) };
  } catch {
    /* poškozená data */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* soukromý režim */
  }
}

export const exportSettings = (s: Settings) => JSON.stringify({ app: "mnastrojarna-cad-settings", version: 2, settings: s }, null, 2);

export function importSettings(json: string): Settings {
  const o = JSON.parse(json) as { app?: string; settings?: Partial<Settings> };
  if (o.app !== "mnastrojarna-cad-settings" || !o.settings) throw new Error("Soubor není nastavení Mnástrojárna CAD.");
  return { ...DEFAULT_SETTINGS, ...o.settings, shortcuts: { ...DEFAULT_SHORTCUTS, ...(o.settings.shortcuts ?? {}) } };
}

// ---------------- jednotky ----------------

const INCH = 25.4;

/** Formát délky podle nastavení (interně vždy mm). */
export function fmtLen(mm: number, s: Pick<Settings, "units" | "decimals">): string {
  const v = s.units === "inch" ? mm / INCH : mm;
  return `${v.toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: s.decimals })} ${s.units === "inch" ? "in" : "mm"}`;
}

/** Převod zadané hodnoty v uživatelských jednotkách na mm. */
export const toMm = (v: number, units: Settings["units"]) => (units === "inch" ? v * INCH : v);
export const fromMm = (mm: number, units: Settings["units"]) => (units === "inch" ? mm / INCH : mm);

// ---------------- nedávné soubory ----------------

export type RecentDoc = { id: string; name: string; kind: "part" | "assembly"; at: number; features: number; thumb?: string };
const RECENT = "mn-cad-recent-v1";

export function loadRecent(): RecentDoc[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as RecentDoc[];
  } catch {
    return [];
  }
}

export function pushRecent(r: RecentDoc, limit = 12) {
  try {
    const list = loadRecent().filter((x) => x.id !== r.id);
    list.unshift(r);
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, limit)));
  } catch {
    /* ignore */
  }
}

export function removeRecent(id: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(loadRecent().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}

/** Kompaktní uložení dokumentu k nedávnému záznamu (pro opětovné otevření). */
export function storeRecentDoc(id: string, json: string) {
  try {
    localStorage.setItem(`mn-cad-doc-${id}`, json);
  } catch {
    /* příliš velké */
  }
}
export function readRecentDoc(id: string): string | null {
  try {
    return localStorage.getItem(`mn-cad-doc-${id}`);
  } catch {
    return null;
  }
}

/** Normalizace zkratky z KeyboardEvent na tvar „Ctrl+Shift+K“. */
export function keyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && e.key.length > 1) parts.push("Shift");
  let k = e.key;
  if (k === " ") k = "Space";
  if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}
