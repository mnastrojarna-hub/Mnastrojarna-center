/**
 * Pracovní prostor v paměti (Node, `mncad run`, relace `mncad serve`) – implementace portu `Workspace` bez Reactu.
 *
 * Chování odpovídá záložkám aplikace (cad-app.tsx `commit`, `openDocInTab`, `activateTab`, `closeTab`):
 * * každý otevřený dokument projde `normalizeDraftDoc(internBlobs(d))` (data importů → úložiště blobů, 2D výkres doplněný);
 * * historie zpět je na záložku a má nejvýš `HISTORY_MAX` (80) kroků;
 * * prázdná záložka se znovu použije jen pro úvodní prázdný díl relace – dokument vytvořený během ji nikdy nepřepíše
 *   (oprava tiché ztráty prázdné sestavy, CAD-HEADLESS-NAVRH.md 5.2 č. 14);
 * * relace (`save` / `loadWorkspace`) nese dokumenty všech záložek s daty importů (`embedBlobs`), bez historie.
 */
import { b64ToBytes, embedBlobs, internBlobs, putBlobAs, type SavedDoc } from "../blobs";
import { docHasContent, docTabKind, normalizeDraftDoc } from "../draft/doc";
import { tr } from "../i18n";
import { emptyDoc, uid, type CadDoc } from "../types";
import { HISTORY_MAX, newAsmCaches, type AsmCaches, type DocKey, type TabInfo, type Workspace } from "./workspace";

type Hist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };
type Tab = {
  id: DocKey;
  docId: string;
  hist: Hist;
  /** úvodní prázdný díl relace – jediná záložka, kterou smí `openInTab` znovu použít */
  initial: boolean;
  /** číslo běhu, ve kterém záložka vznikla (0 = mimo běh) */
  run: number;
  /** pořadí vzniku (pro „nejnovější dokument běhu“) */
  seq: number;
};

/** soubor relace (`session.mncad-ws`, paměť `mncad serve`) */
export type SessionFile = {
  v: 1;
  /** dokumenty záložek (data importů ve společné mapě `blobs`, starší tvar s `blobs` v dokumentu se čte také) */
  tabs: SavedDoc[];
  /** index aktivní záložky */
  active: number;
  ids?: string[];
  docIds?: string[];
  /** indexy záložek, které jsou stále úvodním prázdným dílem */
  initial?: number[];
  blobs?: Record<string, string>;
};

const isPartDoc = (d: CadDoc) => d.kind !== "assembly" && d.kind !== "draft";
const fold = (s: string) => s.trim().toLowerCase();
const steps = (n: number) => (Number.isFinite(n) || n === Infinity ? Math.max(0, Math.trunc(n)) : 0);

export class MemoryWorkspace implements Workspace {
  private list: Tab[] = [];
  private activeId: DocKey = "";
  private runNo = 0;
  private seq = 0;
  readonly asm: AsmCaches = newAsmCaches();

  /** nový prostor s jednou záložkou – úvodním prázdným dílem (jako aplikace po startu); `empty` = bez záložek */
  constructor(o: { empty?: boolean } = {}) {
    if (!o.empty) this.activeId = this.addTab(emptyDoc(), { initial: true }).id;
  }

  private addTab(d: CadDoc, o: { id?: string; docId?: string; initial?: boolean } = {}): Tab {
    const id = o.id && !this.list.some((t) => t.id === o.id) ? o.id : uid();
    const t: Tab = { id, docId: o.docId ?? uid(), hist: { past: [], present: d, future: [] }, initial: !!o.initial, run: this.runNo, seq: ++this.seq };
    this.list.push(t);
    return t;
  }
  private active(): Tab {
    let t = this.list.find((x) => x.id === this.activeId);
    if (!t) {
      t = this.list[0] ?? this.addTab(emptyDoc(), { initial: true });
      this.activeId = t.id;
    }
    return t;
  }
  private tab(id: DocKey): Tab {
    const t = this.list.find((x) => x.id === id);
    if (!t) throw new Error(tr("záložka „{0}“ neexistuje – otevřené: {1}", id, this.list.map((x) => x.hist.present.name).join(", ") || "—"));
    return t;
  }

