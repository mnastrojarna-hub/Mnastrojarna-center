import { cadLocale, tr } from "./i18n";
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
  /** při ukládání a exportu se zeptat na místo a název (vypnuto = přímé stažení pod výchozím názvem – automatizace, AI agenti) */
  askWhereToSave: boolean;
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

/** Zkratky ve 3D (díl, sestava). Zkratky nástrojů skici jsou zvlášť v DEFAULT_SKETCH_SHORTCUTS. */
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

/**
 * Zkratky ve skice (příkaz → klávesa). Platí jen při otevřené skice – je to jiný kontext než 3D, takže stejná
 * klávesa smí být použita jednou ve 3D (DEFAULT_SHORTCUTS) a jednou ve skice. Pořadí = pořadí v Nastavení a zároveň
 * priorita: mají-li dva příkazy skici stejnou zkratku, provede se ten dřívější (viz sketchShortcutAction).
 */
export const DEFAULT_SKETCH_SHORTCUTS: Record<string, string> = {
  "sketch.select": "V",
  "sketch.line": "L",
  "sketch.polyline": "K",
  "sketch.centerline": "X",
  "sketch.rect": "R",
  "sketch.circle": "C",
  "sketch.arc": "A",
  "sketch.ellipse": "E",
  "sketch.spline": "N",
  "sketch.point": "B",
  "sketch.polygon": "P",
  "sketch.slot": "S",
  "sketch.trim": "T",
  "sketch.offset": "O",
  "sketch.dimension": "D",
  "sketch.measure": "M",
  "sketch.horizontal": "H",
  "sketch.fit": "F",
  "sketch.grid": "G",
};

/** Skupiny zkratek pro Nastavení → Klávesové zkratky (každá skupina = jeden kontext kláves). */
export const SHORTCUT_GROUPS: { id: "model" | "sketch"; defaults: Record<string, string> }[] = [
  { id: "model", defaults: DEFAULT_SHORTCUTS },
  { id: "sketch", defaults: DEFAULT_SKETCH_SHORTCUTS },
];

/** Výchozí klávesa příkazu (3D i skica); neznámý příkaz = prázdný text. */
export const defaultShortcut = (id: string): string => DEFAULT_SHORTCUTS[id] ?? DEFAULT_SKETCH_SHORTCUTS[id] ?? "";

/** Platná zkratka příkazu: uložená, jinak výchozí (nastavení uložená před přidáním příkazu ho neznají). */
export const shortcutOf = (shortcuts: Record<string, string> | null | undefined, id: string): string => shortcuts?.[id] ?? defaultShortcut(id);

/** Uložené zkratky doplněné o výchozí hodnoty všech příkazů (3D i skica). */
export const withDefaultShortcuts = (shortcuts?: Record<string, string> | null): Record<string, string> => ({ ...DEFAULT_SHORTCUTS, ...DEFAULT_SKETCH_SHORTCUTS, ...(shortcuts ?? {}) });

/**
 * Příkaz skici (např. „sketch.line“) pro stisknutou kombinaci kláves ve tvaru z `keyCombo`, nebo null. Na velikosti
 * písmen nezáleží. Hledá se jen mezi příkazy skici – zkratky 3D se ve skice nepoužívají, takže stejná klávesa ve 3D
 * nevadí. Při shodě více příkazů skici vyhrává ten dřív v DEFAULT_SKETCH_SHORTCUTS (duplicity se v Nastavení
 * nezakazují, stejně jako u 3D).
 */
export function sketchShortcutAction(shortcuts: Record<string, string> | null | undefined, combo: string): string | null {
  const c = combo.trim().toUpperCase();
  if (!c) return null;
  for (const id of Object.keys(DEFAULT_SKETCH_SHORTCUTS)) if (shortcutOf(shortcuts, id).toUpperCase() === c) return id;
  return null;
}

export const DEFAULT_SETTINGS: Settings = {
  rev: 3,
  display: "shadedEdges",
  bg: "blue",
  ortho: false,
  showGrid: false,
  askWhereToSave: true,
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
  shortcuts: withDefaultShortcuts(),
};

const KEY = "mn-cad-settings-v2";
const LEGACY = "mn-cad-prefs-v1";

/**
 * Nastavení platné v této kartě: poprvé načtené z prohlížeče, pak vždy to naposledy uložené (saveSettings). Čtou ho
 * i části aplikace, které nastavení nedostávají přes vlastnosti – skicář a pás skici (zkratky nástrojů skici) – vždy
 * až v okamžiku použití, takže změna v Nastavení platí hned, bez znovunačtení. Drží se i tehdy, když prohlížeč zápis
 * do úložiště nedovolí.
 */
let current: Settings | null = null;

/** Nastavení uložené v prohlížeči, nebo null (nic uloženo, úložiště nedostupné, poškozená data). */
function readStored(): Settings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      // rev 3: 3D mřížka je nově ve výchozím stavu vypnutá – dříve uložená nastavení ji měly zapnutou implicitně
      if (!s.rev || s.rev < 3) {
        s.showGrid = false;
        s.rev = 3;
      }
      return { ...DEFAULT_SETTINGS, ...s, shortcuts: withDefaultShortcuts(s.shortcuts) };
    }
    const legacy = localStorage.getItem(LEGACY);
    if (legacy) {
      const s = JSON.parse(legacy) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...s, shortcuts: withDefaultShortcuts(s.shortcuts) };
    }
  } catch {
    /* poškozená data */
  }
  return null;
}

export function loadSettings(): Settings {
  if (current) return current;
  const s = readStored() ?? { ...DEFAULT_SETTINGS, shortcuts: withDefaultShortcuts() };
  // v prohlížeči si první načtení pamatujeme (jedna pravda pro celou kartu); na serveru a v testech bez úložiště ne
  if (typeof localStorage !== "undefined") current = s;
  return s;
}

/** Zkratky platné právě teď (uložené doplněné o výchozí) – čte se v okamžiku stisku klávesy / vykreslení pásu. */
export const currentShortcuts = (): Record<string, string> => loadSettings().shortcuts;

export function saveSettings(s: Settings) {
  current = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* soukromý režim */
  }
}

export const exportSettings = (s: Settings) => JSON.stringify({ app: "mnastrojarna-cad-settings", version: 2, settings: s }, null, 2);

export function importSettings(json: string): Settings {
  const o = JSON.parse(json) as { app?: string; settings?: Partial<Settings> };
  if (o.app !== "mnastrojarna-cad-settings" || !o.settings) throw new Error(tr("Soubor není nastavení Mnástrojárna CAD."));
  return { ...DEFAULT_SETTINGS, ...o.settings, shortcuts: withDefaultShortcuts(o.settings.shortcuts) };
}

// ---------------- jednotky ----------------

const INCH = 25.4;

/** Formát délky podle nastavení (interně vždy mm). */
export function fmtLen(mm: number, s: Pick<Settings, "units" | "decimals">): string {
  const v = s.units === "inch" ? mm / INCH : mm;
  return `${v.toLocaleString(cadLocale(), { minimumFractionDigits: 0, maximumFractionDigits: s.decimals })} ${s.units === "inch" ? "in" : "mm"}`;
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
  if (e.ctrlKey || e.metaKey) parts.push(tr("Ctrl"));
  if (e.altKey) parts.push(tr("Alt"));
  if (e.shiftKey && e.key.length > 1) parts.push(tr("Shift"));
  let k = e.key;
  if (k === " ") k = "Space";
  if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}
