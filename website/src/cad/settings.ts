import { vaultGet, vaultRemove, vaultSet } from "./vault";
/** Uživatelské nastavení CAD – uložené v prohlížeči (localStorage), s exportem/importem JSON. */
import type { DisplayMode, MouseScheme } from "@/components/cad/viewport";

export type Settings = {
  /** revize výchozích hodnot (migrace uložených nastavení) */
  rev?: number;
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
  rev: 3,
  display: "shadedEdges",
  bg: "blue",
  ortho: false,
  showGrid: false,
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
      // rev 3: 3D mřížka je nově ve výchozím stavu vypnutá – dříve uložená nastavení ji měly zapnutou implicitně
      if (!s.rev || s.rev < 3) {
        s.showGrid = false;
        s.rev = 3;
      }
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

// ---------------- nedávné soubory (jen v šifrovaném úložišti – viz vault.ts) ----------------

export type RecentDoc = { id: string; name: string; kind: "part" | "assembly"; at: number; features: number; thumb?: string };
const RECENT = "mn-cad-recent-v1";

export async function loadRecent(): Promise<RecentDoc[]> {
  try {
    const t = await vaultGet(RECENT);
    return t ? (JSON.parse(t) as RecentDoc[]) : [];
  } catch {
    return [];
  }
}

/** Přidá / aktualizuje záznam; bez nového náhledu zůstane dosavadní. */
export async function pushRecent(r: RecentDoc, limit = 12) {
  try {
    const list = await loadRecent();
    const prev = list.find((x) => x.id === r.id);
    const next = list.filter((x) => x.id !== r.id);
    next.unshift({ ...r, thumb: r.thumb ?? prev?.thumb });
    await vaultSet(RECENT, JSON.stringify(next.slice(0, limit)));
  } catch {
    /* ignore */
  }
}

export async function removeRecent(id: string) {
  try {
    await vaultSet(RECENT, JSON.stringify((await loadRecent()).filter((x) => x.id !== id)));
    vaultRemove(`mn-cad-doc-${id}`);
  } catch {
    /* ignore */
  }
}

/** Uložení dokumentu k nedávnému záznamu (šifrovaně; v režimu „neukládat“ se nic nezapíše). */
export async function storeRecentDoc(id: string, json: string) {
  await vaultSet(`mn-cad-doc-${id}`, json);
}
export async function readRecentDoc(id: string): Promise<string | null> {
  return vaultGet(`mn-cad-doc-${id}`);
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
