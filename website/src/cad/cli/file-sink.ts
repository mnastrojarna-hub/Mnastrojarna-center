/**
 * Soubory CLI (CAD-HEADLESS-NAVRH.md kap. 2.3, 3.1, 3.5): výstupy do `--out` a vstupy z `--files DIR` / složky skriptu.
 *
 * `CliFileSink` – název se očistí (`safeFileName`: bez `/ \ : NUL…`, bez `..`, nikdy s oddělovačem cesty), cesta je
 * `realpath(out)/název` a zápis proběhne, jen když výsledná cesta leží v `realpath(out)`. Soubor se vytváří výhradně
 * (`wx` = O_CREAT|O_EXCL): existující soubor ani symbolický odkaz se nepřepíše a nenásleduje – název dostane příponu
 * „ (2)“ (jako w11 `outFileName`). Pevné soubory (`protocol-full.txt`, `session.mncad-ws`) se přepisují atomicky přes
 * dočasný soubor a `rename`, který nahradí i případný odkaz, ne jeho cíl.
 *
 * `CliFileSource` – skript smí číst jen soubory ve složkách `roots` (`--files DIR`, složka skriptu) a soubory výslovně
 * zadané na příkazové řádce (`--open`); cokoli jiného (`../../etc/passwd`, odkaz ven ze složky) je ✗ `file.missing`.
 */
import fs from "node:fs";
import path from "node:path";
import { tr } from "../i18n";
import { MissingInputError, OutPathError, safeFileName, sha256Hex, uniqueFileName, type FileSink, type FileSource, type OutFile, type OutWrite } from "../engine/host";

export { OutPathError, MissingInputError };

/** největší vstupní soubor (bajty) – víc odmítne `read` */
export const INPUT_MAX_BYTES = 512 * 1024 * 1024;

/** je `p` uvnitř složky `root` (obě cesty absolutní a normalizované)? */
export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Výstupní složka: vytvoří ji (`mkdir -p`) a vrátí její skutečnou cestu (`realpath`). */
export function prepareOutDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  if (!fs.statSync(real).isDirectory()) throw new Error(tr("„{0}“ není složka", dir));
  return real;
}

/**
 * Cesta souboru `name` ve výstupní složce `root` (už `realpath`): název se očistí; výsledek musí ležet přímo v `root`,
 * jinak `OutPathError` (engine ✗ `out.path`).
 */
export function confinedPath(root: string, name: string): { name: string; path: string } {
  const clean = safeFileName(name);
  const p = path.resolve(root, clean);
  if (path.dirname(p) !== root || !isInside(root, p)) throw new OutPathError(name);
  return { name: clean, path: p };
}

export type SinkRename = { from: string; to: string };

export class CliFileSink implements FileSink {
  /** soubory zapsané touto instancí (pořadí zápisu) */
  readonly written: OutFile[] = [];
  /** přejmenování kvůli existujícímu souboru (engine je hlásí jako ℹ out.renamed) */
  readonly renamed: SinkRename[] = [];

  private constructor(readonly root: string) {}

  /** výstupní složka `dir` (vytvoří se); kořen je `realpath(dir)` */
  static create(dir: string): CliFileSink {
    return new CliFileSink(prepareOutDir(dir));
  }

  async write(f: OutWrite): Promise<OutFile> {
    const first = confinedPath(this.root, f.name);
    let name = first.name;
    for (let attempt = 0; ; attempt++) {
      const p = path.join(this.root, name);
      let fd: number;
      try {
        fd = fs.openSync(p, "wx", 0o644);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 9_999) throw e;
        name = uniqueFileName(first.name, (n) => {
          try {
            fs.lstatSync(path.join(this.root, n));
            return true;
          } catch {
            return false;
          }
        });
        continue;
      }
      try {
        fs.writeFileSync(fd, f.data);
      } finally {
        fs.closeSync(fd);
      }
      if (name !== first.name) this.renamed.push({ from: first.name, to: name });
      const file: OutFile = { name, format: f.format, bytes: f.data.length, sha256: await sha256Hex(f.data), doc: f.doc, path: p };
      this.written.push(file);
      return file;
    }
  }

  /**
   * Pevný soubor (přepíše se): `protocol-full.txt`, `session.mncad-ws`. Zápis do dočasného souboru ve stejné složce a
   * `rename` – existující symbolický odkaz se nahradí, jeho cíl zůstane netknutý. Vrací absolutní cestu.
   */
  writeFixed(name: string, data: Uint8Array | string): string {
    const { path: p } = confinedPath(this.root, name);
    const tmp = path.join(this.root, `.${path.basename(p)}.${process.pid}.${Date.now().toString(36)}.tmp`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, p);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    fs.chmodSync(p, 0o644);
    return p;
  }
}

