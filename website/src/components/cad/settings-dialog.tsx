"use client";

import { useRef, useState } from "react";
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, exportSettings, importSettings, keyCombo, type Settings } from "@/cad/settings";
import { MATERIALS } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "./cad-icons";
import type { DisplayMode, MouseScheme } from "./viewport";
import { Btn, Field, Kbd, Modal, Segmented, Toggle, inputCls, selectCls } from "./ui";

type Tab = "general" | "display" | "mouse" | "sketch" | "drawing" | "files" | "keys";

export const SHORTCUT_LABELS: Record<string, string> = {
  "view.iso": "Pohled: izometrie",
  "view.front": "Pohled: přední",
  "view.top": "Pohled: horní",
  "view.right": "Pohled: pravý",
  "view.back": "Pohled: zadní",
  "view.bottom": "Pohled: spodní",
  "view.left": "Pohled: levý",
  "view.fit": "Přizpůsobit model oknu",
  "view.ortho": "Perspektiva / pravoúhlá",
  "tool.measure": "Měření",
  "tool.section": "Řez modelem",
  "feature.extrude": "Vysunutí",
  "feature.hole": "Díra",
  "feature.fillet": "Zaoblení",
  "feature.chamfer": "Sražení",
  "sketch.new": "Nová skica",
  palette: "Paleta příkazů",
  "file.save": "Uložit projekt",
  "file.open": "Otevřít / import",
  "edit.undo": "Zpět",
  "edit.redo": "Znovu",
};

