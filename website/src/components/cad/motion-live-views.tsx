"use client";
/**
 * Vlna 22, kolo 7b, bod 14 („víc živých pohledů v okně“): pohledy studie zvolené pro video (`pohyb video pohled "A" "B"`,
 * nastavení videa) se kreslí ŽIVĚ a synchronně v panelu studie – každý svou kamerou a rovinou řezu, při přehrávání, kroku
 * i tažení časové osy (stejná poloha jako 3D okno). Vykresluje je softwarový vykreslovač (`@/cad/motion-frames`
 * `renderStudyView`), takže fungují s WebGL i bez něj a nezakládají další kontext WebGL. Kamera pohledu je pevná
 * (spočítaná při prvním snímku), řez z pohledu; čela řezu komponent jako ve 3D okně.
 */
import { tr } from "@/cad/i18n";
import { renderStudyView } from "@/cad/motion-frames";
import type { SoftCamera } from "@/cad/soft-render";
import type { MotionView } from "@/cad/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { sceneItems, type SoftScene } from "./viewport-soft";

const W = 328;
const H = 184;

export function MotionLiveViews({ views, scene }: { views: MotionView[]; scene: SoftScene }) {
  const [hidden, setHidden] = useState(false);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const cams = useRef(new Map<string, SoftCamera>());
  const viewsKey = views.map((v) => `${v.id}:${JSON.stringify(v.camera ?? null)}:${JSON.stringify(v.section ?? null)}`).join("|");
  const compKey = (scene.assembly ?? []).map((c) => c.id).join(",");
  // pevná kamera pohledu: nová jen při změně pohledů nebo komponent (ne při každém kroku přehrávání)
  useMemo(() => cams.current.clear(), [viewsKey, compKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hidden || !views.length) return;
    const items = sceneItems(scene);
    if (!items.length) return;
    views.forEach((v, i) => {
      const cv = refs.current[i];
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      const r = renderStudyView(items, v, W, H, cams.current.get(v.id) ?? null);
      cams.current.set(v.id, r.cam);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), W, H), 0, 0);
      // otisk obrazu pro kontrolu (e2e): mění se s polohou, ne s časem překreslení
      cv.dataset.liveSig = r.sig.join(",");
      cv.dataset.liveFrames = String(Number(cv.dataset.liveFrames ?? "0") + 1);
    });
    // jen při změně polohy (nový seznam komponent z cad-app), stylu nebo pohledů – ne při každém vykreslení aplikace
  }, [scene.assembly, scene.display, viewsKey, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!views.length) return null;
  return (
    <div data-live-views={views.length} className="rounded border border-[#dfe4ea] bg-[#f7f8f9] p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Živé pohledy ({0})", views.length)}</p>
        <button type="button" data-live-views-toggle onClick={() => setHidden((h) => !h)} className="rounded px-1 text-[11px] text-[#6b7785] hover:bg-[#eef2f6]">
          {hidden ? tr("Zobrazit") : tr("Skrýt")}
        </button>
      </div>
      {!hidden && (
        <div className="space-y-1.5">
          {views.map((v, i) => (
            <figure key={v.id} className="m-0">
              <canvas
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-live-view={v.name}
                width={W}
                height={H}
                className="block w-full rounded border border-[#dfe4ea] bg-white"
              />
              <figcaption className="mt-0.5 text-[10.5px] text-[#6b7785]">{v.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="mt-1 text-[10.5px] leading-snug text-[#6b7785]">{tr("Pohledy videa (pohyb video pohled …) synchronně s polohou v okně – kamera a řez pohledu")}</p>
    </div>
  );
}
