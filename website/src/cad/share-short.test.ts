/**
 * Nejkratší sdílený odkaz (vlna 16): `https://mnastrojarna.cz/s#<KÓD>` – kód 10 znaků base58, z něhož se JEDNÍM pomalým
 * odvozením (PBKDF2-HMAC-SHA-256, sůl "mncad-share-v2", 1 200 000 iterací, 32 B = jeden blok) získá tajemství a z něj
 * (HKDF-SHA-256 s popisky) id v úložišti (11 znaků base58) i klíč AES-256. Pevné vektory, abeceda a rovnoměrnost kódu,
 * oddělení id a klíče, heslo, rozbor části za # a ručního zadání, skript stránky a délka odkazu. Celá cesta proti
 * úložišti: share-self.test.ts (napodobený server), share-php.test.ts (PHP).
 */
import { hkdfSync, pbkdf2Sync } from "node:crypto";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveShareCode, groupShareCode, openErrorText, parseShareHash, parseShareInput, randomShareCode, resetShareProbe, SHARE_CODE_ALPHABET, SHARE_CODE_LEN, SHARE_ID_LEN, SHARE_KDF_ITERATIONS, shareCodeProblem, shareHttpsUrl, shareInputHash, shareShortBase } from "./share";
import { SHARE_CODE_CLASS, SHARE_CODE_HASH_SRC, SHARE_STASH_SCRIPT } from "./share-code";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const idOf = (b: Buffer) => {
  let n = BigInt("0x" + b.subarray(0, 16).toString("hex")) % 58n ** 11n;
  let s = "";
  for (let i = 0; i < 11; i++) {
    s = SHARE_CODE_ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
};
/** nezávislý výpočet (node:crypto + BigInt) – ne kód ze share.ts */
function reference(code: string, password?: string) {
  const prk = pbkdf2Sync(Buffer.from(code, "utf8"), "mncad-share-v2", 1_200_000, 32, "sha256");
  const idBytes = Buffer.from(hkdfSync("sha256", prk, Buffer.alloc(0), "mncad-share-v2 id", 16));
  const k = password === undefined ? prk : pbkdf2Sync(Buffer.concat([prk, Buffer.from(password.normalize("NFKC"), "utf8")]), "mncad-share-v2 password", 1_200_000, 32, "sha256");
  return { prk, idBytes, id: idOf(idBytes), key: Buffer.from(hkdfSync("sha256", k, Buffer.alloc(0), "mncad-share-v2 key", 32)).toString("hex") };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetShareProbe();
  delete process.env.NEXT_PUBLIC_CAD_SHARE_SHORT;
  delete process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_EN;
  delete process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_DE;
});

