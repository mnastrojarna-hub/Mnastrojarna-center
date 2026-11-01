import path from "node:path";
import { beforeAll, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { GEARS2 } from "./gears2";
import { defaults } from "./types";
beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60000);
it("timing", async () => {
  for (const f of GEARS2) {
    const doc = f.make(defaults(f));
    const t0 = Date.now();
    const res = await buildDoc(doc);
    require("node:fs").appendFileSync("/tmp/claude-0/libtime.txt", [f.id, Date.now() - t0, "ms vol", res.metrics?.volume?.toFixed(0), "faces", res.metrics?.faces, JSON.stringify(res.status.filter((s) => !s.ok).map((s) => doc.features.find((x) => x.id === s.id)?.name + ": " + s.error))].join(" ") + "\n");
  }
}, 120000);
