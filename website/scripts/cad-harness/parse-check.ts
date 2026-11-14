// Parses a harness script with the CAD text parser (no kernel) and prints {lines, ops, errors} as JSON on stdout.
// Bundled by harness.test.mjs: every line of synth-959.txt must parse; the only tolerated error is `kontrola`
// (package B5 check-compare adds the command).
import fs from "node:fs";
import { parseAgentText } from "@/cad/agent";

const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const prog = parseAgentText(text);
const kinds: Record<string, number> = {};
for (const op of prog.ops) kinds[op.k] = (kinds[op.k] ?? 0) + 1;
process.stdout.write(`${JSON.stringify({ lines: text.trimEnd().split("\n").length, ops: prog.ops.length, kinds, errors: prog.errors.map((e) => ({ line: e.line, text: e.text, message: e.message.slice(0, 120) })) })}\n`);