describe("kód → id + klíč (PBKDF2 + HKDF, pevné vektory)", () => {
  it("parametry odvození jsou pevné (změna = vydané odkazy by přestaly fungovat)", () => {
    expect(SHARE_KDF_ITERATIONS).toBe(1_200_000);
    expect(SHARE_CODE_LEN).toBe(10);
    expect(SHARE_ID_LEN).toBe(11);
    expect(SHARE_CODE_ALPHABET).toBe("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
  });

  it("pevný kód → pevné id a klíč (vektory spočtené nezávisle: node:crypto pbkdf2Sync + hkdfSync a PHP hash_pbkdf2 + hash_hkdf)", async () => {
    const vectors = [
      { code: "Ab3kZ9xQ2m", id: "AbwrSSAc5CL", idBytes: "c6c31174a25690aed73b9627c342c189", key: "703ec7422ee66fd3fceef345376d280302d7104edc5c3afb8f12e8c98c6539cc" },
      { code: "1111111111", id: "1o1HqY39xGu", idBytes: "13735c776dab5764dc42aee4f0cc3016", key: "56359372072f7373517cd986449f93af64bbb4e5556c18e34f19f2c0a25942de" },
      { code: "zzzzzzzzzz", id: "RbCcZvCNtFD", idBytes: "35f2def61a477d6e07daad7b688266fc", key: "b8be984eda9f8b4940e96fa32e1ddfd2cb4aa451c54d55a3b849d718115a7121" },
    ];
    for (const v of vectors) {
      const d = await deriveShareCode(v.code);
      expect(d.id, v.code).toBe(v.id);
      expect(hex(d.key), v.code).toBe(v.key);
      // tentýž výsledek dá nezávislý výpočet za běhu
      const ref = reference(v.code);
      expect(ref.id).toBe(v.id);
      expect(ref.idBytes.toString("hex")).toBe(v.idBytes);
      expect(ref.key).toBe(v.key);
      expect(d.id).toMatch(new RegExp(`^${SHARE_CODE_CLASS}{11}$`));
      expect(d.key.length).toBe(32);
    }
    // s heslem: id stejné, klíč z druhého pomalého odvození (tajemství kódu ‖ heslo)
    const pw = await deriveShareCode("Ab3kZ9xQ2m", "tajne");
    expect(pw.id).toBe("AbwrSSAc5CL");
    expect(hex(pw.key)).toBe("c79be87ac0ce3d082ed3626182c16488f29d264bb07c904444ce8c2afe18f37c");
    expect(reference("Ab3kZ9xQ2m", "tajne").key).toBe(hex(pw.key));
  }, 60_000);

  it("pomalé odvození je JEDEN blok PBKDF2 (32 B): kdo zkouší kódy proti id, platí stejně jako příjemce; id a klíč jsou nezávislá rozšíření", async () => {
    // (revize: původně 64 B = dva nezávislé bloky po 600 000 iteracích – id potřebovalo jen první, útočník platil polovinu)
    const calls: { name: string; bits: number; iterations?: number }[] = [];
    const real = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "deriveBits").mockImplementation(((alg: { name: string; iterations?: number }, key: CryptoKey, bits: number) => {
      calls.push({ name: alg.name, bits, iterations: alg.iterations });
      return real(alg as Pbkdf2Params, key, bits);
    }) as typeof crypto.subtle.deriveBits);
    const code = "Ab3kZ9xQ2n";
    const d = await deriveShareCode(code);
    const slow = calls.filter((c) => c.name === "PBKDF2");
    expect(slow).toEqual([{ name: "PBKDF2", bits: 256, iterations: 1_200_000 }]);
    expect(calls.filter((c) => c.name === "HKDF").map((c) => c.bits).sort()).toEqual([128, 256]);
    // s heslem právě jedno další pomalé odvození (opět jeden blok); odvození kódu se nepočítá znovu
    calls.length = 0;
    const p = await deriveShareCode(code, "tajne");
    expect(calls.filter((c) => c.name === "PBKDF2")).toEqual([{ name: "PBKDF2", bits: 256, iterations: 1_200_000 }]);
    expect(p.id).toBe(d.id);
    // id ani klíč nejdou získat levněji: poloviční počet iterací dá jiné tajemství, jiné id i klíč
    const ref = reference(code);
    expect(d.id).toBe(ref.id);
    expect(hex(d.key)).toBe(ref.key);
    const half = pbkdf2Sync(code, "mncad-share-v2", 600_000, 32, "sha256");
    expect(idOf(Buffer.from(hkdfSync("sha256", half, Buffer.alloc(0), "mncad-share-v2 id", 16)))).not.toBe(d.id);
    // id o klíči nic neprozradí: jsou to různá rozšíření téhož tajemství (jiný popisek), žádný společný úsek
    expect(ref.key).not.toContain(ref.idBytes.toString("hex").slice(0, 16));
    expect(ref.prk.toString("hex")).not.toBe(ref.key);
    expect(Buffer.from(hkdfSync("sha256", ref.prk, Buffer.alloc(0), "mncad-share-v2 key", 16)).toString("hex")).not.toBe(ref.idBytes.toString("hex"));
  }, 60_000);

  it("heslo: id zůstává jen z kódu, klíč je z tajemství kódu + hesla (NFKC); bez hesla a s jiným heslem jiný klíč", async () => {
    const code = "Ab3kZ9xQ2m";
    const plain = await deriveShareCode(code);
    const pw = await deriveShareCode(code, "tajné-123");
    expect(pw.id).toBe(plain.id);
    expect(hex(pw.key)).toBe(reference(code, "tajné-123").key);
    expect(hex(pw.key)).not.toBe(hex(plain.key));
    expect(hex((await deriveShareCode(code, "tajne-123")).key)).not.toBe(hex(pw.key));
    // rozložené „é“ (e + čárka) dá po normalizaci stejný klíč
    expect(hex((await deriveShareCode(code, "tajne\u0301-123")).key)).toBe(hex(pw.key));
    // jiný kód se stejným heslem → jiné id i klíč
    const other = await deriveShareCode("Ab3kZ9xQ2n", "tajné-123");
    expect(other.id).not.toBe(pw.id);
    expect(hex(other.key)).not.toBe(hex(pw.key));
  }, 60_000);
});

