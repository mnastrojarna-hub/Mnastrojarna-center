import { PageHeader } from "@/components/page-header";
import { SuppliersBrowser } from "@/components/suppliers/suppliers-browser";
import { SupplierDialog } from "@/components/suppliers/supplier-dialog";
import { tagSuggestions } from "@/components/suppliers/model";
import { requireFeature } from "@/lib/auth/session";
import { getSuppliers } from "@/lib/data/queries";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("suppliers");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const suppliers = await getSuppliers();
  const suggestions = {
    technologies: tagSuggestions(suppliers, "technologies"),
    materials: tagSuggestions(suppliers, "materials"),
    certifications: tagSuggestions(suppliers, "certifications"),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dodavatelé"
        description="Kooperace a materiál — kdo co umí, jak rychle a jak jsme spokojeni. Vidí a upravuje celý tým."
        actions={<SupplierDialog suggestions={suggestions} className="flex-1 sm:flex-none" />}
      />
      <SuppliersBrowser key={q} suppliers={suppliers} initialQuery={q} />
    </div>
  );
}
