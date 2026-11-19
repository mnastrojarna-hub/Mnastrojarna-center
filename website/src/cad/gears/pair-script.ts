/**
 * Soukolí → existující textové příkazy (žádná nová operace): dva díly s prvkem ozubení, sestava, vložení obou komponent
 * a vazba Ozubení / Hřeben. GUI skript spustí přes `runText`, textový příkaz `soukolí` ho znovu rozebere.
 */
import { fmt } from "./common";
import { kindOfExt } from "./registry";
import type { GearData, Lang, PairResult, PairWheel } from "./types";

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
const n6 = (v: number) => fmt(v, 6);

/** `klíč=hodnota` jen pro klíče, které se liší od výchozích hodnot druhu */
export function gearKeyValues(ext: string, data: GearData): string {
  const def = kindOfExt(ext);
  const base: GearData = def ? def.defaults() : {};
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || JSON.stringify(v) === JSON.stringify(base[k])) continue;
    if (typeof v === "number") out.push(`${k}=${n6(v)}`);
    else if (typeof v === "boolean") out.push(`${k}=${v}`);
    else if (typeof v === "string") out.push(`${k}=${/^[\w.+-]+$/.test(v) ? v : q(v)}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === "number")) out.push(`${k}=${v.map((x) => n6(x as number)).join(";")}`);
    else out.push(`${k}=${JSON.stringify(v)}`);
  }
  return out.join(" ");
}

/** název prvku kola v historii */
export function wheelFeatureName(w: PairWheel): string {
  const def = kindOfExt(w.ext);
  return def ? def.name(def.read({ ...def.defaults(), ...w.data })) : w.name;
}

/**
 * Příkazy pro vyřešené soukolí, jeden na řádek (neplatné soukolí → prázdný seznam). Příkazy jsou v češtině – rozbor textu
 * přijímá česká slova v každém jazyce rozhraní; `lang` je vyhrazeno pro budoucí lokalizované výpisy.
 */
export function pairScript(res: PairResult, lang: Lang = "cs"): string[] {
  void lang;
  if (!res.ok) return [];
  const [a, b] = res.wheels;
  const lines: string[] = [];
  for (const w of [a, b]) {
    const kv = gearKeyValues(w.ext, w.data);
    lines.push(`nový díl ${q(w.name)}`, `prvek ${w.ext}${kv ? ` ${kv}` : ""} name=${q(wheelFeatureName(w))}`);
  }
  lines.push(`nová sestava ${q(res.asmName)}`);
  res.wheels.forEach((w, i) => {
    const p = res.placement[i];
    const rot = p.rot.some((v) => Math.abs(v) > 1e-9) ? ` otočení ${p.rot.map(n6).join(" ")}` : "";
    lines.push(`vložit ${q(w.name)} v ${p.at.map(n6).join(" ")}${rot}`);
  });
  const m = res.mate;
  // bez díry („Ø0“ nebo prázdná plocha) by vazba skončila chybou „nic neodpovídá“ – sestava pak zůstane bez vazby
  const usable = (f: string) => !!f && !/^Ø0(?:[.,]0*)?$/.test(f);
  if (usable(m.faceA) && usable(m.faceB)) {
    if (m.kind === "rack") lines.push(`sestava vazba hřeben ${q(a.name)} ${m.faceA} ${q(b.name)} ${m.faceB} modul ${n6(m.module ?? 1)} zuby ${m.teeth?.[0] ?? 1}`);
    else lines.push(`sestava vazba ozubení ${q(a.name)} ${m.faceA} ${q(b.name)} ${m.faceB} ${m.teeth ? `zuby ${m.teeth[0]} ${m.teeth[1]}` : `poměr ${n6(m.ratio ?? 1)}`}${m.flip ? " vnitřní" : ""}`);
  }
  return lines;
}
