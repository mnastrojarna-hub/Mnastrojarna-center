"use client";
/**
 * Vlastní dotaz na hodnotu (číslo nebo text) místo systémového `window.prompt`: stejný vzhled jako zbytek CADu, čísla
 * s desetinnou čárkou i výrazy (25/2, proměnné dílu), Enter potvrdí, Esc zruší, funguje i na dotyku a v automatizaci
 * (pole má `data-ask-input`). Volá se `await askNumber(...)` / `await askText(...)` odkudkoli; hostitel je v aplikaci jednou.
 */
import { useEffect, useRef, useState } from "react";
import { tr } from "@/cad/i18n";
import { evalExpr } from "@/cad/params";

type AskReq = {
  id: number;
  kind: "number" | "text";
  title: string;
  def: string;
  unit?: string;
  hint?: string;
  scope?: Record<string, number>;
  /** ověření hodnoty; vrací text chyby nebo null */
  check?: (v: number | string) => string | null;
  resolve: (v: number | string | null) => void;
};

let seq = 0;
let host: ((r: AskReq) => void) | null = null;

const parseNumber = (text: string, scope?: Record<string, number>): number => {
  const t = text.trim().replace(/^=\s*/, "");
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return parseFloat(t.replace(",", "."));
  return evalExpr(t.replace(/(\d),(\d)/g, "$1.$2"), scope ?? {});
};

/** Dotaz na číslo (mm, °…). Vrací null, když uživatel dotaz zruší. */
export function askNumber(title: string, def: number, opts: { unit?: string; hint?: string; scope?: Record<string, number>; check?: (v: number) => string | null } = {}): Promise<number | null> {
  return new Promise((resolve) => {
    const req: AskReq = { id: ++seq, kind: "number", title, def: String(def).replace(".", ","), unit: opts.unit, hint: opts.hint, scope: opts.scope, check: opts.check as AskReq["check"], resolve: (v) => resolve(v as number | null) };
    if (host) host(req);
    else {
      // bez hostitele (samostatně použitá komponenta, testy) zůstává systémový dotaz
      const raw = typeof window !== "undefined" ? window.prompt(title, req.def) : null;
      if (raw === null) return resolve(null);
      try {
        resolve(parseNumber(raw, opts.scope));
      } catch {
        resolve(null);
      }
    }
  });
}

/** Dotaz na text. Vrací null, když uživatel dotaz zruší. */
export function askText(title: string, def = "", opts: { hint?: string; check?: (v: string) => string | null } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const req: AskReq = { id: ++seq, kind: "text", title, def, hint: opts.hint, check: opts.check as AskReq["check"], resolve: (v) => resolve(v as string | null) };
    if (host) host(req);
    else resolve(typeof window !== "undefined" ? window.prompt(title, def) : null);
  });
}

/** Hostitel dotazů – v aplikaci právě jednou. */
export function AskHost() {
  const [req, setReq] = useState<AskReq | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<AskReq[]>([]);
  useEffect(() => {
    host = (r) => {
      queue.current.push(r);
      setReq((cur) => cur ?? queue.current.shift() ?? null);
    };
    return () => {
      host = null;
    };
  }, []);
  useEffect(() => {
    if (!req) return;
    setText(req.def);
    setErr(null);
    const t = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [req]);
  if (!req) return null;
  const close = (v: number | string | null) => {
    req.resolve(v);
    setReq(queue.current.shift() ?? null);
  };
  const confirm = () => {
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
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4" data-ask onPointerDown={(e) => e.target === e.currentTarget && close(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="w-full max-w-[380px] rounded-lg border border-[#cdd5de] bg-white p-4 text-[13px] text-[#1f2933] shadow-2xl"
        onKeyDown={(e) => {
          // dotaz má klávesy pro sebe – Enter / Esc nesmí zároveň potvrdit nebo zrušit rozpracovaný prvek pod ním
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close(null);
          }
        }}
      >
        <label className="block font-medium leading-snug" htmlFor={`ask-${req.id}`}>
          {req.title}
        </label>
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
        {err ? (
          <p className="mt-1.5 text-[12px] text-brand" role="alert">
            {err}
          </p>
        ) : (
          req.hint && <p className="mt-1.5 text-[12px] text-[#6b7785]">{req.hint}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" data-ask-cancel className="rounded border border-[#cdd5de] px-3 py-1.5 hover:bg-[#f3f6f9]" onClick={() => close(null)}>
            {tr("Storno")}
          </button>
          <button type="button" data-ask-ok className="rounded bg-[#16a34a] px-4 py-1.5 font-semibold text-white hover:bg-[#15803d]" onClick={confirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
