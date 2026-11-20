"use client";

/**
 * Průvodce „Kola a ozubení“: galerie druhů → JEDNA tabulka druhu (výchozí hodnoty, jednotky, nápověda s normou, hláška
 * u řádku, spočtené řádky) → živý 2D náhled (+ 3D náhled na požádání) → Vytvořit. Výsledek = jeden prvek historie
 * `gear.<druh>`, jehož formulář úprav je TATÁŽ tabulka (register.tsx). Režim Soukolí vytvoří dvě kola a sestavu s vazbou.
 *
 * Cíl: nový uživatel má kolo za 3 kliknutí a 2 čísla (pás karet › Kola a ozubení → dlaždice → modul, počet zubů → Vytvořit).
 * Otevřený díl → prvek se připojí na konec historie (`commit`); sestava, 2D výkres nebo volba „Jako nový díl“ → skript
 * existujících textových příkazů přes `runText` (nová záložka). Chyby běhu (✗) se ukážou v patičce, průvodce zůstane otevřený.
 *
 * Volá se `openGearWizard(api, { kind?, data?, pair? })` odkudkoli (pás karet, paleta Ctrl+K, úvodní obrazovka, knihovna
 * normálií); hostitel se připojí sám jako ask-dialog (samostatný kořen Reactu – bez prvku v cad-app.tsx).
 * Automatizace: `[data-gear-wizard]`, `[data-gear-kind]`, `[data-gear-row]`, `[data-gear-calc]`, `[data-gear-out]`,
 * `[data-gear-target]`, `[data-gear-op]`, `[data-gear-create]`, `[data-gear-create-next]`, `[data-gear-cancel]`,
 * `[data-gear-back]`, `[data-gear-pair-open]`, `[data-gear-pair-create]`, `[data-gear-error]`, `[data-gear-3d]`.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cad } from "@/cad/client";
import { tr } from "@/cad/i18n";
import { KINDS, type GearData, type GearKind, type PairKind } from "@/cad/gears";
import { emptyDoc, uid, type BuildResult, type CadDoc, type Feature } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "../cad-icons";
import { MiniViewport } from "../mini-viewport";
import { Btn, Modal, Segmented } from "../ui";
import { GearGallery } from "./gear-gallery";
import { GearPairPanel } from "./gear-pair";
import { GearPreview } from "./gear-preview";
import { GearTable } from "./gear-table";
import { currentData, currentPair, evaluate, featureData, gearLine, gearName, initState, isPart, loadLast, partHasBody, planCreate, planPair, protocolErrors, saveLast, wizardReducer, type Op, type OutMode, type Target } from "./wizard-state";

/** co průvodce potřebuje od aplikace (podmnožina ExtActionApi) */
export type GearWizardApi = {
  doc: CadDoc;
  commit: (d: CadDoc) => void;
  flash: (m: string) => void;
  /** spustí textové příkazy jako konzole (nový díl, sestava…); bez něj průvodce kola jen přidává do otevřeného dílu */
  runText?: (text: string) => Promise<string>;
};
export type GearWizardOpts = { kind?: GearKind; data?: GearData; pair?: boolean | PairKind };

type Req = GearWizardOpts & { id: number; api: GearWizardApi; resolve: () => void };
let seq = 0;
let host: ((r: Req) => void) | null = null;
const waiting: Req[] = [];
let mounting = false;
let open = 0;
/** je průvodce otevřený (zkratky aplikace počkají) */
export const gearWizardBusy = () => open > 0;

