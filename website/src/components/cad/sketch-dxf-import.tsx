"use client";

/**
 * Skica › Import DXF…: výběr souboru a dialog s volbami (jednotky, posun počátku, hladiny) – entity se přidají
 * do OTEVŘENÉ skici jedním krokem historie (cad/sketch-dxf-import.ts). Otevření DXF jako nového dílu zůstává
 * v Data › Otevřít.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DXF_UNIT_MM, dxfForSketch, dxfImportMessage, fmtMm as fmt, type DxfUnit } from "@/cad/sketch-dxf-import";
import { tr } from "@/cad/i18n";
import type { SketchEntity } from "@/cad/types";
import { Btn, Field, Modal, Segmented, Toggle, inputCls } from "./ui";

/** Výběr souboru .dxf přímo z kliknutí (bez skrytého pole v aplikaci); null = zrušeno. */
export function pickDxfFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".dxf,application/dxf,image/vnd.dxf";
    inp.setAttribute("data-sketch-dxf-input", "");
    inp.style.display = "none";
    document.body.appendChild(inp);
    const done = (v: { name: string; text: string } | null) => {
      inp.remove();
      resolve(v);
    };
    inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      if (!f) return done(null);
      void f.text().then((text) => done({ name: f.name, text }), () => done(null));
    });
    inp.addEventListener("cancel", () => done(null));
    inp.click();
  });
}

const num = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function SketchDxfImportDialog({ file, sketchName, onClose, onImport }: { file: { name: string; text: string }; sketchName: string; onClose: () => void; onImport: (entities: SketchEntity[], message: string) => void }) {
  const [unit, setUnit] = useState<DxfUnit>("file");
  const [toOrigin, setToOrigin] = useState(false);
  const [dx, setDx] = useState("0");
  const [dy, setDy] = useState("0");
  const [off, setOff] = useState<string[]>([]);
  // Esc zavře dialog hned prvním stiskem a nedojde ke skice pod ním (ta by zrušila nástroj / výběr): zachycení na okně
  // ještě před posluchači skici, jeden stálý posluchač (onClose je při každém vykreslení nová funkce)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  /** souhrn souboru (všechny hladiny, jednotky souboru) – pro seznam hladin a chybu čtení */
  const info = useMemo(() => {
    try {
      return { r: dxfForSketch(file.text), err: null as string | null };
    } catch (e) {
      return { r: null, err: e instanceof Error ? e.message : String(e) };
    }
  }, [file.text]);
  const layers = info.r?.layers ?? [];
  const used = layers.filter((l) => !off.includes(l.name)).map((l) => l.name);
  const res = useMemo(() => {
    if (!info.r) return null;
    try {
      return dxfForSketch(file.text, { unit, toOrigin, offset: [num(dx), num(dy)], layers: used });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.r, file.text, unit, toOrigin, dx, dy, off.join("\n")]);
  const n = res?.entities.length ?? 0;
  const fileUnit = info.r?.fileUnit;
  return (
    <Modal
      title={tr("Import DXF do skici „{0}“", sketchName)}
      icon="open"
      tone="file"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{tr("Zrušit")}</Btn>
          <Btn primary disabled={!n} onClick={() => res && onImport(res.entities, dxfImportMessage(file.name, res, used.length))}>
            <span data-dxf-import-ok>{tr("Importovat (entit: {0})", n)}</span>
          </Btn>
        </>
      }
    >
      <div data-dxf-import className="text-[12.5px]">
        <p className="mb-2 text-[12px] text-[#4a5664]">
          {file.name} · {tr("entit v souboru: {0}", info.r?.total ?? 0)} · {fileUnit ? tr("jednotky souboru: {0}", fileUnit) : tr("soubor jednotky neuvádí (bráno jako mm)")}
        </p>
        {info.err ? (
          <p className="rounded bg-amber-50 px-2 py-1.5 text-[12px] text-[#8a5a00]" data-dxf-import-error>
            {info.err}
          </p>
        ) : (
          <>
            <Field label={tr("Jednotky výkresu DXF")} hint={tr("převod na mm skici")}>
              <Segmented<DxfUnit>
                size="sm"
                value={unit}
                onChange={setUnit}
                options={[{ v: "file", l: tr("Podle souboru"), title: fileUnit ? tr("jednotky souboru: {0}", fileUnit) : tr("soubor jednotky neuvádí (bráno jako mm)") }, ...(Object.keys(DXF_UNIT_MM) as Exclude<DxfUnit, "file">[]).map((u) => ({ v: u as DxfUnit, l: u === "in" ? tr("palce") : u }))]}
              />
            </Field>
            <Toggle label={tr("Levý dolní roh do počátku skici")} checked={toOrigin} onChange={setToOrigin} hint={tr("jinak zůstanou souřadnice ze souboru")} />
            <div className="grid grid-cols-2 gap-2">
              <Field label={tr("Posun X [mm]")}>
                <input className={inputCls} inputMode="decimal" value={dx} onChange={(e) => setDx(e.target.value)} data-dxf-dx />
              </Field>
              <Field label={tr("Posun Y [mm]")}>
                <input className={inputCls} inputMode="decimal" value={dy} onChange={(e) => setDy(e.target.value)} data-dxf-dy />
              </Field>
            </div>
            {layers.length > 1 && (
              <Field label={tr("Hladiny")} hint={tr("{0} z {1}", used.length, layers.length)}>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {layers.map((l) => (
                    <label key={l.name} className="flex items-center gap-1.5 text-[12px]">
                      <input type="checkbox" data-dxf-layer={l.name} checked={!off.includes(l.name)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== l.name) : [...o, l.name]))} />
                      {l.name} <span className="text-[#8a95a3]">({l.count})</span>
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <p className="mt-2 rounded bg-[#f3f6f9] px-2 py-1.5 text-[12px] text-[#33404d]" data-dxf-import-summary>
              {tr("Přidá se entit: {0}", n)}
              {res?.bbox ? ` · ${fmt(res.bbox[1][0] - res.bbox[0][0])} × ${fmt(res.bbox[1][1] - res.bbox[0][1])} mm · X ${fmt(res.bbox[0][0])}…${fmt(res.bbox[1][0])}, Y ${fmt(res.bbox[0][1])}…${fmt(res.bbox[1][1])}` : ""}
              {res && Object.keys(res.skipped).length ? ` · ${tr("přeskočeno: {0}", Object.entries(res.skipped).map(([t, k]) => `${t} ×${k}`).join(", "))}` : ""}
            </p>
            <p className="mt-1.5 text-[11px] text-[#6b7785]">{tr("Entity se přidají k otevřené skice jedním krokem – Ctrl+Z vrátí celý import. DXF jako nový díl otevřete přes Data › Otevřít.")}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
