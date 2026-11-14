"use client";
/**
 * Vlastní dotazy místo systémových `window.prompt` / `confirm` / `alert`: stejný vzhled jako zbytek CADu, čísla
 * s desetinnou čárkou i výrazy (25/2, proměnné dílu), Enter potvrdí, Esc zruší, funguje i na dotyku a v automatizaci.
 * Volá se `await askNumber(...)` / `await askText(...)` / `await askConfirm(...)` / `await askNotice(...)` odkudkoli;
 * hostitel je v aplikaci jednou. Bez hostitele (dotaz mimo aplikaci) se hostitel připojí sám – systémové okno se nikdy
 * neotevře (automatizace by na něm uvízla).
 *
 * Pro automatizaci (AI agent, Playwright): překrytí `[data-ask="number|text|confirm"]`, nadpis `[data-ask-title]`, text
 * `[data-ask-body]`, pole `[data-ask-input]`, chyba `[data-ask-error]` (role alert), tlačítka `[data-ask-ok]` a
 * `[data-ask-cancel]`. Fokus je po otevření v poli (u potvrzení na OK), takže stačí `Enter` / `Escape`.
 *
 * Dokud je dotaz otevřený nebo čeká ve frontě, `askBusy()` vrací true – klávesové zkratky aplikace se pak neprovedou
 * (jako u systémového okna, které stránku blokuje): druhé rychlé Delete tak nepoloží druhé potvrzení.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tr } from "@/cad/i18n";
import { evalExpr } from "@/cad/params";

type AskKind = "number" | "text" | "confirm";
type AskReq = {
  id: number;
  kind: AskKind;
  title: string;
  def: string;
  unit?: string;
  hint?: string;
  /** potvrzení: delší text pod nadpisem */
  body?: string;
  /** popisek tlačítka OK */
  ok?: string;
  /** potvrzení: popisek Storno; null = jen OK (oznámení) */
  cancel?: string | null;
  /** potvrzení nevratné akce (OK červeně) */
  danger?: boolean;
  scope?: Record<string, number>;
  /** ověření hodnoty; vrací text chyby nebo null */
  check?: (v: number | string) => string | null;
  resolve: (v: number | string | boolean | null) => void;
};

let seq = 0;
let host: ((r: AskReq) => void) | null = null;
/** dotazy položené dřív, než se hostitel připojil */
const waiting: AskReq[] = [];
let mounting = false;
/** položené a dosud nezodpovězené dotazy (i ty, které ještě nejsou vykreslené) */
let unanswered = 0;
/** Je otevřený (nebo čeká) dotaz na stránce? Zkratky aplikace mají mezitím počkat. */
export const askBusy = () => unanswered > 0;

const parseNumber = (text: string, scope?: Record<string, number>): number => {
  const t = text.trim().replace(/^=\s*/, "");
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return parseFloat(t.replace(",", "."));
  return evalExpr(t.replace(/(\d),(\d)/g, "$1.$2"), scope ?? {});
};

/** odpověď „zrušeno“ (dotaz bez stránky – Node, vykreslení na serveru) */
const cancelled = (r: AskReq) => r.resolve(r.kind === "confirm" ? false : null);

/** předá dotaz hostiteli; bez hostitele ho připojí (samostatný kořen Reactu) – nikdy systémové okno */
function submit(req: AskReq) {
  unanswered++;
  const resolve = req.resolve;
  let done = false;
  req.resolve = (v) => {
    if (!done) {
      done = true;
      unanswered--;
    }
    resolve(v);
  };
  if (host) return host(req);
  if (typeof document === "undefined") return cancelled(req);
  waiting.push(req);
  if (mounting) return;
  mounting = true;
  void import("react-dom/client")
    .then(({ createRoot }) => {
      const el = document.createElement("div");
      el.setAttribute("data-ask-root", "");
      document.body.appendChild(el);
      createRoot(el).render(<AskHost />);
    })
    .catch(() => {
      mounting = false;
      for (const r of waiting.splice(0)) cancelled(r);
    });
}

/** Dotaz na číslo (mm, °…). Vrací null, když uživatel dotaz zruší. */
export function askNumber(title: string, def: number, opts: { unit?: string; hint?: string; scope?: Record<string, number>; check?: (v: number) => string | null } = {}): Promise<number | null> {
  return new Promise((resolve) => submit({ id: ++seq, kind: "number", title, def: String(def).replace(".", ","), unit: opts.unit, hint: opts.hint, scope: opts.scope, check: opts.check as AskReq["check"], resolve: (v) => resolve(v as number | null) }));
}

/** Dotaz na text. Vrací null, když uživatel dotaz zruší. */
export function askText(title: string, def = "", opts: { hint?: string; check?: (v: string) => string | null } = {}): Promise<string | null> {
  return new Promise((resolve) => submit({ id: ++seq, kind: "text", title, def, hint: opts.hint, check: opts.check as AskReq["check"], resolve: (v) => resolve(v as string | null) }));
}

/** Název souboru pro „Uložit jako“ (prohlížeč bez systémového dialogu – Firefox, Safari). Vrací null při zrušení. */
export function askFileName(suggested: string): Promise<string | null> {
  return askText(tr("Uložit jako – název souboru:"), suggested, { check: (v) => (v.trim() ? null : tr("Zadejte název souboru.")) });
}

