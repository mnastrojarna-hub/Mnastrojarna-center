"use client";

import { CAD_LANGS, getLang, langMeta, tr } from "@/cad/i18n";
import { disableEncrypted, enableEncrypted, isUnlocked, lock, notifyVault, persistMode, unlock, VAULT_EVENT, wipeStoredDocuments } from "@/cad/vault";
import { useEffect, useState as useLocalState } from "react";
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
    ["general", tr("Obecné"), "settings"],
    ["display", tr("Zobrazení"), "shaded"],
    ["mouse", tr("Myš a ovládání"), "mouse"],
    ["sketch", tr("Skica"), "sketch"],
    ["drawing", tr("Výkres"), "drawing"],
    ["files", tr("Soubory"), "save"],
    ["keys", tr("Klávesové zkratky"), "table"],
  ];

  return (
    <Modal
      title={tr("Nastavení")}
      icon="settings"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Btn onClick={() => setDraft({ ...DEFAULT_SETTINGS })} title={tr("Vrátit vše na výchozí hodnoty")}>
            {tr("Obnovit výchozí")}
          </Btn>
          <Btn onClick={() => download("mnastrojarna-cad-nastaveni.json", exportSettings(draft))}>{tr("Export")}</Btn>
          <Btn onClick={() => file.current?.click()}>{tr("Import")}</Btn>
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
          <Btn onClick={onClose}>{tr("Storno")}</Btn>
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
              <h3 className="mb-2 text-[13px] font-semibold">{tr("Jazyk rozhraní")}</h3>
              <Field label={tr("Jazyk")} hint={tr("přepnutí znovu načte aplikaci; rozpracovaná práce zůstane uložená")}>
                <Segmented
                  value={getLang()}
                  options={CAD_LANGS.map((l) => ({ v: l.id, l: l.label }))}
                  onChange={(v) => {
                    try {
                      localStorage.setItem("mn-cad-lang", v);
                    } catch {
                      /* bez úložiště */
                    }
                    if (v !== getLang()) window.location.assign(langMeta(v).path);
                  }}
                />
              </Field>
              <h3 className="mb-2 mt-5 text-[13px] font-semibold">{tr("Jednotky a přesnost")}</h3>
              <Field label={tr("Délkové jednotky")}>
                <Segmented value={draft.units} options={[{ v: "mm", l: tr("Milimetry (mm)") }, { v: "inch", l: tr("Palce (in)") }]} onChange={(v) => set("units", v)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr("Desetinná místa (délky)")}>
                  <Segmented value={draft.decimals} options={[1, 2, 3, 4].map((n) => ({ v: n as Settings["decimals"], l: String(n) }))} onChange={(v) => set("decimals", v)} />
                </Field>
                <Field label={tr("Desetinná místa (úhly)")}>
                  <Segmented value={draft.angleDecimals} options={[0, 1, 2].map((n) => ({ v: n as Settings["angleDecimals"], l: String(n) }))} onChange={(v) => set("angleDecimals", v)} />
                </Field>
              </div>
              <h3 className="mb-1 mt-5 text-[13px] font-semibold">{tr("Chování")}</h3>
              <Toggle label={tr("Potvrzovat mazání prvků a komponent")} checked={draft.confirmDelete} onChange={(v) => set("confirmDelete", v)} />
              <Toggle label={tr("Po dokončení skici rovnou nabídnout vysunutí")} hint={tr("Styl Inventor/ZW3D – zrychluje tvorbu prvních těles")} checked={draft.autoExtrude} onChange={(v) => set("autoExtrude", v)} />
              <Toggle label={tr("Úvodní obrazovka při spuštění")} hint={tr("Nedávné soubory, šablony a ukázky")} checked={draft.startScreen} onChange={(v) => set("startScreen", v)} />
              <Field label={tr("Výchozí materiál nového dílu")}>
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
              <Field label={tr("Výchozí styl zobrazení")}>
                <select value={draft.display} onChange={(e) => set("display", e.target.value as DisplayMode)} className={selectCls}>
                  <option value="shadedEdges">{tr("Stínovaný s hranami")}</option>
                  <option value="shaded">{tr("Stínovaný")}</option>
                  <option value="wireframe">{tr("Drátový")}</option>
                  <option value="hiddenLine">{tr("Skryté hrany")}</option>
                  <option value="xray">{tr("Průhledný")}</option>
                </select>
              </Field>
              <Field label={tr("Pozadí pracovní plochy")}>
                <select value={draft.bg} onChange={(e) => set("bg", e.target.value)} className={selectCls}>
                  {Object.entries(backgrounds).map(([k, b]) => (
                    <option key={k} value={k}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr("Kvalita sítě (přesnost zobrazení)")} hint={tr("jemnější = pomalejší přepočet")}>
                <Segmented value={draft.meshQuality} options={[{ v: "draft", l: tr("Hrubá") }, { v: "normal", l: tr("Normální") }, { v: "fine", l: tr("Jemná") }]} onChange={(v) => set("meshQuality", v)} />
              </Field>
              <Field label={tr("Tloušťka hran")}>
                <Segmented value={draft.edgeWidth} options={[{ v: 1, l: tr("Tenké") }, { v: 2, l: tr("Silné") }]} onChange={(v) => set("edgeWidth", v as 1 | 2)} />
              </Field>
              <Toggle label={tr("Pravoúhlé promítání jako výchozí")} checked={draft.ortho} onChange={(v) => set("ortho", v)} />
              <Toggle label={tr("Mřížka a osy")} checked={draft.showGrid} onChange={(v) => set("showGrid", v)} />
              <Toggle label={tr("Navigační krychle (ViewCube)")} checked={draft.showViewCube} onChange={(v) => set("showViewCube", v)} />
              <Toggle label={tr("Osový kříž vlevo dole")} checked={draft.showTriad} onChange={(v) => set("showTriad", v)} />
              <Toggle label={tr("Informační štítky (rozměry, hmotnost)")} checked={draft.showChips} onChange={(v) => set("showChips", v)} />
            </>
          )}

          {tab === "mouse" && (
            <>
              <Field label={tr("Schéma myši")}>
                <div className="space-y-1.5">
                  {(
                    [
                      ["zw3d", "ZW3D", tr("pravé tlačítko otáčí · prostřední posouvá · kolečko zoom · pravý klik (bez tahu) = nabídka")],
                      ["solidworks", "SolidWorks / Inventor", tr("prostřední otáčí · Ctrl+prostřední posouvá · kolečko zoom")],
                      ["simple", "Touchpad / jednoduché", tr("levé otáčí · pravé posouvá · kolečko zoom")],
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
              <Toggle label={tr("Přiblížení ke kurzoru")} hint={tr("kolečko přibližuje k místu pod kurzorem, ne do středu")} checked={draft.zoomToCursor} onChange={(v) => set("zoomToCursor", v)} />
              <Toggle label={tr("Obrátit směr kolečka")} checked={draft.invertZoom} onChange={(v) => set("invertZoom", v)} />
            </>
          )}

          {tab === "sketch" && (
            <>
              <Toggle label={tr("Přichytávat k mřížce")} checked={draft.snapGrid} onChange={(v) => set("snapGrid", v)} />
              <Field label={tr("Krok mřížky [mm]")} hint={tr("0 = automaticky podle přiblížení")}>
                <input type="number" min={0} step={0.5} value={draft.gridStep} onChange={(e) => set("gridStep", Number(e.target.value))} className={inputCls} />
              </Field>
              <Toggle label={tr("Automatické vazby při kreslení")} hint={tr("vodorovně/svisle/totožnost/tečně se přidají při přichycení")} checked={draft.autoConstraints} onChange={(v) => set("autoConstraints", v)} />
              <Toggle label={tr("Zobrazovat značky vazeb")} checked={draft.showConstraints} onChange={(v) => set("showConstraints", v)} />
            </>
          )}

          {tab === "drawing" && (
            <>
              <Field label={tr("Kreslil (do razítka)")}>
                <input value={draft.author} onChange={(e) => set("author", e.target.value)} placeholder={tr("Jméno a příjmení")} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr("Výchozí formát listu")}>
                  <select value={draft.sheet} onChange={(e) => set("sheet", e.target.value as Settings["sheet"])} className={selectCls}>
                    {["auto", "A4", "A3", "A2", "A1", "A0"].map((s) => (
                      <option key={s} value={s}>
                        {s === "auto" ? tr("Automaticky") : s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("Promítání")}>
                  <Segmented value={draft.projection} options={[{ v: "E", l: tr("ISO E (Evropa)") }, { v: "A", l: tr("ISO A (USA)") }]} onChange={(v) => set("projection", v)} />
                </Field>
              </div>
              <Field label={tr("Nepředepsané tolerance")}>
                <input value={draft.tolerance} onChange={(e) => set("tolerance", e.target.value)} className={inputCls} />
              </Field>
            </>
          )}

          {tab === "files" && (
            <>
              <Toggle
                label={tr("Při ukládání a exportu se zeptat na místo a název souboru")}
                checked={draft.askWhereToSave}
                onChange={(v) => setDraft({ ...draft, askWhereToSave: v })}
                hint={tr("Vypnuto = soubory se rovnou stáhnou pod výchozím názvem do složky Stažené (bez dialogu) – vhodné pro automatizaci a AI agenty.")}
              />
              <StorageSettings />
              <Field label={tr("Počet nedávných souborů")}>
                <input type="number" min={4} max={30} value={draft.recentLimit} onChange={(e) => set("recentLimit", Number(e.target.value))} className={inputCls} />
              </Field>
              <p className="mt-4 rounded bg-[#eef2f6] p-3 text-[12px] leading-relaxed text-[#4a5664]">
                {tr("Modely se ukládají jako soubory")}{" "}<code>.mncad</code> {tr("(otevřený JSON) do vašeho počítače. Pro výměnu s jinými CAD použijte STEP AP214 – otevře ho ZW3D, SolidWorks, Inventor, CATIA, NX, Creo i SolidEdge.")}
              </p>
            </>
          )}

          {tab === "keys" && (
            <>
              <p className="mb-2 text-[12px] text-[#6b7785]">{tr("Klikněte na zkratku a stiskněte novou kombinaci. Esc zruší záznam.")}</p>
              <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee]">
                {Object.keys(DEFAULT_SHORTCUTS).map((id) => (
                  <div key={id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
                    <span className="flex-1">{tr(SHORTCUT_LABELS[id] ?? id)}</span>
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
                      {recording === id ? tr("stiskněte…") : <Kbd k={draft.shortcuts[id] ?? DEFAULT_SHORTCUTS[id]} />}
                    </button>
                    {draft.shortcuts[id] !== DEFAULT_SHORTCUTS[id] && (
                      <button type="button" title={tr("Výchozí")} onClick={() => set("shortcuts", { ...draft.shortcuts, [id]: DEFAULT_SHORTCUTS[id] })} className="text-[#8a95a3] hover:text-brand">
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

/** Režim ukládání rozpracované práce (ochrana dokumentace / NDA) – mění se okamžitě, nezávisle na tlačítku OK. */
function StorageSettings() {
  const [mode, setMode] = useLocalState<"none" | "encrypted">("none");
  const [unlocked, setUnlocked] = useLocalState(false);
  const [pass, setPass] = useLocalState("");
  const [pass2, setPass2] = useLocalState("");
  const [msg, setMsg] = useLocalState<string | null>(null);
  const refresh = () => {
    setMode(persistMode());
    setUnlocked(isUnlocked());
  };
  useEffect(() => {
    refresh();
    window.addEventListener(VAULT_EVENT, refresh);
    return () => window.removeEventListener(VAULT_EVENT, refresh);
  }, []);
  const enable = async () => {
    if (pass.length < 4) return setMsg(tr("Heslo musí mít alespoň 4 znaky."));
    if (pass !== pass2) return setMsg(tr("Hesla se neshodují."));
    await enableEncrypted(pass);
    setPass("");
    setPass2("");
    setMsg(tr("Šifrované úložiště je zapnuté a odemčené. Heslo si zapamatujte – bez něj data nelze obnovit."));
    notifyVault();
  };
  const disable = () => {
    if (!window.confirm(tr("Vypnout úložiště a smazat všechny dokumenty uložené v tomto prohlížeči?"))) return;
    disableEncrypted();
    setMsg(tr("Úložiště vypnuto, uložené dokumenty smazány."));
    notifyVault();
  };
  const tryUnlock = async () => {
    if (await unlock(pass)) {
      setPass("");
      setMsg(null);
      notifyVault();
    } else setMsg(tr("Nesprávné heslo."));
  };
  const wipe = () => {
    if (!window.confirm(tr("Smazat všechny dokumenty uložené v tomto prohlížeči? Nastavení zůstane."))) return;
    wipeStoredDocuments();
    setMsg(tr("Uložené dokumenty byly smazány."));
    notifyVault();
  };
  return (
    <div className="space-y-3 rounded-lg border border-[#d5dbe2] bg-white p-3">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Rozpracovaná práce v prohlížeči (ochrana dokumentace)")}</p>
      <p className="text-[12px] leading-relaxed text-[#4a5664]">
        <strong>{tr("Výchozí: neukládat.")}</strong> {tr("Modely a výkresy zůstávají jen v otevřené kartě a v souborech, které si sami uložíte do počítače. Po zavření karty v prohlížeči nic nezůstane – vhodné pro dokumentaci pod NDA i na sdílených počítačích.")}
      </p>
      {mode === "none" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-[#4a5664]">{tr("Volitelně lze zapnout")}{" "}<strong>{tr("šifrované úložiště s heslem")}</strong> {tr("(AES-256): nedávné soubory, záložky a rozpracovaný model se uloží v tomto prohlížeči tak, že je bez hesla nikdo nepřečte.")}</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={tr("Nové heslo (min. 4 znaky)")} aria-label={tr("Nové heslo")} className="rounded border border-[#cfd6de] px-2 py-1.5 text-[13px] outline-none focus:border-brand" />
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder={tr("Heslo znovu")} aria-label={tr("Heslo znovu")} className="rounded border border-[#cfd6de] px-2 py-1.5 text-[13px] outline-none focus:border-brand" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void enable()} className="rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600">
              {tr("Zapnout šifrované úložiště")}
            </button>
            <button type="button" onClick={wipe} className="rounded border border-[#cfd6de] px-3 py-1.5 text-[12.5px] hover:bg-[#f3f6f9]">
              {tr("Vymazat vše uložené v prohlížeči")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-[#4a5664]">
            {tr("Šifrované úložiště je")}{" "}<strong>{tr("zapnuté")}</strong> · {unlocked ? tr("odemčeno pro tuto kartu") : tr("zamčeno")}.
          </p>
          {!unlocked && (
            <div className="flex gap-2">
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void tryUnlock()} placeholder={tr("Heslo úložiště")} aria-label={tr("Heslo úložiště")} className="min-w-0 flex-1 rounded border border-[#cfd6de] px-2 py-1.5 text-[13px] outline-none focus:border-brand" />
              <button type="button" onClick={() => void tryUnlock()} className="rounded bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600">
                {tr("Odemknout")}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {unlocked && (
              <button type="button" onClick={() => { lock(); notifyVault(); }} className="rounded border border-[#cfd6de] px-3 py-1.5 text-[12.5px] hover:bg-[#f3f6f9]">
                {tr("Zamknout (do zavření karty)")}
              </button>
            )}
            <button type="button" onClick={disable} className="rounded border border-brand/40 px-3 py-1.5 text-[12.5px] text-brand hover:bg-brand/5">
              {tr("Vypnout a smazat uložené")}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-[12px] text-[#1f2933]">{msg}</p>}
    </div>
  );
}
