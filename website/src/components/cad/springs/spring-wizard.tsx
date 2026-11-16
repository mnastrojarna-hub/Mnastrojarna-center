"use client";

/**
 * Průvodce Pružina: galerie druhů → JEDNA tabulka pro zvolený druh (výchozí hodnoty, nápověda s normou, hlášky u řádků,
 * spočtené řádky) → živý náhled z boku → Vytvořit. Výsledek = jeden prvek historie `spring.<druh>`.
 *
 * Volá se odkudkoli `await openSpringWizard({ … })` (pás karet Tvorba › Pružina, paleta Ctrl+K, knihovna Pružiny, balík motion
 * „Pružina mezi díly“ s předvyplněnou tabulkou). Hostitel se připojí sám (samostatný kořen Reactu), jako dotazy ask-dialog.
 * Automatizace: `[data-spring-wizard]`, dlaždice `[data-spring-kind="compression"]`, řádky `[data-spring-row="d"]`,
 * spočtené `[data-spring-calc="R"]`, cíl `[data-spring-target="new"]`, tlačítka `[data-spring-create]` / `[data-spring-cancel]`.
 */
import { useEffect, useMemo, useState } from "react";
import { tr } from "@/cad/i18n";
import { KINDS, SPRING_KINDS, springCalc, type SpringData, type SpringExt, type SpringKind } from "@/cad/springs";
import { cn } from "@/lib/cn";
import { CadIcon } from "../cad-icons";
import { Btn, Modal } from "../ui";
import { SpringPreview } from "./spring-preview";
import { SpringTable } from "./spring-table";

export type SpringTarget = "this" | "new" | "asm";
export type SpringWizardResult = { ext: SpringExt; kind: SpringKind; data: SpringData; name: string; target: SpringTarget };
export type SpringWizardOpts = {
  /** předvolený druh (jinak tlačná) */
  kind?: SpringKind;
  /** předvyplněná data tabulky (sloučí se s výchozími) */
  data?: SpringData;
  /** nabízené cíle (výchozí: nový díl / do tohoto dílu) a předvolený */
  targets?: SpringTarget[];
  target?: SpringTarget;
  /** nadpis a popisek tlačítka */
  title?: string;
  submitLabel?: string;
  /** jen jeden druh (bez galerie) – např. úprava */
  lockKind?: boolean;
};
type Req = SpringWizardOpts & { id: number; resolve: (r: SpringWizardResult | null) => void };
let seq = 0;

let host: ((r: Req) => void) | null = null;
const waiting: Req[] = [];
let mounting = false;
let open = 0;
/** je průvodce otevřený (zkratky aplikace počkají) */
export const springWizardBusy = () => open > 0;

/** Otevře průvodce; vrací výsledek nebo null (Storno / Esc). */
export function openSpringWizard(o: SpringWizardOpts = {}): Promise<SpringWizardResult | null> {
  return new Promise((resolve) => {
    open++;
    const req: Req = { ...o, id: ++seq, resolve: (r) => {
      open--;
      resolve(r);
    } };
    if (host) return host(req);
    if (typeof document === "undefined") return req.resolve(null);
    waiting.push(req);
    if (mounting) return;
    mounting = true;
    void import("react-dom/client")
      .then(({ createRoot }) => {
        const el = document.createElement("div");
        el.setAttribute("data-spring-wizard-root", "");
        document.body.appendChild(el);
        createRoot(el).render(<SpringWizardHost />);
      })
      .catch(() => {
        mounting = false;
        for (const r of waiting.splice(0)) r.resolve(null);
      });
  });
}

const kindIcon = (k: SpringKind) => (k === "compression" ? "spring" : k === "extension" ? "spring-ext" : k === "torsion" ? "spring-torsion" : "spring-disc");
const TARGET_LABEL: Record<SpringTarget, () => string> = { this: () => tr("do tohoto dílu"), new: () => tr("jako nový díl"), asm: () => tr("vložit do sestavy") };

function SpringWizardHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    const queue: Req[] = [];
    host = (r) => {
      setReq((cur) => {
        if (cur) {
          queue.push(r);
          return cur;
        }
        return r;
      });
    };
    for (const r of waiting.splice(0)) host(r);
    return () => {
      host = null;
    };
  }, []);
  if (!req) return null;
  return (
    <SpringWizard
      key={req.id}
      opts={req}
      onDone={(r) => {
        req.resolve(r);
        setReq(null);
      }}
    />
  );
}

