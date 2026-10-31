"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM } from "@/content/site";
import { cn } from "@/lib/cn";
import { takeHandoffFiles } from "@/lib/file-handoff";
import { ALLOWED_EXT, BUDGETS, DEADLINES, MAX_UPLOAD_BYTES, NEEDS, QUANTITIES, isValidCzIco, validateLead, type LeadInput } from "@/lib/lead";
import { fmtNum, type Metrics } from "@/lib/mesh-metrics";
import { CAD_EXT, extOf } from "@/lib/occt";
import { track } from "./analytics";
import { Dropzone } from "./dropzone";
import { Icon } from "./icons";

const CadViewer = dynamic(() => import("./cad-viewer").then((m) => m.CadViewer), { ssr: false });

const STEPS = ["Zakázka", "Dokumentace", "Firma a kontakt"] as const;
const STEP_FIELDS: (keyof LeadInput | "files")[][] = [
  ["needs", "budget", "description"],
  ["dataLink", "files"],
  ["ico", "company", "name", "email", "phone", "gdpr"],
];

type Company = { name: string; address?: string };

export function RfqForm() {
  const params = useSearchParams();
  const [step, setStep] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [lead, setLead] = useState<LeadInput>(() => ({
    needs: [],
    budget: "",
    quantity: "",
    deadline: "",
    material: "",
    description: "",
    dataLink: "",
    ico: "",
    company: "",
    name: "",
    position: "",
    email: "",
    phone: "",
    gdpr: false,
    nda: false,
  }));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const [ares, setAres] = useState<{ state: "idle" | "loading" | "ok" | "missing"; company?: Company }>({ state: "idle" });
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const tracked = useRef(false);

  // předvyplnění služby z URL a souborů z 3D prohlížeče
  useEffect(() => {
    const s = params.get("sluzba");
    if (s && NEEDS.some((n) => n.id === s)) setLead((l) => (l.needs.includes(s) ? l : { ...l, needs: [s] }));
    const handed = takeHandoffFiles();
    if (handed.length) setFiles(handed);
  }, [params]);

  const set = <K extends keyof LeadInput>(k: K, v: LeadInput[K]) => {
    setLead((l) => ({ ...l, [k]: v }));
    if (!tracked.current) {
      tracked.current = true;
      track("rfq_start");
    }
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  // ARES — automatické doplnění názvu firmy
  useEffect(() => {
    const ico = lead.ico.replace(/\s/g, "");
    if (!isValidCzIco(ico)) {
      setAres({ state: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setAres({ state: "loading" });
    fetch(`/api/ares?ico=${ico}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { ok: boolean; company?: Company }) => {
        if (j.ok && j.company) {
          setAres({ state: "ok", company: j.company });
          setLead((l) => (l.company ? l : { ...l, company: j.company!.name }));
        } else setAres({ state: "missing" });
      })
      .catch(() => !ctrl.signal.aborted && setAres({ state: "missing" }));
    return () => ctrl.abort();
  }, [lead.ico]);

  const totalSize = files.reduce((a, f) => a + f.size, 0);
  const cadFile = useMemo(() => files.find((f) => CAD_EXT.includes(extOf(f.name))) ?? null, [files]);
  const cadSummary = metrics && cadFile ? `${cadFile.name}: ${metrics.size.map((x) => fmtNum(x, 1)).join(" × ")} mm, objem ${fmtNum(metrics.volume / 1000, 1)} cm³` : "";

  const fileErrors = (): Record<string, string> => {
    if (totalSize > MAX_UPLOAD_BYTES) return { files: "Přílohy přesahují 4 MB. Odeberte část souborů a vložte odkaz na úložiště (OneDrive, WeTransfer…)." };
    const bad = files.find((f) => !ALLOWED_EXT.includes(extOf(f.name)));
    if (bad) return { files: `Soubor ${bad.name} má nepodporovaný formát.` };
    return {};
  };

  const validateStep = (s: number) => {
    const all = { ...validateLead(lead), ...fileErrors() };
    const relevant = Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[s].includes(k as keyof LeadInput)));
    setErrors(relevant);
    return Object.keys(relevant).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    track("rfq_step", { step: step + 1 });
    setStep((s) => s + 1);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) return next();
    const all = { ...validateLead(lead), ...fileErrors() };
    if (Object.keys(all).length) {
      setErrors(all);
      const first = STEP_FIELDS.findIndex((f) => f.some((k) => all[k]));
      if (first >= 0 && first !== step) setStep(first);
      return;
    }
    setStatus("sending");
    setServerError("");
    const fd = new FormData();
    for (const [k, v] of Object.entries(lead)) {
      if (k === "needs") (v as string[]).forEach((n) => fd.append("needs", n));
      else if (typeof v === "boolean") fd.append(k, v ? "true" : "false");
      else fd.append(k, String(v ?? ""));
    }
    files.forEach((f) => fd.append("files", f, f.name));
    fd.append("cad", cadSummary);
    fd.append("source", `web${params.get("z") ? ` (${params.get("z")})` : ""}${document.referrer ? ` · ref: ${document.referrer.slice(0, 120)}` : ""}`);
    fd.append("_t", String(startedAt));
    fd.append("website", (document.getElementById("rfq-website") as HTMLInputElement | null)?.value ?? "");
    try {
      const res = await fetch("/api/poptavka", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: Record<string, string> };
      if (res.ok && j.ok) {
        setStatus("done");
        track("generate_lead", { currency: "CZK", value: 1, budget: lead.budget });
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        if (j.errors) setErrors(j.errors);
        setServerError(j.error ?? "Odeslání se nezdařilo. Zkontrolujte prosím zvýrazněná pole.");
        setStatus("error");
      }
    } catch {
      setServerError(`Odeslání se nezdařilo (síť). Napište nám prosím na ${TEAM[1].email}.`);
      setStatus("error");
    }
  };

  if (status === "done") {
    const c = TEAM[1];
    return (
      <div ref={topRef} className="scroll-mt-28 rounded-3xl border border-ink-700/10 bg-white p-8 text-center shadow-[0_40px_80px_-40px_rgba(39,36,37,.35)] md:p-14">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-white shadow-[0_0_40px_rgba(224,57,48,.6)]">
          <Icon name="check" className="h-8 w-8" strokeWidth={2.4} />
        </span>
        <h2 className="h-display mt-6 text-4xl text-ink-700 md:text-5xl">Poptávka odeslána</h2>
        <p className="mx-auto mt-4 max-w-lg text-lg text-ink-700/70">
          Děkujeme. Technolog nyní posoudí vaši dokumentaci a {c.name} se vám ozve s dalším postupem. Potvrzení jsme poslali na{" "}
          <strong>{lead.email}</strong>.
        </p>
        <div className="mx-auto mt-8 max-w-sm rounded-2xl bg-steel-100 p-5 text-left text-[14px]">
          <p className="font-semibold text-ink-700">
            {c.name} · {c.role}
          </p>
          <a href={c.phoneHref} className="mt-1 block text-ink-700/70 hover:text-brand">
            {c.phone}
          </a>
          <a href={`mailto:${c.email}`} className="block text-ink-700/70 hover:text-brand">
            {c.email}
          </a>
        </div>
        <Link href="/" className="btn-ghost mt-8">
          Zpět na úvod
        </Link>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-28">
    <form onSubmit={submit} noValidate className="rounded-3xl border border-ink-700/10 bg-white p-6 shadow-[0_40px_80px_-40px_rgba(39,36,37,.35)] md:p-10">
      {/* Progres */}
      <ol className="mb-10 grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" disabled={i > step} onClick={() => i < step && setStep(i)} className="w-full text-left disabled:cursor-default">
              <span className="block h-1 overflow-hidden rounded-full bg-ink-700/10">
                <span className={cn("block h-full bg-brand transition-all duration-700", i <= step ? "w-full" : "w-0")} />
              </span>
              <span className={cn("mt-2 block font-mono text-[11px] uppercase tracking-widest", i === step ? "text-brand" : "text-ink-700/40")}>
                {i + 1}. {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* Honeypot */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor="rfq-website">Web</label>
        <input id="rfq-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {step === 0 && (
        <div className="animate-fade-up space-y-8">
          <fieldset>
            <legend className="label">Co potřebujete vyrobit? *</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {NEEDS.map((n) => {
                const on = lead.needs.includes(n.id);
                return (
                  <button
                    type="button"
                    key={n.id}
                    aria-pressed={on}
                    onClick={() => set("needs", on ? lead.needs.filter((x) => x !== n.id) : [...lead.needs, n.id])}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[14px] font-medium transition-all",
                      on ? "border-brand bg-brand text-white shadow-[0_8px_20px_-8px_rgba(224,57,48,.8)]" : "border-ink-700/15 text-ink-700 hover:border-ink-700/40",
                    )}
                  >
                    {on && "✓ "}
                    {n.label}
                  </button>
                );
              })}
            </div>
            <Err m={errors.needs} />
          </fieldset>

          <fieldset>
            <legend className="label">Odhadovaná hodnota zakázky (bez DPH) *</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BUDGETS.map((b) => (
                <label
                  key={b.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[14px] transition",
                    lead.budget === b.id ? "border-brand bg-brand/5 ring-4 ring-brand/10" : "border-ink-700/15 hover:border-ink-700/40",
                  )}
                >
                  <input type="radio" name="budget" value={b.id} checked={lead.budget === b.id} onChange={() => set("budget", b.id)} className="accent-[#E03930]" />
                  {b.label}
                </label>
              ))}
            </div>
            {lead.budget === "pod-50k" ? (
              <p className="mt-3 rounded-xl bg-steel-100 p-4 text-[14px] text-ink-700/80">
                Děkujeme za zájem. Naše kapacita je vyhrazena pro B2B projekty od 50 000 Kč, proto menší zakázky a opravy bohužel
                nepřijímáme.
              </p>
            ) : (
              <Err m={errors.budget} />
            )}
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-3">
            <Select label="Množství" value={lead.quantity} onChange={(v) => set("quantity", v)} options={QUANTITIES} />
            <Select label="Termín" value={lead.deadline} onChange={(v) => set("deadline", v)} options={DEADLINES} />
            <div>
              <label className="label" htmlFor="material">
                Materiál
              </label>
              <input id="material" className="input" placeholder="např. 1.4301, 42CrMo4, AlMg3" value={lead.material} onChange={(e) => set("material", e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="description">
              Popis zakázky *
            </label>
            <textarea
              id="description"
              rows={5}
              className="input resize-y"
              placeholder="Co je to za díl / stroj, k čemu slouží, požadované tolerance, povrchové úpravy, opakovanost…"
              value={lead.description}
              onChange={(e) => set("description", e.target.value)}
            />
            <Err m={errors.description} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="animate-fade-up space-y-6">
          <Dropzone
            accept={ALLOWED_EXT.map((e) => "." + e).join(",")}
            title="Přetáhněte výkresy a 3D modely"
            hint="PDF, STEP, IGES, DXF, DWG, STL, obrázky nebo ZIP – celkem do 4 MB. Větší data vložte jako odkaz níže."
            onFiles={(f) => {
              setFiles((prev) => [...prev, ...f].slice(0, 15));
              setErrors((e) => ({ ...e, files: "" }));
            }}
          />
          {files.length > 0 && (
            <ul className="divide-y divide-ink-700/10 rounded-xl border border-ink-700/10">
              {files.map((f, i) => (
                <li key={f.name + i} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name={CAD_EXT.includes(extOf(f.name)) ? "cube" : "file"} className="h-4 w-4 shrink-0 text-brand" />
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-ink-700/40">{(f.size / 1024).toFixed(0)} kB</span>
                  </span>
                  <button type="button" onClick={() => setFiles((p) => p.filter((_, k) => k !== i))} className="rounded-full p-1 text-ink-700/50 hover:bg-steel-100 hover:text-brand" aria-label={`Odebrat ${f.name}`}>
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                </li>
              ))}
              <li className={cn("px-4 py-2 text-right font-mono text-[12px]", totalSize > MAX_UPLOAD_BYTES ? "text-brand" : "text-ink-700/40")}>
                celkem {(totalSize / 1024 / 1024).toFixed(2)} / 4 MB
              </li>
            </ul>
          )}
          <Err m={errors.files} />

          {cadFile && (
            <div>
              <p className="label">3D náhled: {cadFile.name}</p>
              <CadViewer file={cadFile} compact onMetrics={setMetrics} />
            </div>
          )}

          <div>
            <label className="label" htmlFor="dataLink">
              Odkaz na větší data (volitelné)
            </label>
            <input id="dataLink" className="input" placeholder="https://… (OneDrive, SharePoint, WeTransfer, Google Drive)" value={lead.dataLink} onChange={(e) => set("dataLink", e.target.value)} />
            <Err m={errors.dataLink} />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-steel-100 p-4 text-[14px] text-ink-700/80">
            <input type="checkbox" checked={lead.nda} onChange={(e) => set("nda", e.target.checked)} className="mt-0.5 accent-[#E03930]" />
            <span>
              <strong className="text-ink-700">Požaduji NDA.</strong> Dokumentaci pošlu až po podpisu dohody o mlčenlivosti – ozveme se s ní.
            </span>
          </label>
          <p className="flex items-center gap-2 text-[13px] text-ink-700/50">
            <Icon name="lock" className="h-4 w-4" /> Dokumentaci zpracováváme důvěrně a používáme ji výhradně pro přípravu nabídky.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-up grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ico">
              IČO / VAT ID *
            </label>
            <div className="relative">
              <input id="ico" inputMode="text" autoComplete="off" className="input pr-10" placeholder="12345678" value={lead.ico} onChange={(e) => set("ico", e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {ares.state === "loading" && <span className="block h-4 w-4 animate-spin rounded-full border-2 border-ink-700/15 border-t-brand" />}
                {ares.state === "ok" && <Icon name="check" className="h-5 w-5 text-emerald-600" strokeWidth={2.4} />}
              </span>
            </div>
            {ares.state === "ok" && ares.company && <p className="mt-1.5 text-[12px] text-emerald-700">ARES: {ares.company.name}{ares.company.address ? `, ${ares.company.address}` : ""}</p>}
            {ares.state === "missing" && <p className="mt-1.5 text-[12px] text-ink-700/50">Firmu se nepodařilo ověřit v ARES – vyplňte název ručně.</p>}
            <Err m={errors.ico} />
          </div>
          <Field id="company" label="Název firmy *" value={lead.company} onChange={(v) => set("company", v)} err={errors.company} autoComplete="organization" />
          <Field id="name" label="Jméno a příjmení *" value={lead.name} onChange={(v) => set("name", v)} err={errors.name} autoComplete="name" />
          <Field id="position" label="Pozice" value={lead.position ?? ""} onChange={(v) => set("position", v)} placeholder="např. nákup, údržba, vývoj" autoComplete="organization-title" />
          <Field id="email" type="email" label="Pracovní e-mail *" value={lead.email} onChange={(v) => set("email", v)} err={errors.email} autoComplete="email" />
          <Field id="phone" type="tel" label="Telefon" value={lead.phone ?? ""} onChange={(v) => set("phone", v)} err={errors.phone} autoComplete="tel" placeholder="+420" />
          <label className="flex cursor-pointer items-start gap-3 text-[14px] text-ink-700/80 sm:col-span-2">
            <input type="checkbox" checked={lead.gdpr} onChange={(e) => set("gdpr", e.target.checked)} className="mt-1 accent-[#E03930]" />
            <span>
              Souhlasím se zpracováním osobních údajů za účelem vyřízení poptávky dle{" "}
              <Link href="/ochrana-osobnich-udaju" target="_blank" className="text-brand underline">
                zásad ochrany osobních údajů
              </Link>
              . *
            </span>
          </label>
          <div className="sm:col-span-2">
            <Err m={errors.gdpr} />
          </div>
        </div>
      )}

      {serverError && <p className="mt-6 rounded-xl bg-brand/10 p-4 text-[14px] text-brand-600">{serverError}</p>}

      <div className="mt-10 flex flex-col-reverse items-stretch justify-between gap-3 border-t border-ink-700/10 pt-6 sm:flex-row sm:items-center">
        {step > 0 ? (
          <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-ghost">
            Zpět
          </button>
        ) : (
          <p className="text-[13px] text-ink-700/50">Zabere to cca 2 minuty.</p>
        )}
        <button type="submit" disabled={status === "sending" || lead.budget === "pod-50k"} className="btn-primary !px-8 !py-3.5 disabled:opacity-50">
          {status === "sending" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Odesílám…
            </>
          ) : step < STEPS.length - 1 ? (
            <>
              Pokračovat <Icon name="arrow" className="h-4 w-4" />
            </>
          ) : (
            <>
              Odeslat poptávku <Icon name="arrow" className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </form>
    </div>
  );
}

function Err({ m }: { m?: string }) {
  if (!m) return null;
  return (
    <p className="mt-1.5 text-[13px] text-brand-600" role="alert">
      {m}
    </p>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  err,
  type = "text",
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  err?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type={type} className={cn("input", err && "border-brand")} value={value} placeholder={placeholder} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      <Err m={err} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly { id: string; label: string }[] }) {
  const id = "sel-" + label;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— vyberte —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
