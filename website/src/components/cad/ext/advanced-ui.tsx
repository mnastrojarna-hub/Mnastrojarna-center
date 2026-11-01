/** UI pokročilého modelování: ikony, vlastní formulář zrcadlení více prvků, akce „Tloušťka stěn“ (vzorkování sítě). */
import type { Feature, MeshData } from "@/cad/types";
import { registerIcon } from "./icons";
import { registerExtUi, type ExtFormProps } from "./registry";

// ---------- ikony (24×24, stroke currentColor) ----------
registerIcon("adv-varfillet", <><path d="M4 20V9a5 5 0 0 1 5-5h11" /><path d="M4 20V13a9 9 0 0 1 9-9h7" strokeDasharray="1.5 1.5" /><path d="M4 4h4M4 4v4" strokeDasharray="1 2" /></>);
registerIcon("adv-fullround", <><path d="M4 20V8a4 4 0 0 1 8 0v12" /><path d="M12 8a4 4 0 0 1 8 0v12" /><path d="M4 20h16" /></>);
registerIcon("adv-chain", <><path d="M3 15a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6" /><circle cx="3" cy="15" r="1.5" /><circle cx="21" cy="15" r="1.5" /><path d="M9 9a6 6 0 0 1 6 0" strokeDasharray="1.5 1.5" /></>);
registerIcon("adv-chamfer2", <><path d="M4 20V11l7-7h9" /><path d="M4 11h7V4" strokeDasharray="1.5 2" /><path d="M6 8l2 2M9 5l2 2" /></>);
registerIcon("adv-mirrorfeat", <><path d="M12 2v20" strokeDasharray="2 2" /><rect x="3" y="8" width="6" height="8" rx="1" /><rect x="15" y="8" width="6" height="8" rx="1" strokeDasharray="2 1.5" /></>);
registerIcon("adv-curvepattern", <><path d="M3 18c4-10 10-10 18-4" strokeDasharray="2 2" /><circle cx="4" cy="16" r="2" /><circle cx="9" cy="10.5" r="2" /><circle cx="15" cy="9.5" r="2" /><circle cx="20" cy="13" r="2" /></>);
registerIcon("adv-fillpattern", <><path d="M3 4h18v16H3z" /><circle cx="8" cy="9" r="1.3" /><circle cx="12" cy="9" r="1.3" /><circle cx="16" cy="9" r="1.3" /><circle cx="8" cy="15" r="1.3" /><circle cx="12" cy="15" r="1.3" /><circle cx="16" cy="15" r="1.3" /></>);
registerIcon("adv-twist", <><path d="M7 3h10M7 21h10" /><path d="M7 3c0 6 10 6 10 12M17 3c0 6-10 6-10 12" /><path d="M7 15v6M17 15v6" /></>);
registerIcon("adv-dome", <><path d="M3 18h18" /><path d="M5 18a7 7 0 0 1 14 0" /><path d="M8 18a4 3 0 0 1 8 0" strokeDasharray="1.5 1.5" /></>);
registerIcon("adv-textcyl", <><path d="M5 4h14v16H5z" rx="7" /><ellipse cx="12" cy="4" rx="7" ry="2" /><path d="M9 10h6M12 10v6" /></>);
registerIcon("adv-partdraft", <><path d="M6 20l2-8h8l2 8z" /><path d="M8 12l-1-8h10l-1 8" /><path d="M2 12h20" strokeDasharray="2.5 1.5" /></>);
registerIcon("adv-lip", <><path d="M3 14h18v6H3z" /><path d="M5 14v-3h14v3" /><path d="M7 11V9h10v2" strokeDasharray="1.5 1.5" /></>);
registerIcon("adv-scale", <><rect x="3" y="11" width="10" height="10" rx="1" /><rect x="9" y="3" width="12" height="12" rx="1" strokeDasharray="2 1.5" /><path d="M8 16l5-5" /></>);
registerIcon("adv-holes", <><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="10" r="2" /><circle cx="16" cy="10" r="2" /><circle cx="12" cy="15" r="2" /></>);
registerIcon("adv-combine", <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" strokeDasharray="2 1.5" /><path d="M12 7v10" /></>);
registerIcon("adv-check", <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M8 12l3 3 5-6" /></>);
registerIcon("adv-simplify", <><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /><path d="M12 11l-4-2" strokeDasharray="1.5 1.5" /></>);
registerIcon("adv-wall", <><path d="M4 5h16v14H4z" /><path d="M8 9h8v6H8z" /><path d="M4 12h4M16 12h4" strokeDasharray="1.5 1.5" /></>);

// ---------- zrcadlení více prvků: vlastní formulář ----------
function MirrorForm({ f, doc, onChange }: ExtFormProps) {
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const before = doc.features.slice(0, idx).filter((x) => x.type !== "sketch" && x.type !== "datum" && x.type !== "ext");
  const sel = Array.isArray(f.data.features) ? (f.data.features as string[]) : [];
  const all = !!f.data.all;
  const plane = String(f.data.plane ?? "YZ");
  const offset = Number(f.data.offset ?? 0);
  const row = "flex items-center gap-2 text-[12.5px]";
  return (
    <div className="space-y-3">
      <label className={row}>
        <input type="checkbox" className="accent-[#E03930]" checked={all} onChange={(e) => onChange({ all: e.target.checked })} />
        Všechny dosavadní prvky
      </label>
      {!all && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Prvky k zrcadlení</p>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-ink-700/10 p-2">
            {before.length === 0 && <p className="text-[11.5px] text-ink-700/50">Žádné dřívější prvky s tělesem.</p>}
            {before.map((x) => (
              <label key={x.id} className={row}>
                <input type="checkbox" className="accent-[#E03930]" checked={sel.includes(x.id)} onChange={(e) => onChange({ features: e.target.checked ? [...sel, x.id] : sel.filter((s) => s !== x.id) })} />
                {x.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Rovina zrcadlení</p>
        <div className="flex rounded-lg bg-steel-100 p-0.5">
          {["XY", "XZ", "YZ"].map((p) => (
            <button key={p} type="button" onClick={() => onChange({ plane: p })} className={`flex-1 rounded-md py-1 text-[12.5px] ${plane === p ? "bg-white font-semibold shadow-sm" : "text-ink-700/60"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Odsazení roviny [mm]</span>
        <input type="number" step={1} value={offset} onChange={(e) => onChange({ offset: Number(e.target.value) || 0 })} className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-brand" />
      </label>
    </div>
  );
}
registerExtUi("adv.mirrorFeatures", { Form: MirrorForm });

// ---------- tloušťka stěn: vzorkování sítě (paprsek dovnitř z těžiště trojúhelníků) ----------
export function wallThickness(mesh: MeshData, samples = 600): { min: number; at: [number, number, number]; avg: number; count: number } {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const nTri = t.length / 3;
  const tris: { c: [number, number, number]; n: [number, number, number]; a: number; i: number }[] = [];
  for (let i = 0; i < nTri; i++) {
    const [a, b, c] = [t[i * 3] * 3, t[i * 3 + 1] * 3, t[i * 3 + 2] * 3];
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    tris.push({ c: [(v[a] + v[b] + v[c]) / 3, (v[a + 1] + v[b + 1] + v[c + 1]) / 3, (v[a + 2] + v[b + 2] + v[c + 2]) / 3], n: [nx / l, ny / l, nz / l], a: l / 2, i });
  }
  // Möller–Trumbore
  const hit = (o: [number, number, number], d: [number, number, number], i: number): number | null => {
    const [a, b, c] = [t[i * 3] * 3, t[i * 3 + 1] * 3, t[i * 3 + 2] * 3];
    const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]];
    const e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    const s = [o[0] - v[a], o[1] - v[a + 1], o[2] - v[a + 2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (u < 0 || u > 1) return null;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (w < 0 || u + w > 1) return null;
    const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    return dist > 1e-6 ? dist : null;
  };
  const step = Math.max(1, Math.floor(tris.length / samples));
  let min = Infinity;
  let at: [number, number, number] = [0, 0, 0];
  let sum = 0;
  let count = 0;
  for (let k = 0; k < tris.length; k += step) {
    const s = tris[k];
    const d: [number, number, number] = [-s.n[0], -s.n[1], -s.n[2]];
    const o: [number, number, number] = [s.c[0] + d[0] * 1e-4, s.c[1] + d[1] * 1e-4, s.c[2] + d[2] * 1e-4];
    let best = Infinity;
    for (const q of tris) {
      if (q.i === s.i) continue;
      // jen výstupní stěny (normála souhlasí se směrem paprsku)
      if (q.n[0] * d[0] + q.n[1] * d[1] + q.n[2] * d[2] <= 0) continue;
      const h = hit(o, d, q.i);
      if (h != null && h < best) best = h;
    }
    if (!Number.isFinite(best)) continue;
    sum += best;
    count++;
    if (best < min) {
      min = best;
      at = s.c;
    }
  }
  return { min: Number.isFinite(min) ? min : 0, at, avg: count ? sum / count : 0, count };
}

registerExtUi("adv.wallThickness", {
  action: (api) => {
    const mesh = api.result?.mesh;
    if (!mesh || !mesh.triangles.length) return api.flash("Nejdřív vytvořte těleso.");
    const t0 = performance.now();
    const res = wallThickness(mesh);
    const f = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");
    const ms = Math.round(performance.now() - t0);
    if (!res.count) return api.flash("Tloušťku se nepodařilo změřit (otevřená síť?).");
    api.notice(
      "Tloušťka stěn",
      `Nejtenčí stěna: ${f(res.min)} mm\nu bodu X ${f(res.at[0])} · Y ${f(res.at[1])} · Z ${f(res.at[2])}\n\nPrůměrná tloušťka vzorků: ${f(res.avg)} mm (${res.count} vzorků, ${ms} ms)\n\nMetoda: paprsek dovnitř z těžiště trojúhelníků sítě k protější stěně. U velmi hrubé sítě zvyšte kvalitu sítě v Nastavení → Zobrazení.`,
    );
  },
});

export type { Feature };
