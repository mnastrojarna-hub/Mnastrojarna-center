#!/usr/bin/env node
/**
 * Srovnávací měření rychlosti dvou verzí CLI `mncad` na STEJNÝCH skriptech a STEJNÉM stroji (vlna 22 kolo 7, bod 23 –
 * „bez stejného srovnávacího testu nelze tvrdit, že je nová verze rychlejší“).
 *
 *   node scripts/cad-bench-compare.mjs --old <mncad.mjs> --new <mncad.mjs> [--runs 3] <skript.txt> [skript.txt…]
 *
 * Každý skript se pustí střídavě starou a novou verzí (`--runs` kol, pořadí verzí se v každém kole prohodí, aby zahřátí disku
 * a mezipaměti nezvýhodnilo jednu stranu). Měří se čas celého procesu (načtení jádra WASM + běh) a čas běhu `t=` z hlavičky
 * MNCAD/1. Výstup: řádek na skript s mediány a poměrem nová/stará, a příznak `same=1|0`, zda obě verze daly stejnou hlavičku
 * (počet řádků, operací, chyb a varování; počet ℹ poznámek se jen vypíše – nová verze hlásí víc informací, práce je táž). Při
 * `same=0` čísla nejsou srovnatelná (verze dělají něco jiného) – skript to napíše a do souhrnu ho nezapočítá. Nic se netvrdí obecně: výsledek platí jen pro uvedené skripty, stroj a zátěž v době měření.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const oldCli = opt("--old");
const newCli = opt("--new");
const runs = Math.max(1, Number(opt("--runs", "3")) || 3);
if (!oldCli || !newCli || !args.length) {
  console.error("použití: node scripts/cad-bench-compare.mjs --old <mncad.mjs> --new <mncad.mjs> [--runs 3] <skript.txt>…");
  process.exit(2);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** hlavička bez času: MNCAD/1 OK lines=… ops=… err=… warn=… note=… */
const head = (out) => out.split("\n").find((l) => l.startsWith("MNCAD/1 ")) ?? "";
const headOf = (out) => head(out).replace(/ note=\d+/, "").replace(/ t=[\d.]+$/, "");
const notesOf = (out) => /note=(\d+)/.exec(head(out))?.[1] ?? "?";
const tOf = (out) => Number(/ t=([\d.]+)$/m.exec(out.split("\n").find((l) => l.startsWith("MNCAD/1 ")) ?? "")?.[1] ?? NaN);

function once(cli, script) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [cli, "run", script], { encoding: "utf8", maxBuffer: 64 << 20 });
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = r.stdout ?? "";
  return { wall, t: tOf(out), head: headOf(out), notes: notesOf(out), code: r.status };
}

const ver = (cli) => path.basename(path.dirname(path.resolve(cli)));
console.log(`# srovnání mncad ${ver(oldCli)} (stará) × ${ver(newCli)} (nová) · ${runs} kola · node ${process.version} · ${new Date().toISOString()}`);
let sumOld = 0;
let sumNew = 0;
let comparable = 0;
for (const script of args) {
  if (!fs.existsSync(script)) {
    console.log(`${script}: soubor neexistuje`);
    continue;
  }
  const o = [];
  const n = [];
  for (let k = 0; k < runs; k++) {
    if (k % 2) {
      n.push(once(newCli, script));
      o.push(once(oldCli, script));
    } else {
      o.push(once(oldCli, script));
      n.push(once(newCli, script));
    }
  }
  const same = o[0].head === n[0].head && o[0].head !== "";
  const mo = median(o.map((x) => x.wall));
  const mn = median(n.map((x) => x.wall));
  const to = median(o.map((x) => x.t));
  const tn = median(n.map((x) => x.t));
  const name = path.basename(script);
  console.log(`${name}: wall old=${mo.toFixed(0)}ms new=${mn.toFixed(0)}ms ratio=${(mn / mo).toFixed(2)} · t old=${to}s new=${tn}s · note old=${o[0].notes} new=${n[0].notes} · same=${same ? 1 : 0}`);
  if (!same) console.log(`  nesrovnatelné – hlavičky se liší:\n  old: ${o[0].head}\n  new: ${n[0].head}`);
  else {
    sumOld += mo;
    sumNew += mn;
    comparable++;
  }
}
console.log(comparable ? `Σ ${comparable} srovnatelných skriptů: old=${sumOld.toFixed(0)}ms new=${sumNew.toFixed(0)}ms ratio=${(sumNew / sumOld).toFixed(2)}` : "Σ žádný srovnatelný skript");
