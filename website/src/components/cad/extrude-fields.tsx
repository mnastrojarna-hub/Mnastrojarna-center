"use client";
/**
 * Formulář vysunutí – úkos dovnitř / ven, břit (rovná část před úkosem), ostré rohy a výška kolmo na skicu u šikmého směru.
 * Stejné volby jako text: `vysunout skrz odebrat úkos 2 ven břit 3 [ostré rohy]`, `vysunout výška 20 sklon 25 k +X`.
 * Uložený úhel má znaménko (+ dovnitř, − ven); pole ukazuje velikost a přepínač směr (vazba na proměnnou zachová znaménko).
 * Nově zapnutý úkos dostane ostré rohy (jako text); starší prvky bez `draftCorners` zůstanou se zaoblenými rohy.
 */
import { useState } from "react";
import { tr } from "@/cad/i18n";
import type { Feature } from "@/cad/types";
import { Check, Info, Num, Seg } from "./props";

type ExtrudeF = Extract<Feature, { type: "extrude" }>;

export function ExtrudeDraftFields({ f, set, bind }: { f: ExtrudeF; set: (patch: Partial<ExtrudeF>) => void; bind: (path: string) => string }) {
  const a = f.draftAngle ?? 0;
  const [pref, setPref] = useState<1 | -1>(1);
  const sign: 1 | -1 = a > 0 ? 1 : a < 0 ? -1 : pref;
  return (
    <div className="space-y-2" data-extrude-draft>
      <div className="grid grid-cols-2 gap-2">
        <Num
          label={tr("Úkos")}
          value={Math.abs(a)}
          suffix="°"
          hint={tr("0 = bez úkosu")}
          bind={bind("draftAngle")}
          bindFactor={sign}
          onChange={(v) => {
            // záporné číslo = ven (jako text „úkos -2“ a JSON draftAngle −2); přepínač se přepne, pole ukáže velikost
            const s: 1 | -1 = v < 0 ? -1 : sign;
            if (v < 0) setPref(-1);
            const m = Math.min(44, Math.abs(v));
            set({ draftAngle: m > 0 ? s * m : 0, ...(!a && m > 0 && !f.draftCorners ? { draftCorners: "sharp" as const } : {}) });
          }}
        />
        <Seg
          label={tr("Úkos obrysu")}
          value={sign > 0 ? "in" : "out"}
          options={[
            { v: "in", l: tr("Dovnitř") },
            { v: "out", l: tr("Ven") },
          ]}
          onChange={(v) => {
            const s = v === "in" ? 1 : -1;
            setPref(s);
            if (a && Math.sign(a) !== s) set({ draftAngle: -a });
          }}
        />
      </div>
      {a !== 0 && (
        <>
          <Info>{sign > 0 ? tr("Dovnitř: vnější obrys se od roviny skici zužuje, otvory v profilu se rozšiřují (u odebrání se otvor do hloubky zužuje).") : tr("Ven: vnější obrys se od roviny skici rozšiřuje, otvory v profilu se zužují – u odebrání se otvor do hloubky rozšiřuje (odlehčení střižnice za břitem).")}</Info>
          <Num label={tr("Břit (rovná část)")} value={f.draftLand ?? 0} min={0} hint={tr("kolmo od roviny skici, pak začne úkos")} bind={bind("draftLand")} onChange={(v) => set({ draftLand: v > 0 ? v : undefined })} />
          <Check label={tr("Ostré rohy (jinak zaoblené)")} value={f.draftCorners === "sharp"} onChange={(on) => set({ draftCorners: on ? "sharp" : "round" })} />
        </>
      )}
    </div>
  );
}

/** u šikmého směru: vzdálenost kolmo na skicu (text „výška 20“) místo délky podél směru */
export function ExtrudeHeightCheck({ f, set }: { f: ExtrudeF; set: (patch: Partial<ExtrudeF>) => void }) {
  if (!f.dir || f.dir.kind === "normal") return null;
  return <Check label={tr("Vzdálenost kolmo na skicu (výška), ne podél směru")} value={!!f.normalHeight} onChange={(on) => set({ normalHeight: on || undefined })} />;
}