export function SpringWizard({ opts, onDone }: { opts: SpringWizardOpts; onDone: (r: SpringWizardResult | null) => void }) {
  const [kind, setKind] = useState<SpringKind>(opts.kind ?? "compression");
  const [byKind, setByKind] = useState<Record<string, SpringData>>(() => ({ [opts.kind ?? "compression"]: { ...KINDS[opts.kind ?? "compression"].defaults(), ...(opts.data ?? {}) } }));
  const data = byKind[kind] ?? KINDS[kind].defaults();
  const targets = opts.targets ?? ["new", "this"];
  const [target, setTarget] = useState<SpringTarget>(opts.target ?? targets[0]);
  const k = KINDS[kind];
  const calc = useMemo(() => springCalc(kind, data), [kind, data]);
  const pick = (nk: SpringKind) => {
    setKind(nk);
    setByKind((m) => (m[nk] ? m : { ...m, [nk]: KINDS[nk].defaults() }));
  };
  const patch = (p: SpringData) =>
    setByKind((m) => {
      const next = { ...(m[kind] ?? KINDS[kind].defaults()) };
      for (const [key, v] of Object.entries(p)) {
        if (v === undefined || v === "") delete next[key];
        else next[key] = v;
        // alternativní zadání: vyplněný průměr / počet závitů / síla nahradí ostatní ze stejné skupiny
        const row = k.rows().find((r) => r.key === key);
        if (row?.alt && v !== undefined && v !== "") for (const other of k.rows()) if (other.alt === row.alt && other.key !== key) delete next[other.key];
      }
      return { ...m, [kind]: next };
    });
  const create = () => {
    if (!calc.ok) return;
    onDone({ ext: k.ext, kind, data, name: calc.title, target });
  };
  return (
    <Modal title={opts.title ?? tr("Pružina – tabulka s výpočtem")} icon="spring" tone="create" onClose={() => onDone(null)} width="max-w-5xl">
      <div data-spring-wizard className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_250px]">
        {!opts.lockKind && (
          <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible" role="tablist" aria-label={tr("Druh pružiny")}>
            {SPRING_KINDS.map((sk) => (
              <button
                key={sk}
                type="button"
                role="tab"
                aria-selected={sk === kind}
                data-spring-kind={sk}
                onClick={() => pick(sk)}
                className={cn("flex min-w-[120px] items-center gap-2 rounded border px-2 py-1.5 text-left transition", sk === kind ? "border-brand bg-brand/5" : "border-[#e3e8ee] hover:border-[#cfd6de]")}
              >
                <SpringPreview ext={KINDS[sk].ext} data={byKind[sk] ?? KINDS[sk].defaults()} small />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold leading-tight">{KINDS[sk].label()}</span>
                  <span className="block text-[10.5px] text-[#6b7785]">{KINDS[sk].standard}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className={cn("max-h-[64vh] min-w-0 overflow-y-auto pr-1", opts.lockKind && "md:col-span-2")}>
          <SpringTable rows={k.rows()} data={data} onChange={patch} issues={calc.issues} calc={calc.rows} />
        </div>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <div className="rounded border border-[#e3e8ee] bg-white p-1">
            <SpringPreview ext={k.ext} data={data} />
          </div>
          <p className="w-full text-center text-[12.5px] font-semibold" data-spring-title>
            {calc.title}
          </p>
          <p className="w-full text-center text-[11.5px] text-[#4b5866]" data-spring-summary>
            {calc.summary}
          </p>
          {targets.length > 1 && (
            <div className="flex w-full flex-wrap justify-center gap-1">
              {targets.map((t) => (
                <button key={t} type="button" data-spring-target={t} aria-pressed={t === target} onClick={() => setTarget(t)} className={cn("rounded px-2 py-1 text-[12px]", t === target ? "bg-[#0b1f33] text-white" : "bg-[#eef2f6] text-[#26303b]")}>
                  {TARGET_LABEL[t]()}
                </button>
              ))}
            </div>
          )}
          <div className="mt-auto flex w-full justify-end gap-2">
            <span data-spring-cancel>
              <Btn onClick={() => onDone(null)}>{tr("Storno")}</Btn>
            </span>
            <span data-spring-create>
              <Btn primary disabled={!calc.ok} onClick={create} title={calc.ok ? undefined : tr("Opravte řádky označené ✗")}>
                <CadIcon name={kindIcon(kind) as never} className="mr-1 inline h-4 w-4" />
                {opts.submitLabel ?? tr("Vytvořit")}
              </Btn>
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
