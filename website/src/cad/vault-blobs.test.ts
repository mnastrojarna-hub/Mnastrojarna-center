import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CadDoc } from "./types";

/** jednoduché úložiště místo prohlížeče (jako vault.test.ts) */
function memStorage() {
  const m = new Map<string, string>();
  const st = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
      (st as unknown as Record<string, string>)[k] = v;
    },
    removeItem: (k: string) => {
      m.delete(k);
      delete (st as unknown as Record<string, string>)[k];
    },
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    clear: () => m.clear(),
  };
  return st;
}
type Mem = ReturnType<typeof memStorage>;
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };

/** IndexedDB v paměti (sdílené mezi „načteními stránky“) s počítadlem zápisů */
function memBackend() {
  const m = new Map<string, Uint8Array>();
  let puts = 0;
  return {
    m,
    puts: () => puts,
    get: async (id: string) => m.get(id),
    put: async (id: string, d: Uint8Array) => {
      puts++;
      m.set(id, d.slice());
    },
    delete: async (id: string) => void m.delete(id),
    keys: async () => [...m.keys()],
  };
}

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) u[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
  return u;
};
const partWith = (ref: string, fileName = "velky.step"): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name: "Díl", material: "ocel", features: [{ id: "i", name: `Import ${fileName}`, type: "import", fileName, format: "step", data: ref }] });

/** „nové načtení stránky“: čerstvé moduly (prázdné úložiště dat v paměti), localStorage / sessionStorage zůstávají */
async function freshPage(be: ReturnType<typeof memBackend>) {
  vi.resetModules();
  const vault = await import("./vault");
  const blobs = await import("./blobs");
  const vb = await import("./vault-blobs");
  vb.setBlobBackend(be);
  return { vault, blobs, vb };
}

beforeEach(() => {
  g.localStorage = memStorage();
  g.sessionStorage = memStorage();
});

