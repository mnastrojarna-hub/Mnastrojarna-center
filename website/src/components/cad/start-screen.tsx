"use client";

import { useState } from "react";
import { loadRecent, removeRecent, type RecentDoc } from "@/cad/settings";
import { cn } from "@/lib/cn";
import { LogoMark } from "../logo";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";
import { Kbd } from "./ui";

type Action = { id: string; label: string; desc: string; icon: CadIconName; tone: Tone; run: () => void; kbd?: string };

/** Úvodní obrazovka (jako Start Page v ZW3D / Inventoru): šablony, nedávné soubory, ukázky. */
export function StartScreen({
  actions,
  examples,
  onOpenRecent,
  onClose,
  onDisable,
}: {
  actions: Action[];
  examples: { id: string; label: string; run: () => void }[];
  onOpenRecent: (r: RecentDoc) => void;
  onClose: () => void;
  onDisable: () => void;
}) {
  const [recent, setRecent] = useState<RecentDoc[]>(() => loadRecent());
  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-[#eef1f5] text-[#1f2933]">
      <header className="flex h-12 shrink-0 items-center gap-3 bg-gradient-to-b from-[#262b31] to-[#1c2025] px-5 text-white">
        <LogoMark className="h-7 w-7" />
        <span className="font-display text-[15px] font-bold uppercase tracking-tight">
          Mnástrojárna <span className="text-brand">CAD</span>
        </span>
        <span className="hidden text-[12px] text-white/50 sm:inline">· parametrický 3D/2D CAD · díly · sestavy · výkresy · formy</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded border border-white/20 px-3 py-1 text-[12px] hover:bg-white/10">
          Pokračovat v práci <Kbd k="Esc" />
        </button>
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 overflow-y-auto p-6 lg:grid-cols-[1fr_380px] lg:p-10">
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b7785]">Začít</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={a.run}
                className="group flex items-start gap-3 rounded-lg border border-[#d5dbe2] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#f3f6f9] group-hover:bg-brand/10">
                  <CadIcon name={a.icon} tone={a.tone} className="h-7 w-7" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{a.label}</span>
                  <span className="block text-[11.5px] leading-snug text-[#6b7785]">{a.desc}</span>
                  {a.kbd && (
                    <span className="mt-1 block">
                      <Kbd k={a.kbd} />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b7785]">Ukázkové modely</h2>
          <div className="flex flex-wrap gap-2">
            {examples.map((e) => (
              <button key={e.id} type="button" onClick={e.run} className="rounded-full border border-[#d5dbe2] bg-white px-3.5 py-1.5 text-[12.5px] hover:border-brand hover:text-brand">
                {e.label}
              </button>
            ))}
          </div>

          <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b7785]">Tipy</h2>
          <ul className="grid gap-2 text-[12.5px] text-[#3c4856] sm:grid-cols-2">
            <li className="rounded-md border border-[#e3e8ee] bg-white p-3">
              <Kbd k="Ctrl+K" /> otevře paletu příkazů – napište „díra“, „výkres“, „zaoblit“…
            </li>
            <li className="rounded-md border border-[#e3e8ee] bg-white p-3">Pravé tlačítko na plochu, hranu, bod nebo komponentu otevře nabídku s úpravami pro danou entitu.</li>
            <li className="rounded-md border border-[#e3e8ee] bg-white p-3">Do každého číselného pole lze psát výrazy (<code>25/2</code>) i vazby na proměnné (<code>=d1*2</code>).</li>
            <li className="rounded-md border border-[#e3e8ee] bg-white p-3">Výkres z modelu: karta Výkres → Nový výkres. Kusovník se přidá automaticky u sestav.</li>
          </ul>
        </section>

        <aside>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b7785]">Nedávné</h2>
          {recent.length === 0 && <p className="rounded-md border border-dashed border-[#cdd5de] bg-white/60 p-4 text-[12.5px] text-[#6b7785]">Zatím žádné soubory. Vše, co uložíte nebo otevřete, se objeví tady.</p>}
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li key={r.id} className="group flex items-center gap-3 rounded-md border border-[#e3e8ee] bg-white p-2 hover:border-brand/40">
                <button type="button" onClick={() => onOpenRecent(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="grid h-10 w-12 shrink-0 place-items-center overflow-hidden rounded bg-[#f3f6f9]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL náhledu z canvasu */}
                    {r.thumb ? <img src={r.thumb} alt="" className="h-full w-full object-cover" /> : <CadIcon name={r.kind === "assembly" ? "layers" : "cube"} tone="create" className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{r.name}</span>
                    <span className="block text-[11px] text-[#8a95a3]">
                      {r.kind === "assembly" ? "Sestava" : "Díl"} · {r.features} {r.kind === "assembly" ? "komp." : "prvků"} · {new Date(r.at).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  title="Odebrat ze seznamu"
                  onClick={() => {
                    removeRecent(r.id);
                    setRecent(loadRecent());
                  }}
                  className="hidden rounded p-1 text-[#8a95a3] hover:text-brand group-hover:block"
                >
                  <CadIcon name="x" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <label className={cn("mt-6 flex cursor-pointer items-center gap-2 text-[12px] text-[#6b7785]")}>
            <input type="checkbox" className="accent-[#E03930]" onChange={(e) => e.target.checked && onDisable()} />
            Nezobrazovat při spuštění (lze zapnout v Nastavení)
          </label>
        </aside>
      </div>
    </div>
  );
}
