import { MATERIALS, findMaterial } from "@/lib/pricing/materials";
import type { MaterialGroup } from "@/lib/pricing/types";

/** Materiál pro výpočet hmotnosti (bez cen). */
export interface ViewerMaterial {
  key: string;
  label: string;
  group: MaterialGroup;
  density: number;
}

export const GROUP_LABEL: Record<MaterialGroup, string> = {
  konstrukcni_ocel: "Konstrukční ocel",
  automatova_ocel: "Automatová ocel",
  legovana_ocel: "Legovaná ocel",
  nastrojova_ocel: "Nástrojová ocel",
  nerez: "Nerez",
  litina: "Litina",
  hlinik: "Hliník / dural",
  mosaz: "Mosaz",
  med: "Měď",
  bronz: "Bronz",
  titan: "Titan",
  plast: "Plasty",
};

export const DEFAULT_VIEWER_MATERIALS: ViewerMaterial[] = MATERIALS.map((m) => ({ key: m.key, label: m.label, group: m.group, density: m.densityKgDm3 }));

let cache: Promise<ViewerMaterial[]> | null = null;

/** Katalog z Nacenění (DB), při chybě výchozí katalog aplikace. */
export function loadViewerMaterials(): Promise<ViewerMaterial[]> {
  if (!cache) {
    cache = fetch("/api/viewer/materials", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { materials?: ViewerMaterial[] } | null) => (j?.materials?.length ? j.materials : DEFAULT_VIEWER_MATERIALS))
      .catch(() => DEFAULT_VIEWER_MATERIALS);
  }
  return cache;
}

/** Materiál podle názvu dílu / souboru (např. „1.4301", „AlMgSi"), jinak null. */
export function guessMaterialKey(text: string, list: ViewerMaterial[]): string | null {
  const catalog = MATERIALS.filter((m) => list.some((l) => l.key === m.key));
  const r = findMaterial(text, catalog.length ? catalog : MATERIALS);
  return r.matched ? r.material.key : null;
}

const LS_KEY = "viewer3d.material";

export function lastMaterialKey(): string | null {
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function rememberMaterialKey(key: string) {
  try {
    window.localStorage.setItem(LS_KEY, key);
  } catch {
    /* soukromé okno */
  }
}
