/**
 * In-process transport CAD jádra (CAD-HEADLESS-NAVRH.md kap. 2.2, 2.3, balík B1): jádro (`kernel-ops.ts` `handleKernel`)
 * běží ve stejném vlákně jako klient – ve vlákně běhu CLI / `mncad serve` (`worker_threads`) a v testech v Node.
 *
 * * Zprávy obou směrů se kopírují `structuredClone` (s přenosem bufferů) jako u `postMessage` Web Workeru: klient a jádro
 *   nesdílí objekty, výsledky se chovají stejně jako v prohlížeči. Požadavek se obslouží v mikroúloze (ne uvnitř `post`),
 *   souběžné požadavky se prolínají v místech `await` stejně jako ve workeru.
 * * Data importů (`mnblob:`) se neposílají – klient i jádro sdílí ve vlákně jedno úložiště blobů (`sharedBlobs`).
 * * Zrušit výpočet nejde (`cancellable: false`): volání WASM jsou synchronní ve stejném vlákně; přeruší je jen hlídač
 *   vlákna (`terminate()` celého vlákna běhu, cli/watchdog.ts).
 * * Nová instance po pádu WASM (`fatal`): klient ukončí starou instanci (její další zprávy se zahodí) a příští požadavek
 *   spustí novou – až doběhnou obsluhy staré instance, `resetKernel()` zahodí stav a mezipaměti s tělesy staré instance a
 *   OCCT se načte znovu (generace + 1).
 *
 * * `restart: false` (vlákno běhu CLI): po pádu se nová instance OCCT ve vlákně nespouští – další požadavky hned skončí
 *   chybou pádu a vlákno ukončí hlídač (kód 4); druhé OCCT by se jen zbytečně načítalo do vlákna, které stejně končí.
 *
 * Stav jádra je modulový, proto ve vlákně běží nejvýš jedna instance jádra (jako jeden worker na instanci v prohlížeči).
 */
import { tr } from "./i18n";
import { configureKernel, handleKernel, resetKernel, type KernelInit } from "./kernel-ops";
import type { KernelInstance, KernelTransport, KernelTransportEvents } from "./kernel-client";
import type { KernelMsg } from "./kernel-protocol";

/** volby in-process transportu: načtení jádra (`locateFile`) a nová instance po pádu */
export type InProcessOptions = KernelInit & {
  /**
   * false = po pádu WASM se nová instance OCCT ve vlákně nespouští: každý další požadavek hned skončí chybou pádu (vlákno
   * běhu CLI, které po pádu ukončí hlídač). Výchozí true – nová instance s `resetKernel()` (testy, jiní hostitelé).
   */
  restart?: boolean;
};

export type InProcessTransport = KernelTransport & {
  /** zkušební závada: doručí zprávu běžící instanci, jako by ji poslalo jádro (`MNCAD_TEST_FAULT=fatal`) */
  inject(m: KernelMsg): void;
};

/** předchozí instance ve vlákně byla ukončena (pád) – další musí začít s novou instancí OCCT */
let stale = false;
/** běžící obsluhy požadavků ve vlákně (všech instancí) – nová instance začne, až doběhnou obsluhy ukončené instance */
const running = new Set<Promise<void>>();

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** In-process transport. `o.locateFile` = kde emscripten najde `replicad_single.wasm` (výchozí: vedle modulu / svazku). */
export function inProcessTransport(o: InProcessOptions = {}): InProcessTransport {
  if (o.locateFile) configureKernel({ locateFile: o.locateFile });
  let cur: { alive: boolean; on: KernelTransportEvents } | null = null;
  /** poslední pád instance tohoto transportu (původní chyba) */
  let lastCrash: string | null = null;
  /** instance tohoto transportu skončila po pádu – s `restart: false` se už žádná nová nespouští */
  let ended = false;
  return {
    sharedBlobs: true,
    cancellable: false,
    spawn(on): KernelInstance {
      if (ended && o.restart === false) {
        // bez nové instance OCCT: požadavky skončí chybou pádu (asynchronně, jako odpověď jádra)
        const why = tr("Jádro CAD spadlo ({0}) a ve vlákně běhu se znovu nespouští.", (lastCrash ?? "").slice(0, 120));
        const dead = { alive: true };
        cur = null;
        return {
          post(msg) {
            queueMicrotask(() => dead.alive && on.message({ id: msg.id, ok: false, error: why }));
          },
          terminate() {
            dead.alive = false;
          },
        };
      }
      // stav jádra je modulový: obsluhy ukončené instance (synchronní WASM nejde přerušit, jen jejich zprávy se zahodí) musí
      // doběhnout dřív, než `resetKernel()` připraví novou instanci, jinak by do ní zapsaly tělesa staré instance OCCT
      let start: Promise<void> = Promise.resolve();
      if (stale) {
        stale = false;
        start = Promise.allSettled([...running]).then(() => {
          try {
            resetKernel();
          } catch {
            /* zbytky staré instance – nová se načte i tak */
          }
        });
      }
      const me = { alive: true, on };
      cur = me;
      const deliver = (m: KernelMsg, transfer?: Transferable[]) => {
        if (!me.alive) return;
        if (m.fatal) lastCrash = m.error ?? "";
        const copy = structuredClone(m, transfer?.length ? { transfer } : undefined);
        on.message(copy);
      };
      return {
        post(msg) {
          const copy = structuredClone(msg);
          void start.then(() => {
            if (!me.alive) return;
            const job = handleKernel(copy, deliver).catch((e) => {
              if (!me.alive) return;
              lastCrash = errText(e);
              on.error(lastCrash);
            });
            running.add(job);
            void job.finally(() => running.delete(job));
          });
        },
        terminate() {
          if (!me.alive) return;
          me.alive = false;
          stale = true;
          ended = true;
        },
      };
    },
    inject(m) {
      if (!cur?.alive) return;
      if (m.fatal) lastCrash = m.error ?? "";
      cur.on.message(m);
    },
  };
}