describe("náhodný kód", () => {
  it("10 znaků z abecedy base58 (bez 0 O I l), pokaždé jiný", () => {
    expect(SHARE_CODE_ALPHABET.length).toBe(58);
    expect(new Set(SHARE_CODE_ALPHABET).size).toBe(58);
    expect(SHARE_CODE_ALPHABET).not.toMatch(/[0OIl]/);
    expect(new RegExp(`^${SHARE_CODE_CLASS}+$`).test(SHARE_CODE_ALPHABET)).toBe(true);
    // znaková třída = právě abeceda (žádný znak navíc)
    const all = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).filter((c) => new RegExp(`^${SHARE_CODE_CLASS}$`).test(c));
    expect(all.join("")).toBe([...SHARE_CODE_ALPHABET].sort().join(""));
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomShareCode();
      expect(c).toMatch(new RegExp(`^${SHARE_CODE_CLASS}{10}$`));
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
  });

  it("rovnoměrnost (orientačně): každý znak abecedy na každé pozici, četnosti ±12 %", () => {
    const N = 30_000;
    const total = new Map<string, number>();
    const perPos = Array.from({ length: 10 }, () => new Set<string>());
    for (let i = 0; i < N; i++) {
      const c = randomShareCode();
      for (let k = 0; k < 10; k++) {
        total.set(c[k], (total.get(c[k]) ?? 0) + 1);
        perPos[k].add(c[k]);
      }
    }
    expect(total.size).toBe(58);
    for (const s of perPos) expect(s.size).toBe(58);
    const mean = (N * 10) / 58; // ≈ 5172, σ ≈ 71 → ±12 % je přes 8 σ
    for (const [ch, n] of total) expect(Math.abs(n - mean) / mean, ch).toBeLessThan(0.12);
  });

  it("zamítací výběr: bajty ≥ 232 se zahodí (bez zkreslení modulo), i když jich přijde hodně", () => {
    const orig = crypto.getRandomValues.bind(crypto);
    let calls = 0;
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((a: Uint8Array) => {
      calls++;
      // 1. volání samé zamítnuté hodnoty, 2. volání střídavě 232 (zamítnout) a 57 (poslední znak abecedy), pak 0
      if (calls === 1) a.fill(255);
      else if (calls === 2) a.forEach((_, i) => (a[i] = i % 2 ? 57 : 232));
      else a.fill(0);
      return a;
    }) as typeof crypto.getRandomValues);
    try {
      expect(randomShareCode()).toBe("zzzzzzzzzz");
      expect(calls).toBe(2);
      expect(randomShareCode()).toBe("1111111111");
    } finally {
      spy.mockRestore();
    }
    expect(orig(new Uint8Array(4)).length).toBe(4);
  });

  it("skupiny pro čtení nahlas: Ab3k Z9xQ 2m", () => {
    expect(groupShareCode("Ab3kZ9xQ2m")).toBe("Ab3k Z9xQ 2m");
    expect(groupShareCode("Ab3kZ9xQ2m").replace(/ /g, "")).toBe("Ab3kZ9xQ2m");
  });
});