/**
 * Vstupy skriptu: soubory ve složkách `roots` (nejdřív `--files DIR`, pak složka skriptu) a soubory `explicit`
 * (výslovně zadané na příkazové řádce). Název se hledá v kořenech v pořadí; skutečná cesta (`realpath`, i přes odkazy)
 * musí ležet v kořeni, jinak se soubor nečte.
 */
export class CliFileSource implements FileSource {
  private readonly roots: string[];
  private readonly explicit = new Map<string, string>();

  constructor(roots: string[], explicit: string[] = []) {
    this.roots = [];
    for (const r of roots) {
      try {
        const real = fs.realpathSync(r);
        if (fs.statSync(real).isDirectory() && !this.roots.includes(real)) this.roots.push(real);
      } catch {
        /* neexistující složka – nic z ní */
      }
    }
    for (const f of explicit) {
      const abs = path.resolve(f);
      try {
        this.explicit.set(abs, fs.realpathSync(abs));
      } catch {
        this.explicit.set(abs, abs); // chybějící soubor ohlásí read() jako file.missing
      }
    }
  }

  list(): string[] {
    const out = new Set<string>();
    for (const r of this.roots) {
      try {
        for (const d of fs.readdirSync(r, { withFileTypes: true })) if (d.isFile()) out.add(d.name);
      } catch {
        /* nečitelná složka */
      }
    }
    // výslovně zadané soubory jen ty, které existují (chybějící `--open` není „dostupný“)
    for (const [abs, real] of this.explicit) {
      try {
        if (fs.statSync(real).isFile()) out.add(path.basename(abs));
      } catch {
        /* neexistuje */
      }
    }
    return [...out].sort();
  }

  /** skutečná cesta souboru `name`, nebo null (mimo povolené složky / neexistuje) */
  resolve(name: string): string | null {
    if (!name || name.includes("\0")) return null;
    // výslovně zadaný soubor: přesná cesta (relativně k pracovní složce) nebo jen název souboru
    const abs = path.resolve(name);
    const ex = this.explicit.get(abs) ?? [...this.explicit.entries()].find(([k]) => path.basename(k) === name)?.[1];
    if (ex && fs.existsSync(ex) && fs.statSync(ex).isFile()) return ex;
    if (path.isAbsolute(name)) {
      for (const r of this.roots) if (isInside(r, abs)) return this.real(r, abs);
      return null;
    }
    for (const r of this.roots) {
      const p = this.real(r, path.resolve(r, name));
      if (p) return p;
    }
    return null;
  }

  private real(root: string, p: string): string | null {
    if (!isInside(root, p)) return null;
    try {
      const real = fs.realpathSync(p);
      return isInside(root, real) && fs.statSync(real).isFile() ? real : null;
    } catch {
      return null;
    }
  }

  async read(name: string): Promise<{ name: string; data: Uint8Array }> {
    const p = this.resolve(name);
    if (!p) throw new MissingInputError(name, this.list());
    const size = fs.statSync(p).size;
    if (size > INPUT_MAX_BYTES) throw new Error(tr("soubor „{0}“ je příliš velký ({1} MB, nejvýš {2} MB)", name, Math.round(size / 1048576), INPUT_MAX_BYTES / 1048576));
    return { name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) };
  }
}
