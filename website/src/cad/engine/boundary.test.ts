/**
 * Hranice enginu (CAD-HEADLESS-NAVRH.md 2.2): ESLint pravidlo v `.eslintrc.json` pro `src/cad/engine/**` a `src/cad/cli/**`
 * (všechny přípony skriptů) zakazuje React, Next.js, UI komponenty a `@/lib/save-file`; klient jádra `client.ts` smí jen
 * jako `import type`. Statické importy hlídá `@typescript-eslint/no-restricted-imports`, `import()` a `require()`
 * `no-restricted-syntax`.
 *
 * Protože ESLint porovnává jen zápis specifikátoru, druhý test prochází skutečný graf modulů: importy hodnot (ne
 * `import type`) ze všech souborů enginu a CLI, přeložené stejně jako `tsc` (moduleResolution bundler, alias `@/`), a to
 * tranzitivně přes celé `src/`. Žádný dosažený modul nesmí být `src/cad/client.ts`, `src/lib/save-file.ts`,
 * `src/components/**` ani balík React / Next.js – bez ohledu na to, jak je import zapsaný (`../client.js`, `@/cad/client.js`…).
 */
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const RULES = ["@typescript-eslint/no-restricted-imports", "no-restricted-syntax"];
const eslint = new ESLint({ cwd: ROOT });

async function boundaryErrors(code: string, file = "src/cad/engine/__probe__.ts"): Promise<string[]> {
  const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return res.messages.filter((m) => m.ruleId && RULES.includes(m.ruleId)).map((m) => m.message);
}

describe("ESLint hranice enginu a CLI", () => {
  const cases: [string, boolean][] = [
    [`import { cad } from "@/cad/client";\nvoid cad;`, false],
    [`import { cad } from "../client";\nvoid cad;`, false],
    [`import { cad } from "../client.js";\nvoid cad;`, false],
    [`import { cad } from "@/cad/client.js";\nvoid cad;`, false],
    [`import { cad } from "../../cad/client.ts";\nvoid cad;`, false],
    [`import * as c from "../../client";\nvoid c;`, false],
    [`export { cad } from "../client";`, false],
    [`import "../client";`, false],
    [`import x = require("../client");\nvoid x;`, false],
    [`const m = await import("../client");\nvoid m;`, false],
    [`const m = await import("@/cad/client.js");\nvoid m;`, false],
    [`const m = await import("react");\nvoid m;`, false],
    [`import type { cad } from "@/cad/client";\nexport type K = typeof cad;`, true],
    [`import type { cad } from "../client.js";\nexport type K = typeof cad;`, true],
    [`import { type cad } from "../client";\nexport type K = typeof cad;`, true],
    [`import { type cad, cadReady } from "../client";\nvoid cadReady;`, false],
    [`import { useState } from "react";\nvoid useState;`, false],
    [`import { createRoot } from "react-dom/client";\nvoid createRoot;`, false],
    [`import Link from "next/link";\nvoid Link;`, false],
    [`import env from "@next/env";\nvoid env;`, false],
    [`import { x } from "@/components/cad/cad-app";\nvoid x;`, false],
    [`import { x } from "../../components/cad/agent-api-host";\nvoid x;`, false],
    [`const m = await import("../../components/cad/cad-app");\nvoid m;`, false],
    [`import { writeSaved } from "@/lib/save-file";\nvoid writeSaved;`, false],
    [`import { writeSaved } from "../../lib/save-file.js";\nvoid writeSaved;`, false],
    [`import { tr } from "../i18n";\nimport { internBlobs } from "../blobs";\nvoid tr; void internBlobs;`, true],
    [`const m = await import("../i18n");\nvoid m;`, true],
    [`import { MATERIALS } from "@/lib/mesh-metrics";\nvoid MATERIALS;`, true],
  ];
  for (const [code, ok] of cases) {
    it(`${ok ? "povoleno" : "zakázáno"}: ${code.split("\n")[0]}`, async () => {
      const errs = await boundaryErrors(code);
      if (ok) expect(errs).toEqual([]);
      else expect(errs.length).toBeGreaterThan(0);
    });
  }
  it("platí pro všechny přípony skriptů v src/cad/engine/** a src/cad/cli/**, neplatí mimo engine a CLI", async () => {
    for (const f of ["src/cad/engine/__probe__.tsx", "src/cad/engine/ops/__probe__.mts", "src/cad/cli/__probe__.ts", "src/cad/cli/__probe__.mjs", "src/cad/cli/__probe__.js"]) {
      expect((await boundaryErrors(`import { cad } from "../client";\nvoid cad;`, f)).length, f).toBe(1);
      expect((await boundaryErrors(`import { useState } from "react";\nvoid useState;`, f)).length, f).toBe(1);
    }
    expect((await boundaryErrors(`const c = require("../client");\nvoid c;`, "src/cad/cli/__probe__.cjs")).length).toBe(1);
    expect(await boundaryErrors(`import { cad } from "./client";\nvoid cad;`, "src/cad/__probe__.ts")).toEqual([]);
    expect(await boundaryErrors(`import { useState } from "react";\nvoid useState;`, "src/components/cad/__probe__.ts")).toEqual([]);
  });
  it("soubory enginu projdou celou konfigurací lintu bez chyb a varování", async () => {
    const res = await eslint.lintFiles(["src/cad/engine/**/*.ts"]);
    expect(res.length).toBeGreaterThanOrEqual(10);
    const msgs = res.flatMap((r) => r.messages.map((m) => `${path.relative(ROOT, r.filePath)}:${m.line} ${m.ruleId} ${m.message}`));
    expect(msgs).toEqual([]);
  });
});