/** Otevře průvodce; promise se splní po zavření (vytvořeno i zrušeno). */
export function openGearWizard(api: GearWizardApi, o: GearWizardOpts = {}): Promise<void> {
  return new Promise((resolve) => {
    open++;
    const req: Req = {
      ...o,
      api,
      id: ++seq,
      resolve: () => {
        open = Math.max(0, open - 1);
        resolve();
      },
    };
    if (host) return host(req);
    if (typeof document === "undefined") return req.resolve();
    waiting.push(req);
    if (mounting) return;
    mounting = true;
    void import("react-dom/client")
      .then(({ createRoot }) => {
        const el = document.createElement("div");
        el.setAttribute("data-gear-wizard-root", "");
        document.body.appendChild(el);
        createRoot(el).render(<GearWizardHost />);
      })
      .catch(() => {
        mounting = false;
        for (const r of waiting.splice(0)) r.resolve();
      });
  });
}

function GearWizardHost() {
  const [req, setReq] = useState<Req | null>(null);
  const cur = useRef<Req | null>(null);
  useEffect(() => {
    host = (r) => {
      if (cur.current) return r.resolve(); // druhý průvodce přes otevřený se neotevře
      cur.current = r;
      setReq(r);
    };
    for (const r of waiting.splice(0)) host(r);
    return () => {
      host = null;
    };
  }, []);
  if (!req) return null;
  return (
    <GearWizard
      key={req.id}
      api={req.api}
      opts={req}
      onClose={() => {
        cur.current = null;
        req.resolve();
        setReq(null);
      }}
    />
  );
}

/** tělo dočasného dílu pro 3D náhled (jen kolo, bez umístění) */
const previewDoc = (kind: GearKind, data: GearData, out: OutMode): CadDoc => ({ ...emptyDoc("náhled"), features: [{ id: uid(), name: gearName(kind, data), type: "ext", ext: KINDS[kind].ext, data: { ...featureData({ kind, data, out: out === "teeth" ? "wheel" : out, op: "new", target: "this" }, false), position: [0, 0, 0], positionRef: undefined, axis: { kind: "axis", axis: "Z" }, turn: 0 } } as Feature] });