  /** začátek běhu skriptu: dokumenty vzniklé od teď mají v `findPart` přednost (jako `madeDocs` v aplikaci) */
  beginRun(): void {
    this.runNo++;
  }

  present(): CadDoc {
    return this.active().hist.present;
  }

  commit(d: CadDoc): void {
    const t = this.active();
    t.hist = { past: [...t.hist.past, t.hist.present].slice(-HISTORY_MAX), present: d, future: [] };
    t.initial = false;
  }

  async openInTab(d0: CadDoc, o: { docId?: string; reuseEmpty?: boolean } = {}): Promise<{ id: DocKey; reused: boolean }> {
    const d = normalizeDraftDoc(internBlobs(d0));
    const cur = this.list.find((x) => x.id === this.activeId);
    if (cur && o.reuseEmpty !== false && cur.initial && isPartDoc(cur.hist.present) && !docHasContent(cur.hist.present)) {
      // úvodní prázdný díl: dokument do této záložky jedním krokem historie (zpět vrátí prázdný díl) – jako aplikace
      this.commit(d);
      cur.docId = o.docId ?? uid();
      cur.run = this.runNo;
      cur.seq = ++this.seq;
      return { id: cur.id, reused: true };
    }
    const t = this.addTab(d, { docId: o.docId });
    this.activeId = t.id;
    return { id: t.id, reused: false };
  }

  tabs(): TabInfo[] {
    return this.list.map((t) => ({ id: t.id, title: t.hist.present.name, kind: docTabKind(t.hist.present), active: t.id === this.activeId }));
  }

  async activate(id: DocKey): Promise<CadDoc> {
    const t = this.tab(id);
    this.activeId = t.id;
    return t.hist.present;
  }

  async close(id: DocKey): Promise<CadDoc> {
    const t = this.tab(id);
    const idx = this.list.indexOf(t);
    this.list.splice(idx, 1);
    if (!this.list.length) {
      this.activeId = this.addTab(emptyDoc(), { initial: true }).id; // jako aplikace: vždy aspoň jedna záložka
    } else if (t.id === this.activeId) {
      this.activeId = this.list[Math.min(Math.max(0, idx - 1), this.list.length - 1)].id;
    }
    return this.present();
  }

  undo(n: number): { moved: number } {
    const t = this.active();
    const h = t.hist;
    let moved = 0;
    const want = steps(n);
    while (moved < want && h.past.length) {
      h.future.unshift(h.present);
      h.present = h.past.pop()!;
      moved++;
    }
    return { moved };
  }

  redo(n: number): { moved: number } {
    const t = this.active();
    const h = t.hist;
    let moved = 0;
    const want = steps(n);
    while (moved < want && h.future.length) {
      h.past.push(h.present);
      h.present = h.future.shift()!;
      moved++;
    }
    if (h.past.length > HISTORY_MAX) h.past.splice(0, h.past.length - HISTORY_MAX);
    return { moved };
  }

  findPart(name: string): CadDoc | null {
    const key = fold(name);
    const match = (t: Tab) => isPartDoc(t.hist.present) && fold(t.hist.present.name) === key;
    if (this.runNo > 0) {
      const made = this.list.filter((t) => t.run === this.runNo && match(t)).sort((a, b) => b.seq - a.seq)[0];
      if (made) return made.hist.present;
    }
    return this.list.find(match)?.hist.present ?? null;
  }

