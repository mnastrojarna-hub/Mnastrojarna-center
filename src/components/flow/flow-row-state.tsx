import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { CONFIRMATION_STATES, INQUIRY_STATES, ORDER_STATES, type ChangeStamp } from "@/lib/jobs/flow-status";
import { FlowChip } from "./flow-chip";
import { FlowProposalChip } from "./flow-actions";
import { inquiryChip, orderChips, pricingChip, quoteChip, type ChipData, type FlowJobState } from "./flow-state";

export type FlowRowTab = "inquiries" | "pricing" | "confirmations";

interface StampLine {
  verb: string;
  stamp: ChangeStamp | null;
}

/** Kdo nastavil dílčí stav, který řádek ukazuje (na všech šířkách jako text — M11). */
function stampLines(state: FlowJobState, tab: FlowRowTab): StampLine[] {
  const { snapshot: s, stamps: st, facts: f } = state;
  if (tab === "confirmations") {
    if (!s.order) return [];
    if (s.order === "stornovana") return [{ verb: ORDER_STATES.stornovana.label, stamp: st.lost ?? st.order }];
    if (s.order === "aktualizovana") return [{ verb: `Aktualizovaná rev ${f.orderRevision}`, stamp: st.orderChange ?? st.order }];
    if (s.order === "potvrzena") {
      const lines: StampLine[] = [{ verb: ORDER_STATES.potvrzena.label, stamp: st.confirmed ?? st.order }];
      if (s.confirmation === "odeslano" && st.confirmationSent) lines.push({ verb: CONFIRMATION_STATES.odeslano.label, stamp: st.confirmationSent });
      return lines;
    }
    if ((s.order === "dorucena" || s.order === "rozpor") && f.orderRevision > 1) {
      return [{ verb: `${ORDER_STATES[s.order].label} rev ${f.orderRevision}`, stamp: st.orderChange ?? st.order }];
    }
    return [{ verb: ORDER_STATES[s.order].label, stamp: st.order }];
  }
  if (!s.inquiry) return [];
  const label = INQUIRY_STATES[s.inquiry].label;
  if (s.inquiry === "odmitnuta" || s.inquiry === "stazena") return [{ verb: label, stamp: st.lost ?? st.inquiry }];
  return [{ verb: label, stamp: st.inquiry }];
}

function chipsFor(state: FlowJobState, tab: FlowRowTab): ChipData[] {
  const { facts: f, snapshot: s } = state;
  if (tab === "confirmations") return orderChips(f, s);
  if (tab === "pricing") {
    const list: ChipData[] = [];
    const quote = quoteChip(s);
    const pricing = pricingChip(f, s);
    if (quote && (s.quote === "rozpracovana" || s.quote === "ke_schvaleni" || s.quote === "schvalena")) list.push(quote);
    else if (pricing) list.push(pricing);
    const inq = inquiryChip(f, s);
    if (inq && s.inquiry !== "v_reseni") list.push(inq);
    return list;
  }
  const list: ChipData[] = [];
  const inq = inquiryChip(f, s);
  if (inq) list.push(inq);
  const quote = quoteChip(s);
  if (quote && s.inquiry !== "odmitnuta" && s.inquiry !== "stazena") list.push(quote);
  return list;
}

/**
 * Dílčí stav řádku stránky toku: barevné chipy (ikona + text) a pod nimi „<stav> · <kdo> · <kdy>“.
 * Čekající návrh změny je nahoře jako „duch“ s ✓ / ✕ pro toho, kdo smí rozhodnout.
 */
export function FlowRowState({ state, tab, now }: { state: FlowJobState; tab: FlowRowTab; now?: Date }) {
  const chips = chipsFor(state, tab);
  const lines = stampLines(state, tab).filter((l) => l.stamp);
  const proposal = state.facts.proposal;
  if (!chips.length && !lines.length && !proposal) return null;
  return (
    <>
      {proposal && (
        <FlowProposalChip jobId={state.jobId} proposal={proposal} stamp={state.stamps.proposal} canDecide={state.canDecideProposal} />
      )}
      {chips.length > 0 && (
        <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
          {chips.map((c) => <FlowChip key={`${c.phase}.${c.key}`} chip={c} className="shrink-0" />)}
        </div>
      )}
      {lines.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
          {lines.map((l) => <ActorStamp key={l.verb} stamp={l.stamp} verb={l.verb} now={now} />)}
        </div>
      )}
    </>
  );
}