describe("data importů v šifrovaném úložišti (automatické uložení, obnova karty, nedávné soubory)", () => {
  it("10 MB import: uloží se jednou zašifrovaně, další automatická uložení nic nezapisují; po obnovení stránky se načte", async () => {
    const be = memBackend();
    const { vault, blobs, vb } = await freshPage(be);
    await vault.enableEncrypted("tajne-heslo");
    const raw = bytes(10 * 1048576, 5);
    const ref = blobs.putBlob(raw);
    const doc = partWith(ref);

    const first = await vb.persistDocBlobs(doc);
    expect(first.written).toBe(1);
    expect(first.bytes).toBe(raw.length);
    expect(first.failed).toEqual([]);
    expect(be.puts()).toBe(1);
    const stored = be.m.get(blobs.blobIdOf(ref))!;
    expect(stored.length).toBe(raw.length + 12 + 16); // iv + značka AES-GCM
    expect(Buffer.from(stored.subarray(12, 4108)).equals(Buffer.from(raw.subarray(0, 4096)))).toBe(false); // zašifrované

    // časté automatické ukládání: dokument s odkazem (malý JSON) + kontrola dat bez zápisu
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      const json = JSON.stringify({ ...doc, name: `Díl ${i}` });
      expect(json.length).toBeLessThan(1000);
      const r = await vb.persistDocBlobs(doc);
      expect(r.written).toBe(0);
    }
    const perSave = (performance.now() - t0) / 50;
    console.log(`10 MB import: první uložení dat ${first.ms.toFixed(1)} ms, další automatické uložení ${perSave.toFixed(3)} ms`);
    expect(perSave).toBeLessThan(5);
    expect(be.puts()).toBe(1);
    await vault.vaultSet("mn-cad-doc-v1", JSON.stringify(doc));

    // obnovení stránky: odkaz z dokumentu se doplní z úložiště
    const p2 = await freshPage(be);
    expect(await p2.vault.restoreSession()).toBe(true);
    const d2 = JSON.parse((await p2.vault.vaultGet("mn-cad-doc-v1"))!) as CadDoc;
    expect(p2.blobs.missingBlobs(d2)).toEqual([ref]);
    expect(await p2.vb.loadDocBlobs(d2)).toEqual([]);
    expect(Buffer.from(p2.blobs.blobOf(ref)!).equals(Buffer.from(raw))).toBe(true); // (toEqual nad 10 MB polem vyčerpá paměť)
    // načtená data se znovu nezapisují
    expect((await p2.vb.persistDocBlobs(d2)).written).toBe(0);
    expect(be.puts()).toBe(1);
  }, 60_000);

  it("chybějící data: název souboru; jiný klíč (nové heslo) data nepřečte", async () => {
    const be = memBackend();
    const { vault, blobs, vb } = await freshPage(be);
    await vault.enableEncrypted("heslo-1");
    const ref = blobs.putBlob(bytes(50_000, 9));
    await vb.persistDocBlobs(partWith(ref, "a.step"));
    const p2 = await freshPage(be);
    await p2.vault.restoreSession();
    expect(await p2.vb.loadDocBlobs(partWith("mnblob:0000000000000000zz", "ztraceny.step"))).toEqual(["ztraceny.step"]);
    // nové heslo = vymazání úložiště (a jiný klíč): stará zašifrovaná data se nedešifrují
    const id = p2.blobs.blobIdOf(ref);
    const old = be.m.get(id)!;
    await p2.vault.enableEncrypted("heslo-2");
    be.m.set(id, old);
    expect(await p2.vb.loadDocBlobs(partWith(ref, "a.step"))).toEqual(["a.step"]);
  });

  it("vymazání úložiště: data se po něm zapíší znovu; v režimu „neukládat“ se nezapisuje nic", async () => {
    const be = memBackend();
    const { vault, blobs, vb } = await freshPage(be);
    const ref = blobs.putBlob(bytes(20_000, 3));
    expect((await vb.persistDocBlobs(partWith(ref))).written).toBe(0); // režim „neukládat“
    expect(be.puts()).toBe(0);
    await vault.enableEncrypted("heslo1234");
    expect((await vb.persistDocBlobs(partWith(ref))).written).toBe(1);
    vault.wipeStoredDocuments();
    be.m.clear(); // deleteDatabase
    expect((await vb.persistDocBlobs(partWith(ref))).written).toBe(1);
    expect(be.m.size).toBe(1);
  });

  it("plné úložiště: chyba se ohlásí názvem souboru jednou, další automatická uložení data znovu nešifrují", async () => {
    const be = memBackend();
    let tries = 0;
    const full = { ...be, put: async () => { tries++; throw new DOMException("quota", "QuotaExceededError"); } };
    const { vault, blobs, vb } = await freshPage(be);
    vb.setBlobBackend(full);
    await vault.enableEncrypted("heslo1234");
    const doc = partWith(blobs.putBlob(bytes(30_000, 4)), "velky.step");
    expect((await vb.persistDocBlobs(doc)).failed).toEqual(["velky.step"]);
    expect((await vb.persistDocBlobs(doc)).failed).toEqual([]);
    expect(tries).toBe(1);
  });

  it("úklid: smaže jen data, na která neodkazuje žádný uložený dokument a nejsou v paměti", async () => {
    const be = memBackend();
    const { vault, blobs, vb } = await freshPage(be);
    await vault.enableEncrypted("heslo1234");
    const keep = blobs.putBlob(bytes(10_000, 1));
    const recent = blobs.putBlob(bytes(10_000, 2));
    const gone = blobs.putBlob(bytes(10_000, 3));
    for (const r of [keep, recent, gone]) await vb.persistDocBlobs(partWith(r));
    await vault.vaultSet("mn-cad-doc-v1", JSON.stringify(partWith(keep)));
    await vault.vaultSet("mn-cad-doc-abc123", JSON.stringify(partWith(recent)));
    expect(await vb.gcVaultBlobs()).toBe(0); // vše je v paměti této karty
    const p2 = await freshPage(be);
    await p2.vault.restoreSession();
    expect(await p2.vb.gcVaultBlobs()).toBe(1);
    expect([...be.m.keys()].sort()).toEqual([blobs.blobIdOf(keep), blobs.blobIdOf(recent)].sort());
  });

  it("velký dokument (> 150 kB JSON) se zašifruje a uloží (dřív přetekl zásobník při převodu na base64)", async () => {
    const { vault } = await freshPage(memBackend());
    await vault.enableEncrypted("heslo1234");
    const big = JSON.stringify({ name: "x".repeat(1_000_000) });
    await vault.vaultSet("mn-cad-doc-v1", big);
    expect(await vault.vaultGet("mn-cad-doc-v1")).toBe(big);
  });
});