describe("rozbor části za # a ručního zadání", () => {
  const CODE = { kind: "code", code: "Ab3kZ9xQ2m" };
  it("holý kód (právě 10 znaků base58), tolerantní ke všemu, co zpráva nebo kopírování přilepí za odkaz", () => {
    expect(parseShareHash("#Ab3kZ9xQ2m")).toEqual(CODE);
    expect(parseShareHash("Ab3kZ9xQ2m")).toEqual(CODE);
    // (revize: dříve jen . , ; : ! ? ) ] ' – uvozovky, hvězdičky, mezera, lomítko… vedly mlčky na prázdný CAD)
    for (const tail of [".", ")", ").", ",", "!", "?", ";", ":", "]", ">", "'", '"', "“", "”", "»", "*", "**", "_", "}", "…", " ", "/", "-", "|", "=", ")…\"", "\u00a0"]) expect(parseShareHash("#Ab3kZ9xQ2m" + tail), JSON.stringify(tail)).toEqual(CODE);
    // prohlížeč znaky v adrese zakóduje (Chromium: > → %3E, " → %22, mezera → %20, „”“ → %E2%80%9D)
    for (const tail of ["%3E", "%22", "%20", "%E2%80%9D", "%2A%2A", "%7D", "%7C", ").%22"]) expect(parseShareHash("#Ab3kZ9xQ2m" + tail), tail).toEqual(CODE);
    // poškozené kódování se nedekóduje, ale kód se pozná dál
    expect(parseShareHash("#Ab3kZ9xQ2m%")).toEqual(CODE);
    // kód po skupinách 4-4-2 (jak ho ukazuje dialog) ručně dopsaný za adresu – mezery prohlížeč zakóduje
    for (const h of ["#Ab3k Z9xQ 2m", "#Ab3k%20Z9xQ%202m", "#Ab3k-Z9xQ-2m", "#Ab3k.Z9xQ.2m", "#Ab3k%20Z9xQ%202m)."]) expect(parseShareHash(h), h).toEqual(CODE);
  });

  it("nesmyslné části za # nejsou sdílený odkaz", () => {
    const junk = [
      "",
      "#",
      "#Ab3kZ9xQ2", // 9 znaků
      "#Ab3kZ9xQ2mm", // 11 znaků
      "#Ab3kZ9xQ0m", // 0 není v abecedě
      "#Ab3kZ9xQOm", // O
      "#Ab3kZ9xQIm", // I
      "#Ab3kZ9xQlm", // l
      "#Ab3k-Z9xQ2m",
      "#Ab3-kZ9x-Q2m",
      "#my-section-1",
      "#Ab3kZ9xQ2m/x",
      "#Ab3kZ9xQ2m?x=1",
      "#Ab3kZ9xQ2m&x=1",
      "#Ab3kZ9xQ2m=1",
      "#Ab3kZ9xQ2m#Ab3kZ9xQ2m",
      "#Ab3kZ9xQ2m-modelovani",
      "#parametric-modeling",
      "#app",
      "#dokumentace",
      "#/cad/share",
      "#x=Ab3kZ9xQ2m",
      "#q=Ab3kZ9xQ2m",
      "#s=",
      "# Ab3kZ9xQ2m",
      "#%20Ab3kZ9xQ2m",
    ];
    for (const h of junk) expect(parseShareHash(h), JSON.stringify(h)).toBeNull();
  });

  it("starší tvary se rozpoznají dál", () => {
    expect(parseShareHash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ kind: "self", id: "Ab12345678", key: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect(parseShareHash("#s=1d.abc")).toEqual({ kind: "link", compressed: true, salt: null, data: "abc" });
    expect(parseShareHash("#s=1dp.c2FsdA.abc")).toEqual({ kind: "link", compressed: true, salt: "c2FsdA", data: "abc" });
    expect(parseShareHash("#r=d10~abc.def")).toEqual({ kind: "store", path: "d10/abc.bin", key: "def", salt: null });
    expect(parseShareHash("#r=d10~abc.def.pxyz")).toEqual({ kind: "store", path: "d10/abc.bin", key: "def", salt: "xyz" });
  });

  it("ruční zadání: kód po skupinách, s mezerami, pomlčkami; celý odkaz (i starší)", () => {
    for (const t of ["Ab3kZ9xQ2m", " Ab3k Z9xQ 2m ", "Ab3k-Z9xQ-2m", "Ab3k.Z9xQ.2m", "Ab3k Z9xQ 2m", "Ab3kZ 9xQ2m", "#Ab3kZ9xQ2m", "mnastrojarna.cz/s#Ab3kZ9xQ2m", "https://mnastrojarna.cz/s#Ab3kZ9xQ2m", "https://www.mnastrojarna.cz/cad#Ab3kZ9xQ2m)."]) expect(parseShareInput(t), t).toEqual(CODE);
    expect(parseShareInput("https://www.mnastrojarna.cz/cad#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA")?.kind).toBe("self");
    expect(parseShareInput("https://www.mnastrojarna.cz/cad#s=1d.abc")?.kind).toBe("link");
    for (const t of ["", "   ", "Ab3kZ9xQ2", "Ab3kZ9xQ2mm", "ab3k z9xq 0m", "mnastrojarna.cz/s", "https://mnastrojarna.cz/s#", "ahoj", "nesmysl", "Ab3kZ9xQ0m", "Ab3kZ9xQ2mx heslo"]) expect(parseShareInput(t), t).toBeNull();
  });

  it("ruční zadání přijme i to, co příjemce přirozeně vloží: řádek z dialogu, odkaz s kódem po skupinách, odkaz uprostřed zprávy", () => {
    // (revize: tato zadání pole odmítalo hláškou „Kód má 10 znaků…“)
    const inputs = [
      "Kód: Ab3k Z9xQ 2m", // řádek dialogu sdílení tak, jak je vidět
      "Code: Ab3k Z9xQ 2m",
      "mnastrojarna.cz/s#Ab3k Z9xQ 2m", // odkaz s kódem po skupinách
      "https://mnastrojarna.cz/s#Ab3kZ9xQ2m – heslo pošlu zvlášť", // odkaz, za kterým pokračuje text
      "https://mnastrojarna.cz/s#Ab3kZ9xQ2m heslo: tajne",
      "Posílám model: https://mnastrojarna.cz/s#Ab3kZ9xQ2m.",
      "Ab3k Z9xQ 2m – heslo pošlu zvlášť",
      "Ab3kZ9xQ2m.",
      "„Ab3kZ9xQ2m“",
      "kód je Ab3kZ9xQ2m, díky",
      "Tady je kód Ab3k Z9xQ 2m (platí týden)",
      // celá zpráva z tlačítka „Kopírovat zprávu“ – název dílu obsahuje #
      "Mnástrojárna CAD – sdílený dokument „Příruba #2“ (platí do 24. 11. 2026):\nhttps://mnastrojarna.cz/s#Ab3kZ9xQ2m\n\nOtevře se v prohlížeči bez instalace (Chrome, Edge, Firefox, Safari).",
    ];
    for (const t of inputs) {
      expect(parseShareInput(t), t).toEqual(CODE);
      expect(shareInputHash(t), t).toBe("#Ab3kZ9xQ2m");
    }
    // starší odkaz uprostřed textu: část za # až po první mezeru
    const old = "odkaz https://www.mnastrojarna.cz/cad#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA a heslo zvlášť";
    expect(parseShareInput(old)).toEqual({ kind: "self", id: "Ab12345678", key: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect(shareInputHash(old)).toBe("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA");
    expect(shareInputHash("nic")).toBeNull();
    // kód slepený s dalším písmenem nebo číslicí (i s diakritikou) kódem není
    for (const t of ["Ab3kZ9xQ2mž", "xAb3kZ9xQ2m9", "kódAb3kZ9xQ2m9"]) expect(parseShareInput(t), t).toBeNull();
  });

  it("proč zadání není kód: délka, znak mimo abecedu (0 O I l), obecná nápověda", () => {
    // (revize: desetimístné zadání s 0 nebo O dostalo jen „Kód má 10 znaků…“)
    expect(shareCodeProblem("Ab3kZ9xQ0m")).toMatch(/znak „0“.*0 \(nula\), O \(velké o\), I \(velké i\) a l \(malé L\)/);
    expect(shareCodeProblem("AB3KZ9XQOM")).toMatch(/znak „O“/);
    expect(shareCodeProblem("Ab3k Z9xQ Il")).toMatch(/znak „I“, „l“/);
    expect(shareCodeProblem("Ab3kZ9xQ2")).toMatch(/Kód má 10 znaků, zadáno je 9/);
    expect(shareCodeProblem("Ab3k Z9xQ 2mm")).toMatch(/zadáno je 11/);
    expect(shareCodeProblem("nesmysl")).toMatch(/zadáno je 7/);
    expect(shareCodeProblem("ahoj")).toMatch(/^Kód má 10 znaků \(písmena a číslice/);
    expect(shareCodeProblem("https://mnastrojarna.cz/s")).toMatch(/^Kód má 10 znaků \(písmena a číslice/);
    // část za #: jen to, co vypadá jako pokus o kód (8–12 písmen a číslic); jiné kotvy stránky se neřeší
    expect(shareCodeProblem("#Ab3kZ9xQ0m", true)).toMatch(/znak „0“/);
    expect(shareCodeProblem("#JYCWWOFHWW", true)).toMatch(/znak „O“/);
    expect(shareCodeProblem("#Ab3kZ9xQ2", true)).toMatch(/zadáno je 9/);
    expect(shareCodeProblem("#Ab3kZ9xQ2%22", true)).toMatch(/zadáno je 9/);
    expect(shareCodeProblem("#Ab3kZ9xQ2mm", true)).toMatch(/zadáno je 11/);
    for (const h of ["#app", "#", "", "#q=x", "#x=Ab3kZ9xQ2m", "#Ab3kZ9xQ2m-modelovani", "#/cad/share", "#dokumentace-k-cadu", "#dokumentace", "#jak-na-to-1", "#prehled12-a", "#Ab3k-Z9xQ2"]) expect(shareCodeProblem(h, true), h).toBeNull();
  });

  it("hlášení „nenalezeno“ u odkazu s kódem upozorní na překlep a velikost písmen; zneplatněný a nezabezpečený odkaz mají vlastní text", () => {
    // (revize: kód s jinou velikostí písmen dostal zavádějící „už v úložišti není (platnost vypršela nebo byl smazán)“)
    expect(openErrorText("notfound", null, "code")).toMatch(/Zkontrolujte kód – záleží na velikosti písmen a znaky 0, O, I a l/);
    expect(openErrorText("notfound")).toMatch(/už v úložišti není/);
    expect(openErrorText("notfound", null, "self")).toMatch(/už v úložišti není/);
    expect(openErrorText("revoked")).toMatch(/Odesílatel tento sdílený odkaz zneplatnil/);
    expect(openErrorText("insecure")).toMatch(/https:\/\//);
    expect(openErrorText("expired", Date.UTC(2026, 10, 24))).toMatch(/vypršela \(.*2026/);
  });

  /** spustí skript stránky nad napodobenou adresou; vrátí, co odložil, čím nahradil adresu a kam případně přešel */
  const runStash = (hash: string, o: { search?: string; protocol?: string; port?: string; secure?: boolean } = {}) => {
    const store = new Map<string, string>();
    let replaced: string | null = null;
    let navigated: string | null = null;
    vm.runInNewContext(SHARE_STASH_SCRIPT, {
      location: { hash, pathname: "/cad", search: o.search ?? "?x=1", protocol: o.protocol ?? "https:", port: o.port ?? "", host: "www.mnastrojarna.cz" + (o.port ? ":" + o.port : ""), replace: (u: string) => void (navigated = u) },
      window: { isSecureContext: o.secure ?? true },
      sessionStorage: { setItem: (k: string, v: string) => void store.set(k, v) },
      history: { replaceState: (_s: unknown, _t: string, url: string) => void (replaced = url) },
      decodeURIComponent,
    });
    return { stashed: store.get("mn-cad-share") ?? null, replaced, navigated };
  };

  it("skript stránky odloží právě to, co parseShareHash rozpozná jako kód (a starší #s= / #q= / #r=)", () => {
    const hashes = ["#Ab3kZ9xQ2m", "#Ab3kZ9xQ2m).", "#Ab3kZ9xQ2m'", "#Ab3kZ9xQ2m%22", "#Ab3kZ9xQ2m%3E", "#Ab3kZ9xQ2m**", "#Ab3kZ9xQ2m%20", "#Ab3kZ9xQ2m/", "#Ab3kZ9xQ2", "#Ab3kZ9xQ2mm", "#Ab3kZ9xQ0m", "#Ab3kZ9xQlm", "#app", "#dokumentace", "", "#", "#Ab3kZ9xQ2m/x", "#Ab3kZ9xQ2m=1", "#x=Ab3kZ9xQ2m", "#1111111111", "#zzzzzzzzzz", "#parametric-modeling"];
    for (const h of hashes) {
      const p = parseShareHash(h);
      const isCode = p?.kind === "code";
      const r = runStash(h);
      // odkládá se jen čistý kód (bez přilepené interpunkce)
      expect(r.stashed, JSON.stringify(h)).toBe(isCode ? `#${p.code}` : null);
      // adresa se zbaví části za # (cesta a dotaz zůstanou)
      expect(r.replaced, JSON.stringify(h)).toBe(isCode ? "/cad?x=1" : null);
      expect(r.navigated).toBeNull();
    }
    for (const h of ["#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA", "#s=1d.abc", "#r=d10~abc.def"]) expect(runStash(h).stashed).toBe(h);
    // zdroj výrazu pro kód je tentýž jako v rozboru
    expect(new RegExp(SHARE_CODE_HASH_SRC).exec("Ab3kZ9xQ2m).")?.[1]).toBe("Ab3kZ9xQ2m");
    // skript nesmí obsahovat nic, co by ukončilo <script> nebo potřebovalo escapovat v HTML
    expect(SHARE_STASH_SCRIPT).not.toMatch(/<\/|<!--|\n/);
  });

  it("skript stránky: s odloženým odkazem zmizí z adresy i ?kod=1 (příchod přes /s#KÓD); bez kódu ?kod=1 zůstane pro aplikaci", () => {
    expect(runStash("#Ab3kZ9xQ2m", { search: "?kod=1" })).toEqual({ stashed: "#Ab3kZ9xQ2m", replaced: "/cad", navigated: null });
    expect(runStash("#Ab3kZ9xQ2m", { search: "?kod=1&utm=a" }).replaced).toBe("/cad?utm=a");
    expect(runStash("#Ab3kZ9xQ2m", { search: "?utm=a&kod=1" }).replaced).toBe("/cad?utm=a");
    expect(runStash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA", { search: "?kod=1" }).replaced).toBe("/cad");
    expect(runStash("#Ab3kZ9xQ2m", { search: "?kod=12" }).replaced).toBe("/cad?kod=12");
    expect(runStash("", { search: "?kod=1" })).toEqual({ stashed: null, replaced: null, navigated: null });
    expect(runStash("#Ab3kZ9xQ0m", { search: "?kod=1" })).toEqual({ stashed: null, replaced: null, navigated: null });
  });

  it("skript stránky: na http:// (bez WebCrypto) přejde se sdíleným odkazem nebo žádostí o kód na https:// i s částí za #", () => {
    // (revize: na http:// se platný kód hlásil jako neplatný odkaz a sdílení končilo chybou JavaScriptu)
    const http = { protocol: "http:", secure: false };
    expect(runStash("#Ab3kZ9xQ2m", { ...http, search: "?kod=1" })).toEqual({ stashed: null, replaced: null, navigated: "https://www.mnastrojarna.cz/cad?kod=1#Ab3kZ9xQ2m" });
    expect(runStash("#Ab3kZ9xQ2m).", { ...http, search: "" }).navigated).toBe("https://www.mnastrojarna.cz/cad#Ab3kZ9xQ2m).");
    expect(runStash("#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA", { ...http, search: "" }).navigated).toBe("https://www.mnastrojarna.cz/cad#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA");
    expect(runStash("", { ...http, search: "?kod=1" }).navigated).toBe("https://www.mnastrojarna.cz/cad?kod=1");
    // bez sdíleného odkazu se nikam nepřechází (běžná návštěva CADu na http zůstává, jak byla)
    expect(runStash("", { ...http, search: "" })).toEqual({ stashed: null, replaced: null, navigated: null });
    expect(runStash("#app", { ...http, search: "" }).navigated).toBeNull();
    // jiný než výchozí port (https tam nejspíš neběží) a zabezpečený kontext (http://localhost) se nepřepínají – odkaz se odloží
    expect(runStash("#Ab3kZ9xQ2m", { ...http, port: "8080", search: "" })).toEqual({ stashed: "#Ab3kZ9xQ2m", replaced: "/cad", navigated: null });
    expect(runStash("#Ab3kZ9xQ2m", { protocol: "http:", secure: true, search: "" })).toEqual({ stashed: "#Ab3kZ9xQ2m", replaced: "/cad", navigated: null });
  });

  it("adresa téže stránky přes https (pro přechod z http://): jen na výchozím portu", () => {
    vi.stubGlobal("location", { protocol: "http:", port: "", host: "www.mnastrojarna.cz", pathname: "/cad/", search: "" });
    expect(shareHttpsUrl("#Ab3kZ9xQ2m")).toBe("https://www.mnastrojarna.cz/cad/#Ab3kZ9xQ2m");
    vi.stubGlobal("location", { protocol: "http:", port: "3000", host: "192.168.1.5:3000", pathname: "/cad", search: "" });
    expect(shareHttpsUrl("#Ab3kZ9xQ2m")).toBeNull();
    vi.stubGlobal("location", { protocol: "https:", port: "", host: "www.mnastrojarna.cz", pathname: "/cad", search: "" });
    expect(shareHttpsUrl("#Ab3kZ9xQ2m")).toBeNull();
  });
});

describe("základ a délka odkazu", () => {
  const CODE = "Ab3kZ9xQ2m";
  it("produkce: https://mnastrojarna.cz/s#KÓD = 36 znaků (28 bez https://), část za doménou 13 znaků; EN/DE do 40", () => {
    const cs = `${shareShortBase("https://www.mnastrojarna.cz/cad")}#${CODE}`;
    expect(cs).toBe("https://mnastrojarna.cz/s#Ab3kZ9xQ2m");
    expect(cs.length).toBe(36);
    expect(cs.replace(/^https:\/\//, "").length).toBe(28);
    expect(cs.slice("https://mnastrojarna.cz".length).length).toBe(13);
    const en = `${shareShortBase("https://www.mnastrojarna.cz/en/cad")}#${CODE}`;
    const de = `${shareShortBase("https://www.mnastrojarna.cz/de/cad")}#${CODE}`;
    expect(en).toBe("https://mnastrojarna.cz/en/s#Ab3kZ9xQ2m");
    expect(de).toBe("https://mnastrojarna.cz/de/s#Ab3kZ9xQ2m");
    for (const u of [cs, en, de]) expect(u.length).toBeLessThanOrEqual(40);
    // statický export (lomítko na konci) a už holá doména
    expect(shareShortBase("https://www.mnastrojarna.cz/cad/")).toBe("https://mnastrojarna.cz/s");
    expect(shareShortBase("https://mnastrojarna.cz/cad")).toBe("https://mnastrojarna.cz/s");
  });

  it("„www.“ se vynechá JEN u www.mnastrojarna.cz; jiné weby a porty zůstávají", () => {
    expect(shareShortBase("https://www.example.com/cad")).toBe("https://www.example.com/s");
    expect(shareShortBase("https://nahled.vercel.app/de/cad")).toBe("https://nahled.vercel.app/de/s");
    expect(shareShortBase("http://localhost:3431/en/cad")).toBe("http://localhost:3431/en/s");
    expect(shareShortBase("https://www.mnastrojarna.cz.evil.example/cad")).toBe("https://www.mnastrojarna.cz.evil.example/s");
    // stránka mimo /cad: kód za její vlastní adresou (stránka CADu přijme #KÓD přímo)
    expect(shareShortBase("https://www.mnastrojarna.cz/cad/dokumentace")).toBe("https://www.mnastrojarna.cz/cad/dokumentace");
    expect(shareShortBase("/cad")).toBe("/cad");
  });

  it("bez zadané stránky: aktuální adresa (location)", () => {
    vi.stubGlobal("location", { origin: "https://www.mnastrojarna.cz", pathname: "/en/cad", hash: "" });
    expect(shareShortBase()).toBe("https://mnastrojarna.cz/en/s");
  });

  it("NEXT_PUBLIC_CAD_SHARE_SHORT: kratší doména zkrátí odkaz (≤ 20 znaků bez https:// u domény do 8 znaků); EN/DE mají vlastní proměnné", () => {
    process.env.NEXT_PUBLIC_CAD_SHARE_SHORT = "https://mncad.cz/";
    const u = `${shareShortBase("https://www.mnastrojarna.cz/cad")}#${CODE}`;
    expect(u).toBe("https://mncad.cz/#Ab3kZ9xQ2m");
    expect(u.replace(/^https:\/\//, "").length).toBe(20);
    // jazykové verze bez vlastní proměnné zůstávají na webu (příjemce dostane rozhraní ve stejném jazyce)
    expect(shareShortBase("https://www.mnastrojarna.cz/en/cad")).toBe("https://mnastrojarna.cz/en/s");
    process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_EN = " https://mncad.cz/en ";
    process.env.NEXT_PUBLIC_CAD_SHARE_SHORT_DE = "https://mncad.cz/de#";
    expect(shareShortBase("https://www.mnastrojarna.cz/en/cad")).toBe("https://mncad.cz/en");
    expect(shareShortBase("https://www.mnastrojarna.cz/de/cad")).toBe("https://mncad.cz/de");
    // neplatná hodnota (není http/https adresa) se ignoruje
    process.env.NEXT_PUBLIC_CAD_SHARE_SHORT = "mncad.cz/s";
    expect(shareShortBase("https://www.mnastrojarna.cz/cad")).toBe("https://mnastrojarna.cz/s");
  });
});
