import Link from "next/link";
import { ArrowRight, BrainCircuit, Calculator, Inbox, SlidersHorizontal } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getJob, listJobs } from "@/lib/data/jobs";
import { getRecentPricingCalculations } from "@/lib/data/pricing-data";
import { getIntegrationSettingsMeta } from "@/lib/data/settings-data";
import { getFlowCounts } from "@/lib/data/flow-status";
import { getFlowJobStates, listFlowStateJobIds } from "@/lib/data/flow-pages";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { mineParam } from "@/lib/auth/flow-scope";
import { PRICING_ORDER, chipsForTab } from "@/lib/jobs/flow-status";
import { ToastProvider } from "@/components/jobs/detail/toast";
import { FlowStateFilter } from "@/components/flow/flow-state-filter";
import { STATE_PARAM, parseStateParam } from "@/components/flow/flow-state";
import type { JobDetail } from "@/lib/jobs/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiPricingPanel } from "@/components/ai-pricing-panel";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowEmpty, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { PricingBoard } from "@/components/flow/pricing-board";
import { toPricingJob } from "@/components/flow/flow-data";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";
import { formatCZK, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Kolik zakázek načíst i s položkami (zbytek je v knize). */
const MAX_JOBS = 40;

/** Nacenění — ruční ceny k poptávkám; z ceny jedním klikem nabídka. AI se jen učí. */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // #25: Nacenění zatím jen super admin (ostatní → Kniha s vysvětlením „pristup=pricing")
  const user = await requireFeature("pricing");
  const sp = await searchParams;
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const { can } = await getAccess();
  const margins = can("margins");
  const ai = can("ai_pricing");
  const settings = can("settings");

  const selected = parseStateParam(sp[STATE_PARAM], PRICING_ORDER, PRICING_ORDER);
  const filtered = selected.length < PRICING_ORDER.length;
  const [all, counts, stateIds] = await Promise.all([
    listJobs({ stages: ["poptavka", "naceneni"], sort: "deadline", dir: "asc" }, { scope }),
    getFlowCounts({ mine: mineParam(scope) }),
    filtered ? listFlowStateJobIds([{ phase: "pricing", keys: selected }], { scope }) : Promise.resolve(null),
  ]);
  const wanted = typeof sp.job === "string" ? sp.job : null;
  const list = stateIds ? all.filter((j) => stateIds.has(j.id) || j.id === wanted) : all;
  // vyžádaná zakázka vždy mezi načtenými
  const ids = list.map((j) => j.id);
  const pick = [...(wanted && ids.includes(wanted) ? [wanted] : []), ...ids.filter((id) => id !== wanted)].slice(0, MAX_JOBS);
  const [details, flows, calculations, params] = await Promise.all([
    Promise.all(pick.map((id) => getJob(id))),
    getFlowJobStates(pick),
    ai ? getRecentPricingCalculations(15) : Promise.resolve([]),
    ai && settings ? getIntegrationSettingsMeta() : Promise.resolve([]),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  const jobs = (details.filter(Boolean) as JobDetail[])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((j) => toPricingJob(j, flows[j.id] ?? null));
  const chips = chipsForTab("pricing", counts);
  const pricingParams = params.filter((s) => s.category === "pricing");
  const today = todayPrague();
  const me = { id: user.id, name: user.fullName || user.email };
  const unpriced = jobs.filter((j) => !j.items.length || j.items.some((i) => i.unitPrice === null)).length;

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="amber"
        icon={Calculator}
        title="Nacenění"
        count={list.length}
        description={
          <>Doplň ceny k poptávkám — u každé položky prodejní cenu{margins ? ", nákup a hned uvidíš marži" : ""}. Z hotové ceny vytvoříš jedním klikem nabídku pro zákazníka.</>
        }
        step="naceneni"
        actions={
          <>
            <CaptureButton label="Vyfotit doklad" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/quotes">Nabídky <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <BookLink href={bookHref("poptavky", ["poptavka", "naceneni"])} className="w-full sm:w-auto" />
          </>
        }
      />

      <FlowHint>
        <strong>Nacenění dělá člověk — AI se z tvých cen učí.</strong> Klikni na zakázku, vyplň ceny za kus
        {margins ? " (a nákupní ceny — marži vidíš jen ty a vedení)" : ""} a dej <em>Uložit nacenění</em>, nebo rovnou{" "}
        <em>Vytvořit nabídku z ceny</em>. Zakázka se tím přesune do stavu Nacenění a zapíše se, kdo nacenil.
      </FlowHint>

      <FlowSection
        icon={Calculator}
        iconClass="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        title="K nacenění"
        description={unpriced ? `${unpriced} ${unpriced === 1 ? "zakázka ještě nemá" : unpriced < 5 ? "zakázky ještě nemají" : "zakázek ještě nemá"} všechny ceny.` : "Vše naceněno — vytvoř nabídky a pošli je zákazníkům."}
        count={list.length}
      >
        {Object.keys(counts).length > 0 && (
          <FlowStateFilter chips={chips} selected={selected} fallback={PRICING_ORDER} label="Stav nacenění" />
        )}
        {jobs.length === 0 ? (
          <FlowEmpty
            icon={Inbox}
            iconClass="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
            title={filtered ? "Ve vybraných stavech nic není" : "Nic nečeká na nacenění"}
            actions={
              <Button asChild variant="outline">
                <Link href="/inquiries">Na Poptávky</Link>
              </Button>
            }
          >
            Sem se dostane každá nová poptávka. Až nějaká přijde (e-mailem, z fotky nebo ručně), uvidíš ji tady s položkami k vyplnění cen.
          </FlowEmpty>
        ) : (
          <>
            <ToastProvider>
              <PricingBoard jobs={jobs} me={me} margins={margins} today={today} initialOpenId={wanted} />
            </ToastProvider>
            {list.length > jobs.length && (
              <p className="text-center text-xs text-muted-foreground">
                Zobrazeno {jobs.length} z {list.length} — další najdeš v{" "}
                <Link href={bookHref("poptavky", ["poptavka", "naceneni"])} className="font-medium text-primary hover:underline">Knize zakázek</Link>.
              </p>
            )}
          </>
        )}
      </FlowSection>

      {ai && (
        <details className="group rounded-2xl border bg-card shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4 [&::-webkit-details-marker]:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <BrainCircuit className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">AI návrh ceny (zatím jen pro ladění)</span>
              <span className="block text-xs text-muted-foreground">Vidí jen super admin. Zákazníkům se nic neposílá — slouží k porovnání s ručními cenami.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-open:rotate-90" />
          </summary>
          <div className="space-y-5 border-t p-4">
            <AiPricingPanel />

            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <BrainCircuit className="h-4 w-4 text-violet-500" /> Historie kalkulací (samoučení)
              </h3>
              {calculations.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Zatím žádné AI kalkulace.</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {calculations.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-mono font-medium">{c.drawing_number || "—"}</span>
                      <span className="text-muted-foreground">{c.customer_name || "—"}</span>
                      <span className="text-muted-foreground">{c.material || ""}</span>
                      <span className="tabular-nums">{c.quantity} ks</span>
                      <span className="ml-auto font-semibold tabular-nums">
                        {c.corrected && c.user_unit_price
                          ? formatCZK(Number(c.user_unit_price))
                          : c.unit_price ? formatCZK(Number(c.unit_price)) : "—"}
                        <span className="font-normal text-muted-foreground"> / ks</span>
                      </span>
                      {c.corrected ? <Badge variant="warning">korigováno</Badge> : <Badge variant="secondary">AI</Badge>}
                      <span className="text-xs text-muted-foreground">{relativeTime(c.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {settings && pricingParams.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <SlidersHorizontal className="h-4 w-4 text-violet-500" /> Parametry AI kalkulace
                </h3>
                <p className="text-xs text-muted-foreground">
                  Sazby, marže, strategie a přirážky pro AI návrh. Pravidla technologa najdeš v{" "}
                  <Link href="/tuning" className="text-primary hover:underline">Ladění &amp; korekce</Link>.
                </p>
                <IntegrationSettingsEditor settings={pricingParams} />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
