# 5. vlna CADu – „jak nakrmit příkazy“: bohaté zadání u všech prvků

Navazuje na `CAD-PLAN-ZADANI.md` (plán) a `CAD-ROADMAP.md` (stav). **Jádro referenčního systému je hotové** (commit
„CAD: referenční systém zadání…“): `src/cad/refs.ts` (typy Ref / Extent / Direction / StartFrom / Thin / AxisDef /
PlaneDef), `src/cad/ref-resolve.ts` (řešič ve workeru), `src/components/cad/ref-field.tsx` (pole odkazu a složená pole),
vysunutí / rotace / díra / roviny už vše používají. Tato vlna rozšiřuje **zbytek prvků** – paralelně, bez konfliktů.

## Pravidla pro všechny agenty (povinné)

1. **Vlastnictví souborů.** Pracuj jen v souborech, které máš přidělené (níže). Sdílené soubory (`types.ts`, `build.ts`,
   `props.tsx`, `cad-app.tsx`, `defaults.ts`, `ribbon.tsx`, `viewport.tsx`) **needituj vůbec** – pokud to opravdu
   nejde jinak, jen nástrojem Edit v nejmenším možném místě (nikdy Write/přepis celého souboru, nikdy přeformátování).
   Nové volitelné položky do `Feature` v `types.ts` smíš doplnit jen do řádku svého typu prvku (Edit).
2. **Registry místo zásahů.** Stavbu prvku převezmi přes `registerFeatureBuilder(type, fn)` z `src/cad/feat/registry.ts`
   (stavitel vrací NOVÉ TĚLESO; `null` = beze změny). Formulář převezmi přes `registerFeatureForm(type, render)` z
   `src/components/cad/forms/registry.tsx`. Tvůj modul už je importovaný v `src/cad/feat/index.ts` a
   `src/components/cad/forms/index.tsx` – jen naplň připravený soubor (stub s `export {}`).
3. **Pomocné funkce jádra** (`src/cad/build.ts` exportuje): `sketchDrawing(sk, outerOnly)`, `sketchWires(sk, plane)`,
   `profileSketch(sk, plane, {outerOnly, thin}, shift)`, `thinDrawing(d, thin)`, `sketchPathWire(sk)`, `sketchChain(sk)`,
   `applyMode(body, tool, mode)`, `combine(parts)`, `solidsOf(s)`, `nearestSolid(parts, o, d)`, `needSketch(ctx, id)`,
   `axisPlane(name, offset)`, `bboxDiag(s)`, `edgeFilter(body, edges)`, `planeOf(sketchPlane)`.
   Řešič odkazů (`src/cad/ref-resolve.ts`): `resolveRef(ctx, ref) → {point, dir, plane, radius}`, `pointOf`, `dirOf`,
   `planeOfRef`, `resolveDirection(ctx, dir, {normal, xDir})`, `resolveAxis(ctx, axisDef, sketch, fallback)`,
   `resolvePlaneDef(ctx, def)`, `entityIndex(body, kind, index, sig)` (odkaz s otiskem – přežije změnu indexů), vektory `V`.
   Kontext: `{ body, sketches, features }` – ve stavitelích ho máš v `FeatCtx` (`body, sketches, features, tools, index, doc`).
4. **UI pole** (`src/components/cad/ref-field.tsx`): `RefField` (want: point | vertex | edge | face | plane | axis),
   `RefListField`, `ExtentField`, `DirectionField`, `StartField`, `ThinField`, `AxisField`, `PlaneDefField`.
   Z `props.tsx` jsou exportované `Num, Vec, Seg, Check, Field, Info, Details, SketchPick, PickInfo, selectCls, AXES,
   AXIS_PLANES`. Výběr hran/ploch klikem u prvku funguje přes `edges` / `faces` (jako dnes) – pole odkazu pro ostatní.
5. **Jazyk a styl.** Vše v UI česky (odborně, stručně), kód a komentáře v duchu stávajícího kódu (TS strict, bez `any`
   mimo OCCT shim, Tailwind). Žádné názvy AI modelů v kódu ani commitech.
6. **Kontroly.** Průběžně: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <tvé soubory>`, `npx vitest run <tvůj test>`.
   **Nespouštěj `next dev` ani `next build`** (sdílený `.next` by se rozbil ostatním) – e2e v prohlížeči dělá vedoucí.
   OCCT v testech: viz hlavička `src/cad/refs.test.ts` (beforeAll s `replicad_single.wasm`).
7. **Commity.** Každých ~30–45 min práce (a vždy před odevzdáním) commitni **jen své soubory**:
   `git add <cesty> && git commit -m "CAD: … (5. vlna, <modul>)"` s trailery
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` a
   `Claude-Session: https://claude.ai/code/session_01M3e4nZkkRBPkssXsU3jsou`.
   Nikdy `git add -A`, nikdy push, nikdy rebase/reset. Narazíš-li na `index.lock`, počkej 2 s a zopakuj.
8. **Odevzdání.** Závěrečná zpráva: co je hotové (seznam způsobů zadání / variant), co je přibližné nebo chybí a proč,
   které soubory jsi změnil, jak to otestovat (názvy testů), a poznámky pro `CAD-ROADMAP.md`.
9. **Priorita = počet skutečně fungujících způsobů zadání.** Raději 8 variant ověřených testem než 15 napůl.
   Každá varianta musí mít test ve vitest (objem / bbox / počet ploch) a srozumitelnou českou chybovou hlášku při
   špatném zadání.

## Rozdělení (5 agentů)

| Agent | Modul | Soubory (výhradně) |
| --- | --- | --- |
| **W5-A** | Zaoblení a zkosení | `src/cad/feat/fillet.ts`, `src/cad/feat/fillet.test.ts`, `src/components/cad/forms/fillet-form.tsx` |
| **W5-B** | Pole, skořepina, úkos | `src/cad/feat/pattern.ts`, `src/cad/feat/pattern.test.ts`, `src/components/cad/forms/pattern-form.tsx` |
| **W5-C** | Tažení a šablonování | `src/cad/feat/sweep-loft.ts`, `src/cad/feat/sweep-loft.test.ts`, `src/components/cad/forms/sweep-loft-form.tsx` |
| **W5-D** | Skica: zadání, auto-vazby, nástroje | `src/components/cad/sketcher.tsx`, `src/cad/sketch.ts`, `src/cad/sketch-solver.ts`, `src/cad/sketch*.test.ts` |
| **W5-E** | Odkazy ve zbývajících prvcích + pomocné osy/body/CSYS + výběr ze seznamu | `src/cad/feat/refs-more.ts`, `src/cad/feat/refs-more.test.ts`, `src/components/cad/forms/more-forms.tsx`, `src/components/cad/pick-list.tsx` |

Datový model pro A/B/C je už v `types.ts` připravený (volitelná pole u `fillet`, `chamfer`, `shell`, `pattern`
(druhy `curve` / `sketch` / `fill`), `sweep`, `loft`, `draft`). Chybí-li ti pole, přidej ho Editem jen do svého typu.
