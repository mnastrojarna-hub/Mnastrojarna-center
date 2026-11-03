import { beforeEach, describe, expect, it } from "vitest";

/** jednoduché úložiště místo prohlížeče */
function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    clear: () => m.clear(),
    _keys: () => [...m.keys()],
  };
}
type Mem = ReturnType<typeof memStorage>;
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };

beforeEach(() => {
  g.localStorage = memStorage();
  g.sessionStorage = memStorage();
  // Object.keys(localStorage) v modulu – doplnit vlastnosti jako prohlížeč
  const l = g.localStorage;
  const orig = l.setItem;
  l.setItem = (k: string, v: string) => {
    orig(k, v);
    (l as unknown as Record<string, string>)[k] = v;
  };
  const origDel = l.removeItem;
  l.removeItem = (k: string) => {
    origDel(k);
    delete (l as unknown as Record<string, string>)[k];
  };
});

describe("úložiště rozpracované práce (NDA)", () => {
  it("výchozí režim nic neukládá a vymaže dřívější dokumenty", async () => {
    const v = await import("./vault");
    g.localStorage.setItem("mn-cad-doc-v1", "{}");
    g.localStorage.setItem("mn-cad-doc-abc", "{}");
    g.localStorage.setItem("mn-cad-settings-v2", "{}");
    expect(v.persistMode()).toBe("none");
    await v.vaultSet("mn-cad-doc-v1", "tajné");
    expect(g.localStorage.getItem("mn-cad-doc-v1")).toBe("{}"); // nic nezapsalo
    v.wipeStoredDocuments();
    expect(g.localStorage.getItem("mn-cad-doc-v1")).toBeNull();
    expect(g.localStorage.getItem("mn-cad-doc-abc")).toBeNull();
    expect(g.localStorage.getItem("mn-cad-settings-v2")).toBe("{}"); // nastavení zůstává
    expect(await v.vaultGet("mn-cad-doc-v1")).toBeNull();
  });

  it("šifrovaný režim: zapsané je nečitelné bez hesla, po odemknutí čitelné, špatné heslo neodemkne", async () => {
    const v = await import("./vault");
    await v.enableEncrypted("tajne-heslo");
    expect(v.persistMode()).toBe("encrypted");
    expect(v.isUnlocked()).toBe(true);
    await v.vaultSet("mn-cad-doc-x", '{"name":"Výkres 123"}');
    const raw = g.localStorage.getItem("mn-cad-doc-x")!;
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain("Výkres");
    expect(await v.vaultGet("mn-cad-doc-x")).toBe('{"name":"Výkres 123"}');
    v.lock();
    expect(v.isUnlocked()).toBe(false);
    expect(await v.vaultGet("mn-cad-doc-x")).toBeNull();
    expect(await v.unlock("spatne")).toBe(false);
    expect(await v.unlock("tajne-heslo")).toBe(true);
    expect(await v.vaultGet("mn-cad-doc-x")).toBe('{"name":"Výkres 123"}');
  });

  it("obnovení v téže kartě (sessionStorage) a vypnutí smaže vše", async () => {
    const v = await import("./vault");
    await v.enableEncrypted("heslo1234");
    await v.vaultSet("mn-cad-doc-y", "data");
    // simulace obnovení stránky: klíč v paměti pryč, session zůstává
    v.lock();
    g.sessionStorage.setItem("mn-cad-vault-key", "");
    expect(await v.restoreSession()).toBe(false);
    expect(await v.unlock("heslo1234")).toBe(true);
    const sess = g.sessionStorage.getItem("mn-cad-vault-key");
    expect(sess && sess.length > 10).toBe(true);
    (v as unknown as { lockOnly?: () => void }).lockOnly?.();
    expect(await v.vaultGet("mn-cad-doc-y")).toBe("data");
    v.disableEncrypted();
    expect(v.persistMode()).toBe("none");
    expect(g.localStorage.getItem("mn-cad-doc-y")).toBeNull();
    expect(g.localStorage.getItem("mn-cad-vault-salt-v1")).toBeNull();
  });
});
