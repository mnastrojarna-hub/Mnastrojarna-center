"use client";

/**
 * Číselné pole tabulek pružin a zatížení (vlna 21): desetinná čárka i tečka, text se drží v poli během psaní – „1,“ ani „0“ se
 * nepřepíše (řízené pole s value = String(Number(text)) čárku smazalo a další číslice dala desetkrát větší hodnotu). Hodnota se
 * předá jen u platného čísla, které projde `valid`; prázdné pole = null jen s `empty` (tuhost „spočtená“). Změna hodnoty zvenku
 * (předvolba, „Rozměry jako“) text obnoví, po opuštění pole se ukáže platná hodnota.
 */
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { getLang } from "@/cad/i18n";

const NUM = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
/** text → číslo (čárka i tečka); null = není (zatím) platné číslo */
export function parseDecimal(t: string): number | null {
  const s = t.trim();
  if (!NUM.test(s)) return null;
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
const show = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const s = String(Math.round(v * 1e6) / 1e6);
  return getLang() === "en" ? s : s.replace(".", ",");
};

export function DecimalInput({ value, onValue, valid, empty, ...rest }: { value: number | null | undefined; onValue: (v: number | null) => void; valid?: (v: number) => boolean; empty?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">) {
  const [text, setText] = useState(() => show(value));
  // poslední hodnota předaná ven – ozvěna vlastního psaní text nepřepisuje
  const sent = useRef<number | null | undefined>(value);
  useEffect(() => {
    if (value === sent.current || (value != null && sent.current != null && Math.abs(value - sent.current) < 1e-12)) return;
    sent.current = value;
    setText(show(value));
  }, [value]);
  return (
    <input
      {...rest}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (!t.trim()) {
          if (empty) {
            sent.current = null;
            onValue(null);
          }
          return;
        }
        const v = parseDecimal(t);
        if (v === null || (valid && !valid(v))) return;
        sent.current = v;
        onValue(v);
      }}
      onBlur={(e) => {
        setText(show(value));
        rest.onBlur?.(e);
      }}
    />
  );
}
