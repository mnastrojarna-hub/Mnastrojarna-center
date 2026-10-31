"use server";

import { partyAresLookup } from "@/lib/parties/autofill-service";
import type { AresLookupResponse } from "@/lib/parties/autofill-types";
import type { PartyKind } from "@/lib/contacts/roles";

/**
 * „ARES" v dialogu zákazníka / dodavatele: IČO → název, DIČ a sídlo z registru (+ upozornění, když firma
 * v adresáři už je). Nic se neukládá — formulář jen předvyplní, uloží uživatel. Oprávnění: partyAresLookup.
 */
export async function aresLookupAction(kind: PartyKind, ico: string, exceptId?: string | null): Promise<AresLookupResponse> {
  return partyAresLookup({ kind, ico, exceptId });
}
