/** `název …`, `materiál …`, `barva #hex`, `druh …` (druh položky kusovníku dílu): vlastnosti dokumentu. */
import { tr } from "../../i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { runOf } from "../run-doc";
import { coded, say, type OpHandler } from "./util";
import { supplyWord } from "../../bom-model";

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
    const cls = MATERIALS.find((x) => x.id === d.material) ?? MATERIALS[0];
    if (op.patch.material !== undefined) {
      // označení s rozpoznanou třídou: hustota podle třídy (EN AW-6082 → hliník) – ℹ material.class (5.2 č. 37)
      say(ctx, tr("✓ materiál „{0}“ = označení do razítka, třída „{1}“ ({2} g/cm³)", op.patch.materialName, cls.label, cls.density));
      coded(ctx, "material.class", { args: [op.patch.materialName, `${cls.label} (${cls.density} g/cm³)`] });
    } else {
      // jen označení: hustota zůstane podle dosavadní třídy – hmotnost v měření, kusovníku i razítku z ní (⚠, 5.2 č. 37)
      say(ctx, tr("✓ materiál „{0}“ = označení do razítka; hustota zůstává podle třídy „{1}“ ({2} g/cm³) – pro jinou hustotu zadejte: materiál {3}", op.patch.materialName, cls.label, cls.density, MATERIALS.map((x) => x.id).join("|")));
      coded(ctx, "material.density-assumed", { args: [op.patch.materialName, cls.density, cls.label] });
    }
  } else if (op.patch.material !== undefined) {
    const cls = MATERIALS.find((x) => x.id === op.patch.material);
    say(ctx, tr("✓ materiál = {0}", cls ? `${cls.label} (${cls.density} g/cm³)` : op.patch.material));
  } else say(ctx, `✓ ${Object.entries(op.patch).map(([k, v]) => `${k === "name" ? tr("název") : tr("barva")} = ${v}`).join(", ")}`);
};
