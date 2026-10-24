import { Camera } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CustomersBrowser } from "@/components/customers/customers-browser";
import { CustomerDialog } from "@/components/customers/customer-dialog";
import { requireFeature } from "@/lib/auth/session";
import { getCustomers } from "@/lib/data/queries";
import { getJobFormOptions } from "@/lib/data/jobs";

export default async function CustomersPage() {
  const user = await requireFeature("customers");
  const [customers, options] = await Promise.all([getCustomers(), getJobFormOptions()]);
  const owners = options.users.map((u) => ({ id: u.id, name: u.name, role: u.role }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Zákazníci"
        description="Adresář firem — čísla zákazníků, kontakty a celá historie zakázek. Vidí a upravuje celý tým."
        // #25: zaměstnanec obchodníkem zákazníka není — nový zákazník bez předvyplněného obchodníka
        actions={<CustomerDialog owners={owners} defaultOwnerId={user.role === "zamestnanec" ? undefined : user.id} className="flex-1 sm:flex-none" />}
      />
      <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
        <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Tip: nového zákazníka nemusíš zakládat ručně — vyfoť jeho objednávku v Knize zakázek a AI ho založí i s IČO a adresou.
      </p>
      <CustomersBrowser customers={customers} owners={owners} userId={user.id} />
    </div>
  );
}