export function SettingsDialog({ settings, onChange, onClose, backgrounds }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; backgrounds: Record<string, { label: string }> }) {
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<Settings>(settings);
  const [recording, setRecording] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = () => {
    onChange(draft);
    onClose();
  };
  const tabs: [Tab, string, CadIconName][] = [
    ["general", "Obecné", "settings"],
    ["display", "Zobrazení", "shaded"],
    ["mouse", "Myš a ovládání", "mouse"],
    ["sketch", "Skica", "sketch"],
    ["drawing", "Výkres", "drawing"],
    ["files", "Soubory", "save"],
    ["keys", "Klávesové zkratky", "table"],
  ];

  return (
    <Modal
      title="Nastavení"
      icon="settings"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Btn onClick={() => setDraft({ ...DEFAULT_SETTINGS })} title="Vrátit vše na výchozí hodnoty">
            Obnovit výchozí
          </Btn>
          <Btn onClick={() => download("mnastrojarna-cad-nastaveni.json", exportSettings(draft))}>Export</Btn>
          <Btn onClick={() => file.current?.click()}>Import</Btn>
          <input
            ref={file}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setDraft(importSettings(await f.text()));
              } catch (err) {
                alert((err as Error).message);
              }
              e.target.value = "";
            }}
          />
          <span className="flex-1" />
          <Btn onClick={onClose}>Storno</Btn>
          <Btn primary onClick={apply}>
            OK
          </Btn>
        </>
      }
    >
      <div className="-m-4 flex min-h-[460px]">
        <nav className="w-52 shrink-0 border-r border-[#e3e8ee] bg-[#f7f9fb] py-2">
          {tabs.map(([t, l, i]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn("flex w-full items-center gap-2.5 px-4 py-2 text-left text-[12.5px]", tab === t ? "bg-white font-semibold text-brand shadow-[inset_3px_0_0_#E03930]" : "text-[#3c4856] hover:bg-white/70")}>
              <CadIcon name={i} className="h-4 w-4" />
              {l}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 p-5">
          {tab === "general" && (
            <>
              <h3 className="mb-2 text-[13px] font-semibold">Jednotky a přesnost</h3>
              <Field label="Délkové jednotky">
                <Segmented value={draft.units} options={[{ v: "mm", l: "Milimetry (mm)" }, { v: "inch", l: "Palce (in)" }]} onChange={(v) => set("units", v)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desetinná místa (délky)">
                  <Segmented value={draft.decimals} options={[1, 2, 3, 4].map((n) => ({ v: n as Settings["decimals"], l: String(n) }))} onChange={(v) => set("decimals", v)} />
                </Field>
                <Field label="Desetinná místa (úhly)">
                  <Segmented value={draft.angleDecimals} options={[0, 1, 2].map((n) => ({ v: n as Settings["angleDecimals"], l: String(n) }))} onChange={(v) => set("angleDecimals", v)} />
                </Field>
              </div>
              <h3 className="mb-1 mt-5 text-[13px] font-semibold">Chování</h3>
              <Toggle label="Potvrzovat mazání prvků a komponent" checked={draft.confirmDelete} onChange={(v) => set("confirmDelete", v)} />
              <Toggle label="Po dokončení skici rovnou nabídnout vysunutí" hint="Styl Inventor/ZW3D – zrychluje tvorbu prvních těles" checked={draft.autoExtrude} onChange={(v) => set("autoExtrude", v)} />
              <Toggle label="Úvodní obrazovka při spuštění" hint="Nedávné soubory, šablony a ukázky" checked={draft.startScreen} onChange={(v) => set("startScreen", v)} />
              <Field label="Výchozí materiál nového dílu">
                <select value={draft.defaultMaterial} onChange={(e) => set("defaultMaterial", e.target.value)} className={selectCls}>
                  {MATERIALS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {tab === "display" && (
            <>
              <Field label="Výchozí styl zobrazení">
                <select value={draft.display} onChange={(e) => set("display", e.target.value as DisplayMode)} className={selectCls}>
                  <option value="shadedEdges">Stínovaný s hranami</option>
                  <option value="shaded">Stínovaný</option>
                  <option value="wireframe">Drátový</option>
                  <option value="hiddenLine">Skryté hrany</option>
                  <option value="xray">Průhledný</option>
                </select>
              </Field>
              <Field label="Pozadí pracovní plochy">
                <select value={draft.bg} onChange={(e) => set("bg", e.target.value)} className={selectCls}>
                  {Object.entries(backgrounds).map(([k, b]) => (
                    <option key={k} value={k}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kvalita sítě (přesnost zobrazení)" hint="jemnější = pomalejší přepočet">
                <Segmented value={draft.meshQuality} options={[{ v: "draft", l: "Hrubá" }, { v: "normal", l: "Normální" }, { v: "fine", l: "Jemná" }]} onChange={(v) => set("meshQuality", v)} />
              </Field>
              <Field label="Tloušťka hran">
                <Segmented value={draft.edgeWidth} options={[{ v: 1, l: "Tenké" }, { v: 2, l: "Silné" }]} onChange={(v) => set("edgeWidth", v as 1 | 2)} />
              </Field>
              <Toggle label="Pravoúhlé promítání jako výchozí" checked={draft.ortho} onChange={(v) => set("ortho", v)} />
              <Toggle label="Mřížka a osy" checked={draft.showGrid} onChange={(v) => set("showGrid", v)} />
              <Toggle label="Navigační krychle (ViewCube)" checked={draft.showViewCube} onChange={(v) => set("showViewCube", v)} />
              <Toggle label="Osový kříž vlevo dole" checked={draft.showTriad} onChange={(v) => set("showTriad", v)} />
              <Toggle label="Informační štítky (rozměry, hmotnost)" checked={draft.showChips} onChange={(v) => set("showChips", v)} />
            </>
          )}

          {tab === "mouse" && (
            <>
              <Field label="Schéma myši">
                <div className="space-y-1.5">
                  {(
                    [
                      ["zw3d", "ZW3D", "pravé tlačítko otáčí · prostřední posouvá · kolečko zoom · pravý klik (bez tahu) = nabídka"],
                      ["solidworks", "SolidWorks / Inventor", "prostřední otáčí · Ctrl+prostřední posouvá · kolečko zoom"],
                      ["simple", "Touchpad / jednoduché", "levé otáčí · pravé posouvá · kolečko zoom"],
                    ] as [MouseScheme, string, string][]
                  ).map(([v, l, d]) => (
                    <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-2.5", draft.mouse === v ? "border-brand bg-brand/5" : "border-[#e3e8ee] hover:bg-[#f7f9fb]")}>
                      <input type="radio" name="mouse" checked={draft.mouse === v} onChange={() => set("mouse", v)} className="mt-0.5 accent-[#E03930]" />
                      <span className="text-[12.5px]">
                        <span className="font-semibold">{l}</span>
                        <span className="block text-[11px] text-[#6b7785]">{d}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
              <Toggle label="Přiblížení ke kurzoru" hint="kolečko přibližuje k místu pod kurzorem, ne do středu" checked={draft.zoomToCursor} onChange={(v) => set("zoomToCursor", v)} />
              <Toggle label="Obrátit směr kolečka" checked={draft.invertZoom} onChange={(v) => set("invertZoom", v)} />
            </>
          )}

          {tab === "sketch" && (
            <>
              <Toggle label="Přichytávat k mřížce" checked={draft.snapGrid} onChange={(v) => set("snapGrid", v)} />
              <Field label="Krok mřížky [mm]" hint="0 = automaticky podle přiblížení">
                <input type="number" min={0} step={0.5} value={draft.gridStep} onChange={(e) => set("gridStep", Number(e.target.value))} className={inputCls} />
              </Field>
              <Toggle label="Automatické vazby při kreslení" hint="vodorovně/svisle/totožnost/tečně se přidají při přichycení" checked={draft.autoConstraints} onChange={(v) => set("autoConstraints", v)} />
              <Toggle label="Zobrazovat značky vazeb" checked={draft.showConstraints} onChange={(v) => set("showConstraints", v)} />
            </>
          )}

          {tab === "drawing" && (
            <>
              <Field label="Kreslil (do razítka)">
                <input value={draft.author} onChange={(e) => set("author", e.target.value)} placeholder="Jméno a příjmení" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Výchozí formát listu">
                  <select value={draft.sheet} onChange={(e) => set("sheet", e.target.value as Settings["sheet"])} className={selectCls}>
                    {["auto", "A4", "A3", "A2", "A1", "A0"].map((s) => (
                      <option key={s} value={s}>
                        {s === "auto" ? "Automaticky" : s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Promítání">
                  <Segmented value={draft.projection} options={[{ v: "E", l: "ISO E (Evropa)" }, { v: "A", l: "ISO A (USA)" }]} onChange={(v) => set("projection", v)} />
                </Field>
              </div>
              <Field label="Nepředepsané tolerance">
                <input value={draft.tolerance} onChange={(e) => set("tolerance", e.target.value)} className={inputCls} />
              </Field>
            </>
          )}

          {tab === "files" && (
            <>
              <Toggle label="Automatické ukládání rozpracovaného modelu" hint="do prohlížeče, obnoví se při příštím otevření" checked={draft.autosave} onChange={(v) => set("autosave", v)} />
              <Field label="Počet nedávných souborů">
                <input type="number" min={4} max={30} value={draft.recentLimit} onChange={(e) => set("recentLimit", Number(e.target.value))} className={inputCls} />
              </Field>
              <p className="mt-4 rounded bg-[#eef2f6] p-3 text-[12px] leading-relaxed text-[#4a5664]">
                Modely se ukládají jako soubory <code>.mncad</code> (otevřený JSON) do vašeho počítače. Pro výměnu s jinými CAD použijte STEP AP214 – otevře ho ZW3D, SolidWorks, Inventor, CATIA, NX, Creo i SolidEdge.
              </p>
            </>
          )}

          {tab === "keys" && (
            <>
              <p className="mb-2 text-[12px] text-[#6b7785]">Klikněte na zkratku a stiskněte novou kombinaci. Esc zruší záznam.</p>
              <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee]">
                {Object.keys(DEFAULT_SHORTCUTS).map((id) => (
                  <div key={id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
                    <span className="flex-1">{SHORTCUT_LABELS[id] ?? id}</span>
                    <button
                      type="button"
                      onClick={() => setRecording(id)}
                      onKeyDown={(e) => {
                        if (recording !== id) return;
                        e.preventDefault();
                        if (e.key === "Escape") return setRecording(null);
                        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
                        set("shortcuts", { ...draft.shortcuts, [id]: keyCombo(e.nativeEvent) });
                        setRecording(null);
                      }}
                      onBlur={() => recording === id && setRecording(null)}
                      className={cn("min-w-[90px] rounded border px-2 py-0.5 text-right", recording === id ? "border-brand bg-brand/5 text-brand" : "border-transparent hover:border-[#cfd6de]")}
                    >
                      {recording === id ? "stiskněte…" : <Kbd k={draft.shortcuts[id] ?? DEFAULT_SHORTCUTS[id]} />}
                    </button>
                    {draft.shortcuts[id] !== DEFAULT_SHORTCUTS[id] && (
                      <button type="button" title="Výchozí" onClick={() => set("shortcuts", { ...draft.shortcuts, [id]: DEFAULT_SHORTCUTS[id] })} className="text-[#8a95a3] hover:text-brand">
                        <CadIcon name="undo" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