/* ───────────────────────── skutečný graf modulů (TypeScript) ───────────────────────── */

const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const OPTIONS = parsed!.options;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

/** specifikátory importů HODNOT (bez `import type` a importů jen s `type` specifikátory): statické, re-exporty, `import x = require()`, `import()`, `require()` */
function valueImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const allType = (els: readonly { isTypeOnly: boolean }[]) => els.length > 0 && els.every((e) => e.isTypeOnly);
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && allType(c.namedBindings.elements)));
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const typeOnly = n.isTypeOnly || (!!n.exportClause && ts.isNamedExports(n.exportClause) && allType(n.exportClause.elements));
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(n) && !n.isTypeOnly && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      out.push(n.moduleReference.expression.text);
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const FORBIDDEN_FILES = [path.join(SRC, "cad/client.ts"), path.join(SRC, "lib/save-file.ts")];
function forbidden(spec: string, target: string | undefined): boolean {
  if (/^(react|react-dom|next)(\/|$)|^@next\//.test(spec)) return true;
  if (!target) return false;
  return FORBIDDEN_FILES.includes(target) || target.startsWith(path.join(SRC, "components") + path.sep);
}

/** tranzitivní uzávěr importů hodnot od `roots` přes `src/` (soubor → text; bez textu se čte z disku) */
function valueClosure(roots: { file: string; text?: string }[]) {
  const seen = new Set<string>();
  const bad: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const { file, text } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(file, text ?? fs.readFileSync(file, "utf8"))) {
      const res = ts.resolveModuleName(spec, file, OPTIONS, ts.sys).resolvedModule;
      const target = res?.resolvedFileName;
      if (forbidden(spec, target)) bad.push(`${path.relative(ROOT, file)} → ${spec}${target ? ` (${path.relative(ROOT, target)})` : ""}`);
      else if (target && !res!.isExternalLibraryImport && target.startsWith(SRC + path.sep) && SCRIPT.test(target) && !target.endsWith(".d.ts")) queue.push({ file: target });
    }
  }
  return { seen, bad };
}

function scripts(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? scripts(p) : SCRIPT.test(d.name) && !/\.test\.[cm]?[jt]sx?$/.test(d.name) ? [p] : [];
  });
}

describe("hranice enginu a CLI – skutečný graf modulů (TypeScript resolution)", () => {
  it("valueImports odliší import type od importu hodnoty", () => {
    const src = [
      `import type { cad } from "../client";`,
      `import { type cad as c2 } from "../client.js";`,
      `export type { KernelApi } from "./kernel";`,
      `import { tr, type CadLang } from "../i18n";`,
      `import "../blobs";`,
      `export * from "./codes";`,
      `const m = await import("../types");`,
      `type T = typeof import("../client");`,
      `const r = require("../draft/doc");`,
    ].join("\n");
    expect(valueImports("x.ts", src)).toEqual(["../i18n", "../blobs", "./codes", "../types", "../draft/doc"]);
  });
  it("odhalí každý zápis klienta jádra, UI, save-file a Reactu (i ty, které ESLint podle zápisu nepozná)", () => {
    const probe = path.join(SRC, "cad/engine/__probe__.ts");
    for (const spec of ["../client", "../client.js", "@/cad/client.js", "@/cad/../cad/client", "../../lib/save-file.js", "@/components/cad/cad-app", "react", "next/link", "@next/env"]) {
      for (const code of [`import { x } from "${spec}";`, `export * from "${spec}";`, `const m = import("${spec}");`, `const m = require("${spec}");`]) {
        const { bad } = valueClosure([{ file: probe, text: code }]);
        expect(bad.length, code).toBe(1);
      }
    }
    expect(valueClosure([{ file: probe, text: `import type { cad } from "../client.js";\nimport { type cad as k } from "@/cad/client.js";` }]).bad).toEqual([]);
  });
  it("engine (a CLI) nedosáhne importem hodnoty na client.ts, save-file, components ani React/Next – ani tranzitivně", () => {
    const roots = [...scripts(path.join(SRC, "cad/engine")), ...scripts(path.join(SRC, "cad/cli"))];
    expect(roots.length).toBeGreaterThanOrEqual(8);
    const { seen, bad } = valueClosure(roots.map((file) => ({ file })));
    expect(bad).toEqual([]);
    // uzávěr je skutečně tranzitivní (i18n, blobs, draft/doc, types … mimo engine)
    expect([...seen].some((f) => f.endsWith(path.join("cad", "blobs.ts")))).toBe(true);
    expect([...seen].some((f) => f.endsWith(path.join("cad", "draft", "doc.ts")))).toBe(true);
    expect(seen.has(path.join(SRC, "cad/client.ts"))).toBe(false);
  });
});
