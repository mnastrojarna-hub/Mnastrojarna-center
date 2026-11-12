"use client";

import { cadLocale, tr } from "@/cad/i18n";
import { useEffect, useRef, useState } from "react";
import { createShareLink, LINK_WARN_CHARS, SHARE_DAYS, SHARE_DEFAULT_DAYS, shareMessage, shareStoreConfigured, type ShareMode, type ShareResult, type ShareView } from "@/cad/share";
import type { CadDoc } from "@/cad/types";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Btn, Modal } from "./ui";

const FROM_KEY = "mn-cad-share-from"; // jen jméno odesílatele (není to dokument)

const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleDateString(cadLocale(), { day: "numeric", month: "long", year: "numeric" }) : tr("bez omezení"));
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Dialog „Sdílet odkazem“: jeden odkaz pro WhatsApp, e-mail, Teams… Odkaz se vytvoří hned po otevření
 * s výchozí platností; změna voleb ho přegeneruje. Dokument se nikdy neposílá na server v čitelné podobě.
 */
export function ShareDialog({ doc, view, onClose, onFlash }: { doc: CadDoc; view: ShareView; onClose: () => void; onFlash: (m: string) => void }) {
  const [days, setDays] = useState<number | null>(SHARE_DEFAULT_DAYS);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(() => {
    try {
      return localStorage.getItem(FROM_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [mode, setMode] = useState<"auto" | ShareMode>("auto");
  const [res, setRes] = useState<ShareResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState<"url" | "msg" | null>(null);
  const seq = useRef(0);
  const storeOk = shareStoreConfigured();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isAsm = doc.kind === "assembly";
  const what = `${isAsm ? tr("sestava") : tr("díl")} „${doc.name}“${doc.drawings?.length ? ` + ${doc.drawings.length} ${doc.drawings.length === 1 ? tr("výkres") : doc.drawings.length < 5 ? tr("výkresy") : tr("výkresů")}` : ""}`;

  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    setErr(null);
    setCopied(null);
    const t = setTimeout(async () => {
      try {
        const r = await createShareLink(doc, { days, password: password || undefined, from: from || undefined, view, mode: mode === "auto" ? undefined : mode });
        if (seq.current !== id) return;
        setRes(r);
      } catch (e) {
        if (seq.current !== id) return;
        setRes(null);
        setErr((e as Error).message);
      } finally {
        if (seq.current === id) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [doc, days, password, from, mode, view]);

  const msg = res ? shareMessage(doc.name, res) : "";
  const copy = async (kind: "url" | "msg") => {
    if (!res) return;
    const ok = await copyText(kind === "url" ? res.url : msg);
    setCopied(ok ? kind : null);
    onFlash(ok ? (kind === "url" ? tr("Odkaz zkopírován – vložte ho do zprávy (Ctrl+V).") : tr("Zpráva s odkazem zkopírována.")) : tr("Kopírování se nezdařilo – označte odkaz a zkopírujte ho ručně."));
  };
  const whatsapp = () => res && window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  const email = () => res && (window.location.href = `mailto:?subject=${encodeURIComponent(`Mnástrojárna CAD – ${doc.name}`)}&body=${encodeURIComponent(msg)}`);
  const native = async () => {
    if (!res) return;
    try {
      await navigator.share({ title: tr("Mnástrojárna CAD – {0}", doc.name), text: msg });
    } catch {
      /* zrušeno uživatelem */
    }
  };
  const longLink = !!res && res.mode === "link" && res.url.length > LINK_WARN_CHARS;

  return (
    <Modal title={tr("Sdílet odkazem")} icon="share" tone="file" onClose={onClose} width="max-w-2xl" footer={<Btn onClick={onClose}>{tr("Zavřít")}</Btn>}>
      <div className="space-y-4 text-[12.5px] text-[#26303b]">
        <p className="rounded-md border border-[#e3e8ee] bg-[#f7f9fb] p-3 leading-relaxed">
          <strong>{tr("Sdílíte:")}</strong> {what}
          {view === "drawing" && tr(" (příjemci se otevře rovnou výkres)")}{tr(". Příjemce odkaz otevře v prohlížeči bez instalace a registrace – může model prohlížet, otáčet, měřit, řezat, prohlédnout výkresy a uložit si kopii. Jde o")}{" "}<strong>{tr("snímek")}</strong>{tr(": vaše další úpravy se do odkazu nepromítnou, pošlete nový. Odkaz funguje pro 2, 3 i více lidí najednou, kdekoli na světě.")}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-semibold">{tr("Platnost odkazu")}</p>
            <div className="flex flex-wrap gap-1.5">
              {[...SHARE_DAYS.map((d) => ({ v: d as number | null, l: d === 1 ? tr("1 den") : tr("{0} dní", d) })), { v: null, l: tr("bez omezení") }].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setDays(o.v)}
                  className={cn("rounded-full border px-2.5 py-1 text-[12px]", days === o.v ? "border-brand bg-brand text-white" : "border-[#cfd6de] bg-white hover:border-brand/50")}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-[#6b7785]">{tr("Po vypršení se odkaz neotevře; stačí dokument sdílet znovu.")}</p>
          </div>
          <div className="space-y-2">
            <label className="block">
              <span className="font-semibold">{tr("Heslo (volitelné)")}</span>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tr("bez hesla")}
                autoComplete="off"
                aria-label={tr("Heslo k odkazu")}
                className="mt-1 w-full rounded border border-[#cfd6de] px-2 py-1.5 text-[12.5px] outline-none focus:border-brand"
              />
              <span className="mt-0.5 block text-[11.5px] text-[#6b7785]">{tr("Heslo pošlete jiným kanálem (SMS, telefon). Bez něj odkaz nikdo neotevře.")}</span>
            </label>
            <label className="block">
              <span className="font-semibold">{tr("Odesílatel (volitelné)")}</span>
              <input
                type="text"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  try {
                    localStorage.setItem(FROM_KEY, e.target.value);
                  } catch {
                    /* ignore */
                  }
                }}
                placeholder={tr("např. Vít Volný, Mnástrojárna")}
                aria-label={tr("Jméno odesílatele")}
                className="mt-1 w-full rounded border border-[#cfd6de] px-2 py-1.5 text-[12.5px] outline-none focus:border-brand"
              />
            </label>
          </div>
        </div>

        {storeOk && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{tr("Kde je dokument:")}</span>
            {(
              [
                ["auto", "automaticky"],
                ["link", tr("jen v odkazu (bez serveru)")],
                ["store", tr("v šifrovaném úložišti")],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setMode(v)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", mode === v ? "border-brand bg-brand text-white" : "border-[#cfd6de] bg-white hover:border-brand/50")}>
                {l}
              </button>
            ))}
          </div>
        )}

        <div>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="font-semibold">{tr("Odkaz")}</p>
            {res && (
              <p className="text-[11.5px] text-[#6b7785]">
                {kb(res.bytes)} · {res.mode === "link" ? tr("dokument je uložený jen v odkazu, na server se nic neposílá") : tr("zašifrováno v úložišti do {0}, klíč je jen v odkazu", fmtDate(res.exp))}
              </p>
            )}
          </div>
          <textarea
            readOnly
            value={busy ? tr("Připravuji odkaz…") : (res?.url ?? "")}
            onFocus={(e) => e.target.select()}
            rows={3}
            aria-label={tr("Sdílený odkaz")}
            className={cn("w-full resize-none rounded border border-[#cfd6de] bg-[#f7f9fb] px-2 py-1.5 font-mono text-[11px] leading-snug text-[#26303b] outline-none focus:border-brand", busy && "text-[#8a95a3]")}
          />
          {err && <p className="mt-1 rounded border border-brand/30 bg-[#fff7f6] px-2 py-1.5 text-[12px] text-brand">{err}</p>}
          {longLink && !err && (
            <p className="mt-1 text-[11.5px] text-[#8a6d1f]">
              {tr("Dlouhý odkaz (")}{kb(res!.url.length)}{tr("): WhatsApp, e-mail, Teams a Slack ho přenesou, SMS ne. U e-mailu raději „Kopírovat odkaz“ a vložit do zprávy.")}
              {!storeOk && tr(" Pro velké modely (STEP) lze zapnout šifrované úložiště (viz dokumentace).")}
            </p>
          )}
          {res && (
            <p className="mt-1 text-[11.5px] text-[#6b7785]">
              {tr("Platí do:")}{" "}<strong className="text-[#26303b]">{fmtDate(res.exp)}</strong>
              {res.password && tr(" · chráněno heslem")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn primary disabled={!res} onClick={() => void copy("url")} title={tr("Zkopíruje odkaz do schránky")}>
            <span className="inline-flex items-center gap-1.5">
              <CadIcon name="copy" className="h-4 w-4" />
              {copied === "url" ? tr("Zkopírováno ✓") : tr("Kopírovat odkaz")}
            </span>
          </Btn>
          <Btn disabled={!res} onClick={whatsapp} title={tr("Otevře WhatsApp s připravenou zprávou")}>
            WhatsApp
          </Btn>
          <Btn disabled={!res} onClick={email} title={tr("Otevře nový e-mail s odkazem")}>
            E-mail
          </Btn>
          {canShare && (
            <Btn disabled={!res} onClick={() => void native()} title={tr("Nabídka sdílení systému (Teams, Messenger, Signal…)")}>
              {tr("Sdílet…")}
            </Btn>
          )}
          <Btn disabled={!res} onClick={() => void copy("msg")} title={tr("Zkopíruje hotový text zprávy s odkazem")}>
            {copied === "msg" ? tr("Zkopírováno ✓") : tr("Kopírovat zprávu")}
          </Btn>
        </div>

        <p className="text-[11.5px] leading-relaxed text-[#6b7785]">
          <strong className="text-[#26303b]">{tr("Ochrana dokumentace:")}</strong> {tr("odkaz obsahuje dokument zkomprimovaný v části za „#“, kterou prohlížeč na server nikdy neposílá – dokument existuje jen ve zprávě, kterou pošlete.")}
          {storeOk ? tr(" Velké modely jdou do úložiště zašifrované (AES-256); klíč je jen v odkazu a soubor se po vypršení platnosti smaže.") : tr(" Velké modely (importovaný STEP) do odkazu nevejdou – pošlete soubor .mncad nebo STEP.")}
          {" "}{tr("S heslem je odkaz bez hesla nečitelný.")}
        </p>
      </div>
    </Modal>
  );
}
