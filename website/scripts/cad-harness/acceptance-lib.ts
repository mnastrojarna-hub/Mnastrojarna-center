// Helpers of the B6 acceptance gate (scripts/cad-acceptance.mjs) that need the repo sources – bundled by bundle.mjs:
// * openLink – open a share link the CLI printed in plain Node with the same share.ts as the browser (the store of the
//   gate's `php -S` given explicitly) and say what the link contains;
// * the protocol grammar (engine/protocol.ts GRAMMAR / grammarKind) – the gate checks every line of the real protocol;
// * the independent STEP check (step-check.ts) – solids, free shells / faces, exact BRepCheck of the written STEP.
import { setHostAssets } from "@/cad/host-assets";
import { openShareLink, parseShareHash } from "@/cad/share";
export { GRAMMAR, grammarKind, utf8Bytes } from "@/cad/engine/protocol";
// independent STEP check (own OCCT instance, exact BRepCheck – wave 22, 22c): the gate does not trust the app's own check
export { stepCheck, stepCheckProblems, type StepCheck } from "./step-check";

export type Opened = { ok: boolean; kind: string | null; mode?: string; reason?: string; name?: string; docKind?: string; components?: number; features?: number; exp?: number | null };

export async function openLink(url: string, store: string): Promise<Opened> {
  const u = new URL(url);
  setHostAssets({ share: { page: u.origin + u.pathname.replace(/\/$/, ""), store } });
  const parsed = parseShareHash(u.hash);
  if (!parsed) return { ok: false, kind: null, reason: "unparsed" };
  const r = await openShareLink(parsed);
  if (!r.ok) return { ok: false, kind: parsed.kind, reason: r.reason };
  const doc = r.payload.doc;
  return { ok: true, kind: parsed.kind, mode: r.mode, name: doc.name, docKind: doc.kind ?? "part", components: doc.components?.length ?? 0, features: doc.features?.length ?? 0, exp: r.payload.exp ?? null };
}
