/**
 * Úložiště sdílení na STARÉM PHP (hosting majitele: PHP 5.6.40). Dřív zavaděč index.php odmítl PHP < 7.0 („php_too_old“)
 * a store.php by se na PHP 5.6 ani nepřeložil (typy parametrů a návratových hodnot, ??). Tady:
 *   1. statická kontrola: v index.php a store.php není syntaxe ani funkce, kterou PHP 5.6 nezná (selže na starém souboru
 *      z gitu – ověřeno níže),
 *   2. `php -l` místním PHP (8.x) a PHP 5.6 z Dockeru (obraz php:5.6-cli, MN_PHP_IMAGE) – bez Dockeru / obrazu přeskočeno,
 *   3. krátké spuštění zavaděče na PHP 5.6 bez webového serveru (?ping, ?diag) – bez Dockeru přeskočeno.
 * Celá sada share-php.test.ts jde pustit proti PHP 5.6: `MN_SHARE_PHP=$PWD/scripts/php-docker.sh npx vitest run src/cad/share-php.test.ts`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../public/cad/share");
const FILES = ["index.php", "store.php"] as const;
const T = 60_000;

/** zdroj PHP bez komentářů a s prázdnými řetězci (kontrola syntaxe nesmí reagovat na text v komentářích a řetězcích) */
function phpCode(src: string): string {
  let out = "";
  let i = src.indexOf("<?php");
  i = i < 0 ? 0 : i + 5;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? src.length : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if ((c === "/" && n === "/") || c === "#") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? src.length : e;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += c + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** syntaxe a funkce PHP 7+, které PHP 5.6 nezná (jméno → vzor nad kódem bez komentářů a řetězců) */
const FORBIDDEN: [string, RegExp][] = [
  ["typ parametru (int/string/bool/float/iterable/object/self/mixed)", /function\s*&?\s*\w*\s*\([^)]*\b(?:int|string|bool|float|iterable|object|mixed)\s+&?\.{0,3}\$/i],
  ["nullable typ ?T", /[(,]\s*\?\s*[A-Za-z_\\]+\s+&?\$/],
  ["návratový typ funkce", /function\s*&?\s*\w*\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?:\s*\??[A-Za-z_\\]/i],
  ["operátor ??", /\?\?/],
  ["operátor <=>", /<=>/],
  ["declare(strict_types)", /declare\s*\(\s*strict_types/i],
  ["anonymní třída", /\bnew\s+class\b/i],
  ["skupinový use", /\buse\s+[\w\\]+\\\{/],
  ["yield from", /\byield\s+from\b/i],
  ["sjednocení typů catch (A | B)", /catch\s*\([^)]*\|/i],
  ["konstanta s polem přes define()", /\bdefine\s*\(\s*(?:''|"")\s*,\s*(?:\[|array\s*\()/i],
  ["arrow function fn()", /\bfn\s*\(/i],
  ["intdiv()", /(?<![\w>$:])\\?intdiv\s*\(/i],
  ["random_int()", /(?<![\w>$:])\\?random_int\s*\(/i],
  ["preg_replace_callback_array()", /(?<![\w>$:])\\?preg_replace_callback_array\s*\(/i],
  ["error_clear_last()", /(?<![\w>$:])\\?error_clear_last\s*\(/i],
  ["session_start s volbami", /session_start\s*\(\s*(?:\[|array)/i],
  ["str_contains/str_starts_with/str_ends_with (PHP 8)", /(?<![\w>$:])\\?str_(?:contains|starts_with|ends_with)\s*\(/i],
  ["array_key_first/last (PHP 7.3)", /(?<![\w>$:])\\?array_key_(?:first|last)\s*\(/i],
  ["is_countable/is_iterable", /(?<![\w>$:])\\?is_(?:countable|iterable)\s*\(/i],
  ["spread v poli [...$x] (PHP 7.4)", /\[\s*\.\.\.\$/],
  ["nullsafe ?-> (PHP 8)", /\?->/],
  ["match (PHP 8)", /\bmatch\s*\([^)]*\)\s*\{/i],
  ["throw jako výraz / pojmenované argumenty", /\(\s*\w+\s*:\s*[$'"\w]/],
];

/** porušení pravidel PHP 5.6 v souboru: [pravidlo, řádek] */
function php56Violations(src: string): { rule: string; line: number; text: string }[] {
  const code = phpCode(src);
  const lines = code.split("\n");
  const out: { rule: string; line: number; text: string }[] = [];
  for (const [rule, re] of FORBIDDEN) {
    lines.forEach((l, k) => {
      if (re.test(l)) out.push({ rule, line: k + 1, text: l.trim().slice(0, 120) });
    });
  }
  // catch jen Throwable (PHP 7+): na PHP 5.6 by výjimka prošla nezachycená – vedle musí být catch (Exception …)
  const throwableOnly = /catch\s*\(\s*\\?Throwable\s+\$\w+\s*\)\s*\{[^}]*\}(?!\s*catch\s*\(\s*\\?Exception\b)/g;
  for (const m of code.matchAll(throwableOnly)) out.push({ rule: "catch (Throwable) bez catch (Exception)", line: code.slice(0, m.index).split("\n").length, text: m[0].slice(0, 80) });
  // random_bytes (PHP 7+) jen uvnitř mn_random_strong za kontrolou function_exists
  const rb = [...code.matchAll(/(?<![\w>$:'])\\?random_bytes\s*\(/g)];
  const guard = code.indexOf("function mn_random_strong(");
  const guardEnd = guard < 0 ? -1 : code.indexOf("\n}", guard);
  for (const m of rb) {
    if (guard < 0 || m.index! < guard || m.index! > guardEnd) out.push({ rule: "random_bytes() mimo mn_random_strong", line: code.slice(0, m.index).split("\n").length, text: "random_bytes(" });
  }
  return out;
}

const DOCKER_IMG = process.env.MN_PHP_IMAGE || "php:5.6-cli";
const DOCKER_OK = spawnSync("docker", ["image", "inspect", DOCKER_IMG], { stdio: "ignore" }).status === 0;
const PHP_OK = spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
const docker = (args: string[], mounts: string[]) =>
  spawnSync("docker", ["run", "--rm", ...mounts.flatMap((m) => ["-v", `${m}:${m}`]), DOCKER_IMG, ...args], { encoding: "utf8", timeout: T });

describe("úložiště sdílení: zdroj bez syntaxe a funkcí PHP 7+ (hosting s PHP 5.6)", () => {
  for (const f of FILES) {
    it(`${f}: žádná syntaxe ani funkce, kterou PHP 5.6 nezná`, () => {
      expect(php56Violations(fs.readFileSync(path.join(DIR, f), "utf8"))).toEqual([]);
    });
  }

  it("kontrola opravdu chytá syntaxi PHP 7 – na store.php před opravou (99f7e30) najde typy, návratové typy, ?? i catch (Throwable)", () => {
    const show = (f: string) => spawnSync("git", ["show", `99f7e30:website/public/cad/share/${f}`], { cwd: __dirname, encoding: "utf8", maxBuffer: 1 << 22 });
    const store = show("store.php");
    const index = show("index.php");
    if (store.status !== 0 || index.status !== 0) return; // bez gitu / historie (mělký klon) – jen přeskočit
    const rules = new Set(php56Violations(store.stdout).map((v) => v.rule));
    expect(rules).toContain("typ parametru (int/string/bool/float/iterable/object/self/mixed)");
    expect(rules).toContain("návratový typ funkce");
    expect(rules).toContain("operátor ??");
    expect(rules).toContain("random_bytes() mimo mn_random_strong");
    expect(php56Violations(index.stdout).map((v) => v.rule)).toContain("catch (Throwable) bez catch (Exception)");
  });

  it("vzory: komentáře a řetězce se nekontrolují, kód ano", () => {
    expect(php56Violations("<?php\n// $a ?? 1\n$s = '??';\n/* function f(int $a): int */\n")).toEqual([]);
    expect(php56Violations("<?php\n$a = $b ?? 1;\n").map((v) => v.rule)).toEqual(["operátor ??"]);
    expect(php56Violations("<?php\nfunction f(string $a) {}\n").map((v) => v.rule)).toEqual(["typ parametru (int/string/bool/float/iterable/object/self/mixed)"]);
    expect(php56Violations("<?php\nfunction f($a): bool {}\n").map((v) => v.rule)).toEqual(["návratový typ funkce"]);
    expect(php56Violations("<?php\nfunction f(array $a, $b = []) { return $b ? 1 : 2; }\n")).toEqual([]);
    expect(php56Violations("<?php\ntry {} catch (Throwable $t) { x(); } catch (Exception $e) { x(); }\n")).toEqual([]);
  });

  it.skipIf(!PHP_OK)("php -l místním PHP (8.x)", () => {
    for (const f of FILES) {
      const r = spawnSync("php", ["-l", path.join(DIR, f)], { encoding: "utf8" });
      expect(r.stdout + r.stderr).toMatch(/No syntax errors detected/);
      expect(r.status).toBe(0);
    }
  });

  it.skipIf(!DOCKER_OK)(`php -l na PHP 5.6 (Docker ${DOCKER_IMG})`, () => {
    const v = docker(["php", "-r", "echo PHP_VERSION;"], []);
    expect(v.stdout).toMatch(/^5\.6\./);
    for (const f of FILES) {
      const r = docker(["php", "-l", path.join(DIR, f)], [DIR]);
      expect(r.stdout + r.stderr).toMatch(/No syntax errors detected/);
      expect(r.status).toBe(0);
    }
  }, T);

  it.skipIf(!DOCKER_OK)("PHP 5.6: zavaděč + store.php odpoví na ?ping a ?diag (bez webového serveru, náhoda z openssl se zárukou síly)", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "mn-share-56-"));
    try {
      const run = (q: string) => {
        const code = `$_GET = array('${q}' => ''); $_SERVER['REQUEST_METHOD'] = 'GET'; putenv('MN_SHARE_DATA=${data}'); require '${path.join(DIR, "index.php")}';`;
        const r = docker(["php", "-d", "display_errors=1", "-d", "error_reporting=-1", "-r", code], [DIR, data]);
        expect(r.stderr).toBe("");
        return r.stdout;
      };
      // bez varování (PHP 5.6 E_DEPRECATED / E_NOTICE by se vypsalo před JSON) – výstup je čistý JSON
      expect(JSON.parse(run("ping"))).toEqual({ ok: true, v: 2, max_bytes: 25 * 1024 * 1024, chunk_bytes: expect.any(Number), max_days: 90 });
      const diag = JSON.parse(run("diag"));
      expect(diag).toMatchObject({ ok: true, v: 2, writable: true, random: "openssl", storage: "env", disabled: [] });
      expect(diag.php).toMatch(/^5\.6\./);
    } finally {
      fs.rmSync(data, { recursive: true, force: true });
    }
  }, T);
});
