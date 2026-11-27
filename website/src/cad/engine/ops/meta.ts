/** `název …`, `materiál …`, `barva #hex`, `druh …` (druh položky kusovníku dílu): vlastnosti dokumentu. */
import { tr } from "../../i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { runOf } from "../run-doc";
import { coded, say, type OpHandler } from "./util";
import { supplyWord } from "../../bom-model";
import { designationNote } from "../../material-designation";

export const metaOp: OpHandler<"meta"> = async (op, ctx) => {
  const r = runOf(ctx);
  if (op.patch.supply !== undefined) {
    // druh položky kusovníku dílu (vlna 22, bod 19): vyráběný / normálie / nakupovaný + údaje; null = výchozí podle původu
    if (r.doc.kind === "assembly") throw new Error(tr("druh: v sestavě se zadává komponentě – sestava komponenta \"…\" druh vyráběný|normálie|nakupovaný"));
    const sp = Object.keys(op.patch.supply).length ? op.patch.supply : null; // {} = výchozí druh podle původu
    const { supply: _s, ...rest } = r.doc;
    void _s;
    r.doc = sp ? { ...rest, supply: sp } : rest;
    r.changed = true;
    const extra = sp ? [sp.catalog ? tr("katalog „{0}“", sp.catalog) : "", sp.vendor ? tr("výrobce „{0}“", sp.vendor) : "", sp.size ? tr("rozměr „{0}“", sp.size) : "", sp.grade ? tr("třída „{0}“", sp.grade) : ""].filter(Boolean) : [];
    say(ctx, sp?.kind ? tr("✓ druh dílu „{0}“: {1}{2}", r.doc.name, supplyWord(sp.kind), extra.length ? ` · ${extra.join(" · ")}` : "") : tr("✓ druh dílu „{0}“: výchozí podle původu", r.doc.name));
    return;
  }
  const { supply: _ignored, ...patch } = op.patch;
  void _ignored;
  r.doc = { ...r.doc, ...patch };
  r.changed = true;
  const d = r.doc;
  if (op.patch.materialName !== undefined) {
    // jedno pravidlo s komponentou sestavy a polem označení v GUI (material-designation.ts): rozpoznaná třída = ℹ, jinak ⚠
    const cls = MATERIALS.find((x) => x.id === d.material) ?? MATERIALS[0];
    const note = designationNote(op.patch.materialName, d.material);
    if (note?.code === "material.class") {
      // označení s rozpoznanou třídou: hustota podle třídy (EN AW-6082 → hliník) – ℹ material.class (5.2 č. 37)
      say(ctx, tr("✓ materiál „{0}“ = označení do razítka, třída „{1}“ ({2} g/cm³)", op.patch.materialName, cls.label, cls.density));
      coded(ctx, "material.class", { args: note.args });
    } else if (note) {
      // jen označení: hustota zůstane podle dosavadní třídy – PŘEDPOKLAD, ne ověřený výsledek: → (ℹ msg.note) + ⚠ (nikdy ✓ vedle ⚠,
      // vlna 22 kolo 6); hmotnost v měření, kusovníku i razítku z ní (5.2 č. 37)
      say(ctx, tr("→ materiál „{0}“ uložen jako označení do razítka – třída se z něj nepoznala, hustota zůstává podle třídy „{1}“ ({2} g/cm³); pro jinou hustotu zadejte: materiál {3}", op.patch.materialName, cls.label, cls.density, MATERIALS.map((x) => x.id).join("|")));
      coded(ctx, "material.density-assumed", { args: note.args });
    }
  } else if (op.patch.material !== undefined) {
    const cls = MATERIALS.find((x) => x.id === op.patch.material);
    const label = cls ? `${cls.label} (${cls.density} g/cm³)` : op.patch.material;
    // označení do razítka zůstává (jako nabídka Materiál v GUI); patří-li jiné třídě (`materiál nerez` po ČSN 11 423), hustota
    // označení odporuje → „→“ + ⚠ material.class-conflict, ne ✓ (bod 22g, kolo 7 – dřív ✓ a v razítku ocel s hustotou nerezu)
    const note = d.materialName ? designationNote(d.materialName, d.material) : null;
    if (note?.code === "material.class-conflict") {
      say(ctx, tr("→ materiál = {0} · označení „{1}“ v razítku zůstává", label, d.materialName!));
      coded(ctx, note.code, { args: note.args });
    } else if (note?.code === "material.density-assumed") {
      // neznámé označení (Hardox 400) + zadaná třída: hustota podle výslovně zadané třídy, označení zůstává
      say(ctx, tr("✓ materiál = {0} · označení „{1}“ v razítku zůstává", label, d.materialName!));
    } else say(ctx, tr("✓ materiál = {0}", label));
  } else say(ctx, `✓ ${Object.entries(op.patch).map(([k, v]) => `${k === "name" ? tr("název") : tr("barva")} = ${v}`).join(", ")}`);
};