  freshName(base: string): string {
    const taken = new Set(this.list.map((t) => t.hist.present.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  /** počet kroků zpět / znovu aktivní záložky (diagnostika, testy) */
  historyDepth(): { undo: number; redo: number } {
    const h = this.active().hist;
    return { undo: h.past.length, redo: h.future.length };
  }

  save(): Uint8Array {
    const blobs: Record<string, string> = {};
    const tabs = this.list.map((t) => {
      const s = embedBlobs(t.hist.present);
      if (!s.blobs) return s;
      Object.assign(blobs, s.blobs);
      const { blobs: _b, ...rest } = s;
      void _b;
      return rest as SavedDoc;
    });
    const file: SessionFile = {
      v: 1,
      tabs,
      active: Math.max(0, this.list.findIndex((t) => t.id === this.activeId)),
      ids: this.list.map((t) => t.id),
      docIds: this.list.map((t) => t.docId),
      initial: this.list.flatMap((t, i) => (t.initial ? [i] : [])),
      ...(Object.keys(blobs).length ? { blobs } : {}),
    };
    return new TextEncoder().encode(JSON.stringify(file));
  }

  /**
   * Relace ze `save()`: data importů do úložiště blobů, každý dokument `normalizeDraftDoc(internBlobs(d))`. Historie začíná
   * prázdná. Neplatná relace (záložka bez názvu, seznam prvků nebo komponent jiného typu, data importu mimo base64) skončí
   * lokalizovanou chybou ještě před změnou úložiště blobů – nikdy pozdějším pádem v `findPart` / `save`.
   */
  static load(bytes: Uint8Array): MemoryWorkspace {
    let f: SessionFile;
    try {
      f = JSON.parse(new TextDecoder().decode(bytes)) as SessionFile;
    } catch {
      throw new Error(tr("soubor relace není platný JSON"));
    }
    if (!f || typeof f !== "object" || f.v !== 1 || !Array.isArray(f.tabs)) throw new Error(tr("neznámý formát relace (očekáváno v: 1 a seznam záložek)"));
    const docs = f.tabs.map((raw, i): SavedDoc => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(tr("záložka {0} v relaci není dokument", i + 1));
      if (typeof raw.name !== "string") throw new Error(tr("záložka {0} v relaci nemá název dokumentu (text)", i + 1));
      for (const k of ["features", "components"] as const)
        if (raw[k] !== undefined && !Array.isArray(raw[k])) throw new Error(tr("záložka {0} v relaci má neplatný seznam „{1}“", i + 1, k));
      return { ...raw, features: raw.features ?? [] };
    });
    const blobs: [string, Uint8Array][] = [];
    if (f.blobs !== undefined && (!f.blobs || typeof f.blobs !== "object" || Array.isArray(f.blobs))) throw new Error(tr("data importů v relaci nejsou mapa id → base64"));
    for (const [id, b64] of Object.entries(f.blobs ?? {})) {
      let data: Uint8Array | null = null;
      if (typeof b64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(b64) && b64.length % 4 !== 1)
        try {
          data = b64ToBytes(b64);
        } catch {
          data = null;
        }
      if (!data) throw new Error(tr("data importu „{0}“ v relaci nejsou platné base64", id));
      blobs.push([id, data]);
    }
    for (const [id, data] of blobs) putBlobAs(id, data);
    const ws = new MemoryWorkspace({ empty: true });
    docs.forEach((doc, i) => {
      ws.addTab(normalizeDraftDoc(internBlobs(doc)), { id: f.ids?.[i], docId: f.docIds?.[i], initial: !!f.initial?.includes(i) });
    });
    if (!ws.list.length) ws.addTab(emptyDoc(), { initial: true });
    const a = Number.isInteger(f.active) ? Math.min(Math.max(0, f.active), ws.list.length - 1) : 0;
    ws.activeId = ws.list[a].id;
    return ws;
  }
}

/** relace ze souboru / paměti serveru (viz `MemoryWorkspace.load`) */
export const loadWorkspace = (bytes: Uint8Array): MemoryWorkspace => MemoryWorkspace.load(bytes);