export function GearWizard({ api, opts, onClose }: { api: GearWizardApi; opts: GearWizardOpts; onClose: () => void }) {
  const [s, dispatch] = useReducer(wizardReducer, opts, (o) => {
    const init = o.kind ? initState({ kind: o.kind, data: { ...(o.data ? {} : loadLast(o.kind)), ...(o.data ?? {}) }, pair: o.pair }) : initState({ pair: o.pair });
    return init;
  });
  // dokument, do kterého se přidává (po „Vytvořit a další“ už obsahuje předchozí kolo)
  const docRef = useRef(api.doc);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const kind = s.kind;
  const def = KINDS[kind];
  // stabilní objekt dat (výchozí tabulka se jinak tvoří při každém vykreslení)
  const data = useMemo(() => currentData(s), [s.values, kind]); // eslint-disable-line react-hooks/exhaustive-deps -- currentData čte jen s.values a s.kind
  const ev = useMemo(() => evaluate(kind, data), [kind, data]);
  const pairData = useMemo(() => currentPair(s), [s.pairValues, s.pairKind]); // eslint-disable-line react-hooks/exhaustive-deps -- currentPair čte jen tyto dvě části stavu
  const part = isPart(docRef.current);
  const hasBody = partHasBody(docRef.current);
  // výstup „zuby do tělesa“ jen do dílu s tělesem; jinak hotové kolo
  const out: OutMode = s.out === "teeth" && !(part && hasBody && s.target === "this") ? "wheel" : s.out;
  const target: Target = part ? s.target : "new";
  const textOnly = target === "new" || !part;
  const canText = !!api.runText;

  useEffect(() => setErrors((e) => (e.length ? [] : e)), [kind, data, s.view]);

  const pick = (k: GearKind) => dispatch({ t: "pick", kind: k, init: s.values[k] ? undefined : { ...KINDS[k].defaults(), ...(loadLast(k) ?? {}) } });

  const create = async (andNext: boolean) => {
    setErrors([]);
    setNote("");
    const plan = planCreate(docRef.current, { kind, data, out, op: s.op, target });
    if (plan.kind === "error") return setErrors([plan.text]);
    saveLast(kind, data);
    if (plan.kind === "commit") {
      api.commit(plan.doc);
      docRef.current = plan.doc;
      api.flash(tr("{0} – přidáno do historie.", plan.name));
      if (andNext) setNote(tr("{0} – přidáno do historie. Zadejte další kolo.", plan.name));
      else onClose();
      return;
    }
    if (!api.runText) return setErrors([tr("Nový díl z průvodce tady nejde založit – otevřete díl, nebo použijte textový příkaz:"), plan.script]);
    setBusy(true);
    try {
      const log = await api.runText(plan.script);
      const errs = protocolErrors(log);
      if (errs.length) return setErrors(errs);
      api.flash(tr("{0} – otevřeno jako nový díl.", plan.name));
      onClose(); // otevřený dokument se změnil (nová záložka) – další kolo začne novým průvodcem
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const createPair = async () => {
    setErrors([]);
    const { res, script } = planPair(s.pairKind, currentPair(s));
    const bad = res.issues.filter((i) => i.level === "error");
    if (!res.ok || !script.length) return setErrors(bad.length ? bad.map((i) => i.text) : [tr("Soukolí nejde vytvořit – opravte řádky označené ✗.")]);
    if (!api.runText) return setErrors([tr("Soukolí tady nejde vytvořit – spusťte tyto textové příkazy v konzoli:"), script.join("\n")]);
    setBusy(true);
    try {
      const log = await api.runText(script.join("\n"));
      const errs = protocolErrors(log);
      if (errs.length) return setErrors(errs);
      api.flash(tr("{0} – dva díly a sestava s vazbou.", res.asmName));
      onClose();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const title = s.view === "pair" ? tr("Kola a ozubení – soukolí") : s.view === "table" ? tr("Kola a ozubení – {0}", def.label) : tr("Kola a ozubení");
  const footer = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2" data-gear-footer>
      {errors.length > 0 && (
        <div className="mr-auto max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap text-[11.5px] text-brand-600" data-gear-error role="alert">
          {errors.join("\n")}
        </div>
      )}
      {!errors.length && note && <p className="mr-auto text-[11.5px] text-[#1e7d3a]" data-gear-note>{note}</p>}
      {s.view === "table" && (
        <>
          <span data-gear-out-seg className="flex items-center gap-1">
            {(["wheel", "blank", "teeth"] as OutMode[]).map((o) => {
              const disabled = o === "teeth" && !(part && hasBody && s.target === "this");
              return (
                <button key={o} type="button" data-gear-out={o} aria-pressed={out === o} disabled={disabled} title={disabled ? tr("Zuby se řežou do tělesa otevřeného dílu – nejdřív vytvořte polotovar.") : undefined} onClick={() => dispatch({ t: "out", out: o })} className={cn("rounded px-2 py-1 text-[12px] disabled:opacity-40", out === o ? "bg-[#0b1f33] text-white" : "bg-[#eef2f6] text-[#26303b] hover:bg-[#e3e9f0]")}>
                  {o === "wheel" ? tr("Hotové kolo") : o === "blank" ? tr("Polotovar") : tr("Zuby do tělesa")}
                </button>
              );
            })}
          </span>
          <span data-gear-cancel>
            <Btn onClick={onClose}>{tr("Zrušit")}</Btn>
          </span>
          {!textOnly && (
            <span data-gear-create-next>
              <Btn onClick={() => void create(true)} disabled={!ev.ok || busy}>
                {tr("Vytvořit a další")}
              </Btn>
            </span>
          )}
          <span data-gear-create>
            <Btn primary onClick={() => void create(false)} disabled={!ev.ok || busy || (textOnly && !canText)} title={ev.ok ? undefined : tr("Opravte řádky označené ✗")}>
              <CadIcon name="gear" className="mr-1 inline h-4 w-4" />
              {busy ? tr("Vytvářím…") : tr("Vytvořit")}
            </Btn>
          </span>
        </>
      )}
      {s.view === "pair" && (
        <>
          <span data-gear-cancel>
            <Btn onClick={onClose}>{tr("Zrušit")}</Btn>
          </span>
          <span data-gear-pair-create>
            <Btn primary onClick={() => void createPair()} disabled={busy || !canText}>
              {busy ? tr("Vytvářím…") : tr("Vytvořit soukolí")}
            </Btn>
          </span>
        </>
      )}
      {s.view === "gallery" && (
        <span data-gear-cancel>
          <Btn onClick={onClose}>{tr("Zavřít")}</Btn>
        </span>
      )}
    </div>
  );

  return (
    <Modal title={title} icon="gear" tone="create" onClose={onClose} width="max-w-6xl" footer={footer}>
      <div data-gear-wizard={s.view} className="min-h-[320px]">
        {s.view !== "gallery" && (
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-[#edf1f5] pb-2">
            <button type="button" data-gear-back onClick={() => dispatch({ t: "gallery" })} className="rounded px-1.5 py-0.5 text-[12px] text-[#4b5866] hover:bg-[#eef2f6]">
              ← {tr("Všechny druhy")}
            </button>
            {s.view === "table" && (
              <>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[#6b7785]">{def.standards.join(" · ")}</span>
                <button type="button" data-gear-pair-open onClick={() => dispatch({ t: "pair" })} className="rounded border border-[#cfd6de] px-2 py-0.5 text-[12px] hover:border-brand hover:text-brand">
                  {tr("Soukolí s tímto kolem…")}
                </button>
              </>
            )}
            {s.view === "pair" && <span className="min-w-0 flex-1 truncate text-[12px] text-[#6b7785]">{tr("Obě kola jako díly a sestava s vazbou ozubení (v pohybové studii se otáčejí v převodu).")}</span>}
          </div>
        )}
        {s.view === "gallery" && <GearGallery onPick={pick} onPair={() => dispatch({ t: "pair", kind: "spur" })} />}
        {s.view === "pair" && <GearPairPanel kind={s.pairKind} values={pairData} onKind={(k) => dispatch({ t: "pair", kind: k })} onChange={(p) => dispatch({ t: "pairSet", patch: p })} onReset={() => dispatch({ t: "pairReset" })} />}
        {s.view === "table" && (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2 md:max-h-[62vh] md:overflow-y-auto md:pr-1">
              <GearTable rows={def.rows} data={data} onChange={(p) => dispatch({ t: "set", patch: p })} issues={ev.issues} computed={ev.rows} mode="wizard" autoFocus />
              <button type="button" onClick={() => dispatch({ t: "reset" })} className="text-[11.5px] text-[#6b7785] underline-offset-2 hover:text-brand hover:underline">
                {tr("Výchozí hodnoty")}
              </button>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <GearPreview kind={kind} data={data} />
              <p className="text-center text-[12.5px] font-semibold text-[#0b1f33]" data-gear-title>
                {gearName(kind, data)}
              </p>
              <p className="text-center text-[11.5px] text-[#4b5866]" data-gear-summary>
                {gearLine(kind, data)}
              </p>
              <p className="rounded bg-[#f7f9fb] px-2 py-1 text-[11px] leading-snug text-[#4b5866]">
                <span className="font-semibold">{tr("Přesnost:")}</span> {def.accuracy}
              </p>
              <Preview3d kind={kind} data={data} out={out} ok={ev.ok} />
              <div className="space-y-1.5 rounded border border-[#e3e8ee] p-2">
                {part && docRef.current.features.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-[#6b7785]">{tr("Kam:")}</span>
                    <Segmented<Target> size="sm" value={target} onChange={(t) => dispatch({ t: "target", target: t })} options={[{ v: "this", l: tr("Do tohoto dílu") }, { v: "new", l: tr("Jako nový díl") }]} />
                    <span data-gear-target={target} hidden />
                  </div>
                )}
                {part && hasBody && target === "this" && out !== "teeth" && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-[#6b7785]">{tr("Operace:")}</span>
                    <Segmented<Op> size="sm" value={s.op} onChange={(o) => dispatch({ t: "op", op: o })} options={[{ v: "new", l: tr("Nové těleso") }, { v: "add", l: tr("Přidat") }, { v: "cut", l: tr("Odebrat") }]} />
                    <span data-gear-op={s.op} hidden />
                  </div>
                )}
                <p className="text-[11px] text-[#6b7785]">
                  {textOnly ? (part ? tr("Kolo se otevře jako nový díl v nové záložce.") : tr("Otevřený dokument není díl – kolo se otevře jako nový díl v nové záložce.")) : !hasBody ? tr("Kolo bude prvním tělesem dílu.") : out === "teeth" ? tr("Zubové mezery se vyříznou do aktivního tělesa (polotovaru).") : tr("Kolo se přidá na konec historie otevřeného dílu.")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 3D náhled na požádání (jádro ve workeru, 400 ms po poslední změně; nad 80 zubů jen tlačítkem Obnovit) */
function Preview3d({ kind, data, out, ok }: { kind: GearKind; data: GearData; out: OutMode; ok: boolean }) {
  const [on, setOn] = useState(false);
  const [res, setRes] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [built, setBuilt] = useState("");
  const key = JSON.stringify([kind, data, out]);
  const auto = !(Number(data.z ?? data.N ?? 0) > 80);
  // klíč vyžádaný tlačítkem (velká kola se nestaví při každé změně tabulky)
  const [asked, setAsked] = useState("");
  const want = on && ok ? (auto ? key : asked) : "";
  useEffect(() => {
    if (!want) return;
    let alive = true;
    const t = setTimeout(async () => {
      const [k, d, o] = JSON.parse(want) as [GearKind, GearData, OutMode];
      setBusy(true);
      try {
        const r = await cad.build(previewDoc(k, d, o));
        if (!alive) return;
        setRes(r);
        const bad = r.status.find((x) => !x.ok);
        setErr(bad ? (bad.error ?? tr("Chyba stavby")) : null);
        setBuilt(want);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [want]);
  if (!on)
    return (
      <button
        type="button"
        data-gear-3d="off"
        onClick={() => {
          setOn(true);
          setAsked(key);
        }}
        disabled={!ok}
        className="self-center rounded border border-[#cfd6de] px-2 py-0.5 text-[12px] hover:border-brand hover:text-brand disabled:opacity-40"
      >
        {tr("3D náhled")}
      </button>
    );
  return (
    <div className="relative h-48 overflow-hidden rounded border border-[#e3e8ee]" style={{ background: "linear-gradient(180deg,#9fb1c4 0%,#d3dce6 52%,#f3f5f8 100%)" }} data-gear-3d={busy ? "busy" : err ? "error" : res?.mesh ? "ready" : "on"}>
      <MiniViewport mesh={res?.mesh ?? null} color="#c9a46a" />
      {busy && <span className="absolute right-2 top-2 rounded bg-white/85 px-2 py-0.5 font-mono text-[10.5px] text-[#5b6776]">{tr("stavím…")}</span>}
      {!auto && built !== key && !busy && (
        <button type="button" onClick={() => setAsked(key)} className="absolute left-2 top-2 rounded bg-white/90 px-2 py-0.5 text-[11px] text-[#26303b] hover:text-brand">
          {tr("Obnovit 3D náhled")}
        </button>
      )}
      {err && <p className="absolute inset-x-2 bottom-2 rounded border border-brand/30 bg-white/95 px-2 py-1 text-[11px] text-brand-600">{err}</p>}
      <button type="button" onClick={() => setOn(false)} className="absolute bottom-2 right-2 rounded bg-white/85 px-1.5 text-[11px] text-[#4b5866] hover:text-brand" aria-label={tr("Skrýt 3D náhled")}>
        ×
      </button>
    </div>
  );
}