/** Potvrzení (místo `window.confirm`): true = OK, false = Storno / Esc / klik mimo. */
export function askConfirm(title: string, opts: { body?: string; ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => submit({ id: ++seq, kind: "confirm", title, def: "", body: opts.body, ok: opts.ok, cancel: opts.cancel, danger: opts.danger, resolve: (v) => resolve(v === true) }));
}

/** Oznámení s jediným tlačítkem OK (místo `window.alert`); splní se po zavření. */
export function askNotice(title: string, body?: string): Promise<void> {
  return new Promise((resolve) => submit({ id: ++seq, kind: "confirm", title, def: "", body, cancel: null, resolve: () => resolve() }));
}

/** Hostitel dotazů – v aplikaci právě jednou. */
export function AskHost() {
  const [req, setReq] = useState<AskReq | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  const queue = useRef<AskReq[]>([]);
  useEffect(() => {
    const mine = (r: AskReq) => {
      queue.current.push(r);
      setReq((cur) => cur ?? queue.current.shift() ?? null);
    };
    host = mine;
    for (const r of waiting.splice(0)) mine(r);
    return () => {
      if (host === mine) host = null;
    };
  }, []);
  useEffect(() => {
    if (!req) return;
    setText(req.def);
    setErr(null);
    const t = setTimeout(() => {
      if (req.kind === "confirm") okBtn.current?.focus();
      else {
        input.current?.focus();
        input.current?.select();
      }
    }, 0);
    return () => clearTimeout(t);
  }, [req]);
  // Enter / Esc platí pro dotaz hned po vykreslení – i když fokus ještě není v dialogu (rychlá automatizace, druhé
  // Delete): potvrzení dostane fokus synchronně a klávesy mimo dialog (zachycené na okně) patří dotazu, ne stránce pod ním
  const keys = useRef<{ ok: () => void; cancel: () => void } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!req) return;
    if (req.kind === "confirm") okBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (box.current?.contains(e.target as Node)) return; // uvnitř dialogu klávesy obslouží dialog sám
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") keys.current?.ok();
      else keys.current?.cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);
  if (!req) return null;
  const isConfirm = req.kind === "confirm";
  const close = (v: number | string | boolean | null) => {
    req.resolve(v);
    setReq(queue.current.shift() ?? null);
  };
  // oznámení (jen OK) se i klávesou Esc / klikem mimo „potvrdí“
  const cancel = () => close(isConfirm ? req.cancel === null : null);
  const confirm = () => {
    if (isConfirm) return close(true);
    let v: number | string;
    if (req.kind === "number") {
      try {
        v = parseNumber(text, req.scope);
      } catch (e) {
        return setErr(tr("Zadejte číslo nebo výraz (např. 12,5 nebo 25/2){0}", (e as Error).message ? ` – ${(e as Error).message}` : ""));
      }
      if (!Number.isFinite(v)) return setErr(tr("Zadejte číslo nebo výraz (např. 12,5 nebo 25/2){0}", ""));
    } else v = text;
    const problem = req.check?.(v) ?? null;
    if (problem) return setErr(problem);
    close(v);
  };
  keys.current = { ok: confirm, cancel };
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4" data-ask={req.kind} onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        ref={box}
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={req.title}
        aria-describedby={req.body ? `ask-body-${req.id}` : undefined}
        className="w-full max-w-[380px] rounded-lg border border-[#cdd5de] bg-white p-4 text-[13px] text-[#1f2933] shadow-2xl"
        onKeyDown={(e) => {
          // dotaz má klávesy pro sebe – Enter / Esc nesmí zároveň potvrdit nebo zrušit rozpracovaný prvek pod ním
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      >
        {isConfirm ? (
          <p className="font-medium leading-snug" data-ask-title>
            {req.title}
          </p>
        ) : (
          <label className="block font-medium leading-snug" htmlFor={`ask-${req.id}`} data-ask-title>
            {req.title}
          </label>
        )}
        {isConfirm && req.body && (
          <p id={`ask-body-${req.id}`} className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-[#4a5664]" data-ask-body>
            {req.body}
          </p>
        )}
        {!isConfirm && (
          <div className="mt-2 flex items-center gap-2">
            <input
              id={`ask-${req.id}`}
              ref={input}
              data-ask-input
              className="min-w-0 flex-1 rounded border border-[#cdd5de] px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-brand"
              inputMode={req.kind === "number" ? "decimal" : "text"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setErr(null);
              }}
            />
            {req.unit && <span className="shrink-0 text-[#6b7785]">{req.unit}</span>}
          </div>
        )}
        {err ? (
          <p className="mt-1.5 text-[12px] text-brand" role="alert" data-ask-error>
            {err}
          </p>
        ) : (
          req.hint && <p className="mt-1.5 text-[12px] text-[#6b7785]">{req.hint}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {!(isConfirm && req.cancel === null) && (
            <button type="button" data-ask-cancel className="rounded border border-[#cdd5de] px-3 py-1.5 hover:bg-[#f3f6f9]" onClick={cancel}>
              {req.cancel || tr("Storno")}
            </button>
          )}
          <button
            type="button"
            ref={okBtn}
            data-ask-ok
            className={req.danger ? "rounded bg-brand px-4 py-1.5 font-semibold text-white hover:bg-brand-600" : "rounded bg-[#16a34a] px-4 py-1.5 font-semibold text-white hover:bg-[#15803d]"}
            onClick={confirm}
          >
            {req.ok || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
