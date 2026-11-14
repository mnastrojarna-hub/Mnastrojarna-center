"use client";

import { tr } from "@/cad/i18n";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Btn, Modal } from "./ui";

/** otevře sdílený dokument podle zadaného kódu / odkazu; null = otevřeno (nebo se ptá na heslo), jinak text chyby */
export type OpenShareInput = (text: string) => Promise<string | null>;

/**
 * Pole pro ruční zadání kódu sdíleného dokumentu (nebo vložení celého odkazu). Pole i zadaný text zůstávají, dokud se
 * dokument neotevře – po překlepu jde kód rovnou opravit a hlášení říká, co je špatně.
 */
export function ShareCodeField({
  onOpen,
  initial = "",
  error = null,
  label,
  autoFocus,
  id = "mn-share-code",
  className,
}: {
  onOpen: OpenShareInput;
  initial?: string;
  /** chyba k předvyplněnému kódu (např. odkaz s překlepem) */
  error?: string | null;
  /** popisek před polem (úvodní obrazovka) */
  label?: string;
  autoFocus?: boolean;
  id?: string;
  className?: string;
}) {
  const [code, setCode] = useState(initial);
  const [err, setErr] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const submit = async () => {
    const text = code.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    const e = await onOpen(text).catch(() => tr("Sdílený dokument se nepodařilo otevřít. Zkuste to znovu."));
    if (!live.current) return;
    setBusy(false);
    setErr(e);
  };
  return (
    <form
      data-share-code-form
      className={cn("flex flex-wrap items-center gap-2 text-[12.5px] text-[#3c4856]", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {label && (
        <label htmlFor={id} className="inline-flex items-center gap-1.5 font-medium">
          <CadIcon name="share" className="h-4 w-4 text-brand" />
          {label}
        </label>
      )}
      <input
        id={id}
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setErr(null);
        }}
        placeholder={tr("např. Ab3k Z9xQ 2m")}
        aria-label={tr("Kód sdíleného dokumentu")}
        aria-invalid={!!err}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn("w-44 max-w-full rounded border bg-white px-2 py-1.5 font-mono text-[13px] outline-none focus:border-brand", err ? "border-brand" : "border-[#cfd6de]")}
      />
      <button type="submit" disabled={!code.trim() || busy} className="rounded-md border border-[#d5dbe2] bg-white px-3 py-1.5 font-medium text-[#26303b] hover:border-brand/50 hover:text-brand disabled:opacity-50">
        {busy ? tr("Otevírám…") : tr("Otevřít")}
      </button>
      {err && (
        <span role="alert" data-share-code-error className="w-full text-[12px] leading-snug text-brand">
          {err}
        </span>
      )}
    </form>
  );
}

/**
 * Dialog „Otevřít sdílený dokument“: příjemce přišel na …/s bez kódu, kód v odkazu má překlep, nebo si dialog otevřel
 * z nabídky Soubor / palety příkazů – funguje i s vypnutou úvodní obrazovkou a v kartě, kde se už pracuje.
 */
export function ShareCodeDialog({ initial, error, onOpen, onClose }: { initial?: string; error?: string; onOpen: OpenShareInput; onClose: () => void }) {
  return (
    <Modal title={tr("Otevřít sdílený dokument")} icon="share" tone="file" onClose={onClose} width="max-w-md" footer={<Btn onClick={onClose}>{tr("Zavřít")}</Btn>}>
      <p className="mb-2 text-[12.5px] leading-relaxed text-[#26303b]">{tr("Zadejte kód, který vám odesílatel poslal (10 znaků, záleží na velikosti písmen), nebo vložte celý odkaz.")}</p>
      <ShareCodeField onOpen={onOpen} initial={initial} error={error} autoFocus id="mn-share-code-dialog" />
    </Modal>
  );
}
